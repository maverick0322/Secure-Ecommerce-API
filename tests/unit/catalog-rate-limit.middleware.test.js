'use strict';
const crypto = require('node:crypto');
const { createSellerProductWriteLimiter } = require('../../middlewares/catalog-rate-limit.middleware');
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
    namespace: 'isolated-cat-rl',
    generation: crypto.randomUUID(),
    expectedRunId: server.runId
  }, { poolFactory: (o, p) => server.poolFactory(o, p) });
  await connection.connect();
  return { server, connection, rateLimits: createRateLimitService(connection) };
}

describe('Seller product write rate limiting in Redis', () => {
  it('enforces per-seller write limit with 429 + Retry-After, audits denial, isolates sellers and releases after window', async () => {
    const { server, connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = createSellerProductWriteLimiter({ max: 2, windowMs: 5000, getRateLimits: async () => rateLimits });
      const sellerA = crypto.randomUUID();
      const sellerB = crypto.randomUUID();
      const logAudit = jest.fn().mockResolvedValue(true);
      const next = jest.fn();

      for (let i = 0; i < 3; i++) {
        const res = makeRes();
        await mw({ account: { id: sellerA }, ip: '127.0.0.1', logAudit }, res, next);
        if (i < 2) {
          expect(res.status).not.toHaveBeenCalled();
        } else {
          expect(res.status).toHaveBeenCalledWith(429);
          expect(res.set).toHaveBeenCalledWith('Retry-After', expect.stringMatching(/^[1-5]$/));
          expect(logAudit).toHaveBeenCalledWith('catalog.rate_limited', null, null, 'DENIED', { reason: 'seller_product_writes' });
        }
      }
      expect(next).toHaveBeenCalledTimes(2);

      // Seller B is unaffected
      const resB = makeRes();
      await mw({ account: { id: sellerB }, ip: '127.0.0.1', logAudit }, resB, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(resB.status).not.toHaveBeenCalled();

      // Window expiration releases Seller A
      server.now += 5001;
      const resAfter = makeRes();
      await mw({ account: { id: sellerA }, ip: '127.0.0.1', logAudit }, resAfter, next);
      expect(next).toHaveBeenCalledTimes(4);
      expect(resAfter.status).not.toHaveBeenCalled();
    } finally {
      connection.close();
    }
  });

  it('fails closed with HTTP 503 when Redis is unavailable', async () => {
    const { server, connection, rateLimits } = await createRedisRateLimits();
    try {
      const mw = createSellerProductWriteLimiter({ max: 30, windowMs: 60000, getRateLimits: async () => rateLimits });
      server.online = false;
      const res = makeRes();
      const next = jest.fn();
      await mw({ account: { id: crypto.randomUUID() }, ip: '127.0.0.1' }, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);

      const mwNoRuntime = createSellerProductWriteLimiter({ getRateLimits: async () => { throw new Error('offline'); } });
      const res2 = makeRes();
      await mwNoRuntime({ account: { id: crypto.randomUUID() }, ip: '127.0.0.1' }, res2, next);
      expect(res2.status).toHaveBeenCalledWith(503);

      const mwInvalidStore = createSellerProductWriteLimiter({ getRateLimits: async () => ({}) });
      const res3 = makeRes();
      await mwInvalidStore({ ip: '127.0.0.1' }, res3, next);
      expect(res3.status).toHaveBeenCalledWith(503);
    } finally {
      connection.close();
    }
  });

  it('reads env overrides with safe fallbacks and handles missing account/logAudit', async () => {
    const prevMax = process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX;
    const prevWin = process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS;
    try {
      process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX = '1';
      process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS = 'invalid';
      const consume = jest.fn()
        .mockResolvedValueOnce({ allowed: true })
        .mockResolvedValueOnce({ allowed: false, retryAfter: 0 });
      const mw = createSellerProductWriteLimiter({ getRateLimits: async () => ({ consume }) });
      const next = jest.fn();
      const res1 = makeRes();
      await mw({}, res1, next);
      expect(consume).toHaveBeenCalledWith('prod_wr', 'unknown', { max: 1, windowMs: 60000 });
      expect(next).toHaveBeenCalledTimes(1);

      const res2 = makeRes();
      await mw({ ip: '10.0.0.2' }, res2, next);
      expect(consume).toHaveBeenCalledWith('prod_wr', '10.0.0.2', { max: 1, windowMs: 60000 });
      expect(res2.set).toHaveBeenCalledWith('Retry-After', '1');
      expect(res2.status).toHaveBeenCalledWith(429);
    } finally {
      if (prevMax === undefined) delete process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX;
      else process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_MAX = prevMax;
      if (prevWin === undefined) delete process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS;
      else process.env.RATE_LIMIT_SELLER_PRODUCT_WRITES_WINDOW_MS = prevWin;
    }
  });
});
