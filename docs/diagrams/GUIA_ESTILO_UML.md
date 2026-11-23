# Guía de Estilo UML 2.5.1 y Convenciones de Diagramación

Este documento establece las reglas normativas de modelado y notación UML 2.5.1 para todos los diagramas PlantUML (`docs/diagrams/*.puml`) del proyecto **Tienda en Línea Segura** (`backendnode` + `frontendnet`). Toda regla está fundamentada en las dos obras de referencia del proyecto ubicadas en `libros/` y verificadas en [CITAS_VERIFICACION.md](file:///c:/codigo/ps/ecommerce/backendnode/docs/diagrams/CITAS_VERIFICACION.md):

- **`[Seidl2015]`**: Martina Seidl, Marion Scholz, Christian Huemer y Gerti Kappel, *UML @ Classroom: An Introduction to Object-Oriented Modeling*, Springer, 2015 (`libros/UML_at_Classroom_3dfd.pdf`).
- **`[Rosenberg2007]`**: Doug Rosenberg y Matt Stephens, *Use Case Driven Object Modeling with UML: Theory and Practice* (ICONIX Process), Apress, 2007 (`libros/Apress.Use.Case.Driven.Object.Modeling.with.UML.Jan.2007_7c25.pdf`).

---

## 1. Diagramas de Casos de Uso

### 1.1 Elementos permitidos `[Seidl2015, Cap. 3, §§3.1–3.4; Rosenberg2007, Cap. 3, pp. 49–61]`
1. **Caso de uso (`usecase`)**: Elipse identificada por una frase verbal en voz activa desde la perspectiva del actor que exprese un objetivo de negocio con valor observable (ej. *"Realizar pedido en checkout"*, *"Publicar producto con imagen"*) `[Seidl2015, Cap. 3, §3.1 y §3.7.1]`.
2. **Límite del sistema (`rectangle`)**: Caja que encierra exclusivamente los casos de uso que el sistema implementa, rotulada con el nombre del sistema o contexto acotado (`Tienda en Línea Segura`) `[Seidl2015, Cap. 3, §3.1 y §3.7.3 Error 2]`.
3. **Actor (`actor`)**: Rol externo que interactúa directamente con el sistema; siempre se ubica **fuera** del límite del sistema `[Seidl2015, Cap. 3, §3.2]`:
   - **Actores humanos (primarios/activos)**: Notación stick figure por defecto (`Comprador`, `Vendedor`, `Administrador`).
   - **Actores no humanos (sistemas externos secundarios/pasivos)**: Rectángulo con el estereotipo `«actor»` o `«external»` (ej. `Cloudinary API «external»`, `Gmail OAuth2 API «external»`) `[Seidl2015, Cap. 3, §3.2, Fig. 3.3]`.
4. **Asociación comunicativa (`--`)**: Línea sólida sin punta de flecha entre un actor y el caso de uso en el que participa `[Seidl2015, Cap. 3, §3.3]`.

### 1.2 Cuándo usar `«include»`, `«extend»` y generalización `[Seidl2015, Cap. 3, §§3.4–3.5; Rosenberg2007, Cap. 3, tema: relaciones entre casos de uso y factorización de comportamiento común]`
- **`«include»` (flecha punteada abierta `..>` desde el caso base hacia el caso incluido)**:
  - Úsese **únicamente** cuando un subflujo de comportamiento es obligatorio y se reutiliza en **dos o más** casos de uso base para evitar duplicación `[Seidl2015, Cap. 3, §3.5.1, Fig. 3.8; Rosenberg2007, Cap. 3, tema: relación «includes» y factorización de comportamiento común]`.
  - **Prohibido** usar `«include»` para descomposición funcional o para encadenar precondiciones como *"Iniciar sesión"* antes de cada acción autenticada (`Iniciar sesión` es un caso de uso independiente y una precondición de sesión en los demás casos, no un `«include»` de todos ellos) `[Seidl2015, Cap. 3, §3.7.3 Error 4, tema: descomposición funcional; Rosenberg2007, Cap. 3, tema: abuso de «includes»/«extends» y descomposición funcional]`.
- **`«extend»` (flecha punteada abierta `..>` desde el caso extensor hacia el caso base)**:
  - Úsese solo para comportamiento **opcional o condicional** que se inserta en un punto de extensión explícito **durante la ejecución** del caso de uso base bajo una guarda (`Condition: { ... }`, `Extension point: ...`) `[Seidl2015, Cap. 3, §3.5.2, Fig. 3.9]`.
  - **Regla sobre el uso incorrecto de `«extend»`:** No usar `«extend»` para acciones independientes del ciclo de vida de una entidad que ocurren en una sesión o momento posterior con su propia precondición (por ejemplo, *"Cancelar pedido pendiente"* **no** extiende *"Realizar pedido en checkout"*; ambos son casos de uso independientes asociados al actor `Comprador`, y cancelar declara como precondición la existencia de un pedido en estado `PENDING`).
- **Generalización (`--|>`, flecha sólida con punta triangular vacía del subtipo al supertipo)**:
  - Entre actores cuando un rol especializado hereda todos los casos de uso de un actor general, o entre casos de uso cuando un caso especializado refina uno general `[Seidl2015, Cap. 3, §3.4 y §3.5.3]`.
  - Si un actor padre se asocia a un caso de uso, sus subtipos lo heredan automáticamente y **no** deben repetir la línea de asociación `[Seidl2015, Cap. 3, §3.4, Fig. 3.6 y §3.7.3 Error 5]`.

### 1.3 Qué NO va en un diagrama de casos de uso `[Seidl2015, Cap. 3, §3.7.3, Errores 1–6; Rosenberg2007, Cap. 3, pp. 61–81 y Cap. 4, pp. 86–94]`
- **No modelar flujos de trabajo, orden temporal ni pasos secuenciales** entre casos de uso (los casos de uso no son diagramas de flujo ni máquinas de estados).
- **No modelar pasos internos ni subpasos obligatorios sin valor de negocio autónomo como casos de uso separados** (por ejemplo, *"Verificar código OTP"*, *"Validar contraseña"* o *"Calcular subtotal"* son pasos internos del curso básico de *"Registrar cuenta"* o *"Realizar pedido"*, **no** casos de uso independientes unidos por `«include»`) `[Seidl2015, Cap. 3, §3.7.3 Error 4, tema: descomposición funcional]`.
- **No modelar detalles internos de interfaz gráfica ni mecanismos técnicos** (ej. *"Hacer clic en botón enviar"*, *"Validar firma JWT RS256"*, *"Ejecutar script Lua en Redis"*).
- **No conectar actores entre sí** ni colocar actores dentro del rectángulo del sistema.
- **No desglosar un mismo objetivo CRUD en 4 elipses triviales** cuando comparten actor, precondiciones y valor de negocio (ej. colapsar altas, bajas y cambios de direcciones del comprador en *"Gestionar libreta de direcciones de envío"*, salvo que una operación tenga actores o reglas de negocio sustancialmente distintas, como *"Revisar solicitud de vendedor"* vs. *"Suspender vendedor aprobado"*) `[Seidl2015, Cap. 3, §3.7.3 Error 4 y Error 6]`.

### 1.4 Granularidad y estructura de la descripción `[Seidl2015, Cap. 3, §3.7.2, Tabla 3.1; Rosenberg2007, Cap. 3, tema: anatomía del escenario evento/respuesta y cursos básico y alternos]`
Cada caso de uso documentado fuera del gráfico debe poder expresarse con: **Nombre**, **Actor(es)**, **Precondiciones**, **Postcondiciones**, **Curso Básico** (flujo evento del usuario / respuesta del sistema referenciando objetos del dominio) y **Cursos Alternos / Excepciones** (errores `400/401/403/409/429`).

---

## 2. Diagramas de Clases

### 2.1 Compartimentos, visibilidad y formato `[Seidl2015, Cap. 4, §§4.2.1–4.2.6]`
1. **Compartimentos**: Tres compartimentos estándar: (1) estereotipo opcional y nombre de la clase en **sustantivo singular en `PascalCase`** (`User`, `Order`, `CatalogService`), (2) atributos relevantes de dominio/estado y (3) operaciones con responsabilidad clave `[Seidl2015, Cap. 4, §4.2.1; Rosenberg2007, Cap. 2, p. 31]`.
2. **Marcadores de visibilidad obligatorios** (`skinparam classAttributeIconSize 0` para renderizar los símbolos estándar UML) `[Seidl2015, Cap. 4, §4.2.5, Tabla 4.1]`:
   - `+` público (`public`)
   - `-` privado (`private`)
   - `#` protegido (`protected`)
   - `~` paquete / interno (`package` / `internal` en C#)
3. **Formato de atributos** `[Seidl2015, Cap. 4, §4.2.2]`:
   ```text
   visibilidad [/] nombre : Tipo [multiplicidad] [= valorPorDefecto] {propiedades}
   ```
   *(Ejemplo: `+ status : SellerStatus = PENDING`, `- passwordHash : string`, `/ total : decimal`).*
4. **Formato de operaciones** `[Seidl2015, Cap. 4, tema: formato y firma de operaciones]`:
   ```text
   visibilidad nombre(param1 : Tipo1, param2 : Tipo2) : TipoRetorno
   ```
   *(Ejemplo: `+ createQuote(buyerId : UUID, addressId : bigint) : CheckoutQuoteDto`).*
5. **Elementos estáticos y abstractos**: Miembros de clase (`static`) subrayados (`{static}` en PlantUML); clases u operaciones abstractas en cursiva o con `{abstract}` `[Seidl2015, Cap. 4, §4.2.6 y §4.6.1]`.

### 2.2 Relaciones entre clases `[Seidl2015, Cap. 4, §§4.3–4.7; Rosenberg2007, Cap. 2, pp. 31–36 y Cap. 8, p. 214]`
- **Asociación (`--` o `-->`) frente a atributo**: Si el tipo destino es otra clase del diagrama (`User`, `Product`, `Order`), **se modela como línea de asociación con multiplicidad**, sin duplicar la referencia como atributo primitivo suelto dentro de la caja (salvo en el modelo físico de tablas donde se documentan columnas `FK`) `[Seidl2015, Cap. 4, §4.3.1]`.
- **Multiplicidad y nombres de rol**: Toda asociación entre clases de dominio debe declarar explícitamente su multiplicidad en ambos extremos (`1`, `0..1`, `1..*`, `0..*` o `*`) y nombre de rol cuando clarifique la semántica (ej. `reviewedBy` entre `Seller` y `Admin`) `[Seidl2015, Cap. 4, §4.3.1; Rosenberg2007, Cap. 8, p. 214]`.
- **Agregación compartida (`o--`, rombo blanco) frente a composición (`*--`, rombo negro)** `[Seidl2015, Cap. 4, §4.5, tema: agregación compartida y composición]`:
  - **Composición (`*--`)**: Relación todo-parte con ciclo de vida exclusivo (la parte pertenece a un único todo y no existe sin él: `Cart 1 *-- 0..* CartItem`, `Order 1 *-- 1..* OrderItem`, `Order 1 *-- 1..* OrderStatusHistory`).
  - **Agregación (`o--`)**: Relación todo-parte débil donde la parte puede compartirse o sobrevivir al contenedor (`Category 0..* o-- 0..* Product` vía `ProductCategory`).
- **Generalización (`--|>`) frente a realización de interfaz (`..|>`)** `[Seidl2015, Cap. 4, §§4.6–4.7]`:
  - `--|>` (línea sólida, punta triangular cerrada vacía): herencia entre clases.
  - `..|>` (línea punteada, punta triangular cerrada vacía): una clase implementa una interfaz (`«interface»`).
- **Dependencia (`..>`, línea punteada con punta abierta)**: Un controlador o servicio usa temporalmente otra clase, validador o DTO como parámetro o dependencia sin poseer su estado `[Seidl2015, Cap. 4, §4.4, tema: clases de asociación]`.

### 2.3 Estereotipos y mapeo del proyecto `[Seidl2015, Cap. 4, §4.8 y §9.3; Rosenberg2007, Cap. 5, pp. 105–112]`
Se emplean los estereotipos estándar UML e ICONIX (Entity-Control-Boundary):
- **`«entity»`**: Modelos persistentes de dominio (`backendnode/models/*.js` en Sequelize: `User`, `Admin`, `Buyer`, `Seller`, `UserAddress`, `Category`, `Product`, `ProductCategory`, `Cart`, `CartItem`, `Order`, `OrderItem`, `OrderStatusHistory`, `AuditLog`).
- **`«control»`**: Servicios de negocio, middlewares y controladores (`backendnode/services/*.js`, `backendnode/controllers/*.js`, `backendnode/middlewares/*.js`; en `.NET`: `frontendnet/Services/*ClientService.cs`, `SessionTokenManager`, `DelegatingHandler`).
- **`«boundary»`**: Routers HTTP/REST (`backendnode/routes/*.js`), controladores MVC/vistas Razor (`frontendnet/Controllers/*Controller.cs`) y adaptadores hacia proveedores externos (`CloudinaryService`, `GmailService`).
- **`«dto»` / `«viewmodel»`**: Objetos de transferencia y modelos de vista (`frontendnet/Models/*.cs`).
- **`«enumeration»`**: Enumeraciones cerradas de dominio (`UserProfile`, `UserStatus`, `SellerStatus`, `OrderStatus`, `AuditOutcome`).

---

## 3. Diagramas de Secuencia

### 3.1 Lifelines y activación `[Seidl2015, Cap. 6, §§6.1–6.2; Rosenberg2007, Cap. 8, pp. 185–212]`
1. **Participantes (`participant`, `actor`, `boundary`, `control`, `entity`, `database`)**: Ordenados de izquierda a derecha siguiendo el flujo causal: Actor -> Frontera UI/HTTP -> Middleware/Controlador -> Servicio de Dominio -> Persistencia (`MySQL` / `Redis`) o Proveedor Externo `[Seidl2015, Cap. 6, §6.1, Fig. 6.1; Rosenberg2007, Cap. 8, Fig. 8-2, p. 191]`.
2. **Formato del encabezado de lifeline**: `nombreInstancia : Clase` o `:Clase` con su estereotipo (`«boundary»`, `«control»`, `«entity»`, `«database»`).
3. **Creación y destrucción**: Usar `create` cuando el flujo instancia un recurso o subproceso efímero (ej. worker de validación de imagen) y `destroy` (`!!`) al terminar su vida útil `[Seidl2015, Cap. 6, tema: mensajes de creación y destrucción de lifelines]`.
4. **Especificación de ejecución (barras de activación)**: Usar `activate` / `deactivate` (o `autoactivate on` controlado) únicamente durante el intervalo en que el participante posee el foco de control `[Seidl2015, Cap. 6, §6.2, Fig. 6.2]`.

### 3.2 Tipos de flechas y mensajes `[Seidl2015, Cap. 6, tema: tipos y notación de mensajes síncronos, asíncronos y de retorno]`
- **Llamada síncrona (`->`)**: Punta de flecha **rellena** (`solid arrowhead`). El emisor espera la respuesta (llamadas HTTP BFF -> API, consultas SQL/Redis, llamadas de controlador a servicio).
- **Mensaje de retorno (`-->`)**: Línea **punteada con punta abierta** (`dashed open arrowhead`). Obligatorio al devolver un resultado significativo o código de estado HTTP (`200 OK`, `201 Created`, `401 Unauthorized`, `409 Conflict`, `429 Too Many Requests`). No dibujar retornos vacíos redundantes cuando la llamada es un paso interno obvio `[Seidl2015, Cap. 6, tema: tipos y notación de mensajes síncronos, asíncronos y de retorno]`.
- **Mensaje asíncrono (`->>`)**: Línea sólida con **punta abierta** (`open arrowhead`). Reservado exclusivamente para operaciones reales sin bloqueo del emisor (ej. encolado en segundo plano de correo de recuperación o ciclo asíncrono de recuperación de imágenes huérfanas).
- **Autollamada (`->` sobre la misma lifeline)**: Para validaciones o transformaciones internas relevantes del mismo componente (ej. verificación criptográfica local de firma RS256 o cálculo de `scrypt`).
- **Consistencia con clases**: Todo mensaje enviado a una lifeline de clase debe corresponder a una operación real o endpoint verificable en el código (`BASELINE.md`) `[Rosenberg2007, Cap. 8, pp. 191–204 y Cap. 9, p. 238]`.

### 3.3 Fragmentos combinados (`alt`, `opt`, `loop`, `break`) `[Seidl2015, Cap. 6, §6.4, Tabla 6.1; Rosenberg2007, Apéndice A, pp. 401–402]`
- **`alt [condición] ... else [condición]`**: Ramas mutuamente excluyentes (ej. `[credenciales válidas y cuenta ACTIVE]` vs. `[cuenta bloqueada o umbral superado -> 429]` vs. `[credenciales inválidas -> DUMMY_HASH + 401]`) `[Seidl2015, Cap. 6, §6.4.1, Fig. 6.10]`.
- **`opt [condición]`**: Paso condicional sin rama `else` (ej. `[hash legado bcrypt detectado -> re-hash transparente a scrypt]`) `[Seidl2015, Cap. 6, §6.4.1, tema: fragmentos combinados de ramificación, bucle e interrupción]`.
- **`loop [min..max / condición]`**: Iteración acotada con guarda explícita (ej. `[por cada sellerId en ítems del carrito]`) `[Seidl2015, Cap. 6, §6.4.1, tema: fragmentos combinados de ramificación, bucle e interrupción]`.
- **`break [condición de aborto]`**: Interrupción inmediata del escenario ante fallo de guarda en middleware (ej. `[token JWT inválido, sesión revocada o cuota excedida]`) `[Seidl2015, Cap. 6, §6.4.1, tema: fragmentos combinados de ramificación, bucle e interrupción]`.
- **Nivel máximo de anidamiento**: **2 niveles** de fragmentos combinados por diagrama. Si un flujo requiere mayor profundidad, debe extraerse a un diagrama separado o referenciarse con `ref over` (`Interaction Use`).

---

## 4. Diagramas de Componentes

### 4.1 Notación UML 2.x `[Seidl2015, Cap. 2, §2.3.1, p. 18; Rosenberg2007, Cap. 7, pp. 173–175 y Apéndice A, pp. 397–398, 406]`
- Usar notación de componentes **UML 2.x** (`skinparam componentStyle uml2`): rectángulo con el estereotipo `«component»` y/o el ícono de componente en la esquina superior derecha `[Rosenberg2007, Apéndice A, Fig. A-12, p. 406]`.
- **Interfaces provistas y requeridas (notación *ball-and-socket*)** `[Rosenberg2007, Apéndice A, Fig. A-2 y Fig. A-3, pp. 397–398]`:
  - **Interfaz provista (*lollipop* `()`)**: Círculo sólido unido al componente que publica el contrato (ej. `REST API /api/* (JSON / Multipart)`, `MySQL Wire Protocol 3306`, `RESP TLS 6380`).
  - **Interfaz requerida (*socket* `(`)**: Semicírculo conectado desde el componente consumidor hacia la interfaz provista.
- **Dependencias (`..>`)**: Flecha punteada abierta cuando se modela dependencia directa entre subsistemas internos dentro de un mismo proceso (`Routes ..> Middlewares ..> Controllers ..> Services ..> Models`).
- **Separación de vistas**: El diagrama de componentes modela la **arquitectura lógica de software, sus módulos y contratos**, sin mezclar puertos de host, direcciones IP ni topología física de contenedores (que pertenecen al diagrama de despliegue) `[Rosenberg2007, Cap. 7, pp. 173–175]`.

---

## 5. Diagramas de Despliegue

### 5.1 Nodos, entornos de ejecución, artefactos y enlaces `[Seidl2015, Cap. 2, §2.3.1, p. 18; Rosenberg2007, Cap. 7, pp. 173–177 y Apéndice A, p. 407]`
- **Nodo (`node`)**: Caja tridimensional que representa infraestructura física, host o contenedor aislado (`«device»`, `«container»`) `[Rosenberg2007, Apéndice A, Fig. A-13, p. 407]`.
- **Entorno de ejecución (`«executionEnvironment»`)**: Subnodo de runtime dentro de un nodo (ej. `Node.js 24 LTS Runtime (node:24-alpine, USER node)`, `ASP.NET Core 9.0 Kestrel Runtime (net9.0)`, `MySQL Server 8.4`, `Redis 7.4 TLS`).
- **Artefacto (`artifact`, `«artifact»`)**: Unidad física desplegada dentro de un entorno de ejecución (ej. `backendnode app`, `frontendnet.dll`, `users.acl`, certificados mTLS `/tls/*.crt` y secretos `/run/secrets/*`).
- **Enlaces de comunicación (`--`)**: Líneas entre nodos rotuladas obligatoriamente con el **estereotipo de protocolo, puerto y mecanismo de seguridad verificable** (ej. `«HTTPS / REST JSON :3000»`, `«mTLS RESP :6380 (tls-auth-clients yes)»`, `«TCP MySQL :3306 / host 127.0.0.1:3309 (caching_sha2_password)»`, `«HTTPS API (Cloudinary / Gmail OAuth2)»`) `[Rosenberg2007, Cap. 7, tema: separación entre modelo de paquetes/componentes y arquitectura de despliegue]`.
- **Fidelidad a la línea base**: Solo se representan nodos y parámetros verificables en `Dockerfile`, `compose.yaml` y `Program.cs` (o se marca como `PENDIENTE` / `NO_VERIFICABLE` cualquier infraestructura productiva externa no definida en el repositorio).

---

## 6. Diagramas de Modelo de Datos (Conceptual y Lógico/Físico)

El proyecto no utiliza notación Chen (elipses para atributos y rombos para relaciones). Siguiendo el enfoque UML de `[Seidl2015, Cap. 4, §4.10, pp. 80–81; Rosenberg2007, Cap. 10, pp. 263–264, Fig. 10-1]`, el modelo de datos se divide en dos vistas complementarias usando notación de clases/entidades UML con multiplicidades y estereotipos de base de datos:

1. **Modelo Conceptual de Dominio (`der_conceptual_*.puml`)**:
   - Modela las **14 entidades del dominio** como clases UML con estereotipo `«entity»`, mostrando únicamente atributos conceptuales de negocio (sin llaves foráneas artificiales ni tipos físicos de motor SQL) y asociaciones con multiplicidades exactas (`1`, `0..1`, `1..*`, `0..*`), composiciones (`*--`) y agregaciones (`o--`).
2. **Modelo Lógico / Físico Relacional (`der_logico_*.puml`)** `[Rosenberg2007, Cap. 10, Fig. 10-1, p. 264]`:
   - Modela las **14 tablas físicas** del esquema final MySQL 8.4 (`migrations/20260409000100-rebuild-secure-ecommerce-schema.js` y `20260418000100-expand-product-price-precision.js`) como clases/entidades con estereotipo `«table»` y sus **nombres reales en inglés** (`users`, `admins`, `buyers`, `sellers`, `user_addresses`, `categories`, `products`, `product_categories`, `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`, `audit_logs`).
   - Cada columna indica obligatoriedad (`*` para `NOT NULL`), tipo físico (`CHAR(36)`, `BIGINT UNSIGNED`, `VARCHAR(255)`, `DECIMAL(12,2)`, `ENUM(...)`, `JSON`, `DATETIME`) y estereotipos de restricción: `«PK»`, `«FK»`, `«UK»` (o `«UNIQUE»`) e `«IDX»`.

---

## 7. Convenciones Transversales del Proyecto

### 7.1 Idioma
- **Títulos, notas explicativas, nombres de casos de uso, actores y etiquetas de flujo**: en **español** técnico claro.
- **Identificadores de código, nombres de clases, métodos, rutas HTTP, tablas, columnas SQL, claims JWT y estados `ENUM`**: exactamente en su **idioma real en el código fuente** (inglés en `backendnode` y en el esquema MySQL; nombres reales de clases C# en `frontendnet`, ej. `ProductosController`, `SessionTokenManager`). **Prohibido** traducir tablas o modelos del backend a español (`usuarios`, `pedidos`, `archivos`).

### 7.2 Tipografía y Paleta Sobria (`_skin.puml`)
- Todos los diagramas deben incluir en su cabecera `!include _skin.puml`.
- **Fuente principal**: Sans-serif limpia multiplataforma (`Segoe UI`, con fallback a `Inter`, `Liberation Sans`, `Arial`, `sans-serif`) y monoespaciada (`Cascadia Mono`, `Consolas`, `monospace`) para firmas técnicas, rutas HTTP y tipos SQL.
- **Paleta sobria de alto contraste (máximo 5 tonos semánticos sobre fondo blanco `#FFFFFF`)**:
  1. **Neutro / Entidades y Clases estándar**: Relleno `#F8FAFC`, borde `#334155`, texto `#0F172A`.
  2. **Frontera / UI / HTTP (`«boundary»`)**: Relleno `#EFF6FF`, borde `#1D4ED8`.
  3. **Control / Servicios / Seguridad (`«control»`)**: Relleno `#F0FDF4`, borde `#15803D`.
  4. **Datos / Persistencia (`«entity»`, `«table»`, `«database»`)**: Relleno `#FEFCE8`, borde `#A16207`.
  5. **Sistemas Externos / Alertas (`«external»`, `«threat»`)**: Relleno `#FEF2F2`, borde `#B91C1C`.

### 7.3 Leyenda y Encabezado de Trazabilidad
Todo archivo `.puml` debe contener:
1. Un bloque de comentarios inicial (`' ...`) con: propósito del diagrama, archivos fuente de `backendnode`/`frontendnet` que lo respaldan y referencia a `docs/BASELINE.md`.
2. Un `title` y `caption` o `legend right` sobrio cuando el diagrama utilice estereotipos o colores semánticos.

### 7.4 Presupuesto de Complejidad Visual y Regla de División `[Seidl2015, Cap. 9, §9.1]`
Para garantizar legibilidad inmediata en páginas A4/Carta y pantallas sin cruce caótico de líneas, ningún diagrama individual podrá exceder los siguientes límites:

| Tipo de Diagrama | Límite Máximo por Archivo `.puml` | Regla Obligatoria de División si se Supera el Límite |
|---|---|---|
| **Casos de Uso** | **14 casos de uso** y **5 actores** | Dividir por actor / contexto funcional (`uc_comprador.puml`, `uc_vendedor.puml`, `uc_administrador.puml`). |
| **Clases** | **15 clases/interfaces** y **6 atributos + 6 operaciones visibles** por clase | Dividir por contexto acotado (`identidad y sesión`, `catálogo e imágenes`, `carrito, pedidos y auditoría`) o por capa (`backendnode` vs. `frontendnet`), mostrando en cada vista solo los miembros relevantes al contexto `[Seidl2015, Cap. 9, §9.1]`. |
| **Secuencia** | **7 lifelines**, **16 mensajes** y **2 niveles** de fragmentos anidados (`alt`/`opt`/`loop`/`break`) | Dividir por caso de uso o subflujo y vincular con un bloque de referencia `ref over` `[Seidl2015, Cap. 6, §6.5.1, tema: referencias de interacción ref]`. |
| **Componentes** | **14 componentes** y **4 paquetes/contenedores** | Separar vista global del sistema y vista interna detallada del subsistema si excede el tope. |
| **Despliegue** | **8 nodos/contenedores** y **12 artefactos** | Separar topología de contenedores de ejecución respecto de flujos auxiliares. |
| **Modelo de Datos (Conceptual / Lógico)** | **15 entidades/tablas** por diagrama | Si las relaciones o columnas comprometen la legibilidad, dividir por contexto de dominio (`Identidad + Catálogo` vs. `Carrito + Pedidos + Auditoría`) manteniendo las referencias de llave foránea (`«FK»`). |
