'use strict';

// Child process fixture: only IPC and an explicitly supplied temporary journal.
// Production modules execute unchanged, but SQL/provider operations terminate at IPC.
const crypto = require('node:crypto');
const pending = new Map();
let sequence = 0;
function rpc(operation, payload = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject }); process.send({ rpc: id, operation, payload });
  });
}
function inject(relative, exports) {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const Product = {
  findByPk: async () => rpc('find'), count: async options => rpc('count', { publicId: options.where.imagePublicId })
};
const sequelize = { transaction: callback => callback({ LOCK: { UPDATE: 'UPDATE' } }), query: () => rpc('identity') };
inject('../../models', { Product, sequelize });
class AccountError extends Error { constructor(status, message) { super(message); this.status = status; } }
inject('../../services/accounts.service', { AccountError });
inject('../../services/catalog.service', {
  ownedProduct: () => rpc('find'),
  mutateProduct: async (account, id, apply) => {
    await rpc('beforeCommit');
    const product = await rpc('find');
    product.update = async values => rpc('commit', values);
    await apply(product, { LOCK: { UPDATE: 'UPDATE' } });
  }
});
inject('../../services/cloudinary.service', {
  credentials: () => ({}), upload: (buffer, publicId, productId, scope) => rpc('upload', { publicId, scope }),
  inspect: publicId => rpc('inspect', { publicId }), destroy: publicId => rpc('destroy', { publicId })
});
inject('../../services/structured-logger.service', { log: event => process.send({ event }) });
const images = require('../../services/product-images.service');
process.on('message', async message => {
  if (message.reply) {
    const entry = pending.get(message.reply); if (!entry) return; pending.delete(message.reply);
    if (message.error) entry.reject(new Error('Synthetic IPC failure')); else entry.resolve(message.value);
    return;
  }
  if (!message.command) return;
  try {
    if (message.command === 'advance') { const time = message.now; Date.now = () => time; }
    else if (message.command === 'recover') await images.recover();
    else if (message.command === 'scope') await require('../../services/image-ownership.service').current();
    else if (message.command === 'replace') {
      const publicId = await images.replace({ id: crypto.randomUUID() }, 701, Buffer.from('synthetic-memory-only'));
      process.send({ result: message.id, value: publicId }); return;
    }
    process.send({ result: message.id, value: true });
  } catch { process.send({ result: message.id, error: 'Synthetic worker failure' }); }
});
process.send({ ready: true });
