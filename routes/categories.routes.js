const router = require('express').Router();
const categories = require("../controllers/categories.controller");
const authorize = require('../middlewares/auth.middleware');

// GET: api/categories
router.get('/', authorize('Usuario, Administrador'), categories.getAll);

// GET: api/categories/:id
router.get('/:id', authorize('Usuario, Administrador'), categories.get);

// POST: api/categories
router.post('/', authorize('Administrador'), categories.categoryValidator, categories.create);

// PUT: api/categories/:id
router.put('/:id', authorize('Administrador'), categories.categoryValidator, categories.update);

// DELETE: api/categories/:id
router.delete('/:id', authorize('Administrador'), categories.delete);
module.exports = router;
