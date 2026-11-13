const multer = require('multer');
const path = require('node:path');
const { AccountError, respondError } = require('../services/accounts.service');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const types = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] };

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
  fileFilter(req, file, callback) {
    const allowed = types[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase());
    callback(allowed ? null : new AccountError(400, 'Solo se admiten imágenes JPEG, PNG o WebP.'), Boolean(allowed));
  }
});

function detectedType(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function validateImage(req, res, next) {
  if (!req.file || detectedType(req.file.buffer) !== req.file.mimetype) {
    return respondError(res, new AccountError(400, 'El contenido no corresponde a una imagen permitida.'));
  }
  return next();
}

function uploadErrorHandler(error, req, res, next) {
  if (!error) return next();
  if (error instanceof multer.MulterError) return respondError(res, new AccountError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    'Envíe una sola imagen de hasta 2 MB en el campo image.'));
  return respondError(res, error);
}

module.exports = { upload, validateImage, uploadErrorHandler, MAX_IMAGE_BYTES, detectedType };
