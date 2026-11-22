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

function createSellerProductWriteLimiter({
  max = null,
  windowMs = null,
  getRateLimits = null
} = {}) {
  return async (req, res, next) => {
    const limitMax = max ?? envInt('RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX', 30);
    const limitWindowMs = windowMs ?? envInt('RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS', 60000);

    let rateLimits;
    try {
      rateLimits = getRateLimits ? await getRateLimits() : (await runtime.getRuntime())?.rateLimits;
      if (!rateLimits || typeof rateLimits.consume !== 'function') {
        throw new SessionStoreUnavailableError();
      }
    } catch (error) {
      return respondError(res, error instanceof SessionStoreUnavailableError ? error : new SessionStoreUnavailableError());
    }

    try {
      const sellerKey = req.account?.id || req.ip || 'unknown';
      const result = await rateLimits.consume('prod_wr', sellerKey, { max: limitMax, windowMs: limitWindowMs });
      if (!result.allowed) {
        res.set('Retry-After', String(Math.max(1, Number(result.retryAfter) || 1)));
        if (req.logAudit) {
          await req.logAudit('catalog.rate_limited', null, null, 'DENIED', { reason: 'seller_product_writes' });
        }
        return respondError(res, new AccountError(429, RATE_LIMITED_MESSAGE));
      }
      return next();
    } catch (error) {
      return respondError(res, error instanceof SessionStoreUnavailableError ? error : new SessionStoreUnavailableError());
    }
  };
}

module.exports = { createSellerProductWriteLimiter };
