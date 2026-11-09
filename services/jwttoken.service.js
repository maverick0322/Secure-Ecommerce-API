const jwt = require('jsonwebtoken');
const CLAIM_TYPES = require("../config/claim-types");
const getJwtSecret = () => process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';

/**
 * Genera un token JWT de acceso con atributos estándar y vigencia de 20 minutos
 */
const generateToken = (email, name, role) => {
  const token = jwt.sign({
    [CLAIM_TYPES.Name]: email,
    [CLAIM_TYPES.GivenName]: name,
    [CLAIM_TYPES.Role]: role,
    iss: 'ServidorFeiJWT',
    aud: 'ClientesFeiJWT'
  }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '20m' // Ventana efímera de 20 minutos
  });
  return token;
};

/**
 * Calcula el tiempo restante de vigencia del token en formato 00:MM:SS
 */
const getRemainingTokenTime = req => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.split(' ')[1];
    if (!token) return null;
    const decodedToken = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256']
    });
    const remainingSeconds = Math.max(0, Math.floor(decodedToken.exp - Date.now() / 1000));
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    return `00:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } catch (error) {
    return null;
  }
};
module.exports = {
  generateToken,
  getRemainingTokenTime
};
