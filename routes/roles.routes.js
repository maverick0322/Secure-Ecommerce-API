const router = require('express').Router();
const roles = require('../controllers/roles.controller');
const Authorize = require('../middlewares/auth.middleware');

// GET: api/roles
router.get('/', Authorize('Administrador'), roles.getAll);

module.exports = router;
