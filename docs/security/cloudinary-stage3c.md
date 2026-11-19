# Imágenes: integridad, multipart y proveedor — fase 3C

Esta fase conserva [3A](cloudinary-stage3a.md) y [3B](cloudinary-stage3b.md).
No transforma imágenes históricas, cambia sus identificadores ni accede a recursos
reales. H4 queda fuera de esta etapa.

## Elección del decodificador

Comprobar firmas, MIME o extensiones no prueba la integridad. Validar únicamente
cabeceras o delegar todo en Cloudinary mantiene H3. Implementar JPEG/WebP propios
introduciría complejidad y riesgos innecesarios; invocar ImageMagick del host no
aporta una instalación reproducible en los workflows existentes.

Se añade **sharp 0.35.5**, fijado exactamente. Usa decodificadores mantenidos de
libvips/libpng/libjpeg/libwebp, binarios precompilados e instalación con scripts
desactivados. Su [requisito oficial](https://sharp.pixelplumbing.com/install/) es
Node >=20.9.0; se comprueba en Node 20.20.2/Linux y Node 24.13.1/Windows.
Se revisaron [sus advisories](https://github.com/lovell/sharp/security/advisories)
y los metadatos npm antes de instalar. 0.35.5 está fuera de los rangos afectados
por GHSA-wq5f-xc86-pv6w, GHSA-rgj7-g3m4-5g8c y GHSA-f88m-g3jw-g9cj. La consulta
de candidatos y la auditoría completa posterior no añadieron alertas frente al
diagnóstico previo. Esto no garantiza ausencia de defectos nuevos en código nativo.

No se ejecutó audit fix/--force ni se actualizaron las versiones existentes para
introducir el decodificador. El lock incorpora sus dependencias y variantes de
plataforma; una instalación limpia Linux comprueba que no depende del árbol Windows.

## Política local de admisión

| Control | Política |
|---|---|
| Formatos | JPEG, PNG y WebP; coherencia de extensión, MIME, firma y decodificación real. |
| Bytes | Hasta 2 MiB inclusive en la entrada y en el resultado normalizado. Exceso: 413. |
| Dimensiones | Hasta 4096 por lado y 8 millones de píxeles en total. |
| Fotogramas | Una imagen estática. Se rechazan APNG y WebP animado, incluso si un contenedor de animación declara una sola página. |
| Contenedor | Hasta 4096 segmentos/chunks; límites, longitudes y cierre exactos; sin datos añadidos al final. |
| Validadores | Dos procesos por instancia, sin cola; saturación 429/Retry-After: 1. |
| Ejecución | Cinco segundos por proceso, después SIGKILL; un hilo libvips y caché desactivada. |
| Memoria | Heap V8 de 64 MiB por proceso, entrada de 2 MiB y píxeles/expansión limitados. El heap NO es un límite RSS nativo. |

Los límites son constantes versionadas. Los controles Redis de H2 siguen antes
de Multer; este límite local adicional protege la fase nativa después de recibir
el buffer ya acotado. La capacidad no se libera hasta el cierre del proceso,
incluyendo error de spawn, IPC, cancelación o timeout. No hereda NODE_OPTIONS,
claves, JWT ni configuración de conexión; solo PATH/SystemRoot y una opción fija
de sharp. No carga modelos, SDK, aplicación o .env. stdout/stderr se descartan.
El hijo sale también al desconectarse la API y tiene su propio plazo de vida,
además del temporizador que lo mata desde el padre. Se prueba desconexión real
del canal IPC para evitar procesos huérfanos tras caída del padre.
No es una sandbox de permisos del sistema operativo: el hijo corre con el usuario
de la API. El despliegue debe conservar límites de contenedor y privilegios mínimos.

El proceso nativo recibe un Buffer, no una ruta o URL suministrada por el cliente.
No se habilitan SVG, PDF, TIFF u otros loaders mediante la ruta HTTP. El resultado
se comprueba por IPC antes de sustituir req.file.buffer.

## Integridad del contenedor y decodificación

Se comprueba framing, no se implementa un decodificador de píxeles propio:

- PNG: CRC de todos los chunks, IHDR válido y límites antes de inflar, IDAT contiguo,
  IEND exacto. Se usa zlib de Node con maxOutputLength según las filas declaradas,
  incluyendo pases Adam7; se exige longitud descomprimida exacta y consumo completo
  del stream comprimido. No se permite otro stream o relleno oculto dentro de IDAT.
- JPEG: recorrido de segmentos, scans y marcadores escapados/restart; EOI debe
  cerrar la imagen completa. Se admiten JPEG progresivos. No hay decodificación
  Huffman/DCT implementada en JavaScript.
- WebP: tamaño RIFF exacto, chunks dentro de límites, padding y una sola imagen;
  se rechazan chunks/flags de animación. libwebp decodifica los píxeles.

Sharp realiza una **decodificación completa y codificación nueva** del mismo formato,
aplicando orientación y quitando metadatos. metadata() por sí solo no basta.
Se usa failOn: warning y, además, se rechaza cualquier evento warning nativo:
se comprobó que un JPEG truncado con EOI falsificado podía producir un buffer
reparado aunque se hubiera seleccionado failOn. No se guarda el texto del warning.

Otra prueba comprobó que sharp toleraba un PNG con muchísimas filas descomprimidas
extra; por eso el control adicional acotado de zlib es necesario y tiene regresión.
La expansión máxima de filas es calculada con dimensiones/tipo/profundidad ya
validados, nunca con un tamaño arbitrario del cliente. PNG de 16 bits puede exigir
hasta unos 64 MB de filas; es memoria nativa adicional al heap, no una promesa de RSS.

Se rechazan chunks PNG no incluidos en la política, incluyendo metadata comprimida
iCCP/zTXt/iTXt y animación; evita descompresión de perfiles/texto sin un presupuesto
de filas. Algunos PNG legítimos con esas características necesitarán exportarse
sin ese metadata. El límite de salida puede rechazar una entrada válida menor de
2 MiB si su recodificación crece; responde 413 y no contacta a Cloudinary.

La validación rechaza los poliglotas añadidos/concatenados de las pruebas. No es un
detector universal de toda interpretación alternativa o esteganografía. Un archivo
estructuralmente válido puede contener datos arbitrarios en metadata admitida o
en sus píxeles; la codificación nueva evita reenviar sus segmentos/metadatos originales.
No se ofrece análisis antivirus o autenticidad criptográfica de la fotografía.

## Multipart y liberación

Multer mantiene un archivo, cero campos y el límite de bytes. Sus errores de límite
siguen respondiendo 413 o 400. Los errores conocidos del parser (boundary ausente,
cabecera malformada, formulario/fichero incompleto) se convierten en 400 genérico.
No se reclasifica cualquier fallo interno como error del cliente.

Se descarta req.file al rechazar. Una desconexión durante validación aborta el
proceso hijo; no se llama al controlador/proveedor después de cerrar la respuesta.
El límite de recepción y permisos Redis de 3B permanece vigente. Si el cliente ya
cerró la conexión no puede garantizarse que reciba un cuerpo HTTP 400/408; sí se
liberan los recursos y se impide continuar la carga remota.

## Respuestas de Cloudinary

Antes de comenzar SQL se exige objeto de respuesta, public_id solicitado,
resource_type=image, type=upload, formato permitido y, cuando proviene del flujo
HTTP, coincidencia con el formato/dimensiones recién decodificados. Son obligatorios
asset_id hexadecimal, version positiva, bytes positivos acotados, dimensiones
válidas y secure_url HTTPS del cloud configurado, public_id/formato/versión exactos,
sin credenciales, parámetros ni fragmentos. Un valor existing debe ser booleano.
Se rechaza una respuesta que contiene un campo error.

Solo una colisión confirmada correctamente conserva el 409 existente. Una respuesta
incompleta/contradictoria es 502 controlado, no éxito ni prueba de que no hubo subida.
La confirmación normal exige también el contexto de pertenencia de 3A. El diario
conserva el identificador generado por el servidor, nunca el ID arbitrario de una
respuesta inválida. La recuperación usa las comprobaciones de scope/contexto,
referencias y cierre durable ya existentes; no se elimina un recurso ajeno.

Las inspecciones nulas/contradictorias del SDK son error incierto, no equivalen a
404. Solo un 404 explícito significa ausencia. Los errores de inspección/borrado
se normalizan sin copiar diagnósticos del proveedor y conservan categoría para H1.
Un destroy nulo no produce TypeError ni se considera confirmado.

Una indicación existing=true incompleta mantiene la intención pendiente para revisión;
no permite limpiar un recurso preexistente. Si la colisión está confirmada, sus
dimensiones pueden diferir de la imagen que se intentaba cargar: sigue siendo 409,
no motivo de compensación. Hay una regresión específica para ambos casos.

No se usan ni retornan la API key, firma u otros campos sobrantes del proveedor.
La URL enviada al cliente sigue generándose con el SDK/identificador de siempre;
no se entrega directamente una URL no confiable del resultado.

## EXIF/GPS y recursos públicos

Se establece una política de privacidad para **nuevas cargas**: quitar EXIF/GPS,
XMP, ICC, comentarios y demás metadatos embebidos; aplicar orientación para que la
retirada de EXIF no gire la imagen de presentación. La prueba genera EXIF/GPS/XMP
y comprueba su ausencia después de codificar, antes de cualquier proveedor.
También se pueden quitar atribuciones/copyright embebidos: es una decisión explícita
de esta política, no un almacenamiento privado de esos campos en MySQL.

La [documentación de sharp](https://sharp.pixelplumbing.com/api-output/#keepmetadata)
describe la retirada predeterminada. La [de Cloudinary](https://cloudinary.com/documentation/image_optimization#metadata_stripping)
describe stripping de imágenes transformadas; eso no permite afirmar que un original
histórico servido sin transformación esté libre de GPS. No se basa la privacidad
de una carga nueva en esa conducta del proveedor.

Las imágenes del catálogo continúan siendo públicas: JWT/RBAC protege la mutación,
no vuelve privada su URL de entrega. No subir documentos o fotografías sensibles.
No se cambiaron URLs históricas, invalidaron caches, reetiquetaron o transformaron
recursos existentes. No se inspeccionó el recurso del producto 4. Una revisión o
saneamiento de originales anteriores necesita autorización y verificación separadas.

## Verificación pendiente y operación

La suite usa decodificación nativa real, procesos locales, mocks del proveedor y
MySQL/Redis descartables. La interoperabilidad del contrato más estricto con la
cuenta real, su URL/contexto y sus transformaciones configuradas necesita una nueva
prueba real autorizada; no se infiere de los mocks. No subir ni borrar recursos
para comprobarlo sin autorización específica.

La dependencia nativa requiere seguimiento de releases/advisories y parches de
seguridad. Mantener aislamiento del sistema operativo, memoria/CPU del contenedor,
TLS y ACL existentes. H4, HA multi-host y eliminación manual de pendientes siguen
fuera de esta fase. El gate completo de npm audit continúa bloqueado por las alertas
conocidas; no se modifica su configuración.
