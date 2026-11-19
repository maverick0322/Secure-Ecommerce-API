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

it('preserves UTF-8 input and output without replacing accented characters',async()=>{
  const write=jest.spyOn(catalog,'mutateCategory').mockResolvedValue({id:3,name:'Electrónica',protected:false});
  const result=await request(app).post('/api/categories').set('Authorization',header(admin))
    .set('Content-Type','application/json; charset=utf-8').send(JSON.stringify({name:'Electrónica'}));
  expect(result.status).toBe(201);expect(result.body.name).toBe('Electrónica');
  expect(write).toHaveBeenCalledWith(expect.any(Object),null,'Electrónica',false,expect.any(Object));
  jest.spyOn(Category,'findAll').mockResolvedValue([{id:3,name:'Electrónica',protected:false}]);
  const listed=await request(app).get('/api/categories').set('Authorization',header(buyer));
  expect(listed.body[0].name).toBe('Electrónica');expect(listed.headers['content-type']).toContain('charset=utf-8');
});

it.each(['Niñez y electrónica 🙂','Accesorios e\u0301'])('preserves full Unicode category names without normalization %#',async name=>{
  const write=jest.spyOn(catalog,'mutateCategory').mockResolvedValue({id:3,name,protected:false});
  const result=await request(app).post('/api/categories').set('Authorization',header(admin)).set('Content-Type','application/json; charset=utf-8').send(JSON.stringify({name}));
  expect(result.status).toBe(201);expect(result.body.name).toBe(name);
  expect(write).toHaveBeenCalledWith(expect.any(Object),null,name,false,expect.any(Object));
});

it('handles GET by id, PUT update, DELETE errors and list failures cleanly', async () => {
  jest.spyOn(Category, 'findByPk')
    .mockResolvedValueOnce({ id: 7, name: 'Libros', protected: false })
    .mockResolvedValueOnce(null);
  const found = await request(app).get('/api/categories/7').set('Authorization', header(buyer));
  expect(found.status).toBe(200);
  expect(found.body).toEqual({ categoryId: 7, name: 'Libros', protected: false });

  const missing = await request(app).get('/api/categories/99').set('Authorization', header(buyer));
  expect(missing.status).toBe(404);

  const badId = await request(app).get('/api/categories/abc').set('Authorization', header(buyer));
  expect(badId.status).toBe(400);

  jest.spyOn(Category, 'findAll').mockRejectedValueOnce(new Error('DB failure'));
  const listErr = await request(app).get('/api/categories').set('Authorization', header(buyer));
  expect(listErr.status).toBe(500);

  const mutate = jest.spyOn(catalog, 'mutateCategory')
    .mockResolvedValueOnce({ id: 7, name: 'Libros renovados', protected: false })
    .mockRejectedValueOnce(new Error('Update failure'))
    .mockRejectedValueOnce(new Error('Delete failure'));

  const updated = await request(app).put('/api/categories/7').set('Authorization', header(admin)).send({ name: 'Libros renovados' });
  expect(updated.status).toBe(204);
  expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ id: admin.account.id }), 7, 'Libros renovados');

  const updateErr = await request(app).put('/api/categories/7').set('Authorization', header(admin)).send({ name: 'Otra' });
  expect(updateErr.status).toBe(500);

  const deleteErr = await request(app).delete('/api/categories/7').set('Authorization', header(admin));
  expect(deleteErr.status).toBe(500);
});
