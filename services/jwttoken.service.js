const runtime = require('./auth-runtime.service');
const { isUuid } = require('../validators/uuid');

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

// Access tokens are exclusively RS256; session creation belongs to authentication.service.
function generateToken({ id, sessionId }) { return runtime.getTokens().sign({ sub: id, sid: sessionId }); }
function verifyToken(token) { return runtime.getTokens().verify(token); }

function getRemainingTokenTime(decoded) {
  const seconds = Math.max(0, Math.floor(decoded.exp - Date.now() / 1000));
  return `00:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

module.exports = { generateToken, verifyToken, getJwtSecret, getRemainingTokenTime, isUuid };
