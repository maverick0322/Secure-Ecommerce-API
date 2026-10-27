# Checklist de Documentación y Plan de Trabajo de Ingeniería de Software

**Ubicación:** `docs/checklist_y_plan_documentacion.md`  
**Referencia Base:** Documentación AsciiDoc en [`docs/asciidoc/`](file:///c:/codigo/ps/backendnode/docs/asciidoc/)  
**Enfoque:** Estándares IEEE 830 / ISO/IEC/IEEE 29148 (Requisitos), Modelo de Vistas 4+1 de Kruchten / ISO/IEC/IEEE 42010 (Arquitectura) y Modelo STRIDE / OWASP (Seguridad).  
**Stack de la Solución Completa:** Backend Node.js / Express / MySQL 8 (Puerto 3000) $\longleftrightarrow$ Frontend ASP.NET Core 8.0 MVC / C# / Razor / Bootstrap 5 (Puerto 8080).

---

## 1. CHECKLIST GENERAL DE SECCIONES (CONTROL DE AVANCE)

### Prefacio e Introducción (`index.adoc` y `01_introduccion.adoc`)
- [ ] **Prefacio:** Metadatos del proyecto, repositorio, arquitectura cliente-servidor (.NET 8 MVC $\leftrightarrow$ Node.js API $\leftrightarrow$ MySQL 8) y contexto institucional.
- [ ] **1.1 Propósito:** Formalización de la especificación técnica bajo la tríada CIA.
- [ ] **1.2 Justificación:** Contexto hostil de e-commerce, riesgos legales/financieros y estándares OWASP/CWE.
- [ ] **1.3 Objetivos:**
  - [ ] Objetivo General del backend seguro y su desacoplamiento con clientes frontend.
  - [ ] Objetivos Específicos (ORM anti-SQLi, JWT stateless, Rolling tokens, puente Cookie-JWT en C#, cobertura > 90%, SonarQube Gate A).
- [ ] **1.4 Metodología de Desarrollo:** S-SDLC, Defense in Depth, Menor Privilegio, CI/CD con GitHub Actions.
- [ ] **1.5 Referencias Normativas:** RFC 7519, NIST SP 800-63B, OWASP Top 10 API, CWE Top 25.

---

### Capítulo 2: Especificación de Requisitos (`02_requisitos.adoc`) ✅ COMPLETADO
- [x] **2.1 Contexto del Dominio:** Infraestructura de comercio electrónico, arquitectura en 3 capas (C# .NET 8 $\leftrightarrow$ Node Express $\leftrightarrow$ MySQL).
- [x] **2.2 Impacto:** Mitigación de compromiso de cuentas, confidencialidad y continuidad operativa.
- [x] **2.3 Partes Interesadas y Actores del Sistema:**
  - [x] `Usuario` (Navegación en catálogo, compras, visualización de imágenes y consulta de sesión).
  - [x] `Administrador` (Gestión de productos, categorías, subida de archivos, administración de usuarios y bitácora).
  - [x] `Cliente Frontend .NET` (Servidor de presentación en puerto 8080 con autenticación por Cookies y consumo HTTP tipado).
- [x] **2.4 Requisitos Funcionales (RF-01 al RF-10) — IEEE 830 §3.2 CORREGIDO:**
  - [x] RF-01: Autenticación con JWT (HS256) y puente de cookies `.frontendnet`. Prioridad: Alta. Estabilidad: Estable.
  - [x] RF-02: Consulta de tiempo restante de sesión (`/api/auth/tiempo`). Prioridad: Media. Estabilidad: Estable.
  - [x] RF-03: CRUD de categorías con restricción de protegidas. Prioridad: Alta. Estabilidad: Estable.
  - [x] RF-04: Gestión de catálogo de productos e inventario con Whitelist DTO (CWE-915). Prioridad: Alta. Estabilidad: Estable.
  - [x] RF-05: Búsqueda y filtrado de productos (`?s=termino`). Prioridad: Media. Estabilidad: Estable.
  - [x] RF-06: Asociación relacional N:M (Categoría-Producto). Prioridad: Alta. Estabilidad: Estable.
  - [x] RF-07: Ingesta y almacenamiento dual de archivos multimedia (Disco vs BLOB). Prioridad: Alta. Estabilidad: Estable.
  - [x] RF-08: Trazabilidad inmutable de eventos en bitácora. Prioridad: Alta. Estabilidad: Estable.
  - [x] **RF-09 (NUEVO):** Gestión completa de Usuarios del Sistema CRUD (`/api/usuarios`). Prioridad: Alta. Estabilidad: Estable.
  - [x] **RF-10 (NUEVO):** Consulta del Catálogo de Roles (`/api/roles`). Prioridad: Baja. Estabilidad: Estable.
- [x] **2.5 Casos de Uso del Sistema (CU-01 al CU-08) — CORREGIDO:**
  - [x] CU-01: Iniciar Sesión (flujo principal + 4 flujos alternos 400/401).
  - [x] CU-02: Gestionar Catálogo de Categorías (flujo + FA-01: 401, FA-02: 400 protegida, FA-03: 403).
  - [x] CU-03: Administrar Productos e Inventario (flujo + FA-01: 400 validación, FA-02: 404).
  - [x] CU-04: Consultar Productos y Categorías (flujo público + FA-01: búsqueda vacía).
  - [x] CU-05: Asociar/Desasociar Categorías a Productos (flujo + FA-01: 404, FA-02: 400).
  - [x] CU-06: Subir y Descargar Archivos Multimedia (flujo + FA-01: 2MB, FA-02: MIME, FA-03/04: 404).
  - [x] CU-07: Consultar Bitácora de Auditoría (flujo + FA-01: 403, FA-02: vacía).
  - [x] **CU-08 (NUEVO):** Gestionar Usuarios del Sistema (CRUD completo + 5 flujos alternos: 409, 403, 404, 400, 403).
- [x] **2.6 Prototipos de Interfaz de Usuario (Mockups/Wireframes Razor):**
  - [x] Prototipo Home / Portada con Carrusel y tema Mercado Libre (`#ffe600`).
  - [x] Prototipo Pantalla de Login / Autenticación con mensajes de validación.
  - [x] Prototipo Listado de Productos y formulario Crear/Editar.
  - [x] Prototipo Gestión de Archivos Multimedia (UUID, MIME y tamaño).
  - [x] Prototipo Listado y Consulta de Bitácora (formato es-MX).
- [x] **2.7 Validaciones en Dos Capas (Defense in Depth):**
  - [x] Capa 1 DataAnnotations C#: `[Required]`, `[EmailAddress]`, `[MinLength(6)]`, `[MaxLength(255)]`, `[RegularExpression]`.
  - [x] Capa 2 express-validator / Multer en Node.js: validación semántica mandatoria en todos los endpoints.
- [x] **2.8 Requisitos No Funcionales (RNF-01 al RNF-05):**
  - [x] RNF-01: JWT 20 min + Cookie `.frontendnet` Sliding Expiration 20 min.
  - [x] RNF-02: Rolling Tokens < 5 min transparentes vía `RefrescaTokenDelegatingHandler`.
  - [x] RNF-03: RBAC doble (`[Authorize(Roles)]` en .NET + `Authorize()` en Express).
  - [x] RNF-04: Tiempo de respuesta < 200 ms con pool de conexiones y Event Loop.
  - [x] RNF-05: Docker Compose con `node:20-alpine` y usuario sin privilegios `USER node`.
- [x] **2.9 Reglas de Negocio del Dominio (RN-01 al RN-04):**
  - [x] RN-01: `protegido/protegida = true` → 403/400 Forbidden.
  - [x] RN-02: Email único → 409 Conflict.
  - [x] RN-03: Cuota 2 MB (backend) / 100 KB (frontend C#).
  - [x] RN-04: Solo `.jpg`/`.jpeg` con MIME `image/jpeg`.
- [x] **2.10 Matriz de Riesgos de Seguridad:** RS-01 (CWE-89 SQLi), RS-02 (CWE-208/307 Timing/Brute), RS-03 (CWE-915 Mass Assignment), RS-04 (CWE-22 Path Traversal), RS-05 (CWE-400 DoS).

---

### Capítulo 3: Diseño Arquitectónico Seguro (`03_diseno_arquitectonico.adoc`)
- [x] **3.1 Vista de Escenarios / Casos de Uso:** Diagrama UML de Casos de Uso formal (Actores vs Casos de Uso con `<<include>>`).
- [x] **3.2 Vista de Datos:**
  - [x] Diagrama Entidad-Relación (DER) conceptual y lógico.
  - [x] Esquema Relacional Normalizado en Tercera Forma Normal (3FN).
- [x] **3.3 Vista Lógica:** 
  - [x] Diagrama UML de Clases del Dominio y Modelos ORM Sequelize (Node.js).
  - [x] Diagrama UML de Modelos de Transferencia y DataAnnotations (C# .NET).
- [x] **3.4 Vista de Implementación / Desarrollo:** Diagrama UML de Componentes en 3 Capas:
  - [x] Capa 1: Frontend ASP.NET Core 8 MVC (Controllers, Typed HttpClients, DelegatingHandlers, Razor Views).
  - [x] Capa 2: Backend Express API (Middlewares, Routes, Controllers, Services, Sequelize).
  - [x] Capa 3: Base de Datos MySQL 8.0.
- [x] **3.5 Vista de Procesos (Diagramas de Secuencia UML):**
  - [x] *Secuencia 1:* Autenticación End-to-End: Browser $\rightarrow$ AuthController $\rightarrow$ Node.js API $\rightarrow$ MySQL $\rightarrow$ Cookie `.frontendnet`.
  - [x] *Secuencia 2:* Petición Protegida y Rolling Token: `EnviaBearerDelegatingHandler` inyecta JWT $\rightarrow$ Node valida y emite `Set-Authorization` $\rightarrow$ `RefrescaTokenDelegatingHandler` refresca la Cookie.
  - [x] *Secuencia 3:* Ingesta de Archivos: Carga `IFormFile` $\rightarrow$ Multer $\rightarrow$ Persistencia Dual (Disco vs BLOB en MySQL).
  - [x] *Secuencia 4:* Mutación Segura de Catálogo, Whitelist DTO y Trazabilidad en Bitácora.
- [x] **3.6 Vista Física / Despliegue:**
  - [x] Diagrama de Despliegue UML: Contenedores Docker (`ecommerce_api`, `ecommerce_db`), host .NET Kestrel (Puerto 8080) y volúmenes montados.
  - [x] Topología de Red LAN: Distribución física/virtual de 3 equipos (Equipo 1: MySQL 3306, Equipo 2: Node.js API 3000, Equipo 3: Cliente Frontend 8080).
- [x] **3.7 Vista de Seguridad y Modelo de Amenazas:**
  - [x] Diagrama de Flujo de Datos (DFD) con Fronteras de Confianza (Trust Boundaries: Browser $\rightarrow$ .NET $\rightarrow$ Express $\rightarrow$ MySQL).
  - [x] Matriz de Amenazas y Mitigaciones STRIDE (OWASP Threat Dragon).

---

### Capítulo 4: Construcción Segura (`04_construccion_segura.adoc`)
- [ ] **4.1 Selección Justificada del Stack:** Dualidad tecnológica justificada (.NET 8 MVC en cliente por robustez en SSR + Node.js/Sequelize en API por agilidad REST).
- [ ] **4.2 Patrón de Software:** Doble patrón MVC desacoplado (MVC de presentación en C# + MVC de API REST en Node.js).
- [ ] **4.3 Entorno de Desarrollo Seguro:** Variables `.env` en Node, `appsettings.json` en C#, exclusión de secretos en git.
- [ ] **4.4 Estrategia de Autenticación Híbrida (Cookie $\leftrightarrow$ JWT):** 
  - [ ] Claims estándar WS-Federation (`http://schemas.xmlsoap.org/...`) compartidos entre C# y Node.js.
  - [ ] Mecanismo de delegación con `DelegatingHandler` para desacoplar el manejo del JWT del código de las vistas.
- [ ] **4.5 Estrategia ORM y Parametrización:** Supresión de SQL crudo, consultas preparadas, migraciones de esquema.
- [ ] **4.6 Comunicación Segura Frontend-Backend:** CORS dinámico, `exposedHeaders`, eliminación de `X-Powered-By`.
- [ ] **4.7 Validación en Capas:** Doble validación (DataAnnotations en C# + `express-validator` en Node.js).
- [ ] **4.8 Mitigaciones CWE Específicas:** CWE-89, CWE-434, CWE-22, CWE-400, CWE-915, CWE-200.
- [ ] **4.9 Almacenamiento y Protección de Contraseñas:** Bcrypt salt=10, protección contra Timing Attacks (`DUMMY_HASH`).

---

### Capítulo 5: Estándares de Codificación (`05_estandares_codificacion.adoc`)
- [ ] **5.1 Estándar JavaScript (Backend Node.js):**
  - [ ] Convenciones de nomenclatura (`camelCase`, `PascalCase`, `UPPER_SNAKE_CASE`).
  - [ ] Manejo estricto de tipos (`===`, `!==`, prohibición de `var`).
  - [ ] Flujo asíncrono y control de excepciones (`async/await`, `try/catch`, `next(err)`).
  - [ ] Reglas defensivas (veto de `eval()`, prototype pollution, parámetros validados).
- [ ] **5.2 Estándar C# (Frontend ASP.NET Core 8):**
  - [ ] Convenciones de nomenclatura (`PascalCase`, campos privados `_camelCase`, interfaces `I`).
  - [ ] Reglas defensivas (`IHttpClientFactory`, Typed HttpClients, `System.Text.Json`, `[ValidateAntiForgeryToken]` en vistas Razor).
  - [ ] Manejo seguro de Cookies de sesión (`CookieAuthenticationDefaults`, `HttpOnly`, `SameSiteMode.Lax`).

---

### Capítulo 6: Plan y Reporte de Pruebas (`06_plan_pruebas.adoc`)
- [ ] **6.1 Análisis Estático SonarQube Cloud:** Quality Gate A, cobertura 92.6%, 0 Security Hotspots.
- [ ] **6.2 Pruebas de Penetración con Metasploit:**
  - [ ] Prueba 1: Escaneo de versión HTTP / Banner grabbing.
  - [ ] Prueba 2: Fuerza bruta en endpoint `/api/auth`.
  - [ ] Prueba 3: Carga de shell malicioso en `/api/archivos`.
- [ ] **6.3 Pruebas de Inyección SQL:** Validación de parámetros maliciosos con comillas y operadores lógicos.
- [ ] **6.4 Pruebas de Estrés y Rendimiento:** Autocannon / Apache Benchmark ante ráfagas concurrentes.
- [ ] **6.5 Pruebas contra CSRF:** Neutralización en backend por tokens Bearer y protección en frontend con `[ValidateAntiForgeryToken]`.
- [ ] **6.6 Pruebas contra XSS:** Sanitización JSON, Razor Encoding automático (`@Model`) y supresión de contenido ejecutable.
- [ ] **6.7 Reporte de Pruebas Automatizadas:** 121 casos ejecutados con Jest y Supertest (100% aprobados).
- [ ] **6.8 Escaneo de Puertos Nmap:** Validación de puertos autorizados (3000, 3306, 8080) y filtrado perimetral.

---

### Capítulo 7: Despliegue Seguro (`07_despliegue_seguro.adoc`)
- [ ] **7.1 Configuración de Servidores y Servicios:** Docker Compose (`ecommerce_api`, `ecommerce_db`), Host .NET Kestrel (puerto 8080), usuario sin privilegios `USER node`.
- [ ] **7.2 Estrategia de Respaldos:** Respaldos lógicos con `mysqldump`, respaldos físicos de volúmenes, políticas RPO (< 24h) y RTO (< 30 min).
- [ ] **7.3 Auditoría y Respuesta a Incidentes:** Bitácora en BD, archivo `log.txt`, contención de credenciales, revocación y rollback.

---

### Capítulo 8: Conclusiones (`08_conclusiones.adoc`)
- [ ] **8.1 Contribuciones del Proyecto:** Neutralización de SQLi, arquitectura híbrida Cookie-JWT, resiliencia DoS, cultura de pruebas end-to-end.

---

## 2. PLAN DE REORDENAMIENTO Y ABORDAJE METODOLÓGICO: CAPÍTULO 2

### Secuencia Lógica de Ingeniería de Software (IEEE 830 / ISO 29148)

```
[1. Contexto y Alcance del E-Commerce]
          │
          ▼
[2. Actores del Sistema] ──► (Usuario, Administrador, Cliente Frontend .NET)
          │
          ▼
[3. Requisitos Funcionales] ──► (RF-01 al RF-08: Capacidades del Backend consumidas por el Frontend)
          │
          ▼
[4. Casos de Uso Detallados] ──► (CU-01 al CU-07: Flujo Principal, Alternos 4xx y Excepciones)
          │
          ▼
[5. Prototipos Visuales de Interfaz] ──► (Pantallas Razor exactas: Home, Login, Productos, Archivos, Bitácora)
          │
          ▼
[6. Validaciones en Cliente y Servidor] ──► (DataAnnotations en C# vs express-validator en Node.js)
          │
          ▼
[7. Requisitos No Funcionales] ──► (RNF-01 al RNF-05: Seguridad, Rendimiento, Disponibilidad)
          │
          ▼
[8. Reglas de Negocio] ──► (RN-01 al RN-04: Registros protegidos, cuota 2MB, unicidad)
          │
          ▼
[9. Matriz de Riesgos Iniciales] ──► (CWE / OWASP: Amenazas mitigadas por diseño)
```

---

## 3. PLAN DE REORDENAMIENTO Y ABORDAJE METODOLÓGICO: CAPÍTULO 3

### Secuencia Metodológica de Diagramación (Kruchten 4+1 + STRIDE)

```
ORDEN SECUENCIAL RIGUROSO DE DIAGRAMAS:

1. VISTA DE ESCENARIOS (Casos de Uso)
   └── Diagrama UML de Casos de Uso (Actores Usuario y Administrador frente a la API)

2. VISTA DE DATOS (Persistencia Relacional)
   ├── Diagrama Entidad-Relación (DER) (7 tablas: usuario, rol, producto, categoria, categoriaproducto, archivo, bitacora)
   └── Esquema Relacional Normalizado en 3FN

3. VISTA LÓGICA (Estructura Estática de Clases)
   ├── 3.1 Diagrama UML de Modelos Sequelize (Node.js) con asociaciones ORM
   └── 3.2 Diagrama UML de Modelos DataAnnotations (C# .NET)

4. VISTA DE IMPLEMENTACIÓN / DESARROLLO (Arquitectura en 3 Capas)
   └── Diagrama UML de Componentes (.NET 8 MVC en 8080 ──HTTP──► Node.js API en 3000 ──TCP──► MySQL 8 en 3306)

5. VISTA DE PROCESOS (Dinámica Temporal de Extremo a Extremo)
   ├── 5.1 Diagrama de Secuencia UML: Autenticación Browser -> .NET -> Node -> MySQL -> Cookie
   ├── 5.2 Diagrama de Secuencia UML: DelegatingHandlers (EnviaBearer y RefrescaToken con Rolling Tokens)
   ├── 5.3 Diagrama de Secuencia UML: Ingesta Multipart y Persistencia Dual (Disco vs BLOB)
   └── 5.4 Diagrama de Secuencia UML: Mutación de Catálogo con Whitelist DTO y Auditoría

6. VISTA FÍSICA / DESPLIEGUE (Infraestructura)
   ├── Diagrama de Despliegue UML (Contenedores Docker ecommerce_api y ecommerce_db + Host .NET)
   └── Topología de Red LAN (Distribución de 3 equipos en LAN)

7. VISTA DE SEGURIDAD Y MODELO DE AMENAZAS
   ├── Diagrama de Flujo de Datos (DFD) con Fronteras de Confianza (Browser -> .NET -> Node -> MySQL)
   └── Matriz de Amenazas y Mitigaciones STRIDE (OWASP Threat Dragon)
```

---

## 4. HOJA DE RUTA PARA TRABAJAR CAPÍTULO POR CAPÍTULO

| Fase de Trabajo | Capítulo a Abordar | Entregables Principales | Criterio de Aceptación / Definición de Terminado |
| :--- | :--- | :--- | :--- |
| **Fase 1** | **Capítulo 2: Requisitos** | Requisitos funcionales detallados, fichas de casos de uso completas, prototipos visuales de Razor y validaciones DataAnnotations. | Cobertura total de los 8 RFs y los 7 CUs con flujos alternos y mockups correspondientes. |
| **Fase 2** | **Capítulo 3: Arquitectura** | Generación de los diagramas UML (Casos de Uso, Clases, Componentes en 3 capas, Secuencias con DelegatingHandlers, Despliegue y DFD/STRIDE). | Diagramas consistentes 1:1 con el código de Node.js, .NET 8 y MySQL. |
| **Fase 3** | **Capítulo 4: Construcción Segura** | Redacción técnica de la arquitectura híbrida (Cookie $\leftrightarrow$ JWT), mitigaciones CWE, hashing Bcrypt y validaciones en dos capas. | Verificación de referencias a archivos de código y buenas prácticas OWASP. |
| **Fase 4** | **Capítulo 5: Estándares** | Especificación formal de reglas de Clean Code y programación segura para JavaScript (Node) y C# (Frontend ASP.NET Core 8). | Ejemplos de código defensivo validados para ambos lenguajes. |
| **Fase 5** | **Capítulo 6: Plan de Pruebas** | Tablas de 121 pruebas automatizadas, reportes SonarQube Cloud, escenarios Metasploit y escaneo Nmap. | Evidencia empírica de métricas (92.6% cobertura, Quality Gate Passed). |
| **Fase 6** | **Capítulo 7: Despliegue Seguro** | Configuración de Docker, políticas de respaldo (RPO/RTO) y procedimientos de respuesta a incidentes. | Dockerfile y docker-compose funcionales bajo usuario sin privilegios. |
| **Fase 7** | **Capítulo 1 y 8: Cierre** | Introducción formal, objetivos, metodología S-SDLC y conclusiones valorativas del impacto de seguridad. | Documento completo compilable a HTML/PDF vía `build.js` sin errores. |
