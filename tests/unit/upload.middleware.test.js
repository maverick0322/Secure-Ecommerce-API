const uploadFile = require('../../middlewares/upload.middleware');

describe('Pruebas Unitarias: upload.middleware.js (Defensa CWE-434, CWE-22, CWE-400)', () => {
  it('debe tener configurado un límite estricto de tamaño de 2MB (2097152 bytes)', () => {
    expect(uploadFile.limits).toBeDefined();
    expect(uploadFile.limits.fileSize).toBe(2 * 1024 * 1024);
  });

  describe('Filtro de archivos (fileFilter)', () => {
    it('debe aceptar archivos válidos con extensión .jpg y mimetype image/jpeg', (done) => {
      const mockFile = {
        originalname: 'producto_valido.jpg',
        mimetype: 'image/jpeg'
      };

      uploadFile.fileFilter({}, mockFile, (err, accept) => {
        expect(err).toBeNull();
        expect(accept).toBe(true);
        done();
      });
    });

    it('debe aceptar archivos con extensión .jpeg en mayúsculas o minúsculas', (done) => {
      const mockFile = {
        originalname: 'FOTO_PRODUCTO.JPEG',
        mimetype: 'image/jpeg'
      };

      uploadFile.fileFilter({}, mockFile, (err, accept) => {
        expect(err).toBeNull();
        expect(accept).toBe(true);
        done();
      });
    });

    it('CWE-434: debe rechazar archivos ejecutables o scripts aunque tengan extensión .jpg si el mimetype no coincide', (done) => {
      const mockFile = {
        originalname: 'webshell.php.jpg',
        mimetype: 'application/x-php'
      };

      uploadFile.fileFilter({}, mockFile, (err, accept) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.statusCode).toBe(400);
        expect(accept).toBe(false);
        done();
      });
    });

    it('CWE-434: debe rechazar archivos con mimetype spoofed si la extensión es peligrosa (.php, .exe, .sh)', (done) => {
      const mockFile = {
        originalname: 'script_malicioso.php',
        mimetype: 'image/jpeg'
      };

      uploadFile.fileFilter({}, mockFile, (err, accept) => {
        expect(err).toBeInstanceOf(Error);
        expect(err.statusCode).toBe(400);
        expect(accept).toBe(false);
        done();
      });
    });
  });

  describe('Generación de Nombres de Archivo (storage.filename)', () => {
    it('CWE-22: debe sanitizar el nombre generando un identificador criptográfico sin preservar el nombre del cliente', (done) => {
      const mockFile = {
        originalname: '../../../../etc/passwd'
      };

      uploadFile.storage.getFilename({}, mockFile, (err, filename) => {
        expect(err).toBeNull();
        expect(filename).toBeDefined();
        // Verificar que no contiene secuencias de escape de directorio ni el nombre original
        expect(filename).not.toContain('..');
        expect(filename).not.toContain('passwd');
        expect(filename).toMatch(/^[0-9]+-[a-f0-9]+\.jpg$/);
        done();
      });
    });
  });
});
