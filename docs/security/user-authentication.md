# Autenticación personal, registro y correo

Rama local `feature/user-authentication`, desde main `33709f5e8215686b4dac01460ca8b410c08bf666`, con el merge del PR #4 y structured logging. No se crean commits, push ni PR; no se modifican modelos, migraciones, las 14 tablas, claves, OAuth, configuración Redis/MySQL ni servicios habituales.

## Contratos HTTP

Todos los cuerpos rechazan campos adicionales. Nunca enviar `passwordHash`, identificadores de terceros ni campos administrativos. Los ejemplos usan variables privadas, no credenciales reales.

| Método/ruta | Cuerpo | Resultado |
| --- | --- | --- |
| POST `/api/auth/register` | Formulario completo descrito abajo | 202; validación 400, límites 429, correo/KDF no disponible 503 |
| POST `/api/auth/register/verify` | `email`, `code` | 201; OTP inválido/expirado/consumido 400, cuenta duplicada 409 |
| POST `/api/auth/password/forgot` | `email` | 202 genérico, incluso sin cuenta elegible o si falla la entrega; entrada inválida 400 y limitador HTTP 429 |
| POST `/api/auth/password/reset` | `email`, `code`, `newPassword` | 204; OTP inválido/obsoleto 400, autenticación Redis/KDF no disponible 503 |
| GET `/api/users/me` | Sin cuerpo, Bearer RS256 | 200 con perfil propio |
| PUT `/api/users/me` | Uno o más de `name`, `phoneNumber`, `storeName` | 200 con perfil actualizado; storeName solo para SELLER propietario |
| PUT `/api/users/me/password` | `currentPassword`, `newPassword`, Bearer RS256 | 204; contraseña actual incorrecta 400; revoca todas las sesiones incluida la actual |

Los endpoints personales admiten ADMIN, BUYER y SELLER activo, incluso PENDING/REJECTED/SUSPENDED como vendedor. Esto **no** habilita operaciones comerciales: las reglas de aprobación/suspensión del catálogo y checkout se conservan. Una cuenta de usuario suspendida, deshabilitada, eliminada o no verificada sigue bloqueada. Los endpoints personales no permiten cambiar email, profile, status, emailVerifiedAt, seller.status ni IDs. El CRUD administrativo existente se mantiene.

Formulario inicial BUYER:

```json
{"profile":"BUYER","name":"Persona de ejemplo","email":"buyer@example.invalid","password":"VALOR_PRIVADO_VALIDO","phoneNumber":null}
```

SELLER añade `storeName` obligatorio. BUYER debe omitirlo. ADMIN está prohibido públicamente. Name/storeName: 1–120 puntos de código, sin controles; espacios exteriores se recortan. PhoneNumber: null u omitido para ausencia, o 6–20 caracteres con dígitos, espacios, guiones, paréntesis y `+` inicial opcional; se rechazan tipos incorrectos y vacío. No se añade verificación telefónica.

La segunda petición ya no lleva formulario ni contraseña:

```json
{"email":"buyer@example.invalid","code":"123456"}
```

`123456` es únicamente un ejemplo ficticio. No funciona sin el challenge correspondiente. El correo se normaliza consistentemente y el servidor utiliza exclusivamente los datos pendientes. Un cliente no puede cambiar nombre, perfil, correo o hash al confirmar. La solicitud de código solo se realiza después de validar todos los campos y generar el hash.

Cambiar contraseña:

```json
{"currentPassword":"VALOR_ACTUAL_PRIVADO","newPassword":"VALOR_NUEVO_PRIVADO"}
```

Recuperación:

```json
{"email":"buyer@example.invalid"}
```

```json
{"email":"buyer@example.invalid","code":"123456","newPassword":"VALOR_NUEVO_PRIVADO"}
```

No inicia sesión automáticamente: después de cambio/reset se debe autenticar otra vez. El perfil propio devuelve id, name, email, phoneNumber, profile y status; SELLER añade storeName y sellerStatus. Los hashes y tokens internos no se serializan. PUT de perfil no altera la aprobación del vendedor. Las respuestas de los endpoints personales/recuperación usan `Cache-Control: no-store`.

## Hashing centralizado y compatibilidad

`services/password-hash.service.js` genera hashes nuevos con scrypt nativo, parámetros fijos **N=32768, r=8, p=3**, sal aleatoria de 16 bytes y derivación de 64 bytes. Corresponde a una configuración de referencia de [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). No se añade una dependencia nativa ni se prehashea una contraseña para volver a bcrypt.

Formato explícito: `$scrypt$v1$32768$8$3$<sal-base64url>$<derivación-base64url>`, que cabe en el VARCHAR(255) existente. La verificación valida el formato, parámetros fijos y codificación canónica antes de derivar y comparar con timingSafeEqual. Un cliente no puede seleccionar costes ni enviar hashes. Formatos desconocidos se rechazan.

La política nueva admite **8–128 puntos de código Unicode**, hasta **512 bytes UTF-8** y 256 unidades UTF-16. No se recorta ni normaliza la contraseña original; se rechazan NUL y sustitutos Unicode sueltos. La normalización NFKC solo se utiliza para comparar con la lista local limitada de contraseñas comunes; se conservan controles de candidatos numéricos/repetitivos. Esa lista no es una base exhaustiva de contraseñas comprometidas y no consulta servicios externos.

Los hashes bcrypt anteriores siguen verificándose. Se reconocen 2a/2b/2y; 2y se adapta al identificador 2b para el comparador compatible. Para bcrypt nunca se autoriza una entrada de más de 72 bytes por truncamiento. Se conserva el trabajo bcrypt ficticio del login ante usuario inexistente. La verificación de login admite contraseñas antiguas cortas, sin aplicarles retroactivamente la política de creación. Los hashes existentes no se reescriben al iniciar sesión, por lo que no se revocan sesiones solo por desplegar esta feature. Los tiempos entre algoritmos/costes heredados pueden diferir; no se promete tiempo de respuesta idéntico.

La generación/verificación se centraliza en registro, login, administración, cambio/reset y bootstrap ADMIN. La derivación HMAC de versiones de credenciales reconoce ambos formatos, conservando clave, dominio y algoritmo previos; Redis sigue recibiendo referencias no reversibles. No se cambian RS256, TTL de access/refresh, generación Redis ni fencing.

Hay como máximo dos KDF en curso y 16 esperas por proceso. La saturación falla con 503, sin fallback débil. Cada scrypt tiene un límite de memoria de 64 MiB. Los límites de cuerpo HTTP y rate limiting siguen aplicándose. Un bcrypt heredado con coste excepcionalmente alto puede seguir tardando más; los costes de hashes del servidor no provienen del cliente.

## OTP y datos pendientes

Se reutiliza `email-verification.service.js`: Map **volátil, acotado a 1000 challenges totales por proceso**, código aleatorio de seis dígitos, HMAC-SHA256 con clave efímera, diez minutos, cinco intentos, cooldown de 60 segundos y marcador busy para serializar confirmaciones/envíos. No almacena el OTP en claro. El digest incluye propósito y correo; las entradas usan claves distintas para `registration` y `recovery`.

El registro guarda una copia congelada de los campos validados y el **hash**; no almacena contraseña original en Map, Redis, archivos, logs o respuestas. Un reenvío aceptado reemplaza el código y los datos pendientes, pero conserva los intentos disponibles. Durante cooldown no sustituye el formulario existente: si se edita, esperar y volver a solicitar un código antes de confirmar. OTP correcto solo permite la identidad pendiente de ese correo y propósito.

La recuperación solo envía para una cuenta activa/verificada con perfil exclusivo. Guarda en memoria su ID y una referencia SHA256 al hash actual; no es la versión HMAC de Redis. Esa referencia se vuelve a comprobar bajo bloqueo SQL: un cambio de credenciales posterior invalida el challenge antiguo. La comparación normaliza también el correo histórico almacenado (espacios exteriores y mayúsculas), sin permitir seleccionar otro ID.

La solicitud devuelve el mismo 202 **antes de consultar cuentas o contactar Gmail**. Una cola local volátil admite como máximo 32 direcciones pendientes y dos trabajos activos, agrupa duplicados y no guarda contraseñas, OTP ni hashes en la cola: solo correo normalizado y requestId de servidor. La saturación o fallo de entrega no cambia la respuesta ni revela elegibilidad. No se envía correo ni se crean challenges OTP para direcciones desconocidas/no elegibles. Esto elimina la espera diferenciada directa por SQL/proveedor; no promete un tiempo absoluto constante bajo cualquier carga compartida. No añade infraestructura externa ni reintentos automáticos de envío.

La aceptación 202 no garantiza entrega. Si la cola está llena, la solicitud se descarta con un aviso técnico sin destinatario; un reinicio pierde trabajos en memoria. Para producción con varias instancias o garantías de entrega se necesita una decisión posterior de infraestructura. El drain interno `whenRecoveryIdle` sirve para coordinación de pruebas/cierre, no es un endpoint público. El mailbox exclusivo del runner Postman espera ese drain del workspace aislado antes de devolver el código ficticio; sus barreras de identidad e integridad permanecen intactas.

La confirmación correcta se consume tras finalizar la transacción. Un fallo de escritura conserva el challenge para retry; la unicidad SQL y la versión de credenciales impiden duplicación/cambios con estado obsoleto. Confirmaciones simultáneas no ejecutan dos mutaciones con el mismo challenge.

**Límite de despliegue:** estos challenges son por proceso, igual que la infraestructura OTP anterior. Reiniciar pierde los pendientes; deben solicitarse de nuevo. Varias réplicas necesitan afinidad de peticiones o un almacén OTP compartido diseñado y probado antes de escalar. No se implementa un almacén distribuido nuevo ni se guarda el formulario en Redis de sesiones sin autorización. Los límites actuales por IP/proceso tampoco constituyen protección distribuida contra ataques de múltiples orígenes.

## Transacciones, revocación y auditoría

Registro crea usuario/perfil/evento en la misma transacción. Edición propia bloquea el usuario y, para storeName, después el vendedor, manteniendo el orden de bloqueos. Se audita `profile.update` sin incluir datos de contacto o campos sensibles.

Cambio propio bloquea la fila, verifica la contraseña actual contra el hash vigente y revoca todas las sesiones antes de actualizar el hash y escribir `password.change` en la transacción. Reset verifica propósito/OTP/referencia y hace lo mismo con `password.reset`. Un fallo de auditoría revierte SQL; Redis no participa en una transacción distribuida: una revocación ya efectuada **permanece** tras rollback, nunca resucita sesiones. Los eventos no contienen contraseñas, hashes, OTP o tokens.

La identidad de las rutas protegidas procede de la autenticación validada y la del reset del challenge OTP verificado; ningún ID del cuerpo se utiliza como actor. Las peticiones públicas permanecen anónimas en el logger HTTP. Los fallos de entrega de recuperación emiten solo un evento técnico fijo sin correo ni datos del proveedor. Se conservan structured logging, requestId, sanitización y auditoría inmutable.

## Correo y vista previa

`email-template.service.js` comparte un diseño de tablas adaptable con encabezado azul oscuro, contenedor blanco, código destacado, caducidad y advertencia. Escapa datos dinámicos y no incluye scripts, imágenes externas, trackers o recursos remotos. Registro y recuperación tienen textos/asuntos diferentes.

`gmail.service.js` conserva texto plano y añade `multipart/alternative`: primero text/plain y después text/html, ambos UTF-8/base64 con líneas de 76 caracteres y CRLF. Boundary aleatorio generado en el servidor; datos no pueden inyectar cabeceras. Se mantienen validación de destinatario, límites MIME, configuración/credenciales, scope gmail.send, redirect URI, renovación OAuth y política de no reintentar envíos inciertos.

Vista previa local, **sin cargar credenciales ni enviar correos**:

```powershell
node scripts/gmail/preview.js
Start-Process log/email-preview/registration.html
Start-Process log/email-preview/recovery.html
```

Las vistas usan `123456` y datos ficticios; HTML y texto quedan en `log/email-preview/`, ignorado por Git. Las capturas reales en Gmail/Outlook/móvil requieren una prueba de entrega expresamente autorizada; aquí solo se validan estructura MIME/HTML y simulaciones.

## Documentación, pruebas y pendientes

Swagger y `examples/api.http` reflejan los contratos nuevos. La colección Postman incluye el registro de dos pasos, perfil propio, cambio y recuperación sobre su cuenta sintética dedicada. Se generó y comprobó estructuralmente; **no se ejecuta la colección completa ni se desactiva la barrera del Word ausente**. Los contratos anteriores que verificaban formulario en register/verify deben migrar al formulario completo en register.

### Resultados de implementación previos a la auditoría final

Antes de la auditoría final se incorporaron **37 casos nuevos** (uno de ellos condicionado a MySQL) y se adaptaron los existentes al contrato solicitado, conservando los escenarios negativos. La auditoría final añade 15 casos y amplía las comprobaciones reales, sin desactivar suites ni reducir reglas, umbrales o exclusiones.

| Verificación | Resultado |
| --- | --- |
| Módulos de hashing, OTP, correo y HTTP antes de la regresión | 78 aprobadas en siete suites |
| Regresión completa, Node 24/Windows con MySQL/Redis temporales | **731 aprobadas, 0 fallidas, 44 omitidas**, 66 suites aprobadas y 5 omitidas; 119,107 s |
| Hijo HTTP/MySQL del runner | **33/33 aprobadas**, incluido perfil/password/reset con Redis real y rollback |
| Build final Node 20/Linux | **729 aprobadas, 0 fallidas, 46 omitidas**, 64 suites aprobadas y 7 omitidas; sin advertencia de workers |
| Instalación limpia y auditoría | `npm ci --ignore-scripts` y `npm audit --audit-level=high` aprobados: 0 altas/críticas, 19 moderadas y 4 bajas en backend |
| Swagger y documentación | Generación Swagger, prueba de cobertura de todas las rutas y `docs:build` aprobados |
| Postman | Colección regenerada y contrato estructural probado; ejecución HTTP completa pendiente por Word ausente |
| Vista previa | Dos HTML y dos textos ficticios generados localmente; ningún envío real |

Los 44 omitidos del proceso real incluyen 33 casos que se ejecutan en hijos con sus variables de identidad privadas y 11 históricos de migraciones/transición no repetidos en este trabajo. El build sin Docker real omite además sus dos disparadores, totalizando 46. No se mezclan los resultados de hijos con el contador o LCOV del padre. Las integraciones reales se orquestaron desde Windows/Node 24 contra contenedores Linux propios; la regresión final de Node 20/Linux se ejecutó separadamente dentro de la imagen de verificación.

La prueba MySQL nueva encadena edición de perfil, fallo de auditoría, cambio Unicode, login y recuperación. Tiene un deadline de 15 segundos por incluir varias operaciones KDF reales y múltiples solicitudes HTTP; los deadlines de los casos existentes no se aumentaron. No se redujo el coste criptográfico para acelerar pruebas.

Los fallos encontrados durante la implementación se corrigieron y se repitieron sus verificaciones: el validador de versiones de credenciales solo reconocía bcrypt (se extendió a ambos formatos, conservando HMAC); un test de correo exigía el MIME textual anterior; y el helper real usaba `bcrypt.getRounds` para exigir el formato antiguo. Las comprobaciones actualizadas siguen verificando el formato seguro y la contraseña completa. Los helpers de registro pasan ahora el formulario a la primera petición, sin cambiar perfiles al confirmar.

| Cobertura Jest | Líneas | Ramas |
| --- | ---: | ---: |
| Regresión con recursos reales | 91,12 % | 85,21 % |
| Build Node 20/Linux | 84,76 % | 82,11 % |
| Hashing central, regresión real | 100 % | 96,00 % |
| Entrada de usuario, regresión real | 100 % | 96,15 % |
| Plantillas, regresión real | 100 % | 93,33 % |
| OTP compartido, regresión real | 100 % | 90,69 % |
| Servicio personal, regresión real | 98,21 % | 75,51 % |

Se realizó una estimación local de cambios contra `origin/main` (`33709f5`): 205/217 líneas y 149/172 resultados BRDA cubiertos, indicador combinado **91,00 %**. Incluye helpers fuente pertinentes y cuenta como cero las fuentes sin LCOV, incluido el script de vista previa. No equivale a la definición, fórmula o atribución SCM de SonarCloud. El **Quality Gate real queda pendiente de un análisis autorizado después de publicar**; el gate aprobado de main no se atribuye a esta feature.

### Recursos, archivos y riesgos pendientes

Se crearon dos MySQL descartables durante las regresiones (el primer intento se detuvo en la aserción heredada del hash y el segundo completó todo) y ocho fixtures Redis. Los ocho reportes confirman `cleanup=true`; el inventario Docker de solo lectura final no muestra fixtures pendientes de Redis o MySQL. La imagen local de verificación se conserva como artefacto, sin desplegarla. No se tocaron contenedores, datos, permisos o sesiones habituales.

La evidencia local permanece en `log/user-*.log`/JSON y `coverage/`, ignorados. `git diff --check` y sintaxis JS/CJS pasan. El escaneo de patrones de secretos en los archivos cambiados/nuevos no imprime valores ni detecta claves privadas o tokens completos; no garantiza ausencia absoluta de secretos.

Archivos principales: `password-hash.service.js`, `password-policy.service.js`, `credential-version.service.js`, `personal-account.service.js`, `user-input.service.js`, OTP/correo/plantillas, controladores/rutas personales y de auth, `accounts.service.js`, bootstrap ADMIN, Swagger, ejemplos, colección/generador Postman, pruebas y helpers aislados. No hay cambios de modelos, migraciones, configuración/credenciales, Compose, package-lock ni workflows. Sin commit, push o PR.

Pendientes reales: validación futura de SonarCloud/CI remoto; ejecución completa de Postman cuando se resuelva su referencia canónica; revisión de sus dependencias altas/moderadas ya conocidas; prueba visual de entrega Gmail/Outlook/móviles solo con autorización; y arquitectura OTP compartida antes de desplegar múltiples réplicas. No se declaran reales las pruebas con proveedores simulados ni se ocultan estos límites.

## Auditoría final de seguridad antes del commit

Se revisaron los 34 archivos iniciales, sus consumidores y los flujos de registro, login, administración, bootstrap, recuperación, perfil, correo, contratos y fixtures. Las correcciones requieren un único archivo adicional: `postman/scripts/api-server.js`, que espera el drain de recuperación en su mailbox **exclusivamente de prueba**, sin añadir endpoints a la API de producción. El conjunto final tiene **35 archivos**, todos dentro del alcance; no hay cambios de modelos, migraciones, esquema, secretos, Compose o workflows. No se realiza staging, commit, push ni PR.

### Hallazgos y correcciones

| Clasificación | Hallazgo | Corrección y evidencia |
| --- | --- | --- |
| Riesgo real de enumeración temporal, corregido | Recuperación respondía 202 igual, pero esperaba SQL/Gmail para cuentas elegibles y no para desconocidas | Se desacopla consulta y entrega con la cola acotada descrita arriba. Prueba HTTP determinista recibe ambos 202 con la consulta bloqueada y el proveedor pendiente; no usa comparaciones de milisegundos frágiles. Duplicación y saturación se prueban con 40 solicitudes: dos consultas activas y 32 admitidas como máximo |
| Compatibilidad, corregida | La comparación literal de email en reset rechazaba correos históricos almacenados con mayúsculas | Se compara el correo del usuario bloqueado tras la misma normalización básica. Se verifica con una cuenta histórica de mayúsculas; el ID continúa viniendo del challenge, nunca del cliente |
| Protección de almacenamiento, corregida | Direcciones desconocidas podían consumir entradas OTP sin poder recibir un código | El worker solo emite/almacena el challenge si la cuenta es elegible. La prueba confirma una sola emisión para la cuenta conocida y ninguna para la desconocida, conservando el mismo 202 |
| Endurecimiento preventivo | El helper de plantilla aceptaba números/arrays por coerción de regex | Se exige explícitamente string de seis dígitos. No era una vulnerabilidad HTTP confirmada porque el adaptador de correo ya exigía string; se añaden casos adversariales directos |
| Contraseñas comunes cortas, corregido | La lista heredada de la política de 15 caracteres no incluía algunos candidatos habituales de ocho caracteres | Se agregan bases como abc/abcdefgh y patrones de teclado conocidos. Cinco casos verifican sus variantes. Solo afecta contraseñas nuevas: bcrypt existente sigue verificándose, incluido un candidato ahora prohibido para altas |

### Garantías verificadas

- Scrypt usa N=32768/r=8/p=3, sal CSPRNG y parámetros no controlados por el cliente. Dos KDF activos y 16 en espera; los nuevos tienen límite de 64 MiB por derivación. Se rechazaron parámetros/formato desconocidos y sobrecarga sin un fallback criptográfico débil.
- Se probaron 128 caracteres de cuatro bytes (512 bytes UTF-8), cambios después del byte 72 manteniendo ambas entradas dentro del límite, espacios exteriores y diferencias NFKC. No hay truncamiento ni transformación silenciosa. Se verificaron explícitamente bcrypt 2a/2b/2y y la conservación exacta del HMAC v1 para hashes antiguos.
- Los costes bcrypt heredados proceden del servidor. Un coste extremo puede consumir mucho CPU aunque la concurrencia esté acotada; no se bloquean formatos legítimos retroactivamente ni se certificó el inventario de hashes del servidor habitual. Revisarlo antes de despliegues con datos heredados no controlados.
- El formulario queda congelado en memoria con hash y no puede cambiarse al confirmar. Las pruebas de propósito, correo, replay, intentos, expiración, cooldown, capacidad y concurrencia permanecen activas. La confirmación precede a la creación transaccional del usuario/perfil.
- Cambio/reset revocan sesiones antes de escribir. En MySQL aislado se simula Redis no disponible: responde 503 y no cambia el hash. Se simulan fallos de auditoría en cambio y reset: SQL conserva el hash anterior, mientras las sesiones ya revocadas permanecen revocadas. Se prueba retry del OTP tras rollback y una sola auditoría efectiva de reset.
- Una pérdida de conexión durante COMMIT puede dejar un **resultado incierto**, no una garantía de ausencia de cambios: el motor confirma o revierte la transacción completa. La unicidad de cuentas y la referencia de credenciales del challenge protegen el retry. No se presenta Redis/MySQL como una transacción distribuida ni se restauran sesiones para ocultar errores.
- La identidad de edición propia procede de autenticación validada. Las listas de campos rechazan IDs, profile, status, emailVerifiedAt y aprobación; un BUYER no puede editar storeName. El CRUD administrativo permanece con sus controles actuales. No se amplían permisos SQL.
- MIME conserva CRLF, texto primero y HTML después, base64 y boundary de servidor. Las vistas se regeneraron y coinciden con ambas plantillas; caducidad coherente, sin recursos externos ni scripts. Los encoded-words de los asuntos reales miden 64/72 caracteres. No se enviaron correos reales ni se cambiaron OAuth, credenciales o reintentos.
- Logs y errores no reciben contraseñas, hashes, OTP, cuerpos o MIME. El escaneo de patrones no encontró claves privadas/tokens completos en los candidatos; los datos de ejemplo son ficticios. Las vistas y evidencia permanecen ignoradas en `log/` y `coverage/`.

### Verificación posterior a las correcciones

| Ejecución | Resultado comprobado |
| --- | --- |
| Pruebas dirigidas de hashing/OTP/correo/HTTP/sesiones | 67 aprobadas |
| Regresión con recursos reales temporales tras las correcciones principales | **746 aprobadas, 0 fallidas, 44 omitidas**; 66 suites aprobadas y 5 omitidas; 196,626 s |
| Hijo MySQL, incluyendo nuevas inyecciones de fallo Redis/auditoría | **33/33 aprobadas** |
| Comprobación final de no almacenar OTP desconocidos y contratos | 12 aprobadas |
| Código final Node 20/Linux, instalación limpia y cobertura | **744 aprobadas, 0 fallidas, 46 omitidas**; 64 suites aprobadas y 7 omitidas; sin advertencia de workers |
| Audit del backend en Node 20 | Salida 0 con umbral high: 19 moderadas, 4 bajas, 0 altas/críticas |
| Swagger y documentación | Generación, contrato de rutas y construcción documental aprobados |

La regresión real precede únicamente al último ajuste de no almacenar challenges desconocidos; este último se comprobó con las 12 pruebas dirigidas y la regresión completa del código final en Node 20/Linux. Las 44/46 omisiones conservan la clasificación anterior: 33 casos MySQL se ejecutan en hijos y 11 históricos de migraciones/transición no se repitieron; el build omite además los dos disparadores Docker reales. No se declaran esas omisiones como aciertos del proceso padre.

Se añaden 15 casos de auditoría a los 37 originales: **52 casos nuevos frente a main**. No se elimina ni desactiva ningún test para obtener los resultados. Cobertura global observada: 91,15 % de líneas / 85,27 % de ramas en la regresión real; **84,81 % / 82,16 %** en el código final Node 20/Linux. Estas cifras no sustituyen el análisis de código nuevo de SonarCloud, que sigue pendiente de autorización para publicar.

Un MySQL tmpfs y seis fixtures Redis sirvieron a esta revisión. Los seis reportes Redis confirman cleanup=true y el inventario Docker final de solo lectura no muestra esos recursos pendientes. Se conserva la imagen local de verificación, sin desplegarla. No se accedió con escritura ni se modificaron servicios habituales.

### Dictamen

**Preparado localmente para revisión/publicación en GitHub, sin bloqueos funcionales o de seguridad confirmados pendientes dentro del alcance probado.** No equivale a autorización de despliegue o garantía absoluta de ausencia de vulnerabilidades. Permanecen las limitaciones operativas expresas: entrega/OTP volátiles y por proceso, escalado horizontal pendiente, costes heredados extremos sin inventario habitual, casos de COMMIT incierto, evaluación real de clientes de correo, Postman bloqueado por Word y análisis remoto de SonarCloud. Los consumidores HTML del perfil deben codificar la salida; aceptar texto legítimo en JSON no autoriza a renderizarlo como HTML sin escapar.
