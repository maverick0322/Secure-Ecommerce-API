const router = require('express').Router();
const categorias = require('../controllers/categorias.controller');
const Authorize = require('../middlewares/auth.middleware');

// GET: api/categorias
router.get('/', Authorize('Usuario, Administrador'), categorias.getAll);

// GET: api/categorias/:id
router.get('/:id', Authorize('Usuario, Administrador'), categorias.get);

// POST: api/categorias
router.post('/', Authorize('Administrador'), categorias.categoriaValidator, categorias.create);

// PUT: api/categorias/:id
router.put('/:id', Authorize('Administrador'), categorias.categoriaValidator, categorias.update);

// DELETE: api/categorias/:id
router.delete('/:id', Authorize('Administrador'), categorias.delete);

module.exports = router;
