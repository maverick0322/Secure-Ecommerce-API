const router = require('express').Router();
const files = require('../controllers/files.controller');
const authorize = require('../middlewares/auth.middleware');

router.get('/', authorize('ADMIN'), files.getAll);
router.get('/:id/details', authorize('ADMIN'), files.getDetails);
router.get('/:id', files.get);
router.post('/', authorize('ADMIN'), files.retired);
router.put('/:id', authorize('ADMIN'), files.retired);
router.delete('/:id', authorize('ADMIN'), files.retired);

module.exports = router;
