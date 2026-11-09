const {
  Product: product,
  Category: category,
  Sequelize
} = require('../models');
const {
  body,
  validationResult
} = require('express-validator');
const Op = Sequelize.Op;
const self = {};
self.productValidator = [body("title").trim().notEmpty().withMessage("El campo title es obligatorio.").isLength({
  max: 255
}).withMessage('El título no puede exceder 255 caracteres.'), body("description").trim().notEmpty().withMessage("El campo description es obligatorio."), body("price").notEmpty().withMessage("El campo price es obligatorio.").isDecimal({
  force_decimal: false
}).withMessage("El campo price debe ser un número decimal válido.")];

// GET: api/products o api/products?s=termino
self.getAll = async function (req, res, next) {
  try {
    const {
      s
    } = req.query;
    const filters = {};
    if (s) {
      filters.title = {
        [Op.like]: `%${s}%`
      };
    }
    const data = await product.findAll({
      where: filters,
      attributes: [['id', "productId"], "title", "description", "price", "fileId"],
      include: {
        model: category,
        as: "categories",
        attributes: [['id', "categoryId"], "name", "protected"],
        through: {
          attributes: []
        }
      },
      subQuery: false
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/products/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await product.findByPk(id, {
      attributes: [['id', "productId"], "title", "description", "price", "fileId"],
      include: {
        model: category,
        as: "categories",
        attributes: [['id', "categoryId"], "name", "protected"],
        through: {
          attributes: []
        }
      }
    });
    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({
      message: 'Producto no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};

// POST: api/products
self.create = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Errores de validación en la solicitud.',
        errors: errors.array()
      });
    }
    const data = await product.create({
      title: req.body.title,
      description: req.body.description,
      price: req.body.price,
      fileId: req.body.fileId || null
    });
    if (req.logAudit) {
      await req.logAudit('producto.crear', data.id);
    }
    return res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

// PUT: api/products/:id
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
    const existingProduct = await product.findByPk(id);
    if (!existingProduct) {
      return res.status(404).json({
        message: 'Producto no encontrado.'
      });
    }

    // Mitigación de asignación masiva (CWE-915): solo permitir campos específicos
    const allowedFields = {
      title: req.body.title,
      description: req.body.description,
      price: req.body.price,
      fileId: req.body.fileId !== undefined ? req.body.fileId : existingProduct.fileId
    };
    await product.update(allowedFields, {
      where: {
        id: id
      }
    });
    if (req.logAudit) {
      await req.logAudit('producto.editar', id);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/products/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await product.findByPk(id);
    if (!data) {
      return res.status(404).json({
        message: 'Producto no encontrado.'
      });
    }
    const rowsDeleted = await product.destroy({
      where: {
        id: id
      }
    });
    if (rowsDeleted === 1) {
      if (req.logAudit) {
        await req.logAudit('producto.eliminar', id);
      }
      return res.status(204).send();
    }
    return res.status(404).json({
      message: 'Producto no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};

// POST: api/products/:id/categories
self.assignCategory = async function (req, res, next) {
  try {
    const categoryId = req.body.categoryId;
    if (!categoryId) {
      return res.status(400).json({
        message: "El campo categoryId es obligatorio."
      });
    }
    const itemToAssign = await category.findByPk(categoryId);
    if (!itemToAssign) {
      return res.status(404).json({
        message: 'Categoría no encontrada.'
      });
    }
    const item = await product.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({
        message: 'Producto no encontrado.'
      });
    }
    await item.addCategory(itemToAssign);
    if (req.logAudit) {
      await req.logAudit('productocategoria.agregar', `${req.params.id}:${categoryId}`);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/products/:id/categories/:categoryId
self.removeCategory = async function (req, res, next) {
  try {
    const itemToRemove = await category.findByPk(req.params.categoryId);
    if (!itemToRemove) {
      return res.status(404).json({
        message: 'Categoría no encontrada.'
      });
    }
    const item = await product.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({
        message: 'Producto no encontrado.'
      });
    }
    await item.removeCategory(itemToRemove);
    if (req.logAudit) {
      await req.logAudit('productocategoria.remover', `${req.params.id}:${req.params.categoryId}`);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};
module.exports = self;
