const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const mysql = require('mysql2/promise');
const request = require('supertest');

const isolated = process.env.STAGE3B_MYSQL_UUID ? describe : describe.skip;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const password = 'synthetic-stage3a-password';

isolated.each(['final', 'final-repeat'])('MySQL isolated catalog using %s columns', variant => {
  let app;
  let models;
  let cloud;
  let images;
  let db;
  let isolatedAuth;
  let directory;
  let remote;
  let seller;
  let other;
  let buyer;
  let admin;
  let pending;
  let suspended;
  let productId;
  let categoryId;
  let diagnostics;
  const rounds=Number(process.env.CATALOG_CONCURRENCY_ROUNDS||1);

  beforeAll(async () => {
    expect(process.env.STAGE3B_TEST_PASSWORD).toBeTruthy();
    const database = variant === 'final' ? 'secure_ecommerce_3b_final_test' : 'secure_ecommerce_3b_repeat_test';
    const port = Number(process.env.STAGE3B_TEST_PORT || 13307);
    db = await mysql.createConnection({ host: '127.0.0.1', port, database, user: 'ecommerce_app', password: process.env.STAGE3B_TEST_PASSWORD });
    const [[identity]] = await db.query('SELECT @@server_uuid AS uuid, @@hostname AS host, DATABASE() AS db, CURRENT_USER() AS account');
    expect(identity).toEqual({ uuid: process.env.STAGE3B_MYSQL_UUID, host: process.env.STAGE3B_TEST_HOSTNAME || 'secure-ecommerce-stage3b', db: database, account: 'ecommerce_app@%' });
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-ecommerce-catalog-'));
    Object.assign(process.env, { TEST_DB_HOST: '127.0.0.1', TEST_DB_PORT: String(port), TEST_DB_USER: 'ecommerce_app',
      TEST_DB_DATABASE: database, TEST_DB_PASSWORD: process.env.STAGE3B_TEST_PASSWORD,
      JWT_SECRET: require('../support/signing-secret'),
      CLOUDINARY_CLOUD_NAME: 'synthetic-cloud', CLOUDINARY_API_KEY: 'synthetic-key', CLOUDINARY_API_SECRET: 'synthetic-secret',
      CLOUDINARY_CLEANUP_DIR: directory });
    jest.resetModules();
    diagnostics=require('../support/redis-diagnostics').redisDiagnostics();
    app = require('../../index');
    models = require('../../models');
    cloud = require('../../services/cloudinary.service');
    images = require('../../services/product-images.service');
    const accounts = require('../../services/accounts.service');
    isolatedAuth = await require('../support/isolated-auth').start({poolFactory:diagnostics.poolFactory});
    async function account(label, profile, status = 'APPROVED') {
      const row = await accounts.createPublicAccount({ email: `${label}@example.invalid`, name: label, password, profile, storeName: 'Synthetic shop' });
      if (profile === 'SELLER') await models.Seller.update({ status }, { where: { userId: row.id } });
      return { ...row, token: await isolatedAuth.issue(row) };
    }
    seller = await account('seller', 'SELLER');
    other = await account('other', 'SELLER');
    pending = await account('pending', 'SELLER', 'PENDING');
    suspended = await account('suspended', 'SELLER');
    await models.User.update({ status: 'SUSPENDED' }, { where: { id: suspended.id } });
    buyer = await account('buyer', 'BUYER');
    admin = await accounts.findAccountByEmail('admin@example.invalid');
    admin = { id: admin.id, token: await isolatedAuth.issue(admin) };
    remote = new Map();
  }, 30000);

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(cloud, 'upload').mockImplementation(async (buffer, publicId, id) => {
      remote.set(publicId, { context: { custom: { catalog_owner: 'secure-ecommerce-api', product_id: String(id) } } });
      return { public_id: publicId, format: 'png' };
    });
    jest.spyOn(cloud, 'inspect').mockImplementation(async id => remote.get(id) || null);
    jest.spyOn(cloud, 'destroy').mockImplementation(async id => { remote.delete(id); });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (isolatedAuth) await isolatedAuth.close();
    if (models) await models.sequelize.close();
    if (db) await db.end();
    if (directory) {
      for (const file of await fs.readdir(directory)) await fs.unlink(path.join(directory, file));
      await fs.rmdir(directory);
    }
  });

  const auth = account => `Bearer ${account.token}`;
  const product = () => `/api/products/${productId}`;
  const upload = account => request(app).put(`${product()}/image`).set('Authorization', auth(account)).attach('image', png, 'fixture.png');

  it('creates products only for an approved active seller and prevents mass assignment', async () => {
    for (const actor of [buyer, admin, pending, suspended]) {
      expect((await request(app).post('/api/products').set('Authorization', auth(actor)).send({ title: 'Denied', price: '1.00' })).status).toBe(403);
    }
    expect((await request(app).post('/api/products').set('Authorization', auth(seller)).send({ title: 'Denied', price: '1.00', sellerId: other.id })).status).toBe(400);
    const result = await request(app).post('/api/products').set('Authorization', auth(seller)).send({ title: 'Fixture product', price: '12.50', stock: 5 });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ sellerId: seller.id, price: '12.50', stock: 5, imagePublicId: null });
    productId = result.body.productId;
    const [[event]] = await db.query('SELECT actorUserId, outcome FROM audit_logs WHERE action = ? AND targetId = ?', ['producto.crear', String(productId)]);
    expect(event).toEqual({ actorUserId: seller.id, outcome: 'SUCCESS' });
  });

  it('enforces ownership, valid prices and stock, and the physical DECIMAL capacity', async () => {
    expect((await request(app).put(product()).set('Authorization', auth(other)).send({ stock: 1 })).status).toBe(404);
    expect((await request(app).delete(product()).set('Authorization', auth(other))).status).toBe(404);
    expect((await upload(other)).status).toBe(404);
    expect(cloud.upload).not.toHaveBeenCalled();
    for (const body of [{ price: -1 }, { stock: -1 }, { stock: 1.5 }, { imagePublicId: 'injected' }]) {
      expect((await request(app).put(product()).set('Authorization', auth(seller)).send(body)).status).toBe(400);
    }
    const large = await request(app).put(product()).set('Authorization', auth(seller)).send({ price: '9999999999.99' });
    expect(large.status).toBe(204);
    expect((await request(app).put(product()).set('Authorization', auth(seller)).send({ price: '12.50', stock: 0 })).status).toBe(204);
  });

  it('reuses one category link across concurrent assignment, removal and reactivation', async () => {
    expect(Number.isInteger(rounds)&&rounds>=1&&rounds<=500).toBe(true);
    const category = await request(app).post('/api/categories').set('Authorization', auth(admin)).send({ name: 'Fixture category' });
    expect(category.status).toBe(201);
    categoryId = category.body.categoryId;
    expect((await request(app).delete('/api/categories/1').set('Authorization', auth(admin))).status).toBe(400);
    const assign = () => request(app).post(`${product()}/categories`).set('Authorization', auth(seller)).send({ categoryId });
    const business={calls:0,errors:[]};
    const catalog=require('../../services/catalog.service'),change=catalog.changeCategory;
    jest.spyOn(catalog,'changeCategory').mockImplementation(async(...args)=>{
      business.calls++;
      try{return await change(...args);}catch(error){
        business.errors.push(['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.original?.code)?error.original.code:'other');throw error;
      }
    });
    diagnostics.reset();
    let injected=false;
    if(process.env.CATALOG_TORN_READ_INJECTION==='1'){
      const claims=isolatedAuth.tokens.verify(seller.token);
      diagnostics.beforeGet(async key=>{
        if(injected||!key.endsWith('alive:'+claims.sid))return;
        injected=true;
        const nested=await assign();
        expect(nested.status).toBe(204);
      });
    }
    for(let round=0;round<rounds;round++){
      const statuses=(await Promise.all([assign(),assign()])).map(row=>row.status);
      if(statuses.some(status=>status!==204)){
        throw new Error(JSON.stringify({scenario:'concurrent-category-assignment',round,statuses,business,redis:diagnostics.snapshot()}));
      }
    }
    diagnostics.beforeGet(undefined);
    if(process.env.CATALOG_TORN_READ_INJECTION==='1')expect(injected).toBe(true);
    expect(business.calls).toBe(rounds*2+(injected?1:0));expect(business.errors).toEqual([]);
    if(rounds>1)process.stdout.write(JSON.stringify({scenario:'concurrent-category-assignment',rounds,injected,business,redis:diagnostics.snapshot()})+'\n');
    const before = await models.ProductCategory.findOne({ where: { productId, categoryId } });
    expect((await request(app).delete(`${product()}/categories/${categoryId}`).set('Authorization', auth(seller))).status).toBe(204);
    expect(await models.ProductCategory.count({ where: { productId, categoryId } })).toBe(0);
    expect((await assign()).status).toBe(204);
    const restored = await models.ProductCategory.findOne({ where: { productId, categoryId } });
    expect(restored.createdAt).toEqual(before.createdAt);
    expect(await models.ProductCategory.count({ where: { productId, categoryId }, paranoid: false })).toBe(1);
    const response = await request(app).get(product()).set('Authorization', auth(buyer));
    expect(response.body.categories).toEqual([{ categoryId, name: 'Fixture category', protected: false }]);
  },5000+Math.max(0,rounds-1)*100);

  it('uploads, replaces and compensates an image when the SQL update fails', async () => {
    const first = await upload(seller);
    expect(first.status).toBe(200);
    const second = await upload(seller);
    expect(second.status).toBe(200);
    expect(second.body.imagePublicId).not.toBe(first.body.imagePublicId);
    expect(remote.has(first.body.imagePublicId)).toBe(false);
    expect(remote.has(second.body.imagePublicId)).toBe(true);
    jest.spyOn(models.Product.prototype, 'update').mockRejectedValueOnce(new Error('synthetic SQL write failure'));
    expect((await upload(seller)).status).toBe(500);
    expect((await models.Product.findByPk(productId)).imagePublicId).toBe(second.body.imagePublicId);
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('recovers an uncertain upload failure from the durable journal', async () => {
    let orphan;
    cloud.upload.mockImplementationOnce(async (buffer, publicId, id) => {
      orphan = publicId;
      remote.set(publicId, { context: { custom: { catalog_owner: 'secure-ecommerce-api', product_id: String(id) } } });
      throw new Error('synthetic timeout after remote creation');
    });
    const previous = (await models.Product.findByPk(productId)).imagePublicId;
    expect((await upload(seller)).status).toBe(502);
    expect(remote.has(orphan)).toBe(true);
    expect(await fs.readdir(directory)).toHaveLength(1);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 180000);
    await images.recover();
    expect(remote.has(orphan)).toBe(false);
    expect((await models.Product.findByPk(productId)).imagePublicId).toBe(previous);
  });

  it('compensates an upload if seller approval is revoked while it is in progress', async () => {
    const previous = (await models.Product.findByPk(productId)).imagePublicId;
    let uploaded;
    cloud.upload.mockImplementationOnce(async (buffer, publicId, id) => {
      uploaded = publicId;
      remote.set(publicId, { context: { custom: { catalog_owner: 'secure-ecommerce-api', product_id: String(id) } } });
      await models.Seller.update({ status: 'SUSPENDED' }, { where: { userId: seller.id } });
      return { public_id: publicId, format: 'png' };
    });
    try {
      expect((await upload(seller)).status).toBe(403);
      expect((await models.Product.findByPk(productId)).imagePublicId).toBe(previous);
      expect(remote.has(uploaded)).toBe(false);
    } finally {
      await models.Seller.update({ status: 'APPROVED' }, { where: { userId: seller.id } });
    }
  });

  it('retries failed old-image deletion after the new reference has committed', async () => {
    const previous = (await models.Product.findByPk(productId)).imagePublicId;
    cloud.destroy.mockRejectedValueOnce(new Error('synthetic provider unavailable'));
    const result = await upload(seller);
    expect(result.status).toBe(200);
    expect((await models.Product.findByPk(productId)).imagePublicId).toBe(result.body.imagePublicId);
    expect(remote.has(previous)).toBe(true);
    await images.recover();
    expect(remote.has(previous)).toBe(false);
  });

  it('serializes concurrent image replacement and removes the superseded upload', async () => {
    const results = await Promise.all([upload(seller), upload(seller)]);
    expect(results.map(row => row.status)).toEqual([200, 200]);
    const current = (await models.Product.findByPk(productId)).imagePublicId;
    for (const response of results) expect(remote.has(response.body.imagePublicId)).toBe(response.body.imagePublicId === current);
  });

  it('preserves historical images and supports the catalog without files in the final fixture', async () => {
    await models.Product.update({ imagePublicId: 'migrated/historical' }, { where: { id: productId } });
    expect((await upload(seller)).status).toBe(200);
    expect(cloud.destroy).not.toHaveBeenCalledWith('migrated/historical');
    expect((await fs.readdir(directory)).some(file => file.endsWith('.preserved.json'))).toBe(true);
    const historical = await request(app).get('/api/files/1');
    expect(historical.status).toBe(410);
    expect(models.File).toBeUndefined();
  });

  it('hides products whose seller is suspended and soft-deletes categories and products', async () => {
    await models.User.update({ status: 'SUSPENDED' }, { where: { id: seller.id } });
    expect((await request(app).get(product()).set('Authorization', auth(buyer))).status).toBe(404);
    await models.User.update({ status: 'ACTIVE' }, { where: { id: seller.id } });
    await models.Seller.update({ status: 'SUSPENDED' }, { where: { userId: seller.id } });
    expect((await request(app).get(product()).set('Authorization', auth(buyer))).status).toBe(404);
    await models.Seller.update({ status: 'APPROVED' }, { where: { userId: seller.id } });
    expect((await request(app).delete(`/api/categories/${categoryId}`).set('Authorization', auth(admin))).status).toBe(204);
    expect((await request(app).get(product()).set('Authorization', auth(buyer))).body.categories).toEqual([]);
    const current = (await models.Product.findByPk(productId)).imagePublicId;
    expect((await request(app).delete(product()).set('Authorization', auth(seller))).status).toBe(204);
    expect((await request(app).get(product()).set('Authorization', auth(buyer))).status).toBe(404);
    const deleted = await models.Product.findByPk(productId, { paranoid: false });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    expect(deleted.imagePublicId).toBe(current);
    expect(remote.has(current)).toBe(true);
  });
});
