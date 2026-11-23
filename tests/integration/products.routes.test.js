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
  expect(result.body).toMatchObject({ productId: 1, sellerId: seller.account.id, description: 'Descripción válida', price: '12.50', imagePublicId: null, hasImage: false });
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
  jest.spyOn(catalog, 'listProducts').mockResolvedValue([{ ...sample, imagePublicId: 'managed-img' }]);
  const result = await request(app).get('/api/products?s=Fixture').set('Authorization', header(buyer));
  expect(result.status).toBe(200);
  expect(result.body[0]).not.toHaveProperty('fileId');
  expect(result.body[0]).not.toHaveProperty('hasImage');
  jest.spyOn(catalog, 'getProduct').mockRejectedValue(new Error('secret SQL diagnostics'));
  const failed = await request(app).get('/api/products/1').set('Authorization', header(buyer));
  expect(failed.status).toBe(500);
  expect(failed.text).not.toContain('secret');
});

it('enforces draft visibility rules by role (BUYER/ADMIN vs owning SELLER) and exposes hasImage only to sellers', async () => {
  const { Product, Sequelize } = require('../../models');
  const { Op } = Sequelize;
  const otherSeller = tokenFor('SELLER', { seller: { status: 'APPROVED' } });
  const rows = [
    { id: 10, sellerId: seller.account.id, title: 'Borrador Propio', description: 'Sin foto aún', price: '10.00', stock: 1, imagePublicId: null, categories: [] },
    { id: 11, sellerId: seller.account.id, title: 'Publicado Propio', description: 'Con foto propia', price: '20.00', stock: 2, imagePublicId: 'prod-11', categories: [] },
    { id: 12, sellerId: otherSeller.account.id, title: 'Borrador Ajeno', description: 'Sin foto ajena', price: '30.00', stock: 3, imagePublicId: null, categories: [] },
    { id: 13, sellerId: otherSeller.account.id, title: 'Publicado Ajeno', description: 'Con foto ajena', price: '40.00', stock: 4, imagePublicId: 'prod-13', categories: [] }
  ];
  const matches = (row, where) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.imagePublicId && where.imagePublicId[Op.ne] === null && row.imagePublicId === null) return false;
    if (where[Op.or]) {
      const ok = where[Op.or].some(branch =>
        (branch.imagePublicId?.[Op.ne] === null && row.imagePublicId !== null) ||
        (branch.sellerId !== undefined && row.sellerId === branch.sellerId));
      if (!ok) return false;
    }
    if (where.title?.[Op.like]) {
      const term = where.title[Op.like].slice(1, -1).toLowerCase();
      if (!row.title.toLowerCase().includes(term)) return false;
    }
    return true;
  };
  jest.spyOn(Product, 'findAll').mockImplementation(async ({ where }) => rows.filter(row => matches(row, where)));
  jest.spyOn(Product, 'findOne').mockImplementation(async ({ where }) => rows.find(row => matches(row, where)) || null);

  // BUYER: solo productos con imagen en lista y detalle; 404 en borrador; sin campo hasImage
  const buyerList = await request(app).get('/api/products').set('Authorization', header(buyer));
  expect(buyerList.status).toBe(200);
  expect(buyerList.body.map(item => item.productId)).toEqual([11, 13]);
  expect(buyerList.body.every(item => !Object.hasOwn(item, 'hasImage'))).toBe(true);
  expect((await request(app).get('/api/products/10').set('Authorization', header(buyer))).status).toBe(404);
  const buyerDetail = await request(app).get('/api/products/11').set('Authorization', header(buyer));
  expect(buyerDetail.status).toBe(200);
  expect(buyerDetail.body).not.toHaveProperty('hasImage');
  expect((await request(app).get('/api/products?s=Borrador').set('Authorization', header(buyer))).body).toEqual([]);

  // ADMIN: solo productos con imagen; 404 en borrador; sin campo hasImage
  const adminList = await request(app).get('/api/products').set('Authorization', header(admin));
  expect(adminList.status).toBe(200);
  expect(adminList.body.map(item => item.productId)).toEqual([11, 13]);
  expect(adminList.body.every(item => !Object.hasOwn(item, 'hasImage'))).toBe(true);
  expect((await request(app).get('/api/products/10').set('Authorization', header(admin))).status).toBe(404);

  // SELLER dueño: ve sus borradores (hasImage: false) + productos con imagen (hasImage: true), pero 404 en borrador ajeno
  const sellerList = await request(app).get('/api/products').set('Authorization', header(seller));
  expect(sellerList.status).toBe(200);
  expect(sellerList.body.map(item => ({ id: item.productId, hasImage: item.hasImage }))).toEqual([
    { id: 10, hasImage: false },
    { id: 11, hasImage: true },
    { id: 13, hasImage: true }
  ]);
  const sellerDraftDetail = await request(app).get('/api/products/10').set('Authorization', header(seller));
  expect(sellerDraftDetail.status).toBe(200);
  expect(sellerDraftDetail.body.hasImage).toBe(false);
  expect((await request(app).get('/api/products/12').set('Authorization', header(seller))).status).toBe(404);
  const sellerSearch = await request(app).get('/api/products?s=Borrador').set('Authorization', header(seller));
  expect(sellerSearch.status).toBe(200);
  expect(sellerSearch.body.map(item => item.productId)).toEqual([10]);
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
