# Revisión de las 11 alertas de seguridad de SonarCloud

Rama: `fix/sonar-quality-gate`. Fuente leída íntegramente: `docs/security/sonar-findings.txt`.
Las líneas de esta tabla son las originales del listado, no las posteriores a los cambios.
El listado no proporciona identificadores de reglas; no se asignan identificadores supuestos.
No se ha ejecutado un nuevo análisis de SonarCloud ni se ha cambiado el estado de ninguna incidencia en el servicio.

## Hallazgos individuales

| N.º | Archivo y línea original | Descripción de Sonar | Riesgo y condiciones | Clasificación y solución | Evidencia/pruebas |
| --- | --- | --- | --- | --- | --- |
| 1 | `services/authentication.service.js:6` | Revocar/cambiar/eliminar hash bcrypt | Un hash operativo publicado sería sensible. Este hash público es únicamente trabajo ficticio para búsquedas sin usuario; no concede acceso. | Posible falso positivo. Se conserva y documenta su propósito; no se reduce el coste. | Prueba real de bcrypt coste 12 ante usuario inexistente; verifica una comparación, respuesta 401 y ausencia de creación de sesión. Regresión HTTP de autenticación. |
| 2 | `Dockerfile:13` | Copia recursiva de datos sensibles | `COPY . .` podía incorporar archivos locales fuera de los filtros y hacía depender la seguridad únicamente de `.dockerignore`. Además, el código completo quedaba escribible por la API. | Corregido preventivamente. Lista explícita de fuentes de ejecución, Swagger generado dentro del build, dependencias de desarrollo retiradas y código/dependencias propiedad de root; solo `log` y `uploads` se asignan a `node`. | Construcción real de `secure-ecommerce-sonar-api:local` con Node 20 Alpine. Prueba estática de lista explícita, usuario y permisos. |
| 3 | `postman/scripts/cleanup.js:7` | Path traversal al leer estado | `../` ya era rechazado, pero un directorio enlazado o un `state.json` enlazado podía redirigir la lectura. Requiere manipulación local del árbol de informes. | Corregido bajo la precondición de directorio privado indicada más abajo. UUID v4 canónico; padres sin enlaces; archivo regular sin enlaces duros adicionales; lectura por descriptor con NOFOLLOW cuando está disponible y comprobación de identidad del archivo. | Rechazo de rutas manipuladas, junction de informes/ejecución, archivo enlazado y sustitución del padre. |
| 4 | `postman/scripts/cleanup.js:20` | Path traversal al eliminar entorno privado | Un padre enlazado podía redirigir el nombre fijo a archivos fuera del informe. | Corregido bajo directorio privado. Validación de padres y archivo regular antes de la limpieza y de cada operación correspondiente. | Rechazo de entorno privado enlazado; sentinel externo permanece intacto. |
| 5 | `postman/scripts/cleanup.js:22` — inspección del enlace | Path traversal | Un `workspace` enlazado podía hacer inspeccionar un `node_modules` ajeno. La validación del enlace final por sí sola no protegía a sus padres. | Corregido bajo directorio privado. `workspace` debe ser un directorio real; su entrada `node_modules` solo puede ser enlace y se inspecciona con lstat, incluidos enlaces rotos. | Junction de workspace rechazada antes de limpiar. |
| 6 | `postman/scripts/cleanup.js:22` — eliminación del enlace | Path traversal | Con padres manipulados podía eliminarse una entrada ajena. El objetivo del enlace no debe recorrerse. | Corregido bajo directorio privado. Se revalidan padres y se hace unlink únicamente del enlace de dependencias, nunca una eliminación recursiva de su destino. | Limpieza de junction de dependencias deja intacto su destino y el sentinel externo. |
| 7 | `postman/scripts/cleanup.js:24` | Path traversal al escribir estado | Un enlace simbólico o duro en estado podía sobrescribir un archivo externo; también existe riesgo de sustitución concurrente de padres. | Corregido bajo directorio privado, con limitación TOCTOU explícita. Estado regular de un solo enlace; archivo temporal exclusivo modo 0600; reemplazo por rename y comprobaciones repetidas. | Estado legítimo reemplazado correctamente; enlaces y padre sustituido rechazados; sentinel externo intacto. |
| 8 | `postman/scripts/isolation.js:15` | Inyección de argumentos Docker | No había shell ni concatenación de comandos, y los argumentos de nombres/labels ocupaban posiciones fijas. No se demuestra inyección explotable con el CLI existente. Era conveniente restringir también entradas internas, contexto y plantillas completas. | Posible falso positivo para inyección; endurecido. Plantillas permitidas exactas, IDs hex de 64 caracteres, UUID v4, sin NUL/CR/LF, `shell:false`, rechazo de host/contexto remoto y overrides de endpoint, nombre y base derivados del runId. Se conservan metadatos/etiquetas/tmpfs/puertos/UUID antes de SQL y limpieza. | Argumentos maliciosos, contenedor ajeno, contextos remotos y overrides rechazados antes de mutaciones. Docker simulado en estas pruebas. 38 comprobaciones existentes de aislamiento/metadatos aprobadas. |
| 9 | `scripts/database/Dockerfile.node20-verify:3` | Copia recursiva de datos sensibles | Copiaba todo el contexto y ejecutaba las verificaciones como root. | Corregido preventivamente. Lista explícita de entradas de verificación; `USER node` antes de instalar/ejecutar; filtros de secretos compartidos y filtros equivalentes para el contexto tar. Los seeders se copian para las pruebas de sus barreras, no se ejecutan. | Construcción real de `secure-ecommerce-sonar-node20:local`, instalación limpia, audit, pruebas, Swagger y documentación aprobados en Node 20/Linux. |
| 10 | `scripts/database/stage4-contract.js:15` | Posible contraseña hardcodeada | El nombre `passwordHash` y una cadena parecen una credencial para el analizador; la cadena es exclusivamente un tipo SQL. | Posible falso positivo. Se conserva el contrato de esquema sin alterar MySQL ni migraciones. | Aserción sobre `contract.users.passwordHash === 'varchar(255)'`; consumidor `stage4-verify.js` compara tipos de columnas. |
| 11 | `services/swagger-contract.service.js:75` | Posible contraseña hardcodeada | Era un ejemplo sintético de documentación, no una credencial aprovisionada. Aun así, podría copiarse como contraseña por lectores. | Corregido preventivamente: eliminado únicamente el ejemplo literal de contraseña; se mantienen campo, formato y validaciones documentadas. | Prueba del esquema sin ejemplo de contraseña, generación Swagger y pruebas de contrato HTTP/OpenAPI aprobadas. |

## Justificaciones copiables para revisión manual en SonarCloud

### 1. Hash ficticio de autenticación

El valor señalado no es el hash de una cuenta ni una credencial de acceso. Es un hash bcrypt público, de coste 12, utilizado exclusivamente como operando de comparación cuando la consulta de usuario no devuelve una cuenta. El login rechaza incondicionalmente la ausencia de cuenta, aunque la comparación devolviera true, antes de crear sesiones o tokens. Se conserva esta comparación para mitigar diferencias temporales entre usuarios existentes e inexistentes; no se afirma que elimine todo canal temporal. No se almacena el hash ficticio como contraseña de usuarios. Una prueba ejecuta bcrypt real ante una búsqueda sin usuario y verifica coste, rechazo y ausencia de sesión. Se propone revisar la incidencia como falso positivo, sin eliminar la protección ni rotar credenciales reales.

### 8. Argumentos Docker

La invocación utiliza spawnSync con un array de argumentos y shell:false, no un comando construido para un shell. Los datos variables no se dividen en nuevas opciones. La implementación reforzada admite únicamente plantillas literales de comandos, UUID v4, IDs hexadecimales completos y parámetros de contenedor/base derivados de la ejecución. Rechaza opciones manipuladas, saltos de línea, contextos remotos y overrides del endpoint. La limpieza valida identidad, etiquetas, nombre, tmpfs exclusivo y publicación local antes de detener o eliminar el contenedor de prueba. No se ha demostrado un vector de inyección de argumentos a partir de las entradas del CLI. Se propone revisar la alerta de inyección como posible falso positivo; el endurecimiento preventivo se mantiene.

### 10. Tipo SQL del contrato

El valor `varchar(255)` asociado a la propiedad `passwordHash` describe el tipo esperado de una columna MySQL en un diccionario de esquema. No es una contraseña, hash bcrypt, token ni secreto. El consumidor compara este metadato con information_schema.COLUMNS; no lo emplea para autenticarse ni para crear una cuenta. No existe una credencial que revocar o rotar en esta ubicación. Se propone marcar esta incidencia como falso positivo tras la revisión manual.

### 11. Ejemplo de Swagger anterior a la corrección

La cadena señalada era un ejemplo ficticio de documentación OpenAPI, no una credencial operativa ni un valor aprovisionado en MySQL. El servicio de Swagger no crea cuentas. Se retiró preventivamente el literal para impedir su copia como contraseña por lectores; se conservaron el campo y sus requisitos de validación. No procede rotar credenciales reales por esta cadena. Esta justificación puede adjuntarse a la revisión si la incidencia persiste tras el análisis nuevo.

## Cambios y efectos

- `postman/scripts/cleanup-paths.js`: helper nuevo para las operaciones de informes; separa las rutas confiables del CLI.
- `postman/scripts/cleanup.js`: integra el helper, valida PID positivo y vuelve a comprobar el entorno antes de limpiar; errores de permisos sobre el PID detienen la limpieza.
- `postman/scripts/isolation.js`: validación de plantillas Docker y entradas; comprueba contexto local también al limpiar; no cambia imágenes MySQL, puertos protegidos ni esquema.
- `Dockerfile`: lista de fuentes de ejecución, Swagger durante build y menor superficie de escritura del usuario de la API. Para regenerar Swagger en producción se reconstruye la imagen; no se necesitan herramientas de desarrollo en ejecución.
- `scripts/database/Dockerfile.node20-verify`: fuentes explícitas y verificación como usuario no privilegiado, incluyendo los seeders que requieren las pruebas de protección.
- `.dockerignore`: protección adicional para secretos anidados, material de claves, exports de credenciales/tokens y `config/config.json`.
- `scripts/database/verify-node20.js`: conserva la exclusión de entornos reales, añade solo los tres ejemplos públicos requeridos por el Dockerfile y refuerza exclusiones de material privado en el tar.
- `services/authentication.service.js`: solo comentario explicativo; no cambia el hash ni el comportamiento del login.
- `services/swagger-contract.service.js`: elimina el ejemplo literal de contraseña.
- `tests/unit/sonar-security.test.js`: 32 casos nuevos, incluyendo adversariales.

No se modificaron endpoints, contratos de tokens, RS256, Redis, Gmail, modelos, permisos SQL, bases, Compose, workflows, métricas ni exclusiones de Sonar. No se cambió de rama ni se hicieron commits, push o PR. El listado de entrada del usuario se conserva sin cambios.

## Verificaciones ejecutadas

1. Pruebas dirigidas iniciales: 55 aprobadas y una nueva prueba agotó el tiempo de 5 segundos durante la carga de dependencias/bcrypt. Se amplió únicamente ese timeout a 20 segundos, sin simular bcrypt ni reducir su coste; aprobó después.
2. Pruebas nuevas finales: `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/unit/sonar-security.test.js`: **32 aprobadas**.
3. `node --test postman/scripts/isolation.check.cjs postman/scripts/container-metadata.check.cjs`: **38 aprobadas**. HTTP de barreras usa servidores locales controlados, no la API habitual.
4. Primera regresión Windows en sandbox: 515 pruebas aprobadas, 45 omitidas, pero salida 1 por EPERM en log/log.txt y mensajes asíncronos posteriores al cierre. No se ocultó el error ni se modificó el middleware. Repetición con acceso al log local: **520 aprobadas, 45 omitidas, 45 suites aprobadas, 7 omitidas, salida 0**. Esto precedió al último caso adversarial del override Docker, probado después en la suite dirigida y en Linux.
5. Construcción real del Dockerfile de API: **aprobada** con Node 20 Alpine, instalación limpia y Swagger generado; npm informó 0 vulnerabilidades en las dependencias de ejecución después de prune.
6. Primera construcción de verificación: falló una prueba porque faltaban los seeders en la lista de copias. Se corrigió la lista, sin ejecutar seeders ni quitar la prueba.
7. Construcción final de verificación Node 20/Linux: **aprobada**, ejecutando `npm ci --ignore-scripts`, `npm audit --audit-level=high`, `npm run test:coverage`, `npm run swagger` y `npm run docs:build`. Resultado final: **521 aprobadas, 45 omitidas; 45 suites aprobadas, 7 omitidas**. Audit reportó **19 moderadas y 4 bajas**, sin altas ni críticas; no se aplicaron actualizaciones de dependencias.
8. Cobertura global incidental del comando existente dentro de la imagen: statements 75.15 %, branches 72.96 %, functions 77.97 %, lines 79.05 %. Esto no es cobertura de código nuevo de SonarCloud ni acredita el Quality Gate. No se ajustaron objetivos, exclusiones o configuración de cobertura.
9. `git diff --check`: sin errores de whitespace.

Las dos imágenes de comprobación creadas son `secure-ecommerce-sonar-api:local` y `secure-ecommerce-sonar-node20:local`. No se ejecutaron contenedores de estas imágenes, no se levantaron servicios y no se modificaron contenedores habituales. La construcción ejecutó pruebas dentro de sus etapas aisladas.

## Limitaciones y pendientes

- Las 45 pruebas omitidas pertenecen a siete suites condicionadas de MySQL/Redis reales; no se proporcionaron sus descriptores de instancia temporal. No se ejecutaron Postman completo, migraciones, seeders ni pruebas contra bases habituales. Las regresiones HTTP utilizan persistencia/proveedores simulados; no prueban Gmail real ni Redis TLS real en esta ejecución.
- TOCTOU: comprobaciones repetidas, NOFOLLOW cuando existe, fstat/lstat y rename reducen las ventanas, pero Node.js no ofrece openat/unlinkat portables. No se garantiza seguridad frente a otro proceso con el mismo usuario que sustituya padres exactamente entre comprobación y syscall. El checkout y `postman/reports` deben residir en directorios privados, sin escritura por usuarios locales no confiables; en Windows deben revisarse sus ACL. No se cambiaron permisos existentes. Un entorno hostil compartido requiere aislamiento de usuario/directorio o una decisión adicional de plataforma; no debe considerarse cubierto por estas pruebas.
- El enlace final permitido de `workspace/node_modules` se elimina como entrada, nunca se recorre. Los padres deben cumplir la misma precondición de privacidad.
- Los clientes y configuraciones locales de Docker son parte del entorno confiable. Se rechazan endpoints remotos explícitos; no se pretende defenderse de un administrador local que altere Docker o el ejecutable durante la operación.
- La ruta de construcción por tar se adaptó e inspeccionó, pero las dos construcciones ejecutadas usaron contexto `.`. No se afirma haber ejecutado el runner `verify-node20.js` completo.
- Revisar manualmente en SonarCloud los casos 1, 8 y 10 y adjuntar las justificaciones. El caso 11 tiene una corrección preventiva, además de una justificación del código anterior.
- Ejecutar un nuevo análisis para comprobar cuáles alertas persisten. No se afirma que las 11 hayan desaparecido del servicio ni que se haya aprobado el Quality Gate.
- Fiabilidad, cobertura de código nuevo y dependencias moderadas/bajas quedan para revisión posterior; no se debilitaron controles para mejorar el resultado.
