const router = require('express').Router();
const auditLog = require("../controllers/audit-logs.controller");
const authorize = require('../middlewares/auth.middleware');

// GET: api/audit-logs
router.get('/', authorize('ADMIN'), auditLog.getAll);
module.exports = router;
