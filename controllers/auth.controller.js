const bcrypt = require('bcrypt');
const { usuario, rol, Sequelize } = require('../models');
const { GeneraToken, TiempoRestanteToken } = require('../services/jwttoken.service');

const self = {};

// Hash ficticio para mitigar ataques de temporización (Timing Attacks - CWE-208)
const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

// POST: api/auth
self.login = async function (req, res, next) {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ mensaje: 'El correo electrónico y la contraseña son requeridos.' });
    }

    const data = await usuario.findOne({
      where: { email: email },
      raw: true,
      attributes: ['id', 'email', 'nombre', 'passwordhash', [Sequelize.col('rol.nombre'), 'rol']],
      include: { model: rol, attributes: [] }
    });

    // Mitigación de Timing Attacks: si el usuario no existe, ejecutar bcrypt.compare con hash dummy
    if (data === null) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });
    }

    // Comparar la contraseña contra el hash almacenado
    const passwordMatch = await bcrypt.compare(password, data.passwordhash);
    if (!passwordMatch) {
      return res.status(401).json({ mensaje: 'Usuario o contraseña incorrectos.' });
    }

    // Generar token de acceso seguro
    const token = GeneraToken(data.email, data.nombre, data.rol);

    // Registrar en bitácora de auditoría pasando el correo del usuario que inicia sesión
    if (req.bitacora) {
      await req.bitacora('usuario.login', data.email, data.email);
    }

    return res.status(200).json({
      email: data.email,
      nombre: data.nombre,
      rol: data.rol,
      jwt: token
    });
  } catch (error) {
    next(error);
  }
};

// GET: api/auth/tiempo
self.tiempo = async function (req, res) {
  const tiempo = TiempoRestanteToken(req);

  // CORRECCIÓN CRÍTICA: Retorno anticipado para evitar ERR_HTTP_HEADERS_SENT
  if (tiempo == null) {
    return res.status(404).json({ mensaje: 'No se pudo determinar el tiempo restante de la sesión.' });
  }

  return res.status(200).json({ tiempoRestante: tiempo });
};

module.exports = self;
