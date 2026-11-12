'use strict';
const router=require('express').Router();
const authorize=require('../middlewares/auth.middleware');
const orders=require('../controllers/orders.controller');
router.get('/',authorize('ADMIN,BUYER,SELLER'),orders.list);
router.get('/:id',authorize('ADMIN,BUYER,SELLER'),orders.get);
router.put('/:id/status',authorize('ADMIN,BUYER,SELLER'),orders.transition);
module.exports=router;
