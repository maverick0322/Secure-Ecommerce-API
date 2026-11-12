'use strict';

const router = require('express').Router();
const authorize = require('../middlewares/auth.middleware');
const addresses = require('../controllers/addresses.controller');

router.use(authorize('BUYER'));
router.get('/', addresses.list);
router.post('/', addresses.create);
router.put('/:id', addresses.update);
router.delete('/:id', addresses.remove);
router.put('/:id/default', addresses.setDefault);

module.exports = router;
