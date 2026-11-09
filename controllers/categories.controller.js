const {
  Category: category
} = require('../models');
const {
  body,
  validationResult
} = require('express-validator');
const self = {};
self.categoryValidator = [body("name").trim().notEmpty().withMessage("El campo name es obligatorio.").isLength({
  max: 100
}).withMessage('El nombre de la categoría no puede exceder 100 caracteres.')];

// GET: api/categories
self.getAll = async function (req, res, next) {
  try {
    const data = await category.findAll({
      attributes: [['id', "categoryId"], "name", "protected"]
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/categories/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await category.findByPk(id, {
      attributes: [['id', "categoryId"], "name", "protected"]
    });
    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({
      message: 'Categoría no encontrada.'
    });
  } catch (error) {
    next(error);
  }
};

// POST: api/categories
self.create = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Errores de validación en la solicitud.',
        errors: errors.array()
      });
    }
    const data = await category.create({
      name: req.body.name,
      protected: false
    });
    if (req.logAudit) {
      await req.logAudit('categoria.crear', data.id);
    }
    return res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

// PUT: api/categories/:id
self.update = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Errores de validación en la solicitud.',
        errors: errors.array()
      });
    }
    const id = req.params.id;
    const existingCategory = await category.findByPk(id);
    if (!existingCategory) {
      return res.status(404).json({
        message: 'Categoría no encontrada.'
      });
    }

    // Mitigación de asignación masiva (CWE-915): solo permitir actualizar el nombre
    await category.update({
      name: req.body.name
    }, {
      where: {
        id: id
      }
    });
    if (req.logAudit) {
      await req.logAudit('categoria.editar', id);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/categories/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await category.findByPk(id);
    if (!data) {
      return res.status(404).json({
        message: 'Categoría no encontrada.'
      });
    }

    // Prohibir la eliminación de categorías del catálogo inicial protegido
    if (data.protected) {
      return res.status(400).json({
        message: 'No se pueden eliminar categorías protegidas del sistema.'
      });
    }
    const rowsDeleted = await category.destroy({
      where: {
        id: id
      }
    });
    if (rowsDeleted === 1) {
      if (req.logAudit) {
        await req.logAudit('categoria.eliminar', id);
      }
      return res.status(204).send();
    }
    return res.status(404).json({
      message: 'Categoría no encontrada.'
    });
  } catch (error) {
    next(error);
  }
};
module.exports = self;
