'use strict';
const runtime = require('../services/auth-runtime.service');
const { AccountError, respondError } = require('../services/accounts.service');
const { LIMITS } = require('../services/image-limits.service');
async function imageAdmission(req, res, next) {
  try {
    const permit = await (await runtime.getRuntime()).imageLimits.acquire(req.account.id);
    if (req.destroyed || res.destroyed) { await permit.release(); return; }
    req.imagePermit = permit;
    const release = () => { if (!req.imageProcessing) void permit.release().catch(() => {}); };
    const timer = setTimeout(() => {
      if (!req.imageProcessing) { respondError(res, new AccountError(408, 'Tiempo de recepción agotado.')); req.destroy(); }
    }, LIMITS.receiveMs);
    timer.unref();
    res.once('close', () => { clearTimeout(timer); release(); });
    res.once('finish', () => { clearTimeout(timer); release(); });
    return next();
  } catch (error) {
    if (error.status === 429) { res.set('Retry-After', String(error.retryAfter)); return respondError(res, error); }
    return respondError(res, new AccountError(503, 'Control de cargas no disponible.'));
  }
}
module.exports = imageAdmission;
