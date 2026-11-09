const jwt = require('jsonwebtoken');
const CLAIM_TYPES = require("../../config/claim-types");
const {
  generateToken,
  getRemainingTokenTime
} = require('../../services/jwttoken.service');
describe('Pruebas Unitarias: jwttoken.service.js', () => {
  const mockEmail = 'admin@uv.mx';
  const mockName = 'Administrador Sistema';
  const mockRole = 'Administrador';
  const secretKey = process.env.JWT_SECRET || 'secret_fallback_key_35_bytes_hex_secure_default';
  describe('Función generateToken', () => {
    it('debe generar un JWT con estructura válida de 3 partes separadas por puntos', () => {
      const token = generateToken(mockEmail, mockName, mockRole);
      expect(typeof token).toBe('string');
      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });
    it('debe incluir los atributos estándar requeridos en el payload', () => {
      const token = generateToken(mockEmail, mockName, mockRole);
      const decoded = jwt.verify(token, secretKey);
      expect(decoded[CLAIM_TYPES.Name]).toBe(mockEmail);
      expect(decoded[CLAIM_TYPES.GivenName]).toBe(mockName);
      expect(decoded[CLAIM_TYPES.Role]).toBe(mockRole);
      expect(decoded.iss).toBe('ServidorFeiJWT');
      expect(decoded.aud).toBe('ClientesFeiJWT');
    });
    it('debe fijar una ventana de expiración de 20 minutos (1200 segundos)', () => {
      const token = generateToken(mockEmail, mockName, mockRole);
      const decoded = jwt.verify(token, secretKey);
      const durationSeconds = decoded.exp - decoded.iat;
      expect(durationSeconds).toBe(20 * 60); // 1200 segundos
    });
  });
  describe('Función getRemainingTokenTime', () => {
    it('debe calcular correctamente el tiempo restante en formato 00:MM:SS', () => {
      const token = generateToken(mockEmail, mockName, mockRole);
      const req = {
        header: jest.fn().mockReturnValue(`Bearer ${token}`)
      };
      const time = getRemainingTokenTime(req);
      expect(time).toMatch(/^00:(19|20):[0-5][0-9]$/);
    });
    it('debe retornar null si la cabecera Authorization está ausente', () => {
      const req = {
        header: jest.fn().mockReturnValue(undefined)
      };
      const time = getRemainingTokenTime(req);
      expect(time).toBeNull();
    });
    it('debe retornar null si la cabecera no utiliza el esquema Bearer', () => {
      const req = {
        header: jest.fn().mockReturnValue('Basic dXNlcjpwYXNz')
      };
      const time = getRemainingTokenTime(req);
      expect(time).toBeNull();
    });
    it('debe retornar null si el token es inválido o está manipulado', () => {
      const req = {
        header: jest.fn().mockReturnValue('Bearer token_falso_invalido_123')
      };
      const time = getRemainingTokenTime(req);
      expect(time).toBeNull();
    });
  });
});
