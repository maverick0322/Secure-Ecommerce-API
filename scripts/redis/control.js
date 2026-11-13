'use strict';
// Explicit operator tool. Importing this module performs no I/O or connections.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { createClient } = require('redis');
const { loadRedisConfiguration } = require('../../services/auth-redis.service');
const ROOT = path.resolve(__dirname, '../..');
const SECRET_DIRECTORY = path.join(ROOT, '.secrets/redis');
const NAMESPACE = 'secure-ecommerce-auth';
const USER = 'auth_session_app';
const allowedCommands = ['info', 'get', 'set', 'del', 'time', 'watch', 'unwatch', 'multi', 'exec'];
const demand = condition => { if (!condition) throw new Error('Redis operator precondition failed.'); };

function prepare(directory = SECRET_DIRECTORY) {
  // Refuse to rotate or overwrite existing credentials. Certificates may already
  // exist, but none of these credential files may predate this invocation.
  const names = ['app-password', 'health-password', 'users.acl'];
  for (const name of names) demand(!fs.existsSync(path.join(directory, name)));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(directory, 'state'), { recursive: true, mode: 0o700 });
  const app = randomBytes(32).toString('hex'), health = randomBytes(32).toString('hex');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const acl = ['user default reset off',
    `user ${USER} reset on #${hash(app)} ~${NAMESPACE}:* ${allowedCommands.map(c => '+' + c).join(' ')}`,
    `user redis_health reset on #${hash(health)} +ping`, ''].join('\n');
  for (const [name, content] of [['app-password', app], ['health-password', health], ['users.acl', acl]]) {
    fs.writeFileSync(path.join(directory, name), content, { flag: 'wx', mode: 0o600 });
  }
  // Never print credentials or ACL hashes. Partial preparation must be inspected
  // by the operator; it is deliberately not retried or cleaned up automatically.
}

function parseIdentity(info) {
  demand(typeof info === 'string');
  const runId = /(?:^|\n)run_id:([a-f0-9]{40})\r?\n/.exec(info)?.[1];
  const version = /(?:^|\n)redis_version:(\d+)\.(\d+)\./.exec(info);
  demand(runId && version && Number(version[1]) === 8 && Number(version[2]) === 2 && /(?:^|\n)role:master\r?\n/.test(info));
  return runId;
}

async function recover(env, { clientFactory = createClient } = {}) {
  // This tool only reads Redis. State changes are local and require explicit
  // invalidation. The service itself remains fail-closed, never auto-recovers.
  demand(env.AUTH_REDIS_STATE_PATH && path.isAbsolute(env.AUTH_REDIS_STATE_PATH));
  demand(!env.AUTH_REDIS_GENERATION && !env.AUTH_REDIS_EXPECTED_RUN_ID);
  demand(env.AUTH_REDIS_NAMESPACE === NAMESPACE && env.AUTH_REDIS_USER === USER);
  const config = loadRedisConfiguration({ ...env, AUTH_REDIS_STATE_PATH: '',
    AUTH_REDIS_GENERATION: randomUUID(), AUTH_REDIS_EXPECTED_RUN_ID: '0'.repeat(40) });
  demand(config.tls);
  const client = clientFactory({ username: config.username, password: config.password, RESP: 2,
    disableOfflineQueue: true, disableClientInfo: true, maintNotifications: 'disabled', commandsQueueMaxLength: 10,
    commandOptions: { timeout: config.commandTimeoutMs }, socket: { host: config.host, port: config.port,
      tls: true, rejectUnauthorized: true, reconnectStrategy: false, connectTimeout: config.connectTimeoutMs } });
  client.on('error', () => {});
  let timer, expired = false;
  try {
    await Promise.race([(async () => {
      await client.connect();
      const runId = parseIdentity(await client.sendCommand(['INFO', 'server', 'replication']));
      const again = parseIdentity(await client.sendCommand(['INFO', 'server', 'replication']));
      demand(!expired && runId === again);
      const state = { version: 1, namespace: NAMESPACE, generation: randomUUID(), expectedRunId: runId };
      const target = env.AUTH_REDIS_STATE_PATH;
      demand(fs.statSync(path.dirname(target)).isDirectory());
      if (fs.existsSync(target)) demand(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
      const temporary = target + '.' + randomUUID() + '.tmp';
      fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, target);
    })(), new Promise((resolve, reject) => {
      timer = setTimeout(() => { expired = true; client.destroy(); reject(new Error('Redis operator timeout.')); },
        config.connectTimeoutMs + config.commandTimeoutMs * 2 + 100);
    })]);
  } finally {
    clearTimeout(timer); if (client.isOpen) client.destroy();
  }
}

async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && args[0] === 'prepare') { prepare(); return; }
  demand(args.length === 2 && args[0] === 'recover' && args[1] === '--invalidate-sessions');
  await recover(env);
}
if (require.main === module) main().then(() => console.log('Redis local preparation completed; no credentials displayed.'))
  .catch(() => { console.error('Redis preparation failed. No diagnostic secrets displayed; inspect local prerequisites.'); process.exitCode = 1; });
module.exports = { prepare, recover, main, parseIdentity };
