const router = require('express').Router();
const products = require('../controllers/products.controller');
const authorize = require('../middlewares/auth.middleware');
const { upload, validateImage, uploadErrorHandler } = require('../middlewares/upload.middleware');

router.get('/', authorize('ADMIN, BUYER, SELLER'), products.getAll);
router.get('/:id', authorize('ADMIN, BUYER, SELLER'), products.get);
router.post('/', authorize('SELLER'), products.create);
router.put('/:id', authorize('SELLER'), products.update);
router.delete('/:id', authorize('SELLER'), products.remove);
router.post('/:id/categories', authorize('SELLER'), products.assignCategory);
router.delete('/:id/categories/:categoryId', authorize('SELLER'), products.removeCategory);
router.put('/:id/image', authorize('SELLER'), products.checkImageOwner, upload.single('image'), uploadErrorHandler, validateImage, products.replaceImage);
router.delete('/:id/image', authorize('SELLER'), products.removeImage);

module.exports = router;
