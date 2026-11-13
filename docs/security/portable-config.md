# Configuración portable de RSA, HMAC y Redis

Los cargadores resuelven rutas relativas respecto a la raíz del proyecto obtenida
de `__dirname`, **no del directorio de ejecución**. Windows y Linux pueden usar
`/`; también se normalizan separadores `\` en las rutas relativas.

## Ejemplo local compartido

Incorporar las variables de `.env.example` al `.env` local existente sin copiar
credenciales de otra persona ni reemplazar `JWT_SECRET`. Para un clon nuevo,
copiar el ejemplo una sola vez y aprovisionar secretos propios:

```dotenv
JWT_RS256_ACTIVE_KID=access-v1
JWT_RS256_PRIVATE_KEY_PATH=.secrets/auth/access-private.pem
JWT_RS256_PUBLIC_KEYS_PATH=.secrets/auth/public-keys.json
AUTH_CREDENTIAL_VERSION_KEY_PATH=.secrets/auth/credential-version.key
AUTH_REDIS_PASSWORD_PATH=.secrets/redis/app-password
AUTH_REDIS_STATE_PATH=.secrets/redis/state/state.json
AUTH_REDIS_CA_PATH=.secrets/redis/ca.crt
AUTH_CONFIG_ALLOWED_ROOTS=[]
```

No se versionan `.env` ni `.secrets/` y se excluyen del build Docker. No usar rutas
de otro compañero. Las rutas del ejemplo identifican archivos locales; no contienen
claves, contraseñas ni certificados reales.

`config/auth/public-keys.example.json` sirve de plantilla para copiar a
`.secrets/auth/public-keys.json`:

```json
{ "access-v1": ".secrets/auth/public-keys/access-v1.pem" }
```

Sus entradas son relativas a la **raíz del proyecto**, no al directorio del JSON.
El kid no cambia: `access-v1`. Los archivos público/privado deben ser la pareja
RSA 3072 aprobada. No regenerarlos si ya existen. Una clave HMAC independiente
contiene 32–128 bytes binarios aleatorios, no un password ni un bcrypt.

En un clon nuevo, aprovisionar RSA con las herramientas JavaScript de Node, por
ejemplo `crypto.generateKeyPairSync('rsa', {modulusLength:3072})`, exportando la
privada en PKCS8 y pública en SPKI; la clave HMAC se obtiene con
`crypto.randomBytes(32)`. Guardarlas con creación exclusiva (`flag:'wx'`) y
permisos privados. Este procedimiento es para la primera preparación de cada
compañero, **no se ejecutó sobre las claves existentes**. Redis tiene su preparador
independiente y requiere certificados propios; seguir [Redis en Compose](redis-compose.md)
solo cuando se autorice el inicio del entorno nuevo. No recuperar el Redis de
otro compañero ni reutilizar sus credenciales o estado.

## Barreras de archivos

- Rutas relativas: exclusivamente dentro de `.secrets/` del proyecto.
- Se rechaza cualquier segmento `..`, aunque al normalizar volviera al directorio
  permitido. También URLs, UNC, rutas relativas a una unidad Windows (`C:file`),
  alternate data streams, controles y rutas de otra plataforma.
- Las rutas absolutas también deben pertenecer a una raíz permitida. Se aceptan
  `.secrets/` y, en Linux, `/run/secrets`, `/run/redis-state`, `/run/auth/public-keys`.
  Otros montajes administrados requieren `AUTH_CONFIG_ALLOWED_ROOTS`, un array
  JSON de rutas absolutas aprovisionado por el operador. No viene de HTTP.
- Una ruta relativa nunca aprovecha esa allowlist para salir del proyecto.
- Se rechazan enlaces simbólicos/junctions en cualquier componente. Los volúmenes
  bind con archivos regulares sí son compatibles. Secretos proyectados mediante
  symlinks necesitan otro montaje regular aprobado; no hay opción para desactivar
  esta comprobación.
- Se comprueban tipo, tamaño y componentes antes de abrir. Se usa `O_NOFOLLOW`
  donde existe, se verifica la identidad del descriptor antes de leer y se vuelve
  a verificar ruta/descriptor después, rechazando sustituciones durante la lectura.
  Los directorios deben seguir siendo controlados por el operador y no escribibles
  por usuarios no confiables. No se exponen errores de filesystem en HTTP.

El JSON de manifiesto/estado acepta un BOM UTF-8 inicial de herramientas Windows,
sin modificar su contenido en disco. Se mantienen los límites de tamaño, RSA 3072,
pareja activa coincidente, algoritmo RS256 exclusivo y validación estricta del kid.
El `kid` del cliente nunca forma una ruta ni dispara lecturas o peticiones externas.

## Docker y despliegues administrados

Compose conserva rutas internas absolutas: `/run/secrets/access_private_key`,
`/run/secrets/access_public_manifest`, `/run/secrets/auth_credential_key`,
`/run/secrets/redis_app_password`, `/run/secrets/redis_ca` y
`/run/redis-state/state.json`. El manifiesto Docker debe referenciar la pública
como `/run/auth/public-keys/access-v1.pem`. El manifiesto local puede usar la ruta
relativa anterior; ambos identifican las mismas claves, sin rotación.

Para otros directorios de despliegue, autorizar únicamente la raíz concreta:
por ejemplo un montaje `/etc/secure-ecommerce/keys`, mediante la variable JSON.
No autorizar `/` ni toda una unidad. En Windows cada operador puede usar sus
propias rutas absolutas en su entorno privado; el ejemplo compartido no las necesita.

## TLS de Node

`AUTH_REDIS_CA_PATH` carga explícitamente un bundle PEM de certificados X.509 y
lo entrega como `socket.ca` al cliente Redis, conservando TLS y
`rejectUnauthorized:true`. No se aceptan CA configuradas con TLS deshabilitado,
certificados inválidos ni texto extra en el bundle. Las fechas, cadena y hostname
se comprueban durante el handshake TLS; parsear una CA no demuestra conectividad.

`NODE_EXTRA_CA_CERTS` es una configuración global que Node lee **antes** de ejecutar
JavaScript. Resolver o cambiar `process.env.NODE_EXTRA_CA_CERTS` después no recarga
la confianza del proceso. Véase la [documentación oficial de Node](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).
Si se necesita para otros proveedores, establecer una
ruta absoluta válida en el shell antes de arrancar Node. Para Redis no hace falta
depender de ella: usar la variable CA explícita y portable. No desactivar la
verificación TLS ni establecer `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Diagnóstico sin secretos ni escrituras Redis

```sh
node scripts/auth/check-config.js
```

El comando lee el `.env` de la raíz y respeta la precedencia del entorno del shell.
Devuelve solo estados por variable/cargador y nombres de variables ausentes:
no imprime valores, rutas privadas, llaves, hashes, contraseñas o certificados.
No arranca la API, no conecta Redis, no inicializa marcadores ni ejecuta recovery.
Desde otro directorio se puede ejecutar mediante la ruta del script.

El incidente local diagnosticado tenía archivos RSA existentes correctos, pero
el `.env` carecía de las variables RS256 y de la ruta HMAC. Además el cargador
anterior exigía rutas absolutas. Se completaron únicamente campos de configuración
local con rutas relativas, issuer/audience y `access-v1`, creando el manifiesto
portable; no se cambiaron PEM, HMAC, contraseña Redis, CA ni estado/generación.

Verificación de esta ejecución:

- Carga local real de RS256, HMAC y configuración Redis: **OK**.
- Conexión real TLS a Redis mediante AUTH e INFO exclusivamente: **OK**, primario
  e identidad esperados. No se invocó el runtime de sesiones ni se escribió ninguna
  clave/marcador; no se ejecutó recovery.
- Regresión Windows/Node 24: **456 aprobadas, 45 omitidas**. Se agregaron 30 casos
  de rutas, enlaces, sustitución de archivos, BOM, manifiestos, CA y diagnóstico.
- Node 20/Linux: **456 aprobadas, 45 omitidas**, instalación limpia, auditoría,
  Swagger y build documental aprobados. No se generaron diagramas. Las omitidas
  no se presentan como aprobadas; no se repitieron integraciones destructivas SQL.
- Contexto Docker saneado: excluye `.secrets` y `.env`. Compose solo prepara la
  variable CA del cliente API y el kid; no se operaron contenedores habituales.

No se modificaron MySQL, Redis habitual, sus sesiones ni credenciales. Sin commit,
push, rotaciones de claves existentes o arranque de la API habitual.
