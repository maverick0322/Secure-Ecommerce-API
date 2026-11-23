require('dotenv').config();
const { X509Certificate } = require('node:crypto');
const { readEnvSecret } = require('../services/secret-env.service');
const { readConfigFile } = require('../services/secure-config-file.service');

const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT || 3307;
const PEM_BLOCK_RE = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g;

function validateCaBundle(env, caPath) {
  const pem = readConfigFile(caPath, 65536, env);
  const blocks = pem.match(PEM_BLOCK_RE);
  if (!blocks?.length || pem.replace(PEM_BLOCK_RE, '').trim()) {
    throw new Error('Invalid MySQL CA bundle.');
  }
  for (const cert of blocks) {
    if (!new X509Certificate(cert).raw.length) throw new Error('Invalid MySQL CA certificate.');
  }
  return pem;
}

function buildDialectOptions(env = process.env, sslFlag = env.DB_SSL, caPath = env.DB_SSL_CA_PATH) {
  const base = { supportBigNumbers: true, bigNumberStrings: true };
  if (caPath && sslFlag !== 'true') {
    throw new Error('MySQL CA requires DB_SSL=true.');
  }
  if (sslFlag !== 'true') {
    return base;
  }
  const ca = caPath ? validateCaBundle(env, caPath) : undefined;
  return {
    ...base,
    ssl: ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true }
  };
}

function requireUnprivilegedAccount({ username, password, database }) {
  if (username !== 'ecommerce_app' || !password || database !== 'secure_ecommerce') {
    throw new Error('The API requires secure_ecommerce and its dedicated ecommerce_app account.');
  }
}

const dbPassword = readEnvSecret('DB_PASSWORD');
const testDbPassword = readEnvSecret('TEST_DB_PASSWORD') || dbPassword;
const prodDbPassword = readEnvSecret('PROD_DB_PASSWORD') || dbPassword;

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: dbPassword,
    database: process.env.DB_DATABASE,
    host,
    port,
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    dialectOptions: buildDialectOptions(process.env),
    hooks: { beforeConnect: requireUnprivilegedAccount }
  },
  test: {
    username: process.env.TEST_DB_USER || process.env.DB_USER,
    password: testDbPassword,
    database: process.env.TEST_DB_DATABASE || 'secure_ecommerce_test',
    host: process.env.TEST_DB_HOST || host,
    port: process.env.TEST_DB_PORT || port,
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    dialectOptions: buildDialectOptions(process.env, process.env.TEST_DB_SSL, process.env.TEST_DB_SSL_CA_PATH)
  },
  production: {
    username: process.env.PROD_DB_USERNAME || process.env.DB_USER,
    password: prodDbPassword,
    database: process.env.PROD_DB_NAME || process.env.DB_DATABASE,
    host: process.env.PROD_DB_HOSTNAME || host,
    port: process.env.PROD_DB_PORT || port,
    dialect: 'mysql',
    logging: false,
    timezone: '+00:00',
    dialectOptions: buildDialectOptions(process.env),
    hooks: { beforeConnect: requireUnprivilegedAccount }
  }
};
