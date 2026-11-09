const request = require('supertest');
const app = require('../../index');
const {
  Category: category,
  AuditLog: auditLog
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
describe("Pruebas de Integración: Endpoints de Categorías (/api/categories)", () => {
  let adminToken;
  let userToken;
  beforeAll(() => {
    adminToken = generateToken('admin@uv.mx', 'Guillermo Vera', 'Administrador');
    userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });
  beforeEach(() => {
    jest.spyOn(auditLog, 'create').mockResolvedValue({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe("GET /api/categories", () => {
    it('debe responder con 401 si la petición carece de token de autorización', async () => {
      const res = await request(app).get("/api/categories");
      expect(res.statusCode).toBe(401);
    });
    it('debe responder con 200 OK y la lista de categorías para rol Usuario', async () => {
      jest.spyOn(category, 'findAll').mockResolvedValue([{
        categoryId: 1,
        name: 'Televisores',
        protected: true
      }, {
        categoryId: 2,
        name: 'Celulares',
        protected: true
      }]);
      const res = await request(app).get("/api/categories").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });
  });
  describe("GET /api/categories/:id", () => {
    it('debe responder con 200 OK si la categoría existe', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        categoryId: 1,
        name: 'Televisores',
        protected: true
      });
      const res = await request(app).get("/api/categories/1").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe('Televisores');
    });
    it('debe responder con 404 Not Found si la categoría no existe', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue(null);
      const res = await request(app).get("/api/categories/999").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no encontrada');
    });
  });
  describe("POST /api/categories (Control de Acceso RBAC y Validación)", () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta crear una categoría', async () => {
      const res = await request(app).post("/api/categories").set('Authorization', `Bearer ${userToken}`).send({
        name: 'Nueva Categoría'
      });
      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Acceso prohibido');
    });
    it('debe responder con 400 Bad Request si el Administrador envía el campo name vacío', async () => {
      const res = await request(app).post("/api/categories").set('Authorization', `Bearer ${adminToken}`).send({
        name: ''
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Errores de validación');
      expect(res.body.errors).toBeDefined();
    });
    it('debe responder con 201 Created si el Administrador envía datos válidos', async () => {
      jest.spyOn(category, 'create').mockResolvedValue({
        id: 16,
        name: 'Ferretería y Herramientas',
        protected: false
      });
      const res = await request(app).post("/api/categories").set('Authorization', `Bearer ${adminToken}`).send({
        name: 'Ferretería y Herramientas'
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(16);
      expect(res.body.name).toBe('Ferretería y Herramientas');
    });
  });
  describe("PUT /api/categories/:id", () => {
    it('debe responder con 400 Bad Request si el nombre está vacío', async () => {
      const res = await request(app).put("/api/categories/1").set('Authorization', `Bearer ${adminToken}`).send({
        name: ''
      });
      expect(res.statusCode).toBe(400);
    });
    it('debe responder con 404 Not Found si la categoría no existe al actualizar', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue(null);
      const res = await request(app).put("/api/categories/999").set('Authorization', `Bearer ${adminToken}`).send({
        name: 'Nombre Válido'
      });
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 204 No Content al actualizar una categoría exitosamente', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 16,
        name: 'Viejo'
      });
      jest.spyOn(category, 'update').mockResolvedValue([1]);
      const res = await request(app).put("/api/categories/16").set('Authorization', `Bearer ${adminToken}`).send({
        name: 'Nombre Nuevo'
      });
      expect(res.statusCode).toBe(204);
    });
  });
  describe("DELETE /api/categories/:id (Reglas de Protección del Sistema)", () => {
    it('debe responder con 400 Bad Request al intentar eliminar una categoría protegida', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 1,
        name: 'Televisores',
        protected: true
      });
      const res = await request(app).delete("/api/categories/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('No se pueden eliminar categorías protegidas');
    });
    it('debe responder con 404 Not Found si la categoría no existe', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue(null);
      const res = await request(app).delete("/api/categories/999").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no encontrada');
    });
    it('debe responder con 204 No Content al eliminar con éxito una categoría no protegida', async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 16,
        name: 'Temporal',
        protected: false
      });
      jest.spyOn(category, 'destroy').mockResolvedValue(1);
      const res = await request(app).delete("/api/categories/16").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(204);
    });
  });
});
