# Cloudinary: integridad y aislamiento — fase 3A

Alcance: G09 y H01. No se activó esta versión sobre la API habitual, ni se
consultaron MySQL o Cloudinary reales. No se migraron imágenes ni identificadores.
El identificador existente del producto 4 permanece intacto.

## Causas y alternativas

G09: `active` solo existía en un proceso. Otro recuperador consideraba suficiente
que hubieran pasado 120 segundos y no hubiera referencia SQL, aunque una subida
seguía esperando su transacción. H01: el namespace y `catalog_owner` eran comunes
a todas las instalaciones; una consulta de referencias en una base no protege
las referencias existentes en otra.

| Alternativa | Decisión |
|---|---|
| Ampliar la gracia temporal | Descartada: no prueba que una operación terminó. |
| Lease con expiración o bloqueo de sesión SQL | Descartada aquí: necesita fencing ante pausas, particiones o pérdida de conexión; una expiración aislada reproduce el problema. |
| Mantener bloqueo de fila durante upload/inspect/destroy | Descartada: prolonga transacciones y perjudica disponibilidad. |
| Bloqueo de proceso mediante PID/archivo con vencimiento | Descartada: no identifica de forma fiable procesos en otros hosts ni operaciones pendientes de commit. |
| Diario durable con cierre explícito y conservación de incertidumbre | Elegida: sin tablas, migraciones, dependencias ni servicios nuevos. Prioriza integridad sobre limpieza automática de operaciones abandonadas. |

Para H01 no basta una etiqueta `development`/`production` configurable: puede
duplicarse por error. Se usa una identidad aleatoria persistente, ligada también
al UUID real de MySQL, nombre de base y cloud name configurado.

## G09: cierre durable, no vencimiento de propiedad

Los registros nuevos tienen `version: 2`, `scope` y `state: pending` antes de
contactar al proveedor. Solo el flujo que ya abandonó cualquier intento futuro
de modificar SQL escribe `state: settled`, mediante archivo temporal, sync y
rename en el mismo directorio. Se conserva si la subida tuvo confirmación.

El recuperador nunca elimina un recurso basándose únicamente en tiempo, PID,
`active` o `recovering`. Los mapas locales siguen siendo optimizaciones. Un
registro `pending` sin referencia no otorga permiso de eliminación, aunque pase
un año o reinicie el servicio. Una operación que falla y finaliza de forma
conocida sí publica su cierre durable y puede compensarse.

Una transacción breve bloquea el producto y cuenta referencias con
`paranoid:false`, esperando la resolución de un commit incierto. La transacción
termina antes de `inspect` o `destroy`. Si hay recurso, se vuelve a comprobar
referencia antes de eliminar. No se mantienen bloqueos de fila durante llamadas
remotas.

Esta garantía usa el contrato existente: los public_id nuevos son UUID del
servidor, no se sobrescriben y ninguna entrada HTTP permite asociar de nuevo un
identificador antiguo. No se permiten importadores o escrituras SQL externas
que reasignen imagePublicId simultáneamente con limpieza; necesitarían su propio
protocolo de coordinación.

## H01: identidad persistente y pertenencia verificable

`log/cloudinary/.ownership.json` (o el directorio persistente configurado) contiene
una identidad aleatoria y un hash de UUID de servidor, base y cloud name. No
contiene contraseñas ni claves del proveedor. Se crea exclusivamente con modo
0600, se sincroniza y no se reemplaza automáticamente si existe. Una identidad
parcial, inválida o incompatible produce 503 para las mutaciones de imágenes;
la recuperación también falla cerrada. No se exponen rutas o detalles internos.

Los nuevos identificadores tienen esta forma:

```
secure-ecommerce/environments/<identidad>/<binding>/products/<id>/<uuid>
```

La subida añade `catalog_environment` y `catalog_database` al contexto existente.
La limpieza exige coincidencia entre identidad actual, scope del diario,
namespace del identificador y las cuatro etiquetas del recurso. Un identificador
que imita el namespace pero tiene contexto ajeno se preserva.

Los identificadores previos siguen sirviéndose exactamente como están. Los
recursos y diarios históricos o de origen incierto no se eliminan: su intención
de retirada queda archivada como `.preserved.json`. No se renombra ni reetiqueta
ninguna imagen real automáticamente. La referencia puede retirarse por el
endpoint autorizado, pero el recurso histórico queda conservado.

Si se pierde la identidad persistente y falta su archivo, una inicialización
posterior genera un scope nuevo; no adopta recursos anteriores. Esto evita
borrados cruzados pero deja su limpieza en revisión manual. Conservar y respaldar
la identidad junto al diario evita esa pérdida funcional.

## Restricciones de operación

- Cada entorno debe tener su almacenamiento persistente propio y UUID MySQL
  único. No copiar `.ownership.json` entre entornos. Si se copia a otra base o
  cloud distinguible, el código lo rechaza, sin reemplazarlo.
- Los procesos del mismo entorno que compartan limpieza deben usar el mismo
  directorio durable, identidad de base y cloud. Se probaron dos procesos con
  filesystem local coherente. No se certifica un clúster multi-host, NFS,
  failover automático ni almacenamiento eventual.
- Con directorios distintos, se generan scopes distintos: no se adopta ni borra
  automáticamente el recurso de la otra instancia. Esto protege integridad, pero
  no proporciona recuperación compartida ni garantiza retirar todos los huérfanos.
- No mezclar recuperadores antiguos y nuevos. Antes de una activación futura,
  detener o drenar todos los escritores/recuperadores de la versión anterior.
  Esta fase no ejecutó esa activación ni modificó contenedores habituales.
- Un clon administrativo que duplique simultáneamente datos, UUID de MySQL,
  identidad del almacenamiento y recursos es indistinguible para este protocolo.
  Está fuera de la configuración admitida. Tampoco protege frente a un operador
  con acceso de escritura al diario o una clave Cloudinary comprometida.
- Restringir permisos del directorio a la cuenta de la API. Mantener una clave
  del proveedor con permisos mínimos y aislamiento de recursos conforme al modo
  de carpetas/plan real. No se consultaron ni cambiaron los roles de la clave;
  el aislamiento del código no sustituye el control de acceso del proveedor.

## Reinicios y operaciones abandonadas

| Estado observado | Acción automática |
|---|---|
| Referencia vigente, incluso borrado lógico | Conservar imagen; cerrar intención redundante. |
| `settled`, propio, sin referencia, contexto correcto | Compensar/retirar según las comprobaciones existentes. |
| `pending`, sin referencia | Conservar registro y recurso; no convertir antigüedad en permiso. |
| Scope, identificador o contexto ajeno/histórico | Preservar recurso; archivar intención. |
| Identidad inválida/incompatible o SQL/proveedor inaccesible | Fallar cerrado; no eliminar. |

La limpieza automática completa de operaciones abandonadas NO está resuelta.
Para revisarlas hace falta una tarea de mantenimiento autorizada por separado:
detener/drenar todos los escritores, comprobar la resolución SQL y las referencias
en lectura, identificar el recurso y decidir su tratamiento. No editar JSON para
forzar `settled`, eliminar la identidad o ejecutar destroy manual sin ese análisis.
No se añadió una herramienta que facilite una eliminación accidental.

H1 continúa pendiente: una operación ya terminada cuyo upload es incierto y cuyo
recurso nunca aparece puede seguir conservando su intención. H2, H3 y H4 no se
modificaron. La nueva conservación de `pending` y el archivo de identidad son
cambios indispensables para G09/H01, no una solución general de esas otras fases.

## Contratos y validación

Rutas, autorización y JSON de éxito permanecen iguales. Los public_id continúan
siendo cadenas opacas dentro del límite de 255 caracteres. GET y la generación
de URL no reinterpretan identificadores antiguos. La respuesta 503 por identidad
insegura está documentada también para DELETE de imagen.

Las pruebas filtran únicamente `.ownership.json` al contar intenciones, sin
omitir diarios pendientes, temporales o preservados. Los fixtures incluyen el
contexto completo del proveedor. G09/H01 ahora afirman conservación, y se
mantienen las comprobaciones de referencias y compensación.

Resultados, archivos y límites de ejecución: [informe de fase 3A](../../tests/security/images-phase3a-report.md).
