'use strict';
const { randomUUID, randomBytes } = require('node:crypto');
const { createImageLimits, LIMITS } = require('../../services/image-limits.service');
const { createAdmissionDouble } = require('../support/image-admission-double');
const { RedisDouble } = require('../support/redis-double');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const admission = require('../../middlewares/image-limits.middleware');
const runtime = require('../../services/auth-runtime.service');
const { EventEmitter } = require('node:events');
let store, limits, permits;
beforeEach(() => { store = createAdmissionDouble(); limits = createImageLimits(store); permits = []; });
afterEach(async () => { store.offline = false; await Promise.allSettled(permits.map(p => p.release())); jest.restoreAllMocks(); jest.useRealTimers(); });
async function acquire(user = randomUUID(), service = limits) { const p = await service.acquire(user); permits.push(p); return p; }
it('L01 shares seller concurrency across two service instances', async () => {
  const user = randomUUID(), other = createImageLimits(store); await acquire(user);
  await expect(other.acquire(user)).rejects.toMatchObject({ status: 429, retryAfter: 20 });
});
it('L02 counts failed and successful admitted requests within seller frequency budget', async () => {
  const user = randomUUID();
  for (let i = 0; i < 6; i++) await (await acquire(user)).release();
  await expect(limits.acquire(user)).rejects.toMatchObject({ status: 429, retryAfter: 60 });
  store.now += 60000; await acquire(user);
});
it('L03 bounds different sellers at eight concurrent operations with no waiting queue', async () => {
  const result = await Promise.allSettled(Array.from({ length: 12 }, () => acquire()));
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(8);
  expect(result.filter(r => r.status === 'rejected').every(r => r.reason.status === 429)).toBe(true);
  await permits[0].release(); await acquire();
});
it('L04 global frequency cannot be bypassed by changing sellers', async () => {
  for (let i = 0; i < 60; i++) await (await acquire()).release();
  await expect(limits.acquire(randomUUID())).rejects.toMatchObject({ status: 429, retryAfter: 60 });
  expect(store.data.size).toBe(1);
});
it('L05 abandoned leases expire without permanently locking a seller', async () => {
  const user = randomUUID(), crashed = await acquire(user);
  store.now += LIMITS.leaseMs + 1;
  await acquire(user, createImageLimits(store));
  await expect(crashed.check()).rejects.toThrow('Expired');
});
it('L06 old release cannot remove a replacement lease after restart', async () => {
  const user = randomUUID(), old = await acquire(user); store.now += LIMITS.leaseMs + 1;
  await acquire(user); await old.release();
  await expect(limits.acquire(user)).rejects.toMatchObject({ status: 429 });
});
it('L07 release is idempotent and a released permit cannot authorize work', async () => {
  const p = await acquire(); await p.release(); await p.release(); await expect(p.check()).rejects.toThrow();
});
it('L08 Redis outage fails closed without local fallback', async () => {
  store.offline = true; await expect(limits.acquire(randomUUID())).rejects.toThrow();
  expect(store.data.size).toBe(0);
});
it('L09 checks after admission fail if Redis becomes unavailable', async () => {
  const p = await acquire(); store.offline = true; await expect(p.check()).rejects.toThrow();
});
it('L10 renews leases beyond 120 seconds and stops renewal on release', async () => {
  jest.useFakeTimers(); const user = randomUUID(), p = await acquire(user);
  for (let i = 0; i < 8; i++) { store.now += 20000; await jest.advanceTimersByTimeAsync(20000); }
  await expect(limits.acquire(user)).rejects.toMatchObject({ status: 429 });
  await p.release(); expect(jest.getTimerCount()).toBe(0); await acquire(user);
});
it('L11 heartbeat failure makes the permit unusable even after connectivity returns', async () => {
  jest.useFakeTimers(); const p = await acquire(); store.offline = true;
  await jest.advanceTimersByTimeAsync(20000); store.offline = false;
  await expect(p.check()).rejects.toThrow('unavailable');
});
it.each(['invalid-json', 'wrong-count', 'invalid-lease'])('L12 fails closed on corrupt Redis state: %s', async kind => {
  const state = { window: store.now, total: 0, sellers: {}, leases: {} };
  if (kind === 'wrong-count') state.total = 999;
  if (kind === 'invalid-lease') state.leases[randomUUID()] = { user: 'bad', until: store.now + 1000 };
  store.data.set(store.prefix + 'image-admission', { value: kind === 'invalid-json' ? '{' : JSON.stringify(state), until: store.now + 90000 });
  await expect(limits.acquire(randomUUID())).rejects.toThrow();
});
it('L13 rejects malformed identities without creating keys', async () => {
  await expect(limits.acquire('__proto__')).rejects.toThrow(); expect(store.data.size).toBe(0);
});
function http() {
  const req = { account: { id: randomUUID() }, destroy: jest.fn() };
  const res = Object.assign(new EventEmitter(), { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
  const next = jest.fn(); return { req, res, next };
}
it.each(['finish', 'close'])('L14 middleware releases on %s before processing', async event => {
  const release = jest.fn().mockResolvedValue();
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ imageLimits: { acquire: async () => ({ release }) } });
  const h = http(); await admission(h.req, h.res, h.next); h.res.emit(event); await Promise.resolve();
  expect(h.next).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
});
it('L15 client disconnect retains lease while controller still processes remotely', async () => {
  const release = jest.fn().mockResolvedValue();
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ imageLimits: { acquire: async () => ({ release }) } });
  const h = http(); await admission(h.req, h.res, h.next); h.req.imageProcessing = true; h.res.emit('close');
  expect(release).not.toHaveBeenCalled();
});
it('L16 emits 429 and Retry-After before invoking multipart', async () => {
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ imageLimits: { acquire: async () => { throw Object.assign(new (require('../../services/accounts.service').AccountError)(429, 'Limit'), { retryAfter: 20 }); } } });
  const h = http(); await admission(h.req, h.res, h.next);
  expect(h.res.status).toHaveBeenCalledWith(429); expect(h.res.set).toHaveBeenCalledWith('Retry-After', '20'); expect(h.next).not.toHaveBeenCalled();
});
it('L17 emits safe 503 when limiter is unavailable', async () => {
  jest.spyOn(runtime, 'getRuntime').mockRejectedValue(new Error('SYNTHETIC_PRIVATE'));
  const h = http(); await admission(h.req, h.res, h.next);
  expect(h.res.status).toHaveBeenCalledWith(503); expect(JSON.stringify(h.res.json.mock.calls)).not.toContain('SYNTHETIC_PRIVATE'); expect(h.next).not.toHaveBeenCalled();
});
it('L18 bounds incomplete multipart reception and releases on connection close', async () => {
  jest.useFakeTimers(); const release = jest.fn().mockResolvedValue();
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ imageLimits: { acquire: async () => ({ release }) } });
  const h = http(); h.req.destroy.mockImplementation(() => h.res.emit('close'));
  await admission(h.req, h.res, h.next); await jest.advanceTimersByTimeAsync(30000);
  expect(h.res.status).toHaveBeenCalledWith(408); expect(h.req.destroy).toHaveBeenCalled(); expect(release).toHaveBeenCalled();
});
it('L19 actual WATCH/MULTI coordinator arbitrates separate pools and retries confirmed conflicts', async () => {
  const server = new RedisDouble();
  const config = { host: '127.0.0.1', port: 16379, username: 'image_test', password: randomBytes(32).toString('hex'),
    tls: false, namespace: 'image-limits-test', generation: randomUUID(), expectedRunId: server.runId, connectTimeoutMs: 100, commandTimeoutMs: 100 };
  const connections = [0, 1].map(() => createAuthRedisConnection(config, { poolFactory: (a, b) => server.poolFactory(a, b) }));
  const held = [];
  try {
    await Promise.all(connections.map(c => c.connect()));
    const services = connections.map(createImageLimits), user = randomUUID(); server.forcedConflicts = 1;
    const outcomes = await Promise.allSettled(services.map(s => s.acquire(user)));
    for (const r of outcomes) if (r.status === 'fulfilled') held.push(r.value);
    expect(held).toHaveLength(1); expect(outcomes.find(r => r.status === 'rejected').reason.status).toBe(429);
    expect(server.conflicts).toBeGreaterThan(0);
  } finally { await Promise.allSettled(held.map(p => p.release())); connections.forEach(c => c.close()); }
});
it('L20 heartbeat extends leases and stops retries after coordinator failure', async () => {
  jest.useFakeTimers(); const user=randomUUID(), p=await acquire(user);
  store.now+=20000; await jest.advanceTimersByTimeAsync(20000);
  let state=JSON.parse(store.data.get(store.prefix+'image-admission').value);
  expect(Object.values(state.leases)[0].until).toBe(store.now+90000);
  store.offline=true; await jest.advanceTimersByTimeAsync(20000);
  store.offline=false; await expect(p.check()).rejects.toThrow('Admission unavailable');
  await p.release(); await p.release();
  state=JSON.parse(store.data.get(store.prefix+'image-admission').value);expect(state.leases).toEqual({});
});
it('L21 local memory budget remains bounded even when distributed leases expire', async () => {
  for(let i=0;i<8;i++) await acquire();
  store.now+=90001;
  await expect(limits.acquire(randomUUID())).rejects.toMatchObject({status:429});
  await permits[0].release();await acquire();
});
it('L22 a failed release frees local capacity while distributed lease still expires safely', async () => {
  const p=await acquire();store.offline=true;await expect(p.release()).rejects.toThrow('Synthetic offline');
  store.offline=false;store.now+=90001;for(let i=0;i<8;i++)await acquire();
});
