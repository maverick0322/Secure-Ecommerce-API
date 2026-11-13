'use strict';
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { isAccessUuid } = require('../validators/uuid');
const { AuthSessionError, SessionStoreUnavailableError, RedisConfigurationError } = require('./auth-session-errors');
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const validVersion = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reject = () => { throw new AuthSessionError('SESSION_INPUT_INVALID'); };
const fail = code => { throw new AuthSessionError(code); };
const corrupt = () => { throw new SessionStoreUnavailableError(); };
function digest(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, 'base64url').toString('base64url') !== token) reject();
  return createHash('sha256').update(token).digest('hex');
}
function fields(input, allowed, required = allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) reject();
  return input;
}
function parse(value, kind) {
  if (value === null) return null;
  let record;
  try { record = JSON.parse(value); } catch { return corrupt(); }
  if (!record || !isAccessUuid(record.sid) || !isAccessUuid(record.user) ||
    !Number.isSafeInteger(record.generation) || record.generation < 0 || !Number.isSafeInteger(record.absolute)) return corrupt();
  if (kind === 'session' && (!validVersion(record.credential) || !validVersion(record.digest) ||
    !isAccessUuid(record.revision) || !(record.epoch === 'initial' || isAccessUuid(record.epoch)) || !['active', 'revoked'].includes(record.state) ||
    ![record.created, record.activity, record.idle].every(Number.isSafeInteger) ||
    record.created <= 0 || record.absolute !== record.created + ABSOLUTE_MS ||
    record.activity < record.created || record.idle !== Math.min(record.activity + IDLE_MS, record.absolute))) return corrupt();
  return record;
}
function view(s) {
  return Object.freeze({ sessionId: s.sid, userId: s.user, createdAt: s.created, idleExpiresAt: s.idle,
    absoluteExpiresAt: s.absolute, lastActivityAt: s.activity, state: s.state, generation: s.generation });
}
const stored = (key, value, deadline) => ['SET', key, JSON.stringify(value), 'PXAT', String(deadline)];

function createSessionService(connection) {
  if (!connection || typeof connection.transaction !== 'function' || typeof connection.prefix !== 'string' ||
    !/^[a-f0-9]{40}$/.test(connection.expectedRunId || '')) throw new RedisConfigurationError();
  const sessionKey = id => connection.prefix + 'session:' + id;
  const aliveKey = id => connection.prefix + 'alive:' + id;
  const refreshKey = hash => connection.prefix + 'refresh:' + hash;
  const epochKey = id => connection.prefix + 'user-epoch:' + id;
  async function userEpoch(tx, userId) {
    const key = epochKey(userId); await tx.watch([key]);
    const value = await tx.get(key);
    if (value !== null && !isAccessUuid(value)) return corrupt();
    return value || 'initial';
  }
  const index = s => ({ sid: s.sid, user: s.user, generation: s.generation, absolute: s.absolute });
  function matches(i, s) {
    return i && i.sid === s.sid && i.user === s.user && i.generation === s.generation && i.absolute === s.absolute;
  }
  async function revokeRecord(tx, s, reason, errorCode) {
    const revoked = { ...s, state: 'revoked', reason, revision: randomUUID() };
    await tx.commit([stored(sessionKey(s.sid), revoked, s.absolute), ['DEL', aliveKey(s.sid)]]);
    if (errorCode) fail(errorCode);
    return view(revoked);
  }
  async function load(tx, sessionId, userId) {
    await tx.watch([sessionKey(sessionId), aliveKey(sessionId)]);
    const s = parse(await tx.get(sessionKey(sessionId)), 'session');
    if (!s || s.sid !== sessionId || s.user !== userId) { await tx.commit(); fail('SESSION_NOT_FOUND'); }
    return s;
  }
  async function active(tx, s, credentialVersion) {
    const now = await tx.time();
    if (s.state !== 'active') { await tx.commit(); fail('SESSION_REVOKED'); }
    if (s.epoch !== await userEpoch(tx, s.user)) return revokeRecord(tx, s, 'user-revoked', 'SESSION_REVOKED');
    const alive = await tx.get(aliveKey(s.sid));
    if (now >= s.idle || now >= s.absolute || alive === null) return revokeRecord(tx, s, 'expired', 'SESSION_EXPIRED');
    // Different revisions indicate a partial EXEC failure. Deny, never repair it
    // into an active session. A separate expiring watched key prevents revival
    // when the inactivity deadline passes between TIME and EXEC.
    if (alive !== s.revision) return corrupt();
    if (s.credential !== credentialVersion) return revokeRecord(tx, s, 'credentials', 'CREDENTIALS_CHANGED');
    await tx.watch([refreshKey(s.digest)]);
    if (!matches(parse(await tx.get(refreshKey(s.digest)), 'refresh'), s)) return corrupt();
    return now;
  }
  function identity(userId, sessionId, credentialVersion) {
    if (!isAccessUuid(userId) || !isAccessUuid(sessionId) || !validVersion(credentialVersion)) reject();
  }
  async function create(input) {
    const { userId, credentialVersion } = fields(input, ['userId', 'credentialVersion']);
    const sessionId = randomUUID(); identity(userId, sessionId, credentialVersion);
    const refreshToken = randomBytes(32).toString('base64url');
    const hash = digest(refreshToken);
    return connection.transaction(async tx => {
      const keys = [sessionKey(sessionId), aliveKey(sessionId), refreshKey(hash)];
      await tx.watch(keys);
      for (const key of keys) if (await tx.get(key) !== null) { await tx.commit(); fail('SESSION_COLLISION'); }
      const now = await tx.time();
      const epoch = await userEpoch(tx, userId);
      const s = { sid: sessionId, user: userId, credential: credentialVersion, created: now, activity: now,
        idle: now + IDLE_MS, absolute: now + ABSOLUTE_MS, digest: hash, generation: 0,
        revision: randomUUID(), state: 'active', reason: '', epoch };
      await tx.commit([stored(refreshKey(hash), index(s), s.absolute), stored(sessionKey(sessionId), s, s.absolute),
        ['SET', aliveKey(sessionId), s.revision, 'PXAT', String(s.idle)]]);
      return Object.freeze({ ...view(s), refreshToken });
    });
  }
  async function readIndex(tx, hash) {
    await tx.watch([refreshKey(hash)]);
    const i = parse(await tx.get(refreshKey(hash)), 'refresh');
    if (!i) { await tx.commit(); fail('REFRESH_UNKNOWN'); }
    return i;
  }
  async function lookupRefresh(refreshToken) {
    const hash = digest(refreshToken);
    return connection.transaction(async tx => {
      const i = await readIndex(tx, hash); await tx.commit();
      return Object.freeze({ sessionId: i.sid, userId: i.user });
    });
  }
  async function rotate(input) {
    const { refreshToken, credentialVersion } = fields(input, ['refreshToken', 'credentialVersion']);
    const hash = digest(refreshToken); if (!validVersion(credentialVersion)) reject();
    const next = randomBytes(32).toString('base64url'), nextHash = digest(next);
    return connection.transaction(async tx => {
      const i = await readIndex(tx, hash);
      const s = await load(tx, i.sid, i.user);
      const now = await active(tx, s, credentialVersion);
      if (i.absolute !== s.absolute || i.generation > s.generation) return corrupt();
      if (i.generation < s.generation) return revokeRecord(tx, s, 'reuse', 'REFRESH_REUSED');
      if (hash !== s.digest) { await tx.commit(); fail('REFRESH_INVALID'); }
      await tx.watch([refreshKey(nextHash)]);
      if (await tx.get(refreshKey(nextHash)) !== null) { await tx.commit(); fail('SESSION_COLLISION'); }
      const updated = { ...s, digest: nextHash, generation: s.generation + 1, activity: now,
        idle: Math.min(now + IDLE_MS, s.absolute), revision: randomUUID() };
      // Immutable hash indexes retain reuse evidence. Only this session's
      // current digest/generation authorizes a refresh; an orphan index cannot.
      await tx.commit([stored(refreshKey(nextHash), index(updated), s.absolute), stored(sessionKey(s.sid), updated, s.absolute),
        ['SET', aliveKey(s.sid), updated.revision, 'PXAT', String(updated.idle)]]);
      return Object.freeze({ ...view(updated), refreshToken: next });
    });
  }
  async function check(input) {
    const { userId, sessionId, credentialVersion, touch = false } =
      fields(input, ['userId', 'sessionId', 'credentialVersion', 'touch'], ['userId', 'sessionId', 'credentialVersion']);
    identity(userId, sessionId, credentialVersion); if (typeof touch !== 'boolean') reject();
    return connection.transaction(async tx => {
      const s = await load(tx, sessionId, userId), now = await active(tx, s, credentialVersion);
      if (!touch) { await tx.commit(); return view(s); }
      const updated = { ...s, activity: now, idle: Math.min(now + IDLE_MS, s.absolute), revision: randomUUID() };
      await tx.commit([stored(sessionKey(s.sid), updated, s.absolute),
        ['SET', aliveKey(s.sid), updated.revision, 'PXAT', String(updated.idle)]]);
      return view(updated);
    });
  }
  async function revoke(input) {
    const { userId, sessionId } = fields(input, ['userId', 'sessionId']);
    if (!isAccessUuid(userId) || !isAccessUuid(sessionId)) reject();
    return connection.transaction(async tx => revokeRecord(tx, await load(tx, sessionId, userId), 'logout'));
  }
  async function revokeAll(input) {
    const { userId } = fields(input, ['userId']);
    if (!isAccessUuid(userId)) reject();
    return connection.transaction(async tx => {
      await userEpoch(tx, userId);
      // A persistent, single marker per user avoids scans and cannot expire
      // before sessions created later. It never authorizes a session by itself.
      await tx.commit([['SET', epochKey(userId), randomUUID()]]);
    });
  }
  return Object.freeze({ create, check, rotate, revoke, revokeAll, lookupRefresh });
}
module.exports = { createSessionService };
