# Cancelación atómica con restitución de inventario

## Comportamiento

Se conserva `PUT /api/orders/:id/status`, cuerpo `{ "status": "CANCELED", "reason": "Motivo" }` y respuesta 200 con el pedido. No se añaden endpoints, tablas, columnas, permisos SQL ni un sistema de devoluciones/pagos.

- BUYER activo: solo sus propios pedidos PENDING.
- SELLER activo y aprobado: solo pedidos de su tienda PENDING o PREPARING.
- ADMIN activo: pedidos PENDING o PREPARING.
- Motivo obligatorio, validado por el validador HTTP existente (texto no vacío, hasta 255 caracteres, sin controles).
- SHIPPED, DELIVERED y CANCELED: 409, sin modificar inventario ni insertar otro historial/evento. Un recurso ajeno conserva 404; un comprador que intenta cancelar su PREPARING conserva 403.
- Se suman exclusivamente las cantidades persistidas en order_items. Se agrupan posibles líneas del mismo producto y se usa BigInt al acumular/comprobar límites. El stock final debe caber en **INT UNSIGNED, 0..4294967295**; desbordamiento/inconsistencia impide cancelar con 409.
- Los productos eliminados lógicamente se cargan con paranoid:false. Se actualizan únicamente stock/updatedAt; deletedAt, título, precio, imagen y datos históricos no se restauran ni editan.
- No hay proceso retroactivo: un pedido previamente CANCELED se rechaza antes de consultar productos para restituirlos. Los pedidos de distintos vendedores siguen siendo independientes.

## Transacción, bloqueos y mínimo privilegio

Toda cancelación usa la transacción existente de orders.service:

1. Bloqueo de la cuenta del actor y validación de su perfil/estado actual, igual que antes.
2. Lectura preliminar **no bloqueante** del pedido con scope del propietario; determina el vendedor para ordenar bloqueos, sin confiar en datos del cliente.
3. Bloqueo de cuenta/perfil del vendedor antes de bloquear productos, siguiendo checkout/carrito/catálogo. Si el actor ya es ese vendedor, sus filas ya están bloqueadas. No se exige que el vendedor siga activo/aprobado para permitir una cancelación por BUYER/ADMIN.
4. Lectura del pedido **FOR UPDATE**, nueva comprobación de vendedor, estado y autorización. La fila bloqueada es la autoridad para decidir si se puede cancelar.
5. Lectura de detalles históricos inmutables; bloqueo de productos por ID ascendente. Se validan primero todos los stocks y después se escriben.
6. Actualización de stocks, estado del pedido, historial y auditoría `order.transition` en la misma transacción.

Una segunda solicitud espera los bloqueos y lee CANCELED al adquirirlos: responde 409 sin una segunda restitución. Un error de inventario, actualización del pedido, historial o auditoría provoca rollback SQL completo. No se implementan reintentos automáticos ni éxitos ficticios; se conserva el manejo HTTP 409 de deadlocks/conflictos existente.

order_items no recibe UPDATE locks ni modificaciones: los permisos de aplicación lo mantienen inmutable y no conceden UPDATE. Se conservan los permisos append-only de historial/auditoría y los UPDATE por columna de orders. El stock se actualiza bajo bloqueo exclusivo con los permisos ya existentes de products. No se cambian privilegios habituales ni temporales por esta feature.

## Checkout y carrito

No se modifica cart.service, confirm/quote de orders.service, firma de cotizaciones, límites, precios, snapshots, limpieza del carrito o comparación idempotente. Un reintento del checkout después de cancelar devuelve los mismos pedidos (incluido el estado CANCELED), sin crear otro pedido ni descontar nuevamente inventario. No se invalida ni reemplaza checkoutId. No se reponen artículos en el carrito.

La transacción puede adquirir esperas con otras operaciones del mismo vendedor; los bloqueos de vendedor y el orden numérico de productos reducen ciclos con checkout/catálogo. Esto no promete ausencia universal de deadlocks de InnoDB; siguen siendo conflictos observables, sin cambios parciales. La disponibilidad de un producto eliminado lógicamente no cambia por recibir stock.

## Archivos

- `services/orders.service.js`: helpers de bloqueo del vendedor, cantidades históricas agrupadas y restitución; conexión con transition antes de actualizar el estado.
- `services/orders-openapi.js`: descripción del comportamiento, conflictos y atomicidad, conservando contrato JSON.
- `tests/unit/checkout-persistence.test.js`: la expectativa anterior de no restituir se adapta a la regla de negocio autorizada; el resto de pruebas de checkout se mantiene.
- `tests/unit/orders-cancellation.test.js`: permisos, estados, cantidades, duplicados, límites, productos eliminados y propagación de fallos/orden de bloqueos.
- `tests/integration/orders-cancellation.routes.test.js`: contrato HTTP, identidad validada, motivo, campos protegidos y errores seguros.
- `tests/support/cancellation-checks.js`: escenarios HTTP con persistencia MySQL real y fallos inyectados, llamados por el runner temporal existente después de verificar UUID/destino.
- `scripts/database/stage5-addresses-test.js`: una llamada a la nueva comprobación; se reutilizan servidor tmpfs, cuentas aleatorias, permisos mínimos, infraestructura RS256/Redis temporal y limpieza existentes.
- `docs/implementation/implementation-report.md`: aclaración de que esta regla sustituye la decisión original de no restituir.

## Verificación

Los correos y proveedores externos no participan; todas las escrituras de pruebas reales se ejecutaron exclusivamente sobre el MySQL tmpfs verificado del runner. No se usaron ni modificaron datos habituales.

Pruebas dirigidas ejecutadas: **63 aprobadas, 0 fallidas** (validadores de pedidos, checkout-persistence, nueva suite unitaria y nueva suite HTTP). Los tests reales cubren PENDING/PREPARING por perfil, varios productos, tres actores concurrentes, repetición, propiedad, estados terminales, motivo, producto eliminado, overflow, fallo de segundo producto/historial/auditoría, pedidos separados por vendedor, replay del checkout y checkout concurrente con cancelación.

| Ejecución | Resultado comprobado |
| --- | --- |
| Regresión completa local con MySQL/Redis temporales, --runInBand --detectOpenHandles | **801 aprobadas, 0 fallidas, 46 omitidas**; 69 suites aprobadas y 5 omitidas; 172,468 s |
| Suites MySQL históricamente reutilizadas como proceso hijo del runner | **35/35 aprobadas**, 3 suites, sin omisiones dentro del hijo |
| Nueva ampliación HTTP/MySQL de cancelación | **7 grupos completados** dentro del parent real: permisos/varios productos; concurrencia; propiedad/terminales/históricos; motivo/borrado lógico; rollback/overflow; varios vendedores/replay; checkout simultáneo |
| Redis real | **6 fixtures PASS y cleanup=true**, incluido el runner independiente y los usados por las integraciones de cuentas/catálogo |
| Regresión Node 20/Linux, instalación limpia | **799 aprobadas, 0 fallidas, 48 omitidas**; 67 suites aprobadas y 7 omitidas; build salida 0 en 37,444 s; sin advertencias de workers |
| Cobertura Node 20/Linux | **85,38 % líneas; 82,63 % ramas; 82,24 % sentencias; 87,50 % funciones**. No es una medición remota de código nuevo de SonarCloud |
| Otras verificaciones en Linux | npm audit --audit-level=high aprobado (0 altas/críticas, 19 moderadas y 4 bajas), Swagger generado y docs:build aprobado |
| Revisión final | 9 archivos de la feature, sin patrones de secretos detectados; sintaxis y git diff --check aprobados; staging vacío |

Las **46 omitidas** de la ejecución local incluyen las **35 ejecutadas como hijo** y **11 de esquema/migraciones históricas no repetidas** (3 schema y 8 transition), ajenas a este cambio sin DDL. Las 48 omitidas de Linux agregan los wrappers de MySQL/Redis real, ejecutados fuera del build. No se suman ejecuciones repetidas ni se presentan las omisiones como aprobadas. Postman completo no se ejecutó: permanece la barrera del Word ausente.

Evidencias ignoradas: `log/cancellation-review/{targeted.json,regression.json,regression.log,node20-build.log,cleanup.json}`. El build Linux reutilizó el runner existente, sustituyendo únicamente en memoria etiqueta/rutas de artefactos para no sobrescribir la imagen previa; no se modificó configuración Docker ni el runner Node 20.

Antes de escribir se comprobó nombre/puerto temporal libre, tmpfs, identidad UUID/socket/TCP, base y cuentas efímeras. Después se confirmó: **ningún contenedor nuevo pendiente**, seis informes Redis limpiados, MySQL temporal retirado, imagen exclusiva Node 20 y tar de contexto eliminados. No se ejecutó prune de caché compartida. Los contenedores **ecommerce_api, ecommerce_db y secure-ecommerce-api-redis-1** conservan ID, imagen, configuración, hora de inicio y número de reinicios; los tres siguen running y MySQL/Redis healthy.

No se modificaron modelos, migraciones, grants, autenticación, contraseñas, carrito, firma de cotizaciones ni implementación del checkout. Se mantuvieron los contratos de campos HTTP existentes. Sin commits, push, merge o despliegue. Los riesgos residuales son los conflictos transitorios de InnoDB y una posible pérdida de respuesta después de COMMIT: consultar el pedido permite conocer el estado, y repetir una cancelación ya confirmada da 409 sin reponer otra vez. La garantía supone usar los flujos autorizados y no revertir manualmente CANCELED mediante SQL externo; no se introduce un proceso retroactivo ni un mecanismo de reembolso.
