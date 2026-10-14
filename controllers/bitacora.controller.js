const { bitacora } = require('../models');

const self = {};

// GET: api/bitacora
self.getAll = async function (req, res, next) {
  try {
    const data = await bitacora.findAll({
      attributes: [['id', 'bitacoraId'], 'accion', 'elementoid', 'ip', 'usuario', 'fecha'],
      order: [['id', 'DESC']]
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = self;
