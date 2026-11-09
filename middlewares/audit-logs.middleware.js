const requestIp = require('request-ip');
const CLAIM_TYPES = require("../config/claim-types");
const {
  AuditLog: auditLog
} = require('../models');
const auditLogger = (req, res, next) => {
  // Obtener la IP real de la petición del cliente
  const ip = requestIp.getClientIp(req) || '127.0.0.1';

  // Inyectar método de registro en la petición
  req.logAudit = async (action, id, userOverride = null) => {
    try {
      let email = 'invitado';
      if (userOverride) {
        email = userOverride;
      } else if (req.decodedToken && req.decodedToken[CLAIM_TYPES.Name]) {
        email = req.decodedToken[CLAIM_TYPES.Name];
      }
      await auditLog.create({
        action: String(action),
        elementId: id ? String(id) : null,
        ip: ip,
        user: email,
        date: new Date()
      });
    } catch (err) {
      console.error('Error al registrar acción en bitácora:', err.message);
    }
  };
  next();
};
module.exports = auditLogger;
