# Unicode y JSON desde Windows PowerShell

## Causa confirmada

Entorno comprobado: **Windows PowerShell 5.1.26100.9818**. `$OutputEncoding.WebName` devuelve **us-ascii**, mientras que `[Console]::OutputEncoding.WebName` devuelve **utf-8**. Son configuraciones diferentes.

En Windows PowerShell 5.1, canalizar texto a un ejecutable nativo utiliza `$OutputEncoding`. Este comando puede perder caracteres **antes de entrar en curl o HTTP**:

```powershell
$json | curl.exe --data-binary '@-' -H 'Content-Type: application/json; charset=utf-8' $uri
```

Se reprodujo con datos ficticios construidos en memoria: `Electrónica` → `Electr?nica`, `Cancelación` → `Cancelaci?n`, `niño` → `ni?o`. Los bytes recibidos por un proceso nativo ya contienen `3F` (`?`) en vez de `C3 B3` (`ó`). El encabezado HTTP no reconstruye un carácter que ya se perdió. `curl.exe --data-binary` transmite los bytes que recibe; Express interpreta el JSON válido con esos signos y MySQL puede almacenarlo correctamente como texto UTF-8 que contiene `?`.

No se debe sustituir ni prohibir automáticamente `?`: también es texto legítimo. Un servidor no puede inferir qué letra original habría ocupado su lugar, y reinterpretar ese texto alteraría datos/validaciones existentes.

La nueva prueba automatizada reproduce la canalización **real a curl.exe contra un servidor HTTP de loopback**, con payload sintético y sin usar la API habitual; después comprueba la solución contra el mismo receptor de bytes.

## Verificación del backend y datos existentes (solo lectura)

Antes de cambiar configuración se inspeccionaron Express, validadores, controladores, modelos y config/config.js. No hay conversión a ASCII ni transliteración en categorías, direcciones o motivos. Los validadores mantienen los textos Unicode y únicamente aplican sus reglas existentes de espacios, campos, longitud y controles. Express recibe/responde JSON UTF-8. Sequelize usa mysql2; su configuración predeterminada instalada es UTF8MB4_UNICODE_CI, sin una sobreescritura incompatible en config/config.js.

También se abrió una conexión **exclusivamente de lectura**, tras verificar host/puerto local esperado, base secure_ecommerce, cuenta ecommerce_app, versión y UUID esperado cuando está configurado. Resultado:

- character_set_client, character_set_connection y character_set_results: **utf8mb4**.
- categories.name, user_addresses.recipientName/street/city y order_status_history.reason: **utf8mb4 / utf8mb4_unicode_ci**.
- Categoría **ID 5**: contiene `?` almacenado y no coincide con los bytes de `Electrónica`.
- Existe **1 motivo histórico** que coincide con `Cancelaci?n%` con el interrogante ya persistido.

No se imprimieron credenciales ni registros completos, ni se realizó ninguna escritura en el MySQL habitual. La reproducción demuestra el mecanismo del cliente descrito en las pruebas manuales. Sin sus bytes originales no se puede probar la procedencia individual de cada fila histórica, ni reconstruir automáticamente letras perdidas. No se cambió configuración, validación, contrato HTTP, esquema o registro del backend: no se demostró un defecto de codificación allí.

## Solución reutilizable

Archivo: `scripts/http/Invoke-Utf8Json.ps1`.

La función **Invoke-Utf8Json** serializa objetos con ConvertTo-Json o acepta JSON ya serializado mediante -Json. Construye **byte[] UTF-8 sin BOM**, con encoder estricto, y los entrega directamente a Invoke-RestMethod. No utiliza la canalización de texto a ejecutables, no escribe cuerpos/credenciales en archivos, no registra cuerpos/tokens ni modifica `$OutputEncoding`, TLS o políticas globales. No recorta ni normaliza cadenas. Un Unicode inválido falla antes de enviar bytes. El Content-Type lo fija la función y no debe repetirse en -Headers. Los errores HTTP, incluido 409, conservan el comportamiento de error de Invoke-RestMethod; no se convierten en éxitos.

**Los siguientes son ejemplos para la fase manual final autorizada. No se ejecutaron ahora contra la API ni reparan datos habituales.** Verificar primero que la URL pertenece al entorno aislado correspondiente; el número de puerto por sí solo no garantiza aislamiento.

```powershell
# Desde la raiz del repositorio, cuando la politica del equipo permita cargarlo:
. .\scripts\http\Invoke-Utf8Json.ps1

$baseUrl = 'http://127.0.0.1:3001' # Sustituir por la API aislada verificada.
# Utilizar el JWT privado del perfil autorizado; no guardarlo en este archivo.
$headers = @{ Authorization = "Bearer $token" }

# Objeto: acentos y enie se conservan desde la cadena .NET hasta los bytes HTTP.
Invoke-Utf8Json -Uri "$baseUrl/api/categories" -Method POST -Headers $headers `
    -Body @{ name = 'Electrónica' }

# JSON ya serializado: los escapes Unicode evitan depender del texto del .ps1.
Invoke-Utf8Json -Uri "$baseUrl/api/categories" -Method POST -Headers $headers `
    -Json '{"name":"Ni\u00f1ez y electr\u00f3nica"}'

# Solo con un pedido de prueba propio PENDING y el usuario correspondiente.
Invoke-Utf8Json -Uri "$baseUrl/api/orders/$orderId/status" -Method PUT -Headers $headers `
    -Body @{ status = 'CANCELED'; reason = 'Cancelación por cambio de envío' }
```

El -Body espera un objeto; usar -Json cuando ya se llamó a ConvertTo-Json para evitar doble serialización. La función admite POST/PUT/PATCH/DELETE y timeout de 1..300 segundos (30 por defecto). No acepta credenciales incrustadas en la URI. El envío correcto no sustituye autenticación, autorización ni validación de negocio.

### Políticas de ejecución y archivos de PowerShell

Este host rechaza cargar archivos ps1 por su política de ejecución. **No se cambió esa política, ni se utilizó ExecutionPolicy Bypass.** La suite automatizada ejecuta la definición local revisada como fuente de un comando PowerShell permitido, no carga código remoto y no cambia políticas. Esto comprueba la función, pero no autoriza dot-sourcing en una máquina que lo prohíba. Para uso habitual, seguir el procedimiento de firma/autorización de scripts del equipo; el helper no lo modifica automáticamente.

Si aún no se permite cargarlo, se puede utilizar directamente este equivalente en la consola autorizada, sin ejecutar un ps1 ni cambiar políticas:

```powershell
$json = '{"name":"Electr\u00f3nica"}'
$bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes($json)
Invoke-RestMethod -Uri "$baseUrl/api/categories" -Method POST -Headers $headers `
    -ContentType 'application/json; charset=utf-8' -Body $bytes
```

El helper tiene fuente **solo ASCII**, que Windows PowerShell 5.1 puede interpretar sin BOM. En **otros archivos ps1 con caracteres literales** como ñ/ó, Windows PowerShell 5.1 requiere una codificación de fuente reconocible (por ejemplo UTF-8 **con BOM**) o construir los textos con escapes JSON/valores Unicode. Esto es independiente del **cuerpo HTTP**, que la función genera siempre en UTF-8 **sin BOM**. Un archivo ya leído con caracteres incorrectos no puede repararse solo cambiando la codificación de salida.

### Si se mantiene curl.exe

La alternativa es establecer la codificación de la canalización explícitamente y restaurarla al terminar. No basta con Console.OutputEncoding ni el Content-Type:

```powershell
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
    $json | curl.exe --data-binary '@-' -H 'Content-Type: application/json; charset=utf-8' $uri
} finally {
    $OutputEncoding = $previousEncoding
}
```

Preferir la función con byte[] para no depender del alcance de variables de la sesión. Nunca incluir secretos reales en scripts versionados, archivos de ejemplo, logs o historial de comandos. La función no protege un secreto que se pega literalmente en el terminal.

## Reparación posterior de datos: requiere autorización independiente

**No se reparó ningún dato.** Para la categoría 5:

1. Verificar por lectura ID, nombre/HEX, unicidad del nombre previsto y relaciones. Confirmar el texto correcto con una fuente autorizada; un `?` no identifica de forma inequívoca la letra original.
2. Conservar evidencia segura del antes (sin publicar datos privados en Git). Obtener autorización específica para la reparación y utilizar la cuenta ADMIN existente y autenticada.
3. Ejecutar **una actualización administrativa de la categoría existente** mediante el endpoint PUT `/api/categories/5`, enviando únicamente name mediante el transporte UTF-8. No crear otra categoría, cambiar IDs o reescribir asociaciones.
4. Comprobar por GET/lectura el resultado y la relación con productos. Conservar la evidencia del después y la correlación de la petición. La operación administrativa genera un **nuevo evento categoria.editar**; no reemplaza eventos anteriores ni garantiza por sí sola un snapshot del nombre previo.

Los motivos de **order_status_history**, pedidos y **audit_logs** son históricos: **no hacer UPDATE/DELETE, no reabrir pedidos ni repetir una cancelación para corregir texto**. Mantener el registro original. Si se requiere aclaración, documentarla posteriormente por un mecanismo administrativo expresamente autorizado, sin sobrescribir historia; esta tarea no crea otro endpoint ni tabla para ello. La cancelación repetida conserva 409 y no restituye inventario otra vez.

## Pruebas y alcance de esta revisión

Se añaden pruebas HTTP con mocks de persistencia para categorías, direcciones y motivos, incluyendo acentos, ñ, emoji de cuatro bytes y secuencias combinadas sin normalización. Se mantienen las suites de permisos, validación y restitución transaccional. La prueba Windows usa únicamente un servidor receptor temporal 127.0.0.1 con puerto aleatorio; no inicia contenedores, no envía correos y no conecta con la API habitual. En Linux sin Windows PowerShell se omite explícitamente esa suite específica, no se finge que fue ejecutada.

Quedan **preparadas para la fase final**, sin ejecutarse ahora, las ampliaciones de `tests/database/catalog.mysql.test.js` y `tests/support/cancellation-checks.js`: comparación exacta de texto/HEX en MySQL temporal para categorías, direcciones y motivos, y lectura por GET manteniendo la restitución. No se ejecutó la batería manual completa ni el runner MySQL/Redis en esta revisión. Los resultados automatizados dirigidos se registran al concluir.

### Resultados comprobados de esta revisión

- **102 pruebas aprobadas, 0 fallidas, 0 omitidas**, siete suites dirigidas en Windows: powershell-utf8, categories.routes, addresses.routes, orders-cancellation.routes, orders-cancellation, checkout-persistence y addresses.
- Las **cinco pruebas de transporte Windows** ejecutan procesos Windows PowerShell 5.1 reales y HTTP contra loopback: corrupción ASCII previa a curl, Body, Json, propagación de HTTP 409 y rechazo de Content-Type ambiguo/Unicode inválido sin petición. No usan cuentas, tokens reales ni base de datos.
- Se verifican los bytes recibidos, ausencia de BOM, Content-Type, acentos/ñ/emoji/secuencia combinada exactos y ausencia de cambios globales de codificación. Los errores HTTP siguen siendo errores; en la prueba de 409 esperado, el proceso de pruebas finaliza con éxito **solo después de comprobar explícitamente ese código**.
- La primera ejecución falló en cuatro casos por carga ps1 bloqueada; no fue un fallo del transporte. Se adaptó el arnés para probar la misma definición local mediante -Command sin cambiar la política. Después se ajustó únicamente la salida del proceso en el caso de excepción 409 esperada, que Windows PowerShell conservaba como código de error aunque estuviera capturada; no se cambió el comportamiento de la función ante errores HTTP.
- Evidencias locales ignoradas: `log/utf8-review/{targeted.json,targeted-final.json,verified.json}` y sus logs. La ejecución final `verified.json` registra las 102 pruebas aprobadas; se conservan los intentos anteriores y sus fallos, sin presentarlos como aprobados.
- Código de backend, validadores, autenticación, carrito, checkout, restitución, modelos, migraciones, configuración y secretos: **sin modificaciones**. Sin comandos Docker, escrituras habituales, reparaciones, commit, push ni merge.
- Los nuevos casos SQL/HEX quedan **PENDIENTES de ejecución en MySQL temporal en la fase final**; las pruebas HTTP dirigidas utilizan dobles de persistencia y no sustituyen esa comprobación.
