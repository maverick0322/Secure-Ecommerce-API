'use strict';

jest.mock('../../models', () => require('../support/image-phase2-fixture').makeModels());
jest.mock('../../services/cloudinary.service', () => Object.fromEntries(
  ['credentials', 'upload', 'inspect', 'destroy', 'deliveryUrl'].map(name => [name, jest.fn()])));
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../../models');
const cloud = require('../../services/cloudinary.service');
const images = require('../../services/product-images.service');
const ownership = require('../../services/image-ownership.service');
const fixture = require('../support/image-phase2-fixture');
let directory;
const replace = () => images.replace({ id: db.state.owner }, 701, fixture.png);
beforeEach(async () => {
  db.reset(); fixture.configureCloud(cloud, db.state); jest.clearAllMocks();
  directory = await fixture.temporaryDirectory();
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLEANUP_DIR: directory, CLOUDINARY_CLOUD_NAME: 'synthetic' });
  jest.spyOn(require('../../services/structured-logger.service'), 'log').mockImplementation(() => {});
});
afterEach(async () => { jest.restoreAllMocks(); await fixture.removeDirectory(directory); });

it('S01 same persistent directory returns immutable stable identity', async () => {
  const first = await ownership.current(), second = await ownership.current();
  expect(second).toEqual(first); expect(Object.isFrozen(second)).toBe(true);
  expect(ownership.prefix(first, 2147483647).length + 36).toBeLessThanOrEqual(255);
});
it('S02 copied identity cannot be used with an independent database', async () => {
  await ownership.current(); const location = path.join(directory, '.ownership.json'), before = await fs.readFile(location);
  db.state.identity.uuid = '22222222-2222-4222-8222-222222222222';
  await expect(replace()).rejects.toMatchObject({ status: 503 });
  expect(await fs.readFile(location)).toEqual(before); expect(cloud.upload).not.toHaveBeenCalled();
  expect(db.state.row.imagePublicId).toBeNull();
});
it('S03 copied identity cannot be used with a different cloud or database name', async () => {
  await ownership.current(); process.env.CLOUDINARY_CLOUD_NAME = 'another-cloud';
  await expect(ownership.current()).rejects.toMatchObject({ status: 503 });
  process.env.CLOUDINARY_CLOUD_NAME = 'synthetic'; db.state.identity.db = 'independent';
  await expect(ownership.current()).rejects.toMatchObject({ status: 503 });
});
it('S04 partial identity is never regenerated or overwritten automatically', async () => {
  const location = path.join(directory, '.ownership.json'); await fs.writeFile(location, '{');
  await expect(ownership.current()).rejects.toMatchObject({ status: 503 }); expect(await fs.readFile(location, 'utf8')).toBe('{');
  expect(cloud.upload).not.toHaveBeenCalled();
});
it('S05 separate stores produce separate namespaces even with same database identity', async () => {
  const first = await ownership.current(), otherDirectory = await fixture.temporaryDirectory();
  try {
    process.env.CLOUDINARY_CLEANUP_DIR = otherDirectory; const second = await ownership.current();
    expect(second.binding).toBe(first.binding); expect(second.id).not.toBe(first.id);
    expect(ownership.managed(ownership.prefix(first, 701) + crypto.randomUUID(), 701, second)).toBe(false);
  } finally { process.env.CLOUDINARY_CLEANUP_DIR = directory; await fixture.removeDirectory(otherDirectory); }
});
it('S06 upload propagates complete ownership into provider context and identifier', async () => {
  const id = await replace(); const scope = cloud.upload.mock.calls[0][3];
  expect(ownership.managed(id, 701, scope)).toBe(true);
  expect(ownership.matches(db.state.remote.get(id), scope, 701)).toBe(true);
});
it('S07 legacy resource remains deliverable and is never inspected or deleted on reference retirement', async () => {
  const legacy = 'secure-ecommerce/products/701/11111111-1111-4111-8111-111111111111';
  db.state.row.imagePublicId = legacy; db.state.remote.set(legacy, { context: { custom: { catalog_owner: 'secure-ecommerce-api', product_id: '701' } } });
  await images.remove({ id: db.state.owner }, 701);
  expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.has(legacy)).toBe(true);
  expect(cloud.inspect).not.toHaveBeenCalled(); expect(cloud.destroy).not.toHaveBeenCalled();
  expect((await fixture.journalFiles(directory))[0]).toMatch(/\.preserved\.json$/);
});
it('S08 inspect and destroy execute outside SQL transactions', async () => {
  await fixture.prepareOwnership(db); const old = fixture.managedId(); db.state.row.imagePublicId = old;
  db.state.remote.set(old, fixture.resource()); const observed = [];
  const inspect = cloud.inspect.getMockImplementation(), destroy = cloud.destroy.getMockImplementation();
  cloud.inspect.mockImplementation(async id => { observed.push(db.state.openTransactions); return inspect(id); });
  cloud.destroy.mockImplementation(async id => { observed.push(db.state.openTransactions); return destroy(id); });
  await replace(); expect(observed).toEqual([0, 0]);
});
it('S09 live operation has no settled marker until transactional outcome is known', async () => {
  const entered = fixture.deferred(), gate = fixture.deferred(), normal = cloud.upload.getMockImplementation();
  cloud.upload.mockImplementationOnce(async (...args) => { const result = await normal(...args); entered.resolve(); await gate.promise; return result; });
  const pending = replace(); await entered.promise;
  const [file] = await fixture.journalFiles(directory); const record = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
  expect(record.state).toBe('pending'); expect(record.version).toBe(2);
  gate.resolve(); const id = await pending; expect(db.state.remote.has(id)).toBe(true);
});
it('S10 failed terminal-marker write never permits cleanup of an unresolved operation', async () => {
  await fixture.prepareOwnership(db);
  jest.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('Synthetic full disk'), { code: 'ENOSPC' }));
  const id = await replace(); const [name] = await fixture.journalFiles(directory);
  const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); expect(record.state).toBe('pending');
  await images.recover(); expect(db.state.remote.has(id)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
});
it('S11 settled failed operation can recover after simulated one-year outage without changing H1 policy', async () => {
  const normal = cloud.upload.getMockImplementation();
  cloud.upload.mockImplementationOnce(async (...args) => { await normal(...args); throw new Error('Synthetic lost response'); });
  await expect(replace()).rejects.toMatchObject({ status: 502 });
  const [name] = await fixture.journalFiles(directory); const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
  expect(record.state).toBe('settled');
  const now = Date.now() + 365 * 86400000; jest.spyOn(Date, 'now').mockReturnValue(now);
  await images.recover(); expect(db.state.remote.size).toBe(0); expect(await fixture.journalFiles(directory)).toEqual([]);
});
it.each(['catalog_environment', 'catalog_database', 'catalog_owner', 'product_id'])('S12-%s foreign context is protected even in the local namespace', async field => {
  const local = await fixture.prepareOwnership(db), id = fixture.managedId();
  db.state.row.imagePublicId = id;
  db.state.remote.set(id, { context: { custom: { ...ownership.context(local, 701), [field]: 'foreign-value' } } });
  await images.remove({ id: db.state.owner }, 701);
  expect(db.state.remote.has(id)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
});
it('S14 malformed database identity fails closed before upload', async () => {
  db.state.identity.uuid = 'invalid-identity'; await expect(replace()).rejects.toMatchObject({ status: 503 });
  expect(cloud.upload).not.toHaveBeenCalled(); expect(db.state.row.imagePublicId).toBeNull();
});
it('S13 legacy journal with no scope is archived, never treated as a settled deletion permit', async () => {
  const scope = await fixture.prepareOwnership(db), publicId = ownership.prefix(scope, 701) + crypto.randomUUID();
  const filename = crypto.createHash('sha256').update(publicId).digest('hex') + '.json';
  await fs.writeFile(path.join(directory, filename), JSON.stringify({ publicId, productId: 701, notBefore: 0 }));
  await images.recover(); expect(cloud.inspect).not.toHaveBeenCalled(); expect(cloud.destroy).not.toHaveBeenCalled();
  expect((await fixture.journalFiles(directory))[0]).toMatch(/\.preserved\.json$/);
});
it('S15 concurrent identity initialization has one stable result and fails closed on an incomplete race', async () => {
  const outcomes = await Promise.allSettled([ownership.current(), ownership.current()]);
  const successful = outcomes.filter(value => value.status === 'fulfilled'); expect(successful.length).toBeGreaterThan(0);
  const persisted = await ownership.current();
  for (const result of successful) expect(result.value).toEqual(persisted);
  for (const result of outcomes.filter(value => value.status === 'rejected')) expect(result.reason.status).toBe(503);
});
it('S16 failed terminal publication after rollback retains unresolved orphan instead of permitting deletion', async () => {
  await fixture.prepareOwnership(db); db.state.faults.beforeUpdate = new Error('Synthetic SQL rollback');
  jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Synthetic metadata publication failure'));
  await expect(replace()).rejects.toThrow('Synthetic SQL rollback');
  const [name] = await fixture.journalFiles(directory);
  expect(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')).state).toBe('pending');
  const later = Date.now() + 365 * 86400000; jest.spyOn(Date, 'now').mockReturnValue(later);
  await images.recover(); expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(1);
  expect(cloud.destroy).not.toHaveBeenCalled();
});
