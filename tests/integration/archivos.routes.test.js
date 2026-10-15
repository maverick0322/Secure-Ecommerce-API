const request = require('supertest');
const app = require('../../index');
const { archivo, bitacora } = require('../../models');
const { GeneraToken } = require('../../services/jwttoken.service');
const fs = require('fs');
const path = require('path');

describe('Pruebas de Integración: Endpoints de Archivos (/api/archivos)', () => {
  let adminToken;
  let usuarioToken;

  beforeAll(() => {
    adminToken = GeneraToken('admin@uv.mx', 'Administrador General', 'Administrador');
    usuarioToken = GeneraToken('usuario@uv.mx', 'Usuario Normal', 'Usuario');
  });

  beforeEach(() => {
    jest.spyOn(bitacora, 'create').mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/archivos (Listado administrativo)', () => {
    it('debe responder con 401 si la petición carece de token', async () => {
      const res = await request(app).get('/api/archivos');
      expect(res.statusCode).toBe(401);
    });

    it('debe responder con 403 Forbidden si el rol no es Administrador', async () => {
      const res = await request(app)
        .get('/api/archivos')
        .set('Authorization', `Bearer ${usuarioToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('debe responder con 200 OK y la lista de archivos para rol Administrador', async () => {
      jest.spyOn(archivo, 'findAll').mockResolvedValue([
        {
          archivoId: 1,
          mime: 'image/jpeg',
          indb: false,
          nombre: 'demo.jpg',
          size: 1024
        }
      ]);

      const res = await request(app)
        .get('/api/archivos')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('debe responder con 500 si falla la consulta en la base de datos', async () => {
      jest.spyOn(archivo, 'findAll').mockRejectedValue(new Error('Fallo de BD'));

      const res = await request(app)
        .get('/api/archivos')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /api/archivos/:id/detalle', () => {
    it('debe responder con 200 OK y los metadatos del archivo', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        archivoId: 5,
        mime: 'image/jpeg',
        indb: false,
        nombre: 'foto.jpg',
        size: 2048
      });

      const res = await request(app)
        .get('/api/archivos/5/detalle')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.nombre).toBe('foto.jpg');
    });

    it('debe responder con 404 Not Found si el archivo no existe', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .get('/api/archivos/999/detalle')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/archivos/:id (Visualización y Descarga)', () => {
    it('debe responder con 404 si el registro del archivo no existe en BD', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue(null);

      const res = await request(app).get('/api/archivos/999');
      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 200 y contenido binario cuando está guardado en BD (indb: true)', async () => {
      const bufferFicticio = Buffer.from('contenido-imagen-jpeg');
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        id: 1,
        mime: 'image/jpeg',
        indb: true,
        datos: bufferFicticio
      });

      const res = await request(app).get('/api/archivos/1');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.body).toEqual(bufferFicticio);
    });

    it('debe responder con 404 si el archivo físico en disco no existe (indb: false)', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        id: 2,
        mime: 'image/jpeg',
        indb: false,
        nombre: 'fantasma.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const res = await request(app).get('/api/archivos/2');

      expect(res.statusCode).toBe(404);
      expect(res.body.mensaje).toContain('no existe en el almacenamiento');
    });

    it('debe responder con 200 y el archivo físico de disco si existe (indb: false)', async () => {
      const bufferFicticio = Buffer.from('imagen-en-disco');
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        id: 3,
        mime: 'image/jpeg',
        indb: false,
        nombre: 'real.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(bufferFicticio);

      const res = await request(app).get('/api/archivos/3');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/jpeg');
      expect(res.body).toEqual(bufferFicticio);
    });
  });

  describe('POST /api/archivos (Subida de Archivos)', () => {
    it('debe responder con 400 Bad Request si no se envía archivo en campo file', async () => {
      const res = await request(app)
        .post('/api/archivos')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.mensaje).toContain('obligatorio');
    });

    it('debe responder con 201 Created al subir archivo JPG a disco (FILES_IN_BD=false)', async () => {
      jest.spyOn(archivo, 'create').mockResolvedValue({
        id: 1,
        mime: 'image/jpeg',
        indb: false,
        nombre: 'archivo-uuid.jpg'
      });

      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // Magic numbers JPEG

      const res = await request(app)
        .post('/api/archivos')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', bufferJpeg, 'foto.jpg');

      expect(res.statusCode).toBe(201);
      expect(res.body.id).toBe(1);
      expect(res.body.mime).toBe('image/jpeg');
    });

    it('debe responder con 201 Created al subir archivo a BD (FILES_IN_BD=true)', async () => {
      const envOriginal = process.env.FILES_IN_BD;
      process.env.FILES_IN_BD = 'true';

      jest.spyOn(archivo, 'create').mockResolvedValue({
        id: 2,
        mime: 'image/jpeg',
        indb: true,
        nombre: 'archivo-en-bd.jpg'
      });
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('blob'));
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const res = await request(app)
        .post('/api/archivos')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', bufferJpeg, 'foto_bd.jpg');

      process.env.FILES_IN_BD = envOriginal;

      expect(res.statusCode).toBe(201);
      expect(res.body.indb).toBe(true);
    });
  });

  describe('PUT /api/archivos/:id (Actualización de Archivo)', () => {
    it('debe responder con 400 Bad Request si no se adjunta archivo', async () => {
      const res = await request(app)
        .put('/api/archivos/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
    });

    it('debe responder con 404 si el archivo a reemplazar no existe', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue(null);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const res = await request(app)
        .put('/api/archivos/999')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', bufferJpeg, 'nuevo.jpg');

      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 204 No Content al actualizar exitosamente', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        id: 1,
        indb: false,
        nombre: 'anterior.jpg'
      });
      jest.spyOn(archivo, 'update').mockResolvedValue([1]);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const bufferJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

      const res = await request(app)
        .put('/api/archivos/1')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', bufferJpeg, 'actualizado.jpg');

      expect(res.statusCode).toBe(204);
    });
  });

  describe('DELETE /api/archivos/:id (Eliminación de Archivo)', () => {
    it('debe responder con 404 Not Found si el archivo no existe en BD', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/archivos/999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(404);
    });

    it('debe responder con 204 No Content y limpiar el archivo en disco si no estaba en BD', async () => {
      jest.spyOn(archivo, 'findByPk').mockResolvedValue({
        id: 1,
        indb: false,
        nombre: 'a-borrar.jpg'
      });
      jest.spyOn(archivo, 'destroy').mockResolvedValue(1);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const spyUnlink = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      const res = await request(app)
        .delete('/api/archivos/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(204);
      expect(spyUnlink).toHaveBeenCalled();
    });

    it('debe responder con 500 si la base de datos lanza un error', async () => {
      jest.spyOn(archivo, 'findByPk').mockRejectedValue(new Error('Fallo de BD'));

      const res = await request(app)
        .delete('/api/archivos/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(500);
    });
  });
});
