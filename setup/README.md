# Instalación local en Windows

Requisitos: Windows con PowerShell 5.1 o posterior, Docker Desktop abierto en modo Linux (contexto `desktop-linux`), Node.js 20 o superior y OpenSSL 3 o posterior disponible como `openssl.exe`. Usa un clon nuevo. Coloca la copia de `.env` en la raíz. Debe conservar `DB_DATABASE=secure_ecommerce` y `DB_USER=ecommerce_app`, que son las identidades que verifica el backend.

```powershell
.\setup\install.ps1
```

El comando usa el Compose de `setup/`, con un nombre de proyecto aleatorio por clon. Solo publica la API y Redis en loopback. MySQL queda en la red privada del proyecto. Los puertos predeterminados son 13000 para la API y 16380 para Redis. Para elegir otros puertos en un **clon todavía no preparado**:

```powershell
.\setup\install.ps1 -ApiPort 13001 -RedisPort 16381
```

La contraseña local de root, la de `ecommerce_app`, Redis, RS256 y los dos secretos HMAC se generan por separado y se guardan debajo de `.secrets/`, fuera de Git y del contexto de construcción. El instalador deja `.env` intacto: los valores copiados de contraseña MySQL, UUID, HMAC y estado Redis **no son los efectivos en este Compose**. Usa la instancia de Compose y evita arrancar `npm start` con el `.env` copiado. El manifiesto Windows usa rutas relativas y el de Docker usa las rutas montadas del contenedor.

El esquema empieza vacío, con las 14 tablas definitivas y sin seeders históricos ni administradores. La cuenta de la API tiene los permisos mínimos del esquema verificado, incluido INSERT en auditoría. La lectura administrativa de auditoría queda sujeta al aprovisionamiento de permisos que ya exige la API. La instalación no concede ese acceso adicional.

Las ejecuciones repetidas vuelven a comprobar la identidad del contenedor, del volumen y de MySQL. No recrean contenedores desaparecidos. Si Redis se reinició y su `run_id` cambió, el inicio se detiene por diseño. Para recuperar **este proyecto** y aceptar expresamente la invalidación de sus sesiones:

```powershell
.\setup\install.ps1 -RecoverRedis
```

No borres archivos parciales o volúmenes para forzar un reintento. Si faltan identidades o el instalador detecta `.secrets` de otra instalación, revisa el estado o usa otro clon. Los certificados vencen y su renovación requiere mantenimiento independiente. El instalador no rota certificados, claves ni contraseñas automáticamente.

Si detuviste manualmente MySQL después de aprovisionarlo, inspecciona su volumen e inicia el contenedor de este proyecto desde Docker Desktop antes de repetir el comando. El instalador no arranca automáticamente un MySQL registrado pero detenido, para evitar una inicialización sobre datos faltantes.

Gmail es opcional para iniciar la infraestructura. Coloca el `client.json` OAuth de tu equipo en `.secrets/gmail/` y usa el asistente existente `npm run gmail:authorize` con tu cuenta, remitente y credenciales OAuth, para generar `token.json`. No copies tokens ajenos. Cloudinary conserva la configuración de `.env`; usa una cuenta o entorno propio antes de subir imágenes. Ninguno de los dos proveedores se comprueba en la instalación. Si modificas variables externas tras crear el contenedor, necesitarás aplicar esos cambios mediante una recreación controlada de la aplicación, conservando sus volúmenes y secretos.
