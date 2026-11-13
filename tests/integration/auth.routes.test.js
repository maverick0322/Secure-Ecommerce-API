const request = require('supertest');
const bcrypt = require('bcrypt');
const app = require('../../index');
const { User, AuditLog } = require('../../models');
const accounts = require('../../services/accounts.service');
const mailer = require('../../services/registration-email.service');
const { verifyToken } = require('../../services/jwttoken.service');
const { makeAccount } = require('../support/auth-fixtures');

const secret = 'synthetic-password-123';
let hash;

beforeAll(async () => { hash = await bcrypt.hash(secret, 4); });
beforeEach(() => jest.spyOn(AuditLog, 'create').mockResolvedValue({}));
afterEach(() => jest.restoreAllMocks());

it('validates login and returns a current profile and JWT without the hash', async () => {
  const account = makeAccount('BUYER', { passwordHash: hash });
  const findOne = jest.fn().mockResolvedValue(account);
  jest.spyOn(User, 'unscoped').mockReturnValue({ findOne, findByPk: async () => account });
  expect((await request(app).post('/api/auth').send({ email: account.email })).status).toBe(400);
  expect((await request(app).post('/api/auth').send({ email: account.email, password: 'bad' })).status).toBe(401);
  const response = await request(app).post('/api/auth').send({ email: ` ${account.email.toUpperCase()} `, password: secret });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ id: account.id, email: account.email, name: account.name, status: 'ACTIVE', profile: 'BUYER', jwt: expect.any(String), refreshToken: expect.any(String), expiresIn: 300, tokenType: 'Bearer' });
  expect(verifyToken(response.body.jwt).sub).toBe(account.id);
  expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { email: account.email } }));
  jest.spyOn(User, 'findByPk').mockResolvedValue(account);
  const time = await request(app).get('/api/auth/time').set('Authorization', `Bearer ${response.body.jwt}`);
  expect(time.body.remainingTime).toMatch(/^00:0[45]:[0-5]\d$/);
});

it('rejects absent, suspended, unverified and ambiguous accounts with the same login error', async () => {
  const findOne = jest.fn();
  jest.spyOn(User, 'unscoped').mockReturnValue({ findOne });
  const credentials = { email: 'login@example.invalid', password: secret };
  for (const row of [null, makeAccount('BUYER', { status: 'SUSPENDED', passwordHash: hash }),
    makeAccount('BUYER', { emailVerifiedAt: null, passwordHash: hash }),
    makeAccount('BUYER', { admin: {}, passwordHash: hash })]) {
    findOne.mockResolvedValue(row);
    const response = await request(app).post('/api/auth').send(credentials);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ status: 401, message: 'Usuario o contraseña incorrectos.' });
  }
});

it('returns a generic error for a database failure', async () => {
  jest.spyOn(User, 'unscoped').mockReturnValue({ findOne: jest.fn().mockRejectedValue(new Error('sensitive database details')) });
  const response = await request(app).post('/api/auth').send({ email: 'login@example.invalid', password: secret });
  expect(response.status).toBe(500);
  expect(response.text).not.toContain('sensitive');
});

it('sends the code privately and creates only once, after validation', async () => {
  const email = 'register@example.invalid';
  const send = jest.spyOn(mailer, 'sendVerificationCode').mockResolvedValue();
  const create = jest.spyOn(accounts, 'createPublicAccount').mockResolvedValue({ email, profile: 'SELLER', sellerStatus: 'PENDING' });
  const issued = await request(app).post('/api/auth/register').send({ email });
  expect(issued.status).toBe(202);
  expect(issued.body).toEqual({ message: expect.any(String) });
  expect(create).not.toHaveBeenCalled();
  const code = send.mock.calls[0][1];
  const payload = { email, code, password: secret, name: 'Synthetic seller', profile: 'SELLER', storeName: 'Synthetic shop' };
  expect((await request(app).post('/api/auth/register/verify').send({ ...payload, profile: 'ADMIN' })).status).toBe(400);
  const results = await Promise.all([1, 2].map(() => request(app).post('/api/auth/register/verify').send(payload)));
  expect(results.map(result => result.status).sort()).toEqual([201, 400]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ email, profile: 'SELLER' }),{ipAddress:expect.any(String)});
});
