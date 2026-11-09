const router = require('express').Router();
const roles = require('../controllers/roles.controller');
const authorize = require('../middlewares/auth.middleware');

// GET: api/roles
router.get('/', authorize('Administrador'), roles.getAll);
module.exports = router;
