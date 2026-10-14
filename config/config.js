require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false
  },
  test: {
    username: process.env.TEST_DB_USER || process.env.DB_USER,
    password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.TEST_DB_DATABASE || 'mercadolibrenode_test',
    host: process.env.TEST_DB_HOST || process.env.DB_HOST,
    port: process.env.TEST_DB_PORT || 3306,
    dialect: 'mysql',
    logging: false
  },
  production: {
    username: process.env.PROD_DB_USERNAME || process.env.DB_USER,
    password: process.env.PROD_DB_PASSWORD || process.env.DB_PASSWORD,
    database: process.env.PROD_DB_NAME || process.env.DB_DATABASE,
    host: process.env.PROD_DB_HOSTNAME || process.env.DB_HOST,
    port: process.env.PROD_DB_PORT || 3306,
    dialect: 'mysql',
    logging: false
  }
};
