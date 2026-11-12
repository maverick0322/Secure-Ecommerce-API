'use strict';

const create = require('../../migrations/20261110000001-create-secure-ecommerce-tables');
const prepare = require('../../migrations/20261110000002-prepare-existing-ecommerce-tables');
const cutover = require('../../migrations/cutover/20261110000003-finalize-secure-ecommerce-schema');

const legacy = ['users', 'roles', 'products', 'files', 'categories', 'product_categories', 'audit_logs'];
const added = ['admins', 'sellers', 'buyers', 'user_addresses', 'carts', 'cart_items', 'orders', 'order_items', 'order_status_history'];
const uuid = { columnType: 'char(36)', charset: 'utf8mb4', collation: 'utf8mb4_bin' };
const userStatus = "ENUM('ACTIVE','SUSPENDED','DISABLED')";
const orderStatus = "ENUM('PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED')";
const history = [
  { name: '20261110000001-create-secure-ecommerce-tables.js' },
  { name: '20261110000002-prepare-existing-ecommerce-tables.js' }
];

function fixture({ tables = legacy, columns = {}, constraints = [], db = 'secure_ecommerce', sqlMode = 'STRICT_TRANS_TABLES',
  foreignKeyChecks = 1, version = '8.0.41', failCheck = '', emailKeys = [{ INDEX_NAME: 'email' }] } = {}) {
  const statements = [];
  const query = jest.fn(async sql => {
    const statement = sql.trim();
    if (statement.startsWith('SELECT DATABASE()')) return [{ db, version, sqlMode, foreignKeyChecks }];
    if (statement.startsWith('SELECT COLUMN_TYPE')) return [uuid];
    if (statement.startsWith('SELECT name FROM')) return history;
    if (statement.startsWith('SELECT TABLE_NAME AS tableName, COLUMN_NAME')) {
      return Object.entries(columns).flatMap(([tableName, names]) => names.map(name => ({
        tableName, name, charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci'
      })));
    }
    if (statement.startsWith('SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME')) return constraints;
    if (statement.startsWith('SELECT INDEX_NAME')) return emailKeys;
    if (statement.startsWith('SELECT 1')) return failCheck && statement.includes(failCheck) ? [{ found: 1 }] : [];
    statements.push(statement);
    return [];
  });
  return {
    statements,
    queryInterface: {
      sequelize: { query },
      showAllTables: jest.fn(async () => tables),
      describeTable: jest.fn(async table => Object.fromEntries((columns[table] || []).map(name => [name, {}])))
    }
  };
}

const cutoverColumns = {
  users: ['roleId', 'protected', 'name', 'email'],
  categories: ['name'],
  products: ['fileId', 'title'],
  product_categories: ['updatedAt'],
  audit_logs: ['action', 'date']
};

describe('secure_ecommerce migrations (recorded SQL, no database)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('creates exactly the nine new tables in dependency order', async () => {
    const { queryInterface, statements } = fixture();
    await create.up(queryInterface);
    const names = statements.map(sql => sql.match(/^CREATE TABLE (\w+)/)[1]);
    expect(names).toEqual(added);
    expect(statements.every(sql => sql.endsWith('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'))).toBe(true);
    const sql = Object.fromEntries(names.map((name, index) => [name, statements[index]]));
    for (const profile of ['admins', 'buyers', 'sellers']) {
      expect(sql[profile]).toContain('`userId` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY');
      expect(sql[profile]).toContain('FOREIGN KEY (userId) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT');
    }
    expect(sql.sellers).toContain("`status` ENUM('PENDING','APPROVED','REJECTED','SUSPENDED') NOT NULL DEFAULT 'PENDING'");
    expect(sql.sellers).toContain('FOREIGN KEY (reviewedByUserId) REFERENCES admins (userId)');
    expect(sql.user_addresses).toContain("`country` CHAR(2) NOT NULL DEFAULT 'MX'");
    expect(sql.user_addresses).toContain('CHECK (isDefault IN (0, 1))');
    expect(sql.user_addresses).toContain('UNIQUE KEY user_addresses_one_active_default ((CASE WHEN isDefault = 1 AND deletedAt IS NULL THEN buyerId ELSE NULL END))');
    expect(sql.carts).toContain('UNIQUE KEY carts_buyer_unique (buyerId)');
    expect(sql.cart_items).toContain('`cartId` BIGINT UNSIGNED NOT NULL');
    expect(sql.cart_items).toContain('UNIQUE KEY cart_items_cart_product_unique (cartId, productId)');
    expect(sql.cart_items).toContain('CHECK (quantity > 0)');
    expect(sql.cart_items).not.toContain('price');
    expect(sql.orders).toContain(`\`status\` ${orderStatus} NOT NULL DEFAULT 'PENDING'`);
    expect(sql.orders).toContain('UNIQUE KEY orders_checkout_seller_unique (checkoutId, sellerId)');
    expect(sql.orders).toContain('`deliveryAddressSnapshot` JSON NOT NULL');
    expect(sql.orders).toContain('`total` DECIMAL(12,2) NOT NULL');
    expect(sql.orders).toContain('CHECK (total >= 0)');
    expect(sql.order_items).toContain('`productTitle` VARCHAR(255) NOT NULL');
    expect(sql.order_items).toContain('`unitPrice` DECIMAL(12,2) NOT NULL');
    expect(sql.order_items).toContain('CHECK (unitPrice >= 0)');
    expect(sql.order_items).toContain('CHECK (quantity > 0)');
    expect(sql.order_status_history).toContain(`\`previousStatus\` ${orderStatus} NULL`);
    expect(sql.order_status_history).toContain(`\`newStatus\` ${orderStatus} NOT NULL`);
    expect(sql.order_status_history).toContain('`reason` VARCHAR(255) NULL');
    for (const table of ['user_addresses', 'carts', 'cart_items']) expect(sql[table]).toContain('`deletedAt` DATETIME(3) NULL');
    for (const table of ['orders', 'order_items', 'order_status_history']) expect(sql[table]).not.toContain('deletedAt');
    expect(statements.join('\n').match(/ON DELETE RESTRICT ON UPDATE RESTRICT/g)).toHaveLength(14);
  });

  it('resumes creation after a committed table and refuses unexpected columns', async () => {
    const good = fixture({ tables: [...legacy, 'admins'], columns: { admins: ['userId'] } });
    await create.up(good.queryInterface);
    expect(good.statements).toHaveLength(8);
    const drift = fixture({ tables: [...legacy, 'admins'], columns: { admins: ['userId', 'unexpected'] } });
    await expect(create.up(drift.queryInterface)).rejects.toThrow('Unexpected columns in admins');
    expect(drift.statements).toEqual([]);
  });

  it('only adds fields and restrictive references to the five existing tables', async () => {
    const { queryInterface, statements } = fixture();
    await prepare.up(queryInterface);
    expect(statements.map(sql => sql.match(/^ALTER TABLE (\w+)/)[1])).toEqual([
      'users', 'categories', 'products', 'product_categories', 'audit_logs'
    ]);
    expect(statements[0]).toContain(`\`status\` ${userStatus} NOT NULL DEFAULT 'ACTIVE'`);
    expect(statements[0]).toContain('`emailVerifiedAt` DATETIME(3) NULL');
    expect(statements[2]).toContain('`stock` INT UNSIGNED NOT NULL DEFAULT 0');
    expect(statements[2]).toContain('`imagePublicId` VARCHAR(255) NULL');
    expect(statements[2]).toContain('REFERENCES sellers (userId) ON DELETE RESTRICT');
    expect(statements[4]).toContain('`outcome` VARCHAR(16) NULL');
    expect(statements[4]).toContain('`details` JSON NULL');
    expect(statements[4]).toContain('REFERENCES users (id) ON DELETE RESTRICT');
    expect(statements.join('\n')).not.toMatch(/\b(DROP|MODIFY|CHANGE|INSERT|DELETE FROM|UPDATE \w+ SET)\b/);
  });

  it('resumes a committed group and refuses a partial group', async () => {
    const good = fixture({ columns: { users: ['phoneNumber', 'status', 'emailVerifiedAt', 'deletedAt'] } });
    await prepare.up(good.queryInterface);
    expect(good.statements).toHaveLength(4);
    const partial = fixture({ columns: { users: ['phoneNumber'] } });
    await expect(prepare.up(partial.queryInterface)).rejects.toThrow('Unexpected partial column set in users');
    expect(partial.statements).toEqual([]);
  });

  it.each([
    [{ db: 'mercadolibrenode' }, /secure_ecommerce database/],
    [{ sqlMode: '' }, /strict SQL mode/],
    [{ foreignKeyChecks: 0 }, /foreign_key_checks/],
    [{ version: '8.0.15' }, /8.0.18/]
  ])('rejects an incompatible target before DDL (%j)', async (options, message) => {
    const { queryInterface, statements } = fixture(options);
    await expect(create.up(queryInterface)).rejects.toThrow(message);
    await expect(prepare.up(queryInterface)).rejects.toThrow(message);
    expect(statements).toEqual([]);
  });

  it('blocks unapproved cutover before even inspecting the database', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '' });
    const { queryInterface } = fixture();
    await expect(cutover.up(queryInterface)).rejects.toThrow('requires explicit approval');
    expect(queryInterface.sequelize.query).not.toHaveBeenCalled();
  });

  it.each(['u.emailVerifiedAt IS NULL', 'categories WHERE', 'fileId IS NOT NULL', 'occurredAt IS NULL'])('blocks cutover before DDL when %s needs reconciliation', async failCheck => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '1' });
    const { queryInterface, statements } = fixture({ tables: [...legacy, ...added], columns: cutoverColumns, failCheck });
    await expect(cutover.up(queryInterface)).rejects.toThrow('Cutover blocked');
    expect(statements).toEqual([]);
  });

  it('tightens final constraints and removes legacy tables last', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '1' });
    const constraints = ['product_categories_product_id_fk', 'product_categories_category_id_fk']
      .map(name => ({ tableName: 'product_categories', name }));
    const { queryInterface, statements } = fixture({ tables: [...legacy, ...added], columns: cutoverColumns, constraints });
    await cutover.up(queryInterface);
    expect(statements).toHaveLength(7);
    expect(statements[0]).toContain('MODIFY COLUMN emailVerifiedAt DATETIME(3) NOT NULL');
    expect(statements[1]).toContain('ADD UNIQUE KEY categories_name_unique (name)');
    expect(statements[2]).toContain('MODIFY COLUMN price DECIMAL(12,2) NOT NULL');
    expect(statements[2]).toContain('CHECK (price >= 0)');
    expect(statements[3]).toContain('DROP FOREIGN KEY product_categories_product_id_fk');
    expect(statements[4]).toContain('ADD PRIMARY KEY (productId, categoryId)');
    expect(statements[4].match(/ON DELETE RESTRICT/g)).toHaveLength(2);
    expect(statements[5]).toContain('MODIFY COLUMN occurredAt DATETIME(3) NOT NULL');
    expect(statements[6]).toBe('DROP TABLE IF EXISTS roles, files');
  });

  it('blocks cutover if the historical email uniqueness is missing', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '1' });
    const { queryInterface, statements } = fixture({ tables: [...legacy, ...added], columns: cutoverColumns, emailKeys: [] });
    await expect(cutover.up(queryInterface)).rejects.toThrow('users.email unique key is missing');
    expect(statements).toEqual([]);
  });

  it('removes the seller FK before changing nullability and restores it atomically', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '1' });
    const { queryInterface, statements } = fixture({ tables: [...legacy, ...added], columns: cutoverColumns,
      constraints: [{ tableName: 'products', name: 'products_seller_fk' }] });
    await cutover.up(queryInterface);
    const dropIndex = statements.findIndex(sql => sql === 'ALTER TABLE products\n  DROP FOREIGN KEY products_seller_fk');
    const changeIndex = statements.findIndex(sql => sql.includes('MODIFY COLUMN sellerId'));
    expect(dropIndex).toBeGreaterThan(-1);
    expect(changeIndex).toBe(dropIndex + 1);
    expect(statements[changeIndex]).toContain('ADD CONSTRAINT products_seller_fk FOREIGN KEY (sellerId) REFERENCES sellers (userId) ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(statements.join('\n')).not.toContain('foreign_key_checks = 0');
  });

  it('resumes cutover after the historical join keys were removed', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SECURE_ECOMMERCE_CUTOVER_APPROVED: '1' });
    const { queryInterface, statements } = fixture({
      tables: [...legacy, ...added],
      columns: { product_categories: ['updatedAt'] },
      constraints: [{ tableName: 'categories', name: 'categories_name_unique' }]
    });
    await cutover.up(queryInterface);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('ADD PRIMARY KEY (productId, categoryId)');
    expect(statements[1]).toBe('DROP TABLE IF EXISTS roles, files');
  });

  it('refuses automatic undo for all three migrations', () => {
    for (const migration of [create, prepare, cutover]) expect(() => migration.down()).toThrow('Automatic undo is disabled');
  });
});
