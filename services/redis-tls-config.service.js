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
  for (const certificate of certificates) new X509Certificate(certificate);
  return pem;
}
module.exports = { loadRedisCa };
