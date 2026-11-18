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
const logger = require('../../services/structured-logger.service');
const fixture = require('../support/image-phase2-fixture');
let directory, logs;
const account = () => ({ id: db.state.owner });
const replace = () => images.replace(account(), 701, fixture.png);
const remove = () => images.remove(account(), 701);
const files = () => fixture.journalFiles(directory);
const error = message => new Error('Synthetic ' + message);
function later(milliseconds = 180000) {
  const value = Date.now() + milliseconds; jest.spyOn(Date, 'now').mockReturnValue(value);
}
function seedImage(id = fixture.managedId(), resource = fixture.resource()) {
  db.state.row.imagePublicId = id; db.state.remote.set(id, resource); return id;
}
beforeEach(async () => {
  db.reset(); fixture.configureCloud(cloud, db.state); jest.clearAllMocks(); logs = [];
  directory = await fixture.temporaryDirectory();
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLEANUP_DIR: directory, CLOUDINARY_CLOUD_NAME: 'synthetic' });
  await fixture.prepareOwnership(db);
  const safeLogger = logger.createLogger({ sink: line => logs.push(JSON.parse(line)) });
  jest.spyOn(logger, 'log').mockImplementation(safeLogger.log);
});
afterEach(async () => { jest.restoreAllMocks(); await fixture.removeDirectory(directory); });

describe('C: provider failures without external SDK/network', () => {
  it.each([400, 401, 403, 429, 500, 503])('C01-%i bounds recovery and closes definitive rejection', async status => {
    cloud.upload.mockRejectedValueOnce(Object.assign(error('private provider diagnostic'), {
      imageFailure: status < 429 ? 'definitive' : status === 429 ? 'transient' : 'uncertain' }));
    await expect(replace()).rejects.toMatchObject({ status: 502, message: 'No se pudo cargar la imagen.' });
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0);
    later(365 * 86400000);
    await images.recover(); await images.recover(); await images.recover();
    expect(await files()).toHaveLength(status < 429 ? 0 : 1); expect(cloud.inspect).toHaveBeenCalledTimes(status < 429 ? 0 : 1);
    expect(cloud.destroy).not.toHaveBeenCalled();
  });
  it.each(['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'])('C02-%s preserves uncertain failure before storage', async code => {
    cloud.upload.mockRejectedValueOnce(Object.assign(error('network'), { code }));
    await expect(replace()).rejects.toMatchObject({ status: 502 });
    later(); await images.recover(); expect(await files()).toHaveLength(1);
    expect(db.state.remote.size).toBe(0); expect(db.state.row.imagePublicId).toBeNull();
  });
  it('C03 cleans timeout after remote storage once grace expires', async () => {
    cloud.upload.mockImplementationOnce(async (buffer, id) => { db.state.remote.set(id, fixture.resource()); throw error('timeout'); });
    await expect(replace()).rejects.toMatchObject({ status: 502 });
    expect(db.state.remote.size).toBe(1); later(); await images.recover();
    expect(db.state.remote.size).toBe(0); expect(await files()).toEqual([]);
  });
  it('C04 three definitive rejections create no persistent recovery work', async () => {
    cloud.upload.mockRejectedValue(Object.assign(error('definite rejection'), { imageFailure: 'definitive' }));
    const outcomes = await Promise.allSettled([replace(), replace(), replace()]);
    expect(outcomes.every(value => value.status === 'rejected')).toBe(true);
    for (let day = 0; day < 3; day++) { later(86400000); await images.recover(); }
    expect(await files()).toHaveLength(0); expect(cloud.inspect).not.toHaveBeenCalled();
  });
  it.each([['C05', null], ['C06', undefined]])('%s preserves uncertain incomplete result with controlled provider error', async (id, result) => {
    cloud.upload.mockResolvedValueOnce(result);
    await expect(replace()).rejects.toMatchObject({ status: 502 });
    expect(await files()).toHaveLength(1); expect(db.state.row.imagePublicId).toBeNull();
  });
  it.each([['C07', {}], ['C08', { public_id: 'inconsistent', format: 'png' }], ['C09', { format: 'gif' }]])('%s rejects incomplete/inconsistent result and compensates only requested resource', async (id, result) => {
    const normal = cloud.upload.getMockImplementation();
    cloud.upload.mockImplementationOnce(async (...args) => { await normal(...args); return result; });
    await expect(replace()).rejects.toMatchObject({ status: 502 });
    later(); await images.recover();
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0);
    expect(cloud.destroy).not.toHaveBeenCalledWith('inconsistent'); expect(await files()).toEqual([]);
  });
  it('C10 leaves failed inspection pending then recovers after connectivity returns', async () => {
    db.state.faults.beforeUpdate = error('SQL'); cloud.inspect.mockRejectedValueOnce(error('network'));
    await expect(replace()).rejects.toThrow('Synthetic SQL'); expect(db.state.remote.size).toBe(1);
    later(); await images.recover(); expect(db.state.remote.size).toBe(0); expect(await files()).toEqual([]);
  });
  it('C15 rejects contradictory provider resource type without committing SQL', async () => {
    const normal = cloud.upload.getMockImplementation();
    cloud.upload.mockImplementationOnce(async (...args) => ({ ...await normal(...args), resource_type: 'video', type: 'private' }));
    await expect(replace()).rejects.toMatchObject({status:502});expect(db.state.row.imagePublicId).toBeNull();
    later();await images.recover();expect(db.state.remote.size).toBe(0);
  });
});

describe('D: transactional model with separate pending/committed rows and audit', () => {
  it('D01 fails before any remote operation if initial lookup loses connection', async () => {
    db.state.faults.lookup = error('connection'); await expect(replace()).rejects.toThrow('Synthetic connection');
    expect(cloud.upload).not.toHaveBeenCalled(); expect(await files()).toEqual([]);
  });
  it.each([['D02', 'transaction'], ['D03', 'beforeUpdate'], ['D04', 'afterUpdate'], ['D05', 'commitBefore']])('%s rolls back %s and compensates uploaded resource', async (id, fault) => {
    const old = seedImage(); db.state.faults[fault] = error(fault);
    await expect(replace()).rejects.toThrow('Synthetic');
    expect(db.state.row.imagePublicId).toBe(old); expect([...db.state.remote.keys()]).toEqual([old]);
    expect(db.state.audits).toEqual([]); expect(await files()).toEqual([]);
  });
  it('D06 preserves a committed reference when commit acknowledgment is lost', async () => {
    db.state.faults.commitAfter = error('acknowledgment lost');
    await expect(replace()).rejects.toThrow('Synthetic acknowledgment lost');
    expect(db.state.row.imagePublicId).toBeTruthy(); expect(db.state.remote.has(db.state.row.imagePublicId)).toBe(true);
    expect(cloud.destroy).not.toHaveBeenCalled(); expect(db.state.audits).toHaveLength(1); expect(await files()).toEqual([]);
  });
  it('D07 preserves journal during post-commit SQL outage, then protects committed image', async () => {
    db.state.faults.count = error('post-commit connection'); const id = await replace();
    expect(await files()).toHaveLength(1); later(); await images.recover();
    expect(db.state.row.imagePublicId).toBe(id); expect(db.state.remote.has(id)).toBe(true);
    expect(cloud.destroy).not.toHaveBeenCalled(); expect(await files()).toEqual([]);
  });
  it('D08 rolls back image and successful audit together when audit insert fails', async () => {
    db.state.faults.audit = error('audit'); await expect(replace()).rejects.toThrow('Synthetic audit');
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.audits).toEqual([]); expect(db.state.remote.size).toBe(0);
  });
});

describe('E: replacement, deletion, ownership markers and soft deletion', () => {
  it('E01 replaces successfully and removes only superseded unreferenced managed image', async () => {
    const old = seedImage(); const next = await replace();
    expect(next).not.toBe(old); expect(db.state.row.imagePublicId).toBe(next);
    expect([...db.state.remote.keys()]).toEqual([next]); expect(db.state.audits[0].action).toBe('producto.imagen');
  });
  it('E02 failed upload leaves original image and reference unchanged', async () => {
    const old = seedImage(); cloud.upload.mockRejectedValueOnce(error('upload'));
    await expect(replace()).rejects.toMatchObject({ status: 502 });
    expect(db.state.row.imagePublicId).toBe(old); expect(db.state.remote.has(old)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
  });
  it('E03 failed deletion of old image is retried without losing new reference', async () => {
    const old = seedImage(); cloud.destroy.mockRejectedValueOnce(error('deletion')); const next = await replace();
    expect(db.state.remote.has(old)).toBe(true); expect(await files()).toHaveLength(1);
    later(); await images.recover(); expect(db.state.remote.has(old)).toBe(false); expect(db.state.remote.has(next)).toBe(true);
    expect(db.state.row.imagePublicId).toBe(next); expect(await files()).toEqual([]);
  });
  it('E04 removes reference and managed resource with transactional audit', async () => {
    seedImage(); await remove(); expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0);
    expect(db.state.audits[0].action).toBe('producto.imagen.retirar'); expect(await files()).toEqual([]);
  });
  it('E05 failed remove audit rolls back reference and cannot delete resource', async () => {
    const old = seedImage(); db.state.faults.audit = error('audit'); await expect(remove()).rejects.toThrow('Synthetic audit');
    expect(db.state.row.imagePublicId).toBe(old); expect(db.state.remote.has(old)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
  });
  it.each([['E06', 'historical/unmanaged', fixture.resource()], ['E07', null, { context: { custom: { catalog_owner: 'another-app', product_id: '701' } } }],
    ['E08', null, { context: { custom: { catalog_owner: 'secure-ecommerce-api', product_id: '999' } } }], ['E09', null, {}]])('%s archives historical/foreign/missing-context resources without deletion', async (id, publicId, resource) => {
    const old = seedImage(publicId || fixture.managedId(), resource); await remove();
    expect(db.state.remote.has(old)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
    expect((await files())[0]).toMatch(/\.preserved\.json$/);
  });
  it('E10 never deletes an image referenced by another row', async () => {
    const old = seedImage(); db.state.extraReferences.push(old); await remove();
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.has(old)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
  });
  it('E11 recovery preserves referenced image of a logically deleted product', async () => {
    db.state.faults.count = error('outage'); const id = await replace(); db.state.row.deletedAt = new Date();
    later(); await images.recover(); expect(db.state.remote.has(id)).toBe(true); expect(await files()).toEqual([]);
    expect(db.Product.count).toHaveBeenCalledWith(expect.objectContaining({ paranoid: false }));
  });
  it('E12 refuses already soft-deleted product before upload', async () => {
    db.state.row.deletedAt = new Date(); await expect(replace()).rejects.toMatchObject({ status: 404 }); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('E13 no-image removal is idempotent for remote resources', async () => {
    await remove(); await remove(); expect(db.state.row.imagePublicId).toBeNull(); expect(cloud.destroy).not.toHaveBeenCalled();
  });
});

describe('F: concurrent flows with deterministic transactional scheduling', () => {
  it('F01 two replacements retain exactly the final committed resource', async () => {
    const results = await Promise.all([replace(), replace()]);
    expect(results).toContain(db.state.row.imagePublicId); expect([...db.state.remote.keys()]).toEqual([db.state.row.imagePublicId]);
  });
  it.each([['F02a', 'remove-first'], ['F02b', 'upload-first']])('%s upload and removal preserve consistent final state', async (id, order) => {
    const old = seedImage();
    if (order === 'remove-first') {
      const gate = fixture.deferred(), entered = fixture.deferred(), normal = cloud.upload.getMockImplementation();
      cloud.upload.mockImplementationOnce(async (...args) => { const value = await normal(...args); entered.resolve(); await gate.promise; return value; });
      const pending = replace(); await entered.promise; await remove(); gate.resolve(); await pending;
      expect(db.state.remote.has(db.state.row.imagePublicId)).toBe(true); expect(db.state.remote.size).toBe(1);
    } else {
      const gate = fixture.deferred(), entered = fixture.deferred(), normal = cloud.inspect.getMockImplementation();
      cloud.inspect.mockImplementationOnce(async publicId => {
        expect(publicId).toBe(old); entered.resolve(); await gate.promise; return normal(publicId);
      });
      const pending = replace(); await entered.promise;
      const deletion = remove(); gate.resolve(); await Promise.all([pending, deletion]);
      expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0);
    }
  });
  it.each([['F03', 'suspension', 403], ['F04', 'soft-delete', 404]])('%s rechecks %s after provider operation', async (id, change, status) => {
    const normal = cloud.upload.getMockImplementation();
    cloud.upload.mockImplementationOnce(async (...args) => {
      const value = await normal(...args);
      if (change === 'suspension') db.state.accounts.get(db.state.owner).seller.status = 'SUSPENDED';
      else db.state.row.deletedAt = new Date(); return value;
    });
    await expect(replace()).rejects.toMatchObject({ status });
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0); expect(db.state.audits).toEqual([]);
  });
});

describe('G/H: local recovery faults and independent environment simulation', () => {
  it('G03 preserves partial journal and reports invalid record without contacting provider', async () => {
    const name = crypto.createHash('sha256').update(fixture.managedId()).digest('hex') + '.json';
    await fs.writeFile(path.join(directory, name), '{"publicId":');
    await images.recover(); await images.recover(); expect(await files()).toHaveLength(1);
    expect(cloud.inspect).not.toHaveBeenCalled(); expect(logs.filter(row => row.event === 'image.cleanup.invalid')).toHaveLength(2);
  });
  it('G04 denies upload before remote operation when directory cannot be written', async () => {
    jest.spyOn(fs, 'mkdir').mockRejectedValueOnce(Object.assign(error('permission'), { code: 'EACCES' }));
    await expect(replace()).rejects.toMatchObject({ status: 503 }); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('G05 denies upload and closes journal file on ENOSPC', async () => {
    const close = jest.fn(async () => {});
    jest.spyOn(fs, 'open').mockResolvedValueOnce({ writeFile: jest.fn(async () => { throw Object.assign(error('full'), { code: 'ENOSPC' }); }), close });
    await expect(replace()).rejects.toMatchObject({ code: 'ENOSPC' }); expect(close).toHaveBeenCalledTimes(1); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('G06 failed journal fsync prevents remote operation', async () => {
    const close = jest.fn(async () => {});
    jest.spyOn(fs, 'open').mockResolvedValueOnce({ writeFile: jest.fn(async () => {}), sync: jest.fn(async () => { throw error('fsync'); }), close });
    await expect(replace()).rejects.toThrow('Synthetic fsync'); expect(close).toHaveBeenCalledTimes(1); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('G07 invalid hashed record cannot redirect cleanup to another public identifier', async () => {
    await fs.writeFile(path.join(directory, '0'.repeat(64) + '.json'), JSON.stringify({ publicId: fixture.managedId(), productId: 701, notBefore: 0 }));
    await images.recover(); expect(cloud.inspect).not.toHaveBeenCalled(); expect(cloud.destroy).not.toHaveBeenCalled();
  });
  it('G12 journal storage failure for old image rolls back replacement and compensates new resource', async () => {
    const old = seedImage(), oldHash = crypto.createHash('sha256').update(old).digest('hex');
    const original = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementation((name, ...args) => {
      if (String(name).endsWith(oldHash + '.json')) return Promise.reject(Object.assign(error('full'), { code: 'ENOSPC' }));
      return original(name, ...args);
    });
    await expect(replace()).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(db.state.row.imagePublicId).toBe(old); expect([...db.state.remote.keys()]).toEqual([old]); expect(await files()).toEqual([]);
  });
  it('H01 independent database preserves shared image belonging to original environment', async () => {
    const shared = seedImage(), otherEnvironment = { imagePublicId: shared };
    const otherDirectory = await fixture.temporaryDirectory();
    try {
      process.env.CLOUDINARY_CLEANUP_DIR = otherDirectory;
      db.state.identity.uuid = '22222222-2222-4222-8222-222222222222';
      await remove();
      expect(db.state.row.imagePublicId).toBeNull(); expect(otherEnvironment.imagePublicId).toBe(shared);
      expect(db.state.remote.has(otherEnvironment.imagePublicId)).toBe(true); expect(cloud.destroy).not.toHaveBeenCalled();
      expect((await fixture.journalFiles(otherDirectory))[0]).toMatch(/\.preserved\.json$/);
    } finally { process.env.CLOUDINARY_CLEANUP_DIR = directory; await fixture.removeDirectory(otherDirectory); }
  });
});
