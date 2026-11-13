const errorHandler = require('../../middlewares/errorhandler.middleware');
describe('Pruebas Unitarias: errorhandler.middleware.js (Manejo Seguro y Fuga CWE-200)', () => {
  let req, res, next;
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    req = {
      decodedToken: {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'test@uv.mx'
      }
    };
    res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    next = jest.fn();
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
  it('debe responder con statusCode 500 por defecto si el error no define uno', () => {
    const genericError = new Error('Falla imprevista en el sistema');
    errorHandler(genericError, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalled();
  });
  it('debe respetar el statusCode asignado en el error (ej: 400 Bad Request)', () => {
    const error400 = new Error('Parámetros inválidos');
    error400.statusCode = 400;
    errorHandler(error400, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
  });
  it('CWE-200: en entorno de producción debe ocultar el stack trace y devolver mensaje sanitizado', () => {
    process.env.NODE_ENV = 'production';
    const sensitiveError = new Error('Contraseña de base de datos incorrecta en mysql.connection.js:45');
    sensitiveError.stack = 'Error de conexión (/var/app/db.js:10:5)...';
    errorHandler(sensitiveError, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const response = res.json.mock.calls[0][0];
    expect(response.stack).toBeUndefined(); // Traza oculta en producción
    expect(response.message).toBe('No se ha podido procesar la petición. Inténtelo nuevamente más tarde.');
  });
  it('también oculta detalles internos y stack en desarrollo', () => {
    process.env.NODE_ENV = 'development';
    const errorDev = new Error('Error de prueba en desarrollo');
    errorDev.stack = 'Traza de prueba...';
    errorHandler(errorDev, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const response = res.json.mock.calls[0][0];
    expect(response.stack).toBeUndefined();
    expect(response.message).toBe('No se ha podido procesar la petición. Inténtelo nuevamente más tarde.');
  });
});
