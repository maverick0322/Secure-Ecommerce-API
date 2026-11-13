const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const authorize = require('../middlewares/auth.middleware');
const rateLimit = require('../middlewares/auth-rate-limit.middleware')();

// POST: api/auth
router.post('/', rateLimit, auth.login);
router.post('/refresh', rateLimit, auth.refresh);
router.post('/logout', rateLimit, authorize('ADMIN, BUYER, SELLER', { allowUnapprovedSeller: true }), auth.logout);
router.post('/register', rateLimit, auth.requestRegistrationCode);
router.post('/register/verify', rateLimit, auth.register);

// GET: api/auth/time
router.get('/time', authorize('ADMIN, BUYER, SELLER', { allowUnapprovedSeller: true }), auth.time);
module.exports = router;
