'use strict';

const { UserAddress, Buyer, User, sequelize, Sequelize } = require('../models');
const { AccountError, isActive } = require('./accounts.service');

// Every writer locks the same buyer account before touching any address.
// The functional UNIQUE index remains the final safeguard against direct SQL.
async function withBuyer(buyerId, work) {
  return sequelize.transaction(async transaction => {
    const user = await User.findByPk(buyerId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!isActive(user) || !await Buyer.findByPk(buyerId, { transaction })) {
      throw new AccountError(403, 'Se requiere un comprador activo.');
    }
    return work(transaction);
  });
}

function list(buyerId) {
  return UserAddress.findAll({ where: { buyerId }, order: [['isDefault', 'DESC'], ['id', 'ASC']] });
}

async function clearDefault(buyerId, transaction, exceptId) {
  const where = { buyerId, isDefault: true };
  if (exceptId) where.id = { [Sequelize.Op.ne]: exceptId };
  await UserAddress.update({ isDefault: false }, { where, transaction });
}

function create(buyerId, input, context = {}) {
  return withBuyer(buyerId, async transaction => {
    if (input.isDefault) await clearDefault(buyerId, transaction);
    const row = await UserAddress.create({ ...input, buyerId }, { transaction });
    await require('./audit.service').business(buyerId,'address.create','address',row.id,transaction,context);
    return row;
  });
}

function update(buyerId, id, input, context = {}) {
  return withBuyer(buyerId, async transaction => {
    const row = await UserAddress.findOne({ where: { id, buyerId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw new AccountError(404, 'Dirección no encontrada.');
    if (input.isDefault) await clearDefault(buyerId, transaction, id);
    const result = await row.update(input, { transaction });
    await require('./audit.service').business(buyerId,input.isDefault === true ? 'address.default' : 'address.update',
      'address',id,transaction,context);
    return result;
  });
}

function remove(buyerId, id, context = {}) {
  return withBuyer(buyerId, async transaction => {
    const row = await UserAddress.findOne({ where: { id, buyerId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw new AccountError(404, 'Dirección no encontrada.');
    await row.destroy({ transaction });
    await require('./audit.service').business(buyerId,'address.remove','address',id,transaction,context);
  });
}

module.exports = { list, create, update, remove };
