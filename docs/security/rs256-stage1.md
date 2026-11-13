# Etapa 1: infraestructura criptográfica RS256

El módulo `services/rs256-access-token.service.js` es independiente. Importarlo
no lee archivos, carga variables, genera llaves ni establece conexiones. No se
utiliza todavía en login, middleware, renovación o checkout. `JWT_SECRET` y el
servicio HS256 existente siguen siendo necesarios y conservan su comportamiento.
Esta etapa no activa Redis ni cambia contratos HTTP o las 14 tablas MySQL.

## Configuración del servidor

Las variables públicas están documentadas también en `.env.example`:

| Variable | Uso |
| --- | --- |
| `JWT_RS256_ISSUER` | Identificador exacto del emisor de los nuevos access tokens. Obligatorio, sin espacios, hasta 256 caracteres. |
| `JWT_RS256_AUDIENCE` | Audiencia exacta, como string único. Obligatoria, sin espacios, hasta 256 caracteres. |
| `JWT_RS256_ACTIVE_KID` | Identificador de la llave de firma activa. Entre 1 y 64 caracteres; empieza por letra/dígito y admite letras, dígitos, `_` y `-`. |
| `JWT_RS256_PRIVATE_KEY_PATH` | Ruta absoluta al PEM privado RSA de exactamente 3072 bits. |
| `JWT_RS256_PUBLIC_KEYS_PATH` | Ruta absoluta a un manifiesto JSON confiable de llaves públicas. |

No se admiten llaves PEM dentro de esas variables. El manifiesto contiene de una
a dieciséis entradas, cada una `kid -> ruta absoluta a un PEM público SPKI`.
Ejemplo sin secretos, para un futuro montaje de solo lectura:

```json
{
  "access-v2-current": "/run/secrets/access-v2-current.public.pem",
  "access-v2-previous": "/run/secrets/access-v2-previous.public.pem"
}
```

En Windows, utilizar rutas absolutas locales con permisos NTFS restringidos;
en JSON, escapar las barras invertidas o usar barras `/`. El manifiesto y sus
rutas proceden exclusivamente de configuración del operador. Nunca se construyen
a partir de un token o una petición. No incluir material privado en un PEM público.

La llave privada debe estar fuera del repositorio y del contexto Docker, con
acceso limitado al usuario del proceso. En Linux, utilizar permisos como 0400
o 0600 según el montaje; en Windows, restringir sus ACL. Las comprobaciones de
permisos del sistema operativo son responsabilidad del aprovisionamiento; el
módulo valida tipo, tamaño y correspondencia del par. No generar ni rotar llaves
reales automáticamente al faltar configuración. No registrar PEMs, tokens ni
errores subyacentes del cargador.

Se recomienda PKCS#8 para la llave privada. La clave activa debe corresponder
a su entrada pública. Todas las llaves del mapa deben ser RSA de 3072 bits.
Los archivos deben ser regulares y están limitados a 16 KiB por PEM y 64 KiB
por manifiesto. Los archivos privados `.pem` y `.key` ya están excluidos de
Git y Docker; eso no sustituye almacenarlos fuera del contexto de construcción.

## API interna aislada

La carga se realiza solo si código confiable del servidor llama explícitamente:

```js
const { loadAccessTokenService } = require('./services/rs256-access-token.service');
const accessTokens = loadAccessTokenService();
// sub y sid: UUID válidos definidos por lógica confiable del servidor.
const token = accessTokens.sign({ sub: userId, sid: sessionId });
const claims = accessTokens.verify(token);
```

Este ejemplo **no está conectado a ningún endpoint**. No pasar `req.body`,
encabezados o parámetros del cliente como configuración del cargador.

Para pruebas existe `createAccessTokenService({ issuer, audience, activeKid,
privateKey, publicKeys, now })`, con `KeyObject` privado, `Map` de `KeyObject`
públicos y reloj interno opcional en milisegundos Unix. El mapa se copia al
crear el servicio y no admite cambios externos posteriores. El reloj se inyecta
solo por código confiable; en producción se utiliza `Date.now`.

## Contrato criptográfico

- Encabezado exacto: `alg: RS256`, `typ: at+jwt`, `kid` conocido.
- Payload exacto: `sub`, `sid`, `jti`, `iat`, `exp`, `iss`, `aud`.
- `sub`, `sid` y `jti`: UUID con versión 1–8 y variante RFC; no Nil/Max UUID.
- El llamador de `sign` solo proporciona `sub` y `sid`.
- `jti` se genera con `crypto.randomUUID`; `iat` y `exp` se generan en el servidor.
- Emisión de cinco minutos exactos; verificación admite duración positiva de
  hasta 300 segundos, sin tolerancia de reloj, sin `iat` futuro y sin expiración
  alcanzada. Timestamps enteros seguros y no negativos.
- Emisor y audiencia deben coincidir exactamente; no se admiten arrays.
- El verificador rechaza claims adicionales. Nuevos claims de sesión o perfil
  requerirán una evolución explícita de este contrato, no una aceptación implícita.
- Los JWT deben tener tres segmentos base64url canónicos, sin padding/espacios,
  y no superar 8192 caracteres ASCII.
- HS256, `none`, otras firmas, tipos de token, `kid` desconocidos y encabezados
  adicionales (`jku`, `x5u`, `jwk`, `x5c`, `crit`, etc.) se rechazan.
- Ningún encabezado provoca lecturas de archivos ni conexiones externas. El
  mapa público se precarga al crear el servicio y solo se consulta por `kid`.

`verify` devuelve una copia congelada de los claims. Los rechazos utilizan
`AccessTokenError` con código `INVALID_ACCESS_TOKEN`. Configuración inválida
utiliza `Rs256ConfigurationError` con código `RS256_CONFIGURATION_INVALID`.
Los mensajes no incluyen token, llave, ruta ni la causa original.

El módulo solo acredita firma y claims: **no comprueba sesión Redis, existencia
del usuario, estado, perfil o revocación**. No debe utilizarse como autorización
completa. Esa integración pertenece a una etapa posterior.

## Rotación futura

Cargar una nueva instancia con su llave activa y el mapa de verificadores
autorizados. Los tokens nuevos usan el nuevo `kid`; el mapa puede conservar la
llave pública anterior durante la ventana aprobada de verificación. No existe
recarga automática, descarga JWKS, fallback a HS256 ni generación de llaves por
petición. La política operativa de rotación se implementará por separado.

## Utilidades compartidas y compatibilidad

`validators/uuid.js` contiene el `isUuid` histórico sin modificar sus reglas y
`isAccessUuid` para el contrato nuevo. Auditoría, cuentas y usuarios importan
ahora la utilidad directamente. El servicio HS256 reexporta `isUuid` para no
romper consumidores existentes. Ningún consumidor histórico carga el servicio
RS256 a través de esa utilidad.

## Pruebas

```sh
node node_modules/jest/bin/jest.js --runInBand --coverage=false --runTestsByPath tests/unit/rs256-access-token.service.test.js tests/unit/uuid.test.js
```

Las pruebas generan pares RSA efímeros en memoria; también crean llaves de
tamaño/tipo incorrecto para comprobar su rechazo. La carga de archivos se prueba
con filesystem simulado, sin escribir llaves privadas ni necesitar secretos
locales. Los casos adversarios incluyen claims malformados firmados mediante
una primitiva independiente, sustitución de llave/firma, confusión RSA/HMAC,
extensiones de encabezado, expiración y ausencia de accesos a archivos/red.

Los tests actuales de login, JWT HS256, renovación y checkout siguen siendo
la regresión del sistema vigente; no deben cambiar sus expectativas a RS256
durante esta etapa.

## Resultados comprobados — 12 de noviembre de 2026

- Windows, Node.js 24.13.1: **75 pruebas nuevas aprobadas** en dos suites.
- Cobertura de los dos archivos nuevos de implementación: **100 % líneas,
  97,53 % ramas**, 98,88 % sentencias y 100 % funciones. Se guardó por separado
  en `log/stage5/rs256-stage1/coverage`, ignorado por Git, sin sobrescribir la
  cobertura global anterior.
- Regresión completa: **310 aprobadas, 39 MySQL omitidas**, 35 suites aprobadas
  y cinco omitidas, código de salida 0. Se desactivaron las suites MySQL y se
  fijó la configuración de pruebas al puerto 9; no se probaron escrituras reales.
  Incluye los tests existentes de login, renovación HS256 y checkout.
- Se conserva el aviso previo de Jest sobre nombres de paquetes duplicados
  dentro de workspaces generados de Postman; no produjo fallo ni se cambió su
  descubrimiento para ocultarlo.
- Node 20/Linux: **NO VERIFICADO en esta etapa**. El intento con la imagen local
  de verificación y montajes de solo lectura no llegó a crear el contenedor:
  el daemon `dockerDesktopLinuxEngine` no estaba disponible. No se inició Docker
  ni se modificó ningún contenedor habitual para resolverlo.
- No se conectó RS256 a rutas o middlewares. Login, renovación, `JWT_SECRET`
  y checkout conservan su configuración y contrato actuales. No se activó Redis,
  no se generaron llaves reales y no se hicieron commits, push ni PR.
