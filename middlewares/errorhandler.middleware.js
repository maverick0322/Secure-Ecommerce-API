const fs = require('fs');
const path = require('path');
const {isIP} = require('node:net');
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
  const candidate = Number(err.statusCode || err.status);
  const statusCode = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;

  // Obtener la IP real de la petición resolviendo encabezados de proxy/forwarded
  const ip = isIP(req.ip || '') ? req.ip : 'Desconocida';

  // Obtener el correo del usuario a partir del token decodificado
  const actor = typeof req.account?.id === 'string' && /^[0-9a-f-]{36}$/i.test(req.account.id) ? req.account.id : 'Anonimo';
  const kind = /^[A-Za-z.]{1,80}$/.test(err.name || '') ? err.name : 'Error';

  // Registro persistente en bitácora física de texto
  const logLine = `${new Date().toISOString()} - [${statusCode}] - [IP: ${ip}] - [Actor: ${actor}] - ${kind}\n`;
  fs.appendFile(logFilePath, logLine, writeErr => {
    if (writeErr) {
      console.error('Error al escribir en log/log.txt:', writeErr);
    }
  });

  // Manejo de mensajes de error seguros:
  // - Para errores de cliente (4xx), el mensaje es funcional y seguro de mostrar al usuario.
  // - Para errores de servidor (5xx), en producción se sanitiza para prevenir CWE-200 (fuga de información sensible).
  if (statusCode < 500) {
    message = err.type ? 'Petición inválida.' : (err.message || 'Petición inválida');
  }
  const responseBody = {
    status: statusCode,
    message
  };
  res.status(statusCode).json(responseBody);
};
module.exports = errorHandler;
