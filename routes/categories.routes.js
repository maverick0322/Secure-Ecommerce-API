const router = require('express').Router();
const categories = require('../controllers/categories.controller');
const authorize = require('../middlewares/auth.middleware');

router.get('/', authorize('ADMIN, BUYER, SELLER'), categories.getAll);
router.get('/:id', authorize('ADMIN, BUYER, SELLER'), categories.get);
router.post('/', authorize('ADMIN'), categories.create);
router.put('/:id', authorize('ADMIN'), categories.update);
router.delete('/:id', authorize('ADMIN'), categories.remove);

module.exports = router;
