# Implementación de `secure_ecommerce`

La [propuesta de base de datos de 14 tablas](../Propuesta_BD_Secure_Ecommerce_14_tablas.docx) define el esquema. Las aclaraciones de la etapa 2 fijan los mismos cinco valores de `orders.status` para `order_status_history.previousStatus` y `newStatus`. Solo el estado anterior puede ser `NULL`.

## Etapa 1

### Objetivo y cambios

Preparar MySQL y Sequelize para un esquema nuevo, conservando el destino de la API en `mercadolibrenode`. La conexión desde Windows usa `127.0.0.1:3307`. La conexión desde el contenedor de la API usa `db:3306`.

| Archivos | Cambios y motivo |
| --- | --- |
| `docker-compose.yml`, `bd.sql` | Se conservó `3307:3306`. El bootstrap de un volumen nuevo crea el esquema anterior y deja el aprovisionamiento de cuentas al administrador. Compose retiró los secretos predeterminados y exige `JWT_SECRET` al arrancar la API. |
| `.env.example`, `config/config.js` | Se documentaron los dos puertos y las variables de la API. Las conexiones de desarrollo y producción rechazan `root`, `ecommerce_migrator` y contraseñas vacías. |
| `.env.migration.example`, `config/secure-ecommerce-migrations.js` | Se preparó una configuración independiente de Sequelize CLI, limitada a `secure_ecommerce` y a `ecommerce_migrator`. La credencial se obtiene del entorno o de `.env.migration.local`. |
| `README.md`, `docs/database/etapa-1-secure-ecommerce.md` | Se documentaron el aprovisionamiento, los permisos por tabla y la transición de datos y aplicación. |

### Verificación, riesgos y pendientes

- `docker compose config --quiet`, comprobación de los valores resueltos de Compose y verificación de la configuración Sequelize sin conexión a MySQL completaron correctamente. La suite sin MySQL terminó con **131 pruebas aprobadas en 14 suites** tras repetirla con acceso a `log/log.txt`. En el primer intento, el entorno restringido devolvió `EPERM` al escribir ese archivo.
- En un volumen inicializado, cambiar las variables o `bd.sql` no cambia las cuentas ni sus permisos. Las credenciales históricas y posibles privilegios amplios necesitan revisión y rotación administrativa. La ejecución directa de Node.js conserva el respaldo de JWT del código anterior. [Imagen oficial de MySQL](https://github.com/docker-library/docs/blob/master/mysql/README.md).
- Quedaron pendientes la creación del destino y las cuentas, el ensayo en una instancia aislada y el corte. La [guía de etapa 1](../database/etapa-1-secure-ecommerce.md) contiene el SQL de aprovisionamiento. Los permisos de `ecommerce_app` se aplicarán después de crear sus tablas y antes de desplegar la API adaptada.

## Etapa 2

### Objetivo y archivos

Implementar la evolución desde la normalización de 2026 hasta el esquema acordado. Las dos migraciones que descubre el CLI por defecto son aditivas. El cierre es una migración separada en `migrations/cutover/` y exige aprobación explícita.

| Archivo | Cambios y motivo |
| --- | --- |
| `migrations/20261110000001-create-secure-ecommerce-tables.js` | Crea `admins`, `sellers`, `buyers`, `user_addresses`, `carts`, `cart_items`, `orders`, `order_items` y `order_status_history` en orden de dependencias. |
| `migrations/20261110000002-prepare-existing-ecommerce-tables.js` | Amplía `users`, `categories`, `products`, `product_categories` y `audit_logs`. Conserva los contratos de columnas existentes y permite reconciliar datos antes de imponer los nuevos `NOT NULL`. |
| `migrations/cutover/20261110000003-finalize-secure-ecommerce-schema.js` | Valida los datos reconciliados, aplica los tipos y restricciones finales y retira las estructuras históricas del destino. |
| `migrations/support/secure-ecommerce.js` | Comparte definiciones de `ENUM`, comprobaciones del destino y reglas para FKs restrictivas. Lee el juego de caracteres y la colación reales de `users.id` para igualarlos en las referencias `CHAR(36)`. |
| `tests/unit/secure-ecommerce-migrations.test.js` | Comprueba el SQL y las barreras de seguridad con una interfaz Sequelize simulada. |
| `tests/database/schema.mysql.test.js` | Fija el límite de las pruebas históricas en la normalización de 2026, de modo que continúen probando ese contrato en sus bases temporales. |
| `README.md`, `docs/implementation/implementation-report.md` | Distinguen los comandos históricos del flujo nuevo y documentan cómo verificarlo. |

### Estructura y restricciones

- Las nueve tablas nuevas incluyen las FKs restrictivas, la clave única del carrito por comprador, la clave única del ítem por carrito y producto, y la de pedido por `checkoutId` y vendedor. La dirección predeterminada activa se protege mediante un índice único funcional que devuelve `NULL` para otras filas, sin añadir una columna visible. Las cantidades positivas, el total no negativo y el precio histórico no negativo tienen `CHECK`. [Índices funcionales en MySQL](https://dev.mysql.com/doc/refman/8.0/en/create-index.html).
- `orders` conserva la dirección como JSON. `order_items` conserva `productTitle` y `unitPrice`. El historial usa los mismos valores `ENUM` que `orders.status`, con `previousStatus` y `reason` anulables. Las tablas que admiten borrado lógico tienen `deletedAt`. El esquema no añade tablas de registro pendiente o de sesión JWT.
- En la transición coexisten **16 tablas de negocio**. `emailVerifiedAt`, `sellerId`, `audit_logs.outcome` y `audit_logs.occurredAt` permiten `NULL` hasta el cierre. `users.status` y `sellers.status` ya usan sus `ENUM`. El `DEFAULT 'ACTIVE'` en una fila anterior no acredita que su correo esté verificado. El `DEFAULT 0` de `stock` tampoco acredita el inventario anterior.
- El cierre conserva y comprueba la unicidad histórica de `users.email`. Agrega unicidad de `categories.name`, `CHECK` en `products.price` y `categories.protected`, el orden final de la PK de `product_categories` y sus FKs restrictivas. Ajusta longitudes, nulabilidad, `DECIMAL(12,2)` y `DATETIME(3)` donde el esquema anterior difiere. Tras retirar las FKs y columnas antiguas elimina `roles` y `files` del destino. Quedan **14 tablas de negocio** y `SequelizeMeta` como tabla técnica.

### Riesgos y pendientes antes del cierre

1. Verificar el historial y la estructura de la copia normalizada. Archivar y ensayar la recuperación del origen, `uploads/`, BLOB y auditoría antes de retirar campos. Mantener el destino separado de la API anterior. Después de incorporar perfiles u operaciones comerciales, los borrados físicos de la API anterior pueden chocar con las nuevas FKs.
2. Reconciliar `users` con evidencia de verificación de correo, exactamente un perfil por cuenta, asignaciones de vendedores e inventario confirmado. Resolver longitudes incompatibles, categorías duplicadas según su colación y precios negativos. Reconciliar referencias de imágenes con `imagePublicId` y conservar el mapa de transferencia. Para la bitácora, conservar la fecha histórica real, el resultado y las referencias comprobables. La migración solo valida condiciones estructurales y la presencia de datos obligatorios. La evidencia de negocio y la revisión del respaldo requieren verificación externa.
3. Adaptar modelos, controladores, rutas y autenticación antes del cambio de destino. La API debe normalizar correos, crear cuenta y perfil de forma atómica, verificar correo antes del alta, restringir el alta de administradores, comprobar cuenta activa y propietario, y exigir vendedor aprobado. Una FK por perfil garantiza la referencia individual. La exclusividad entre las tres tablas y su existencia conjunta requieren transacciones y serialización por usuario o controles adicionales si hay escrituras directas.
4. Implementar checkout, descuento atómico de stock, verificación de reintentos y contenido, consistencia entre total y detalles, coherencia entre vendedor y productos del pedido, validación de JSON de dirección y transiciones autorizadas con motivo de cancelación. La API debe filtrar `deletedAt` y aplicar reactivaciones mediante las claves únicas. La inmutabilidad de snapshots, detalle e historial se refuerza con permisos por tabla y columna de `ecommerce_app`. El acceso a auditoría requiere autorización y filtrado de datos sensibles.
5. Ejecutar un migrador a la vez y pausar escrituras del destino durante el cierre. MySQL hace confirmaciones implícitas. En particular, el cambio de las FKs del vínculo de categorías usa dos `ALTER` con `foreign_key_checks` activo. Entre ellos las dos referencias antiguas ya pueden estar retiradas. Ante una interrupción, inspeccionar los DDL y `SequelizeMeta`, y reanudar solo desde un estado conocido. Las comprobaciones de reentrada usan nombres de columnas y restricciones como marcadores. Ante divergencias manuales se requiere inspección completa con `SHOW CREATE TABLE`. Los `down` rechazan la reversión automática para proteger datos nuevos e históricos. [DDL atómico](https://dev.mysql.com/doc/refman/8.0/en/atomic-ddl.html), [ALTER TABLE y FKs](https://dev.mysql.com/doc/refman/8.0/en/alter-table.html).

### Pruebas ejecutadas

- `npm.cmd test -- --runTestsByPath tests/unit/secure-ecommerce-migrations.test.js` terminó con **17 pruebas aprobadas**. Las pruebas cubren tipos, FKs y restricciones, precondiciones del destino, reentrada, bloqueo de datos pendientes y orden del cierre.
- `npm.cmd test -- --testPathIgnorePatterns=tests/database` terminó con **148 pruebas aprobadas en 15 suites**.
- Se verificó sin conexión que Umzug descubre las ocho migraciones históricas y las dos aditivas en la ruta habitual. La ruta de cierre solo descubre su propia migración. `git diff --check` pasó y el hash del Word coincide con el de la etapa 1.
- En esta etapa no se inició MySQL, ni se ejecutaron migraciones, seeders o pruebas sobre `mercadolibrenode` o `secure_ecommerce`. La compatibilidad efectiva del DDL con MySQL, los bloqueos y los tiempos de ejecución quedan pendientes de ensayo.

### Comandos para revisar antes de ejecutar

El ensayo posterior debe usar una **instancia descartable distinta** y una base llamada `secure_ecommerce` en ella. El siguiente ejemplo usa un contenedor independiente sin montar `mysql_data` del proyecto. Cargar `MYSQL_ROOT_PASSWORD` en la sesión desde el gestor de secretos del ensayo. Una vez que MySQL responda, usar la sesión de administrador para aplicar el aprovisionamiento de la [guía de etapa 1](../database/etapa-1-secure-ecommerce.md#aprovisionamiento-posterior-del-nuevo-esquema).

```powershell
docker run --detach --name secure-ecommerce-stage2-test --publish 127.0.0.1:13307:3306 --env MYSQL_ROOT_PASSWORD --env MYSQL_ROOT_HOST=localhost mysql:8.0
docker exec -it secure-ecommerce-stage2-test mysql --user=root --password
```

Antes de migrar, conectarse por el puerto aislado con `mysql --host=127.0.0.1 --port=13307 --protocol=TCP --user=ecommerce_migrator --password --database=secure_ecommerce` y verificar `SELECT @@hostname, VERSION(), DATABASE(), CURRENT_USER(), @@session.sql_mode, @@session.foreign_key_checks;`. El mínimo del procedimiento es MySQL 8.0.18. La normalización histórica combina el retiro y la creación de FKs en un solo `ALTER`. Ensayar ese punto al partir de cero, ya que MySQL restringe esa combinación cuando necesita `ALGORITHM=COPY`. Si falla, detener el ensayo y revisar el DDL aplicado antes de continuar desde una copia normalizada y verificada. [Operaciones DDL de InnoDB](https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html).

```powershell
# Solo en la instancia aislada y después de la revisión.
$env:MIGRATION_DB_HOST = '127.0.0.1'
$env:MIGRATION_DB_PORT = '13307'
$env:MIGRATION_DB_USER = 'ecommerce_migrator'
# Cargar MIGRATION_DB_PASSWORD desde el gestor de secretos del ensayo.

# En una base vacía, aplicar y verificar primero la cadena histórica.
npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration --to 20261108000001-normalize-english-schema.js

# Después, con fixtures sintéticos o una copia previamente normalizada y revisada.
npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration --to 20261110000002-prepare-existing-ecommerce-tables.js
```

En el ensayo, comparar filas y referencias antes y después de las adiciones. Usar `SHOW CREATE TABLE` e `information_schema` para verificar tipos, índices y reglas de FK. Probar inserciones rechazadas por `ENUM`, FKs, duplicados y `CHECK`, y que una segunda dirección predeterminada activa falle mientras una anterior con `deletedAt` permita reemplazo. Probar que el cierre rechace datos incompletos y ensayar recuperación de un `ALTER` interrumpido. Verificar que el resultado final incluya exactamente 14 tablas de negocio y probar el alcance efectivo de `ecommerce_app`.

El siguiente comando se revisa por separado. En un despliegue real requiere autorización de corte, respaldo restaurable, datos reconciliados, escrituras pausadas y API compatible.

```powershell
$env:SECURE_ECOMMERCE_CUTOVER_APPROVED = '1'
try {
  npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration --migrations-path migrations/cutover --to 20261110000003-finalize-secure-ecommerce-schema.js
} finally {
  Remove-Item Env:SECURE_ECOMMERCE_CUTOVER_APPROVED
}
```

Durante la etapa 2 se aplazan estos comandos, `migrate:undo`, `migrate:undo:last`, los seeders y las pruebas que requieren `TEST_MYSQL_URL`. No apuntar el CLI a la base activa de la API ni usar `docker compose down -v`.

## Etapa 2.5 — Validación real en MySQL

### Entorno y migraciones

El ensayo se ejecutó dos veces desde una instancia descartable nueva de MySQL **8.0.46**, con Docker Desktop 4.63.0, motor Linux y la imagen `mysql:8.0`. El motor de Docker no respondía inicialmente y se inició Docker Desktop antes de aprovisionar el ensayo. El contenedor `secure-ecommerce-stage25` publicó solo `127.0.0.1:13307` hacia su puerto `3306`. Cada instancia usó un volumen anónimo propio, credenciales aleatorias de ensayo y datos sintéticos. Se verificó la retirada de ambos contenedores temporales. El volumen `mysql_data` del proyecto y las bases habituales quedaron intactos.

Antes de migrar se comprobó el identificador del contenedor, su mapeo de puerto y sus montajes. Se comparó el UUID del servidor obtenido por el socket de `root@localhost` con el de la conexión TCP. La sesión TCP confirmó `secure_ecommerce`, `ecommerce_migrator@%`, modo estricto y `foreign_key_checks=1`. La cuenta de migración tenía permisos limitados a la base aislada. Node.js 24.13.1 ejecutó Sequelize CLI 6.6.5 y Sequelize 6.37.8.

1. Las siete migraciones de 2024 y `20261108000001-normalize-english-schema.js` finalizaron en los dos ensayos. Tras la normalización quedaron siete tablas de negocio con nombres en inglés, cuatro claves foráneas históricas y ocho entradas en `SequelizeMeta`. El `ALTER` histórico que reemplaza claves foráneas terminó correctamente en MySQL 8.0.46 con `foreign_key_checks` activo.
2. `20261110000001-create-secure-ecommerce-tables.js` y `20261110000002-prepare-existing-ecommerce-tables.js` finalizaron después de cargar filas sintéticas en las siete tablas históricas. La transición quedó con **16 tablas de negocio más `SequelizeMeta`**. Se conservaron `roles` y `files`.
3. Una segunda invocación del CLI con la ruta habitual informó `No migrations were executed, database schema was already up to date.` El esquema y las diez entradas de `SequelizeMeta` coincidieron antes y después de esa invocación. La migración de cierre quedó sin aplicar.

### Resultados de las pruebas

| Comprobación | Resultado observado en el segundo ensayo |
| --- | --- |
| `SHOW CREATE TABLE` e `information_schema` | Se verificó el conjunto exacto de tablas, las PK, las 20 FKs y sus reglas. Las 16 FKs nuevas fueron restrictivas y las cuatro históricas conservaron sus reglas. Las definiciones de `roles` y `files` y las filas sintéticas de las siete tablas históricas coincidieron antes y después de las adiciones. |
| Tipos, estados y nulabilidad | Se comprobaron los valores y defaults de `ENUM`, la nulabilidad de ambos estados del historial, `reason`, los tipos JSON y DECIMAL y la precisión de `DATETIME(3)`. MySQL rechazó estados desconocidos, un `NULL` en el nuevo estado del historial y direcciones de pedido nulas o JSON inválido. |
| Compradores, vendedores y carritos | MySQL aceptó relaciones válidas, rechazó perfiles incorrectos en pedidos o carritos, impidió duplicar carrito, ítem y correo, y rechazó actualizar una clave padre referenciada. |
| Dirección predeterminada | Se aceptó una dirección no predeterminada adicional. Una segunda predeterminada activa y un valor `isDefault=2` fueron rechazados. Tras el borrado lógico de la anterior se aceptó su reemplazo. |
| Inventario, importes y snapshots | MySQL rechazó inventario negativo, cantidades de cero e importes negativos de pedido o detalle. Un cambio posterior de título y precio en el catálogo preservó el nombre, el precio y la dirección del pedido. La prueba de transición confirmó que `products.price` aún admite negativos por diseño. El `CHECK` del catálogo pertenece al cierre. |

- Las **17 pruebas unitarias** de las migraciones pasaron sin MySQL. En el primer ensayo real, **6 de 8** pruebas pasaron. En dos pruebas, la FK rechazó la escritura con `1216` (`ER_NO_REFERENCED_ROW`) y la aserción esperaba `1452` (`ER_NO_REFERENCED_ROW_2`). Se ajustó la aserción para exigir una de esas dos variantes de violación de FK. [Referencia de errores de MySQL](https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html).
- Tras repetir la cadena completa en un contenedor vacío, **8 de 8** pruebas de integración pasaron. No se corrigió ninguna migración. La nueva suite se ejecuta con `npm.cmd test -- --runTestsByPath tests/database/secure-ecommerce-transition.mysql.test.js` después de la normalización histórica en el contenedor aislado `secure-ecommerce-stage25`. Requiere `STAGE25_MYSQL_UUID` y `MIGRATION_DB_PASSWORD`, y valida la identidad y el estado inicial del servidor antes de escribir.

### Archivos, riesgos y recomendación

- Se creó `tests/database/secure-ecommerce-transition.mysql.test.js` y se actualizó este reporte. El Word, la configuración, las migraciones y el código del backend quedaron intactos.
- Recomiendo iniciar la adaptación del backend tras autorización, usando el esquema de transición validado en MySQL 8.0.46. Para el corte quedan pendientes la reconciliación de datos reales, la adaptación de la API, la validación de privilegios de `ecommerce_app` y el ensayo autorizado del cierre. El esquema definitivo debe tener exactamente las **14 tablas del Word más `SequelizeMeta`**. `roles` y `files` se conservarán durante la transición y su retirada se hará únicamente en el cierre.

## Etapa 3A — Cuentas y autenticación

### Implementación y decisiones

`User` usa las columnas del diseño, borrado lógico y un alcance predeterminado que excluye `passwordHash`. `Admin`, `Seller` y `Buyer` usan `userId` como PK y FK. La autorización resuelve el perfil a partir de las tres relaciones y exige exactamente una. Una cuenta sin perfil, con varios perfiles, sin correo verificado, suspendida, deshabilitada o cerrada queda excluida de las operaciones protegidas.

| Contrato | Comportamiento |
| --- | --- |
| `POST /api/auth/register` | Recibe `email` y responde `202`. Envía un código de seis dígitos por correo. La respuesta no incluye el código. |
| `POST /api/auth/register/verify` | Recibe `email`, `code`, `name`, `password` y `profile`. `SELLER` requiere `storeName`. Responde `201` tras confirmar la transacción de usuario y perfil. `ADMIN` se provisiona mediante un proceso operativo protegido, fuera de los endpoints públicos. |
| `POST /api/auth` | Devuelve `id`, `email`, `name`, `profile`, `status`, `sellerStatus` si aplica y `jwt`. Rechaza credenciales incorrectas y cuentas no habilitadas con el mismo `401`. |
| `GET /api/auth/time` | Conserva la duración y el formato de sesión. Un vendedor pendiente puede consultar la sesión. Las rutas comerciales que admitan `SELLER` exigen `APPROVED`. |
| `GET`, `PUT`, `DELETE /api/users` | `ADMIN` lista cuentas, consulta por correo, edita `name`, `password` o `status`, o realiza el cierre lógico por correo. El perfil se conserva. El antiguo `POST /api/users` se sustituye por la verificación pública de correo. |
| `PUT /api/users/sellers/:userId/review` | `ADMIN` activo puede aprobar o rechazar una solicitud `PENDING`. El rechazo exige `rejectionReason`. La decisión registra actor y fecha. El bloqueo de la solicitud garantiza que solo una revisión concurrente se confirme. La decisión y su evento de auditoría comparten la transacción. |

- El código se guarda en memoria como HMAC con clave aleatoria de proceso. Caduca en diez minutos, admite hasta cinco intentos, limita reenvíos a uno por minuto y acota el almacenamiento a 1,000 solicitudes pendientes. La confirmación bloquea el código mientras escribe y lo consume después del commit. Una transacción fallida permite volver a intentar con el mismo código dentro de su vigencia. La aplicación usa Resend con `REGISTRATION_EMAIL_FROM` y `RESEND_API_KEY`; las pruebas sustituyen el envío. [API de correo de Resend](https://resend.com/docs/api-reference/emails/send-email).
- La restricción única de correo y la transacción de Sequelize impiden cuentas incompletas y perfiles duplicados en las altas concurrentes. El correo se normaliza antes de guardar y las contraseñas nuevas se hashean con bcrypt. Las escrituras directas fuera de la API todavía deben mantener la exclusividad transversal descrita en el Word.
- El JWT conserva HS256, los claims de interoperabilidad, 20 minutos de duración y la renovación mediante `Set-Authorization` durante los últimos cinco minutos. Usa el UUID en `sub` y valida emisor, audiencia y expiración. Cada petición protegida consulta el estado actual y resuelve el perfil desde MySQL. Se exige `JWT_SECRET` de al menos 32 bytes y se retiró el valor de respaldo. Los tokens anteriores sin `sub` requieren un nuevo inicio de sesión.
- Durante la transición, `users.roleId` sigue siendo `NOT NULL`. Solo al insertar, el servicio comprueba `TRANSITION_USER_ROLE_ID` contra el rol histórico no administrativo `Usuario` y escribe esa FK. El inicio de sesión y la autorización resuelven el acceso con las tablas de perfil. Las rutas preexistentes con permisos `Administrador` o `Usuario` se traducen a `ADMIN` o `BUYER`. Los contratos del catálogo y de archivos se mantienen en su etapa actual.

### Archivos modificados

| Área | Archivos |
| --- | --- |
| Modelos | `models/user.js`, `models/admin.js`, `models/buyer.js`, `models/seller.js`, `models/role.js` |
| Cuentas, correo y seguridad | `services/accounts.service.js`, `services/email-verification.service.js`, `services/registration-email.service.js`, `services/jwttoken.service.js`, `middlewares/auth.middleware.js` |
| HTTP y configuración | `controllers/auth.controller.js`, `controllers/users.controller.js`, `routes/auth.routes.js`, `routes/users.routes.js`, `services/swagger-contract.service.js`, `examples/api.http`, `index.js`, `.env.example`, `docker-compose.yml` |
| Pruebas unitarias | `tests/unit/auth.middleware.test.js`, `tests/unit/email-verification.service.test.js`, `tests/unit/jwttoken.service.test.js` |
| Pruebas de contratos | `tests/integration/auth.routes.test.js`, `tests/integration/users.routes.test.js`, `tests/integration/english-contract.test.js`, `tests/integration/audit-logs.routes.test.js`, `tests/integration/categories.routes.test.js`, `tests/integration/files.routes.test.js`, `tests/integration/products.routes.test.js`, `tests/integration/roles.routes.test.js`, `tests/support/auth-fixtures.js` |
| Pruebas de MySQL | `tests/database/accounts.mysql.test.js`, `tests/support/accounts-transition-schema.js`, `tests/database/schema.mysql.test.js` |
| Reporte | `docs/implementation/implementation-report.md` |

### Verificación y pendientes

- `npm.cmd test -- --testPathIgnorePatterns=tests/database` pasó **142 pruebas en 16 suites**. Incluye los contratos de recursos existentes con identidades de prueba y los casos de registro, caducidad, intentos, autorización, JWT y revisión.
- Se comprobó que las tres suites optativas de MySQL omiten sus **17 pruebas** cuando faltan las variables de ensayo. Las suites de historial y de transición ejecutan migraciones cuando se habilitan, por lo que quedaron fuera del ensayo real de esta etapa. Sus pruebas históricas consultan las estructuras anteriores sin usar el modelo de cuentas nuevo.
- La suite de cuentas usó MySQL 8.0.46 en `127.0.0.1:13307` con el esquema aislado `secure_ecommerce_3a_test`. Se cargaron seis tablas de prueba con DDL de fixture y datos sintéticos. `ecommerce_app` se conectó con permisos por tabla y sin DDL ni `DELETE`. En el primer ensayo pasaron cuatro de seis pruebas. La aprobación y el rechazo fallaron con `ER_TABLEACCESS_DENIED_ERROR` porque `SELECT ... FOR UPDATE` en `admins` requería más permisos que el `SELECT` concedido. Se retiró el bloqueo de `admins` y se mantuvieron los bloqueos de la cuenta y la solicitud, junto con la FK del revisor.
- `npm.cmd test -- --runTestsByPath tests/database/accounts.mysql.test.js` pasó **6 de 6 pruebas** en un segundo contenedor vacío con los mismos permisos. Se verificaron el alta y el correo único bajo concurrencia, la reversión de un alta incompleta, el bloqueo de JWT vigentes al suspender o retirar la verificación, la aprobación concurrente con auditoría y el rechazo con motivo. La suite se habilita con `STAGE3A_MYSQL_UUID` y `STAGE3A_TEST_PASSWORD` y verifica la identidad del contenedor antes de escribir. Se retiraron ambos contenedores temporales.
- El destino habitual de la API conserva su configuración. Este código requiere el esquema de transición y la reconciliación de perfiles y correos existentes antes de desplegarse. Debe provisionarse al menos un `ADMIN` verificado con su perfil en una sola transacción y configurarse el identificador histórico `Usuario` para el alta durante la transición.
- Antes del cierre quedan pendientes la adaptación de catálogo, Cloudinary, carrito y pedidos, la migración del resto de la auditoría al contrato final, la verificación de los permisos de producción y el ensayo del cierre. Se requiere un almacenamiento compartido para los códigos si el despliegue tiene varias instancias. No se envió correo real en las pruebas. El Word, las migraciones y las bases habituales quedaron intactos.

## Etapa 3B — Catálogo y Cloudinary

### Funcionalidades y contratos

Los modelos `Product`, `Category` y `ProductCategory` usan los campos, tamaños, fechas y borrado lógico del diseño. `Product` pertenece a `Seller` y mantiene una relación N:M con categorías. El vínculo tiene PK compuesta, `createdAt` y `deletedAt`. La reactivación conserva su fila y su fecha de creación. El catálogo devuelve `productId`, `sellerId`, título, descripción, precio decimal como cadena, inventario, `imagePublicId`, una URL pública calculada y categorías activas.

| Ruta | Comportamiento |
| --- | --- |
| `GET /api/products` y `GET /api/products/:id` | ADMIN, BUYER y SELLER aprobado consultan productos vigentes de vendedores activos, verificados y aprobados. Los productos sin vendedor reconciliado, con precio negativo o título nulo quedan fuera de la consulta. |
| `POST /api/products` | El vendedor aprobado crea productos con su propio `sellerId`, calculado en el servidor. Se aceptan `title`, `description`, `price` y `stock`. |
| `PUT` y `DELETE /api/products/:id` | El propietario aprobado edita contenido, precio o inventario, o realiza borrado lógico. Los productos ajenos responden `404`. La desactivación conserva la referencia de imagen. |
| `POST /api/products/:id/categories` y `DELETE /api/products/:id/categories/:categoryId` | Asocian, reactivan o desasocian lógicamente categorías activas del producto propio. |
| `PUT /api/products/:id/image` | Recibe una sola imagen en el campo multipart `image`, JPEG, PNG o WebP, hasta 2 MB. Verifica propietario antes de recibir el archivo y revalida cuenta, aprobación y propiedad antes de cambiar MySQL. |
| `DELETE /api/products/:id/image` | Retira la referencia y programa la limpieza segura del recurso. |
| `/api/categories` | Los perfiles autorizados consultan las categorías activas. ADMIN crea, renombra o desactiva categorías. `protected` impide la desactivación y queda fuera de los campos editables del cliente. |
| `/api/files` | Conserva las lecturas históricas. POST, PUT y DELETE responden `410`. La API nueva carga las imágenes mediante la ruta del producto. |

Se validan precios no negativos de hasta dos decimales e inventario entero en el rango de `INT UNSIGNED`. Los campos de administración, identificadores de imagen y `fileId` quedan excluidos de la entrada. Las escrituras comprueban de nuevo el estado del vendedor bajo bloqueo SQL. Las asociaciones y las actualizaciones concurrentes se serializan con las filas de cuenta y producto. La gestión de categorías usa aislamiento `REPEATABLE READ` para proteger los nombres mientras el destino todavía carece del índice único final. La API devuelve errores controlados sin diagnósticos SQL o del proveedor.

### Imágenes y recuperación

Se incorporó el SDK oficial `cloudinary` **2.11.0**. Las credenciales se obtienen de `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`. Las cargas usan memoria, validan extensión, MIME, firma binaria y tamaño, y Cloudinary valida el formato al procesar la imagen. El servidor genera un identificador único por carga y desactiva la sobrescritura. MySQL almacena únicamente `imagePublicId`. La URL se calcula al responder. [SDK de Node.js](https://cloudinary.com/documentation/node_image_and_video_upload).

La coordinación de Cloudinary y MySQL usa compensación y un diario persistente en `log/cloudinary`. Antes de subir se escribe y sincroniza un registro con el identificador esperado. Antes de sustituir una referencia se registra también la imagen anterior. Si falla la escritura SQL, se vuelve a comprobar si la imagen quedó referenciada antes de intentar eliminarla. Esta comprobación espera el bloqueo del producto para resolver un commit incierto y cuenta también los productos borrados lógicamente.

La recuperación se inicia con la API y se repite cada minuto. Tras un timeout de carga, espera al menos dos minutos y mantiene la vigilancia si Cloudinary todavía responde que la imagen no existe. Así puede limpiar una finalización remota tardía. Las eliminaciones fallidas conservan su registro para reintento. Los recursos se eliminan únicamente si están sin referencias, tienen el namespace generado por el servidor y el contexto remoto identifica a esta API y al producto. Los identificadores históricos o sin esa prueba de propiedad se archivan en registros `.preserved.json` y se conservan en Cloudinary. Las imágenes de productos borrados lógicamente permanecen referenciadas.

El directorio del diario requiere almacenamiento persistente y permisos de escritura, ya cubierto por el montaje `log` de Compose. Está excluido de Git y del contexto de construcción Docker. Este mecanismo está preparado para la ejecución actual de una instancia por directorio de recuperación. La operación con varias instancias que compartan el directorio requiere coordinación adicional antes de desplegarse. MySQL y Cloudinary no comparten una transacción distribuida. Un fallo permanente del proveedor, de la base o del almacenamiento local requiere revisar los registros pendientes.

Los eventos de escritura del catálogo insertan el contrato nuevo de `audit_logs` y completan las columnas históricas mientras existan. La auditoría conserva el comportamiento de registro posterior a la operación. Si falla, emite un aviso seguro y requiere supervisión. La adaptación de los demás consumidores de auditoría sigue pendiente.

### Archivos modificados

| Área | Archivos |
| --- | --- |
| Modelos | `models/product.js`, `models/category.js`, `models/product-category.js`, `models/file.js` |
| Catálogo e imágenes | `services/catalog.service.js`, `services/cloudinary.service.js`, `services/product-images.service.js`, `controllers/products.controller.js`, `controllers/categories.controller.js`, `controllers/files.controller.js`, `middlewares/upload.middleware.js` |
| Rutas | `routes/products.routes.js`, `routes/categories.routes.js`, `routes/files.routes.js` |
| Dependencias y configuración | `package.json`, `package-lock.json`, `.env.example`, `docker-compose.yml`, `.gitignore`, `.dockerignore`, `index.js` |
| Contratos y documentación | `services/swagger-contract.service.js`, `examples/api.http`, `README.md`, este reporte |
| Pruebas | `tests/integration/products.routes.test.js`, `tests/integration/categories.routes.test.js`, `tests/integration/files.routes.test.js`, `tests/integration/english-contract.test.js`, `tests/unit/upload.middleware.test.js`, `tests/unit/cloudinary.service.test.js`, `tests/unit/product-images.service.test.js`, `tests/support/auth-fixtures.js`, `tests/database/catalog.mysql.test.js`, `tests/support/catalog-final-schema.js`, `tests/database/schema.mysql.test.js` |

### Pruebas y problemas resueltos

- La suite sin MySQL comprueba permisos, entrada, contrato Swagger, imágenes en memoria y recuperación de errores simulados de Cloudinary. En el primer recorrido pasaron 108 pruebas y fallaron diez del contrato por una suposición del generador Swagger sobre la respuesta `200` de archivos. Se corrigió la respuesta explícita y pasaron las diez pruebas del contrato. Las pruebas de seguridad de cuentas de la etapa 3A siguen incluidas.
- La verificación final `npm.cmd test -- --testPathIgnorePatterns=tests/database` pasó **121 pruebas en 18 suites**. Incluye los casos de finalización tardía de subidas, recursos históricos y borrado lógico. `git diff --check` y la validación de Compose también terminaron correctamente. El hash del Word coincide con el original y la rama es `feature/secure-ecommerce-db`.
- Los ensayos reales usaron MySQL **8.0.46**, contenedor `secure-ecommerce-stage3b`, publicado únicamente en `127.0.0.1:13307`, con credenciales aleatorias y almacenamiento anónimo independiente. Antes de cada preparación se verificaron contenedor, puerto, montajes, UUID del servidor y cuentas. La cuenta `ecommerce_app` tuvo permisos por tabla sin `DELETE` ni DDL.
- En la instancia temporal se aplicaron las ocho migraciones históricas y las dos aditivas a `secure_ecommerce`, conservando las 16 tablas de negocio y `SequelizeMeta`. En otra base temporal, `secure_ecommerce_3b_final_test`, se cargó DDL independiente para las ocho tablas de cuentas, catálogo y auditoría que utiliza este ensayo, con las columnas definitivas y sin `roles` ni `files`. Ese fixture comprueba la compatibilidad del catálogo con las columnas finales. La migración de cierre quedó fuera del ensayo.
- El primer ensayo pasó **18 de 18** pruebas reales. Después se agregó el caso de suspensión durante una carga y se repitió la cadena en un contenedor vacío. `npm.cmd test -- --runTestsByPath tests/database/catalog.mysql.test.js` pasó **20 de 20 pruebas**, diez por cada forma del esquema. Se probaron altas por vendedor aprobado, denegación de otros perfiles y propietarios, precio e inventario, capacidad DECIMAL de cada esquema, asociaciones concurrentes, reactivación, borrado lógico, imágenes, compensación SQL, timeout remoto, reintento de limpieza, imágenes históricas, suspensión y auditoría del catálogo.
- Se retiraron los dos contenedores temporales después del ensayo. La limpieza verificó sus identificadores y montajes antes de detenerlos.
- Cloudinary se simuló en todas las pruebas. La prueba del SDK verificó sus opciones y flujo de carga firmado. La integración con una cuenta real del proveedor queda pendiente. Una comprobación inicial de aprovisionamiento tuvo un error de cita de literales SQL en PowerShell. Se corrigió antes de crear los esquemas del ensayo. Las migraciones terminaron correctamente y conservaron su contenido.
- La instalación de dependencias informó 23 avisos de auditoría del árbol instalado, cuatro bajos y diecinueve moderados. La revisión general de esas dependencias queda pendiente de un trabajo específico.

### Transición y siguiente etapa

El catálogo ya usa las columnas definitivas y se probó también con las tablas de transición. Al crear una asociación completa `product_categories.updatedAt` únicamente si la columna histórica existe. Lee la precisión real de `products.price`: el destino transitorio `DECIMAL(10,2)` rechaza con `409` los importes que requieren la futura ampliación a `DECIMAL(12,2)`. Los productos históricos necesitan vendedor, cuenta verificada, aprobación, inventario y datos reconciliados antes de publicarse. El cliente debe consumir `imagePublicId` o `imageUrl` y las nuevas rutas.

Para retirar `files` falta inventariar sus BLOB y archivos de `uploads`, verificar todos los consumidores y las referencias compartidas, transferir los recursos autorizados a Cloudinary y comprobar el mapa `fileId` a `imagePublicId`. Deben conservarse respaldos y la evidencia de esa transferencia antes de retirar las columnas y la tabla en el cierre aprobado. Las lecturas históricas siguen disponibles durante esa transición. Los seeders anteriores y otros consumidores del esquema antiguo también necesitan revisión antes del cierre.

Quedan pendientes configurar y verificar Cloudinary en el despliegue autorizado, supervisar el diario persistente y los avisos de auditoría, adaptar carrito y pedidos en sus etapas respectivas y ensayar el cierre completo hasta las 14 tablas del Word más `SequelizeMeta`. Las bases habituales y el destino configurado de la API conservaron su estado.

## Etapa 4 — Base de datos definitiva

### 1. Base y servidor utilizados

**Resultado: base creada, cierre aplicado y comprobaciones completadas en MySQL real.** La verificación final se registró el 10 de noviembre de 2026, a las 23:17:45 de Ciudad de México (11 de noviembre, 05:17:45 UTC).

| Dato | Valor comprobado |
| --- | --- |
| Conexión desde Windows | `127.0.0.1:3307` |
| Base nueva | `secure_ecommerce` |
| Motor | MySQL **8.0.46**, InnoDB |
| Contenedor | `ecommerce_db`, ID `29e92b602f717a55be5195e1ef823545844d7cd6ef87eca45bd59800ec823142` |
| UUID del servidor | `b68c7b62-dc02-11f1-b706-caca74da477e` |
| Puerto interno del servidor | `3306`, publicado en `3307` |
| Administración | `root@localhost`, socket dentro del contenedor |
| Migraciones y comprobaciones de estructura | `ecommerce_migrator@%`, TCP |
| Ejecución futura de la aplicación | `ecommerce_app@%`, TCP |
| Fechas de las conexiones de trabajo | UTC, `+00:00` |

La inspección inicial confirmó que `secure_ecommerce` **no existía**, que sí existía `mercadolibrenode` y que las dos cuentas nuevas no existían. Se utilizó `CREATE DATABASE` sin `IF NOT EXISTS`, sin importar datos ni ejecutar seeders. Antes de aprovisionar, migrar, reanudar y probar se verificaron servidor, puerto, base y usuario. Se conservaron el modo estricto y `foreign_key_checks=1`.

No se ejecutó ninguna escritura en `mercadolibrenode`, ni `DROP DATABASE`, ni eliminación de volúmenes o contenedores. El volumen existente `secure-ecommerce-api_mysql_data` se conservó. No se cambió de rama ni se hizo commit o push. El Word y las ocho migraciones históricas conservan sus hashes anteriores al trabajo; además, las ocho coinciden con Git. SHA-256 del Word: `d9d8884cd43911bf34d0762b3d012b39da050bd7393a47144f1720389ebd3ec2`.

Aunque el destino se creó vacío, se hicieron volcados antes de sus siguientes cambios. Cada volcado se verificó leyendo de nuevo el archivo, comprobando SHA-256, terminación correcta de `mysqldump`, presencia de los DDL esperados y ausencia de filas de negocio en la base. Los respaldos incluyen `SequelizeMeta` cuando existe; no contienen cuentas ni contraseñas. Se conservan localmente en `log/stage4/`, excluido de Git y de la imagen Docker. No se ensayó una restauración en esta instancia compartida.

| Respaldo | Tamaño | SHA-256 |
| --- | --- | --- |
| `before-migrations.sql` | 1 260 bytes | `c5c250dc951625ac01cdd9a04d09145f1f7be2e63734759738d6c78e69f7d0f3` |
| `before-cutover.sql` | 21 051 bytes | `4e63c26bd83fe92a326ade1b5ba97af9ad3800a25e5bc3a1796f25d5d487df2b` |
| `before-cutover-resume.sql` | 20 991 bytes | `8da6ea0f7ef9a73b3ab0ec3bf64a0606eb53fff05d932944689275d690fedd04` |
| `final-empty.sql` | 19 136 bytes | `430e6f48fc1be84cbae9db8f49b4c4ed0d220cbfc0e12ad0d3f9fd745d49f3aa` |

### 2. Migraciones ejecutadas

Se mantuvo la ruta histórica, porque funcionó desde cero sin datos ni dependencias adicionales. `SequelizeMeta` contiene exactamente estas **11 entradas**:

```text
20240101000001-create-archivo.js
20240101000002-create-rol.js
20240101000003-create-categoria.js
20240101000004-create-producto.js
20240101000005-create-categoriaproducto.js
20240101000006-create-usuario.js
20240101000007-create-bitacora.js
20261108000001-normalize-english-schema.js
20261110000001-create-secure-ecommerce-tables.js
20261110000002-prepare-existing-ecommerce-tables.js
20261110000003-finalize-secure-ecommerce-schema.js
```

Las diez primeras se ejecutaron con `config/secure-ecommerce-migrations.js --env migration`. La última se ejecutó desde `migrations/cutover/`, usando la autorización explícita del usuario exclusivamente para esta base nueva, identificada y sin filas de negocio. `roles` y `files` estaban vacías cuando se retiraron. No se inventaron correos verificados, perfiles, inventario ni referencias históricas para superar validaciones.

Después del cierre se ejecutó de nuevo la ruta normal con la configuración dedicada:

```powershell
npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration
```

Resultado real: `No migrations were executed, database schema was already up to date.` Las 11 entradas de historial permanecieron iguales y no se reconstruyeron tablas antiguas. El comando sin `--config` conserva su configuración anterior y no se utilizó para este destino.

### 3. Tablas creadas: resultado real de SHOW TABLES

```text
Tables_in_secure_ecommerce
SequelizeMeta
admins
audit_logs
buyers
cart_items
carts
categories
order_items
order_status_history
orders
product_categories
products
sellers
user_addresses
users
```

**Exactamente 14 tablas de negocio más `SequelizeMeta`**, sin `roles`, `files`, tablas adicionales ni vistas. Tras las pruebas se comprobó `COUNT(*) = 0` en cada una de las 14 tablas de negocio. Las inserciones revertidas pueden dejar saltos en sus contadores `AUTO_INCREMENT`; no se reiniciaron ni se truncaron tablas.

### 4. Restricciones verificadas

La comprobación independiente del diccionario del Word contrastó **99 columnas** con `information_schema`, sin derivar el contrato de las migraciones. Se inspeccionaron los 15 resultados de `SHOW CREATE TABLE`, todas las PK, **18 FKs**, índices, defaults, nulabilidad y los **7 CHECK activos**. Las evidencias están en `log/stage4/schema-verification.json`.

| Comprobación directa | Resultado |
| --- | --- |
| Columnas y tipos de las 14 tablas | Conjunto exacto, longitudes y `NOT NULL` según el diccionario; sin columnas históricas sobrantes. |
| Identificadores y relaciones | PK correctas, PK de `product_categories` en orden `(productId, categoryId)`. Tipos, charset y colación iguales en cada FK y su referencia. Todas las referencias quedan dentro de `secure_ecommerce`. |
| Reglas referenciales | Las 18 FKs tienen `ON DELETE RESTRICT ON UPDATE RESTRICT`; cada columna de FK dispone de un índice utilizable. |
| Importes | `products.price`, `orders.total` y `order_items.unitPrice`: `DECIMAL(12,2)`, obligatorios, con CHECK no negativo. |
| Cantidades e inventario | `stock` y cantidades `INT UNSIGNED`; `quantity > 0` en carrito y detalle. |
| Unicidad | Correo, nombre de categoría, comprador de carrito, `(cartId, productId)` y `(checkoutId, sellerId)`. Las claves siguen reservadas tras el borrado lógico. |
| Dirección predeterminada | Índice único funcional por comprador cuando `isDefault=1 AND deletedAt IS NULL`; admite varias direcciones adicionales y reemplazo tras borrado lógico. CHECK 0/1. |
| Estados | ENUM de cuentas, vendedores y pedidos con defaults `ACTIVE`, `PENDING` y `PENDING`. Los estados del historial reutilizan el ENUM de pedidos, conforme a la aclaración ya adoptada en etapa 2; `previousStatus` admite NULL y `newStatus` es obligatorio. El Word muestra VARCHAR(20) en esas dos filas, pero su convención general exige ENUM. |
| JSON | Snapshot de dirección obligatorio y detalles de auditoría opcionales; MySQL rechaza JSON inválido. |
| Fechas y borrado lógico | Todos los campos temporales son `DATETIME(3)`. `deletedAt` solo en las siete entidades previstas: usuarios, direcciones, categorías, productos, asociaciones, carritos e ítems de carrito. |
| Defaults adicionales | País `MX`, dirección no predeterminada, categoría no protegida e inventario 0. |
| Históricos | Pedidos, detalle, historial y auditoría sin `deletedAt`; permisos de aplicación restringidos para conservar snapshots y registros. |

La exclusividad transversal y existencia de exactamente un perfil por cuenta siguen siendo reglas transaccionales de integración, tal como advierte el Word. Las FKs no garantizan por sí solas esa regla ni el total calculado, la pertenencia de productos al vendedor del pedido, la forma de los objetos JSON o las transiciones permitidas. No se añadieron tablas, discriminadores ni triggers fuera del diseño para cambiar ese contrato.

### 5. Pruebas realizadas y resultados

| Ejecución | Resultado |
| --- | --- |
| `node scripts/database/stage4-verify.js schema` | Contrato completo de estructura aprobado en MySQL 8.0.46. |
| `node scripts/database/stage4-verify.js data` | **38 comprobaciones aprobadas** en MySQL. |
| `node scripts/database/stage4-verify.js application` | **28 comprobaciones de permisos aprobadas** con `ecommerce_app`. |
| `npm.cmd test -- --runTestsByPath tests/unit/secure-ecommerce-migrations.test.js` | **18 pruebas aprobadas**, incluida la regresión de la FK de vendedor. |
| `node scripts/database/stage4.js final` | Tablas exactas, 11 migraciones, cero filas de negocio, migrador limitado al esquema y hashes del Word/historial intactos. |
| Validación sintáctica de los tres scripts y `git diff --check` | Correctos. |

Se insertaron datos sintéticos válidos en las 14 tablas, usando UUID aleatorios, correos `example.invalid` y hashes bcrypt. Se probaron relaciones válidas y rechazo de padres inexistentes, perfiles incorrectos, correos/categorías/asociaciones duplicados, carritos duplicados incluso desactivados, ítems duplicados y reintentos duplicados de pedido. Se verificaron la dirección predeterminada, su reemplazo y la reactivación conflictiva.

MySQL rechazó precios/totales negativos, cantidades cero/negativas, stock negativo, valores booleanos/ENUM inválidos, verificación de correo nula, vendedor nulo, snapshot nulo o JSON inválido y cambio de una PK referenciada. Se aceptó `9999999999.99` y se rechazó el desbordamiento de `DECIMAL(12,2)`. Al modificar y ocultar el producto y editar la dirección original, título, precio, total y JSON históricos permanecieron iguales.

La cuenta de aplicación pudo insertar en sus 13 tablas autorizadas, leer sus 13 tablas autorizadas y actualizar el estado del pedido. Se rechazaron la creación de administradores, la modificación de total/comprador/snapshot, de título/precio históricos y de historial/auditoría. También se rechazaron la lectura de auditoría aún no autorizada, el acceso a `SequelizeMeta` y a cuentas administrativas. Se comprobó la denegación de `DELETE` en las 14 tablas mediante sentencias con condición siempre falsa; no se borró ninguna fila.

Los dos ensayos de datos usaron transacciones con `ROLLBACK` en `finally`. Después se confirmó de nuevo que las 14 tablas estaban vacías. Evidencias locales: `data-tests.json`, `application-tests.json`, `account-grants.txt`, `migrations.json` y `final-result.json`, dentro de `log/stage4/`. No se ejecutaron suites históricas que crean otras bases ni seeders.

### 6. Errores y correcciones

1. El sandbox impidió leer la configuración de Docker. Se autorizó el acceso externo para identificar el contenedor y administrar exclusivamente el destino verificado. Una consulta inicial mediante citas anidadas de PowerShell devolvió error SQL 1064 sin ejecutar escrituras; se sustituyó por argumentos estructurados y SQL por entrada estándar.
2. El primer cierre ajustó `users` y `categories`, pero MySQL rechazó modificar la nulabilidad de `products.sellerId` mientras existía `products_seller_fk`. Se detuvo la ejecución, se inspeccionaron el DDL real y las diez entradas de `SequelizeMeta`, se comprobaron cero filas y se respaldó el estado parcial. Se corrigió **solo la migración de cierre**, retirando primero esa FK y restaurándola con reglas restrictivas dentro del ALTER que cambia la columna. El marcador `fileId` permite reentrada si se interrumpe entre ambos ALTER. No se desactivó `foreign_key_checks`. La reanudación terminó correctamente; la aplicación todavía no tenía cuenta ni podía escribir durante ese intervalo.
3. La primera prueba de FK esperaba solamente el código detallado 1452; MySQL devolvió su variante genérica 1216. Se ajustó el verificador para admitir ambas variantes de FK, conservando la exigencia de rechazo. La transacción fallida se revirtió y se comprobó vacía antes de repetir; las 38 comprobaciones posteriores pasaron.

### 7. Configuración preparada

- `config/secure-ecommerce-migrations.js` mantiene el destino dedicado y la cuenta `ecommerce_migrator`. `.env.migration.local` contiene su secreto generado por MySQL, fuera del código y excluido de Git/Docker. El migrador tiene solo `SELECT, INSERT, UPDATE, CREATE, ALTER, INDEX, REFERENCES, DROP` sobre el nombre exacto de la nueva base, sin privilegios globales, `GRANT OPTION` ni `DELETE`. El guion bajo está escapado en el GRANT porque `partial_revokes=0`; el permiso no alcanza a otras bases.
- `.env.secure-ecommerce.example` documenta la futura integración. `.env.secure-ecommerce.local` ya contiene el destino y el secreto independiente de `ecommerce_app`, también ignorado. La API y Compose **no cargan automáticamente ese archivo**. `.env.example`, `config/config.js`, Compose y el destino habitual de la API no se cambiaron en esta etapa. No se arrancó ni desplegó la API.
- `ecommerce_app` usa permisos por tabla: lectura de `admins`; lectura/inserción de `buyers`, `order_items` y `order_status_history`; solo inserción en `audit_logs`; lectura/inserción y UPDATE limitado a `status, updatedAt` en `orders`; lectura/inserción/actualización en las demás entidades editables. Carece de `DELETE`, DDL, administración, `GRANT OPTION` y acceso a `SequelizeMeta`. Ambas cuentas usan `caching_sha2_password`, están habilitadas y tienen su ámbito de datos limitado a `secure_ecommerce`.
- Los scripts `scripts/database/stage4*.js` conservan las operaciones y verificaciones revisables, con identidad de contenedor/servidor fijada para esta ejecución. El aprovisionamiento rechaza destinos/cuentas preexistentes; la construcción rechaza tablas existentes y la reanudación exige el historial y estado vacío esperados. Los artefactos no se sobrescriben automáticamente. No deben usarse como un mecanismo de restauración o recreación de una base que reciba datos posteriormente.
- No se configuraron credenciales de Resend ni Cloudinary. No se creó una cuenta ADMIN real ni registros de demostración permanentes.

### 8. Pendientes exclusivamente de integración del backend

| Elemento revisado | Estado y adaptación pendiente |
| --- | --- |
| `User`, `Admin`, `Buyer`, `Seller`, `Product`, `Category`, `ProductCategory` | Sus columnas, tipos, fechas, asociaciones y borrado lógico son coherentes con las tablas finales. `accounts.service.js` detecta la ausencia de `roleId` y puede usar su camino final; no necesita un rol histórico en esta base. |
| `Role` y `File` | Siguen cargándose en `models/index.js` y apuntan a tablas retiradas. `/api/roles` y las lecturas de `/api/files` deben retirarse o adaptarse antes de conectar la API al destino. No ejecutar `sync`, `sync({alter:true})` ni seeders históricos para intentar satisfacer esas dependencias. |
| `AuditLog`, middleware, controlador y Swagger de auditoría | Conservan `elementId`, `ip`, `user`, `date` y timestamps automáticos que ya no existen; faltan los campos finales y la FK de actor. Adaptar modelo, escrituras y contrato de lectura. La lectura deberá autorizarse explícitamente antes de concederla a la cuenta SQL. Las escrituras específicas de cuentas/catálogo ya detectan las columnas finales, pero no sustituyen esta adaptación general. |
| Direcciones, carrito, pedidos y su historial | No existen todavía los seis modelos Sequelize correspondientes. Implementarlos junto con sus módulos en etapas posteriores; el DDL y las restricciones ya están disponibles. |
| Reglas transaccionales y autorización | Mantener un solo perfil por cuenta bajo concurrencia; comprobar vendedor aprobado y propietario; implementar checkout atómico, inventario, consistencia de total/detalle, reintentos por contenido y transiciones con motivo cuando corresponda. Los permisos ya impiden a la cuenta de aplicación editar los snapshots confirmados. |
| Primera cuenta administrativa y conexión | Aprovisionar un ADMIN verificado mediante un proceso protegido, sin inventar datos; completar la adaptación anterior y luego activar explícitamente la configuración preparada. Revisar contratos, pruebas y proveedores externos antes de desplegar. |

La base de datos definitiva queda terminada y verificada para su integración posterior. Ningún módulo del backend se desarrolló ni se cambió su destino en esta etapa.

# Etapa 5 — Integración completa y segura del backend

**Estado actual: implementación de módulos y conexión definitiva comprobadas; cierre pendiente del permiso de lectura administrativa de auditoría y de validación remota del Quality Gate.** La sección «Continuación verificada» al final registra el estado más reciente. Los apartados intermedios conservan la evidencia del primer avance, cuando solo direcciones estaba integrado. Se mantiene `feature/secure-ecommerce-db`, sin commits, push ni PR. No se modificaron el Word, las migraciones ni el esquema definitivo; no se ejecutaron migraciones, sync o seeders en la base habitual.

## Funcionalidad implementada y arquitectura

Se añadió el módulo de direcciones: modelo `UserAddress`, validador estricto, servicio transaccional, controlador HTTP y rutas. Cada escritura bloquea primero la fila del comprador en `users`, comprueba su estado y perfil y después opera exclusivamente sobre direcciones de su propiedad. La selección de predeterminada retira la anterior dentro de la misma transacción; el índice único funcional existente protege también el acceso SQL directo. El borrado utiliza `paranoid`. Las direcciones ajenas responden 404 y los campos de propiedad y fechas no son asignables por el cliente. Los errores inesperados devuelven un mensaje genérico. Se preservan los identificadores de entrada como cadenas BIGINT y se serializan como texto en HTTP.

Archivos añadidos: `models/user-address.js`, `validators/address.js`, `services/addresses.service.js`, `controllers/addresses.controller.js`, `routes/addresses.routes.js`, `tests/unit/addresses.test.js`, `tests/unit/address-openapi.test.js`, `tests/integration/addresses.routes.test.js` y `scripts/database/stage5-addresses-test.js`. Archivos existentes modificados en este avance: `index.js`, `services/swagger-contract.service.js`, `examples/api.http`, `README.md` y este reporte. Los cambios anteriores del resto del repositorio se conservaron.

## Conexión, rutas y Swagger

La configuración habitual **no se activó**: la integración completa todavía no ha superado sus pruebas. `.env.secure-ecommerce.local` se conserva preparado, sin publicar su secreto ni cargarlo automáticamente. No se arrancó la API contra `mercadolibrenode` ni se escribieron datos en el destino habitual.

| Ruta | Perfil y resultado |
| --- | --- |
| `GET /api/addresses` | BUYER, lista solo direcciones propias activas, 200. |
| `POST /api/addresses` | BUYER, valida y crea dirección propia, 201. |
| `PUT /api/addresses/:id` | BUYER propietario, actualización parcial validada, 204. |
| `DELETE /api/addresses/:id` | BUYER propietario, borrado lógico, 204. |
| `PUT /api/addresses/:id/default` | BUYER propietario, cambia la predeterminada con serialización, 204. |

`npm run swagger` terminó correctamente después de repetirlo fuera del sandbox por permisos del archivo generado. Se documentaron los cinco endpoints, cuerpos permitidos, campos obligatorios, límites, IDs como texto, JWT, propiedad y respuestas de error. Se actualizaron ejemplos HTTP y se añadió una prueba del contrato OpenAPI. El artefacto `swagger-output.json` sigue ignorado por Git. La documentación general aún incluye los recursos antiguos hasta completar su retirada; no se afirma que toda la API esté adaptada.

## Pruebas y cobertura comprobadas

La ejecución inicial de cobertura encontró EPERM al escribir `coverage/` y `log/log.txt`; se repitió con autorización externa sin cambiar pruebas ni exclusiones. El punto de partida pasó **122 pruebas**, con **37 pruebas de MySQL omitidas** al no habilitar sus entornos. Cobertura inicial: 74,66 % sentencias, 64,26 % ramas, 76,80 % funciones y 78,04 % líneas.

La ejecución posterior a la instalación limpia y al módulo de direcciones pasó **156 pruebas en 21 suites**, con las mismas **37 pruebas MySQL omitidas en cuatro suites**. Cobertura: **76,15 % sentencias, 63,73 % ramas, 80,34 % funciones y 78,83 % líneas**. El servicio y el validador nuevos alcanzaron 100 % de líneas; el servicio alcanzó 92,85 % de ramas y el validador 100 %. El descenso global de ramas respecto al punto de partida está visible y sigue pendiente de mejorar; no se considera cumplido el Quality Gate. No se consultó ni ejecutó el gate real de SonarQube Cloud.

Las 34 pruebas nuevas cubren validaciones, campos desconocidos, longitudes, caracteres de control, nulabilidad, límites BIGINT, autenticación/perfil, propiedad, serialización de escrituras, selección de predeterminada, borrado lógico, errores y contrato Swagger. Se ejecutó además el ensayo real `node scripts/database/stage5-addresses-test.js`: contenedor independiente `secure-ecommerce-stage5-addresses`, MySQL 8.0, puerto **127.0.0.1:13308**, almacenamiento tmpfs y secretos aleatorios de proceso. Se verificaron ID, montajes, hostname y UUID, y se contrastó UUID por socket y TCP antes del aprovisionamiento.

El ensayo cargó exclusivamente el DDL definitivo guardado en la evidencia local de etapa 4, sin migraciones ni seeders históricos. Aprovisionó los mismos GRANT de `ecommerce_app`, identificó la conexión de Sequelize y ejecutó endpoints HTTP reales con usuarios sintéticos. Comprobó dos creaciones concurrentes con `isDefault=true` y exactamente una predeterminada activa al terminar, rechazo de edición/borrado ajenos, cambio de predeterminada, lectura propia y persistencia del borrado lógico. Resultado: **PASS**. Se verificó el ID del contenedor antes de detenerlo y retirarlo, sin volúmenes compartidos ni acceso al puerto 3307. Este script depende de las evidencias locales de etapa 4: todavía no es una suite portable para CI ni cubre los demás módulos.

## Dependencias y workflows

`npm ci --ignore-scripts` terminó correctamente: 477 paquetes instalados, 478 auditados. `npm audit --audit-level=high` terminó con código 0: **23 avisos (4 bajos, 19 moderados), sin altos/críticos**. Los avisos incluyen deepmerge, glob y minimatch y sus consumidores transitivos de herramientas de desarrollo. No se aplicó `audit fix --force`; la remediación compatible sigue pendiente. No se introdujeron overrides para ocultar avisos.

Se revisaron `test.yml`, `sonar.yml`, `docs.yml` y `sonar-project.properties`. No se alteraron workflows, métricas ni exclusiones. La instalación y cobertura se ejecutaron con Node.js local 24.13.1; **todavía falta ejecutarlas con Node.js 20/Linux**, así como los workflows reales, análisis estático y Quality Gate remoto. `npm run docs:build` terminó correctamente. El generador de diagramas falló en el sandbox por acceso a red; su código existente captura los errores y anuncia éxito, por lo que el código de salida 0 de esa ejecución **no valida** los diagramas.

La revisión automática de permisos rechazó repetir `docs:diagrams` fuera del sandbox porque el generador envía fuentes de arquitectura a `www.plantuml.com`. Se solicitó una preferencia explícita entre generación local y autorización del envío; mientras no exista esa autorización no se reintentará el envío. Queda pendiente preparar/verificar una alternativa local o el envío autorizado y corregir la propagación de errores del generador.

## Servicios externos, respaldo y requisitos pendientes

Cloudinary y Resend continúan sin credenciales reales configuradas. Las pruebas de proveedores existentes usan mocks; el ensayo nuevo de direcciones no utiliza ninguno de esos proveedores. No se ha probado envío de correo o carga real de imágenes.

El inventario, respaldo de `mercadolibrenode` y `uploads/`, y la restauración aislada de ese respaldo **todavía no se han ejecutado en etapa 5**. No se preparó ni ejecutó su eliminación. La autorización futura para borrar la base antigua sigue siendo obligatoria e independiente.

Requisitos críticos pendientes antes del PR/despliegue: completar carrito, checkout, pedidos e historial y sus cinco modelos; retirar Role/File y las rutas/columnas/variables de transición; adaptar auditoría y sus permisos de lectura; registrar eventos de direcciones mediante la auditoría final; revisar exhaustivamente autenticación y catálogo; preparar el procedimiento de ADMIN inicial; implementar y ejecutar integración real de todos los módulos, concurrencia de stock e idempotencia; aumentar/revisar cobertura y gate; remediar dependencias compatibles; comprobar Node 20/Linux y workflows; respaldar/restaurar origen y archivos; activar la configuración definitiva solo después de superar el conjunto completo y probar arranque/lectura contra la base habitual. No se han cumplido todavía los criterios de cierre de etapa 5.

## Continuación verificada — 11 de noviembre de 2026

### Compatibilidad y seguridad

Se retiraron los modelos `Role` y `File`; `models/index.js` registra explícitamente los 14 modelos de negocio. Las rutas antiguas conservan respuestas **410** sin consultar tablas ni almacenamiento histórico. Se retiraron `roleId`, `TRANSITION_USER_ROLE_ID` y las escrituras condicionales de columnas antiguas de cuentas, catálogo y auditoría. Las referencias restantes en migraciones y sus pruebas son históricas, no dependencias de ejecución de la API. Los seeders históricos rechazan `DATABASE() = 'secure_ecommerce'` antes de consultar o insertar registros de negocio.

Se mantuvieron bcrypt, OTP con HMAC/expiración/intentos/reenvíos, JWT HS256 de 20 minutos y renovación en los últimos cinco minutos, comprobaciones del perfil vigente y vendedores aprobados. Se añadió un límite compartido de **30 solicitudes por IP/minuto** en login y registro, con memoria acotada y `Retry-After`; sus límites son locales a la instancia, como los procesos de registro pendientes. Un despliegue con varias instancias requiere coordinación en el proxy/almacenamiento compartido. CORS rechaza comodines. Los errores no exponen stacks o diagnósticos SQL tampoco en desarrollo; el registro de errores conserva clasificación, actor e IP, sin mensajes arbitrarios que puedan contener contraseñas, OTP o cuerpos JSON.

Archivos: `models/index.js`, retirada de `models/role.js` y `models/file.js`, `services/accounts.service.js`, `services/catalog.service.js`, `services/seed-data.service.js`, controladores de archivos/roles/autenticación, middlewares de autenticación/errores, nuevo `middlewares/auth-rate-limit.middleware.js`, rutas, configuración, Compose y pruebas correspondientes. No se borraron imágenes ni archivos históricos.

### Auditoría

`AuditLog` utiliza exactamente las columnas definitivas, sin timestamps automáticos, con FK al actor. `services/audit.service.js` centraliza escritura, validación, saneamiento de metadatos mediante lista permitida y lectura paginada; middleware y controladores usan este contrato. Las operaciones relevantes de cuentas, vendedor, catálogo, direcciones, carrito, pedidos y accesos rechazados registran actor comprobable o NULL, acción, resultado, IP y fecha. No se registran contraseñas, JWT, cotizaciones firmadas ni códigos de correo. Pedido/historial/auditoría se escriben en la misma transacción de checkout y transiciones. Las operaciones anteriores de catálogo/direcciones/carrito mantienen auditoría posterior con aviso seguro si falla, sin afirmar atomicidad de esas dos escrituras.

Se bloquean UPDATE/DELETE de auditoría desde hooks Sequelize y permisos MySQL. `GET /api/audit-logs` requiere ADMIN y admite `before` y `limit` (1..100); no devuelve `details`. El endpoint está documentado y se probó con MySQL real y **SELECT por columnas exclusivamente en fixtures aislados**, incluida la denegación de lectura de `details`, UPDATE y DELETE.

**Permiso pendiente en el servidor habitual:** la cuenta actual tiene INSERT en auditoría y carece de SELECT. La API devuelve **503 controlado** al intentar esa lectura. Se solicitó autorización explícita para el siguiente cambio de permisos; **no se ejecutó**, respetando el alcance de solo lectura del servidor habitual:

```sql
GRANT SELECT (id, actorUserId, action, targetType, targetId, ipAddress, outcome, occurredAt)
ON secure_ecommerce.audit_logs TO 'ecommerce_app'@'%';
```

Archivos: `models/audit-log.js`, `services/audit.service.js`, `middlewares/audit-logs.middleware.js`, controlador/ruta de auditoría, consumidores y Swagger. Se adaptaron las pruebas de nombres antiguos a los campos finales; no se conservaron contratos inválidos para hacerlas pasar.

### Carrito

Se implementaron `Cart` y `CartItem`, validador, servicio, controlador y cuatro endpoints: `GET /api/cart`, `POST /api/cart/items`, `PUT /api/cart/items/:productId`, `DELETE /api/cart/items/:productId`. El comprador se deriva exclusivamente de la cuenta autenticada. Las escrituras se serializan bloqueando su fila de usuario, incluida la primera creación; no se aceptan precios ni propietarios desde el cliente. Se validan producto vigente, vendedor activo/aprobado, cantidades positivas e inventario. Se reutilizan carrito e ítems retirados mediante borrado lógico. El GET calcula precios actuales y disponibilidad; no reserva stock. Los importes se calculan con BigInt en centavos y se devuelven como cadenas decimales.

Pruebas unitarias/HTTP cubrieron validación, límites, permisos, fallos, ámbito del propietario y Swagger. El ensayo MySQL real comprobó altas concurrentes sin duplicados, separación entre compradores, inventario insuficiente, rechazo de vendedores suspendidos, reactivación de la misma línea y actualización del subtotal al cambiar el precio.

Archivos nuevos: `models/cart.js`, `models/cart-item.js`, `validators/cart.js`, `services/cart.service.js`, `controllers/cart.controller.js`, `routes/cart.routes.js`, `services/cart-openapi.js`, pruebas de lógica y HTTP. Direcciones se conservó y se conectó a la auditoría final.

### Checkout, pedidos e historial

Se implementaron los tres modelos restantes (`Order`, `OrderItem`, `OrderStatusHistory`), validador, servicios, controladores y rutas:

| Endpoint | Contrato |
| --- | --- |
| `POST /api/checkout/quote` | BUYER; recibe solo `addressId`, calcula el carrito actual y devuelve cotización firmada, dirección y pedidos previstos por vendedor. |
| `POST /api/checkout` | BUYER; recibe únicamente `quote`. 201 al crear y 200 en un reintento idéntico ya confirmado. |
| `GET /api/orders` | Hasta 100 pedidos recientes; comprador propio, vendedor propio aprobado o ADMIN. |
| `GET /api/orders/:id` | Ámbito del propietario/ADMIN, con detalles históricos e historial. |
| `PUT /api/orders/:id/status` | Transiciones autorizadas, con motivo obligatorio al cancelar. |

La cotización dura diez minutos y usa una clave HMAC derivada con dominio separado del JWT de sesión, emisor/audiencia propios, comprador y `checkoutId` generados por el servidor. Su contenido firmado vincula productos, vendedores, títulos, precios, cantidades y dirección. Se limita también el tamaño del token. Una alteración, otro comprador o campos adicionales son rechazados. Para compras nuevas se exige cotización vigente, dirección propia activa, mismo carrito y precios/dirección sin cambios; un **409 exige nueva cotización y reconfirmación**. No se confía en totales, precios o vendedores enviados libremente por el cliente.

Checkout bloquea comprador, vendedores y productos en orden estable, vuelve a comprobar disponibilidad y stock, calcula totales exactos con límite DECIMAL, crea un pedido por vendedor, detalle, historial inicial y auditoría, descuenta inventario y retira lógicamente las líneas dentro de una transacción. El reintento compara contra pedidos/detalles/snapshots persistidos y no descuenta nuevamente stock, incluso si la cotización ya confirmada caducó. La comparación de objetos JSON no depende del orden de claves que utiliza MySQL.

Transiciones: SELLER propietario aprobado o ADMIN puede preparar, enviar y entregar; BUYER solo cancela PENDING; SELLER/ADMIN cancela PENDING o PREPARING. Estados terminales y saltos inválidos se rechazan. No hay edición de snapshots ni borrado de pedidos. La cancelación **no repone automáticamente stock**: no se presupone devolución física ni se introduce otra escritura de inventario sin una política de devoluciones. Se usa UPDATE únicamente de `status, updatedAt`, conforme a los permisos SQL existentes.

Pruebas reales: cambio de precio exige reconfirmación; dos confirmaciones concurrentes producen un único resultado; dos compradores compiten por la última unidad y solo uno compra; pedidos independientes para dos vendedores; fallo simulado durante el segundo vendedor revierte también el primero; reintento después del fallo completa la compra; instantáneas sobreviven a cambios de catálogo/dirección; acceso ajeno 404; actor/comprador incorrecto, falta de motivo y transiciones inválidas rechazados. Historial y campos históricos protegidos por permisos SQL.

Archivos: tres modelos, `validators/orders.js`, `services/orders.service.js`, `services/checkout-quote.service.js`, `controllers/orders.controller.js`, rutas de checkout/pedidos, `services/orders-openapi.js` y pruebas. Se preservaron las 14 tablas sin añadir columnas.

### Pruebas ejecutadas, cobertura y diferencias entre mocks y persistencia

La última ejecución completa, anterior a retirar PlantUML del alcance, terminó con **204 pruebas aprobadas en 33 suites**: **196 corresponden al alcance conservado y 8 eran pruebas exclusivas de PlantUML, ahora retiradas**. No se repitió la suite tras revertir únicamente documentación/diagramas, siguiendo la instrucción de no repetir verificaciones aprobadas sin cambios del backend. El resumen exterior marcó **38 pruebas omitidas** por sus propias variables optativas. Esas pruebas **sí se ejecutaron por separado** en sus runners aislados; no se confunde su omisión en ese resumen con una aprobación:

| Grupo | Ejecución comprobada |
| --- | --- |
| Esquema histórico y seeders históricos | 3 pruebas aprobadas en `stage5-historical-tests.js`, exclusivamente en bases temporales de un servidor tmpfs. |
| Integridad de la transición | 8 pruebas aprobadas en ese mismo servidor aislado, con UUID/hostname y puerto verificados. |
| Cuentas/autenticación/aprobación | 7 pruebas aprobadas sobre fixture final, incluida lectura de columnas públicas de auditoría y permisos SQL. |
| Catálogo e imágenes | 20 pruebas aprobadas, dos ejecuciones independientes del mismo contrato definitivo. Cloudinary se simula; MySQL y HTTP son reales. |
| Flujo final integrado | Caso HTTP/MySQL real que incluye direcciones, carrito, auditoría, checkout, carreras de stock, dos vendedores, reversión y transiciones. |

Se adaptaron las suites previas de cuentas/catálogo a la eliminación deliberada del contrato transitorio: ya no esperan `roleId`, BLOB ni DECIMAL(10,2). Sus casos funcionales se conservaron; catálogo se repite sobre dos fixtures finales independientes. La revocación que antes escribía NULL en `emailVerifiedAt` ahora comprueba que MySQL rechaza ese NULL y prueba DISABLED. La verificación de un JWT sobre una cuenta no verificada sigue cubierta por pruebas del middleware. Los datos y privilegios adicionales de los fixtures nunca se aplicaron al servidor habitual.

Cobertura medida en esa ejecución con MySQL, **antes de la reversión de PlantUML**: **86,64 % sentencias, 74,54 % ramas, 91,38 % funciones y 90,28 % líneas**. No se presentan como una medición nueva posterior al cambio de alcance. Carrito: 100 % de líneas/ramas; pedidos: 100 % líneas y 80,26 % ramas; validadores nuevos: 100 % líneas/ramas; verificación de conexión: 100 %. El procedimiento interactivo de ADMIN solo tiene pruebas de la unidad transaccional: no se ejecutó con una identidad real ni se considera validado su envío real de correo. El **Quality Gate remoto no se ejecutó ni se declara aprobado**; las métricas globales no sustituyen el análisis de código nuevo de SonarQube Cloud.

`tests/support/final-schema.json` conserva únicamente DDL verificado y GRANT sin secretos, con el hash del Word como referencia; hace portable el ensayo y elimina su dependencia de artefactos locales ignorados. Los contenedores de ensayo usan tmpfs, se identifican antes de escribir y se retiran verificando su ID. Los reintentos fallidos de comandos/pruebas se investigaron y corrigieron, sin omitir verificaciones ni cambiar exclusiones de cobertura.

### Node 20/Linux, Swagger y exclusión de PlantUML

Se ejecutaron instalación limpia (`npm ci --ignore-scripts`), auditoría, pruebas, generación de Swagger y AsciiDoc dentro de una imagen Node 20/Linux. Además se ejecutó el flujo HTTP/MySQL y las 27 regresiones de cuentas/catálogo desde Node 20/Linux, compartiendo exclusivamente la red de un nuevo MySQL tmpfs; no se montó el socket Docker ni credenciales habituales en el ejecutor. Evidencias locales: `log/stage5/node20-build.log` y `node20-mysql.log`. El entorno es Linux Debian del contenedor Node, no una ejecución remota de GitHub Actions Ubuntu; no se afirma que esos jobs remotos ya hayan pasado.

**PlantUML queda excluido de esta etapa por la última instrucción del usuario.** Se revirtieron únicamente los cambios de esta ejecución: generador, `docs.yml`, doce SVG versionados y sus copias en `dist`; se retiraron la prueba dedicada nueva y el JAR descargado, y se quitaron instalación/renderizado del Dockerfile de validación Node 20. Los catorce archivos versionados restaurados estaban sin cambios al inicio de esta ejecución y se verificó que coinciden con su estado anterior. No se ejecutaron nuevamente diagramas ni pruebas ya aprobadas. Los logs anteriores se conservan como evidencia histórica, no como trabajo pendiente ni como validación exigida para cerrar esta etapa. Las menciones anteriores a un pendiente de PlantUML quedan fuera del alcance vigente.

`docs.yml` conserva su implementación anterior; no se modificó para ocultar fallos ni se declara validada su generación de diagramas dentro del alcance actual. Se conservan los cambios del backend en `test.yml` y `sonar.yml`: activan el ensayo MySQL final durante cobertura y añaden la prueba histórica en otro servidor temporal; no se debilitan fallos ni se modifican métricas/exclusiones de Sonar. Docker de la API usa `npm ci --ignore-scripts`. Se corrigieron diferencias de inferencia de swagger-autogen entre Windows/Linux documentando explícitamente las rutas retiradas y auditoría. Una prueba recorre **todos los endpoints registrados**, exige operación OpenAPI y comprueba que cada referencia a un esquema exista. Swagger y ejemplos incluyen carrito, cotización, checkout, pedidos e historial, además de los módulos anteriores.

### Conexión habitual y conservación de la base definitiva

Tras las pruebas aisladas se activó `.env`, ignorado por Git/Docker, usando la credencial preparada de `ecommerce_app`, un secreto JWT generado localmente y el UUID esperado. La API rechaza cualquier cuenta/base distintas en configuración habitual y verifica conexión, MySQL 8, modo estricto, FKs y conjunto final de tablas antes de escuchar. Se usan UTC y cadenas para BIGINT. Compose conserva el puerto 3307 y usa `db:3306` dentro de su red, con cuenta separada del migrador y sin credenciales reales de proveedores en archivos versionados.

Prueba real habitual: **127.0.0.1:3307**, MySQL **8.0.46**, `secure_ecommerce`, `ecommerce_app@%`, UUID `b68c7b62-dc02-11f1-b706-caca74da477e`; contraste de **14 modelos/99 columnas**, lecturas de catálogo/cuentas y arranque HTTP temporal en loopback. Las sondas de HTTP usan Swagger y 404; no generan registros de auditoría de autenticación. Solo se hicieron lecturas en MySQL habitual, sin demostraciones persistentes. `log/stage5/activation.json` documenta el resultado y que falta SELECT de auditoría.

Verificación administrativa final de solo lectura: **14 tablas de negocio más SequelizeMeta, 11 migraciones, COUNT(*)=0 en las 14 tablas**, sin roles/files. El Word conserva SHA-256 `d9d8884cd43911bf34d0762b3d012b39da050bd7393a47144f1720389ebd3ec2` y las ocho migraciones históricas conservaron sus hashes. Evidencia: `log/stage5/final-state.json`. No se ejecutaron DDL, migraciones, seeders, sync ni borrados de registros en el destino habitual.

### ADMIN inicial y proveedores

Se preparó `scripts/database/bootstrap-admin.js`: exige terminal protegida, no acepta argumentos de credenciales, oculta contraseña/OTP, verifica correo real con código de diez minutos/cinco intentos, comprueba base/cuenta/UUID y crea usuario, perfil ADMIN y auditoría en una transacción con parámetros. No lo invoca ninguna ruta pública. Requiere una cuenta independiente `ecommerce_admin_bootstrap`, cuyo secreto se carga mediante `.env.admin-bootstrap.local` (ignorado), variables `BOOTSTRAP_DB_USER`, `BOOTSTRAP_DB_PASSWORD`, `BOOTSTRAP_DB_UUID` y opcionalmente host/puerto. Un administrador deberá aprovisionarla con INSERT en `users`, `admins`, `audit_logs` y SELECT necesario en `users`, restringiendo el origen; la API conserva sus permisos actuales y no recibe INSERT en admins. No se ejecutó ese aprovisionamiento ni se inventaron nombre, correo o contraseña reales.

Resend y Cloudinary **no se probaron con proveedores reales** y siguen sin credenciales reales configuradas. Se probaron sus flujos con mocks, incluidos fallos y saneamiento de diagnósticos; la persistencia, recuperación de diario e interacciones SQL de imágenes sí se ejecutaron en MySQL. `log/cloudinary` se conserva persistente y no se eliminaron recursos históricos. La memoria de códigos/rate limits necesita un mecanismo compartido si hay varias instancias.

### Dependencias, respaldo y retirada posterior del origen

`npm audit --audit-level=high` finalizó con código 0: **23 avisos, 4 bajos y 19 moderados, ninguno alto/crítico**. Se revisó `npm audit fix --dry-run --ignore-scripts` y se permitió únicamente la resolución compatible sin force; el lock contiene `glob 13.0.7` y `babel-plugin-istanbul 8.0.2`. Los avisos transitivos de herramientas de desarrollo (deepmerge/glob/minimatch y consumidores) permanecen; npm propone cambios incompatibles para el resto y no se aplicaron. No se añadieron exclusiones/overrides para ocultarlos ni se afirma una auditoría sin avisos. Las instalaciones limpias de Windows/Linux se comprobaron.

Inventario real de `mercadolibrenode`: **base existente sin tablas**. Se generó mysqldump completo con rutinas/eventos/triggers y se restauró con éxito en `secure-ecommerce-stage5-restore`, puerto 13309 y tmpfs independiente. Se respaldaron **41 archivos de uploads (incluido .gitkeep)** en tar y se extrajeron/compararon byte a byte mediante SHA-256. No se modificó el origen. Artefactos ignorados en `log/stage5/legacy-backup/`:

- `mercadolibrenode.sql`: SHA-256 `56399d61a53b0c54e8e1c539fb658837a08461dbca5a73eaf2a09b93e0146b12`.
- `uploads.tar`: SHA-256 `20114c03fc23387e3e4a75f4113e90024051e365407137af4176ca37063faef5`.
- `manifest.json`: inventario, hashes individuales y comprobación de restauración; copia extraída en `restored-files/`.

El comando preparado para una autorización posterior, **no ejecutado**, es:

```sql
DROP DATABASE `mercadolibrenode`;
```

Antes de utilizarlo habrá que volver a verificar servidor/UUID, respaldo restaurado y ausencia de nuevas escrituras o dependencias. La autorización de ese DROP es independiente de cualquier permiso de esta etapa. No se eliminaron contenedores ni volúmenes compartidos.

### Riesgos y pendientes reales antes del PR/despliegue

1. Resolver la autorización del SELECT limitado de auditoría habitual y repetir su lectura administrativa; hasta entonces esa funcionalidad devuelve 503. No se declara cerrada la etapa con ese pendiente.
2. Ejecutar el análisis remoto de SonarQube Cloud/Quality Gate y revisar sus métricas de código nuevo; no hubo commit, push ni PR para disparar los workflows.
3. Proporcionar datos reales y proveedor de correo para el ADMIN inicial; configurar y verificar Resend/Cloudinary reales en el despliegue autorizado.
4. Revisar los avisos moderados/bajos restantes y las diferencias de dependencias de herramientas sin recurrir a force.
5. Definir reposición/devoluciones y retención/anonimización antes de ampliar cancelaciones; revisar almacenamiento compartido para múltiples instancias. La cancelación actual conserva inventario descontado y todos sus históricos.

No quedan módulos críticos sin implementar; las restricciones pendientes de permisos/proveedores/validación remota se distinguen de las funcionalidades comprobadas. La rama y el trabajo anterior se conservaron. No se hizo commit, push, PR ni cambios al frontend .NET.

### Revisión de cierre solicitada por el usuario

Se detuvo y revirtió exclusivamente el trabajo de PlantUML de esta ejecución. La comparación Git del generador, `docs.yml` y los doce SVG no presenta diferencias; también se restituyeron sus copias generadas en `dist`. Se conservó íntegra la implementación del backend y sus pruebas. No se ejecutaron nuevas generaciones ni se repitieron suites ya aprobadas.

La revisión final fue únicamente de lectura: `secure_ecommerce`, `ecommerce_app@%`, MySQL 8.0.46, UUID esperado, 14 tablas de negocio, 11 entradas de migraciones y **cero filas de negocio**. Se confirmó que el SELECT de auditoría sigue sin concederse y que el respaldo de `mercadolibrenode` tiene restauración verificada. Evidencia: `log/stage5/closure-review.json`. El arranque normal mediante `node index.js` también había quedado comprobado en loopback, con Swagger/404 y diario de recuperación aislado (`startup.json`), sin insertar demostraciones.

**Funciona y está probado:** autenticación/perfiles y revisión de vendedores, catálogo e imágenes con proveedor simulado, direcciones, carrito, cotización y reconfirmación, checkout por vendedor, idempotencia, inventario concurrente, snapshots, pedidos/historial, auditoría inmutable, Swagger de todos los endpoints y conexión definitiva con mínimo privilegio. Las pruebas MySQL omitidas en el resumen global se ejecutaron realmente en los runners separados indicados arriba.

**Requiere autorización:** únicamente el GRANT SELECT de las ocho columnas públicas de auditoría detallado en su sección, para habilitar esa lectura en la base habitual. No se ha concedido; el endpoint devuelve 503. La eventual eliminación de `mercadolibrenode` exige otra autorización posterior y separada y permanece sin ejecutar.

**Falta antes del despliegue/PR:** datos y correo verificado para crear el ADMIN mediante el procedimiento protegido, configuración y prueba de proveedores reales, y resultado remoto del Quality Gate/GitHub Actions. Hay 23 avisos bajos/moderados documentados y ninguno alto/crítico. No se declara cerrada definitivamente la etapa mientras siga pendiente la lectura administrativa de auditoría. No se hicieron commits, push, PR ni eliminación de bases.

### Correcciones finales de seguridad — 11 de noviembre de 2026

Esta continuación conserva los módulos anteriores y no modifica el Word, las ocho migraciones históricas, las migraciones nuevas ni el esquema. No se hicieron commits, push, PR, altas ADMIN habituales ni cambios de privilegios SQL. No se trabajó con PlantUML ni se modificó `docs.yml`.

#### Contraseñas, JWT y credenciales

- `services/password-policy.service.js` centraliza la política de nuevas contraseñas: mínimo 15 caracteres Unicode, máximo 72 bytes UTF-8 antes de bcrypt; rechazo de NUL, sustitutos Unicode aislados, candidatos numéricos, patrones repetidos, variedad muy reducida y una lista local acotada de contraseñas comunes. La comparación de esa lista usa NFKC y minúsculas; **el valor que se cifra no se recorta ni normaliza**. No se envían contraseñas ni hashes a terceros. La lista no garantiza detectar todas las contraseñas comprometidas existentes.
- Registro, cambio administrativo, procedimiento protegido de ADMIN y seeder histórico utilizan la misma validación. Las escrituras nuevas usan bcrypt con coste 12. El login conserva compatibilidad con contraseñas anteriores válidas para bcrypt, sin aplicar retroactivamente la política de altas ni truncar entradas superiores a 72 bytes. No se rotaron cuentas existentes.
- Se retiró la contraseña fija de demostración de `seeders/20240101000004-seed-users.js`. Ese seeder exige ahora `LEGACY_SEED_USER_PASSWORD` fuerte, suministrada de forma protegida. El corredor histórico genera una credencial efímera para sus bases temporales. Sigue prohibido ejecutar seeders históricos en `secure_ecommerce`.
- JWT exige material de al menos 32 bytes en hexadecimal o en codificación canónica con prefijo `base64url:`; rechaza formatos ambiguos y diversidad claramente insuficiente. El formato no demuestra entropía por sí solo: el aprovisionamiento debe usar un CSPRNG. La clave habitual existente pasa la validación; no se alteró. Las pruebas usan claves aleatorias efímeras, sin excepción de seguridad por `NODE_ENV`.
- Los mensajes de login permanecen uniformes para cuenta inexistente, contraseña incorrecta, suspensión, falta de verificación o perfil inválido. La serialización de usuarios excluye hashes y las respuestas de error no devuelven diagnósticos SQL ni secretos. Las pruebas incluyen límites multibyte, igualdad de errores, rechazo de entradas débiles y escritura exclusiva del hash.
- La inspección de archivos modificados/nuevos y plantillas no encontró coincidencias con los valores locales revisados de aplicación, migrador o JWT ni marcadores de claves privadas. Las plantillas no contienen credenciales. Es una inspección del estado local, no una certificación de todo el historial remoto ni de archivos externos al repositorio.
- **Riesgo comprobado:** la contraseña root del contenedor existente no cumple la nueva política de robustez. No se imprime su valor ni se cambió. Las credenciales actuales de aplicación y migrador sí pasan esa política; esto no certifica su procedencia aleatoria. No se encontró una coincidencia de root como valor predeterminado en los archivos seleccionados del HEAD conocido.

Se ampliaron `.gitignore` y `.dockerignore` para otros `.env.*`, logs completos, archivos de respaldo y claves privadas. El contexto del verificador Node 20 también excluye esas variantes, volcados, archivos de credenciales y archivos comprimidos; solo reincorpora explícitamente el `bd.sql` público. Una prueba real de filtrado con archivos sintéticos comprobó que únicamente permanecen código público y ese bootstrap, sin ejecutar SQL. La imagen de validación utilizada no recibió `.env` habituales, uploads, respaldos ni credenciales del servidor habitual.

Criterio de referencia: [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) y [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). No se impusieron clases ASCII obligatorias ni se consultó una API externa de contraseñas comprometidas.

#### Docker: configuración corregida, activación pendiente

`docker-compose.yml` publica ahora `127.0.0.1:3307:3306`. La configuración efectiva de Compose se validó: conserva `db:3306` para la API y el volumen `secure-ecommerce-api_mysql_data` para `/var/lib/mysql`. No se identificó una necesidad documentada de acceso remoto directo. Si se necesitara posteriormente, debe acordarse un túnel SSH/VPN y controles de acceso, sin abrir silenciosamente MySQL a todas las interfaces.

**El contenedor habitual NO se recreó:** sigue siendo `29e92b602f717a55be5195e1ef823545844d7cd6ef87eca45bd59800ec823142`, con publicaciones `0.0.0.0:3307` y `[::]:3307`. Cambiar el enlace de un contenedor existente requiere sustituirlo; se respeta la restricción anterior del usuario de no eliminar contenedores compartidos. La protección está preparada en el archivo, pero no se declara activa en Docker.

La operación preparada para una autorización posterior es:

```powershell
docker --context desktop-linux compose --project-name secure-ecommerce-api up -d --no-deps --no-build --pull never db
```

Antes de ejecutarla debe conservarse el secreto root actual mediante un entorno protegido, verificar que la imagen local coincide con la imagen actual y confirmar el mismo volumen existente. Después deben contrastarse UUID, tablas, recuentos, permisos y conexión de lectura de `ecommerce_app`. No usar `down`, `down -v`, retirada de volúmenes, inicialización de una base nueva ni cambios de contraseña implícitos.

Se dejó un dump completo de `secure_ecommerce` en `log/stage5/security/secure-ecommerce-before-network-change.sql`, con lectura posterior y SHA-256 contrastados. Contiene las 15 tablas y el historial técnico actual. No se restauró ni ejecutó contra el servidor habitual. El manifiesto `habitual-readonly.json` registra identidad, volumen, puertos, recuentos y hash del respaldo, sin credenciales. Esta verificación de lectura no equivale a un nuevo ensayo de restauración; se conservan las evidencias anteriores de restauración aislada del respaldo antiguo.

#### Suspensión de vendedores

Nuevo endpoint: **PUT `/api/users/sellers/:userId/suspend`**, exclusivamente ADMIN activo, cuerpo exacto `{"reason":"motivo sin secretos"}`. Solo permite `APPROVED → SUSPENDED`; PENDING, REJECTED o SUSPENDED producen conflicto. Exige UUID válido y motivo no vacío de hasta 255 caracteres, sin controles. No se añadió reactivación ni una conversión de perfiles.

El servicio comprueba nuevamente ADMIN y estado activo dentro de la transacción. Bloquea la cuenta del vendedor y su perfil en el orden utilizado por catálogo/checkout; actualiza `status`, `reviewedAt`, `reviewedByUserId` y registra `seller.suspended` con estado anterior y motivo sanitizado en `audit_logs.details`. No reutiliza `rejectionReason` para una suspensión ni añade columnas. Se redactan asignaciones de credenciales, cadenas largas con aspecto de token y correos en ese motivo; el cliente debe aportar una justificación no sensible.

La autorización consulta el estado actual, por lo que un JWT anterior no permite seguir administrando productos. El catálogo oculta productos del vendedor suspendido; carrito y checkout vuelven a comprobar el vendedor. El carrito usa ahora el mismo orden de bloqueo de cuenta/perfil/producto. Las pruebas comprobaron dos suspensiones concurrentes con resultados 200/409, ausencia de eventos duplicados, denegación de operaciones posteriores y conservación de pedidos, detalles y snapshots.

#### Consistencia e inmutabilidad de auditoría

`audit.business` exige una transacción explícita. Registro de usuario/perfil, cambios y cierres de cuenta, creación/modificación/borrado lógico de productos y categorías, asociaciones, imágenes, direcciones y operaciones de carrito incluyen su evento de éxito en la misma transacción. Los controladores pasan únicamente contexto de IP y ya no duplican eventos después del commit. El login escribe su evento antes de entregar un JWT; si falla, no devuelve una sesión exitosa. Checkout y transiciones conservan su atomicidad anterior.

Se mantuvieron las restricciones de actualización/eliminación de auditoría, historial y snapshots, junto con los permisos mínimos. Un fallo de auditoría en imágenes revierte su referencia SQL y utiliza el diario existente para compensar el recurso del proveedor. Las pruebas reales simularon fallos de auditoría en cada familia crítica y contrastaron la reversión; también comprobaron que una contraseña nueva queda como bcrypt coste 12 y que un fallo transaccional conserva el hash anterior sin imprimirlo.

Los eventos de peticiones ya rechazadas siguen siendo de mejor esfuerzo: no existe una escritura comercial exitosa que confirmar. Su almacenamiento puede fallar sin sustituir el rechazo por una respuesta insegura. No se añadió un sistema distribuido de limitación ni se garantiza resistencia a saturación de auditoría fuera de los límites existentes; debe revisarse según el despliegue.

**No se ejecutó el GRANT habitual.** Permiso mínimo preparado, limitado a las ocho columnas públicas y sin `details`:

```sql
GRANT SELECT (id, actorUserId, action, targetType, targetId, ipAddress, outcome, occurredAt)
ON secure_ecommerce.audit_logs TO 'ecommerce_app'@'%';
```

Requiere autorización explícita posterior del usuario y ejecución administrativa controlada. La cuenta habitual mantiene INSERT sin SELECT de auditoría; la lectura administrativa continúa pendiente y el servicio contempla 503 por denegación SQL. Los GRANT de los fixtures pertenecen exclusivamente a servidores descartables.

#### Diferencia metodológica del historial

El diccionario del Word indica VARCHAR(20) para `order_status_history.previousStatus` y `newStatus`; las decisiones implementadas y documentadas desde las etapas 2/4 utilizaron ENUM con los cinco estados del pedido. MySQL y Sequelize coinciden entre sí. ENUM refuerza el rechazo de estados inválidos en modo estricto, pero **no es una equivalencia literal del tipo declarado en el Word**. Se deja explícita esta desviación para la revisión metodológica; en esta continuación no se altera el Word, el esquema ni ninguna migración.

#### Pruebas y resultados comprobados

| Verificación | Resultado |
|---|---|
| Regresión final `RUN_STAGE5_MYSQL=1 npm run test:coverage -- --runInBand` | **236 aprobadas, 38 omitidas por activación propia; 34 suites aprobadas y cuatro omitidas**. Log: `log/stage5/security/coverage-final.log`. |
| Cuentas y catálogo, invocadas por el runner final | **27 aprobadas** sobre fixtures finales independientes, HTTP/MySQL reales. Son parte de las 38 omitidas en el resumen exterior; no se cuentan como aprobadas por haber sido omitidas. |
| `node scripts/database/stage5-historical-tests.js` | **3 pruebas de migraciones y 8 de transición aprobadas** en MySQL tmpfs del puerto 13307; incluyen la configuración protegida del seeder histórico. Completan las otras 11 omitidas. Ninguna migración se ejecutó contra el servidor habitual. |
| Correcciones de seguridad HTTP/MySQL | Runner aislado del puerto 13308: fallos de auditoría y reversión, cambios de contraseña, suspensión concurrente, autorización, disponibilidad y snapshots aprobados. Incluye compensación de imágenes con Cloudinary simulado. |
| Node 20/Linux Debian | Instalación limpia con `npm ci --ignore-scripts`, auditoría, **234 pruebas aprobadas y 39 omitidas** en la construcción sin MySQL, generación Swagger aprobada. Después, flujo HTTP/MySQL real y 27 regresiones aprobados desde Node 20, sin socket Docker ni credenciales habituales. La última ampliación Unicode se comprobó adicionalmente con **20 pruebas de política aprobadas en Node 20**. Logs: `log/stage5/security/node20-build.log` y `node20-mysql.log`. |
| `npm audit --audit-level=high` | Código 0: **23 avisos, cuatro bajos y 19 moderados; ninguno alto/crítico**. Permanecen avisos transitivos de herramientas como deepmerge/glob/minimatch y consumidores. No se instalaron actualizaciones incompatibles, no se ejecutó `audit fix --force` ni se modificó el lockfile en esta continuación. |
| `npm run swagger` | Aprobado. **47 operaciones documentadas: 46 API y GET /swagger**; incluye suspensión, sus errores, JWT, perfil ADMIN y política de contraseña. |
| Arranque habitual | `node index.js` temporal en loopback, Swagger 200 y ruta inexistente 404, con recuperación de imágenes dirigida a un diario de prueba separado. Solo lecturas; sin autenticaciones ni demostraciones persistentes. Evidencia: `log/stage5/security/startup.json`. |
| Estado habitual final inspeccionado | MySQL 8.0.46, UUID esperado, 14 tablas de negocio + SequelizeMeta, 99 columnas, 11 migraciones, cero registros de negocio. `mercadolibrenode` existe y conserva cero tablas. Sin cambios de grants. |

Cobertura final local comprobada en JSON y LCOV: **90,88 % sentencias, 81,64 % ramas, 93,62 % funciones y 94,21 % líneas**. Política de contraseñas: 100 % líneas/ramas; cuentas: 101/102 líneas y 90/99 ramas; direcciones: 100 % líneas/ramas; carrito: 100 % líneas; JWT: 100 % líneas. La cobertura de Node 20 en construcción sin MySQL es una medición distinta y menor (78,49 % líneas); no se confunde con la cobertura final que sí incluye MySQL.

Las pruebas existentes se adaptaron a las nuevas firmas de contexto transaccional, conservando los casos funcionales. Se añadieron pruebas de política y seguridad de cuentas, el caso HTTP de suspensión y comprobaciones reales en `tests/support/security-checks.js`. Los fallos iniciales fueron un cálculo incorrecto del fixture de frontera UTF-8, expectativas antiguas de firmas, una frase ambigua aceptada como base64url sin prefijo y una colisión de nombre en el nuevo helper de pruebas; se corrigieron y las regresiones posteriores pasaron. Swagger local encontró inicialmente un bloqueo de escritura del entorno Windows y pasó al ejecutarse con el permiso correspondiente, sin cambiar su contrato para ocultar el error.

No se modificaron métricas, exclusiones de cobertura/Sonar ni workflows para ocultar fallos. `test.yml` y `sonar.yml` conservan sus comandos Node 20/Ubuntu y la activación de MySQL aislado. **No se ejecutó GitHub Actions remoto ni el Quality Gate**; la validación Linux local no los sustituye. Resend y Cloudinary reales siguen sin configurar ni probar.

#### Archivos y pendientes de autorización

Archivos principales: política y cuentas/JWT/auditoría; servicios/controladores de usuarios, autenticación, catálogo, imágenes, direcciones y carrito; ruta de suspensión; contrato Swagger y ejemplos; seeder histórico y su prueba; `.gitignore`, `.dockerignore`, Compose y verificador de contexto; pruebas unitarias/HTTP/MySQL indicadas. README y `.env.example` aclaran el destino definitivo y el aprovisionamiento de secretos. No se alteró el frontend.

1. **Activación del enlace local:** autorizar la sustitución controlada de `ecommerce_db`, exclusivamente con la misma imagen y volumen, conservando UUID, datos y permisos. Hasta entonces permanece la exposición de red anterior, aunque Compose ya está corregido.
2. **Auditoría:** autorizar por separado el SELECT mínimo anterior y comprobar después la lectura ADMIN habitual. No se ha ejecutado.
3. **Rotación root:** acordar una ventana administrativa y guardar una nueva credencial CSPRNG en un gestor protegido. Verificar cuenta exacta/servidor/UUID y respaldo antes del cambio; utilizar una conexión administrativa sin logging de SQL y un parámetro protegido para cambiar únicamente esa cuenta. Actualizar después el secreto operativo del contenedor sin publicarlo. No introducir valores en argv, scripts, reportes o historial de shell. No se ejecutó ninguna rotación. Para aplicación/migrador, si se decidiera rotar, coordinar el cambio de secreto con sus consumidores; para JWT, advertir que la sustitución invalida todas las sesiones existentes. Para proveedores, coordinar revocación y comprobación con su autorización específica.
4. **Operación real y PR:** mantener pendientes ADMIN inicial con correo real verificado, proveedores autorizados, revisión del conjunto de archivos aún sin seguimiento y Quality Gate remoto. Se conservan los límites documentados de OTP/limitadores en memoria y revocación individual de JWT.
5. **Base antigua:** su respaldo y restauración aislada anteriores permanecen conservados. No se eliminó `mercadolibrenode`; cualquier eliminación requiere autorización posterior independiente.

Las correcciones de código descritas están implementadas y probadas. **No se declara finalizada definitivamente la etapa 5** mientras sigan pendientes la activación de red y la lectura administrativa habitual, y no se presentan como realizados el aprovisionamiento ni las validaciones externas pendientes.

### Activación autorizada del enlace local de MySQL — 12 de noviembre de 2026 (UTC)

El usuario autorizó expresamente recrear únicamente `ecommerce_db` para activar `127.0.0.1:3307:3306`, conservando imagen, volumen, datos, cuentas y permisos. Esta actualización sustituye el estado **pendiente de activación de red** de las secciones anteriores. No autoriza ni ejecuta el GRANT de auditoría, rotaciones o eliminación de bases.

#### Comprobaciones previas y operación realizada

- Se identificó el contenedor original `29e92b602f717a55be5195e1ef823545844d7cd6ef87eca45bd59800ec823142`, servicio `db`, proyecto `secure-ecommerce-api`, inicialmente saludable.
- Se verificó y fijó la imagen local exacta `sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`, mediante su referencia inmutable `mysql@sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`. No se descargó, construyó ni actualizó la imagen.
- Se comprobó el volumen existente `secure-ecommerce-api_mysql_data`, de tipo `local`, montado en `/var/lib/mysql`, y la presencia de los archivos de una instalación MySQL existente. Se verificaron MySQL 8.0.46, el directorio de datos y el UUID `b68c7b62-dc02-11f1-b706-caca74da477e` antes de actuar.
- Se contrastaron los hashes de los respaldos preparados de ambas bases y se generó además un nuevo `mysqldump` completo de `secure_ecommerce` y `mercadolibrenode`, con lectura posterior y SHA-256 comprobados: `log/stage5/security/network-activation.before.sql`. No se restauró ni ejecutó su contenido contra el servidor habitual.
- Antes de la recreación se verificaron los recuentos y nombres de las 11 migraciones. Las credenciales y variables existentes se conservaron en memoria mediante un override efímero de Compose, sin escribir sus valores en archivos o argumentos de shell. Se contrastó el entorno resuelto de Compose con el entorno original antes de ejecutar el cambio.
- Se ejecutó una sola recreación, exclusivamente de `db`, con `--no-deps --no-build --pull never --force-recreate`, usando la configuración base y el override por stdin. No se ejecutó `down`, retirada de volúmenes, migraciones, seeders ni instrucciones SQL de modificación.

El nuevo contenedor es **`0c25989fe3798f687d89a6101b0cb730bcaee20a34982a044a00728f567102f2`**. Conserva exactamente el ID de imagen y el volumen anteriores. El proyecto sigue teniendo únicamente el contenedor de servicio `db`; no se creó o arrancó la API ni se operó sobre otros servicios.

#### Incidencia del verificador y detención de cambios

La recreación terminó y MySQL alcanzó `healthy`. La comprobación posterior de igualdad literal del entorno detuvo entonces el script: Compose había dejado un elemento **`MYSQL_ROOT_HOST` sin signo `=` ni valor** en los metadatos del contenedor. El parser del verificador interpretaba incorrectamente ese marcador como una asignación y produjo una falsa diferencia. Se detuvieron las acciones de cambio; **no hubo una segunda recreación, corrección del contenedor ni inicialización de una base nueva**.

La inspección posterior fue exclusivamente de lectura. Confirmó que `MYSQL_ROOT_HOST` está efectivamente ausente en el proceso, y que las nueve claves con valor del entorno original siguen presentes. La autenticación con las credenciales existentes de root, aplicación, migrador y cuenta histórica funcionó; no se muestran ni se rotan sus valores.

Se conservan el registro de fallo original y las comprobaciones posteriores por separado. La comparación integral de todas las tablas internas de privilegios que el primer script mantenía en memoria no llegó a completarse; no se presenta como ejecutada. La verificación posterior contrastó los GRANT de aplicación y migrador con el snapshot histórico conservado de etapa 4, y comprobó las autenticaciones indicadas, la misma imagen, el volumen y la identidad del servidor. No se ejecutó ninguna instrucción para modificar cuentas o privilegios.

#### Resultado comprobado mediante lecturas

| Comprobación | Resultado real |
|---|---|
| Estado Docker | `running`, `healthy`. |
| Publicación Docker | Solo `127.0.0.1:3307` → `3306/tcp`; sin publicación en `0.0.0.0` ni IPv6. |
| Listener Windows | `Get-NetTCPConnection -State Listen -LocalPort 3307` devuelve únicamente `127.0.0.1:3307`. La consulta CIM requirió permiso de lectura fuera del sandbox. |
| Imagen / volumen | Mismo ID de imagen; `secure-ecommerce-api_mysql_data`, montado en el mismo directorio de datos. |
| Servidor | MySQL 8.0.46, UUID `b68c7b62-dc02-11f1-b706-caca74da477e`, sin cambio. |
| Esquema definitivo | Exactamente **14 tablas de negocio más `SequelizeMeta`**; ausencia de `roles` y `files`. |
| Migraciones | Las mismas **11 entradas**, comparadas por nombre; no se aplicó ninguna. |
| Registros | Las 14 tablas de negocio conservan **cero filas**; `SequelizeMeta` conserva 11. |
| Integridad lógica de ambas bases | Un nuevo volcado posterior coincide con el respaldo inmediatamente anterior, eliminando únicamente el comentario de fecha de finalización de `mysqldump`. Se comprobaron estructura y registros, no solo recuentos. |
| Cuentas / permisos | Root y cuenta histórica autentican; aplicación y migrador autentican y conservan los mismos GRANT del snapshot previo de etapa 4. Sin GRANT, REVOKE, ALTER USER ni rotaciones ejecutados. |
| Node.js | Conexión Sequelize real a `secure_ecommerce` como **`ecommerce_app@%`**, UUID esperado, verificación de seguridad de sesión y lecturas de productos/categorías correctas. No se utilizó root o migrador como cuenta de la API. |
| Base antigua | `mercadolibrenode` sigue existiendo, conserva cero tablas y coincide con su estado respaldado. No se eliminó. |

Inventario real obtenido mediante `SHOW TABLES`:

```text
SequelizeMeta
admins
audit_logs
buyers
cart_items
carts
categories
order_items
order_status_history
orders
product_categories
products
sellers
user_addresses
users
```

Evidencias locales ignoradas por Git: `network-activation.preflight.json`, `network-activation.before.sql`, `network-activation.failure.json` y `network-activation.readonly-validation.json`, dentro de `log/stage5/security/`. El último registra la validación de lectura completada a las `2026-11-12T03:51:15.606Z`. El fallo inicial no se borró ni se ocultó.

Para operaciones futuras de Compose deben preservarse explícitamente la imagen y el entorno protegido: esta recreación utilizó un override efímero para mantener variables históricas que no están declaradas en el archivo base. No se añadieron secretos al repositorio ni se modificaron archivos de credenciales. Un `compose up` posterior sin preparar ese entorno no forma parte de esta autorización.

**La publicación local ya está activa y verificada.** Siguen pendientes de autorización separada el SELECT mínimo de auditoría, cualquier rotación de contraseñas y la eventual eliminación de `mercadolibrenode`. ADMIN inicial, proveedores reales y Quality Gate remoto mantienen su estado anterior. No se hicieron commit, push ni PR; se conserva `feature/secure-ecommerce-db`.
