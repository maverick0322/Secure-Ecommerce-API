const request = require('supertest');
const app = require('../../index');
const {
  User: user,
  Role: role,
  AuditLog: auditLog
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
describe("Pruebas de Integración: Endpoints de Usuarios (/api/users)", () => {
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
  describe("Control de Acceso (RBAC en /api/users)", () => {
    it('debe responder con 403 Forbidden si un rol Usuario intenta listar los usuarios', async () => {
      const res = await request(app).get("/api/users").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(403);
    });
    it('debe responder con 200 OK si un Administrador consulta los usuarios', async () => {
      jest.spyOn(user, 'findAll').mockResolvedValue([{
        id: 'uuid-1',
        email: 'gvera@uv.mx',
        name: 'Guillermo Vera',
        role: 'Administrador'
      }]);
      const res = await request(app).get("/api/users").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
  describe("GET /api/users/:email", () => {
    it('debe responder con 200 OK y el usuario si existe', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-1',
        email: 'gvera@uv.mx',
        name: 'Guillermo Vera',
        protected: true,
        role: 'Administrador'
      });
      const res = await request(app).get("/api/users/gvera@uv.mx").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.email).toBe('gvera@uv.mx');
    });
    it('debe responder con 404 Not Found si el usuario no existe', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue(null);
      const res = await request(app).get("/api/users/noexiste@uv.mx").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no encontrado');
    });
  });
  describe("POST /api/users (Creación Defensiva)", () => {
    it('debe responder con 400 Bad Request si faltan campos obligatorios', async () => {
      const res = await request(app).post("/api/users").set('Authorization', `Bearer ${adminToken}`).send({
        email: 'incompleto@uv.mx'
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('obligatorios');
    });
    it('CORRECCIÓN DE BUG: debe responder con 400 Bad Request si el rol especificado no existe en la BD', async () => {
      jest.spyOn(role, 'findOne').mockResolvedValue(null);
      const res = await request(app).post("/api/users").set('Authorization', `Bearer ${adminToken}`).send({
        email: 'nuevo@uv.mx',
        password: 'password123',
        name: 'Nuevo Usuario',
        role: 'RolInexistente'
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('no existe');
    });
    it('debe responder con 409 Conflict si el correo electrónico ya está registrado', async () => {
      jest.spyOn(role, 'findOne').mockResolvedValue({
        id: 1,
        name: 'Usuario'
      });
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-existente',
        email: 'existente@uv.mx'
      });
      const res = await request(app).post("/api/users").set('Authorization', `Bearer ${adminToken}`).send({
        email: 'existente@uv.mx',
        password: 'password123',
        name: 'Usuario Existente',
        role: 'Usuario'
      });
      expect(res.statusCode).toBe(409);
      expect(res.body.message).toContain('ya se encuentra registrado');
    });
    it('debe responder con 201 Created al registrar un usuario con datos correctos', async () => {
      jest.spyOn(role, 'findOne').mockResolvedValue({
        id: 2,
        name: 'Usuario'
      });
      jest.spyOn(user, 'findOne').mockResolvedValue(null);
      jest.spyOn(user, 'create').mockResolvedValue({
        id: 'uuid-nuevo-123',
        email: 'cmendoza@uv.mx',
        name: 'Carlos Mendoza',
        protected: false
      });
      const res = await request(app).post("/api/users").set('Authorization', `Bearer ${adminToken}`).send({
        email: 'cmendoza@uv.mx',
        password: 'passwordSeguro123',
        name: 'Carlos Mendoza',
        role: 'Usuario'
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.email).toBe('cmendoza@uv.mx');
      expect(res.body.name).toBe('Carlos Mendoza');
    });
  });
  describe("PUT /api/users/:email (Actualización Segura de Datos y Roles)", () => {
    it('debe responder con 404 si el usuario no existe', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue(null);
      const res = await request(app).put("/api/users/fantasma@uv.mx").set('Authorization', `Bearer ${adminToken}`).send({
        name: 'Nuevo Nombre'
      });
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 400 si el nuevo rol especificado no existe en el sistema', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-1',
        email: 'test@uv.mx'
      });
      jest.spyOn(role, 'findOne').mockResolvedValue(null);
      const res = await request(app).put("/api/users/test@uv.mx").set('Authorization', `Bearer ${adminToken}`).send({
        role: 'SuperRolFalso'
      });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('no existe');
    });
    it('debe responder con 204 No Content al actualizar nombre, rol y contraseña hasheada', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-1',
        email: 'test@uv.mx'
      });
      jest.spyOn(role, 'findOne').mockResolvedValue({
        id: 1,
        name: 'Administrador'
      });
      jest.spyOn(user, 'update').mockResolvedValue([1]);
      const res = await request(app).put("/api/users/test@uv.mx").set('Authorization', `Bearer ${adminToken}`).send({
        name: 'Nombre Modificado',
        role: 'Administrador',
        password: 'nuevaPassword123'
      });
      expect(res.statusCode).toBe(204);
    });
  });
  describe("DELETE /api/users/:email (Prevención de Null Pointer y Eliminación de Protegidos)", () => {
    it('CORRECCIÓN DE BUG: debe responder con 404 Not Found si el usuario no existe (evita Null Pointer DoS)', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue(null);
      const res = await request(app).delete("/api/users/fantasma@uv.mx").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no encontrado');
    });
    it('debe responder con 403 Forbidden al intentar eliminar un usuario con campo protected=true', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-admin-root',
        email: 'gvera@uv.mx',
        protected: true
      });
      const res = await request(app).delete("/api/users/gvera@uv.mx").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('No se pueden eliminar usuarios protegidos');
    });
    it('debe responder con 204 No Content al eliminar un usuario no protegido', async () => {
      jest.spyOn(user, 'findOne').mockResolvedValue({
        id: 'uuid-normal',
        email: 'usuario.temporal@uv.mx',
        protected: false
      });
      jest.spyOn(user, 'destroy').mockResolvedValue(1);
      const res = await request(app).delete("/api/users/usuario.temporal@uv.mx").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(204);
    });
  });
});
