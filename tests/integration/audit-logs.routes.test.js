const request = require('supertest');
const app = require('../../index');
const {
  AuditLog: auditLog
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
describe("Pruebas de Integración: Endpoints de Bitácora (/api/audit-logs)", () => {
  let adminToken;
  let userToken;
  beforeAll(() => {
    adminToken = generateToken('admin@uv.mx', 'Administrador General', 'Administrador');
    userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe("GET /api/audit-logs", () => {
    it('debe responder con 401 Unauthorized si la petición carece de token', async () => {
      const res = await request(app).get("/api/audit-logs");
      expect(res.statusCode).toBe(401);
    });
    it('debe responder con 403 Forbidden si un rol Usuario intenta consultar la bitácora', async () => {
      const res = await request(app).get("/api/audit-logs").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain('Acceso prohibido');
    });
    it('debe responder con 200 OK y la lista de eventos para rol Administrador', async () => {
      jest.spyOn(auditLog, 'findAll').mockResolvedValue([{
        auditLogId: 1,
        action: 'categoria.crear',
        elementId: '1',
        ip: '127.0.0.1',
        user: 'admin@uv.mx',
        date: new Date()
      }]);
      const res = await request(app).get("/api/audit-logs").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].action).toBe('categoria.crear');
    });
    it('debe responder con 500 si ocurre un error en la base de datos al listar', async () => {
      jest.spyOn(auditLog, 'findAll').mockRejectedValue(new Error('Error de conexión con la bitácora'));
      const res = await request(app).get("/api/audit-logs").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
});
