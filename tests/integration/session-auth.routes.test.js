'use strict';
const request = require('supertest');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../../index');
const { User, Admin, AuditLog, sequelize } = require('../../models');
const runtime = require('../../services/auth-runtime.service');
const { RedisDouble } = require('../support/redis-double');
const { cryptography } = require('../support/isolated-auth');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { createSessionService } = require('../../services/auth-session.service');
let server, connection, services, users, buyer, admin;
const password = crypto.randomBytes(24).toString('base64url');
const cryptoServices = cryptography();
const tx = { LOCK: { UPDATE: 'UPDATE' } };
beforeEach(async () => {
  server = new RedisDouble(); server.now = Date.now();
  connection = createAuthRedisConnection({ host: '127.0.0.1', port: 16379, tls: false, username: 'isolated',
    password: crypto.randomBytes(32).toString('hex'), namespace: 'isolated-http', generation: crypto.randomUUID(),
    expectedRunId: server.runId }, { poolFactory: (o, p) => server.poolFactory(o, p) });
  await connection.connect(); services = { ...cryptoServices, sessions: createSessionService(connection) };
  jest.spyOn(runtime, 'getTokens').mockReturnValue(services.tokens);
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue(services);
  users = new Map();
  async function account(profile) {
    const id = crypto.randomUUID(), user = { id, email: `${id}@example.invalid`, name: 'Isolated session user',
      passwordHash: await bcrypt.hash(password, 4), status: 'ACTIVE', emailVerifiedAt: new Date(), deletedAt: null,
      [profile.toLowerCase()]: { userId: id }, update: jest.fn(async changes => Object.assign(user, changes)) };
    users.set(id, user); return user;
  }
  buyer = await account('BUYER'); admin = await account('ADMIN');
  jest.spyOn(User, 'unscoped').mockReturnValue(User);
  jest.spyOn(User, 'findByPk').mockImplementation(async id => users.get(id) || null);
  jest.spyOn(User, 'findOne').mockImplementation(async options => [...users.values()].find(u => u.email === options.where.email) || null);
  jest.spyOn(Admin, 'findByPk').mockImplementation(async id => users.get(id)?.admin || null);
  jest.spyOn(AuditLog, 'create').mockResolvedValue({});
  jest.spyOn(sequelize, 'transaction').mockImplementation(work => work(tx));
});
afterEach(() => { connection.close(); jest.restoreAllMocks(); });
const login = user => request(app).post('/api/auth').send({ email: user.email, password });
const refresh = token => request(app).post('/api/auth/refresh').send({ refreshToken: token });
const time = token => request(app).get('/api/auth/time').set('Authorization', `Bearer ${token}`);

it('issues five-minute RS256/opaque refresh, rotates and immediately rejects both tokens after logout', async () => {
  const first = await login(buyer); expect(first.status).toBe(200);
  const claims = services.tokens.verify(first.body.jwt);
  expect(jwt.decode(first.body.jwt, { complete: true }).header.alg).toBe('RS256');
  expect(claims.exp - claims.iat).toBe(300); expect(Buffer.from(first.body.refreshToken, 'base64url').length).toBe(32);
  expect(first.headers['cache-control']).toBe('no-store');
  expect(server.serializedData().includes(first.body.refreshToken)).toBe(false);
  const active = await time(first.body.jwt); expect(active.status).toBe(200); expect(active.headers['set-authorization']).toBeUndefined();
  const next = await refresh(first.body.refreshToken); expect(next.status).toBe(200);
  expect(next.body.refreshToken === first.body.refreshToken).toBe(false);
  expect(services.tokens.verify(next.body.jwt).sid).toBe(claims.sid);
  expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${next.body.jwt}`)).status).toBe(204);
  expect((await time(first.body.jwt)).status).toBe(401);
  expect((await refresh(next.body.refreshToken)).status).toBe(401);
});
it('detects reuse and concurrent refresh while preserving an independent session', async () => {
  const first = (await login(buyer)).body, independent = (await login(buyer)).body;
  const result = await Promise.all([refresh(first.refreshToken), refresh(first.refreshToken)]);
  expect(result.map(r => r.status).sort()).toEqual([200, 401]);
  expect((await time(first.jwt)).status).toBe(401);
  expect((await time(independent.jwt)).status).toBe(200);
});
it('revokes all current sessions on password change, and permits a new login', async () => {
  const first = (await login(buyer)).body, second = (await login(buyer)).body, administrator = (await login(admin)).body;
  const nextPassword = crypto.randomBytes(24).toString('base64url');
  expect((await request(app).put(`/api/users/${buyer.email}`).set('Authorization', `Bearer ${administrator.jwt}`)
    .send({ password: nextPassword })).status).toBe(204);
  expect((await time(first.jwt)).status).toBe(401); expect((await refresh(second.refreshToken)).status).toBe(401);
  expect((await login(buyer)).status).toBe(401);
  expect((await request(app).post('/api/auth').send({ email: buyer.email, password: nextPassword })).status).toBe(200);
});
it('fails password mutation closed before SQL writes if Redis revocation is unavailable', async () => {
  const administrator = (await login(admin)).body;
  const revokeAll = jest.fn(async () => { throw new (require('../../services/auth-session-errors').SessionStoreUnavailableError)(); });
  runtime.getRuntime.mockResolvedValue({ ...services, sessions: { ...services.sessions, revokeAll } });
  const response = await request(app).put(`/api/users/${buyer.email}`).set('Authorization', `Bearer ${administrator.jwt}`)
    .send({ password: crypto.randomBytes(24).toString('base64url') });
  expect(response.status).toBe(503); expect(revokeAll).toHaveBeenCalledWith({ userId: buyer.id });
  expect(buyer.update).not.toHaveBeenCalled();
});
it('distinguishes invalid tokens from a Redis outage, without leaking diagnostics', async () => {
  const first = (await login(buyer)).body;
  const legacy = jwt.sign({}, require('../support/signing-secret'), { algorithm: 'HS256', expiresIn: 120 });
  expect((await time(legacy)).status).toBe(401);
  server.online = false;
  expect((await time(first.jwt)).status).toBe(503);
  const failed = await login(buyer); expect(failed.status).toBe(503);
  expect(failed.body).toEqual({ status: 503, message: expect.any(String) });
});
it('rejects extra fields, malformed/unknown refresh, unauthenticated logout and cross-user session JWT', async () => {
  const first = (await login(buyer)).body;
  expect((await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken, userId: admin.id })).status).toBe(400);
  expect((await refresh('bad')).status).toBe(400);
  expect((await refresh(crypto.randomBytes(32).toString('base64url'))).status).toBe(401);
  expect((await request(app).post('/api/auth/logout')).status).toBe(401);
  expect((await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${first.jwt}`).send({ sessionId: 'other' })).status).toBe(400);
  const forged = services.tokens.sign({ sub: admin.id, sid: services.tokens.verify(first.jwt).sid });
  expect((await time(forged)).status).toBe(401);
});
it('checks current state and credentials on refresh; does not cache account permissions', async () => {
  const first = (await login(buyer)).body;
  buyer.status = 'SUSPENDED'; expect((await refresh(first.refreshToken)).status).toBe(401);
  buyer.status = 'ACTIVE'; expect((await time(first.jwt)).status).toBe(401);
  const another = (await login(buyer)).body; buyer.passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 4);
  expect((await time(another.jwt)).status).toBe(401);
});
it('enforces inactivity and absolute expiry without trusting the API process clock', async () => {
  const first = (await login(buyer)).body; server.now += 1800000;
  expect((await refresh(first.refreshToken)).status).toBe(401);
  const second = (await login(buyer)).body; server.now += 28800000;
  expect((await refresh(second.refreshToken)).status).toBe(401);
});

it.each(['active','expired','revoked','offline'])('validates Redis for a forbidden profile without touching activity: %s',async state=>{
  const session=await services.sessions.create({userId:buyer.id,credentialVersion:services.versions.derive(buyer.passwordHash)});
  const token=services.tokens.sign({sub:buyer.id,sid:session.sessionId});
  const key=connection.prefix+'session:'+session.sessionId;
  const before=JSON.parse(server.get(key).value);
  server.now+=1000;
  if(state==='expired')server.now=session.idleExpiresAt;
  if(state==='revoked')await services.sessions.revoke({userId:buyer.id,sessionId:session.sessionId});
  if(state==='offline')server.online=false;
  const response=await request(app).get('/api/users').set('Authorization',`Bearer ${token}`);
  expect(response.status).toBe(state==='active'?403:state==='offline'?503:401);
  const after=JSON.parse(server.get(key).value);
  expect(after.activity).toBe(before.activity);expect(after.idle).toBe(before.idle);
  if(state==='active')expect(after.revision===before.revision).toBe(true);
});
it.each(['PENDING','REJECTED','SUSPENDED'])('does not extend inactivity on seller approval denial: %s',async status=>{
  delete buyer.buyer;buyer.seller={userId:buyer.id,status};
  const session=await services.sessions.create({userId:buyer.id,credentialVersion:services.versions.derive(buyer.passwordHash)});
  const token=services.tokens.sign({sub:buyer.id,sid:session.sessionId});
  const key=connection.prefix+'session:'+session.sessionId,before=server.get(key).value;
  server.now+=1000;
  expect((await request(app).post('/api/products').set('Authorization',`Bearer ${token}`).send({title:'Denied',price:'1.00'})).status).toBe(403);
  expect(server.get(key).value===before).toBe(true);
});
it('still extends activity for an authorized protected request',async()=>{
  const session=await services.sessions.create({userId:buyer.id,credentialVersion:services.versions.derive(buyer.passwordHash)});
  const token=services.tokens.sign({sub:buyer.id,sid:session.sessionId});server.now+=1000;
  expect((await time(token)).status).toBe(200);
  const record=JSON.parse(server.get(connection.prefix+'session:'+session.sessionId).value);
  expect(record.activity).toBe(server.now);expect(record.idle).toBe(server.now+1800000);
});
