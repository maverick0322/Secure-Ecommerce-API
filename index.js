const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const fs = require('fs');
const net = require('node:net');
const path = require('path');
const app = express();

// 1. Cargar variables de entorno desde el archivo .env
dotenv.config();

// 1.1 Configuración explícita de TRUST_PROXY (desactivada por defecto, SEC-08)
function resolveTrustProxy(raw = process.env.TRUST_PROXY) {
  if (raw === undefined || raw === null) return false;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === 'false' || trimmed === '0') return false;
  if (trimmed.toLowerCase() === 'true' || trimmed === '*') {
    throw new Error('TRUST_PROXY must be false or an explicit comma-separated list of trusted proxy IPs/CIDRs.');
  }
  const entries = trimmed.split(',').map(item => item.trim()).filter(Boolean);
  for (const entry of entries) {
    const [ip, prefix, extra] = entry.split('/');
    const ipVersion = net.isIP(ip);
    if (!ipVersion || extra !== undefined) {
      throw new Error(`Invalid TRUST_PROXY entry: ${entry}`);
    }
    if (prefix !== undefined) {
      const bits = Number(prefix);
      const maxBits = ipVersion === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefix) || bits < 0 || bits > maxBits) {
        throw new Error(`Invalid TRUST_PROXY CIDR: ${entry}`);
      }
    }
  }
  return entries;
}

// 2. Seguridad defensiva: cabeceras HTTP seguras y supresión de tecnología subyacente (CWE-200, CWE-693)
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  xContentTypeOptions: true
}));
// No proxy headers are trusted implicitly. Changing this requires a reviewed
// deployment-specific proxy allowlist via TRUST_PROXY, never boolean true.
app.set('trust proxy', resolveTrustProxy());
app.use(require('./middlewares/http-logging.middleware'));
app.use(require('./middlewares/audit-logs.middleware'));

// 2.1 Control de caché para rutas con datos personales o respuestas autenticadas (CWE-525)
const NO_STORE_PREFIXES = [
  '/api/users',
  '/api/addresses',
  '/api/orders',
  '/api/cart',
  '/api/checkout',
  '/api/audit-logs',
  '/api/auth'
];
app.use((req, res, next) => {
  const pathLower = (req.path || '').toLowerCase();
  const isSensitiveRoute = NO_STORE_PREFIXES.some(
    prefix => pathLower === prefix || pathLower.startsWith(`${prefix}/`)
  );
  if (isSensitiveRoute || req.headers.authorization) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
  }
  next();
});

// 3. Procesamiento de cuerpos de petición (JSON y URL-encoded)
app.use(express.json());
app.use(express.urlencoded({
  extended: false
}));

// 4. Configuración de CORS: denegar todo por defecto; permitir solo orígenes explícitos vía CORS_ORIGIN
const envOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : [];
if (envOrigins.includes('*')) {
  throw new Error('Configure explicit CORS origins; wildcard access is forbidden.');
}
const allowedOrigins = Array.from(new Set(envOrigins));
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, false);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

// 5. Documentación OpenAPI / Swagger (solo disponible fuera de producción, SEC-06 / CWE-200)
if (process.env.NODE_ENV !== 'production') {
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
}

// 6. Healthcheck mínimo sin autenticación ni datos internos (SEC-11)
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ status: 'ok' });
});

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
    app.listen(PORT,process.env.SERVER_HOST||'127.0.0.1',()=>require('./services/structured-logger.service').log('api.started'));
  }).catch(async()=>{
    require('./services/auth-runtime.service').close();
    require('./services/structured-logger.service').log('api.start.failed');
    await require('./models').sequelize.close();process.exitCode=1;
  });
}
module.exports = app;
