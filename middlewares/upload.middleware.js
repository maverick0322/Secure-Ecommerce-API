const multer = require('multer');
const {
  MulterError
} = multer;
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const uploadsDirectory = path.resolve(__dirname, '../uploads');

// Asegurar que el directorio de almacenamiento en disco exista
if (!fs.existsSync(uploadsDirectory)) {
  fs.mkdirSync(uploadsDirectory, {
    recursive: true
  });
}

// Filtro de validación sintáctica y de tipo MIME
const imageFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();
  const validExtension = ['.jpg', '.jpeg'].includes(extension);
  const validMime = file.mimetype === 'image/jpeg' || file.mimetype === 'image/pjpeg';
  if (validMime && validExtension) {
    cb(null, true);
  } else {
    const error = new Error('Solo se permiten imágenes con formato JPG/JPEG (.jpg, .jpeg).');
    error.statusCode = 400;
    cb(error, false);
  }
};

// Configuración de almacenamiento en disco con mitigación de recorrido de rutas (CWE-22)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDirectory);
  },
  filename: (req, file, cb) => {
    // Generar identificador criptográfico único para disociar el nombre original del cliente
    const safeFilename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.jpg`;
    cb(null, safeFilename);
  }
});

// Instancia de Multer con límite de tamaño para mitigar DoS por saturación de disco (CWE-400)
const uploadFile = multer({
  storage: storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2 megabytes
  }
});

/**
 * Envoltura que convierte errores MulterError en respuestas HTTP 400 claras.
 * Se usa en las rutas como: upload.single('file'), uploadErrorHandler
 */
const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof MulterError) {
    let message = 'Error al procesar el archivo.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'El archivo supera el tamaño máximo permitido de 2 MB.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = `Campo de archivo inesperado: '${err.field}'. Use el campo 'file'.`;
    }
    return res.status(400).json({
      message
    });
  }
  next(err);
};
module.exports = uploadFile;
module.exports.uploadErrorHandler = uploadErrorHandler;
module.exports.MulterError = MulterError;
