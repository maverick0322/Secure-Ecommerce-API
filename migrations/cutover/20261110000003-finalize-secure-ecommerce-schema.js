'use strict';

const { select, requireTarget, characterOptions, legacyUuid, foreignKey, alter, rejectUndo } = require('../support/secure-ecommerce');

const businessTables = [
  'users', 'admins', 'sellers', 'buyers', 'user_addresses', 'categories', 'products',
  'product_categories', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history', 'audit_logs'
];
const legacyTables = ['roles', 'files'];
const requiredMigrations = [
  '20261110000001-create-secure-ecommerce-tables.js',
  '20261110000002-prepare-existing-ecommerce-tables.js'
];

async function assertNoRows(queryInterface, condition, sql) {
  if ((await select(queryInterface, sql)).length > 0) {
    throw new Error(`Cutover blocked: ${condition}. Reconcile the data before retrying.`);
  }
}

async function validateData(queryInterface, columns) {
  const emailKeys = await select(queryInterface, `
    SELECT INDEX_NAME FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND NON_UNIQUE = 0
    GROUP BY INDEX_NAME
    HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME = 'email' AND SUB_PART IS NULL) = 1`);
  if (emailKeys.length === 0) {
    throw new Error('Cutover blocked: the historical users.email unique key is missing.');
  }
  await assertNoRows(queryInterface, 'users need verified emails, valid lengths and exactly one profile', `
    SELECT 1 FROM users u
    LEFT JOIN admins a ON a.userId = u.id
    LEFT JOIN sellers s ON s.userId = u.id
    LEFT JOIN buyers b ON b.userId = u.id
    WHERE u.emailVerifiedAt IS NULL OR CHAR_LENGTH(u.name) > 120 OR CHAR_LENGTH(u.email) > 254
       OR ((a.userId IS NOT NULL) + (s.userId IS NOT NULL) + (b.userId IS NOT NULL)) <> 1
    LIMIT 1`);
  await assertNoRows(queryInterface, 'categories need unique names of at most 120 characters and a valid protected value', `
    SELECT 1 FROM categories WHERE CHAR_LENGTH(name) > 120 OR protected IS NULL OR protected NOT IN (0, 1)
    UNION ALL
    SELECT 1 FROM categories GROUP BY name HAVING COUNT(*) > 1 LIMIT 1`);
  const imageCheck = columns.products.fileId ? "OR (fileId IS NOT NULL AND NULLIF(TRIM(imagePublicId), '') IS NULL)" : '';
  await assertNoRows(queryInterface, 'products need sellers, titles, nonnegative prices and reconciled image references', `
    SELECT 1 FROM products WHERE sellerId IS NULL OR title IS NULL OR price < 0 ${imageCheck} LIMIT 1`);
  await assertNoRows(queryInterface, 'audit logs need an outcome, a timestamp and actions of at most 80 characters', `
    SELECT 1 FROM audit_logs
    WHERE outcome IS NULL OR TRIM(outcome) = '' OR occurredAt IS NULL OR CHAR_LENGTH(action) > 80 LIMIT 1`);
}

async function up(queryInterface) {
  if (process.env.SECURE_ECOMMERCE_CUTOVER_APPROVED !== '1') {
    throw new Error('Cutover requires explicit approval after reconciliation and a verified backup.');
  }
  await requireTarget(queryInterface);
  const actualTables = (await queryInterface.showAllTables()).map(name => name.toLowerCase());
  const allowedTables = [...businessTables, ...legacyTables, 'sequelizemeta'];
  if (businessTables.some(table => !actualTables.includes(table)) || actualTables.some(table => !allowedTables.includes(table))) {
    throw new Error('Unexpected tables in secure_ecommerce. Review the schema before cutover.');
  }
  const history = new Set((await select(queryInterface, 'SELECT name FROM `SequelizeMeta`')).map(row => row.name));
  if (requiredMigrations.some(name => !history.has(name))) {
    throw new Error('Apply both additive secure_ecommerce migrations before cutover.');
  }

  const metadata = await select(queryInterface, `
    SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('users', 'categories', 'products', 'product_categories', 'audit_logs')`);
  const columns = { users: {}, categories: {}, products: {}, product_categories: {}, audit_logs: {} };
  for (const column of metadata) columns[column.tableName][column.name] = column;
  const constraints = await select(queryInterface, `
    SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name
    FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()`);
  const hasConstraint = (table, name) => constraints.some(row => row.tableName === table && row.name === name);
  const uuid = await legacyUuid(queryInterface);
  const requiredText = (table, field, length) => `VARCHAR(${length}) ${characterOptions(columns[table][field])} NOT NULL`;

  await validateData(queryInterface, columns);

  if (columns.users.roleId) {
    await alter(queryInterface, 'users', [
      `MODIFY COLUMN name ${requiredText('users', 'name', 120)}`,
      `MODIFY COLUMN email ${requiredText('users', 'email', 254)}`,
      'MODIFY COLUMN emailVerifiedAt DATETIME(3) NOT NULL',
      'MODIFY COLUMN createdAt DATETIME(3) NOT NULL',
      'MODIFY COLUMN updatedAt DATETIME(3) NOT NULL',
      'DROP FOREIGN KEY users_role_id_fk',
      'DROP COLUMN roleId',
      'DROP COLUMN protected'
    ]);
  }
  if (!hasConstraint('categories', 'categories_name_unique')) {
    await alter(queryInterface, 'categories', [
      `MODIFY COLUMN name ${requiredText('categories', 'name', 120)}`,
      'MODIFY COLUMN protected TINYINT(1) NOT NULL DEFAULT 0',
      'MODIFY COLUMN createdAt DATETIME(3) NOT NULL',
      'MODIFY COLUMN updatedAt DATETIME(3) NOT NULL',
      'ADD UNIQUE KEY categories_name_unique (name)',
      'ADD CONSTRAINT categories_protected_valid CHECK (protected IN (0, 1))'
    ]);
  }
  if (columns.products.fileId) {
    // MySQL 8 rejects changing nullability while this column has an FK (1832).
    // Keep checks enabled; validate data first, then restore the restrictive FK
    // in the same atomic ALTER that changes the column. Re-entry also handles
    // interruption after the first ALTER, while fileId still marks this step.
    if (hasConstraint('products', 'products_seller_fk')) {
      await alter(queryInterface, 'products', ['DROP FOREIGN KEY products_seller_fk']);
    }
    await alter(queryInterface, 'products', [
      `MODIFY COLUMN sellerId ${uuid} NOT NULL`,
      `MODIFY COLUMN title ${requiredText('products', 'title', 255)}`,
      'MODIFY COLUMN description TEXT NULL',
      'MODIFY COLUMN price DECIMAL(12,2) NOT NULL',
      'MODIFY COLUMN createdAt DATETIME(3) NOT NULL',
      'MODIFY COLUMN updatedAt DATETIME(3) NOT NULL',
      `ADD ${foreignKey('products_seller_fk', 'sellerId', 'sellers', 'userId')}`,
      'ADD CONSTRAINT products_price_nonnegative CHECK (price >= 0)',
      'DROP FOREIGN KEY products_file_id_fk',
      'DROP COLUMN fileId'
    ]);
  }
  if (columns.product_categories.updatedAt) {
    const oldKeys = ['product_categories_product_id_fk', 'product_categories_category_id_fk'];
    const drops = oldKeys.filter(name => hasConstraint('product_categories', name)).map(name => `DROP FOREIGN KEY ${name}`);
    // With FK checks enabled, dropping old keys and adding their replacements may require separate ALTERs.
    if (drops.length > 0) await alter(queryInterface, 'product_categories', drops);
    await alter(queryInterface, 'product_categories', [
      'DROP PRIMARY KEY',
      'ADD PRIMARY KEY (productId, categoryId)',
      'MODIFY COLUMN createdAt DATETIME(3) NOT NULL',
      'DROP COLUMN updatedAt',
      `ADD ${foreignKey('product_categories_product_restrict_fk', 'productId', 'products', 'id')}`,
      `ADD ${foreignKey('product_categories_category_restrict_fk', 'categoryId', 'categories', 'id')}`
    ]);
  }
  if (columns.audit_logs.date) {
    await alter(queryInterface, 'audit_logs', [
      `MODIFY COLUMN action ${requiredText('audit_logs', 'action', 80)}`,
      'MODIFY COLUMN outcome VARCHAR(16) NOT NULL',
      'MODIFY COLUMN occurredAt DATETIME(3) NOT NULL',
      ...['elementId', 'ip', 'user', 'date', 'createdAt', 'updatedAt'].map(name => `DROP COLUMN \`${name}\``)
    ]);
  }
  if (legacyTables.some(table => actualTables.includes(table))) {
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS roles, files');
  }
}

module.exports = { up, down: rejectUndo };
