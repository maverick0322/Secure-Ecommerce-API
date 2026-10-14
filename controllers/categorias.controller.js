const { categoria } = require('../models');
const { body, validationResult } = require('express-validator');

const self = {};

self.categoriaValidator = [
  body('nombre')
    .trim()
    .notEmpty()
    .withMessage('El campo nombre es obligatorio.')
    .isLength({ max: 100 })
    .withMessage('El nombre de la categoría no puede exceder 100 caracteres.')
];

// GET: api/categorias
self.getAll = async function (req, res, next) {
  try {
    const data = await categoria.findAll({
      attributes: [['id', 'categoriaId'], 'nombre', 'protegida']
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/categorias/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await categoria.findByPk(id, {
      attributes: [['id', 'categoriaId'], 'nombre', 'protegida']
    });

    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
  } catch (error) {
    next(error);
  }
};

// POST: api/categorias
self.create = async function (req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        mensaje: 'Errores de validación en la solicitud.',
        errores: errors.array()
      });
    }

    const data = await categoria.create({
      nombre: req.body.nombre,
      protegida: false
    });

    if (req.bitacora) {
      await req.bitacora('categoria.crear', data.id);
    }

    return res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

// PUT: api/categorias/:id
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
    const categoriaExistente = await categoria.findByPk(id);

    if (!categoriaExistente) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
    }

    // Mitigación de Mass Assignment (CWE-915): solo permitir actualizar el nombre
    await categoria.update(
      { nombre: req.body.nombre },
      { where: { id: id } }
    );

    if (req.bitacora) {
      await req.bitacora('categoria.editar', id);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/categorias/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await categoria.findByPk(id);

    if (!data) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
    }

    // Prohibir la eliminación de categorías del catálogo inicial protegido
    if (data.protegida) {
      return res.status(400).json({ mensaje: 'No se pueden eliminar categorías protegidas del sistema.' });
    }

    const rowsDeleted = await categoria.destroy({ where: { id: id } });
    if (rowsDeleted === 1) {
      if (req.bitacora) {
        await req.bitacora('categoria.eliminar', id);
      }
      return res.status(204).send();
    }

    return res.status(404).json({ mensaje: 'Categoría no encontrada.' });
  } catch (error) {
    next(error);
  }
};

module.exports = self;
