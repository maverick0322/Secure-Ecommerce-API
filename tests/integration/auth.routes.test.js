const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../index');
const { usuario, bitacora } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Autenticación (/api/auth)', () => {
  let adminPasswordHash;

  beforeAll(async () => {
    adminPasswordHash = await bcrypt.hash('patito', 10);
  });

  beforeEach(() => {
    jest.spyOn(bitacora, 'create').mockResolvedValue({});
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

    it('debe responder con 500 si ocurre un fallo en la base de datos al autenticar', async () => {
      jest.spyOn(usuario, 'findOne').mockRejectedValue(new Error('Fallo crítico de BD'));

      const res = await request(app)
        .post('/api/auth')
        .send({ email: 'error@uv.mx', password: 'cualquiera' });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /api/auth/tiempo', () => {
    it('debe rechazar con 401 si no se envía token de autenticación', async () => {
      const res = await request(app).get('/api/auth/tiempo');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 404 si el servicio no puede determinar el tiempo restante', async () => {
      const jwt = require('jsonwebtoken');
      jest.spyOn(jwt, 'verify')
        .mockReturnValueOnce({
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'gvera@uv.mx',
          'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'Administrador'
        })
        .mockImplementationOnce(() => {
          throw new Error('Manipulación de token');
        });

      const res = await request(app)
        .get('/api/auth/tiempo')
        .set('Authorization', 'Bearer token_valido_para_authorize');

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('No se pudo determinar el tiempo');
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
