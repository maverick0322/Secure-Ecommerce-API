'use strict';

jest.mock('../../models', () => require('../support/image-phase2-fixture').makeModels());
jest.mock('../../services/cloudinary.service', () => Object.fromEntries(
  ['credentials', 'upload', 'inspect', 'destroy', 'deliveryUrl'].map(name => [name, jest.fn()])));

const express = require('express');
const request = require('supertest');
const crypto = require('node:crypto');
const https = require('node:https');
const fs = require('node:fs/promises');
const db = require('../../models');
const cloud = require('../../services/cloudinary.service');
const runtime = require('../../services/auth-runtime.service');
const logger = require('../../services/structured-logger.service');
const fixture = require('../support/image-phase2-fixture');
const { createAccessTokenService } = require('../../services/rs256-access-token.service');
const uploadMiddleware = require('../../middlewares/upload.middleware');

const parsed = jest.fn();
const originalSingle = uploadMiddleware.upload.single;
uploadMiddleware.upload.single = function (...args) {
  const middleware = originalSingle.apply(this, args);
  return (req, res, next) => { parsed(); return middleware(req, res, next); };
};
const routes = require('../../routes/products.routes');
uploadMiddleware.upload.single = originalSingle;
const app = express();
app.use(require('../../middlewares/http-logging.middleware'));
app.use(require('../../middlewares/audit-logs.middleware'));
app.use('/api/products', routes);
app.use(require('../../middlewares/errorhandler.middleware'));

let keys, directory, now, tokens, sessions, revoked, logs;
beforeAll(() => { keys = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 }); });
beforeEach(async () => {
  db.reset(); fixture.configureCloud(cloud, db.state); jest.clearAllMocks(); parsed.mockClear();
  directory = await fixture.temporaryDirectory();
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLEANUP_DIR: directory, CLOUDINARY_CLOUD_NAME: 'synthetic' });
  await fixture.prepareOwnership(db);
  now = Date.now(); revoked = new Set(); sessions = new Map(); logs = [];
  tokens = createAccessTokenService({ issuer: 'phase2', audience: 'phase2-local', activeKid: 'ephemeral',
    privateKey: keys.privateKey, publicKeys: new Map([['ephemeral', keys.publicKey]]), now: () => now });
  jest.spyOn(runtime, 'getTokens').mockReturnValue(tokens);
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ versions: { derive: () => 'fixture-version' },
    imageLimits: require('../../services/image-limits.service').createImageLimits(require('../support/image-admission-double').createAdmissionDouble()),
    sessions: { check: jest.fn(async ({ userId, sessionId }) => {
      if (revoked.has(sessionId) || sessions.get(sessionId) !== userId) {
        const error = new Error('Synthetic revoked session'); error.name = 'AuthSessionError'; throw error;
      }
    }) } });
  const safeLogger = logger.createLogger({ sink: line => logs.push(JSON.parse(line)) });
  jest.spyOn(logger, 'log').mockImplementation(safeLogger.log);
  jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('External network forbidden'); });
});
afterEach(async () => { jest.restoreAllMocks(); await fixture.removeDirectory(directory); });

function identity(kind = 'owner') {
  let account = db.state.accounts.get(db.state.owner);
  if (kind !== 'owner') {
    account = { ...account, id: crypto.randomUUID() };
    account.seller = { userId: account.id, status: 'APPROVED' };
    if (['BUYER', 'ADMIN'].includes(kind)) { delete account.seller; account[kind.toLowerCase()] = { userId: account.id }; }
    else if (['PENDING', 'REJECTED', 'SUSPENDED'].includes(kind)) account.seller.status = kind;
    else if (kind === 'inactive') account.status = 'SUSPENDED';
    else if (kind === 'unverified') account.emailVerifiedAt = null;
    db.state.accounts.set(account.id, account);
  }
  const sid = crypto.randomUUID(); sessions.set(sid, account.id);
  return { account, sid, token: tokens.sign({ sub: account.id, sid }) };
}
function put(buffer = fixture.png, name = 'fixture.png', type = 'image/png', auth = identity()) {
  return request(app).put('/api/products/701/image').set('Authorization', `Bearer ${auth.token}`)
    .attach('image', buffer, { filename: name, contentType: type });
}

describe('A: HTTP authentication before multipart parsing', () => {
  const cases = [['A01', 'missing', 401], ['A02', 'invalid', 401], ['A03', 'expired', 401], ['A04', 'revoked', 401],
    ['A05', 'BUYER', 403], ['A06', 'ADMIN', 403], ['A07', 'PENDING', 403], ['A08', 'REJECTED', 403],
    ['A09', 'SUSPENDED', 403], ['A10', 'inactive', 403], ['A11', 'unverified', 403], ['A12', 'foreign', 404]];
  it.each(cases)('%s rejects %s with %i before parser/provider, PUT and DELETE', async (id, kind, status) => {
    const auth = identity(['missing', 'invalid', 'expired', 'revoked'].includes(kind) ? 'owner' : kind);
    if (kind === 'expired') now += 300000;
    if (kind === 'revoked') revoked.add(auth.sid);
    for (const method of ['put', 'delete']) {
      const req = request(app)[method]('/api/products/701/image');
      if (kind !== 'missing') req.set('Authorization', kind === 'invalid' ? 'Bearer malformed' : `Bearer ${auth.token}`);
      if (method === 'put') req.attach('image', fixture.png, 'fixture.png');
      const response = await req;
      expect(response.status).toBe(status);
    }
    expect(parsed).not.toHaveBeenCalled(); expect(cloud.upload).not.toHaveBeenCalled();
    expect(cloud.inspect).not.toHaveBeenCalled(); expect(cloud.destroy).not.toHaveBeenCalled();
    expect(db.state.row.imagePublicId).toBeNull();
  });
});

describe('B: full local validation; mock provider deliberately does not decode', () => {
  it.each([['B01', 'JPEG', fixture.jpeg, 'fixture.jpeg', 'image/jpeg'], ['B02', 'PNG', fixture.png, 'fixture.png', 'image/png'],
    ['B03', 'WebP', fixture.webp, 'fixture.webp', 'image/webp']])('%s accepts a generated valid %s fixture', async (id, type, bytes, name, mime) => {
    const response = await put(bytes, name, mime); expect(response.status).toBe(200); expect(cloud.upload).toHaveBeenCalledTimes(1);
  });
  it.each([['B04', 2 * 1024 * 1024, 200], ['B05', 2 * 1024 * 1024 + 1, 413]])('%s enforces byte boundary %i', async (id, size, status) => {
    const bytes = fixture.pngAtSize(size);
    expect((await put(bytes)).status).toBe(status);
    expect(cloud.upload).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });
  it.each([['B06', Buffer.alloc(0), 'empty.png', 'image/png'], ['B07', fixture.png, 'fake.jpg', 'image/png'],
    ['B08', fixture.png, 'fake.jpg', 'image/jpeg'], ['B09', fixture.png, 'fake.svg', 'image/svg+xml'],
    ['B10', Buffer.from('not an image'), 'fake.png', 'image/png']])('%s rejects empty/spoofed/unsupported content', async (id, bytes, name, mime) => {
    expect((await put(bytes, name, mime)).status).toBe(400); expect(cloud.upload).not.toHaveBeenCalled();
  });
  const corrupt = Buffer.from(fixture.png); corrupt[29] ^= 1;
  it.each([['B11', fixture.png.subarray(0, 8), 'PNG signature only'], ['B12', fixture.jpeg.subarray(0, 4), 'JPEG signature only'],
    ['B13', fixture.webp.subarray(0, 12), 'WebP signature only'], ['B14', corrupt, 'invalid PNG checksum'],
    ['B15', Buffer.concat([fixture.png, Buffer.from('<script>synthetic-polyglot</script>')]), 'PNG with appended script'],
    ['B16', fixture.pngWithDimensions(100000, 100000), 'declared 10 billion pixels'],
    ['B17', fixture.declaredAnimation(), 'declared million animation frames']].map(([id, bytes, description]) => ({ id, bytes, description })))('$id rejects $description locally', async ({ id, bytes }) => {
    const mime = id === 'B12' ? 'image/jpeg' : id === 'B13' ? 'image/webp' : 'image/png';
    const name = id === 'B12' ? 'fixture.jpg' : id === 'B13' ? 'fixture.webp' : 'fixture.png';
    expect((await put(bytes, name, mime)).status).toBe(400);
    expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('B18 incomplete multipart returns 400 without contacting provider', async () => {
    const response = await request(app).put('/api/products/701/image').set('Authorization', `Bearer ${identity().token}`)
      .set('Content-Type', 'multipart/form-data; boundary=phase2').send('--phase2\r\nContent-Disposition: form-data; name="image"; filename="x.png"\r\nContent-Type: image/png\r\n\r\ntruncated');
    expect(response.status).toBe(400);
    expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('B19 rejects unexpected multipart fields', async () => {
    const response = await put().field('sellerId', 'forged');
    expect(response.status).toBe(400); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it('B20 rejects multiple files', async () => {
    const response = await put().attach('image', fixture.png, 'second.png');
    expect(response.status).toBe(400); expect(cloud.upload).not.toHaveBeenCalled();
  });
  it.each([['B21', fixture.largePixelPNG], ['B22', fixture.manyFramePNG], ['B23', fixture.pngZipPolyglot]])('%s rejects pixel/frame-heavy or PNG-ZIP fixture locally', async (id, generate) => {
    const bytes = generate(); expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect((await put(bytes)).status).toBe(400); expect(cloud.upload).not.toHaveBeenCalled();
  });
});

describe('F/I: bounded resource usage and safe observable outcomes', () => {
  it('F05 limits six requests at concurrency three before file processing', async () => {
    const start = Date.now(), auth = identity(); let current = 0, peak = 0;
    const upload = cloud.upload.getMockImplementation();
    cloud.upload.mockImplementation(async (...args) => {
      current++; peak = Math.max(peak, current);
      try { await new Promise(resolve => setTimeout(resolve, 20)); return await upload(...args); }
      finally { current--; }
    });
    const statuses = [];
    for (let batch = 0; batch < 2; batch++) {
      const responses = await Promise.all(Array.from({ length: 3 }, () => put(fixture.png, 'fixture.png', 'image/png', auth)));
      statuses.push(...responses.map(response => response.status));
    }
    expect(statuses.filter(status => status === 200)).toHaveLength(2);
    expect(statuses.filter(status => status === 429)).toHaveLength(4);
    expect(peak).toBe(1); expect(Date.now() - start).toBeLessThan(10000);
    expect(cloud.upload).toHaveBeenCalledTimes(2); expect(parsed).toHaveBeenCalledTimes(2); expect(db.state.remote.size).toBe(1);
  }, 12000);
  it('I01 records successful actor, target and correlated request, then removal', async () => {
    expect((await put()).status).toBe(200);
    const event = db.state.audits.find(row => row.action === 'producto.imagen');
    expect(event).toMatchObject({ actorUserId: db.state.owner, targetId: '701', outcome: 'SUCCESS' });
    expect(logs.some(row => row.requestId === event.details.requestId && row.statusCode === 200)).toBe(true);
    const response = await request(app).delete('/api/products/701/image').set('Authorization', `Bearer ${identity().token}`);
    expect(response.status).toBe(204); expect(db.state.audits.some(row => row.action === 'producto.imagen.retirar')).toBe(true);
  });
  it.each([['I02', 'foreign', 404], ['I03', 'invalid-file', 400], ['I04', 'provider', 502], ['I05', 'sql', 500]])('%s REPRODUCED H4: %s lacks a business failure event', async (id, kind, status) => {
    if (kind === 'provider') cloud.upload.mockRejectedValue(new Error('synthetic-private-diagnostic'));
    if (kind === 'sql') db.state.faults.beforeUpdate = new Error('synthetic-private-diagnostic');
    const response = await put(kind === 'invalid-file' ? Buffer.from('invalid') : fixture.png, 'fixture.png', 'image/png', identity(kind === 'foreign' ? 'foreign' : 'owner'));
    expect(response.status).toBe(status); expect(db.state.audits).toHaveLength(0);
    expect(logs.filter(row => row.event === 'http.request')).toHaveLength(1);
    expect(logs.find(row => row.event === 'http.request').route).toBe('/api/products/:id/image');
    expect(response.text).not.toContain('synthetic-private-diagnostic'); expect(JSON.stringify(logs)).not.toContain('synthetic-private-diagnostic');
  });
  it('I06 fails closed on audit write error, rolls back SQL and compensates remote upload', async () => {
    db.state.faults.audit = new Error('synthetic-private-diagnostic');
    const response = await put(); expect(response.status).toBe(500);
    expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0); expect(db.state.audits).toHaveLength(0);
    expect(logs.some(row => row.event === 'audit.write.failed' && row.critical)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('synthetic-private-diagnostic'); expect(response.text).not.toContain('synthetic-private-diagnostic');
  });
  it('I07 preserves denial when its audit write fails', async () => {
    db.state.faults.audit = new Error('synthetic-private-diagnostic');
    const response = await put(fixture.png, 'fixture.png', 'image/png', identity('BUYER'));
    expect(response.status).toBe(403); expect(cloud.upload).not.toHaveBeenCalled(); expect(parsed).not.toHaveBeenCalled();
    expect(logs.some(row => row.event === 'audit.write.failed')).toBe(true);
  });
  it('I08 never serializes authorization header, provider payload or request body', async () => {
    const auth = identity(); cloud.upload.mockRejectedValue(new Error('synthetic-private-diagnostic'));
    const response = await put(fixture.png, 'fixture.png', 'image/png', auth);
    const output = JSON.stringify(logs) + response.text + JSON.stringify(db.state.audits);
    expect(response.status).toBe(502); expect(output.includes(auth.token)).toBe(false);
    expect(output.includes('synthetic-private-diagnostic')).toBe(false); expect(output.includes('Authorization')).toBe(false);
    expect(await fixture.journalFiles(directory)).toHaveLength(1);
  });
  it.each(['null','incomplete','contradictory','wrong-format'])('I09 rejects %s success payload safely before SQL and preserves recovery',async kind=>{
    const normal=cloud.upload.getMockImplementation(),auth=identity();
    cloud.upload.mockImplementationOnce(async(...args)=>{
      const valid=await normal(...args);
      if(kind==='null')return null;
      if(kind==='incomplete')return {public_id:valid.public_id,api_key:'SYNTHETIC_PRIVATE'};
      if(kind==='wrong-format')return {...valid,format:'jpg',api_key:'SYNTHETIC_PRIVATE'};
      return {...valid,type:'private',resource_type:'video',api_key:'SYNTHETIC_PRIVATE'};
    });
    const response=await put(fixture.png,'fixture.png','image/png',auth);
    expect(response.status).toBe(502);expect(db.state.row.imagePublicId).toBeNull();expect(cloud.upload).toHaveBeenCalledTimes(1);
    expect(cloud.destroy).not.toHaveBeenCalled();expect(await fixture.journalFiles(directory)).toHaveLength(1);
    expect(JSON.stringify(logs)+response.text+JSON.stringify(db.state.audits)).not.toMatch(/SYNTHETIC_PRIVATE|TypeError/);
    expect(response.text).not.toContain(auth.token);
  });
});
