const accounts = require('../services/accounts.service');
const personal = require('../services/personal-account.service');
const { getRemainingTokenTime } = require('../services/jwttoken.service');

const authentication = require('../services/authentication.service');
const runtime = require('../services/auth-runtime.service');
const { normalizeEmailKey } = require('../middlewares/auth-rate-limit.middleware');
const { AccountError, respondError } = accounts;

async function requestRegistrationCode(req, res) {
  try {
    await personal.beginRegistration(req.body);
    return res.status(202).json({ message: 'Solicitud de verificación recibida.' });
  } catch (error) {
    if(req.logAudit && error instanceof AccountError) await req.logAudit('auth.registration.denied',null,null,error.status>=500?'ERROR':'DENIED');
    return respondError(res, error);
  }
}

async function register(req, res) {
  try {
    const account = await personal.finishRegistration(req.body,{ipAddress:req.ip});
    return res.status(201).json(account);
  } catch (error) {
    if(req.logAudit && error instanceof AccountError) await req.logAudit('auth.verification.denied',null,null,error.status>=500?'ERROR':'DENIED');
    return respondError(res, error);
  }
}

async function login(req, res) {
  const emailKey = normalizeEmailKey(req);
  try {
    const result = await authentication.login(req.body, { ipAddress: req.ip });
    req.account={id:result.id}; // Server-validated identity for request logging.
    if (emailKey) {
      const rt = await runtime.getRuntime().catch(() => null);
      await rt?.rateLimits?.clearLoginFailures?.(emailKey).catch(() => {});
    }
    res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache');
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AccountError && error.status === 401 && emailKey) {
      const rt = await runtime.getRuntime().catch(() => null);
      const lockout = await rt?.rateLimits?.recordLoginFailure?.(emailKey).catch(() => null);
      if (lockout?.locked && req.logAudit) {
        await req.logAudit('auth.login.locked', null, null, 'DENIED', { reason: 'login_failures_threshold' });
      }
    }
    if (req.logAudit && error instanceof AccountError) await req.logAudit('auth.login.denied', null, null, 'DENIED');
    return respondError(res, error);
  }
}
async function refresh(req, res) {
  try {
    const result = await authentication.refresh(req.body, { ipAddress: req.ip });
    req.account={id:result.id};
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
