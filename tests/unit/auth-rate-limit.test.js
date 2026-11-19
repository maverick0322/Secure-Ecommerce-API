'use strict';
const crypto = require('node:crypto');
const limiter = require('../../middlewares/auth-rate-limit.middleware');
const { createRateLimitService } = require('../../services/auth-rate-limit.service');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { RedisDouble } = require('../support/redis-double');

function makeRes() {
  const res = { set: jest.fn(), status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

async function createRedisRateLimits() {
  const server = new RedisDouble();
  const connection = createAuthRedisConnection({
    host: '127.0.0.1',
    port: 16379,
    tls: false,
    username: 'isolated',
    password: crypto.randomBytes(32).toString('hex'),
    namespace: 'isolated-rl',
    generation: crypto.randomUUID(),
    expectedRunId: server.runId
  }, { poolFactory: (o, p) => server.poolFactory(o, p) });
  await connection.connect();
  return { server, connection, rateLimits: createRateLimitService(connection) };
}

describe('SEC-08: Redis auth rate limiting and lockout', () => {
  it('blocks a burst exceeding the sliding window, sets Retry-After, audits without PII and releases after expiration', async () => {
    const { server, connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = limiter({
        scope: 'login',
        ipMax: 100,
        accountMax: 2,
        accountWindowMs: 5000,
        getRateLimits: async () => rateLimits
      });
      const logAudit = jest.fn().mockResolvedValue(true);
      const next = jest.fn();

      for (let i = 0; i < 3; i++) {
        const res = makeRes();
        await mw({ ip: '10.0.0.10', body: { email: '  Victim@Example.com  ' }, logAudit }, res, next);
        if (i < 2) {
          expect(res.status).not.toHaveBeenCalled();
        } else {
          expect(res.status).toHaveBeenCalledWith(429);
          expect(res.set).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^[1-5]$/));
          expect(logAudit).toHaveBeenCalledWith('auth.rate_limited', null, null, 'DENIED', { reason: 'login_account_limit' });
        }
      }
      expect(next).toHaveBeenCalledTimes(2);
      // Verify raw email is never stored in Redis keys/data
      expect(server.serializedData().toLowerCase()).not.toContain('victim@example.com');

      // Advance Redis clock past the 5000ms sliding window
      server.now += 5001;
      const resAfter = makeRes();
      await mw({ ip: '10.0.0.10', body: { email: 'victim@example.com' }, logAudit }, resAfter, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(resAfter.status).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  });

  it('isolates distinct users sharing the same frontend IP without global maxKeys DoS', async () => {
    const { connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = limiter({
        scope: 'login',
        ipMax: 120,
        accountMax: 2,
        accountWindowMs: 60000,
        getRateLimits: async () => rateLimits
      });
      const next = jest.fn();
      // Exhaust user A from shared frontend IP
      for (let i = 0; i < 3; i++) {
        await mw({ ip: '10.0.0.5', body: { email: 'userA@example.com' } }, makeRes(), next);
      }
      expect(next).toHaveBeenCalledTimes(2);

      // User B from the exact same frontend IP is unaffected
      const resB = makeRes();
      await mw({ ip: '10.0.0.5', body: { email: 'userB@example.com' } }, resB, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(resB.status).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  });

  it('enforces progressive temporary lockout on failed login attempts and clears on success', async () => {
    const { server, connection, rateLimits } = await createRedisRateLimits();
    try {
      const email = 'target@example.com';
      for (let i = 1; i <= 4; i++) {
        const res = await rateLimits.recordLoginFailure(email, { maxFailures: 5, windowMs: 60000, baseLockoutMs: 5000, maxLockoutMs: 20000 });
        expect(res.locked).toBe(false);
        expect(res.failures).toBe(i);
      }
      const fifth = await rateLimits.recordLoginFailure(email, { maxFailures: 5, windowMs: 60000, baseLockoutMs: 5000, maxLockoutMs: 20000 });
      expect(fifth.locked).toBe(true);
      expect(fifth.retryAfter).toBe(5);

      const mw = limiter({
        scope: 'login',
        ipMax: 100,
        accountMax: 10,
        checkLockout: true,
        getRateLimits: async () => rateLimits
      });
      const resLocked = makeRes();
      const next = jest.fn();
      await mw({ ip: '10.0.0.5', body: { email } }, resLocked, next);
      expect(next).not.toHaveBeenCalled();
      expect(resLocked.status).toHaveBeenCalledWith(429);

      // Progressive backoff on 6th failure
      const sixth = await rateLimits.recordLoginFailure(email, { maxFailures: 5, windowMs: 60000, baseLockoutMs: 5000, maxLockoutMs: 20000 });
      expect(sixth.retryAfter).toBe(10);

      // Expires after lockout duration
      server.now += 10001;
      const unlocked = await rateLimits.checkLoginLockout(email);
      expect(unlocked.locked).toBe(false);

      // Clear resets failure count
      await rateLimits.clearLoginFailures(email);
      const afterClear = await rateLimits.checkLoginLockout(email);
      expect(afterClear.failures).toBe(0);
    } finally {
      connection.close();
    }
  });

  it('limits refresh requests per session token independently', async () => {
    const { connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = limiter({
        scope: 'refresh',
        ipMax: 100,
        sessionMax: 2,
        sessionWindowMs: 60000,
        getRateLimits: async () => rateLimits
      });
      const next = jest.fn();
      const tokenA = 'A'.repeat(43);
      const tokenB = 'B'.repeat(43);

      for (let i = 0; i < 3; i++) {
        await mw({ ip: '10.0.0.5', body: { refreshToken: tokenA } }, makeRes(), next);
      }
      expect(next).toHaveBeenCalledTimes(2);

      const resB = makeRes();
      await mw({ ip: '10.0.0.5', body: { refreshToken: tokenB } }, resB, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(resB.status).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  });

  it('fails closed with HTTP 503 when Redis is unavailable', async () => {
    const { server, connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = limiter({
        scope: 'login',
        ipMax: 10,
        accountMax: 5,
        getRateLimits: async () => rateLimits
      });
      server.online = false;
      const res = makeRes();
      const next = jest.fn();
      await mw({ ip: '127.0.0.1', body: { email: 'user@example.com' } }, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        status: 503,
        message: 'El servicio de autenticación no está disponible.'
      });

      const mwMissingRuntime = limiter({
        scope: 'login',
        getRateLimits: async () => { throw new Error('Redis down'); }
      });
      const res2 = makeRes();
      await mwMissingRuntime({ ip: '127.0.0.1', body: {} }, res2, next);
      expect(res2.status).toHaveBeenCalledWith(503);
    } finally {
      connection.close();
    }
  });

  it('validates TRUST_PROXY configuration safely (off by default, rejects true/*, allows explicit IPs)', () => {
    function loadTrustProxy(value) {
      const saved = process.env.TRUST_PROXY;
      const savedCors = process.env.CORS_ORIGIN;
      try {
        process.env.CORS_ORIGIN = '';
        if (value === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = value;
        let app;
        jest.isolateModules(() => { app = require('../../index'); });
        return app.get('trust proxy');
      } finally {
        if (saved === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = saved;
        if (savedCors === undefined) delete process.env.CORS_ORIGIN; else process.env.CORS_ORIGIN = savedCors;
      }
    }

    expect(loadTrustProxy('')).toBe(false);
    expect(loadTrustProxy('false')).toBe(false);
    expect(loadTrustProxy('10.0.0.5, 192.168.1.0/24')).toEqual(['10.0.0.5', '192.168.1.0/24']);
    expect(() => loadTrustProxy('true')).toThrow(/TRUST_PROXY/);
    expect(() => loadTrustProxy('*')).toThrow(/TRUST_PROXY/);
    expect(() => loadTrustProxy('not-an-ip')).toThrow(/Invalid TRUST_PROXY/);
    expect(() => loadTrustProxy('10.0.0.1/33')).toThrow(/Invalid TRUST_PROXY CIDR/);
  });
});
