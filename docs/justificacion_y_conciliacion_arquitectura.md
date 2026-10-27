# Justificación Técnica, Conciliación de Requisitos y Validez del Mapa de Arquitectura

**Documento Relacionado:** [`docs/mapa_tecnico_arquitectura.md`](file:///c:/codigo/ps/backendnode/docs/mapa_tecnico_arquitectura.md)  
**Rol:** Ingeniero de Datos y Arquitecto de Software Senior  
**Propósito:** Proporcionar la justificación técnica formal, auditoría de coherencia y conciliación de divergencias entre el documento base (Práctica Guiada Backend API en Node.js, 70 páginas) y el código fuente implementado en el repositorio.

---

## 1. AUDITORÍA DE ANÁLISIS INTEGRAL (PDF VS. CÓDIGO FUENTE)

El diseño plasmado en el mapa técnico no es una abstracción genérica; deriva de la correlación exhaustiva entre las especificaciones del PDF de la práctica y los módulos de código construidos en el repositorio:

### 1.1 Cobertura de Secciones del PDF Analizadas

| Bloque en PDF | Páginas | Tema Central del PDF | Archivos de Código Inspeccionados y Validados |
| :--- | :--- | :--- | :--- |
| **Bloque 1** | Págs. 1-7 | Objetivos, definición inicial de endpoints, diagrama MVC y teoría de JSON Web Tokens (Claims W3C, firmas, stateless). | `routes/*.js`, `config/claimtypes.js`, `services/jwttoken.service.js`. |
| **Bloque 2** | Págs. 8-15 | Setup del entorno, creación de base de datos (`bd.sql`), dependencias Express, CORS y Dotenv. | `bd.sql`, `.env`, `.env.example`, `package.json`, `index.js`. |
| **Bloque 3** | Págs. 16-31 | Inicialización de Sequelize ORM, creación de 7 modelos relacionales y ejecución de 7 migraciones. | `config/config.js`, `models/*.js`, `migrations/*.js`. |
| **Bloque 4** | Págs. 32-34 | Inicialización de catálogos mediante seeders (categorías, productos, categoriaproducto, usuarios). | `seeders/*.js` (incluyendo reconstrucción del seeder truncado). |
| **Bloque 5** | Págs. 35-36 | Construcción de middlewares transversales (bitácora, carga de archivos con Multer, manejo de errores). | `middlewares/bitacora.middleware.js`, `upload.middleware.js`, `errorhandler.middleware.js`. |
| **Bloque 6** | Págs. 37-51 | Implementación de controladores de negocio y CRUDs completos con validaciones. | `controllers/categorias.controller.js`, `productos.controller.js`, `archivos.controller.js`, `usuarios.controller.js`, `roles.controller.js`, `bitacora.controller.js`. |
| **Bloque 7** | Págs. 52-56 | Servicios criptográficos, login de autenticación, tiempo de sesión y middleware de autorización RBAC con Rolling Tokens. | `services/jwttoken.service.js`, `controllers/auth.controller.js`, `middlewares/auth.middleware.js`. |
| **Bloque 8** | Págs. 57-63 | Enrutamiento Express, integración de Swagger UI y generación OpenAPI mediante `swagger-autogen`. | `routes/*.js`, `swagger.js`, `swagger-output.json`, `index.js`. |
| **Bloque 9** | Págs. 64-69 | Pruebas de integración cliente con extensión REST Client (`.http`). | `restclient/*.http`, `restclient/assets/`. |
| **Bloque 10**| Pág. 70 | Publicación, control de versiones y exclusión defensiva de secretos. | `.gitignore`, `Dockerfile`, `docker-compose.yml`. |

---

## 2. MATRIZ DE CONCILIACIÓN: REQUISITOS DEL PDF VS. IMPLEMENTACIÓN REAL

El mapa técnico refleja decisiones arquitectónicas que intencionalmente se desvían de los errores presentes en el PDF para garantizar estabilidad, seguridad defensiva y apego a estándares de la industria (RFC 9110, OWASP API Security Top 10, CWE Top 25):

| # | Requisito / Código Original en el PDF | Implementación Real en el Código | Justificación Arquitectónica y de Seguridad |
| :--- | :--- | :--- | :--- |
| **C-01** | **Método de Login:** La tabla de la pág. 2 define `GET /api/auth` sin cuerpo de solicitud. | Se implementó `POST /api/auth` con payload JSON en el cuerpo (`req.body`). | **CWE-598:** Enviar credenciales en peticiones `GET` expone las contraseñas en URLs, historiales de navegador, registros de proxy y servidores web. El método `POST` es obligatorio para transferencias seguras. |
| **C-02** | **Ruta de Consulta de Tiempo:** La tabla de la pág. 2 define `GET /api/tiempo`. | Se implementó `GET /api/auth/tiempo`. | Agrupación canónica bajo el *Bounded Context* de Autenticación (`auth.routes.js`), manteniendo alta cohesión de endpoints. |
| **C-03** | **Identificador de Usuario:** La tabla de la pág. 2 define `GET/PUT/DELETE /api/usuarios/{id}`. | Se implementó `/api/usuarios/:email`. | El correo electrónico actúa como identificador único y clave de autenticación del usuario en el sistema. Los controladores del PDF (págs. 47-50) se basaron en `email`. |
| **C-04** | **Bug de RBAC por espacios:** `rol.split(',').indexOf(...)` en pág. 56 evaluando `Authorize('Usuario, Administrador')`. | Se normaliza con `.map(r => r.trim())` y método `.includes()`. | `'Usuario, Administrador'.split(',')` producía `['Usuario', ' Administrador']`. Sin este ajuste, cualquier usuario con rol `Administrador` quedaba bloqueado del sistema con `401`. |
| **C-05** | **Semántica de Códigos HTTP en RBAC:** El PDF devolvía `401 Unauthorized` ante fallos de autorización por rol. | `401 Unauthorized` si el token falta o expira; `403 Forbidden` si el rol carece de privilegios. | Cumplimiento del estándar **RFC 9110 / RFC 7235**: `401` denota falta de autenticación; `403` denota autenticación válida pero permisos insuficientes. |
| **C-06** | **Crash `ERR_HTTP_HEADERS_SENT`:** En `auth.controller.js` (pág. 55), `self.tiempo` ejecuta `res.status(404).send()` sin `return`. | Inclusión de `return res.status(404)...`. | En Node.js, enviar cabeceras a un stream cerrado dispara una excepción que derriba el hilo o genera denegación de servicio (**CWE-703**). |
| **C-07** | **Null Pointer DoS en Usuarios:** En `usuarios.controller.js` (págs. 49-50), se evalúa `data.protegido` sin verificar si `data` es `null`. | Validación defensiva previa: `if (!data) return res.status(404)...`. | Evita que consultas o borrados con emails inexistentes colapsen en un error 500 no controlado (**CWE-703**). |
| **C-08** | **Seeder Truncado de Productos:** El recuadro de código en pág. 32 (Paso 7) está completamente en blanco. | Reconstrucción completa del seeder con 15 productos coherentes con las 15 categorías. | Resuelve la violación de integridad referencial al ejecutar el seeder de la tabla asociativa `categoriaproducto`. |
| **C-09** | **Asociación Errónea en ORM:** En `models/archivo.js` (pág. 27), define `foreignKey: 'id'`. | Se configuró `foreignKey: 'archivoid'`. | En el esquema relacional, la columna de unión en `producto` es `archivoid`, no su clave primaria `id`. |
| **C-10** | **Fallo de CORS en Rolling Tokens:** En `index.js` (pág. 61), CORS no declaraba cabeceras expuestas. | Se añadió `exposedHeaders: ['Set-Authorization']`. | Por política oficial W3C CORS, los navegadores bloquean la lectura de cabeceras personalizadas salvo que el servidor las exponga explícitamente; sin esto, la renovación de tokens es inservible en frontend. |
| **C-11** | **Vulnerabilidad de Asignación Masiva:** En los métodos `update` (págs. 41 y 49), se pasaba `req.body` íntegro a Sequelize. | Implementación de listas blancas DTO (Whitelist) estrictas. | Mitigación directa de **CWE-915** y **OWASP API3:2023**, impidiendo que un atacante altere los flags `protegido`, `passwordhash` o `indb`. |
| **C-12** | **Carga Insegura de Archivos (Uploads):** Validación en pág. 36 limitada a terminación de texto `.jpg` y concatenación de nombre original. | Validación de tipo MIME real, límite de 2 MB y sustitución por nombre criptográfico UUIDv4. | Mitigación de **CWE-434** (Unrestricted Upload), **CWE-22** (Path Traversal) y **CWE-400** (DoS por agotamiento de almacenamiento). |
| **C-13** | **Bloqueo en Arranque por Swagger:** `index.js` (pág. 61) requiere `swagger-output.json` de forma síncrona. | Carga condicional tolerante: si el JSON no existe, retorna `503 Service Unavailable` indicando el comando de compilación. | Resiliencia operativa: impide que la aplicación muera al clonar el repositorio antes de generar el contrato OpenAPI. |
| **C-14** | **Discrepancia de Base de Datos:** Pág. 9 indica crear `mercadolibrenode`, pero pág. 31 muestra captura de `netflixnode`. | Todo el proyecto está unificado de forma limpia bajo `mercadolibrenode`. | Eliminación de inconsistencias del documento original reciclado. |

---

## 3. PARTES MENCIONADAS EN EL PDF NO IMPLEMENTADAS EN EL CÓDIGO (ANÁLISIS DE BRECHA)

El PDF menciona componentes contextuales, instrucciones manuales y directivas que no forman parte del runtime de Node.js o que corresponden a capas externas. El mapa técnico las contempló bajo las siguientes consideraciones:

### 3.1 Integración y Conciliación con el Frontend ASP.NET Core 8.0 MVC
* **Mención en el PDF del Backend y el PDF del Frontend:**
  * El PDF del backend hacía referencia a clientes en `http://localhost:8080` y a esquemas de identidad WS-Federation (`http://schemas.xmlsoap.org/...`).
  * El PDF complementario del Frontend formaliza la aplicación cliente: **ASP.NET Core 8.0 (.NET 8) MVC**, ejecutándose en el puerto 8080 bajo Kestrel (`launchSettings.json`).
* **Arquitectura de Interoperabilidad (Puente Cookie-JWT):**
  * **Capa Browser $\leftrightarrow$ Frontend:** Opera mediante autenticación basada en cookies seguras (`CookieAuthenticationDefaults`, cookie `.frontendnet`, con *Sliding Expiration* de 20 minutos), protegiendo la sesión contra robo directo por XSS en DOM.
  * **Capa Frontend $\leftrightarrow$ Backend API:** El frontend desempaqueta el JWT retornado por `POST /api/auth` y lo almacena dentro de un claim `"jwt"` en la cookie de sesión.
  * **Delegating Handlers de HttpClient:**
    1. `EnviaBearerDelegatingHandler`: Intercepta peticiones salientes a `http://localhost:3000`, extrae el token del claim `"jwt"` y anexa la cabecera `Authorization: Bearer <jwt>`.
    2. `RefrescaTokenDelegatingHandler`: Intercepta respuestas de la API, detecta la cabecera `Set-Authorization` (Rolling Token) y actualiza de inmediato la cookie de sesión del usuario mediante `auth.IniciaSesionAsync(claims)`.
* **Modelos y Vistas en Razor:**
  * Modelos DataAnnotations (`Login.cs`, `Producto.cs`, `Upload.cs`, `Usuario.cs`, `Categoria.cs`, etc.) con validación unobtrusive en navegador (`jquery.validate.unobtrusive.js`).
  * Vistas Razor (`.cshtml`) estructuradas con Bootstrap 5.3.3 y el tema corporativo de Mercado Libre (`#ffe600`), incorporando soporte de tema oscuro (`cambio_tema.js`).
* **Integración en el Mapa Técnico:** Modelado como la **Capa de Presentación Web (Boundary 1)** que se comunica de forma síncrona vía HTTP REST con el contenedor de la API en el puerto 3000.

### 3.2 Revocación de Privilegios de Base de Datos en Producción
* **Mención en el PDF (Pág. 9, Paso 16):**
  * *"No utilice este comando en este momento, pues queremos que el usuario si pueda crear, modificar y eliminar las tablas... Después de la creación de las tablas, puede revocar los privilegios y utilizar este comando (`GRANT SELECT, INSERT, UPDATE, DELETE`) para un entorno más seguro"*.
* **Estado en el Código:** El entorno de desarrollo y pruebas locales conserva privilegios completos (`GRANT ALL`) para permitir la ejecución continua de migraciones automáticas (`npx sequelize db:migrate`) y desmontajes (`db:migrate:undo:all`).
* **Integración en el Mapa Técnico:** Se categorizó como un control de seguridad perimetral de la **Frontera de Datos Privados (Boundary 2)** para despliegues productivos.

### 3.3 Entregables Académicos y Evidencias Documentales
* **Mención en el PDF (Pág. 1, Paso 3):**
  * Reporte de práctica en archivo Word con portada: `NombreAlumno_BackendNode.docx`.
  * Captura de pantalla de Visual Studio Code con REST Client realizando un `GET` con **3 nuevos usuarios agregados por el alumno**.
  * Capturas de pantalla de operaciones `POST`, `PUT` y `DELETE` de usuarios.
  * Captura de la documentación Swagger en el navegador web (`/swagger`).
  * Captura de la consola de MySQL listando las tablas y datos creados por el ORM.
  * URL del repositorio público en GitHub.
* **Estado en el Código:** Las consultas requeridas fueron preconfiguradas en el archivo [`restclient/usuarios.http`](file:///c:/codigo/ps/backendnode/restclient/usuarios.http) y en las suites de prueba de integración de Jest. Las capturas y el documento Word corresponden a los artefactos finales que el estudiante compila para Eminus.

### 3.4 Lista de Revocación de Tokens JWT (Blacklisting / Token Invalidation)
* **Mención en el PDF (Pág. 54, Paso 8):**
  * *"Solo con esa cadena token, usted puede tener acceso al sistema por 20 minutos. Es por ello que JWT no se considera un método de acceso tan estricto, pues si este token es robado, cualquiera podría acceder a los recursos."*
* **Estado en el Código:** La API opera bajo una arquitectura 100% *stateless*. Si un usuario es eliminado de la base de datos o su rol es revocado, su token JWT emitido previamente continúa siendo matemáticamente válido hasta que transcurran sus 20 minutos de vigencia.
* **Integración en el Mapa Técnico:** Quedó asentado en el análisis de **Máquinas de Estado y Ciclo de Vida del Token**, señalando la necesidad arquitectónica de incorporar una capa de persistencia en memoria/caché (ej. Redis) o validación de versión de token (`token_version`) en caso de requerir revocación instantánea.

### 3.5 Endurecimiento de Seguridad Adicional Sugerido en el PDF
* **Mención en el PDF (Pág. 36, Paso 9):**
  * *"Más adelante se agregarán más middlewares referentes a la autenticación y autorización de usuarios."*
* **Estado en el Código:** El PDF omitió detallar controles contra ataques de fuerza bruta.
* **Integración en el Mapa Técnico:** Se documentó la arquitectura defensiva requerida:
  1. Integración de **Rate Limiting** en el endpoint crítico de login (`POST /api/auth`) para frustrar ataques de diccionario (**CWE-307**).
  2. Implementación de **Anti-Timing Attack** mediante evaluación contra hash dummy (`DUMMY_HASH`) en `auth.controller.js` (**CWE-208**).
  3. Sanitización de cabeceras mediante `app.disable('x-powered-by')` (**CWE-200**).

---

## 4. CONCLUSIÓN DE VALIDEZ

El archivo [`docs/mapa_tecnico_arquitectura.md`](file:///c:/codigo/ps/backendnode/docs/mapa_tecnico_arquitectura.md) posee **validez técnica absoluta** debido a que:
1. **No repite acríticamente los defectos del tutorial:** Incorpora las correcciones de los 14 defectos críticos identificados, evitando que el diseño represente un sistema vulnerable o inestable.
2. **Es exhaustivo con el código implementado:** Cada tabla, relación ORM, middleware y flujo de secuencia mapeado corresponde con los archivos existentes en el proyecto.
3. **Mantiene trazabilidad total:** Todos los requerimientos omitidos o pendientes en el código pero descritos en la práctica guiada han sido delimitados en sus respectivas fronteras operativas y de integración.
