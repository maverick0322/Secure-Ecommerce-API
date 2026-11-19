# Imágenes Cloudinary — fase 3A: G09 y H01

Fecha: 17 de noviembre de 2026. Implementación y validación exclusivamente local.
No se accedió a Cloudinary real ni a la base habitual. El producto 4 y su recurso
no se leyeron, sustituyeron ni eliminaron. No hubo commits, sincronización o despliegue.

## Resultado y alcance

G09 y H01 se corrigieron para los escenarios y precondiciones probados. La
solución no ofrece limpieza autónoma de operaciones abandonadas ni certifica
alta disponibilidad multi-host. Ante incertidumbre conserva recursos y diarios.
H1, H2, H3 y H4 siguen pendientes de sus fases; sus pruebas de caracterización se
mantienen. No se avanzó a 3B.

## Causas raíz y elección

- **G09:** `active` era local y los 120 segundos se usaban como indicio de que
  otra operación había terminado. Un proceso podía retirar el recurso mientras
  otro aún esperaba confirmar SQL.
- **H01:** namespace y contexto compartidos, con referencias verificadas solo en
  la base actual, permitían retirar recursos usados por una base independiente.

Se descartaron ampliaciones de plazo, leases sin fencing, PID/lockfiles con
vencimiento y bloqueos de fila durante llamadas remotas. Se eligió un cierre
durable de la operación y pertenencia persistente ligada a la identidad real de
MySQL y al cloud configurado. No requiere dependencias, tablas o migraciones.
La justificación, invariantes y restricciones están en la
[guía operativa](../../docs/security/cloudinary-stage3a.md).

## Implementación

1. Diario v2: `pending` antes del upload y publicación atómica de `settled` solo
   después de abandonar cualquier futura escritura SQL de esa operación.
2. Ningún recuperador puede eliminar un recurso `pending` sin referencia por su
   antigüedad. Si el proceso cae, se conserva hasta revisión manual.
3. Las referencias, incluso borradas lógicamente, se comprueban con una
   transacción breve que espera commits inciertos. Se libera antes del proveedor
   y se comprueba de nuevo antes de destroy.
4. `.ownership.json` identifica el almacenamiento; su binding contiene un hash
   de UUID real MySQL, base y cloud name. Una copia incompatible o identidad
   parcial causa fallo cerrado 503, sin reemplazarla.
5. Los nuevos public_id y contexto contienen identidad/binding. Se exige
   coincidencia de diario, namespace y contexto antes de eliminar.
6. Identificadores anteriores y diarios sin pertenencia fiable se preservan;
   no hay migración ni reetiquetado de recursos. La generación de URL antigua
   permanece compatible.

## Pruebas de seguridad nuevas o actualizadas

Todos los escenarios usan modelos/proveedor simulados o MySQL/Redis descartables.
Los procesos G son procesos Node distintos con archivos temporales reales, sin
heredar credenciales de la aplicación. SQL y Cloudinary se sustituyen por IPC.
Los tiempos largos se adelantan; no se ejecuta carga sobre servicios reales.

| ID | Condición | Expectativa segura y resultado comprobado |
|---|---|---|
| G09 | Dos procesos; upload activo esperando SQL; otro reloj +180 s | No eliminar; después del commit la referencia apunta a un recurso existente. |
| G08 | Dos procesos dentro de gracia | Recurso activo conservado. |
| G11 | Dos procesos reemplazando simultáneamente | Una referencia final válida; solo su recurso permanece. |
| G01 | Proceso cae durante upload ya almacenado | Registro `pending` y recurso conservados, sin limpieza por edad. |
| G02 / D06 | Commit aplicado y confirmación perdida | Referencia confirmada protegida; no destroy. |
| G10 | Caída antes de confirmar update | Sin referencia; recurso incierto conservado para revisión. |
| G13 | Upload fallido con cierre durable; reinicio posterior | Nuevo proceso limpia huérfano propio y no referenciado después de gracia. |
| H01 | Dos bases independientes comparten recurso simulado | El segundo entorno puede retirar su referencia, pero conserva el recurso del primero. |
| S01 | Lecturas repetidas del mismo almacenamiento | Identidad estable e inmutable; public_id dentro de 255 caracteres. |
| S02 | Identidad copiada y UUID MySQL distinto | 503 antes del proveedor; archivo original sin cambios. |
| S03 | Cloud o nombre de base distinto | Identidad incompatible rechazada. |
| S04 | Identidad parcialmente escrita | No regenerar ni sobrescribir; fallo cerrado. |
| S05 | Dos directorios, misma base | Scopes distintos: ninguno adopta el namespace ajeno. |
| S06 | Nueva subida propia | Namespace y contexto completos y coherentes. |
| S07 / prueba SDK legacy | Referencia anterior al aislamiento | URL conserva identificador; retirada no consulta ni elimina recurso histórico. |
| S08 | Retirada de recurso anterior | Inspect y destroy se ejecutan con cero transacciones SQL abiertas en el doble instrumentado. |
| S09 | Upload en curso | Diario v2 sigue `pending` antes del resultado transaccional. |
| S10 | Falla publicación de cierre tras commit | Recurso referenciado protegido; el diario nunca autoriza borrado incierto. |
| S11 / C03 | Fallo de red, recurso creado, operación terminada; tiempo +1 año | Reconciliación segura del recurso propio sin referencia. |
| S12, cuatro variantes | Un campo del contexto contradice entorno/base/owner/producto | Todas conservan recurso, incluso con namespace local. |
| S13 | Diario anterior sin versión/scope | Archivado conservador; ninguna consulta/eliminación remota. |
| S14 | Identidad MySQL inválida | 503 antes de upload; referencia intacta. |
| S15 | Inicialización concurrente de identidad | Identidad persistente única; lectores de una carrera incompleta fallan cerrados. |
| S16 | Rollback y fallo al publicar cierre | Registro incierto y huérfano conservados incluso después de un año simulado. |
| E06–E11 | Histórico, contexto ajeno y referencias secundarias/soft-deleted | Continúan protegidos. |
| D01–D08 / I06 | Fallos SQL y auditoría | Rollback, compensación y commits inciertos conservan invariantes. |

G01/G10 cambiaron deliberadamente de limpieza automática a conservación: una
instancia nueva no puede demostrar solo con tiempo que no queda una operación
remota o SQL por terminar. No se sustituyó seguridad por una expectativa más
débil: se comprueba explícitamente que no hubo destroy y se añadió G13 para
demostrar que las operaciones con resultado durable conocido sí se recuperan.

La creación de `.ownership.json` hizo visible un error latente del helper de
pruebas `security-checks.js`: limpiaba con la variable `path` declarada después
para una ruta HTTP. Se usó el módulo `filesPath` ya existente. El primer runner
SQL se detuvo en esa limpieza; la repetición completa aprobó. Es una corrección
del fixture, no un cambio de lógica de producción ajeno a G09/H01.

## Evidencia de ejecución

| Comprobación | Resultado | Evidencia |
|---|---|---|
| Dirigidas: 7 suites, mocks y procesos | 146 aprobadas; 0 fallidas | [JSON](../../log/images-phase3a-targeted.json), [salida](../../log/images-phase3a-targeted.log) |
| npm test, Windows/Node 24 | 939 aprobadas, 50 omitidas; 73 suites aprobadas y 7 omitidas; exit 0 | [regresión](../../log/images-phase3a-regression.log) |
| npm run test:coverage -- --runInBand | 939 aprobadas, 50 omitidas; 87,61 % líneas / 85,03 % ramas globales; informes escritos; exit 0 | [cobertura](../../log/images-phase3a-coverage.log) |
| MySQL 8/Redis reales descartables | 37 pruebas SQL aprobadas en 3 suites, más comprobaciones HTTP del runner; cleanup completado | [SQL aislado](../../log/images-phase3a-mysql.log) |
| Verificador completo Node 20 | FAIL en npm audit antes de ejecutar tests; 34 altas y 7 moderadas | [builder](../../log/images-phase3a-node20.log) |
| Compatibilidad separada Node 20.20.2/Linux sin red | Lockfile comparado idéntico; 934 aprobadas / 55 omitidas; 87,58 % líneas / 84,99 % ramas; Swagger y docs:build aprobados; exit 0 | [compatibilidad offline](../../log/images-phase3a-node20-compat.log) |

Cobertura Windows: image-ownership.service.js 100 % líneas / 85,10 % ramas; product-images.service.js 96,42 % / 84,70 %; cloudinary.service.js 96,15 % / 89,47 %. Las pruebas de procesos no se agregan artificialmente a LCOV. Los 37 casos SQL no se suman a la suite general como si fueran una única ejecución.

El verificador Node 20 existente se ejecutó sin modificaciones y falló al consultar las alertas actuales. El árbol del mismo lockfile ahora marca picomatch por [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), propagándose a varios consumidores de tooling. Son 34 entradas altas en el árbol, no 34 defectos independientes del módulo de imágenes. No se ejecutó audit fix, no se actualizaron versiones y no se alteró el umbral.

Para separar el fallo de auditoría de la compatibilidad, se usó la imagen Node 20 local previamente disponible, se comparó su package-lock con el actual y se extrajo el archivo fuente ya verificado sin secretos en tmpfs. El contenedor se ejecutó sin red, sin capabilities y con límites de memoria/CPU/procesos, sin servicios habituales. Esta comprobación no reemplaza ni convierte en aprobado el verificador completo fallido.

Los workflows test.yml, sonar.yml y docs.yml permanecen intactos. test.yml quedaría bloqueado por la auditoría actual; las pruebas/cobertura y compilación comprobadas son compatibles con sus comandos. No se ejecutaron Actions, SonarQube/Quality Gate remoto, PlantUML ni el runner de migraciones históricas. No se certifica el CI completo.

Las cinco omisiones adicionales en Linux corresponden a casos exclusivos de Windows PowerShell. Las demás omisiones conservan sus guards de integración optativa. Todos los contenedores de ensayo se retiraron; permanecen únicamente los servicios habituales.

Los logs locales están bajo `log/images-phase3a-*`, ignorados por Git. Los
resultados dirigidos incluyen nombres de escenarios y estados Jest. Las
caracterizaciones todavía marcadas H1–H4 verifican comportamientos conocidos,
no certifican su corrección. El informe de fase 2 se conserva como histórico.

## Archivos modificados

Producción:

- `services/image-ownership.service.js` — nuevo: identidad, namespace y contexto.
- `services/product-images.service.js` — cierre durable y reconciliación conservadora.
- `services/cloudinary.service.js` — contexto de pertenencia para nuevas subidas.
- `services/swagger-contract.service.js` — documentar 503 de identidad en DELETE.

Pruebas:

- `tests/security/images-phase3a.ownership.test.js` — nuevo.
- `tests/security/images-phase2.process.test.js` — G09 seguro, caídas y concurrencia.
- `tests/security/images-phase2.service.test.js` — H01 seguro y metadata de intenciones.
- `tests/security/images-phase2.http.test.js` — adaptar fixtures al contexto nuevo.
- `tests/security/images-phase2.sdk.test.js` — contexto explícito del adaptador.
- `tests/support/image-phase2-fixture.js` — identidad sintética, contexto y observación de transacciones.
- `tests/support/image-phase2-worker.cjs` — scope por IPC sin servicios reales.
- `tests/unit/product-images.service.test.js` y `tests/unit/cloudinary.service.test.js`.
- `tests/database/catalog.mysql.test.js` y `tests/support/security-checks.js`.

Documentación:

- `docs/security/cloudinary-stage3a.md`, este informe y nota histórica en el informe de fase 2.
- `README.md` y `docs/implementation/implementation-report.md`.

No se modificaron workflows, SonarQube, package/lock, `.env`, modelos o migraciones.
Se conservaron las modificaciones locales previas ajenas a esta etapa.

## Corregido frente a mitigado o pendiente

| Aspecto | Estado |
|---|---|
| G09, borrado de operación activa por superar gracia | Corregido en la implementación y escenarios de procesos probados. |
| H01, limpieza de recurso con pertenencia a otro entorno distinguible | Corregido mediante namespace, binding y contexto, con rechazo de identidades copiadas incompatibles. |
| Recursos anteriores/sin contexto | Conservación garantizada por no habilitar su eliminación automática; retirada física manual pendiente. |
| Operaciones abandonadas sin cierre durable | Riesgo de borrado mitigado mediante conservación; limpieza autónoma NO resuelta. |
| Multi-host, NFS, clon exacto de todas las identidades y escrituras SQL externas | No certificados; restricciones explícitas de la guía. No se afirma soporte HA. |
| Permisos efectivos de API key y fallo físico del host | No comprobados ni modificados; no se accedió al proveedor real. |
| H1/H2/H3/H4 | Pendientes, sin correcciones generales en esta fase. |

Esta etapa termina con cambios locales para revisión. Una activación posterior
requiere revisar las restricciones operativas y drenar versiones anteriores;
no se ejecutó aquí. No se continúa a 3B automáticamente.
