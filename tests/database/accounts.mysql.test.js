const request = require('supertest');
const express = require('express');
const mysql = require('mysql2/promise');

const isolated = process.env.STAGE3A_MYSQL_UUID ? describe : describe.skip;
const password = 'synthetic-stage3a-password';
const adminEmail = 'admin@example.invalid';
const adminId = '00000000-0000-4000-8000-000000000003';

isolated('Stage 3A isolated MySQL account workflows', () => {
  let db;
  let isolatedAuth;
  let app;
  let models;
  let accounts;
  let mailer;
  let commerce;

  beforeAll(async () => {
    expect(process.env.STAGE3A_TEST_PASSWORD).toBeTruthy();
    const config = { host: '127.0.0.1', port: Number(process.env.STAGE3A_TEST_PORT || 13307), database: 'secure_ecommerce_3a_test', user: 'ecommerce_app',
      password: process.env.STAGE3A_TEST_PASSWORD };
    db = await mysql.createConnection(config);
    const [[identity]] = await db.query('SELECT @@server_uuid AS uuid, @@hostname AS host, @@port AS port, DATABASE() AS db, CURRENT_USER() AS account');
    expect(identity).toEqual({ uuid: process.env.STAGE3A_MYSQL_UUID, host: process.env.STAGE3A_TEST_HOSTNAME || 'secure-ecommerce-stage3a', port: 3306,
      db: config.database, account: 'ecommerce_app@%' });
    Object.assign(process.env, { TEST_DB_HOST: config.host, TEST_DB_PORT: String(config.port), TEST_DB_DATABASE: config.database,
      TEST_DB_USER: config.user, TEST_DB_PASSWORD: config.password,
      JWT_SECRET: require('../support/signing-secret') });
    app = require('../../index');
    models = require('../../models');
    accounts = require('../../services/accounts.service');
    isolatedAuth = await require('../support/isolated-auth').start();
    mailer = require('../../services/registration-email.service');
    commerce = express().get('/commerce', require('../../middlewares/auth.middleware')('SELLER'), (req, res) => res.status(204).end());
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (isolatedAuth) await isolatedAuth.close();
    if (models) await models.sequelize.close();
    if (db) await db.end();
  });

  const token = jwt => `Bearer ${jwt}`;
  const login = email => request(app).post('/api/auth').send({ email, password });
  const reviewPath = userId => `/api/users/sellers/${userId}/review`;

  async function issue(email) {
    const send = jest.spyOn(mailer, 'sendVerificationCode').mockResolvedValue();
    expect((await request(app).post('/api/auth/register').send({ email })).status).toBe(202);
    const code = send.mock.calls.at(-1)[1];
    expect(code).toMatch(/^\d{6}$/);
    return code;
  }

  function verify(email, code, profile = 'BUYER') {
    return request(app).post('/api/auth/register/verify').send({ email, code, password, name: 'Synthetic account', profile, storeName: 'Synthetic shop' });
  }

  it('creates one verified exclusive profile under concurrent verification without a role column', async () => {
    const email = 'concurrent@example.invalid';
    const code = await issue(email);
    expect(await models.User.count({ where: { email } })).toBe(0);
    expect((await verify(email, code, 'ADMIN')).status).toBe(400);
    const results = await Promise.all([verify(email.toUpperCase(), code), verify(email, code, 'SELLER')]);
    expect(results.map(result => result.status).sort()).toEqual([201, 400]);
    const row = await accounts.findAccountByEmail(email);
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(accounts.accountType(row)).toBe(results.find(result => result.status === 201).body.profile);
    expect(row.passwordHash).toBeUndefined();
    expect(await models.User.count({ where: { email } })).toBe(1);
    const [columns] = await db.query('SHOW COLUMNS FROM users');
    expect(columns.map(column=>column.Field)).not.toContain('roleId');
  });

  it('uses the database unique key to protect concurrent account creation across requests', async () => {
    const data = { email: 'unique@example.invalid', name: 'Fixture', password, storeName: 'Fixture shop' };
    const results = await Promise.allSettled(['BUYER', 'SELLER'].map(profile => accounts.createPublicAccount({ ...data, profile })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason).toMatchObject({ status: 409 });
    expect(await models.User.count({ where: { email: data.email } })).toBe(1);
    expect(accounts.accountType(await accounts.findAccountByEmail(data.email))).toBeTruthy();
  });

  it('rolls back the SQL user insert if profile creation fails and allows retrying the code', async () => {
    const email = 'rollback@example.invalid';
    const code = await issue(email);
    jest.spyOn(models.Buyer, 'create').mockRejectedValueOnce(new Error('synthetic profile failure'));
    expect((await verify(email, code)).status).toBe(500);
    expect(await models.User.count({ where: { email } })).toBe(0);
    expect((await verify(email, code)).status).toBe(201);
    expect(accounts.accountType(await accounts.findAccountByEmail(email))).toBe('BUYER');
  });

  it('rechecks suspension and verification before reusing a JWT', async () => {
    const email = 'status@example.invalid';
    const result = await verify(email, await issue(email));
    expect(result.status).toBe(201);
    const session = await login(email);
    expect(session.status).toBe(200);
    const endpoint = () => request(app).get('/api/auth/time').set('Authorization', token(session.body.jwt));
    expect((await endpoint()).status).toBe(200);
    const admin = await login(adminEmail);
    expect(admin.body.profile).toBe('ADMIN');
    expect((await request(app).put(`/api/users/${email}`).set('Authorization', token(admin.body.jwt)).send({ status: 'SUSPENDED' })).status).toBe(204);
    expect((await endpoint()).status).toBe(403);
    expect((await login(email)).status).toBe(401);
    await expect(db.query('UPDATE users SET emailVerifiedAt = NULL WHERE id = ?', [result.body.id])).rejects.toThrow();
    await db.query('UPDATE users SET status = ? WHERE id = ?', ['DISABLED', result.body.id]);
    expect((await endpoint()).status).toBe(403);
    expect((await login(email)).status).toBe(401);
  });

  it('serializes seller reviews, audits the decision and gates commerce on current approval', async () => {
    const email = 'seller@example.invalid';
    const seller = await verify(email, await issue(email), 'SELLER');
    expect(seller.status).toBe(201);
    expect(seller.body.sellerStatus).toBe('PENDING');
    const session = await login(email);
    const commercial = () => request(commerce).get('/commerce').set('Authorization', token(session.body.jwt));
    expect((await commercial()).status).toBe(403);
    const admin = await login(adminEmail);
    const path = reviewPath(seller.body.id);
    expect((await request(app).put(path).set('Authorization', token(session.body.jwt)).send({ status: 'APPROVED' })).status).toBe(403);
    expect((await request(app).put(path).set('Authorization', token(admin.body.jwt)).send({ status: 'REJECTED' })).status).toBe(400);
    const review = () => request(app).put(path).set('Authorization', token(admin.body.jwt)).send({ status: 'APPROVED' });
    expect((await Promise.all([review(), review()])).map(result => result.status).sort()).toEqual([200, 409]);
    expect((await commercial()).status).toBe(204);
    const [events] = await db.query('SELECT actorUserId, action, outcome FROM audit_logs WHERE targetId = ? AND action = ?', [seller.body.id, 'seller.approved']);
    expect(events).toEqual([{ actorUserId: adminId, action: 'seller.approved', outcome: 'SUCCESS' }]);
  });

  it('stores the rejection reason and denies commerce to a rejected seller', async () => {
    const email = 'rejected@example.invalid';
    const seller = await verify(email, await issue(email), 'SELLER');
    const admin = await login(adminEmail);
    const reviewed = await request(app).put(reviewPath(seller.body.id)).set('Authorization', token(admin.body.jwt))
      .send({ status: 'REJECTED', rejectionReason: 'Fixture incompleto' });
    expect(reviewed.status).toBe(200);
    expect((await models.Seller.findByPk(seller.body.id)).rejectionReason).toBe('Fixture incompleto');
    const session = await login(email);
    expect((await request(commerce).get('/commerce').set('Authorization', token(session.body.jwt))).status).toBe(403);
  });
  it('reads only public audit columns for ADMIN and retains immutable SQL permissions',async()=>{
    const admin=await login(adminEmail);
    const response=await request(app).get('/api/audit-logs?limit=2').set('Authorization',token(admin.body.jwt));
    expect(response.status).toBe(200);expect(response.body.length).toBeLessThanOrEqual(2);
    for(const event of response.body){expect(event).toHaveProperty('actorUserId');expect(event).not.toHaveProperty('details');expect(event).not.toHaveProperty('passwordHash');}
    await expect(db.query('SELECT details FROM audit_logs LIMIT 1')).rejects.toThrow();
    await expect(db.query("UPDATE audit_logs SET outcome='ERROR' WHERE id=1")).rejects.toThrow();
    await expect(db.query('DELETE FROM audit_logs WHERE id=1')).rejects.toThrow();
  });
});
