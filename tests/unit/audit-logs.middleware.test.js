const auditLogger = require("../../middlewares/audit-logs.middleware");
const CLAIM_TYPES = require("../../config/claim-types");
const {
  AuditLog: auditLog
} = require('../../models');
const requestIp = require('request-ip');
describe('Pruebas unitarias: audit-logs.middleware.js (Auditoría e Inmutabilidad)', () => {
  let req;
  let res;
  let next;
  beforeEach(() => {
    req = {};
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });
  it('debe inyectar la función req.logAudit y llamar a next()', () => {
    auditLogger(req, res, next);
    expect(typeof req.logAudit).toBe('function');
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('debe capturar la IP real del cliente mediante request-ip', async () => {
    jest.spyOn(requestIp, 'getClientIp').mockReturnValue('192.168.1.100');
    const spyCreate = jest.spyOn(auditLog, 'create').mockResolvedValue({});
    auditLogger(req, res, next);
    await req.logAudit('categoria.crear', 5);
    expect(spyCreate).toHaveBeenCalledWith(expect.objectContaining({
      ip: '192.168.1.100',
      action: 'categoria.crear',
      elementId: '5'
    }));
  });
  it('debe utilizar 127.0.0.1 como alternativa si request-ip devuelve null', async () => {
    jest.spyOn(requestIp, 'getClientIp').mockReturnValue(null);
    const spyCreate = jest.spyOn(auditLog, 'create').mockResolvedValue({});
    auditLogger(req, res, next);
    await req.logAudit('test.accion', null);
    expect(spyCreate).toHaveBeenCalledWith(expect.objectContaining({
      ip: '127.0.0.1',
      elementId: null
    }));
  });
  it('debe registrar el usuario autenticado desde los atributos del token decodificado', async () => {
    req.decodedToken = {
      [CLAIM_TYPES.Name]: 'operador@uv.mx'
    };
    const spyCreate = jest.spyOn(auditLog, 'create').mockResolvedValue({});
    auditLogger(req, res, next);
    await req.logAudit('producto.crear', 10);
    expect(spyCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: 'operador@uv.mx'
    }));
  });
  it('debe priorizar userOverride si se proporciona explícitamente', async () => {
    req.decodedToken = {
      [CLAIM_TYPES.Name]: 'token_user@uv.mx'
    };
    const spyCreate = jest.spyOn(auditLog, 'create').mockResolvedValue({});
    auditLogger(req, res, next);
    await req.logAudit('auth.login', null, 'usuario_login@uv.mx');
    expect(spyCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: 'usuario_login@uv.mx'
    }));
  });
  it('debe asignar el usuario como "invitado" si no hay token ni usuario sobrescrito', async () => {
    const spyCreate = jest.spyOn(auditLog, 'create').mockResolvedValue({});
    auditLogger(req, res, next);
    await req.logAudit('auth.fallido', null);
    expect(spyCreate).toHaveBeenCalledWith(expect.objectContaining({
      user: 'invitado'
    }));
  });
  it('resiliencia: si AuditLog.create falla, debe atrapar el error sin interrumpir el flujo', async () => {
    const spyError = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(auditLog, 'create').mockRejectedValue(new Error('Conexión perdida a base de datos de auditoría'));
    auditLogger(req, res, next);
    await expect(req.logAudit('fallo.test', 1)).resolves.not.toThrow();
    expect(spyError).toHaveBeenCalled();
    spyError.mockRestore();
  });
});
