const request = require('supertest');
const app = require('../../index');
const { categoria, bitacora } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Categorías (/api/categorias)', () => {
  let adminToken;
  let usuarioToken;

  beforeAll(() => {
    adminToken = GeneraToken('admin@uv.mx', 'Guillermo Vera', 'Administrador');
    usuarioToken = GeneraToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });

  beforeEach(() => {
    jest.spyOn(bitacora, 'create').mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/categorias', () => {
    it('debe responder con 401 si la petición carece de token de autorización', async () => {
      const res = await request(app).get('/api/categorias');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 200 OK y la lista de categorías para rol Usuario', async () => {
      jest.spyOn(categoria, 'findAll').mockResolvedValue([
        { categoriaId: 1, nombre: 'Televisores', protegida: true },
        { categoriaId: 2, nombre: 'Celulares', protegida: true }
      ]);

      const res = await request(app)
        .get('/api/categorias')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });

  describe('GET /api/categorias/:id', () => {
    it('debe responder con 200 OK si la categoría existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({
        categoriaId: 1,
        nombre: 'Televisores',
        protegida: true
      });

      const res = await request(app)
        .get('/api/categorias/1')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.nombre).toBe('Televisores');
    });

    it('debe responder con 404 Not Found si la categoría no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .get('/api/categorias/999')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('no encontrada');
    });
  });

  describe('POST /api/categorias (Control de Acceso RBAC y Validación)', () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta crear una categoría', async () => {
      const res = await request(app)
        .post('/api/categorias')
        .set('Authorization', `Bearer ${usuarioToken}`)
        .send({ nombre: 'Nueva Categoría' });

      expect(res.statusCode).toBe(403);
      expect(res.body.mensaje).toContain('Acceso prohibido');
    });

    it('debe responder con 400 Bad Request si el Administrador envía el campo nombre vacío', async () => {
      const res = await request(app)
        .post('/api/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: '' });

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('Errores de validación');
      expect(res.body.errores).toBeDefined();
    });

    it('debe responder con 201 Created si el Administrador envía datos válidos', async () => {
      jest.spyOn(categoria, 'create').mockResolvedValue({
        id: 16,
        nombre: 'Ferretería y Herramientas',
        protegida: false
      });

      const res = await request(app)
        .post('/api/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: 'Ferretería y Herramientas' });

      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(16);
      expect(res.body.nombre).toBe('Ferretería y Herramientas');
    });
  });

  describe('PUT /api/categorias/:id', () => {
    it('debe responder con 400 Bad Request si el nombre está vacío', async () => {
      const res = await request(app)
        .put('/api/categorias/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: '' });

      expect(res.statusCode).toBe(400);
    });

    it('debe responder con 404 Not Found si la categoría no existe al actualizar', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .put('/api/categorias/999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: 'Nombre Válido' });

      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 204 No Content al actualizar una categoría exitosamente', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({ id: 16, nombre: 'Viejo' });
      jest.spyOn(categoria, 'update').mockResolvedValue([1]);

      const res = await request(app)
        .put('/api/categorias/16')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre: 'Nombre Nuevo' });

      expect(res.statusCode).toBe(204);
    });
  });

  describe('DELETE /api/categorias/:id (Reglas de Protección del Sistema)', () => {
    it('debe responder con 400 Bad Request al intentar eliminar una categoría protegida', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({
        id: 1,
        nombre: 'Televisores',
        protegida: true
      });

      const res = await request(app)
        .delete('/api/categorias/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('No se pueden eliminar categorías protegidas');
    });

    it('debe responder con 404 Not Found si la categoría no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/categorias/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('no encontrada');
    });

    it('debe responder con 204 No Content al eliminar con éxito una categoría no protegida', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({
        id: 16,
        nombre: 'Temporal',
        protegida: false
      });
      jest.spyOn(categoria, 'destroy').mockResolvedValue(1);

      const res = await request(app)
        .delete('/api/categorias/16')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
    });
  });
});
