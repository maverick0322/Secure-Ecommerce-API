'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { PROJECT_ROOT, resolveConfigPath } = require('../../services/secure-config-file.service');
function checkConfiguration(env) {
  const report = { files: {}, redisConnectionAttempted: false };
  for (const name of ['JWT_RS256_PRIVATE_KEY_PATH', 'JWT_RS256_PUBLIC_KEYS_PATH',
    'AUTH_CREDENTIAL_VERSION_KEY_PATH', 'AUTH_REDIS_PASSWORD_PATH', 'AUTH_REDIS_STATE_PATH', 'AUTH_REDIS_CA_PATH']) {
    if (!env[name]) { report.files[name] = 'NOT_CONFIGURED'; continue; }
    try { resolveConfigPath(env[name], env); report.files[name] = 'PATH_OK'; }
    catch (error) { report.files[name] = error.code?.startsWith('CONFIG_') ? error.code : 'INVALID'; }
  }
  for (const [name, module, method] of [
    ['rs256', '../../services/rs256-access-token.service', 'loadAccessTokenService'],
    ['hmac', '../../services/credential-version.service', 'loadCredentialVersionService'],
    ['redis', '../../services/auth-redis.service', 'loadRedisConfiguration']
  ]) {
    try { require(module)[method](env); report[name] = 'OK'; }
    catch { report[name] = 'INVALID'; }
  }
  report.accessV1 = env.JWT_RS256_ACTIVE_KID === 'access-v1';
  report.missingRs256Variables = ['JWT_RS256_ISSUER', 'JWT_RS256_AUDIENCE', 'JWT_RS256_ACTIVE_KID',
    'JWT_RS256_PRIVATE_KEY_PATH', 'JWT_RS256_PUBLIC_KEYS_PATH'].filter(name => !env[name]);
  return report;
}
if (require.main === module) {
  try {
    const location = path.join(PROJECT_ROOT, '.env');
    const env = { ...(fs.existsSync(location) ? dotenv.parse(fs.readFileSync(location)) : {}), ...process.env };
    const report = checkConfiguration(env);
    console.log(JSON.stringify(report, null, 2));
    if (['rs256', 'hmac', 'redis'].some(name => report[name] !== 'OK')) process.exitCode = 1;
  } catch { console.error('Protected configuration check failed; no diagnostic secrets displayed.'); process.exitCode = 1; }
}
module.exports = { checkConfiguration };
