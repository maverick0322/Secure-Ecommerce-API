const bcrypt = require('bcrypt');
const accounts = require('../services/accounts.service');
const verification = require('../services/email-verification.service');
const { generateToken, getRemainingTokenTime } = require('../services/jwttoken.service');

// A synthetic bcrypt hash makes the missing-account comparison comparable in cost.
const DUMMY_HASH = '$2b$12$yIYsFG/CLkHoQu1IXqg0Ke4Vy3kGCImKQPBR0tcNW5QXxWLnxZH3y';
const { AccountError, respondError } = accounts;

async function requestRegistrationCode(req, res) {
  try {
    const email = await accounts.normalizeEmail(req.body?.email);
    await verification.issue(email);
    return res.status(202).json({ message: 'Solicitud de verificación recibida.' });
  } catch (error) {
    if(req.logAudit && error instanceof AccountError) await req.logAudit('auth.registration.denied',null,null,error.status>=500?'ERROR':'DENIED');
    return respondError(res, error);
  }
}

async function register(req, res) {
  try {
    const { email: address, code, name: inputName, password: inputPassword, profile, storeName: inputStore } = req.body || {};
    if (profile !== 'BUYER' && profile !== 'SELLER') throw new AccountError(400, 'Seleccione el perfil BUYER o SELLER.');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AccountError(400, 'El código es inválido o ha caducado.');
    const email = await accounts.normalizeEmail(address);
    const name = accounts.text(inputName, 120, 'El nombre debe tener entre 1 y 120 caracteres.');
    const password = accounts.newPassword(inputPassword);
    const storeName = profile === 'SELLER' ? accounts.text(inputStore, 120, 'El nombre comercial debe tener entre 1 y 120 caracteres.') : undefined;
    const account = await verification.verify(email, code, () => accounts.createPublicAccount(
      { email, name, password, profile, storeName }, { ipAddress: req.ip }));
    return res.status(201).json(account);
  } catch (error) {
    if(req.logAudit && error instanceof AccountError) await req.logAudit('auth.verification.denied',null,null,error.status>=500?'ERROR':'DENIED');
    return respondError(res, error);
  }
}

async function login(req, res) {
  try {
    const { email: address, password } = req.body || {};
    const email = await accounts.normalizeEmail(address);
    if (!accounts.validPassword(password)) throw new AccountError(400, 'La contraseña no es válida.');
    const account = await accounts.findAccountByEmail(email, true);
    const match = await bcrypt.compare(password, account?.passwordHash || DUMMY_HASH);
    const profile = accounts.accountType(account);
    if (!account || !match || !accounts.isActive(account) || !profile) {
      throw new AccountError(401, 'Usuario o contraseña incorrectos.');
    }
    const result = accounts.serializeAccount(account, profile);
    await require('../services/audit.service').write({ actorUserId: account.id, action: 'usuario.login',
      targetType: 'user', targetId: account.id, ipAddress: req.ip });
    const jwt = generateToken(result);
    return res.status(200).json({ ...result, jwt });
  } catch (error) {
    if(req.logAudit && error instanceof AccountError) await req.logAudit('auth.login.denied',null,null,error.status>=500?'ERROR':'DENIED');
    return respondError(res, error);
  }
}

function time(req, res) {
  return res.status(200).json({ remainingTime: getRemainingTokenTime(req.decodedToken) });
}

module.exports = { login, time, requestRegistrationCode, register };
