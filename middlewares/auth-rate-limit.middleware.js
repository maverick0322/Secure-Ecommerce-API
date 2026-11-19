'use strict';
const { AccountError, respondError } = require('../services/accounts.service');
const runtime = require('../services/auth-runtime.service');
const { SessionStoreUnavailableError } = require('../services/auth-session-errors');

const RATE_LIMITED_MESSAGE = 'Demasiadas solicitudes; intente más tarde.';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function normalizeEmailKey(req) {
  const raw = req?.body?.email;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  return trimmed;
}

function extractSessionKey(req) {
  const raw = req?.body?.refreshToken;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 512) return null;
  return raw.trim();
}

async function resolveRateLimits(override) {
  try {
    const service = override ? await override() : (await runtime.getRuntime())?.rateLimits;
    if (!service || typeof service.consume !== 'function') {
      throw new SessionStoreUnavailableError();
    }
    return service;
  } catch (error) {
    if (error instanceof SessionStoreUnavailableError) throw error;
    throw new SessionStoreUnavailableError();
  }
}

async function blockRequest(req, res, retryAfter, reason) {
  res.set('Retry-After', String(Math.max(1, Number(retryAfter) || 1)));
  if (req.logAudit) {
    await req.logAudit('auth.rate_limited', null, null, 'DENIED', { reason });
  }
  return respondError(res, new AccountError(429, RATE_LIMITED_MESSAGE));
}

function createLimiter({
  scope = 'auth',
  ipMax = envInt('RATE_LIMIT_IP_MAX', 120),
  ipWindowMs = envInt('RATE_LIMIT_IP_WINDOW_MS', 60000),
  accountMax = null,
  accountWindowMs = 60000,
  sessionMax = null,
  sessionWindowMs = 60000,
  checkLockout = false,
  getRateLimits = null
} = {}) {
  return async (req, res, next) => {
    let rateLimits;
    try {
      rateLimits = await resolveRateLimits(getRateLimits);
    } catch (error) {
      return respondError(res, error);
    }

    try {
      const ip = req.ip || 'unknown';
      if (ipMax) {
        const ipResult = await rateLimits.consume(`${scope}_ip`, ip, { max: ipMax, windowMs: ipWindowMs });
        if (!ipResult.allowed) {
          return blockRequest(req, res, ipResult.retryAfter, `${scope}_ip_limit`);
        }
      }

      if (accountMax || checkLockout) {
        const email = normalizeEmailKey(req);
        if (email) {
          if (checkLockout && typeof rateLimits.checkLoginLockout === 'function') {
            const lockout = await rateLimits.checkLoginLockout(email);
            if (lockout.locked) {
              return blockRequest(req, res, lockout.retryAfter, `${scope}_account_lockout`);
            }
          }
          if (accountMax) {
            const acctResult = await rateLimits.consume(`${scope}_acct`, email, {
              max: accountMax,
              windowMs: accountWindowMs
            });
            if (!acctResult.allowed) {
              return blockRequest(req, res, acctResult.retryAfter, `${scope}_account_limit`);
            }
          }
        }
      }

      if (sessionMax) {
        const sessionKey = extractSessionKey(req);
        if (sessionKey) {
          const sessResult = await rateLimits.consume(`${scope}_sess`, sessionKey, {
            max: sessionMax,
            windowMs: sessionWindowMs
          });
          if (!sessResult.allowed) {
            return blockRequest(req, res, sessResult.retryAfter, `${scope}_session_limit`);
          }
        }
      }

      return next();
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError) {
        return respondError(res, error);
      }
      return respondError(res, new SessionStoreUnavailableError());
    }
  };
}

function createAuthLimiters() {
  const ipWindowMs = envInt('RATE_LIMIT_IP_WINDOW_MS', 60000);
  return {
    login: createLimiter({
      scope: 'login',
      ipMax: envInt('RATE_LIMIT_LOGIN_IP_MAX', 120),
      ipWindowMs,
      accountMax: envInt('RATE_LIMIT_LOGIN_ACCOUNT_MAX', 10),
      accountWindowMs: envInt('RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_MS', 60000),
      checkLockout: true
    }),
    refresh: createLimiter({
      scope: 'refresh',
      ipMax: envInt('RATE_LIMIT_REFRESH_IP_MAX', 180),
      ipWindowMs,
      sessionMax: envInt('RATE_LIMIT_REFRESH_SESSION_MAX', 15),
      sessionWindowMs: envInt('RATE_LIMIT_REFRESH_SESSION_WINDOW_MS', 60000)
    }),
    logout: createLimiter({
      scope: 'logout',
      ipMax: envInt('RATE_LIMIT_LOGOUT_IP_MAX', 120),
      ipWindowMs
    }),
    register: createLimiter({
      scope: 'register',
      ipMax: envInt('RATE_LIMIT_REGISTER_IP_MAX', 60),
      ipWindowMs,
      accountMax: envInt('RATE_LIMIT_REGISTER_ACCOUNT_MAX', 5),
      accountWindowMs: envInt('RATE_LIMIT_REGISTER_ACCOUNT_WINDOW_MS', 15 * 60 * 1000)
    }),
    registerVerify: createLimiter({
      scope: 'otp',
      ipMax: envInt('RATE_LIMIT_OTP_IP_MAX', 60),
      ipWindowMs,
      accountMax: envInt('RATE_LIMIT_OTP_ACCOUNT_MAX', 8),
      accountWindowMs: envInt('RATE_LIMIT_OTP_ACCOUNT_WINDOW_MS', 15 * 60 * 1000)
    }),
    passwordForgot: createLimiter({
      scope: 'forgot',
      ipMax: envInt('RATE_LIMIT_RECOVERY_IP_MAX', 60),
      ipWindowMs,
      accountMax: envInt('RATE_LIMIT_RECOVERY_ACCOUNT_MAX', 5),
      accountWindowMs: envInt('RATE_LIMIT_RECOVERY_ACCOUNT_WINDOW_MS', 15 * 60 * 1000)
    }),
    passwordReset: createLimiter({
      scope: 'reset',
      ipMax: envInt('RATE_LIMIT_RECOVERY_IP_MAX', 60),
      ipWindowMs,
      accountMax: envInt('RATE_LIMIT_RECOVERY_ACCOUNT_MAX', 8),
      accountWindowMs: envInt('RATE_LIMIT_RECOVERY_ACCOUNT_WINDOW_MS', 15 * 60 * 1000)
    })
  };
}

createLimiter.createAuthLimiters = createAuthLimiters;
createLimiter.normalizeEmailKey = normalizeEmailKey;
module.exports = createLimiter;
