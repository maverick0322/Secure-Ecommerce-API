const {
  Role: role
} = require('../models');
const self = {};

// GET: api/roles
self.getAll = async function (req, res, next) {
  try {
    const data = await role.findAll({
      attributes: ['id', "name"]
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};
module.exports = self;
