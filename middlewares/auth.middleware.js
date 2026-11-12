const CLAIM_TYPES = require('../config/claim-types');
const { generateToken, verifyToken, getJwtSecret } = require('../services/jwttoken.service');
const { AccountError, respondError, findAccountById, accountType, isActive, serializeAccount } = require('../services/accounts.service');

// Existing route declarations keep working while their contracts are adapted.
const legacyPermissions = { Administrador: 'ADMIN', Usuario: 'BUYER' };
async function deny(req,res,error,actorId=null){
  if(req.logAudit) await req.logAudit('access.denied',null,actorId,'DENIED');
  return respondError(res,error);
}

function authorize(profiles, { allowUnapprovedSeller = false } = {}) {
  const allowed = profiles.split(',').map(value => legacyPermissions[value.trim()] || value.trim());
  return async (req, res, next) => {
    const token = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') || '')?.[1];
    if (!token) return deny(req,res, new AccountError(401, 'Se requiere un token Bearer.'));

    try {
      const secret = getJwtSecret();
      let decoded;
      try {
        decoded = verifyToken(token, secret);
      } catch {
        return deny(req,res, new AccountError(401, 'Token inválido o expirado.'));
      }
      const account = await findAccountById(decoded.sub);
      const profile = accountType(account);
      if (!isActive(account) || !profile || !allowed.includes(profile)) {
        return deny(req,res, new AccountError(403, 'Acceso prohibido para esta cuenta.'),account?.id);
      }
      if (profile === 'SELLER' && !allowUnapprovedSeller && account.seller.status !== 'APPROVED') {
        return deny(req,res, new AccountError(403, 'La cuenta de vendedor debe estar aprobada.'),account.id);
      }

      req.account = serializeAccount(account, profile);
      req.decodedToken = { ...decoded, [CLAIM_TYPES.Name]: account.email, [CLAIM_TYPES.GivenName]: account.name,
        [CLAIM_TYPES.Role]: profile };
      const remaining = decoded.exp - Date.now() / 1000;
      if (remaining > 0 && remaining < 5 * 60) res.set('Set-Authorization', generateToken(req.account));
    } catch (error) {
      return respondError(res, error);
    }
    return next();
  };
}

module.exports = authorize;
