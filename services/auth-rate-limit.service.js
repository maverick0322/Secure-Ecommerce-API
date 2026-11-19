'use strict';
const { createHash } = require('node:crypto');
const { SessionStoreUnavailableError, RedisConfigurationError } = require('./auth-session-errors');

const DEFAULT_LOCKOUT = Object.freeze({
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 15 * 60 * 1000
});

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

function safeScope(scope) {
  if (typeof scope !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(scope)) {
    throw new RedisConfigurationError();
  }
  return scope;
}

function createRateLimitService(connection) {
  if (!connection || typeof connection.transaction !== 'function' || typeof connection.prefix !== 'string') {
    throw new SessionStoreUnavailableError();
  }

  function rateKey(scope, identifier) {
    return `${connection.prefix}rl:${safeScope(scope)}:${digest(identifier)}`;
  }

  function lockoutKey(identifier) {
    return `${connection.prefix}rl:lfail:${digest(identifier)}`;
  }

  async function consume(scope, identifier, { max, windowMs }) {
    if (!Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1000) {
      throw new RedisConfigurationError();
    }
    const key = rateKey(scope, identifier);
    try {
      return await connection.transaction(async tx => {
        await tx.watch([key]);
        const now = await tx.time();
        const raw = await tx.get(key);
        let entries = [];
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              entries = parsed.filter(ts => Number.isSafeInteger(ts) && ts > now - windowMs && ts <= now);
            }
          } catch {
            entries = [];
          }
        }
        if (entries.length >= max) {
          const retryAfter = Math.max(1, Math.ceil((entries[0] + windowMs - now) / 1000));
          await tx.commit([]);
          return { allowed: false, retryAfter, remaining: 0 };
        }
        entries.push(now);
        const bounded = entries.slice(-max);
        await tx.commit([['SET', key, JSON.stringify(bounded), 'PXAT', String(now + windowMs)]]);
        return { allowed: true, retryAfter: 0, remaining: Math.max(0, max - bounded.length) };
      });
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError || error instanceof RedisConfigurationError) throw error;
      throw new SessionStoreUnavailableError();
    }
  }

  async function checkLoginLockout(email) {
    const key = lockoutKey(email);
    try {
      return await connection.transaction(async tx => {
        await tx.watch([key]);
        const now = await tx.time();
        const raw = await tx.get(key);
        await tx.commit([]);
        if (raw === null) return { locked: false, retryAfter: 0, failures: 0 };
        let state;
        try { state = JSON.parse(raw); } catch { return { locked: false, retryAfter: 0, failures: 0 }; }
        if (Number.isSafeInteger(state?.lockedUntil) && state.lockedUntil > now) {
          return {
            locked: true,
            retryAfter: Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)),
            failures: Number.isInteger(state.failures) ? state.failures : 0
          };
        }
        return { locked: false, retryAfter: 0, failures: Number.isInteger(state?.failures) ? state.failures : 0 };
      });
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError || error instanceof RedisConfigurationError) throw error;
      throw new SessionStoreUnavailableError();
    }
  }

  async function recordLoginFailure(email, options = {}) {
    const {
      maxFailures = DEFAULT_LOCKOUT.maxFailures,
      windowMs = DEFAULT_LOCKOUT.windowMs,
      baseLockoutMs = DEFAULT_LOCKOUT.baseLockoutMs,
      maxLockoutMs = DEFAULT_LOCKOUT.maxLockoutMs
    } = options;
    const key = lockoutKey(email);
    try {
      return await connection.transaction(async tx => {
        await tx.watch([key]);
        const now = await tx.time();
        const raw = await tx.get(key);
        let state = { failures: 0, windowStart: now, lockedUntil: 0 };
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && Number.isSafeInteger(parsed.windowStart) && parsed.windowStart + windowMs > now) {
              state = {
                failures: Number.isInteger(parsed.failures) && parsed.failures >= 0 ? parsed.failures : 0,
                windowStart: parsed.windowStart,
                lockedUntil: Number.isSafeInteger(parsed.lockedUntil) ? parsed.lockedUntil : 0
              };
            }
          } catch {
            // Reset malformed state safely.
          }
        }
        state.failures += 1;
        if (state.failures >= maxFailures) {
          const exponent = Math.min(state.failures - maxFailures, 10);
          const duration = Math.min(baseLockoutMs * (2 ** exponent), maxLockoutMs);
          state.lockedUntil = now + duration;
        }
        const expiresAt = Math.max(state.windowStart + windowMs, state.lockedUntil || 0, now + 1000);
        await tx.commit([['SET', key, JSON.stringify(state), 'PXAT', String(expiresAt)]]);
        const locked = state.lockedUntil > now;
        return {
          locked,
          retryAfter: locked ? Math.max(1, Math.ceil((state.lockedUntil - now) / 1000)) : 0,
          failures: state.failures
        };
      });
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError || error instanceof RedisConfigurationError) throw error;
      throw new SessionStoreUnavailableError();
    }
  }

  async function clearLoginFailures(email) {
    const key = lockoutKey(email);
    try {
      await connection.transaction(async tx => {
        await tx.watch([key]);
        await tx.commit([['DEL', key]]);
      });
    } catch (error) {
      if (error instanceof SessionStoreUnavailableError || error instanceof RedisConfigurationError) throw error;
      throw new SessionStoreUnavailableError();
    }
  }

  return Object.freeze({ consume, checkLoginLockout, recordLoginFailure, clearLoginFailures });
}

module.exports = { createRateLimitService, DEFAULT_LOCKOUT };
