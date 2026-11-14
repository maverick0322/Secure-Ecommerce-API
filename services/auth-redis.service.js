'use strict';
const { compareCodeUnits } = require('./canonical-order');

const { readConfigFile } = require('./secure-config-file.service');
const { loadRedisCa } = require('./redis-tls-config.service');
const net = require('node:net');
const { createClientPool, WatchError } = require('redis');
const { isAccessUuid } = require('../validators/uuid');
const { RedisConfigurationError, SessionStoreUnavailableError, AuthSessionError } = require('./auth-session-errors');

const validRunId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function configured(condition) { if (!condition) throw new RedisConfigurationError(); }

function readSecret(location, env) {
  const secret = readConfigFile(location, 256, env);
  configured(Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 256 && !/[\r\n\0]/.test(secret));
  return secret;
}
function validateConfiguration(config) {
  configured(config && typeof config === 'object');
  const { host, port, username, password, tls, ca, namespace, generation, expectedRunId,
    connectTimeoutMs = 1000, commandTimeoutMs = 1000 } = config;
  configured(typeof host === 'string' && (net.isIP(host) || /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host)));
  configured(Number.isInteger(port) && port > 0 && port <= 65535);
  configured(typeof username === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(username));
  configured(typeof password === 'string' && Buffer.byteLength(password) >= 32 && Buffer.byteLength(password) <= 256 && !/[\r\n\0]/.test(password));
  configured(typeof tls === 'boolean' && (tls || ['127.0.0.1', '::1', 'localhost'].includes(host)));
  configured(ca === undefined || (tls && typeof ca === 'string' && Buffer.byteLength(ca) <= 65536));
  configured(typeof namespace === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(namespace));
  configured(isAccessUuid(generation) && validRunId(expectedRunId));
  for (const value of [connectTimeoutMs, commandTimeoutMs]) configured(Number.isInteger(value) && value >= 100 && value <= 5000);
  return Object.freeze({ host, port, username, password, tls, ca, namespace, generation, expectedRunId,
    connectTimeoutMs, commandTimeoutMs });
}
function loadRedisConfiguration(env = process.env) {
  try {
    configured(['true', 'false'].includes(env.AUTH_REDIS_TLS));
    let generation = env.AUTH_REDIS_GENERATION, expectedRunId = env.AUTH_REDIS_EXPECTED_RUN_ID;
    if (env.AUTH_REDIS_STATE_PATH) {
      configured(!generation && !expectedRunId);
      const state = JSON.parse(readConfigFile(env.AUTH_REDIS_STATE_PATH, 1024, env).replace(/^\uFEFF/, ''));
      configured(state && state.namespace === env.AUTH_REDIS_NAMESPACE && state.version === 1 &&
        Object.keys(state).sort(compareCodeUnits).join(',') === 'expectedRunId,generation,namespace,version');
      generation = state.generation; expectedRunId = state.expectedRunId;
    }
    return validateConfiguration({ host: env.AUTH_REDIS_HOST, port: Number(env.AUTH_REDIS_PORT),
      username: env.AUTH_REDIS_USER, password: readSecret(env.AUTH_REDIS_PASSWORD_PATH, env), tls: env.AUTH_REDIS_TLS === 'true',
      ca: loadRedisCa(env),
      namespace: env.AUTH_REDIS_NAMESPACE, generation, expectedRunId,
      connectTimeoutMs: env.AUTH_REDIS_CONNECT_TIMEOUT_MS === undefined ? 1000 : Number(env.AUTH_REDIS_CONNECT_TIMEOUT_MS),
      commandTimeoutMs: env.AUTH_REDIS_COMMAND_TIMEOUT_MS === undefined ? 1000 : Number(env.AUTH_REDIS_COMMAND_TIMEOUT_MS) });
  } catch { throw new RedisConfigurationError(); }
}

const MAX_ATTEMPTS = 4;
const confirmedConflict = error => error instanceof WatchError && error.message === new WatchError().message;

function createAuthRedisConnection(configuration, { poolFactory = createClientPool } = {}) {
  const config = validateConfiguration(configuration);
  const prefix = `${config.namespace}:{${config.generation}}:`;
  const fenceKey = prefix + 'store';
  let pool, ready = false, poisoned = false, started = false, pending = 0;
  function poison() {
    ready = false; poisoned = true;
    try { pool?.destroy(); } catch { /* Client diagnostics must not escape. */ }
  }
  function available() { if (poisoned) throw new SessionStoreUnavailableError(); }
  async function limited(work, milliseconds, uncertain = false, conflictAllowed = false) {
    let timer;
    try {
      available();
      return await Promise.race([Promise.resolve().then(work), new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new SessionStoreUnavailableError(uncertain)), milliseconds);
      })]);
    } catch (error) {
      if (conflictAllowed && !poisoned && confirmedConflict(error)) throw error;
      poison(); throw new SessionStoreUnavailableError(uncertain);
    } finally { clearTimeout(timer); }
  }
  function validateIdentity(info) {
    const lines = typeof info === 'string' ? Object.fromEntries(info.split(/\r?\n/)
      .filter(line => /^[a-z_]+:/.test(line)).map(line => { const i = line.indexOf(':'); return [line.slice(0, i), line.slice(i + 1)]; })) : {};
    const version = /^(\d+)\.(\d+)\./.exec(lines.redis_version || '');
    if (lines.run_id !== config.expectedRunId || lines.role !== 'master' || !version ||
      Number(version[1]) < 7 || (Number(version[1]) === 7 && Number(version[2]) < 2)) {
      poison(); throw new SessionStoreUnavailableError();
    }
  }
  function keyAllowed(key) { return typeof key === 'string' && key.startsWith(prefix) && key.length <= prefix.length + 128; }
  async function leased(client, work, bootstrap) {
    const send = args => limited(() => client.sendCommand(args), config.commandTimeoutMs);
    let committed = false;
    try {
      validateIdentity(await send(['INFO', 'server', 'replication']));
      await limited(() => client.watch(fenceKey), config.commandTimeoutMs);
      const prior = await send(['GET', fenceKey]);
      if ((bootstrap && prior !== null && prior !== config.expectedRunId) || (!bootstrap && prior !== config.expectedRunId)) {
        poison(); throw new SessionStoreUnavailableError();
      }
      const tx = Object.freeze({
        async watch(keys) {
          if (!Array.isArray(keys) || !keys.length || keys.some(key => !keyAllowed(key))) throw new RedisConfigurationError();
          await limited(() => client.watch(keys), config.commandTimeoutMs);
        },
        async get(key) {
          if (!keyAllowed(key)) throw new RedisConfigurationError();
          return send(['GET', key]);
        },
        async time() {
          const reply = await send(['TIME']);
          const now = Array.isArray(reply) ? Number(reply[0]) * 1000 + Math.floor(Number(reply[1]) / 1000) : Number.NaN;
          if (!Number.isSafeInteger(now) || now <= 0) { poison(); throw new SessionStoreUnavailableError(); }
          return now;
        },
        async commit(commands = []) {
          if (committed || !Array.isArray(commands) || commands.some(args => !Array.isArray(args) ||
            args.some(v => typeof v !== 'string') || !['SET', 'DEL'].includes(args[0]) || !keyAllowed(args[1]) ||
            (args[0] === 'DEL' && args.length !== 2) ||
            (args[0] === 'SET' && !(args.length === 5 && args[3] === 'PXAT' && /^\d{13,16}$/.test(args[4])) &&
              !(args.length === 3 && args[1].startsWith(prefix + 'user-epoch:') && isAccessUuid(args[2]))))) {
            throw new RedisConfigurationError();
          }
          validateIdentity(await send(['INFO', 'server', 'replication']));
          available();
          const multi = client.multi().addCommand(['INFO', 'server', 'replication']).addCommand(['GET', fenceKey]);
          if (bootstrap && prior === null) multi.addCommand(['SET', fenceKey, config.expectedRunId, 'NX']);
          for (const args of commands) multi.addCommand(args);
          // Only a confirmed null EXEC reply can be retried. Disconnects, timeouts,
          // topology WatchErrors and partial EXEC failures permanently fence this pool.
          const replies = await limited(() => multi.exec(), config.commandTimeoutMs, commands.length > 0 || bootstrap, true);
          committed = true;
          if (!Array.isArray(replies) || replies.length !== 2 + commands.length + (bootstrap && prior === null ? 1 : 0) ||
            replies.some(value => value instanceof Error)) {
            poison(); throw new SessionStoreUnavailableError(commands.length > 0 || bootstrap);
          }
          try { validateIdentity(replies[0]); }
          catch { throw new SessionStoreUnavailableError(commands.length > 0 || bootstrap); }
          if (replies[1] !== prior || (bootstrap && prior === null && replies[2] !== 'OK')) {
            poison(); throw new SessionStoreUnavailableError(true);
          }
          available();
        }
      });
      const result = await work(tx);
      if (!committed) throw new RedisConfigurationError();
      return result;
    } finally {
      // Pool.execute does not reset WATCH on application errors. Never return a
      // watched connection to another request; destroy the pool if cleanup fails.
      if (!poisoned && client.isReady) await limited(() => client.unwatch(), config.commandTimeoutMs);
    }
  }
  async function transaction(work, bootstrap = false) {
    if ((!ready && !bootstrap) || poisoned) throw new SessionStoreUnavailableError();
    if (typeof work !== 'function') throw new RedisConfigurationError();
    if (pending >= 32) throw new AuthSessionError('SESSION_CONFLICT');
    pending++;
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          // One exclusive pool lease covers WATCH, reads, MULTI/EXEC and UNWATCH.
          return await pool.execute(client => leased(client, work, bootstrap));
        } catch (error) {
          if (!poisoned && confirmedConflict(error)) continue;
          if (error instanceof AuthSessionError || error instanceof RedisConfigurationError || error instanceof SessionStoreUnavailableError) throw error;
          poison(); throw new SessionStoreUnavailableError();
        }
      }
      throw new AuthSessionError('SESSION_CONFLICT');
    } finally { pending--; }
  }
  async function connect() {
    if (started) throw new SessionStoreUnavailableError();
    started = true;
    try {
      pool = poolFactory({ username: config.username, password: config.password, database: 0, RESP: 2,
        disableOfflineQueue: true, commandsQueueMaxLength: 100, disableClientInfo: true, maintNotifications: 'disabled',
        commandOptions: { timeout: config.commandTimeoutMs },
        socket: { host: config.host, port: config.port, tls: config.tls, ...(config.ca && { ca: config.ca }), rejectUnauthorized: true,
          connectTimeout: config.connectTimeoutMs, reconnectStrategy: false } },
      { minimum: 1, maximum: 4, acquireTimeout: config.connectTimeoutMs, cleanupDelay: 1000 });
      pool.on('error', poison);
      await limited(() => pool.connect(), config.connectTimeoutMs);
      await transaction(tx => tx.commit(), true);
      available(); ready = true;
    } catch { poison(); throw new SessionStoreUnavailableError(); }
  }
  return Object.freeze({ connect, transaction: work => transaction(work), close: poison, prefix, fenceKey, expectedRunId: config.expectedRunId });
}
module.exports = { createAuthRedisConnection, loadRedisConfiguration };
