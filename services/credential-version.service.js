'use strict';
const crypto = require('node:crypto');
const { readConfigFile } = require('./secure-config-file.service');
const { RedisConfigurationError } = require('./auth-session-errors');

// The caller supplies a protected, dedicated CSPRNG key. Never use a password,
// JWT signing key, client-supplied value or the bcrypt hash itself as a version.
function createCredentialVersionService(key) {
  if (!Buffer.isBuffer(key) || key.length < 32 || key.length > 128) throw new RedisConfigurationError();
  const secret = Buffer.from(key);
  return Object.freeze({ derive(passwordHash) {
    if (!require('./password-hash.service').isEncodedHash(passwordHash)) {
      throw new RedisConfigurationError();
    }
    return crypto.createHmac('sha256', secret).update('secure-ecommerce-credentials-v1\0').update(passwordHash).digest('hex');
  } });
}
function loadCredentialVersionService(env = process.env) {
  try {
    return createCredentialVersionService(readConfigFile(env.AUTH_CREDENTIAL_VERSION_KEY_PATH, 128, env, null));
  } catch { throw new RedisConfigurationError(); }
}
module.exports = { createCredentialVersionService, loadCredentialVersionService };
