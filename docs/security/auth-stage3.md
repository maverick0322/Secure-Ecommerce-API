# Seguridad JWT — Etapa 3: integración HTTP RS256 y Redis

Implementación local preparada, sin reiniciar la API habitual ni modificar
MySQL, sus 14 tablas, datos, cuentas o contenedores. No se conectó a Redis habitual,
no se modificaron ACL/configuración ni se ejecutaron recuperaciones sobre él.
El usuario reportó previamente Redis healthy y una conexión TLS exitosa; esta
etapa usa únicamente instancias temporales para comprobar escrituras.

## Contrato HTTP

| Endpoint | Entrada y autenticación | Resultado |
| --- | --- | --- |
| `POST /api/auth` | JSON con solo `email`, `password` | Cuenta pública más `jwt` RS256, `refreshToken`, `expiresIn:300`, `tokenType:"Bearer"`. |
| `POST /api/auth/refresh` | JSON con solo `refreshToken`; no necesita access vigente | Nueva pareja; el refresh anterior queda consumido. |
| `POST /api/auth/logout` | Bearer RS256 vigente; sin cuerpo ni IDs | 204; revoca únicamente la sesión del access presentado. Repetir tras revocación devuelve 401. |
| `GET /api/auth/time` | Bearer y sesión activa | Tiempo restante del access, máximo cinco minutos. |
| Rutas protegidas existentes | Bearer RS256 y sesión Redis válida | Se conservan perfil, propiedad, estado actual y aprobación de vendedor. |
| `PUT /api/users/:email` con `password` o cambio de estado | ADMIN y restricciones anteriores | 204; revoca todas las sesiones al cambiar contraseña, suspender, deshabilitar o reactivar. |
| `DELETE /api/users/:email` | ADMIN y restricciones anteriores | 204; revoca todas las sesiones antes del borrado lógico. |

No hay cookies nuevas ni transporte implícito de refresh. Se mantiene `jwt` en
la respuesta para reducir cambios del consumidor. Las respuestas con tokens usan
`Cache-Control:no-store` y `Pragma:no-cache`. Login y refresh rechazan propiedades
adicionales. El logout no permite elegir una sesión ajena. El rate limiter
compartido de autenticación también cubre refresh/logout.

No se emite `Set-Authorization` ni se expone mediante CORS. Ya no existe renovación
automática del access al consultar recursos. Los access HS256 antiguos son
rechazados, incluso si su firma y expiración eran válidas para el sistema anterior.
El servicio criptográfico conserva RS256 exclusivo, RSA 3072, kid de un mapa
confiable, issuer/audience propios y validación estricta de claims.

401 indica access/refresh/sesión inválidos, expirados o revocados. El cuerpo
malformado devuelve 400; un perfil o cuenta sin autorización conserva 403.
503 indica Redis/configuración criptográfica no disponible o conflictos agotados;
no habilita fallback HS256 ni autorización en memoria. SQL y otros errores
inesperados conservan 500 genérico. Los errores no adjuntan causas, secretos ni
diagnósticos de proveedores. Un access imposible de verificar por falta de
configuración criptográfica produce 503, no una aceptación temporal.

## Sesión, concurrencia y cambio de contraseña

Login compara bcrypt y el estado actual; crea sesión y vuelve a comprobar la
cuenta antes de devolver tokens. Refresh resuelve la referencia del digest,
lee la cuenta y credenciales actuales, rota atómicamente y revalida antes de
emitir el access. No se confía en roles ni IDs enviados en el refresh.

Cada petición protegida verifica RS256 y consulta MySQL/Redis; deriva la versión
HMAC desde el bcrypt actual y verifica la sesión. El middleware registra actividad
solo si concede el perfil y la aprobación comercial requerida. Sus denegaciones
403 siguen validando Redis sin touch, para detectar expiración o revocación (401)
e indisponibilidad (503), sin prolongar la inactividad.
La inactividad sigue siendo 30 minutos y el máximo absoluto ocho horas. La
expiración del access no prolonga ni reemplaza esos límites. Los permisos siguen
procediendo de perfiles SQL, no de claims de rol proporcionados por el cliente.
Vendedores pendientes/rechazados/suspendidos pueden consultar la sesión según
las convenciones previas, pero no operar comercialmente sin APPROVED.

`revokeAll` actualiza con WATCH/MULTI/EXEC un marcador `user-epoch:<uuid>` en el
namespace de Redis. Cada sesión guarda la generación del usuario y cada operación
la observa con WATCH. Una rotación o comprobación concurrente no puede pasar por
alto una revocación confirmada primero. Las sesiones anteriores quedan inutilizables
aunque sus metadatos persistan hasta el TTL; un nuevo login obtiene la generación
actual. El marcador no es una sesión y no autoriza por sí mismo. Permanece un
marcador por usuario revocado/generación del almacén; tenerlo en cuenta al dimensionar
memoria y aprobar posteriormente limpieza de namespaces retirados. No se usa SCAN
ni se requieren comandos nuevos de ACL aparte de los ya concedidos.

No hay transacción distribuida SQL/Redis. El cambio de contraseña toma el bloqueo
SQL y revoca todas las sesiones **antes** de actualizar/confirmar SQL. Si Redis
falla, la contraseña no se escribe. Si SQL/auditoría falla después, SQL revierte
pero las sesiones permanecen revocadas: iniciar sesión de nuevo con la contraseña
que finalmente conserve SQL. No se intenta deshacer una revocación. El HMAC de
credenciales vigente se comprueba además en cada petición para cerrar carreras
entre lectura de credenciales, creación de sesión y commit de contraseña.

La misma secuencia de revocación antes de SQL se aplica a suspensión,
deshabilitación y borrado lógico de cuentas. También se revoca al pasar de un
estado no activo a ACTIVE, para cerrar sesiones anteriores o creadas durante una
carrera con la suspensión. Actualizar solo el nombre o reafirmar ACTIVE sobre una
cuenta ya activa no revoca innecesariamente. Si falla Redis no se aplica la
mutación; si SQL revierte después, las sesiones permanecen revocadas.

La auditoría de login/refresh puede fallar después de mutar Redis: no se devuelve
una pareja de tokens y se intenta revocar la sesión. Logout conserva su revocación
aunque falle la auditoría SQL. Un error de red puede dejar resultado incierto;
no se reintenta automáticamente. No se promete atomicidad entre ambos almacenes.

Una reutilización de refresh revoca toda esa sesión, incluido el sucesor. Con
renovaciones simultáneas puede haber una respuesta 200 o ninguna si la comprobación
final ya ve la revocación; nunca dos sucesores utilizables. El cliente debe tener
una sola renovación en vuelo por sesión, sustituir ambos tokens y no reenviar un
refresh tras perder la respuesta. En un resultado incierto, volver a autenticar.

## Checkout: secreto preservado

`checkout-quote.service.js` queda intacto. Sigue derivando su clave HMAC independiente
de `JWT_SECRET` con el dominio `secure-ecommerce-checkout-v1`, algoritmo HS256 y
audiencia `checkout`; el access usa RSA y otra audiencia. Un quote no autentica
una petición protegida y un access RS256 no sustituye un quote.

No borrar, regenerar ni rotar `JWT_SECRET` al activar RS256. Una rotación rompería
quotes anteriores, incluidos reintentos ya confirmados cuya verificación admite
una expiración pasada para preservar idempotencia. Una migración futura de ese
secreto requiere diseño independiente de keyring/kid y compatibilidad de reintentos;
esperar diez minutos por sí solo no conserva ese contrato. No se implementa ni
se ejecuta esa rotación en esta etapa.

## Activación posterior, sin recuperaciones automáticas

1. Revisar `.env` sin sobrescribir credenciales: issuer/audience, kid activo,
   ruta absoluta de llave privada RSA 3072 y manifiesto público `kid -> ruta PEM`.
   No generar ni publicar llaves reales como parte de pruebas. Mantenerlas bajo
   almacenamiento protegido, por ejemplo `.secrets/`, fuera de Git/build.
2. Verificar el archivo binario independiente `AUTH_CREDENTIAL_VERSION_KEY_PATH`,
   de 32–128 bytes aleatorios, estable entre procesos. No usar `JWT_SECRET` ni
   un bcrypt como clave HMAC. Su rotación es una operación separada.
3. Usar el estado Redis aprobado existente: TLS, CA, usuario, secreto por archivo,
   namespace, run_id y generación actuales. No ejecutar `control.js recover`,
   vaciar Redis ni cambiar la generación simplemente para desplegar esta etapa.
   Si Redis reinicia, conservar el procedimiento controlado ya documentado y
   solicitar autorización para invalidar sesiones cuando corresponda.
4. Compose prepara en lectura `.secrets/auth/access-private.pem`,
   `.secrets/auth/public-keys.docker.json`, `.secrets/auth/credential-version.key`
   y el directorio `.secrets/auth/public-keys/`. **No se crearon esos secretos**.
   Aprovisionarlos en esas ubicaciones o aprobar un override de rutas del host;
   no mover/copiar credenciales existentes sin revisión. La API ve respectivamente
   `/run/secrets/access_private_key`, `/run/secrets/access_public_manifest`,
   `/run/secrets/auth_credential_key` y `/run/auth/public-keys/`. El manifiesto Docker
   debe mapear el kid activo a un PEM público bajo esa última ruta. Windows usa
   otro manifiesto con rutas absolutas locales; ambos pueden referenciar las mismas
   llaves aprobadas sin rotarlas. Revisar permisos de lectura para el UID Node y
   mantener la CA cargada antes de iniciar Node. MySQL y servicio Redis en Compose
   no se modificaron.
5. Coordinar la actualización del consumidor: reautenticación obligatoria de
   JWT HS256 anteriores; conservar el campo `jwt`, añadir manejo del refresh y
   retirar lectura de `Set-Authorization`. El futuro frontend .NET debe almacenar
   refresh de forma privada (preferiblemente en servidor/BFF) y no registrarlo;
   el cliente no debe inferir permisos autoritativos desde el JWT.
6. Solo después de esa revisión, reiniciar/desplegar la API por separado. El
   nuevo arranque exige criptografía, Redis y conexión SQL verificadas antes de
   escuchar; falta de configuración impide iniciar, sin modo legacy. No fue
   activado sobre la API habitual en esta tarea.

Las sesiones internas de pruebas de etapas anteriores no ofrecen compatibilidad
de formato garantizada (ahora hay generación por usuario). Esto no permite migrar
access HS256: todos requieren un login nuevo. No se modifica el esquema MySQL.

## Pruebas y evidencia

- Unitarias/HTTP: RS256, Redis no disponible (503), HS256 rechazado (401), login,
  refresh/reutilización, logout, validaciones, posesión, suspensión, contraseñas,
  expiraciones y carreras contra revocación total. Los tests HTTP de sesión usan
  criptografía real y un doble **de comandos** Redis, con lógica de producción.
- Regresión Windows/Node 24: `npm run test:coverage`, **411 aprobadas y 40 omitidas**,
  41 suites aprobadas y seis omitidas; salida 0. Cobertura global sin integración
  real: 78,21 % líneas y 72,94 % ramas. Nuevos módulos: runtime 100/100 y autenticación
  95,65 % líneas / 83,33 % ramas. Middleware 100/100. No se cambiaron umbrales,
  exclusiones ni métricas; esto no certifica el Quality Gate remoto.
- Runner Redis temporal: **seis grupos reales aprobados**, limpieza correcta.
- HTTP/MySQL 8 + Redis 8.2 aislados: login/refresh/logout, contraseña y rollback,
  controles de perfiles, direcciones, inventario/checkout, auditoría y snapshots;
  más **27 pruebas MySQL históricas aprobadas** en fixtures finales independientes.
  SMTP/Cloudinary son simulados; estas pruebas no acreditan proveedores reales.
- Node 20/Linux: imagen de verificación con instalación limpia, auditoría, **411
  pruebas aprobadas / 40 omitidas**, Swagger y build documental aprobados. No se
  ejecutó generación de diagramas. El archivo de contexto excluye `.secrets`.
- `npm audit --audit-level=high`: salida 0; 0 altas/críticas, 19 moderadas y cuatro
  bajas existentes. No se cambiaron dependencias ni se aplicó `audit fix`.
- Swagger generado correctamente y cobertura automática de rutas aprobada.
  Compose validado sin arrancar servicios; comparación confirma servicios MySQL
  y Redis, redes y volúmenes intactos. Solo se preparó configuración de la API.
  `test.yml` y `sonar.yml` descargan explícitamente la imagen Redis del runner
  aislado antes de las pruebas, sin debilitar sus verificaciones.
  Colección Postman ampliada a 114 peticiones. Ejecución
  `2c660fd3-d2c1-47b4-86d2-2d3b463299e1`: **NO APROBADA**, detenida en provisioning
  por Word ausente, antes de peticiones. Limpieza=true y metadatos del MySQL
  habitual intactos. No se retiró su barrera SHA-256. Requiere recuperar la ruta
  del documento original para volver a ejecutar; no modificar el Word.

Las 40 omitidas de la suite general son 39 MySQL y una Redis optativas. Parte de
esas MySQL (27) y el runner Redis se ejecutaron por separado como se indica;
las históricas restantes no se declaran ejecutadas en esta tarea. Los logs,
cobertura, instantáneas y reportes temporales permanecen ignorados por Git.

Se conservan cambios previos de documentación ajenos a esta tarea. Sin commits,
push, PR, cambios de credenciales ni recuperación sobre Redis habitual.
