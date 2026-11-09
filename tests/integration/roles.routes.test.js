const request = require('supertest');
const app = require('../../index');
const {
  Role: role
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
describe('Pruebas de Integración: Endpoints de Roles (/api/roles)', () => {
  let adminToken;
  let userToken;
  beforeAll(() => {
    adminToken = generateToken('admin@uv.mx', 'Administrador General', 'Administrador');
    userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe('GET /api/roles', () => {
    it('debe responder con 401 Unauthorized si la petición carece de token', async () => {
      const res = await request(app).get('/api/roles');
      expect(res.statusCode).toBe(401);
    });
    it('debe responder con 403 Forbidden si el rol no es Administrador', async () => {
      const res = await request(app).get('/api/roles').set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Acceso prohibido');
    });
    it('debe responder con 200 OK y la lista de roles para rol Administrador', async () => {
      jest.spyOn(role, 'findAll').mockResolvedValue([{
        id: 1,
        name: 'Administrador'
      }, {
        id: 2,
        name: 'Usuario'
      }]);
      const res = await request(app).get('/api/roles').set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].name).toBe('Administrador');
    });
    it('debe responder con 500 si ocurre un fallo en la base de datos', async () => {
      jest.spyOn(role, 'findAll').mockRejectedValue(new Error('Fallo de conexión en BD'));
      const res = await request(app).get('/api/roles').set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBeDefined();
    });
  });
});
