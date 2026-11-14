'use strict';
const crypto = require('node:crypto');
const { RedisDouble } = require('../support/redis-double');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { createSessionService } = require('../../services/auth-session.service');
const { createCredentialVersionService, loadCredentialVersionService } = require('../../services/credential-version.service');
const fs = require('node:fs');
const path = require('node:path');
const { isAccessUuid } = require('../../validators/uuid');

let server, connection, sessions, userId, version, config;
const code = async promise => { try { await promise; return 'OK'; } catch (error) { return error.code; } };
beforeEach(async () => {
  server = new RedisDouble(); userId = crypto.randomUUID(); version = crypto.randomBytes(32).toString('hex');
  config = { host: '127.0.0.1', port: 16379, username: 'auth_test', password: crypto.randomBytes(32).toString('hex'),
    tls: false, namespace: 'secure-ecommerce-auth-test', generation: crypto.randomUUID(), expectedRunId: server.runId };
  connection = createAuthRedisConnection(config, { poolFactory: (options, poolOptions) => server.poolFactory(options, poolOptions) });
  await connection.connect(); sessions = createSessionService(connection);
});
afterEach(() => { connection.close(); jest.restoreAllMocks(); });
const create = () => sessions.create({ userId, credentialVersion: version });
const check = (s, extra = {}) => sessions.check({ userId, sessionId: s.sessionId, credentialVersion: version, ...extra });

it.each(['read','touch','rotate'])('retries a torn session/alive read during %s instead of reporting corruption',async operation=>{
  const s=await create(),key=connection.prefix+'alive:'+s.sessionId;
  const client=server.clients[0],send=client.sendCommand;
  let injected=false;
  client.sendCommand=async args=>{
    if(!injected&&args[0]==='GET'&&args[1]===key){
      injected=true;await check(s,{touch:true});
    }
    return send(args);
  };
  const result=operation==='rotate'?sessions.rotate({refreshToken:s.refreshToken,credentialVersion:version}):check(s,{touch:operation==='touch'});
  await expect(result).resolves.toMatchObject({sessionId:s.sessionId,state:'active'});
  expect(injected).toBe(true);expect(server.conflicts).toBe(1);
  expect(await code(check(s))).toBe('OK');
});
it('still rejects stable revision corruption without repairing or extending the session',async()=>{
  const s=await create();
  server.command(['SET',connection.prefix+'alive:'+s.sessionId,crypto.randomUUID(),'PXAT',String(s.idleExpiresAt)]);
  const data=server.serializedData(),writes=server.writes;
  expect(await code(check(s,{touch:true}))).toBe('SESSION_STORE_UNAVAILABLE');
  expect(server.serializedData()).toBe(data);expect(server.writes).toBe(writes);
});
it('does not authorize a torn-read retry past a concurrent revocation',async()=>{
  const s=await create(),client=server.clients[0],send=client.sendCommand;
  let touched=false,revoked=false;
  client.sendCommand=async args=>{
    if(!touched&&args[0]==='GET'&&args[1]===connection.prefix+'alive:'+s.sessionId){
      touched=true;await check(s,{touch:true});
    }
    return send(args);
  };
  server.beforeExec=async(c,commands)=>{
    if(touched&&!revoked&&!commands.some(args=>args[0]==='SET')){
      revoked=true;await sessions.revoke({userId,sessionId:s.sessionId});
    }
  };
  expect(await code(check(s,{touch:true}))).toBe('SESSION_REVOKED');
  expect(touched&&revoked).toBe(true);expect(await code(check(s))).toBe('SESSION_REVOKED');
});
it('fails closed on an uncertain read-only corruption confirmation without writing repairs',async()=>{
  const s=await create();
  server.command(['SET',connection.prefix+'alive:'+s.sessionId,crypto.randomUUID(),'PXAT',String(s.idleExpiresAt)]);
  const writes=server.writes;
  server.beforeExec=()=>{throw new Error('Synthetic connection failure');};
  expect(await code(check(s,{touch:true}))).toBe('SESSION_STORE_UNAVAILABLE');
  expect(server.writes).toBe(writes);expect(await code(check(s))).toBe('SESSION_STORE_UNAVAILABLE');
});

it('creates independent random UUID sessions and stores only refresh digests and credential tags', async () => {
  const first = await create(), second = await create(); const data = server.serializedData();
  expect(isAccessUuid(first.sessionId)).toBe(true); expect(first.sessionId === second.sessionId).toBe(false);
  expect(first.state).toBe('active'); expect(first.idleExpiresAt - server.now).toBe(1800000);
  expect(first.absoluteExpiresAt - server.now).toBe(28800000); expect(first.generation).toBe(0);
  expect(Buffer.from(first.refreshToken, 'base64url').length).toBe(32);
  expect(first.refreshToken === second.refreshToken).toBe(false);
  expect(data.includes(first.refreshToken)).toBe(false); expect(data.includes(second.refreshToken)).toBe(false);
  expect(data.includes(crypto.createHash('sha256').update(first.refreshToken).digest('hex'))).toBe(true);
  expect(Object.keys(first).some(key => /digest|credential/i.test(key))).toBe(false);
  expect((await check(first)).state).toBe('active');
});
it('uses Redis time, including millisecond boundaries, never the process clock', async () => {
  server.now += 321; const original = Date.now;
  Date.now = () => 1;
  try { expect((await create()).createdAt).toBe(server.now); } finally { Date.now = original; }
});
it('expires exactly at 30 idle minutes and never becomes active again', async () => {
  const s = await create(); server.now += 1799999; expect(await code(check(s))).toBe('OK');
  server.now++; expect(await code(check(s))).toBe('SESSION_EXPIRED');
  expect(await code(check(s, { touch: true }))).toBe('SESSION_REVOKED');
  expect(await code(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('SESSION_REVOKED');
});
it('touch extends inactivity but not the absolute deadline; checks do not touch by default', async () => {
  const s = await create(); server.now += 600000;
  expect((await check(s)).idleExpiresAt).toBe(s.idleExpiresAt);
  expect((await check(s, { touch: true })).idleExpiresAt).toBe(server.now + 1800000);
  for (let minute = 0; minute < 46; minute++) {
    server.now += 600000; const current = await check(s, { touch: true });
    expect(current.absoluteExpiresAt).toBe(s.absoluteExpiresAt); expect(current.idleExpiresAt <= s.absoluteExpiresAt).toBe(true);
  }
  server.now = s.absoluteExpiresAt; expect(await code(check(s))).toBe('SESSION_NOT_FOUND');
});
it('rotates once, preserves the absolute deadline and retains the used digest until that deadline', async () => {
  const s = await create(); server.now += 1000;
  const next = await sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version });
  expect(next.sessionId).toBe(s.sessionId); expect(next.generation).toBe(1);
  expect(next.refreshToken === s.refreshToken).toBe(false); expect(next.absoluteExpiresAt).toBe(s.absoluteExpiresAt);
  const oldKey = connection.prefix + 'refresh:' + crypto.createHash('sha256').update(s.refreshToken).digest('hex');
  expect(JSON.parse(server.get(oldKey).value).generation).toBe(0); expect(server.get(oldKey).expiresAt).toBe(s.absoluteExpiresAt);
  expect((await sessions.lookupRefresh(next.refreshToken)).userId).toBe(userId);
});
it('reused refresh revokes the whole family but does not revoke an independent session', async () => {
  const s = await create(), independent = await create();
  const rotated = await sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version });
  expect(await code(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('REFRESH_REUSED');
  expect(await code(check(s))).toBe('SESSION_REVOKED');
  expect(await code(sessions.rotate({ refreshToken: rotated.refreshToken, credentialVersion: version }))).toBe('SESSION_REVOKED');
  expect(await code(check(independent))).toBe('OK');
});
it('unknown and malformed refresh tokens do not revoke unrelated sessions', async () => {
  const s = await create();
  expect(await code(sessions.rotate({ refreshToken: crypto.randomBytes(32).toString('base64url'), credentialVersion: version }))).toBe('REFRESH_UNKNOWN');
  for (const token of [null, '', {}, 'invalid', 'x'.repeat(44)]) {
    expect(await code(sessions.rotate({ refreshToken: token, credentialVersion: version }))).toBe('SESSION_INPUT_INVALID');
  }
  expect(await code(check(s))).toBe('OK');
});
it('concurrent renewals cannot produce two valid successors; reuse revokes the winner too', async () => {
  const s = await create();
  const results = await Promise.allSettled([1, 2].map(() => sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version })));
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
  expect(results.filter(r => r.status === 'rejected' && r.reason.code === 'REFRESH_REUSED').length).toBe(1);
  expect(await code(check(s))).toBe('SESSION_REVOKED');
});
it('revokes idempotently, cannot revive through touch/refresh, and does not authorize a different owner', async () => {
  const s = await create();
  expect(await code(check(s, { userId: crypto.randomUUID() }))).toBe('SESSION_NOT_FOUND');
  expect(await code(check(s))).toBe('OK');
  expect((await sessions.revoke({ userId, sessionId: s.sessionId })).state).toBe('revoked');
  expect((await sessions.revoke({ userId, sessionId: s.sessionId })).state).toBe('revoked');
  expect(await code(check(s, { touch: true }))).toBe('SESSION_REVOKED');
});
it('credential-version mismatch revokes the session without accepting a caller-supplied password hash', async () => {
  const s = await create();
  expect(await code(check(s, { credentialVersion: crypto.randomBytes(32).toString('hex') }))).toBe('CREDENTIALS_CHANGED');
  expect(await code(check(s))).toBe('SESSION_REVOKED');
  expect(await code(sessions.create({ userId, credentialVersion: 'raw-password' }))).toBe('SESSION_INPUT_INVALID');
});
it('a network loss after rotation is uncertain, never retried, and the old token triggers reuse on a fresh connection', async () => {
  const s = await create(); server.dropCommitReply = true;
  let unknown = false;
  try { await sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }); }
  catch (error) { unknown = error.code === 'SESSION_STORE_UNAVAILABLE' && error.outcomeUnknown; }
  expect(unknown).toBe(true); expect(await code(check(s))).toBe('SESSION_STORE_UNAVAILABLE');
  const fresh = createAuthRedisConnection(config, { poolFactory: (options, poolOptions) => server.poolFactory(options, poolOptions) });
  try {
    await fresh.connect(); const recovered = createSessionService(fresh);
    expect(await code(recovered.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('REFRESH_REUSED');
  } finally { fresh.close(); }
});
it('partial EXEC write errors fail closed instead of leaving two active refresh tokens', async () => {
  const s = await create(); server.failWriteAt = server.writes + 3;
  expect(await code(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('SESSION_STORE_UNAVAILABLE');
  expect(JSON.parse(server.get(connection.prefix + 'session:' + s.sessionId).value).generation).toBe(1);
  const fresh = createAuthRedisConnection(config, { poolFactory: (value, poolOptions) => server.poolFactory(value, poolOptions) });
  try {
    await fresh.connect(); expect(await code(createSessionService(fresh).check({ userId, sessionId: s.sessionId, credentialVersion: version }))).toBe('SESSION_STORE_UNAVAILABLE');
  } finally { fresh.close(); }
});
it('fails closed during Redis outages without an in-memory authorization fallback', async () => {
  const s = await create(); server.online = false;
  expect(await code(check(s))).toBe('SESSION_STORE_UNAVAILABLE');
  server.online = true; expect(await code(check(s))).toBe('SESSION_STORE_UNAVAILABLE');
});
it('API reconnection preserves revocation; Redis recovery requires a new generation and cannot resurrect a restored session', async () => {
  const s = await create(); const beforeLogout = structuredClone(server.data);
  await sessions.revoke({ userId, sessionId: s.sessionId });
  const sameServer = createAuthRedisConnection(config, { poolFactory: (options, poolOptions) => server.poolFactory(options, poolOptions) });
  try {
    await sameServer.connect(); expect(await code(createSessionService(sameServer).check({ userId, sessionId: s.sessionId, credentialVersion: version }))).toBe('SESSION_REVOKED');
  } finally { sameServer.close(); }
  server.data = beforeLogout; server.runId = crypto.randomBytes(20).toString('hex');
  expect(await code(check(s))).toBe('SESSION_STORE_UNAVAILABLE');
  const unsafeRecovery = createAuthRedisConnection({ ...config, expectedRunId: server.runId }, { poolFactory: (options, poolOptions) => server.poolFactory(options, poolOptions) });
  expect(await code(unsafeRecovery.connect())).toBe('SESSION_STORE_UNAVAILABLE'); unsafeRecovery.close();
  const recovery = createAuthRedisConnection({ ...config, expectedRunId: server.runId, generation: crypto.randomUUID() }, { poolFactory: (options, poolOptions) => server.poolFactory(options, poolOptions) });
  try {
    await recovery.connect();
    expect(await code(createSessionService(recovery).check({ userId, sessionId: s.sessionId, credentialVersion: version }))).toBe('SESSION_NOT_FOUND');
  } finally { recovery.close(); }
});
it('derives non-plaintext credential versions with a dedicated key, without retaining bcrypt hashes in Redis', () => {
  const secret = crypto.randomBytes(32); const original = Buffer.from(secret);
  const helper = createCredentialVersionService(secret); secret.fill(0);
  const hash = '$2b$12$' + crypto.randomBytes(40).toString('base64').replace(/\+/g, '.').slice(0, 53);
  const derived = helper.derive(hash); const again = createCredentialVersionService(original).derive(hash);
  expect(derived === again).toBe(true); expect(/^[a-f0-9]{64}$/.test(derived)).toBe(true);
  expect(derived.includes(hash)).toBe(false);
  expect(() => helper.derive('plaintext')).toThrow(); expect(() => createCredentialVersionService(Buffer.alloc(31))).toThrow();
});

it('loads the credential-reference key only from an explicit protected absolute file', () => {
  const key = crypto.randomBytes(32); const location = path.resolve(path.parse(process.cwd()).root, 'auth-memory.key');
  require('../support/mock-config-paths')([location]);
  jest.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true, size: key.length });
  jest.spyOn(fs, 'readFileSync').mockReturnValue(key);
  expect(typeof loadCredentialVersionService({ AUTH_CREDENTIAL_VERSION_KEY_PATH: location,
    AUTH_CONFIG_ALLOWED_ROOTS: JSON.stringify([path.dirname(location)]) }).derive).toBe('function');
  expect(() => loadCredentialVersionService({ AUTH_CREDENTIAL_VERSION_KEY_PATH: 'relative' })).toThrow();
  fs.statSync.mockReturnValue({ isFile: () => false, size: key.length });
  expect(() => loadCredentialVersionService({ AUTH_CREDENTIAL_VERSION_KEY_PATH: location })).toThrow();
});
it('rejects invalid service inputs and attempts to override the Redis clock or retention', async () => {
  for (const input of [null, [], {}, { userId: 'wrong', credentialVersion: version },
    { userId, credentialVersion: version, absoluteExpiresAt: 1 }]) {
    expect(await code(sessions.create(input))).toBe('SESSION_INPUT_INVALID');
  }
  const s = await create();
  expect(await code(check(s, { touch: 1 }))).toBe('SESSION_INPUT_INVALID');
  expect(await code(sessions.revoke({ sessionId: 'not-uuid', userId }))).toBe('SESSION_INPUT_INVALID');
  expect(() => createSessionService({})).toThrow();
});

it.each(['read', 'touch', 'rotate'])('cannot revive an expired session when the deadline passes immediately before %s EXEC', async operation => {
  const s = await create(); server.now = s.idleExpiresAt - 1;
  let advanced = false;
  server.beforeExec = () => { if (!advanced) { advanced = true; server.now = s.idleExpiresAt; } };
  const promise = operation === 'rotate' ? sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }) :
    check(s, { touch: operation === 'touch' });
  expect(await code(promise)).toBe('SESSION_EXPIRED');
  expect(server.conflicts).toBe(1);
  expect(await code(check(s))).toBe('SESSION_REVOKED');
});
it.each([1, 2, 3])('denies all authorization after rotation command %i fails inside EXEC', async offset => {
  const s = await create(); server.failWriteAt = server.writes + offset;
  expect(await code(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('SESSION_STORE_UNAVAILABLE');
  const fresh = createAuthRedisConnection(config, { poolFactory: (o, p) => server.poolFactory(o, p) });
  try {
    await fresh.connect(); const service = createSessionService(fresh);
    expect(await code(service.check({ userId, sessionId: s.sessionId, credentialVersion: version }))).not.toBe('OK');
    expect(await code(service.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).not.toBe('OK');
  } finally { fresh.close(); }
});
it.each([1, 2])('cannot undo revocation after logout command %i fails inside EXEC', async offset => {
  const s = await create(); server.failWriteAt = server.writes + offset;
  expect(await code(sessions.revoke({ userId, sessionId: s.sessionId }))).toBe('SESSION_STORE_UNAVAILABLE');
  const fresh = createAuthRedisConnection(config, { poolFactory: (o, p) => server.poolFactory(o, p) });
  try {
    await fresh.connect(); const service = createSessionService(fresh);
    expect(await code(service.check({ userId, sessionId: s.sessionId, credentialVersion: version, touch: true }))).not.toBe('OK');
  } finally { fresh.close(); }
});
it.each(['read', 'touch', 'rotate'])('serializes %s against a committed logout on another leased connection', async operation => {
  const s = await create(); let injected = false;
  server.beforeExec = async () => {
    if (!injected) { injected = true; await sessions.revoke({ userId, sessionId: s.sessionId }); }
  };
  const promise = operation === 'rotate' ? sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }) :
    check(s, { touch: operation === 'touch' });
  expect(await code(promise)).toBe('SESSION_REVOKED'); expect(server.conflicts).toBe(1);
  expect(server.clients.length).toBe(2);
  expect(server.clients.every(client => !client.leased && client.watched.size === 0)).toBe(true);
  expect(await code(check(s))).toBe('SESSION_REVOKED');
});
it('allows a confirmed aborted rotation to retry, preserving only one current digest', async () => {
  const s = await create(); server.forcedConflicts = 2;
  const next = await sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version });
  expect(server.conflicts).toBe(2); expect(next.generation).toBe(1);
  expect(await code(check(s))).toBe('OK');
  expect(await code(sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }))).toBe('REFRESH_REUSED');
});
it('uses exclusive leases with four clients under contention and bounds retry exhaustion', async () => {
  const s = await create(); let waiting = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  server.beforeExec = async () => {
    waiting++; if (waiting === 4) release();
    if (waiting <= 4) await barrier;
  };
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => check(s, { touch: true })));
  expect(server.clients.length).toBe(4);
  expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThan(0);
  expect(results.every(r => r.status === 'fulfilled' || r.reason.code === 'SESSION_CONFLICT')).toBe(true);
  expect(server.clients.every(client => !client.leased && client.watched.size === 0)).toBe(true);
  expect(await code(check(s))).toBe('OK');
});

it('revokes every existing session of one user while permitting a new login and preserving other users', async () => {
  const first = await create(), second = await create(), otherUser = crypto.randomUUID();
  const other = await sessions.create({ userId: otherUser, credentialVersion: version });
  await sessions.revokeAll({ userId });
  expect(await code(check(first))).toBe('SESSION_REVOKED');
  expect(await code(sessions.rotate({ refreshToken: second.refreshToken, credentialVersion: version }))).toBe('SESSION_REVOKED');
  expect(await code(sessions.check({ userId: otherUser, sessionId: other.sessionId, credentialVersion: version }))).toBe('OK');
  expect(await code(check(await create()))).toBe('OK');
});
it.each(['read', 'touch', 'rotate'])('cannot race %s past a committed all-session revocation', async operation => {
  const s = await create(); let injected = false;
  server.beforeExec = async () => { if (!injected) { injected = true; await sessions.revokeAll({ userId }); } };
  const result = operation === 'rotate' ? sessions.rotate({ refreshToken: s.refreshToken, credentialVersion: version }) : check(s, { touch: operation === 'touch' });
  expect(await code(result)).toBe('SESSION_REVOKED'); expect(server.conflicts).toBe(1);
});
