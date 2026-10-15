const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const app = express();

// 1. Cargar variables de entorno desde el archivo .env
dotenv.config();

// 2. Seguridad defensiva: suprimir cabecera de tecnología subyacente (CWE-200)
app.disable('x-powered-by');

// 3. Procesamiento de cuerpos de petición (JSON y URL-encoded)
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 4. Configuración de CORS con lista blanca dinámica y exposición de cabeceras de renovación
const defaultOrigins = ['http://localhost:8080', 'http://localhost:8081'];
const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [];
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por política CORS: ${origin}`));
  },
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // CORRECCIÓN CRÍTICA: Exponer Set-Authorization para que clientes frontend puedan leer el token renovado
  exposedHeaders: ['Set-Authorization']
};
app.use(cors(corsOptions));

// 5. Documentación OpenAPI / Swagger
const swaggerFilePath = path.resolve(__dirname, './swagger-output.json');
if (fs.existsSync(swaggerFilePath)) {
  const swaggerUi = require('swagger-ui-express');
  const swaggerFile = require(swaggerFilePath);
  app.use('/swagger', swaggerUi.serve, swaggerUi.setup(swaggerFile));
} else {
  // Manejo resiliente: si aún no se ha ejecutado 'npm run swagger', no derribar la aplicación
  app.get('/swagger', (req, res) => {
    res.status(503).json({
      mensaje: 'La especificación Swagger aún no ha sido generada. Ejecute: npm run swagger'
    });
  });
}

// 6. Middleware global de bitácora y auditoría
app.use(require('./middlewares/bitacora.middleware'));

// 7. Enrutamiento de recursos de la API
app.use('/api/categorias', require('./routes/categorias.routes'));
app.use('/api/productos', require('./routes/productos.routes'));
app.use('/api/usuarios', require('./routes/usuarios.routes'));
app.use('/api/roles', require('./routes/roles.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/archivos', require('./routes/archivos.routes'));
app.use('/api/bitacora', require('./routes/bitacora.routes'));

// 8. Manejo de recursos no encontrados (404) para todos los verbos HTTP
app.use((req, res) => {
  res.status(404).json({ mensaje: 'Recurso no encontrado' });
});

// 9. Middleware centralizado de manejo y registro de errores
const errorHandler = require('./middlewares/errorhandler.middleware');
app.use(errorHandler);

// 10. Inicialización del servidor HTTP solo en ejecución directa
const PORT = process.env.SERVER_PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Aplicación E-Commerce escuchando en el puerto ${PORT}`);
    console.log(`Entorno actual: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Documentación disponible en: http://localhost:${PORT}/swagger`);
  });
}

module.exports = app;

