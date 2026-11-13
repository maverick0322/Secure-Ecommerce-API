'use strict';
const router=require('express').Router();
const orders=require('../controllers/orders.controller');
router.use(require('../middlewares/auth.middleware')('BUYER'));
router.post('/quote',orders.quote);router.post('/',orders.confirm);
module.exports=router;
