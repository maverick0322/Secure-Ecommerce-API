# Normalización del backend al inglés

Fecha: 8 de noviembre de 2026. Rama: `refactor/backend-english-names`.

## Alcance e inventario de referencias

Se modificó exclusivamente `Secure-Ecommerce-API`. El inventario inicial abarcó los siete controladores y archivos de rutas, seis modelos y su cargador, cuatro middlewares, el servicio JWT, la configuración, siete migraciones históricas, cuatro seeders, trece suites originales, `index.js`, `swagger.js`, `bd.sql`, `package.json`, Docker Compose y las instrucciones operacionales.

Referencias que requirieron coordinación:

| Origen | Referencias actualizadas |
| --- | --- |
| `index.js` | Montaje de rutas y middleware de auditoría; clave JSON `message` |
| `routes/` | Nombres de módulos, controladores, validadores y autorización |
| `controllers/` | Exportaciones ORM, atributos, alias de respuestas, validadores, métodos de asociaciones y `req.logAudit` |
| `models/` | Clases, tablas, atributos, asociaciones y claves foráneas |
| `middlewares/`, `services/` | Funciones JWT, configuración de atributos estándar, renovación y registro de auditoría |
| `seeders/` | Tablas y campos finales; inserción de registros faltantes y resolución de relaciones por datos de dominio |
| `tests/` | Importaciones, rutas, entradas, respuestas y expectativas; contratos nuevos y pruebas reales con MySQL |
| Swagger y ejemplos HTTP | Rutas nuevas, esquemas de respuesta, autenticación, carga multipart y mensajes en español |

Los comentarios, las validaciones y los errores propios mantienen el español. No cambiaron los permisos de rutas, los códigos HTTP, la duración y renovación de JWT, los tipos ORM, la representación de DECIMAL, la protección de registros ni los valores del catálogo.

## Mapa real de modelos y módulos

| Anterior | Clase y archivo actuales | Tabla actual |
| --- | --- | --- |
| `usuario`, `models/usuario.js` | `User`, `models/user.js` | `users` |
| `rol`, `models/rol.js` | `Role`, `models/role.js` | `roles` |
| `producto`, `models/producto.js` | `Product`, `models/product.js` | `products` |
| `categoria`, `models/categoria.js` | `Category`, `models/category.js` | `categories` |
| `archivo`, `models/archivo.js` | `File`, `models/file.js` | `files` |
| `bitacora`, `models/bitacora.js` | `AuditLog`, `models/audit-log.js` | `audit_logs` |
| Tabla implícita `categoriaproducto` | `ProductCategory`, `models/product-category.js` | `product_categories` |

Controladores, rutas y pruebas de `usuarios`, `productos`, `categorias`, `archivos` y `bitacora` pasan a llamarse `users`, `products`, `categories`, `files` y `audit-logs`. El middleware usa `audit-logs.middleware.js`. `config/claimtypes.js` pasa a `config/claim-types.js` y exporta `CLAIM_TYPES`. Los seeders conservan su orden cronológico y usan los sufijos `seed-categories`, `seed-products`, `seed-product-categories` y `seed-users`.

| Símbolo anterior | Símbolo actual |
| --- | --- |
| `Authorize` | `authorize` |
| `GeneraToken`, `TiempoRestanteToken` | `generateToken`, `getRemainingTokenTime` |
| `usuarioExistente`, `productoExistente`, `categoriaExistente`, `archivoExistente` | `existingUser`, `existingProduct`, `existingCategory`, `existingFile` |
| `camposPermitidos`, `camposActualizar` | `allowedFields`, `fieldsToUpdate` |
| `rolesPermitidos`, `rolUsuario`, `rolusuario` | `allowedRoles`, `userRole` |
| `minutosRestantes`, `nuevoToken` | `remainingMinutes`, `newToken` |
| `nombreSeguro`, `contenidoBinario`, `binario` | `safeFilename`, `binaryContent`, `binaryData` |
| `rutaNuevo`, `rutaAnterior`, `nuevoFilePath` | `newPath`, `previousPath`, `newFilePath` |
| `asignaCategoria`, `eliminaCategoria` | `assignCategory`, `removeCategory` |
| `categoriaValidator`, `productoValidator` | `categoryValidator`, `productValidator` |
| `addCategoria`, `removeCategoria` | `addCategory`, `removeCategory` |
| `getDetalle`, `tiempo` | `getDetails`, `time` |
| `bitacoralogger`, `req.bitacora` | `auditLogger`, `req.logAudit` |

## Contrato incompatible con el frontend anterior

| Anterior | Actual |
| --- | --- |
| `/api/categorias` | `/api/categories` |
| `/api/productos` | `/api/products` |
| `/api/usuarios` | `/api/users` |
| `/api/archivos` | `/api/files` |
| `/api/bitacora` | `/api/audit-logs` |
| `/api/auth/tiempo` | `/api/auth/time` |
| `/api/archivos/:id/detalle` | `/api/files/:id/details` |
| `/api/productos/:id/categoria` | `/api/products/:id/categories` |
| `/api/productos/:id/categoria/:categoriaid` | `/api/products/:id/categories/:categoryId` |

`POST /api/auth` y `/api/roles` conservan su ruta. La búsqueda de productos conserva `?s=...`. Las rutas anteriores responden 404; el frontend debe cambiarse por separado.

| Campos anteriores | Campos actuales |
| --- | --- |
| `nombre`, `titulo`, `descripcion`, `precio` | `name`, `title`, `description`, `price` |
| `protegido`, `protegida` | `protected` |
| `archivoid`, `categoriaid`, `productoid`, `rolid` | `fileId`, `categoryId`, `productId`, `roleId` |
| `archivoId`, `categoriaId`, `productoId`, `bitacoraId` | `fileId`, `categoryId`, `productId`, `auditLogId` |
| `passwordhash` | `passwordHash` (campo interno; no se expone) |
| `indb`, `datos` | `storedInDatabase`, `data` (contenido binario interno) |
| `accion`, `elementoid`, `usuario`, `fecha` en auditoría | `action`, `elementId`, `user`, `date` |
| `rol`, `categorias` | `role`, `categories` |
| `mensaje`, `errores`, `tiempoRestante` | `message`, `errors`, `remainingTime` |

La fecha de auditoría se llama `date` porque es un atributo distinto de las marcas `createdAt` y `updatedAt`, que también se conservan. Los alias de lectura siguen siendo específicos del recurso (`productId`, `categoryId`, `fileId`, `auditLogId`); las creaciones que antes devolvían `id` siguen devolviendo `id`.

Las consultas de usuarios y el inicio de sesión devuelven `role` como nombre de dominio (`Administrador` o `Usuario`). La creación de usuarios ahora devuelve `role` para el antiguo `rolid` de respuesta: ese valor ya era un nombre, no un UUID. `roleId` queda reservado para la clave foránea UUID interna. La entrada para crear y actualizar usuarios utiliza `role` con el nombre del rol, igual que antes semánticamente.

En configuración se renombra `FILES_IN_BD` a `FILES_IN_DB`; es necesario actualizar el `.env` existente. La carga multipart conserva `file`, JPEG y el límite de 2 MB. Los encabezados `Authorization` y `Set-Authorization` y sus formatos permanecen iguales.

## Migración y datos existentes

Las siete migraciones `20240101000001` a `20240101000007` mantienen exactamente sus nombres y contenidos. La nueva `20261108000001-normalize-english-schema.js` se ejecuta después de ellas; no modifica `SequelizeMeta` directamente ni vuelve a ejecutar migraciones registradas.

La migración usa `RENAME TABLE` y `ALTER TABLE ... RENAME COLUMN` de MySQL 8: conserva valores, tipos, BLOB, índices, claves y fechas. Renombra las restricciones propias a `products_file_id_fk`, `product_categories_category_id_fk`, `product_categories_product_id_fk` y `users_role_id_fk`. Consulta y conserva las reglas reales de actualización y eliminación y la referencia de cada restricción. La reversión recupera los nombres históricos canónicos de restricciones de las migraciones iniciales; si una instalación personalizó esos nombres, no recupera necesariamente su etiqueta anterior, pero conserva sus reglas y columnas.

MySQL confirma implícitamente cada DDL. La migración valida las tablas y columnas antes del primer cambio, rechaza la coexistencia ambigua de nombres y acepta pasos ya renombrados para poder reanudarse. No se declara una transacción ficticia que MySQL no pueda garantizar. Debe ejecutarse sin tráfico concurrente de la API; el código de ambas versiones requiere su esquema correspondiente.

Los seeders nuevos consultan los registros existentes por identidad y por datos de dominio antes de insertar; no actualizan registros ni contraseñas. Las relaciones de catálogo se resuelven por nombre/título, evitando asumir que los identificadores iniciales siguen libres. Pueden volver a ejecutarse aunque existan entradas históricas en `SequelizeData`; no se eliminan esas entradas. La reversión automática de seeders produce un error explícito en español para evitar borrar registros ajenos o datos utilizados después de la carga inicial.

`bd.sql` crea la base solo si falta y conserva cuentas ya existentes. No contiene `DROP DATABASE`; las tablas del esquema final se obtienen con `npm run migrate`.

## Excepciones y pendientes

- Identificadores y nombres de las siete migraciones históricas en español: excepción de compatibilidad con `SequelizeMeta`. Las pruebas de migración contienen claves de ese esquema histórico exclusivamente para verificar la transición.
- Se conservan los nombres de bases y cuentas existentes (`mercadolibrenode`, `mercadolibre_user`) y el nombre de base de pruebas configurado previamente; no se migra la identidad de conexiones externas.
- Se conservan las claves externas de Express, Sequelize, Multer y express-validator, los atributos estándar JWT, los URI de identidad y los valores existentes de `iss`/`aud` (`ServidorFeiJWT`, `ClientesFeiJWT`).
- Se conservan valores de dominio, datos de ejemplo y acciones históricas de auditoría como `producto.crear`, `usuarios.editar` y `usuario.login`, para mantener la continuidad del registro. Sus campos contenedores sí están en inglés.
- Los índices heredados pueden conservar etiquetas históricas de MySQL; las columnas y restricciones foráneas del nuevo esquema están normalizadas.
- No se modificaron `docs/asciidoc/05_estandares_codificacion.adoc` ni `docs/checklist_y_plan_documentacion.md`. El estándar y los documentos formales/diagramas anteriores que describen nombres en español quedan pendientes de conciliación; este reporte y README describen el contrato operativo actual.
- Seguridad independiente pendiente: secreto JWT de reserva en código, credenciales de demostración en seeders y valores predeterminados de conexión existentes. Se documentan sin alterar su comportamiento durante este renombrado.
- Auditoría de dependencias: 23 hallazgos (4 bajos, 19 moderados, 0 altos y 0 críticos). No se ejecutó `npm audit fix` ni se modificaron versiones o el archivo de bloqueo; las correcciones requieren una revisión separada.

## Validación ejecutada

Entorno: Node.js 24.13.1, npm y MySQL Community Server 8.0.39 en Windows. Se utilizó `npm.cmd` porque la política de PowerShell bloquea `npm.ps1`. Docker está instalado, pero su motor no estaba disponible; no se probó el despliegue con contenedores.

- `npm ci`: instalación limpia completada, 476 paquetes.
- `npm test` con `TEST_MYSQL_URL` de la instancia aislada: 15 suites y 134 pruebas aprobadas.
- `npm test` sin conexión de MySQL configurada: 14 suites y 131 pruebas aprobadas; una suite y tres pruebas de base real omitidas explícitamente.
- `npm run test:coverage -- --runInBand` con la misma conexión aislada: 134 pruebas aprobadas; 91.9% de sentencias, 80.53% de ramas, 87.91% de funciones y 92% de líneas. El reporte corresponde a los módulos cargados por Jest; los seeders y la generación Swagger se ejecutan además en procesos de CLI y no se incluyen en esos porcentajes.
- `npm run swagger`: especificación generada correctamente, con rutas/campos nuevos, autenticación, multipart y descripciones de respuesta en español.
- `npm audit --audit-level=high`: código de salida 0; hallazgos detallados arriba.
- Pruebas reales con MySQL: migraciones por Sequelize CLI en base nueva y base histórica con `SequelizeMeta`; comparación exacta de registros antes/después de revertir; BLOB, DECIMAL, contraseñas, fechas y asociaciones conservados; migración posterior a la reversión; dos ejecuciones de seeders sin duplicación ni sobrescritura de contraseñas.
- Reanudación real de `up` y `down` después de interrupciones simuladas entre instrucciones DDL y segunda ejecución de `up` ya normalizado.
- Verificación HTTP contra la base real mediante Supertest: autenticación, productos con categorías, usuarios sin hash, bitácora y tiempo de sesión. Las bases temporales creadas por las pruebas se eliminaron al finalizar.

Los artefactos locales `coverage/` y `swagger-output.json` mantienen la exclusión ya existente en Git.
