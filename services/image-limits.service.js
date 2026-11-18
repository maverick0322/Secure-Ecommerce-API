'use strict';
const { randomUUID } = require('node:crypto');
const { AccountError } = require('./accounts.service');
const { isAccessUuid } = require('../validators/uuid');
const LIMITS = Object.freeze({ sellerPerMinute: 6, globalPerMinute: 60, sellerConcurrent: 1, globalConcurrent: 8,
  leaseMs: 90000, heartbeatMs: 20000, receiveMs: 30000 });
function createImageLimits(connection) {
  const key = connection.prefix + 'image-admission';
  let localActive = 0;
  function limited(retryAfter) {
    const error = new AccountError(429, 'Límite de cargas alcanzado.'); error.retryAfter = retryAfter; return error;
  }
  async function change(user, token, action) {
    const outcome = await connection.transaction(async tx => {
      await tx.watch([key]);
      const now = await tx.time(), raw = await tx.get(key);
      const state = raw === null ? { window: now, total: 0, sellers: {}, leases: {} } : JSON.parse(raw);
      if (!state || !Number.isSafeInteger(state.window) || !Number.isInteger(state.total) ||
          state.total < 0 || state.total > 60 || !state.sellers || !state.leases ||
          Object.keys(state.leases).length > 8 || Object.keys(state.sellers).length > 60 ||
          Object.entries(state.sellers).some(([id, count]) => !isAccessUuid(id) || !Number.isInteger(count) || count < 1 || count > 6)) throw new Error('Invalid admission state');
      for (const [id, lease] of Object.entries(state.leases)) {
        if (!isAccessUuid(id) || !Number.isSafeInteger(lease.until) || !isAccessUuid(lease.user)) throw new Error('Invalid lease');
        if (lease.until <= now) delete state.leases[id];
      }
      if (now >= state.window + 60000) { state.window = now; state.total = 0; state.sellers = {}; }
      let retry = 0;
      if (action === 'acquire') {
        const sellerLeases = Object.values(state.leases).filter(lease => lease.user === user);
        if (state.total >= LIMITS.globalPerMinute || (state.sellers[user] || 0) >= LIMITS.sellerPerMinute) retry = Math.ceil((state.window + 60000 - now) / 1000);
        else if (Object.keys(state.leases).length >= LIMITS.globalConcurrent || sellerLeases.length >= LIMITS.sellerConcurrent) retry = 20;
        if (!retry) { state.total++; state.sellers[user] = (state.sellers[user] || 0) + 1; state.leases[token] = { user, until: now + LIMITS.leaseMs }; }
      } else if (action === 'renew') {
        if (state.leases[token]?.user !== user) { await tx.commit(); return -1; }
        state.leases[token].until = now + LIMITS.leaseMs;
      } else if (action === 'release') {
        if (state.leases[token]?.user === user) delete state.leases[token];
      }
      await tx.commit([['SET', key, JSON.stringify(state), 'PXAT', String(now + LIMITS.leaseMs)]]);
      return retry;
    });
    // Expiry is a normal application rejection, not a corrupt session store.
    if (outcome === -1) throw new Error('Expired admission');
    return outcome;
  }
  async function acquire(user) {
    if (!isAccessUuid(user)) throw new Error('Invalid admission identity');
    if (localActive >= LIMITS.globalConcurrent) throw limited(20);
    localActive++;
    const token = randomUUID();
    let retryAfter;
    try { retryAfter = await change(user, token, 'acquire'); }
    catch (error) { localActive--; throw error; }
    if (retryAfter) { localActive--; throw limited(retryAfter); }
    let released = false, failed = false, renewing;
    const timer = setInterval(() => {
      if (!renewing && !released) renewing = change(user, token, 'renew').catch(() => { failed = true; clearInterval(timer); }).finally(() => { renewing = null; });
    }, LIMITS.heartbeatMs);
    timer.unref();
    return {
      async check() { if (released || failed) throw new Error('Admission unavailable'); await change(user, token, 'renew'); },
      async release() { if (released) return; released = true; localActive--; clearInterval(timer); if (renewing) await renewing; await change(user, token, 'release'); }
    };
  }
  return Object.freeze({ acquire });
}
module.exports = { createImageLimits, LIMITS };
