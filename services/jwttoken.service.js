const jwt = require('jsonwebtoken');
const ClaimTypes = require('../config/claimtypes');

const getJwtSecret = () => process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';

/**
 * Genera un token JWT de acceso con claims estándar y vigencia de 20 minutos
 */
const GeneraToken = (email, nombre, rol) => {
  const token = jwt.sign(
    {
      [ClaimTypes.Name]: email,
      [ClaimTypes.GivenName]: nombre,
      [ClaimTypes.Role]: rol,
      iss: 'ServidorFeiJWT',
      aud: 'ClientesFeiJWT'
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: '20m' // Ventana efímera de 20 minutos
    }
  );
  return token;
};

/**
 * Calcula el tiempo restante de vigencia del token en formato 00:MM:SS
 */
const TiempoRestanteToken = (req) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.split(' ')[1];
    if (!token) return null;

    const decodedToken = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });

    const tiempoSegundos = Math.max(0, Math.floor(decodedToken.exp - Date.now() / 1000));
    const minutos = Math.floor(tiempoSegundos / 60);
    const segundos = Math.floor(tiempoSegundos % 60);

    return `00:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
  } catch (error) {
    return null;
  }
};

module.exports = { GeneraToken, TiempoRestanteToken };
