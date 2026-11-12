'use strict';

const { execFileSync } = require('node:child_process');
const mysql = require('mysql2/promise');

const expectedUuid = process.env.STAGE25_MYSQL_UUID;
const stage25 = expectedUuid ? describe : describe.skip;
const legacy = ['audit_logs', 'categories', 'files', 'product_categories', 'products', 'roles', 'users'];
const added = ['admins', 'buyers', 'cart_items', 'carts', 'order_items', 'order_status_history', 'orders', 'sellers', 'user_addresses'];
const baseline = '20261108000001-normalize-english-schema.js';
const create = '20261110000001-create-secure-ecommerce-tables.js';
const prepare = '20261110000002-prepare-existing-ecommerce-tables.js';
const legacyDate = '2026-01-01 12:00:00';
const date = `${legacyDate}.123`;
const role = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const buyer = '00000000-0000-4000-8000-000000000003';
const seller = '00000000-0000-4000-8000-000000000004';
const missing = '00000000-0000-4000-8000-000000000005';
const checkout = '00000000-0000-4000-8000-000000000006';

stage25('MySQL 8 isolated secure_ecommerce transition', () => {
  let connection;
  let tablesBefore;
  let before;
  let after;
  let historicalNames;

  async function query(sql, params) {
    const [rows] = await connection.query(sql, params);
    return rows;
  }

  function cli(to) {
    const options = to ? ['--to', to] : [];
    return execFileSync(process.execPath, [
      'node_modules/sequelize-cli/lib/sequelize', 'db:migrate', '--config',
      'config/secure-ecommerce-migrations.js', '--env', 'migration', '--debug', ...options
    ], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, MIGRATION_DB_HOST: '127.0.0.1', MIGRATION_DB_PORT: '13307', MIGRATION_DB_USER: 'ecommerce_migrator' }
    });
  }

  async function definitions(tables) {
    const result = {};
    for (const table of tables) result[table] = (await query(`SHOW CREATE TABLE \`${table}\``))[0]['Create Table'];
    return result;
  }

  async function legacyRows() {
    const result = {};
    for (const table of legacy) {
      const columns = tablesBefore[table].map(name => `\`${name}\``).join(', ');
      result[table] = await query(`SELECT ${columns} FROM \`${table}\` ORDER BY 1, 2`);
    }
    return result;
  }

  async function insertHistoricalFixtures() {
    await query('INSERT INTO roles (id, name, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [role, 'Synthetic role', legacyDate, legacyDate]);
    await query('INSERT INTO files (id, mime, name, size, storedInDatabase, data, createdAt, updatedAt) VALUES (1, ?, ?, 2, 1, ?, ?, ?)',
      ['image/jpeg', 'synthetic.jpg', Buffer.from([1, 2]), legacyDate, legacyDate]);
    await query('INSERT INTO categories (id, name, protected, createdAt, updatedAt) VALUES (1, ?, 1, ?, ?)', ['Synthetic category', legacyDate, legacyDate]);
    await query('INSERT INTO products (id, title, price, fileId, createdAt, updatedAt) VALUES (1, ?, 12.50, 1, ?, ?)', ['Synthetic product', legacyDate, legacyDate]);
    await query('INSERT INTO product_categories (categoryId, productId, createdAt, updatedAt) VALUES (1, 1, ?, ?)', [legacyDate, legacyDate]);
    for (const [id, label] of [[admin, 'admin'], [buyer, 'buyer'], [seller, 'seller']]) {
      await query('INSERT INTO users (id, email, passwordHash, name, protected, roleId, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
        [id, `${label}@example.invalid`, 'synthetic-fixture-hash', label, role, legacyDate, legacyDate]);
    }
    await query('INSERT INTO audit_logs (id, action, elementId, ip, `user`, date, createdAt, updatedAt) VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
      ['synthetic.action', '1', '192.0.2.1', 'admin@example.invalid', legacyDate, legacyDate, legacyDate]);
  }

  beforeAll(async () => {
    expect(process.env.MIGRATION_DB_PASSWORD).toBeTruthy();
    connection = await mysql.createConnection({
      host: '127.0.0.1', port: 13307, database: 'secure_ecommerce', user: 'ecommerce_migrator',
      password: process.env.MIGRATION_DB_PASSWORD, dateStrings: true
    });
    const [identity] = await query(`SELECT @@hostname AS host, @@server_uuid AS uuid, @@port AS port,
      VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account,
      @@session.foreign_key_checks AS foreignKeys, @@session.sql_mode AS mode`);
    expect(identity).toMatchObject({ host: 'secure-ecommerce-stage25', uuid: expectedUuid, port: 3306,
      version: expect.stringMatching(/^8\.0\./), db: 'secure_ecommerce', account: 'ecommerce_migrator@%', foreignKeys: 1,
      mode: expect.stringMatching(/STRICT_(TRANS|ALL)_TABLES/) });
    historicalNames = (await query('SELECT name FROM SequelizeMeta ORDER BY name')).map(row => row.name);
    expect(historicalNames).toHaveLength(8);
    expect(historicalNames.at(-1)).toBe(baseline);
    expect((await query('SHOW TABLES')).map(row => Object.values(row)[0]).sort()).toEqual([...legacy, 'SequelizeMeta'].sort());
    const columns = await query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    tablesBefore = Object.fromEntries(legacy.map(table => [table, columns.filter(row => row.tableName === table).map(row => row.name)]));
    for (const table of legacy) expect(await query(`SELECT 1 FROM \`${table}\` LIMIT 1`)).toEqual([]);
    await insertHistoricalFixtures();
    before = { rows: await legacyRows(), ddl: await definitions(legacy) };
    const output = cli(prepare);
    expect(output).toContain('20261110000001-create-secure-ecommerce-tables: migrated');
    expect(output).toContain('20261110000002-prepare-existing-ecommerce-tables: migrated');
    after = { rows: await legacyRows(), ddl: await definitions([...legacy, ...added]) };
    await query('INSERT INTO admins (userId) VALUES (?)', [admin]);
    await query('INSERT INTO buyers (userId) VALUES (?)', [buyer]);
    await query('INSERT INTO sellers (userId, storeName, requestedAt, updatedAt) VALUES (?, ?, ?, ?)', [seller, 'Synthetic seller', date, date]);
    await query('UPDATE products SET sellerId = ?, stock = 5 WHERE id = 1', [seller]);
  }, 90000);

  afterAll(async () => { if (connection) await connection.end(); });

  async function inTransaction(test) {
    await connection.beginTransaction();
    try { await test(); } finally { await connection.rollback(); }
  }

  const invalid = (sql, params, errno) => expect(query(sql, params)).rejects.toMatchObject({ errno });
  // MySQL can report a generic FK violation or the variant with constraint details.
  const invalidReference = (sql, params) => expect(query(sql, params)).rejects.toMatchObject({
    code: expect.stringMatching(/^ER_NO_REFERENCED_ROW(?:_2)?$/)
  });

  it('contains the 16 business tables and preserves all historical fixture rows', async () => {
    expect((await query('SHOW TABLES')).map(row => Object.values(row)[0]).sort()).toEqual([...legacy, ...added, 'SequelizeMeta'].sort());
    expect(after.rows).toEqual(before.rows);
    expect(after.ddl.roles).toBe(before.ddl.roles);
    expect(after.ddl.files).toBe(before.ddl.files);
    expect(after.ddl.users).toContain('`roleId`');
    expect(after.ddl.products).toContain('`fileId`');
    expect(after.ddl.product_categories).toContain('`updatedAt`');
    expect(after.ddl.audit_logs).toContain('`elementId`');
    expect(after.ddl.user_addresses).toContain('user_addresses_one_active_default');
  });

  it('reports the expected primary keys and foreign key actions', async () => {
    const primary = await query(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    for (const table of [...legacy, ...added]) {
      const expected = ['admins', 'buyers', 'sellers'].includes(table) ? ['userId'] : table === 'product_categories' ? ['categoryId', 'productId'] : ['id'];
      expect(primary.filter(row => row.t === table).map(row => row.c)).toEqual(expected);
    }
    const fks = await query(`SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS p,
      k.REFERENCED_COLUMN_NAME AS pc, r.DELETE_RULE AS d, r.UPDATE_RULE AS u
      FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND k.TABLE_NAME = r.TABLE_NAME AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
    expect(fks).toHaveLength(20);
    const newEdges = [
      ['admins', 'userId', 'users', 'id'], ['buyers', 'userId', 'users', 'id'], ['sellers', 'userId', 'users', 'id'],
      ['sellers', 'reviewedByUserId', 'admins', 'userId'], ['user_addresses', 'buyerId', 'buyers', 'userId'],
      ['carts', 'buyerId', 'buyers', 'userId'], ['cart_items', 'cartId', 'carts', 'id'], ['cart_items', 'productId', 'products', 'id'],
      ['orders', 'buyerId', 'buyers', 'userId'], ['orders', 'sellerId', 'sellers', 'userId'],
      ['order_items', 'orderId', 'orders', 'id'], ['order_items', 'productId', 'products', 'id'],
      ['order_status_history', 'orderId', 'orders', 'id'], ['order_status_history', 'changedByUserId', 'users', 'id'],
      ['products', 'sellerId', 'sellers', 'userId'], ['audit_logs', 'actorUserId', 'users', 'id']
    ];
    expect(fks).toEqual(expect.arrayContaining(newEdges.map(([t, c, p, pc]) => ({ t, c, p, pc, d: 'RESTRICT', u: 'RESTRICT' }))));
    expect(fks).toEqual(expect.arrayContaining([
      { t: 'users', c: 'roleId', p: 'roles', pc: 'id', d: 'CASCADE', u: 'CASCADE' },
      { t: 'products', c: 'fileId', p: 'files', pc: 'id', d: 'SET NULL', u: 'CASCADE' },
      { t: 'product_categories', c: 'categoryId', p: 'categories', pc: 'id', d: 'CASCADE', u: 'CASCADE' },
      { t: 'product_categories', c: 'productId', p: 'products', pc: 'id', d: 'CASCADE', u: 'CASCADE' }
    ]));
  });

  it('reports the transition types, defaults, enum values and nullability', async () => {
    const rows = await query(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type,
      IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, COLLATION_NAME AS collation
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`);
    const column = (t, c) => rows.find(row => row.t === t && row.c === c);
    const orderEnum = "enum('PENDING','PREPARING','SHIPPED','DELIVERED','CANCELED')";
    expect(column('users', 'status')).toMatchObject({ type: "enum('ACTIVE','SUSPENDED','DISABLED')", def: 'ACTIVE', nullable: 'NO' });
    expect(column('sellers', 'status')).toMatchObject({ type: "enum('PENDING','APPROVED','REJECTED','SUSPENDED')", def: 'PENDING', nullable: 'NO' });
    expect(column('orders', 'status')).toMatchObject({ type: orderEnum, def: 'PENDING', nullable: 'NO' });
    expect(column('order_status_history', 'previousStatus')).toMatchObject({ type: orderEnum, nullable: 'YES' });
    expect(column('order_status_history', 'newStatus')).toMatchObject({ type: orderEnum, nullable: 'NO' });
    expect(column('order_status_history', 'reason')).toMatchObject({ type: 'varchar(255)', nullable: 'YES' });
    expect(column('orders', 'deliveryAddressSnapshot')).toMatchObject({ type: 'json', nullable: 'NO' });
    expect(column('orders', 'total')).toMatchObject({ type: 'decimal(12,2)', nullable: 'NO' });
    expect(column('order_items', 'unitPrice')).toMatchObject({ type: 'decimal(12,2)', nullable: 'NO' });
    expect(column('audit_logs', 'details')).toMatchObject({ type: 'json', nullable: 'YES' });
    expect(column('products', 'price')).toMatchObject({ type: 'decimal(10,2)', nullable: 'NO' });
    expect(column('products', 'stock')).toMatchObject({ type: 'int unsigned', nullable: 'NO', def: '0' });
    expect(column('users', 'emailVerifiedAt')).toMatchObject({ type: 'datetime(3)', nullable: 'YES' });
    expect(column('sellers', 'userId').collation).toBe(column('users', 'id').collation);
  });

  it('enforces unique carts, cart items, and email, and rejects invalid quantities and inventory', () => inTransaction(async () => {
    const cart = 'INSERT INTO carts (buyerId, createdAt, updatedAt) VALUES (?, ?, ?)';
    const { insertId } = await query(cart, [buyer, date, date]);
    await invalid(cart, [buyer, date, date], 1062);
    await invalidReference(cart, [seller, date, date]);
    const item = 'INSERT INTO cart_items (cartId, productId, quantity, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)';
    await query(item, [insertId, 1, 2, date, date]);
    await invalid(item, [insertId, 1, 2, date, date], 1062);
    await invalid(item, [insertId, 1, 0, date, date], 3819);
    await invalidReference(item, [insertId, 999, 1, date, date]);
    await invalid('UPDATE users SET email = ? WHERE id = ?', ['buyer@example.invalid', seller], 1062);
    await invalid('UPDATE products SET stock = -1 WHERE id = 1', [], 1264);
    expect((await query('SELECT stock FROM products WHERE id = 1'))[0].stock).toBe(5);
  }));

  it('permits a replacement default only after the previous default is inactive', () => inTransaction(async () => {
    const address = `INSERT INTO user_addresses (buyerId, recipientName, street, exteriorNumber, neighborhood,
      city, state, postalCode, isDefault, createdAt, updatedAt) VALUES (?, 'Synthetic', 'Test street', '1', 'Test', 'Test', 'Test', '00000', ?, ?, ?)`;
    const { insertId } = await query(address, [buyer, 1, date, date]);
    await query(address, [buyer, 0, date, date]);
    await invalid(address, [buyer, 1, date, date], 1062);
    await invalid(address, [buyer, 2, date, date], 3819);
    await query('UPDATE user_addresses SET deletedAt = ? WHERE id = ?', [date, insertId]);
    await query(address, [buyer, 1, date, date]);
    expect((await query('SELECT COUNT(*) AS n FROM user_addresses WHERE buyerId = ? AND isDefault = 1 AND deletedAt IS NULL', [buyer]))[0].n).toBe(1);
  }));

  it('enforces order relationships, enum, nonnegative amounts and snapshots', () => inTransaction(async () => {
    const order = 'INSERT INTO orders (buyerId, sellerId, checkoutId, total, deliveryAddressSnapshot, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)';
    const snapshot = JSON.stringify({ street: 'Synthetic address' });
    const args = [buyer, seller, checkout, '25.00', snapshot, date, date];
    await invalidReference(order, [seller, seller, ...args.slice(2)]);
    await invalidReference(order, [buyer, buyer, ...args.slice(2)]);
    await invalid(order, [buyer, seller, checkout, '-1.00', snapshot, date, date], 3819);
    await invalid(order, [buyer, seller, checkout, '25.00', 'invalid-json', date, date], 3140);
    await invalid(order, [buyer, seller, checkout, '25.00', null, date, date], 1048);
    const { insertId } = await query(order, args);
    await invalid(order, args, 1062);
    await invalid('UPDATE orders SET status = ? WHERE id = ?', ['UNKNOWN', insertId], 1265);
    await invalid('UPDATE sellers SET status = ? WHERE userId = ?', ['UNKNOWN', seller], 1265);
    await invalid('UPDATE users SET status = ? WHERE id = ?', ['UNKNOWN', buyer], 1265);
    await expect(query('UPDATE buyers SET userId = ? WHERE userId = ?', [admin, buyer])).rejects.toMatchObject({
      code: expect.stringMatching(/^ER_ROW_IS_REFERENCED(?:_2)?$/)
    });
    const item = 'INSERT INTO order_items (orderId, productId, productTitle, quantity, unitPrice) VALUES (?, 1, ?, ?, ?)';
    await invalid(item, [insertId, 'Synthetic product', 0, '12.50'], 3819);
    await invalid(item, [insertId, 'Synthetic product', 2, '-1.00'], 3819);
    await query(item, [insertId, 'Synthetic product', 2, '12.50']);
    const history = 'INSERT INTO order_status_history (orderId, previousStatus, newStatus, changedByUserId, occurredAt) VALUES (?, ?, ?, ?, ?)';
    await query(history, [insertId, null, 'PENDING', admin, date]);
    await query(history, [insertId, 'PENDING', 'PREPARING', null, date]);
    await invalid(history, [insertId, 'UNKNOWN', 'PREPARING', admin, date], 1265);
    await invalid(history, [insertId, 'PENDING', null, admin, date], 1048);
    await invalidReference(history, [insertId, 'PENDING', 'PREPARING', missing, date]);
    await query('UPDATE products SET title = ?, price = 15.00 WHERE id = 1', ['Synthetic renamed']);
    const [saved] = await query(`SELECT o.status, o.total, o.createdAt, JSON_UNQUOTE(JSON_EXTRACT(o.deliveryAddressSnapshot, '$.street')) AS street,
      i.productTitle, i.unitPrice FROM orders o JOIN order_items i ON i.orderId = o.id WHERE o.id = ?`, [insertId]);
    expect(saved).toEqual({ status: 'PENDING', total: '25.00', createdAt: date, street: 'Synthetic address', productTitle: 'Synthetic product', unitPrice: '12.50' });
  }));

  it('retains the legacy catalog price behavior pending the separate cutover constraint', () => inTransaction(async () => {
    await query('UPDATE products SET price = -1.00 WHERE id = 1');
    expect((await query('SELECT price FROM products WHERE id = 1'))[0].price).toBe('-1.00');
  }));

  it('re-running pending migrations is a no-op and leaves the cutover unapplied', async () => {
    const expected = [...historicalNames, create, prepare];
    expect((await query('SELECT name FROM SequelizeMeta ORDER BY name')).map(row => row.name)).toEqual(expected);
    const ddl = await definitions([...legacy, ...added]);
    expect(cli()).toContain('No migrations were executed, database schema was already up to date.');
    expect((await query('SELECT name FROM SequelizeMeta ORDER BY name')).map(row => row.name)).toEqual(expected);
    expect(await definitions([...legacy, ...added])).toEqual(ddl);
  }, 90000);
});
