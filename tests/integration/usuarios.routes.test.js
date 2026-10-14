const request = require('supertest');
const app = require('../../index');
const { usuario, rol } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');

describe('Pruebas de Integración: Endpoints de Usuarios (/api/usuarios)', () => {
  let adminToken;
  let usuarioToken;

  beforeAll(() => {
    adminToken = GeneraToken('admin@uv.mx', 'Guillermo Vera', 'Administrador');
    usuarioToken = GeneraToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Control de Acceso (RBAC en /api/usuarios)', () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta listar los usuarios', async () => {
      const res = await request(app)
        .get('/api/usuarios')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('debe responder con 200 OK si un Administrador consulta los usuarios', async () => {
      jest.spyOn(usuario, 'findAll').mockResolvedValue([
        { id: 'uuid-1', email: 'gvera@uv.mx', nombre: 'Guillermo Vera', rol: 'Administrador' }
      ]);

      const res = await request(app)
        .get('/api/usuarios')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/usuarios (Creación Defensiva)', () => {
    it('CORRECCIÓN DE BUG: debe responder con 400 Bad Request si el rol especificado no existe en la BD', async () => {
      jest.spyOn(rol, 'findOne').mockResolvedValue(null); // Rol inexistente

      const res = await request(app)
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'nuevo@uv.mx',
          password: 'password123',
          nombre: 'Nuevo Usuario',
          rol: 'RolInexistente'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('no existe');
    });

    it('debe responder con 409 Conflict si el correo electrónico ya está registrado', async () => {
      jest.spyOn(rol, 'findOne').mockResolvedValue({ id: 'uuid-rol-usuario', nombre: 'Usuario' });
      jest.spyOn(usuario, 'findOne').mockResolvedValue({ id: 'uuid-existente', email: 'existente@uv.mx' });

      const res = await request(app)
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'existente@uv.mx',
          password: 'password123',
          nombre: 'Usuario Existente',
          rol: 'Usuario'
        });

      expect(res.statusCode).toBe(409);
      expect(res.body.mensaje).toContain('ya se encuentra registrado');
    });

    it('debe responder con 201 Created al registrar un usuario con datos correctos', async () => {
      jest.spyOn(rol, 'findOne').mockResolvedValue({ id: 'uuid-rol-usuario', nombre: 'Usuario' });
      jest.spyOn(usuario, 'findOne').mockResolvedValue(null);
      jest.spyOn(usuario, 'create').mockResolvedValue({
        id: 'uuid-nuevo-123',
        email: 'cmendoza@uv.mx',
        nombre: 'Carlos Mendoza',
        protegido: false
      });

      const res = await request(app)
        .post('/api/usuarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'cmendoza@uv.mx',
          password: 'passwordSeguro123',
          nombre: 'Carlos Mendoza',
          rol: 'Usuario'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.email).toBe('cmendoza@uv.mx');
      expect(res.body.nombre).toBe('Carlos Mendoza');
    });
  });

  describe('DELETE /api/usuarios/:email (Prevención de Null Pointer y Eliminación de Protegidos)', () => {
    it('CORRECCIÓN DE BUG: debe responder con 404 Not Found si el usuario no existe (evita Null Pointer DoS)', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue(null); // Usuario no encontrado

      const res = await request(app)
        .delete('/api/usuarios/fantasma@uv.mx')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('no encontrado');
    });

    it('debe responder con 403 Forbidden al intentar eliminar un usuario con flag protegido=true', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue({
        id: 'uuid-admin-root',
        email: 'gvera@uv.mx',
        protegido: true // Usuario protegido del sistema
      });

      const res = await request(app)
        .delete('/api/usuarios/gvera@uv.mx')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.mensaje).toContain('No se pueden eliminar usuarios protegidos');
    });

    it('debe responder con 204 No Content al eliminar un usuario no protegido', async () => {
      jest.spyOn(usuario, 'findOne').mockResolvedValue({
        id: 'uuid-normal',
        email: 'usuario.temporal@uv.mx',
        protegido: false
      });
      jest.spyOn(usuario, 'destroy').mockResolvedValue(1);

      const res = await request(app)
        .delete('/api/usuarios/usuario.temporal@uv.mx')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
    });
  });
});
