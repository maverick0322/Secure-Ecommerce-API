const bcrypt = require('bcrypt');
const {
  User: user,
  Role: role,
  Sequelize
} = require('../models');
const {
  generateToken,
  getRemainingTokenTime
} = require('../services/jwttoken.service');
const self = {};

// Hash ficticio para mitigar ataques de temporización (CWE-208)
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

// POST: api/auth
self.login = async function (req, res, next) {
  const {
    email,
    password
  } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({
        message: 'El correo electrónico y la contraseña son requeridos.'
      });
    }
    const data = await user.findOne({
      where: {
        email: email
      },
      raw: true,
      attributes: ['id', 'email', "name", "passwordHash", [Sequelize.col("role.name"), "role"]],
      include: {
        model: role,
        as: 'role',
        attributes: []
      }
    });

    // Mitigación de ataques de temporización: si el usuario no existe, ejecutar bcrypt.compare con hash ficticio
    if (data === null) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({
        message: 'Usuario o contraseña incorrectos.'
      });
    }

    // Comparar la contraseña contra el hash almacenado
    const passwordMatch = await bcrypt.compare(password, data.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Usuario o contraseña incorrectos.'
      });
    }

    // Generar token de acceso seguro
    const token = generateToken(data.email, data.name, data.role);

    // Registrar en bitácora de auditoría pasando el correo del usuario que inicia sesión
    if (req.logAudit) {
      await req.logAudit('usuario.login', data.email, data.email);
    }
    return res.status(200).json({
      email: data.email,
      name: data.name,
      role: data.role,
      jwt: token
    });
  } catch (error) {
    next(error);
  }
};

// GET: api/auth/time
self.time = async function (req, res) {
  const time = getRemainingTokenTime(req);

  // CORRECCIÓN CRÍTICA: Retorno anticipado para evitar ERR_HTTP_HEADERS_SENT
  if (time == null) {
    return res.status(404).json({
      message: 'No se pudo determinar el tiempo restante de la sesión.'
    });
  }
  return res.status(200).json({
    remainingTime: time
  });
};
module.exports = self;
