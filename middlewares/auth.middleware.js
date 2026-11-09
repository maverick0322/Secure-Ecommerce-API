const jwt = require('jsonwebtoken');
const CLAIM_TYPES = require("../config/claim-types");
const {
  generateToken
} = require('../services/jwttoken.service');
const getJwtSecret = () => process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';

/**
 * Middleware de Autorización RBAC con renovación continua (renovación continua de token)
 * @param {string} role - Lista de roles permitidos separados por coma (ej: 'Usuario, Administrador')
 */
const authorize = role => {
  return async (req, res, next) => {
    try {
      const authHeader = req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        const error401 = new Error('Acceso no autenticado: Se requiere token Bearer en el encabezado Authorization.');
        error401.statusCode = 401;
        return next(error401);
      }

      // Extracción del token JWT
      const token = authHeader.split(' ')[1];
      if (!token) {
        const error401 = new Error('Acceso no autenticado: Token no proporcionado.');
        error401.statusCode = 401;
        return next(error401);
      }

      // Verificación de integridad y vigencia con algoritmo estricto HS256
      const decodedToken = jwt.verify(token, getJwtSecret(), {
        algorithms: ['HS256']
      });

      // Verificación de Control de Acceso Basado en Roles (RBAC)
      // CORRECCIÓN CRÍTICA DE SEGURIDAD: normalizar con .trim() para evitar que espacios en blanco bloqueen roles legítimos
      const allowedRoles = role.split(',').map(r => r.trim());
      const userRole = decodedToken[CLAIM_TYPES.Role];
      if (!allowedRoles.includes(userRole)) {
        const error403 = new Error(`Acceso prohibido: El rol '${userRole}' no tiene privilegios suficientes para este recurso.`);
        error403.statusCode = 403; // RFC 9110: 403 cuando el usuario está autenticado pero no autorizado
        return next(error403);
      }

      // Inyectar datos del usuario autenticado en la petición
      req.decodedToken = decodedToken;

      // Mecanismo de Renovación Continua (renovación continua de tokens)
      // Si el tiempo de vida restante es menor a 5 minutos, emitir nuevo token en Set-Authorization
      const remainingMinutes = (decodedToken.exp - Date.now() / 1000) / 60;
      if (remainingMinutes > 0 && remainingMinutes < 5) {
        const newToken = generateToken(decodedToken[CLAIM_TYPES.Name], decodedToken[CLAIM_TYPES.GivenName], decodedToken[CLAIM_TYPES.Role]);
        res.header('Set-Authorization', newToken);
      }
      next();
    } catch (error) {
      error.statusCode = 401;
      error.message = 'Acceso no autenticado: Token inválido o expirado.';
      next(error);
    }
  };
};
module.exports = authorize;
