const accounts = require('../services/accounts.service');
const verification = require('../services/email-verification.service');
const { getRemainingTokenTime } = require('../services/jwttoken.service');

const authentication = require('../services/authentication.service');
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
    const result = await authentication.login(req.body, { ipAddress: req.ip });
    res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache');
    return res.status(200).json(result);
  } catch (error) {
    if (req.logAudit && error instanceof AccountError) await req.logAudit('auth.login.denied', null, null, 'DENIED');
    return respondError(res, error);
  }
}
async function refresh(req, res) {
  try {
    const result = await authentication.refresh(req.body, { ipAddress: req.ip });
    res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache');
    return res.status(200).json(result);
  } catch (error) {
    if (req.logAudit && error?.name === 'AuthSessionError') await req.logAudit('auth.refresh.denied', null, null, 'DENIED');
    return respondError(res, error);
  }
}
async function logout(req, res) {
  try {
    if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw new AccountError(400, 'El cierre de sesión no admite campos.');
    }
    await authentication.logout(req.account, req.decodedToken, { ipAddress: req.ip });
    res.set('Cache-Control', 'no-store'); return res.status(204).end();
  } catch (error) { return respondError(res, error); }
}

function time(req, res) {
  return res.status(200).json({ remainingTime: getRemainingTokenTime(req.decodedToken) });
}

module.exports = { login, refresh, logout, time, requestRegistrationCode, register };
