# E-Commerce Backend API en Node.js 🛡️

**Materia:** Programación Segura  
**Institución:** Facultad de Estadística e Informática — Universidad Veracruzana  
**Tecnologías:** Node.js (v20+), Express.js, Sequelize ORM, MySQL 8.0, JWT, Bcrypt, Multer, Swagger (OpenAPI).

---

## 📋 Descripción del Proyecto

API RESTful segura para una plataforma de E-Commerce desarrollada siguiendo el patrón arquitectónico **MVC (Modelo-Vista-Controlador)**. El sistema integra mecanismos de autenticación sin estado (stateless) mediante JWT, control de acceso basado en roles (RBAC), renovación continua de sesión (Rolling Tokens), trazabilidad y auditoría inmutable de operaciones (Bitácora), y persistencia relacional con el ORM **Sequelize**.

### 🔐 Enfoque en Programación Segura y Uso del ORM

Uno de los pilares arquitectónicos centrales del proyecto es la **eliminación de consultas SQL manuales** mediante la adopción integral de **Sequelize ORM**:
* **Prevención de Inyección SQL (CWE-89):** Al utilizar el ORM, todas las consultas a la base de datos MySQL son parametrizadas de forma transparente y nativa, neutralizando el vector de ataque más crítico en aplicaciones web (OWASP Top 10 A03: Injection).
* **Control de Esquema mediante Migraciones:** Se elimina la ejecución de scripts DDL descontrolados en producción; cada cambio estructural está versionado cronológicamente en la carpeta `migrations/`.
* **Aislamiento de Atributos:** Permite abstraer y proteger campos sensibles en reposo (como `passwordhash` y el flag `protegido`).

Para más detalles sobre los requerimientos arquitectónicos y las justificaciones defensivas, consulte los documentos en `docs/`:
- 📄 [docs/reporte_auditoria_backend_node.md](docs/reporte_auditoria_backend_node.md)
- 📄 [docs/asr_y_justificacion_cambios.md](docs/asr_y_justificacion_cambios.md)

---

## 📂 Estructura del Proyecto

```
backendnode/
├── config/             # Configuración dinámica del ORM y esquemas de claims
├── controllers/        # Controladores MVC con lógica de negocio y sanitización
├── docs/               # Documentación formal de arquitectura, auditoría y ASRs
├── log/                # Registro persistente de eventos y errores (log.txt)
├── middlewares/        # Middlewares de seguridad (JWT, RBAC, bitácora, upload, errores)
├── migrations/         # Migraciones estructuradas de base de datos
├── models/             # Modelos Sequelize y definiciones relacionales
├── restclient/         # Pruebas HTTP para extensión REST Client de VS Code
│   └── assets/         # Imágenes de prueba para subida
├── routes/             # Enrutamiento de endpoints con guardas de autorización
├── seeders/            # Datos iniciales de catálogos y usuarios de prueba
├── services/           # Lógica reutilizable de generación y validación de tokens
├── uploads/            # Directorio físico para archivos multimedia
├── .env.example        # Plantilla pública de variables de entorno
├── .gitignore          # Reglas estrictas de exclusión para Git
├── .sequelizerc        # Enrutador de rutas para la CLI de Sequelize
├── bd.sql              # Script DDL inicial de MySQL
├── package.json        # Manifiesto de dependencias y scripts NPM
└── swagger.js          # Generador de documentación Swagger / OpenAPI
```

---

## 🛠️ Prerrequisitos

1. **Node.js** (v20.x o superior) y **npm** (v10.x o superior).
2. **MySQL Server** (v8.0 o superior) en ejecución local.
3. **Visual Studio Code** con la extensión **REST Client**.
4. **Git** para control de versiones.

---

## 🚀 Guía de Instalación y Puesta en Marcha

### 1. Inicialización de la Base de Datos MySQL
Abra la consola de MySQL con el usuario `root` y ejecute el script `bd.sql` provisto:
```bash
mysql -u root -p < bd.sql
```
*O dentro del cliente MySQL:*
```sql
source C:/codigo/ps/backendnode/bd.sql;
```
Esto creará la base de datos `mercadolibrenode`, el usuario de servicio `mercadolibre_user` (clave `M3rc@d0`) y asignará los privilegios necesarios.

### 2. Configuración de Variables de Entorno
Copie la plantilla `.env.example` a `.env`:
```bash
cp .env.example .env
```
*(En Windows PowerShell: `Copy-Item .env.example .env`)*.  
Verifique que los valores de conexión a MySQL y el secreto `JWT_SECRET` sean los deseados.

### 3. Instalación de Dependencias
Instale los paquetes de Node.js:
```bash
npm install
```

### 4. Ejecución de Migraciones del ORM
Cree las tablas relacionales en MySQL en orden estricto de llaves foráneas:
```bash
npm run migrate
```

### 5. Inserción de Datos Iniciales (Seeders)
Pueble las tablas con los catálogos y usuarios iniciales:
```bash
npm run seed
```

### 6. Generación de Documentación Swagger
Genere el esquema OpenAPI `swagger-output.json`:
```bash
npm run swagger
```

### 7. Inicio del Servidor en Desarrollo
Inicie la API con reinicio automático nativo (`node --watch`):
```bash
npm start
# O alternativamente:
npm run dev
```
El servidor escuchará en el puerto configurado: `http://localhost:3000`.  
La interfaz interactiva de Swagger estará disponible en: `http://localhost:3000/swagger`.

### 8. Ejecución de Pruebas Automatizadas y Auditoría de Seguridad
Para comprobar el correcto funcionamiento de los 49 casos de prueba y la seguridad de la cadena de suministro:
```bash
# Ejecutar todas las pruebas (Unitarias e Integración)
npm test

# Ejecutar con análisis de cobertura
npm run test:coverage

# Comprobar auditoría de seguridad de dependencias (0 vulnerabilidades)
npm audit
```

---

## 🌿 Inicialización del Repositorio Git

El proyecto incluye un archivo `.gitignore` estricto que **excluye de forma automática**:
- Carpeta `node_modules/` (dependencias pesadas).
- Archivo `.env` (credenciales y llaves secretas).
- Archivos `*.sql` (scripts y volcados de base de datos).
- Carpeta `restclient/` (archivos con tokens de sesión y contraseñas de prueba).
- Registros en `log/*.txt` y archivos subidos en `uploads/*`.

Para inicializar el repositorio y publicarlo en GitHub cuando su equipo esté listo:
```bash
git init
git add .
git commit -m "feat: initial commit - secure ecommerce backend api architecture"
git branch -M main
git remote add origin <URL_DE_SU_REPOSITORIO_GITHUB>
git push -u origin main
```
