'use strict';

// Entirely synthetic, in-memory SQL/provider fixtures. Never reads .env or connects.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGPUaLrDwMDAxAAGABG+AYoOO5YVAAAAAElFTkSuQmCC', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwChRRRX2p8if//Z', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAAAQAgCdASoCAAIAAUAmJaACdLoB+AH4AAPIAP7ni//6s+mhF/ev/+jBv8ovljAA', 'base64');

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}
function pngAtSize(size) {
  const padding=Buffer.alloc(size-png.length-12,65);
  padding[0]=80;padding[1]=0;
  return Buffer.concat([png.subarray(0,png.length-12),chunk('tEXt',padding),png.subarray(png.length-12)]);
}
function pngWithDimensions(width, height) {
  // Headers declare dimensions; payload stays tiny. No large allocation/decode.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function declaredAnimation() {
  // Deliberately inconsistent APNG declaration: exercises absence of local checks.
  const control = Buffer.alloc(8); control.writeUInt32BE(1000000);
  return Buffer.concat([png.subarray(0, 33), chunk('acTL', control), png.subarray(33)]);
}
function largePixelPNG() {
  // Valid 100-megapixel, one-bit grayscale PNG: bounded 12.51 MB encode input.
  const width = 10000, height = 10000, header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 1;
  const encoded = zlib.deflateSync(Buffer.alloc((Math.ceil(width / 8) + 1) * height));
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', header), chunk('IDAT', encoded), chunk('IEND', Buffer.alloc(0))]);
}
function manyFramePNG() {
  // Valid APNG container with 2048 tiny frames; never decoded or sent externally.
  const header = Buffer.alloc(13), animation = Buffer.alloc(8);
  header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  animation.writeUInt32BE(2048); const parts = [png.subarray(0, 8), chunk('IHDR', header), chunk('acTL', animation)];
  const frame = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 255])); let sequence = 0;
  for (let index = 0; index < 2048; index++) {
    const control = Buffer.alloc(26); control.writeUInt32BE(sequence++); control.writeUInt32BE(1, 4); control.writeUInt32BE(1, 8);
    control.writeUInt16BE(1, 20); control.writeUInt16BE(100, 22); parts.push(chunk('fcTL', control));
    if (index === 0) parts.push(chunk('IDAT', frame));
    else { const seq = Buffer.alloc(4); seq.writeUInt32BE(sequence++); parts.push(chunk('fdAT', Buffer.concat([seq, frame]))); }
  }
  parts.push(chunk('IEND', Buffer.alloc(0))); return Buffer.concat(parts);
}
function pngZipPolyglot() {
  // Both a PNG and a valid stored ZIP, with correct absolute ZIP offsets.
  const name = Buffer.from('fixture.txt'), content = Buffer.from('synthetic'), checksum = crc32(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
  const entry = Buffer.concat([local, name, content]), central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(png.length, 42);
  const directory = Buffer.concat([central, name]), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(png.length + entry.length, 16);
  return Buffer.concat([png, entry, directory, end]);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let testScope = { version: 1, id: '11111111-1111-4111-8111-111111111111', binding: 'a'.repeat(64) };
const managedId = (scope = testScope) => `${require('../../services/image-ownership.service').prefix(scope, 701)}${crypto.randomUUID()}`;
const resource = (scope = testScope) => ({ context: { custom: require('../../services/image-ownership.service').context(scope, 701) } });
function uploadResult(publicId,format='png',scope=testScope,productId=701) {
  return {public_id:publicId,format,resource_type:'image',type:'upload',asset_id:'a'.repeat(32),version:1,
    bytes:100,width:2,height:2,secure_url:`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME||'synthetic'}/image/upload/v1/${publicId}.${format}`,
    context:{custom:require('../../services/image-ownership.service').context(scope,productId)}};
}
async function prepareOwnership(db) {
  testScope = await require('../../services/image-ownership.service').current();
  if (db?.state) db.state.scope = testScope;
  return testScope;
}
async function journalFiles(directory) {
  return (await fs.readdir(directory)).filter(name => name !== '.ownership.json');
}
async function temporaryDirectory() { return fs.mkdtemp(path.join(os.tmpdir(), 'secure-ecommerce-phase2-')); }
async function removeDirectory(directory) {
  const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('secure-ecommerce-phase2-')) throw new Error('Unsafe fixture cleanup');
  await fs.rm(resolved, { recursive: true, force: true });
}
function makeModels() {
  const state = {};
  let tail = Promise.resolve();
  const db = { Sequelize: require('sequelize'), state };
  db.reset = () => {
    const owner = crypto.randomUUID();
    Object.assign(state, { owner, row: { id: 701, sellerId: owner, title: 'Synthetic phase 2', price: '1.00', stock: 1, imagePublicId: null, deletedAt: null },
      accounts: new Map(), remote: new Map(), audits: [], extraReferences: [], faults: {}, commits: 0, rollbacks: 0,
      identity: { uuid: '11111111-1111-4111-8111-111111111111', db: 'phase2_test' }, openTransactions: 0 });
    state.accounts.set(owner, { id: owner, email: 'synthetic@example.invalid', name: 'Synthetic', status: 'ACTIVE', deletedAt: null,
      emailVerifiedAt: new Date(), passwordHash: 'non-secret-fixture-version', seller: { userId: owner, status: 'APPROVED' } });
    tail = Promise.resolve();
  };
  function fault(key) {
    if (!state.faults[key]) return;
    const error = state.faults[key]; delete state.faults[key]; throw error;
  }
  db.sequelize = {
    transaction: jest.fn(async callback => {
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
      state.openTransactions++;
      const tx = { LOCK: { UPDATE: 'UPDATE' }, row: { ...state.row }, audits: [], changed: false };
      try {
        fault('transaction');
        const result = await callback(tx);
        if (tx.changed) fault('commitBefore');
        state.row = tx.row; state.audits.push(...tx.audits); state.commits++;
        if (tx.changed) fault('commitAfter');
        return result;
      } catch (error) { state.rollbacks++; throw error; }
      finally { state.openTransactions--; release(); }
    }),
    query: jest.fn(async sql => {
      if (sql === 'SELECT @@server_uuid AS uuid, DATABASE() AS db') return [[{ ...state.identity }], {}];
      throw new Error('Real SQL forbidden in phase 2 double');
    })
  };
  db.Product = {
    findByPk: jest.fn(async (id, options = {}) => {
      fault('lookup');
      const row = options.transaction?.row || state.row;
      if (id !== row.id || (row.deletedAt && options.paranoid !== false)) return null;
      return { ...row, update: jest.fn(async (values, { transaction }) => {
        fault('beforeUpdate'); Object.assign(transaction.row, values); transaction.changed = true; fault('afterUpdate');
      }) };
    }),
    count: jest.fn(async options => {
      fault('count'); const row = options.transaction?.row || state.row;
      return Number(row.imagePublicId === options.where.imagePublicId && (!row.deletedAt || options.paranoid === false)) +
        state.extraReferences.filter(value => value === options.where.imagePublicId).length;
    })
  };
  db.User = { findByPk: jest.fn(async id => state.accounts.get(id) || null) };
  db.User.unscoped = jest.fn(() => db.User);
  db.Seller = { findByPk: jest.fn(async id => state.accounts.get(id)?.seller || null) };
  db.Admin = { findByPk: jest.fn(async id => state.accounts.get(id)?.admin || null) };
  db.AuditLog = { create: jest.fn(async (event, options = {}) => {
    fault('audit'); (options.transaction ? options.transaction.audits : state.audits).push(event); return event;
  }) };
  for (const name of ['Buyer', 'Category', 'ProductCategory']) db[name] = {};
  db.reset(); return db;
}
function configureCloud(cloud, state) {
  for (const method of Object.values(cloud)) method.mockReset();
  cloud.credentials.mockReturnValue({});
  cloud.upload.mockImplementation(async (buffer, id, productId, scope) => {
    state.remote.set(id, resource(scope));
    return uploadResult(id,buffer[0] === 255 ? 'jpg' : buffer.toString('ascii', 0, 4) === 'RIFF' ? 'webp' : 'png',scope,productId);
  });
  cloud.inspect.mockImplementation(async id => state.remote.get(id) || null);
  cloud.destroy.mockImplementation(async id => { state.remote.delete(id); });
  cloud.deliveryUrl.mockImplementation(id => id ? `https://example.invalid/${id}` : null);
}
module.exports = { png, jpeg, webp, pngAtSize, pngWithDimensions, declaredAnimation, largePixelPNG, manyFramePNG, pngZipPolyglot, deferred, managedId, resource, uploadResult,
  temporaryDirectory, removeDirectory, makeModels, configureCloud, chunk, prepareOwnership, journalFiles };
