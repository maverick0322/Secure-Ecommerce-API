const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Product, sequelize } = require('../../models');
const catalog = require('../../services/catalog.service');
const cloud = require('../../services/cloudinary.service');
const images = require('../../services/product-images.service');

let directory;
let product;
let remote;
let scope;
const ownership = require('../../services/image-ownership.service');
const journalFiles = require('../support/image-phase2-fixture').journalFiles;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-ecommerce-images-'));
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLEANUP_DIR: directory, CLOUDINARY_CLOUD_NAME: 'synthetic' });
  jest.spyOn(sequelize, 'query').mockResolvedValue([[{uuid:'11111111-1111-4111-8111-111111111111',db:'test_images'}],{}]);
  scope = await ownership.current();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  product = { id: 1, sellerId: 'seller', imagePublicId: null, update: jest.fn(async values => Object.assign(product, values)) };
  remote = new Map();
  jest.spyOn(Product, 'findByPk').mockResolvedValue(product);
  jest.spyOn(Product, 'count').mockImplementation(async ({ where }) => product.imagePublicId === where.imagePublicId ? 1 : 0);
  jest.spyOn(sequelize, 'transaction').mockImplementation(callback => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  jest.spyOn(catalog, 'ownedProduct').mockResolvedValue(product);
  jest.spyOn(catalog, 'mutateProduct').mockImplementation((account, id, apply) => apply(product, 'tx'));
  jest.spyOn(cloud, 'credentials').mockReturnValue({});
  jest.spyOn(cloud, 'upload').mockImplementation(async (buffer, publicId, productId) => {
    remote.set(publicId, { context: { custom: ownership.context(scope, productId) } });
    return require('../support/image-phase2-fixture').uploadResult(publicId,'png',scope,productId);
  });
  jest.spyOn(cloud, 'inspect').mockImplementation(async id => remote.get(id) || null);
  jest.spyOn(cloud, 'destroy').mockImplementation(async id => { remote.delete(id); });
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const filename of await fs.readdir(directory)) await fs.unlink(path.join(directory, filename));
  await fs.rmdir(directory);
});

it('commits one image and removes its completed intent without deleting the referenced resource', async () => {
  const id = await images.replace({ id: 'seller' }, 1, Buffer.from('fixture'));
  expect(product.imagePublicId).toBe(id);
  expect(remote.has(id)).toBe(true);
  expect(cloud.destroy).not.toHaveBeenCalled();
  expect(await journalFiles(directory)).toEqual([]);
});

it('compensates a failed SQL write without touching the old image', async () => {
  product.imagePublicId = 'imported/old';
  product.update.mockRejectedValueOnce(new Error('synthetic SQL failure'));
  await expect(images.replace({ id: 'seller' }, 1, Buffer.from('fixture'))).rejects.toThrow('synthetic SQL failure');
  expect(product.imagePublicId).toBe('imported/old');
  expect(remote.size).toBe(0);
  expect(cloud.destroy).toHaveBeenCalledTimes(1);
  expect(await journalFiles(directory)).toEqual([]);
});

it('retains a durable cleanup record across provider failure and recovers it later', async () => {
  product.update.mockRejectedValueOnce(new Error('synthetic SQL failure'));
  cloud.destroy.mockRejectedValueOnce(new Error('synthetic provider unavailable'));
  await expect(images.replace({ id: 'seller' }, 1, Buffer.from('fixture'))).rejects.toThrow('synthetic SQL failure');
  expect(remote.size).toBe(1);
  expect(await journalFiles(directory)).toHaveLength(1);
  const later = Date.now() + 180000;
  jest.spyOn(Date, 'now').mockReturnValue(later);
  await images.recover();
  expect(remote.size).toBe(0);
  expect(await journalFiles(directory)).toEqual([]);
});

it('handles an upload timeout that may have created a remote image', async () => {
  cloud.upload.mockImplementationOnce(async (buffer, publicId) => {
    remote.set(publicId, { context: { custom: ownership.context(scope, 1) } });
    throw new Error('synthetic timeout');
  });
  await expect(images.replace({ id: 'seller' }, 1, Buffer.from('fixture'))).rejects.toMatchObject({ status: 502 });
  expect(product.imagePublicId).toBeNull();
  expect(remote.size).toBe(1);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 180000);
  await images.recover();
  expect(remote.size).toBe(0);
});

it('keeps watching an uncertain missing upload so a late remote completion is cleaned', async () => {
  cloud.upload.mockRejectedValueOnce(new Error('synthetic upload timeout'));
  await expect(images.replace({ id: 'seller' }, 1, Buffer.from('fixture'))).rejects.toMatchObject({ status: 502 });
  const id = cloud.upload.mock.calls[0][1];
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 180000);
  await images.recover();
  expect(await journalFiles(directory)).toHaveLength(1);
  remote.set(id, { context: { custom: ownership.context(scope, 1) } });
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
  await images.recover();
  expect(remote.has(id)).toBe(false);
  expect(await journalFiles(directory)).toEqual([]);
});

it('preserves a historical resource and archives its public identifier', async () => {
  product.imagePublicId = 'imported/historical';
  await images.replace({ id: 'seller' }, 1, Buffer.from('fixture'));
  expect(cloud.destroy).not.toHaveBeenCalledWith('imported/historical');
  const [record] = await journalFiles(directory);
  expect(record).toMatch(/\.preserved\.json$/);
  expect(JSON.parse(await fs.readFile(path.join(directory, record), 'utf8')).publicId).toBe('imported/historical');
});

it('preserves a resource in the managed namespace when its ownership context is missing', async () => {
  const historical = 'secure-ecommerce/products/1/00000000-0000-4000-8000-000000000001';
  product.imagePublicId = historical;
  remote.set(historical, { context: { custom: { product_id: '1' } } });
  await images.replace({ id: 'seller' }, 1, Buffer.from('fixture'));
  expect(remote.has(historical)).toBe(true);
  expect(cloud.destroy).not.toHaveBeenCalledWith(historical);
});

it('does not delete a colliding preexisting asset', async () => {
  cloud.upload.mockImplementationOnce(async(buffer,id)=>({...require('../support/image-phase2-fixture').uploadResult(id,'png',scope,1),width:3,existing:true}));
  await expect(images.replace({ id: 'seller' }, 1, Buffer.from('fixture'),{imageInfo:{format:'png',width:2,height:2}})).rejects.toMatchObject({ status: 409 });
  expect(product.imagePublicId).toBeNull();
  expect(cloud.destroy).not.toHaveBeenCalled();
  expect(await journalFiles(directory)).toEqual([]);
});

it('preserves an uncertain preexisting resource when its collision response is incomplete',async()=>{
  cloud.upload.mockImplementationOnce(async(buffer,id)=>{
    remote.set(id,{context:{custom:ownership.context(scope,1)}});return {existing:true};
  });
  await expect(images.replace({id:'seller'},1,Buffer.from('fixture'))).rejects.toMatchObject({status:502});
  jest.spyOn(Date,'now').mockReturnValue(Date.now()+180000);await images.recover();
  expect(remote.size).toBe(1);expect(cloud.destroy).not.toHaveBeenCalled();expect(cloud.inspect).not.toHaveBeenCalled();
});

it('keeps a resource still referenced by a logically deleted product', async () => {
  Product.count.mockRejectedValueOnce(new Error('synthetic connection lost after commit'));
  await images.replace({ id: 'seller' }, 1, Buffer.from('fixture'));
  expect(await journalFiles(directory)).toHaveLength(1);
  product.deletedAt = new Date();
  await images.recover();
  expect(remote.size).toBe(1);
  expect(Product.count).toHaveBeenCalledWith(expect.objectContaining({ paranoid: false }));
});
