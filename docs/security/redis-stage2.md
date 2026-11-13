# Etapa 2: sesiones Redis implementadas en JavaScript

Esta sección conserva el alcance original de la Etapa 2. La integración HTTP
posterior se documenta en [Etapa 3 de autenticación](auth-stage3.md).

Servicios internos aislados: **no se conectan a login, middleware ni endpoints**.
No activan RS256 ni modifican el contrato HTTP, JWT actual, checkout, MySQL,
migraciones, permisos o contenedores habituales. `JWT_SECRET` se conserva.

## Dependencias y configuración

Se utiliza `redis@6.3.1` (Node >=20), con `createClientPool`. Se retiraron el
archivo de lógica del servidor y su intérprete de desarrollo. Toda la lógica
de sesiones y el doble de comandos de las pruebas están escritos en JavaScript.
Los módulos no abren conexiones ni cargan variables de entorno al importarse.

Variables documentadas en `.env.example`, sin secretos reales:

| Variable | Regla |
| --- | --- |
| `AUTH_REDIS_HOST`, `AUTH_REDIS_PORT` | Destino del operador; no admite URLs con credenciales. |
| `AUTH_REDIS_TLS` | `true` o `false`; texto plano solo en loopback. TLS verifica certificados. |
| `AUTH_REDIS_USER` | Usuario ACL dedicado. |
| `AUTH_REDIS_PASSWORD_PATH` | Archivo protegido de 32–256 bytes UTF-8, relativo bajo `.secrets/` o absoluto permitido; sin salto de línea ni NUL. |
| `AUTH_REDIS_CA_PATH` | Bundle CA PEM protegido y portable; se carga explícitamente en el cliente TLS. |
| `AUTH_REDIS_NAMESPACE` | Prefijo de 3–64 caracteres ASCII: minúsculas, dígitos y guiones. |
| `AUTH_REDIS_GENERATION` | UUID del almacén aprovisionado por el operador, estable entre reinicios de la API. |
| `AUTH_REDIS_EXPECTED_RUN_ID` | Identidad `run_id` esperada: 40 hexadecimales. |
| `AUTH_REDIS_STATE_PATH` | JSON protegido de configuración del operador; sustituye generación/run_id. No se admiten ambas fuentes a la vez. |
| `AUTH_REDIS_CONNECT_TIMEOUT_MS` | 100–5000 ms, por defecto 1000; también limita la espera de una conexión del pool. |
| `AUTH_REDIS_COMMAND_TIMEOUT_MS` | 100–5000 ms por comando o `EXEC`, por defecto 1000. |
| `AUTH_CREDENTIAL_VERSION_KEY_PATH` | Archivo protegido, relativo o absoluto permitido: clave binaria aleatoria independiente de 32–128 bytes. |

Los archivos secretos deben quedar fuera de Git/contexto Docker, con ACL NTFS
o permisos 0400/0600 adecuados. Los cargadores validan tipo y tamaño; el operador
configura los permisos del SO. Para CA privadas usar la confianza protegida de
Node; no deshabilitar la validación TLS.

Requisitos operativos: Redis >=7.2 actualizado, primario dedicado en red privada,
memoria limitada y política `noeviction`. No se configura ni habilita un servidor
habitual en esta etapa. No se soporta Cluster, Sentinel ni failover transparente.

Permisos mínimos de los servicios: `INFO`, `GET`, `SET`, `DEL`, `TIME`, `WATCH`,
`UNWATCH`, `MULTI`, `EXEC`, con acceso a claves limitado a su namespace.
`PING` solo si se necesita una sonda. No conceder categorías administrativas.
`INFO` es necesario para comprobar versión, identidad y rol; sus respuestas no
se incluyen en errores ni logs. El runner concede estos permisos únicamente
en su instancia descartable. No se cambiaron permisos reales.

## API interna

```js
const { createAuthRedisConnection, loadRedisConfiguration } = require('./services/auth-redis.service');
const { createSessionService } = require('./services/auth-session.service');
const { loadCredentialVersionService } = require('./services/credential-version.service');

// Ejemplo interno; index.js no ejecuta este código.
const store = createAuthRedisConnection(loadRedisConfiguration());
await store.connect();
const sessions = createSessionService(store);
const credentialVersion = loadCredentialVersionService().derive(trustedPasswordHash);
const created = await sessions.create({ userId, credentialVersion });
// created.refreshToken es secreto; no registrarlo ni incluirlo en reportes.
```

| Método | Comportamiento |
| --- | --- |
| `create({userId, credentialVersion})` | UUID aleatorio de sesión y refresh opaco de 32 bytes. |
| `check({userId, sessionId, credentialVersion, touch?})` | Comprueba identidad, estado, credenciales y vencimiento; no prolonga actividad por defecto. |
| `rotate({refreshToken, credentialVersion})` | Consume el refresh actual y entrega su sucesor. |
| `revoke({userId, sessionId})` | Revoca la sesión; es idempotente mientras existan sus metadatos. |
| `lookupRefresh(refreshToken)` | Resuelve usuario/sesión para consulta interna; **no autentica**, puede resolver tokens consumidos y no prolonga actividad. |
| `store.close()` | Destruye el pool e impide reutilizarlo. |

El llamador debe ser confiable y obtener el usuario/versión actuales desde el
estado autorizado del servidor. Estos servicios no autorizan por sí mismos una
ruta pública. Los cuerpos rechazan propiedades adicionales; ningún cliente
puede imponer reloj, TTL, versión de credenciales o identidad objetivo.

La versión de credenciales es HMAC-SHA256 sobre el hash bcrypt con la clave
independiente. Redis no guarda contraseñas ni hashes bcrypt; los DTOs no exponen
digests ni versiones. El cambio de contraseña y su integración con MySQL siguen
fuera de esta etapa. La clave HMAC no se rota automáticamente.

## Transacciones, vencimientos y reutilización

Cada intento se ejecuta dentro de `pool.execute(async client => ...)`, con una
conexión exclusiva desde `WATCH` hasta `MULTI/EXEC` y `UNWATCH`. Se usan entre
una y cuatro conexiones; se admiten como máximo 32 operaciones pendientes.
No se comparte un `WATCH` entre peticiones ni se utiliza `pool.multi()`.

Las claves tienen prefijo `namespace:{generation}:`:

- `session:<sid>`: JSON autoritativo con usuario, HMAC de credenciales, digest
  actual, generación de refresh, revisión aleatoria, estado y fechas.
- `alive:<sid>`: revisión de la sesión con vencimiento físico por inactividad.
- `refresh:<sha256>`: índice JSON inmutable de sesión/usuario/generación y fecha
  absoluta. Los índices consumidos permanecen hasta las ocho horas.
- `store`: marcador sin TTL que vincula la generación con el `run_id` original.

`TIME` de Redis es el único reloj de negocio. Creación, rotación y `touch=true`
fijan inactividad de 30 minutos, limitada por ocho horas desde la creación.
`SET ... PXAT` aplica las fechas absolutas. Los metadatos y digests permanecen
hasta la expiración absoluta para reconocer reutilizaciones; su mera existencia
no autoriza una sesión inactiva. Al vencer absolutamente puede recibirse
`SESSION_NOT_FOUND` en lugar de `SESSION_EXPIRED`; ambos deniegan acceso.

Se observan con `WATCH` el marcador, la sesión, su clave de actividad y los índices
leídos o creados. La expiración de una clave observada aborta la transacción.
Esto impide que la espera entre `TIME` y `EXEC` reactive una sesión que ya venció.
Incluso una comprobación sin escrituras termina con `MULTI/EXEC`: si un logout
se confirma primero, la comprobación reintenta y ve la revocación.

Solo la generación/digest actuales de la sesión aceptan un refresh. Una generación
consumida revoca toda esa sesión, sin afectar otras del usuario. Dos rotaciones
simultáneas no producen dos sucesores válidos: una gana y la otra detecta
reutilización, revocando también al sucesor. El futuro cliente debe serializar
sus renovaciones y tratar la respuesta perdida como necesidad de autenticar otra vez.

### Fallos y reintentos

Se permiten cuatro intentos totales, únicamente ante el `WatchError` específico
que representa un `EXEC` abortado por cambio de claves. Cada intento relee estado
y reloj. Un cambio de topología, error de conexión, timeout, error parcial o
respuesta perdida **no se reintenta automáticamente**. Agotar conflictos o la
capacidad pendiente produce `SESSION_CONFLICT`, sin habilitar acceso.

Redis no revierte comandos anteriores cuando un comando dentro de `EXEC` falla.
Por ello la autorización exige coincidencia entre revisión de sesión y actividad,
y un índice actual coherente. Una escritura parcial de rotación deja una revisión
distinta o un índice ausente: no concede acceso. Un índice huérfano no es un token
vigente. La revocación escribe estado revocado y elimina actividad; cualquiera
de esas escrituras por separado impide autorización. Se prueban los fallos en
cada una de las tres escrituras de rotación y las dos de revocación.

`SessionStoreUnavailableError` no adjunta diagnósticos, causas, tokens ni secretos.
`outcomeUnknown=true` indica que una mutación pudo confirmarse: no significa que
no se aplicó. El pool queda bloqueado y destruido, sin cola offline, reconexión ni
fallback de autorización. Hace falta crear otro servicio explícitamente. Reenviar
un refresh ya consumido tras perder la respuesta revoca la sesión.

`UNWATCH` se ejecuta antes de devolver conexiones incluso al rechazar entradas
o reglas de negocio; si falla, se destruye el pool. Los únicos comandos de escritura
del wrapper transaccional son `SET ... PXAT` y `DEL` en el namespace propio.

## Identidad y recuperación

Se verifica primario, versión y `run_id` al adquirir cada conexión y antes de
confirmar; `INFO` y lectura del marcador también se incluyen en `EXEC` y se
validan antes de devolver resultados. El marcador se inicializa mediante una
transacción observada con `SET NX`. Cambiarlo o eliminarlo bloquea el servicio.

Tras un reinicio/promoción debe aprovisionarse **nuevo run_id y nueva generación**;
actualizar solo el run_id no acepta un marcador antiguo. Reiniciar únicamente
la API conserva revocaciones. El runner restaura una instantánea anterior al logout
en su Redis temporal reiniciado y comprueba el rechazo y el namespace nuevo.

Limitaciones explícitas: los comandos nativos no permiten condicionar escrituras
al contenido de `INFO` dentro de `EXEC`. Un proxy que cambie de servidor en una
conexión viva durante la confirmación podría recibir escrituras antes de que se
detecte la identidad distinta; el servicio no devuelve autorización y queda
bloqueado. Por eso se exige un destino primario fijo, sin failover transparente.
Una restauración en caliente dentro del mismo proceso no cambia `run_id`: requiere
procedimiento externo de nueva generación y reautenticación. Tampoco se promete
durabilidad distribuida entre Redis y MySQL. Aprobar persistencia/recuperación
antes de integrar los endpoints. Limitar creación de sesiones/rotaciones al
integrar: retención temporal no equivale a memoria global ilimitadamente segura.

## Pruebas y runner temporal

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/unit/auth-session.service.test.js tests/unit/auth-redis.service.test.js tests/unit/redis-isolation.test.js
npm run test:auth-redis
```

El segundo comando requiere Docker local iniciado por el operador e imagen
`redis:8.2` disponible. Usa `--pull never`; no inicia Docker ni descarga imágenes.
Reutiliza el wrapper existente, crea un contenedor propio identificado por
ID/nombre/etiqueta/imagen, usa tmpfs `/data` y puerto loopback aleatorio distinto
de 6379/3306/3307. Comprueba montajes y publicación antes de escribir, y compara
run_id por TCP y socket del contenedor. Credenciales aleatorias solo en memoria;
configuración y logs del servidor solo en tmpfs. No usa Compose ni volúmenes.
Reinicia y retira exclusivamente su contenedor. No accede a MySQL.

Comprueba creación, verificación, rotación, reutilización, token desconocido,
concurrencia entre dos pools, logout, vencimientos con fixtures pasados y
recuperación. No espera ocho horas ni cambia el reloj del host. Reportes sanitizados:
`log/stage5/redis-stage2/<runId>.json`, ignorados por Git.
La suite `tests/database/auth-sessions.redis.test.js` solo se activa con
`RUN_STAGE2_REDIS=1`; si se habilita sin requisitos disponibles, falla.

## Resultados comprobados — 12 de noviembre de 2026

- Node 24.13.1/Windows: **73 pruebas específicas aprobadas**, tres suites.
  Doble JavaScript de comandos, con producción ejecutando su propia lógica,
  expiración de WATCH, conflictos, conexiones exclusivas, respuestas perdidas,
  errores parciales, reutilización, recuperación y barreras del runner.
- Cobertura de los cuatro módulos: **97,91 % líneas; 90,71 % ramas;
  93,23 % sentencias; 100 % funciones**. Evidencia separada en
  `log/stage5/redis-stage2/coverage`.
- Regresión completa: **383 aprobadas y 40 omitidas**; 38 suites aprobadas y
  seis omitidas (44 totales), salida 0. Se desactivaron los activadores reales
  MySQL/Redis y se dirigió SQL de pruebas al puerto 9 sin servicio.
  Las omitidas son 39 MySQL y una integración Redis; no equivalen a aprobaciones.
- Retirar el intérprete eliminó cuatro paquetes; lockfile conserva redis 6.3.1.
  `npm audit --audit-level=high`: salida 0, **0 altos/críticos**, 19 moderados y
  cuatro bajos, vinculados a herramientas existentes. No se ejecutó `audit fix`.
- Runner real: salida 1, **NOT_EXECUTED**, sin recursos creados, cleanup=true.
  Docker Desktop no está disponible (`dockerDesktopLinuxEngine` ausente).
  Reporte: `log/stage5/redis-stage2/589fd18e-59ec-4dc6-8eba-bac0b94e3b30.json`.
  La integración real queda **PENDIENTE**, no aprobada.
- Node 20/Linux: compatibilidad de APIs/dependencias revisada; ejecución en ese
  runtime **PENDIENTE**. No se modificaron workflows.
- Persiste un aviso previo de Jest por paquetes duplicados de workspaces
  generados de Postman. No se ocultó ni se modificaron sus archivos.

No hubo commits, push, PR ni avances a la Etapa 3. No se modificaron los archivos
excluidos de documentación, autenticación actual, checkout o recursos habituales.
Antes de integrar faltan Redis real, Node 20/Linux y aprobación operativa del
destino privado, ACL/TLS, secretos y recuperación con generación nueva.

La preparación de Compose, TLS y la utilidad JavaScript de recuperación manual
se describen en [Redis en Compose](redis-compose.md). Ese procedimiento crea un
estado local nuevo tras cada reinicio sin retirar el fencing ni reactivar sesiones.
