'use strict';
// Disposable end-to-end runner for PEN-05 / RNF-06 load and rate-limit tests with k6.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { hash } = require('../../services/password-hash.service');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'tests', 'support', 'final-schema.json');
const REDIS_CONF_PATH = path.join(REPO_ROOT, 'config', 'redis', 'redis.conf');
const K6_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'load', 'k6-pen05.js');
const IMAGE_TAG = 'backendnode-k6-app:local';

function dockerPrefix() {
  return process.platform === 'win32' ? ['--context', 'desktop-linux'] : [];
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result;
}

function docker(args, options = {}) {
  return run('docker', [...dockerPrefix(), ...args], { timeout: 120000, ...options }).stdout.trim();
}

function dockerRaw(args, options = {}) {
  return run('docker', [...dockerPrefix(), ...args], { timeout: 120000, ...options });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUntil(checkFn, attempts, delayMs, onTimeout) {
  if (await checkFn()) return;
  if (attempts <= 1) {
    throw new Error(onTimeout());
  }
  await delay(delayMs);
  return pollUntil(checkFn, attempts - 1, delayMs, onTimeout);
}

function writeSecretFile(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode });
}

function generateTlsCerts(redisDir) {
  const caKey = path.join(redisDir, 'ca.key');
  const caCrt = path.join(redisDir, 'ca.crt');
  const srvKey = path.join(redisDir, 'server.key');
  const srvCsr = path.join(redisDir, 'server.csr');
  const srvCrt = path.join(redisDir, 'server.crt');
  const extFile = path.join(redisDir, 'ext.cnf');

  run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '7',
    '-keyout', caKey, '-out', caCrt, '-subj', '/CN=k6-pen05-redis-ca',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign'
  ]);
  run('openssl', [
    'req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', srvKey, '-out', srvCsr, '-subj', '/CN=redis'
  ]);
  fs.writeFileSync(extFile, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    'subjectAltName=DNS:redis,DNS:localhost,IP:127.0.0.1',
    ''
  ].join('\n'));
  run('openssl', [
    'x509', '-req', '-sha256', '-days', '7',
    '-in', srvCsr, '-CA', caCrt, '-CAkey', caKey,
    '-CAcreateserial', '-out', srvCrt, '-extfile', extFile
  ]);
  for (const tempFile of [caKey, srvCsr, extFile, path.join(redisDir, 'ca.srl')]) {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

function prepareEphemeralSecrets(secretsDir, cfg) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });

  const authPubDir = path.join(secretsDir, 'auth', 'public-keys');
  const redisStateDir = path.join(secretsDir, 'redis', 'state');
  const redisDir = path.join(secretsDir, 'redis');
  fs.mkdirSync(authPubDir, { recursive: true });
  fs.mkdirSync(redisStateDir, { recursive: true });

  writeSecretFile(path.join(secretsDir, 'db-app-password'), cfg.dbAppPw);
  writeSecretFile(path.join(secretsDir, 'jwt-secret'), cfg.jwtSecret);
  writeSecretFile(path.join(secretsDir, 'cred-version.key'), cfg.credKey);
  writeSecretFile(path.join(secretsDir, 'access-private.pem'), privateKey);
  writeSecretFile(path.join(authPubDir, 'access-v1.pem'), publicKey, 0o644);
  writeSecretFile(
    path.join(secretsDir, 'public-keys.docker.json'),
    JSON.stringify({ 'access-v1': '/run/auth/public-keys/access-v1.pem' }, null, 2),
    0o644
  );
  writeSecretFile(path.join(secretsDir, 'cloudinary-secret'), 'synthetic-k6-cloudinary');
  writeSecretFile(path.join(secretsDir, 'gmail-client.json'), '{"installed":{"client_id":"k6.apps.googleusercontent.com"}}');
  writeSecretFile(path.join(secretsDir, 'gmail-token.json'), '{"version":1}');

  const sha256Hex = val => crypto.createHash('sha256').update(val).digest('hex');
  const allowedRedisCmds = ['info', 'get', 'set', 'del', 'time', 'watch', 'unwatch', 'multi', 'exec'];
  const acl = [
    'user default reset off',
    `user auth_session_app reset on #${sha256Hex(cfg.redisAppPw)} ~secure-ecommerce-auth:* ${allowedRedisCmds.map(c => '+' + c).join(' ')}`,
    `user redis_health reset on #${sha256Hex(cfg.redisHealthPw)} +ping`,
    ''
  ].join('\n');
  writeSecretFile(path.join(redisDir, 'app-password'), cfg.redisAppPw);
  writeSecretFile(path.join(redisDir, 'users.acl'), acl);
  generateTlsCerts(redisDir);

  return { authPubDir, redisStateDir, redisDir };
}

async function startAndSeedMysql(cfg) {
  console.log('[k6-runner] Starting disposable MySQL 8.4...');
  docker([
    'run', '--detach', '--name', cfg.dbName, '--hostname', 'db',
    '--network', cfg.internalNet, '--network-alias', 'db',
    '--tmpfs', '/var/lib/mysql:rw',
    '--env', `MYSQL_ROOT_PASSWORD=${cfg.dbRootPw}`,
    '--env', 'MYSQL_ROOT_HOST=localhost',
    'mysql:8.4',
    '--authentication-policy=caching_sha2_password,,',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci'
  ]);

  let lastDbErr = '';
  await pollUntil(() => {
    const probe = dockerRaw([
      'exec', '-i', cfg.dbName, 'sh', '-c',
      'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; mysql --protocol=SOCKET --user=root --batch --skip-column-names -e "SELECT 1"'
    ], { allowFailure: true });
    if (probe.status === 0 && probe.stdout.trim() === '1') return true;
    lastDbErr = probe.stderr || probe.stdout || `exit ${probe.status}`;
    return false;
  }, 90, 1000, () => {
    const logs = dockerRaw(['logs', '--tail', '30', cfg.dbName], { allowFailure: true });
    return `MySQL did not become ready (${lastDbErr.trim()}):\n${logs.stderr || logs.stdout}`;
  });

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const sellerId = crypto.randomUUID();
  const buyerId = crypto.randomUUID();
  const lockoutId = crypto.randomUUID();
  const passwordHash = await hash(cfg.testPassword);

  const setupStatements = [
    'CREATE DATABASE secure_ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
    'USE secure_ecommerce;',
    ...['users', 'admins', 'sellers', 'buyers', 'user_addresses', 'categories', 'products',
      'product_categories', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history', 'audit_logs', 'SequelizeMeta']
      .map(t => `${schema.ddl[t]};`),
    `CREATE USER 'ecommerce_app'@'%' IDENTIFIED WITH caching_sha2_password BY '${cfg.dbAppPw}';`,
    ...schema.grants.map(g => `${g};`),
    'FLUSH PRIVILEGES;',
    `INSERT INTO users (id,email,name,passwordHash,status,emailVerifiedAt,createdAt,updatedAt) VALUES ('${sellerId}','${cfg.sellerEmail}','Load Seller','${passwordHash}','ACTIVE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO sellers (userId,storeName,status,requestedAt,reviewedAt,updatedAt) VALUES ('${sellerId}','Load Store','APPROVED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO users (id,email,name,passwordHash,status,emailVerifiedAt,createdAt,updatedAt) VALUES ('${buyerId}','${cfg.buyerEmail}','Load Buyer','${passwordHash}','ACTIVE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO buyers (userId) VALUES ('${buyerId}');`,
    `INSERT INTO users (id,email,name,passwordHash,status,emailVerifiedAt,createdAt,updatedAt) VALUES ('${lockoutId}','${cfg.lockoutEmail}','Load Lockout','${passwordHash}','ACTIVE',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO buyers (userId) VALUES ('${lockoutId}');`,
    `INSERT INTO user_addresses (id,buyerId,label,recipientName,street,exteriorNumber,neighborhood,city,state,postalCode,country,isDefault,createdAt,updatedAt) VALUES (1,'${buyerId}','Casa','Load Buyer','Av. Principal','100','Centro','Xalapa','Veracruz','91000','MX',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO categories (id,name,protected,createdAt,updatedAt) VALUES (1,'Laptops',0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO products (id,sellerId,title,description,price,stock,imagePublicId,createdAt,updatedAt) VALUES (1,'${sellerId}','Laptop Pro 14','Equipo de prueba de carga 1','12500.00',500,'secure-ecommerce/products/load-1',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO products (id,sellerId,title,description,price,stock,imagePublicId,createdAt,updatedAt) VALUES (2,'${sellerId}','Laptop Air 13','Equipo de prueba de carga 2','9500.00',500,'secure-ecommerce/products/load-2',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));`,
    `INSERT INTO product_categories (categoryId,productId,createdAt) VALUES (1,1,UTC_TIMESTAMP(3)),(1,2,UTC_TIMESTAMP(3));`,
    'SELECT @@server_uuid AS uuid;'
  ].join('\n');

  const uuidOut = docker([
    'exec', '-i', cfg.dbName, 'sh', '-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names'
  ], { input: setupStatements });
  const dbUuid = uuidOut.trim().split(/\r?\n/).at(-1).trim();
  assert(/^[0-9a-f-]{36}$/i.test(dbUuid), `Unexpected DB UUID: ${dbUuid}`);
  return dbUuid;
}

async function startAndRecoverRedis(cfg, paths) {
  console.log('[k6-runner] Starting disposable Redis 8.2 TLS...');
  docker([
    'run', '--detach', '--name', cfg.redisName, '--hostname', 'redis',
    '--network', cfg.internalNet, '--network-alias', 'redis',
    '--tmpfs', '/data:rw',
    '-v', `${REDIS_CONF_PATH}:/usr/local/etc/redis/redis.conf:ro`,
    '-v', `${path.join(paths.redisDir, 'users.acl')}:/run/secrets/redis_acl:ro`,
    '-v', `${path.join(paths.redisDir, 'ca.crt')}:/run/secrets/redis_ca:ro`,
    '-v', `${path.join(paths.redisDir, 'server.crt')}:/run/secrets/redis_server_cert:ro`,
    '-v', `${path.join(paths.redisDir, 'server.key')}:/run/secrets/redis_server_key:ro`,
    'redis:8.2', 'redis-server', '/usr/local/etc/redis/redis.conf'
  ]);

  await pollUntil(() => {
    const probe = dockerRaw([
      'exec', '-e', `REDISCLI_AUTH=${cfg.redisHealthPw}`, cfg.redisName,
      'redis-cli', '--tls', '--cacert', '/run/secrets/redis_ca',
      '-h', '127.0.0.1', '-p', '6379', '--user', 'redis_health', 'ping'
    ], { allowFailure: true });
    return probe.status === 0 && probe.stdout.trim() === 'PONG';
  }, 40, 500, () => 'Redis TLS did not become ready');

  console.log('[k6-runner] Executing fail-closed Redis recovery...');
  docker([
    'run', '--rm', '--network', cfg.internalNet,
    '--entrypoint', 'node',
    '-v', `${path.join(REPO_ROOT, 'scripts')}:/usr/src/app/scripts:ro`,
    '-v', `${paths.redisStateDir}:/run/redis-state:rw`,
    '-v', `${path.join(paths.redisDir, 'app-password')}:/run/secrets/redis_app_password:ro`,
    '-v', `${path.join(paths.redisDir, 'ca.crt')}:/run/secrets/redis_ca:ro`,
    '--env', 'AUTH_REDIS_HOST=redis',
    '--env', 'AUTH_REDIS_PORT=6379',
    '--env', 'AUTH_REDIS_TLS=true',
    '--env', 'AUTH_REDIS_USER=auth_session_app',
    '--env', 'AUTH_REDIS_NAMESPACE=secure-ecommerce-auth',
    '--env', 'AUTH_REDIS_PASSWORD_PATH=/run/secrets/redis_app_password',
    '--env', 'AUTH_REDIS_CA_PATH=/run/secrets/redis_ca',
    '--env', 'AUTH_REDIS_STATE_PATH=/run/redis-state/state.json',
    '--env', 'NODE_EXTRA_CA_CERTS=/run/secrets/redis_ca',
    IMAGE_TAG, 'scripts/redis/control.js', 'recover', '--invalidate-sessions'
  ]);
}

async function waitForHttpHealth(url, containerName) {
  await pollUntil(async () => {
    try {
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }, 40, 1000, () => {
    const logs = dockerRaw(['logs', '--tail', '40', containerName], { allowFailure: true });
    return `API failed to respond healthy at ${url}:\n${logs.stderr || logs.stdout}`;
  });
}

async function runDefensiveHttpChecks(baseUrl) {
  const health = await fetch(`${baseUrl}/health`);
  const swagger = await fetch(`${baseUrl}/swagger`);
  const fileItemGone = await fetch(`${baseUrl}/api/files/1`);
  const rolesUnauth = await fetch(`${baseUrl}/api/roles`);
  const authUnauth = await fetch(`${baseUrl}/api/auth/time`);

  const checks = {
    healthStatus: health.status,
    xPoweredByAbsent: !health.headers.has('x-powered-by'),
    swaggerDisabledInProd: swagger.status === 404,
    fileItemGone410: fileItemGone.status === 410,
    rolesRequireAuth401: rolesUnauth.status === 401,
    authNoStore: (authUnauth.headers.get('cache-control') || '').toLowerCase().includes('no-store')
  };

  assert.equal(checks.healthStatus, 200, 'Expected /health to return 200');
  assert.equal(checks.xPoweredByAbsent, true, 'Expected X-Powered-By to be absent');
  assert.equal(checks.swaggerDisabledInProd, true, 'Expected /swagger to return 404 in production');
  assert.equal(checks.fileItemGone410, true, 'Expected /api/files/1 to return 410');
  assert.equal(checks.rolesRequireAuth401, true, 'Expected unauthenticated /api/roles to return 401');
  assert.equal(checks.authNoStore, true, 'Expected /api/auth/time to set Cache-Control: no-store');

  return checks;
}

async function startHardenedApi(cfg, paths, secretsDir, dbUuid) {
  console.log('[k6-runner] Starting hardened ecommerce_api container...');
  docker([
    'create', '--name', cfg.apiName, '--hostname', cfg.apiName,
    '--network', cfg.edgeNet, '--network-alias', 'k6-pen05-api',
    '--publish', '127.0.0.1::3000',
    '--read-only',
    '--security-opt', 'no-new-privileges:true',
    '--cap-drop', 'ALL',
    '--memory', '512m',
    '--cpus', '1.0',
    '--pids-limit', '128',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--tmpfs', '/usr/src/app/uploads:rw,noexec,nosuid,uid=1000,gid=1000',
    '--tmpfs', '/usr/src/app/log:rw,noexec,nosuid,uid=1000,gid=1000',
    '-v', `${paths.authPubDir}:/run/auth/public-keys:ro`,
    '-v', `${paths.redisStateDir}:/run/redis-state:ro`,
    '-v', `${path.join(secretsDir, 'db-app-password')}:/run/secrets/db_password:ro`,
    '-v', `${path.join(secretsDir, 'jwt-secret')}:/run/secrets/jwt_secret:ro`,
    '-v', `${path.join(secretsDir, 'cloudinary-secret')}:/run/secrets/cloudinary_api_secret:ro`,
    '-v', `${path.join(secretsDir, 'gmail-client.json')}:/run/secrets/gmail_client:ro`,
    '-v', `${path.join(secretsDir, 'gmail-token.json')}:/run/secrets/gmail_token:ro`,
    '-v', `${path.join(secretsDir, 'access-private.pem')}:/run/secrets/access_private_key:ro`,
    '-v', `${path.join(secretsDir, 'public-keys.docker.json')}:/run/secrets/access_public_manifest:ro`,
    '-v', `${path.join(secretsDir, 'cred-version.key')}:/run/secrets/auth_credential_key:ro`,
    '-v', `${path.join(paths.redisDir, 'app-password')}:/run/secrets/redis_app_password:ro`,
    '-v', `${path.join(paths.redisDir, 'ca.crt')}:/run/secrets/redis_ca:ro`,
    '--env', 'DB_HOST=db',
    '--env', 'DB_PORT=3306',
    '--env', 'DB_DATABASE=secure_ecommerce',
    '--env', 'DB_USER=ecommerce_app',
    '--env', 'DB_PASSWORD_FILE=/run/secrets/db_password',
    '--env', `DB_EXPECTED_UUID=${dbUuid}`,
    '--env', 'DB_SSL=false',
    '--env', 'SERVER_PORT=3000',
    '--env', 'SERVER_HOST=0.0.0.0',
    '--env', 'NODE_ENV=production',
    '--env', 'TRUST_PROXY=false',
    '--env', 'CORS_ORIGIN=https://tienda.lan',
    '--env', 'JWT_SECRET_FILE=/run/secrets/jwt_secret',
    '--env', 'GMAIL_CLIENT_PATH=/run/secrets/gmail_client',
    '--env', 'GMAIL_TOKEN_PATH=/run/secrets/gmail_token',
    '--env', 'GMAIL_SENDER_EMAIL=noreply@example.invalid',
    '--env', 'GMAIL_REDIRECT_URI=http://localhost:3001/oauth2/callback',
    '--env', 'CLOUDINARY_CLOUD_NAME=k6cloud',
    '--env', 'CLOUDINARY_API_KEY=123456',
    '--env', 'CLOUDINARY_API_SECRET_FILE=/run/secrets/cloudinary_api_secret',
    '--env', 'JWT_RS256_ISSUER=secure-ecommerce-api/access-v2',
    '--env', 'JWT_RS256_AUDIENCE=secure-ecommerce-clients/access-v2',
    '--env', 'JWT_RS256_ACTIVE_KID=access-v1',
    '--env', 'JWT_RS256_PRIVATE_KEY_PATH=/run/secrets/access_private_key',
    '--env', 'JWT_RS256_PUBLIC_KEYS_PATH=/run/secrets/access_public_manifest',
    '--env', 'AUTH_CREDENTIAL_VERSION_KEY_PATH=/run/secrets/auth_credential_key',
    '--env', 'AUTH_REDIS_HOST=redis',
    '--env', 'AUTH_REDIS_PORT=6379',
    '--env', 'AUTH_REDIS_TLS=true',
    '--env', 'AUTH_REDIS_USER=auth_session_app',
    '--env', 'AUTH_REDIS_NAMESPACE=secure-ecommerce-auth',
    '--env', 'AUTH_REDIS_PASSWORD_PATH=/run/secrets/redis_app_password',
    '--env', 'AUTH_REDIS_CA_PATH=/run/secrets/redis_ca',
    '--env', 'AUTH_REDIS_STATE_PATH=/run/redis-state/state.json',
    '--env', 'NODE_EXTRA_CA_CERTS=/run/secrets/redis_ca',
    IMAGE_TAG
  ]);
  docker(['network', 'connect', cfg.internalNet, cfg.apiName]);
  docker(['start', cfg.apiName]);

  const portLine = docker(['port', cfg.apiName, '3000/tcp']);
  const hostPort = portLine.split(':').pop().trim();
  const hostBaseUrl = `http://127.0.0.1:${hostPort}`;
  await waitForHttpHealth(`${hostBaseUrl}/health`, cfg.apiName);
  return hostBaseUrl;
}

function summarizeMetric(metrics, name) {
  const entry = metrics?.[name]?.values ?? metrics?.[name];
  if (!entry) return null;
  if (typeof entry.count === 'number' && entry['p(95)'] === undefined) {
    return { count: entry.count };
  }
  return {
    avgMs: Number((entry.avg || 0).toFixed(2)),
    p50Ms: Number((entry.med || 0).toFixed(2)),
    p95Ms: Number((entry['p(95)'] || 0).toFixed(2)),
    maxMs: Number((entry.max || 0).toFixed(2))
  };
}

function executeK6Suite(cfg, outDir, httpSurfaceChecks) {
  console.log('[k6-runner] Executing grafana/k6:1.3.0 PEN-05 / RNF-06 suite...');
  const apiUrl = ['http://', 'k6-pen05-api:3000'].join('');
  const k6Run = dockerRaw([
    'run', '--rm', '--network', cfg.edgeNet,
    '-v', `${K6_SCRIPT_PATH}:/scripts/k6-pen05.js:ro`,
    '-v', `${outDir}:/out:rw`,
    '--env', `BASE_URL=${apiUrl}`,
    '--env', `BUYER_EMAIL=${cfg.buyerEmail}`,
    '--env', `BUYER_PASSWORD=${cfg.testPassword}`,
    '--env', 'PRODUCT_ID=1',
    '--env', 'ADDRESS_ID=1',
    '--env', `LOCKOUT_EMAIL=${cfg.lockoutEmail}`,
    '--env', `LOCKOUT_PASSWORD=${cfg.wrongPassword}`,
    'grafana/k6:1.3.0', 'run', '--summary-export', '/out/summary.json', '/scripts/k6-pen05.js'
  ], { allowFailure: true, timeout: 180000 });

  process.stdout.write(k6Run.stdout || '');
  if (k6Run.stderr) process.stderr.write(k6Run.stderr);

  const summaryPath = path.join(outDir, 'summary.json');
  const summaryJson = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null;
  const cleanSummary = {
    k6ExitCode: k6Run.status,
    httpSurfaceChecks,
    metrics: summaryJson ? {
      httpRequestsTotal: summaryJson.metrics?.http_reqs?.values?.count ?? summaryJson.metrics?.http_reqs?.count ?? 0,
      checksPasses: summaryJson.metrics?.checks?.values?.passes ?? summaryJson.metrics?.checks?.passes ?? 0,
      checksFails: summaryJson.metrics?.checks?.values?.fails ?? summaryJson.metrics?.checks?.fails ?? 0,
      loginDuration: summarizeMetric(summaryJson.metrics, 'login_duration'),
      healthDuration: summarizeMetric(summaryJson.metrics, 'health_duration'),
      catalogReadDuration: summarizeMetric(summaryJson.metrics, 'catalog_read_duration'),
      catalogSearchDuration: summarizeMetric(summaryJson.metrics, 'catalog_search_duration'),
      checkoutFlowDuration: summarizeMetric(summaryJson.metrics, 'checkout_flow_duration'),
      bruteforce401: summarizeMetric(summaryJson.metrics, 'bruteforce_401'),
      bruteforce429: summarizeMetric(summaryJson.metrics, 'bruteforce_429'),
      bruteforceRetryAfter: summarizeMetric(summaryJson.metrics, 'bruteforce_retry_after'),
      server5xx: summarizeMetric(summaryJson.metrics, 'server_5xx')
    } : null
  };

  console.log('=== PEN-05 SUMMARY ===');
  console.log(JSON.stringify(cleanSummary, null, 2));

  if (k6Run.status !== 0) {
    throw new Error(`k6 exited with code ${k6Run.status}`);
  }
}

function cleanupResources(cfg, tmpDir) {
  for (const c of [cfg.apiName, cfg.redisName, cfg.dbName]) {
    docker(['rm', '-f', c], { allowFailure: true });
  }
  for (const n of [cfg.edgeNet, cfg.internalNet]) {
    docker(['network', 'rm', n], { allowFailure: true });
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function main() {
  const suffix = crypto.randomBytes(4).toString('hex');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `k6-pen05-${suffix}-`));
  const secretsDir = path.join(tmpDir, 'secrets');
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const cfg = {
    internalNet: `k6-pen05-int-${suffix}`,
    edgeNet: `k6-pen05-edge-${suffix}`,
    dbName: `k6-pen05-db-${suffix}`,
    redisName: `k6-pen05-redis-${suffix}`,
    apiName: `k6-pen05-api-${suffix}`,
    dbRootPw: crypto.randomBytes(24).toString('hex'),
    dbAppPw: crypto.randomBytes(24).toString('hex'),
    jwtSecret: crypto.randomBytes(48).toString('hex'),
    credKey: crypto.randomBytes(64),
    redisAppPw: crypto.randomBytes(32).toString('hex'),
    redisHealthPw: crypto.randomBytes(32).toString('hex'),
    buyerEmail: `buyer.${suffix}@example.invalid`,
    sellerEmail: `seller.${suffix}@example.invalid`,
    lockoutEmail: `lockout.${suffix}@example.invalid`,
    testPassword: `LoadTest_${crypto.randomBytes(8).toString('hex')}!1`,
    wrongPassword: `WrongPass_${crypto.randomBytes(8).toString('hex')}!1`
  };

  try {
    const paths = prepareEphemeralSecrets(secretsDir, cfg);
    console.log('[k6-runner] Building backend Dockerfile image...');
    docker(['build', '-t', IMAGE_TAG, '.'], { cwd: REPO_ROOT, timeout: 300000 });
    docker(['network', 'create', '--internal', cfg.internalNet]);
    docker(['network', 'create', cfg.edgeNet]);

    const dbUuid = await startAndSeedMysql(cfg);
    await startAndRecoverRedis(cfg, paths);
    const hostBaseUrl = await startHardenedApi(cfg, paths, secretsDir, dbUuid);
    const httpSurfaceChecks = await runDefensiveHttpChecks(hostBaseUrl);
    executeK6Suite(cfg, outDir, httpSurfaceChecks);
  } finally {
    cleanupResources(cfg, tmpDir);
  }
}

main().catch(err => {
  console.error('[k6-runner] ERROR:', err.message);
  process.exitCode = 1;
});
