const accounts = require('../services/accounts.service');
const { isUuid } = require('../validators/uuid');
const { AccountError, respondError, serializeAccount } = accounts;

async function getAll(req, res) {
  try {
    return res.status(200).json((await accounts.listAccounts()).map(account => serializeAccount(account)));
  } catch (error) {
    return respondError(res, error);
  }
}

async function targetByEmail(req) {
  const account = await accounts.findAccountByEmail(await accounts.normalizeEmail(req.params.email));
  if (!account) throw new AccountError(404, 'Usuario no encontrado.');
  return account;
}

async function get(req, res) {
  try {
    return res.status(200).json(serializeAccount(await targetByEmail(req)));
  } catch (error) {
    return respondError(res, error);
  }
}

async function update(req, res) {
  try {
    await accounts.updateAccount(req.account.id, await accounts.normalizeEmail(req.params.email), req.body, { ipAddress: req.ip });
    return res.status(204).end();
  } catch (error) { return respondError(res, error); }
}

async function remove(req, res) {
  try {
    await accounts.removeAccount(req.account.id, await accounts.normalizeEmail(req.params.email), { ipAddress: req.ip });
    return res.status(204).end();
  } catch (error) { return respondError(res, error); }
}

async function suspendSeller(req, res) {
  try {
    const body = req.body;
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body,'reason')) {
      throw new AccountError(400,'Indique únicamente reason.');
    }
    return res.json(await accounts.suspendSeller(req.account.id,req.params.userId,body.reason,{ipAddress:req.ip}));
  } catch (error) { return respondError(res,error); }
}

async function reviewSeller(req, res) {
  try {
    const { userId } = req.params;
    const { status, rejectionReason: reason } = req.body || {};
    if (!isUuid(userId) || !['APPROVED', 'REJECTED'].includes(status)) {
      throw new AccountError(400, 'Indique un vendedor válido y el estado APPROVED o REJECTED.');
    }
    if (status === 'APPROVED' && reason != null) throw new AccountError(400, 'El motivo solo se admite al rechazar.');
    const rejectionReason = status === 'REJECTED' ? accounts.text(reason, 255, 'El rechazo requiere un motivo de hasta 255 caracteres.') : null;
    return res.status(200).json(await accounts.reviewSeller(req.account.id, userId, status, rejectionReason, req.ip));
  } catch (error) {
    return respondError(res, error);
  }
}

module.exports = { getAll, get, update, remove, reviewSeller, suspendSeller };
