const router = require('express').Router();
const productos = require('../controllers/productos.controller');
const Authorize = require('../middlewares/auth.middleware');

// GET: api/productos
router.get('/', Authorize('Usuario, Administrador'), productos.getAll);

// GET: api/productos/:id
router.get('/:id', Authorize('Usuario, Administrador'), productos.get);

// POST: api/productos
router.post('/', Authorize('Administrador'), productos.productoValidator, productos.create);

// PUT: api/productos/:id
router.put('/:id', Authorize('Administrador'), productos.productoValidator, productos.update);

// DELETE: api/productos/:id
router.delete('/:id', Authorize('Administrador'), productos.delete);

// POST: api/productos/:id/categoria
router.post('/:id/categoria', Authorize('Administrador'), productos.asignaCategoria);

// DELETE: api/productos/:id/categoria/:categoriaid
router.delete('/:id/categoria/:categoriaid', Authorize('Administrador'), productos.eliminaCategoria);

module.exports = router;
