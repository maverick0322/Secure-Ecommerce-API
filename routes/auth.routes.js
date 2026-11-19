const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const authorize = require('../middlewares/auth.middleware');
const { createAuthLimiters } = require('../middlewares/auth-rate-limit.middleware');
const limiters = createAuthLimiters();

// POST: api/auth
router.post('/', limiters.login, auth.login);
router.post('/refresh', limiters.refresh, auth.refresh);
router.post('/logout', limiters.logout, authorize('ADMIN, BUYER, SELLER', { allowUnapprovedSeller: true }), auth.logout);
router.post('/register', limiters.register, auth.requestRegistrationCode);
router.post('/register/verify', limiters.registerVerify, auth.register);
router.post('/password/forgot', limiters.passwordForgot, require('../controllers/personal-account.controller').forgot);
router.post('/password/reset', limiters.passwordReset, require('../controllers/personal-account.controller').reset);

// GET: api/auth/time
router.get('/time', authorize('ADMIN, BUYER, SELLER', { allowUnapprovedSeller: true }), auth.time);
module.exports = router;
