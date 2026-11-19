require('dotenv').config();
const { readEnvSecret } = require('../services/secret-env.service');

const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT || 3307;

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
    dialectOptions: { supportBigNumbers: true, bigNumberStrings: true },
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
    dialectOptions: { supportBigNumbers: true, bigNumberStrings: true }
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
    dialectOptions: { supportBigNumbers: true, bigNumberStrings: true },
    hooks: { beforeConnect: requireUnprivilegedAccount }
  }
};
