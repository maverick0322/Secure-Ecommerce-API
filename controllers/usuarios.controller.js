const { usuario, rol, Sequelize } = require('../models');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const self = {};

// GET: api/usuarios
self.getAll = async function (req, res, next) {
  try {
    const data = await usuario.findAll({
      raw: true,
      attributes: ['id', 'email', 'nombre', 'protegido', [Sequelize.col('rol.nombre'), 'rol']],
      include: { model: rol, attributes: [] }
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/usuarios/:email
self.get = async function (req, res, next) {
  try {
    const email = req.params.email;
    const data = await usuario.findOne({
      where: { email: email },
      raw: true,
      attributes: ['id', 'email', 'nombre', 'protegido', [Sequelize.col('rol.nombre'), 'rol']],
      include: { model: rol, attributes: [] }
    });

    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
  } catch (error) {
    next(error);
  }
};

// POST: api/usuarios
self.create = async function (req, res, next) {
  try {
    const { email, password, nombre, rol: nombreRol } = req.body;

    if (!email || !password || !nombre || !nombreRol) {
      return res.status(400).json({ mensaje: 'Todos los campos (email, password, nombre, rol) son obligatorios.' });
    }

    // Validar si el rol solicitado existe en la base de datos
    const rolusuario = await rol.findOne({ where: { nombre: nombreRol } });
    if (!rolusuario) {
      return res.status(400).json({ mensaje: `El rol '${nombreRol}' no existe en el sistema.` });
    }

    // Verificar si el correo ya está registrado
    const usuarioExistente = await usuario.findOne({ where: { email: email } });
    if (usuarioExistente) {
      return res.status(409).json({ mensaje: 'El correo electrónico ya se encuentra registrado.' });
    }

    // Hash criptográfico con salt rounds = 10
    const passwordHash = await bcrypt.hash(password, 10);

    const data = await usuario.create({
      id: crypto.randomUUID(),
      email: email,
      passwordhash: passwordHash,
      nombre: nombre,
      protegido: false,
      rolid: rolusuario.id
    });

    if (req.bitacora) {
      await req.bitacora('usuarios.crear', data.email);
    }

    return res.status(201).json({
      id: data.id,
      email: data.email,
      nombre: data.nombre,
      rolid: rolusuario.nombre
    });
  } catch (error) {
    next(error);
  }
};

// PUT: api/usuarios/:email
self.update = async function (req, res, next) {
  try {
    const email = req.params.email;
    const usuarioExistente = await usuario.findOne({ where: { email: email } });

    if (!usuarioExistente) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
    }

    const camposActualizar = {};

    if (req.body.nombre) {
      camposActualizar.nombre = req.body.nombre;
    }

    if (req.body.rol) {
      const rolusuario = await rol.findOne({ where: { nombre: req.body.rol } });
      if (!rolusuario) {
        return res.status(400).json({ mensaje: `El rol '${req.body.rol}' no existe en el sistema.` });
      }
      camposActualizar.rolid = rolusuario.id;
    }

    // Si se envía una nueva contraseña, debe hashearse de forma segura
    if (req.body.password) {
      camposActualizar.passwordhash = await bcrypt.hash(req.body.password, 10);
    }

    await usuario.update(camposActualizar, { where: { email: email } });

    if (req.bitacora) {
      await req.bitacora('usuarios.editar', email);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/usuarios/:email
self.delete = async function (req, res, next) {
  try {
    const email = req.params.email;
    const data = await usuario.findOne({ where: { email: email } });

    // CORRECCIÓN CRÍTICA DE ROBUSTEZ: Validar existencia antes de leer data.protegido
    if (!data) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
    }

    // Regla de negocio y seguridad: No se pueden eliminar usuarios protegidos
    if (data.protegido) {
      return res.status(403).json({ mensaje: 'Acceso prohibido: No se pueden eliminar usuarios protegidos del sistema.' });
    }

    const rowsDeleted = await usuario.destroy({ where: { email: email } });
    if (rowsDeleted === 1) {
      if (req.bitacora) {
        await req.bitacora('usuarios.eliminar', email);
      }
      return res.status(204).send();
    }

    return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
  } catch (error) {
    next(error);
  }
};

module.exports = self;
