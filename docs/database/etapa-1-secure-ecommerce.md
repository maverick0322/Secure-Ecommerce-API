# Preparación de `secure_ecommerce`

La especificación es el [Word de las 14 tablas](../Propuesta_BD_Secure_Ecommerce_14_tablas.docx), ubicado en `docs/`. La etapa 1 conserva `mercadolibrenode` como destino de la API y prepara una conexión independiente para Sequelize CLI. La creación del esquema, las cuentas, las migraciones y la transferencia de datos quedan para etapas posteriores.

## Configuración de conexión

| Proceso | Host y puerto | Configuración |
| --- | --- | --- |
| API en Windows, con MySQL en Docker | `127.0.0.1:3307` | `DB_HOST`, `DB_PORT` |
| API en la misma red de Compose | `db:3306` | `DOCKER_DB_HOST`, `DOCKER_DB_PORT`, que Compose traduce a `DB_HOST` y `DB_PORT` dentro del contenedor |
| API en otra máquina, con MySQL publicado por Docker | IP del host MySQL, puerto `3307` | `DB_HOST` y `DB_PORT` para Node.js nativo. `DOCKER_DB_HOST` y `DOCKER_DB_PORT` para Node.js en Docker |
| Sequelize CLI para el nuevo esquema | `127.0.0.1:3307` desde Windows. `db:3306` desde un proceso separado en la red de Compose | `MIGRATION_DB_HOST`, `MIGRATION_DB_PORT`, `MIGRATION_DB_USER`, `MIGRATION_DB_PASSWORD` |

- En un entorno existente, conserve los valores vigentes de `DB_DATABASE`, `DB_USER` y `DB_PASSWORD`. Configure un `JWT_SECRET` propio antes de recrear la API. El servicio `app` de Compose exige esa variable al arrancar. Node.js ejecutado directamente todavía tiene el valor de respaldo del código actual si falta la variable. Cambiar una clave en uso invalida los tokens emitidos con ella.
- Para un volumen nuevo, suministre `DB_ROOT_PASSWORD` a la sesión que ejecutará Compose mediante el gestor de secretos o la configuración local de esa sesión. El `root` que crea la imagen se limita a `localhost` en inicializaciones nuevas. El archivo `.env` de la API contiene su propia cuenta y secreto JWT. Reserve `.env.migration.local`, ignorado por Git y por Docker, para las credenciales de migración. Su plantilla es `.env.migration.example`.
- En `mysql_data` ya inicializado, las variables de inicialización y `bd.sql` no cambian bases, cuentas, permisos ni contraseñas existentes. El chequeo de salud de Compose comprueba que MySQL responde, incluso si rechaza la autenticación. Compruebe por separado el acceso de la cuenta de la API con `SELECT CURRENT_USER(), DATABASE()` cuando corresponda. El puerto `3307:3306` sigue publicado en el host, así que limite el acceso mediante la red y el firewall. [Imagen oficial de MySQL](https://github.com/docker-library/docs/blob/master/mysql/README.md), [mysqladmin](https://dev.mysql.com/doc/refman/8.0/en/mysqladmin.html).

### Esquema anterior

Para un volumen nuevo, el bootstrap `bd.sql` crea `mercadolibrenode`. Para habilitar una instalación anterior desde cero, un operador de esquema independiente debe aplicar las migraciones históricas en esa base. Una vez que existan las tablas, el administrador debe crear la cuenta de ejecución y conceder `SELECT, INSERT, UPDATE` en las tablas que administra el backend, `SELECT` en `roles`, y `SELECT, INSERT` en `audit_logs`. El backend anterior todavía requiere `DELETE` en `users`, `products`, `categories`, `files` y `product_categories` para sus borrados físicos y desasociaciones. Reserve `CREATE`, `ALTER` y `DROP` al operador. Use seeders históricos solo en un entorno de demostración aislado si se requieren esos datos. Para una instalación anterior nueva sin esos seeders, aprovisione los roles `Administrador` y `Usuario` y la primera cuenta administrativa mediante un proceso protegido.

En volúmenes existentes, revise `SHOW GRANTS` de las cuentas efectivas antes de ajustar privilegios. El bootstrap anterior otorgaba `ALL` y usaba contraseñas conocidas. Coordine la rotación y el recorte de privilegios con el despliegue para conservar el acceso de la API y retirar accesos remotos de `root` que se hayan habilitado. Estos cambios requieren administración directa en MySQL.

## Aprovisionamiento posterior del nuevo esquema

1. Desde la instancia correcta, conéctese como administrador por el socket local del contenedor (`docker compose exec db mysql --user=root --password`). MySQL solicitará la contraseña. Revise `SELECT VERSION(), @@session.sql_mode, @@session.time_zone, @@global.partial_revokes;` y las cuentas existentes con `SELECT User, Host, plugin FROM mysql.user WHERE User IN ('root', 'ecommerce_migrator', 'ecommerce_app');`. Verifique InnoDB, un modo estricto y el tratamiento UTC antes de migrar.
2. Una vez aprobada la etapa siguiente, cree la base y la cuenta de migración. Sustituya `<migration_host>` por el origen que MySQL observa. En Docker, la conexión al puerto publicado puede aparecer desde la red puente y no desde `localhost`. Use el host o la subred aprobada para cada proceso y confirme la cuenta efectiva con `CURRENT_USER()`. Revise cualquier cuenta preexistente con `SHOW GRANTS` y gestione sus credenciales antes de reutilizarla. Guarde la contraseña generada directamente en el gestor de secretos y suminístrela a Sequelize CLI como `MIGRATION_DB_PASSWORD`.

   ```sql
   CREATE DATABASE `secure_ecommerce`
     CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'ecommerce_migrator'@'<migration_host>'
     IDENTIFIED WITH caching_sha2_password BY RANDOM PASSWORD;
   GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, INDEX, REFERENCES, DROP
     ON `secure\_ecommerce`.* TO 'ecommerce_migrator'@'<migration_host>';
   SHOW GRANTS FOR 'ecommerce_migrator'@'<migration_host>';
   ```

   El `GRANT` de base escapa `_` si `partial_revokes` está desactivado. Si está activado, use el nombre literal sin barra. `DROP` es necesario para los renombres de la migración histórica y puede eliminar toda la base en ese ámbito. Mantenga la credencial fuera de la API y retire el acceso del migrador cuando termine la ventana de despliegue. [GRANT](https://dev.mysql.com/doc/refman/8.0/en/grant.html), [privilegios de MySQL](https://dev.mysql.com/doc/refman/8.0/en/privileges-provided.html), [contraseñas aleatorias](https://dev.mysql.com/doc/refman/8.0/en/password-management.html).

3. Después de aplicar las migraciones aprobadas y comprobar las 14 tablas, cree `ecommerce_app`. El siguiente punto de partida supone que el alta de administradores se realiza mediante un proceso protegido separado de la API, y que la API administra las categorías. Sustituya `<app_host>` por el origen autorizado y ajuste la matriz a las consultas reales antes del corte. Guarde la contraseña generada y entréguela a la API como `DB_PASSWORD` cuando se cambie a `DB_USER=ecommerce_app` y `DB_DATABASE=secure_ecommerce`.

   ```sql
   CREATE USER 'ecommerce_app'@'<app_host>'
     IDENTIFIED WITH caching_sha2_password BY RANDOM PASSWORD;
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`users` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT ON `secure_ecommerce`.`admins` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`sellers` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT ON `secure_ecommerce`.`buyers` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`user_addresses` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`categories` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`products` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`product_categories` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`carts` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE ON `secure_ecommerce`.`cart_items` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT, UPDATE (status, updatedAt) ON `secure_ecommerce`.`orders` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT ON `secure_ecommerce`.`order_items` TO 'ecommerce_app'@'<app_host>';
   GRANT SELECT, INSERT ON `secure_ecommerce`.`order_status_history` TO 'ecommerce_app'@'<app_host>';
   GRANT INSERT ON `secure_ecommerce`.`audit_logs` TO 'ecommerce_app'@'<app_host>';
   SHOW GRANTS FOR 'ecommerce_app'@'<app_host>';
   ```

   Si se mantiene `GET /api/audit-logs`, conceda `SELECT` sobre las columnas que devuelve ese endpoint después de revisar la autorización de `ADMIN`. MySQL distingue cuentas de conexión. El middleware debe distinguir a los usuarios HTTP que comparten esa cuenta. Verifique que la cuenta de la API carece de `DELETE`, `ALTER`, `DROP`, permisos de administración y acceso a `SequelizeMeta`, y que las tablas históricas solo admiten inserciones y lecturas autorizadas. [Privilegios por tabla y columna](https://dev.mysql.com/doc/refman/8.0/en/grant.html).

## Orden de implementación

1. **Inventario y recuperación.** Compare `SequelizeMeta`, columnas, FKs, índices y datos reales con las siete migraciones de 2024 y la normalización de 2026. Haga y ensaye una restauración del respaldo de MySQL y de `uploads/`. Conserve BLOB, hashes y registros de auditoría bajo acceso restringido. Use una instancia aislada para el ensayo.
2. **Base del historial.** Conserve las ocho migraciones existentes. En un destino vacío, aplique la cadena histórica hasta `20261108000001-normalize-english-schema.js` y valide el resultado antes de importar los datos con sus IDs y referencias. Si parte de una copia restaurada del esquema anterior, verifique su `SequelizeMeta` antes de continuar. Use migraciones posteriores que primero admitan la transición, luego completen los datos de forma repetible y por último activen las restricciones tras la reconciliación. Compruebe `DATABASE()` al iniciar las nuevas migraciones para proteger el esquema anterior. `SequelizeMeta` queda fuera del conteo de 14 tablas de negocio.
3. **Identidad.** Evolucione `users` y agregue `admins`, `sellers` y `buyers`, con FKs a `users` y la revisión de `sellers` enlazada a `admins`. Antes de exigir `emailVerifiedAt`, defina cómo verificar los correos anteriores o cómo conservar las cuentas pendientes fuera del destino hasta verificar. No hay evidencia de verificación en el esquema actual. Apruebe el mapeo de cada rol, los permisos antes asociados a `users.protected` y los datos necesarios de vendedor. No infiera administradores, vendedores ni fechas de verificación. Cree cuenta y perfil en una transacción y serialice las escrituras por fila de `users`. Las FKs por sí solas no garantizan exclusividad entre perfiles. Revise el alcance de las escrituras directas antes de decidir si hacen falta controles adicionales en MySQL.
4. **Direcciones y catálogo.** Cree `user_addresses` y serialice la elección de dirección predeterminada bloqueando la fila de `users` del comprador. Evolucione `categories`, `products` y `product_categories`. Verifique duplicados bajo la colación elegida, longitudes y precios. Asigne un vendedor por producto con evidencia y acuerde el inventario inicial. Migre a Cloudinary desde BLOB o `uploads/`, compare las imágenes y preserve un mapa de `fileId` a `imagePublicId` fuera del esquema final. Resuelva referencias faltantes y archivos compartidos antes del corte. El catálogo usará `DECIMAL(12,2)` y reactivará las asociaciones por la PK compuesta.
5. **Carrito y pedidos.** Cree `carts`, `cart_items`, `orders`, `order_items` y `order_status_history`, en ese orden. Aplique las claves únicas del Word para carrito por comprador, línea por producto y pedido por `checkoutId` y vendedor. Use FKs restrictivas en relaciones comerciales e históricas. Compruebe stock y precio bajo bloqueo, actualice inventario y escriba pedidos, detalles e historial inicial en una transacción. Revalide el comprador y el contenido en reintentos. Conserve título, precio y total históricos y el snapshot de dirección en JSON, sin duplicar teléfono. Registre las transiciones con actor y motivo obligatorio en cancelaciones. El Word asigna `VARCHAR(20)` a `previousStatus` y `newStatus`, mientras que el requisito de esta etapa pide `ENUM` para los estados. Resuelva la discrepancia antes del DDL. La propuesta para revisión es reutilizar los cinco estados de `orders.status` y permitir `NULL` en `previousStatus`.
6. **Auditoría y comprobaciones.** Evolucione `audit_logs`. Convierta actores a `actorUserId` solo con una coincidencia verificable. Preserve la bitácora original bajo la política de retención y documente cómo reconciliar eventos sin actor, acción larga o fecha fiable. Valide `DATETIME(3)` en UTC, tipos de FKs, restricciones, `ENUM`, `CHECK` y los valores válidos en Node.js. Compruebe concurrencia, exclusividad, cruces de perfil, borrado lógico, suspensión, reintentos, snapshots, historial y privilegios en MySQL 8 aislado.
7. **Corte y retirada.** Antes de cerrar cada migración, compruebe las precondiciones y el resultado de cada DDL. MySQL confirma implícitamente muchas operaciones, así que prepare reanudación por paso y recuperación desde un respaldo ensayado. Después de reconciliar datos, archivos, FKs y contratos, retire en el destino las FKs de `users.roleId` y `products.fileId`, las columnas y después `roles` y `files`, además de las columnas históricas que no figuran en el Word. Valide exactamente las 14 tablas de negocio. Coordine una pausa de escrituras y la transferencia final antes de cambiar API y credenciales. Conserve el origen para recuperación. Si el destino ya recibió escrituras, reconcilie esos cambios antes de regresar al origen. La retirada de la base anterior requiere una decisión posterior de retención. [Confirmaciones implícitas en MySQL](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html).

## Dependencias que cambian en el backend

| Dependencia actual | Adaptación posterior |
| --- | --- |
| `User` y `Role`; `users.controller.js`, `auth.controller.js` y `/api/roles` | Sustituir la FK y el contrato de edición de rol por perfiles exclusivos. Separar el alta pública de `BUYER` y `SELLER` del alta protegida de `ADMIN`. Verificar el correo antes de insertar, con código hasheado, expiración y límite de intentos en almacenamiento temporal del servidor. Para varias instancias, usar almacenamiento compartido. |
| `auth.middleware.js` y Rolling Token | Conservar JWT de 20 minutos. Comprobar cuenta activa, `deletedAt`, perfil y propiedad en cada solicitud protegida antes de renovar. La suspensión bloquea el acceso con tokens vigentes. El diseño no incluye revocación selectiva por dispositivo. |
| `Product`, `File`, `products.controller.js`, `/api/files`, Multer y `FILES_IN_DB` | Sustituir `fileId` y las lecturas de BLOB/disco por `imagePublicId`. Autorizar cargas y cambios del catálogo a vendedores aprobados sobre sus recursos. Coordinar validación de formatos, límites, reemplazos y eliminación remota. |
| `destroy` en usuarios, productos, categorías y archivos; `removeCategory` en asociaciones | Adaptar las entidades persistentes a borrado lógico. Excluir filas inactivas y conservar `categories.protected`. Revisar las cascadas históricas. |
| `AuditLog`, middleware y `/api/audit-logs` | Adaptar `elementId`, `user`, `ip`, `date` y timestamps antiguos a actor, recurso, IP, resultado y fecha del Word. Filtrar secretos y datos personales. |
| Seeders históricos, pruebas, OpenAPI, ejemplos y documentación de arquitectura | Aislar los seeders antiguos que escriben `roles`, `users.roleId`, `products.fileId` y timestamps del vínculo. Sustituir las cuentas de demostración por un aprovisionamiento protegido. Mantener pruebas del historial separadas de las pruebas del nuevo contrato, y actualizar consumidores, diagramas y documentación. |

## Comandos por etapa

- En esta etapa se puede validar configuración con `docker compose config --quiet` y ejecutar la suite simulada con `npm.cmd test -- --testPathIgnorePatterns=tests/database`. La prueba `tests/database/schema.mysql.test.js` ejecuta migraciones, seeders y `DROP DATABASE` si se define `TEST_MYSQL_URL`.
- Tras aprobación, compruebe el destino y las cuentas en una instancia de ensayo. Si el esquema de destino está vacío, `npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration --to 20261108000001-normalize-english-schema.js` aplica solo el historial. Si parte de un respaldo restaurado, valide primero el historial que contiene. Con `SequelizeMeta` inicializada puede consultar el estado usando `npx.cmd --no-install sequelize-cli db:migrate:status --config config/secure-ecommerce-migrations.js --env migration`. En una instancia vacía, `db:migrate:status` puede crear `SequelizeMeta`. Una vez desarrolladas y probadas las nuevas migraciones, `npm.cmd run migrate -- --config config/secure-ecommerce-migrations.js --env migration` aplicará las pendientes. Use `npm` y `npx` fuera de PowerShell si corresponde.
- Aplace `docker compose up` para un volumen nuevo, los comandos SQL de aprovisionamiento, las migraciones, los seeders y las pruebas con MySQL real hasta la etapa autorizada. `npm run migrate` sin `--config` todavía puede apuntar al esquema anterior. No use `migrate:undo`, `migrate:undo:last`, `seed:undo`, `DROP DATABASE`, `DROP TABLE`, `docker compose down -v` ni comandos de eliminación de volúmenes como parte de esta preparación.
