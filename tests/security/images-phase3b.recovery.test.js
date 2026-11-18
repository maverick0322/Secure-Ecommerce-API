'use strict';
jest.mock('../../models', () => require('../support/image-phase2-fixture').makeModels());
jest.mock('../../services/cloudinary.service', () => Object.fromEntries(['credentials','upload','inspect','destroy','deliveryUrl'].map(name => [name,jest.fn()])));
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const db = require('../../models');
const cloud = require('../../services/cloudinary.service');
const images = require('../../services/product-images.service');
const fixture = require('../support/image-phase2-fixture');
let directory, now, scope;
const replace = context => images.replace({id:db.state.owner},701,fixture.png,context);
const files = () => fixture.journalFiles(directory);
const journal = id => path.join(directory,createHash('sha256').update(id).digest('hex')+'.json');
beforeEach(async () => {
  db.reset(); fixture.configureCloud(cloud,db.state); jest.clearAllMocks();
  directory = await fixture.temporaryDirectory();
  jest.replaceProperty(process,'env',{...process.env,CLOUDINARY_CLEANUP_DIR:directory,CLOUDINARY_CLOUD_NAME:'synthetic'});
  scope = await fixture.prepareOwnership(db); now = Date.now(); jest.spyOn(Date,'now').mockImplementation(() => now);
  jest.spyOn(require('../../services/structured-logger.service'),'log').mockImplementation(() => {});
});
afterEach(async () => { jest.restoreAllMocks(); await fixture.removeDirectory(directory); });
async function seed(extra = {}) {
  const publicId = fixture.managedId(scope);
  await fs.writeFile(journal(publicId),JSON.stringify({version:2,scope,state:'settled',publicId,productId:701,notBefore:0,uploadConfirmed:false,watchMissing:true,...extra}));
  return publicId;
}
it.each(['definitive','transient','uncertain'])('R01 %s upload has controlled error and safe durable outcome',async imageFailure => {
  cloud.upload.mockRejectedValueOnce(Object.assign(new Error('SYNTHETIC_PRIVATE'),{imageFailure}));
  await expect(replace()).rejects.toMatchObject({status:502,message:'No se pudo cargar la imagen.'});
  expect(await files()).toHaveLength(imageFailure==='definitive'?0:1);
  expect(cloud.inspect).not.toHaveBeenCalled(); expect(cloud.destroy).not.toHaveBeenCalled();
});
it('R02 missing uncertain operation exhausts six persisted attempts then requires manual intervention',async () => {
  const id = await seed();
  for (let i=0;i<6;i++) {
    await images.recover();
    const task = JSON.parse(await fs.readFile(journal(id),'utf8'));
    expect(task.attempts).toBe(i+1);
    const sql = db.Product.count.mock.calls.length, remote = cloud.inspect.mock.calls.length;
    await images.recover(); expect(db.Product.count).toHaveBeenCalledTimes(sql); expect(cloud.inspect).toHaveBeenCalledTimes(remote);
    now = task.retryAt+1;
  }
  expect(JSON.parse(await fs.readFile(journal(id),'utf8')).manual).toBe(true);
  now+=365*86400000; await images.recover(); await images.recover();
  expect(cloud.inspect).toHaveBeenCalledTimes(6); expect(await files()).toHaveLength(1); expect(cloud.destroy).not.toHaveBeenCalled();
});
it('R03 persistent provider 429 is bounded and never resubmits the upload',async () => {
  await seed({uploadConfirmed:true,watchMissing:false});
  cloud.inspect.mockRejectedValue(Object.assign(new Error('Synthetic'),{imageFailure:'transient'}));
  for(let i=0;i<8;i++) {await images.recover(); now+=3600001;}
  expect(cloud.inspect).toHaveBeenCalledTimes(6); expect(cloud.upload).not.toHaveBeenCalled(); expect(await files()).toHaveLength(1);
});
it('R04 definitive cleanup authorization error stops automatic retries immediately',async () => {
  const id = await seed(); cloud.inspect.mockRejectedValue(Object.assign(new Error('Synthetic'),{imageFailure:'definitive'}));
  await images.recover(); now+=3600001; await images.recover();
  expect(cloud.inspect).toHaveBeenCalledTimes(1); expect(JSON.parse(await fs.readFile(journal(id),'utf8')).manual).toBe(true);
});
it('R05 persisted backoff and manual status survive service recreation',async () => {
  const id = await seed({attempts:3,retryAt:now+60000});
  let restarted;
  jest.isolateModules(() => {
    jest.doMock('../../models',()=>db); jest.doMock('../../services/cloudinary.service',()=>cloud);
    restarted = require('../../services/product-images.service');
  });
  await restarted.recover(); expect(cloud.inspect).not.toHaveBeenCalled(); expect(db.Product.count).not.toHaveBeenCalled();
  now+=60001; await restarted.recover();
  expect(JSON.parse(await fs.readFile(journal(id),'utf8')).attempts).toBe(4);
});
it('R06 bounds one cycle at 32 directory entries and makes progress without loading the backlog',async () => {
  for(let i=0;i<70;i++) await seed({manual:true});
  const before = images.recoveryMetrics().processed;
  await images.recover(); expect(images.recoveryMetrics().processed-before).toBeLessThanOrEqual(32);
  await images.recover(); await images.recover();
  expect(images.recoveryMetrics().processed-before).toBe(70);
  expect(cloud.inspect).not.toHaveBeenCalled(); expect(db.Product.count).not.toHaveBeenCalled(); expect(await files()).toHaveLength(70);
});
it('R07 durable backlog capacity fails closed before uploading and preserves all evidence',async () => {
  for(let i=0;i<1000;i++) await fs.writeFile(path.join(directory,`synthetic-${i}.preserved.json`),'{}');
  await expect(replace()).rejects.toMatchObject({status:503});
  expect(cloud.upload).not.toHaveBeenCalled(); expect(await files()).toHaveLength(1000);
});
it('R08 abandoned pending intent is never converted into settled by a failed SQL probe',async () => {
  const id = await seed({state:'pending'}); db.state.faults.count=new Error('Synthetic SQL');
  await images.recover(); now+=365*86400000; await images.recover();
  expect(JSON.parse(await fs.readFile(journal(id),'utf8')).state).toBe('pending');
  expect(db.Product.count).toHaveBeenCalledTimes(1); expect(cloud.inspect).not.toHaveBeenCalled();
});
it('R09 recovery preserves soft-deleted references and foreign images',async () => {
  const live = await seed({uploadConfirmed:true}); db.state.row.imagePublicId=live; db.state.row.deletedAt=new Date();
  db.state.remote.set(live,fixture.resource(scope));
  const foreign = await seed({uploadConfirmed:true}); db.state.remote.set(foreign,{context:{custom:{}}});
  await images.recover(); expect(db.state.remote.has(live)).toBe(true); expect(db.state.remote.has(foreign)).toBe(true);
  expect(cloud.destroy).not.toHaveBeenCalled();
});
it('R10 lost admission before SQL compensates only its own confirmed unreferenced upload',async () => {
  const check=jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(new Error('Synthetic lost lease'));
  await expect(replace({imagePermit:{check}})).rejects.toMatchObject({status:503,message:'Control de cargas no disponible.'});
  expect(db.state.row.imagePublicId).toBeNull(); expect(db.state.remote.size).toBe(0); expect(cloud.destroy).toHaveBeenCalledTimes(1);
});
it('R11 recovery diagnostics contain only bounded numeric counters',async () => {
  await seed({manual:true}); await images.recover();
  const metrics=images.recoveryMetrics(); expect(Object.values(metrics).every(Number.isSafeInteger)).toBe(true);
  expect(Object.keys(metrics).sort()).toEqual(['deferred','failed','invalid','manual','processed']);
});
it('R12 lost admission before contacting provider creates no unnecessary recovery work',async () => {
  const check=jest.fn().mockRejectedValue(new Error('Synthetic private diagnostic'));
  await expect(replace({imagePermit:{check}})).rejects.toMatchObject({status:503});
  expect(cloud.upload).not.toHaveBeenCalled();expect(await files()).toEqual([]);
});
