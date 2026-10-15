const request = require('supertest');
const app = require('../../index');
const { producto, categoria, bitacora } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Productos (/api/productos)', () => {
  let adminToken;
  let usuarioToken;

  beforeAll(() => {
    adminToken = GeneraToken('admin@uv.mx', 'Administrador General', 'Administrador');
    usuarioToken = GeneraToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });

  beforeEach(() => {
    // Evitar que llamadas de bitácora intenten tocar BD real y generen logs en consola
    jest.spyOn(bitacora, 'create').mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/productos', () => {
    it('debe responder con 401 si la petición carece de token de autorización', async () => {
      const res = await request(app).get('/api/productos');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 200 OK y la lista de productos para rol Usuario', async () => {
      jest.spyOn(producto, 'findAll').mockResolvedValue([
        {
          productoId: 1,
          titulo: 'Laptop Dell XPS 15',
          descripcion: 'Potente laptop para desarrollo',
          precio: 25000.0,
          archivoid: null,
          categorias: []
        }
      ]);

      const res = await request(app)
        .get('/api/productos')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].titulo).toBe('Laptop Dell XPS 15');
    });

    it('debe filtrar productos cuando se envía el parámetro ?s=termino', async () => {
      const spyFind = jest.spyOn(producto, 'findAll').mockResolvedValue([]);

      const res = await request(app)
        .get('/api/productos?s=Monitor')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(200);
      expect(spyFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            titulo: expect.anything()
          })
        })
      );
    });

    it('debe responder con 500 si falla la consulta de productos en la base de datos', async () => {
      jest.spyOn(producto, 'findAll').mockRejectedValue(new Error('Fallo de conexión'));

      const res = await request(app)
        .get('/api/productos')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /api/productos/:id', () => {
    it('debe responder con 200 OK y el detalle del producto si existe', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue({
        productoId: 1,
        titulo: 'Mouse Ergonómico',
        descripcion: 'Mouse inalámbrico óptico',
        precio: 450.0,
        archivoid: null,
        categorias: []
      });

      const res = await request(app)
        .get('/api/productos/1')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.titulo).toBe('Mouse Ergonómico');
    });

    it('debe responder con 404 Not Found si el producto no existe', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .get('/api/productos/999')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('no encontrado');
    });

    it('debe responder con 500 si la base de datos lanza un error en get por ID', async () => {
      jest.spyOn(producto, 'findByPk').mockRejectedValue(new Error('Fallo interno'));

      const res = await request(app)
        .get('/api/productos/1')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('POST /api/productos (Validación y Creación RBAC)', () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta crear un producto', async () => {
      const res = await request(app)
        .post('/api/productos')
        .set('Authorization', `Bearer ${usuarioToken}`)
        .send({
          titulo: 'Producto no autorizado',
          descripcion: 'Intento de usuario',
          precio: 100
        });

      expect(res.statusCode).toBe(403);
    });

    it('debe responder con 400 Bad Request si faltan campos obligatorios o precio no es numérico', async () => {
      const res = await request(app)
        .post('/api/productos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: '',
          descripcion: '',
          precio: 'invalido'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('Errores de validación');
      expect(res.body.errores).toBeDefined();
    });

    it('debe responder con 201 Created si Administrador envía datos válidos', async () => {
      jest.spyOn(producto, 'create').mockResolvedValue({
        id: 10,
        titulo: 'Teclado Mecánico RGB',
        descripcion: 'Switches táctiles',
        precio: 1200.5,
        archivoid: null
      });

      const res = await request(app)
        .post('/api/productos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: 'Teclado Mecánico RGB',
          descripcion: 'Switches táctiles',
          precio: 1200.5
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(10);
      expect(res.body.titulo).toBe('Teclado Mecánico RGB');
    });

    it('debe responder con 500 si falla producto.create en BD', async () => {
      jest.spyOn(producto, 'create').mockRejectedValue(new Error('Error al insertar producto'));

      const res = await request(app)
        .post('/api/productos')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: 'Producto Válido',
          descripcion: 'Descripción válida',
          precio: 50.0
        });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('PUT /api/productos/:id (Actualización y Mitigación CWE-915)', () => {
    it('debe responder con 400 si los campos enviados no pasan la validación', async () => {
      const res = await request(app)
        .put('/api/productos/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: '',
          descripcion: '',
          precio: 'no-numero'
        });

      expect(res.statusCode).toBe(400);
    });

    it('debe responder con 404 si el producto a actualizar no existe', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .put('/api/productos/999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: 'Nuevo título',
          descripcion: 'Nueva descripción',
          precio: 200.0
        });

      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 204 No Content al actualizar exitosamente', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue({
        id: 1,
        archivoid: 2
      });
      jest.spyOn(producto, 'update').mockResolvedValue([1]);

      const res = await request(app)
        .put('/api/productos/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: 'Título Actualizado',
          descripcion: 'Descripción Actualizada',
          precio: 350.0
        });

      expect(res.statusCode).toBe(204);
    });

    it('debe responder con 500 si ocurre un fallo interno al actualizar', async () => {
      jest.spyOn(producto, 'findByPk').mockRejectedValue(new Error('Error de BD'));

      const res = await request(app)
        .put('/api/productos/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          titulo: 'Título',
          descripcion: 'Descripción',
          precio: 100.0
        });

      expect(res.statusCode).toBe(500);
    });
  });

  describe('DELETE /api/productos/:id', () => {
    it('debe responder con 404 si el producto a eliminar no existe', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/productos/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 204 No Content al eliminar un producto exitosamente', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue({ id: 1 });
      jest.spyOn(producto, 'destroy').mockResolvedValue(1);

      const res = await request(app)
        .delete('/api/productos/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
    });

    it('debe responder con 500 si falla la eliminación en base de datos', async () => {
      jest.spyOn(producto, 'findByPk').mockResolvedValue({ id: 1 });
      jest.spyOn(producto, 'destroy').mockRejectedValue(new Error('Fallo al borrar'));

      const res = await request(app)
        .delete('/api/productos/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('Asignación y Desasociación de Categorías (N:M)', () => {
    it('POST /api/productos/:id/categoria: debe responder 400 si falta categoriaid', async () => {
      const res = await request(app)
        .post('/api/productos/1/categoria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.statusCode).toBe(400);
    });

    it('POST /api/productos/:id/categoria: debe responder 404 si la categoría no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/productos/1/categoria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoriaid: 99 });

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('Categoría no encontrada');
    });

    it('POST /api/productos/:id/categoria: debe responder 404 si el producto no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({ id: 2 });
      jest.spyOn(producto, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/productos/1/categoria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoriaid: 2 });

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('Producto no encontrado');
    });

    it('POST /api/productos/:id/categoria: debe responder 204 al asociar categoría con éxito', async () => {
      const mockItem = {
        id: 1,
        addCategoria: jest.fn().mockResolvedValue({})
      };
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({ id: 2 });
      jest.spyOn(producto, 'findByPk').mockResolvedValue(mockItem);

      const res = await request(app)
        .post('/api/productos/1/categoria')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoriaid: 2 });

      expect(res.statusCode).toBe(204);
      expect(mockItem.addCategoria).toHaveBeenCalled();
    });

    it('DELETE /api/productos/:id/categoria/:categoriaid: debe responder 404 si categoría no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/productos/1/categoria/99')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('DELETE /api/productos/:id/categoria/:categoriaid: debe responder 404 si producto no existe', async () => {
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({ id: 2 });
      jest.spyOn(producto, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/productos/1/categoria/2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('DELETE /api/productos/:id/categoria/:categoriaid: debe responder 204 al remover categoría', async () => {
      const mockItem = {
        id: 1,
        removeCategoria: jest.fn().mockResolvedValue({})
      };
      jest.spyOn(categoria, 'findByPk').mockResolvedValue({ id: 2 });
      jest.spyOn(producto, 'findByPk').mockResolvedValue(mockItem);

      const res = await request(app)
        .delete('/api/productos/1/categoria/2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
      expect(mockItem.removeCategoria).toHaveBeenCalled();
    });
  });
});
