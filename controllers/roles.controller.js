const { rol } = require('../models');

const self = {};

// GET: api/roles
self.getAll = async function (req, res, next) {
  try {
    const data = await rol.findAll({
      attributes: ['id', 'nombre']
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = self;
