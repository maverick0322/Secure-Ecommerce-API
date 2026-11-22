# Etapa 1: Generación de artefactos de compilación (Swagger OpenAPI para entornos no productivos)
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY index.js swagger.js ./
COPY config/ ./config/
COPY controllers/ ./controllers/
COPY middlewares/ ./middlewares/
COPY models/ ./models/
COPY routes/ ./routes/
COPY services/ ./services/
COPY validators/ ./validators/

RUN npm run swagger

# Etapa 2: Dependencias exclusivas de producción (sin devDependencies)
FROM node:24-alpine AS deps

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Etapa 3: Imagen final endurecida de ejecución (principio de mínima superficie y menor privilegio)
FROM node:24-alpine

WORKDIR /usr/src/app

COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY package.json ./
COPY index.js ./
COPY config/ ./config/
COPY controllers/ ./controllers/
COPY middlewares/ ./middlewares/
COPY models/ ./models/
COPY routes/ ./routes/
COPY services/ ./services/
COPY validators/ ./validators/
COPY --from=builder /usr/src/app/swagger-output.json ./swagger-output.json

RUN mkdir -p uploads log && chown node:node uploads log

USER node

EXPOSE 3000
ENV SERVER_HOST=0.0.0.0

CMD ["node", "index.js"]
