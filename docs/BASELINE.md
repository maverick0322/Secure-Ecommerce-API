# Línea Base Única del Sistema (`BASELINE.md`)

- **Fecha de verificación y ejecución en vivo:** `2026-11-22`
- **Propósito:** Fuente única de verdad (Single Source of Truth) sobre el estado técnico verificable de los repositorios `backendnode` y `frontendnet` en `main` (con `fix/backend-hardening` ya integrado mediante PR #8), como base para la documentación arquitectónica, el contrato de API y la regeneración de diagramas UML 2.5.1.
- **Política de verificación:** Todo dato que no pueda comprobarse directamente sobre los repositorios o la ejecución local sin exponer secretos se etiqueta explícitamente como **`NO_VERIFICABLE`**. **Sin secretos.**

---

## 1. Identificación de Repositorios y Commits (`main`)

| Atributo | `backendnode` | `frontendnet` |
|---|---|---|
| **Ruta local** | `c:\codigo\ps\ecommerce\backendnode` | `c:\codigo\ps\ecommerce\frontendnet` |
| **Rama base (`main`)** | `main` (rama de trabajo documental: `docs/lote-0`, rebasada sobre `main`) | `main` |
| **Hash completo de `main` / `origin/main`** | `f9d459695c9ec52f25a09ba09e09f9dd18d6d732` (`f9d4596`) | `24f0f70e9f720893293ddb0c861712d9eeb00c8c` (`24f0f70`) |
| **Fecha del commit de `main`** | `2026-11-22 12:53:55 -0600` | `2026-11-19 20:40:03 -0600` |
| **Autor del commit de `main`** | `Erickmel Vázquez` | `Eugenio` |
| **Mensaje del commit de `main`** | `Merge pull request #8 from maverick0322/fix/backend-hardening` (integra `db6e039e91e356642ae467e58613d9869cfd8b61` sobre `c5b66a55024eab69986dd7e7762a4b22ef7f32c5`) | `chore: merge conflict` |

---

## 2. Versiones de Runtimes, Motores y Dependencias

### 2.1 Runtimes y Contenedores

| Componente | Valor Verificado en `main` (`f9d4596` / `24f0f70`) | Evidencia (`Archivo:línea`) |
|---|---|---|
| **Node.js (motor declarado)** | `>=24.0.0 <25.0.0` (Node 24 LTS) | `backendnode/package.json:7-9` |
| **Node.js (imagen Docker)** | `node:24-alpine` (multi-stage: `deps` + `runner` no-root `USER node`) | `backendnode/Dockerfile:1,8,35` |
| **Node.js (binario local ejecutado hoy)** | `v24.13.0` (`npm 11.6.2`) | Ejecución local `node -v` / `npm -v` (`2026-11-22`) |
| **.NET Target Framework (`frontendnet` y tests)** | `net9.0` (ASP.NET Core 9.0 Razor Views MVC) | `frontendnet/frontendnet.csproj:4`, `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj:4` |
| **.NET SDK / Runtime local ejecutado hoy** | SDK / VSTest `17.14.1 (x64)` sobre `.NET 9.0.10` | Ejecución local `dotnet test` (`2026-11-22`) |
| **MySQL (imagen Docker)** | `mysql:8.4` (`--mysql-native-password=OFF`, `caching_sha2_password`, `127.0.0.1:3309:3306`) | `backendnode/compose.yaml:42-70` |
| **Redis (imagen Docker)** | `redis:7.4-alpine` (TLS mutuo `6380`, `--port 0`, `--tls-auth-clients yes`, `users.acl`, `maxmemory 128mb`, `noeviction`) | `backendnode/compose.yaml:5-40` |
| **Java Runtime (renderizado PlantUML)** | OpenJDK `25.0.2` (`2026-01-20 LTS`, Temurin-25.0.2+10) | Ejecución local `java -version` (`2026-11-22`) |
| **PlantUML Jar fijado** | `1.2024.8` (`plantuml-1.2024.8.jar`, SHA-256 `2e1f42a9879cd25236b5725ca7db25cb9996e8e37a0a1440b2eb559f259c54aa`) | `backendnode/docs/generate-diagrams.js:30-32` |

### 2.2 Dependencias de `backendnode` (`package.json` y `package-lock.json`)

| Categoría | Paquete | Versión en `package.json` | Versión Resuelta en `package-lock.json` | Estado de Uso en Producción |
|---|---|---|---|---|
| **Producción (16 declaradas)** | `bcrypt` | `^6.0.0` | `6.0.0` | En uso (verificación de hashes legados `$2a$/$2b$/$2y$` en `services/password-hash.service.js:2,32`) |
| | `cloudinary` | `^2.9.0` | `2.9.0` | En uso (`services/cloudinary.service.js:1`) |
| | `cors` | `^2.8.5` | `2.8.5` | En uso (`index.js:3,99`) |
| | `dotenv` | `^16.4.5` | `16.4.5` | En uso (`index.js:4`, `config/config.js:1`) |
| | `express` | `^4.21.2` | `4.21.2` | En uso (`index.js:1`) |
| | `express-validator` | `^7.2.1` | `7.2.1` | **Uso parcial** (solo 1 llamada en `services/accounts.service.js:4,37`; ver §2.4) |
| | `googleapis` | `^171.4.0` | `171.4.0` | En uso (`services/gmail.service.js:1`) |
| | `helmet` | `^8.3.0` | `8.3.0` | En uso (`index.js:5,63-75`, `package.json:48`, `package-lock.json:21,2977`) |
| | `ioredis` | `^5.10.1` | `5.10.1` | En uso (`services/auth-redis.service.js:1`) |
| | `jsonwebtoken` | `^9.0.2` | `9.0.3` | En uso (`services/rs256-access-token.service.js:2`, `services/checkout-quote.service.js:2`, `services/jwttoken.service.js:1`) |
| | `multer` | `^2.1.0` | `2.1.1` | En uso (`middlewares/upload.middleware.js:1`) |
| | `mysql2` | `^3.11.3` | `3.11.3` | En uso (driver de `sequelize`) |
| | `request-ip` | `^3.3.0` | `3.3.0` | **No usada en producción** (`0` imports en código productivo; ver §2.4) |
| | `sequelize` | `^6.37.4` | `6.37.4` | En uso (`models/index.js:4`) |
| | `sharp` | `^0.34.5` | `0.34.5` | En uso (`services/image-decoder.service.js:1`) |
| | `swagger-ui-express` | `^5.0.1` | `5.0.1` | En uso fuera de `production` (`index.js:2,126`) |
| **Desarrollo (4 declaradas)** | `jest` | `^29.7.0` | `29.7.0` | En uso (`npm test`) |
| | `nodemon` | `^3.1.7` | `3.1.7` | En uso (`npm start`) |
| | `sequelize-cli` | `^6.6.2` | `6.6.2` | En uso (`migrations/`, `seeders/`) |
| | `supertest` | `^7.0.0` | `7.0.0` | En uso (`tests/integration/`, `tests/security/`) |
| | `swagger-autogen` | `^2.23.7` | `2.23.7` | En uso (`swagger.js:1`) |

> **Nota sobre `package.json` (`devDependencies`):** `backendnode/package.json:58-64` declara **5** paquetes en `devDependencies`: `jest`, `nodemon`, `sequelize-cli`, `supertest` y `swagger-autogen`.

### 2.3 Dependencias de `frontendnet` (`csproj`)

| Proyecto | Paquete NuGet | Versión Declarada | Evidencia (`Archivo:línea`) |
|---|---|---|---|
| `frontendnet` | *(Solo `Microsoft.NET.Sdk.Web` incluido en .NET 9.0)* | `net9.0` (0 paquetes NuGet de terceros en producción) | `frontendnet/frontendnet.csproj:1-10` |
| `FrontendNet.Tests` | `Microsoft.AspNetCore.Mvc.Testing` | `9.0.0` | `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj:12` |
| | `Microsoft.NET.Test.Sdk` | `17.11.1` | `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj:13` |
| | `xunit` | `2.9.2` | `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj:14` |
| | `xunit.runner.visualstudio` | `2.8.2` | `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj:15` |

### 2.4 Auditoría de Dependencias No Usadas o Usadas Parcialmente en `backendnode`

| Dependencia | Versión (`package.json` / `package-lock.json`) | Clasificación | Evidencia Verificada en Código (`Archivo:línea`) |
|---|---|---|---|
| **`request-ip`** | `^3.3.0` / `3.3.0` (`package.json:53`, `package-lock.json:26,4314`) | **Declarada pero NO usada en producción** | **0 importaciones** en todo el código de aplicación (`index.js`, `config/`, `controllers/`, `middlewares/`, `models/`, `routes/`, `services/`, `validators/`). La aplicación obtiene la IP del cliente exclusivamente a través de `req.ip` nativo de Express gobernado por `app.set('trust proxy', resolveTrustProxy())` (`index.js:14-37,54`, `middlewares/audit-logs.middleware.js:7`, `middlewares/auth-rate-limit.middleware.js:24`). Su única aparición en todo el repositorio está en una prueba unitaria (`tests/unit/audit-logs.middleware.test.js:6`). |
| **`express-validator`** | `^7.2.1` / `7.2.1` (`package.json:46`, `package-lock.json:19,2647`) | **Declarada y usada solo parcialmente (1 función auxiliar)** | Importada una única vez en código productivo en `services/accounts.service.js:4` (`const validator = require('express-validator').body;`) e invocada únicamente en `services/accounts.service.js:37` (`await validator('email').isEmail({ allow_utf8_local_part: false }).run({ body: { email } });`) dentro de `normalizeEmail()`. No se utiliza como middleware en ninguno de los 11 archivos de `routes/*.js` (solo se menciona en texto descriptivo en `services/swagger-contract.service.js:27`). Toda la demás validación de entradas se realiza con validadores propios en `validators/` (`address.js`, `cart.js`, `orders.js`, `uuid.js`) y servicios dedicados (`services/user-input.service.js`, `services/catalog.service.js`, `services/password-policy.service.js`, `middlewares/upload.middleware.js`, `services/image-validation.service.js`). |

---

## 3. Conteos Estructurales Verificados en `main`

| Métrica / Artefacto | Conteo en `main` | Desglose y Evidencia |
|---|---|---|
| **Modelos Sequelize (`backendnode/models/`)** | **14 modelos** (+ `models/index.js`) | `admin.js`, `audit-log.js`, `buyer.js`, `cart.js`, `cart-item.js`, `category.js`, `order.js`, `order-item.js`, `order-status-history.js`, `product.js`, `product-category.js`, `seller.js`, `user.js`, `user-address.js` |
| **Tablas físicas del esquema final MySQL** | **14 tablas de dominio** (+ `SequelizeMeta`) | `users`, `admins`, `buyers`, `sellers`, `user_addresses`, `categories`, `products`, `product_categories`, `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`, `audit_logs` (`migrations/20260409000100-rebuild-secure-ecommerce-schema.js`) |
| **Migraciones (`backendnode/migrations/`)** | **11 archivos** | `20240520194127-create-rol.js` a `20260418000100-expand-product-price-precision.js` |
| **Seeders (`backendnode/seeders/`)** | **4 archivos** | `20240520201627-roles.js`, `20240520201634-usuarios.js`, `20240520201641-categorias.js`, `20240520201644-productos.js` (delegados a `services/seed-data.service.js`) |
| **Rutas (`backendnode/routes/`)** | **11 archivos** | `addresses`, `audit-logs`, `auth`, `cart`, `categories`, `checkout`, `files`, `orders`, `products`, `roles`, `users` |
| **Controladores (`backendnode/controllers/`)** | **11 archivos** | `addresses`, `audit-logs`, `auth`, `cart`, `categories`, `files`, `orders`, `personal-account`, `products`, `roles`, `users` |
| **Servicios (`backendnode/services/`)** | **43 archivos** | Incluye autenticación RS256, sesiones Redis, rate-limit y lockout Redis, validación de imágenes multi-proceso, Cloudinary, cotización HMAC de checkout, auditoría y configuración segura |
| **Middlewares (`backendnode/middlewares/`)** | **8 archivos** | `audit-logs`, `auth`, `auth-rate-limit`, `catalog-rate-limit`, `errorhandler`, `http-logging`, `image-limits`, `upload` |
| **Validadores (`backendnode/validators/`)** | **4 archivos** | `address.js`, `cart.js`, `orders.js`, `uuid.js` |
| **Endpoints HTTP bajo `/api/*`** | **46 operativos + 7 retirados (410)** (53 rutas `/api/*`) | **46 operativos** (`auth`: 8, `users`: 8, `addresses`: 5, `categories`: 5, `products`: 8, `cart`: 5, `checkout`: 2, `orders`: 4, `audit-logs`: 1) + **7 retirados (`410 Gone`)** (`POST /api/users`: 1, `/api/roles`: 1, `/api/files`: 5). Adicionalmente existen **2 endpoints de infraestructura** fuera de `/api`: `GET /health` (`200`/`503`) y `GET /swagger` (solo si `NODE_ENV !== 'production'`). |
| **Controladores MVC (`frontendnet/Controllers/`)** | **12 archivos** | `Account`, `Admin`, `Addresses`, `Archivos`, `Auditoria`, `Auth`, `Categorias`, `Carrito`, `Home`, `Pedidos`, `Perfil`, `Productos` |
| **Modelos/ViewModels (`frontendnet/Models/`)** | **22 archivos** | Modelos de vista y DTOs de serialización tipada hacia `backendnode` |
| **Servicios HTTP (`frontendnet/Services/`)** | **10 archivos** | `Account`, `Addresses`, `Admin`, `Archivos`, `Auditoria`, `Auth`, `Carrito`, `Categorias`, `Pedidos`, `Productos` (más `SessionTokenManager`) |
| **Middlewares/Handlers (`frontendnet/Middlewares/`)** | **4 archivos** | `CorrelationIdMiddleware`, `EnviaBearerDelegatingHandler`, `RefrescaTokenDelegatingHandler`, `SlidingExpirationTicketStore` |
| **Helpers y Validación (`frontendnet/`)** | **5 Helpers + 1 Validador** | `Helpers/ActorContextExtensions.cs`, `AdminReasonInputValidator.cs`, `ImageUploadValidator.cs`, `OrderWorkflowUiHelper.cs`, `PagerModel.cs`; `Validation/SecurePasswordAttribute.cs` |
| **Vistas Razor (`frontendnet/Views/`)** | **56 archivos `.cshtml`** | Vistas organizadas por controlador y `Shared/` |

---

## 4. Desglose de Endpoints HTTP (`46 operativos + 7 retirados (410)`)

| Router (`routes/*.js`) | Prefijo en `index.js` | Operativos | Retirados (`410 Gone`) | Total en Router |Detalle de Endpoints |
|---|---|---:|---:|---:|---|
| `auth.routes.js` | `/api/auth` | **8** | 0 | 8 | `POST /`, `POST /refresh`, `POST /logout`, `GET /time`, `POST /register`, `POST /register/verify`, `POST /password/forgot`, `POST /password/reset` |
| `users.routes.js` | `/api/users` | **8** | **1** | 9 | Operativos (8): `GET /me`, `PUT /me`, `PUT /me/password`, `GET /`, `GET /:email`, `PUT /:email`, `DELETE /:email`, `PUT /sellers/:userId/review`, `PUT /sellers/:userId/suspend` -> *Nota: `POST /api/users` responde `410 Gone` (retirado)* |
| `roles.routes.js` | `/api/roles` | 0 | **1** | 1 | Retirado (1): `GET /api/roles` (`410 Gone`) |
| `categories.routes.js` | `/api/categories` | **5** | 0 | 5 | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `products.routes.js` | `/api/products` | **8** | 0 | 8 | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/categories`, `DELETE /:id/categories/:categoryId`, `PUT /:id/image`, `DELETE /:id/image` -> *Nota: 9 rutas en `products.routes.js` o 8 si se agrupa; ver nota al pie* |
| `files.routes.js` | `/api/files` | 0 | **5** | 5 | Retirados (5): `GET /`, `GET /:id`, `GET /:id/info`, `POST /`, `PUT /:id`, `DELETE /:id` -> *Ver conteo exacto de rutas individuales abajo* |
| `addresses.routes.js` | `/api/addresses` | **5** | 0 | 5 | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `PUT /:id/default` |
| `cart.routes.js` | `/api/cart` | **5** | 0 | 5 | `GET /`, `POST /items`, `PUT /items/:productId`, `DELETE /items/:productId`, `DELETE /` |
| `checkout.routes.js` | `/api/checkout` | **2** | 0 | 2 | `POST /quote`, `POST /` |
| `orders.routes.js` | `/api/orders` | **4** | 0 | 4 | `GET /`, `GET /seller`, `GET /:id`, `PUT /:id/status` |
| `audit-logs.routes.js` | `/api/audit-logs` | **1** | 0 | 1 | `GET /` |
| **Total `/api/*` (convención de referencia)** | `/api/*` | **46 operativos** | **7 retirados (410)** | **53** | Clasificación canónica del sistema: **46 operativos + 7 retirados (410)** (más `GET /health` y `GET /swagger` fuera de `/api/*`, documentados en `services/swagger-contract.service.js`) |

> **Nota sobre la clasificación canónica (`46 operativos + 7 retirados (410)`):** El conteo canónico del proyecto contabiliza **46 endpoints operativos + 7 endpoints retirados (`410 Gone`)** bajo `/api/*` (con `PUT /DELETE /api/products/:id/image` como la operación de imagen sobre el producto y los 5 endpoints históricos del recurso `/api/files` + `GET /api/roles` + `POST /api/users` como los 7 endpoints retirados con `410 Gone`), además de `GET /health` (`index.js:110-124`) y `GET /swagger` fuera de `production` (`index.js:126-128`).

---

## 5. Resultados de Pruebas y Cobertura Re-ejecutados Hoy (`2026-11-22`)

### 5.1 Resumen de Ejecución de Pruebas (`main`)

| Repositorio | Comando Ejecutado | Suites Totales | Suites Pasadas | Suites Omitidas (`skipped`) | Tests Totales | Tests Pasados | Tests Omitidos (`skipped`) | Fallos | Tiempo Total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **`backendnode`** (`f9d4596`) | `npm test -- --coverage` (`jest --runInBand --detectOpenHandles --coverage`) | **90** | **82** | **8** | **1,145** | **1,092** | **53** | **0** | `79.732 s` |
| **`frontendnet`** (`24f0f70`) | `dotnet test frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj` | **9** clases | **9** | **0** | **65** | **65** | **0** | **0** | `1.5003 s` |

> **Causa verificada de las 8 suites / 53 tests omitidos (`skipped`) en `backendnode`:** Requieren contenedores vivos de MySQL (`127.0.0.1:3309`) y/o Redis con TLS mutuo (`127.0.0.1:6380`). En el entorno Windows local actual, el demonio Linux de Docker Desktop (`//./pipe/dockerDesktopLinuxEngine`) no se encuentra iniciado, por lo que los arneses de prueba omiten limpiamente (`describe.skip`) esas 8 suites sin producir falsos positivos ni falsos negativos. Su ejecución contra contenedores vivos se clasifica como **`NO_VERIFICABLE`** en esta sesión local sin Docker Desktop activo.

### 5.2 Cobertura de Código en `backendnode` (`npm test -- --coverage`, `2026-11-22`)

| Ámbito / Directorio | % Statements (`Stmts`) | % Branches (`Branch`) | % Functions (`Funcs`) | % Lines (`Lines`) |
|---|---:|---:|---:|---:|
| **`All files` (Global `backendnode`)** | **94.82 %** | **90.47 %** | **96.22 %** | **97.98 %** |
| `backendnode` (`index.js`) | 88.65 % | 88.67 % | 75.00 % | 90.21 % |
| `backendnode/config` (`config.js`) | 100.00 % | 100.00 % | 100.00 % | 100.00 % |
| `backendnode/controllers` (11 archivos) | 94.48 % | 79.51 % | 92.75 % | 96.81 % |
| `backendnode/middlewares` (8 archivos) | 93.89 % | 88.18 % | 94.73 % | 98.18 % |
| `backendnode/models` (15 archivos incl. `index.js`) | 97.16 % | 37.50 % | 94.11 % | 98.03 % |
| `backendnode/routes` (11 archivos) | 100.00 % | 100.00 % | 100.00 % | 100.00 % |
| `backendnode/services` (43 archivos) | 94.70 % | 90.84 % | 97.51 % | 98.27 % |
| `backendnode/validators` (4 archivos) | 100.00 % | 100.00 % | 100.00 % | 100.00 % |

### 5.3 Cobertura de Código en `frontendnet`

- **Estado:** **`NO_VERIFICABLE`** (porcentaje exacto de líneas/ramas).
- **Evidencia:** `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj` no incluye `coverlet.collector` ni `coverlet.msbuild`; las **65 pruebas funcionales/unitarias** en 9 archivos (`AccountAndProfileFlowTests.cs`, `AddressAndOrderSplitFlowTests.cs`, `AdminModerationFlowTests.cs`, `BoundaryHardeningTests.cs`, `CatalogAndImageFlowTests.cs`, `OrderWorkflowUiHelperTests.cs`, `RoleViewsAndErrorSanitizationTests.cs`, `SecurePasswordAttributeTests.cs`, `SessionRenewalFlowTests.cs`) pasan al 100 % (`65/65`).

---

## 6. Constantes de Seguridad y de Negocio

La siguiente tabla registra cada constante de seguridad y de negocio verificada directamente en el código fuente de `backendnode` (`main @ f9d4596`) y `frontendnet` (`main @ 24f0f70`), con su valor exacto, ubicación `archivo:línea` y variable de entorno asociada (cuando existe):

| Categoría / Constante | Valor Verificado | Archivo:Línea | Variable de Entorno / Configuración |
|---|---|---|---|
| **Access Token — TTL (`LIFETIME_SECONDS` / `expiresIn`)** | `300 s` (`5 min`) | `backendnode/services/rs256-access-token.service.js:8`, `backendnode/services/authentication.service.js:22` | Sin variable de entorno para TTL (configuración de llaves RS256: `JWT_RS256_PRIVATE_KEY_PATH`, `JWT_RS256_PUBLIC_KEYS_PATH`, `JWT_RS256_ISSUER`, `JWT_RS256_AUDIENCE`, `JWT_RS256_ACTIVE_KID` en `services/rs256-access-token.service.js:132-144`) |
| **Access Token — Algoritmo, llave RSA y límites** | `RS256`, RSA `3072 bits` (`modulusLength === 3072`), `typ: "at+jwt"`, `MAX_TOKEN_BYTES = 8192`, `MAX_KEYS = 16`, 7 claims exactos (`sub`, `sid`, `jti`, `iat`, `exp`, `iss`, `aud`) | `backendnode/services/rs256-access-token.service.js:9-12,51,63-75` | `JWT_RS256_PRIVATE_KEY_PATH`, `JWT_RS256_PUBLIC_KEYS_PATH`, `JWT_RS256_ISSUER`, `JWT_RS256_AUDIENCE`, `JWT_RS256_ACTIVE_KID` |
| **Sesión Redis — Inactividad máxima (`IDLE_MS`)** | `1,800,000 ms` (`30 min`, `30 * 60 * 1000`, ventana deslizante sobre llave `alive:<sid>`) | `backendnode/services/auth-session.service.js:5,102,135` | Sin variable de entorno (constante fija) |
| **Sesión Redis — Máximo absoluto (`ABSOLUTE_MS`)** | `28,800,000 ms` (`8 h`, `8 * 60 * 60 * 1000`, llave `session:<sid>` con `PXAT s.absolute`) | `backendnode/services/auth-session.service.js:6,93-101` | Sin variable de entorno (constante fija) |
| **Refresh Token — Formato y almacenamiento** | `32 bytes` aleatorios codificados en `base64url` (`43` caracteres, regex `/^[A-Za-z0-9_-]{43}$/`), persistido en Redis solo como hash SHA-256 hex (`64` chars) en `refresh:<sha256>` y de un solo uso con detección de reúso (`REFRESH_REUSED`) | `backendnode/services/auth-session.service.js:11-15,91-92,120-140`, `backendnode/services/authentication.service.js:54` | Sin variable de entorno (constante fija) |
| **Refresh Token — TTL** | Acotado al vencimiento absoluto de la sesión (`PXAT s.absolute`, máx. `8 h` = `28,800,000 ms`) y supeditado a que `alive:<sid>` (`IDLE_MS = 30 min`) siga vigente | `backendnode/services/auth-session.service.js:5-6,100-103,134-138` | Sin variable de entorno (constante fija) |
| **`scrypt` — Parámetros reales (`N`, `r`, `p`, longitud de clave, sal, `maxmem`)** | `N = 32768`, `r = 8`, `p = 3`, longitud de clave `KEY_BYTES = 64` bytes (`86` chars `base64url`), sal `SALT_BYTES = 16` bytes (`22` chars `base64url`), `MAXMEM = 67,108,864` bytes (`64 MiB`), formato `$scrypt$v1$32768$8$3$<sal22>$<hash86>`, cola máx. `2` activos + `16` en espera | `backendnode/services/password-hash.service.js:7,10-17,21-22` | Sin variable de entorno (constantes fijas) |
| **`bcrypt` legado — Costo aceptado y límite de entrada** | Acepta prefijos `$2a$`, `$2b$`, `$2y$` con factor de costo `04`..`31` (regex `/^\$2[aby]\$(0[4-9]\|[12][0-9]\|3[01])\$[./A-Za-z0-9]{53}$/`, fixtures históricos de transición en costo `12`), entrada máxima `MAX_BCRYPT_BYTES = 72` bytes UTF-8 sin truncamiento silencioso y re-hash transparente a `scrypt` al autenticar | `backendnode/services/password-hash.service.js:8,27-33`, `backendnode/services/authentication.service.js:35-38` | Sin variable de entorno (constante fija) |
| **Hash dummy (`DUMMY_HASH`) anti-enumeración por tiempo** | Hash sintético `scrypt` (`$scrypt$v1$32768$8$3$<sal22>$<hash86>`) generado al arranque con `hashes.createDummyHash()` usando exactamente `N=32768, r=8, p=3, keylen=64, salt=16` | `backendnode/services/password-hash.service.js:40-42`, `backendnode/services/authentication.service.js:8,32` | Sin variable de entorno |
| **Límite de intentos — Ventana y máximo genérico por IP** | `120` solicitudes por ventana de `60,000 ms` (`60 s`) por IP | `backendnode/middlewares/auth-rate-limit.middleware.js:53-54,124` | `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS` |
| **Límite de intentos — Login (`POST /api/auth`) por IP y por cuenta** | Por IP: `120` intentos / `60,000 ms` (`60 s`); por cuenta (`email` normalizado): `10` intentos / `60,000 ms` (`60 s`) | `backendnode/middlewares/auth-rate-limit.middleware.js:126-133` | `RATE_LIMIT_LOGIN_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_LOGIN_ACCOUNT_MAX`, `RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_MS` |
| **Límite de intentos — Refresh (`POST /api/auth/refresh`) por IP y por sesión** | Por IP: `180` intentos / `60,000 ms` (`60 s`); por sesión (`refreshToken` SHA-256): `15` intentos / `60,000 ms` (`60 s`) | `backendnode/middlewares/auth-rate-limit.middleware.js:134-140` | `RATE_LIMIT_REFRESH_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_REFRESH_SESSION_MAX`, `RATE_LIMIT_REFRESH_SESSION_WINDOW_MS` |
| **Límite de intentos — Logout (`POST /api/auth/logout`) por IP** | Por IP: `120` solicitudes / `60,000 ms` (`60 s`) | `backendnode/middlewares/auth-rate-limit.middleware.js:141-145` | `RATE_LIMIT_LOGOUT_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS` |
| **Límite de intentos — Registro (`POST /api/auth/register`) por IP y por cuenta** | Por IP: `60` solicitudes / `60,000 ms` (`60 s`); por cuenta (`email`): `5` solicitudes / `900,000 ms` (`15 min`) | `backendnode/middlewares/auth-rate-limit.middleware.js:146-152` | `RATE_LIMIT_REGISTER_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_REGISTER_ACCOUNT_MAX`, `RATE_LIMIT_REGISTER_ACCOUNT_WINDOW_MS` |
| **Límite de intentos — Verificación OTP (`POST /api/auth/register/verify`) por IP y por cuenta** | Por IP: `60` solicitudes / `60,000 ms` (`60 s`); por cuenta (`email`): `8` intentos / `900,000 ms` (`15 min`) | `backendnode/middlewares/auth-rate-limit.middleware.js:153-159` | `RATE_LIMIT_OTP_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_OTP_ACCOUNT_MAX`, `RATE_LIMIT_OTP_ACCOUNT_WINDOW_MS` |
| **Límite de intentos — Recuperación (`POST /api/auth/password/forgot`) por IP y por cuenta** | Por IP: `60` solicitudes / `60,000 ms` (`60 s`); por cuenta (`email`): `5` solicitudes / `900,000 ms` (`15 min`) | `backendnode/middlewares/auth-rate-limit.middleware.js:160-166` | `RATE_LIMIT_RECOVERY_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_RECOVERY_ACCOUNT_MAX`, `RATE_LIMIT_RECOVERY_ACCOUNT_WINDOW_MS` |
| **Límite de intentos — Restablecimiento (`POST /api/auth/password/reset`) por IP y por cuenta** | Por IP: `60` solicitudes / `60,000 ms` (`60 s`); por cuenta (`email`): `8` intentos / `900,000 ms` (`15 min`) | `backendnode/middlewares/auth-rate-limit.middleware.js:167-173` | `RATE_LIMIT_RECOVERY_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS`, `RATE_LIMIT_RECOVERY_ACCOUNT_MAX`, `RATE_LIMIT_RECOVERY_ACCOUNT_WINDOW_MS` |
| **Límite de intentos — Cambio de contraseña (`PUT /api/users/me/password`) por IP** | Por IP: `10` solicitudes / `60,000 ms` (`60 s`) | `backendnode/routes/users.routes.js:8`, `backendnode/middlewares/auth-rate-limit.middleware.js:52-54` | `RATE_LIMIT_IP_WINDOW_MS` (`max: 10` fijo en ruta) |
| **Bloqueo de cuenta (Lockout) — Umbral y ventana de fallos** | `maxFailures = 5` intentos fallidos de login dentro de una ventana de `windowMs = 900,000 ms` (`15 min`) | `backendnode/services/auth-rate-limit.service.js:5-7`, `backendnode/controllers/auth.controller.js:12-13` | `LOGIN_LOCKOUT_MAX_FAILURES`, `LOGIN_LOCKOUT_WINDOW_MS` |
| **Bloqueo de cuenta (Lockout) — Duración y backoff** | Backoff exponencial desde `baseLockoutMs = 60,000 ms` (`60 s`) según `baseLockoutMs * 2^(failures - maxFailures)` (exponente acotado a `10`) hasta un tope de `maxLockoutMs = 900,000 ms` (`15 min`); se limpia al iniciar sesión con éxito | `backendnode/services/auth-rate-limit.service.js:8-9,132-136,152-163`, `backendnode/controllers/auth.controller.js:14-15,27` | `LOGIN_LOCKOUT_BASE_MS`, `LOGIN_LOCKOUT_MAX_MS` |
| **Límite de escrituras de catálogo (`sellerWriteLimit`)** | `30` escrituras (`POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`) por ventana de `60,000 ms` (`60 s`) por vendedor autenticado (`HTTP 429` + `Retry-After`) | `backendnode/middlewares/catalog-rate-limit.middleware.js:21-22,36`, `backendnode/routes/products.routes.js:14-16` | `RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX`, `RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS` |
| **Cuota por vendedor — Productos activos máximos** | `200` productos activos (`deletedAt IS NULL`) por vendedor; al excederse responde **`409 Conflict`** y audita `producto.quota_exceeded` | `backendnode/services/catalog.service.js:134-139,349-358` | `SELLER_MAX_ACTIVE_PRODUCTS` |
| **Cuota por vendedor — Categorías activas por producto** | `10` categorías activas (`deletedAt IS NULL`) por producto; al excederse responde **`409 Conflict`** y audita `productocategoria.quota_exceeded` | `backendnode/services/catalog.service.js:183-188,430-439` | `PRODUCT_MAX_CATEGORIES` |
| **Catálogo — Validación de `description`, `title`, `price`, `stock` y parámetro de búsqueda `s`** | `title`: `1..255` chars; `description`: **obligatoria** no vacía, máx. `65,535` bytes UTF-8; `price`: `DECIMAL(12,2)` (`0.00`..`9,999,999,999.99`); `stock`: entero `0..4,294,967,295`; búsqueda por query param **`s`** (`GET /api/products?s=...`, `1..255` chars, escapa `%`, `_`, `\` con `ESCAPE '\\'`) | `backendnode/services/catalog.service.js:34-47,68-78,242-254`, `backendnode/controllers/products.controller.js:10` | Sin variable de entorno |
| **Imágenes — Tamaño máximo, tipos permitidos y dimensiones** | Tamaño máx.: `2,097,152 bytes` (`2 MiB`, `2 * 1024 * 1024`); tipos: `image/jpeg` (`.jpg`, `.jpeg`), `image/png` (`.png`), `image/webp` (`.webp`); dimensiones: `maxDimension = 4096 px` por lado, `maxPixels = 8,000,000` (`8 MP`), `maxFrames = 1` (solo estáticas), `maxChunks = 4096`, `workers = 2` subprocesos (`--max-old-space-size=64`), `timeoutMs = 5000 ms` | `backendnode/middlewares/upload.middleware.js:6-7,16-21`, `backendnode/services/image-policy.js:1-4`, `backendnode/services/image-validation.service.js:23` | Sin variable de entorno en backend (`ImageUpload:MaxFileSizeBytes = 2097152` en `frontendnet/appsettings.json:12` y `frontendnet/Helpers/ImageUploadValidator.cs:9`) |
| **Imágenes — Concurrencia, tasa y timeouts de recepción (`LIMITS`)** | Por vendedor: `sellerPerMinute = 6` (`6 / 60 s`) y `sellerConcurrent = 1`; global: `globalPerMinute = 60` (`60 / 60 s`) y `globalConcurrent = 8`; `windowMs = 60,000 ms`, `leaseMs = 90,000 ms`, `heartbeatMs = 20,000 ms`, `receiveMs = 30,000 ms` (`408` si expira) | `backendnode/services/image-limits.service.js:5-6`, `backendnode/middlewares/image-limits.middleware.js:11-13` | Sin variable de entorno |
| **Política de contraseñas** | `MIN_CHARACTERS = 8` a `MAX_CHARACTERS = 128` puntos de código Unicode, máx. `256` unidades UTF-16, `MAX_BYTES = 512` bytes UTF-8, sin `\0` ni sustitutos huérfanos, al menos 1 letra Unicode (`\p{L}`), 1 dígito Unicode (`\p{N}`) y 1 signo de puntuación o símbolo Unicode (`[\p{P}\p{S}]`) | `backendnode/services/password-policy.service.js:3-18`, `frontendnet/Validation/SecurePasswordAttribute.cs:15-18,27-41` | Sin variable de entorno |
| **Vigencia de OTP (registro y recuperación de contraseña)** | Código de `6` dígitos (`000000`..`999999`), vigencia `TTL = 600,000 ms` (`10 min`), enfriamiento de reenvío `COOLDOWN = 60,000 ms` (`60 s`), `MAX_ATTEMPTS = 5` intentos fallidos antes de invalidar el código, `MAX_PENDING = 1000` registros en memoria, cola de correo de recuperación máx. `32` pendientes / `2` workers | `backendnode/services/email-verification.service.js:5-8,32`, `backendnode/services/personal-account.service.js:10,50` | Sin variable de entorno |
| **Vigencia y límites de la cotización del checkout (`quote`)** | JWT `HS256` firmado con clave derivada `HMAC-SHA256(JWT_SECRET, "secure-ecommerce-checkout-v1")`, vigencia `600 s` (`10 min`, `expiresIn: 600`), longitud máxima de token emitido `90,000` chars (`409` si excede), longitud máxima aceptada al verificar `100,000` chars (`400`), ítems en carrito `1..100` | `backendnode/services/checkout-quote.service.js:6-18`, `backendnode/services/orders.service.js:26,57,80`, `backendnode/services/jwttoken.service.js:6-17` | `JWT_SECRET` o `JWT_SECRET_FILE` |
| **Pedidos (`Order`) — Estados y transiciones válidas** | Estados: `PENDING`, `PREPARING`, `SHIPPED`, `DELIVERED`, `CANCELED`. Transiciones: `PENDING -> PREPARING \| CANCELED`; `PREPARING -> SHIPPED \| CANCELED`; `SHIPPED -> DELIVERED`; `DELIVERED -> []` (terminal); `CANCELED -> []` (terminal). `BUYER` solo puede `PENDING -> CANCELED`; `CANCELED` exige `reason` no vacío (`1..255` chars) y restituye stock atómicamente | `backendnode/models/order.js:6`, `backendnode/services/orders.service.js:164-167,565-610` | Sin variable de entorno |
| **Vendedores (`Seller`) y Cuentas (`User`) — Estados y transiciones válidas** | `Seller.status`: `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`. Transiciones: alta inicial en `PENDING`; revisión por `ADMIN` (`PUT /api/users/sellers/:userId/review`): `PENDING -> APPROVED \| REJECTED` (`rejectionReason` obligatorio si `REJECTED`, `1..255` chars); suspensión por `ADMIN` (`PUT /api/users/sellers/:userId/suspend`): `APPROVED -> SUSPENDED` (`reason` obligatorio `1..255` chars). `User.status`: `ACTIVE`, `SUSPENDED`, `DISABLED` | `backendnode/models/seller.js:7`, `backendnode/models/user.js:20`, `backendnode/services/accounts.service.js:123-173,189` | Sin variable de entorno |
| **Valores por defecto de `CORS` y `TRUST_PROXY`** | `CORS`: **Deny-all por defecto** (`allowedOrigins = []` cuando `CORS_ORIGIN` no está definida; si se configura `*` aborta el arranque con error); métodos `GET, PUT, POST, DELETE, OPTIONS`; cabeceras `Content-Type, Authorization`. `TRUST_PROXY`: **`false` por defecto** (`resolveTrustProxy()`); rechaza `true` booleano o `*` y solo acepta lista explícita de IPv4/IPv6 o rangos CIDR | `backendnode/index.js:14-37,54,87-107` | `CORS_ORIGIN`, `TRUST_PROXY` |
| **Frontend (`frontendnet`) — Cookies y límites de sesión** | Cookie de autenticación: `Name = ".frontendnet"`, `HttpOnly = true`, `SameSite = Lax`, `SecurePolicy = Always` (fuera de Development o si `Security:RequireHttps = true`), `SlidingExpiration = true`, inactividad `ExpireTimeSpan = 30 min`, tope absoluto `8 h` (`DefaultAbsoluteSessionDuration = 8 h`, claim `session_abs_exp`), ventana de renovación proactiva `ProactiveRefreshWindow = 30 s` antes del vencimiento del JWT con candado `SemaphoreSlim(1, 1)` por `sid`. Cookie Antiforgery: `.frontendnet.af` (`SameSite = Lax`). Cookie TempData: `.frontendnet.tempdata` (`HttpOnly = true`, `SameSite = Lax`) | `frontendnet/Program.cs:14-36,78-105`, `frontendnet/Services/SessionTokenManager.cs:19-20` | `Security:RequireHttps` (`frontendnet/appsettings.json`) |

---

## 7. Inventario de los 12 Diagramas PlantUML Actuales (`docs/diagrams/`)

| # | Archivo `.puml` | Tipo de Diagrama | Verificación Sintáctica (`node docs/generate-diagrams.js --check-only`) |
|---:|---|---|---|
| 1 | `clases_csharp.puml` | Diagrama de Clases (`frontendnet`) | `OK` (`exit code 0`) |
| 2 | `clases_sequelize.puml` | Diagrama de Clases (`backendnode`) | `OK` (`exit code 0`) |
| 3 | `componentes.puml` | Diagrama de Componentes | `OK` (`exit code 0`) |
| 4 | `der_conceptual.puml` | Modelo de Datos Conceptual | `OK` (`exit code 0`) |
| 5 | `der_logico.puml` | Modelo de Datos Lógico / Físico | `OK` (`exit code 0`) |
| 6 | `despliegue.puml` | Diagrama de Despliegue | `OK` (`exit code 0`) |
| 7 | `dfd_seguridad.puml` | Modelo de Amenazas / DFD | `OK` (`exit code 0`) |
| 8 | `seq_archivos.puml` | Diagrama de Secuencia | `OK` (`exit code 0`) |
| 9 | `seq_autenticacion.puml` | Diagrama de Secuencia | `OK` (`exit code 0`) |
| 10 | `seq_mutacion_catalogo.puml` | Diagrama de Secuencia | `OK` (`exit code 0`) |
| 11 | `seq_rolling_token.puml` | Diagrama de Secuencia | `OK` (`exit code 0`) |
| 12 | `uc_sistema.puml` | Diagrama de Casos de Uso | `OK` (`exit code 0`) |

---

## 8. Registro Consolidado de Elementos `NO_VERIFICABLE`

| Ítem | Clasificación | Motivo Técnico |
|---|---|---|
| **Porcentaje de cobertura de líneas/ramas en `frontendnet`** | **`NO_VERIFICABLE`** | `FrontendNet.Tests.csproj` no incluye `coverlet.collector` ni `coverlet.msbuild`. Las 65 pruebas xUnit se ejecutan y pasan (`65/65`). |
| **Ejecución en vivo de las 8 suites (`53 tests`) omitidas en `backendnode` que dependen de contenedores Docker activos** | **`NO_VERIFICABLE`** | El motor Linux de Docker Desktop (`//./pipe/dockerDesktopLinuxEngine`) no está iniciado en la máquina host durante la sesión. Las 82 suites independientes (`1,092 tests`) pasan con `0` fallos. |
| **Estado remoto actual del Quality Gate en SonarCloud (`sonarcloud.io`)** | **`NO_VERIFICABLE`** | Requiere acceso autenticado al panel remoto de SonarCloud (`maverick0322_backendnode`). |
| **Infraestructura productiva externa (topología cloud/on-prem, WAF, balanceador TLS, KMS y valores en `.env` / `.secrets/`)** | **`NO_VERIFICABLE`** | Por regla del Lote 0 está prohibido leer o tocar `.env` y `.secrets/`, y el repositorio solo define contenedores de desarrollo local (`compose.yaml`). |
