# Logging HTTP estructurado y auditoría

## Base y diagnóstico

Rama `feature/structured-logging-audit`, creada desde `origin/main` actualizado a `0009b30a54b124c0b6ee7107d2551f3c6cad27ab`, que ya incorpora el PR #3 de Sonar. El árbol estaba limpio. No se reescribió la rama anterior ni se hicieron commits/push en esta etapa.

La implementación anterior ya auditaba las escrituras de cuentas, vendedores, catálogo, direcciones, carrito y pedidos dentro de las transacciones SQL. Login/refresh tenían compensación de sesión ante fallo de auditoría; logout revocaba primero en Redis. Se conservan esos comportamientos.

Las carencias encontradas fueron: ausencia de trazabilidad HTTP general; archivo de errores de texto `log/log.txt` que solo cubría el error handler y no los errores respondidos desde controladores; advertencias técnicas en texto libre; rechazos JWT sin un evento SQL uniforme; falta de correlación petición/auditoría; y atribución del registro público a la cuenta recién creada en vez de a un actor anónimo.

Las pruebas de inyección de fallo confirmaron además que login/refresh escribían SUCCESS antes de firmar el access token. Si la firma fallaba, revocaban correctamente la sesión pero conservaban ese éxito SQL prematuro. Se prepara ahora la respuesta firmada antes de escribir el éxito obligatorio, sin devolverla antes de esa escritura. Los dos casos fallaron antes y aprobaron después; se mantiene la revocación al fallar. No cambian algoritmos, secretos, tiempos, validaciones ni contratos de autenticación.

## Registro técnico

`middlewares/http-logging.middleware.js` se instala antes del parser JSON y CORS, incluyendo Swagger, errores de parsing, rutas inexistentes y respuestas directas. Emite **un solo evento `http.request` por petición** al finalizar; si la conexión se cierra antes, emite uno con `completed=false` y estado nulo cuando no hubo cabeceras. No genera un segundo evento al recibir finish/close de la misma respuesta.

Campos: `timestamp` UTC, `requestId` UUID aleatorio generado por el servidor, `method`, `route`, `userId` UUID o null, `ipAddress`, `statusCode`, `durationMs`, `completed` y `level`. La ruta procede de la plantilla del router y un mount fijo autorizado, como `/api/users/:email`; nunca de `originalUrl`, `url`, query, parámetros concretos o cuerpo. Las peticiones sin ruta reconocida se identifican como `unmatched`.

La identidad procede exclusivamente de la cuenta validada por el backend. Para denegaciones de perfil/vendedor, se registra después de verificar firma, cuenta y sesión Redis, sin modificar los permisos ni prolongar sesiones rechazadas. Registro público y autenticación fallida permanecen anónimos. Login/refresh completados conservan su ID de cuenta validada para el logger. Un override antiguo de auditoría solo puede corroborar la identidad autenticada, nunca establecerla.

No se confía en `X-Request-ID` ni se agrega una cabecera pública nueva. `trust proxy=false` permanece explícito; `X-Forwarded-For`, `Forwarded` y similares no sustituyen la IP del socket. Un despliegue detrás de proxy necesita una allowlist revisada para ese entorno; no habilitar `trust proxy=true` globalmente ni interpretar encabezados manualmente.

`services/structured-logger.service.js` usa JSON por línea en stdout, sin dependencias adicionales ni servicios externos. Permite únicamente campos y eventos definidos. No serializa requests, responses, errores, stacks, cuerpos, cookies, Authorization, JWT, refresh tokens, OTP, claves, cadenas de conexión, correos o rutas privadas. Los logs técnicos de inicio, limpieza de imágenes y aviso de reautorización Gmail se convierten al mismo formato, sin cambiar operaciones de proveedores.

El transporte contempla excepciones, rechazos asíncronos, errores de stdout y acumulación superior a 64 KiB. Ante fallo se cuenta la incidencia y se intenta una línea fija `logging.failed` por stderr; no se adjunta el error original ni se reintenta una operación de negocio. No hay cola ilimitada ni garantía de entrega si el destino no está disponible. Los fallos del logger técnico no convierten una petición válida en error ni un error de negocio en éxito.

Si un error ocurre tras enviar cabeceras, se cierra la respuesta parcial y el logger HTTP registra su cierre. No se delega el Error original al final handler de Express: la implementación instalada imprime `err.stack` fuera de test. Se comprobó el comportamiento del cierre con una prueba específica, manteniendo el cierre de conexión esperado para una respuesta que ya no puede reemplazarse.

## Auditoría SQL y eventos

Se reutiliza exclusivamente `audit_logs`; sin columnas, tablas, permisos nuevos ni modificaciones de esquema. `AsyncLocalStorage` conserva solo el requestId del servidor y lo agrega a `details.requestId` al escribir auditoría. `details.requestId` enviado por un cliente o contexto arbitrario no se admite como fuente. Se mantiene la whitelist/redacción anterior de detalles; no se añaden payloads de petición.

| Operación | Evento SQL | Garantía |
| --- | --- | --- |
| Registro público verificado | `usuarios.crear` | Usuario/perfil/evento en la misma transacción; actor null y targetId de la cuenta creada |
| Modificación/eliminación de cuenta | `usuarios.editar`, `usuarios.eliminar` | Misma transacción; revocación Redis previa conservada, nunca se resucitan sesiones tras rollback |
| Login, refresh, logout | `usuario.login`, `auth.refresh`, `auth.logout` | Auditoría obligatoria existente; sin tokens en los eventos |
| Aprobación/rechazo/suspensión | `seller.approved`, `seller.rejected`, `seller.suspended` | Misma transacción; actor/fecha/estado; rechazo incluye motivo sanitizado |
| Productos/imágenes/asociaciones | `producto.crear`, `producto.editar`, `producto.eliminar`, eventos existentes de imágenes y `productocategoria.*` | Se conserva la auditoría transaccional del catálogo |
| Categorías | `categoria.crear`, `categoria.editar`, `categoria.eliminar` | Misma transacción |
| Direcciones | `address.create`, `address.update`, `address.default`, `address.remove` | Misma transacción y bloqueo del comprador |
| Carrito | `cart.create`, `cart.restore`, `cart.add`, `cart.update`, `cart.remove` | Misma transacción; GET puede auditar solo si crea/restaura realmente el carrito |
| Confirmación/transición de pedido | `order.create`, `order.transition` | Misma transacción con inventario, snapshots e historial; replay no duplica creación |
| Rechazos | Eventos explícitos `auth.*.denied` o fallback `access.denied` | Un evento DENIED por petición; actor null hasta validar identidad; best effort |

El fallback de auditoría se aplica a respuestas **401/403**, incluyendo errores JWT y denegaciones de negocio. No agrega filas por cada GET ordinario. Los **429** se registran en HTTP, sin insertar por cada petición limitada en MySQL; evita amplificar una ráfaga de autenticación en escrituras SQL. Los eventos explícitos existentes de registro/verificación se conservan. El marcador de denegación impide duplicar el mismo rechazo con el fallback.

### Fallos y atomicidad

- `audit.write` registra `audit.write.failed` con acción allowlisted, requestId si existe, `transactional` y `critical`; no registra el error original ni los detalles del evento.
- Un fallo de auditoría de negocio **se propaga** y hace fallar la transacción. No se emite un evento técnico de éxito anticipado. El logger HTTP registra el resultado final de la respuesta.
- Login/refresh no devuelven tokens si falla su auditoría y mantienen su compensación. MySQL y Redis no comparten una transacción distribuida; logout revoca antes de auditar y una falla SQL no revierte esa revocación.
- La auditoría de un acceso ya rechazado es best effort: el fallo se señala técnicamente pero la respuesta conserva su rechazo. El fallback se ejecuta al finalizar y puede perderse si el proceso termina abruptamente; no sustituye la auditoría obligatoria transaccional. No se implementa outbox ni infraestructura nueva.
- El logger puede descartar registros bajo avería/backpressure, sin alterar decisiones de autenticación o negocio. La durabilidad de logs técnicos y la entrega de eventos de rechazo no son equivalentes a la atomicidad SQL.

## Consulta de registros

En Docker, solo lectura:

```powershell
docker compose logs --no-color --no-log-prefix --since 1h app
```

En ejecución local puede redirigirse stdout/stderr a archivos privados ignorados, creando previamente `log/` con acceso restringido:

```powershell
node --env-file=.env index.js 1>> log/http.jsonl 2>> log/technical-errors.jsonl
Get-Content log/http.jsonl | ForEach-Object { $_ | ConvertFrom-Json } |
    Where-Object { $_.event -eq 'http.request' -and $_.statusCode -ge 400 }
```

No se ejecutaron esos comandos sobre la API habitual en esta etapa. Para correlación, filtrar `requestId` en los JSON; en auditoría el mismo valor queda en `details.requestId`. `GET /api/audit-logs` continúa siendo solo ADMIN y paginado, sin exponer details; los privilegios SQL mínimos existentes siguen aplicándose. No se agregan GRANT ni se amplía la respuesta para consultar correlación. Un operador con autorización previa puede usar una consulta parametrizada sobre details en su entorno autorizado.

IP, UUID y motivos de auditoría son datos que requieren control de acceso y una política de retención. Los archivos existentes de `log/log.txt` no se borran ni se migran. El journal `log/cloudinary/` permanece intacto y conserva su función de recuperación. La rotación/retención de stdout en Docker o de archivos locales debe establecerse operativamente antes de un despliegue; no se cambia Compose ni se reinician servicios en este trabajo.

No hay cambios de rutas, cuerpos, códigos de respuesta, cabeceras públicas o modelo de autenticación. **No se modifica Swagger**. No se publican reportes de pruebas ni secretos.

## Validación

Se agregaron **27 casos** entre las suites del logger, HTTP, autenticación, middleware de auditoría y error handler. Cubren JSON seguro, anonimato, correlación concurrente, IP/proxy, estados 401/403/429/500, cierre prematuro, fallos del transporte y fallos de firma sin éxito SQL prematuro. Se ampliaron los casos existentes del runner real para comprobar correlación persistida, registro público anónimo y ausencia de SQL de auditoría en una lectura ordinaria; se conservaron rollback y mínimo privilegio.

| Verificación | Resultado comprobado |
| --- | --- |
| Pruebas dirigidas iniciales | 54 aprobadas en seis suites |
| Fallo de firma antes de corregir el orden | 2 fallidas, confirmando el éxito SQL prematuro |
| Suite de autenticación tras corregirlo | 21 aprobadas |
| Última regresión completa con flags reales | **694 aprobadas, 0 fallidas, 43 omitidas**, 62 suites aprobadas y 5 omitidas; 120,642 s |
| Hijo HTTP/MySQL de esa regresión | **32/32 aprobadas**, incluidas las nuevas aserciones y los fallos transaccionales existentes |
| Ajuste final de respuesta parcial + HTTP | 17 aprobadas; ejecutado después de esa regresión real |
| Código final, build Node 20/Linux | **693 aprobadas, 0 fallidas, 45 omitidas**, 60 suites aprobadas y 7 omitidas |
| Diagnóstico final Node 20/Linux sin red, `--runInBand --detectOpenHandles` | **693 aprobadas, 0 fallidas, 45 omitidas**, salida 0 y sin reporte de handles abiertos |
| Repetición paralela final Node 20/Linux sin red | **693 aprobadas, 0 fallidas, 45 omitidas**, salida 0, 7,202 s, cero advertencias de workers/handles |
| Audit del backend en el build | Salida 0 con umbral high; 0 altas/críticas, 19 moderadas y 4 bajas |
| Instalación/build | `npm ci --ignore-scripts`, cobertura, generación Swagger y `docs:build` aprobados; sin generación de diagramas |

La diferencia de contadores entre 694 reales y 693 del build no es una pérdida de cobertura: el build omite los dos disparadores de Docker real y agrega el caso final de respuesta parcial. La regresión real se ejecutó antes de ese último ajuste acotado del error handler; el código final completo sí se ejecutó en Node 20/Linux y en sus pruebas dirigidas. No se declara una ejecución final combinada Node 20 + Docker real en GitHub, ya que no se publicó esta rama.

Los 43 omitidos del proceso real son suites con variables de identidad propias: 32 casos se ejecutan en los procesos hijos MySQL; los 11 históricos de migraciones/transición no se repitieron en este trabajo porque no se modificaron migraciones ni su runner. En el build sin Docker se omiten también los dos disparadores reales, totalizando 45. La colección Postman completa sigue pendiente por el Word ausente; no se alteró su barrera ni se presentó como aprobada. Los proveedores Gmail/Cloudinary se simularon; no se enviaron correos ni archivos reales.

Durante una regresión, el caso añadido de permisos agotó el limitador compartido de la suite y produjo un 429 legítimo donde el caso posterior esperaba 401. Se corrigió el fixture del caso nuevo para preparar directamente su sesión aislada; no se cambiaron límites de producción, timeouts ni reglas. Se añadió además un caso con el rate limiter real para comprobar el registro del 429 sin SQL adicional.

### Cobertura y límites

| Medición | Líneas | Ramas |
| --- | ---: | ---: |
| Regresión real anterior al último ajuste de respuesta parcial | 90,79 % | 86,00 % |
| Código final, Node 20/Linux | 83,91 % | 82,89 % |
| Nuevo middleware HTTP, Node 20/Linux | 100 % | 100 % |
| Nuevo servicio de logging, Node 20/Linux | 100 % | 93,10 % |
| Middleware de auditoría, Node 20/Linux | 100 % | 94,73 % |
| Servicio de auditoría, Node 20/Linux | 96,55 % | 98,93 % |

Son métricas de Jest sobre los archivos cargados/instrumentados, no una nueva medición de SonarCloud. No se fusionó la cobertura de procesos hijos ni se modificaron exclusiones, umbrales o workflows.

El build paralelo emitió una advertencia de cierre forzado de un worker, aunque todas sus pruebas y comandos terminaron con salida 0. El diagnóstico serial posterior con `--detectOpenHandles`, sin red ni mounts, terminó normalmente sin señalar handles abiertos. Se comprobó además una repetición del comando paralelo original; su resultado se registra a continuación sin cambiar configuración ni aumentar timeouts para ocultar la advertencia.

La primera repetición paralela no reprodujo la advertencia, pero falló un caso preexistente de `secure-config-file.test.js`: su spy global de `fs.readFileSync` capturó las lecturas de dependencias sourcemap hechas por Jest al renderizar el stack de `toThrow`, fuera de la operación protegida. Se acotó la captura a la ejecución de `readConfigFile` y se restaura el spy antes de las aserciones. Se sigue exigiendo Error y **cero lecturas durante la operación**, sin modificar el cargador seguro, allowlists, RSA o TLS.

La repetición paralela final utilizó la imagen final ya construida, sustituyendo únicamente ese archivo de prueba dentro de un contenedor propio verificado por ID, nombre y etiqueta, sin red ni mounts. Aprobó los 693 casos sin advertencia; se eliminó su contenedor al terminar. La causa de la advertencia inicial de worker no queda confirmada: no se declara una fuga resuelta, sino una advertencia no reproducida en los diagnósticos posteriores. Debe observarse en el próximo CI. No se cambiaron los límites de Jest, número de workers o reglas de producción para obtener un resultado verde.

### Recursos y revisión

Se utilizaron cuatro servidores MySQL tmpfs de regresión, retirados por el runner, y **24 fixtures Redis temporales**, cuyos 24 reportes confirman `cleanup=true`. Se añadieron contenedores Node 20 desechables sin red ni mounts para diagnosticar el cierre de workers, con límite de ejecución y `--rm`; la imagen de verificación se conserva como artefacto local. No se desplegó la API habitual ni se iniciaron o reiniciaron MySQL/Redis habituales.

`git diff --check` y la comprobación de sintaxis JS pasan; el escaneo de patrones del conjunto modificado/nuevo no detecta claves privadas o tokens completos. Las evidencias permanecen en `log/logging-*.log` y JSON ignorados por Git, con datos únicamente sintéticos. El escaneo no garantiza detectar todo secreto posible.

Archivos (21 en total): `index.js`; controlador de auth; middlewares HTTP, auditoría, autorización y errores; servicios de logger, auditoría, cuentas, autenticación y mensajes técnicos de Gmail/imágenes; pruebas unitarias/HTTP, `accounts.mysql.test.js`, el helper `security-checks.js` y el ajuste del spy de `secure-config-file.test.js`; este documento. No se modifica el esquema, el journal Cloudinary, claves, credenciales, MySQL/Redis habituales, Swagger público ni workflows. Sin commit ni push.

Riesgos operativos conservados: durabilidad/retención del destino de logs, pérdida de eventos best effort ante terminación abrupta, ausencia de atomicidad distribuida Redis/MySQL, acceso administrativo a auditoría dependiente de los permisos previamente autorizados y prueba de proveedores reales fuera de alcance. No se otorgan permisos ni se afirma haber verificado su estado actual en el servidor habitual.
