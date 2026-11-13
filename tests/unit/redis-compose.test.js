'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { prepare, recover, main } = require('../../scripts/redis/control');
const { loadRedisConfiguration } = require('../../services/auth-redis.service');
let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'secure-redis-config-')); });
afterEach(() => { jest.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });

it('preserves the entire tracked MySQL service and its volume, adding only a separate Redis volume/network', () => {
  const original = {
  "services": {
    "db": {
      "image": "mysql:8.0",
      "container_name": "ecommerce_db",
      "restart": "unless-stopped",
      "command": "--default-authentication-plugin=mysql_native_password --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci\n",
      "environment": {
        "MYSQL_ROOT_PASSWORD": "${DB_ROOT_PASSWORD:-}",
        "MYSQL_ROOT_HOST": "localhost"
      },
      "ports": [
        "127.0.0.1:3307:3306"
      ],
      "volumes": [
        "mysql_data:/var/lib/mysql",
        "./bd.sql:/docker-entrypoint-initdb.d/01-init.sql:ro"
      ],
      "healthcheck": {
        "test": [
          "CMD",
          "mysqladmin",
          "ping",
          "--host=127.0.0.1",
          "--user=mysql_healthcheck",
          "--silent"
        ],
        "interval": "10s",
        "timeout": "5s",
        "retries": 5,
        "start_period": "20s"
      }
    },
    "app": {
      "depends_on": {
        "db": {
          "condition": "service_healthy",
          "required": false
        }
      }
    }
  },
  "volumes": {
    "mysql_data": null
  }
};
  const current = yaml.load(fs.readFileSync('compose.yaml', 'utf8'));
  expect(current.services.db).toEqual(original.services.db);
  expect(current.volumes.mysql_data).toEqual(original.volumes.mysql_data);
  expect(current.services.redis.image).toBe('redis:8.2');
  expect(current.services.redis.ports).toEqual(['127.0.0.1:6380:6379']);
  expect(current.services.redis.networks).toEqual(['redis_private']);
  expect(current.services.redis.volumes[0]).toBe('redis_data:/data');
  expect(current.services.redis.healthcheck.test.join(' ')).toContain('--tls');
  expect(current.services.redis.healthcheck.test.join(' ')).toContain('--user redis_health');
  expect(current.services.app.networks).toContain('default');
  expect(current.services.app.depends_on).toEqual(original.services.app.depends_on);
});
it('creates random local credentials once, hashes ACL secrets, disables default and limits commands', () => {
  prepare(directory);
  const app = fs.readFileSync(path.join(directory, 'app-password'), 'utf8');
  const health = fs.readFileSync(path.join(directory, 'health-password'), 'utf8');
  const acl = fs.readFileSync(path.join(directory, 'users.acl'), 'utf8');
  expect(Buffer.from(app, 'hex').length).toBe(32); expect(app === health).toBe(false);
  expect(acl.includes(app) || acl.includes(health)).toBe(false);
  expect(acl.includes(crypto.createHash('sha256').update(app).digest('hex'))).toBe(true);
  expect(acl).toContain('user default reset off');
  expect(acl).toContain('~secure-ecommerce-auth:* +info +get +set +del +time +watch +unwatch +multi +exec');
  expect(acl).not.toMatch(/\+@|\+acl|\+config/);
  expect(acl.split('\n').find(line => line.startsWith('user redis_health'))).toMatch(/ \+ping$/);
  expect(() => prepare(directory)).toThrow();
  expect(fs.readFileSync(path.join(directory, 'app-password'), 'utf8') === app).toBe(true);
});

function fixture(changes = {}) {
  prepare(directory);
  const runId = crypto.randomBytes(20).toString('hex');
  const env = { AUTH_REDIS_HOST: '127.0.0.1', AUTH_REDIS_PORT: '6380', AUTH_REDIS_TLS: 'true',
    AUTH_REDIS_USER: 'auth_session_app', AUTH_REDIS_NAMESPACE: 'secure-ecommerce-auth',
    AUTH_REDIS_PASSWORD_PATH: path.join(directory, 'app-password'),
    AUTH_REDIS_STATE_PATH: path.join(directory, 'state/state.json'), ...changes };
  const client = { isOpen: false, on: jest.fn(), connect: jest.fn(async () => { client.isOpen = true; }),
    destroy: jest.fn(() => { client.isOpen = false; }),
    sendCommand: jest.fn(async () => `redis_version:8.2.3\r\nrun_id:${runId}\r\nrole:master\r\n`) };
  const factory = jest.fn(() => client);
  return { env, client, factory, runId };
}
it('recovers using read-only Redis commands, an atomic local state replacement and a fresh generation every time', async () => {
  const f = fixture();
  await recover(f.env, { clientFactory: f.factory });
  const initial = loadRedisConfiguration(f.env);
  expect(initial.expectedRunId).toBe(f.runId);
  expect(f.factory.mock.calls[0][0].socket.rejectUnauthorized).toBe(true);
  expect(f.factory.mock.calls[0][0].socket.reconnectStrategy).toBe(false);
  await recover(f.env, { clientFactory: f.factory });
  const next = loadRedisConfiguration(f.env);
  expect(next.generation === initial.generation).toBe(false);
  expect(f.client.sendCommand.mock.calls.every(([args]) => args.join(' ') === 'INFO server replication')).toBe(true);
  expect(f.client.destroy).toHaveBeenCalledTimes(2);
  const state = JSON.parse(fs.readFileSync(f.env.AUTH_REDIS_STATE_PATH, 'utf8'));
  expect(Object.keys(state).sort()).toEqual(['expectedRunId', 'generation', 'namespace', 'version']);
});
it.each(['namespace', 'version', 'generation', 'expectedRunId', 'extra'])('rejects malformed or conflicting state: %s', async field => {
  const f = fixture(); await recover(f.env, { clientFactory: f.factory });
  const state = JSON.parse(fs.readFileSync(f.env.AUTH_REDIS_STATE_PATH, 'utf8'));
  state[field] = 'invalid'; fs.writeFileSync(f.env.AUTH_REDIS_STATE_PATH, JSON.stringify(state));
  expect(() => loadRedisConfiguration(f.env)).toThrow();
});
it('rejects ambiguous identity sources and relative state paths', async () => {
  const f = fixture(); await recover(f.env, { clientFactory: f.factory });
  expect(() => loadRedisConfiguration({ ...f.env, AUTH_REDIS_GENERATION: crypto.randomUUID() })).toThrow();
  expect(() => loadRedisConfiguration({ ...f.env, AUTH_REDIS_STATE_PATH: 'state.json' })).toThrow();
});
it.each(['replica', 'wrong-version', 'identity-switch', 'offline'])('does not publish a recovery state on %s', async kind => {
  const f = fixture();
  if (kind === 'replica') f.client.sendCommand.mockResolvedValue(`redis_version:8.2.3\r\nrun_id:${f.runId}\r\nrole:slave\r\n`);
  if (kind === 'wrong-version') f.client.sendCommand.mockResolvedValue(`redis_version:7.2.0\r\nrun_id:${f.runId}\r\nrole:master\r\n`);
  if (kind === 'identity-switch') f.client.sendCommand.mockResolvedValueOnce(`redis_version:8.2.3\r\nrun_id:${crypto.randomBytes(20).toString('hex')}\r\nrole:master\r\n`);
  if (kind === 'offline') f.client.connect.mockRejectedValue(new Error('offline'));
  await expect(recover(f.env, { clientFactory: f.factory })).rejects.toThrow();
  expect(fs.existsSync(f.env.AUTH_REDIS_STATE_PATH)).toBe(false);
});
it('requires explicit invalidation and TLS for recovery', async () => {
  await expect(main(['recover'])).rejects.toThrow();
  const f = fixture({ AUTH_REDIS_TLS: 'false' });
  await expect(recover(f.env, { clientFactory: f.factory })).rejects.toThrow();
  expect(f.factory).not.toHaveBeenCalled();
});
it('bounds a hung recovery, and a late read response cannot publish state after timeout', async () => {
  const f = fixture(); jest.useFakeTimers(); let resolve;
  f.client.sendCommand.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const result = recover(f.env, { clientFactory: f.factory }).catch(e => e);
  await jest.advanceTimersByTimeAsync(3101); expect(await result).toBeInstanceOf(Error);
  resolve(`redis_version:8.2.3\r\nrun_id:${f.runId}\r\nrole:master\r\n`);
  await jest.advanceTimersByTimeAsync(1);
  expect(fs.existsSync(f.env.AUTH_REDIS_STATE_PATH)).toBe(false);
});
