# Redis 8.2 en Compose: preparación y reinicios controlados

Estado original de esta preparación: Redis aún no iniciado en esa etapa. El usuario
reporta posteriormente Redis healthy y conexión TLS verificada. La integración
HTTP actual, todavía sin activación de la API habitual en esta tarea, se detalla
en [Etapa 3 de autenticación](auth-stage3.md). Checkout conserva su firma independiente. No se cambia
MySQL, sus cuentas, datos o volumen. `compose.yaml` sustituye el archivo anterior;
Compose lo descubre automáticamente y conserva el nombre de proyecto derivado
del mismo directorio. No usar otro `--project-name` ni mover el proyecto al operar
el MySQL existente: podría seleccionar otro volumen. Esta tarea no ejecutó `up`.

## Diseño y decisiones

- `redis:8.2`, volumen independiente `redis_data:/data`, AOF con `appendfsync always`,
  rechazo de AOF truncado, sin snapshots periódicos, `maxmemory 128mb`, `noeviction`
  y límite del contenedor de 256 MiB. Debe medirse memoria bajo carga antes de
  producción: `noeviction` deniega escrituras al agotar memoria; el servicio
  de sesiones falla cerrado y no reintenta resultados inciertos.
- Solo Redis y API pertenecen a `redis_private`. MySQL mantiene su red por defecto.
  Se usa un bridge dedicado y publicación **127.0.0.1:6380:6379** para Node en Windows.
  No se marca `internal:true`, porque impediría la ruta al host necesaria para ese
  caso. La única exposición al host es loopback; no se proporciona acceso remoto.
  Esto no configura una prohibición de tráfico saliente del servidor Redis.
- Docker: Node usa `redis:6379`. Host: `127.0.0.1:6380`. Ambos usan TLS, con
  verificación de CA/hostname. No se relajó la exigencia TLS del cliente actual.
- Redis no acepta TCP sin TLS (`port 0`). ACL desactiva el usuario default;
  `auth_session_app` solo dispone de `INFO/GET/SET/DEL/TIME/WATCH/UNWATCH/MULTI/EXEC`
  en `secure-ecommerce-auth:*`. `redis_health` solo dispone de `PING`, sin claves.
  No existe una cuenta administrativa predeterminada ni contraseñas por defecto.
- `INFO` es un permiso necesario para identidad, rol y versión; no se registra
  su respuesta. La ACL contiene SHA-256 de las contraseñas. Los archivos del
  cliente contienen el secreto y están excluidos de Git y del contexto Docker.
- El healthcheck usa TLS, su cuenta exclusiva y contraseña desde un secret;
  el secreto no viaja en argumentos de `redis-cli`. El fragmento de shell solo
  conecta herramientas del healthcheck; la lógica de aplicación/recuperación
  permanece en JavaScript. No hay scripts de servidor.

## Pasos manuales antes de autorizar el arranque

**No se ejecutaron estos pasos sobre el entorno habitual.** Revisar y autorizar
el aprovisionamiento de secretos y el inicio de Redis antes de realizarlos.

1. Desde la raíz, preparar credenciales nuevas mediante:

   ```sh
   node scripts/redis/control.js prepare
   ```

   Escribe contraseñas CSPRNG de 32 bytes (64 hexadecimales), ACL con hashes y
   directorio de estado en `.secrets/redis/`. No imprime valores. Rechaza
   sobrescribir cualquier archivo de credenciales existente. Si falla a mitad,
   detenerse e inspeccionar; no borra ni rota automáticamente secretos.

2. Aprovisionar una CA y certificado de servidor, conservando la clave de CA
   fuera del proyecto. Instalar estos archivos locales protegidos:

   ```text
   .secrets/redis/ca.crt
   .secrets/redis/server.crt
   .secrets/redis/server.key
   ```

   El certificado debe ser válido para `DNS:redis`, `DNS:localhost` y
   `IP:127.0.0.1`, con uso TLS de servidor y cadena de confianza correcta.
   Puede utilizarse una CA local administrada o OpenSSL como herramienta de
   aprovisionamiento. No se generan certificados autofirmados ni se desactiva
   su verificación automáticamente. No usar llaves/contraseñas de ejemplo.

3. Revisar permisos del SO. El preparador usa 0700/0600 en POSIX; en Windows
   restringir ACL NTFS al operador y cuentas necesarias. Compose monta secretos
   locales como archivos; no es un almacén cifrado ni remapea de forma fiable
   UID/GID de archivos bind. Comprobar el UID/GID de la imagen antes de arrancar.
   Redis debe poder leer `users.acl`, `health-password`, CA, certificado y clave;
   el usuario Node del Dockerfile debe poder leer `app-password`, CA y estado.
   En Linux, conceder ACL de lectura a esos UID concretos (p. ej. `setfacl`),
   manteniendo el resto restringido. El directorio de estado requiere permiso
   de recorrido y su JSON permiso de lectura para Node, también tras cada
   reemplazo atómico. No resolverlo con permisos globales de escritura ni root.

4. Usar el `.env` local unificado (ignorado). Si ya existe, incorporar únicamente
   la sección **REDIS** de `.env.example`, sin reemplazar credenciales ni otras
   variables existentes. Si todavía no existe, crear `.env` a partir del ejemplo
   y completar los valores necesarios. No hay un archivo de entorno Redis aparte.
   Para Node ejecutado en Windows/host, conservar `127.0.0.1:6380`, TLS y establecer rutas
   **relativas al proyecto** de `AUTH_REDIS_PASSWORD_PATH` a `.secrets/redis/app-password` y
   `AUTH_REDIS_STATE_PATH` a `.secrets/redis/state/state.json`. Mantener
   namespace/usuario del ejemplo. No definir `AUTH_REDIS_GENERATION` ni
   `AUTH_REDIS_EXPECTED_RUN_ID` si se usa el JSON: dejarlas vacías; fuentes ambiguas
   se rechazan. Eliminar cualquier definición obsoleta de esas variables en el
   shell invocador, porque las variables del shell prevalecen sobre `--env-file`.
   El servicio Docker conserva `redis:6379` y rutas `/run/...` en Compose; no copiar
   esos valores al `.env` utilizado por Node en Windows. Todos los secretos y
   certificados continúan bajo `.secrets/redis/`, excluido de Git y del build.

5. Configurar `AUTH_REDIS_CA_PATH=.secrets/redis/ca.crt` en el `.env` unificado.
   El cliente resuelve y carga esa CA explícitamente sin depender del directorio
   de ejecución ni de modificar la confianza global después de iniciar Node.
   Si otros proveedores necesitan `NODE_EXTRA_CA_CERTS`, configurarlo en el shell
   **antes** de iniciar Node. Ejemplo PowerShell opcional, sin credenciales:

   ```powershell
   $env:NODE_EXTRA_CA_CERTS = (Resolve-Path .secrets/redis/ca.crt).Path
   ```

   Para Node dentro de Docker, Compose ya prepara `redis:6379`, TLS y rutas
   `/run/secrets/...`. El directorio de estado se monta completo en lectura,
   para que el reemplazo de su JSON sea visible. No se agrega dependencia de
   arranque de la API sobre Redis ni se conectan endpoints en esta etapa;
   los montajes de la API requieren preparar esos archivos antes de recrearla.

6. Revisar la configuración sin ejecutar servicios:

   ```sh
   docker compose --env-file .env.example config --quiet
   ```

## Inicio y recuperación, solo tras autorización operativa

Para iniciar únicamente Redis, una vez aprobados los pasos anteriores:

```sh
docker compose up -d redis
docker compose ps redis
```

No ejecutar un `up` general para esta operación. Redis no depende de MySQL ni
de la API. No usar `down`, no eliminar volúmenes y no recrear `db`.

Después del primer arranque, y **después de cada reinicio, restauración o resultado
incierto**, detener las instancias de API consumidoras durante el procedimiento
controlado y ejecutar manualmente:

```sh
node --env-file=.env scripts/redis/control.js recover --invalidate-sessions
```

La utilidad autentica con TLS, lee `INFO server replication` dos veces, exige
Redis 8.2 primario e identidad estable y guarda atómicamente un JSON local
`{version, namespace, generation, expectedRunId}`. La generación es un UUID nuevo
**en cada invocación**, incluso si run_id no cambió. No modifica Redis, ACL ni
credenciales. Si la lectura o TLS falla, no publica estado. Un timeout impide
publicaciones tardías. Los errores no muestran diagnósticos sensibles.

Revisar nuevamente los permisos de lectura del JSON reemplazado y reiniciar
explícitamente los futuros consumidores Node para cargarlo y crear un nuevo pool.
No hay autorecuperación, seguimiento de run_id sin control, ni reconexión de
clientes envenenados. Mientras no se complete este procedimiento, el servicio
falla cerrado. El acceso HTTP actual todavía no consume este servicio.

Una generación nueva obliga a **reautenticar todas las sesiones anteriores**.
Las sesiones conservadas en AOF no se reactivan porque pertenecen a otro prefijo;
sus TTL las retirarán sin borrar el volumen. No editar un marcador antiguo ni
reusar su generación para conservar sesiones tras una recuperación. Tampoco
restaurar snapshots en caliente del namespace activo. Los controles de sesión
siguen usando `WATCH/MULTI/EXEC`, conexiones exclusivas y reloj Redis.

El JSON es configuración de seguridad controlada por el operador, aunque no
contiene contraseñas. No restaurarlo desde una copia antigua sin regenerarlo.
Su nueva carga no es una transacción distribuida entre procesos: todas las
instancias consumidoras deben permanecer detenidas durante una recuperación.

## Verificación realizada

- `docker compose --env-file .env.example -f compose.yaml config --quiet`:
  salida 0, sin iniciar servicios ni usar el `.env` real.
- Comparación del objeto completo `services.db` y volumen MySQL con el archivo
  previo: idénticos; queda contrato de regresión en `redis-compose.test.js`.
- Pruebas de preparación: credenciales aleatorias, hashes ACL, negativa a
  sobrescribir, comandos mínimos, TLS, identidad, nueva generación, rechazo
  de estado ambiguo/corrupto y timeout sin publicaciones tardías.
- El runner temporal mantiene sus credenciales, tmpfs y namespace propios;
  no depende de Compose, los secrets ni el nuevo JSON opcional. Se conservan
  las pruebas de sesiones, recuperación y barreras de aislamiento.
- Node 24.13.1/Windows: **88 pruebas específicas aprobadas** en cuatro suites.
  Regresión completa: **398 aprobadas, 40 omitidas**, 39 suites aprobadas y seis
  omitidas; salida 0. MySQL/Redis reales desactivados y SQL de pruebas dirigido
  a puerto sin servicio. Las omitidas siguen sin considerarse aprobadas.
- Node 20/Linux y Redis real/TLS: no ejecutados en esta tarea. No se repitió el
  runner que necesita Docker ni se inició ningún servicio habitual. La revisión
  confirma que el runner temporal conserva configuración explícita independiente.
- Arranque habitual, TLS efectivo, permisos de archivos dentro de imágenes,
  healthcheck real y conectividad Docker/Windows: **PENDIENTES**, requieren
  secretos/certificados y autorización para iniciar Redis. No se declara que
  un healthcheck haya aprobado solo porque su definición valida.

Referencias: [publicación loopback en Docker](https://docs.docker.com/engine/network/port-publishing/),
[redes Compose](https://docs.docker.com/compose/how-tos/networking/),
[ACL Redis](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/),
[persistencia Redis](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
