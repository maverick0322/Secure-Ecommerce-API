# Línea Base del Proyecto (`BASELINE.md`)

- **Fecha de corte y verificación:** `2026-11-22`
- **Propósito:** Fuente única de verdad (*Single Source of Truth*) para hashes de Git, versiones de runtime, imágenes base, dependencias, conteos de arquitectura, endpoints, tablas/migraciones y resultados de pruebas y cobertura que utilizará la reescritura de la documentación técnica y de seguridad.
- **Criterio de verificación:** Toda cifra incluida en este documento fue obtenida directamente de los repositorios `backendnode/` y `frontendnet/` mediante comandos reproducibles ejecutados el `2026-11-22`. Todo elemento que requiere infraestructura externa no disponible en el entorno local o evidencia de producción se marca explícitamente como `NO_VERIFICABLE`.

---

## 1. Estado de Repositorios Git (`2026-11-22`)

> **Nota crítica sobre topología de ramas en `backendnode`:** Al iniciar el corte del Lote 0 (`2026-11-22`), el árbol de trabajo de `backendnode` se encontraba posicionado en la rama `main` (`c5b66a55024eab69986dd7e7762a4b22ef7f32c5`), mientras que la auditoría previa del `2026-11-20` se ejecutó sobre la rama local `fix/backend-hardening` (`db6e039de9d781cb92f09ef6946cf7916f6196e7`). El commit `db6e039` es un *merge commit* cuyo segundo padre es precisamente `main` (`c5b66a5`), pero **`fix/backend-hardening` aún no ha sido fusionada de vuelta hacia `main`** (está 15 commits por delante de `main` y 3 commits por delante de `origin/fix/backend-hardening`). Para evitar cualquier discrepancia documental antes o después de fusionar `fix/backend-hardening`, esta línea base registra las cifras verificadas de **ambas referencias** (`main @ c5b66a5` y `fix/backend-hardening @ db6e039`), indicando explícitamente dónde difieren.

| Parámetro | Repositorio `backendnode` (Rama base actual `main`) | Repositorio `backendnode` (Rama auditada `fix/backend-hardening`) | Repositorio `frontendnet` |
| :--- | :--- | :--- | :--- |
| **Ruta local** | `c:\codigo\ps\ecommerce\backendnode` | `c:\codigo\ps\ecommerce\backendnode` | `c:\codigo\ps\ecommerce\frontendnet` |
| **Remoto (`origin`)** | `https://github.com/maverick0322/Secure-Ecommerce-API` | `https://github.com/maverick0322/Secure-Ecommerce-API` | `https://github.com/Eugene1805/FrontendNet` |
| **Rama activa antes de Lote 0** | `main` (rama de trabajo creada: `docs/lote-0`) | `fix/backend-hardening` (rama local) | `main` |
| **Commit (`HEAD` completo)** | `c5b66a55024eab69986dd7e7762a4b22ef7f32c5` | `db6e039de9d781cb92f09ef6946cf7916f6196e7` | `24f0f70e9f720893293ddb0c861712d9eeb00c8c` |
| **Commit corto** | `c5b66a5` | `db6e039` | `24f0f70` |
| **Fecha del commit** | `2026-11-20 00:39:05 -0600` | `2026-11-20 04:01:41 -0600` | `2026-11-20 00:54:51 -0600` |
| **Autor del commit** | `Eugene1805` | `maverick0322` | `Eugene1805` |
| **Mensaje del commit** | `Merge pull request #9 from maverick0322/feature/registration-password-product-validation` | `Merge branch 'main' of https://github.com/maverick0322/Secure-Ecommerce-API into fix/backend-hardening` | `chore: merge conflict` |
| **¿Fusionado en `main`?** | **Sí** (`HEAD` de `main` y `origin/main`) | **No** (`main` es ancestro de `db6e039`; faltan 15 commits por fusionar en `main`) | **Sí** (`HEAD` de `main`, `origin/main` y `fix/refresh-session`) |
| **Commits remotos más nuevos tras `git fetch --all`** | **Ninguno en `origin/main`** (`origin/main` = `c5b66a5`). En `origin/feature/registration-password-product-validation` se descargó `3a30c13`, ya integrado en `c5b66a5` | **Ninguno** (`db6e039` está 3 commits adelante de `origin/fix/backend-hardening @ f558bdc`) | **Ninguno** (`origin/main` = `24f0f70`; `origin/fix/refresh-session @ 51aadc4` está 4 commits detrás de `main`) |

---

## 2. Comandos de Verificación Ejecutados

```powershell
# 1. Sincronización e inspección de estado Git en ambos repositorios
git -C c:\codigo\ps\ecommerce\backendnode fetch --all --prune
git -C c:\codigo\ps\ecommerce\backendnode status -sb
git -C c:\codigo\ps\ecommerce\backendnode branch -vv -a
git -C c:\codigo\ps\ecommerce\backendnode merge-base --is-ancestor db6e039 main

git -C c:\codigo\ps\ecommerce\frontendnet fetch --all --prune
git -C c:\codigo\ps\ecommerce\frontendnet status -sb
git -C c:\codigo\ps\ecommerce\frontendnet branch -vv -a

# 2. Creación de rama de documentación Lote 0 (sin push)
git -C c:\codigo\ps\ecommerce\backendnode checkout -b docs/lote-0

# 3. Ejecución de suite de pruebas y cobertura en backendnode
Set-Location c:\codigo\ps\ecommerce\backendnode
npm test -- --coverage

# 4. Ejecución de suite de pruebas en frontendnet
Set-Location c:\codigo\ps\ecommerce\frontendnet\FrontendNet.Tests
dotnet test --logger "console;verbosity=normal"

# 5. Verificación y generación reproducible de diagramas PlantUML (versión fija 1.2024.8)
Set-Location c:\codigo\ps\ecommerce\backendnode
node docs/generate-diagrams.js --check-only
```

---

## 3. Runtimes, Contenedores e Imágenes Base

| Componente | En Entorno Local de Verificación (`2026-11-22`) | En `backendnode` (`main @ c5b66a5`) | En `backendnode` (`fix/backend-hardening @ db6e039`) | En `frontendnet` (`main @ 24f0f70`) |
| :--- | :--- | :--- | :--- | :--- |
| **Node.js Runtime** | `v24.11.1` | `node:20-alpine` (`Dockerfile`), Node `20` en CI (`.github/workflows/*.yml`), sin campo `engines` en `package.json` | `node:24-alpine` (multi-stage 3 etapas en `Dockerfile`), Node `24` en CI, `engines.node: ">=24.0.0 <25.0.0"` | N/A |
| **.NET SDK / Runtime** | `.NET SDK 9.0.111` (runtime `9.0.10`) | N/A | N/A | `net9.0` (`FrontendNet.csproj` y `FrontendNet.Tests.csproj`) |
| **Motor de Base de Datos** | Sin contenedor activo en pruebas unitarias/integración con dobles | `mysql:8.0` (`compose.yaml`, `--default-authentication-plugin=mysql_native_password`, puerto `127.0.0.1:3307:3306`) | `mysql:8.4` (`compose.yaml`, `--authentication-policy=caching_sha2_password,,`, sin puertos expuestos en prod; `127.0.0.1:3307:3306` en `compose.dev.yaml`) | N/A (consume API REST del backend) |
| **Almacén en Memoria (Sesiones/Rate-Limit/OTP)** | Doble en memoria (`tests/support/redis-double.js`) en suite Jest por defecto | `redis:8.2` (`compose.yaml`, TLS 1.3 + ACL, puerto `127.0.0.1:6380:6379`) | `redis:8.2` (`compose.yaml`, TLS 1.3 + ACL, red interna `backend_internal` sin puerto en prod; `127.0.0.1:6380:6379` en `compose.dev.yaml`) | N/A |
| **Java Runtime (Pipeline UML)** | `Java 1.8.0_481` (HotSpot 64-Bit) | N/A | N/A | N/A |
| **Graphviz (`dot`)** | `2.44.1 (20200629.0846)` | N/A | N/A | N/A |
| **PlantUML (Pipeline Docs)** | `1.2024.8` (JAR fijado por SHA-256) | Servidor remoto sin versión fija (`plantuml.com` en `docs/generate-diagrams.js` previo) | Servidor remoto sin versión fija (`plantuml.com` en `docs/generate-diagrams.js` previo) | N/A |
| **Contenedor Docker en `frontendnet`** | `Docker 29.8.2` (CLI instalada; daemon detenido) | N/A | N/A | **No existe `Dockerfile` ni `compose.yaml` en `frontendnet/`** |

---

## 4. Pruebas Automatizadas y Cobertura (`2026-11-22`)

### 4.1 Backend (`backendnode`)

| Métrica | `main @ c5b66a5` (Ejecutado `2026-11-22`) | `fix/backend-hardening @ db6e039` (Verificado) | Observaciones |
| :--- | :--- | :--- | :--- |
| **Framework de pruebas** | Jest `^30.0.0` + Supertest `^7.1.0` | Jest `^30.0.0` + Supertest `^7.1.0` | Ejecución en serie (`--runInBand`) |
| **Suites totales** | **85** | **90** | +5 suites unitarias en `fix/backend-hardening` (`accounts.service`, `catalog-rate-limit.middleware`, `config`, `orders.controller`, `secret-env.service`) |
| **Suites aprobadas (`passed`)** | **77** | **82** | 0 fallos en ambas ramas |
| **Suites omitidas (`skipped`)** | **8** | **8** | Suites en `tests/database/*.mysql.test.js` y `tests/integration/redis-*.live.test.js` que requieren MySQL/Redis en vivo (`RUN_LIVE_REDIS_TESTS=1` / `TEST_DB_HOST`) |
| **Pruebas totales (`tests`)** | **1,100** | **1,145** | +45 pruebas en `fix/backend-hardening` |
| **Pruebas aprobadas (`passed`)** | **1,047** | **1,092** | 100 % de las pruebas ejecutadas aprueban |
| **Pruebas omitidas (`skipped`)** | **53** | **53** | Pruebas de infraestructura MySQL/Redis en vivo |
| **Tiempo de ejecución** | `83.982 s` | `83.318 s` | Medido localmente en Windows |
| **Cobertura — Statements (`% Stmts`)** | **85.11 %** (alcance global por defecto sin `collectCoverageFrom`) | **94.79 %** (alcance de aplicación definido en `package.json -> jest.collectCoverageFrom`) | En `c5b66a5` Jest incluye `scripts/**`, `migrations/**`, `seeders/**` y `postman/scripts/**`; en `db6e039` se alineó `collectCoverageFrom` con SonarCloud (`index.js`, `config/config.js`, `controllers/**`, `middlewares/**`, `routes/**`, `services/**`, `validators/**`, `models/**`) |
| **Cobertura — Branches (`% Branch`)** | **85.60 %** | **90.43 %** | — |
| **Cobertura — Functions (`% Funcs`)** | **89.22 %** | **96.22 %** | — |
| **Cobertura — Lines (`% Lines`)** | **88.33 %** | **97.95 %** | — |

#### Desglose de Cobertura por Directorio en `main @ c5b66a5` (`2026-11-22`)

| Directorio / Ámbito | % Stmts | % Branch | % Funcs | % Lines |
| :--- | :---: | :---: | :---: | :---: |
| **`All files` (`main @ c5b66a5`)** | **85.11 %** | **85.60 %** | **89.22 %** | **88.33 %** |
| `backendnode` (`index.js`, `swagger.js`) | 74.66 % | 47.61 % | 44.44 % | 78.57 % |
| `backendnode/config` (`claim-types.js`, `config.js`) | 75.00 % | 75.86 % | 0.00 % | 75.00 % |
| `backendnode/controllers` (11 archivos) | 88.93 % | 75.71 % | 90.62 % | 89.70 % |
| `backendnode/middlewares` (7 archivos) | 95.72 % | 93.95 % | 93.10 % | 100.00 % |
| `backendnode/models` (15 archivos) | 97.16 % | 37.50 % | 96.96 % | 98.03 % |
| `backendnode/routes` (11 archivos) | 100.00 % | 100.00 % | 100.00 % | 100.00 % |
| `backendnode/services` (41 archivos) | 93.91 % | 90.18 % | 96.90 % | 97.42 % |
| `backendnode/validators` (4 archivos) | 100.00 % | 100.00 % | 100.00 % | 100.00 % |
| `backendnode/migrations` (+ `cutover/`, `support/`) | 92.00 %–97.82 % | 82.60 %–92.30 % | 100.00 % | 92.00 %–97.50 % |
| `backendnode/postman/scripts` (8 archivos) | 82.65 % | 77.28 % | 86.36 % | 86.24 % |
| `backendnode/scripts/*` (`auth`, `database`, `gmail`, `redis`) | 25.81 %–90.27 % | 30.00 %–74.28 % | 42.25 %–76.92 % | 27.74 %–96.42 % |
| `backendnode/seeders` (`20240101000004-seed-users.js`) | 21.05 % | 0.00 % | 33.33 % | 25.00 % |
| `backendnode/tests/support` (12 archivos) | 95.60 % | 86.86 % | 94.36 % | 97.36 % |

### 4.2 Frontend (`frontendnet`)

| Métrica | `main @ 24f0f70` (Ejecutado `2026-11-22`) | Observaciones |
| :--- | :--- | :--- |
| **Framework de pruebas** | xUnit `2.9.2` + `Microsoft.AspNetCore.Mvc.Testing` `9.0.0` + `Microsoft.NET.Test.Sdk` `17.12.0` | Proyecto `FrontendNet.Tests/FrontendNet.Tests.csproj` |
| **Archivos de prueba** | **8** | 4 unitarios (`Tests/Unit/*`) y 4 de integración (`Tests/Integration/*`) + 2 dobles de soporte (`Tests/TestSupport/*`) |
| **Pruebas totalesejecutadas** | **65** | `Pruebas totales: 65, Correcto: 65, Fallidas: 0, Omitidas: 0` |
| **Tiempo de ejecución** | `3.3109 s` | VSTest `17.14.1 (x64)` sobre `.NET 9.0.10` |
| **Cobertura de código (`%`)** | **`NO_VERIFICABLE`** | `FrontendNet.Tests.csproj` no incluye `coverlet.collector` ni `coverlet.msbuild`; al invocar `dotnet test --collect:"XPlat Code Coverage"`, VSTest reporta: `No se pudo encontrar el recopilador de datos "XPlat Code Coverage"` |

---

## 5. Dependencias Clave

### 5.1 `backendnode/package.json`

#### Dependencias de Producción (`15` en `main @ c5b66a5` / `16` en `fix/backend-hardening @ db6e039`)

| Paquete | Versión en `main @ c5b66a5` | Versión en `fix/backend-hardening @ db6e039` | Propósito |
| :--- | :--- | :--- | :--- |
| `bcrypt` | `^6.0.0` | `^6.0.0` | Verificación de hashes legacy `$2a$/$2b$/$2y$` en transición a `scrypt` |
| `cloudinary` | `^2.11.0` | `^2.11.0` | SDK de almacenamiento externo de imágenes de productos |
| `cors` | `^2.8.6` | `^2.8.6` | Control de orígenes cruzados (CORS) |
| `dotenv` | `^16.4.5` | `^16.4.5` | Carga de variables de entorno desde `.env` |
| `express` | `^4.21.2` | `^4.21.2` | Framework HTTP REST |
| `express-validator` | `^7.2.1` | `^7.2.1` | Validación declarativa de entradas |
| `googleapis` | `171.4.0` | `171.4.0` | Envío de correos transaccionales (OTP) vía Gmail API OAuth 2.0 |
| `helmet` | *(No instalado)* | `^8.1.0` | Cabeceras HTTP de seguridad (CSP, HSTS, X-Frame-Options, nosniff) — agregado en `a5c6d8c` |
| `jsonwebtoken` | `^9.0.2` | `^9.0.2` | Emisión y verificación de JWT (`RS256` en runtime activo; `HS256` en servicio legacy) |
| `multer` | `^2.0.1` | `^2.0.1` | Recepción de `multipart/form-data` en memoria para imágenes |
| `mysql2` | `^3.11.3` | `^3.11.3` | Driver MySQL para Sequelize |
| `redis` | `6.3.1` | `6.3.1` | Cliente Redis (sesiones opacas, revocación, OTP, límites de imágenes y rate-limit en `db6e039`) |
| `request-ip` | `^3.3.0` | `^3.3.0` | Utilidad de extracción de IP (nota: la aplicación usa `req.ip` con `trust proxy`) |
| `sequelize` | `^6.37.8` | `^6.37.8` | ORM relacional para MySQL |
| `sharp` | `0.35.5` | `0.35.5` | Decodificación, sanitización y recodificación de imágenes a WebP |
| `swagger-ui-express` | `^5.0.1` | `^5.0.1` | Interfaz web de exploración OpenAPI en `/swagger` |

#### Dependencias de Desarrollo (`7` en ambas ramas) y Overrides (`7` en ambas ramas)

| Categoría | Paquete | Versión |
| :--- | :--- | :--- |
| `devDependencies` | `@asciidoctor/core` | `^4.1.1` |
| `devDependencies` | `@emnapi/core` | `^1.11.3` |
| `devDependencies` | `@emnapi/runtime` | `^1.11.3` |
| `devDependencies` | `jest` | `^30.0.0` |
| `devDependencies` | `sequelize-cli` | `^6.6.5` |
| `devDependencies` | `supertest` | `^7.1.0` |
| `devDependencies` | `swagger-autogen` | `^2.23.7` |
| `overrides` | `path-to-regexp` | `0.1.13` |
| `overrides` | `minimatch` | `^10.2.3` |
| `overrides` | `ajv` | `^6.14.0` |
| `overrides` | `lodash` | `^4.17.23` |
| `overrides` | `argparse` | `^2.0.1` |
| `overrides` | `js-yaml` | `^4.1.0` |
| `overrides` | `gaxios` | `7.3.1` |

### 5.2 `frontendnet` (`FrontendNet.csproj` y `FrontendNet.Tests.csproj`)

- **`FrontendNet.csproj`:** `Microsoft.NET.Sdk.Web` (`net9.0`), **0 paquetes NuGet de terceros** (utiliza exclusivamente las bibliotecas integradas de ASP.NET Core 9.0: `CookieAuthentication`, `AutoValidateAntiforgeryTokenAttribute`, `IHttpClientFactory`, `ForwardedHeadersMiddleware`, `System.Text.Json`, `System.IdentityModel.Tokens.Jwt` vía lectura de claims).
- **`FrontendNet.Tests/FrontendNet.Tests.csproj`:** `Microsoft.NET.Test.Sdk` (`17.12.0`), `xunit` (`2.9.2`), `xunit.runner.visualstudio` (`2.8.2`), `Microsoft.AspNetCore.Mvc.Testing` (`9.0.0`).

---

## 6. Inventario de Endpoints de la API (`backendnode`)

### 6.1 Resumen Numérico de Endpoints

| Categoría | `main @ c5b66a5` | `fix/backend-hardening @ db6e039` | Detalle |
| :--- | :---: | :---: | :--- |
| **Archivos de rutas (`routes/*.routes.js`)** | **11** | **11** | Mismos 11 módulos de rutas en `/api/*` |
| **Endpoints de negocio bajo `/api/*` (`routes/*.routes.js`)** | **53** | **53** | **46** endpoints operativos + **7** endpoints deprecados que responden `410 Gone` (`/api/files/*` [6] y `/api/roles` [1]) |
| **Endpoints de infraestructura en `index.js`** | **1** (`/swagger`) | **2** (`/health` y `/swagger` solo fuera de `production`) | En `db6e039` se agrega `GET /health` (`200 { status: "ok" }`) y `/swagger` se deshabilita (`404`) cuando `NODE_ENV === 'production'` |
| **Total de endpoints HTTP registrados** | **54** | **55** (54 en `production` donde `/swagger` no se monta) | — |

### 6.2 Desglose Completo de los 53 Endpoints en `routes/*.routes.js`

| Módulo (`routes/*.js`) | Prefijo en `index.js` | Cant. | Endpoints (`Método RutaCompleta` — Estado / Autorización) |
| :--- | :--- | :---: | :--- |
| `auth.routes.js` | `/api/auth` | **8** | `POST /api/auth` (público, rate-limit), `POST /api/auth/refresh` (público, rate-limit), `POST /api/auth/logout` (`ADMIN, BUYER, SELLER` incl. seller no aprobado, rate-limit), `POST /api/auth/register` (público, rate-limit), `POST /api/auth/register/verify` (público, rate-limit), `POST /api/auth/password/forgot` (público, rate-limit), `POST /api/auth/password/reset` (público, rate-limit), `GET /api/auth/time` (`ADMIN, BUYER, SELLER` incl. seller no aprobado) |
| `users.routes.js` | `/api/users` | **9** | `GET /api/users/me` (`ADMIN, BUYER, SELLER` incl. seller no aprobado), `PUT /api/users/me` (`ADMIN, BUYER, SELLER` incl. seller no aprobado), `PUT /api/users/me/password` (`ADMIN, BUYER, SELLER` incl. seller no aprobado), `GET /api/users` (`ADMIN`), `GET /api/users/:email` (`ADMIN`), `PUT /api/users/sellers/:userId/review` (`ADMIN`), `PUT /api/users/sellers/:userId/suspend` (`ADMIN`), `PUT /api/users/:email` (`ADMIN`), `DELETE /api/users/:email` (`ADMIN`) |
| `categories.routes.js` | `/api/categories` | **5** | `GET /api/categories` (`ADMIN, BUYER, SELLER`), `GET /api/categories/:id` (`ADMIN, BUYER, SELLER`), `POST /api/categories` (`ADMIN`), `PUT /api/categories/:id` (`ADMIN`), `DELETE /api/categories/:id` (`ADMIN`) |
| `products.routes.js` | `/api/products` | **9** | `GET /api/products` (`ADMIN, BUYER, SELLER`), `GET /api/products/:id` (`ADMIN, BUYER, SELLER`), `POST /api/products` (`SELLER` [+ `sellerWriteLimit` en `db6e039`]), `PUT /api/products/:id` (`SELLER` [+ `sellerWriteLimit` en `db6e039`]), `DELETE /api/products/:id` (`SELLER` [+ `sellerWriteLimit` en `db6e039`]), `POST /api/products/:id/categories` (`SELLER`), `DELETE /api/products/:id/categories/:categoryId` (`SELLER`), `PUT /api/products/:id/image` (`SELLER` + `checkImageOwner` + `imageAdmission` + `upload.single('image')` + `validateImage`), `DELETE /api/products/:id/image` (`SELLER`) |
| `addresses.routes.js` | `/api/addresses` | **5** | `GET /api/addresses` (`BUYER`), `POST /api/addresses` (`BUYER`), `PUT /api/addresses/:id` (`BUYER`), `DELETE /api/addresses/:id` (`BUYER`), `PUT /api/addresses/:id/default` (`BUYER`) |
| `cart.routes.js` | `/api/cart` | **4** | `GET /api/cart` (`BUYER`), `POST /api/cart/items` (`BUYER`), `PUT /api/cart/items/:productId` (`BUYER`), `DELETE /api/cart/items/:productId` (`BUYER`) |
| `checkout.routes.js` | `/api/checkout` | **2** | `POST /api/checkout/quote` (`BUYER`), `POST /api/checkout` (`BUYER`) |
| `orders.routes.js` | `/api/orders` | **3** | `GET /api/orders` (`ADMIN, BUYER, SELLER`), `GET /api/orders/:id` (`ADMIN, BUYER, SELLER`), `PUT /api/orders/:id/status` (`ADMIN, BUYER, SELLER`) |
| `audit-logs.routes.js` | `/api/audit-logs` | **1** | `GET /api/audit-logs` (`ADMIN`) |
| `files.routes.js` | `/api/files` | **6** | `GET /api/files`, `GET /api/files/:id/details`, `GET /api/files/:id`, `POST /api/files`, `PUT /api/files/:id`, `DELETE /api/files/:id` — **Deprecados (`410 Gone`)** |
| `roles.routes.js` | `/api/roles` | **1** | `GET /api/roles` (`ADMIN`) — **Deprecado (`410 Gone`)** |

---

## 7. Inventario de Base de Datos, Modelos y Migraciones (`backendnode`)

### 7.1 Tablas del Esquema Relacional Final (`14` tablas de aplicación + `1` tabla de metadatos Sequelize = `15` tablas físicas)

El esquema relacional final (verificado en `tests/support/final-schema.json` y en las migraciones de corte) consta de **14 tablas de dominio** (más `SequelizeMeta` cuando se ejecuta mediante `sequelize-cli`):

| # | Tabla en MySQL | Modelo Sequelize (`models/*.js`) | Nombre de Modelo | Llave Primaria | Descripción |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `users` | `models/user.js` | `User` | `id` (`CHAR(36)` UUID) | Cuentas de usuario (`profile`: `ADMIN`, `BUYER`, `SELLER`; `credentialVersion`, `isActive`) |
| 2 | `admins` | `models/admin.js` | `Admin` | `userId` (`CHAR(36)` PK/FK) | Extensión 1:1 para cuentas con perfil `ADMIN` |
| 3 | `buyers` | `models/buyer.js` | `Buyer` | `userId` (`CHAR(36)` PK/FK) | Extensión 1:1 para cuentas con perfil `BUYER` |
| 4 | `sellers` | `models/seller.js` | `Seller` | `userId` (`CHAR(36)` PK/FK) | Extensión 1:1 para cuentas `SELLER` (`status`: `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`) |
| 5 | `user_addresses` | `models/user-address.js` | `UserAddress` | `id` (`INT` AI) | Direcciones postales de envío del comprador (`userId`, `isDefault`, `activeSlot`) |
| 6 | `categories` | `models/category.js` | `Category` | `id` (`INT` AI) | Categorías del catálogo (`name`, `protected`; en `db6e039` agrega columna generada `normalizedName` `UNIQUE`) |
| 7 | `products` | `models/product.js` | `Product` | `id` (`INT` AI) | Productos publicados por vendedores (`sellerId`, `title`, `description`, `price`, `stock`, `active`, metadatos Cloudinary) |
| 8 | `product_categories` | `models/product-category.js` | `ProductCategory` | `(productId, categoryId)` | Tabla puente N:M entre `products` y `categories` |
| 9 | `carts` | `models/cart.js` | `Cart` | `id` (`INT` AI) | Carrito activo del comprador (`buyerId`, `status`, `activeBuyerId`) |
| 10 | `cart_items` | `models/cart-item.js` | `CartItem` | `id` (`INT` AI) | Líneas de producto dentro de un carrito (`cartId`, `productId`, `quantity`) |
| 11 | `orders` | `models/order.js` | `Order` | `id` (`INT` AI) | Pedidos confirmados por vendedor (`buyerId`, `sellerId`, `status`, `total`, snapshot de dirección `shipping*`) |
| 12 | `order_items` | `models/order-item.js` | `OrderItem` | `id` (`INT` AI) | Líneas de pedido con snapshot de título y precio unitario (`orderId`, `productId`, `productTitle`, `unitPrice`, `quantity`, `lineTotal`) |
| 13 | `order_status_history` | `models/order-status-history.js` | `OrderStatusHistory` | `id` (`INT` AI) | Historial inmutable de transiciones de estado del pedido (`orderId`, `fromStatus`, `toStatus`, `changedByUserId`, `reason`) |
| 14 | `audit_logs` | `models/audit-log.js` | `AuditLog` | `id` (`INT` AI) | Bitácora de auditoría de seguridad (`actorUserId`, `action`, `resourceType`, `resourceId`, `outcome`, `ipAddress`, `requestId`, `metadata`) |

> **Nota sobre `models/`:** El directorio `backendnode/models/` contiene **15 archivos `.js`**: los **14 modelos** listados arriba más `models/index.js` (inicializador de Sequelize y registro de asociaciones). Las tablas legacy `files` (`archivos`) y `roles` fueron eliminadas en la migración de corte `20261110000003-finalize-secure-ecommerce-schema.js`.

### 7.2 Migraciones y Seeders

| Categoría | `main @ c5b66a5` | `fix/backend-hardening @ db6e039` | Archivos |
| :--- | :---: | :---: | :--- |
| **Migraciones en `migrations/*.js`** | **10** | **11** | `20240101000001-create-archivo.js` a `20240101000007-create-bitacora.js` (7 legacy), `20261108000001-normalize-english-schema.js`, `20261110000001-create-secure-ecommerce-tables.js`, `20261110000002-prepare-existing-ecommerce-tables.js`, y en `db6e039`: `20261119000001-add-categories-normalized-name-unique.js` |
| **Migraciones de corte (`migrations/cutover/*.js`)** | **1** | **1** | `20261110000003-finalize-secure-ecommerce-schema.js` |
| **Módulos de soporte de migración (`migrations/support/*.js`)** | **1** | **1** | `secure-ecommerce.js` |
| **Total de archivos de migración ejecutables** | **11** (10 + 1 cutover) | **12** (11 + 1 cutover) | — |
| **Seeders (`seeders/*.js`)** | **4** | **4** | `20240101000001-seed-categories.js`, `20240101000002-seed-products.js`, `20240101000003-seed-product-categories.js`, `20240101000004-seed-users.js` |

---

## 8. Inventario de Módulos de Código (`backendnode` y `frontendnet`)

### 8.1 `backendnode`

| Directorio | `main @ c5b66a5` | `fix/backend-hardening @ db6e039` | Diferencia entre ramas |
| :--- | :---: | :---: | :--- |
| `routes/*.js` | **11** | **11** | Sin cambio en cantidad (modificados `auth.routes.js` y `products.routes.js` en `db6e039`) |
| `controllers/*.js` | **11** | **11** | Sin cambio en cantidad (modificados `auth.controller.js` y `categories.controller.js` en `db6e039`) |
| `services/*.js` | **41** | **43** | En `db6e039` se agregan `services/auth-rate-limit.service.js` y `services/secret-env.service.js` |
| `middlewares/*.js` | **7** | **8** | En `db6e039` se agrega `middlewares/catalog-rate-limit.middleware.js` |
| `models/*.js` | **15** (14 modelos + `index.js`) | **15** (14 modelos + `index.js`) | En `db6e039` `models/category.js` añade el atributo `normalizedName` |
| `validators/*.js` | **4** | **4** | `address.js`, `cart.js`, `orders.js`, `uuid.js` |
| `docs/diagrams/*.puml` | **12** (+ `_skin.puml` en Lote 0) | **12** | 12 diagramas existentes intactos + `_skin.puml` añadido en Lote 0 |
| `docs/asciidoc/assets/*.svg` | **12** | **12** | 12 SVGs compilados |

### 8.2 `frontendnet` (`main @ 24f0f70`)

| Directorio | Cantidad | Detalle |
| :--- | :---: | :--- |
| `Controllers/*.cs` | **12** | `AppController` (clase base abstracta) + **11 controladores MVC concretos** (`Addresses`, `AuditLog`, `Auth`, `Categories`, `Home`, `Orders`, `Products`, `Profile`, `ShoppingCart`, `Shopping`, `Users`) con **75 métodos de acción (`IActionResult` / `Task<IActionResult>`)** en total |
| `Services/*.cs` | **10** (con **13 tipos** declarados) | 8 archivos de servicio cliente REST (`AddressesClientService`, `AuditLogClientService`, `AuthClientService`, `CategoryClientService`, `ProductClientService`, `ProfileClientService`, `UsersClientService`, más `ShoppingCartClientService` / `IShoppingCartService` y `OrdersClientService` / `IOrdersService` definidos dentro de `ProfileClientService.cs`), `CloudflareTurnstileService.cs`, `ISessionTokenManager.cs` y `SessionTokenManager.cs` |
| `Middlewares/*.cs` | **4** | `BearerTokenDelegatingHandler.cs`, `ClientIpForwardingDelegatingHandler.cs`, `RefreshTokenDelegatingHandler.cs`, `SecurityHeadersMiddleware.cs` |
| `Models/*.cs` | **22** | Modelos de vista, DTOs y excepciones tipadas (`ApiError`, `ApiException`, `AuthModels`, `Order`, `Product`, `ProductFormModel`, `ShoppingCart`, etc.) |
| `Validators/*.cs` | **3** | `NotEmptyOrWhitespaceAttribute.cs`, `SecurePasswordAttribute.cs`, `Utf8MaxBytesAttribute.cs` |
| `Helpers/*.cs` | **5** | `DisplayFormatter.cs`, `ImageUploadValidator.cs`, `JwtInfo.cs`, `NumericBooleanConverter.cs`, `UrlHelper.cs` |
| `Extensions/*.cs` | **2** | `ControllerAlertExtensions.cs`, `ServiceCollectionExtensions.cs` |
| `Views/**/*.cshtml` | **49** | Vistas Razor organizadas en 11 carpetas de controlador + `Shared/` + `_ViewImports.cshtml` y `_ViewStart.cshtml` |

---

## 9. Elementos Marcados como `NO_VERIFICABLE`

De conformidad con las reglas de auditoría, los siguientes elementos no pueden comprobarse de forma determinista únicamente con el código fuente local y las suites ejecutadas sin contenedores externos ni acceso a infraestructura remota:

1. **Cobertura de línea/rama en `frontendnet` (`NO_VERIFICABLE`):** El proyecto `FrontendNet.Tests.csproj` carece del paquete `coverlet.collector` / `coverlet.msbuild`. El conteo de pruebas (**65/65 aprobadas**) está verificado, pero el porcentaje numérico de cobertura de líneas en C# es `NO_VERIFICABLE` sin modificar `FrontendNet.Tests.csproj` (prohibido por restricción de solo lectura).
2. **Ejecución en vivo de las 8 suites omitidas (`53 tests skipped`) de MySQL y Redis en `backendnode` (`NO_VERIFICABLE` en esta corrida local):** El daemon de Docker Desktop (`dockerDesktopLinuxEngine`) no se encontraba en ejecución en la máquina local el `2026-11-22`, por lo que las suites que requieren instancias vivas de MySQL 8.0/8.4 y Redis 8.2 TLS (`tests/database/*.mysql.test.js` y `tests/integration/redis-*.live.test.js`) quedaron en estado `skipped` (sus contrapartes unitarias y de integración con dobles sí se ejecutaron y aprobaron al 100 %).
3. **Estado actual del Quality Gate remoto en SonarCloud (`NO_VERIFICABLE`):** Aunque la configuración local (`sonar-project.properties` y `.github/workflows/sonar.yml`) es verificable, el resultado remoto en `sonarcloud.io` depende de la ejecución del pipeline de GitHub Actions con el secreto `SONAR_TOKEN`.
4. **Infraestructura de despliegue productivo, túneles Cloudflare, certificados TLS reales y secretos en `.env` / `.secrets/` (`NO_VERIFICABLE`):** Por política de seguridad no se leen ni exponen archivos `.env` ni `.secrets/`, y no existe acceso a entornos productivos, reglas de WAF/firewall externas ni pruebas de carga o pentesting externas.
