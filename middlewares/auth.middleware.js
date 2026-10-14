const jwt = require('jsonwebtoken');
const ClaimTypes = require('../config/claimtypes');
const { GeneraToken } = require('../services/jwttoken.service');

const getJwtSecret = () => process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';

/**
 * Middleware de Autorización RBAC con renovación continua (Rolling Token)
 * @param {string} rol - Lista de roles permitidos separados por coma (ej: 'Usuario, Administrador')
 */
const Authorize = (rol) => {
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
      const decodedToken = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });

      // Verificación de Control de Acceso Basado en Roles (RBAC)
      // CORRECCIÓN CRÍTICA DE SEGURIDAD: normalizar con .trim() para evitar que espacios en blanco bloqueen roles legítimos
      const rolesPermitidos = rol.split(',').map(r => r.trim());
      const rolUsuario = decodedToken[ClaimTypes.Role];

      if (!rolesPermitidos.includes(rolUsuario)) {
        const error403 = new Error(`Acceso prohibido: El rol '${rolUsuario}' no tiene privilegios suficientes para este recurso.`);
        error403.statusCode = 403; // RFC 9110: 403 Forbidden cuando el usuario está autenticado pero no autorizado
        return next(error403);
      }

      // Inyectar datos del usuario autenticado en la petición
      req.decodedToken = decodedToken;

      // Mecanismo de Renovación Continua (Rolling Tokens)
      // Si el tiempo de vida restante es menor a 5 minutos, emitir nuevo token en Set-Authorization
      const minutosRestantes = (decodedToken.exp - Date.now() / 1000) / 60;
      if (minutosRestantes > 0 && minutosRestantes < 5) {
        const nuevoToken = GeneraToken(
          decodedToken[ClaimTypes.Name],
          decodedToken[ClaimTypes.GivenName],
          decodedToken[ClaimTypes.Role]
        );
        res.header('Set-Authorization', nuevoToken);
      }

      next();
    } catch (error) {
      error.statusCode = 401;
      error.message = 'Acceso no autenticado: Token inválido o expirado.';
      next(error);
    }
  };
};

module.exports = Authorize;
