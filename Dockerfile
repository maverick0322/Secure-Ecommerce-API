# Imagen base oficial y ligera basada en Alpine Linux (Principio de superficie mínima de ataque)
FROM node:20-alpine

# Definir directorio de trabajo de la aplicación
WORKDIR /usr/src/app

# Instalar dependencias del proyecto primero para aprovechar el caché de capas de Docker
COPY package*.json ./

RUN npm install

# Copiar el código fuente del proyecto
COPY . .

# Asegurar existencia de directorios de almacenamiento y logs con permisos adecuados para usuario sin privilegios
RUN mkdir -p uploads log && chown -R node:node /usr/src/app

# Seguridad Defensiva (Principio de Menor Privilegio): Ejecutar como usuario 'node' no privilegiado (no-root)
USER node

# Exponer el puerto de la API REST
EXPOSE 3000

# Comando de inicio predeterminado
CMD ["node", "index.js"]
