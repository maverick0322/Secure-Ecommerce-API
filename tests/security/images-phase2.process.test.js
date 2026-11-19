'use strict';

jest.mock('../../models', () => require('../support/image-phase2-fixture').makeModels());

const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { temporaryDirectory, removeDirectory, deferred, resource, journalFiles } = require('../support/image-phase2-fixture');
let directory, workers, shared;
beforeEach(async () => {
  directory = await temporaryDirectory(); workers = [];
  shared = { row: { id: 701, imagePublicId: null }, remote: new Map(), gate: null, hold: null,
    entered: deferred(), destroyed: [], operations: [] };
});
afterEach(async () => {
  for (const worker of workers) await worker.stop();
  await removeDirectory(directory);
});
async function worker() {
  // Deliberately do not inherit .env, keys, passwords or application connections.
  const env = { NODE_ENV: 'test', CLOUDINARY_CLEANUP_DIR: directory, CLOUDINARY_CLOUD_NAME: 'synthetic' };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME']) if (process.env[key]) env[key] = process.env[key];
  const child = fork(path.join(__dirname, '../support/image-phase2-worker.cjs'), [], {
    env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true
  });
  const ready = deferred(), commands = new Map(); let sequence = 0, stopped = false;
  // Capture no raw stdout/stderr; workers are forbidden to expose payloads.
  child.stdout.resume(); child.stderr.resume();
  const handle = {
    child,
    command(command, extra = {}) {
      const id = ++sequence, pending = deferred(); commands.set(id, pending);
      child.send({ command, id, ...extra }); return pending.promise;
    },
    async stop() {
      if (stopped) return; stopped = true;
      for (const pending of commands.values()) pending.resolve('worker-terminated'); commands.clear();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited;
    }
  };
  workers.push(handle);
  child.on('error', () => ready.reject(new Error('Synthetic worker could not start')));
  child.on('message', async message => {
    if (message.ready) { ready.resolve(); return; }
    if (message.result) {
      const pending = commands.get(message.result); if (!pending) return;
      commands.delete(message.result);
      if (message.error) pending.reject(new Error('Synthetic worker command failed')); else pending.resolve(message.value);
      return;
    }
    if (!message.rpc) return;
    const { operation, payload } = message; shared.operations.push(operation);
    let value;
    if (operation === 'identity') value = [[{ uuid: '11111111-1111-4111-8111-111111111111', db: 'phase2_test' }], {}];
    else if (operation === 'find') value = { ...shared.row };
    else if (operation === 'count') value = Number(shared.row.imagePublicId === payload.publicId);
    else if (operation === 'upload') {
      shared.remote.set(payload.publicId, resource(payload.scope)); value = require('../support/image-phase2-fixture').uploadResult(payload.publicId,'png',payload.scope);
      if (shared.failUpload) {
        shared.failUpload = false;
        if (child.connected) child.send({ reply: message.rpc, error: 'Synthetic response loss' });
        return;
      }
    } else if (operation === 'inspect') value = shared.remote.get(payload.publicId) || null;
    else if (operation === 'destroy') { shared.destroyed.push(payload.publicId); shared.remote.delete(payload.publicId); }
    else if (operation === 'commit') {
      if (shared.hold === 'commitBeforeApply') {
        shared.entered.resolve(); await shared.gate.promise;
        if (!child.connected) return;
      }
      shared.row = { ...shared.row, ...payload };
    }
    if (shared.hold === operation) { shared.entered.resolve(); await shared.gate.promise; }
    if (child.connected) child.send({ reply: message.rpc, value });
  });
  await Promise.race([ready.promise, new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic worker startup timeout')), 5000); timer.unref();
  })]);
  return handle;
}

it('G01 process termination during upload preserves unresolved intent for manual reconciliation', async () => {
  shared.hold = 'upload'; shared.gate = deferred(); const first = await worker();
  const pending = first.command('replace'); await shared.entered.promise;
  expect(shared.remote.size).toBe(1); expect(await journalFiles(directory)).toHaveLength(1);
  await first.stop(); await pending; shared.hold = null; shared.gate.resolve();
  const recovery = await worker(); await recovery.command('advance', { now: Date.now() + 180000 }); await recovery.command('recover');
  expect(shared.row.imagePublicId).toBeNull(); expect(shared.remote.size).toBe(1); expect(await journalFiles(directory)).toHaveLength(1);
  expect(shared.destroyed).toEqual([]);
}, 15000);

it('G02 process termination after SQL commit before acknowledgment preserves referenced image', async () => {
  shared.hold = 'commit'; shared.gate = deferred(); const first = await worker();
  const pending = first.command('replace'); await shared.entered.promise;
  expect(shared.row.imagePublicId).toBeTruthy(); await first.stop(); await pending; shared.hold = null; shared.gate.resolve();
  const recovery = await worker(); await recovery.command('advance', { now: Date.now() + 180000 }); await recovery.command('recover');
  expect(shared.remote.has(shared.row.imagePublicId)).toBe(true); expect(shared.destroyed).toEqual([]);
  expect(await journalFiles(directory)).toEqual([]);
}, 15000);

it('G08 two live processes do not clean active upload before 120-second grace', async () => {
  shared.hold = 'beforeCommit'; shared.gate = deferred(); const first = await worker(), second = await worker();
  const pending = first.command('replace'); await shared.entered.promise;
  await second.command('recover'); expect(shared.remote.size).toBe(1); expect(shared.destroyed).toEqual([]);
  shared.hold = null; shared.gate.resolve(); const id = await pending;
  expect(shared.row.imagePublicId).toBe(id); expect(shared.remote.has(id)).toBe(true);
}, 15000);

it('G09 prevents a second process deleting a live upload after grace, then commits a valid reference', async () => {
  shared.hold = 'beforeCommit'; shared.gate = deferred(); const first = await worker(), second = await worker();
  const pending = first.command('replace'); await shared.entered.promise;
  await second.command('advance', { now: Date.now() + 180000 }); await second.command('recover');
  expect(shared.destroyed).toEqual([]); expect(shared.remote.size).toBe(1);
  shared.hold = null; shared.gate.resolve(); const id = await pending;
  expect(shared.row.imagePublicId).toBe(id); expect(shared.remote.has(id)).toBe(true);
}, 15000);

it('G10 termination during uncommitted SQL update preserves unresolved orphan without deleting', async () => {
  shared.hold = 'commitBeforeApply'; shared.gate = deferred(); const first = await worker();
  const pending = first.command('replace'); await shared.entered.promise;
  expect(shared.row.imagePublicId).toBeNull(); await first.stop(); await pending;
  shared.hold = null; shared.gate.resolve(); const recovery = await worker();
  await recovery.command('advance', { now: Date.now() + 180000 }); await recovery.command('recover');
  expect(shared.row.imagePublicId).toBeNull(); expect(shared.remote.size).toBe(1); expect(shared.destroyed).toEqual([]);
}, 15000);

it('G11 two processes replace concurrently with one valid final reference', async () => {
  const first = await worker(); await first.command('scope'); const second = await worker();
  const ids = await Promise.all([first.command('replace'), second.command('replace')]);
  expect(ids).toContain(shared.row.imagePublicId);
  expect(shared.remote.has(shared.row.imagePublicId)).toBe(true);
  expect([...shared.remote.keys()]).toEqual([shared.row.imagePublicId]);
}, 15000);

it('G13 new process recovers a durably settled network failure after previous process exits', async () => {
  const first = await worker(); shared.failUpload = true;
  await expect(first.command('replace')).rejects.toThrow('Synthetic worker command failed');
  const [filename] = await journalFiles(directory);
  expect(JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8')).state).toBe('settled');
  await first.stop(); const second = await worker();
  await second.command('advance', { now: Date.now() + 180000 }); await second.command('recover');
  expect(shared.row.imagePublicId).toBeNull(); expect(shared.remote.size).toBe(0); expect(await journalFiles(directory)).toEqual([]);
}, 15000);
