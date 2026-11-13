const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.migration.local') });

const {
  MIGRATION_DB_HOST = '127.0.0.1',
  MIGRATION_DB_PORT = '3307',
  MIGRATION_DB_USER,
  MIGRATION_DB_PASSWORD
} = process.env;

if (MIGRATION_DB_USER !== 'ecommerce_migrator' || !MIGRATION_DB_PASSWORD) {
  throw new Error('Configure MIGRATION_DB_USER=ecommerce_migrator and MIGRATION_DB_PASSWORD.');
}

module.exports = {
  migration: {
    username: MIGRATION_DB_USER,
    password: MIGRATION_DB_PASSWORD,
    database: 'secure_ecommerce',
    host: MIGRATION_DB_HOST,
    port: MIGRATION_DB_PORT,
    dialect: 'mysql',
    timezone: '+00:00',
    logging: false
  }
};
