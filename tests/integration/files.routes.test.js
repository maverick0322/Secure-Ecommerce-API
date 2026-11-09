const request = require('supertest');
const app = require('../../index');
const {
  File: fileModel,
  AuditLog: auditLog
} = require('../../models');
const {
  generateToken
} = require('../../services/jwttoken.service');
const fs = require('fs');
const path = require('path');
describe("Pruebas de Integración: Endpoints de Archivos (/api/files)", () => {
  let adminToken;
  let userToken;
  beforeAll(() => {
    adminToken = generateToken('admin@uv.mx', 'Administrador General', 'Administrador');
    userToken = generateToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });
  beforeEach(() => {
    jest.spyOn(auditLog, 'create').mockResolvedValue({});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  describe("GET /api/files (Listado administrativo)", () => {
    it('debe responder con 401 si la petición carece de token', async () => {
      const res = await request(app).get("/api/files");
      expect(res.statusCode).toBe(401);
    });
    it('debe responder con 403 Forbidden si el rol no es Administrador', async () => {
      const res = await request(app).get("/api/files").set('Authorization', `Bearer ${userToken}`);
      expect(res.statusCode).toBe(403);
    });
    it('debe responder con 200 OK y la lista de archivos para rol Administrador', async () => {
      jest.spyOn(fileModel, 'findAll').mockResolvedValue([{
        fileId: 1,
        mime: 'image/jpeg',
        storedInDatabase: false,
        name: 'demo.jpg',
        size: 1024
      }]);
      const res = await request(app).get("/api/files").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });
    it('debe responder con 500 si falla la consulta en la base de datos', async () => {
      jest.spyOn(fileModel, 'findAll').mockRejectedValue(new Error('Fallo de BD'));
      const res = await request(app).get("/api/files").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
  describe("GET /api/files/:id/details", () => {
    it('debe responder con 200 OK y los metadatos del archivo', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        fileId: 5,
        mime: 'image/jpeg',
        storedInDatabase: false,
        name: 'foto.jpg',
        size: 2048
      });
      const res = await request(app).get("/api/files/5/details").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.name).toBe('foto.jpg');
    });
    it('debe responder con 404 Not Found si el archivo no existe', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue(null);
      const res = await request(app).get("/api/files/999/details").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
    });
  });
  describe("GET /api/files/:id (Visualización y Descarga)", () => {
    it('debe responder con 404 si el registro del archivo no existe en BD', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue(null);
      const res = await request(app).get("/api/files/999");
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 200 y contenido binario cuando está guardado en BD (storedInDatabase: true)', async () => {
      const mockBuffer = Buffer.from('contenido-imagen-jpeg');
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        id: 1,
        mime: 'image/jpeg',
        storedInDatabase: true,
        data: mockBuffer
      });
      const res = await request(app).get("/api/files/1");
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.body).toEqual(mockBuffer);
    });
    it('debe responder con 404 si el archivo físico en disco no existe (storedInDatabase: false)', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        id: 2,
        mime: 'image/jpeg',
        storedInDatabase: false,
        name: 'fantasma.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const res = await request(app).get("/api/files/2");
      expect(res.statusCode).toBe(404);
      expect(res.body.message).toContain('no existe en el almacenamiento');
    });
    it('debe responder con 200 y el archivo físico de disco si existe (storedInDatabase: false)', async () => {
      const mockBuffer = Buffer.from('imagen-en-disco');
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        id: 3,
        mime: 'image/jpeg',
        storedInDatabase: false,
        name: 'real.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(mockBuffer);
      const res = await request(app).get("/api/files/3");
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.body).toEqual(mockBuffer);
    });
  });
  describe("POST /api/files (Subida de Archivos)", () => {
    it('debe responder con 400 Bad Request si no se envía archivo en campo file', async () => {
      const res = await request(app).post("/api/files").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain('obligatorio');
    });
    it('debe responder con 201 Created al subir archivo JPG a disco (FILES_IN_DB=false)', async () => {
      jest.spyOn(fileModel, 'create').mockResolvedValue({
        id: 1,
        mime: 'image/jpeg',
        storedInDatabase: false,
        name: 'archivo-uuid.jpg'
      });
      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // Firma binaria JPEG

      const res = await request(app).post("/api/files").set('Authorization', `Bearer ${adminToken}`).attach('file', bufferJpeg, 'foto.jpg');
      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(1);
      expect(res.body.mime).toBe('image/jpeg');
    });
    it('debe responder con 201 Created al subir archivo a BD (FILES_IN_DB=true)', async () => {
      const originalEnv = process.env.FILES_IN_DB;
      process.env.FILES_IN_DB = 'true';
      jest.spyOn(fileModel, 'create').mockResolvedValue({
        id: 2,
        mime: 'image/jpeg',
        storedInDatabase: true,
        name: 'archivo-en-bd.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('blob'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const res = await request(app).post("/api/files").set('Authorization', `Bearer ${adminToken}`).attach('file', bufferJpeg, 'foto_bd.jpg');
      process.env.FILES_IN_DB = originalEnv;
      expect(res.statusCode).toBe(201);
      expect(res.body.storedInDatabase).toBe(true);
    });
  });
  describe("PUT /api/files/:id (Actualización de Archivo)", () => {
    it('debe responder con 400 Bad Request si no se adjunta archivo', async () => {
      const res = await request(app).put("/api/files/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(400);
    });
    it('debe responder con 404 si el archivo a reemplazar no existe', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue(null);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const res = await request(app).put("/api/files/999").set('Authorization', `Bearer ${adminToken}`).attach('file', bufferJpeg, 'nuevo.jpg');
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 204 No Content al actualizar exitosamente', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        id: 1,
        storedInDatabase: false,
        name: 'anterior.jpg'
      });
      jest.spyOn(fileModel, 'update').mockResolvedValue([1]);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      const res = await request(app).put("/api/files/1").set('Authorization', `Bearer ${adminToken}`).attach('file', bufferJpeg, 'actualizado.jpg');
      expect(res.statusCode).toBe(204);
    });
  });
  describe("DELETE /api/files/:id (Eliminación de Archivo)", () => {
    it('debe responder con 404 Not Found si el archivo no existe en BD', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue(null);
      const res = await request(app).delete("/api/files/999").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(404);
    });
    it('debe responder con 204 No Content y limpiar el archivo en disco si no estaba en BD', async () => {
      jest.spyOn(fileModel, 'findByPk').mockResolvedValue({
        id: 1,
        storedInDatabase: false,
        name: 'a-borrar.jpg'
      });
      jest.spyOn(fileModel, 'destroy').mockResolvedValue(1);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const spyUnlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
      const res = await request(app).delete("/api/files/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(204);
      expect(spyUnlink).toHaveBeenCalled();
    });
    it('debe responder con 500 si la base de datos lanza un error', async () => {
      jest.spyOn(fileModel, 'findByPk').mockRejectedValue(new Error('Fallo de BD'));
      const res = await request(app).delete("/api/files/1").set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(500);
    });
  });
});
