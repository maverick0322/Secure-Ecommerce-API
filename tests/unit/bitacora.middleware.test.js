const bitacoralogger = require('../../middlewares/bitacora.middleware');
const ClaimTypes = require('../../config/claimtypes');
const { bitacora } = require('../../models');
const requestIp = require('request-ip');

describe('Pruebas Unitarias: bitacora.middleware.js (Auditoría e Inmutabilidad)', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {};
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });

  it('debe inyectar la función req.bitacora y llamar a next()', () => {
    bitacoralogger(req, res, next);

    expect(typeof req.bitacora).toBe('function');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('debe capturar la IP real del cliente mediante request-ip', async () => {
    jest.spyOn(requestIp, 'getClientIp').mockReturnValue('192.168.1.100');
    const spyCreate = jest.spyOn(bitacora, 'create').mockResolvedValue({});

    bitacoralogger(req, res, next);
    await req.bitacora('categoria.crear', 5);

    expect(spyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '192.168.1.100',
        accion: 'categoria.crear',
        elementoid: '5'
      })
    );
  });

  it('debe utilizar 127.0.0.1 como fallback si request-ip devuelve null', async () => {
    jest.spyOn(requestIp, 'getClientIp').mockReturnValue(null);
    const spyCreate = jest.spyOn(bitacora, 'create').mockResolvedValue({});

    bitacoralogger(req, res, next);
    await req.bitacora('test.accion', null);

    expect(spyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ip: '127.0.0.1',
        elementoid: null
      })
    );
  });

  it('debe registrar el usuario autenticado desde los claims del token decodificado', async () => {
    req.decodedToken = {
      [ClaimTypes.Name]: 'operador@uv.mx'
    };
    const spyCreate = jest.spyOn(bitacora, 'create').mockResolvedValue({});

    bitacoralogger(req, res, next);
    await req.bitacora('producto.crear', 10);

    expect(spyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        usuario: 'operador@uv.mx'
      })
    );
  });

  it('debe priorizar usuarioSobrescrito si se proporciona explícitamente', async () => {
    req.decodedToken = {
      [ClaimTypes.Name]: 'token_user@uv.mx'
    };
    const spyCreate = jest.spyOn(bitacora, 'create').mockResolvedValue({});

    bitacoralogger(req, res, next);
    await req.bitacora('auth.login', null, 'usuario_login@uv.mx');

    expect(spyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        usuario: 'usuario_login@uv.mx'
      })
    );
  });

  it('debe asignar el usuario como "invitado" si no hay token ni usuario sobrescrito', async () => {
    const spyCreate = jest.spyOn(bitacora, 'create').mockResolvedValue({});

    bitacoralogger(req, res, next);
    await req.bitacora('auth.fallido', null);

    expect(spyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        usuario: 'invitado'
      })
    );
  });

  it('resiliencia: si bitacora.create falla, debe atrapar el error sin interrumpir el flujo', async () => {
    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(bitacora, 'create').mockRejectedValue(new Error('Conexión perdida a base de datos de auditoría'));

    bitacoralogger(req, res, next);
    await expect(req.bitacora('fallo.test', 1)).resolves.not.toThrow();

    expect(spyError).toHaveBeenCalled();
    spyError.mockRestore();
  });
});
