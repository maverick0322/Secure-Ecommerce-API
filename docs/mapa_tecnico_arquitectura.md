# Mapa Técnico de Arquitectura y Datos

## 1. COMPONENTES CLAVE

### 1.1 Inventario de Componentes y Topología Tecnológica

| Componente | Clasificación | Tecnología / Runtime | Responsabilidad Arquitectónica | Estado / Modo |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend Web MVC** | Cliente / Servidor Web Presentación | ASP.NET Core 8.0 (.NET 8), C#, Razor Engine, Bootstrap 5.3.3, jQuery Validate | Renderizado del lado del servidor (SSR), gestión de vistas del usuario, validación unobtrusive en cliente, puente de autenticación Cookie $\leftrightarrow$ JWT y consumo HTTP tipado. Puerto: 8080. | Host Autónomo / Perímetro Web |
| **Bridge Cookie-JWT y DelegatingHandlers** | Middleware de Cliente HTTP (.NET) | `DelegatingHandler` (`EnviaBearer`, `RefrescaToken`) | Intercepta peticiones salientes para inyectar `Bearer <JWT>`; intercepta respuestas entrantes para capturar `Set-Authorization` y refrescar la cookie de sesión. | En memoria (.NET Pipeline) |
| **Cliente de Pruebas / Admin** | Cliente Técnico | VS Code REST Client / Swagger UI | Emisión de peticiones directas de administración, auditoría de endpoints y pruebas funcionales de la API. | Desarrollo / Pruebas |
| **Punto de Entrada / API Backend** | Application Server | Node.js (v20+ LTS), Express (v4.19+) | Servidor RESTful stateless, orquestador del pipeline de middlewares, control de concurrencia en Event Loop y despacho JSON. Puerto: 3000. | Monolito Modular Contenerizado |
| **Pipeline de Hardening y Seguridad** | Middleware Transversal | Helmet, CORS (v2.8+), Custom Headers | Supresión de huellas (`X-Powered-By`), control dinámico de orígenes (puerto 8080) y exposición explícita de `Set-Authorization`. | En memoria (Express) |
| **Motor de Autenticación y Autorización (RBAC)** | Servicio Transversal | `jsonwebtoken` (v9.0+), HMAC SHA-256 (`HS256`) | Verificación de firma stateless, claims W3C/WS-Federation, validación de expiración (20 min), normalización RBAC (`.trim()`) y Rolling Tokens. | Stateless / En memoria |
| **Motor Criptográfico y Derivación** | Servicio Transversal | `bcrypt` (v6.0+), `crypto` (Nativo Node.js) | Hashing adaptativo unidireccional de contraseñas (salt rounds = 10), mitigación de ataques de temporización (`DUMMY_HASH`) y generación de UUIDs v4. | CPU-Bound / Libuv |
| **Módulo de Ingesta y Storage de Archivos** | Servicio / Middleware | `multer` (v2.0+), `fs` (Nativo) | Ingesta segura multipart/form-data, filtrado MIME y extensiones, límite de cuota (2 MB), disociación de nombres aleatorios y almacenamiento dual (Disco vs BLOB). | I/O Local / BD |
| **Capa de Abstracción de Datos (ORM)** | Data Access Layer | Sequelize (v6.37+), Driver `mysql2` (v3.9+) | Mapeo Objeto-Relacional, parametrización anti-SQLi, gestión de pool de conexiones, migraciones y seeders transaccionales. | Conexión TCP agrupada |
| **Base de Datos Principal** | Database (RDBMS) | MySQL 8.0 (Motor InnoDB, `utf8mb4`) | Persistencia relacional ACID, soporte de integridad referencial (FKs en cascada/set null), almacenamiento de binarios (`LONGBLOB`) y catálogos. Puerto: 3306. | Contenedor / Servicio DB |
| **Sistema de Auditoría (Bitácora)** | Servicio de Trazabilidad | `request-ip` (v3.3+), Sequelize Model | Detección de IP pública/proxy, captura inmutable de operaciones de mutación de datos y persistencia en tabla `bitacora`. | Persistencia Síncrona en BD |
| **Sistema de Observabilidad y Errores** | Middleware / Logger | `fs` Stream, Custom ErrorHandler | Captura centralizada de excepciones no atrapadas, diferenciación de salida RFC 9110 vs CWE-200 según `NODE_ENV`, registro en `log/log.txt`. | Filesystem / stdout |
| **Motor de Contratos y OpenAPI** | Documentación de API | `swagger-autogen`, `swagger-ui-express` | Generación e inspección estática/dinámica de la especificación OpenAPI en `/swagger` con tolerancia a fallos en arranque. | En memoria / Archivo JSON |
| **Infraestructura de Contenerización** | Infraestructura | Docker Engine, Docker Compose v2 | Aislamiento en contenedores (`ecommerce_api`, `ecommerce_db`), redes bridge internas, healthchecks y persistencia en volúmenes. | Infraestructura |

---

## 2. REGLAS DE NEGOCIO CRÍTICAS

### 2.1 Eventos y Acciones Disparadas (Extremo a Extremo: Frontend $\leftrightarrow$ Backend)

| Evento Disparador | Condición de Control | Acción Ejecutada | Efecto Secundario / Registro |
| :--- | :--- | :--- | :--- |
| **Submit Formulario Login (Frontend)** | Validación DataAnnotations en cliente (`[Required]`, `[EmailAddress]`). | `AuthController` (.NET) invoca `AuthClientService.ObtenTokenAsync()` enviando `POST /api/auth` al Backend. | Si la API responde 200, extrae el JWT, crea cookie de sesión `.frontendnet` (20 min) con los claims (`Name`, `GivenName`, `Role`, `jwt`) y redirige según rol. |
| **Petición `POST /api/auth` (Backend)** | Credenciales (`email`, `password`) presentes en `req.body`. | Consulta usuario y rol; evalúa hash con `bcrypt.compare`. | Si falla: ejecuta comparación contra hash dummy y retorna `401`. Si tiene éxito: emite JWT con claims W3C y registra `usuario.login` en `bitacora`. |
| **Llamada Saliente HTTP (Frontend)** | Controlador .NET invoca cualquier servicio (`Categorias`, `Productos`, etc.). | `EnviaBearerDelegatingHandler` intercepta la petición, lee el claim `"jwt"` de la cookie del usuario y anexa cabecera `Authorization: Bearer <jwt>`. | Garantiza propagación transparente de credenciales sin que el usuario gestione tokens manualmente. |
| **Petición a Ruta Protegida (Backend)** | Token presente en cabecera `Authorization: Bearer <JWT>`. | Valida firma HS256 y vigencia temporal (`exp`). | Si es inválido/expirado: interrumpe con `401`. Inyecta `req.decodedToken`. |
| **Evaluación de Rol RBAC (Backend)** | Endpoint define lista de roles (ej: `'Usuario, Administrador'`). | Normaliza lista con `.trim()` y verifica pertenencia del claim `Role`. | Si el rol no pertenece: interrumpe con `403 Forbidden`. |
| **Detección de Token Próximo a Expirar (Backend)** | Tiempo restante de vida: `0 < exp - now < 5 min`. | Genera nuevo JWT de 20 min con los mismos claims. | Inyecta el nuevo token en la cabecera HTTP `Set-Authorization`. |
| **Recepción de Respuesta con Renovación (Frontend)** | `RefrescaTokenDelegatingHandler` detecta cabecera `Set-Authorization` en la respuesta de la API. | Extrae el nuevo JWT de la cabecera. | Reconstruye la lista de Claims y actualiza síncronamente la cookie de sesión `.frontendnet` mediante `SignInAsync()`. |
| **Petición `POST /api/archivos`** | Archivo recibido vía `multipart/form-data`. | Valida peso $\le 2\text{ MB}$, extensión `.jpg`/`.jpeg` y MIME `image/jpeg`. | Renombra a UUIDv4 aleatorio. Si `FILES_IN_BD=true`, lee buffer a `LONGBLOB` y borra archivo en disco. Registra `archivos.crear` en `bitacora`. |
| **Petición `PUT /api/archivos/:id`** | Archivo nuevo cargado para reemplazar existente. | Valida archivo, actualiza metadatos/binario y localiza archivo previo. | Si el archivo anterior residía en disco (`indb=false`), purga el archivo antiguo de `uploads/`. Registra `archivos.editar` en `bitacora`. |
| **Petición `DELETE /api/archivos/:id`** | Archivo existe en base de datos. | Elimina registro en tabla `archivo`. | Si `indb=false`, elimina el binario en disco (`fs.unlinkSync`). Claves foráneas en `producto.archivoid` pasan a `NULL`. Registra `archivos.eliminar`. |
| **Petición `DELETE /api/categorias/:id`** | Categoría localizada por PK. | Evalúa bandera booleana `protegida`. | Si `protegida == true`: rechaza con `400 Bad Request`. Si `false`: elimina registro y asociaciones N:M en cascada. Registra `categoria.eliminar`. |
| **Petición `DELETE /api/usuarios/:email`** | Usuario localizado por correo único. | Evalúa bandera booleana `protegido`. | Si `protegido == true`: rechaza con `403 Forbidden`. Si `false`: elimina cuenta. Registra `usuarios.eliminar`. |
| **Petición `PUT /api/usuarios/:email`** | Datos recibidos en `req.body`. | Aplica lista blanca estricta (Whitelist DTO). | Si incluye `password`, deriva nuevo hash `bcrypt(10)`. No permite alterar `protegido` ni inyectar `passwordhash` plano. Registra `usuarios.editar`. |
| **Excepción no atrapada en Backend** | Error lanzado síncrona o asíncronamente vía `next(err)`. | ErrorHandler intercepta, extrae IP y correo de sesión. | Escribe en `log/log.txt`. Si es 4xx, envía mensaje funcional. Si es 5xx en producción, envía mensaje genérico sanitizado y oculta stack trace. |

---

### 2.2 Restricciones de Seguridad Defensiva y Mitigaciones CWE / OWASP

* **Defensa contra Inyección SQL (CWE-89):** Abstracción total mediante Sequelize ORM. Todas las consultas utilizan sentencias preparadas y parámetros enlazados dinámicamente; las búsquedas por coincidencia en productos (`s=termino`) se parametrizan con `Op.like`.
* **Defensa contra Asignación Masiva (Mass Assignment / CWE-915 / OWASP API3:2023):** Los controladores de mutación (`usuarios`, `productos`, `categorias`) descartan el objeto crudo `req.body` y filtran campos permitidos mediante asignación explícita (DTOs), bloqueando la alteración no autorizada de banderas críticas (`protegido`, `indb`, `id`). En el Frontend, los modelos C# usan `[Bind]` y DataAnnotations.
* **Defensa contra Carga Irrestricta y Path Traversal (CWE-434, CWE-22, CWE-400):**
  * Cuota estricta de 2 MB por archivo (validada en cliente por frontend y forzada por Multer en backend).
  * Verificación doble: cabecera `mimetype === 'image/jpeg'` y extensión `.jpg` / `.jpeg`.
  * Generación de nombres de archivo criptográficos desvinculados del nombre original (`crypto.randomUUID() + '.jpg'`), impidiendo secuencias de escape de directorio (`../`).
* **Defensa contra Ataques de Temporización y Enumeración (CWE-208):** En `auth.controller.js`, si un correo no existe en la base de datos, el flujo ejecuta obligatoriamente un cálculo de comparación contra una constante de hash ficticia (`DUMMY_HASH`) para mantener constante el tiempo de procesamiento (~100 ms) e impedir la enumeración de usuarios válidos.
* **Defensa contra Fuga de Información Técnica (CWE-200 / CWE-693):** Desactivación explícita de `x-powered-by` en Express; ocultamiento de volcados de base de datos y rastros de pila (*stack traces*) en respuestas cliente bajo entornos de producción.
* **Seguridad de Sesión Híbrida (Cookie Stateful en Browser $\leftrightarrow$ JWT Stateless en API):** 
  * El navegador del usuario final solo almacena una cookie segura cifrada de ASP.NET Core (`.frontendnet`), mitigando el robo directo de tokens vía scripts maliciosos en DOM (XSS).
  * El backend opera completamente *stateless* recibiendo el JWT en la cabecera `Authorization`.

---

### 2.3 Máquinas de Estado y Ciclos de Vida de los Datos

#### A. Ciclo de Vida del Usuario (`usuario`)
```
[Formulario Registro / Seeder]
       │
       ▼ (Validación DataAnnotations en C# + Validación DTO en Node.js)
[Activo - No Protegido] ◄────────┐
       │                         │ (PUT con Whitelist DTO / Re-hash Bcrypt)
       ├─────────────────────────┘
       ▼ (DELETE con validación protegido == false)
[Eliminado de BD]
       
* Nota: Los usuarios inicializados por seeder poseen flag 'protegido = true' (Estado Inmutable contra DELETE).
```

#### B. Ciclo de Vida del Archivo Multimedia (`archivo`)
```
[Selección en Formulario C# IFormFile]
       │
       ▼ (Validación Cuota <= 2MB + Formato JPEG)
[Stream HTTP Multipart hacia Node.js API]
       │
       ▼ (Multer: nombrado seguro crypto.randomUUID() + .jpg)
[Almacenado Temporal en uploads/]
       │
       ├─────────────────────────────────┬─────────────────────────────────┐
       ▼ (FILES_IN_BD = false)            ▼ (FILES_IN_BD = true)             ▼ (Fallo de BD)
[Persistido en Filesystem uploads/]   [Cargado a Buffer LONGBLOB]     [Rollback y fs.unlinkSync]
       │                                     │
       │                                     ▼ (fs.unlinkSync en disco)
       │                              [Persistido en Columna MySQL]
       │                                     │
       └─────────────────┬───────────────────┘
                         ▼
             [Asociable a Productos (archivoid)]
                         │
                         ├─────────────────────────────────────────┐
                         ▼ (PUT con nuevo binario)                 ▼ (DELETE)
             [Reemplazo de Binario + Limpieza Previa]    [Eliminación BD + Purgado Disco]
```

#### C. Ciclo de Vida de la Sesión y Token Dual (Cookie $\leftrightarrow$ JWT)
```
[Credenciales en Vista Login .cshtml]
       │
       ▼ (POST /api/auth desde AuthClientService)
[JWT Emitido por Backend (Vigencia: 20 min)]
       │
       ▼ (IniciaSesionAsync en C#)
[Cookie .frontendnet creada en Browser] (Sliding Expiration: 20 min)
       │
       ▼ (Petición HTTP subsecuente vía EnviaBearerDelegatingHandler)
[Token verificado en Express (0 < exp - now < 5 min)]
       │
       ▼ (Backend emite Set-Authorization con nuevo JWT)
[RefrescaTokenDelegatingHandler intercepta en C#]
       │
       ▼ (Actualización automática de claims en Cookie)
[Sesión y Token Renovados por 20 minutos más]
```

---

## 3. FLUJOS DE DATOS Y SECUENCIAS TÉCNICAS

### 3.1 Flujo de Autenticación de Extremo a Extremo (Browser $\rightarrow$ ASP.NET Core $\rightarrow$ Node.js API $\rightarrow$ MySQL)

1. **Usuario:** Llena el formulario de login en el navegador (`GET /auth`) e ingresa email y password.
2. **Validación en Cliente:** La librería `jquery.validate.unobtrusive.js` valida que los campos cumplan con las DataAnnotations del modelo C# `Login.cs` (`[Required]`, `[EmailAddress]`).
3. **Controlador Frontend (`AuthController.cs`):** Recibe el `POST /auth`. Si `ModelState.IsValid`, invoca `AuthClientService.ObtenTokenAsync(model.Email, model.Password)`.
4. **Llamada HTTP a la API:** El cliente `HttpClient` despacha una petición síncrona `POST http://localhost:3000/api/auth` con el payload JSON.
5. **Backend Node.js (`auth.controller.js`):**
   - Extrae `email` y `password`.
   - Consulta el usuario en MySQL con Sequelize: `usuario.findOne({ where: { email } })` incluyendo el modelo `rol`.
   - Si no existe: ejecuta `bcrypt.compare(password, DUMMY_HASH)` y responde `401 Unauthorized`.
   - Si existe: evalúa `bcrypt.compare(password, usuario.passwordhash)`. Si es válido, genera el JWT con vigencia de 20 minutos y claims W3C (`Name`, `GivenName`, `Role`).
   - Registra `usuario.login` en la tabla `bitacora`.
   - Responde `200 OK` con JSON: `{ email, nombre, rol, jwt }`.
6. **Establecimiento de Sesión en Frontend:**
   - `AuthClientService` desempaqueta el JWT.
   - Crea un `ClaimsIdentity` con los claims recibidos e incorpora el token bajo el claim `"jwt"`.
   - Invoca `HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, ...)` generando la cookie `.frontendnet`.
   - Redirige al usuario: si `Rol == "Administrador"` hacia `/Productos`, si no hacia `/Home`.

```
[Browser] ────(1. Submit Login)────► [ASP.NET Core AuthController]
                                                │
                                                ▼ (2. ObtenTokenAsync)
                                     [AuthClientService]
                                                │
                                                ▼ (3. HTTP POST síncrono a :3000/api/auth)
                                     [Express Node.js API]
                                                │
                                                ▼ (4. Sequelize findOne + bcrypt.compare)
                                     [MySQL 8.0 Database]
                                                │
                                                ▼ (5. 200 OK + JWT)
                                     [AuthClientService]
                                                │
                                                ▼ (6. SignInAsync: Crea Cookie .frontendnet)
[Browser] ◄───(7. Set-Cookie + 302)── [AuthController]
```

---

### 3.2 Flujo de Petición Protegida y Renovación Continua (*Rolling Token*)

1. **Usuario:** En el navegador hace clic en una sección protegida (ej: `GET /productos/editar/5`).
2. **Frontend .NET (`ProductosController.cs`):** Evalúa el atributo `[Authorize(Roles = "Administrador")]`. Verifica la cookie de sesión del navegador.
3. **Invocación del Servicio Tipado:** El controlador invoca `ProductosClientService.GetAsync(5)`.
4. **Delegating Handler Saliente (`EnviaBearerDelegatingHandler.cs`):**
   - Intercepta la petición HTTP saliente.
   - Extrae el token JWT guardado en los claims de la cookie: `httpContextAccessor.HttpContext.User.FindFirstValue("jwt")`.
   - Inyecta la cabecera: `request.Headers.Add("Authorization", "Bearer " + token)`.
5. **Backend Node.js (`auth.middleware.js`):**
   - Extrae el token Bearer. Valida la firma `HS256` con `JWT_SECRET`.
   - Sanea los roles con `.trim()` y valida que el usuario sea `Administrador`.
   - **Evaluación de Rolling Token:** Detecta que el tiempo restante de vida es menor a 5 minutos ($0 < \Delta t < 5\text{ min}$).
   - Genera un nuevo JWT (20 min) con los mismos claims y agrega la cabecera HTTP: `Set-Authorization: <nuevo_jwt>`.
   - El controlador `productos.controller.js` consulta el registro en MySQL y responde `200 OK`.
6. **Delegating Handler Entrante (`RefrescaTokenDelegatingHandler.cs`):**
   - Intercepta la respuesta HTTP entrante proveniente del Backend.
   - Evalúa: `if (response.Headers.Contains("Set-Authorization"))`.
   - Extrae el nuevo token y llama a `auth.IniciaSesionAsync(claims)` actualizando la cookie `.frontendnet` del usuario.
7. **Renderizado:** `ProductosController` entrega la vista Razor `Editar.cshtml` renderizada con los datos al navegador.

---

### 3.3 Flujo de Ingesta y Persistencia de Archivos Multimedia (`POST /api/archivos`)

1. **Usuario:** En la vista `Views/Archivos/Crear.cshtml`, selecciona una imagen JPEG y envía el formulario `multipart/form-data`.
2. **Frontend .NET (`ArchivosController.cs`):** 
   - El modelo `Upload.cs` recibe el `IFormFile Portada`.
   - Valida en C#: `Portada.Length / 1024 <= 100` (100 KB en frontend / 2 MB máximo en backend) y `Portada.ContentType == "image/jpeg"`.
   - Copia el stream a un `ByteArrayContent` y lo despacha vía `ArchivosClientService.PostAsync()` usando `MultipartFormDataContent`.
3. **Delegating Handler:** Inyecta la cabecera `Authorization: Bearer <jwt>`.
4. **Backend Express (`upload.middleware.js`):**
   - Multer verifica cuota de 2 MB y extensión permitida.
   - Renombra a `crypto.randomUUID() + '.jpg'`.
   - Escribe el archivo en `/uploads`.
5. **Controlador Archivos (`archivos.controller.js`):**
   - Si `process.env.FILES_IN_BD === 'true'`: lee el archivo de `/uploads` con `fs.readFileSync`, elimina el archivo físico con `fs.unlinkSync` y persiste el binario en la columna `LONGBLOB` de MySQL (`indb = true`).
   - Si `FILES_IN_BD === 'false'`: mantiene el archivo en `/uploads` e inserta registro con `indb = false` y `datos = null`.
   - Registra evento en `bitacora`.
   - Responde HTTP `201 Created`.
6. **Frontend:** Redirige al listado `Views/Archivos/Index.cshtml` mostrando la imagen servida desde `http://localhost:3000/api/archivos/{id}`.

---

## 4. FRONTERAS Y JERARQUÍAS DEL SISTEMA

### 4.1 Fronteras de Red y Contención de Componentes

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ CLIENTE FINAL (Navegador Web / Red Externa)                                      │
│  - Renderizado HTML5 / CSS3 (Bootstrap 5.3.3 + Theme Mercado Libre)              │
│  - Scripts JS: jquery-validate, unobtrusive, cambio_tema.js                      │
│  - Almacén de Credenciales: Cookie HttpOnly/Encrypted (.frontendnet)             │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Tráfico HTTP / HTTPS
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDARY 1: CAPA DE PRESENTACIÓN WEB (Host .NET 8 - Puerto 8080)                 │
│  Proyecto: frontendnet (ASP.NET Core MVC)                                        │
│                                                                                  │
│  [Servidor Kestrel / ASP.NET Core Runtime]                                       │
│   ├── Controllers MVC (Home, Auth, Categorias, Productos, Archivos, etc.)        │
│   ├── Razor View Engine (Views/*.cshtml, Layouts, Partials)                      │
│   ├── Cookie Authentication Handler (.frontendnet - Sliding 20 min)              │
│   ├── Typed HttpClients (AuthClientService, ProductosClientService, etc.)        │
│   └── Delegating Handlers Pipeline                                               │
│        ├── EnviaBearerDelegatingHandler (Inyecta Authorization: Bearer JWT)       │
│        └── RefrescaTokenDelegatingHandler (Captura Set-Authorization y actualiza) │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Tráfico HTTP RESTful (Puerto 3000)
                                         │ Contrato JSON / Multipart
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDARY 2: PERÍMETRO DE LA API (Contenedor Docker: ecommerce_api)               │
│  Red Interna: bridge | Puerto Expuesto: 3000                                     │
│                                                                                  │
│  [Servidor Express index.js]                                                     │
│   ├── Middlewares Transversales (Helmet, CORS para 8080, ErrorHandler)           │
│   ├── auth.middleware (HS256, Claims WS-Federation, RBAC .trim(), Rolling)       │
│   ├── bitacora.middleware (Resolución de IP real request-ip y contexto)          │
│   ├── upload.middleware (Multer - Validación de firmas, cuota 2MB y UUIDs)       │
│   ├── Controladores RESTful (Categorias, Productos, Usuarios, Archivos, etc.)    │
│   ├── Whitelist DTOs (Protección contra Mass Assignment CWE-915)                 │
│   └── Volúmenes Docker Montados: /uploads (Archivos JPEG) y /log (log.txt)       │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Conexión TCP Interna (mysql2 / Pool)
                                         │ Puerto 3306 (No expuesto al exterior)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDARY 3: PERÍMETRO DE DATOS PRIVADOS (Contenedor Docker: ecommerce_db)        │
│  Red Interna: bridge | Servicio: mysql:8.0                                       │
│                                                                                  │
│  [Motor de Base de Datos MySQL - InnoDB]                                         │
│   ├── Schema: mercadolibrenode (utf8mb4)                                         │
│   ├── Tablas Relacionales: usuario, rol, categoria, producto, categoriaproducto  │
│   ├── Tabla de Archivos: archivo (Metadatos + Columna datos: LONGBLOB)           │
│   ├── Tabla de Auditoría: bitacora (Inmutable)                                   │
│   └── Volumen Docker Persistente: mysql_data (/var/lib/mysql)                    │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### 4.2 Jerarquía de Bounded Contexts (Arquitectura de Dominio)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDED CONTEXT 1: IDENTIDAD Y ACCESO (IAM & Security)                           │
│  - Frontend: AuthController, Login.cs, AuthUser.cs, EnviaBearer, RefrescaToken   │
│  - Backend: auth.controller, usuario, rol, jwttoken.service, bcrypt (Salt 10)    │
│  - Claims: Name, GivenName, Role (Esquemas W3C/WS-Federation)                    │
│  - Reglas: Contraseñas no reversibles, usuarios protegidos no eliminables,       │
│            RBAC estricto (401 vs 403), renovación continua transparente.         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Inyecta identidad y rol verificado
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDED CONTEXT 2: CATÁLOGO Y COMERCIO (Catalog & Shopping)                      │
│  - Frontend: ProductosController, CategoriasController, Carrito, Comprar         │
│  - Backend: productos.controller, categorias.controller, categoriaproducto      │
│  - Reglas: Búsqueda parametrizada, categorías protegidas no eliminables,         │
│            asociación múltiple muchos a muchos, cascada referencial.             │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Vinculación referencial (archivoid)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDED CONTEXT 3: GESTIÓN DE MEDIOS Y ASSETS (Media Storage)                    │
│  - Frontend: ArchivosController, Upload.cs, Archivo.cs                           │
│  - Backend: archivos.controller, archivo, upload.middleware (Multer)             │
│  - Reglas: Cuota máxima 2MB, tipos JPEG estrictos, nombres UUID aleatorios,      │
│            estrategia de persistencia híbrida (Disco vs BLOB según FILES_IN_BD). │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Emite eventos de mutación
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│ BOUNDED CONTEXT 4: AUDITORÍA Y CUMPLIMIENTO (Audit & Traceability)               │
│  - Frontend: BitacoraController, Views/Bitacora/Index.cshtml                     │
│  - Backend: bitacora.controller, bitacora, bitacora.middleware, log/log.txt     │
│  - Reglas: Captura de IP real de cliente, registro inmutable de acciones,        │
│            ocultación de volcados técnicos en entornos productivos.              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

### 4.3 Matriz de Relaciones e Interacción entre Contextos

| Bounded Context Origen | Bounded Context Destino | Tipo de Acoplamiento | Mecanismo de Comunicación | Garantía Transaccional / Integridad |
| :--- | :--- | :--- | :--- | :--- |
| **Capa Presentación (.NET)** | **IAM & Security (Node)** | Síncrono / HTTP | `POST /api/auth` vía `HttpClient` | Retorna JWT; si es válido, genera cookie `.frontendnet`. |
| **Capa Presentación (.NET)** | **Catálogo / Medios** | Síncrono / HTTP | `EnviaBearerDelegatingHandler` inyecta JWT | La API autoriza la petición validando claims en memoria. |
| **IAM & Security** | **Catálogo de Comercio** | Débil (Contextual) | Inyección en `req.decodedToken` por middleware | El catálogo consume el rol sin consultar nuevamente la BD de usuarios. |
| **Catálogo de Comercio** | **Gestión de Medios** | Referencial Débil | Clave foránea `producto.archivoid -> archivo.id` | Directiva `ON DELETE SET NULL`. Si se borra el archivo, el producto no se destruye. |
| **Catálogo de Comercio** | **Catálogo de Comercio** | Referencial Fuerte | Clave foránea compuesta en `categoriaproducto` | Directiva `ON DELETE CASCADE`. La tabla pivote se limpia si se elimina la categoría o el producto. |
| **Todos los Contextos** | **Auditoría y Trazabilidad**| Transversal / Síncrono | Inyección de método `req.bitacora()` en pipeline Express | Inserción en tabla `bitacora` de MySQL. Aislado para no interrumpir transacciones de negocio. |
| **Pipeline Express** | **Observabilidad de Errores** | Centralizado | Flujo de excepciones vía `next(err)` | Escritura en `log/log.txt` y sanitización del cuerpo HTTP de respuesta al cliente. |
