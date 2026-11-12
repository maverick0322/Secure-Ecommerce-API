const request = require('supertest');
const app = require('../../index');
const { Category, AuditLog } = require('../../models');
const catalog = require('../../services/catalog.service');
const { tokenFor, mockAccountLookups } = require('../support/auth-fixtures');

const admin = tokenFor('ADMIN');
const buyer = tokenFor('BUYER');
const header = account => `Bearer ${account.token}`;

beforeEach(() => { mockAccountLookups(); jest.spyOn(AuditLog, 'create').mockResolvedValue({}); });
afterEach(() => jest.restoreAllMocks());

it('lists active categories for buyers', async () => {
  jest.spyOn(Category, 'findAll').mockResolvedValue([{ id: 1, name: 'Fixture', protected: true }]);
  const result = await request(app).get('/api/categories').set('Authorization', header(buyer));
  expect(result.status).toBe(200);
  expect(result.body).toEqual([{ categoryId: 1, name: 'Fixture', protected: true }]);
  expect(Category.options.paranoid).toBe(true);
});

it('restricts category administration and validates the name', async () => {
  const write = jest.spyOn(catalog, 'mutateCategory').mockResolvedValue({ id: 2, name: 'Fixture', protected: false });
  expect((await request(app).post('/api/categories').set('Authorization', header(buyer)).send({ name: 'Fixture' })).status).toBe(403);
  expect((await request(app).post('/api/categories').set('Authorization', header(admin)).send({ name: '', protected: true })).status).toBe(400);
  expect((await request(app).post('/api/categories').set('Authorization', header(admin)).send({ name: 'Fixture' })).status).toBe(201);
  expect(write).toHaveBeenCalledWith(expect.objectContaining({ id: admin.account.id }), null, 'Fixture',false,{ipAddress:expect.any(String)});
  expect((await request(app).delete('/api/categories/2').set('Authorization', header(admin))).status).toBe(204);
  expect(write).toHaveBeenLastCalledWith(expect.any(Object), 2, undefined, true,{ipAddress:expect.any(String)});
});
