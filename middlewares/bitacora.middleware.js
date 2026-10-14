const requestIp = require('request-ip');
const ClaimTypes = require('../config/claimtypes');
const { bitacora } = require('../models');

const bitacoralogger = (req, res, next) => {
  // Obtener la IP real de la petición del cliente
  const ip = requestIp.getClientIp(req) || '127.0.0.1';

  // Inyectar método de registro en la petición
  req.bitacora = async (accion, id, usuarioSobrescrito = null) => {
    try {
      let email = 'invitado';

      if (usuarioSobrescrito) {
        email = usuarioSobrescrito;
      } else if (req.decodedToken && req.decodedToken[ClaimTypes.Name]) {
        email = req.decodedToken[ClaimTypes.Name];
      }

      await bitacora.create({
        accion: String(accion),
        elementoid: id ? String(id) : null,
        ip: ip,
        usuario: email,
        fecha: new Date()
      });
    } catch (err) {
      console.error('Error al registrar acción en bitácora:', err.message);
    }
  };

  next();
};

module.exports = bitacoralogger;
