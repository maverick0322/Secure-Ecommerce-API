# Verificación de seguridad de imágenes — fase 2

Informe histórico anterior a las correcciones de G09/H01. Sus cifras y fallos describen aquella ejecución. Las pruebas de esos dos casos se actualizaron en fase 3A: véase [el informe posterior](images-phase3a-report.md).

H1/H2 se corrigieron posteriormente en [fase 3B](images-phase3b-report.md). Las expectativas de caracterización correspondientes se actualizaron; las cifras históricas de este informe no certifican el estado actual.

H3, multipart incompleto y respuestas anómalas se revisaron y corrigieron localmente en [fase 3C](images-phase3c-report.md), con validación nativa real y proveedor simulado. H4 continúa fuera de esa etapa.

Fecha: 2026-11-17. Alcance: producción sin cambios; solo pruebas nuevas bajo tests/. No se consulta ni modifica el producto 4, la base habitual o Cloudinary real.

## Cómo interpretar los estados

- PASS: cumple la expectativa del escenario en el entorno descrito.
- FAIL: reproduce un defecto o incumple el criterio de seguridad indicado. Puede respetar el contrato HTTP actual; en ese caso la columna esperado distingue contrato y criterio de diseño.
- BLOCKED: no ejecutado; no se cuenta como aprobado.
- Las pruebas de caracterización afirman el comportamiento observado, incluidos defectos. Por eso Jest aprueba mientras algunas filas tienen FAIL de seguridad. No son pruebas que certifiquen que esos defectos están corregidos.

Matriz A–I: 109 escenarios; 78 PASS, 31 FAIL. Jest: 109 aprobadas, 0 fallidas.

## Aislamiento y límites

Los tests HTTP usan rutas, controladores, JWT RS256, RBAC, validación, servicio de imágenes y auditoría reales, con modelos/proveedor sustituidos antes de importar módulos. Nunca se arranca la API habitual. IDs sintéticos: 701. Claves RSA/JWT se generan en memoria y no se escriben. Los procesos hijos heredan solo rutas básicas del sistema y el directorio temporal, sin credenciales de la aplicación.

El doble SQL separa filas y auditorías provisionales de confirmadas y serializa transacciones; no reproduce todas las semánticas de InnoDB. Las pruebas G usan procesos Node distintos, archivos reales temporales e IPC para SQL/proveedor. Las pausas simulan espera previa a adquirir una transacción o confirmaciones inciertas. El reloj se adelanta; no se espera realmente un año ni 120 segundos.

La carga H2 se limita a 6 peticiones y concurrencia 3, con una expectativa de duración <10 s y timeout Jest de 12 s. No se genera tráfico externo. Las imágenes grandes/animadas nunca se decodifican: se construyen buffers acotados, <2 MiB; los fixtures normales 2x2 se decodificaron por separado con Pillow existente.

## Evidencia reproducible

Comando dirigido:

```powershell
node node_modules/jest/bin/jest.js --runInBand --detectOpenHandles --json --outputFile=log/images-phase2-results.json --runTestsByPath tests/security/images-phase2.http.test.js tests/security/images-phase2.service.test.js tests/security/images-phase2.process.test.js tests/security/images-phase2.sdk.test.js
```

JSON de ejecución: [images-phase2-results.json](../../log/images-phase2-results.json). Salida: [images-phase2-targeted.log](../../log/images-phase2-targeted.log). Cada fila remite además al archivo y nombre de escenario ejecutado. Los logs se ignoran en Git y no contienen credenciales de esta prueba.

## Grupo A: Autenticación y autorización

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| A01 | JWT ausente; archivo PNG; PUT y DELETE. | HTTP 401; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 401 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A01; Jest passed | Ninguno observado. |
| A02 | JWT inválido; archivo PNG; PUT y DELETE. | HTTP 401; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 401 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A02; Jest passed | Ninguno observado. |
| A03 | JWT expirado exactamente a 300 s; archivo PNG; PUT y DELETE. | HTTP 401; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 401 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A03; Jest passed | Ninguno observado. |
| A04 | Sesión revocada en doble de sesiones; archivo PNG; PUT y DELETE. | HTTP 401; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 401 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A04; Jest passed | Ninguno observado. |
| A05 | Perfil BUYER; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A05; Jest passed | Ninguno observado. |
| A06 | Perfil ADMIN; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A06; Jest passed | Ninguno observado. |
| A07 | SELLER PENDING; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A07; Jest passed | Ninguno observado. |
| A08 | SELLER REJECTED; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A08; Jest passed | Ninguno observado. |
| A09 | SELLER SUSPENDED; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A09; Jest passed | Ninguno observado. |
| A10 | Usuario SUSPENDED; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A10; Jest passed | Ninguno observado. |
| A11 | Usuario sin verificar; archivo PNG; PUT y DELETE. | HTTP 403; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 403 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A11; Jest passed | Ninguno observado. |
| A12 | SELLER aprobado propietario de otro producto; archivo PNG; PUT y DELETE. | HTTP 404; ninguna llamada a Multer o Cloudinary; referencia intacta. | HTTP 404 en ambos métodos; parser/upload/inspect/destroy: 0 llamadas. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / A12; Jest passed | Ninguno observado. |

## Grupo B: Validación de archivos

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| B01 | JPEG 2x2 generado y decodificado con Pillow. | 200; una subida mock. | 200; una subida mock. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B01; Jest passed | Ninguno observado. |
| B02 | PNG 2x2 generado y decodificado con Pillow. | 200; una subida mock. | 200; una subida mock. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B02; Jest passed | Ninguno observado. |
| B03 | WebP 2x2 generado y decodificado con Pillow. | 200; una subida mock. | 200; una subida mock. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B03; Jest passed | Ninguno observado. |
| B04 | PNG con relleno hasta 2097152 bytes. | 200; frontera exacta aceptada localmente. | 200; frontera exacta aceptada localmente. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B04; Jest passed | Ninguno observado. |
| B05 | 2097153 bytes. | 413; proveedor no invocado. | 413; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B05; Jest passed | Ninguno observado. |
| B06 | Archivo vacío. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B06; Jest passed | Ninguno observado. |
| B07 | PNG con extensión JPG y MIME PNG. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B07; Jest passed | Ninguno observado. |
| B08 | PNG con extensión y MIME JPEG. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B08; Jest passed | Ninguno observado. |
| B09 | Extensión/MIME SVG. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B09; Jest passed | Ninguno observado. |
| B10 | Texto con extensión/MIME PNG. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B10; Jest passed | Ninguno observado. |
| B11 | Solo 8 bytes de firma PNG. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo; bytes llegan a upload mock. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B11; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B12 | Solo 4 bytes de firma JPEG. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo; bytes llegan a upload mock. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B12; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B13 | Solo 12 bytes RIFF/WEBP. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo; bytes llegan a upload mock. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B13; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B14 | PNG con CRC de IHDR corrupto. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B14; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B15 | PNG con script añadido tras IEND; no se ejecuta. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B15; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B16 | Cabecera declara 100000x100000; datos mínimos inconsistentes. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B16; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B17 | APNG declara un millón de frames, sin esos frames. | Contrato actual: firma/MIME/extensión; integridad completa depende del proveedor. Criterio H3: detectar corrupción local. | 200 con proveedor permisivo. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B17; Jest passed | H3: validación local insuficiente demostrada; aceptación por Cloudinary real NO probada. |
| B18 | Multipart sin cierre y fichero incompleto. | Rechazo de petición incompleta; criterio HTTP de cliente: 400. | 500 genérico; proveedor no invocado. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / B18; Jest passed | Error de cliente clasificado como 500; sin escritura ni fuga. |
| B19 | Campo adicional sellerId. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B19; Jest passed | Ninguno observado. |
| B20 | Dos archivos image. | 400; proveedor no invocado. | 400; proveedor no invocado. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B20; Jest passed | Ninguno observado. |
| B21 | PNG estructural de 10000x10000, 1 bit/píxel, datos comprimidos <2 MiB; generación acotada a 12,51 MB. | Contrato actual: <=2 MiB y firma permitida; no hay política de píxeles/frames/poliglotas. | 200 con proveedor mock; sin límite local de dimensiones. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B21; Jest passed | Riesgo potencial: procesamiento/normalización depende del proveedor. No se mide DoS ni se demuestra XSS. |
| B22 | APNG estructural con 2048 frames 1x1 y <2 MiB. | Contrato actual: <=2 MiB y firma permitida; no hay política de píxeles/frames/poliglotas. | 200 con proveedor mock; sin límite local de frames. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B22; Jest passed | Riesgo potencial: procesamiento/normalización depende del proveedor. No se mide DoS ni se demuestra XSS. |
| B23 | Poliglota PNG/ZIP con CRC y offsets ZIP correctos, contenido sintético. | Contrato actual: <=2 MiB y firma permitida; no hay política de píxeles/frames/poliglotas. | 200 con proveedor mock; no se normaliza localmente. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / B23; Jest passed | Riesgo potencial: procesamiento/normalización depende del proveedor. No se mide DoS ni se demuestra XSS. |

## Grupo C: Proveedor y clasificación de errores

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| C01-400 | Upload mock rechaza con HTTP 400; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-400; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C01-401 | Upload mock rechaza con HTTP 401; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-401; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C01-403 | Upload mock rechaza con HTTP 403; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-403; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C01-429 | Upload mock rechaza con HTTP 429; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-429; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C01-500 | Upload mock rechaza con HTTP 500; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-500; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C01-503 | Upload mock rechaza con HTTP 503; recurso remoto ausente. Tiempo adelantado un año. | 502 genérico según contrato; criterio H1: distinguir rechazo definitivo y acotar recuperación. | 502; tras tres recover siguen 1 registro y 3 consultas sin eliminación. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C01-503; Jest passed | H1: trabajo persistente sin cierre ni espera progresiva. HTTP 500/503 pueden ser ambiguos: conservar evidencia es correcto, la falta de presupuesto/alertas sigue pendiente. |
| C02-ECONNRESET | Fallo sintético ECONNRESET antes de almacenar. | 502 y preservar intención ante incertidumbre. | 502; referencia nula, sin recurso; registro conservado después de recover. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C02-ECONNRESET; Jest passed | H1: seguridad conservadora correcta; cierre operativo todavía no resuelto. |
| C02-ENOTFOUND | Fallo sintético ENOTFOUND antes de almacenar. | 502 y preservar intención ante incertidumbre. | 502; referencia nula, sin recurso; registro conservado después de recover. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C02-ENOTFOUND; Jest passed | H1: seguridad conservadora correcta; cierre operativo todavía no resuelto. |
| C02-ETIMEDOUT | Fallo sintético ETIMEDOUT antes de almacenar. | 502 y preservar intención ante incertidumbre. | 502; referencia nula, sin recurso; registro conservado después de recover. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C02-ETIMEDOUT; Jest passed | H1: seguridad conservadora correcta; cierre operativo todavía no resuelto. |
| C03 | Timeout tras crear recurso mock. | 502; limpieza segura después de gracia. | Recurso eliminado al adelantar 180 s; referencia nula; diario vacío. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C03; Jest passed | Ninguno observado. |
| C04 | 3 subidas rechazadas 400 y 3 ciclos, un día simulado entre ciclos. | 502 inicial; criterio H1: no crear trabajo de recuperación indefinido. | 3 registros persistentes, 9 inspect, ningún recurso. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C04; Jest passed | H1: acumulación reproducida con carga limitada. |
| C05 | Upload mock devuelve null. | Respuesta inválida debería convertirse en error controlado de proveedor 502. | TypeError observado en servicio; queda registro. El 500 de frontera HTTP se deduce de respondError, no de una petición HTTP específica con null. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C05; Jest passed | Defecto de robustez; no fuga demostrada. |
| C06 | Upload mock devuelve undefined. | Respuesta inválida debería convertirse en error controlado de proveedor 502. | TypeError observado en servicio; queda registro. El 500 HTTP es una inferencia del manejador, no una petición específica con undefined. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C06; Jest passed | Defecto de robustez. |
| C07 | Recurso creado; respuesta vacía {}. | 502 y compensar únicamente identificador solicitado. | 502, sin referencia ni recurso; diario vacío. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C07; Jest passed | Ninguno observado. |
| C08 | Recurso creado; respuesta con otro public_id. | 502; nunca eliminar public_id ajeno recibido. | 502; se compensa identificador generado, no inconsistent. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C08; Jest passed | Ninguno observado. |
| C09 | Recurso creado; respuesta con formato GIF. | 502; impedir persistencia. | 502; recurso compensado, referencia nula. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C09; Jest passed | Ninguno observado. |
| C10 | Fallo SQL y primer inspect sin conectividad. | Conservar intención y reintentar recuperación. | Registro pendiente, luego recurso limpiado y diario vacío. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / C10; Jest passed | Ninguno observado. |
| C11-400 | SDK oficial simulado devuelve objeto de error HTTP 400. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-400; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C11-401 | SDK oficial simulado devuelve objeto de error HTTP 401. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-401; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C11-403 | SDK oficial simulado devuelve objeto de error HTTP 403. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-403; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C11-429 | SDK oficial simulado devuelve objeto de error HTTP 429. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-429; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C11-500 | SDK oficial simulado devuelve objeto de error HTTP 500. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-500; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C11-503 | SDK oficial simulado devuelve objeto de error HTTP 503. | Contrato adaptador: Error sin detalles sensibles. Criterio operativo: preservar código seguro. | Error genérico; se pierde http_code; ninguna solicitud HTTPS real. | FAIL | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C11-503; Jest passed | H1: pérdida de clasificación del error; saneamiento del texto sí funciona. |
| C12 | SDK api.resource devuelve error anidado 404. | Interpretar recurso ausente. | inspect devuelve null. | PASS | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C12; Jest passed | Ninguno observado. |
| C13 | SDK destroy responde resultado inesperado. | No confirmar eliminación. | Error controlado Image deletion was not confirmed. | PASS | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C13; Jest passed | Ninguno observado. |
| C14 | Falta secreto en entorno SINTÉTICO. | 503 antes del SDK. | credentials rechaza; upload_stream no se invoca. | PASS | [images-phase2.sdk.test.js](./images-phase2.sdk.test.js) / C14; Jest passed | Ninguno observado. |
| C15 | Respuesta mock id/formato correctos, resource_type video y type private. | Criterio de respuesta coherente con image/upload. | La referencia se acepta y confirma. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / C15; Jest passed | Validación incompleta de respuesta; no se demostró que un cliente pueda falsificar al proveedor. |

## Grupo D: Persistencia y commits

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| D01 | Lookup inicial falla por conexión. | No subir ni crear diario. | Excepción; upload=0, diario vacío. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D01; Jest passed | Ninguno observado. |
| D02 | Transacción no llega a comenzar tras upload. | Mantener anterior y compensar nueva. | Referencia anterior conservada, una imagen anterior, sin auditoría falsa. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D02; Jest passed | Ninguno observado. |
| D03 | Fallo antes de update. | Rollback y compensación. | Referencia anterior conservada; nueva eliminada; sin auditoría exitosa. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D03; Jest passed | Ninguno observado. |
| D04 | Fallo después de update provisional, antes de commit. | Rollback de fila provisional y auditoría. | Referencia anterior conservada; nueva eliminada. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D04; Jest passed | Ninguno observado. |
| D05 | Fallo de commit antes de aplicar estado. | No persistir fila ni auditoría; compensar nueva. | Fila/auditoría revertidas; nueva eliminada. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D05; Jest passed | Ninguno observado. |
| D06 | Commit aplicado en doble transaccional, se pierde confirmación. | Preservar imagen referenciada pese al error. | Cliente recibe error; referencia/recurso/auditoría confirmados; destroy no llamado. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D06; Jest passed | Ninguno observado. |
| D07 | Commit correcto y count de reconciliación falla. | Preservar diario y recurso hasta verificar SQL. | Diario conservado; recover posterior verifica referencia y no borra imagen. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D07; Jest passed | Ninguno observado. |
| D08 | Audit insert falla dentro de transacción. | Rollback de fila y auditoría; compensar upload. | Referencia nula, cero auditorías, cero recursos. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / D08; Jest passed | Ninguno observado. |

## Grupo E: Sustitución y retirada

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| E01 | Imagen anterior gestionada. | Reemplazar y retirar solo anterior sin referencias. | Nueva referencia/recurso; anterior retirado; evento producto.imagen. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E01; Jest passed | Ninguno observado. |
| E02 | Imagen anterior; nueva subida falla. | Conservar anterior. | Referencia/recurso anterior intactos; destroy=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E02; Jest passed | Ninguno observado. |
| E03 | Nueva confirmada; eliminación anterior falla una vez. | Mantener nueva y reintentar anterior. | 200 lógico; diario pendiente; recover retira anterior, conserva nueva. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E03; Jest passed | Ninguno observado. |
| E04 | Una imagen gestionada. | Retirar referencia y limpiar con auditoría atómica. | Referencia nula, recurso retirado, producto.imagen.retirar registrado. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E04; Jest passed | Ninguno observado. |
| E05 | Audit insert de retirada falla. | Rollback y no borrar recurso. | Referencia/recurso anterior intactos; destroy=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E05; Jest passed | Ninguno observado. |
| E06 | Identificador histórico fuera del namespace. | Preservar recurso. | Registro .preserved.json; destroy=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E06; Jest passed | Ninguno observado. |
| E07 | Contexto catalog_owner de otra aplicación. | Preservar recurso. | Archivo preservado; recurso intacto. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E07; Jest passed | Ninguno observado. |
| E08 | Contexto product_id de otro producto. | Preservar recurso. | Archivo preservado; recurso intacto. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E08; Jest passed | Ninguno observado. |
| E09 | Recurso sin contexto. | Preservar recurso. | Archivo preservado; recurso intacto. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E09; Jest passed | Ninguno observado. |
| E10 | Otro registro de la misma base referencia la imagen. | Nunca borrar recurso referenciado. | Retirada local, referencia secundaria protegida; destroy=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E10; Jest passed | Ninguno observado. |
| E11 | Producto borrado lógicamente tras commit; diario pendiente. | Contar referencias con paranoid:false. | Recurso conservado; diario cerrado sin destroy. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E11; Jest passed | Ninguno observado. |
| E12 | Producto ya borrado lógicamente. | 404 antes de upload. | 404, upload=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E12; Jest passed | Ninguno observado. |
| E13 | Producto sin imagen; dos retiradas. | Operación remota idempotente. | Referencia nula; destroy=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / E13; Jest passed | Ninguno observado. |

## Grupo F: Concurrencia y carga acotada

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| F01 | 2 reemplazos simultáneos; doble SQL serializado. | Recurso final coincide con último commit. | Solo recurso referenciado sobrevive. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / F01; Jest passed | Ninguno observado. |
| F02a | Upload remoto pausado; retirada confirma primero. | Final consistente tras ambas operaciones. | Nueva referencia existe en remoto; solo un recurso. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / F02a; Jest passed | Ninguno observado. |
| F02b | Upload confirma; limpieza anterior pausada; retirada concurre. | Final consistente respetando serialización. | Referencia nula y ningún recurso al terminar ambas. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / F02b; Jest passed | Ninguno observado. |
| F03 | Vendedor suspendido durante upload. | 403, rollback y compensación. | 403; referencia nula; nuevo recurso retirado; sin auditoría de éxito. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / F03; Jest passed | Ninguno observado. |
| F04 | Producto borrado lógicamente durante upload. | 404 y compensación. | 404; sin referencia nueva ni recurso huérfano. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / F04; Jest passed | Ninguno observado. |
| F05 | 6 peticiones HTTP, 2 tandas, concurrencia máxima 3, PNG pequeño, límite de prueba 10 s. | Contrato actual no define 429; criterio H2: controlar concurrencia/cuota. | 6 respuestas 200, pico de uploads=3, 6 llamadas mock, recurso final único. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / F05; Jest passed | H2: ausencia de control específico corroborada; NO demuestra agotamiento ni mide un umbral de DoS. |

## Grupo G: Recuperación y procesos

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| G01 | Proceso hijo termina durante upload remoto ya almacenado; diario en temp. | Nuevo proceso recupera intención no referenciada. | Tras 180 s simulados se limpia recurso; diario vacío. | PASS | [images-phase2.process.test.js](./images-phase2.process.test.js) / G01; Jest passed | Ninguno observado. |
| G02 | Proceso termina después de commit aplicado, antes de confirmación. | Nueva instancia debe preservar referencia confirmada. | Recurso retenido; ninguna eliminación; diario cerrado. | PASS | [images-phase2.process.test.js](./images-phase2.process.test.js) / G02; Jest passed | Ninguno observado. |
| G03 | Diario JSON parcialmente escrito, con nombre hash válido. | No confiar ni contactar proveedor. | 2 recover: 2 eventos invalid; archivo permanece; proveedor=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G03; Jest passed | Ninguno observado. |
| G04 | mkdir devuelve EACCES simulado. | No subir sin diario durable. | EACCES; upload=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G04; Jest passed | Ninguno observado. |
| G05 | writeFile devuelve ENOSPC simulado. | No subir; cerrar descriptor. | ENOSPC; close=1; upload=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G05; Jest passed | Ninguno observado. |
| G06 | fsync de intención falla. | No subir sin persistencia confirmada. | Error; descriptor cerrado; upload=0. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G06; Jest passed | Ninguno observado. |
| G07 | Nombre hash no coincide con publicId del JSON. | No aceptar registro manipulable. | No inspect ni destroy. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G07; Jest passed | Ninguno observado. |
| G08 | Dos procesos, mismo diario; primer upload espera antes de transacción, gracia vigente. | No limpiar upload activo. | Recurso conservado y después referenciado. | PASS | [images-phase2.process.test.js](./images-phase2.process.test.js) / G08; Jest passed | Ninguno observado. |
| G09 | Dos procesos, mismo diario; primero espera antes de transacción; segundo reloj +180 s. | Nunca borrar recurso que aún puede ser confirmado por operación activa. | Segundo proceso destruye recurso; primero confirma luego un imagePublicId inexistente. | FAIL | [images-phase2.process.test.js](./images-phase2.process.test.js) / G09; Jest passed | Alta condicional: carrera reproducida con procesos reales y SQL/proveedor por IPC, no con MySQL/Cloudinary reales. |
| G10 | Proceso termina durante update no confirmado; estado SQL todavía provisional. | No dejar referencia; limpiar huérfano. | Nueva instancia limpia huérfano; referencia nula. | PASS | [images-phase2.process.test.js](./images-phase2.process.test.js) / G10; Jest passed | Ninguno observado. |
| G12 | ENOSPC al reservar limpieza de anterior después de subir nueva. | Rollback; anterior intacta; compensar nueva. | Anterior conservada y nueva retirada; diario vacío. | PASS | [images-phase2.service.test.js](./images-phase2.service.test.js) / G12; Jest passed | Ninguno observado. |

## Grupo H: Separación de entornos

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| H01 | Dos bases independientes simuladas, referencia copiada, misma cuenta/namespace/contexto Cloudinary. | No eliminar recurso todavía usado por otro entorno. | La retirada del entorno actual borra el recurso que la otra base sigue referenciando. | FAIL | [images-phase2.service.test.js](./images-phase2.service.test.js) / H01; Jest passed | Alta condicional: separación de entornos insuficiente reproducida; no prueba que el despliegue actual comparta ese recurso. |

## Grupo I: Auditoría y observabilidad

| ID | Condiciones iniciales | Esperado / criterio | Obtenido | Estado | Evidencia | Riesgo |
|---|---|---|---|---|---|---|
| I01 | Upload y retirada correctos. | Actor/target/outcome y requestId correlacionados. | Auditorías de éxito correlacionadas; retirada=204. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / I01; Jest passed | Ninguno observado. |
| I02 | Intento de propietario ajeno. | 404 público; criterio H4: trazabilidad interna del intento. | 404 y solo registro técnico de ruta normalizada. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / I02; Jest passed | H4: falta evento con producto intentado. |
| I03 | Archivo no permitido. | 400; criterio H4: traza selectiva del rechazo. | 400 y solo registro técnico. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / I03; Jest passed | H4: falta evento de imagen rechazada. |
| I04 | Proveedor rechaza. | 502 genérico; criterio H4: traza del fallo. | 502 sin evento de negocio fallido. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / I04; Jest passed | H4: falta contexto de operación en auditoría. |
| I05 | Update SQL falla. | 500 genérico, rollback; criterio H4: traza de fallo. | 500 y rollback; solo registro técnico. | FAIL | [images-phase2.http.test.js](./images-phase2.http.test.js) / I05; Jest passed | H4: falta evento de persistencia fallida. |
| I06 | Audit insert de éxito falla. | Fallar cerrado y compensar. | 500, referencia/auditoría revertidas; imagen compensada; audit.write.failed seguro. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / I06; Jest passed | Ninguno observado. |
| I07 | Auditoría de denegación falla. | Mantener rechazo y no procesar fichero. | 403; parser/proveedor=0; evento técnico de fallo seguro. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / I07; Jest passed | Ninguno observado. |
| I08 | JWT efímero, fallo de proveedor con diagnóstico sintético. | No serializar JWT, cuerpo o diagnóstico. | 502; ausencia comprobada en respuesta, logs y auditoría; intención conservada. | PASS | [images-phase2.http.test.js](./images-phase2.http.test.js) / I08; Jest passed | Ninguno observado. |

## Grupo J: regresión y CI/CD

| ID | Condiciones iniciales | Esperado | Obtenido | Estado | Evidencia / límites |
|---|---|---|---|---|---|
| J01 | Suite general Windows, Node 24; integraciones optativas sin activar | Regresión sin fallos | 917 aprobadas, 50 omitidas; 72 suites aprobadas, 7 omitidas; exit 0 | PASS | [images-phase2-regression.log](../../log/images-phase2-regression.log); npm test |
| J02 | Misma suite con cobertura, ejecución serial | Pruebas aprobadas e informes escritos | 917 aprobadas / 50 omitidas; 87,38 % líneas y 85,11 % ramas globales; exit 0 | PASS | [images-phase2-coverage.log](../../log/images-phase2-coverage.log); npm run test:coverage -- --runInBand |
| J03 | Imagen Docker Node 20/Linux, fuente sin .env/secretos, instalación desde lockfile | Compatibilidad de pruebas y herramientas | 912 aprobadas / 55 omitidas; 86,42 % líneas y 83,34 % ramas; Swagger y docs:build aprobados; exit 0 | PASS | [images-phase2-node20.log](../../log/images-phase2-node20.log); verify-node20.js. Cinco casos exclusivos PowerShell omitidos respecto a Windows. No se publican imágenes. |
| J04 | MySQL 8 tmpfs exclusivo en 127.0.0.1:13308, identidad comprobada, Redis efímero, proveedor mock | Transacciones y HTTP reales sin servicios habituales | 37 pruebas aprobadas en 3 suites, más comprobaciones procedurales del runner; contenedores descartables retirados; exit 0 | PASS | [images-phase2-mysql.log](../../log/images-phase2-mysql.log); stage5-addresses-test.js. No se ejecutan migraciones/seeders habituales. No todas las inyecciones nuevas se repiten en MySQL real. |
| J05 | npm audit --audit-level=high dentro de validación Node 20, dependencias bloqueadas | Ninguna alta/crítica | 21 moderadas; cero altas/críticas; exit 0 | PASS | [images-phase2-node20.log](../../log/images-phase2-node20.log), etapa npm audit. No audit fix ni cambios de dependencias. |
| J06 | Revisión estática test.yml, sonar.yml y docs.yml; pruebas detectadas automáticamente por Jest | Mantener contratos/comandos/umbrales | Workflows y Sonar sin cambios; pruebas, cobertura, Swagger y compilación documental local compatibles | PASS | No se certifica Actions/Quality Gate. PlantUML y runner histórico de migraciones no se ejecutaron en esta fase. |

Cobertura de módulos en Windows: upload.middleware.js 100 % líneas / 96,29 % ramas; cloudinary.service.js 95,83 % / 89,47 %; product-images.service.js 95,69 % / 86,48 %. Los procesos hijos ejecutan código real sin sumar artificialmente sus ejecuciones a LCOV. startRecovery (temporizador de arranque) sigue sin cobertura directa; la recuperación tras reinicio sí se ejercita mediante procesos nuevos.

No se suman las 37 pruebas SQL a las 917 de la suite general como si fueran una única ejecución. Las omitidas se reportan como omitidas, aunque algunos escenarios se hayan comprobado por separado en el runner aislado.

## Clasificación del resultado

- **Fallos de integridad reproducidos bajo precondiciones simuladas:** G09 (dos procesos, operación sin referencia más allá de gracia) y H01 (dos bases con recurso compartido). Severidad alta condicional. No son una explotación del despliegue habitual.
- **Deficiencias de diseño verificadas:** H1 (C01/C04/C11), H2 (F05), H3 (B11–B17) y H4 (I02–I05). No se provocó agotamiento de memoria/cuota ni se acreditó que el proveedor acepte archivos corruptos.
- **Defectos de robustez adicionales:** B18 (multipart incompleto como 500), C05/C06 (TypeError con respuesta nula) y C15 (respuesta contradictoria no validada). Severidad baja; respuestas públicas saneadas.
- **Comportamientos esperados:** rechazo antes del parser en A, límites de bytes, compensación, rollback, protección de referencias, históricos y estado suspendido/borrado, y seguridad de logs.
- **Riesgos sin acreditar:** decodificación real y bombas en proveedor/navegador, fallo físico de almacenamiento, permisos efectivos de API key, metadatos privados y configuración real de múltiples entornos. No se contactó Cloudinary para investigarlos.

## Qué quedó sin comprobar

| ID | Condiciones / objetivo | Esperado | Obtenido | Estado | Motivo |
|---|---|---|---|---|---|
| B24 | Validación real de corrupción/poliglotas por Cloudinary | Rechazo o normalización del proveedor | No se envían archivos | BLOCKED | Tráfico de escritura real prohibido; mocks no decodifican ni representan sus límites. |
| B25 | Coste real de bombas de descompresión en proveedor/navegador | Consumo acotado | Solo construcción/header y forwarding local | BLOCKED | No se ejecutan decodificaciones peligrosas ni carga contra servicios reales. |
| G13 | Corte eléctrico/caída del host y garantías del filesystem | Diario durable tras fallo físico | No se simula fallo físico | BLOCKED | No es equivalente a terminar un proceso; requiere laboratorio específico. |
| J07 | Actions y Quality Gate remoto | Gate aprobado | No ejecutados | BLOCKED | No se publica ni sincroniza; esta validación es exclusivamente local. |

G09 y H01 reproducen fallos de integridad bajo sus precondiciones en simulación; no acreditan explotación del entorno habitual. D06/G02 prueban confirmación incierta mediante doble/IPC, no cortando una conexión MySQL real durante COMMIT. ENOSPC/EACCES son inyecciones de fallo, no llenado de discos ni cambios de permisos habituales.

## Clasificación y correcciones propuestas (NO implementadas)

1. **P0 — Alta condicional, G09:** evitar que la recuperación de otra instancia retire operaciones todavía activas. Afecta `services/product-images.service.js`, en especial `active`, `reserve`, `reconcile` y `recover`. Usar coordinación durable compartida con lease/fencing o un único recuperador con conocimiento fiable de operaciones activas; aumentar 120 s no resuelve la carrera. Después, G09 debe conservar la imagen y la referencia; G01/G02/G08/G10 y D06 deben seguir pasando.

2. **P0 — Alta condicional, H01:** aislar entornos mediante cuentas/carpetas/permisos y marcador de entorno verificable en namespace/contexto. Afecta `services/cloudinary.service.js` y `services/product-images.service.js`; documentación/configuración de aprovisionamiento en una fase autorizada. H01 debe preservar la imagen del otro entorno; E06–E11 deben seguir protegiendo históricos y referencias. No retirar automáticamente recursos antiguos sin marcador nuevo.

3. **P1 — Media, H1:** preservar códigos seguros del proveedor y clasificar incertidumbre; presupuesto de recuperación por ciclo, espera progresiva, cuarentena durable y alertas. Afecta ambos servicios. C01/C04/C11 deben actualizar sus expectativas para demostrar clasificación y trabajo acotado; C02/C03/D06 deben conservar la seguridad ante resultados inciertos. No aplicar TTL que descarte ciegamente una subida tardía.

4. **P1 — Media, H2:** límite por vendedor y global de concurrencia/frecuencia/cuota antes de Multer. Afecta `routes/products.routes.js` y el middleware de control que se autorice. F05 deberá validar el límite configurado, respuesta controlada y liberación de capacidad tras fallo; A01–A12 y los flujos permitidos deben conservar contrato. Esta prueba no propone un umbral de producción ni demuestra una caída.

5. **P2 — Baja, B18/C05/C06/C15:** errores de multipart incompleto como 400 y respuestas del proveedor nulas/incoherentes como 502, con compensación segura. Afecta `middlewares/upload.middleware.js`, `services/cloudinary.service.js` y `services/product-images.service.js`. Esos escenarios deben dejar de producir 500/TypeError o aceptar tipos contradictorios; C07–C10 deben mantener la compensación.

6. **P2 — Baja/media según política, H3:** definir rechazo/normalización de corrupción, poliglotas, dimensiones, animación y metadatos con recursos acotados. Afecta `middlewares/upload.middleware.js` y `services/cloudinary.service.js`. B11–B17 deben seguir la política aprobada; B21–B23 necesitan límites explícitos antes de exigir rechazo. La validez definitiva del proveedor permanece BLOCKED en esta fase.

7. **P2 — Baja, H4:** eventos selectivos de fallo y referencias anterior/nueva, sin mensajes crudos ni secretos. Afecta `controllers/products.controller.js`, `middlewares/audit-logs.middleware.js`, `services/audit.service.js` y servicio de imágenes. I02–I05 deberán comprobar eventos suficientes; I01/I06–I08 deben mantener correlación, rollback y ausencia de filtraciones. Mantener 404 para propietario ajeno.

8. **P3 — Operación:** cuarentena de diarios inválidos, ACL privadas, límites de tamaño de lectura y documentación de almacenamiento persistente. Afecta `services/product-images.service.js`. G03–G07/G12 deben mantener fallo seguro; investigar G13 por separado.

## Archivos de esta fase

- Cuatro suites nuevas `images-phase2.*.test.js` bajo `tests/security/`.
- `tests/support/image-phase2-fixture.js`: fixtures y modelo transaccional en memoria.
- `tests/support/image-phase2-worker.cjs`: trabajador de procesos por IPC.
- Este informe. Producción, workflows, SonarQube, dependencias y .env no fueron modificados.

Las pruebas de caracterización de comportamientos defectuosos deberán convertirse en regresiones de la corrección aprobada; no conservar como expectativa permanente el comportamiento inseguro. No se implementó ninguna corrección de producción.
