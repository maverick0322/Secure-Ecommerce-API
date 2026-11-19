# Seguridad de imágenes — fase 3B, H1/H2

Fecha de ejecución: 2026-11-17. Cambios exclusivamente locales, sin operaciones
Git, publicación, despliegue, migraciones habituales o acceso al proveedor real.
Se mantienen las correcciones y pruebas de G09/H01 de 3A. Esta etapa no continúa
a 3C ni corrige H3/H4.

## Causa y solución

H1: el adaptador descartaba la categoría de error del proveedor; `watchMissing`
volvía a inspeccionar recursos inexistentes indefinidamente y recorría todo el
directorio sin presupuesto. Ahora se conserva una clasificación segura, se cierran
solo rechazos inequívocos y se preserva la incertidumbre. La recuperación tiene
presupuesto persistente, backoff, revisión manual, lectura incremental y un tope
de admisión del backlog. Un resultado de upload incompleto también se trata como
incierto y responde 502 controlado: es necesario para aplicar esa política H1.

H2: no existía admisión antes de Multer ni frecuencia o concurrencia compartidas.
Se usa el coordinador Redis de sesiones, con clave separada, WATCH/MULTI/EXEC,
reloj Redis y expiración. No cambia RS256, RBAC, comprobación de propietario ni
las transacciones SQL/auditoría. Se añade un presupuesto local de memoria que no
vence mientras el proceso todavía retiene trabajo.

Diseño completo, alternativas descartadas, semántica de clasificación y límites:
[guía operativa de 3B](../../docs/security/cloudinary-stage3b.md).

| Control | Valor |
|---|---|
| Frecuencia vendedor/global | 6 / 60 admisiones por ventana fija de 60 s. |
| Concurrencia vendedor/global/local | 1 / 8 / 8 por proceso. |
| Permiso y renovación | 90 s, heartbeat cada 20 s. |
| Recepción / SDK / plazo local remoto | 30 s / 30 s / 35 s. |
| Recuperación | 32 entradas por ciclo; intervalo 60 s; máximo 6 fallos; backoff exponencial persistente. |
| Backlog | Dejar de reservar al observar 1000 entradas; preservar evidencia, responder 503. No es una cuota atómica de filesystem. |
| Límite alcanzado | 429 con Retry-After, antes de Multer. |
| Redis no disponible / permiso perdido | 503, sin fallback permisivo. |

## Evidencia de escenarios

Todos los recursos son sintéticos: modelos/proveedor mock, directorios temporales,
Redis y MySQL creados y destruidos por los fixtures existentes. No se cargó `.env`
ni se consultó el producto 4. Las cargas de prueba son acotadas: máximo 12 intentos
paralelos en el doble de admisión, 6 solicitudes HTTP de caracterización y 60
admisiones secuenciales para agotar la ventana global. Tiempo avanzado mediante
mocks o metadata de un Redis descartable, sin cambiar el reloj del host.

| IDs | Condiciones / esperado | Evidencia ejecutable |
|---|---|---|
| R01 ×3 | Definitivo cierra diario sin inspect; transitorio/incierto conserva evidencia y 502 genérico. | images-phase3b.recovery.test.js |
| R02 | Ausencia incierta: seis intentos persistidos; entre plazos no hay consultas; después queda manual aunque pase un año. | Misma suite. |
| R03 | 429 persistente durante recuperación: seis inspecciones, ninguna repetición de upload. | Misma suite. |
| R04 | Rechazo definitivo de limpieza: intervención manual inmediata, sin repetir llamada. | Misma suite. |
| R05 | Recrear el servicio respeta retryAt y presupuesto almacenados en disco. | Misma suite; procesos independientes también en G13. |
| R06 | 70 tareas manuales; máximo 32 entradas por ciclo, sin SQL/proveedor, progreso en ciclos sucesivos. | Misma suite. |
| R07 | 1000 archivos de evidencia: nueva carga 503 antes de contactar proveedor; conservar todos. | Misma suite. |
| R08 | Pending con fallo SQL: no convertir a settled; no sondear indefinidamente ni borrar. | Misma suite. |
| R09 | Referencia de producto eliminado lógicamente y recurso de contexto ajeno: ambos intactos. | Misma suite. |
| R10/R12 | Pérdida de permiso después/antes del upload: 503; compensar únicamente recurso propio confirmado o cerrar sin trabajo remoto. | Misma suite. |
| R11 | Métricas numéricas seguras, sin serializar errores o buffers. | Misma suite. |
| L01/L19 | Dos limitadores y dos pools WATCH/MULTI comparten límite por vendedor; resolver conflictos confirmados. | images-phase3b.limits.test.js |
| L02 | Seis admisiones consumen ventana; séptima 429 y apertura posterior según TIME. | Misma suite. |
| L03 | 12 intentos simultáneos de vendedores distintos: ocho aceptados, cuatro rechazados; liberar abre plaza. | Misma suite. |
| L04 | 60 admisiones secuenciales; siguiente vendedor también 429 global; estado acotado a una clave. | Misma suite. |
| L05/L06/L07 | Expirar proceso abandonado; liberar token viejo no elimina el nuevo; release idempotente. | Misma suite. |
| L08/L09 | Redis falla antes/después de admisión: no hay fallback ni permiso válido. | Misma suite. |
| L10/L11/L20 | Renovación más allá de 120 s; dejar de renovar tras release/fallo; permiso fallido no se reutiliza. | Misma suite. |
| L12 ×3/L13 | Estado corrupto o identidad inválida: rechazo seguro. | Misma suite. |
| L14 ×2/L15 | Finish/close liberan recepción; desconexión durante procesamiento mantiene permiso hasta finally. | Misma suite. |
| L16/L17/L18 | 429/Retry-After, 503 genérico, 408 y cierre al agotar recepción. No invocar siguiente middleware bajo rechazo. | Misma suite. |
| L21/L22 | Presupuesto local sigue acotado aunque venzan permisos; fallo de release libera memoria local. | Misma suite. |
| C01/C04/C05–C09/C11/C16 | Rechazos, incompletos, SDK normalizado sin secretos, timeout sin callback; expectativas anteriores de H1 sustituidas por controles seguros. | Suites phase2.service / phase2.sdk actualizadas. |
| F05 | Seis peticiones, concurrencia tres: dos aceptadas, cuatro 429; pico de upload 1; solo dos llamadas Multer/proveedor. | phase2.http actualizada. |
| G01/G02/G08–G11/G13, S01–S16, H01 | Caídas antes/después de commit, otro proceso tras 120 s, reinicio settled, entornos independientes, contexto e imágenes históricas. Preservar garantías de 3A. | phase2.process, phase3a.ownership y phase2.service. |
| SQL + HTTP | Backoff real de limpieza; concurrencia transaccional del servicio conservada; nuevo rechazo HTTP simultáneo; integridad/auditoría/propiedad. | catalog.mysql.test.js, fixture MySQL/Redis descartable. |
| Redis + dos procesos | Admisión compartida; matar un proceso no libera prematuramente su permiso; vencimiento simulado únicamente en Redis propio, saturación global. | database/image-limits.redis.test.js. |

Las pruebas MySQL históricas compartían el mismo vendedor entre escenarios y
agotaban la nueva cuota. Se aísla el estado de admisión entre casos borrando
exclusivamente la clave del Redis descartable verificado por el fixture. No se
desactiva la validación de producción. La concurrencia SQL sigue probándose
directamente en el servicio, además de probar el nuevo 429 del flujo HTTP.
La expectativa de reintento inmediato se cambió por avance de tiempo simulado.

## Archivos de esta etapa

Producción:

- services/cloudinary.service.js: categoría segura y plazo/cancelación de upload.
- services/product-images.service.js: estados, presupuesto, backoff, admisión de backlog y métricas.
- services/image-limits.service.js (nuevo): coordinador de frecuencia y permisos Redis.
- services/auth-runtime.service.js: composición del limitador con la conexión existente.
- middlewares/image-limits.middleware.js (nuevo): admisión antes de Multer y recepción acotada.
- routes/products.routes.js: orden JWT → propietario → límites → Multer.
- controllers/products.controller.js: permiso durante procesamiento y finally seguro.
- services/structured-logger.service.js: métricas allowlistadas de recuperación.
- services/swagger-contract.service.js: 408/429 y Retry-After, manteniendo errores y éxito anteriores.

Pruebas y soporte:

- tests/security/images-phase3b.limits.test.js y images-phase3b.recovery.test.js (nuevos).
- tests/database/image-limits.redis.test.js (nuevo).
- tests/support/image-admission-double.js, image-limits-worker.cjs e image-phase3b-node20.cjs (nuevos).
- tests/support/auth-fixtures.js y isolated-auth.js.
- tests/security/images-phase2.http.test.js, images-phase2.service.test.js, images-phase2.sdk.test.js.
- tests/unit/product-images.service.test.js y tests/integration/products.routes.test.js.
- tests/database/catalog.mysql.test.js: se conserva el trabajo previo y se amplían expectativas.

Documentación: guía 3B, este informe, README e informe de implementación.
Artefactos de diagnóstico/ejecución: log/images-phase3b-*; cobertura alternativa
en log/images-phase3b-coverage/. No se modificaron package/lock, workflows,
SonarQube, modelos, migraciones, .env ni credenciales. Las pruebas de 3A continúan
sin rebajar sus expectativas. No se revirtieron cambios locales anteriores.

## Estado de seguridad y límites residuales

- H1 corregido en consumo automático: rechazos cierran, inciertos tienen presupuesto
  durable y trabajo por ciclo acotado; evidencia que no permite cierre seguro queda
  preservada para intervención. Limpieza autónoma de todo pendiente NO implementada.
- H2 corregido en ausencia de control: cuotas, concurrencia, TTL, tiempos de recepción
  y rechazo seguro. Es mitigación de abuso de aplicación, no protección total DDoS.
- G09/H01 conservados: permisos de admisión o reintentos no autorizan borrado. El
  borrado exige cierre durable, identidad/contexto propios y ausencia de referencias
  incluyendo soft delete. No se migra ni se borra una imagen histórica.
- Los contadores de recuperación no coordinan un único consumidor entre hosts;
  para un presupuesto agregado estricto, operar una sola instancia de la API.
  Con varias, el máximo por ciclo es 32 veces el número de instancias; no hay elección de líder.
  No existe certificación HA/NFS/Redis Cluster. Las instancias deben compartir la
  misma identidad Redis/namespace/generation y respetar restricciones de 3A.
- Ventanas fijas permiten ráfaga en el cambio de minuto. La partición o pausa de
  proceso no demuestra fin de la operación externa. El presupuesto local conserva
  el límite de memoria; no se mata un commit incierto para liberar una plaza.
- La infraestructura Redis de autenticación se comparte deliberadamente, sin ampliar
  ACL. Su fallo puede exigir reiniciar el proceso por el fencing existente. Mayor
  aislamiento de disponibilidad sería un trabajo separado, no una relajación de seguridad.
- H3/H4, revisión de privilegios efectivos del proveedor y recuperación física del host
  continúan pendientes. No se hicieron pruebas reales de proveedor ni carga sin límites.

## Ejecución final

| Comprobación | Resultado definitivo | Evidencia local |
|---|---|---|
| H1/H2 + G09/H01 + adaptador | PASS: 7 suites, 133 pruebas, exit 0. | log/images-phase3b-targeted-final.log |
| npm test | PASS: 75 suites, 979 pruebas; 53 omitidas de fixtures/plataforma, exit 0. | log/images-phase3b-regression-final.log |
| npm run test:coverage, directorio predeterminado | Pruebas aprobadas, reporte BLOCKED por EPERM al abrir coverage/coverage-final.json. No se considera evidencia de cobertura nueva. | log/images-phase3b-coverage.log |
| npm run test:coverage -- --runInBand --coverageDirectory=log/images-phase3b-coverage | PASS: 979 pruebas, 53 omitidas, exit 0; reportes generados, sin cambiar configuración/umbrales. | log/images-phase3b-coverage-final.log; log/images-phase3b-coverage/ |
| MySQL/Redis descartables, esquema final y repetido, HTTP/auditoría | PASS: 3 suites, 39 pruebas, exit 0; limpieza confirmada. | log/images-phase3b-mysql.log |
| Limitador con dos procesos y Redis real descartable | PASS: 1 prueba, exit 0; limpieza confirmada por fixture. | log/images-phase3b-redis.log |
| Node 20.20.2/Linux, red desactivada, mismos package/lock/dependencias cacheadas | PASS: 974 pruebas, 58 omitidas; cobertura, Swagger y docs:build, exit 0. | log/images-phase3b-node20-compat.log |
| npm audit --audit-level=high --json | FAIL externo conocido, exit 1: 34 entradas altas, 7 moderadas. Mismos tres advisories que el diagnóstico, sin entradas adicionales. | log/images-phase3b-audit.json; stderr vacío |

Cobertura total Windows: **87,98 % líneas, 85,42 % ramas**; en 3A era 87,61 % /
85,03 %. Node 20: **87,96 % líneas, 85,38 % ramas**. No se redujeron exigencias
ni exclusiones para obtener esos resultados. Módulos de 3B:

| Archivo | Líneas | Ramas |
|---|---:|---:|
| image-limits.service.js | 100 % | 94,36 % |
| image-limits.middleware.js | 100 % | 80 % |
| product-images.service.js | 96,31 % | 87,2 % |
| cloudinary.service.js | 97,5 % | 91,3 % |
| image-ownership.service.js, conservado de 3A | 100 % | 85,1 % |

La ligera variación de líneas del servicio de imágenes (96,42 % en 3A a 96,31 %)
corresponde a nuevas ramas de protección de archivos/backoff; la cobertura global
y de ramas aumenta. Permanecen sin cubrir algunos fallos de escritura del presupuesto
y casos de metadata inválida; no equivalen a pruebas de fallo físico de disco.

Hubo ejecuciones intermedias fallidas por expectativas anteriores de reintento
inmediato/concurrencia ilimitada, cuota compartida accidentalmente entre casos SQL
y un doble Redis que no aceptaba commit sin comandos. Se ajustaron los fixtures y
las expectativas relacionadas con el contrato nuevo, conservando las pruebas de
integridad. Los resultados de la tabla son las ejecuciones posteriores aprobadas.
Un reinicio del servidor interrumpió ejecuciones anteriores: se retiraron únicamente
sus contenedores descartables y se repitieron; no se contaron como aprobadas.

La verificación Linux usa una imagen Node 20 ya instalada y un tar excluyendo
secretos; compara el lock con el árbol cacheado antes de ejecutar. No instala,
actualiza, construye ni descarga dependencias o imágenes. Solo monta ese tar,
ejecuta en tmpfs y no accede a Docker/servicios habituales desde el contenedor.
Es evidencia de compatibilidad, no sustitución de npm ci/audit ni certificación del CI.
Las pruebas MySQL/Redis se ejecutaron aparte con Node 24.13.1 del host; la integración
SQL completa bajo Node 20/Actions remoto no se ejecutó en esta etapa.

Hashes package.json / package-lock.json sin cambios respecto del diagnóstico:

```
e9e1fadb5e10feb97afa131dd1f52f40c073e858bccf1a3b0812d52f1ab50da1
f89c4e0d5b95057df254e393149f7abd95ddeb0336c91a57a84ce178d9980de5
```

Los advisories siguen siendo GHSA-fc5q-39xc-vjpf (picomatch, alto sin parche según
el diagnóstico), GHSA-3g3m-2fjr-6pw4 (glob) y GHSA-g3hv-75wg-m249 (minimatch).
No se ejecutó audit fix, --force, ni auditoría reducida para sustituir la completa.
Los workflows test.yml, sonar.yml y docs.yml permanecen intactos. Jest/cobertura,
contrato Swagger y construcción documental son compatibles con Node 20 probado;
**CI no aprobado** por auditoría. No se ejecutó análisis remoto SonarQube ni despliegue.

Al terminar solo continúan los tres contenedores habituales que ya existían; los
fixtures se retiraron. No se consultó ni modificó la base habitual, Redis habitual,
Cloudinary, la imagen del producto 4 o sus referencias. No se ejecutó Git ni se publicó
nada. Fin de fase 3B, pendiente de revisión manual del usuario.
