const jwt = require('jsonwebtoken');
const ClaimTypes = require('../../config/claimtypes');
const { GeneraToken, TiempoRestanteToken } = require('../../services/jwttoken.service');

describe('Pruebas Unitarias: jwttoken.service.js', () => {
  const mockEmail = 'admin@uv.mx';
  const mockNombre = 'Administrador Sistema';
  const mockRol = 'Administrador';
  const secretKey = process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';

  describe('Función GeneraToken', () => {
    it('debe generar un JWT con estructura válida de 3 partes separadas por puntos', () => {
      const token = GeneraToken(mockEmail, mockNombre, mockRol);
      expect(typeof token).toBe('string');
      const partes = token.split('.');
      expect(partes.length).toBe(3);
    });

    it('debe incluir los claims estándar requeridos en el payload', () => {
      const token = GeneraToken(mockEmail, mockNombre, mockRol);
      const decoded = jwt.verify(token, secretKey);

      expect(decoded[ClaimTypes.Name]).toBe(mockEmail);
      expect(decoded[ClaimTypes.GivenName]).toBe(mockNombre);
      expect(decoded[ClaimTypes.Role]).toBe(mockRol);
      expect(decoded.iss).toBe('ServidorFeiJWT');
      expect(decoded.aud).toBe('ClientesFeiJWT');
    });

    it('debe fijar una ventana de expiración de 20 minutos (1200 segundos)', () => {
      const token = GeneraToken(mockEmail, mockNombre, mockRol);
      const decoded = jwt.verify(token, secretKey);

      const duracionSegundos = decoded.exp - decoded.iat;
      expect(duracionSegundos).toBe(20 * 60); // 1200 segundos
    });
  });

  describe('Función TiempoRestanteToken', () => {
    it('debe calcular correctamente el tiempo restante en formato 00:MM:SS', () => {
      const token = GeneraToken(mockEmail, mockNombre, mockRol);
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${token}`)
      };

      const tiempo = TiempoRestanteToken(req);
      expect(tiempo).toMatch(/^00:(19|20):[0-5][0-9]$/);
    });

    it('debe retornar null si la cabecera Authorization está ausente', () => {
      const req = {
        header: jest.fn().mockReturnValue(undefined)
      };

      const tiempo = TiempoRestanteToken(req);
      expect(tiempo).toBeNull();
    });

    it('debe retornar null si la cabecera no utiliza el esquema Bearer', () => {
      const req = {
        header: jest.fn().mockReturnValue('Basic dXNlcjpwYXNz')
      };

      const tiempo = TiempoRestanteToken(req);
      expect(tiempo).toBeNull();
    });

    it('debe retornar null si el token es inválido o está manipulado', () => {
      const req = {
        header: jest.fn().mockReturnValue('Bearer token_falso_invalido_123')
      };

      const tiempo = TiempoRestanteToken(req);
      expect(tiempo).toBeNull();
    });
  });
});
