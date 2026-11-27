# Línea Base Única del Sistema (`BASELINE.md`)

- **Fecha de verificación y ejecución en vivo:** `2026-11-26`
- **Propósito:** Fuente única de verdad (*Single Source of Truth*) sobre el estado técnico verificable de `backendnode` y `frontendnet` en `main` (`eaf6616` tras PR #10/#11 y `90635a6` tras PR #2/#3), para documentación arquitectónica, contrato de API y diagramas UML 2.5.1.
- **Generación determinista:** Las secciones 1 a 6 provienen íntegramente de `node docs/generate-inventory.js --update-baseline` sin edición manual. Todo elemento que no pueda comprobarse localmente sin tocar `.env` o `.secrets/` se marca como **`NO_VERIFICABLE`**. **Sin secretos.**

---

<!-- BEGIN:AUTO-INVENTORY -->
## 1. Identificación de Repositorios y Hashes Git (`main`)

| Atributo | `backendnode` | `frontendnet` |
|---|---|---|
| **Rama activa actual** | `docs/incremento-1` (rebasada sobre `main`) | `main` |
| **Hash completo de `main`** | `eaf6616ee52e799035b2802a16185bd76f37af8e` | `90635a6d5725bd35cf66b9499021f2ea00af753f` |
| **Fecha de `main`** | `2026-11-26 00:57:41 -0600` | `2026-11-26 00:55:30 -0600` |
| **Autor de `main`** | Erickmel Vázquez | Erickmel Vázquez |
| **Mensaje de `main`** | Merge pull request #11 from maverick0322/fix/deploy-guide | Merge pull request #3 from Eugene1805/fix/deploy-compose |
| **Hash completo de `db6e039` (integrado en `main`)** | `db6e039e91e356642ae467e58613d9869cfd8b61` (Merge branch 'main' of https://github.com/maverick0322/Secure-Ecommerce-API into fix/backend-hardening) | N/A |

## 2. Imágenes de Contenedores y Puertos (`compose.yaml`, `compose.dev.yaml`, `Dockerfile`)

| Archivo | Servicio | Imagen / Build (`archivo:línea`) | Puertos Declarados (`archivo:línea`) |
|---|---|---|---|
| `backendnode/compose.dev.yaml` | `db` | *(override en `backendnode/compose.dev.yaml:4`)* | `127.0.0.1:3307:3306` (`backendnode/compose.dev.yaml:6`) |
| `backendnode/compose.dev.yaml` | `redis` | *(override en `backendnode/compose.dev.yaml:11`)* | `127.0.0.1:6380:6379` (`backendnode/compose.dev.yaml:13`) |
| `backendnode/compose.vm2-backend.yaml` | `app` | Build local `Dockerfile` (`backendnode/compose.vm2-backend.yaml:2`) | `${APP_BIND_ADDRESS:-127.0.0.1}:${SERVER_PORT:-3000}:3000` (`backendnode/compose.vm2-backend.yaml:9`) |
| `backendnode/compose.vm2-backend.yaml` | `redis` | `redis:8.2` (`backendnode/compose.vm2-backend.yaml:103`) | Sin puertos publicados al host |
| `backendnode/compose.vm3-db.yaml` | `db` | `mysql:8.4` (`backendnode/compose.vm3-db.yaml:3`) | `${DB_BIND_ADDRESS:-127.0.0.1}:${DB_PORT:-3306}:3306` (`backendnode/compose.vm3-db.yaml:7`) |
| `backendnode/compose.yaml` | `db` | `mysql:8.4` (`backendnode/compose.yaml:3`) | Sin puertos publicados al host |
| `backendnode/compose.yaml` | `app` | Build local `Dockerfile` (`backendnode/compose.yaml:44`) | `${APP_BIND_ADDRESS:-127.0.0.1}:${SERVER_PORT:-3000}:3000` (`backendnode/compose.yaml:51`) |
| `backendnode/compose.yaml` | `redis` | `redis:8.2` (`backendnode/compose.yaml:144`) | Sin puertos publicados al host |
| `backendnode/Dockerfile` | `app` (multi-stage) | `FROM node:24-alpine AS builder` (`backendnode/Dockerfile:2`); `FROM node:24-alpine AS deps` (`backendnode/Dockerfile:21`); `FROM node:24-alpine` (`backendnode/Dockerfile:29`) | `EXPOSE 3000` |

## 3. Dependencias Verificadas (`package.json`, `package-lock.json` y `*.csproj`)

- **`backendnode/package.json` `engines.node`:** `>=24.0.0 <25.0.0`
- **Producción (`dependencies`):** **16** paquetes
- **Desarrollo (`devDependencies`):** **7** paquetes

| Tipo | Paquete | Versión en `backendnode/package.json` | Versión Resuelta en `backendnode/package-lock.json` |
|---|---|---|---|
| `dependencies` | `bcrypt` | `^6.0.0` | `6.0.0` |
| `dependencies` | `cloudinary` | `^2.11.0` | `2.11.0` |
| `dependencies` | `cors` | `^2.8.6` | `2.8.6` |
| `dependencies` | `dotenv` | `^16.4.5` | `16.6.1` |
| `dependencies` | `express` | `^4.21.2` | `4.22.3` |
| `dependencies` | `express-validator` | `^7.2.1` | `7.3.2` |
| `dependencies` | `googleapis` | `171.4.0` | `171.4.0` |
| `dependencies` | `helmet` | `^8.3.0` | `8.3.0` |
| `dependencies` | `jsonwebtoken` | `^9.0.2` | `9.0.3` |
| `dependencies` | `multer` | `^2.0.1` | `2.5.0` |
| `dependencies` | `mysql2` | `^3.11.3` | `3.24.6` |
| `dependencies` | `redis` | `6.3.1` | `6.3.1` |
| `dependencies` | `request-ip` | `^3.3.0` | `3.3.0` |
| `dependencies` | `sequelize` | `^6.37.8` | `6.37.8` |
| `dependencies` | `sharp` | `0.35.5` | `0.35.5` |
| `dependencies` | `swagger-ui-express` | `^5.0.1` | `5.0.1` |
| `devDependencies` | `@asciidoctor/core` | `^4.1.1` | `4.1.1` |
| `devDependencies` | `@emnapi/core` | `^1.11.3` | `1.11.3` |
| `devDependencies` | `@emnapi/runtime` | `^1.11.3` | `1.11.3` |
| `devDependencies` | `jest` | `^30.0.0` | `30.5.2` |
| `devDependencies` | `sequelize-cli` | `^6.6.5` | `6.6.5` |
| `devDependencies` | `supertest` | `^7.1.0` | `7.3.1` |
| `devDependencies` | `swagger-autogen` | `^2.23.7` | `2.23.7` |

### 3.1 Proyectos y Paquetes NuGet de `frontendnet`

- **`frontendnet/frontendnet.csproj`:** `TargetFramework = net9.0`, paquetes NuGet directos: **0**
- **`frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj`:** `TargetFramework = net9.0`, paquetes NuGet: `Microsoft.NET.Test.Sdk 17.12.0`, `xunit 2.9.2`, `xunit.runner.visualstudio 2.8.2`, `Microsoft.AspNetCore.Mvc.Testing 9.0.0`

## 4. Migraciones y Seeders de `backendnode`

- **Migraciones ejecutables (`backendnode/migrations/` + `backendnode/migrations/cutover/`):** **13**
  - `backendnode/migrations/20240101000001-create-archivo.js`
  - `backendnode/migrations/20240101000002-create-rol.js`
  - `backendnode/migrations/20240101000003-create-categoria.js`
  - `backendnode/migrations/20240101000004-create-producto.js`
  - `backendnode/migrations/20240101000005-create-categoriaproducto.js`
  - `backendnode/migrations/20240101000006-create-usuario.js`
  - `backendnode/migrations/20240101000007-create-bitacora.js`
  - `backendnode/migrations/20261108000001-normalize-english-schema.js`
  - `backendnode/migrations/20261110000001-create-secure-ecommerce-tables.js`
  - `backendnode/migrations/20261110000002-prepare-existing-ecommerce-tables.js`
  - `backendnode/migrations/20261119000001-add-categories-normalized-name-unique.js`
  - `backendnode/migrations/20261123000001-require-products-description-not-null.js`
  - `backendnode/migrations/cutover/20261110000003-finalize-secure-ecommerce-schema.js`
- **Módulos auxiliares bajo `backendnode/migrations/support/` (no son migraciones):** **1**
  - `backendnode/migrations/support/secure-ecommerce.js`
- **Seeders (`backendnode/seeders/`):** **4**
  - `backendnode/seeders/20240101000001-seed-categories.js`
  - `backendnode/seeders/20240101000002-seed-products.js`
  - `backendnode/seeders/20240101000003-seed-product-categories.js`
  - `backendnode/seeders/20240101000004-seed-users.js`

## 5. Inventario de Código de `backendnode`

### 5.1 Controllers (`backendnode/controllers/`) — 11 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/controllers/addresses.controller.js` | `list`, `create`, `update`, `remove`, `setDefault` |
| `backendnode/controllers/audit-logs.controller.js` | `getAll` |
| `backendnode/controllers/auth.controller.js` | `login`, `refresh`, `logout`, `time`, `requestRegistrationCode`, `register` |
| `backendnode/controllers/cart.controller.js` | `get`, `add`, `update`, `remove` |
| `backendnode/controllers/categories.controller.js` | `getAll`, `get`, `create`, `update`, `remove` |
| `backendnode/controllers/files.controller.js` | `get`, `getAll`, `getDetails`, `retired` |
| `backendnode/controllers/orders.controller.js` | `quote`, `confirm`, `list`, `get`, `transition` |
| `backendnode/controllers/personal-account.controller.js` | `forgot`, `reset`, `changePassword`, `get`, `update` |
| `backendnode/controllers/products.controller.js` | `getAll`, `get`, `create`, `update`, `remove`, `assignCategory`, `removeCategory`, `checkImageOwner` |
| `backendnode/controllers/roles.controller.js` | `getAll` |
| `backendnode/controllers/users.controller.js` | `getAll`, `get`, `update`, `remove`, `reviewSeller`, `suspendSeller` |

### 5.2 Middlewares (`backendnode/middlewares/`) — 8 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/middlewares/audit-logs.middleware.js` | *(router / factory)* |
| `backendnode/middlewares/auth-rate-limit.middleware.js` | *(router / factory)* |
| `backendnode/middlewares/auth.middleware.js` | *(router / factory)* |
| `backendnode/middlewares/catalog-rate-limit.middleware.js` | `createSellerProductWriteLimiter` |
| `backendnode/middlewares/errorhandler.middleware.js` | *(router / factory)* |
| `backendnode/middlewares/http-logging.middleware.js` | `createHttpLogger`, `normalizedRoute` |
| `backendnode/middlewares/image-limits.middleware.js` | *(router / factory)* |
| `backendnode/middlewares/upload.middleware.js` | `upload`, `validateImage`, `uploadErrorHandler`, `MAX_IMAGE_BYTES`, `detectedType` |

### 5.3 Services (`backendnode/services/`) — 43 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/services/accounts.service.js` | `AccountError`, `respondError`, `normalizeEmail`, `text`, `validPassword`, `newPassword`, `accountType`, `isActive` |
| `backendnode/services/addresses.service.js` | `list`, `create`, `update`, `remove` |
| `backendnode/services/audit.service.js` | `write`, `list`, `sanitize`, `business` |
| `backendnode/services/auth-rate-limit.service.js` | `createRateLimitService`, `DEFAULT_LOCKOUT` |
| `backendnode/services/auth-redis.service.js` | `createAuthRedisConnection`, `loadRedisConfiguration` |
| `backendnode/services/auth-runtime.service.js` | `getTokens`, `getRuntime`, `close` |
| `backendnode/services/auth-session-errors.js` | `RedisConfigurationError`, `SessionStoreUnavailableError`, `AuthSessionError` |
| `backendnode/services/auth-session.service.js` | `createSessionService` |
| `backendnode/services/authentication.service.js` | `login`, `refresh`, `logout` |
| `backendnode/services/canonical-order.js` | `compareCodeUnits` |
| `backendnode/services/cart-openapi.js` | *(router / factory)* |
| `backendnode/services/cart.service.js` | `get`, `put`, `remove`, `cents`, `money` |
| `backendnode/services/catalog.service.js` | `catalogError`, `positiveId`, `productInput`, `categoryInput`, `ownedProduct`, `mutateProduct`, `createProduct`, `updateProduct` |
| `backendnode/services/checkout-quote.service.js` | `sign`, `verify` |
| `backendnode/services/cloudinary.service.js` | `credentials`, `upload`, `inspect`, `destroy`, `deliveryUrl`, `classify` |
| `backendnode/services/credential-version.service.js` | `createCredentialVersionService`, `loadCredentialVersionService` |
| `backendnode/services/database.service.js` | `verifyConnection`, `tables` |
| `backendnode/services/email-template.service.js` | `verification`, `escape` |
| `backendnode/services/email-verification.service.js` | `issue`, `verify` |
| `backendnode/services/gmail.service.js` | `GmailError`, `SCOPE`, `REDIRECT_URI`, `TIMEOUT_MS`, `validMailbox`, `validSecret`, `requireValid`, `loadClientConfiguration` |
| `backendnode/services/image-container.service.js` | `validateContainer` |
| `backendnode/services/image-decoder.service.js` | `decode` |
| `backendnode/services/image-limits.service.js` | `createImageLimits`, `LIMITS` |
| `backendnode/services/image-ownership.service.js` | `current`, `directory`, `prefix`, `managed`, `context`, `matches`, `same` |
| `backendnode/services/image-policy.js` | *(router / factory)* |
| `backendnode/services/image-response.service.js` | `validateUpload` |
| `backendnode/services/image-validation.service.js` | `normalize` |
| `backendnode/services/jwttoken.service.js` | `generateToken`, `verifyToken`, `getJwtSecret`, `getRemainingTokenTime`, `isUuid` |
| `backendnode/services/orders-openapi.js` | *(router / factory)* |
| `backendnode/services/orders.service.js` | `quote`, `confirm`, `list`, `get`, `transition`, `grouped`, `addressSnapshot` |
| `backendnode/services/password-hash.service.js` | `hash`, `verify`, `isEncodedHash`, `createDummyHash` |
| `backendnode/services/password-policy.service.js` | `acceptable`, `validInput`, `validBcryptInput`, `MIN_CHARACTERS`, `MAX_CHARACTERS`, `MAX_BYTES` |
| `backendnode/services/personal-account.service.js` | `beginRegistration`, `finishRegistration`, `forgot`, `reset`, `changePassword`, `profile`, `updateProfile`, `whenRecoveryIdle` |
| `backendnode/services/product-images.service.js` | `replace`, `remove`, `recover`, `startRecovery`, `recoveryMetrics`, `RECOVERY` |
| `backendnode/services/redis-tls-config.service.js` | `loadRedisCa` |
| `backendnode/services/registration-email.service.js` | `sendVerificationCode` |
| `backendnode/services/rs256-access-token.service.js` | `Rs256ConfigurationError`, `AccessTokenError`, `createAccessTokenService`, `loadAccessTokenService`, `LIFETIME_SECONDS` |
| `backendnode/services/secret-env.service.js` | `readEnvSecret` |
| `backendnode/services/secure-config-file.service.js` | `SecureConfigFileError`, `PROJECT_ROOT`, `resolveConfigPath`, `readConfigFile` |
| `backendnode/services/seed-data.service.js` | `insertMissingRecords`, `rejectAutomaticSeedRemoval` |
| `backendnode/services/structured-logger.service.js` | `log`, `createLogger`, `context` |
| `backendnode/services/swagger-contract.service.js` | `completeSpecification` |
| `backendnode/services/user-input.service.js` | `object`, `name`, `phone`, `registration` |

### 5.4 Models (`backendnode/models/`) — 15 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/models/admin.js` | *(router / factory)* |
| `backendnode/models/audit-log.js` | *(router / factory)* |
| `backendnode/models/buyer.js` | *(router / factory)* |
| `backendnode/models/cart-item.js` | *(router / factory)* |
| `backendnode/models/cart.js` | *(router / factory)* |
| `backendnode/models/category.js` | *(router / factory)* |
| `backendnode/models/index.js` | *(router / factory)* |
| `backendnode/models/order-item.js` | *(router / factory)* |
| `backendnode/models/order-status-history.js` | *(router / factory)* |
| `backendnode/models/order.js` | *(router / factory)* |
| `backendnode/models/product-category.js` | *(router / factory)* |
| `backendnode/models/product.js` | *(router / factory)* |
| `backendnode/models/seller.js` | *(router / factory)* |
| `backendnode/models/user-address.js` | *(router / factory)* |
| `backendnode/models/user.js` | `User` |

### 5.5 Routes (`backendnode/routes/`) — 11 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/routes/addresses.routes.js` | *(router / factory)* |
| `backendnode/routes/audit-logs.routes.js` | *(router / factory)* |
| `backendnode/routes/auth.routes.js` | *(router / factory)* |
| `backendnode/routes/cart.routes.js` | *(router / factory)* |
| `backendnode/routes/categories.routes.js` | *(router / factory)* |
| `backendnode/routes/checkout.routes.js` | *(router / factory)* |
| `backendnode/routes/files.routes.js` | *(router / factory)* |
| `backendnode/routes/orders.routes.js` | *(router / factory)* |
| `backendnode/routes/products.routes.js` | *(router / factory)* |
| `backendnode/routes/roles.routes.js` | *(router / factory)* |
| `backendnode/routes/users.routes.js` | *(router / factory)* |

### 5.6 Validators (`backendnode/validators/`) — 4 archivos

| Archivo | Símbolos / Exports Principales |
|---|---|
| `backendnode/validators/address.js` | `addressInput`, `addressId` |
| `backendnode/validators/cart.js` | `cartInput`, `productId` |
| `backendnode/validators/orders.js` | `quoteInput`, `confirmInput`, `transitionInput`, `orderId` |
| `backendnode/validators/uuid.js` | `isUuid`, `isAccessUuid` |

## 6. Inventario de Código de `frontendnet`

### 6.1 Controllers (`frontendnet/Controllers/`) — 12 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Controllers/AddressesController.cs` | `AddressesController` |
| `frontendnet/Controllers/AppController.cs` | `AppController` |
| `frontendnet/Controllers/AuditLogController.cs` | `AuditLogController` |
| `frontendnet/Controllers/AuthController.cs` | `AuthController` |
| `frontendnet/Controllers/CategoriesController.cs` | `CategoriesController` |
| `frontendnet/Controllers/HomeController.cs` | `HomeController` |
| `frontendnet/Controllers/OrdersController.cs` | `OrdersController`, `OrderStatusOption` |
| `frontendnet/Controllers/ProductsController.cs` | `ProductsController` |
| `frontendnet/Controllers/ProfileController.cs` | `ProfileController` |
| `frontendnet/Controllers/ShoppingCartController.cs` | `ShoppingCartController` |
| `frontendnet/Controllers/ShoppingController.cs` | `ShoppingController`, `SortOption` |
| `frontendnet/Controllers/UsersController.cs` | `UsersController` |

### 6.2 Middlewares (`frontendnet/Middlewares/`) — 4 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Middlewares/BearerTokenDelegatingHandler.cs` | `BearerTokenDelegatingHandler` |
| `frontendnet/Middlewares/ClientIpForwardingDelegatingHandler.cs` | `ClientIpForwardingDelegatingHandler` |
| `frontendnet/Middlewares/RefreshTokenDelegatingHandler.cs` | `RefreshTokenDelegatingHandler` |
| `frontendnet/Middlewares/SecurityHeadersMiddleware.cs` | `SecurityHeadersMiddleware` |

### 6.3 Services (`frontendnet/Services/`) — 14 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Services/AddressesClientService.cs` | `AddressesClientService` |
| `frontendnet/Services/AuditLogClientService.cs` | `AuditLogClientService` |
| `frontendnet/Services/AuthClientService.cs` | `AuthClientService` |
| `frontendnet/Services/CategoryClientService.cs` | `CategoryClientService` |
| `frontendnet/Services/CloudflareTurnstileService.cs` | `CloudflareTurnstileService`, `SiteVerifyResponse` |
| `frontendnet/Services/ISessionTokenManager.cs` | `ISessionTokenManager` |
| `frontendnet/Services/Orders/IOrdersService.cs` | `IOrdersService` |
| `frontendnet/Services/Orders/OrdersClientService.cs` | `OrdersClientService` |
| `frontendnet/Services/ProductClientService.cs` | `ProductClientService` |
| `frontendnet/Services/ProfileClientService.cs` | `ProfileClientService` |
| `frontendnet/Services/SessionTokenManager.cs` | `SessionTokenManager`, `SessionState` |
| `frontendnet/Services/ShoppingCart/IShoppingCartService.cs` | `IShoppingCartService` |
| `frontendnet/Services/ShoppingCart/ShoppingCartClientService.cs` | `ShoppingCartClientService` |
| `frontendnet/Services/UsersClientService.cs` | `UsersClientService` |

### 6.4 Models (`frontendnet/Models/`) — 22 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Models/Address.cs` | `Address`, `AddressFormModel`, `AddressSnapshot` |
| `frontendnet/Models/ApiError.cs` | `ApiError`, `ApiFieldError` |
| `frontendnet/Models/ApiException.cs` | `ApiException` |
| `frontendnet/Models/AuditEntry.cs` | `AuditEntry` |
| `frontendnet/Models/AuthModels.cs` | `RegisterRequestModel`, `VerifyRegistrationModel`, `VerifyRegistrationResult`, `ForgotPasswordModel`, `ResetPasswordModel`, `ApiMessageResponse` |
| `frontendnet/Models/AuthUser.cs` | `AuthUser` |
| `frontendnet/Models/Category.cs` | `Category` |
| `frontendnet/Models/Login.cs` | `Login` |
| `frontendnet/Models/Order.cs` | `OrderStatus`, `OrderSummary`, `Order`, `OrderItem`, `OrderHistoryEntry`, `CheckoutQuoteResponse`, `CheckoutQuotedOrder`, `CheckoutQuotedItem`, `CheckoutConfirmResponse`, `CheckoutViewModel` |
| `frontendnet/Models/PagedList.cs` | `PagedList` |
| `frontendnet/Models/Product.cs` | `Product` |
| `frontendnet/Models/ProductCategory.cs` | `ProductCategory` |
| `frontendnet/Models/ProductFormModel.cs` | `ProductFormModel` |
| `frontendnet/Models/ProductImageResponse.cs` | `ProductImageResponse` |
| `frontendnet/Models/ProductRequest.cs` | `ProductRequest` |
| `frontendnet/Models/ProfileModels.cs` | `UserProfile`, `ProfileSessionViewModel`, `ProfileEditModel`, `ChangePasswordModel` |
| `frontendnet/Models/Roles.cs` | `Roles`, `UserStatuses`, `SellerStatuses` |
| `frontendnet/Models/SessionTime.cs` | `SessionTime` |
| `frontendnet/Models/ShoppingCart.cs` | `ShoppingCart`, `CartItem` |
| `frontendnet/Models/User.cs` | `User` |
| `frontendnet/Models/UserEditModel.cs` | `UserEditModel` |
| `frontendnet/Models/UserRequest.cs` | `UserUpdateRequest`, `SellerReviewResponse` |

### 6.5 Helpers (`frontendnet/Helpers/`) — 5 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Helpers/DisplayFormatter.cs` | `DisplayFormatter` |
| `frontendnet/Helpers/ImageUploadValidator.cs` | `ImageUploadValidator` |
| `frontendnet/Helpers/JwtInfo.cs` | `JwtInfo` |
| `frontendnet/Helpers/NumericBooleanConverter.cs` | `NumericBooleanConverter` |
| `frontendnet/Helpers/UrlHelper.cs` | `UrlHelper` |

### 6.6 Validation (`frontendnet/Validation/`) — 1 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Validation/SecurePasswordAttribute.cs` | `SecurePasswordAttribute` |

### 6.7 Extensions (`frontendnet/Extensions/`) — 1 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/Extensions/ApiClientExtensions.cs` | `ApiClientExtensions` |

### 6.8 ViewComponents (`frontendnet/ViewComponents/`) — 1 archivos

| Archivo | Clases / Interfaces / Tipos C# |
|---|---|
| `frontendnet/ViewComponents/ShoppingCartSummaryViewComponent.cs` | `ShoppingCartSummaryViewComponent` |

### 6.9 Views (`frontendnet/Views/`) — 56 vistas Razor (`.cshtml`)

| Carpeta | Cantidad | Archivos `.cshtml` |
|---|---:|---|
| `frontendnet/Views/` | 2 | `_ViewImports.cshtml`, `_ViewStart.cshtml` |
| `frontendnet/Views/Addresses/` | 4 | `Create.cshtml`, `Delete.cshtml`, `Edit.cshtml`, `Index.cshtml` |
| `frontendnet/Views/AuditLog/` | 1 | `Index.cshtml` |
| `frontendnet/Views/Auth/` | 5 | `ForgotPassword.cshtml`, `Index.cshtml`, `Register.cshtml`, `ResetPassword.cshtml`, `VerifyRegistration.cshtml` |
| `frontendnet/Views/Categories/` | 6 | `_DetailsPartial.cshtml`, `Create.cshtml`, `Delete.cshtml`, `Details.cshtml`, `Edit.cshtml`, `Index.cshtml` |
| `frontendnet/Views/Home/` | 2 | `Index.cshtml`, `Status.cshtml` |
| `frontendnet/Views/Orders/` | 3 | `Checkout.cshtml`, `Details.cshtml`, `Index.cshtml` |
| `frontendnet/Views/Products/` | 11 | `_CardPartial.cshtml`, `_CategoryListPartial.cshtml`, `AddCategory.cshtml`, `Categories.cshtml`, `Create.cshtml`, `Delete.cshtml`, `Details.cshtml`, `Edit.cshtml`, `Index.cshtml`, `RemoveCategory.cshtml`, `SellerPending.cshtml` |
| `frontendnet/Views/Profile/` | 3 | `ChangePassword.cshtml`, `Edit.cshtml`, `Index.cshtml` |
| `frontendnet/Views/Shared/` | 9 | `_AlertsPartial.cshtml`, `_Layout.cshtml`, `_LeftMenuPartial.cshtml`, `_PaginationPartial.cshtml`, `_RightMenuPartial.cshtml`, `_ValidationScriptsPartial.cshtml`, `AccessDenied.cshtml`, `Error.cshtml`, `ErrorApi.cshtml` |
| `frontendnet/Views/Shared/Components/ShoppingCartSummary/` | 1 | `Default.cshtml` |
| `frontendnet/Views/Shopping/` | 3 | `_CardPartial.cshtml`, `Details.cshtml`, `Index.cshtml` |
| `frontendnet/Views/ShoppingCart/` | 1 | `Index.cshtml` |
| `frontendnet/Views/Users/` | 5 | `_DetailsPartial.cshtml`, `Delete.cshtml`, `Details.cshtml`, `Edit.cshtml`, `Index.cshtml` |

### 6.10 Pruebas de `frontendnet` (`frontendnet/FrontendNet.Tests/`) — 12 archivos `.cs`

| Archivo | Clases de Prueba / Soporte |
|---|---|
| `frontendnet/FrontendNet.Tests/Integration/AuthAndAccountFlowTests.cs` | `AuthAndAccountFlowTests` |
| `frontendnet/FrontendNet.Tests/Integration/BuyerFlowsTests.cs` | `BuyerFlowsTests` |
| `frontendnet/FrontendNet.Tests/Integration/SecurityAndHeadersTests.cs` | `SecurityAndHeadersTests`, `CaptureHeaderHandler` |
| `frontendnet/FrontendNet.Tests/Integration/SellerAndAdminFlowsTests.cs` | `SellerAndAdminFlowsTests` |
| `frontendnet/FrontendNet.Tests/Support/FakeBackendHandler.cs` | `FakeBackendHandler` |
| `frontendnet/FrontendNet.Tests/Support/FakeBackendState.cs` | `RecordedRequest`, `FakeUserRecord`, `FakeSessionRecord`, `FakePendingOtp`, `FakeQuoteRecord`, `FakeBackendState` |
| `frontendnet/FrontendNet.Tests/Support/FrontendWebApplicationFactory.cs` | `FrontendWebApplicationFactory`, `FakePrimaryHandlerFilter` |
| `frontendnet/FrontendNet.Tests/Unit/ApiClientContractTests.cs` | `ApiClientContractTests`, `StubAuthService` |
| `frontendnet/FrontendNet.Tests/Unit/HelpersAndModelsTests.cs` | `HelpersAndModelsTests` |
| `frontendnet/FrontendNet.Tests/Unit/ImageUploadValidatorTests.cs` | `ImageUploadValidatorTests` |
| `frontendnet/FrontendNet.Tests/Unit/PasswordPolicyTests.cs` | `PasswordPolicyTests` |
| `frontendnet/FrontendNet.Tests/Unit/SessionTokenManagerAndRefreshHandlerTests.cs` | `SessionTokenManagerAndRefreshHandlerTests`, `TestableAppController`, `NoOpAuthenticationService` |
<!-- END:AUTO-INVENTORY -->

---

## 7. Auditoría de Dependencias No Usadas o Usadas Parcialmente en `backendnode`

| Dependencia | Versión (`package.json` / `package-lock.json`) | Clasificación | Evidencia Verificada en Código (`Archivo:línea`) |
|---|---|---|---|
| **`request-ip`** | `^3.3.0` / `3.3.0` (`backendnode/package.json:53`) | **Declarada pero NO usada en producción** | **0 importaciones** en código de producción (`backendnode/index.js`, `backendnode/controllers/`, `backendnode/middlewares/`, `backendnode/models/`, `backendnode/routes/`, `backendnode/services/`, `backendnode/validators/`). La IP del cliente se obtiene con `req.ip` nativo de Express gobernado por `resolveTrustProxy()` (`backendnode/index.js:14-37`, `backendnode/middlewares/audit-logs.middleware.js:7`). Solo se importa en la prueba unitaria `backendnode/tests/unit/audit-logs.middleware.test.js:6`. |
| **`express-validator`** | `^7.2.1` / `7.3.2` (`backendnode/package.json:46`) | **Declarada y usada solo parcialmente (1 llamada)** | Importada una única vez en producción en `backendnode/services/accounts.service.js:4` e invocada únicamente en `backendnode/services/accounts.service.js:37` dentro de `normalizeEmail()`. No se emplea como middleware en `backendnode/routes/*.js`; el resto de la validación de entradas usa validadores dedicados en `backendnode/validators/*.js` y servicios de dominio (`backendnode/services/user-input.service.js`, `backendnode/services/catalog.service.js`, `backendnode/services/password-policy.service.js`, `backendnode/middlewares/upload.middleware.js`, `backendnode/services/image-validation.service.js`). |

---

## 8. Conteo Canónico de Endpoints HTTP (`46 operativos + 7 retirados (410)`)

| Router (`backendnode/routes/*.js`) | Prefijo en `backendnode/index.js` | Operativos | Retirados (`410 Gone`) | Detalle de Endpoints |
|---|---|---:|---:|---|
| `backendnode/routes/auth.routes.js` | `/api/auth` | 8 | 0 | `POST /`, `POST /refresh`, `POST /logout`, `GET /time`, `POST /register`, `POST /register/verify`, `POST /password/forgot`, `POST /password/reset` |
| `backendnode/routes/users.routes.js` | `/api/users` | 8 | 1 | Operativos: `GET /me`, `PUT /me`, `PUT /me/password`, `GET /`, `GET /:email`, `PUT /:email`, `DELETE /:email`, `PUT /sellers/:userId/review`, `PUT /sellers/:userId/suspend`; Retirado: `POST /api/users` (`410`) |
| `backendnode/routes/roles.routes.js` | `/api/roles` | 0 | 1 | Retirado: `GET /api/roles` (`410`) |
| `backendnode/routes/categories.routes.js` | `/api/categories` | 5 | 0 | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` |
| `backendnode/routes/products.routes.js` | `/api/products` | 8 | 0 | `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /id`, `POST /:id/categories`, `DELETE /:id/categories/:categoryId`, `PUT /:id/image`, `DELETE /:id/image` |
| `backendnode/routes/files.routes.js` | `/api/files` | 0 | 5 | Retirados (`410`): recurso histórico `/api/files` (`GET`, `POST`, `PUT`, `DELETE`) |
| `backendnode/routes/addresses.routes.js` | `/api/addresses` | 5 | 0 | `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `PUT /:id/default` |
| `backendnode/routes/cart.routes.js` | `/api/cart` | 5 | 0 | `GET /`, `POST /items`, `PUT /items/:productId`, `DELETE /items/:productId`, `DELETE /` |
| `backendnode/routes/checkout.routes.js` | `/api/checkout` | 2 | 0 | `POST /quote`, `POST /` |
| `backendnode/routes/orders.routes.js` | `/api/orders` | 4 | 0 | `GET /`, `GET /seller`, `GET /:id`, `PUT /:id/status` |
| `backendnode/routes/audit-logs.routes.js` | `/api/audit-logs` | 1 | 0 | `GET /` |
| **Total canónico `/api/*`** | `/api/*` | **46 operativos** | **7 retirados (410)** | Más 2 endpoints de infraestructura fuera de `/api/*`: `GET /health` (`backendnode/index.js:110-124`) y `GET /swagger` fuera de `production` (`backendnode/index.js:126-128`) |

---

## 9. Resultados de Pruebas y Cobertura Re-ejecutados (`2026-11-26`)

| Repositorio | Comando Ejecutado | Suites | Tests | Fallos | Tiempo | Cobertura Global |
|---|---|---:|---:|---:|---:|---|
| **`backendnode`** (`eaf6616` + rama actual) | `$env:RUN_STAGE5_MYSQL='1'; $env:RUN_STAGE2_REDIS='1'; npm test -- --coverage` | 91 (`86 passed`, `5 skipped`) | 1,151 (`1,101 passed`, `50 skipped`) | 0 | `515.907 s` | `95 % Stmts`, `90.87 % Branch`, `96.57 % Funcs`, `98.11 % Lines` |
| **`backendnode`** (histórico MySQL) | `node scripts/database/stage5-historical-tests.js` | 2 (`2 passed`) | 11 (`11 passed`) | 0 | `51.512 s` | `schema.mysql.test.js` (`3/3`, `43.662 s`) + `secure-ecommerce-transition.mysql.test.js` (`8/8`, `7.85 s`) |
| **`frontendnet`** (`90635a6`) | `dotnet test frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj` | 9 clases (`9 passed`) | 69 (`69 passed`, `0 skipped`) | 0 | `3 s` | **`NO_VERIFICABLE`** (sin recolector de cobertura NuGet) |

- **Consolidado `backendnode` (`91/91` suites locales verificadas):** En la corrida principal con `RUN_STAGE5_MYSQL=1` y `RUN_STAGE2_REDIS=1` (`515.907 s`), además de las 86 suites en Jest, `backendnode/tests/database/final-backend.mysql.test.js` orquestó e invocó contra MySQL 8.4 desechable 3 de las 5 suites omitidas (`accounts.mysql.test.js`, `catalog.mysql.test.js`, `account-session-security.mysql.test.js` -> `3 passed`, `39 tests`); las 2 suites históricas restantes (`schema.mysql.test.js` y `secure-ecommerce-transition.mysql.test.js`) pasaron (`11/11`) mediante `backendnode/scripts/database/stage5-historical-tests.js`. Total acumulado: **91/91 suites y 1,151/1,151 pruebas aprobadas (`0` fallos)** en Docker local.
- **Desglose de cobertura `backendnode` (`2026-11-26`):** `backendnode/index.js` (`88.65 % Stmts`, `90.21 % Lines`), `backendnode/config` (`96.42 % Stmts`, `100 % Lines`), `backendnode/controllers` (`95.66 % Stmts`, `97.8 % Lines`), `backendnode/middlewares` (`93.89 % Stmts`, `98.18 % Lines`), `backendnode/models` (`99.05 % Stmts`, `99.01 % Lines`), `backendnode/routes` (`100 %`), `backendnode/services` (`94.75 % Stmts`, `98.28 % Lines`), `backendnode/validators` (`100 %`).
- **Prueba de carga, latencia (`<<RNF-06>>`) y fuerza bruta (`PEN-05` con `grafana/k6:1.3.0` en Docker local):**
  - Comando: `node scripts/load/run-k6-local.js` (stack efímero aislado con `mysql:8.4`, `redis:8.2` TLS y contenedor `Dockerfile` endurecido con `NODE_ENV=production`, `--read-only`, `--cap-drop ALL`, `512m` RAM, `1.0` CPU) ejecutando `backendnode/scripts/load/k6-pen05.js`.
  - Verificaciones previas de superficie HTTP (`httpSurfaceChecks`): `/health` `200`, ausencia de `X-Powered-By`, `/swagger` deshabilitado (`404`), `/api/files/1` retirado (`410`), `/api/roles` sin autenticar (`401`) y `/api/auth/time` con `Cache-Control: no-store`.
  - Métricas observadas (`327` peticiones HTTP, `434/434` checks aprobados, `0` fallos de checks, `0` errores `5xx`):
    - `health_duration`: `avg 1.02 ms`, `p50 0.88 ms`, `p95 1.97 ms`, `max 5.13 ms`.
    - `catalog_read_duration` (`GET /api/products`, 3 VUs, `20 s`): `avg 9.25 ms`, `p50 6.88 ms`, `p95 17.32 ms`, `max 78.36 ms` (umbral `< 500 ms` OK).
    - `catalog_search_duration` (`GET /api/products?s=Laptop`, 3 VUs, `20 s`): `avg 8.32 ms`, `p50 6.28 ms`, `p95 20.84 ms`, `max 39.01 ms` (umbral `< 500 ms` OK).
    - `checkout_flow_duration` (`cart/items` + `checkout/quote` + `checkout`, `5` iteraciones): `avg 56.6 ms`, `p50 54 ms`, `p95 70 ms`, `max 73 ms` (umbral `< 1500 ms` OK).
    - `login_duration` (`POST /api/auth`, `3` sesiones en `setup()`): `avg 191.76 ms`, `p50 187.56 ms`, `p95 202.93 ms`, `max 204.63 ms` (umbral `< 1500 ms` OK).
    - `login_bruteforce_containment` (`12` intentos inválidos sobre una misma cuenta): `5` respuestas `401` seguidas de `7` respuestas `429` todas con cabecera `Retry-After` presente (`bruteforce_429 = 7`, `bruteforce_retry_after = 7`).
- **Pipeline UML fijado:** PlantUML `1.2024.8` (SHA-256 `2e1f42a9879cd25236b5725ca7db25cb9996e8e37a0a1440b2eb559f259c54aa` en `backendnode/docs/generate-diagrams.js:30-32`).

---

## 10. Constantes de Seguridad y de Negocio

| Constante | Valor Verificado | Archivo:Línea | Variable de Entorno / Configuración |
|---|---|---|---|
| **Access Token — TTL (`LIFETIME_SECONDS`)** | `300 s` (`5 min`) | `backendnode/services/rs256-access-token.service.js:8`, `backendnode/services/authentication.service.js:22` | Sin variable de entorno para TTL (`JWT_RS256_PRIVATE_KEY_PATH`, `JWT_RS256_PUBLIC_KEYS_PATH`, `JWT_RS256_ISSUER`, `JWT_RS256_AUDIENCE`, `JWT_RS256_ACTIVE_KID` en `backendnode/services/rs256-access-token.service.js:132-144`) |
| **Access Token — Algoritmo y límites** | `RS256`, RSA `3072 bits`, `typ: "at+jwt"`, `MAX_TOKEN_BYTES = 8192`, `MAX_KEYS = 16`, 7 claims exactos (`sub`, `sid`, `jti`, `iat`, `exp`, `iss`, `aud`) | `backendnode/services/rs256-access-token.service.js:9-12` | `JWT_RS256_ACTIVE_KID`, `JWT_RS256_ISSUER`, `JWT_RS256_AUDIENCE` |
| **Sesión Redis — Inactividad máxima (`IDLE_MS`)** | `1,800,000 ms` (`30 min`, ventana deslizante) | `backendnode/services/auth-session.service.js:5` | Sin variable de entorno |
| **Sesión Redis — Máximo absoluto (`ABSOLUTE_MS`)** | `28,800,000 ms` (`8 h`) | `backendnode/services/auth-session.service.js:6` | Sin variable de entorno |
| **Refresh Token — Formato y TTL** | `32 bytes` aleatorios en `base64url` (`43` chars), almacenado como SHA-256 hex (`64` chars), rotación de un solo uso con revocación por reúso (`REFRESH_REUSED`); TTL acotado a `ABSOLUTE_MS` (`8 h`) sujeto a `IDLE_MS` (`30 min`) | `backendnode/services/auth-session.service.js:5-15`, `backendnode/services/authentication.service.js:54` | Sin variable de entorno |
| **`scrypt` — Parámetros reales (`N`, `r`, `p`, clave, sal, `maxmem`)** | `N = 32768`, `r = 8`, `p = 3`, `KEY_BYTES = 64` (`86` chars `base64url`), `SALT_BYTES = 16` (`22` chars `base64url`), `MAXMEM = 67,108,864` bytes (`64 MiB`), cola máx. `2` activos + `16` en espera | `backendnode/services/password-hash.service.js:7-22` | Sin variable de entorno |
| **`bcrypt` legado — Costo y longitud máxima** | Prefijos `$2a$`, `$2b$`, `$2y$`, costo `04`..`31` (`MAX_BCRYPT_BYTES = 72` bytes UTF-8), migración transparente a `scrypt` al autenticar | `backendnode/services/password-hash.service.js:8-33`, `backendnode/services/authentication.service.js:35-38` | Sin variable de entorno |
| **Hash dummy (`createDummyHash()`)** | Hash sintético `scrypt` (`N = 32768, r = 8, p = 3, keylen = 64, salt = 16`) generado al arranque | `backendnode/services/password-hash.service.js:40-42`, `backendnode/services/authentication.service.js:8` | Sin variable de entorno |
| **Rate limit genérico por IP** | `120 req / 60,000 ms` (`60 s`) | `backendnode/middlewares/auth-rate-limit.middleware.js:53-54` | `RATE_LIMIT_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS` |
| **Rate limit Login (`POST /api/auth`)** | IP: `120 / 60 s`; Cuenta: `10 / 60 s` | `backendnode/middlewares/auth-rate-limit.middleware.js:126-133` | `RATE_LIMIT_LOGIN_IP_MAX`, `RATE_LIMIT_LOGIN_ACCOUNT_MAX`, `RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_MS` |
| **Rate limit Refresh (`POST /api/auth/refresh`)** | IP: `180 / 60 s`; Sesión (`refreshToken`): `15 / 60 s` | `backendnode/middlewares/auth-rate-limit.middleware.js:134-140` | `RATE_LIMIT_REFRESH_IP_MAX`, `RATE_LIMIT_REFRESH_SESSION_MAX`, `RATE_LIMIT_REFRESH_SESSION_WINDOW_MS` |
| **Rate limit Logout (`POST /api/auth/logout`)** | IP: `120 / 60 s` | `backendnode/middlewares/auth-rate-limit.middleware.js:141-145` | `RATE_LIMIT_LOGOUT_IP_MAX`, `RATE_LIMIT_IP_WINDOW_MS` |
| **Rate limit Registro y OTP (`/register`, `/register/verify`)** | IP: `60 / 60 s`; Cuenta: `5 / 15 min` (registro) y `8 / 15 min` (verificación OTP) | `backendnode/middlewares/auth-rate-limit.middleware.js:146-159` | `RATE_LIMIT_REGISTER_IP_MAX`, `RATE_LIMIT_REGISTER_ACCOUNT_MAX`, `RATE_LIMIT_OTP_IP_MAX`, `RATE_LIMIT_OTP_ACCOUNT_MAX` |
| **Rate limit Recuperación (`/password/forgot`, `/password/reset`)** | IP: `60 / 60 s`; Cuenta: `5 / 15 min` (forgot) y `8 / 15 min` (reset) | `backendnode/middlewares/auth-rate-limit.middleware.js:160-173` | `RATE_LIMIT_RECOVERY_IP_MAX`, `RATE_LIMIT_RECOVERY_ACCOUNT_MAX`, `RATE_LIMIT_RECOVERY_ACCOUNT_WINDOW_MS` |
| **Rate limit Cambio de contraseña (`PUT /api/users/me/password`)** | IP: `10 / 60 s` | `backendnode/routes/users.routes.js:8` | `RATE_LIMIT_IP_WINDOW_MS` (`max: 10` fijo) |
| **Bloqueo de cuenta (Lockout)** | Umbral `5` fallos en `900,000 ms` (`15 min`); backoff exponencial desde `60,000 ms` (`60 s`) hasta `900,000 ms` (`15 min`) | `backendnode/services/auth-rate-limit.service.js:5-9`, `backendnode/controllers/auth.controller.js:35-48` | `LOGIN_LOCKOUT_MAX_FAILURES`, `LOGIN_LOCKOUT_WINDOW_MS`, `LOGIN_LOCKOUT_BASE_MS`, `LOGIN_LOCKOUT_MAX_MS` |
| **Límite de escrituras de catálogo** | `30` escrituras (`POST`/`PUT`/`DELETE /api/products`) por `60,000 ms` (`60 s`) por vendedor (`429`) | `backendnode/middlewares/catalog-rate-limit.middleware.js:21-22`, `backendnode/routes/products.routes.js:14-16` | `RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX`, `RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS` |
| **Cuota por vendedor — Productos activos** | `200` productos activos por vendedor (`409 Conflict`, auditoría `producto.quota_exceeded`) | `backendnode/services/catalog.service.js:134-139` | `SELLER_MAX_ACTIVE_PRODUCTS` |
| **Cuota por vendedor — Categorías por producto** | `10` categorías activas por producto (`409 Conflict`, auditoría `productocategoria.quota_exceeded`) | `backendnode/services/catalog.service.js:183-188` | `PRODUCT_MAX_CATEGORIES` |
| **Imágenes — Tamaño, tipos, dimensiones y workers** | `MAX_IMAGE_BYTES = 2,097,152` bytes (`2 MiB`); tipos `image/jpeg`, `image/png`, `image/webp`; `maxDimension = 4096 px`, `maxPixels = 8,000,000`, `maxFrames = 1`, `maxChunks = 4096`, `workers = 2` (`--max-old-space-size=64`), `timeoutMs = 5000 ms` | `backendnode/middlewares/upload.middleware.js:6-21`, `backendnode/services/image-policy.js:1-4`, `backendnode/services/image-validation.service.js:23` | Sin variable de entorno en backend (`ImageUpload:MaxFileSizeBytes` en `frontendnet/appsettings.json:12` y `frontendnet/Helpers/ImageUploadValidator.cs:9`) |
| **Imágenes — Concurrencia, tasa y timeouts** | Vendedor: `6 / 60 s` y `1` concurrente; Global: `60 / 60 s` y `8` concurrentes; `leaseMs = 90,000 ms`, `heartbeatMs = 20,000 ms`, `receiveMs = 30,000 ms` (`408`) | `backendnode/services/image-limits.service.js:5-6`, `backendnode/middlewares/image-limits.middleware.js:11-13` | Sin variable de entorno |
| **Política de contraseñas** | `MIN_CHARACTERS = 8` a `MAX_CHARACTERS = 128` puntos Unicode, máx. `256` UTF-16, `MAX_BYTES = 512` bytes UTF-8, sin `\0`, letra + dígito + puntuación/símbolo Unicode | `backendnode/services/password-policy.service.js:3-18`, `frontendnet/Validation/SecurePasswordAttribute.cs:15-41` | Sin variable de entorno |
| **Vigencia de OTP** | 6 dígitos, `TTL = 600,000 ms` (`10 min`), `COOLDOWN = 60,000 ms` (`60 s`), `MAX_ATTEMPTS = 5`, `MAX_PENDING = 1000` | `backendnode/services/email-verification.service.js:5-8` | Sin variable de entorno |
| **Vigencia de cotización del checkout** | JWT `HS256` derivado de `JWT_SECRET`, vigencia `600 s` (`10 min`), máx. `90,000` chars al firmar (`409`), máx. `100,000` chars al verificar (`400`), `1..100` ítems | `backendnode/services/checkout-quote.service.js:6-18`, `backendnode/services/orders.service.js:26`, `backendnode/services/jwttoken.service.js:6-17` | `JWT_SECRET`, `JWT_SECRET_FILE` |
| **Pedidos (`Order`) — Estados y transiciones** | Estados: `PENDING`, `PREPARING`, `SHIPPED`, `DELIVERED`, `CANCELED`. Transiciones: `PENDING -> PREPARING \| CANCELED`, `PREPARING -> SHIPPED \| CANCELED`, `SHIPPED -> DELIVERED`, `DELIVERED -> []`, `CANCELED -> []`. `BUYER` solo `PENDING -> CANCELED`; `CANCELED` exige motivo (`reason`) y restituye inventario | `backendnode/models/order.js:6`, `backendnode/services/orders.service.js:164-171` | Sin variable de entorno |
| **Vendedores (`Seller`) y Cuentas (`User`) — Estados y transiciones** | `Seller.status`: `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` (`PENDING -> APPROVED \| REJECTED` vía `reviewSeller`; `APPROVED -> SUSPENDED` vía `suspendSeller`). `User.status`: `ACTIVE`, `SUSPENDED`, `DISABLED` | `backendnode/models/seller.js:7`, `backendnode/models/user.js:20`, `backendnode/services/accounts.service.js:123-143`, `backendnode/services/accounts.service.js:156-173`, `backendnode/services/accounts.service.js:189` | Sin variable de entorno |
| **Valores por defecto de `CORS` y `TRUST_PROXY`** | `CORS`: deny-all (`allowedOrigins = []`, rechaza `*`); `TRUST_PROXY`: `false` (rechaza `true` o `*`, solo IPs/CIDRs explícitos) | `backendnode/index.js:14-37`, `backendnode/index.js:54`, `backendnode/index.js:87-107` | `CORS_ORIGIN`, `TRUST_PROXY` |
| **Frontend (`frontendnet`) — Cookies y límites de sesión** | Cookie `.frontendnet` (`HttpOnly`, `SameSite=Lax`, `SecurePolicy=Always` fuera de Development, `SlidingExpiration=true`, inactividad `30 min`, tope absoluto `8 h` vía `AbsoluteExpirationClaimType = "session_abs_exp"`, `ProactiveRefreshWindow = 30 s`, `DefaultAbsoluteSessionDuration = 8 h`); cookies `.frontendnet.af` y `.frontendnet.tempdata` | `frontendnet/Program.cs:20-36`, `frontendnet/Program.cs:78-105`, `frontendnet/Services/SessionTokenManager.cs:16-20` | `Security:RequireHttps` (`frontendnet/appsettings.json`) |
| **Descripción obligatoria y visibilidad de borradores** | `products.description` `NOT NULL` (`validate: { notEmpty: true }`); borradores sin `imagePublicId` visibles solo al `SELLER` propietario (`hasImage: false`) y ocultos a `BUYER`/`ADMIN` | `backendnode/models/product.js:8`, `backendnode/migrations/20261123000001-require-products-description-not-null.js:15-48`, `backendnode/services/catalog.service.js:200-212`, `backendnode/controllers/products.controller.js:6-13` | Sin variable de entorno |
| **MySQL TLS y verificación de CA** | `buildDialectOptions` exige `rejectUnauthorized: true` con `DB_SSL=true` y valida bloques PEM vía `validateCaBundle` (`DB_SSL_CA_PATH`) | `backendnode/config/config.js:10-35` | `DB_SSL`, `DB_SSL_CA_PATH`, `TEST_DB_SSL`, `TEST_DB_SSL_CA_PATH` |
| **Proxy frontend y llaves DataProtection** | `Security:ForwardedForHeaderName` configurable (`X-Forwarded-For` por defecto) y volumen `frontend_dataprotection` en `/home/app/.aspnet/DataProtection-Keys` bajo `read_only: true` | `frontendnet/Program.cs:49-67`, `frontendnet/Dockerfile:22-23`, `frontendnet/compose.vm1-frontend.yaml:30` | `SECURITY_FORWARDED_FOR_HEADER_NAME`, `TRUSTED_PROXY_CIDR_0`, `TRUSTED_PROXY_CIDR_1` |

---

## 11. Elementos `NO_VERIFICABLE`

| Ítem | Clasificación | Motivo Técnico |
|---|---|---|
| **Cobertura de líneas/ramas en `frontendnet`** | **`NO_VERIFICABLE`** | `frontendnet/FrontendNet.Tests/FrontendNet.Tests.csproj` no incluye paquete recolector de cobertura (coverlet). |
| **Estado remoto del Quality Gate en SonarCloud** | **`NO_VERIFICABLE`** | Requiere acceso autenticado al panel remoto del servicio (los workflows de PR #10 y PR #11 reportaron estado aprobatorio en GitHub). |
| **Despliegue distribuido en 3 VMs vs. secretos privados (`.env` / `.secrets/`)** | **`PARCIALMENTE VERIFICADO`** | Los manifiestos y scripts de 3 VMs (`frontendnet/compose.vm1-frontend.yaml`, `backendnode/compose.vm2-backend.yaml`, `backendnode/compose.vm3-db.yaml`, `backendnode/scripts/deploy/generate-lan-certs.sh`, `backendnode/scripts/deploy/verify-vm.sh`, `frontendnet/scripts/deploy/verify-vm.sh`) están implementados y probados en red local del equipo; los valores secretos de `.env`/`.secrets/` quedan excluidos y sin exposición documental. |
| **Pruebas ofensivas restantes (`PEN-01..04`) y escaneos externos (`SCN-01..02` con `Nmap` / OWASP ZAP)** | **`PLANIFICADO` (`NO_VERIFICABLE`)** | Planificadas en el Capítulo 7; aún sin corrida de payloads ofensivos ni escaneo completo externo (`PEN-05` con `k6` ya fue verificado en Docker local). |

---

## Anexo A. Comandos de Evidencia Ejecutados y Extractos de Salida Real

```powershell
# 1. Generación determinista del inventario (secciones 1 a 6 de este archivo)
node backendnode/docs/generate-inventory.js --update-baseline
# Extracto:
#  - backendnode main = f9d459695c9ec52f25a09ba09e09f9dd18d6d732; db6e039 = db6e039e91e356642ae467e58613d9869cfd8b61
#  - frontendnet main = 24f0f70e9f720893293ddb0c861712d9eeb00c8c
#  - compose.yaml: mysql:8.4 (línea 3), redis:8.2 (línea 144); compose.dev.yaml: 127.0.0.1:3307:3306 (línea 6), 127.0.0.1:6380:6379 (línea 13)
#  - package.json / package-lock.json: helmet ^8.3.0 (8.3.0), sequelize-cli ^6.6.5 (6.6.5), redis 6.3.1 (6.3.1), jest ^30.0.0 (30.5.2)
#  - migrations: 12 migraciones (7 heredadas 20240101000001..07 + 4 en raíz 202611* + 1 en cutover/) + 1 auxiliar en support/secure-ecommerce.js

# 2. Verificación de archivos en frontendnet y migraciones en backendnode
Get-ChildItem backendnode/migrations -Recurse -File
Get-ChildItem frontendnet/Controllers, frontendnet/Middlewares, frontendnet/Services, frontendnet/Models, frontendnet/Helpers, frontendnet/Validation -Recurse -File
# Extracto:
#  - frontendnet/Controllers: AddressesController.cs, AppController.cs, AuditLogController.cs, AuthController.cs,
#    CategoriesController.cs, HomeController.cs, OrdersController.cs, ProductsController.cs, ProfileController.cs,
#    ShoppingCartController.cs, ShoppingController.cs, UsersController.cs (12)
#  - frontendnet/Middlewares: BearerTokenDelegatingHandler.cs, ClientIpForwardingDelegatingHandler.cs,
#    RefreshTokenDelegatingHandler.cs, SecurityHeadersMiddleware.cs (4)

# 3. Verificación automática de trazabilidad sobre BASELINE.md y PLAN_DIAGRAMAS.md
node backendnode/docs/verify-traces.js
# Resultado esperado: exit code 0 (0 rutas faltantes, 0 símbolos faltantes).
```
