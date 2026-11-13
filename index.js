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
app.use(express.urlencoded({
  extended: false
}));

// 4. Configuración de CORS con lista blanca dinámica
const defaultOrigins = ['http://localhost:8080', 'http://localhost:8081'];
const envOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean) : [];
if(envOrigins.includes('*')) throw new Error('Configure explicit CORS origins; wildcard access is forbidden.');
const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origen no permitido por política CORS: ${origin}`));
  },
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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
      message: 'La especificación Swagger aún no ha sido generada. Ejecute: npm run swagger'
    });
  });
}

// 6. Middleware global de bitácora y auditoría
app.use(require("./middlewares/audit-logs.middleware"));

// 7. Enrutamiento de recursos de la API
app.use("/api/categories", require("./routes/categories.routes"));
app.use("/api/products", require("./routes/products.routes"));
app.use("/api/users", require("./routes/users.routes"));
app.use('/api/roles', require('./routes/roles.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use("/api/files", require("./routes/files.routes"));
app.use("/api/audit-logs", require("./routes/audit-logs.routes"));
app.use('/api/addresses', require('./routes/addresses.routes'));
app.use('/api/cart', require('./routes/cart.routes'));
app.use('/api/checkout', require('./routes/checkout.routes'));
app.use('/api/orders', require('./routes/orders.routes'));

// 8. Manejo de recursos no encontrados (404) para todos los verbos HTTP
app.use((req, res) => {
  res.status(404).json({
    message: 'Recurso no encontrado'
  });
});

// 9. Middleware centralizado de manejo y registro de errores
const errorHandler = require('./middlewares/errorhandler.middleware');
app.use(errorHandler);

// 10. Inicialización del servidor HTTP solo en ejecución directa
const PORT = process.env.SERVER_PORT || 3000;
if (require.main === module) {
  Promise.resolve().then(async()=>{
    require('./services/jwttoken.service').getJwtSecret();
    await require('./services/auth-runtime.service').getRuntime();
    await require('./services/database.service').verifyConnection(require('./models').sequelize);
    require('./services/product-images.service').startRecovery();
    app.listen(PORT,process.env.SERVER_HOST||'127.0.0.1',()=>console.log(`API conectada a secure_ecommerce; puerto ${PORT}.`));
  }).catch(async()=>{
    require('./services/auth-runtime.service').close();
    console.error('No se pudo verificar la conexión segura. La API no se inició.');
    await require('./models').sequelize.close();process.exitCode=1;
  });
}
module.exports = app;
