# E-Commerce Backend API en Node.js 🛡️

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
* **Aislamiento de Atributos:** Permite abstraer y proteger campos sensibles en reposo (como `passwordhash` y el flag `protegido`).
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
├── restclient/         # Pruebas HTTP para extensión REST Client de VS Code
├── routes/             # Enrutamiento de endpoints con guardas de autorización
├── seeders/            # Datos iniciales de catálogos y usuarios de prueba
├── services/           # Lógica reutilizable de generación y validación de tokens
├── uploads/            # Directorio físico para archivos multimedia
├── .dockerignore       # Exclusiones de contexto para construcción Docker
├── .env.example        # Plantilla pública de variables de entorno
├── .gitignore          # Reglas estrictas de exclusión para Git
├── .sequelizerc        # Enrutador de rutas para la CLI de Sequelize
├── bd.sql              # Script DDL inicial de MySQL (permisos locales y de red)
├── Dockerfile          # Imagen contenerizada de la API en Node.js (Alpine, no-root)
├── docker-compose.yml  # Orquestador multiservicio (API + MySQL 8.0)
├── package.json        # Manifiesto de dependencias y scripts NPM
└── swagger.js          # Generador de documentación Swagger / OpenAPI
```

---

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

2. **Levantar los servicios con Docker Compose:**
   ```bash
   docker compose up -d --build
   ```

3. **Ejecutar migraciones y datos iniciales en el contenedor:**
   ```bash
   docker compose exec app npm run migrate
   docker compose exec app npm run seed
   docker compose exec app npm run swagger
   ```

4. **Acceder a la aplicación:**
   * **API REST:** `http://localhost:3000`
   * **Documentación Swagger UI:** `http://localhost:3000/swagger`

5. **Para detener los contenedores:**
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
│  IP: 192.168.1.10:3306 │      │  IP: 192.168.1.20:3000 │      │ IP: 192.168.1.30       │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

#### Paso 1: Configurar el EQUIPO 1 (Base de Datos MySQL)
1. Clonar el repositorio en el Equipo 1.
2. Levantar **únicamente** el contenedor de MySQL con Docker:
   ```bash
   docker compose up -d db
   ```
   *(El script `bd.sql` se ejecuta automáticamente al primer inicio creando la base de datos y el usuario con permisos remotos `'mercadolibre_user'@'%'`)*.
3. Obtener la dirección IP local de este equipo:
   * En Windows PowerShell: `ipconfig` (buscar dirección IPv4, ej: `192.168.1.10`).
   * En Linux/Mac: `ip a` o `ifconfig`.
4. **Habilitar el puerto 3306 en el Firewall de Windows del Equipo 1:**
   ```powershell
   New-NetFirewallRule -DisplayName "MySQL 3306" -Direction Inbound -Protocol TCP -LocalPort 3306 -Action Allow
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
   DB_PORT=3306
   DB_DATABASE=mercadolibrenode
   DB_USER=mercadolibre_user
   DB_PASSWORD=M3rc@d0

   # Configurar puerto y CORS para admitir al cliente (Equipo 3)
   SERVER_PORT=3000
   CORS_ORIGIN=http://192.168.1.30:8080,http://localhost:8080
   ```
4. Ejecutar las migraciones y seeders para estructurar la base de datos remota del Equipo 1:
   * **Con Node.js nativo:**
     ```bash
     npm install
     npm run migrate
     npm run seed
     npm run swagger
     npm start
     ```
   * **O con Docker en el Equipo 2:**
     ```bash
     docker compose up -d --no-deps --build app
     docker compose exec app npm run migrate
     docker compose exec app npm run seed
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
   * `POST http://192.168.1.20:3000/api/auth/login`
   * `GET http://192.168.1.20:3000/api/productos`
   * `GET http://192.168.1.20:3000/api/categorias`

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
   Configure las credenciales correspondientes a su servidor MySQL local.

3. **Instalación de Dependencias:**
   ```bash
   npm install
   ```

4. **Ejecución de Migraciones y Seeders:**
   ```bash
   npm run migrate
   npm run seed
   ```

5. **Generación de Swagger y Arranque:**
   ```bash
   npm run swagger
   npm start
   ```

---

## 🧪 Pruebas Automatizadas y Auditoría de Seguridad

El proyecto cuenta con una cobertura integral de 49 pruebas unitarias y de integración:

```bash
# Ejecutar todas las pruebas (Unitarias e Integración)
npm test

# Ejecutar con reporte de cobertura
npm run test:coverage

# Comprobar auditoría de seguridad de dependencias (0 vulnerabilidades)
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
npm install
```
