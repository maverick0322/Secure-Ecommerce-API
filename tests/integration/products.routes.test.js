const request = require('supertest');
const app = require('../../index');
const {
  Product: product,
  Category: category,
  AuditLog: auditLog
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
describe("Pruebas de Integración: Endpoints de Productos (/api/products)", () => {
  let adminToken;
  let userToken;
  beforeAll(() => {
    adminToken = generateToken('admin@uv.mx', 'Administrador General', 'Administrador');
    userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });
  beforeEach(() => {
    // Evitar que llamadas de bitácora intenten tocar BD real y generen logs en consola
    jest.spyOn(auditLog, 'create').mockResolvedValue({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe("GET /api/products", () => {
    it('debe responder con 401 si la petición carece de token de autorización', async () => {
      const res = await request(app).get("/api/products");
      expect(res.statusCode).toBe(401);
    });
    it('debe responder con 200 OK y la lista de productos para rol Usuario', async () => {
      jest.spyOn(product, 'findAll').mockResolvedValue([{
        productId: 1,
        title: 'Laptop Dell XPS 15',
        description: 'Potente laptop para desarrollo',
        price: 25000.0,
        fileId: null,
        categories: []
      }]);
      const res = await request(app).get("/api/products").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].title).toBe('Laptop Dell XPS 15');
    });
    it('debe filtrar productos cuando se envía el parámetro ?s=termino', async () => {
      const spyFind = jest.spyOn(product, 'findAll').mockResolvedValue([]);
      const res = await request(app).get("/api/products?s=Monitor").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(spyFind).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          title: expect.anything()
        })
      }));
    });
    it('debe responder con 500 si falla la consulta de productos en la base de datos', async () => {
      jest.spyOn(product, 'findAll').mockRejectedValue(new Error('Fallo de conexión'));
      const res = await request(app).get("/api/products").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
  describe("GET /api/products/:id", () => {
    it('debe responder con 200 OK y el detalle del producto si existe', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue({
        productId: 1,
        title: 'Mouse Ergonómico',
        description: 'Mouse inalámbrico óptico',
        price: 450.0,
        fileId: null,
        categories: []
      });
      const res = await request(app).get("/api/products/1").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.title).toBe('Mouse Ergonómico');
    });
    it('debe responder con 404 Not Found si el producto no existe', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue(null);
      const res = await request(app).get("/api/products/999").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no encontrado');
    });
    it('debe responder con 500 si la base de datos lanza un error en get por ID', async () => {
      jest.spyOn(product, 'findByPk').mockRejectedValue(new Error('Fallo interno'));
      const res = await request(app).get("/api/products/1").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
  describe("POST /api/products (Validación y Creación RBAC)", () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta crear un producto', async () => {
      const res = await request(app).post("/api/products").set('Authorization', `Bearer ${userToken}`).send({
        title: 'Producto no autorizado',
        description: 'Intento de usuario',
        price: 100
      });
      expect(res.statusCode).toBe(403);
    });
    it('debe responder con 400 Bad Request si faltan campos obligatorios o precio no es numérico', async () => {
      const res = await request(app).post("/api/products").set('Authorization', `Bearer ${adminToken}`).send({
        title: '',
        description: '',
        price: 'invalido'
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('Errores de validación');
      expect(res.body.errors).toBeDefined();
    });
    it('debe responder con 201 Created si Administrador envía datos válidos', async () => {
      jest.spyOn(product, 'create').mockResolvedValue({
        id: 10,
        title: 'Teclado Mecánico RGB',
        description: 'Switches táctiles',
        price: 1200.5,
        fileId: null
      });
      const res = await request(app).post("/api/products").set('Authorization', `Bearer ${adminToken}`).send({
        title: 'Teclado Mecánico RGB',
        description: 'Switches táctiles',
        price: 1200.5
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(10);
      expect(res.body.title).toBe('Teclado Mecánico RGB');
    });
    it('debe responder con 500 si falla Product.create en BD', async () => {
      jest.spyOn(product, 'create').mockRejectedValue(new Error('Error al insertar producto'));
      const res = await request(app).post("/api/products").set('Authorization', `Bearer ${adminToken}`).send({
        title: 'Producto Válido',
        description: 'Descripción válida',
        price: 50.0
      });
      expect(res.statusCode).toBe(500);
    });
  });
  describe("PUT /api/products/:id (Actualización y Mitigación CWE-915)", () => {
    it('debe responder con 400 si los campos enviados no pasan la validación', async () => {
      const res = await request(app).put("/api/products/1").set('Authorization', `Bearer ${adminToken}`).send({
        title: '',
        description: '',
        price: 'no-numero'
      });
      expect(res.statusCode).toBe(400);
    });
    it('debe responder con 404 si el producto a actualizar no existe', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue(null);
      const res = await request(app).put("/api/products/999").set('Authorization', `Bearer ${adminToken}`).send({
        title: 'Nuevo título',
        description: 'Nueva descripción',
        price: 200.0
      });
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 204 No Content al actualizar exitosamente', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue({
        id: 1,
        fileId: 2
      });
      jest.spyOn(product, 'update').mockResolvedValue([1]);
      const res = await request(app).put("/api/products/1").set('Authorization', `Bearer ${adminToken}`).send({
        title: 'Título Actualizado',
        description: 'Descripción Actualizada',
        price: 350.0
      });
      expect(res.statusCode).toBe(204);
    });
    it('debe responder con 500 si ocurre un fallo interno al actualizar', async () => {
      jest.spyOn(product, 'findByPk').mockRejectedValue(new Error('Error de BD'));
      const res = await request(app).put("/api/products/1").set('Authorization', `Bearer ${adminToken}`).send({
        title: 'Título',
        description: 'Descripción',
        price: 100.0
      });
      expect(res.statusCode).toBe(500);
    });
  });
  describe("DELETE /api/products/:id", () => {
    it('debe responder con 404 si el producto a eliminar no existe', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue(null);
      const res = await request(app).delete("/api/products/999").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 204 No Content al eliminar un producto exitosamente', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue({
        id: 1
      });
      jest.spyOn(product, 'destroy').mockResolvedValue(1);
      const res = await request(app).delete("/api/products/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(204);
    });
    it('debe responder con 500 si falla la eliminación en base de datos', async () => {
      jest.spyOn(product, 'findByPk').mockResolvedValue({
        id: 1
      });
      jest.spyOn(product, 'destroy').mockRejectedValue(new Error('Fallo al borrar'));
      const res = await request(app).delete("/api/products/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
  describe('Asignación y Desasociación de Categorías (N:M)', () => {
    it("POST /api/products/:id/categories: debe responder 400 si falta categoryId", async () => {
      const res = await request(app).post("/api/products/1/categories").set('Authorization', `Bearer ${adminToken}`).send({});
      expect(res.statusCode).toBe(400);
    });
    it("POST /api/products/:id/categories: debe responder 404 si la categoría no existe", async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue(null);
      const res = await request(app).post("/api/products/1/categories").set('Authorization', `Bearer ${adminToken}`).send({
        categoryId: 99
      });
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Categoría no encontrada');
    });
    it("POST /api/products/:id/categories: debe responder 404 si el producto no existe", async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 2
      });
      jest.spyOn(product, 'findByPk').mockResolvedValue(null);
      const res = await request(app).post("/api/products/1/categories").set('Authorization', `Bearer ${adminToken}`).send({
        categoryId: 2
      });
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('Producto no encontrado');
    });
    it("POST /api/products/:id/categories: debe responder 204 al asociar categoría con éxito", async () => {
      const mockItem = {
        id: 1,
        addCategory: jest.fn().mockResolvedValue({})
      };
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 2
      });
      jest.spyOn(product, 'findByPk').mockResolvedValue(mockItem);
      const res = await request(app).post("/api/products/1/categories").set('Authorization', `Bearer ${adminToken}`).send({
        categoryId: 2
      });
      expect(res.statusCode).toBe(204);
      expect(mockItem.addCategory).toHaveBeenCalled();
    });
    it("DELETE /api/products/:id/categories/:categoryId: debe responder 404 si categoría no existe", async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue(null);
      const res = await request(app).delete("/api/products/1/categories/99").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
    });
    it("DELETE /api/products/:id/categories/:categoryId: debe responder 404 si producto no existe", async () => {
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 2
      });
      jest.spyOn(product, 'findByPk').mockResolvedValue(null);
      const res = await request(app).delete("/api/products/1/categories/2").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
    });
    it("DELETE /api/products/:id/categories/:categoryId: debe responder 204 al remover categoría", async () => {
      const mockItem = {
        id: 1,
        removeCategory: jest.fn().mockResolvedValue({})
      };
      jest.spyOn(category, 'findByPk').mockResolvedValue({
        id: 2
      });
      jest.spyOn(product, 'findByPk').mockResolvedValue(mockItem);
      const res = await request(app).delete("/api/products/1/categories/2").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(204);
      expect(mockItem.removeCategory).toHaveBeenCalled();
    });
  });
});
