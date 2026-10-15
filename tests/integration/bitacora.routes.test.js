const request = require('supertest');
const app = require('../../index');
const { bitacora } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Bitácora (/api/bitacora)', () => {
  let adminToken;
  let usuarioToken;

  beforeAll(() => {
    adminToken = GeneraToken('admin@uv.mx', 'Administrador General', 'Administrador');
    usuarioToken = GeneraToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/bitacora', () => {
    it('debe responder con 401 Unauthorized si la petición carece de token', async () => {
      const res = await request(app).get('/api/bitacora');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 403 Forbidden si un rol Usuario intenta consultar la bitácora', async () => {
      const res = await request(app)
        .get('/api/bitacora')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.mensaje).toContain('Acceso prohibido');
    });

    it('debe responder con 200 OK y la lista de eventos para rol Administrador', async () => {
      jest.spyOn(bitacora, 'findAll').mockResolvedValue([
        {
          bitacoraId: 1,
          accion: 'categoria.crear',
          elementoid: '1',
          ip: '127.0.0.1',
          usuario: 'admin@uv.mx',
          fecha: new Date()
        }
      ]);

      const res = await request(app)
        .get('/api/bitacora')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].accion).toBe('categoria.crear');
    });

    it('debe responder con 500 si ocurre un error en la base de datos al listar', async () => {
      jest.spyOn(bitacora, 'findAll').mockRejectedValue(new Error('Error de conexión con la bitácora'));

      const res = await request(app)
        .get('/api/bitacora')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(500);
    });
  });
});
