'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { RedisDouble } = require('../support/redis-double');
const { createAuthRedisConnection, loadRedisConfiguration } = require('../../services/auth-redis.service');
const { RedisConfigurationError } = require('../../services/auth-session-errors');
let server, options;
const code = async promise => { try { await promise; return 'OK'; } catch (error) { return error.code; } };
beforeEach(() => {
  server = new RedisDouble();
  options = { host: '127.0.0.1', port: 16379, username: 'session_test', password: crypto.randomBytes(32).toString('hex'),
    tls: false, namespace: 'secure-ecommerce-auth-test', generation: crypto.randomUUID(), expectedRunId: server.runId,
    connectTimeoutMs: 100, commandTimeoutMs: 100 };
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); for (const client of server.clients) if (client.isOpen) client.destroy(); });

const connection = () => createAuthRedisConnection(options, { poolFactory: (client, pool) => server.poolFactory(client, pool) });
it('uses a bounded exclusive pool with no reconnection, offline replay or exposed credentials', async () => {
  const c = connection(); expect(server.clients).toHaveLength(0); await c.connect();
  const opts = server.clients[0].options;
  expect(opts.disableOfflineQueue).toBe(true); expect(opts.socket.reconnectStrategy).toBe(false);
  expect(opts.socket.rejectUnauthorized).toBe(true); expect(opts.commandOptions.timeout).toBe(100);
  expect(opts.commandsQueueMaxLength).toBe(100); expect(opts.maintNotifications).toBe('disabled');
  expect(JSON.stringify(c).includes(options.password)).toBe(false);
  c.close(); expect(await code(c.connect())).toBe('SESSION_STORE_UNAVAILABLE');
});
it('refuses disconnected use and permanently fences a pool after a socket error', async () => {
  const c = connection(); expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_STORE_UNAVAILABLE');
  await c.connect(); server.clients[0].emit('error', new Error('private diagnostic'));
  expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_STORE_UNAVAILABLE');
});
it.each(['wrong-id', 'replica', 'offline', 'old-version'])('rejects %s before any namespace writes', async kind => {
  if (kind === 'wrong-id') options.expectedRunId = crypto.randomBytes(20).toString('hex');
  if (kind === 'replica') server.role = 'slave';
  if (kind === 'offline') server.online = false;
  if (kind === 'old-version') server.version = '6.2.0';
  expect(await code(connection().connect())).toBe('SESSION_STORE_UNAVAILABLE'); expect(server.writes).toBe(0);
});
it('restricts native operations to the namespace and releases WATCH on caller errors', async () => {
  const c = connection(); await c.connect(); const writes = server.writes;
  for (const work of [tx => tx.watch(['other']), tx => tx.get('other'), tx => tx.commit([['FLUSHDB']]),
    tx => tx.commit([['DEL', c.prefix + 'ok', 'other']]), tx => tx.commit([['SET', c.prefix + 'ok', 'value']])]) {
    expect(await code(c.transaction(work))).toBe('AUTH_REDIS_CONFIGURATION_INVALID');
    expect(server.clients.every(client => client.watched.size === 0)).toBe(true);
  }
  expect(server.writes).toBe(writes); await c.transaction(tx => tx.commit()); c.close();
});
it('bounds connection time', async () => {
  jest.useFakeTimers();
  const c = createAuthRedisConnection(options, { poolFactory: () => ({ on() {}, destroy() {}, connect: () => new Promise(() => {}) }) });
  const result = code(c.connect()); await jest.advanceTimersByTimeAsync(101);
  expect(await result).toBe('SESSION_STORE_UNAVAILABLE');
});
it('does not retry a timed out EXEC or expose the underlying diagnostic', async () => {
  const c = connection(); await c.connect(); jest.useFakeTimers(); let calls = 0;
  server.beforeExec = () => { calls++; return new Promise(() => {}); };
  const result = c.transaction(tx => tx.commit([['DEL', c.prefix + 'unused']])).catch(e => e);
  await jest.advanceTimersByTimeAsync(101); const error = await result;
  expect(error.code).toBe('SESSION_STORE_UNAVAILABLE'); expect(error.outcomeUnknown).toBe(true); expect(calls).toBe(1);
  expect(error.cause).toBeUndefined(); expect(error.message.includes(options.password)).toBe(false);
  c.close();
});
it('limits confirmed WATCH retries without poisoning a healthy store', async () => {
  const c = connection(); await c.connect(); const execs = server.execs;
  server.forcedConflicts = 4;
  expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_CONFLICT');
  expect(server.execs - execs).toBe(4); await c.transaction(tx => tx.commit()); c.close();
});
it('does not treat a topology WatchError as a confirmed transaction conflict', async () => {
  const c = connection(); await c.connect(); const execs = server.execs;
  server.beforeExec = () => { throw new (require('redis').WatchError)('Client reconnected after WATCH'); };
  expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_STORE_UNAVAILABLE');
  expect(server.execs - execs).toBe(1);
});
it('verifies the identity again in EXEC and returns no authorization after an unexpected switch', async () => {
  const c = connection(); await c.connect();
  server.beforeExec = () => { server.runId = crypto.randomBytes(20).toString('hex'); };
  expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_STORE_UNAVAILABLE');
});
it('fails closed if the namespace fence is removed or replaced', async () => {
  const c = connection(); await c.connect(); server.command(['DEL', c.fenceKey]);
  expect(await code(c.transaction(tx => tx.commit()))).toBe('SESSION_STORE_UNAVAILABLE');
});

it.each([
  { host: 'https://example.invalid' }, { host: 'redis.example.invalid', tls: false }, { tls: undefined },
  { username: '' }, { password: 'short' }, { password: 'x'.repeat(40) + '\n' },
  { namespace: '../usual' }, { generation: 'invalid' }, { expectedRunId: 'unknown' },
  { port: 0 }, { port: 65536 }, { connectTimeoutMs: 99 }, { commandTimeoutMs: 5001 }
])('rejects insecure or malformed configuration %#', change => {
  expect(() => createAuthRedisConnection({ ...options, ...change })).toThrow(RedisConfigurationError);
});
it('permits a remote hostname only with verified TLS', () => {
  expect(() => createAuthRedisConnection({ ...options, host: 'redis.example.invalid', tls: true })).not.toThrow();
});
it('reads an explicitly configured secret file without logging or inlining it in errors', () => {
  const location = path.resolve(path.parse(process.cwd()).root, 'auth-test-memory.key');
  jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: 64 });
  jest.spyOn(fs, 'readFileSync').mockReturnValue(options.password);
  const env = { AUTH_REDIS_HOST: options.host, AUTH_REDIS_PORT: String(options.port), AUTH_REDIS_USER: options.username,
    AUTH_REDIS_TLS: 'false', AUTH_REDIS_NAMESPACE: options.namespace, AUTH_REDIS_GENERATION: options.generation,
    AUTH_REDIS_EXPECTED_RUN_ID: options.expectedRunId, AUTH_REDIS_PASSWORD_PATH: location };
  expect(loadRedisConfiguration(env).password === options.password).toBe(true);
  expect(() => loadRedisConfiguration({ ...env, AUTH_REDIS_PASSWORD_PATH: 'relative.key' })).toThrow(RedisConfigurationError);
  expect(() => loadRedisConfiguration({ ...env, AUTH_REDIS_TLS: 'maybe' })).toThrow(RedisConfigurationError);
  fs.readFileSync.mockImplementation(() => { throw new Error('Sensitive filesystem diagnostic'); });
  try { loadRedisConfiguration(env); throw new Error('Expected rejection'); }
  catch (error) { expect(error.code).toBe('AUTH_REDIS_CONFIGURATION_INVALID'); expect(error.cause).toBeUndefined(); }
});
