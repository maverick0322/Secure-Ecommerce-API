const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Product, sequelize } = require('../models');
const { AccountError } = require('./accounts.service');
const catalog = require('./catalog.service');
const cloud = require('./cloudinary.service');

const active = new Map();
let recovering = false;
let timer;
const directory = () => path.resolve(process.env.CLOUDINARY_CLEANUP_DIR || path.join(__dirname, '../log/cloudinary'));
const recordPath = publicId => path.join(directory(), `${createHash('sha256').update(publicId).digest('hex')}.json`);

function managedId(publicId, productId) {
  return typeof publicId === 'string' && new RegExp(`^secure-ecommerce/products/${productId}/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$`).test(publicId);
}

async function reserve(publicId, productId, delayed = false) {
  active.set(publicId, (active.get(publicId) || 0) + 1);
  const release = () => {
    const remaining = active.get(publicId) - 1;
    if (remaining) active.set(publicId, remaining);
    else active.delete(publicId);
  };
  const task = { publicId, productId, notBefore: Date.now() + (delayed ? 120000 : 0), watchMissing: delayed };
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

async function reconcile(task, completedUpload = false) {
  if (active.has(task.publicId)) return;
  await sequelize.transaction(async transaction => {
    // Wait for a possibly ambiguous commit before deciding whether the upload is referenced.
    await Product.findByPk(task.productId, { paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
    const references = await Product.count({ where: { imagePublicId: task.publicId }, paranoid: false, transaction });
    if (references > 0) return forget(task);
    if (!completedUpload && task.notBefore > Date.now()) return;
    const preserve = async () => {
      await fs.rename(recordPath(task.publicId), recordPath(task.publicId).replace(/\.json$/, '.preserved.json'));
    };
    // Historical or migrated images require a separately verified retirement decision.
    if (!managedId(task.publicId, task.productId)) return preserve();
    const resource = await cloud.inspect(task.publicId);
    // An upload timeout can finish remotely after an earlier "not found" response.
    if (!resource && task.watchMissing && !completedUpload) return;
    if (resource && (resource.context?.custom?.catalog_owner !== 'secure-ecommerce-api' ||
      resource.context?.custom?.product_id !== String(task.productId))) return preserve();
    if (resource) await cloud.destroy(task.publicId);
    await forget(task);
  });
}

async function settle(task, completedUpload = false) {
  try { await reconcile(task, completedUpload); } catch {
    // The fsynced record survives transient provider/database failures and process restarts.
    console.error('La limpieza de una imagen quedó pendiente de reintento.');
  }
}

async function recover() {
  if (recovering) return;
  recovering = true;
  try {
    let files;
    try { files = await fs.readdir(directory()); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const file of files.filter(name => /^[0-9a-f]{64}\.json$/.test(name))) {
      try {
        const task = JSON.parse(await fs.readFile(path.join(directory(), file), 'utf8'));
        if (!Number.isInteger(task.productId) || task.productId < 1 || typeof task.publicId !== 'string' ||
          !Number.isFinite(task.notBefore) || path.basename(recordPath(task.publicId)) !== file) throw new Error('Invalid cleanup record');
        await settle(task);
      } catch { console.error('Un registro de limpieza de imágenes requiere revisión.'); }
    }
  } finally { recovering = false; }
}

function startRecovery() {
  if (timer) return;
  void recover().catch(() => console.error('No se pudo recuperar la limpieza de imágenes.'));
  timer = setInterval(() => { void recover().catch(() => console.error('No se pudo recuperar la limpieza de imágenes.')); }, 60000);
  timer.unref();
}

async function replace(account, productId, buffer, context = {}) {
  await catalog.ownedProduct(productId, account.id);
  cloud.credentials();
  const publicId = `secure-ecommerce/products/${productId}/${randomUUID()}`;
  const pending = await reserve(publicId, productId, true);
  let old;
  let uploaded = false;
  let collision = false;
  try {
    let result;
    try { result = await cloud.upload(buffer, publicId, productId); } catch { throw new AccountError(502, 'No se pudo cargar la imagen.'); }
    if (result.existing) {
      collision = true;
      await forget(pending.task);
      throw new AccountError(409, 'La imagen generada ya existe. Intente nuevamente.');
    }
    uploaded = true;
    if (result.public_id !== publicId || !['jpg', 'png', 'webp'].includes(result.format)) throw new AccountError(502, 'El proveedor no confirmó una imagen válida.');
    await catalog.mutateProduct(account, productId, async (product, transaction) => {
      if (product.imagePublicId) old = await reserve(product.imagePublicId, productId);
      await product.update({ imagePublicId: publicId }, { transaction });
    },context,'producto.imagen');
    return publicId;
  } finally {
    pending.release();
    if (old) old.release();
    if (!collision) await settle(pending.task, uploaded);
    if (old) await settle(old.task);
  }
}

async function remove(account, productId, context = {}) {
  let old;
  try {
    await catalog.mutateProduct(account, productId, async (product, transaction) => {
      if (product.imagePublicId) old = await reserve(product.imagePublicId, productId);
      await product.update({ imagePublicId: null }, { transaction });
    },context,'producto.imagen.retirar');
  } finally {
    if (old) {
      old.release();
      await settle(old.task);
    }
  }
}

module.exports = { replace, remove, recover, startRecovery };
