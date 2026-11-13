const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const bcrypt = require('bcrypt');
const validator = require('express-validator').body;
const passwords = require('./password-policy.service');
const { isUuid } = require('../validators/uuid');
const { User, Admin, Seller, Buyer, sequelize, Sequelize } = require('../models');

const profiles = [['ADMIN', 'admin'], ['SELLER', 'seller'], ['BUYER', 'buyer']];
const include = [
  { association: 'admin', attributes: ['userId'] },
  { association: 'seller', attributes: ['userId', 'status'] },
  { association: 'buyer', attributes: ['userId'] }
];

class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function respondError(res, error) {
  if (['SESSION_STORE_UNAVAILABLE', 'AUTH_REDIS_CONFIGURATION_INVALID', 'RS256_CONFIGURATION_INVALID', 'SESSION_CONFLICT'].includes(error?.code)) {
    return res.status(503).json({ status: 503, message: 'El servicio de autenticación no está disponible.' });
  }
  if (error?.name === 'AuthSessionError' || error?.code === 'INVALID_ACCESS_TOKEN') {
    return res.status(401).json({ status: 401, message: 'Sesión inválida o expirada.' });
  }
  const status = error instanceof AccountError ? error.status : 500;
  const message = status === 500 ? 'No se ha podido procesar la petición.' : error.message;
  return res.status(status).json({ status, message });
}

async function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const result = await validator('email').isEmail({ allow_utf8_local_part: false }).run({ body: { email } });
  if (email.length > 254 || !result.isEmpty()) throw new AccountError(400, 'El correo electrónico no es válido.');
  return email;
}

function text(value, max, message) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || [...normalized].length > max) throw new AccountError(400, message);
  return normalized;
}

function validPassword(value) {
  return passwords.validBcryptInput(value);
}

function newPassword(value) {
  if (!passwords.acceptable(value)) throw new AccountError(400,
    'Use una contraseña de al menos 15 caracteres y hasta 72 bytes, que no sea común ni repetitiva.');
  return value;
}

function accountType(account) {
  const found = profiles.filter(([, key]) => account?.[key]);
  return found.length === 1 ? found[0][0] : null;
}

function isActive(account) {
  return account?.status === 'ACTIVE' && account.deletedAt == null && Boolean(account.emailVerifiedAt);
}

function serializeAccount(account, profile = accountType(account), sellerStatus = account.seller?.status) {
  const result = { id: account.id, email: account.email, name: account.name, profile, status: account.status };
  if (profile === 'SELLER') result.sellerStatus = sellerStatus;
  return result;
}

function findAccountById(id, options = {}) {
  const { withPassword = false, ...query } = options;
  return (withPassword ? User.unscoped() : User).findByPk(id, { ...query, include });
}

function findAccountByEmail(email, withPassword = false) {
  const model = withPassword ? User.unscoped() : User;
  return model.findOne({ where: { email }, include });
}

function listAccounts() {
  return User.findAll({ include, order: [['email', 'ASC']] });
}

async function insertUser(account, transaction) {
  return User.create(account, { transaction });
}

async function createPublicAccount({ email, name, password, profile, storeName }, context = {}) {
  if (profile !== 'BUYER' && profile !== 'SELLER') throw new AccountError(400, 'Seleccione el perfil BUYER o SELLER.');
  const passwordHash = await bcrypt.hash(newPassword(password), 12);
  const now = new Date();
  try {
    return await sequelize.transaction(async transaction => {
      const account = await insertUser({ id: randomUUID(), email, name, passwordHash, status: 'ACTIVE',
        emailVerifiedAt: now, createdAt: now, updatedAt: now }, transaction);
      const { id: userId } = account;
      if (profile === 'SELLER') {
        await Seller.create({ userId, storeName, requestedAt: now }, { transaction });
      } else {
        await Buyer.create({ userId }, { transaction });
      }
      await require('./audit.service').business(userId, 'usuarios.crear', 'user', userId, transaction, context);
      return serializeAccount(account, profile, 'PENDING');
    });
  } catch (error) {
    if (error instanceof Sequelize.UniqueConstraintError) throw new AccountError(409, 'El correo electrónico ya está registrado.');
    throw error;
  }
}

async function reviewSeller(actorId, userId, status, rejectionReason, remoteIp) {
  return sequelize.transaction(async transaction => {
    const options = { transaction, lock: transaction.LOCK.UPDATE };
    const actor = await User.findByPk(actorId, options);
    // The API has SELECT-only access to admins. The review FK also checks membership on update.
    if (!isActive(actor) || !await Admin.findByPk(actorId, { transaction })) {
      throw new AccountError(403, 'Se requiere una cuenta ADMIN activa.');
    }
    const seller = await Seller.findByPk(userId, options);
    if (!seller) throw new AccountError(404, 'Solicitud de vendedor no encontrada.');
    if (seller.status !== 'PENDING') throw new AccountError(409, 'La solicitud ya fue revisada.');

    const now = new Date();
    await seller.update({ status, rejectionReason, reviewedAt: now, reviewedByUserId: actorId }, { transaction });
    const ipAddress = isIP(remoteIp || '') ? remoteIp : null;
    const event = { actorUserId: actorId, action: status === 'APPROVED' ? 'seller.approved' : 'seller.rejected',
      targetType: 'seller', targetId: userId, ipAddress, outcome: 'SUCCESS', occurredAt: now };
    await require('./audit.service').write(event,{transaction});
    return { userId, status, rejectionReason, reviewedAt: now, reviewedByUserId: actorId };
  });
}

async function withAdmin(actorId, work) {
  return sequelize.transaction(async transaction => {
    const actor = await User.findByPk(actorId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!isActive(actor) || !await Admin.findByPk(actorId, { transaction })) {
      throw new AccountError(403, 'Se requiere una cuenta ADMIN activa.');
    }
    return work(transaction);
  });
}

function suspendSeller(actorId, userId, reason, context = {}) {
  if (!isUuid(userId) || typeof reason !== 'string' ||
      !reason.trim() || [...reason.trim()].length > 255 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new AccountError(400, 'La suspensión requiere un vendedor y un motivo de hasta 255 caracteres.');
  }
  return withAdmin(actorId, async transaction => {
    // Same lock order as catalog and checkout: seller account, then profile.
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    const seller = user && await Seller.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!seller) throw new AccountError(404, 'Vendedor no encontrado.');
    if (seller.status !== 'APPROVED') throw new AccountError(409, 'Solo puede suspenderse un vendedor aprobado.');
    const reviewedAt = new Date();
    await seller.update({ status: 'SUSPENDED', reviewedAt, reviewedByUserId: actorId }, { transaction });
    await require('./audit.service').business(actorId, 'seller.suspended', 'seller', userId,
      transaction, { ipAddress: context.ipAddress, details: { previousStatus: 'APPROVED', status: 'SUSPENDED', reason: reason.trim() } });
    return { userId, status: 'SUSPENDED', reviewedAt, reviewedByUserId: actorId };
  });
}

async function lockedTarget(email, transaction) {
  const account = await User.findOne({ where: { email }, transaction, lock: transaction.LOCK.UPDATE });
  if (!account) throw new AccountError(404, 'Usuario no encontrado.');
  return { account, admin: await Admin.findByPk(account.id, { transaction }) };
}

async function updateAccount(actorId, email, body, context = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
      Object.keys(body).some(key => !['name','password','status'].includes(key))) {
    throw new AccountError(400, 'Solo se permite actualizar name, password y status.');
  }
  const changes = {};
  if (body.name !== undefined) changes.name = text(body.name,120,'El nombre debe tener entre 1 y 120 caracteres.');
  if (body.status !== undefined) {
    if (!['ACTIVE','SUSPENDED','DISABLED'].includes(body.status)) throw new AccountError(400,'Estado de cuenta no válido.');
    changes.status = body.status;
  }
  if (body.password !== undefined) changes.passwordHash = await bcrypt.hash(newPassword(body.password),12);
  return withAdmin(actorId, async transaction => {
    const { account, admin } = await lockedTarget(email, transaction);
    if (admin && (actorId !== account.id || (changes.status !== undefined && changes.status !== 'ACTIVE'))) {
      throw new AccountError(403, 'La administración de esta cuenta ADMIN está restringida.');
    }
    // Also revoke on reactivation: a login racing with suspension, or a
    // pre-existing suspended account, must not resurrect an older session.
    const changesAccountState = changes.status !== undefined &&
      (changes.status !== 'ACTIVE' || account.status !== 'ACTIVE');
    if (changes.passwordHash || changesAccountState) {
      // SQL cannot atomically commit Redis. Revoke first while holding the user
      // row lock. On SQL rollback sessions remain revoked, never resurrected.
      const { sessions } = await require('./auth-runtime.service').getRuntime();
      await sessions.revokeAll({ userId: account.id });
    }
    await account.update(changes,{transaction});
    await require('./audit.service').business(actorId,'usuarios.editar','user',account.id,transaction,context);
  });
}

function removeAccount(actorId, email, context = {}) {
  return withAdmin(actorId, async transaction => {
    const { account, admin } = await lockedTarget(email, transaction);
    if (admin) throw new AccountError(403,'El cierre de una cuenta ADMIN está restringido.');
    const { sessions } = await require('./auth-runtime.service').getRuntime();
    await sessions.revokeAll({ userId: account.id });
    await account.destroy({transaction});
    await require('./audit.service').business(actorId,'usuarios.eliminar','user',account.id,transaction,context);
  });
}

module.exports = { AccountError, respondError, normalizeEmail, text, validPassword, newPassword, accountType, isActive,
  serializeAccount, findAccountById, findAccountByEmail, listAccounts, createPublicAccount, reviewSeller,
  suspendSeller, updateAccount, removeAccount };
