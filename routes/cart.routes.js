'use strict';
const router = require('express').Router();
const cart = require('../controllers/cart.controller');
router.use(require('../middlewares/auth.middleware')('BUYER'));
router.get('/',cart.get);
router.post('/items',cart.add);
router.put('/items/:productId',cart.update);
router.delete('/items/:productId',cart.remove);
module.exports = router;
