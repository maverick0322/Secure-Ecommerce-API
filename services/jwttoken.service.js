const jwt = require('jsonwebtoken');
const CLAIM_TYPES = require('../config/claim-types');

const issuer = 'ServidorFeiJWT';
const audience = 'ClientesFeiJWT';
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  // Encoding and diversity reject obvious weak keys, but cannot prove random
  // generation. Provision at least 32 CSPRNG bytes; never a human passphrase.
  let bytes;
  if (typeof secret === 'string' && /^(?:[0-9a-f]{2}){32,128}$/i.test(secret)) bytes = Buffer.from(secret,'hex');
  else if (typeof secret === 'string' && secret.startsWith('base64url:')) {
    const encoded = secret.slice('base64url:'.length);
    if (/^[\w-]{43,171}$/.test(encoded)) {
      const decoded = Buffer.from(encoded,'base64url');
      if (decoded.toString('base64url') === encoded) bytes = decoded;
    }
  }
  if (!bytes || bytes.length < 32 || new Set(bytes).size < 16) {
    throw new Error('JWT_SECRET requiere al menos 32 bytes aleatorios, en hexadecimal o con prefijo base64url:.');
  }
  return secret;
}

function generateToken({ id, email, name, profile }) {
  return jwt.sign({ [CLAIM_TYPES.Name]: email, [CLAIM_TYPES.GivenName]: name, [CLAIM_TYPES.Role]: profile },
    getJwtSecret(), { algorithm: 'HS256', expiresIn: '20m', issuer, audience, subject: id });
}

function verifyToken(token, secret = getJwtSecret()) {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'], issuer, audience });
  if (!isUuid(decoded.sub) || !Number.isInteger(decoded.exp)) throw new jwt.JsonWebTokenError('Invalid account token');
  return decoded;
}

function getRemainingTokenTime(decoded) {
  const seconds = Math.max(0, Math.floor(decoded.exp - Date.now() / 1000));
  return `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

module.exports = { generateToken, verifyToken, getJwtSecret, getRemainingTokenTime, isUuid };
