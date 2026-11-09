const {
  AuditLog: auditLog
} = require('../models');
const self = {};

// GET: api/audit-logs
self.getAll = async function (req, res, next) {
  try {
    const data = await auditLog.findAll({
      attributes: [['id', "auditLogId"], "action", "elementId", 'ip', "user", "date"],
      order: [['id', 'DESC']]
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};
module.exports = self;
