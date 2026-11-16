# Validación de registro, contraseñas y categoría inicial

## Alcance y diagnóstico

Rama independiente: `feature/registration-password-product-validation`. El árbol inicial estaba limpio en `main`; se creó la rama antes de editar. Se inspeccionaron los controladores, rutas, servicios de cuentas/catálogo, validadores, modelos/asociaciones, conexión Sequelize, hashing y pruebas. No hay cambios de esquema, migraciones, permisos, configuración de servicios, secretos ni datos habituales.

Política anterior: 8–128 puntos de código Unicode, hasta 512 bytes UTF-8/256 unidades UTF-16, sin NUL ni sustitutos sueltos. Incluía lista local de palabras comunes, normalización solo para esa comparación y filtros de repetición/diversidad; no exigía letra/número/símbolo. Hash scrypt versionado, compatibilidad bcrypt y límites del servicio criptográfico existentes.

## Cambios y contratos

- `POST /api/auth/register`: valida todo el formulario y consulta el correo normalizado, incluyendo cuentas eliminadas lógicamente cuyo correo sigue reservado. Si existe, devuelve **409**, `El correo electrónico ya está registrado.`, antes del hash/OTP/correo. Un fallo SQL no permite emitir OTP. La restricción UNIQUE y la respuesta 409 en verificación siguen protegiendo carreras posteriores a la comprobación. La enumeración de correos en registro es una decisión explícita de producto; recuperación y login mantienen sus protecciones.
- Política central: **8–128 puntos de código Unicode**, al menos una letra (`\p{L}`), un número (`\p{N}`) y puntuación/símbolo (`\p{P}`/`\p{S}`). No exige mayúsculas; admite `contraseña123?`, letras acentuadas, ñ y dígitos Unicode. Espacios permitidos, pero no cuentan como símbolo. Se retiraron la lista común y los filtros repetitivos; se conservan límites técnicos y bytes originales, sin trim ni normalización. Afecta registro, cambio propio, recuperación, edición administrativa y bootstrap ADMIN mediante el servicio compartido. Login y verificación de hashes históricos no aplican composición retroactivamente. No cambia scrypt, bcrypt ni versiones de credenciales.
- `POST /api/products`: `categoryId` opcional, entero positivo o representación decimal canónica, hasta 2147483647. Omitido: comportamiento previo sin categorías. Si se proporciona, se bloquea la categoría existente y no eliminada, se crea producto, asociación `product_categories` y auditoría en la misma transacción. Categoría inexistente/eliminada: **404**; identificador malformado: **400**. Un error en asociación/auditoría rechaza la transacción. Respuesta 201 incluye la categoría bloqueada. No se acepta categoryId en PUT; se conservan endpoints posteriores de asociación. sellerId sigue derivándose de autenticación y el HTTP rechaza asignación masiva.
- `POST /api/auth/password/forgot`: mantiene **202**, respuesta indistinguible, cola/OTP/límites y entrega simulada en pruebas. Nuevo mensaje exacto: `Revisa tu correo electrónico. Si existe una cuenta asociada a esta dirección, recibirás un código para restablecer tu contraseña.`
- Swagger y ejemplos actualizados. Postman conserva su barrera del Word: solo se actualizan la colección y generador/fixtures de contraseña, sin ejecutar peticiones.

## Investigación de Electrónica

El código de categoría recorta espacios, pero no translitera ni reemplaza `é`. Express recibe JSON y responde JSON UTF-8. Las pruebas HTTP de entrada/salida de `Electrónica` y serialización de categorías de productos aprueban con dependencias de persistencia simuladas. La versión instalada de mysql2 configura `UTF8MB4_UNICODE_CI` por defecto (`lib/connection_config.js`); Sequelize no establece un charset incompatible.

Se realizó además una **comprobación habitual exclusivamente de lectura**: carga privada de la configuración local sin imprimir valores sensibles; validación previa del destino local 3307, base secure_ecommerce y usuario ecommerce_app; SELECT de identidad, versión MySQL 8.0 y UUID esperado cuando está configurado; después SELECT de charsets, metadatos de columna y agregados del prefijo `Electr%`. Resultado: sesión client/connection/results **utf8mb4**, columna name **utf8mb4 / utf8mb4_unicode_ci**; **1 nombre coincidente, 1 con signo de interrogación almacenado y 0 con HEX exacto de Electrónica**. No se modificó ningún dato ni configuración. No se mostraron credenciales ni registros completos.

**Conclusión confirmada:** el signo `?` ya está persistido; no es únicamente visualización de GET. El carácter original se perdió antes o durante aquella escritura. Las pruebas HTTP UTF-8 correctas y los charsets inspeccionados no muestran una conversión sistemática del backend. La atribución concreta al comando PowerShell/curl original queda **NO VERIFICADA**, pues no se dispone de sus bytes originales ni se hizo una escritura en la base habitual. No se corrigen registros ni se inventan caracteres sin autorización.

Se añadió y ejecutó en MySQL aislado una comprobación HTTP/SQL de `Electrónica`, `HEX(name)` y los tres charsets de conexión. **Aprobada en las dos variantes de catálogo del esquema final**: la respuesta de creación/listado y los bytes persistidos conservan el nombre correcto. No se añadió una conversión ni se corrigieron datos habituales.

Para diagnosticar registros existentes, un operador autorizado puede ejecutar exclusivamente lecturas:

```sql
SELECT DATABASE(), CURRENT_USER(), @@server_uuid,
       @@character_set_client, @@character_set_connection, @@character_set_results;
SELECT COLUMN_NAME, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='categories' AND COLUMN_NAME='name';
SELECT id, name, HEX(name) FROM categories WHERE id = /* ID conocido */ 5;
```

`é` en UTF-8 es `C3A9`; `?` es `3F`. Encontrar `3F` almacenado demuestra que el carácter ya se perdió antes o durante la escritura, pero por sí solo no identifica al cliente culpable. Un nombre correcto en SQL y erróneo en pantalla requiere revisar respuesta HTTP cruda/codificación del cliente. Un `?` persistido no permite reconstruir automáticamente el carácter original.

## Verificación manual desde PowerShell

Solo contra una API **aislada y previamente validada**. Estos comandos de escritura son instrucciones, no se ejecutaron sobre servicios habituales. No confiar en la codificación predeterminada de Windows PowerShell 5.1 ni en curl como alias.

```powershell
# Completar con el puerto confirmado del entorno aislado y un JWT efímero.
$baseUrl = 'http://127.0.0.1:3001'
$token = Read-Host 'JWT del ADMIN de pruebas aisladas'
$headers = @{ Authorization = "Bearer $token" }
# El escape evita depender incluso de la codificación del archivo .ps1.
$json = '{"name":"Electr\u00f3nica"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$category = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/categories" `
  -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes
$category
Invoke-RestMethod -Uri "$baseUrl/api/categories" -Headers $headers

# JWT de SELLER aprobado del MISMO entorno aislado.
$token = Read-Host 'JWT del SELLER de pruebas aisladas'
$headers = @{ Authorization = "Bearer $token" }
$body = @{ title = 'Teclado'; price = '249.99'; stock = 15; categoryId = $category.categoryId } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$baseUrl/api/products" -Headers $headers `
  -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
Remove-Variable token,headers,bytes,body -ErrorAction SilentlyContinue
```

Registro: enviar perfil BUYER/SELLER y formulario completo con contraseña válida; repetir con el mismo correo después de crear la cuenta debe dar 409 sin envío. Para verificar recuperación, usar direcciones ficticias conocidas/desconocidas con proveedor simulado: ambos cuerpos y estado deben ser iguales. No pegar contraseñas/JWT en archivos versionados ni en reportes. Las variables en memoria no sustituyen una política segura de manejo de secretos del terminal.

## Pruebas y reversión

Las pruebas nuevas cubren duplicados incluidos soft-delete, carrera UNIQUE, error de consulta sin OTP, política Unicode/límites, bcrypt/scrypt históricos, permisos, validación categoryId, vínculo/auditoría en transacción y recorrido HTTP UTF-8. Los tests MySQL agregados comprobaron persistencia/rollback real, incluidos fallos inyectados de asociación/auditoría y categoría eliminada, después de la autorización explícita para recursos Docker temporales.

### Resultados ejecutados el 15 de noviembre de 2026

| Verificación | Resultado comprobado |
| --- | --- |
| Ocho suites dirigidas iniciales | 115 aprobadas, 0 fallidas |
| Suites de recuperación y composición tras separar la matriz HTTP | Aprobadas; limitador real conservado |
| Regresión final completa disponible sin Docker, Node 24.13.1 / Windows | **766 aprobadas, 0 fallidas, 48 omitidas**, 65 suites aprobadas, 7 omitidas, 814 pruebas declaradas |
| Regeneración de cobertura en carpeta nueva, misma regresión final | **766 aprobadas, 0 fallidas, 48 omitidas**, salida 0; reportes generados correctamente |
| Cobertura global de esta ejecución | **86,18 % líneas; 84,30 % ramas; 82,93 % sentencias; 87,40 % funciones** |
| Catálogo | 98,16 % líneas / 94,24 % ramas |
| Política de contraseñas | 100 % líneas / 100 % ramas |
| Hashing | 100 % líneas / 96 % ramas |
| Cuentas personales | 98,61 % líneas / 80,95 % ramas |
| Swagger | Generación real aprobada; contrato unitario aprobado |
| Postman | Colección regenerada; **no se ejecutó**. Falta el Word y no se alteró su barrera |
| Revisión local | 31 archivos, sintaxis JavaScript revisada, cero patrones de secretos detectados, git diff --check aprobado |

Evidencias generadas e ignoradas: `log/requested-improvements-targeted.json`, `log/requested-improvements-complete.json`, `log/requested-improvements-coverage-run.json` y sus logs; cobertura vigente en `log/requested-improvements-coverage/` (LCOV y JSON). Un intento previo no pudo sobrescribir el coverage-final.json antiguo por EPERM del entorno: sus pruebas sí aprobaron, pero **su cobertura no se consideró vigente**. Se repitió la generación en la carpeta nueva indicada. Swagger también requirió permiso de escritura del sandbox para sobrescribir su artefacto local; después generó correctamente sin cambios de código/configuración por ese incidente.

Las 48 omitidas son: catálogo MySQL 22, cuentas MySQL 8, sesiones de cuenta MySQL/Redis 5, wrapper HTTP/MySQL completo 1, wrapper Redis 1, esquema histórico 3 y transición histórica 8. **No se reportan como aprobadas dentro de esa ejecución sin Docker.** La autorización y ejecución temporal posterior se documentan a continuación. Los resultados históricos no sustituyen una ejecución actual y no se afirma aprobación remota de SonarCloud.

Comando de regresión sin Docker (mantener RUN_STAGE5_MYSQL/RUN_STAGE2_REDIS sin activar):

```powershell
node node_modules/jest/bin/jest.js --runInBand --coverage --coverageDirectory=log/requested-improvements-coverage
```

Con la autorización concedida, se reutilizaron `scripts/database/stage5-addresses-test.js` para HTTP/MySQL/Redis y `scripts/database/verify-node20.js` para Node 20/Linux. Nunca sustituir sus identidades, credenciales efímeras o destinos por los habituales.

### Validación temporal autorizada posterior

Ejecución: `18335069-59b7-4f87-bee9-7d2eeec66e7b`. Evidencia local ignorada en `log/isolated-final-18335069-59b7-4f87-bee9-7d2eeec66e7b/`.

Antes de crear recursos se verificaron nombre MySQL libre, puerto local 13308 libre e imágenes mysql:8.0/redis:8.2 disponibles. Se guardó una referencia de ID, imagen, montajes, puertos, inicio, reinicios y hash de configuración de los contenedores habituales, sin guardar sus variables ni secretos. El runner MySQL valida hostname, puerto, UUID TCP/socket, cuenta y ausencia de volúmenes/bind mounts antes del DDL temporal. Redis verifica etiquetas/propiedad, puerto efímero en loopback, identidad y tmpfs; usa credenciales aleatorias y ACL exclusivas. No se ejecutó Compose ni se modificaron secretos locales.

| Ejecución | Resultado |
| --- | --- |
| MySQL primera ejecución | Parent HTTP/seguridad aprobado; hijos **34 aprobados y 1 fallido de 35**. Duración total 72,302 s |
| Causa del fallo | Fixture antiguo de 128 letras Unicode sin número ni símbolo, incompatible con la nueva política. HTTP 400 correcto; expectativa antigua 204 |
| Corrección posterior a explicar la causa | **Solo tests/database/accounts.mysql.test.js**: contraseña sintética de 128 puntos de código, 512 bytes UTF-8, con letra/número/símbolo; se añaden aserciones de esos límites. Ningún cambio de funcionalidad, timeout o seguridad |
| MySQL repetición desde cero | Parent HTTP/seguridad aprobado y **35/35 hijos aprobados**, 3 suites, 0 fallos/omitidos en hijos. Duración total 68,530 s |
| Persistencia y transacciones reales | Categoría inicial, nombre UTF-8/HEX/charsets, asociación, propiedad, vendedores aprobados, rollback de asociación/auditoría, cuentas, sesiones, checkout y concurrencia aprobados por el runner y suites reutilizados |
| Redis real independiente | **6 grupos aprobados**, salida 0, cleanup=true: creación/rotación/reutilización, refresh desconocido, carrera entre conexiones, revocación, vencimiento inactivo/absoluto con TIME y protección frente a reinicio/restauración obsoleta |
| Fixtures Redis de las dos ejecuciones MySQL y runner independiente | **11 informes PASS, 11 con cleanup=true**; cuentas y sesiones efímeras, sin intervención habitual |
| Node 20/Linux | Instalación limpia y regresión: **766 aprobadas, 0 fallidas, 48 omitidas**, 65 suites aprobadas, 7 omitidas. Build salida 0, 35,293 s |
| Cobertura Node 20/Linux | **85,19 % líneas, 82,48 % ramas, 82,04 % sentencias, 87,16 % funciones**; no es cobertura de código nuevo medida por SonarCloud |
| Calidad en Node 20/Linux | npm audit --audit-level=high aprobado, **0 altas/críticas, 19 moderadas y 4 bajas**; Swagger y docs:build aprobados. No se aplicaron actualizaciones de dependencias |

El runner Node 20 se ejecutó desde su código actual, con sustitución **solo en memoria** de etiqueta de imagen y rutas de artefactos por valores exclusivos de esta ejecución; su archivo y controles del contexto no se modificaron. El contexto excluye .env reales, .secrets, logs, respaldos y claves. Las 48 pruebas omitidas en la imagen se distinguen de las integraciones separadas: los 35 hijos MySQL y el parent HTTP se ejecutaron con sus fixtures reales; Redis se ejercitó separadamente. Permanecen sin repetir las **11 pruebas históricas de esquema/transición**, ajenas a los cambios actuales. Postman completo sigue sin ejecutarse por el Word ausente.

Redis temporal utiliza conexión local sin TLS para ejercitar el almacenamiento y concurrencia; la configuración TLS se cubre por pruebas unitarias. No se probó ni modificó Redis TLS habitual, ni se enviaron correos reales ni archivos a Cloudinary.

El build emitió una advertencia de worker Jest sin cierre limpio, pese a pruebas aprobadas. Se ejecutó diagnóstico adicional **--runInBand --detectOpenHandles** en un contenedor exclusivo sin red externa, puertos ni volúmenes: **766 aprobadas, 0 fallidas, 48 omitidas**, salida 0, **47,899 s**, cierre normal, sin aviso de handles abiertos ni advertencia de worker. Su contenedor se eliminó después de verificar ID/etiqueta. La causa de la advertencia en ejecución paralela no quedó identificada; **no se considera corregida**, sino no reproducida en el diagnóstico serial. Conviene observarla en el siguiente CI; no se añadieron forceExit, exclusiones, aumentos de timeout ni cambios funcionales.

### Limpieza y comparación final

- **2 contenedores MySQL temporales**, **11 fixtures Redis** y **1 contenedor de diagnóstico Node 20** retirados. Todos los informes Redis indican cleanup=true. El inventario final no contiene ningún contenedor adicional al inicial.
- Imagen exclusiva `secure-ecommerce-node20-test:18335069-59b7-4f87-bee9-7d2eeec66e7b` retirada tras verificar que su ID no estaba en el inventario inicial y que solo tenía esa etiqueta. No se alteró la imagen de verificación preexistente ni las imágenes habituales. Contexto tar exclusivo eliminado. Se conservan informes locales ignorados y la caché estándar compartida de BuildKit; no se ejecutó prune.
- Los contenedores habituales **ecommerce_api, ecommerce_db y secure-ecommerce-api-redis-1** continúan **running**; MySQL y Redis continúan **healthy**. API no declara estado de healthcheck. Se conservaron exactamente **ID, imagen, configuración, puertos, montajes, hora de inicio y número de reinicios**.
- La primera comparación local falló por tratar el array Mounts como una lista ordenada; Docker devolvió sus elementos en distinto orden entre lecturas. Las comprobaciones exclusivamente de lectura posteriores compararon todos los campos de cada montaje como conjunto, sin omitir valores, y confirmaron igualdad. Además, los IDs iniciales de docker ps eran abreviados: el inventario final se contrastó correctamente contra sus prefijos únicos y los IDs habituales completos. No se modificó el comparador de Postman ni código de aplicación; ambas incidencias pertenecían al script puntual de inspección. Se conservan el informe inicial y `final-state-canonical.json` como evidencia.
- **Sin commits, staging, push, merge, despliegues, cambios de permisos, secretos, contenedores habituales o datos reales.** La única edición adicional de código en esta validación fue el fixture Unicode descrito y este informe.

### Inventario de archivos

- Producción: `controllers/personal-account.controller.js`; `services/accounts.service.js`, `catalog.service.js`, `password-policy.service.js`, `personal-account.service.js`, `swagger-contract.service.js`.
- Documentación/contratos: `docs/security/user-authentication.md`, este informe y `examples/api.http`; `postman/scripts/build-collection.js`, `postman/scripts/run.js`, `postman/collections/secure-ecommerce.postman_collection.json`.
- Fixtures temporales: `scripts/database/stage5-addresses-test.js`, `tests/support/security-checks.js`. Solo se adaptan contraseñas sintéticas a la composición vigente; no se ejecutan contra servicios habituales.
- MySQL: `tests/database/accounts.mysql.test.js`, `account-session-security.mysql.test.js`, `catalog.mysql.test.js`.
- HTTP: `tests/integration/auth.routes.test.js`, `categories.routes.test.js`, `english-contract.test.js`, `personal-account.routes.test.js`, `products.routes.test.js`, `session-auth.routes.test.js` y nuevo `password-composition.routes.test.js`.
- Unitarias: `tests/unit/account-security.test.js`, `catalog-business.test.js`, `password-hash.test.js`, `password-policy.test.js`, `personal-openapi.test.js`, `seed-guard.test.js`, `sonar-reliability.test.js`.

Los cambios de pruebas históricas sustituyen candidatos antes rechazados por denylist (ahora válidos por decisión de producto), actualizan el contrato aditivo y garantizan composición en fixtures aleatorios. No se retiran pruebas ni se desactivan límites. La nueva matriz HTTP se separa en su propio archivo para no superar 30 peticiones/minuto por el mismo origen entre casos; el limitador real permanece habilitado.

Compatibilidad: consumidores deben manejar el nuevo 409 en solicitud de registro y actualizar sus validaciones de nuevas contraseñas. No comparar literalmente el antiguo texto de recuperación. categoryId es aditivo y opcional; no cambia el formato de respuesta de productos ni los endpoints de asociación. La selección de categoría no otorga privilegios de ADMIN.

No se necesita revertir datos/esquema. Antes de descartar cambios, guardar `git diff --binary` fuera de esta rama de forma segura y conservar los archivos nuevos que se quieran mantener. Para revertir, revisar `git diff --name-only` y usar `git restore --source=HEAD -- <rutas revisadas>` únicamente para los archivos de esta entrega; los archivos nuevos se retiran individualmente después de revisarlos y respaldarlos. No usar reset --hard, clean ni eliminación masiva, y no descartar trabajo posterior de compañeros.
