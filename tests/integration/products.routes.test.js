const request = require('supertest');
const app = require('../../index');
const { AuditLog } = require('../../models');
const catalog = require('../../services/catalog.service');
const images = require('../../services/product-images.service');
const cloud = require('../../services/cloudinary.service');
const { tokenFor, mockAccountLookups } = require('../support/auth-fixtures');

const seller = tokenFor('SELLER', { seller: { status: 'APPROVED' } });
const buyer = tokenFor('BUYER');
const admin = tokenFor('ADMIN');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPUaLrDwMDAxAAGABG+AYoOO5YVAAAAAElFTkSuQmCC', 'base64');
const header = fixture => `Bearer ${fixture.token}`;
const sample = { id: 1, sellerId: seller.account.id, title: 'Fixture', description: 'Descripción válida', price: '12.50', stock: 2, imagePublicId: null };

beforeEach(() => {
  mockAccountLookups();
  jest.spyOn(AuditLog, 'create').mockResolvedValue({});
});
afterEach(() => jest.restoreAllMocks());

it('allows an approved seller to create and derives sellerId on the server', async () => {
  const create = jest.spyOn(catalog, 'createProduct').mockResolvedValue(sample);
  const result = await request(app).post('/api/products').set('Authorization', header(seller)).send({ title: 'Fixture', description: 'Descripción válida', price: '12.5', stock: 2 });
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ productId: 1, sellerId: seller.account.id, description: 'Descripción válida', price: '12.50', imagePublicId: null });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: seller.account.id }), { title: 'Fixture', description: 'Descripción válida', price: '12.50', stock: 2 },{ipAddress:expect.any(String)});
});

it('requires non-empty description when creating and editing products', async () => {
  const create = jest.spyOn(catalog, 'createProduct');
  const update = jest.spyOn(catalog, 'updateProduct');
  for (const body of [
    { title: 'Fixture', price: '10.00' },
    { title: 'Fixture', description: null, price: '10.00' },
    { title: 'Fixture', description: '   ', price: '10.00' }
  ]) {
    const res = await request(app).post('/api/products').set('Authorization', header(seller)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/descripción/i);
  }
  for (const body of [{ description: null }, { description: '' }, { description: '   ' }]) {
    const res = await request(app).put('/api/products/1').set('Authorization', header(seller)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/descripción/i);
  }
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

it.each(['PENDING', 'REJECTED', 'SUSPENDED'])('rejects a %s seller before reaching the catalog', async status => {
  const pending = tokenFor('SELLER', { seller: { status } });
  const create = jest.spyOn(catalog, 'createProduct');
  expect((await request(app).post('/api/products').set('Authorization', header(pending)).send({ title: 'Fixture', price: 1 })).status).toBe(403);
  expect(create).not.toHaveBeenCalled();
});

it.each([buyer, admin, tokenFor('SELLER', { status: 'SUSPENDED', seller: { status: 'APPROVED' } })])('rejects a non-commercial account', async account => {
  expect((await request(app).post('/api/products').set('Authorization', header(account)).send({ title: 'Fixture', price: 1 })).status).toBe(403);
});

it.each([
  { price: -1 }, { price: '1.234' }, { price: true }, { price: '1e3' }, { stock: -1 }, { stock: 1.5 },
  { stock: '1' }, { sellerId: buyer.account.id }, { fileId: 1 }, { imagePublicId: 'client-image' }, { deletedAt: null }
])('rejects invalid or administrative input %j', async extra => {
  const create = jest.spyOn(catalog, 'createProduct');
  expect((await request(app).post('/api/products').set('Authorization', header(seller)).send({ title: 'Fixture', price: '1.00', ...extra })).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

it('permits buyers to query the active catalog and sanitizes failures', async () => {
  jest.spyOn(catalog, 'listProducts').mockResolvedValue([sample]);
  const result = await request(app).get('/api/products?s=Fixture').set('Authorization', header(buyer));
  expect(result.status).toBe(200);
  expect(result.body[0]).not.toHaveProperty('fileId');
  jest.spyOn(catalog, 'getProduct').mockRejectedValue(new Error('secret SQL diagnostics'));
  const failed = await request(app).get('/api/products/1').set('Authorization', header(buyer));
  expect(failed.status).toBe(500);
  expect(failed.text).not.toContain('secret');
});

it('validates category assignment and uses logical product mutations', async () => {
  const change = jest.spyOn(catalog, 'changeCategory').mockResolvedValue();
  expect((await request(app).post('/api/products/1/categories').set('Authorization', header(seller)).send({ categoryId: 2 })).status).toBe(204);
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ id: seller.account.id }), 1, 2, false,{ipAddress:expect.any(String)});
  expect((await request(app).delete('/api/products/1/categories/2').set('Authorization', header(seller))).status).toBe(204);
  expect(change).toHaveBeenLastCalledWith(expect.any(Object), 1, 2, true,{ipAddress:expect.any(String)});
  expect((await request(app).post('/api/products/1/categories').set('Authorization', header(seller)).send({ categoryId: 'bad' })).status).toBe(400);
  const remove = jest.spyOn(catalog,'removeProduct').mockResolvedValue();
  expect((await request(app).delete('/api/products/1').set('Authorization', header(seller))).status).toBe(204);
  expect(remove).toHaveBeenCalledWith(expect.objectContaining({id:seller.account.id}),1,{ipAddress:expect.any(String)});
});

it('rejects assigning a nonexistent category or assigning to another seller product with 404 without creating categories', async () => {
  const { Category } = require('../../models');
  const createCategory = jest.spyOn(Category, 'create');
  const change = jest.spyOn(catalog, 'changeCategory')
    .mockRejectedValueOnce(new (require('../../services/accounts.service').AccountError)(404, 'Categoría no encontrada.'))
    .mockRejectedValueOnce(new (require('../../services/accounts.service').AccountError)(404, 'Producto no encontrado.'));
  expect((await request(app).post('/api/products/1/categories').set('Authorization', header(seller)).send({ categoryId: 9999 })).status).toBe(404);
  expect((await request(app).post('/api/products/999/categories').set('Authorization', header(seller)).send({ categoryId: 2 })).status).toBe(404);
  expect(change).toHaveBeenCalledTimes(2);
  expect(createCategory).not.toHaveBeenCalled();
});

it('accepts a category only during creation and serializes its Unicode name',async()=>{
  const create=jest.spyOn(catalog,'createProduct').mockResolvedValue({...sample,categories:[{id:5,name:'Electrónica',protected:false}]});
  const result=await request(app).post('/api/products').set('Authorization',header(seller)).send({title:'Teclado mecánico',description:'Teclado RGB mecánico',price:'249.99',stock:15,categoryId:5});
  expect(result.status).toBe(201);expect(result.body.categories).toEqual([{categoryId:5,name:'Electrónica',protected:false}]);
  expect(create).toHaveBeenCalledWith(expect.any(Object),{title:'Teclado mecánico',description:'Teclado RGB mecánico',price:'249.99',stock:15,categoryId:5},expect.any(Object));
  expect((await request(app).put('/api/products/1').set('Authorization',header(seller)).send({categoryId:5})).status).toBe(400);
});
it.each([null,0,-1,1.5,'bad',{},[],true,2147483648])('rejects an invalid initial category %# before creating',async categoryId=>{
  const create=jest.spyOn(catalog,'createProduct');
  expect((await request(app).post('/api/products').set('Authorization',header(seller)).send({title:'Fixture',price:'1.00',categoryId})).status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});

it('uploads one image after checking ownership and exposes only a public identifier and URL', async () => {
  const owner = jest.spyOn(catalog, 'ownedProduct').mockResolvedValue(sample);
  const replace = jest.spyOn(images, 'replace').mockResolvedValue('managed-image');
  jest.spyOn(cloud, 'deliveryUrl').mockReturnValue('https://example.invalid/image');
  const result = await request(app).put('/api/products/1/image').set('Authorization', header(seller)).attach('image', png, 'fixture.png');
  expect(result.status).toBe(200);
  expect(owner).toHaveBeenCalledWith(1, seller.account.id);
  expect(replace).toHaveBeenCalledWith(expect.objectContaining({ id: seller.account.id }), 1, expect.any(Buffer),
    {ipAddress:expect.any(String), imagePermit:expect.objectContaining({check:expect.any(Function),release:expect.any(Function)}),
      imageInfo:{format:'png',width:2,height:2}});
  expect(result.body).toEqual({ productId: 1, imagePublicId: 'managed-image', imageUrl: 'https://example.invalid/image' });
});
