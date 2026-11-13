# E-Commerce Backend API en Node.js 🛡️

Redis 8.2 y `compose.yaml`: [preparación manual, TLS y secretos](docs/security/redis-compose.md). [Etapa 3 de autenticación](docs/security/auth-stage3.md): integración RS256/refresh implementada y probada en aislamiento; activación habitual pendiente de revisar configuración y coordinar la API.

> Etapa 5: el backend ya utiliza `secure_ecommerce` con `ecommerce_app`. Direcciones, carrito, cotizaciones, checkout, pedidos y auditoría disponen de pruebas HTTP/MySQL aisladas. La lectura administrativa de auditoría requiere el SELECT limitado documentado en el [reporte de implementación](docs/implementation/implementation-report.md); todavía no se ha concedido en la base habitual. Las instrucciones antiguas de instalación, migraciones y seeders conservadas más abajo son históricas: no deben ejecutarse sobre el destino definitivo.

Direcciones del comprador: `GET/POST /api/addresses`, `PUT/DELETE /api/addresses/:id` y `PUT /api/addresses/:id/default`. Requieren JWT de BUYER activo y verificado; la propiedad se deriva del usuario autenticado. Los identificadores BIGINT se envían como texto decimal. El cuerpo admite únicamente los campos de dirección documentados en Swagger, sin `buyerId`.

Carrito: `GET /api/cart`, `POST /api/cart/items`, `PUT/DELETE /api/cart/items/:productId`. Cotización: `POST /api/checkout/quote` con `addressId` como texto; confirme el precio y dirección mostrados al comprador y envíe únicamente `quote` a `POST /api/checkout`. Un 409 por cambios exige nueva cotización y reconfirmación. La cotización dura diez minutos; un reintento de una compra ya confirmada devuelve el mismo resultado sin descontar nuevamente stock. Pedidos: `GET /api/orders`, `GET /api/orders/:id`, `PUT /api/orders/:id/status`. La cancelación requiere motivo y no repone automáticamente inventario.

Pruebas reales del esquema final: `RUN_STAGE5_MYSQL=1 npm run test:coverage` en Linux, con Docker disponible. En PowerShell configure `$env:RUN_STAGE5_MYSQL='1'`. El ensayo crea su propio servidor tmpfs en `127.0.0.1:13308`, ejecuta además las regresiones de cuentas/catálogo y retira exclusivamente ese contenedor al terminar. `node scripts/database/stage5-historical-tests.js` ejecuta las pruebas históricas de migraciones e integridad en otro servidor tmpfs, puerto 13307. Ninguno utiliza el puerto habitual 3307.

PlantUML queda excluido de esta etapa. La validación del backend en Node 20/Linux puede reproducirse con `node scripts/database/verify-node20.js`; su contexto excluye secretos y almacenamiento histórico y no ejecuta generación de diagramas.

ADMIN inicial: prepare la cuenta MySQL independiente `ecommerce_admin_bootstrap` según el reporte y cargue su secreto en `.env.admin-bootstrap.local`, ignorado por Git. `node scripts/database/bootstrap-admin.js` solicita correo, nombre, contraseña oculta y código de correo; exige proveedor de correo configurado, verifica servidor/UUID y crea usuario, perfil y auditoría en una transacción. No hay registro ADMIN público. Todavía no se ha creado una cuenta real.

**Materia:** Programación Segura  
**Institución:** Facultad de Estadística e Informática — Universidad Veracruzana  
**Tecnologías:** Node.js (v20+), Express.js, Sequelize ORM, MySQL 8.0, Docker, Docker Compose, JWT, Bcrypt, Multer, Swagger (OpenAPI).

---

## 📋 Descripción del Proyecto

API RESTful segura para una plataforma de E-Commerce desarrollada siguiendo el patrón arquitectónico **MVC (Modelo-Vista-Controlador)**. El sistema integra mecanismos de autenticación sin estado (stateless) mediante JWT, control de acceso basado en roles (RBAC), renovación continua de sesión (Rolling Tokens), trazabilidad y auditoría inmutable de operaciones (Bitácora), y persistencia relacional con el ORM **Sequelize**.

### 🔐 Enfoque en Programación Segura y Uso del ORM

Uno de los pilares arquitectónicos centrales del proyecto es la **eliminación de consultas SQL manuales** mediante la adopción integral de **Sequelize ORM**:
* **Prevención de Inyección SQL (CWE-89):** Al utilizar el ORM, todas las consultas a la base de datos MySQL son parametrizadas de forma transparente y nativa, neutralizando el vector de ataque más crítico en aplicaciones web (OWASP Top 10 A03: Injection).
* **Control de Esquema mediante Migraciones:** Se elimina la ejecución de scripts DDL descontrolados en producción; cada cambio estructural está versionado cronológicamente en la carpeta `migrations/`.
* **Aislamiento de Atributos:** Permite abstraer y proteger campos sensibles en reposo (como `passwordHash` y el flag `protected`).
* **Principio de Menor Privilegio en Contenedores:** Imagen Docker basada en `node:20-alpine` ejecutada con usuario sin privilegios `USER node` (no-root).

Para más detalles sobre los requerimientos arquitectónicos y las justificaciones defensivas, consulte los documentos en `docs/`:
- 📄 [docs/reporte_auditoria_backend_node.md](docs/reporte_auditoria_backend_node.md)
- 📄 [docs/asr_y_justificacion_cambios.md](docs/asr_y_justificacion_cambios.md)

---

## 📂 Estructura del Proyecto

```
backendnode/
├── config/             # Configuración dinámica del ORM (config.js) y claims JWT
├── controllers/        # Controladores MVC con lógica de negocio y sanitización
├── docs/               # Documentación formal de arquitectura, auditoría y ASRs
├── log/                # Registro persistente de eventos y errores (log.txt)
├── middlewares/        # Middlewares de seguridad (JWT, RBAC, bitácora, upload, errores)
├── migrations/         # Migraciones estructuradas de base de datos
├── models/             # Modelos Sequelize y definiciones relacionales
├── examples/           # Ejemplos HTTP sin tokens ni credenciales reales
├── routes/             # Enrutamiento de endpoints con guardas de autorización
├── seeders/            # Datos iniciales de catálogos y usuarios de prueba
├── services/           # Lógica reutilizable de generación y validación de tokens
├── uploads/            # Directorio físico para archivos multimedia
├── .dockerignore       # Exclusiones de contexto para construcción Docker
├── .env.example        # Plantilla pública de variables de entorno
├── .gitignore          # Reglas estrictas de exclusión para Git
├── .sequelizerc        # Enrutador de rutas para la CLI de Sequelize
├── bd.sql              # Creación inicial del esquema anterior en MySQL
├── Dockerfile          # Imagen contenerizada de la API en Node.js (Alpine, no-root)
├── compose.yaml        # API + MySQL 8.0 + infraestructura Redis 8.2
├── package.json        # Manifiesto de dependencias y scripts NPM
└── swagger.js          # Generador de documentación Swagger / OpenAPI
```

---


## Normalización de nombres del backend

En `feature/secure-ecommerce-db` consulte el [reporte de implementación de `secure_ecommerce`](docs/implementation/implementation-report.md) antes de usar comandos históricos de instalación. La API utiliza exclusivamente el esquema definitivo `secure_ecommerce` con `ecommerce_app`; no ejecute migraciones ni seeders históricos en ese destino.

El código de cuentas y catálogo requiere las 14 tablas definitivas. El catálogo usa Cloudinary y las variables `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y `CLOUDINARY_API_SECRET`. El directorio persistente `log/cloudinary` conserva las limpiezas de imágenes pendientes. Las nuevas cargas se realizan en `PUT /api/products/:id/image` con una sola imagen JPEG, PNG o WebP de hasta 2 MB.

El backend usa rutas y campos en inglés y mantiene los mensajes en español. El cambio de contrato requiere adaptar el frontend por separado: no se ofrecen alias de las rutas antiguas. Consulte el [mapa de renombres, despliegue y resultados](docs/backend-english-names.md) y los [ejemplos HTTP](examples/api.http).

Para normalizar el esquema anterior en una instalación independiente, detenga la API, respalde sus datos y use `npm run migrate -- --to 20261108000001-normalize-english-schema.js`. Las siete migraciones históricas se conservan intactas y la normalización renombra tablas y columnas sin reiniciar la base. Conserve las entradas de `SequelizeMeta`. Los seeders anteriores completan registros faltantes y preservan las contraseñas existentes.

Cambie `FILES_IN_BD` por `FILES_IN_DB` en su archivo de entorno antes de arrancar. La variable admite `true` y `false`. Los nombres de bases y cuentas MySQL existentes permanecen compatibles. `bd.sql` crea `mercadolibrenode` si falta. Un administrador provisiona las cuentas de MySQL por separado.

Para revertir únicamente el último cambio, detenga la API y ejecute `npm run migrate:undo:last` mientras la migración de normalización sea la última aplicada. Después use el código de la versión anterior. El comando histórico `migrate:undo` revierte todas las migraciones y no debe usarse para esta actualización. La reversión automática de seeders se bloquea para preservar datos existentes.

Para ejecutar las pruebas reales sobre un servidor MySQL 8 de pruebas, proporcione una conexión sin nombre de base. La cuenta necesita permisos para crear y eliminar bases temporales de prueba:

```powershell
$env:TEST_MYSQL_URL='mysql://usuario:contraseña@127.0.0.1:3306'
npm run test:database
Remove-Item Env:TEST_MYSQL_URL
```

En Windows puede usar `npm.cmd` si PowerShell bloquea `npm.ps1`. Las pruebas generales se ejecutan con `npm test`; sin `TEST_MYSQL_URL` se omiten explícitamente las pruebas de MySQL real.

## 🛠️ Prerrequisitos

* **Opción con Docker (Recomendada):** Docker Desktop (o Docker Engine con plugin Docker Compose v2+).
* **Opción sin Docker:** 
  1. Node.js (v20.x o superior) y npm (v10.x o superior).
  2. MySQL Server (v8.0 o superior) en ejecución.
  3. Git para control de versiones.

---

## 🚀 Guías de Puesta en Marcha

Seleccione la modalidad que mejor se adapte a su entorno de trabajo:

```
┌────────────────────────────────────────────────────────────────────────┐
│ MODALIDAD A: Desarrollo Local con Docker Compose (1 solo equipo)      │
│ MODALIDAD B: Despliegue Distribuido en Red LAN (Presentación 3 equipos)│
│ MODALIDAD C: Instalación Tradicional sin Docker                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 🐳 MODALIDAD A: Desarrollo Local Rápido con Docker Compose (Recomendado)

Esta modalidad levanta de forma automática la base de datos MySQL 8.0 y la API de Node.js en una misma máquina sin necesidad de instalar MySQL localmente.

1. **Configurar el archivo de entorno:**
   ```bash
   cp .env.example .env
   ```
   *(En PowerShell: `Copy-Item .env.example .env`)*.

2. **Completar `.env` con las credenciales vigentes y `JWT_SECRET`.** Para un volumen nuevo, defina `DB_ROOT_PASSWORD` en la sesión de Compose y siga el [aprovisionamiento del esquema anterior](docs/database/etapa-1-secure-ecommerce.md#esquema-anterior).

3. **Levantar los servicios con Docker Compose:**
   ```bash
   docker compose up -d --build
   ```

4. **Generar Swagger en el contenedor:**
   ```bash
   docker compose exec app npm run swagger
   ```

5. **Acceder a la aplicación:**
   * **API REST:** `http://localhost:3000`
   * **Documentación Swagger UI:** `http://localhost:3000/swagger`

6. **Para detener los contenedores:**
   ```bash
   docker compose down
   ```

---

### 🌐 MODALIDAD B: Despliegue Distribuido en Red LAN (Presentación en 3 Equipos)

Arquitectura distribuida en 3 capas físicas/virtuales conectadas a la misma red local (LAN o Wi-Fi del aula):

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│       EQUIPO 1         │      │        EQUIPO 2        │      │        EQUIPO 3        │
│  Servidor de MySQL 8   │◄────►│  Servidor API Node.js  │◄────►│ Cliente Web / Swagger  │
│  IP: 192.168.1.10:3307 │      │  IP: 192.168.1.20:3000 │      │ IP: 192.168.1.30       │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

#### Paso 1: Configurar el EQUIPO 1 (Base de Datos MySQL)
1. Clonar el repositorio en el Equipo 1.
2. Levantar **únicamente** el contenedor de MySQL con Docker:
   ```bash
   docker compose up -d db
   ```
   En un volumen nuevo, defina antes `DB_ROOT_PASSWORD` en la sesión de Compose. `bd.sql` crea la base anterior en el primer arranque. El [aprovisionamiento de la cuenta](docs/database/etapa-1-secure-ecommerce.md#esquema-anterior) es un paso administrativo separado.
3. Obtener la dirección IP local de este equipo:
   * En Windows PowerShell: `ipconfig` (buscar dirección IPv4, ej: `192.168.1.10`).
   * En Linux/Mac: `ip a` o `ifconfig`.
4. **Permitir el puerto publicado `3307` desde el Equipo 2 en el Firewall de Windows del Equipo 1:**
   ```powershell
   New-NetFirewallRule -DisplayName "MySQL 3307" -Direction Inbound -Protocol TCP -LocalPort 3307 -RemoteAddress 192.168.1.20 -Action Allow
   ```

---

#### Paso 2: Configurar el EQUIPO 2 (Servidor de Aplicación / Backend API)
1. Clonar el repositorio en el Equipo 2.
2. Copiar la plantilla `.env.example` a `.env`:
   ```bash
   cp .env.example .env
   ```
3. Editar el archivo `.env` configurando la IP del Equipo 1 y el origen CORS:
   ```env
   # Apuntar al Equipo 1 (Base de Datos)
   DB_HOST=192.168.1.10
   DOCKER_DB_HOST=192.168.1.10
   DB_PORT=3307
   DOCKER_DB_PORT=3307
   DB_DATABASE=mercadolibrenode
   DB_USER=mercadolibre_user
   DB_PASSWORD=

   # Configurar puerto y CORS para admitir al cliente (Equipo 3)
   SERVER_PORT=3000
   CORS_ORIGIN=http://192.168.1.30:8080,http://localhost:8080
   ```
4. Completar `DB_PASSWORD` y `JWT_SECRET`. Arrancar la API con el esquema anterior ya preparado:
   * **Con Node.js nativo:**
     ```bash
     npm ci
     npm run swagger
     npm start
     ```
   * **O con Docker en el Equipo 2:**
     ```bash
     docker compose up -d --no-deps --build app
     docker compose exec app npm run swagger
     ```
5. Obtener la IP local del Equipo 2 (ej: `192.168.1.20`).
6. **Habilitar el puerto 3000 en el Firewall de Windows del Equipo 2:**
   ```powershell
   New-NetFirewallRule -DisplayName "API Node 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```

---

#### Paso 3: Configurar el EQUIPO 3 (Cliente / Consumidor / Frontend)
1. Desde el navegador del Equipo 3, abrir la documentación interactiva Swagger:
   ```
   http://192.168.1.20:3000/swagger
   ```
   *(Donde `192.168.1.20` es la IP del Equipo 2)*.
2. Si se utiliza una aplicación Frontend (React, Vue o Vanilla JS), configurar la URL base de peticiones HTTP en:
   ```
   http://192.168.1.20:3000/api
   ```
3. Si se utiliza la extensión **REST Client** de VS Code o **Postman**, realizar las peticiones a los endpoints del servidor:
   * `POST http://192.168.1.20:3000/api/auth`
   * `GET http://192.168.1.20:3000/api/products`
   * `GET http://192.168.1.20:3000/api/categories`

---

### 💻 MODALIDAD C: Instalación Tradicional sin Docker

1. **Inicialización de la Base de Datos MySQL:**
   Abra la consola de MySQL con el usuario `root` y ejecute el script `bd.sql`:
   ```bash
   mysql -u root -p < bd.sql
   ```
   *O dentro de la consola interactiva de MySQL:*
   ```sql
   source ./bd.sql;
   ```

2. **Configuración de Variables de Entorno:**
   ```bash
   cp .env.example .env
   ```
   Configure las credenciales correspondientes a su servidor MySQL local, `JWT_SECRET` y `DB_PORT` según el puerto de ese servidor, habitualmente `3306` para una instalación directa.

3. **Instalación de Dependencias:**
   ```bash
   npm ci
   ```

4. **Preparación de la base anterior:** siga el [procedimiento administrativo](docs/database/etapa-1-secure-ecommerce.md#esquema-anterior) si necesita inicializar un servidor independiente.

5. **Generación de Swagger y Arranque:**
   ```bash
   npm run swagger
   npm start
   ```

---

## 🧪 Pruebas Automatizadas y Auditoría de Seguridad

Las pruebas unitarias y de integración verifican el contrato en inglés. Las pruebas opcionales con MySQL 8 crean bases temporales propias y comprueban migraciones, reversión, seeders y contratos HTTP reales. Consulte [el reporte de normalización](docs/backend-english-names.md) para los resultados de esta revisión.

```bash
# Ejecutar todas las pruebas (Unitarias e Integración)
npm test

# Ejecutar con reporte de cobertura
npm run test:coverage

# Comprobar dependencias con umbral de severidad alta
npm audit
```

---

## 🌿 Gestión del Repositorio Git

El archivo `.gitignore` mantiene una política estricta de seguridad:
* **Excluye secretos y entornos:** `.env`, `.env.*`.
* **Excluye archivos con credenciales estáticas:** `config/config.json`.
* **Excluye volcados generales:** `*.sql` manteniendo únicamente el script estructurado `!bd.sql`.
* **Excluye archivos de prueba con tokens:** `restclient/`.
* **Excluye registros y cargas:** `log/*.txt`, `uploads/*`.

Para clonar y publicar cambios del equipo:
```bash
git clone <URL_REPOSITORIO>
cd backendnode
cp .env.example .env
npm ci
```

---

## 🚀 Integración Continua y Calidad de Código (CI/CD)

El repositorio cuenta con dos flujos de trabajo automatizados en GitHub Actions (`.github/workflows/`):

1. **`test.yml` (Suite de Pruebas & Auditoría):**
   * Se ejecuta automáticamente ante cada `push` directo o `pull_request` a las ramas `main` y `develop`.
   * Instala dependencias limpias (`npm ci`), ejecuta `npm audit` y ejecuta las pruebas disponibles con reporte de cobertura.
2. **`sonar.yml` (Análisis Estático con SonarQube Cloud):**
   * Genera el reporte LCOV (`coverage/lcov.info`) y ejecuta el escáner de SonarQube Cloud.
   * Evalúa mantenibilidad, confiabilidad, seguridad (vulnerabilidades/hotspots) y cobertura mediante [sonar-project.properties](sonar-project.properties).
   * **Configuración requerida en GitHub:** Configurar el token generado en SonarCloud como secreto del repositorio en `Settings -> Secrets and variables -> Actions` con el nombre `SONAR_TOKEN`.

### 🔄 Política de Integración y Pull Requests
* **Push Directo Permitido:** Los flujos están diseñados para dispararse tanto en `push` directo como en `pull_request`. Mientras no se activen reglas restrictivas de protección de rama en GitHub, todos los colaboradores pueden seguir subiendo su trabajo directamente a `main` sin esperas ni bloqueos.
* **Validación Opcional en Pull Requests:** Si algún colaborador decide abrir un Pull Request para revisión en equipo, ambos flujos validarán automáticamente la integridad del código y el Gate de Calidad de SonarQube antes del merge.

