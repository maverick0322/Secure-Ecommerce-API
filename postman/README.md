# Pruebas Postman de Secure-Ecommerce-API

Colección Postman v2.1 con **114 peticiones**, organizada en autenticación,
usuarios, vendedores, categorías, productos, direcciones, carrito, checkout,
pedidos, seguridad y auditoría. HTTP, RS256, bcrypt, MySQL y sesiones Redis son reales.
Incluye rotación/reutilización de refresh y logout en sesiones independientes.
El correo y Cloudinary son proveedores **simulados en memoria**: los resultados
no acreditan el funcionamiento de Resend ni Cloudinary reales.

## Requisitos

- Node.js 20 o posterior, npm y las dependencias del backend instaladas
  (`npm ci --ignore-scripts` en la raíz si todavía no están instaladas).
- Docker local accesible. En Windows se utiliza el contexto `desktop-linux`;
  en Linux, el contexto activo debe tener un endpoint local `unix:`.
- Imagen local `mysql:8.0`. El runner usa `--pull never` y falla si no existe.
  Si hace falta descargarla: `docker pull mysql:8.0`. No utiliza Docker Compose.
- Imagen local `redis:8.2`; se reutiliza el runner temporal con tmpfs, puerto
  aleatorio loopback, identidad y ACL de prueba. Las llaves RSA se generan en
  memoria. No se usan credenciales, CA ni sesiones del Redis habitual.
- Word original en `docs/Propuesta_BD_Secure_Ecommerce_14_tablas.docx`: su SHA-256
  debe coincidir con el esquema de fixtures. Si falta, el runner se detiene
  antes de las peticiones; no omitir ni sustituir esa barrera.
- Puerto `127.0.0.1:3001` disponible. Puede elegirse otro entre 3001 y 3099.

Todos los comandos siguientes se ejecutan desde la raíz del repositorio.

```sh
npm ci --prefix postman --ignore-scripts
npm test --prefix postman
npm run repeat --prefix postman
```

El último comando ejecuta la colección **dos veces desde cero**, cada vez con
otro contenedor, UUID, base, cuentas, contraseñas y clave JWT. Si un puerto está
ocupado, se detiene sin cerrar el proceso que lo utiliza. Para una ejecución:

```sh
npm run run --prefix postman
node postman/scripts/run.js --repeat 2 --port 3002
```

No ejecutar directamente `newman run`: el runner incorpora comprobaciones SQL,
preparación, mitigaciones del runtime, informes sanitizados y limpieza que ese
comando aislado no proporciona. No requiere Postman CLI, login ni API key.

## Aislamiento y datos

Antes de crear el esquema o insertar fixtures se comprueban el ID y etiquetas
del contenedor propio, hostname, publicación exclusivamente local, puerto
distinto de 3306/3307, almacenamiento **tmpfs sin volumen persistente**, UUID
leído por socket y TCP, cuenta SQL, modo estricto y claves foráneas activas.
Solo se acepta una base `secure_ecommerce_postman_<32 caracteres hexadecimales>`.
Se rechazan el UUID habitual conocido y el esperado en `.env`, si existe.
El runner nunca carga las credenciales habituales en el entorno de la API.

Se reutiliza `tests/support/final-schema.json`, comprobando su SHA-256 contra
el Word. Se crean sus 14 tablas y `SequelizeMeta` en el servidor descartable;
los 11 nombres de migración se registran como metadatos de fixture, **sin
ejecutar migraciones ni seeders históricos**.

La API aislada usa `ecommerce_app` con contraseña aleatoria y los permisos del
fixture existente. Para probar la lectura administrativa de auditoría se añade
**solo en el MySQL temporal** SELECT sobre las ocho columnas públicas de
`audit_logs`; no se permite leer `details` ni modificar/eliminar auditoría.
No se ejecuta ningún GRANT en el servidor habitual.

Un ADMIN ficticio se crea transaccionalmente mediante el preparador SQL de
pruebas; SELLER y BUYER usan el servicio de cuentas existente. Las contraseñas
se almacenan con bcrypt. No se crean endpoints públicos para dar de alta ADMIN.
La colección prueba además el registro público con código, expiración gestionada
por el servicio existente y rechazo de reutilización de código; no adelanta el
reloj para probar su vencimiento. El buzón local permite recuperar el código
sintético sin enviar correo. Las imágenes pasan por las validaciones HTTP reales
antes de llegar al proveedor Cloudinary simulado.

Se ejecuta una copia byte a byte del código público actual del backend dentro de
`reports/<runId>/workspace`, con las dependencias instaladas del proyecto. Esto
aísla dotenv y los directorios de logs del backend sin modificar su código ni sus
controles de autenticación. El informe registra el digest de las fuentes.
El lanzador de pruebas requiere IPC del runner y no forma parte de `index.js`.

Antes de **cada petición**, la colección consulta la identidad del servidor;
la API exige además una capacidad aleatoria local y comprueba su conexión SQL
antes de despachar la petición. Cada nueva conexión Sequelize también verifica
destino, usuario y UUID. La API escucha únicamente en loopback. Las rutas
`/__postman/isolation` y `/__postman/mailbox` existen exclusivamente en este
lanzador aislado y requieren la misma capacidad. No son rutas de producción.

`ecommerce_db` solo se inspecciona mediante metadatos Docker para comparar ID,
imagen, arranque, montajes y puertos antes/después. No se abre conexión SQL a
`secure_ecommerce` ni a `mercadolibrenode`. No se recrea el contenedor habitual.
El runner elimina únicamente su contenedor etiquetado; no utiliza `down`, `-v`,
DROP DATABASE, volúmenes compartidos ni servicios Compose.

## Importar y ejecutar manualmente en Postman

1. Iniciar un entorno nuevo y mantener este proceso abierto:

   ```sh
   npm run serve --prefix postman
   ```

2. Importar `collections/secure-ecommerce.postman_collection.json`.
3. Importar el entorno **privado local** cuya ruta imprime el runner:
   `postman/reports/<runId>/private.postman_environment.json`. Seleccionarlo.
   `environments/isolated.example.postman_environment.json` es una plantilla
   pública sin secretos y **no permite ejecutar pruebas** por sí sola.
4. Usar Postman Desktop o Desktop Agent local. Mantener desactivado el seguimiento
   de redirecciones. No usar Cloud Agent ni sincronizar/exportar el entorno
   privado: contiene únicamente secretos sintéticos, pero son de uso local.
5. Configurar como directorio de trabajo la carpeta `postman`. Si Postman solicita
   los archivos del formulario, seleccionar `scripts/fixtures/product.png` y
   `scripts/fixtures/not-image.txt` en sus respectivas peticiones de imágenes.
6. En Collection Runner seleccionar **todas las carpetas en su orden**, una
   iteración, sin CSV, sin datos externos y sin persistir valores de variables.
   Tokens, IDs y cotizaciones se conservan solo en variables de ejecución.
7. Al terminar, pulsar Ctrl+C en la terminal del runner. Se cierra la API, se
   elimina el contenedor propio y se borra el entorno privado generado.

Para repetir manualmente, iniciar otra vez `serve` e importar el nuevo entorno.
La colección cambia estados y consume el carrito: no se promete repetir una
carpeta aislada sobre fixtures ya consumidos. La repetibilidad se consigue
preparando una instancia nueva automáticamente en cada ejecución.
Los resultados manuales se consultan en Postman; `serve` no los certifica como
una ejecución automatizada aprobada.

## Cobertura funcional de la colección

- Login ADMIN/SELLER/BUYER, errores sin enumeración de cuentas, registro público
  con OTP local, contraseñas comunes y límite de bytes, JWT y permisos.
- Gestión administrativa de usuarios y vendedores; aprobación, revisión doble,
  suspensión con motivo, token previo y ocultación de productos suspendidos.
- Categorías protegidas, duplicados, productos por propietario, validación de
  precio/stock, asociaciones e imagen válida/inválida con proveedor simulado.
- Direcciones propias, asignación masiva rechazada y única predeterminada activa.
- Carrito persistente, cantidades, subtotal calculado, retiro y reactivación.
- Cotización, cambio de precio, reconfirmación, pedido por vendedor,
  reintento idempotente y cotizaciones manipuladas o de otro comprador.
- Estados e historial de pedidos, permisos, cancelación con motivo y snapshots
  preservados después de cambiar el producto y la dirección.
- CORS, rutas retiradas, lectura administrativa de auditoría y prohibición HTTP
  de modificación; comprobaciones SQL adicionales de privilegios mínimos.

La ejecución es secuencial. No sustituye las suites existentes de concurrencia,
caducidad, fallos simulados o cobertura del backend. No mide cobertura de líneas.

## Informes, secretos y recuperación

`reports/<runId>/summary.json` contiene resultados, estados HTTP, nombres de
aserciones, identidad del servidor temporal, persistencia y limpieza.
`summary.md` es el resumen; `reports/latest.json` identifica la última serie.
No se genera el informe JSON bruto de Newman porque incluiría JWT y cuerpos.
No se guardan contraseñas ni JWT en la colección ni en el entorno público.

Los informes, el workspace de pruebas, el entorno privado y `node_modules/`
están excluidos de Git. Los informes y dependencias Postman están excluidos del
contexto Docker y del archivo de verificación Node 20 existente. Los logs del
backend aislado permanecen bajo el workspace ignorado. Revisar privacidad antes
de compartir cualquier artefacto, incluso aunque sus cuentas sean ficticias.

Ante un corte abrupto, cerrar primero el runner y su API local. Inspeccionar
`reports/<runId>/state.json` y ejecutar:

```sh
node postman/scripts/cleanup.js <runId>
```

La recuperación rechaza un runner activo y contenedores sin identidad/etiquetas
propias o con almacenamiento persistente. No mata procesos ajenos. Si la
comprobación falla, inspeccionar el estado; no borrar recursos manualmente con
comandos generales. No borrar recursivamente un workspace mientras conserve
su enlace `node_modules`, que apunta a las dependencias del backend.

## Dependencias del ejecutor y límites conocidos

Newman 6.2.3 se instala en este subproyecto, sin cambiar `package.json` ni
`package-lock.json` del backend. Se fijaron parches compatibles de dependencias
transitivas mediante overrides, sin `audit fix --force`.

La auditoría del 12-11-2026 **no está limpia**: 5 avisos altos y 4 moderados
contando propagación transitiva (ninguno crítico). Las causas directas restantes
son Faker, csv-parse y uuid; los demás avisos se propagan a sus dependientes.
Se pueden revisar con:

```sh
npm audit --prefix postman --audit-level=high
```

Este comando devuelve un estado no exitoso mientras existan esos avisos. El
runner deshabilita las funciones vulnerables de plantillas Faker y rechaza las
variables `$random`; no admite CSV ni colecciones externas. Son mitigaciones de
esta suite controlada, **no una corrección del paquete ni una eliminación del
riesgo**. Las actualizaciones mayores incompatibles no se aplicaron. Revisar
estos avisos antes de aprobar la incorporación del ejecutor a CI.

## Evidencia de ejecución

El 12-11-2026 se completaron dos ejecuciones consecutivas independientes:

| Ejecución | Aserciones | Fallos | Limpieza | Metadatos de ecommerce_db |
| --- | ---: | ---: | --- | --- |
| `da5049b6-0a3b-48bd-a05f-fa76eee2127a` | 451 | 0 | Correcta | Sin cambios |
| `feb02bbc-3bef-4064-85e0-a93361b3250a` | 451 | 0 | Correcta | Sin cambios |

Cada ejecución hizo 106 peticiones de colección y 106 consultas HTTP de identidad
(212 contabilizadas por Newman). Persistencia comprobada: dos pedidos, dos
ítems históricos, dos líneas únicas de carrito, una dirección predeterminada
activa y stock final 8/19, con rechazo SQL de operaciones innecesarias. La
cancelación conserva el comportamiento existente de inventario; esta suite no
implementa reintegro de stock.

Los informes locales ignorados conservan también un primer intento fallido:
Docker exponía tmpfs en `HostConfig.Tmpfs`, sin entrada en `Mounts`. La barrera
detuvo el intento antes de crear el esquema; se corrigió su interpretación y se
limpió exclusivamente ese contenedor temporal. No se ocultó el fallo.

Las 22 pruebas de barreras pasaron tanto en Node.js 24.13.1/Windows como en
Node.js 20/Linux (imagen local `secure-ecommerce-stage5-node20:local`, sin red
externa y con scripts/dependencias montados en solo lectura). Evidencia local:
`reports/node20-guards.txt`. Las dos ejecuciones completas HTTP/MySQL se hicieron
en Windows con Node.js 24; no se presenta esto como una ejecución completa en
Node.js 20. `npm ci --prefix postman --ignore-scripts` también terminó
correctamente. No se modificaron ni se ejecutaron los workflows de GitHub.

Para regenerar la colección después de editar su constructor:

```sh
npm run build --prefix postman
```

No es necesario regenerarla para importarla o ejecutar la versión incluida.

## Diagnóstico del comparador de metadatos (12-11-2026)

La ejecución `7391a24d-4652-44c0-bdd1-d199ddb47fe7` aprobó 451 aserciones,
persistencia y limpieza, pero terminó en FAIL por la comparación de metadatos.
Su comparador usaba `JSON.stringify` directamente sobre el array `Mounts`.
En una comprobación exclusivamente de lectura se observaron 16 respuestas
Docker: 13 con el volumen MySQL primero y 3 con el bind de `bd.sql` primero.
ID, imagen, fecha de arranque, contenido de ambos montajes y puertos eran iguales.
El orden de esos montajes no representa un cambio de configuración.

El reporte original no guardó los snapshots inicial y final: no puede afirmarse
retroactivamente qué diferencia concreta ocurrió en aquel par ni reclasificar
su FAIL como PASS. Se mantiene intacto. El diagnóstico adicional se encuentra
en `reports/7391a24d-4652-44c0-bdd1-d199ddb47fe7/metadata-investigation.json`.
Mediante Docker inspect y SELECT con `ecommerce_app` se verificaron el contenedor
habitual, su imagen, volumen persistente, publicación local y UUID esperado.

El comparador ahora normaliza únicamente el orden de claves de objetos,
montajes y listas de bindings de puertos. Conserva todos los valores y duplicados;
un cambio de ID, imagen, arranque, volumen, ruta o publicación sigue causando FAIL.
Las próximas ejecuciones guardarán ambas capturas y los campos distintos en
`habitualContainerMetadataComparison`. Los errores de inspección siguen fallando.
No se modificó ninguna barrera de UUID, conexión, base, cuenta o volumen.

Se aprobaron las 16 pruebas específicas del comparador:

```sh
node --test postman/scripts/container-metadata.check.cjs
```

No se repitió la colección HTTP ni se modificaron datos, contenedores, permisos
o credenciales para este diagnóstico.
