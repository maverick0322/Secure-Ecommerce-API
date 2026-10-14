const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../index');
const { usuario } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Autenticación (/api/auth)', () => {
  let adminPasswordHash;

  beforeAll(async () => {
    adminPasswordHash = await bcrypt.hash('patito', 10);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/auth (Inicio de Sesión)', () => {
    it('debe responder con 400 Bad Request si faltan las credenciales', async () => {
      const res = await request(app)
        .post('/api/auth')
        .send({ email: 'gvera@uv.mx' }); // Sin password

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('requeridos');
    });

    it('debe responder con 401 Unauthorized si el usuario no existe', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth')
        .send({ email: 'inexistente@uv.mx', password: 'password123' });

      expect(res.statusCode).toBe(401);
      expect(res.body.mensaje).toContain('incorrectos');
    });

    it('debe responder con 401 Unauthorized si la contraseña es incorrecta', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue({
        id: 'mock-uuid-admin',
        email: 'gvera@uv.mx',
        nombre: 'Guillermo Vera',
        passwordhash: adminPasswordHash,
        rol: 'Administrador'
      });

      const res = await request(app)
        .post('/api/auth')
        .send({ email: 'gvera@uv.mx', password: 'password_equivocada' });

      expect(res.statusCode).toBe(401);
      expect(res.body.mensaje).toContain('incorrectos');
    });

    it('debe responder con 200 OK y devolver un JWT válido con las credenciales correctas', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue({
        id: 'mock-uuid-admin',
        email: 'gvera@uv.mx',
        nombre: 'Guillermo Vera',
        passwordhash: adminPasswordHash,
        rol: 'Administrador'
      });

      const res = await request(app)
        .post('/api/auth')
        .send({ email: 'gvera@uv.mx', password: 'patito' });

      expect(res.statusCode).toBe(200);
      expect(res.body.email).toBe('gvera@uv.mx');
      expect(res.body.nombre).toBe('Guillermo Vera');
      expect(res.body.rol).toBe('Administrador');
      expect(res.body.jwt).toBeDefined();
      expect(res.body.jwt.split('.').length).toBe(3);
    });
  });

  describe('GET /api/auth/tiempo', () => {
    it('debe rechazar con 401 si no se envía token', async () => {
      const res = await request(app).get('/api/auth/tiempo');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 200 OK y el tiempo restante de sesión con un token válido', async () => {
      const token = GeneraToken('gvera@uv.mx', 'Guillermo Vera', 'Administrador');

      const res = await request(app)
        .get('/api/auth/tiempo')
        .set('Authorization', `Bearer ${token}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.tiempoRestante).toBeDefined();
      expect(res.body.tiempoRestante).toMatch(/^00:(19|20):[0-5][0-9]$/);
    });
  });
});
