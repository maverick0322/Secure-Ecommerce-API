const authorize = require('../../middlewares/auth.middleware');
const {
  generateToken
} = require('../../services/jwttoken.service');
const jwt = require('jsonwebtoken');
describe('Pruebas Unitarias: auth.middleware.js (RBAC y Rolling Tokens)', () => {
  let req, res, next;
  beforeEach(() => {
    req = {
      header: jest.fn()
    };
    res = {
      header: jest.fn()
    };
    next = jest.fn();
  });
  it('debe rechazar con 401 si no se envía la cabecera Authorization', async () => {
    req.header.mockReturnValue(undefined);
    const middleware = authorize('Administrador');
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const capturedError = next.mock.calls[0][0];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.statusCode).toBe(401);
  });
  it('debe rechazar con 401 si la cabecera no inicia con Bearer', async () => {
    req.header.mockReturnValue('TokenSinBearer eyJhbGci...');
    const middleware = authorize('Administrador');
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const capturedError = next.mock.calls[0][0];
    expect(capturedError.statusCode).toBe(401);
  });
  it('debe rechazar con 401 si el token JWT es inválido o está firmado con otra clave', async () => {
    req.header.mockReturnValue('Bearer token_totalmente_invalido');
    const middleware = authorize('Administrador');
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const capturedError = next.mock.calls[0][0];
    expect(capturedError.statusCode).toBe(401);
  });
  it('CORRECCIÓN DE BUG: debe autorizar al Administrador cuando la regla tiene espacios ("Usuario, Administrador")', async () => {
    const adminToken = generateToken('admin@uv.mx', 'Guillermo Vera', 'Administrador');
    req.header.mockReturnValue(`Bearer ${adminToken}`);

    // En el PDF original, 'Usuario, Administrador'.split(',') dejaba ' Administrador' con espacio y bloqueaba al Admin
    const middleware = authorize('Usuario, Administrador');
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledWith(); // next() llamado sin error
    expect(req.decodedToken).toBeDefined();
    expect(req.decodedToken['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']).toBe('Administrador');
  });
  it('debe rechazar con 403 Forbidden si el rol no tiene permisos suficientes', async () => {
    const userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
    req.header.mockReturnValue(`Bearer ${userToken}`);

    // Recurso exclusivo para Administrador
    const middleware = authorize('Administrador');
    await middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const capturedError = next.mock.calls[0][0];
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.statusCode).toBe(403);
    expect(capturedError.message).toContain('Acceso prohibido');
  });
  it('debe emitir cabecera Set-Authorization cuando restan menos de 5 minutos de sesión', async () => {
    // Generar un token con expiración forzada a 3 minutos restantes
    const secretKey = process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const nearlyExpiredToken = jwt.sign({
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'admin@uv.mx',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Admin',
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'Administrador',
      exp: nowInSeconds + 3 * 60 // Expira en 3 minutos (< 5 min)
    }, secretKey, {
      algorithm: 'HS256'
    });
    req.header.mockReturnValue(`Bearer ${nearlyExpiredToken}`);
    const middleware = authorize('Administrador');
    await middleware(req, res, next);
    expect(res.header).toHaveBeenCalledWith('Set-Authorization', expect.any(String));
    expect(next).toHaveBeenCalledWith();
  });
});
