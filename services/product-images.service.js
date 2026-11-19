const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Product, sequelize } = require('../models');
const { AccountError } = require('./accounts.service');
const catalog = require('./catalog.service');
const cloud = require('./cloudinary.service');
const ownership = require('./image-ownership.service');
const { validateUpload } = require('./image-response.service');

const active = new Map();
let recovering = false;
let timer;
let scan;
let scanDirectory;
let recoveryPausedUntil = 0;
const RECOVERY = Object.freeze({ perCycle: 32, attempts: 6, baseMs: 60000, maxMs: 3600000 });
const metrics = { processed: 0, deferred: 0, manual: 0, invalid: 0, failed: 0 };
const pendingProbed = new Set();
const directory = ownership.directory;
const recordPath = publicId => path.join(directory(), `${createHash('sha256').update(publicId).digest('hex')}.json`);

async function reserve(publicId, productId, scope, delayed = false) {
  const entries = await fs.opendir(directory());
  let count = 0;
  for await (const entry of entries) {
    if (entry.name !== '.ownership.json' && ++count >= 1000) throw new AccountError(503, 'La recuperación de imágenes requiere revisión.');
  }
  active.set(publicId, (active.get(publicId) || 0) + 1);
  const release = () => {
    const remaining = active.get(publicId) - 1;
    if (remaining) active.set(publicId, remaining);
    else active.delete(publicId);
  };
  const task = { version: 2, scope, state: 'pending', publicId, productId,
    notBefore: Date.now() + (delayed ? 120000 : 0), watchMissing: delayed };
  try {
    await fs.mkdir(directory(), { recursive: true });
    let file;
    try {
      file = await fs.open(recordPath(publicId), 'wx', 0o600);
      await file.writeFile(JSON.stringify(task));
      await file.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      if (file) await file.close();
    }
    return { task, release };
  } catch (error) {
    release();
    throw error;
  }
}

async function forget(task) {
  try { await fs.unlink(recordPath(task.publicId)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function complete(task, uploadConfirmed = false, extra = {}) {
  const temporary = `${recordPath(task.publicId)}.${randomUUID()}.tmp`;
  const settled = { ...task, state: 'settled', uploadConfirmed, ...extra };
  let file;
  try {
    file = await fs.open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(settled));
    await file.sync(); await file.close(); file = null;
    await fs.rename(temporary, recordPath(task.publicId));
    Object.assign(task, settled);
    return true;
  } catch {
    require('./structured-logger.service').log('image.cleanup.pending');
    return false;
  } finally {
    if (file) await file.close();
    try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') require('./structured-logger.service').log('image.cleanup.pending'); }
  }
}

function references(task) {
  return sequelize.transaction(async transaction => {
    // Only this short SQL section holds a row lock; provider I/O happens after commit.
    await Product.findByPk(task.productId, { paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
    return Product.count({ where: { imagePublicId: task.publicId }, paranoid: false, transaction });
  });
}

async function reconcile(task, scope) {
  if (active.has(task.publicId)) return;
  // Pending belongs to a possibly live process, irrespective of age. No polling SQL.
  if (task.version === 2 && task.state !== 'settled') {
    metrics.manual++;
    if (!pendingProbed.has(task.publicId) && pendingProbed.size < 1000) {
      pendingProbed.add(task.publicId);
      if (await references(task) > 0) await forget(task);
    }
    return;
  }
  if (task.manual || (task.retryAt || 0) > Date.now()) { metrics.deferred++; return; }
  if (!task.uploadConfirmed && task.notBefore > Date.now()) { metrics.deferred++; return; }
  if (await references(task) > 0) return forget(task);
  const preserve = () => fs.rename(recordPath(task.publicId), recordPath(task.publicId).replace(/\.json$/, '.preserved.json'));
  // Old identifiers/journals and unknown environments are readable, never auto-deletable.
  if (task.version !== 2 || !ownership.same(task.scope, scope) ||
      !ownership.managed(task.publicId, task.productId, scope)) return preserve();
  // Age is not evidence of termination. A crashed/abandoned pending operation
  // remains durable for manual reconciliation, even after 120 seconds or a restart.
  if (task.state !== 'settled') return;
  if (!task.uploadConfirmed && task.notBefore > Date.now()) return;
  const resource = await cloud.inspect(task.publicId);
  if (!resource && task.watchMissing && !task.uploadConfirmed) throw new Error('Uncertain missing upload');
  if (resource && !ownership.matches(resource, scope, task.productId)) return preserve();
  if (resource) {
    if (await references(task) > 0) return forget(task);
    await cloud.destroy(task.publicId);
  }
  await forget(task);
}

async function settle(task, scope) {
  try { await reconcile(task, scope); } catch (error) {
    // The fsynced record survives transient provider/database failures and process restarts.
    require('./structured-logger.service').log('image.cleanup.pending');
    metrics.failed++;
    if (task.state === 'settled') {
      const failureKind = error.imageFailure || cloud.classify?.(error) || 'uncertain';
      const attempts = Math.min(RECOVERY.attempts, (task.attempts || 0) + 1);
      if (!await complete(task, task.uploadConfirmed, { attempts, failureKind, manual: failureKind === 'definitive' || attempts >= RECOVERY.attempts,
        retryAt: Date.now() + Math.min(RECOVERY.maxMs, RECOVERY.baseMs * 2 ** (attempts - 1)) })) recoveryPausedUntil = Date.now() + RECOVERY.maxMs;
    }
  }
}

async function recover() {
  if (recovering || recoveryPausedUntil > Date.now()) return;
  recovering = true;
  try {
    if (scanDirectory !== directory()) { if (scan) await scan.close(); scan = null; scanDirectory = directory(); }
    try { scan ||= await fs.opendir(directory()); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    let scope;
    for (let index = 0; index < RECOVERY.perCycle; index++) {
      const entry = await scan.read();
      if (!entry) { await scan.close(); scan = null; break; }
      const file = entry.name;
      if (!/^[0-9a-f]{64}\.json$/.test(file)) continue;
      try {
        const stat = await fs.lstat(path.join(directory(), file));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid record');
        const task = JSON.parse(await fs.readFile(path.join(directory(), file), 'utf8'));
        if (!Number.isInteger(task.productId) || task.productId < 1 || typeof task.publicId !== 'string' ||
          !Number.isFinite(task.notBefore) || path.basename(recordPath(task.publicId)) !== file) throw new Error('Invalid cleanup record');
        if ((task.attempts !== undefined && (!Number.isInteger(task.attempts) || task.attempts < 0 || task.attempts > RECOVERY.attempts)) ||
          (task.retryAt !== undefined && (!Number.isSafeInteger(task.retryAt) || task.retryAt < 0)) ||
          (task.manual !== undefined && typeof task.manual !== 'boolean')) throw new Error('Invalid retry metadata');
        metrics.processed++;
        if (task.version === 2 && (task.manual || (task.retryAt || 0) > Date.now())) {
          if (task.manual) metrics.manual++;
          metrics.deferred++; continue;
        }
        if (task.version === 2 && task.state !== 'settled' &&
            (pendingProbed.has(task.publicId) || pendingProbed.size >= 1000)) { metrics.manual++; continue; }
        scope ||= await ownership.current();
        await settle(task, scope);
        if (recoveryPausedUntil > Date.now()) break;
      } catch { metrics.invalid++; require('./structured-logger.service').log('image.cleanup.invalid'); }
    }
  } finally {
    recovering = false;
    require('./structured-logger.service').log('image.recovery.cycle', metrics);
  }
}

function startRecovery() {
  if (timer) return;
  void recover().catch(() => require('./structured-logger.service').log('image.recovery.failed'));
  timer = setInterval(() => { void recover().catch(() => require('./structured-logger.service').log('image.recovery.failed')); }, 60000);
  timer.unref();
}

async function checkPermit(context) {
  try { await context.imagePermit?.check(); }
  catch { throw new AccountError(503, 'Control de cargas no disponible.'); }
}

async function replace(account, productId, buffer, context = {}) {
  await catalog.ownedProduct(productId, account.id);
  cloud.credentials();
  const scope = await ownership.current();
  const publicId = `${ownership.prefix(scope, productId)}${randomUUID()}`;
  const pending = await reserve(publicId, productId, scope, true);
  let old;
  let uploaded = false;
  let collision = false;
  let definitive = false;
  let failureKind;
  try {
    let result;
    try { await checkPermit(context); }
    catch (error) { definitive = true; throw error; } // No provider operation has started.
    try {
      result = await cloud.upload(buffer, publicId, productId, scope);
    } catch (error) {
      definitive = error.imageFailure === 'definitive';
      failureKind = error.imageFailure || 'uncertain';
      throw new AccountError(502, 'No se pudo cargar la imagen.');
    }
    if (result?.existing === true) {
      // Even an incomplete collision response is not permission to clean a preexisting asset.
      collision = true;
      validateUpload(result, publicId);
      await forget(pending.task);
      throw new AccountError(409, 'La imagen generada ya existe. Intente nuevamente.');
    }
    validateUpload(result, publicId, context.imageInfo);
    if (!ownership.matches(result, scope, productId)) throw new AccountError(502, 'El proveedor no confirmó una imagen válida.');
    uploaded = true;
    await checkPermit(context);
    await catalog.mutateProduct(account, productId, async (product, transaction) => {
      if (product.imagePublicId) old = await reserve(product.imagePublicId, productId, scope);
      await product.update({ imagePublicId: publicId }, { transaction });
    },context,'producto.imagen');
    return publicId;
  } finally {
    pending.release();
    if (old) old.release();
    if (definitive) await forget(pending.task);
    else if (!collision && await complete(pending.task, uploaded, { failureKind })) await settle(pending.task, scope);
    if (old && await complete(old.task)) await settle(old.task, scope);
  }
}

async function remove(account, productId, context = {}) {
  await catalog.ownedProduct(productId, account.id);
  const scope = await ownership.current();
  let old;
  try {
    await catalog.mutateProduct(account, productId, async (product, transaction) => {
      if (product.imagePublicId) old = await reserve(product.imagePublicId, productId, scope);
      await product.update({ imagePublicId: null }, { transaction });
    },context,'producto.imagen.retirar');
  } finally {
    if (old) {
      old.release();
      if (await complete(old.task)) await settle(old.task, scope);
    }
  }
}

module.exports = { replace, remove, recover, startRecovery, recoveryMetrics: () => ({ ...metrics }), RECOVERY };
