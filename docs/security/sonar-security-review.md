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

# Etapa 2 — Fiabilidad de SonarCloud

Se volvió a leer íntegramente `sonar-findings.txt`: contiene exactamente 45 entradas Reliability. Se conserva la revisión de seguridad anterior. Rama `fix/sonar-quality-gate`, sin commits, push ni PR. Las líneas siguientes son las originales del listado; no son las actuales tras los cambios. El listado no contiene IDs de regla y la última incidencia no incluye línea: no se inventan esos datos.

## Tabla de las 45 incidencias

Clases de solución: **O** = orden explícito equivalente al anterior; **P** = propiedad de la promesa explícita; **R** = trabajo acotado sin patrón superlineal; **V** = uso/representación explícita con validación conservada. Todas están atendidas en código; su cierre en SonarCloud y la calificación A requieren un análisis nuevo.

| N.º | Archivo | Línea original | Problema | Clasificación y solución aplicada |
| --- | --- | --- | --- | --- |
| 1 | `postman/scripts/api-server.js` | 43 | sort sin comparador | O: nombres de tablas, orden canónico UTF-16 explícito. También se actualiza su comparación adyacente. |
| 2 | `postman/scripts/container-metadata.js` | 8 | sort de claves sin localeCompare | O: claves de JSON canónico, se conserva orden UTF-16; no se usa colación regional. |
| 3 | `postman/scripts/isolation.js` | 110 | sort sin comparador | O: nombres de migraciones, orden UTF-16 explícito. |
| 4 | `scripts/database/activate-final.js` | 25 | sort sin comparador | O: nombres de atributos/columnas, mismo orden en ambos lados. |
| 5 | `scripts/database/activate-final.js` | 39 | sort sin comparador | O: nombres de tablas del artefacto. |
| 6 | `scripts/database/stage4-verify.js` | 13 | sort sin comparador | O: tablas esperadas y observadas. |
| 7 | `scripts/database/stage4-verify.js` | 20 | sort sin comparador | O: nombres de columnas en ambos lados. |
| 8 | `scripts/database/stage4-verify.js` | 37 | sort sin comparador | O: identidades textuales de relaciones FK. |
| 9 | `scripts/database/stage4-verify.js` | 63 | sort sin comparador | O: nombres de restricciones CHECK. |
| 10 | `scripts/database/stage4.js` | 15 | sort sin comparador | O: secuencia de archivos de migración históricos. |
| 11 | `scripts/database/stage4.js` | 19 | sort sin comparador | O: nombres de tablas de negocio. |
| 12 | `scripts/database/stage4.js` | 171 | sort sin comparador | O: conjuntos de tablas finales. |
| 13 | `scripts/database/stage4.js` | 174 | sort sin comparador | O: nombres de migraciones aplicadas/esperadas. |
| 14 | `scripts/database/stage4.js` | 202 | sort sin comparador | O: tablas finales y estructuras transitorias esperadas. |
| 15 | `scripts/database/stage4.js` | 206 | sort sin comparador | O: tablas antes/después del cierre. |
| 16 | `scripts/database/stage4.js` | 208 | sort sin comparador | O: historial esperado de migraciones. |
| 17 | `scripts/database/stage4.js` | 212 | sort sin comparador | O: tablas del artefacto de migraciones. |
| 18 | `scripts/database/stage4.js` | 222 | sort sin comparador | O: historial de migraciones aditivas. |
| 19 | `scripts/database/stage4.js` | 224 | sort sin comparador | O: conjunto transitorio de tablas. |
| 20 | `scripts/database/stage4.js` | 229 | sort sin comparador | O: conjunto final de tablas. |
| 21 | `scripts/database/stage4.js` | 231 | sort sin comparador | O: historial final de migraciones. |
| 22 | `services/auth-redis.service.js` | 41 | sort sin comparador | O: claves del estado Redis; conserva exactamente `expectedRunId,generation,namespace,version`. |
| 23 | `services/database.service.js` | 2 | sort sin comparador | O: nombres de las 14 tablas; comparador equivalente también en las filas observadas. |
| 24 | `services/orders.service.js` | 28 | sort de identificadores sin comparador | O: UUID de vendedores, mismo orden UTF-16 y de adquisición de bloqueos. |
| 25 | `tests/support/security-checks.js` | 169 | sort numérico sin comparador | O: estados HTTP con `(a,b)=>a-b`, no orden alfabético. |
| 26 | `postman/scripts/container-metadata.check.cjs` | 17 | promesa de test sin manejo explícito | P: `void test(...)`; node:test conserva y reporta el resultado del callback. |
| 27 | `postman/scripts/container-metadata.check.cjs` | 44 | promesa de test sin manejo explícito | P: registro de casos parametrizados explícito. |
| 28 | `postman/scripts/container-metadata.check.cjs` | 50 | promesa de test sin manejo explícito | P: resultado de registro descartado explícitamente; cuerpo supervisado por node:test. |
| 29 | `postman/scripts/container-metadata.check.cjs` | 57 | promesa de test sin manejo explícito | P: registro explícito sin suprimir errores del callback. |
| 30 | `postman/scripts/isolation.check.cjs` | 17 | promesa de test sin manejo explícito | P: `void test(...)`, supervisión por node:test. |
| 31 | `postman/scripts/isolation.check.cjs` | 20 | promesa de test sin manejo explícito | P: mismo tratamiento de registro. |
| 32 | `postman/scripts/isolation.check.cjs` | 23 | promesa de test sin manejo explícito | P: mismo tratamiento de registro. |
| 33 | `postman/scripts/isolation.check.cjs` | 36 | promesas de casos parametrizados | P: registro explícito; las aserciones siguen ejecutándose. |
| 34 | `postman/scripts/isolation.check.cjs` | 45 | promesas de casos parametrizados | P: registro explícito; errores siguen afectando al resultado del runner. |
| 35 | `postman/scripts/isolation.check.cjs` | 46 | promesa de test sin manejo explícito | P: mismo tratamiento de registro. |
| 36 | `postman/scripts/isolation.check.cjs` | 60 | promesa de test HTTP sin manejo explícito | P: registro explícito; callback async conserva awaits y finally. |
| 37 | `postman/scripts/isolation.check.cjs` | 67 | promesa de test HTTP sin manejo explícito | P: mismo tratamiento y limpieza del servidor local. |
| 38 | `tests/support/isolated-auth.js` | No indicada | catch con handler no reconocido como función | P: `void run.catch(error => { rejectReady(error); })`; `close()` sigue esperando la promesa original y propaga fallos de teardown. |
| 39 | `postman/scripts/isolation.js` | 109 | regex de migraciones potencialmente superlineal | R: filtro compartido `isMigrationFile`, longitud máxima 255, primer dígito/extensión comprobados directamente y rechazo de saltos de línea. |
| 40 | `postman/scripts/isolation.js` | 110 | segunda regex de migraciones | R: mismo filtro para migraciones de cierre; no se ejecutan migraciones con esta corrección. |
| 41 | `services/audit.service.js` | 20 | regex de correos potencialmente superlineal | R: scanner de caracteres equivalente para redacción de correos; prefijo de hasta 255 caracteres Unicode obtenido antes de copiar toda la entrada. |
| 42 | `services/password-policy.service.js` | 30 | regex de sufijo potencialmente superlineal | R: recorrido inverso por puntos de código; longitud UTF-16 rechazada antes del cómputo de bytes. Se conservan 15 caracteres, 72 bytes y la política original. |
| 43 | `services/auth-redis.service.js` | 109 | uso de NaN global | V: `Number.NaN`; mantiene el rechazo seguro del reloj inválido. |
| 44 | `services/cloudinary.service.js` | 18 | rechazo con valor distinto de Error | V: normalización de errores de callback, stream y excepciones síncronas; objetos desconocidos producen un mensaje genérico sin copiar detalles. |
| 45 | `services/redis-tls-config.service.js` | 12 | X509Certificate aparentemente no utilizado | V: se consulta `parsed.raw.length`; se conserva el constructor que valida DER/PEM y rechaza entradas inválidas. |

## Contratos preservados y justificaciones para SonarCloud

**Orden canónico — incidencias O textuales.** Los arreglos contienen identificadores, nombres de migraciones, claves de JSON, columnas y UUID de bloqueos, no texto de presentación. El orden anterior de strings era el de unidades UTF-16. `compareCodeUnits` implementa explícitamente ese mismo orden mediante `<` y `>`. `localeCompare()` no es apropiado: puede cambiar con ICU/locale y ordenar de otro modo mayúsculas, puntuación o Unicode. Las pruebas fijan ejemplos con números en texto, mayúsculas, BMP y caracteres suplementarios, y verifican el orden real de llamadas de bloqueo en checkout con persistencia simulada. Si Sonar insiste en localeCompare, esta es una excepción metodológica a revisar, no un motivo para alterar el contrato. No se cambiaron firmas, HMAC, contenido de snapshots, comparaciones de identidad, orden de productos ni contratos SQL.

**Registro node:test — incidencias 26–37.** La promesa devuelta por el registro no necesita un catch que oculte fallos: node:test ejecuta y supervisa el callback, incluidas sus promesas. `void` explicita únicamente que el llamador no usa el resultado del registro. Una prueba lanza un subproceso node:test con un callback async rechazado y verifica salida 1 y reporte del error, demostrando que no se pierden fallos. No se añadieron catch vacíos. Esta justificación sirve si el analizador mantiene alguno de los avisos.

**Runner de autenticación — incidencia 38.** El handler de rechazo ahora es una función explícita y la promesa derivada se marca con void. El rechazo previo a ready se propaga al await de start; tras ready, close sigue esperando la promesa original. Las pruebas simulan fallos de arranque, de conexión y de limpieza, verificando restauración del runtime y cierre. No hay recuperación de Redis ni cambio de estado de sesiones habituales.

**Regex — incidencias 39–42.** Los nombres de migración proceden del sistema de archivos, no de HTTP. La contraseña ya se limitaba a 72 bytes antes del patrón y el texto de auditoría ya se truncaba a 255 puntos de código antes de sus regex: no se ha demostrado un ReDoS remoto explotable en esas regex concretas. Aun así, se reemplazaron los patrones señalados por recorridos acotados. En auditoría se evita además expandir la cadena completa con spread antes del truncamiento. Pruebas de un millón de caracteres comprueban rechazo/truncamiento sin presupuestos temporales frágiles. La redacción de correos se contrasta con un oráculo acotado de la expresión anterior en 1.000 entradas deterministas y casos límite. Los nombres terminados en saltos de línea se rechazan explícitamente, sin afectar archivos de migración válidos.

**Certificado — incidencia 45.** El constructor original sí tenía un efecto requerido: validar y lanzar ante DER inválido. No era seguro eliminarlo como código muerto. Ahora se utiliza también su representación raw; no se añaden restricciones nuevas de vencimiento o tipo de CA. Se prueba un PEM de envoltura válida pero DER inválido y un bundle público válido de dos certificados. Si persiste la incidencia, adjuntar esta justificación: la operación es validación, no una asignación inútil.

## Compatibilidad real descubierta durante la verificación

Los runners Redis y HTTP/MySQL reutilizaban el wrapper Docker de Postman. La lista estricta de la etapa anterior no admitía create/start/restart/exec/stop del Redis temporal; las pruebas basadas solo en dobles no lo habían detectado. Los primeros intentos reales terminaron NOT_EXECUTED antes de ejercitar Redis. La imagen redis:8.2 sí estaba disponible.

Se añadieron únicamente plantillas exactas para Redis de prueba, con UUID v4, nombre derivado, imagen redis:8.2, tmpfs /data, puerto loopback efímero y script de arranque fijo cuyo password se pasa por entorno. Antes de cualquier operación Redis sobre un contenedor existente se verifica contexto local y la barrera de identidad, etiquetas, imagen, puertos y montajes. La lista MySQL/Postman previa no se amplió a comandos arbitrarios. El verificador de metadatos existente se trasladó sin cambiar su contenido a `postman/scripts/redis-test-metadata.js`, compartido por wrapper y runner, para evitar dependencias circulares. Se añadieron pruebas que rechazan opciones manipuladas y contenedores sin propiedad de prueba antes de iniciar nada.

Esto restaura compatibilidad con infraestructura ya existente; no habilita operaciones sobre Redis habitual, no ejecuta Lua ni cambia el contrato de autenticación.

## Archivos modificados y pruebas añadidas

- Helper nuevo: `services/canonical-order.js`.
- Ordenamientos: `postman/scripts/api-server.js`, `postman/scripts/container-metadata.js`, `postman/scripts/isolation.js`, `scripts/database/activate-final.js`, `scripts/database/stage4-verify.js`, `scripts/database/stage4.js`, `services/auth-redis.service.js`, `services/database.service.js`, `services/orders.service.js`, `tests/support/security-checks.js`.
- Promesas: `postman/scripts/container-metadata.check.cjs`, `postman/scripts/isolation.check.cjs`, `tests/support/isolated-auth.js`.
- Validaciones y errores: `services/audit.service.js`, `services/password-policy.service.js`, `services/cloudinary.service.js`, `services/redis-tls-config.service.js`.
- Compatibilidad del runner: `scripts/database/stage2-redis-test.js` y helper nuevo `postman/scripts/redis-test-metadata.js`.
- Pruebas nuevas: `tests/unit/sonar-reliability.test.js` (20 casos), `tests/unit/isolated-auth-lifecycle.test.js` (3 casos).
- Pruebas ampliadas: `tests/unit/cloudinary.service.test.js` (4 casos), `tests/unit/secure-config-file.test.js` (1 caso) y `tests/unit/redis-isolation.test.js` (2 casos).
- Este informe. Total: **30 casos nuevos**. Se conservaron los 32 adversariales de la etapa anterior.

No se modificaron MySQL/Redis habituales, sus credenciales, certificados, permisos o datos; ni los 14 modelos, migraciones históricas, reglas de autorización, RS256, OAuth, Gmail, workflows, exclusiones de Sonar o Quality Gate. Los archivos administrativos con sorts corregidos se inspeccionaron, pero no se ejecutaron sus operaciones administrativas.

## Resultados comprobados

1. Grupo de ordenamientos: 74 pruebas aprobadas en las suites dirigidas de seguridad, pedidos, identidad SQL y Redis.
2. Grupo de regex/promesas/proveedores: se detectaron y corrigieron dos fixtures nuevos incorrectos (nombre inicial de migración y forma del doble Redis) y un error de alcance del normalizador síncrono. No se quitaron aserciones ni se modificó la configuración para ocultarlos. La regresión final incluye todos esos casos.
3. Pruebas dirigidas finales de ambos grupos y barreras: 72 aprobadas en cuatro suites. Las demás pruebas ampliadas aprobaron en la regresión completa.
4. `node --test postman/scripts/container-metadata.check.cjs postman/scripts/isolation.check.cjs`: **38 aprobadas**, después de todos los cambios.
5. Build final `docker --context desktop-linux build --file scripts/database/Dockerfile.node20-verify --tag secure-ecommerce-sonar-node20:local .`: **aprobado**. Ejecutó regresión en Node 20/Linux, Swagger y docs:build sin PlantUML. **551 pruebas aprobadas, 45 omitidas; 47 suites aprobadas, 7 omitidas; salida 0**. Los contenedores habituales no se usan durante el build.
6. `npm audit --audit-level=high` dentro de esa construcción: **salida 0**, 19 moderadas y 4 bajas, sin altas ni críticas. No se modificaron dependencias ni lockfiles.
7. Cobertura global incidental de ese build: statements 77.27 %, branches 74.03 %, functions 80.72 %, lines 80.96 %. No es la cobertura de código nuevo de SonarCloud y no acredita el Quality Gate.
8. Redis real temporal, `node scripts/database/stage2-redis-test.js`: **6 grupos aprobados, cleanup=true**. Verifica creación, rotación, reutilización, concurrencia, vencimientos, revocación y fencing frente a estados obsoletos. Los reinicios afectan solo a su contenedor descartable.
9. HTTP/MySQL real temporal, `node scripts/database/stage5-addresses-test.js`: **salida 0** en la última ejecución. Verifica DDL final, aplicación con privilegios mínimos de prueba, direcciones, carrito, checkout y auditoría, además de **32 pruebas aprobadas en tres suites** de cuentas/catálogo/seguridad. Redis también es temporal. Proveedores de correo e imágenes se simulan. No se modifican bases habituales ni se ejecutan sus migraciones/seeders.
10. La primera ejecución real tras restaurar el wrapper registró un fallo: dos asignaciones concurrentes de categoría devolvieron [204,503] en vez de [204,204]. La repetición sin builds concurrentes aprobó 32/32. La causa exacta del 503 no quedó establecida; la carga concurrente es una hipótesis, no un diagnóstico confirmado. No se relajaron timeouts, reintentos ni aserciones. Se conserva como riesgo pendiente, no como fallo resuelto por repetición.
11. Las 45 omisiones del build se mantienen identificadas como suites condicionadas de MySQL/Redis. Los comandos reales anteriores ejercitaron el runner final y tres suites MySQL, más Redis real por separado; esto no convierte todas las omisiones del build en pruebas ejecutadas. Las suites históricas de esquema/transición no se ejecutaron con instancias específicas en esta etapa.
12. `git diff --check`: salida 0. Git advierte sobre conversión futura LF/CRLF en algunos archivos; no son errores de whitespace ni cambios de lógica.
13. Inspección de texto añadido y archivos nuevos para patrones de claves privadas, OAuth, tokens GitHub y JWT completos: **0 coincidencias**. No se imprimieron valores sensibles; el escaneo de patrones no constituye una garantía de ausencia de todo secreto posible.
14. Comprobación Docker de solo lectura al finalizar: no quedan contenedores con la etiqueta de Redis temporal ni con el nombre del runner MySQL temporal. No se eliminaron contenedores o volúmenes habituales.

## Pendientes y revisión manual

- Ejecutar SonarCloud sobre estos cambios para confirmar qué incidencias se cierran y si Reliability alcanza A. No se realizó ninguna clasificación automática en el servicio.
- Si persisten avisos que exigen localeCompare, registros node:test o uso del constructor X509, adjuntar las justificaciones anteriores. No hay IDs de regla en la fuente recibida.
- Investigar la intermitencia HTTP 503 en asignación concurrente de categorías antes de dar por estable la integración bajo carga. Cambiar el contrato de concurrencia, límites o disponibilidad de sesiones requiere revisión; no se hizo aquí.
- Mantener los pendientes de la etapa anterior relativos a TOCTOU, directorios privados y ACL de Windows. No se debilitaron sus barreras.
- Cobertura de código nuevo y dependencias moderadas/bajas requieren revisión posterior. No se alteraron métricas, umbrales ni exclusiones.
- Estado Git: rama conservada; cambios locales pendientes de revisión, sin commit, push, PR ni eliminaciones de archivos del proyecto. Los informes temporales de los runners permanecen ignorados por Git.

# Etapa 2.5 — Investigación del HTTP 503 concurrente

## Estado y causa confirmada

**Resuelto el defecto de concurrencia reproducido en la validación de sesiones Redis.** No se inició la etapa 3 de cobertura. Queda pendiente un fallo independiente de arranque del fixture MySQL descrito más abajo; no se presenta la regresión real completa como aprobada.

La prueba original es `tests/database/catalog.mysql.test.js`, caso `reuses one category link across concurrent assignment, removal and reactivation`, aserción original de línea 121. Ejecuta dos `POST /api/products/{id}/categories` simultáneos con el mismo vendedor y el mismo Bearer/sid, esperando [204,204]. El flujo es autorización RS256, lectura de cuenta, validación Redis con touch y luego controlador/servicio de catálogo.

La asociación utiliza `catalog.changeCategory` y `mutateProduct`: bloquea cuenta y perfil del vendedor, producto, categoría y vínculo; la auditoría está en la misma transacción SQL. `catalogError` traduce deadlocks a 409. La operación no llama a la comprobación de precisión de precios que puede generar otro 503. El 503 reproducido ocurre antes de entrar al servicio de catálogo, dentro de `auth-session.service.js::active`.

`WATCH` detecta cambios al ejecutar `EXEC`, pero **no ofrece un snapshot para varios GET**. Se confirmó esta intercalación:

1. A hace WATCH de sesión y marcador de actividad y lee la sesión con revisión R0.
2. B actualiza válidamente la misma sesión y su marcador a R1 mediante su EXEC atómico.
3. A lee el marcador R1, que no coincide con la revisión R0 que había leído anteriormente.
4. El código anterior llamaba directamente a `corrupt()` y generaba `SESSION_STORE_UNAVAILABLE`, HTTP 503. Nunca llegaba al EXEC que habría detectado el cambio concurrente y permitido el reintento.

Tres pruebas deterministas, con RedisDouble e intercalación inyectada exactamente entre lecturas, fallaron con el código anterior para read, touch y rotate. Una prueba HTTP del endpoint real, con SQL simulado, devolvió **503 en lugar de 204 antes de corregirlo**. Esto confirma un defecto real del código y su ruta HTTP. El incidente histórico no tenía esta telemetría: no se puede probar retrospectivamente que fuera su única causa, pero se ha reproducido el mismo síntoma en el mismo flujo sin necesitar MySQL ni carga externa.

No se confirmó un deadlock MySQL, timeout de comandos ni agotamiento de reintentos como causa del 503 reproducido. La condición defectuosa ya existía antes de la limpieza de Sonar; no era un cambio de la etapa 2.

## Corrección mínima y garantías

Único cambio de producción: en la rama `alive !== s.revision` se ejecuta primero `await tx.commit()` **sin comandos de escritura**, y solo después se declara corrupción.

- Si otro proceso modificó las claves observadas, Redis aborta el EXEC; el bucle ya existente reintenta la transacción con lecturas nuevas, hasta el mismo máximo de cuatro intentos.
- Si el estado observado es estable y las revisiones siguen siendo incompatibles, se mantiene `SESSION_STORE_UNAVAILABLE`/503. No se repara, extiende ni reactiva esa sesión.
- El EXEC sigue comprobando identidad y fence. Desconexiones, resultados inciertos, cambios de topología o identidad siguen fallando de forma segura.
- Una revocación entre las lecturas y el reintento sigue impidiendo autorización.
- No cambian ACL, comandos permitidos, reloj Redis, TTL de 30 minutos, máximo absoluto de ocho horas, rotación/reutilización, límites de pool, timeouts de conexión/comandos ni contratos HTTP. No se añadió Lua ni un fallback.
- No cambian RS256, JWT, Gmail/OAuth, permisos SQL, esquema, reglas de propiedad, bloqueos o transacciones MySQL.

La confirmación de lectura usa los comandos ya autorizados; no requiere habilitar MGET ni modificar permisos del Redis habitual.

## Diagnóstico y reproducción controlada

Se añadió `tests/support/redis-diagnostics.js`, que envuelve exclusivamente el pool del fixture y acumula contadores, latencias y categorías de error permitidas. No conserva argumentos, claves, valores, contraseñas, JWT, hashes, usuarios o identificadores de sesión. El servicio de producción no importa este helper. `tests/support/isolated-auth.js` permite inyectar ese pool de pruebas.

El diagnóstico se construye **después de jest.resetModules()**. Un primer intento lo había construido antes: las dos instancias del módulo redis tenían constructores WatchError diferentes y la instrumentación provocó un fencing artificial del pool. Se corrigió la carga del fixture, sin debilitar el instanceof ni la clasificación de conflictos del código de producción. Esa traza inicial no se usa como prueba de la causa original.

El caso de catálogo acepta tres opciones de investigación, solo en pruebas:

- `CATALOG_CONCURRENCY_ROUNDS`: entre 1 y 500, por defecto 1.
- `CATALOG_TORN_READ_INJECTION=1`: una petición anidada actualiza la sesión justo antes de leer su marcador, forzando la carrera en Redis/MySQL reales.
- `STAGE5_CATALOG_ONLY=1`: el runner conserva su preparación y validaciones de aislamiento, pero selecciona únicamente la suite de catálogo para el experimento. Sin la opción, continúa ejecutando las tres suites originales.

El presupuesto del caso de estrés es 5.000 ms más 100 ms por ronda adicional, porque ejecuta N lotes HTTP completos; el caso normal conserva 5.000 ms. No se aumenta el timeout de ninguna petición, comando Redis ni adquisición del pool. No se reintentan HTTP fallidos desde el test y no se aceptan respuestas distintas de 204 como éxito.

Reproducción de las tres repeticiones realizadas, desde PowerShell en la raíz:

```powershell
$env:CATALOG_CONCURRENCY_ROUNDS = '25'
$env:CATALOG_TORN_READ_INJECTION = '1'
$env:STAGE5_CATALOG_ONLY = '1'
for ($run = 1; $run -le 3; $run++) {
    node scripts/database/stage5-addresses-test.js
    if ($LASTEXITCODE -ne 0) { throw "Falló la repetición aislada $run" }
}
Remove-Item Env:CATALOG_CONCURRENCY_ROUNDS, Env:CATALOG_TORN_READ_INJECTION, Env:STAGE5_CATALOG_ONLY
```

El runner usa MySQL nuevo con tmpfs, puerto de prueba, credenciales aleatorias e identidad comprobada antes de escribir; Redis también es temporal. No se ejecuta ninguna de estas operaciones contra los servidores habituales.

## Evidencia y resultados

| Comprobación | Resultado real |
| --- | --- |
| Unitarias deterministas antes del cambio | Tres rechazos `SESSION_STORE_UNAVAILABLE` al intercalar touch entre GET de sesión y GET de marcador; el caso de corrupción estable sí rechazaba correctamente. |
| HTTP determinista antes del cambio | Endpoint de asignación devuelve 503 en la intercalación forzada. |
| Sesiones/Redis/HTTP dirigidas después del cambio | **86 aprobadas** en tres suites. |
| Repeticiones reales 1, 2 y 3 | **20 pruebas de catálogo aprobadas por repetición**, ambas variantes del esquema en cada una. |
| Trabajo concurrente real total | 150 pares simultáneos más seis peticiones anidadas: **306 asignaciones correctas**, 306 entradas al servicio, sin errores SQL registrados. |
| Abortos Redis observados en esas seis variantes | **152 WatchError confirmados**, recuperados dentro del límite existente; no son 152 respuestas HTTP fallidas. |
| Redis temporal, runner completo | **6 grupos aprobados; cleanup=true**: rotación, reutilización, concurrencia, vencimientos, revocación y fencing. |
| Regresión Node 20/Linux | Build de verificación aprobado: **559 pruebas aprobadas, 45 omitidas, 47 suites aprobadas, 7 omitidas**. Incluye los cambios de seguridad/fiabilidad anteriores y ocho casos nuevos de esta investigación. |
| Audit/Swagger/documentación del build existente | Aprobados. Audit mantiene 19 moderadas y 4 bajas, sin altas ni críticas. No se trabajó en métricas u objetivos de cobertura; el build conserva sus comandos previos. |
| Regresión HTTP/MySQL completa en Windows | **No aprobada**: 25 pruebas pasan y siete fallan porque el beforeAll de accounts.mysql.test.js supera 5.000 ms. Catálogo y seguridad de cuentas pasan. |

Las ocho pruebas nuevas cubren read/touch/rotate con lectura intercalada, corrupción estable sin reparación, revocación durante confirmación, fallo durante EXEC de confirmación y dos casos HTTP (carrera válida y corrupción real). La corrupción estable conserva 503 y el controlador no se ejecuta. Las pruebas previas de EXEC parcial, respuesta perdida y reutilización siguen incluidas y aprobadas en la regresión.

Antes de la corrección se ejecutaron también 100 rondas naturales en ambas variantes: no reprodujeron el 503 una vez corregido el orden de carga del diagnóstico. Esto confirma su intermitencia, no su inexistencia; la inyección determinista fue necesaria para demostrar la carrera.

## Incidencia independiente del fixture y limpieza

El timeout de 5.000 ms en el beforeAll de `tests/database/accounts.mysql.test.js` se observó **también antes de cambiar producción**. Afecta al arranque de infraestructura/carga de módulos del fixture y bloquea siete casos; no es una respuesta HTTP 503 del catálogo. No se ha perfilado su causa exacta y no se amplió el timeout para ocultarlo. Debe investigarse por separado antes de declarar toda la integración real verde.

Uno de esos intentos dejó un Redis de prueba abierto porque la preparación terminó después de que Jest cancelara el hook; el proceso hijo terminó agotando su límite. Se identificó únicamente ese contenedor por ID completo, etiqueta de ejecución y nombre `secure-ecommerce-redis-test-*`, y se verificaron imagen, tmpfs, puerto y propiedad con la barrera existente antes de limpiarlo. No se borraron volúmenes ni recursos habituales. Las tres repeticiones finales limpiaron sus instancias. La comprobación Docker de solo lectura posterior no encontró Redis temporales ni el contenedor MySQL del runner pendientes.

## Archivos de esta etapa y pendientes

Solo producción: `services/auth-session.service.js`, condición de revisión y comentario explicativo.

Infraestructura/pruebas: `tests/support/redis-diagnostics.js` (nuevo), `tests/support/isolated-auth.js`, `tests/database/catalog.mysql.test.js`, `scripts/database/stage5-addresses-test.js`, `tests/unit/auth-session.service.test.js`, `tests/integration/session-auth.routes.test.js` y este informe. Se conservan todos los cambios anteriores en `fix/sonar-quality-gate`, sin commit ni push.

El defecto de validación concurrente está corregido y sus garantías de rechazo están probadas. Quedan pendientes el arranque/cancelación del fixture de cuentas y la ejecución de las suites históricas que requieren otros descriptores de instancia; las omisiones de la regresión no se presentan como aprobadas. Tampoco se afirma que haya desaparecido todo 503 legítimo de infraestructura ni se atribuye retrospectivamente cada incidente histórico sin traza a una única causa.

Verificación final: `git diff --check` sale 0; el escaneo de patrones de secretos sobre texto añadido y archivos nuevos devuelve 0 coincidencias sin imprimir valores. Esto no sustituye una revisión humana ni garantiza detectar todos los secretos posibles. Se conserva la rama `fix/sonar-quality-gate` y no se hicieron commits, push, PR ni cambios en servicios habituales.

# Etapa 2.6 — Timeouts del fixture MySQL de cuentas

## Evidencia previa al ajuste del límite

Se mantuvo inicialmente el límite original de 5.000 ms y se midieron fases mediante performance.now, sin registrar configuración, claves, identidades, credenciales ni respuestas HTTP. Se realizaron dos ejecuciones focalizadas nuevas, con MySQL/Redis descartables y el mismo límite:

| Fase (ms) | Ejecución 1: falla | Ejecución 2: aprueba |
| --- | ---: | ---: |
| Conexión MySQL ya aprovisionado | 25 | 29 |
| Consulta de identidad MySQL | 4 | 5 |
| Carga de aplicación/módulos | 2.303 | 2.150 |
| Preparación de instancia Redis (dentro de isolated-auth) | 2.304 | 2.134 |
| Generación RSA efímera (dentro de isolated-auth) | 366 | 66 |
| Conexión y comprobaciones Redis (dentro de isolated-auth) | 49 | 61 |
| isolated-auth total | 2.754 | 2.264 |
| Importación posterior del mailer | 0 | 0 |
| beforeAll completo | **5.094** | **4.457** |

Las fases internas Redis/RSA no se suman otra vez al total isolated-auth. La primera ejecución reprodujo exactamente los siete errores `Exceeded timeout of 5000 ms for a hook`. Los cuerpos de esas pruebas no llegaron a ejecutarse; no se atribuye a cada cuerpo una duración ficticia de cinco segundos. En la segunda, las siete pruebas aprobaron, con cuerpos entre 149 y 1.304 ms.

**Causa confirmada:** presupuesto por defecto insuficiente para un único beforeAll que combina conexión/identidad MySQL, carga de aplicación, arranque/aprovisionamiento de otro contenedor Redis, generación RSA y conexión autenticada. MySQL estaba listo y sus dos operaciones consumieron 29–34 ms; no se encontró una espera SQL, deadlock ni aprovisionamiento MySQL tardío dentro del hook. La variabilidad de Redis/CPU hace cruzar el umbral de cinco segundos. No se ha identificado una regresión de negocio que explique este timeout; el límite heredado no contempla el fixture integrado actual.

**Decisión documentada antes de cambiar el límite:** asignar 30.000 ms exclusivamente a la preparación y limpieza de esta infraestructura, coherente con el beforeAll de catálogo que prepara el mismo tipo de fixture (30.000 ms; la suite de seguridad de cuentas ya usa 60.000 ms). El límite de 5.000 ms de cada prueba de negocio permanece intacto. No se cambian timeouts de MySQL/Redis/HTTP, límites de pool, reintentos ni barreras de identidad. No se introduce un reintento de las pruebas fallidas.

Además, se detectó un defecto real de ciclo de vida: Jest no cancela la promesa al agotar beforeAll. Teardown debe esperar su terminación, incluso si el hook ha sido declarado fallido, antes de cerrar los handles. Así no puede publicarse un Redis tardío después de la limpieza. Se conserva propagación de errores y se cierra cada recurso aun si falla el cierre de otro. El presupuesto de limpieza cubre también esa espera y las operaciones Docker del fixture; no convierte una inicialización fallida en aprobada.

## Siete casos afectados y tiempos individuales

Todos pertenecen a `tests/database/accounts.mysql.test.js`, describe `Stage 3A isolated MySQL account workflows`, y comparten el único beforeAll. El error de los siete en la reproducción inicial fue exactamente **`Exceeded timeout of 5000 ms for a hook`**. No fueron siete consultas lentas: el setup falló una vez y Jest marcó fallidos los siete casos sin ejecutar sus cuerpos. Sus tiempos de cuerpo en esa ejecución son, por tanto, **no ejecutado**, no 5.000 ms cada uno.

Tiempos de cuerpo posteriores al ajuste, reportados por Jest en milisegundos:

| Nombre exacto del caso | Completa 1 | Completa 2 | Completa 3 |
| --- | ---: | ---: | ---: |
| creates one verified exclusive profile under concurrent verification without a role column | 305 | 312 | 471 |
| uses the database unique key to protect concurrent account creation across requests | 276 | 286 | 460 |
| rolls back the SQL user insert if profile creation fails and allows retrying the code | 532 | 524 | 812 |
| rechecks suspension and verification before reusing a JWT | 1328 | 1337 | 1898 |
| serializes seller reviews, audits the decision and gates commerce on current approval | 814 | 815 | 1211 |
| stores the rejection reason and denies commerce to a rejected seller | 724 | 734 | 1047 |
| reads only public audit columns for ADMIN and retains immutable SQL permissions | 139 | 158 | 188 |

Se mantiene el límite original de 5.000 ms para cada uno de estos cuerpos. No se eliminaron aserciones ni se marcaron fallos como omitidos.

## Corrección aplicada y pruebas del ciclo de vida

- `tests/database/accounts.mysql.test.js`: beforeAll y afterAll explícitos de 30.000 ms solo para infraestructura, tras documentar la evidencia; comprobación de identidad intacta antes de importar la aplicación y operar sobre datos; cierre de Redis, Sequelize y conexión MySQL mediante finally encadenados.
- `tests/support/fixture-lifecycle.js` (nuevo): retiene la promesa de preparación y la espera antes de limpiar; impide iniciar tras comenzar el cierre. Si preparación y limpieza fallan, conserva ambos errores en AggregateError. Ningún fallo se convierte en éxito.
- `tests/support/isolated-auth.js`: callback de métricas opcional del fixture, con fases estáticas y tiempos; no cambia claves, algoritmo, autenticación, conexiones, derechos ni sesiones de producción.
- `tests/support/setup-timing-reporter.cjs` (nuevo): reporter opcional que emite únicamente nombre/estado/duración de los casos y clasificación de timeout, sin copiar failureMessages ni configuración. Su habilitación no modifica las aserciones ni el resultado de Jest.
- `scripts/database/stage5-addresses-test.js`: opción `STAGE5_ACCOUNTS_ONLY=1` para investigación focalizada y reporter activado solo por `STAGE3A_TIMINGS=1`. Se rechaza combinar selección focalizada de cuentas y catálogo. Sin esas opciones sigue ejecutándose la regresión de tres suites.
- `tests/unit/fixture-lifecycle.test.js` (cuatro casos nuevos): recurso tardío, preparación fallida, limpieza fallida y conservación de ambos errores.
- `tests/unit/setup-timing-reporter.test.js` (tres casos nuevos): clasificación de deadlines de 5/30 segundos sin datos de errores, y reporter desactivado.
- Este informe. **Ningún módulo de producción fue modificado en la etapa 2.6.** Se conservan todos los cambios de las etapas anteriores.

## Ejecuciones repetidas y regresión

| Ejecución | beforeAll cuentas (ms) | Cuentas | Regresión MySQL completa | Tiempo Jest de tres suites |
| --- | ---: | --- | --- | --- |
| Diagnóstico original 1, deadline 5.000 ms | 5094 | 7 fallidas por hook | No solicitada, ejecución focalizada | No aplica |
| Diagnóstico original 2, deadline 5.000 ms | 4457 | 7 aprobadas | No solicitada, ejecución focalizada | No aplica |
| Corregida 1, deadline de setup 30.000 ms | 3797 | 7 aprobadas | **32 aprobadas, 0 fallidas, 0 omitidas** | 38.541 s |
| Corregida 2, mismo deadline | 3401 | 7 aprobadas | **32 aprobadas, 0 fallidas, 0 omitidas** | 37.203 s |
| Corregida 3, mismo deadline | 3883 | 7 aprobadas | **32 aprobadas, 0 fallidas, 0 omitidas** | 45.427 s |

Las tres ejecuciones completas fueron secuenciales, sin reintentos de fallos; el bucle habría terminado con la primera salida distinta de cero. Total posterior: **96 pruebas MySQL reales aprobadas**, además de las comprobaciones HTTP del runner padre. No se atribuye la menor duración de los setups posteriores a una optimización de MySQL: es variación observada del entorno, y la corrección evita depender de quedar justo por debajo de cinco segundos.

Comando utilizado para las tres regresiones completas, desde la raíz en PowerShell:

```powershell
$env:STAGE3A_TIMINGS = '1'
for ($run = 1; $run -le 3; $run++) {
    node scripts/database/stage5-addresses-test.js
    if ($LASTEXITCODE -ne 0) { throw "Falló la regresión aislada $run" }
}
Remove-Item Env:STAGE3A_TIMINGS
```

Para una investigación focalizada se añade `STAGE5_ACCOUNTS_ONLY=1`; debe retirarse para ejecutar las tres suites. No se requieren credenciales de la base habitual.

Pruebas dirigidas de ciclo de vida, reporter, sesiones y HTTP: **68 aprobadas en cinco suites**. Incluyen la corrección y las pruebas adversariales del HTTP 503 anterior.

Regresión general en Node 20/Linux mediante el Dockerfile de verificación existente: **566 aprobadas, 45 omitidas; 49 suites aprobadas, 7 omitidas; build y comandos con salida 0**. Las omisiones son suites condicionadas de recursos externos; no se reportan como ejecutadas por el build. Las tres regresiones MySQL reales se realizaron desde Node 24/Windows contra contenedores Linux temporales; la regresión general de Node 20/Linux es una comprobación separada. No se afirma haber ejecutado esas tres regresiones reales desde Node 20.

El build conservó sus comandos existentes de audit, pruebas, Swagger y documentación. Audit mantiene 19 moderadas/4 bajas sin altas ni críticas; no se actualizaron dependencias. No se alteraron exclusiones, Quality Gate ni objetivos de cobertura y no se inició la etapa 3.

## Recursos temporales y limpieza

Se crearon **cinco instancias MySQL tmpfs**, una por ejecución del runner (dos diagnósticos focalizados y tres regresiones completas), siempre con el nombre reservado del runner y su ID verificado, puerto de prueba e identidad distinta del servidor habitual antes de escribir. Cada ejecución las retiró en su finally.

Se generaron **19 fixtures Redis temporales**: cuatro en los dos diagnósticos y quince en las tres regresiones completas. Los 19 reportes de fixture de esta etapa confirman `cleanup=true`; ninguno registra limpieza fallida. Una consulta Docker de solo lectura al finalizar no encontró contenedores con la etiqueta Redis de prueba ni con el nombre del runner MySQL pendientes. La imagen local de verificación Node 20 se conserva como artefacto de build, sin desplegarla.

No se modificaron ni reiniciaron los contenedores habituales, volúmenes compartidos, bases, datos, permisos, claves, credenciales o sesiones. Los datos sintéticos, cuentas y permisos SQL de prueba existieron exclusivamente en los servidores temporales verificados.

## Estado y límites

**Resuelto el timeout de preparación reproducido**, con causa medida y corrección acotada al fixture. También se corrigió la carrera de teardown que podía dejar recursos creados tardíamente. No queda pendiente el bloqueo de las siete pruebas de cuentas en las ejecuciones comprobadas.

Si Docker o la infraestructura temporal dejan de responder, los deadlines y verificaciones continúan produciendo fallos: no hay garantía de éxito bajo cualquier carga ni recuperación insegura. Un proceso forzado a terminar o una operación Docker síncrona bloqueada siguen requiriendo inspección y limpieza de recursos cuya propiedad pueda verificarse; no se eliminan recursos ambiguos. Las suites históricas omitidas y los pendientes de Sonar/cobertura de etapas anteriores siguen separados de esta corrección.

Comprobaciones finales: `git diff --check` sale 0 y el escaneo de patrones de secretos del texto añadido/archivos nuevos registra 0 coincidencias sin imprimir valores. El escaneo no garantiza detectar todo secreto posible. Se conserva `fix/sonar-quality-gate`, con todos los cambios anteriores, sin commit, push ni PR.

# Etapa 3 — Cobertura y regresión de SonarCloud

Fecha: 2026-11-13. Rama conservada: `fix/sonar-quality-gate`. Se mantienen las correcciones anteriores de seguridad, fiabilidad, concurrencia y preparación de fixtures. Sin commits, push ni PR.

## Diagnóstico y alcance de la medición

Se revisaron `sonar-project.properties`, `.github/workflows/sonar.yml`, `.github/workflows/test.yml`, `package.json`, los runners y los LCOV. Jest utiliza su configuración implícita y `test:coverage` ejecuta `jest --coverage`. La cobertura global corresponde a los archivos instrumentados/cargados; no demuestra que todo archivo fuente esté cubierto.

Sonar recibe `coverage/lcov.info`, con `sonar.sources=.` y `sonar.test.inclusions=tests/**/*.test.js`. Los helpers de `tests/support` pueden quedar clasificados como fuente; se incluyeron en la estimación conservadora final. No se cambiaron exclusiones, métricas, umbrales, clasificación de archivos ni Quality Gate.

Comparación local contra `main` y `origin/main` conocidos: `497889f42f0ee83e70e8969e173d2fcb1c51c173`; HEAD conservado: `373195172096c5c4ceebe47ae19360a04f5f6adc`. No se hizo fetch: estas referencias no acreditan el estado remoto actual. La definición de código nuevo del proyecto/PR debe comprobarse en SonarCloud; depende de su configuración y del análisis del servidor ([documentación oficial](https://docs.sonarsource.com/sonarqube-cloud/standards/about-new-code)).

## Cobertura inicial y final

| Ejecución | Aprobadas / fallidas / omitidas | Líneas | Ramas | Sentencias | Funciones |
| --- | --- | ---: | ---: | ---: | ---: |
| Inicial, Node 24/Windows, Jest sin flags de recursos reales | 566 / 0 / 45 | 82,34 % (2364/2871) | 76,14 % (1724/2264) | 78,58 % | 81,25 % |
| Final, Node 20/Linux, build aislado sin esos flags | 666 / 0 / 45 | 83,43 % (2695/3230) | 82,15 % (1975/2404) | 80,34 % | 86,08 % |
| Final, Node 24/Windows, MySQL y Redis temporales habilitados | 668 / 0 / 43 | 90,51 % (3246/3586) | 85,44 % (2096/2453) | 87,96 % | 91,58 % |

El denominador aumenta al ejercitar más módulos. La tercera fila incluye cobertura del runner padre, pero no combina automáticamente LCOV de los procesos Jest hijos. No es correcto atribuir todo el aumento global exclusivamente a las pruebas nuevas ni comparar entornos como si fueran idénticos.

Se estimó el alcance de código nuevo intersectando líneas añadidas/modificadas de `git diff main --unified=0` y archivos JS/CJS nuevos con DA/BRDA de LCOV. Para fuentes sin LCOV se instrumentó estáticamente con Istanbul, sin ejecutar el código, asignando cero aciertos. Se normalizaron rutas Windows y `/workspace`. Los archivos de pruebas `*.test.js` no se cuentan como fuente; sí los helpers pertinentes. No hubo archivos de ese alcance que no pudieran analizarse.

| Aproximación de cambios, incluyendo helpers | Líneas cubiertas / elegibles | Resultados de ramas cubiertos / elegibles | Indicador combinado local |
| --- | ---: | ---: | ---: |
| Inicial reconstruida con los helpers existentes al comenzar | 200/303 | 162/223 | 68,82 % |
| Final Node 20/Linux | 290/328 | 235/259 | **89,44 %** |
| Final con runners reales habilitados en Windows | 296/328 | 243/259 | **91,82 %** |

El indicador local suma aciertos de líneas y resultados BRDA y divide por sus elegibles. **No es una reproducción exacta de la fórmula, alcance o atribución de SonarCloud**: la correspondencia de condiciones, clasificación de archivos, SCM y referencia de código nuevo puede diferir. La reconstrucción inicial excluye el helper `schema-metadata.js`, creado en esta etapa. Sin helpers, la aproximación final de Node 20 es 86,99 %; no se usó esa omisión para justificar el objetivo. El 68,7 % del Quality Gate anterior sigue siendo un resultado histórico del servidor, no una medición equivalente a esta aproximación. No se ejecutó un análisis nuevo de SonarCloud y no se declara aprobado su Quality Gate.

### Módulos priorizados

| Archivo | Inicial líneas / ramas | Final Node 20 líneas / ramas |
| --- | ---: | ---: |
| `services/orders.service.js` | 45,36 / 30,26 % | 100 / 94,73 % |
| `services/catalog.service.js` | 30,69 / 33,33 % | 98,01 / 93,49 % |
| `services/auth-session.service.js` | 98,16 / 91,15 % | 98,16 / 91,15 % |
| `services/auth-redis.service.js` | 97,47 / 90,17 % | 97,47 / 90,17 % |
| `postman/scripts/cleanup.js` | Sin LCOV inicial | 100 / 80 % |
| `postman/scripts/cleanup-paths.js` | 96,49 / 89,28 % | 100 / 96,42 % |
| `postman/scripts/isolation.js` | 46,35 / 50,31 % | 68,87 / 83,85 % |
| `postman/scripts/container-metadata.js` | Sin cobertura Jest inicial de sus casos CLI | 100 / 85,71 % |
| `scripts/database/stage4-verify.js` | Sin LCOV inicial | 25 / 62,85 % |
| `tests/support/redis-diagnostics.js` | Sin LCOV inicial | 100 / 100 % |

La cobertura baja global de `stage4-verify.js` sigue incluyendo operaciones administrativas no invocadas por estas unitarias; se verificó su comparación de esquema mediante dobles. No se ejecutó el script de etapa 4 sobre ninguna base habitual para aumentar porcentajes.

## Pruebas añadidas y archivos de esta etapa

Se incorporaron **100 casos al recuento de Jest: 84 casos nuevos y 16 casos existentes de metadatos reutilizados mediante un adaptador**, sin duplicar sus fixtures. No se presentan los 16 como escenarios inéditos.

| Archivo nuevo o ampliado | Casos incorporados | Comportamiento comprobado |
| --- | ---: | --- |
| `tests/unit/checkout-persistence.test.js` | 24 | Totales del servidor, inventario, snapshots, historial/auditoría en transacción, repetición idempotente y colisiones, dirección/precio/stock/vendedor inválidos, fallos parciales, propiedad y transiciones por perfil |
| `tests/unit/catalog-business.test.js` | 12 | Aprobación/propiedad, precios, CRUD y auditoría transaccional, categorías protegidas, asociaciones/restauración y validaciones Unicode, bytes, enteros y asignación masiva |
| `tests/unit/postman-cleanup.test.js` | 13 | Rechazo de runId/PID incorrectos, procesos vivos, propiedad ambigua, errores de eliminación y preservación de artefactos |
| `tests/unit/container-metadata.test.js` | 16 reutilizados | Adaptador de los casos existentes de `container-metadata.check.cjs` para instrumentarlos también en Jest |
| `tests/unit/schema-verification.test.js` | 9 | Metadatos definitivos, tablas extra, DECIMAL/JSON, FK, unicidad de checkout, CHECK y prohibición de datos existentes |
| `tests/unit/docker-command-barriers.test.js` | 10 | Argumentos Docker de Redis, nombres/volúmenes/puertos manipulados, operaciones permitidas y errores; spawn simulado |
| `tests/unit/build-context-safety.test.js` | 5 | Entornos públicos permitidos y rechazo previo al build de `.env`, secretos y reportes privados, con/sin prefijo `./` |
| `tests/unit/postman-provisioning.test.js` | 2 | Word ausente o hash incorrecto: únicamente SELECT de identidad, ninguna escritura SQL |
| `tests/unit/redis-diagnostics.test.js` | 6 | Comandos nativos, conflictos WATCH, errores de topología/timeout/resultado incierto propagados, eventos del pool y métricas sin claves ni valores |
| `tests/unit/sonar-security.test.js` | 3 | Errores de permisos al inspeccionar archivos/directorios y limpieza segura de un workspace vacío |

También se añadió `tests/support/schema-metadata.js`: construye metadatos de prueba desde el snapshot DDL existente `tests/support/final-schema.json`. No sustituye al Word ni demuestra por sí mismo la equivalencia documental del esquema.

Las primeras ejecuciones descubrieron dos huecos en la defensa final del archivo de verificación: `.secrets/private.key` sin `./` y `./postman/reports/private.json` no se rechazaban en esa comprobación. Se corrigió **solo `scripts/database/verify-node20.js`**, normalizando el prefijo y añadiendo los directorios privados de Postman a la barrera final. Las exclusiones previas de tar ya pretendían impedir su inclusión; no se afirma que hubiera una filtración real. Las pruebas adversariales fallaron antes y aprobaron después. No se cambió código funcional de autenticación, catálogo, checkout, contratos HTTP o esquema.

En `.github/workflows/test.yml` y `sonar.yml` se habilitó `RUN_STAGE2_REDIS: '1'` junto a `RUN_STAGE5_MYSQL`, aprovechando el pull de Redis 8.2 y el runner aislado existentes. Ambos YAML se analizaron correctamente. No se modificó `docs.yml`, no se trabajó con PlantUML y no se cambiaron dependencias.

## Omisiones del proceso principal y ejecución segura

Las 45 omisiones iniciales se clasificaron todas. Los flags de identidad se entregan solamente al hijo propietario de cada fixture; no se propagaron credenciales a suites ajenas.

| Suite condicionada | Casos inicialmente omitidos | Ejecución realizada en esta etapa |
| --- | ---: | --- |
| `tests/database/accounts.mysql.test.js` | 7 | Runner `stage5-addresses-test.js`, MySQL temporal y Redis temporal |
| `tests/database/catalog.mysql.test.js` | 20 | Mismo runner, variantes con los permisos SQL previstos |
| `tests/database/account-session-security.mysql.test.js` | 5 | Mismo runner, revocación de sesiones contra recursos temporales |
| `tests/database/schema.mysql.test.js` | 3 | `stage5-historical-tests.js`, MySQL temporal con identidad verificada |
| `tests/database/secure-ecommerce-transition.mysql.test.js` | 8 | Mismo runner histórico, migraciones/datos solo en su instancia descartable |
| `tests/database/auth-sessions.redis.test.js` | 1 | `RUN_STAGE2_REDIS=1`; seis grupos reales de creación/rotación/reutilización/concurrencia/revocación/vencimiento/recuperación |
| `tests/database/final-backend.mysql.test.js` | 1 | `RUN_STAGE5_MYSQL=1`; dispara la regresión HTTP/MySQL aislada |

El proceso principal final tiene **668 aprobadas, 0 fallidas, 43 omitidas; 60 suites aprobadas y 5 omitidas**. Las primeras cinco filas anteriores se ejecutan separadamente como **32/32** casos MySQL/HTTP del runner principal y **11/11** históricos. No se suman otra vez al contador padre ni se afirma que las 43 omisiones se conviertan en aciertos dentro de su LCOV. Sus escenarios sí se ejecutaron en hijos aislados. No quedan suites históricas sin ejecutar por falta de la configuración de prueba.

Comandos finales relevantes:

```powershell
$env:RUN_STAGE5_MYSQL = '1'
$env:RUN_STAGE2_REDIS = '1'
node node_modules/jest/bin/jest.js --coverage --runInBand --json --outputFile=log/sonar-coverage/final-jest.json
# En procesos separados, sin esos flags globales:
node scripts/database/stage5-historical-tests.js
node --test postman/scripts/isolation.check.cjs postman/scripts/container-metadata.check.cjs
node swagger.js
```

La última regresión real duró 133,897 segundos y devolvió código 0; su JSON confirma `success=true`, cero pruebas/suites fallidas. Los runners hijos aprobaron sus 32 casos, sin acceso a los servidores habituales. El runner histórico aprobó 3+8 casos. Las comprobaciones CLI de aislamiento/metadatos aprobaron **38/38**. Las pruebas anteriores de seguridad, fiabilidad y concurrencia permanecen incluidas en la regresión.

El build de verificación Node 20/Linux terminó correctamente: **666 aprobadas, 0 fallidas, 45 omitidas; 58 suites aprobadas, 7 omitidas**. Utilizó el Dockerfile existente, `npm ci --ignore-scripts`, audit, cobertura, Swagger y construcción documental existentes. La imagen local `secure-ecommerce-sonar-node20:local` es un artefacto de verificación, no un despliegue. Las integraciones reales de esta etapa se ejecutaron desde Node 24/Windows contra MySQL/Redis Linux temporales; no se afirma haber ejecutado esas integraciones reales desde Node 20/Linux. La verificación del workflow completo en GitHub sigue pendiente de su ejecución remota.

## Postman: bloqueo real, no aprobación

Se intentó `node postman/scripts/run.js`, ejecución `45e0109d-7d17-4f0b-9ea8-c68dbf12ddc5`. Falló de forma segura en preparación, antes de crear el esquema, iniciar la API o ejecutar peticiones de negocio/Newman: falta `docs/Propuesta_BD_Secure_Ecommerce_14_tablas.docx` (`ENOENT`). El usuario confirmó que **no hay Word disponible**.

Su resumen registra `success=false`, `failure.stage=provisioning`, `cleanup=true` y `habitualContainerMetadataUnchanged=true`. No se presentan las 38 comprobaciones de barreras como una ejecución exitosa de la colección HTTP completa. Los dos nuevos casos de preparación comprueban expresamente que documento ausente/hash incorrecto impiden escribir SQL.

**Pendiente de decisión:** establecer una referencia canónica versionada para el esquema y revisar el contrato del runner antes de sustituir su comprobación documental. No se eliminó la verificación de hash, no se fabricó un Word y no se cambió silenciosamente a otro esquema. Después de esa decisión debe ejecutarse la colección completa desde cero; por ello esta etapa no se declara totalmente cerrada.

## Verificaciones restantes, artefactos y limpieza

- Swagger se generó correctamente (`node swagger.js`); la primera ejecución restringida no podía escribir el archivo generado y se repitió con acceso local autorizado. No fue necesario cambiar rutas ni contratos.
- `npm audit --audit-level=high`, ejecutado en el build Node 20, terminó con código 0: **0 altas/críticas, 19 moderadas y 4 bajas**. No se actualizaron paquetes ni se aplicaron exclusiones.
- `git diff --check` terminó con código 0. El escaneo de patrones de claves privadas, tokens GitHub/Google/AWS y JWT en los 51 archivos cambiados/nuevos revisados produjo cero archivos coincidentes, sin imprimir valores. Es una comprobación limitada, no garantía de ausencia de cualquier secreto.
- Los LCOV/JSON y logs de diagnóstico se conservan únicamente en `coverage/` y `log/sonar-coverage/`, ignorados por Git. El reporte fallido de Postman permanece en `postman/reports/`, también ignorado. No se versionan esos artefactos.
- Se utilizaron MySQL tmpfs de los runners de backend, histórico y Postman; credenciales aleatorias, puertos de prueba e identidad verificada antes de escribir. Los runners retiraron sus recursos propios. Los **18 reportes Redis temporales** generados en las regresiones de esta etapa confirman todos `cleanup=true`. Ninguno indica limpieza fallida.
- Los dos contenedores usados para extraer LCOV de la imagen Node 20 se crearon sin red ni mounts, no se iniciaron y se eliminaron tras comprobar nombre, ID, etiqueta e imagen. No son servicios desplegados.
- La inspección Docker final de solo lectura no encontró contenedores pendientes de Redis de prueba, Postman, exportación de cobertura, `secure-ecommerce-stage5-addresses` ni `secure-ecommerce-stage25`. La imagen local de verificación se conserva deliberadamente.
- Gmail y Cloudinary se simularon en las pruebas pertinentes; no se enviaron correos ni archivos a proveedores reales. No se modificaron MySQL/Redis habituales, sus datos, sesiones, permisos, credenciales o contenedores.

## Resultado y pendientes del Quality Gate

Se mejoró la cobertura de código crítico con pruebas de negocio y fallos verificables; el indicador local de cambios de Node 20 tiene un margen estimado de 89,44 %. Permanecen sin cubrir algunos scripts operativos; no se ejecutaron sobre recursos habituales para aumentar métricas ni se excluyeron del análisis.

Pendientes reales: resolver el contrato documental ausente del runner Postman con una decisión explícita, ejecutar después la colección HTTP completa, ejecutar los workflows y un análisis nuevo de SonarCloud, y comprobar su definición de código nuevo y Quality Gate real. La revisión manual de los posibles falsos positivos de etapas anteriores sigue correspondiendo al equipo en SonarCloud. **No se declara aprobado el Quality Gate ni terminada toda la etapa 3.**

# Etapa 4 — Auditoría local antes de publicar

Fecha: 2026-11-13. Solo se actualiza este informe en esta etapa; no se modifica código, workflows, dependencias, referencias Git ni servicios habituales. No se realizan commit, push, PR, fetch o cambios de rama.

## Inventario exacto propuesto para el siguiente commit

`git status --short`, `git diff --stat`, `git diff --numstat`, `git diff --name-status` y `git diff --check`: **32 archivos modificados, 19 nuevos, ninguno eliminado y ningún archivo staged**. Se revisaron los cambios y archivos nuevos; corresponden a fiabilidad Sonar, concurrencia Redis, ciclo de vida/diagnóstico de fixtures, cobertura y su documentación. No hay cambios pendientes en modelos, migraciones, Compose, credenciales, configuración funcional de proveedores, `sonar-project.properties` o archivos de dependencias.

Archivos modificados que se incluirían, relativos a la raíz:

```text
.github/workflows/sonar.yml
.github/workflows/test.yml
docs/security/sonar-security-review.md
postman/scripts/api-server.js
postman/scripts/container-metadata.check.cjs
postman/scripts/container-metadata.js
postman/scripts/isolation.check.cjs
postman/scripts/isolation.js
scripts/database/activate-final.js
scripts/database/stage2-redis-test.js
scripts/database/stage4-verify.js
scripts/database/stage4.js
scripts/database/stage5-addresses-test.js
scripts/database/verify-node20.js
services/audit.service.js
services/auth-redis.service.js
services/auth-session.service.js
services/cloudinary.service.js
services/database.service.js
services/orders.service.js
services/password-policy.service.js
services/redis-tls-config.service.js
tests/database/accounts.mysql.test.js
tests/database/catalog.mysql.test.js
tests/integration/session-auth.routes.test.js
tests/support/isolated-auth.js
tests/support/security-checks.js
tests/unit/auth-session.service.test.js
tests/unit/cloudinary.service.test.js
tests/unit/redis-isolation.test.js
tests/unit/secure-config-file.test.js
tests/unit/sonar-security.test.js
```

Archivos nuevos que se incluirían:

```text
postman/scripts/redis-test-metadata.js
services/canonical-order.js
tests/support/fixture-lifecycle.js
tests/support/redis-diagnostics.js
tests/support/schema-metadata.js
tests/support/setup-timing-reporter.cjs
tests/unit/build-context-safety.test.js
tests/unit/catalog-business.test.js
tests/unit/checkout-persistence.test.js
tests/unit/container-metadata.test.js
tests/unit/docker-command-barriers.test.js
tests/unit/fixture-lifecycle.test.js
tests/unit/isolated-auth-lifecycle.test.js
tests/unit/postman-cleanup.test.js
tests/unit/postman-provisioning.test.js
tests/unit/redis-diagnostics.test.js
tests/unit/schema-verification.test.js
tests/unit/setup-timing-reporter.test.js
tests/unit/sonar-reliability.test.js
```

`main` remoto se consultó con `git ls-remote` y sigue en `497889f42f0ee83e70e8969e173d2fcb1c51c173`. La rama local está un commit por delante, sin divergencia: **ya existía** `3731951 fix(security): harden Docker builds and Postman isolation`. Ese commit conserva las correcciones previas de Docker/Postman, el hash ficticio de login y el ajuste del ejemplo Swagger; no se creó en esta auditoría. No existe todavía una rama remota `fix/sonar-quality-gate`. El futuro PR incluiría ese commit previo más los cambios locales autorizados después; no debe confundirse el diff contra HEAD con el diff completo contra main.

## Exclusiones y protección de datos

Se revisaron `.gitignore`, `.dockerignore`, los Dockerfiles y las listas de Git. `.env`, `.env.secure-ecommerce.local`, `.secrets/`, claves, credenciales de Gmail/Redis/RSA, `coverage/`, `log/sonar-coverage/` y reportes privados de `postman/reports/` permanecen fuera del conjunto propuesto. `git check-ignore` confirmó los casos representativos. Los únicos entornos versionados encontrados son ejemplos públicos. `bd.sql` contiene únicamente el bootstrap histórico vacío, sin registros ni cuentas; no cambió y no requiere añadirse al nuevo commit. Los `.gitkeep` de log/reportes son legítimos.

El escaneo local de **284 archivos de texto versionados o candidatos nuevos** no detectó patrones de claves privadas, tokens Google/GitHub/AWS ni JWT completos. Se imprimieron solo conteos y nombres de archivos, sin valores. Tampoco se encontraron rutas de secretos/reportes generados entre los 51 candidatos. No se certifica ausencia absoluta de secretos con un escaneo de patrones ni se auditó todo el historial de blobs buscando credenciales.

`git diff --check` termina en 0; los avisos LF/CRLF son informativos. `node --check` aprobó todos los JS/CJS cambiados/nuevos sin ejecutarlos. Se conservan el orden UTF-16 de comparaciones/identificadores/bloqueos, el fallo cerrado de sesiones corruptas, los límites de reintentos, las barreras de Docker y el esquema de 14 tablas. No hay cambios ajenos a las etapas revisadas en el conjunto pendiente.

## Workflows locales y publicados

Se consultaron de solo lectura la API pública de GitHub y los workflows de `main`, sin lanzar ejecuciones:

| Archivo publicado | Blob remoto | Comparación local |
| --- | --- | --- |
| `.github/workflows/test.yml` | `c0be72c4139dfcd4bd29855b81eb1d4fa9cfe09b` | Solo se añade `RUN_STAGE2_REDIS: '1'` |
| `.github/workflows/sonar.yml` | `76a9f7773f00b86d91990025d953b14e7d7061dc` | Solo se añade el mismo flag |
| `.github/workflows/docs.yml` | `3dc947b861c0624accbaed760e4216119af710b8` | Idéntico; sin modificaciones |

Los tres YAML son válidos. Test/Sonar mantienen Ubuntu, Node 20, instalación limpia, imágenes temporales y los runners históricos. Test mantiene `npm audit --audit-level=high`. Se provisiona Redis 8.2 antes de habilitar su suite; MySQL usa servidores tmpfs propios. No necesitan secretos de producción, servicios Compose ni el Word. No importan Newman para ejecutar su cobertura principal. Los helpers nuevos necesarios deben incluirse junto a los consumidores; omitirlos del commit sí rompería CI.

`sonar.javascript.lcov.reportPaths=coverage/lcov.info` permanece intacto. Jest genera ese archivo antes del scanner; los SF inspeccionados usan rutas relativas como `index.js`, compatibles con el checkout de CI. `fetch-depth: 0` sigue habilitado en Sonar. No se publica el LCOV local en Git: lo genera cada job. Los procesos hijos de integración no se presentan como cobertura fusionada.

Test y Sonar se disparan en PR hacia main/develop, push a main/develop o workflow_dispatch. **Un push aislado a fix/sonar-quality-gate no dispararía automáticamente esos dos workflows.** La publicación posterior deberá usar el mecanismo autorizado correspondiente; en esta etapa no se ejecuta ninguno.

La API registra éxitos recientes de main para [Test](https://github.com/maverick0322/Secure-Ecommerce-API/actions/runs/43392084653), [análisis Sonar](https://github.com/maverick0322/Secure-Ecommerce-API/actions/runs/43392084655) y [documentación](https://github.com/maverick0322/Secure-Ecommerce-API/actions/runs/43392084712). Son antecedentes del código publicado, no resultados de estos cambios locales. El YAML de Sonar no contiene una espera explícita del Quality Gate ni un paso separado para comprobarlo: un job de análisis verde no demuestra por sí mismo un Quality Gate aprobado. No se modificó ese contrato durante esta revisión.

Se reutilizó la evidencia final de etapa 3 porque desde entonces no cambió código ejecutable: Node 20/Linux 666/0/45; regresión con recursos temporales 668/0/43; hijos MySQL 32/32 e históricos 11/11; CLI de barreras 38/38. No se repitieron suites extensas innecesariamente. La ejecución combinada exacta Node 20/Linux + Docker real de GitHub para estos cambios sigue sin comprobarse remotamente; las pruebas reales locales anteriores fueron orquestadas desde Windows/Node 24. La compatibilidad esperada es favorable, sin garantía de éxito ante variaciones de carga/descargas/runner o configuración externa de Sonar.

Cobertura: Node 20/Linux 83,43 % de líneas y 82,15 % de ramas; con recursos reales habilitados 90,51 % y 85,44 %. Aproximación local del código nuevo de Node 20: **89,44 %**, con las limitaciones metodológicas ya descritas. No se declara aprobado el Quality Gate. La configuración actual del secreto Sonar, sus permisos y las condiciones vigentes del proyecto deben confirmarse mediante el análisis real; no se consultaron ni imprimieron secretos de GitHub.

## Word original y alcance del bloqueo Postman

No se encontró copia del Word en el workspace, en la búsqueda acotada bajo `C:/Proyectos/ProgramacionSegura`, ni en los nombres del historial Git disponible. También se consultaron los árboles completos, sin truncamiento, de las tres ramas remotas actuales: main `497889f`, feature/secure-ecommerce-db `607ab85` y refactor/backend-english-names `b6c51cd`; ninguno contiene archivos `.docx`. Esto no descarta copias fuera de esas ubicaciones o en historial remoto no disponible. El usuario confirmó que no hay Word.

No se fabricó documento ni SHA-256, no se cambió el contrato canónico y no se desactivó ninguna comprobación. La colección HTTP completa de Postman continúa bloqueada, como en etapa 3. **Ese pendiente no bloquea directamente test.yml o sonar.yml**, que ejecutan otros runners sobre el snapshot y las migraciones controlados. La prueba unitaria del Word ausente usa dobles y confirma el bloqueo antes de SQL de escritura. La equivalencia con el documento original no se vuelve a certificar en esta auditoría.

## Dependencias: backend frente a subproyecto Postman

Se repitió únicamente la consulta de auditoría, sin instalación ni cambios en lockfiles:

| Ámbito | Comando | Salida | Resultado actual |
| --- | --- | ---: | --- |
| Raíz/backend | `npm audit --audit-level=high` | 0 | 0 altas/críticas, 19 moderadas y 4 bajas |
| `postman/` | Mismo comando con su propio package-lock | 1 | **5 altas, 4 moderadas, 0 críticas** |

Los cinco paquetes clasificados altos por npm en Postman son `@faker-js/faker`, `newman`, `postman-collection`, `postman-runtime` y `postman-sandbox`; incluyen propagación del mismo advisory, no cinco vulnerabilidades independientes de ejecución de código. El advisory directo de Faker es [GHSA-qxc2-j82w-r537](https://github.com/advisories/GHSA-qxc2-j82w-r537). Las moderadas afectan `csv-parse`, `uuid` y sus dependientes `postman-request`/`serialised-error` ([CSV](https://github.com/advisories/GHSA-8cw4-87c7-c6xx), [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq)).

`postman/scripts/newman-runtime.js` deshabilita las dos funciones de plantillas Faker y rechaza generadores dinámicos para la colección controlada; las pruebas existentes comprueban ese bloqueo. **Es mitigación de alcance, no una dependencia parcheada ni una eliminación del advisory**, y no demuestra resolver los otros avisos. No deben ejecutarse colecciones, scripts o CSV no confiables con ese runtime. No se aplicó el downgrade mayor que npm propone como fix de Newman ni cambios de dependencias sin análisis.

Postman usa un proyecto separado, no un workspace instalado por el `npm ci` de la raíz. Su audit fallido no es el audit del backend ni bloquea actualmente esos workflows; si se incorpora `npm --prefix postman audit --audit-level=high`, ese paso fallaría. Estas dependencias quedan pendientes de un trabajo específico y se deben divulgar en el PR, sin ocultarlas.

## Dictamen y propuesta para revisión

**Preparado localmente para publicar los cambios acotados de Sonar y obtener una validación real de CI, sujeto a autorización del usuario.** No se detecta un bloqueo local de test.yml/sonar.yml; no equivale a asegurar su aprobación ni a declarar cerrada toda la integración/Postman. Se conserva la precondición de que los reportes de limpieza Postman sean privados al usuario local: Node no ofrece una protección portable completa contra carreras de sustitución de directorios por otro usuario con acceso de escritura.

Pendientes que no bloquean directamente esos dos workflows: contrato documental de Postman, audit de su subproyecto, revisión manual en Sonar de los posibles falsos positivos y verificación futura de proveedores reales. La ejecución de documentación completa se mantiene fuera de esta revisión; no se trabajó con PlantUML, ni se alteró o lanzó docs.yml. Su éxito remoto anterior no garantiza una publicación futura.

La inspección Docker final de solo lectura no encontró fixtures pendientes con los nombres/etiquetas de Redis, Postman, backend MySQL e histórico. No se crearon contenedores nuevos en esta auditoría ni se modificaron los habituales. Los cambios permanecen locales y sin staging.

Mensaje propuesto para el siguiente commit, **no ejecutado**:

```text
fix(quality): resolve Sonar reliability and strengthen regression coverage
```

Título propuesto de PR: `Corrige fiabilidad, concurrencia de sesiones y cobertura para SonarCloud`.

Descripción propuesta, **no publicada**:

```text
Corrige los hallazgos de fiabilidad de Sonar conservando el orden canónico, las validaciones y los contratos existentes. Evita el HTTP 503 espurio cuando dos peticiones actualizan la misma sesión Redis y asegura el cierre de fixtures cuya preparación tarda o falla. Conserva el endurecimiento previo de Docker y el aislamiento de Postman.

Añade pruebas de checkout, catálogo, errores de dependencias, limpieza e infraestructura. Habilita la suite Redis temporal en los jobs de test y cobertura, sin usar servicios habituales ni alterar el esquema MySQL.

Validación local: Node 20/Linux 666 aprobadas, 45 omitidas; con runners aislados 668 aprobadas, 43 omitidas; hijos MySQL 32/32 e históricos 11/11; barreras CLI 38/38. Las suites condicionadas se ejecutaron en los hijos propietarios correspondientes. Cobertura Node 20: líneas 83,43 %, ramas 82,15 %; aproximación local de cambios 89,44 %, pendiente de medición real SonarCloud. Audit del backend sin altas/críticas; diff y sintaxis correctos.

Pendientes divulgados: colección Postman bloqueada por ausencia del Word canónico y audit de su subproyecto con 5 paquetes altos y 4 moderados. No forman parte del audit ni del runner principal de CI. Los posibles falsos positivos requieren revisión manual. Este PR no afirma que el Quality Gate esté aprobado; requiere las ejecuciones remotas y la comprobación del gate.
```
