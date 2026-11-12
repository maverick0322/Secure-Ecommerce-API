const router = require('express').Router();
const users = require("../controllers/users.controller");
const authorize = require('../middlewares/auth.middleware');

// GET: api/users
router.get('/', authorize('ADMIN'), users.getAll);

// GET: api/users/:email
router.get('/:email', authorize('ADMIN'), users.get);

router.put('/sellers/:userId/review', authorize('ADMIN'), users.reviewSeller);
router.put('/sellers/:userId/suspend', authorize('ADMIN'), users.suspendSeller);

// PUT: api/users/:email
router.put('/:email', authorize('ADMIN'), users.update);

// DELETE: api/users/:email
router.delete('/:email', authorize('ADMIN'), users.remove);
module.exports = router;
