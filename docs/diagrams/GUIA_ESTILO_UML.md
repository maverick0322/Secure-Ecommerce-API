# Guía de Estilo UML y Convenciones de Diagramación (`GUIA_ESTILO_UML.md`)

Esta guía establece las reglas formales de modelado UML 2.x y las convenciones visuales obligatorias para todos los diagramas del proyecto (`backendnode/docs/diagrams/*.puml`).

Todas las reglas sintácticas y semánticas han sido redactadas a partir de los dos libros de referencia del proyecto ubicados en `/ecommerce/libros`:

1. **Seidl, M., Scholz, M., Huemer, C., & Kappel, G. (2015).** *UML @ Classroom: An Introduction to Object-Oriented Modeling*. Springer. (Citado como **`[Seidl2015]`**).
2. **Rosenberg, D., & Stephens, M. (2007).** *Use Case Driven Object Modeling with UML: Theory and Practice*. Apress. (Citado como **`[Rosenberg2007]`**).

---

## 1. Diagramas y Especificación Textual de Casos de Uso

### 1.1 Nombres, Frontera del Sistema y Actores (`[Seidl2015, Cap. 3, §§3.1–3.4]`, `[Rosenberg2007, Cap. 3, pp. 49–61]`)

- **Nombres de casos de uso:** Deben expresarse como una frase verbal activa en infinitivo o sustantivo de acción seguida del objeto de negocio (`Verbo + Objeto`, p. ej., *Confirmar pedido*, *Moderar solicitud de vendedor*, *Renovar sesión*). El nombre debe reflejar una meta con valor observable para el actor que la inicia, nunca una operación técnica interna ni un paso aislado de interfaz (`[Seidl2015, §3.1 y §3.7.1]`).
- **Frontera del sistema (*System Boundary*):** Todo diagrama de casos de uso debe encerrar las elipses dentro de un rectángulo claramente rotulado con el nombre del sistema o subsistema (p. ej., `Sistema de Comercio Electrónico Seguro`). Nada que pertenezca al software modelado puede quedar fuera del rectángulo, y ningún actor puede ubicarse dentro de él (`[Seidl2015, §3.1 y §3.7.3 Error 2]`).
- **Actores:**
  - Representan **roles externos** (usuarios humanos, otros sistemas o dispositivos/temporizadores) que interactúan directamente con el sistema intercambiando información (`[Seidl2015, §3.2]`).
  - **Prohibición de actores internos:** Un componente interno del propio sistema (como una base de datos propia, un middleware o una tarea interna en memoria) **jamás** se modela como actor. Solo servicios externos autónomos fuera del control del sistema (p. ej., *Cloudinary API*, *Gmail OAuth2 API*, *Cloudflare Turnstile*) pueden modelarse como actores secundarios no humanos (`[Seidl2015, §3.2]`).
  - **Notación:** Los actores humanos se representan como *stick figures* y los sistemas externos con el estereotipo `«actor»` o `«external»` en notación rectangular para distinguirlos visualmente (`[Seidl2015, §3.2, Fig. 3.3]`).
  - **Asociaciones actor–caso de uso:** Se trazan con línea continua sin punta de flecha; indican participación en la comunicación bidireccional del caso de uso (`[Seidl2015, §3.3]`).

### 1.2 Relaciones `«include»`, `«extend»` y Generalización (`[Seidl2015, Cap. 3, §§3.4–3.5 y §3.7.3]`, `[Rosenberg2007, Cap. 3, pp. 56–60]`)

- **`«include»` (inclusión obligatoria):**
  - Se dibuja como una flecha punteada con punta abierta (`..>`) **desde el caso de uso base hacia el caso de uso incluido** (`[Seidl2015, §3.5.1, Fig. 3.8]`).
  - Semántica: El comportamiento del caso incluido se ejecuta **siempre** como parte indispensable del caso base (equivalente a una subrutina compartida). Úsese únicamente cuando un fragmento conductual significativo es reutilizado por dos o más casos de uso o cuando aislarlo simplifica un caso complejo sin caer en descomposición funcional (`[Rosenberg2007, Cap. 3, p. 57]`).
- **`«extend»` (extensión condicional):**
  - Se dibuja como una flecha punteada con punta abierta (`..>`) **desde el caso de uso extensor hacia el caso de uso base** (`[Seidl2015, §3.5.2, Fig. 3.9]`).
  - Semántica: El caso base es completo por sí mismo; el caso extensor inserta comportamiento adicional de manera opcional solo si se cumple una condición explícita en un punto de extensión (*extension point*) definido dentro del caso base (`[Seidl2015, §3.5.2]`). Si se usa `«extend»`, debe documentarse la condición (`Condition: {...}`) y el punto de extensión.
- **Generalización de actores y de casos de uso:**
  - Se dibuja con línea continua y punta triangular hueca (`--|>`) desde el elemento especializado hacia el elemento general (`[Seidl2015, §3.4 y §3.5.3]`).
  - Cuando dos o más actores pueden ejecutar exactamente el mismo caso de uso de manera independiente (p. ej., *Comprador*, *Vendedor* y *Administrador* pueden *Cerrar sesión*), no se deben trazar múltiples líneas al mismo caso si ello sugiere que se requieren todos simultáneamente; en su lugar, se define un actor general abstracto (p. ej., *Usuario Autenticado*) del cual heredan los roles específicos (`[Seidl2015, §3.4, Fig. 3.6 y §3.7.3 Error 5]`).
- **Errores prohibidos (`[Seidl2015, §3.7.3, Errores 1–6]`, `[Rosenberg2007, Cap. 3, pp. 58–60]`):**
  1. **No modelar flujos de trabajo ni orden cronológico:** Los casos de uso no son diagramas de flujo ni máquinas de estados; nunca se encadenan con `«include»` o `«extend»` para expresar que uno ocurre "después" de otro.
  2. **No usar *Iniciar sesión* como `«include»` de cada operación protegida:** Haber iniciado sesión es una **precondición** de los casos de uso protegidos, no un caso de uso incluido en cada acción (`[Seidl2015, §3.7.3 Error 4, Fig. 3.21]`).
  3. **No caer en descomposición funcional ni micro-CRUD:** Acciones triviales de interfaz (*Pulsar botón*, *Ingresar datos*) no son casos de uso (`[Seidl2015, §3.7.3 Error 4 y Error 6]`).

### 1.3 Especificación del TEXTO del Caso de Uso: Curso Básico y Cursos Alternos (`[Seidl2015, §3.7.2, Tabla 3.1]`, `[Rosenberg2007, Cap. 3, pp. 61–81 y Cap. 4, pp. 86–94]`)

Todo caso de uso documentado en AsciiDoc debe incluir su ficha textual estructurada con los siguientes campos obligatorios:

1. **Encabezado estructurado (`[Seidl2015, §3.7.2, Tabla 3.1]`):** Identificador (`CU-XX`), Nombre, Actor(es) primario(s) y secundario(s), Precondiciones, Disparador (*Trigger*), Postcondición de éxito y Postcondición/Garantía mínima ante fallo.
2. **Curso Básico (*Basic Course / Sunny-Day Scenario*) (`[Rosenberg2007, Cap. 3, pp. 62–68]`):**
   - Secuencia numerada (`1, 2, 3...`) redactada en **voz activa y tiempo presente** (*"El Comprador selecciona..."*, *"El Sistema valida..."*).
   - Debe describir **ambos lados del diálogo** usuario–sistema (acción del actor y respuesta/validación del sistema), referenciando por su nombre exacto los objetos del modelo de dominio y las vistas o endpoints de frontera (`[Rosenberg2007, Cap. 3, Fig. 3-2, pp. 63–66]`).
   - Debe mantenerse conciso (regla de los dos párrafos / ~4 a 10 pasos claros) y libre de fórmulas algorítmicas de bajo nivel o SQL (`[Rosenberg2007, Cap. 3, Tabla 3-2, p. 77]`).
3. **Cursos Alternos (*Alternate Courses / Rainy-Day Scenarios*) (`[Rosenberg2007, Cap. 3, pp. 68–73]`, `[Seidl2015, §3.7.2]`):**
   - Se numeran ramificándose desde el paso exacto del curso básico donde ocurre la condición divergente (p. ej., `3a`, `3b`, `5a`).
   - Todo caso de uso de seguridad o negocio **debe** especificar sus cursos alternos y de error: credenciales inválidas, bloqueo por límite de intentos (*rate-limit* `429`), cuenta suspendida o pendiente de aprobación (`403`), token expirado o revocado (`401`), stock insuficiente o conflicto de estado (`409`), fallo de validación de entrada (`400`) o indisponibilidad de dependencia crítica (`503`).
   - Cada curso alterno debe indicar explícitamente qué registra el sistema (auditoría), qué mensaje o código devuelve al actor y en qué estado queda el sistema.

---

## 2. Diagramas de Clases

### 2.1 Compartimentos, Visibilidad y Tipos (`[Seidl2015, Cap. 4, §§4.2.1–4.2.6]`, `[Rosenberg2007, Cap. 2 y Cap. 8]`)

- **Nomenclatura:** Los nombres de clases e interfaces se escriben en `PascalCase` y en **singular** (`User`, `Order`, `SessionTokenManager`), nunca en plural (`[Seidl2015, §4.2.1]`, `[Rosenberg2007, Cap. 2, p. 31]`).
- **Visibilidad obligatoria (`[Seidl2015, §4.2.5, Tabla 4.1]`):** Todo atributo y operación en un diagrama de clases de diseño debe llevar su marcador de visibilidad explícito:
  - `+` Público (*public*)
  - `-` Privado (*private*)
  - `#` Protegido (*protected*)
  - `~` Paquete / Interno (*package / internal*)
- **Formato de atributos (`[Seidl2015, §4.2.2]`):**
  `visibilidad [/] nombre : Tipo [multiplicidad] [= valorPorDefecto] {propiedades}`
  *(Ejemplo: `- credentialVersion : int = 0`, `+ [/] normalizedName : string {readOnly}`).*
- **Formato de operaciones (`[Seidl2015, §4.2.3]`):**
  `visibilidad nombre(param1 : Tipo1, param2 : Tipo2) : TipoRetorno`
  *(Ejemplo: `+ rotateRefreshToken(rawToken : string, ipAddress : string) : Promise<SessionResult>`).*
- **Miembros estáticos y abstractos (`[Seidl2015, §4.2.6 y §4.6.1]`):** Los atributos o métodos de clase (`static`) se subrayan (`{static}` en PlantUML); las clases u operaciones abstractas se escriben en cursiva o con `{abstract}`.

### 2.2 Asociaciones, Multiplicidades, Nombres de Rol y Agregación/Composición (`[Seidl2015, Cap. 4, §§4.3–4.8]`, `[Rosenberg2007, Cap. 2, pp. 32–38 y Cap. 8, p. 214]`)

- **Prohibición de relaciones como métodos internos:** Las asociaciones entre clases (`1:1`, `1:N`, `N:M`) **jamás** se escriben como métodos `hasMany()` o `belongsTo()` dentro del compartimento de operaciones de la clase; deben trazarse como líneas de asociación UML entre las cajas de clase (`[Seidl2015, §4.3]`).
- **Multiplicidades y nombres de rol (`[Seidl2015, §4.3.1]`, `[Rosenberg2007, Cap. 8, p. 214]`):**
  - Toda asociación binaria debe especificar la **multiplicidad** en ambos extremos (`1`, `0..1`, `0..*`, `1..*`). Omitir la multiplicidad deja el modelo incompleto (`[Rosenberg2007, p. 214]`).
  - Cuando existan múltiples asociaciones entre las mismas clases o el papel semántico no sea obvio (p. ej., `User` asociado a `Order` como comprador `buyer` y como vendedor `seller`, o como `changedByUser` en `OrderStatusHistory`), es obligatorio rotular el **nombre de rol** en el extremo correspondiente (`+buyer`, `+seller`, `+actor`).
- **Asociación simple vs. Agregación vs. Composición (`[Seidl2015, §4.5, Fig. 4.19–4.21]`, `[Rosenberg2007, Cap. 2, p. 33]`):**
  - **Asociación (`--` o `-->`):** Relación estructural entre objetos independientes. Si es navegable en un solo sentido, se usa punta de flecha abierta (`-->`).
  - **Agregación compartida (`o--`, rombo hueco en el todo):** Relación parte–todo débil (*has-a*) donde la parte puede existir independientemente del todo o ser compartida.
  - **Composición (`*--`, rombo relleno en el todo):** Relación parte–todo fuerte con **dependencia de existencia** y pertenencia exclusiva (la multiplicidad en el extremo del todo es siempre `1` o `0..1`; si se destruye el contenedor, se destruyen sus partes, p. ej., `Order *-- "1..*" OrderItem` o `Cart *-- "0..*" CartItem`).
- **Generalización y Realización (`[Seidl2015, §§4.6–4.7]`):**
  - Herencia entre clases (`is-a`): línea sólida con triángulo hueco (`--|>`), p. ej., `AddressesController --|> AppController`.
  - Implementación de interfaz: línea punteada con triángulo hueco (`..|>`), p. ej., `SessionTokenManager ..|> ISessionTokenManager`.
- **Clases de asociación (`[Seidl2015, §4.4, Fig. 4.15]`):** Cuando una relación `N:M` posee atributos propios (o representa una entidad de enlace con marcas de tiempo), puede modelarse mediante una clase de asociación conectada con línea punteada o descomponerse explícitamente en dos asociaciones `1` a `0..*` hacia la clase intermedia (`ProductCategory`).

### 2.3 Estereotipos de Clase (`[Seidl2015, §4.8 y §9.3]`, `[Rosenberg2007, Cap. 5, pp. 105–112]`)

Se adoptan los estereotipos estándar de análisis y diseño orientado a objetos:
- `«boundary»`: Clases de frontera que reciben peticiones externas o presentan interfaz (`Controller`, `Route`, `ViewModel`, `Middleware`).
- `«control»`: Clases de coordinación, lógica de negocio, validación o clientes HTTP (`Service`, `DelegatingHandler`, `Validator`).
- `«entity»`: Objetos persistentes del dominio o modelos ORM (`Model`).
- `«interface»`, `«enumeration»`, `«datatype»`, `«exception»`: Tipos estructurales del lenguaje.

---

## 3. Diagramas de Secuencia

### 3.1 Líneas de Vida, Activaciones y Mensajes (`[Seidl2015, Cap. 6, §§6.1–6.3]`, `[Rosenberg2007, Cap. 8, pp. 185–212]`)

- **Líneas de vida (*Lifelines*) (`[Seidl2015, §6.1]`):**
  - El encabezado de cada participante debe escribirse con la notación `rol : Clase` o `: Clase` usando el **nombre real del módulo, servicio, controlador o middleware en el código** (p. ej., `:AuthController`, `:RefreshTokenDelegatingHandler`, `:auth-session.service`).
  - El actor iniciador se coloca en el extremo izquierdo, seguido de los objetos de frontera (`«boundary»`), luego los controladores/servicios (`«control»`) y finalmente las entidades o almacenes (`«entity»` / base de datos / Redis) (`[Rosenberg2007, Cap. 8, Fig. 8-2, p. 190]`).
- **Barras de activación (*Execution Specifications*) (`[Seidl2015, §6.2]`):**
  - Todo participante que recibe un mensaje síncrono y ejecuta lógica debe mostrar su barra de activación (`activate` / `deactivate` en PlantUML) durante el intervalo exacto en que mantiene el control o espera una respuesta síncrona.
- **Tipos de mensajes y retornos (`[Seidl2015, §6.2, Tabla 6.1]`):**
  - **Mensaje síncrono (`->`):** Línea sólida con punta de flecha rellena. El emisor espera la respuesta.
  - **Mensaje de retorno (`-->`):** Línea punteada con punta de flecha abierta. Debe incluirse siempre que el llamado devuelva un valor relevante, un estado HTTP o una excepción mapeada (`[Seidl2015, §6.2, Fig. 6.4]`).
  - **Mensaje asíncrono (`->>`):** Línea sólida con punta abierta, reservado para operaciones que no bloquean al emisor (p. ej., ciclos de recuperación en segundo plano).
  - **Creación y destrucción (`[Seidl2015, §6.2, Fig. 6.6]`):** La creación dinámica usa `create` apuntando al encabezado de la línea de vida; la destrucción o invalidación explícita de un recurso temporal se marca con `destroy` (`X`).
- **Trazabilidad con el código y el diagrama de clases (`[Rosenberg2007, Cap. 8, pp. 191–204 y Cap. 9, p. 238]`):**
  - Todo mensaje enviado hacia una línea de vida de software debe corresponder a una **operación real existente en el código** (método de clase, función exportada o endpoint HTTP real con su verbo y ruta exacta). Queda prohibido inventar nombres de funciones o rutas que no existan en `backendnode/` o `frontendnet/`.

### 3.2 Fragmentos Combinados (`alt`, `opt`, `loop`, `break`) (`[Seidl2015, Cap. 6, §6.4]`, `[Rosenberg2007, Apéndice A, pp. 401–402]`)

- **`alt` (alternativas mutuamente excluyentes):** Obligatorio para modelar bifurcaciones entre el curso básico y los cursos alternos (p. ej., `[credenciales válidas]` vs. `[else: credenciales inválidas -> 401 / bloqueo 429]`, o `[refresh exitoso 200]` vs. `[401/403 definitivo -> SignOut]` vs. `[429/5xx transitorio -> conservar sesión]`). Cada operando se separa con línea horizontal punteada (`else`) y lleva su guarda entre corchetes `[condición]` (`[Seidl2015, §6.4.1, Fig. 6.10]`).
- **`opt` (opcional):** Marco de un solo operando que solo se ejecuta si su guarda `[condición]` es verdadera (`[Seidl2015, §6.4.2]`).
- **`loop` (iteración):** Marco con operador `loop` y guarda `[condición de continuación]` o límites `(min, max)` (`[Seidl2015, §6.4.3]`).
- **`break` (interrupción temprana):** Marco con guarda `[condición de aborto]` cuyo contenido se ejecuta y **termina inmediatamente** el resto de la interacción envolvente (ideal para rechazos tempranos de middleware como `401 Unauthorized` o `429 Too Many Requests`) (`[Seidl2015, §6.4.4, Fig. 6.13]`).

---

## 4. Diagramas de Componentes

### 4.1 Componentes, Interfaces Provistas y Requeridas (`[Seidl2015, Cap. 2, §2.3.1, p. 18]`, `[Rosenberg2007, Cap. 7, pp. 173–175 y Apéndice A, pp. 397–398, 406]`)

- **Separación respecto al despliegue (`[Rosenberg2007, Cap. 7, pp. 173–177]`):** El diagrama de componentes modela la **arquitectura modular de software** (subsistemas, capas, bibliotecas y contratos entre módulos), no las máquinas físicas ni contenedores Docker (que pertenecen al diagrama de despliegue).
- **Notación de componente (`[Rosenberg2007, Apéndice A, Fig. A-12, p. 406]`):** Rectángulo con el estereotipo `«component»` o el ícono UML de componente en la esquina superior derecha, agrupado por paquetes o capas lógicas (Presentación/MVC, Pipeline HTTP, Capa de Aplicación/Servicios, Persistencia/Datos).
- **Interfaces provistas (*Provided Interfaces* — notación *Lollipop*):** Círculo sólido conectado al componente por una línea continua (`() "NombreInterfaz" -- [Componente]`), que indica el contrato o API que dicho componente expone hacia otros módulos (`[Rosenberg2007, Apéndice A, Fig. A-2, p. 397]`).
- **Interfaces requeridas (*Required Interfaces* — notación *Socket*):** Semicírculo abierto o dependencia estereotipada hacia la interfaz provista de otro componente (`[ComponenteA] ..> () "NombreInterfaz"` o conector *ball-and-socket* `-(0-`), que expresa qué contrato externo necesita el componente para funcionar (`[Rosenberg2007, Apéndice A, Fig. A-2 y A-12]`).
- **Puertos (`[Rosenberg2007, Apéndice A, Fig. A-3, p. 398]`):** Cuando un subsistema expone puntos de entrada diferenciados en su frontera (p. ej., API REST `/api/*`), se indican los puntos de interacción y el protocolo o contrato asociado.

---

## 5. Diagramas de Despliegue

### 5.1 Nodos, Entornos de Ejecución, Artefactos, Protocolos y Puertos (`[Seidl2015, Cap. 2, §2.3.1, p. 18]`, `[Rosenberg2007, Cap. 7, Fig. 7-9, p. 176 y Apéndice A, Fig. A-13, p. 407]`)

- **Nodos (*Nodes*):** Cajas tridimensionales (`node` en PlantUML) que representan recursos computacionales en tiempo de ejecución (`[Rosenberg2007, Apéndice A, p. 407]`):
  - `«device»`: Host físico, servidor o estación cliente.
  - `«executionEnvironment»` / `«container»`: Entorno de ejecución o contenedor de sistema operativo/runtime (p. ej., contenedor `ecommerce_api` con `node:24-alpine` / `node:20-alpine`, contenedor `ecommerce_db` con `mysql:8.4` / `mysql:8.0`, contenedor `redis:8.2`, host `.NET 9.0 Kestrel`).
- **Artefactos (*Artifacts*):** Elementos físicos desplegados dentro de los nodos (`artifact` con estereotipo `«artifact»`, `«secret»` o `«volume»`), tales como binarios/ensamblados (`FrontendNet.dll`), punto de entrada (`index.js`), archivos de configuración (`redis.conf`) y secretos montados en `/run/secrets/*` (`[Rosenberg2007, Apéndice A, Fig. A-13]`).
- **Enlaces de comunicación, protocolos y puertos (`[Rosenberg2007, Apéndice A, p. 407]`):**
  - Toda línea que conecte dos nodos debe rotularse con un estereotipo de protocolo (`«HTTPS»`, `«HTTP/REST»`, `«MySQL/TCP»`, `«RESP3/TLS 1.3»`) y especificar explícitamente el **puerto de red y dirección de enlace** verificados en el código (`127.0.0.1:3000`, `3306` / `127.0.0.1:3307`, `6379` / `127.0.0.1:6380`).
  - Las redes aisladas de contenedores (como `app_edge` y `backend_internal` / `redis_private`) deben delimitarse mediante paquetes o marcos de red con su propiedad de aislamiento (`internal: true`, `host_binding_ipv4: 127.0.0.1`).

---

## 6. Diagramas Entidad-Relación (Conceptual y Lógico/Físico)

### 6.1 Distinción entre Modelo Conceptual y Esquema Lógico/Físico (`[Seidl2015, Cap. 4, §4.10, pp. 80–81]`, `[Rosenberg2007, Cap. 2, pp. 31–36 y Cap. 10, pp. 263–264, Fig. 10-1]`)

- **Diagrama Conceptual / Dominio (`der_conceptual.puml`):**
  - Muestra las **14 entidades del dominio** y sus relaciones semánticas con cardinalidades exactas (`1`, `0..1`, `0..*`, `1..*`) y atributos de negocio esenciales, sin tipos físicos de motor SQL ni detalles de índices internos (`[Rosenberg2007, Cap. 2, pp. 31–36]`).
  - Las relaciones de especialización 1:1 (`User` -> `Admin`, `Buyer`, `Seller`) deben reflejar con claridad la partición por perfil.
- **Diagrama Lógico / Físico Relacional (`der_logico.puml`):**
  - Representa fielmente las **14 tablas físicas** del esquema MySQL (`«table»`), con el nombre exacto de tabla en `snake_case` (`users`, `admins`, `buyers`, `sellers`, `user_addresses`, `categories`, `products`, `product_categories`, `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`, `audit_logs`) (`[Rosenberg2007, Cap. 10, Fig. 10-1, p. 264]`).
  - Cada tabla debe separar la llave primaria (`PK`) encima del divisor horizontal (`--`) y listar debajo las columnas con sus tipos SQL reales (`CHAR(36)`, `VARCHAR(120)`, `DECIMAL(10,2)`, `DATETIME(3)`, `JSON`, `TINYINT(1)`), restricciones de nulidad (`NOT NULL` / `NULL`), llaves foráneas (`FK`), índices únicos (`UQ`) y columnas generadas (`GENERATED STORED`).
  - Las líneas de relación utilizan notación *Crow's Foot* (`||--o{`, `||--|{`, `||--||`, `}o--||`) indicando la política de integridad referencial (`ON DELETE RESTRICT` / `CASCADE` / `SET NULL`) verificada en las migraciones.

---

## 7. Convenciones Específicas del Proyecto

### 7.1 Idioma de los Nombres y Etiquetas

1. **Identificadores de código, tablas, columnas, rutas HTTP, clases, métodos y variables de entorno:** Se escriben **exactamente en inglés** tal como existen en el código fuente (`users`, `order_status_history`, `POST /api/auth/refresh`, `RefreshTokenDelegatingHandler`, `SessionTokenManager`, `catalog.service.js`). Queda estrictamente prohibido traducir nombres de tablas o clases al español (como `Usuario`, `Producto`, `Archivo` o `Bitacora`), ya que la migración `20261108000001-normalize-english-schema.js` estandarizó todo el esquema y contrato en inglés.
2. **Títulos de diagramas, nombres de casos de uso, actores, notas explicativas, guardas de negocio y leyendas:** Se redactan en **español técnico claro y conciso** (p. ej., `Comprador`, `[stock disponible y vendedor activo]`, `«Flujo de renovación silenciosa»`).

### 7.2 Distinción Visual y Semántica entre Frontend y Backend

Todo diagrama en el que participen elementos de ambos repositorios (o que represente uno de ellos) debe distinguirlos mediante:
1. **Prefijo de paquete o contenedor explícito:** `Frontend (.NET 9 MVC)` vs. `Backend (Node.js / Express API)`.
2. **Estereotipos dedicados definidos en `_skin.puml`:**
   - `«frontend»`: Componentes, controladores, vistas Razor, handlers o modelos de `frontendnet/` (paleta azul índigo suave `#EEF2FF`, borde `#3730A3`).
   - `«backend»`: Rutas, controladores, middlewares, servicios o modelos de `backendnode/` (paleta verde esmeralda suave `#ECFDF5`, borde `#065F46`).
   - `«database»`: Tablas o nodos MySQL (paleta ámbar suave `#FFFBEB`, borde `#92400E`).
   - `«cache»`: Nodos o estructuras Redis (paleta roja/coral suave `#FEF2F2`, borde `#991B1B`).
   - `«security»`: Controles criptográficos, tokens RS256, secretos o políticas de bloqueo (paleta violeta suave `#F5F3FF`, borde `#5B21B6`).
   - `«external»`: Servicios de terceros en la nube como Cloudinary, Gmail OAuth2 o Cloudflare Turnstile (paleta gris pizarra `#F1F5F9`, borde punteado `#475569`).

### 7.3 Paleta de Colores y Uso Obligatorio de `_skin.puml`

- Todos los archivos `.puml` del directorio `backendnode/docs/diagrams/` deben incluir en su encabezado (inmediatamente después de `@startuml`) la directiva:
  ```plantuml
  !include _skin.puml
  ```
- No se permite redefinir colores arbitrarios ni fuentes inline en diagramas individuales salvo para resaltar un estado de error puntual, garantizando uniformidad tipográfica y alto contraste (WCAG AA) tanto en salida HTML como en PDF impreso.

### 7.4 Límite Máximo de Elementos por Diagrama y Regla de División (`[Seidl2015, Cap. 9, §9.1]`, `[Rosenberg2007, Cap. 7, p. 177]`)

Para garantizar que todo diagrama sea legible al 100 % del ancho de página sin requerir zoom excesivo:

| Tipo de Diagrama | Límite Máximo por Archivo `.puml` | Regla de División Obligatoria si se Supera el Límite |
| :--- | :--- | :--- |
| **Casos de Uso** | Máximo **14 casos de uso** y **5 actores** por diagrama | Dividir por subsistema o actor principal (`uc_comprador.puml`, `uc_vendedor_admin.puml`) agrupando en paquetes funcionales (`[Seidl2015, §9.1]`). |
| **Clases / DER** | Máximo **15 clases o tablas** por diagrama; máximo **12 atributos/operaciones visibles** por caja | Si un subsistema supera 15 clases, dividir por paquete arquitectónico o contexto delimitado (*Identidad y Sesiones*, *Catálogo*, *Carrito y Pedidos*), omitiendo getters/setters triviales. |
| **Secuencia** | Máximo **7 líneas de vida** (*lifelines*), **16 mensajes** y **2 niveles de anidamiento** de fragmentos (`alt`/`loop`) | Extraer subflujos secundarios (p. ej., verificación criptográfica interna o envío de correo OAuth2) a un diagrama separado referenciado con un marco `ref over ...` (`[Seidl2015, §6.5, Fig. 6.18]`). |
| **Componentes / Despliegue** | Máximo **14 componentes o nodos/artefactos** y **4 contenedores/paquetes** | Separar la vista lógica de componentes (`componentes.puml`) de la topología física de contenedores y red (`despliegue.puml`) (`[Rosenberg2007, Cap. 7, pp. 173–177]`). |

---

## 8. Ejecución del Pipeline de Renderizado de Diagramas

El script `backendnode/docs/generate-diagrams.js` utiliza una versión fija y verificada por hash SHA-256 de **PlantUML `1.2024.8`** (con Graphviz local o motor Smetana integrado) y falla con código de salida distinto de cero (`exit 1`) ante cualquier error de sintaxis:

```powershell
# Validar sintaxis de todos los archivos .puml sin modificar los .svg existentes
node docs/generate-diagrams.js --check-only

# Generar todos los archivos SVG en docs/asciidoc/assets/
node docs/generate-diagrams.js

# Validar o renderizar un único diagrama específico
node docs/generate-diagrams.js --check-only --file uc_sistema.puml
```
