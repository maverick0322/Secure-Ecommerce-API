# Gmail API + OAuth 2.0 para códigos de registro

Se sustituyó el adaptador Resend por `googleapis` sin cambiar rutas, respuestas
HTTP ni el desafío OTP: seis dígitos, diez minutos, cooldown de un minuto, cinco
intentos y consumo único. El código sigue guardado como HMAC en memoria del
servidor. No se guarda en MySQL ni se escribe en logs. Un fallo de Gmail conserva
el 503 genérico y el rollback del desafío existentes.

Referencia revisada: [Tap2Eat](https://github.com/onecap05/tap2eat-backend), clases
`GmailCredentialsProvider`, `GmailConfig` y `EmailSenderServiceImpl` del servicio
notification. Se tomó el patrón de consentimiento offline, almacén local, scope
de envío y MIME/base64url. La implementación es JavaScript y no copia sus logs
de destinatarios ni sus excepciones del proveedor.

## Preparación manual del cliente existente

No se creó otro cliente OAuth ni se cambiaron las credenciales descargadas.
Crear `.secrets/gmail/` y copiar allí el JSON **ya descargado** como `client.json`.
Si existe un cliente local, revisarlo antes de sustituirlo. No adjuntar el JSON
a Git, reportes, capturas o mensajes. `.secrets/` está excluido tanto de Git como
del contexto de construcción Docker.

La configuración Google existente debe contener exactamente esta URI autorizada:

```text
http://localhost:3001/oauth2/callback
```

El cliente puede ser `web` o `installed`, pero el JSON debe incluir esa URI en
`redirect_uris`. Si falta, el chequeo la rechaza; corregir la configuración del
cliente existente y volver a descargar su JSON, sin inventar un client secret.
No se aceptan endpoints OAuth externos aportados por el archivo.

Mantener OAuth en **Testing** y agregar la cuenta remitente a sus usuarios de
prueba. El único permiso solicitado y admitido al autorizar es:

```text
https://www.googleapis.com/auth/gmail.send
```

No se solicitan permisos para leer mensajes, perfil, borrado o SMTP. Elegir en
Google la misma cuenta indicada en `GMAIL_SENDER_EMAIL`; se usa como login_hint,
pero no se verifica la identidad mediante permisos adicionales. Un alias remitente
debe estar autorizado en Gmail. Google puede rechazar o normalizar un From que
no corresponda a la cuenta/alias autorizado.

## Variables del `.env` unificado

```dotenv
GMAIL_CLIENT_PATH=.secrets/gmail/client.json
GMAIL_TOKEN_PATH=.secrets/gmail/token.json
GMAIL_SENDER_EMAIL=REEMPLAZAR_POR_LA_CUENTA_GMAIL
GMAIL_REDIRECT_URI=http://localhost:3001/oauth2/callback
```

La cuenta del ejemplo es un marcador que debe reemplazarse. No se incluyen
contraseñas, client secrets ni tokens inline. Las rutas son relativas a la raíz,
con las mismas protecciones de archivos ya existentes. Para Docker, Compose
prepara `/run/secrets/gmail_client` y `/run/secrets/gmail_token` en lectura. El
cliente/callback usan destinos Google fijos, no URLs controladas por el usuario.

Restringir `.secrets/gmail/` al operador. En POSIX, directorio 0700 y archivos
privados 0600; en Windows configurar ACL NTFS. Para el contenedor, conceder al UID
Node únicamente la lectura necesaria mediante ACL/grupo específico: Compose con
archivos locales no remapea UID/GID de forma fiable. No resolverlo con root ni
con permisos de escritura globales. Mantener backups de tokens también privados.

## Comprobación sin red

```sh
npm run gmail:check
```

Lee y valida archivos/configuración. No renueva access tokens, no abre el navegador,
no contacta Google y no envía correo. Un token con estructura válida se informa
como `FILE_OK_NOT_VALIDATED_WITH_GOOGLE`: no significa que Google lo siga aceptando.
La ausencia de token antes del primer consentimiento es esperada y da salida 1.
El cliente/token reales aún no están configurados en el `.env` inspeccionado;
la comprobación local realizada fue INVALID/NOT_READY, sin operaciones externas.

## Autorización inicial y reautorización

Ejecutar **manualmente desde el host**, cuando se decida autorizar esa cuenta:

```sh
npm run gmail:authorize
```

Abre el navegador del sistema, escucha temporalmente solo en loopback:3001,
solicita consentimiento offline con PKCE S256 y state aleatorio, y procesa una
sola respuesta. No instala una ruta en la API ni cambia su puerto. Si 3001 está
ocupado (p. ej. por Postman), se detiene sin cerrar el otro proceso: liberar ese
servicio propio antes de volver a ejecutar; no cambiar arbitrariamente el callback.

El consentimiento tiene un límite de cinco minutos. State inválido, falta de
refresh token, scopes adicionales, timeout o denegación no publican un token.
El script verifica los permisos concedidos y escribe atómicamente `token.json`
con solo refresh token, scope y datos de vinculación al cliente/remitente.
Los access tokens se mantienen en memoria, no se guardan. No imprime URLs de
consentimiento, códigos de autorización, tokens ni secretos. Un fallo de reemplazo
conserva el archivo anterior. La autorización no envía mensajes.

El [modo Testing externo de Google](https://developers.google.com/identity/protocols/oauth2#expiration)
normalmente emite refresh tokens que caducan a los **siete días** para scopes Gmail;
también pueden revocarse por otros motivos. El SDK renueva automáticamente el
access token mientras el refresh sea válido. Eso no alarga la vida del refresh.

Ante `invalid_grant`, el adaptador devuelve el 503 habitual y registra únicamente:

```text
GMAIL_REAUTH_REQUIRED: ejecute npm run gmail:authorize
```

No reintenta ese refresh en cada petición ni expone detalles del proveedor.
Para volver a consentir se usa **el mismo comando** `npm run gmail:authorize`.
El remitente y cliente deben coincidir con el token. La nueva escritura permite
al proceso local detectar el refresh actualizado. En Docker, recrear solamente
`app` después para remapear el archivo reemplazado; un bind mount puede conservar
el inode anterior. No ejecutar recovery Redis ni rotar RS256/JWT por esta causa.

Si los permisos devueltos incluyen scopes previos más amplios, el script los
rechaza: revisar/revocar ese consentimiento en la cuenta Google y autorizar de
nuevo solo gmail.send. No ampliar scopes para resolver un error.

## Envío real de prueba — solo tras autorización del usuario

El comando está preparado; **no se ejecutó**:

```sh
npm run gmail:send-test -- --to CORREO_AUTORIZADO --allow-send
```

Reemplazar el marcador únicamente después de autorizar ese destinatario y envío.
Sin `--allow-send` no se llama al proveedor. El mensaje es una prueba identificada
y no genera ni contiene OTP del registro. No registrar destinatarios ni habilitar
trazas HTTP del SDK que pudieran revelar credenciales o contenido.

Las llamadas OAuth/Gmail tienen timeout de cinco segundos, sin redirects ni
reintentos de transporte. Un envío con resultado incierto no se repite
automáticamente para evitar entregas duplicadas. La renovación normal del access
token la hace `google-auth-library`, que comparte un refresh en vuelo por cliente.

## Desplegar únicamente app

Después de instalar el cliente/token y verificar sus permisos, el operador puede
ejecutar, cuando autorice el despliegue:

```sh
docker compose up -d --no-deps --build --force-recreate app
docker compose ps app
```

No usar `up` general, `down`, `-v` ni recrear `db`/`redis`. No se agregó ninguna
publicación de puerto OAuth al contenedor: autorizar desde Windows/Linux host,
montar los archivos resultantes y mantener intactos los puertos actuales de API.
Los secrets Gmail deben existir antes de recrear app. No se ejecutó el despliegue.

## Dependencias y pruebas

`googleapis@171.4.0` es compatible con Node 20 (la versión más reciente consultada
exige Node 22). Se fija gaxios 7.3.1, de la misma versión mayor, para evitar el
aviso transitivo de gaxios 7.1.3/rimraf sin actualizar Node ni usar audit fix force.
Esto no elimina los avisos previos del proyecto ni certifica proveedores reales.

Las pruebas usan Google simulado y un callback HTTP local de puerto efímero:
formato MIME/OTP, access refresh automático, invalid_grant, timeout, state, PKCE,
scopes, concurrencia, puerto ocupado, escritura atómica y barrera del envío real.
No abren navegadores reales ni contactan Google. La prueba real de Gmail queda
pendiente del consentimiento y autorización del usuario.

Resultados comprobados: **42 pruebas específicas aprobadas** en cinco suites.
Regresión con cobertura: **489 aprobadas, 45 omitidas**, 44 suites aprobadas de
51 totales, tanto Windows/Node 24 como Node 20/Linux. Las omitidas de MySQL/Redis
no se ejecutaron para este cambio y no se declaran aprobadas. Cobertura del adaptador
Gmail: **96,66 % líneas / 83,82 % ramas**; fachada de registro 100/100. La cobertura
global es 79,40 % líneas / 73,46 % ramas; no se modificaron umbrales/exclusiones ni
se certifica un Quality Gate remoto. El flujo inicial de prueba OAuth se ajustó
para esperar la respuesta HTTP del callback, sin debilitar la validación.

Node 20 aprobó además instalación limpia, auditoría, Swagger y build documental.
Auditoría final: cero altos/críticos, 19 moderados y cuatro bajos preexistentes;
no quedan los tres avisos nuevos que inicialmente introducía el gaxios transitivo.
Compose valida sin arrancar servicios. El chequeo local fue exclusivamente offline
y sigue pendiente de configurar el cliente/token reales y el remitente. No se
abrió el navegador real, no hubo consentimiento Google ni correos enviados.

Fuentes: [OAuth web-server](https://developers.google.com/identity/protocols/oauth2/web-server),
[envío MIME/base64url](https://developers.google.com/workspace/gmail/api/guides/sending),
[caducidad de refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration).
