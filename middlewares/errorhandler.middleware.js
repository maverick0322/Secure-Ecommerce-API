const fs = require('fs');
const path = require('path');
const requestIp = require('request-ip');
const CLAIM_TYPES = require("../config/claim-types");
const logDirectory = path.resolve(__dirname, '../log');
const logFilePath = path.join(logDirectory, 'log.txt');

// Asegurar que el directorio de logs exista para evitar excepciones de E/S
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, {
    recursive: true
  });
}
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  let message = 'No se ha podido procesar la petición. Inténtelo nuevamente más tarde.';
  const statusCode = err.statusCode || 500;

  // Obtener la IP real de la petición resolviendo encabezados de proxy/forwarded
  const ip = requestIp.getClientIp(req) || 'Desconocida';

  // Obtener el correo del usuario a partir del token decodificado
  let email = 'Anonimo';
  if (req.decodedToken && req.decodedToken[CLAIM_TYPES.Name]) {
    email = req.decodedToken[CLAIM_TYPES.Name];
  }

  // Registro persistente en bitácora física de texto
  const logLine = `${new Date().toISOString()} - [${statusCode}] - [IP: ${ip}] - [Usuario: ${email}] - ${err.message || message}\n`;
  fs.appendFile(logFilePath, logLine, writeErr => {
    if (writeErr) {
      console.error('Error al escribir en log/log.txt:', writeErr);
    }
  });

  // Manejo de mensajes de error seguros:
  // - Para errores de cliente (4xx), el mensaje es funcional y seguro de mostrar al usuario.
  // - Para errores de servidor (5xx), en producción se sanitiza para prevenir CWE-200 (fuga de información sensible).
  if (statusCode < 500) {
    message = err.message || 'Petición inválida';
  } else if (process.env.NODE_ENV === 'development') {
    message = err.message || message;
  }
  const responseBody = {
    status: statusCode,
    message
  };
  if (process.env.NODE_ENV === 'development') {
    responseBody.stack = err.stack;
  }
  res.status(statusCode).json(responseBody);
};
module.exports = errorHandler;
