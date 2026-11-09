const router = require('express').Router();
const users = require("../controllers/users.controller");
const authorize = require('../middlewares/auth.middleware');

// GET: api/users
router.get('/', authorize('Administrador'), users.getAll);

// GET: api/users/:email
router.get('/:email', authorize('Administrador'), users.get);

// POST: api/users
router.post('/', authorize('Administrador'), users.create);

// PUT: api/users/:email
router.put('/:email', authorize('Administrador'), users.update);

// DELETE: api/users/:email
router.delete('/:email', authorize('Administrador'), users.delete);
module.exports = router;
