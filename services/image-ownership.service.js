'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { sequelize } = require('../models');
const { AccountError } = require('./accounts.service');

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const directory = () => path.resolve(process.env.CLOUDINARY_CLEANUP_DIR || path.join(__dirname, '../log/cloudinary'));
const invalid = () => new AccountError(503, 'La identidad del almacenamiento de imágenes requiere revisión.');
function valid(scope) {
  return scope?.version === 1 && typeof scope.id === 'string' && uuid.test(scope.id) &&
    typeof scope.binding === 'string' && digest.test(scope.binding);
}

async function current() {
  try {
    const [[identity]] = await sequelize.query('SELECT @@server_uuid AS uuid, DATABASE() AS db', { logging: false });
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    if (!uuid.test(identity?.uuid || '') || !/^[a-zA-Z0-9_]{1,64}$/.test(identity?.db || '') ||
        typeof cloud !== 'string' || !/^[a-z0-9_-]{1,128}$/.test(cloud)) throw invalid();
    const binding = createHash('sha256').update(JSON.stringify([identity.uuid, identity.db, cloud])).digest('hex');
    await fs.mkdir(directory(), { recursive: true });
    const location = path.join(directory(), '.ownership.json');
    let metadata;
    try { metadata = await fs.lstat(location); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let handle;
    try {
      // An identity is never replaced automatically. A racing/partial creator fails closed.
      if (!metadata) {
        handle = await fs.open(location, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ version: 1, id: randomUUID(), binding }));
        await handle.sync();
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally { if (handle) await handle.close(); }
    metadata = await fs.lstat(location);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024) throw invalid();
    const scope = JSON.parse(await fs.readFile(location, 'utf8'));
    if (!valid(scope) || scope.binding !== binding) throw invalid();
    return Object.freeze(scope);
  } catch { throw invalid(); }
}

function prefix(scope, productId) {
  if (!valid(scope) || !Number.isInteger(productId) || productId < 1) throw invalid();
  return `secure-ecommerce/environments/${scope.id}/${scope.binding}/products/${productId}/`;
}
function managed(publicId, productId, scope) {
  return valid(scope) && typeof publicId === 'string' && publicId.startsWith(prefix(scope, productId)) &&
    uuid.test(publicId.slice(prefix(scope, productId).length));
}
function context(scope, productId) {
  prefix(scope, productId);
  return { catalog_owner: 'secure-ecommerce-api', product_id: String(productId),
    catalog_environment: scope.id, catalog_database: scope.binding };
}
function matches(resource, scope, productId) {
  const custom = resource?.context?.custom;
  return Object.entries(context(scope, productId)).every(([key, value]) => custom?.[key] === value);
}
function same(left, right) {
  return valid(left) && valid(right) && left.id === right.id && left.binding === right.binding;
}
module.exports = { current, directory, prefix, managed, context, matches, same };
