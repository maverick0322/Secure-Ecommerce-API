# Seguridad de imágenes — fase 3C

Trabajo local, 2026-11-17/18. No se hicieron operaciones Git, publicación,
despliegue, consultas al proveedor real, cambios de secretos o acceso a la base
habitual. El producto 4 y su imagen permanecen intactos. No continúa a 3D.

## 1. Causas raíz y correcciones

| Hallazgo | Evidencia / causa | Corrección |
|---|---|---|
| H3, firmas solamente | B11–B17 admitían firmas sin imagen, CRC corrupto, datos añadidos y dimensiones/fotogramas arbitrarios. | Decodificación nativa completa y nueva codificación con límites; framing acotado previo. |
| Deflate PNG con filas extra | Nueva V05: sharp toleró 1 MB descomprimido para un IHDR de 2×2; rechazar solo por decoder no bastaba. | CRC, longitud exacta de filas, consumo íntegro de stream y maxOutputLength mediante zlib nativo; sin codec PNG de píxeles propio. |
| JPEG reparado silenciosamente | Nueva V02: EOI falsificado tras truncar entropía producía salida y advertencias, incluso con failOn:warning. | Rechazo de cualquier warning nativo sin guardar o registrar su texto. |
| Poliglotas/trailing bytes | B15/B23 y V03: bytes/ZIP/segunda imagen tras el fin. | Cierre exacto IEND/EOI/RIFF, validación y recodificación; no reenviar segmentos originales. |
| Multipart incompleto | B18 producía 500 por errores genéricos de Busboy. | Mapear solo errores conocidos de datos malformados a 400; mantener 413 y validación de campos/archivos. |
| Respuestas SDK anómalas | El null ya tenía 502 en 3B; faltaban validación completa y rechazo de resource_type/type contradictorios de C15. | Objeto, campos obligatorios, tipos, límites, URL y pertenencia coherentes antes de SQL. |
| Inspección/borrado anómalos | Una inspección nula podía confundirse con ausencia; destroy nulo podía dar TypeError. | Solo 404 explícito significa ausencia; error controlado conservando categoría de H1. |

El control de extensión/MIME y los 2 MiB existentes se conservan. No se sustituyen
por una confianza exclusiva en la respuesta de Cloudinary.

## 2. Dependencia y límites

Se evaluaron validación de firmas, bibliotecas solo de metadata, decodificador
propio y herramientas externas. Se eligió **sharp 0.35.5 exacto**, compatible
con Node >=20.9.0, mantenido y con binarios reproducibles para Windows/Linux.
Se revisaron sus advisories y los metadatos npm antes de instalar. Se ejecutó la
instalación con --ignore-scripts y se comprobó npm ci limpio en Linux/Node 20.
No se ejecutaron recomendaciones automáticas audit fix/--force.

Los rangos de advisories revisados excluyen 0.35.5; la consulta de candidatos no
reportó afectados. La auditoría posterior conserva exactamente los tres advisories
del diagnóstico: no añade vulnerabilidades npm por la dependencia nueva. Las 29
entradas nuevas del lock incluyen bindings/plataformas y sus componentes; no son
29 dependencias ejecutadas simultáneamente. Comparación semántica: **cero cambios
de versión en paquetes ya presentes**, package.json solo añade sharp a producción.

| Control | Política |
|---|---|
| Entrada y salida normalizada | <= 2 MiB cada una; 413 al superar. |
| Dimensiones/píxeles | <=4096 por lado y <=8.000.000 píxeles. |
| Fotogramas | Una imagen estática; APNG/WebP animado rechazados. |
| Trabajo nativo local | Dos procesos por API; sin cola; saturación 429/Retry-After=1. |
| CPU/vida de proceso | Plazo 5 s; terminación desde padre, plazo propio y salida al desconectar IPC. |
| Paralelismo/caché nativa | Un hilo libvips por proceso; caché desactivada. |
| Heap/memoria | Heap V8 64 MiB por hijo; entrada/píxeles/expansión acotados. No limita por sí solo RSS nativo. |
| PNG | CRC, chunks y orden básico; zlib con salida limitada a filas esperadas (Adam7 incluido). |
| JPEG/WebP | Estructura de segmentos/RIFF y cierre exacto; native decode completo y advertencias como rechazo. |

El nuevo límite de validadores complementa las cuotas Redis anteriores, que siguen
antes de Multer. No se cambian JWT RS256, sesiones Redis, RBAC ni propiedad.
PNG con metadata comprimida o chunks fuera de la lista admitida se rechaza; una
entrada válida de menos de 2 MiB puede dar 413 si su nueva codificación crece.
Estos son límites explícitos de admisión, no ajustes de dimensiones o calidad
silenciosos para hacer pasar pruebas.

## 3. Contrato del proveedor y recuperación

Se requieren public_id generado por el servidor, asset_id hexadecimal, version,
bytes, width/height, formato permitido, resource_type=image, type=upload y
secure_url del cloud configurado con versión/ruta/formato exactos y sin datos
de autenticación, query o fragmentos. existing debe ser booleano. La respuesta
normal también debe contener contexto de pertenencia de 3A; formato/dimensiones
deben coincidir con la salida validada del flujo HTTP.

Nulos, campos faltantes o contradicciones son 502 genérico, sin commit SQL/auditoría
de éxito. No se marca confirmada una subida inválida ni se elimina usando un
identificador suministrado por el proveedor. El diario propio permanece settled
incierto y usa gracia/backoff/presupuesto de 3B. Una colisión confirmada conserva
409 y no elimina el recurso previo. Las referencias, incluso soft-deleted,
namespace/contexto y cierre durable siguen protegiendo G09/H01.

Las pruebas del proveedor siguen usando mocks. El contrato estricto deberá
verificarse en una próxima subida real autorizada con la configuración efectiva
de Cloudinary; no se declara comprobado frente a la cuenta real en esta fase.

## 4. Casos ejecutables

| IDs / suite | Qué se verifica |
|---|---|
| B01–B03, V01 | JPEG/PNG/WebP válidos; native decode real, no mock del decodificador. |
| B04/B05, V06 | Contenedor PNG válido de 2 MiB exactos aceptado; 2 MiB+1 da 413. El padding anterior fuera de IEND ya no simula una imagen válida. |
| B06–B17, V02–V04 | Vacíos, firmas falsas, MIME/extensión cruzados, CRC corrupto, truncados y contenido comprimido inválido; no llamar proveedor. |
| V05 | Expansión zlib que excede filas declaradas, con payload pequeño y límite real de salida. |
| B15/B23, V03 | PNG-ZIP, contenido añadido y JPEG/PNG/WebP concatenados rechazados. |
| B16/B17/B21/B22, V07/V08 | Dimensiones/píxeles/fotogramas excesivos, flags de WebP animado y RIFF inválido; 4096×1 válido. |
| B18–B20, V10 | Multipart incompleto, boundary/cabeceras malformados, campos extra y múltiples ficheros; 400 controlado sin SDK. |
| V09 | EXIF/GPS/XMP sintéticos presentes antes y ausentes después de recodificar; no conservar ICC. |
| V11/V14 | Subproceso real, error sin fuga y liberación; salida al desaparecer el padre. |
| V12 | JPEG progresivo y PNG Adam7 legítimos aceptados. |
| V13 | PNG paletizado bajo 2 MiB cuya nueva codificación supera el límite: 413, sin llamar al siguiente controlador. |
| P01–P04 | Respuestas nulas/incompletas, campos obligatorios, tipos contradictorios, URL no HTTPS/ajena/inconsistente y error embebido. |
| C15/C17–C19, I09 | 502 HTTP antes de SQL, recuperación conservada, inspección/borrado anómalos controlados, sin secretos en respuestas/logs. |
| Colisión preexistente | 409 confirmado aunque cambien las dimensiones respecto de la carga intentada; respuesta existing=true incompleta conserva evidencia y recurso sin cleanup. |
| unit/image-validation.service | Capacidad de dos trabajos, cancelación, plazo, error de spawn/IPC, respuestas anómalas y liberación solo al cerrar. |
| Suites phase3a / phase3b / phase2.process | Regresiones de G09/H01/H1/H2, reinicios, commits inciertos, histórico, referencias y concurrencia. |
| MySQL/Redis descartables | Persistencia/auditoría/compensación y propiedad con decodificador nativo; proveedor mock. |

Los fixtures positivos de un PNG de 1×1 tenían IDAT corrupto. Se sustituyeron por
el PNG 2×2 comprobado mediante decodificación completa, sin relajar las validaciones.
Los mocks de upload ahora contienen el contrato real completo; no se permite el
éxito por eliminar expectativas de integridad o compensación.

## 5. Archivos modificados

Producción nuevos:

- services/image-policy.js
- services/image-container.service.js
- services/image-decoder.service.js
- services/image-validation.service.js
- services/image-validation-worker.cjs
- services/image-response.service.js

Producción existente/manifiestos:

- middlewares/upload.middleware.js
- controllers/products.controller.js
- services/product-images.service.js
- services/cloudinary.service.js
- services/swagger-contract.service.js
- package.json y package-lock.json

Pruebas y soporte:

- tests/security/images-phase3c.validation.test.js, tests/unit/image-validation.service.test.js (nuevas).
- tests/support/image-phase3c-node20.cjs (nuevo verificador local).
- tests/security/images-phase2.http.test.js, images-phase2.service.test.js, images-phase2.sdk.test.js, images-phase2.process.test.js.
- tests/support/image-phase2-fixture.js, security-checks.js.
- tests/unit/upload.middleware.test.js, product-images.service.test.js.
- tests/integration/products.routes.test.js, tests/database/catalog.mysql.test.js.

Documentación: guía de fase 3C, este informe, nota histórica de fase 2, README e
informe de implementación. Artefactos nuevos en log/images-phase3c-* y directorios
de verificación descartable. No se cambiaron workflows, SonarQube, .env, credenciales,
modelos, migraciones o seeders. Se conservan los cambios locales anteriores de 3A/3B
y ajenos a esta tarea; sus expectativas de seguridad no se debilitan.

## 6. Metadatos, contenido público y riesgos residuales

La política de nuevas cargas quita metadata embebida, incluidos EXIF/GPS/XMP/ICC,
comentarios y atribuciones; aplica orientación antes de retirar EXIF. No vuelve
privadas las URLs públicas del catálogo. Un proveedor o herramienta que conserve
originales históricos podría seguir entregando metadatos anteriores: no se
transformó, descargó ni examinó la imagen del producto 4.

Se rechazan los poliglotas y daños reproducidos. No hay detector universal de
esteganografía, interpretación alternativa o malware en toda imagen válida; la
codificación nueva impide publicar los segmentos originales. JPEG/WebP tampoco
tienen una prueba criptográfica de que píxeles válidos no hayan sido alterados.
El procesador nativo aumenta superficie de dependencias: mantenerlo actualizado
y vigilar avisos, sin suponer que npm audit representa todos los bugs nativos.

El subproceso tiene límites de trabajo y entrada, pero corre como el usuario de
la API: no es una sandbox de permisos, no impone límite RSS nativo ni elimina la
necesidad de límites de memoria/CPU del contenedor. La recuperación y cuotas de
3A/3B mantienen sus limitaciones distribuidas documentadas. H4 continúa pendiente.

La [guía 3C](../../docs/security/cloudinary-stage3c.md) contiene alternativas,
restricciones y fuentes oficiales: sharp/install, API de output, avisos del
proyecto y metadata stripping de Cloudinary. No se confunde la comprobación local
con una prueba real del proveedor, rendimiento de producción o certificación HA.

## 7. Resultados finales y CI

| Comprobación | Resultado final | Evidencia local |
|---|---|---|
| Validación, multipart, SDK, lifecycle y regresiones 3A/3B | PASS, 10 suites y 247 pruebas, exit 0. | log/images-phase3c-targeted-final.log |
| npm test | PASS, 77 suites y 1047 pruebas; 53 omitidas por fixtures/plataforma, exit 0. | log/images-phase3c-regression-final.log |
| npm run test:coverage -- --runInBand --coverageDirectory=log/images-phase3c-coverage | PASS, mismas 1047 pruebas, reportes JSON/LCOV y exit 0. | log/images-phase3c-coverage-final.log; log/images-phase3c-coverage/ |
| MySQL/Redis descartables | PASS, 3 suites y 39 pruebas, exit 0; esquema final y repetido, auditoría y compensación. | log/images-phase3c-mysql-final.log |
| Redis real descartable, limitador en dos procesos | PASS, 1 prueba, exit 0; limpieza confirmada. | log/images-phase3c-redis.log |
| npm ci --ignore-scripts y carga nativa en Linux/Node 20.20.2 | PASS; instalación independiente del árbol Windows, sin actualizar dependencias. | log/images-phase3c-node20-install.log |
| Node 20.20.2/Linux, pruebas sin red | PASS, 1042 pruebas, 58 omitidas; cobertura, Swagger y docs:build, exit 0. | log/images-phase3c-node20-compat.log |
| npm audit --audit-level=high --json | FAIL externo conocido, exit 1; 34 altas y 7 moderadas, 0 críticas. | log/images-phase3c-audit.json; stderr vacío |

Cobertura global Windows: **88,35 % líneas y 85,63 % ramas**, frente a 87,98 % /
85,42 % en 3B. Node 20: **88,33 % líneas y 85,60 % ramas**. No se redujeron umbrales,
exclusiones ni exigencias de SonarQube. Se usa un directorio nuevo bajo log/ porque
la fase previa documentó EPERM en el reporte predeterminado de Windows; en el
contenedor Linux se generó la cobertura en coverage/ mediante el comando habitual.

| Módulo | Líneas | Ramas |
|---|---:|---:|
| upload.middleware.js | 100 % | 90,69 % |
| image-container.service.js | 96,96 % | 85,27 % |
| image-decoder.service.js | 93,75 % | 94,11 % |
| image-validation.service.js | 100 % | 90 % |
| image-response.service.js | 100 % | 100 % |
| cloudinary.service.js | 97,67 % | 89,65 % |
| product-images.service.js | 96,36 % | 86,14 % |
| image-ownership.service.js, preservado | 100 % | 85,1 % |

Los escenarios negativos iniciales que descubrieron tolerancia de filas PNG y
reparación JPEG fallaron antes de sus correcciones; se conservaron como regresiones.
También se corrigieron expectativas de fixtures/bytes tras recodificar y una comilla
del Dockerfile exclusivamente diagnóstico. No se cuentan esos intentos fallidos
como aprobados: los artefactos con sufijo final corresponden a la revisión posterior.

El verificador de Node 20 copia solo package/lock al contexto de instalación local,
no publica imágenes y usa una instantánea de fuentes que excluye .env/secretos,
logs y node_modules. La ejecución de pruebas usa tmpfs, red desactivada, filesystem
de imagen de solo lectura, capacidades eliminadas y límites de memoria/CPU. El
lock dentro de la imagen debe coincidir exactamente con el de la instantánea.
Las integraciones SQL/Redis se verificaron aparte en el host Node 24.13.1, usando
contenedores descartables. No se ejecutó el pipeline remoto ni MySQL integrado
bajo Node 20: se distingue la compatibilidad funcional local de la ejecución real
de Actions. No se ejecutó despliegue, análisis remoto SonarQube o generación remota
de diagramas. Los workflows test.yml, sonar.yml y docs.yml permanecen intactos.

Estado de dependencias:

- sharp fijado a 0.35.5; instalación con scripts desactivados.
- 29 entradas nuevas en lock, incluidas plataformas; cero versiones previas cambiadas.
- Misma lista de advisories que antes: GHSA-fc5q-39xc-vjpf (picomatch),
  GHSA-3g3m-2fjr-6pw4 (glob) y GHSA-g3hv-75wg-m249 (minimatch).
- No se declara aprobado el CI: picomatch continúa siendo el bloqueo externo
  conocido, sin parche según el diagnóstico previo; no se intentó ocultarlo.
- Revisión semántica guardada en log/images-phase3c-dependency-review.json y
  consulta previa en log/images-phase3c-candidate-advisories.json.

Hashes finales de los manifiestos modificados justificadamente:

```
package.json       198a193f1379deb44ddfa448698b5655c7d856870493048ca3e4a704aaf17237
package-lock.json  e681fbb091ff0a4c3a860c4b534ec9cff232acd7e71b4235d980116e009a90ec
```

## 8. Corregido frente a mitigado y pendiente

- **Corregidos y comprobados localmente:** H3 en los casos reproducidos, archivos
  falsos/truncados/corruptos, límites, poliglotas añadidos/concatenados, multipart
  incompleto y confirmaciones nulas/incompletas/contradictorias del proveedor.
- **Conservados y con regresión:** G09, H01, presupuestos de H1, cuotas y permisos
  de H2, protección de referencias soft-deleted y compensación de fallos SQL/auditoría.
- **Mitigación con límites:** abuso de CPU/memoria mediante imágenes, metadata y
  payload alternativo. No se garantiza RSS nativo, ausencia de zero-days, detección
  universal de poliglotas, antivirus o funcionamiento HA fuera de los límites de 3A/3B.
- **Pendiente de autorización/verificación real:** nuevo contrato de respuesta
  con la configuración efectiva de Cloudinary, entrega/metadata de originales
  históricos, privilegios reales de la clave y comportamiento de proveedor ante
  sus errores. No se hicieron cargas reales en esta etapa.
- **Fuera de alcance:** H4 y el bloqueo externo de dependencias; no se continúa a 3D.

La comprobación final de Docker solo muestra los tres contenedores habituales que
ya existían; los de pruebas se retiraron. No se consultaron ni modificaron datos
reales, la cuenta Cloudinary o el producto 4. Cambios exclusivamente locales para
revisión manual; sin commits, sincronización, publicación o despliegue.
