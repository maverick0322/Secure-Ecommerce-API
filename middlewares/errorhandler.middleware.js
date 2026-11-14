const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // Express's default final handler prints raw error stacks. A partial
    // response cannot be replaced; close it and let the HTTP logger record it.
    return res.destroy();
  }
  let message = 'No se ha podido procesar la petición. Inténtelo nuevamente más tarde.';
  const candidate = Number(err.statusCode || err.status);
  const statusCode = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;

  // The global HTTP logger owns the single request record, including failures.
  // Never log err.message, stack, provider payloads or request bodies here.

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
