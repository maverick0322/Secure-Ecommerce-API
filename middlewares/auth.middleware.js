const CLAIM_TYPES = require('../config/claim-types');
const runtime = require('../services/auth-runtime.service');
const accounts = require('../services/accounts.service');
const { AccountError, respondError, accountType, isActive, serializeAccount } = accounts;

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
      // Signature/claims are checked before Redis; no HS256 fallback exists.
      const decoded = runtime.getTokens().verify(token);
      const { sessions, versions } = await runtime.getRuntime();
      const account = await accounts.findAccountById(decoded.sub, { withPassword: true });
      const profile = accountType(account);
      if (!isActive(account) || !profile) {
        return deny(req,res, new AccountError(403, 'Acceso prohibido para esta cuenta.'),account?.id);
      }
      const permittedProfile = allowed.includes(profile);
      const permittedSeller = profile !== 'SELLER' || allowUnapprovedSeller || account.seller.status === 'APPROVED';
      // Denied permissions still validate Redis, but cannot extend inactivity.
      await sessions.check({ userId: account.id, sessionId: decoded.sid,
        credentialVersion: versions.derive(account.passwordHash), touch: permittedProfile && permittedSeller });
      if (!permittedProfile) return deny(req, res, new AccountError(403, 'Acceso prohibido para esta cuenta.'), account.id);
      if (!permittedSeller) {
        return deny(req,res, new AccountError(403, 'La cuenta de vendedor debe estar aprobada.'),account.id);
      }

      req.account = serializeAccount(account, profile);
      req.decodedToken = { ...decoded, [CLAIM_TYPES.Name]: account.email, [CLAIM_TYPES.GivenName]: account.name,
        [CLAIM_TYPES.Role]: profile };
    } catch (error) {
      return respondError(res, error);
    }
    return next();
  };
}

module.exports = authorize;
