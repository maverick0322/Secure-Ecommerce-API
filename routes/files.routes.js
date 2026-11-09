const router = require('express').Router();
const files = require("../controllers/files.controller");
const authorize = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');
const {
  uploadErrorHandler
} = require('../middlewares/upload.middleware');

// GET: api/files
router.get('/', authorize('Administrador'), files.getAll);

// GET: api/files/:id/details
router.get("/:id/details", authorize('Administrador'), files.getDetails);

// GET: api/files/:id (Público / Usuarios autorizados para visualización de imagen)
router.get('/:id', files.get);

// POST: api/files (Autorización antes de la carga para evitar consumo de disco por usuarios no autenticados)
router.post('/', authorize('Administrador'), upload.single('file'), uploadErrorHandler, files.create);

// PUT: api/files/:id
router.put('/:id', authorize('Administrador'), upload.single('file'), uploadErrorHandler, files.update);

// DELETE: api/files/:id
router.delete('/:id', authorize('Administrador'), files.delete);
module.exports = router;
