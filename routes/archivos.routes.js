const router = require('express').Router();
const archivos = require('../controllers/archivos.controller');
const Authorize = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');
const { uploadErrorHandler } = require('../middlewares/upload.middleware');

// GET: api/archivos
router.get('/', Authorize('Administrador'), archivos.getAll);

// GET: api/archivos/:id/detalle
router.get('/:id/detalle', Authorize('Administrador'), archivos.getDetalle);

// GET: api/archivos/:id (Público / Usuarios autorizados para visualización de imagen)
router.get('/:id', archivos.get);

// POST: api/archivos (Autorización antes de upload para evitar consumo de disco por usuarios no autenticados)
router.post('/', Authorize('Administrador'), upload.single('file'), uploadErrorHandler, archivos.create);

// PUT: api/archivos/:id
router.put('/:id', Authorize('Administrador'), upload.single('file'), uploadErrorHandler, archivos.update);

// DELETE: api/archivos/:id
router.delete('/:id', Authorize('Administrador'), archivos.delete);

module.exports = router;

