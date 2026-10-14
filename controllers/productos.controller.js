const { producto, categoria, Sequelize } = require('../models');
const { body, validationResult } = require('express-validator');
const Op = Sequelize.Op;

const self = {};

self.productoValidator = [
  body('titulo')
    .trim()
    .notEmpty()
    .withMessage('El campo titulo es obligatorio.')
    .isLength({ max: 255 })
    .withMessage('El título no puede exceder 255 caracteres.'),
  body('descripcion')
    .trim()
    .notEmpty()
    .withMessage('El campo descripcion es obligatorio.'),
  body('precio')
    .notEmpty()
    .withMessage('El campo precio es obligatorio.')
    .isDecimal({ force_decimal: false })
    .withMessage('El campo precio debe ser un número decimal válido.')
];

// GET: api/productos o api/productos?s=termino
self.getAll = async function (req, res, next) {
  try {
    const { s } = req.query;
    const filters = {};

    if (s) {
      filters.titulo = { [Op.like]: `%${s}%` };
    }

    const data = await producto.findAll({
      where: filters,
      attributes: [['id', 'productoId'], 'titulo', 'descripcion', 'precio', 'archivoid'],
      include: {
        model: categoria,
        as: 'categorias',
        attributes: [['id', 'categoriaId'], 'nombre', 'protegida'],
        through: { attributes: [] }
      },
      subQuery: false
    });

    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/productos/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await producto.findByPk(id, {
      attributes: [['id', 'productoId'], 'titulo', 'descripcion', 'precio', 'archivoid'],
      include: {
        model: categoria,
        as: 'categorias',
        attributes: [['id', 'categoriaId'], 'nombre', 'protegida'],
        through: { attributes: [] }
      }
    });

    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({ mensaje: 'Producto no encontrado.' });
  } catch (error) {
    next(error);
  }
};

// POST: api/productos
self.create = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        mensaje: 'Errores de validación en la solicitud.',
        errores: errors.array()
      });
    }

    const data = await producto.create({
      titulo: req.body.titulo,
      descripcion: req.body.descripcion,
      precio: req.body.precio,
      archivoid: req.body.archivoid || null
    });

    if (req.bitacora) {
      await req.bitacora('producto.crear', data.id);
    }

    return res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

// PUT: api/productos/:id
self.update = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        mensaje: 'Errores de validación en la solicitud.',
        errores: errors.array()
      });
    }

    const id = req.params.id;
    const productoExistente = await producto.findByPk(id);

    if (!productoExistente) {
      return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    }

    // Mitigación de Mass Assignment (CWE-915): solo permitir campos específicos
    const camposPermitidos = {
      titulo: req.body.titulo,
      descripcion: req.body.descripcion,
      precio: req.body.precio,
      archivoid: req.body.archivoid !== undefined ? req.body.archivoid : productoExistente.archivoid
    };

    await producto.update(camposPermitidos, { where: { id: id } });

    if (req.bitacora) {
      await req.bitacora('producto.editar', id);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/productos/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await producto.findByPk(id);

    if (!data) {
      return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    }

    const rowsDeleted = await producto.destroy({ where: { id: id } });
    if (rowsDeleted === 1) {
      if (req.bitacora) {
        await req.bitacora('producto.eliminar', id);
      }
      return res.status(204).send();
    }

    return res.status(404).json({ mensaje: 'Producto no encontrado.' });
  } catch (error) {
    next(error);
  }
};

// POST: api/productos/:id/categoria
self.asignaCategoria = async function (req, res, next) {
  try {
    const categoriaId = req.body.categoriaid;
    if (!categoriaId) {
      return res.status(400).json({ mensaje: 'El campo categoriaid es obligatorio.' });
    }

    const itemToAssign = await categoria.findByPk(categoriaId);
    if (!itemToAssign) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
    }

    const item = await producto.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    }

    await item.addCategoria(itemToAssign);

    if (req.bitacora) {
      await req.bitacora('productocategoria.agregar', `${req.params.id}:${categoriaId}`);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/productos/:id/categoria/:categoriaid
self.eliminaCategoria = async function (req, res, next) {
  try {
    const itemToRemove = await categoria.findByPk(req.params.categoriaid);
    if (!itemToRemove) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
    }

    const item = await producto.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ mensaje: 'Producto no encontrado.' });
    }

    await item.removeCategoria(itemToRemove);

    if (req.bitacora) {
      await req.bitacora('productocategoria.remover', `${req.params.id}:${req.params.categoriaid}`);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

module.exports = self;
