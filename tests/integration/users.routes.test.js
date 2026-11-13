const request = require('supertest');
const app = require('../../index');
const { User, Admin, AuditLog, sequelize } = require('../../models');
const accounts = require('../../services/accounts.service');
const { generateToken, mockAccountLookups, makeAccount } = require('../support/auth-fixtures');

const admin = generateToken('admin@example.invalid', 'Synthetic admin', 'Administrador');
const buyer = generateToken('buyer@example.invalid', 'Synthetic buyer', 'Usuario');
const tx={LOCK:{UPDATE:'UPDATE'}};

beforeEach(() => {
  mockAccountLookups();
  jest.spyOn(AuditLog, 'create').mockResolvedValue({});
  jest.spyOn(sequelize,'transaction').mockImplementation(work=>work(tx));
  jest.spyOn(Admin,'findByPk').mockImplementation(async id=>id===require('../../services/jwttoken.service').verifyToken(admin).sub ? {} : null);
});
afterEach(() => jest.restoreAllMocks());

it('allows administrators to list and read accounts without exposing stored hashes', async () => {
  const account = makeAccount('BUYER', { passwordHash: 'synthetic-hash' });
  jest.spyOn(User, 'findAll').mockResolvedValue([account]);
  jest.spyOn(User, 'findOne').mockResolvedValue(account);
  expect((await request(app).get('/api/users').set('Authorization', `Bearer ${buyer}`)).status).toBe(403);
  const result = await request(app).get('/api/users').set('Authorization', `Bearer ${admin}`);
  expect(result.body).toEqual([{ id: account.id, email: account.email, name: account.name, status: 'ACTIVE', profile: 'BUYER' }]);
  const individual = await request(app).get(`/api/users/${account.email}`).set('Authorization', `Bearer ${admin}`);
  expect(individual.body).toEqual(result.body[0]);
});

it('rejects profile changes and closes accounts through the paranoid model', async () => {
  const account = makeAccount('BUYER', { update: jest.fn(), destroy: jest.fn() });
  jest.spyOn(User, 'findOne').mockResolvedValue(account);
  const path = `/api/users/${account.email}`;
  expect((await request(app).put(path).set('Authorization', `Bearer ${admin}`).send({ profile: 'ADMIN' })).status).toBe(400);
  expect(account.update).not.toHaveBeenCalled();
  expect((await request(app).put(path).set('Authorization', `Bearer ${admin}`).send({ status: 'SUSPENDED' })).status).toBe(204);
  expect(account.update).toHaveBeenCalledWith({ status: 'SUSPENDED' },{transaction:tx});
  expect((await request(app).delete(path).set('Authorization', `Bearer ${admin}`)).status).toBe(204);
  expect(account.destroy).toHaveBeenCalledTimes(1);
  expect(User.options.paranoid).toBe(true);
  expect((await request(app).post('/api/users').set('Authorization', `Bearer ${admin}`).send({ profile: 'ADMIN' })).status).toBe(404);
});

it('suspends only through an ADMIN endpoint with a reason and no mass assignment',async()=>{
  const seller=makeAccount('SELLER');
  const suspend=jest.spyOn(accounts,'suspendSeller').mockResolvedValue({userId:seller.id,status:'SUSPENDED'});
  const path=`/api/users/sellers/${seller.id}/suspend`;
  expect((await request(app).put(path).send({reason:'Policy violation'})).status).toBe(401);
  expect((await request(app).put(path).set('Authorization',`Bearer ${buyer}`).send({reason:'Policy violation'})).status).toBe(403);
  for(const body of [{},[],{reason:'Policy violation',status:'APPROVED'}]){
    expect((await request(app).put(path).set('Authorization',`Bearer ${admin}`).send(body)).status).toBe(400);
  }
  expect(suspend).not.toHaveBeenCalled();
  expect((await request(app).put(path).set('Authorization',`Bearer ${admin}`).send({reason:'Policy violation'})).status).toBe(200);
  expect(suspend).toHaveBeenCalledWith(expect.any(String),seller.id,'Policy violation',{ipAddress:expect.any(String)});
});

it('restricts seller review to ADMIN and requires a reason when rejecting', async () => {
  const seller = makeAccount('SELLER');
  const review = jest.spyOn(accounts, 'reviewSeller').mockResolvedValue({ userId: seller.id, status: 'REJECTED' });
  const path = `/api/users/sellers/${seller.id}/review`;
  expect((await request(app).put(path).set('Authorization', `Bearer ${buyer}`).send({ status: 'APPROVED' })).status).toBe(403);
  expect((await request(app).put(path).set('Authorization', `Bearer ${admin}`).send({ status: 'REJECTED' })).status).toBe(400);
  expect((await request(app).put(path).set('Authorization', `Bearer ${admin}`).send({ status: 'REJECTED', rejectionReason: '  Datos incompletos  ' })).status).toBe(200);
  expect(review).toHaveBeenCalledTimes(1);
  expect(review).toHaveBeenCalledWith(expect.any(String), seller.id, 'REJECTED', 'Datos incompletos', expect.any(String));
});

it.each(['SUSPENDED','DISABLED'])('revokes all sessions before changing account state to %s',async status=>{
  const {sessions}=require('../support/auth-fixtures');sessions.revokeAll.mockClear();
  const account=makeAccount('BUYER',{update:jest.fn()});
  jest.spyOn(User,'findOne').mockResolvedValue(account);
  expect((await request(app).put(`/api/users/${account.email}`).set('Authorization',`Bearer ${admin}`).send({status})).status).toBe(204);
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:account.id});
  expect(sessions.revokeAll.mock.invocationCallOrder.at(-1)).toBeLessThan(account.update.mock.invocationCallOrder[0]);
});
it('revokes on reactivation and before soft deletion, but not on a name-only update',async()=>{
  const {sessions}=require('../support/auth-fixtures');sessions.revokeAll.mockClear();
  const account=makeAccount('BUYER',{status:'SUSPENDED',update:jest.fn(),destroy:jest.fn()});
  jest.spyOn(User,'findOne').mockResolvedValue(account);
  const path=`/api/users/${account.email}`;
  expect((await request(app).put(path).set('Authorization',`Bearer ${admin}`).send({status:'ACTIVE'})).status).toBe(204);
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:account.id});
  sessions.revokeAll.mockClear();
  expect((await request(app).put(path).set('Authorization',`Bearer ${admin}`).send({name:'Renamed buyer'})).status).toBe(204);
  expect(sessions.revokeAll).not.toHaveBeenCalled();
  expect((await request(app).delete(path).set('Authorization',`Bearer ${admin}`)).status).toBe(204);
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:account.id});
  expect(sessions.revokeAll.mock.invocationCallOrder.at(-1)).toBeLessThan(account.destroy.mock.invocationCallOrder[0]);
});
it.each(['SUSPENDED','DISABLED','ACTIVE','delete'])('does not mutate SQL when all-session revocation fails for %s',async operation=>{
  const {sessions}=require('../support/auth-fixtures');
  const account=makeAccount('BUYER',{status:'SUSPENDED',update:jest.fn(),destroy:jest.fn()});
  jest.spyOn(User,'findOne').mockResolvedValue(account);
  sessions.revokeAll.mockRejectedValueOnce(new (require('../../services/auth-session-errors').SessionStoreUnavailableError)());
  const path=`/api/users/${account.email}`;
  const response=operation==='delete'?await request(app).delete(path).set('Authorization',`Bearer ${admin}`):
    await request(app).put(path).set('Authorization',`Bearer ${admin}`).send({status:operation});
  expect(response.status).toBe(503);expect(account.update).not.toHaveBeenCalled();expect(account.destroy).not.toHaveBeenCalled();
});
