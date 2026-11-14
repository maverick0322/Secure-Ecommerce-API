'use strict';
const { X509Certificate } = require('node:crypto');
const { readConfigFile } = require('./secure-config-file.service');
function loadRedisCa(env) {
  if (!env.AUTH_REDIS_CA_PATH) return undefined;
  if (env.AUTH_REDIS_TLS !== 'true') throw new Error('Redis CA requires TLS.');
  const pem = readConfigFile(env.AUTH_REDIS_CA_PATH, 65536, env);
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g);
  if (!certificates?.length || pem.replace(/-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g, '').trim()) {
    throw new Error('Invalid Redis CA bundle.');
  }
  // Construction validates DER/PEM. Exporting its parsed representation also
  // makes explicit that this is validation, not an unused allocation.
  for (const certificate of certificates) {
    const parsed = new X509Certificate(certificate);
    if (!parsed.raw.length) throw new Error('Invalid Redis CA certificate.');
  }
  return pem;
}
module.exports = { loadRedisCa };
