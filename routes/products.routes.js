const router = require('express').Router();
const products = require("../controllers/products.controller");
const authorize = require('../middlewares/auth.middleware');

// GET: api/products
router.get('/', authorize('Usuario, Administrador'), products.getAll);

// GET: api/products/:id
router.get('/:id', authorize('Usuario, Administrador'), products.get);

// POST: api/products
router.post('/', authorize('Administrador'), products.productValidator, products.create);

// PUT: api/products/:id
router.put('/:id', authorize('Administrador'), products.productValidator, products.update);

// DELETE: api/products/:id
router.delete('/:id', authorize('Administrador'), products.delete);

// POST: api/products/:id/categories
router.post("/:id/categories", authorize('Administrador'), products.assignCategory);

// DELETE: api/products/:id/categories/:categoryId
router.delete("/:id/categories/:categoryId", authorize('Administrador'), products.removeCategory);
module.exports = router;
