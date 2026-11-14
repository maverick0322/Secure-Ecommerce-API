'use strict';
// Dedicated disposable Redis only. Never uses Compose or any habitual server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createClient } = require('redis');
const { docker, redisTestStartup: startup } = require('../../postman/scripts/isolation');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { createSessionService } = require('../../services/auth-session.service');

const { inspectOwned } = require('../../postman/scripts/redis-test-metadata');
const inspect = fixture => JSON.parse(docker(['inspect', fixture.id]))[0];
const outcome = async promise => { try { await promise; return 'OK'; } catch (error) { return error.code; } };
async function main({ exercise } = {}) {
  const runId = crypto.randomUUID(); const reportDirectory = path.resolve('log/stage5/redis-stage2');
  fs.mkdirSync(reportDirectory, { recursive: true });
  const report = { runId, success: false, status: 'NOT_EXECUTED', checks: [], cleanup: false };
  const fixture = { runId, name: 'secure-ecommerce-redis-test-' + runId.slice(0, 8) };
  const rootPassword = crypto.randomBytes(32).toString('hex'); const password = crypto.randomBytes(32).toString('hex');
  const namespace = 'secure-ecommerce-auth-test-' + runId.slice(0, 8);
  const generation = crypto.randomUUID(); const connections = []; let admin;
  function ownedPort(beforeStart = false) { return inspectOwned(inspect(fixture), fixture, beforeStart); }
  async function openAdmin() {
    const port = ownedPort();
    for (let n = 0; n < 60; n++) {
      const client = createClient({ password: rootPassword, disableOfflineQueue: true, disableClientInfo: true,
        maintNotifications: 'disabled', commandOptions: { timeout: 1000 },
        socket: { host: '127.0.0.1', port, connectTimeout: 500, reconnectStrategy: false } });
      client.on('error', () => {});
      try { await client.connect(); return client; }
      catch { if (client.isOpen) client.destroy(); await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    throw new Error('Temporary Redis did not become ready');
  }
  async function identity() {
    ownedPort();
    const info = await admin.sendCommand(['INFO', 'server']);
    const run = /(?:^|\n)run_id:([a-f0-9]{40})\r?\n/.exec(info)?.[1]; assert(run);
    const socket = docker(['exec', fixture.id, 'sh', '-c',
      'export REDISCLI_AUTH="$REDIS_TEST_PASSWORD"; exec redis-cli -s /data/redis.sock INFO server']);
    assert(socket.includes('run_id:' + run)); return run;
  }
  async function provision() {
    ownedPort();
    await admin.sendCommand(['ACL', 'SETUSER', 'auth_session_test', 'reset', 'on', '>' + password,
      '~' + namespace + ':*', '+info', '+get', '+set', '+del', '+watch', '+unwatch', '+multi', '+exec', '+time', '+ping']);
  }
  async function connect(config) {
    const connection = createAuthRedisConnection(config); connections.push(connection); await connection.connect(); return connection;
  }
  try {
    const context = JSON.parse(docker(['context', 'inspect', ...(process.platform === 'win32' ? ['desktop-linux'] : [])]))[0];
    assert(/^(unix:|npipe:)/.test(context.Endpoints.docker.Host));
    // Password stays out of argv; redis.conf and log are in the new tmpfs only.
    fixture.id = docker(['create', '--pull', 'never', '--name', fixture.name, '--hostname', fixture.name,
      '--label', 'secure-ecommerce.redis-test=' + runId, '--publish', '127.0.0.1::6379', '--tmpfs', '/data:rw',
      '--env', 'REDIS_TEST_PASSWORD', '--entrypoint', 'sh', 'redis:8.2', '-c', startup], { env: { REDIS_TEST_PASSWORD: rootPassword } });
    ownedPort(true); fixture.imageId = inspect(fixture).Image;
    docker(['start', fixture.id]); admin = await openAdmin(); const run = await identity(); await provision();
    report.status = 'RUNNING';
    const config = { host: '127.0.0.1', port: ownedPort(), tls: false, username: 'auth_session_test', password,
      namespace, generation, expectedRunId: run };
    if (exercise) {
      await exercise({ config, admin, assertOwned: ownedPort });
      report.checks.push('isolated authentication integration callback');
      report.success = true; report.status = 'PASS';
      return report;
    }
    const firstConnection = await connect(config); const sessions = createSessionService(firstConnection);
    const userId = crypto.randomUUID(), credentialVersion = crypto.randomBytes(32).toString('hex');
    const create = () => sessions.create({ userId, credentialVersion });
    const check = s => sessions.check({ userId, sessionId: s.sessionId, credentialVersion });
    let s = await create(); assert.equal((await check(s)).state, 'active');
    assert.equal(s.idleExpiresAt - s.createdAt, 1800000); assert.equal(s.absoluteExpiresAt - s.createdAt, 28800000);
    const next = await sessions.rotate({ refreshToken: s.refreshToken, credentialVersion });
    assert(next.refreshToken !== s.refreshToken); assert.equal(next.absoluteExpiresAt, s.absoluteExpiresAt);
    assert.equal(await outcome(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion })), 'REFRESH_REUSED');
    assert.equal(await outcome(check(s)), 'SESSION_REVOKED'); report.checks.push('create/check/rotation/reuse');
    s = await create();
    assert.equal(await outcome(sessions.rotate({ refreshToken: crypto.randomBytes(32).toString('base64url'), credentialVersion })), 'REFRESH_UNKNOWN');
    assert.equal((await check(s)).state, 'active'); report.checks.push('unknown refresh does not revoke');
    const other = createSessionService(await connect(config));
    const parallel = await Promise.allSettled([sessions, other].map(service => service.rotate({ refreshToken: s.refreshToken, credentialVersion })));
    assert.equal(parallel.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(parallel.filter(result => result.status === 'rejected' && result.reason.code === 'REFRESH_REUSED').length, 1);
    assert.equal(await outcome(check(s)), 'SESSION_REVOKED'); report.checks.push('rotation across two real connections');
    s = await create(); await sessions.revoke({ userId, sessionId: s.sessionId });
    assert.equal(await outcome(check(s)), 'SESSION_REVOKED'); report.checks.push('logout/revocation');
    for (const field of ['idle', 'absolute']) {
      s = await create(); const time = await admin.sendCommand(['TIME']);
      const now = Number(time[0]) * 1000 + Math.floor(Number(time[1]) / 1000);
      // Past deadlines only in the owned fixture; do not change the host clock.
      const key = firstConnection.prefix + 'session:' + s.sessionId;
      const record = JSON.parse(await admin.get(key));
      if (field === 'idle') {
        record.activity = now - 1800001; record.created = record.activity - 1;
        record.absolute = record.created + 28800000; record.idle = now - 1;
      } else {
        record.created = now - 28800001; record.absolute = now - 1;
        record.activity = now - 2; record.idle = record.absolute;
      }
      await admin.set(key, JSON.stringify(record));
      assert.equal(await outcome(check(s)), 'SESSION_EXPIRED');
    }
    report.checks.push('idle and absolute deadline rejection using Redis TIME');
    s = await create();
    const sessionKey = firstConnection.prefix + 'session:' + s.sessionId;
    const refreshKey = firstConnection.prefix + 'refresh:' + crypto.createHash('sha256').update(s.refreshToken).digest('hex');
    const aliveKey = firstConnection.prefix + 'alive:' + s.sessionId;
    const snapshot = { session: await admin.get(sessionKey), refresh: await admin.get(refreshKey), alive: await admin.get(aliveKey) };
    await sessions.revoke({ userId, sessionId: s.sessionId });
    for (const connection of connections) connection.close(); admin.destroy(); admin = null;
    ownedPort(); docker(['restart', fixture.id]); admin = await openAdmin(); const newRun = await identity();
    assert.notEqual(newRun, run); await provision();
    await admin.set(firstConnection.fenceKey, run);
    await admin.set(sessionKey, snapshot.session, { PXAT: s.absoluteExpiresAt });
    await admin.set(refreshKey, snapshot.refresh, { PXAT: s.absoluteExpiresAt });
    await admin.set(aliveKey, snapshot.alive, { PXAT: s.idleExpiresAt });
    assert.equal(await outcome(connect({ ...config, port: ownedPort(), expectedRunId: newRun })), 'SESSION_STORE_UNAVAILABLE');
    const recovered = createSessionService(await connect({ ...config, port: ownedPort(), expectedRunId: newRun, generation: crypto.randomUUID() }));
    assert.equal(await outcome(recovered.check({ userId, sessionId: s.sessionId, credentialVersion })), 'SESSION_NOT_FOUND');
    report.checks.push('restart/stale restore fenced; fresh generation cannot reactivate old sessions');
    report.success = true; report.status = 'PASS';
  } catch {
    if (report.status !== 'NOT_EXECUTED') report.status = 'FAIL';
    throw new Error('Isolated Redis verification did not pass; see the sanitized report.');
  } finally {
    for (const connection of connections) connection.close();
    try { if (admin?.isOpen) admin.destroy(); } catch { /* no diagnostics */ }
    try {
      if (fixture.id) { ownedPort(!inspect(fixture).State.Running); docker(['stop', '--time', '5', fixture.id]); docker(['rm', fixture.id]); }
      report.cleanup = true;
    } catch { report.cleanup = false; report.success = false; report.status = 'CLEANUP_REQUIRED'; }
    fs.writeFileSync(path.join(reportDirectory, runId + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (!report.success) throw new Error('Owned Redis cleanup requires inspection.');
  return report;
}
if (require.main === module) main().then(report => console.log(`PASS: ${report.checks.length} real Redis scenario groups; cleanup=${report.cleanup}`))
  .catch(() => { console.error('Redis integration NOT PASSED. Docker and a cached redis:8.2 image are required; habitual resources were not used.'); process.exitCode = 1; });
module.exports = { main, inspectOwned, withRedisFixture: exercise => main({ exercise }) };
