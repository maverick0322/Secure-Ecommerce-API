const errorHandler = require('../../middlewares/errorhandler.middleware');

describe('Pruebas Unitarias: errorhandler.middleware.js (Manejo Seguro y Fuga CWE-200)', () => {
  let req, res, next;
  const envOriginal = process.env.NODE_ENV;

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
    process.env.NODE_ENV = envOriginal;
  });

  it('debe responder con statusCode 500 por defecto si el error no define uno', () => {
    const errorGenerico = new Error('Falla imprevista en el sistema');

    errorHandler(errorGenerico, req, res, next);

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
    const errorSensible = new Error('Database password incorrect at mysql.connection.js:45');
    errorSensible.stack = 'Error at connect (/var/app/db.js:10:5)...';

    errorHandler(errorSensible, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const respuesta = res.json.mock.calls[0][0];
    expect(respuesta.stack).toBeUndefined(); // Stack oculto en producción
    expect(respuesta.mensaje).toBe('No se ha podido procesar la petición. Inténtelo nuevamente más tarde.');
  });

  it('en entorno de desarrollo debe exponer el stack trace y detalle para depuración', () => {
    process.env.NODE_ENV = 'development';
    const errorDev = new Error('Error de prueba en desarrollo');
    errorDev.stack = 'Stack de prueba...';

    errorHandler(errorDev, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const respuesta = res.json.mock.calls[0][0];
    expect(respuesta.stack).toBeDefined();
    expect(respuesta.mensaje).toBe('Error de prueba en desarrollo');
  });
});
