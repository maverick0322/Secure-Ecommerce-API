const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const Authorize = require('../middlewares/auth.middleware');

// POST: api/auth
router.post('/', auth.login);

// GET: api/auth/tiempo
router.get('/tiempo', Authorize('Usuario, Administrador'), auth.tiempo);

module.exports = router;
