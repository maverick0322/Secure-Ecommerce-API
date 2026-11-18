# Imágenes: recuperación y límites de cargas — fase 3B

Esta etapa corrige H1/H2 y conserva las garantías de [3A](cloudinary-stage3a.md).
No activa servicios, cambia secretos ni migra recursos. Los identificadores y
las imágenes anteriores permanecen compatibles. No se certifica HA multi-host.

## H1: fallo del proveedor y recuperación acotada

La causa era la pérdida del código del proveedor al normalizar errores y la
consulta repetida de diarios sin límite de intentos ni espera persistente.

El adaptador conserva solo una clasificación, nunca el mensaje del proveedor:

| Resultado | Tratamiento |
|---|---|
| Rechazo explícito 400/401/403/404/413/415/422 de upload | Definitivo: no hay escritura SQL ni recurso creado por esta operación; se cierra su intención. La respuesta HTTP continúa siendo 502 genérica. |
| 429 | Transitorio: no se repite automáticamente la subida. Se conserva evidencia y se aplica recuperación acotada. |
| Timeout, desconexión, 5xx o resultado incompleto/inconsistente | Incierto: conservar intención, sin inventar éxito ni repetir la subida. |
| Pérdida del permiso antes de llamar al proveedor | 503; se cierra la intención porque no empezó ninguna operación remota. |
| Pérdida del permiso después de subir | 503; no se actualiza SQL; compensación con las comprobaciones de pertenencia y referencias de 3A. |

La subida mantiene el timeout del SDK de 30 segundos y añade un plazo local de
35 segundos con destrucción del stream y de su agente HTTPS exclusivo. Cancelar
la conexión no demuestra que el proveedor no haya creado un recurso: el resultado
sigue siendo incierto y su evidencia se conserva.

Los registros `settled` guardan `attempts`, `retryAt`, `failureKind` y `manual`.
Se permiten como máximo seis intentos fallidos, con esperas de 1, 2, 4, 8, 16 y
32 minutos, limitadas además a una hora. El sexto fallo requiere revisión manual;
un rechazo definitivo durante limpieza también la requiere inmediatamente.
Un recurso ausente tras un upload incierto NO autoriza a olvidar la intención:
consume ese presupuesto y termina conservado, sin más consultas al proveedor.
Los plazos y el presupuesto sobreviven a reinicios. No hay reintento automático
del upload ni del commit de negocio.

Cada ciclo examina como máximo 32 entradas de directorio mediante un iterador,
sin cargar todos los nombres en memoria. El ciclo periódico sigue siendo de un
minuto y no se encola otro ciclo en el mismo proceso mientras trabaja el anterior.
Los registros aplazados/manuales no consultan SQL ni Cloudinary. Los registros
se leen hasta 4 KiB y la metadata de reintentos se valida estrictamente.
Si no se puede persistir el presupuesto, el recuperador de ese proceso se pausa
una hora y registra el fallo; conserva la evidencia. El espacio de archivos no
se puede reparar automáticamente si el sistema de almacenamiento está averiado.

Una operación `pending` de 3A sigue sin otorgar permiso de borrado. Se permite una
sola comprobación SQL de referencia por proceso/identificador para cerrar evidencia
ya referenciada; si no se demuestra, queda para revisión. El conjunto de esas
comprobaciones está acotado a 1000; al saturarse, se conservan los demás pendientes.
No se escribe `settled` desde un recuperador para un trabajo potencialmente vivo.
Incluso después de 120 segundos o de un reinicio se mantiene esta regla.

Antes de reservar trabajo nuevo se recorre el directorio de forma incremental,
con corte en 1000 entradas distintas de `.ownership.json`; al alcanzar ese umbral
se responde 503 antes de subir. Cuentan también los archivos preservados y
temporales: no se borran para liberar espacio. Es un límite de admisión conservador,
no una cuota atómica de filesystem; reservas simultáneas pueden superarlo de forma
acotada. Requiere el almacenamiento coherente y dedicado descrito en 3A.

`recoveryMetrics()` y `image.recovery.cycle` exponen solamente contadores acumulados
del proceso: `processed`, `deferred`, `manual`, `invalid`, `failed`. Son observaciones,
no un inventario exacto del backlog. No contienen credenciales, errores originales,
buffer, URL ni datos personales. Alertar ante incremento de `manual`/`invalid`,
fallos de recuperación o 503 por capacidad. El diario conserva la referencia para
la revisión operativa; no hay endpoint público que exponga esos archivos.

## H2: admisión previa a Multer

La ruta exige JWT, RBAC y propiedad antes de pedir el permiso; la admisión ocurre
antes de Multer. Los rechazos por cuotas no consumen buffer de imagen ni llaman
al proveedor. Los permisos se comprueban nuevamente antes del upload y de SQL.

| Control | Valor y justificación |
|---|---|
| Frecuencia por vendedor | 6 admisiones por ventana de 60 segundos: suficiente para edición manual y acota coste de intentos fallidos. |
| Frecuencia global | 60 admisiones por ventana de 60 segundos, compartidas entre instancias. |
| Concurrencia por vendedor | 1: evita cargas remotas simultáneas del mismo propietario. |
| Concurrencia global | 8 permisos distribuidos, sin cola de subida. |
| Concurrencia local | 8 admisiones/trabajos retenidos por proceso, aunque expire un permiso distribuido. Protege memoria de procesos bloqueados. |
| Recepción multipart | 30 segundos; después, 408 y cierre de conexión. |
| Permiso | 90 segundos, renovado cada 20 segundos mientras el trabajo vive. |

Las ventanas son fijas, ancladas en la primera admisión global de la ventana,
no deslizantes: puede haber una ráfaga de hasta el doble de la cuota alrededor
del cambio de ventana. La concurrencia sigue limitando el trabajo simultáneo.
Intentos admitidos que luego fallan validación también consumen frecuencia.
Los rechazos devuelven 429 con `Retry-After`: segundos restantes de ventana o
20 segundos por concurrencia. Reintentar sigue sujeto a todas las validaciones.

Se reutilizan WATCH/MULTI/EXEC, TIME, TTL, ACL y el fencing de identidad Redis
existentes. No se añaden Lua, permisos, dependencias ni credenciales. La clave
`<namespace>:{<generation>}:image-admission` es distinta de sesiones y está dentro
del espacio autorizado. Su estado está acotado a 60 vendedores y ocho permisos.
El reloj de cuotas es Redis, no el del cliente ni el del host de cada API.
Los conflictos confirmados usan el presupuesto de reintentos ya existente del
coordinador. No se repite un EXEC de resultado incierto.

Todas las instancias del mismo entorno deben usar el mismo Redis, namespace y
generation, además de los requisitos de MySQL/directorio de 3A. Una configuración
con coordinadores independientes reparte las cuotas y NO ofrece límite global.
No se afirma soporte Redis Cluster, failover automático o multi-host certificado.
El limitador no usa su temporizador local como autoridad distribuida.

Sin Redis se responde 503 y no se procesa el fichero. No hay fallback permisivo.
Una renovación fallida invalida el permiso y detiene su heartbeat. El fallo del
coordinador conserva el comportamiento existente de sesiones: puede exigir
reiniciar el proceso después de la reparación; no se debilita el fencing.
Un permiso vencido se rechaza como condición de aplicación sin envenenar por sí
solo una conexión sana. TTL permite recuperar permisos de procesos muertos.

Finish/close liberan el permiso si aún no empezó el controlador. Durante trabajo
remoto, una desconexión del cliente NO libera anticipadamente el permiso: el
`finally` del controlador lo libera al terminar y suelta el buffer. La liberación
es idempotente y libera capacidad local aunque Redis falle; la capacidad remota
se recupera por TTL si la liberación no se confirmó.

## Límites de la corrección y alternativas

- Se descartó repetir uploads inciertos: puede duplicar recursos y empeorar carga.
- Se descartó borrar pendientes por antigüedad o tras agotar intentos: rompe G09.
- Se descartó un limitador exclusivamente en memoria: se elude entre instancias.
- Se descartó habilitar cargas si Redis falla: elimina el control precisamente bajo fallo.
- Se descartaron nuevas colas, tablas o dependencias: la infraestructura existente basta.
- El presupuesto de recuperación es durable por registro; dos recuperadores pueden
  duplicar algún intento o incrementar el presupuesto en paralelo. No es una cola
  con un consumidor único ni un límite agregado global de llamadas de limpieza.
  La seguridad de borrado depende de las pruebas de pertenencia/cierre/referencias,
  y no de esos contadores. No hay elección de líder: si se exige un presupuesto
  agregado estricto de recuperación, operar una sola instancia de la API. Con varias,
  multiplicar el máximo por el número acotado de instancias. El drenaje de versiones
  anteriores sigue siendo obligatorio.
- Las pausas de procesos o particiones pueden dejar trabajo remoto incierto incluso
  tras vencer el permiso. Las cuotas limitan nuevas admisiones; no son una garantía
  de que el backend del proveedor haya dejado de procesar la solicitud cancelada.
- Una consulta SQL colgada puede retener un permiso local hasta terminar o reiniciar
  el proceso; quedan acotados a ocho trabajos por proceso. No se mata una transacción
  incierta para liberar recursos ni se elimina su imagen por ese motivo.
- No hay protección completa frente a DDoS de red, conexiones HTTP rechazadas masivas,
  imágenes malformadas/bombas del proveedor (H3) ni auditoría detallada de todo fallo (H4).
  Esos asuntos siguen fuera de 3B.
- Los registros manuales/históricos requieren intervención supervisada, conservando
  las comprobaciones de 3A. No ejecutar `destroy` manual ni borrar diarios para
  hacer desaparecer alertas. Primero correlacionar referencias, auditoría e identidad;
  los casos inciertos continúan preservados hasta demostrar una resolución segura.

El bloqueo externo de npm audit y la evaluación remota de SonarQube no quedan
resueltos por estas correcciones. No se modifican las exigencias del CI.
