const {
  User: user,
  Role: role,
  Sequelize
} = require('../models');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const self = {};

// GET: api/users
self.getAll = async function (req, res, next) {
  try {
    const data = await user.findAll({
      raw: true,
      attributes: ['id', 'email', "name", "protected", [Sequelize.col("role.name"), "role"]],
      include: {
        model: role,
        as: 'role',
        attributes: []
      }
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/users/:email
self.get = async function (req, res, next) {
  try {
    const email = req.params.email;
    const data = await user.findOne({
      where: {
        email: email
      },
      raw: true,
      attributes: ['id', 'email', "name", "protected", [Sequelize.col("role.name"), "role"]],
      include: {
        model: role,
        as: 'role',
        attributes: []
      }
    });
    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({
      message: 'Usuario no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};

// POST: api/users
self.create = async function (req, res, next) {
  try {
    const {
      email,
      password,
      name,
      role: roleName
    } = req.body;
    if (!email || !password || !name || !roleName) {
      return res.status(400).json({
        message: "Todos los campos (email, password, name, role) son obligatorios."
      });
    }

    // Validar si el rol solicitado existe en la base de datos
    const userRole = await role.findOne({
      where: {
        name: roleName
      }
    });
    if (!userRole) {
      return res.status(400).json({
        message: `El rol '${roleName}' no existe en el sistema.`
      });
    }

    // Verificar si el correo ya está registrado
    const existingUser = await user.findOne({
      where: {
        email: email
      }
    });
    if (existingUser) {
      return res.status(409).json({
        message: 'El correo electrónico ya se encuentra registrado.'
      });
    }

    // Hash criptográfico con rondas de sal = 10
    const passwordHash = await bcrypt.hash(password, 10);
    const data = await user.create({
      id: crypto.randomUUID(),
      email: email,
      passwordHash,
      name,
      protected: false,
      roleId: userRole.id
    });
    if (req.logAudit) {
      await req.logAudit('usuarios.crear', data.email);
    }
    return res.status(201).json({
      id: data.id,
      email: data.email,
      name: data.name,
      role: userRole.name
    });
  } catch (error) {
    next(error);
  }
};

// PUT: api/users/:email
self.update = async function (req, res, next) {
  try {
    const email = req.params.email;
    const existingUser = await user.findOne({
      where: {
        email: email
      }
    });
    if (!existingUser) {
      return res.status(404).json({
        message: 'Usuario no encontrado.'
      });
    }
    const fieldsToUpdate = {};
    if (req.body.name) {
      fieldsToUpdate.name = req.body.name;
    }
    if (req.body.role) {
      const userRole = await role.findOne({
        where: {
          name: req.body.role
        }
      });
      if (!userRole) {
        return res.status(400).json({
          message: `El rol '${req.body.role}' no existe en el sistema.`
        });
      }
      fieldsToUpdate.roleId = userRole.id;
    }

    // Si se envía una nueva contraseña, debe hashearse de forma segura
    if (req.body.password) {
      fieldsToUpdate.passwordHash = await bcrypt.hash(req.body.password, 10);
    }
    await user.update(fieldsToUpdate, {
      where: {
        email: email
      }
    });
    if (req.logAudit) {
      await req.logAudit('usuarios.editar', email);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/users/:email
self.delete = async function (req, res, next) {
  try {
    const email = req.params.email;
    const data = await user.findOne({
      where: {
        email: email
      }
    });

    // CORRECCIÓN CRÍTICA DE ROBUSTEZ: Validar existencia antes de leer data.protected
    if (!data) {
      return res.status(404).json({
        message: 'Usuario no encontrado.'
      });
    }

    // Regla de negocio y seguridad: No se pueden eliminar usuarios protegidos
    if (data.protected) {
      return res.status(403).json({
        message: 'Acceso prohibido: No se pueden eliminar usuarios protegidos del sistema.'
      });
    }
    const rowsDeleted = await user.destroy({
      where: {
        email: email
      }
    });
    if (rowsDeleted === 1) {
      if (req.logAudit) {
        await req.logAudit('usuarios.eliminar', email);
      }
      return res.status(204).send();
    }
    return res.status(404).json({
      message: 'Usuario no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};
module.exports = self;
