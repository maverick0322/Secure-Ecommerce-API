'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, business, artifact, assertEmpty } = require('./stage4');
const { contract, edges } = require('./stage4-contract');

async function verifySchema() {
  const c = await connect('ecommerce_migrator');
  const q = async (sql, values) => (await c.query(sql, values))[0];
  try {
    const tables = (await q('SHOW TABLES')).map(r => Object.values(r)[0]).sort();
    assert.deepEqual(tables, [...business, 'SequelizeMeta'].sort());
    const columns = await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type,
      IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, EXTRA AS extra,
      CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    for (const [table, fields] of Object.entries(contract)) {
      const actual = columns.filter(r => r.t === table);
      assert.deepEqual(actual.map(r => r.c).sort(), Object.keys(fields).sort(), table);
      for (const [name, value] of Object.entries(fields)) {
        const expected = typeof value === 'string' ? { type: value, nullable: 'NO', def: null } : value;
        const field = actual.find(r => r.c === name);
        assert.deepEqual({ type: field.type, nullable: field.nullable, def: field.def }, expected, `${table}.${name}`);
        assert.equal(field.extra.includes('auto_increment'), name === 'id' && table !== 'users', `${table}.${name} auto increment`);
      }
    }
    const primary = await q(`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME='PRIMARY' ORDER BY TABLE_NAME, ORDINAL_POSITION`);
    for (const table of business) assert.deepEqual(primary.filter(r => r.t === table).map(r => r.c),
      table === 'product_categories' ? ['productId','categoryId'] : ['admins','sellers','buyers'].includes(table) ? ['userId'] : ['id'], `${table} PK`);
    const fks = await q(`SELECT k.TABLE_NAME AS t, k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS p,
      k.REFERENCED_COLUMN_NAME AS pc, k.REFERENCED_TABLE_SCHEMA AS ps, r.DELETE_RULE AS d, r.UPDATE_RULE AS u
      FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA AND k.TABLE_NAME=r.TABLE_NAME AND k.CONSTRAINT_NAME=r.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL`);
    assert.deepEqual(fks.map(r => [r.t,r.c,r.p,r.pc].join('.')).sort(), edges.map(e => e.join('.')).sort());
    for (const fk of fks) {
      assert.equal(fk.ps, 'secure_ecommerce');
      assert.equal(fk.d, 'RESTRICT'); assert.equal(fk.u, 'RESTRICT');
      const source = columns.find(r => r.t === fk.t && r.c === fk.c);
      const target = columns.find(r => r.t === fk.p && r.c === fk.pc);
      for (const key of ['type','charset','collation']) assert.equal(source[key], target[key], `${fk.t}.${fk.c} ${key}`);
    }
    const indexes = await q(`SELECT TABLE_NAME AS t, INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
      COLUMN_NAME AS c, EXPRESSION AS expression, SEQ_IN_INDEX AS seq FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`);
    for (const [table, fields] of [['users',['email']],['categories',['name']],['carts',['buyerId']],
      ['cart_items',['cartId','productId']],['orders',['checkoutId','sellerId']]]) {
      const names = [...new Set(indexes.filter(r => r.t === table && r.nonUnique === 0).map(r => r.name))];
      assert(names.some(n => JSON.stringify(indexes.filter(r => r.t === table && r.name === n).map(r => r.c)) === JSON.stringify(fields)), `${table} UNIQUE`);
    }
    const activeDefault = indexes.find(r => r.t === 'user_addresses' && r.name === 'user_addresses_one_active_default');
    assert.equal(activeDefault.nonUnique, 0);
    assert.match(activeDefault.expression, /case.*isDefault.*deletedAt.*buyerId.*NULL/is);
    for (const fk of fks) assert(indexes.some(r => r.t === fk.t && r.c === fk.c && r.seq === 1), `${fk.t}.${fk.c} index`);
    const checks = await q(`SELECT t.TABLE_NAME AS t, t.CONSTRAINT_NAME AS name, t.ENFORCED AS enforced, c.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
      ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
      WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.CONSTRAINT_TYPE='CHECK'`);
    assert.deepEqual(checks.map(r => r.name).sort(), ['categories_protected_valid','products_price_nonnegative',
      'user_addresses_default_valid','cart_items_quantity_positive','orders_total_nonnegative',
      'order_items_quantity_positive','order_items_unit_price_nonnegative'].sort());
    assert(checks.every(r => r.enforced === 'YES'));
    const ddl = {};
    for (const table of tables) ddl[table] = (await q(`SHOW CREATE TABLE \`${table}\``))[0]['Create Table'];
    const engines = await q(`SELECT TABLE_NAME AS t, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);
    assert(engines.every(r => r.engine === 'InnoDB'));
    await assertEmpty(c, tables);
    artifact('schema-verification.json', { verifiedAt: new Date().toISOString(), tables, columns, primary, fks, indexes, checks, engines, ddl });
    console.log(`Schema verified: ${business.length} business tables, ${columns.filter(r => r.t !== 'SequelizeMeta').length} columns, ${fks.length} restrictive FKs, ${checks.length} enforced CHECKs.`);
  } finally { await c.end(); }
}

async function verifyData() {
  const c = await connect('ecommerce_migrator');
  const q = async (sql, values) => (await c.query(sql, values))[0];
  const checks = [];
  const check = (name, fn) => Promise.resolve().then(fn).then(() => { checks.push(name); });
  const rejects = async (name, sql, values, numbers) => {
    // MySQL may hide FK details behind the generic 1216/1217 variants.
    const allowed = [...numbers, ...(numbers.includes(1452) ? [1216] : []), ...(numbers.includes(1451) ? [1217] : [])];
    await assert.rejects(() => q(sql, values), error => {
      assert(allowed.includes(error.errno), `${name}: unexpected MySQL ${error.code} (${error.errno})`);
      return true;
    }, name);
    checks.push(name);
  };
  const a = crypto.randomUUID(), b = crypto.randomUUID(), s = crypto.randomUUID(), missing = crypto.randomUUID(), checkout = crypto.randomUUID();
  const now = '2026-11-10 12:00:00.123';
  const hash = require('bcrypt').hashSync(crypto.randomBytes(32).toString('base64'), 10);
  let emptyAfter;
  try {
    await assertEmpty(c, business);
    await c.beginTransaction();
    for (const [id, name] of [[a,'admin'],[b,'buyer'],[s,'seller']]) await q(`INSERT INTO users
      (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`, [id,name,`${id}@example.invalid`,hash,now,now,now]);
    await q('INSERT INTO admins (userId) VALUES (?)', [a]);
    await q('INSERT INTO buyers (userId) VALUES (?)', [b]);
    await q(`INSERT INTO sellers (userId,storeName,requestedAt,updatedAt) VALUES (?,'Synthetic store',?,?)`, [s,now,now]);
    assert.equal((await q('SELECT status FROM sellers WHERE userId=?',[s]))[0].status,'PENDING');
    await q("UPDATE sellers SET status='APPROVED',reviewedByUserId=?,reviewedAt=? WHERE userId=?",[a,now,s]);
    const p = (await q(`INSERT INTO products (sellerId,title,price,stock,createdAt,updatedAt) VALUES (?,'Snapshot title',12.50,10,?,?)`,[s,now,now])).insertId;
    const cat = (await q(`INSERT INTO categories (name,createdAt,updatedAt) VALUES ('Synthetic category',?,?)`,[now,now])).insertId;
    await q('INSERT INTO product_categories (productId,categoryId,createdAt) VALUES (?,?,?)',[p,cat,now]);
    const addressSQL = `INSERT INTO user_addresses (buyerId,recipientName,street,exteriorNumber,neighborhood,city,state,postalCode,isDefault,createdAt,updatedAt)
      VALUES (?,'Synthetic recipient','Original street','1','District','City','State','01000',?,?,?)`;
    const address = (await q(addressSQL,[b,1,now,now])).insertId;
    await q(addressSQL,[b,0,now,now]);
    const cartSQL = 'INSERT INTO carts (buyerId,createdAt,updatedAt) VALUES (?,?,?)';
    const cart = (await q(cartSQL,[b,now,now])).insertId;
    const itemSQL = 'INSERT INTO cart_items (cartId,productId,quantity,createdAt,updatedAt) VALUES (?,?,?,?,?)';
    await q(itemSQL,[cart,p,2,now,now]);
    const snapshot = { recipientName:'Synthetic recipient',street:'Original street',exteriorNumber:'1',neighborhood:'District',city:'City',state:'State',postalCode:'01000',country:'MX' };
    const orderSQL = `INSERT INTO orders (buyerId,sellerId,checkoutId,total,deliveryAddressSnapshot,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`;
    const order = (await q(orderSQL,[b,s,checkout,'25.00',JSON.stringify(snapshot),now,now])).insertId;
    const detailSQL = 'INSERT INTO order_items (orderId,productId,productTitle,quantity,unitPrice) VALUES (?,?,?,?,?)';
    await q(detailSQL,[order,p,'Snapshot title',2,'12.50']);
    await q(`INSERT INTO order_status_history (orderId,newStatus,occurredAt) VALUES (?,'PENDING',?)`,[order,now]);
    await q(`INSERT INTO audit_logs (actorUserId,action,outcome,details,occurredAt) VALUES (?,'stage4.synthetic','SUCCESS',?,?)`,[a,JSON.stringify({synthetic:true}),now]);
    checks.push('valid inserts in all 14 business tables');
    await check('defaults and fractional UTC dates',async () => {
      const [user] = await q('SELECT status,createdAt FROM users WHERE id=?',[b]);
      assert.equal(user.status,'ACTIVE'); assert.equal(user.createdAt,now);
      assert.equal((await q('SELECT country FROM user_addresses WHERE id=?',[address]))[0].country,'MX');
      assert.equal((await q('SELECT status FROM orders WHERE id=?',[order]))[0].status,'PENDING');
      const profiles = await q(`SELECT u.id FROM users u LEFT JOIN admins a ON a.userId=u.id LEFT JOIN buyers b ON b.userId=u.id
        LEFT JOIN sellers s ON s.userId=u.id WHERE ((a.userId IS NOT NULL)+(b.userId IS NOT NULL)+(s.userId IS NOT NULL))<>1`);
      assert.deepEqual(profiles,[]);
    });
    await rejects('missing parent FK','INSERT INTO buyers (userId) VALUES (?)',[missing],[1452]);
    await rejects('wrong profile in cart',cartSQL,[s,now,now],[1452]);
    await rejects('wrong profile in order',orderSQL,[s,s,crypto.randomUUID(),'25.00',JSON.stringify(snapshot),now,now],[1452]);
    await rejects('missing product FK',detailSQL,[order,2147483647,'Missing',1,'1.00'],[1452]);
    await rejects('duplicate email','UPDATE users SET email=? WHERE id=?',[`${b}@example.invalid`,s],[1062]);
    await rejects('duplicate category',`INSERT INTO categories (name,createdAt,updatedAt) VALUES ('Synthetic category',?,?)`,[now,now],[1062]);
    await rejects('duplicate product category','INSERT INTO product_categories (productId,categoryId,createdAt) VALUES (?,?,?)',[p,cat,now],[1062]);
    await rejects('one cart per buyer',cartSQL,[b,now,now],[1062]);
    await q('UPDATE carts SET deletedAt=? WHERE id=?',[now,cart]);
    await rejects('soft deleted cart still unique',cartSQL,[b,now,now],[1062]);
    await q('UPDATE carts SET deletedAt=NULL WHERE id=?',[cart]);
    await rejects('one product per cart',itemSQL,[cart,p,1,now,now],[1062]);
    await rejects('one order per checkout and seller',orderSQL,[b,s,checkout,'25.00',JSON.stringify(snapshot),now,now],[1062]);
    await rejects('one active default address',addressSQL,[b,1,now,now],[1062]);
    await q('UPDATE user_addresses SET deletedAt=? WHERE id=?',[now,address]);
    await q(addressSQL,[b,1,now,now]); checks.push('replacement default address after soft delete');
    await rejects('reactivation cannot duplicate default','UPDATE user_addresses SET deletedAt=NULL WHERE id=?',[address],[1062]);
    await rejects('isDefault boolean','UPDATE user_addresses SET isDefault=2 WHERE id=?',[address],[3819]);
    await rejects('protected boolean','UPDATE categories SET protected=2 WHERE id=?',[cat],[3819]);
    await rejects('negative product price','UPDATE products SET price=-0.01 WHERE id=?',[p],[3819]);
    await rejects('negative stock','UPDATE products SET stock=-1 WHERE id=?',[p],[1264]);
    for (const [table,id] of [['cart_items',(await q('SELECT id FROM cart_items WHERE cartId=?',[cart]))[0].id],['order_items',(await q('SELECT id FROM order_items WHERE orderId=?',[order]))[0].id]]) {
      await rejects(`${table} zero quantity`,`UPDATE ${table} SET quantity=0 WHERE id=?`,[id],[3819]);
      await rejects(`${table} negative quantity`,`UPDATE ${table} SET quantity=-1 WHERE id=?`,[id],[1264]);
    }
    await rejects('negative historical unit price','UPDATE order_items SET unitPrice=-0.01 WHERE orderId=?',[order],[3819]);
    await rejects('negative order total','UPDATE orders SET total=-0.01 WHERE id=?',[order],[3819]);
    for (const [table,key,id] of [['users','id',b],['sellers','userId',s],['orders','id',order]]) {
      await rejects(`${table} invalid ENUM`,`UPDATE ${table} SET status='INVALID' WHERE ${key}=?`,[id],[1265]);
    }
    await rejects('history invalid ENUM',`INSERT INTO order_status_history (orderId,newStatus,occurredAt) VALUES (?,'INVALID',?)`,[order,now],[1265]);
    await rejects('history requires newStatus','INSERT INTO order_status_history (orderId,newStatus,occurredAt) VALUES (?,NULL,?)',[order,now],[1048]);
    await rejects('verified email required','UPDATE users SET emailVerifiedAt=NULL WHERE id=?',[b],[1048]);
    await rejects('product seller required','UPDATE products SET sellerId=NULL WHERE id=?',[p],[1048]);
    await rejects('address snapshot required','UPDATE orders SET deliveryAddressSnapshot=NULL WHERE id=?',[order],[1048]);
    await rejects('snapshot valid JSON','UPDATE orders SET deliveryAddressSnapshot=? WHERE id=?',['invalid-json',order],[3140]);
    await rejects('restrict parent key update','UPDATE users SET id=? WHERE id=?',[crypto.randomUUID(),b],[1451]);
    await q('UPDATE products SET title=?,price=9999999999.99,stock=0,deletedAt=? WHERE id=?',['Changed title',now,p]);
    await rejects('DECIMAL(12,2) overflow','UPDATE products SET price=10000000000.00 WHERE id=?',[p],[1264]);
    await q("UPDATE user_addresses SET street='Changed street' WHERE id=?",[address]);
    await check('snapshots preserved after catalog and address changes',async () => {
      const [detail] = await q('SELECT productTitle,unitPrice,quantity FROM order_items WHERE orderId=?',[order]);
      assert.equal(detail.productTitle,'Snapshot title'); assert.equal(detail.unitPrice,'12.50'); assert.equal(detail.quantity,2);
      const [row] = await q('SELECT total,deliveryAddressSnapshot FROM orders WHERE id=?',[order]);
      assert.equal(row.total,'25.00');
      assert.deepEqual(typeof row.deliveryAddressSnapshot === 'string' ? JSON.parse(row.deliveryAddressSnapshot) : row.deliveryAddressSnapshot,snapshot);
      assert.equal((await q('SELECT COUNT(*) AS n FROM order_status_history WHERE orderId=?',[order]))[0].n,1);
      assert.equal((await q('SELECT COUNT(*) AS n FROM product_categories WHERE productId=?',[p]))[0].n,1);
    });
  } finally {
    try { await c.rollback(); await assertEmpty(c,business); emptyAfter=true; } finally { await c.end(); }
  }
  artifact('data-tests.json',{ verifiedAt:new Date().toISOString(),checks,syntheticRowsPersisted:0,cleanup:emptyAfter ? 'ROLLBACK verified; all business tables empty' : 'failed' });
  console.log(`${checks.length} MySQL data checks passed; synthetic rows rolled back; all 14 tables empty.`);
}

async function verifyApplication() {
  const c = await connect('ecommerce_app');
  const q = async (sql, values) => (await c.query(sql, values))[0];
  const checks = [];
  const denied = async (name, sql, values) => {
    await assert.rejects(() => q(sql, values), error => [1142,1143,1227,1044].includes(error.errno), name);
    checks.push(name);
  };
  const b = crypto.randomUUID(), s = crypto.randomUUID(), now = '2026-11-10 12:00:00.123';
  let grants;
  try {
    grants = (await q('SHOW GRANTS')).map(r => Object.values(r)[0]);
    assert.equal(grants.filter(g => / ON \*\.\* /.test(g)).length,1);
    assert(grants.some(g => g === 'GRANT USAGE ON *.* TO `ecommerce_app`@`%`'));
    for (const grant of grants) {
      assert(!/\b(DELETE|DROP|CREATE|ALTER|INDEX|REFERENCES|ALL PRIVILEGES|GRANT OPTION|FILE|PROCESS|SUPER|EXECUTE)\b/.test(grant),grant);
      if (!grant.includes(' ON *.* ')) assert(grant.includes(' ON `secure_ecommerce`.`'),grant);
    }
    checks.push('no global, administrative, DDL, DELETE, wildcard schema or grant-option permissions');
    await c.beginTransaction();
    const hash = require('bcrypt').hashSync(crypto.randomBytes(32).toString('base64'),10);
    for (const [id,name] of [[b,'buyer'],[s,'seller']]) await q(`INSERT INTO users
      (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`,[id,name,`${id}@example.invalid`,hash,now,now,now]);
    await q('INSERT INTO buyers (userId) VALUES (?)',[b]);
    await q(`INSERT INTO sellers (userId,storeName,requestedAt,updatedAt) VALUES (?,'Synthetic app store',?,?)`,[s,now,now]);
    const p = (await q(`INSERT INTO products (sellerId,title,price,createdAt,updatedAt) VALUES (?,'Synthetic app product',0,?,?)`,[s,now,now])).insertId;
    const cat = (await q(`INSERT INTO categories (name,createdAt,updatedAt) VALUES (?,?,?)`,[crypto.randomUUID(),now,now])).insertId;
    await q('INSERT INTO product_categories (productId,categoryId,createdAt) VALUES (?,?,?)',[p,cat,now]);
    await q(`INSERT INTO user_addresses (buyerId,recipientName,street,exteriorNumber,neighborhood,city,state,postalCode,createdAt,updatedAt)
      VALUES (?,'Synthetic','Street','1','District','City','State','01000',?,?)`,[b,now,now]);
    const cart = (await q('INSERT INTO carts (buyerId,createdAt,updatedAt) VALUES (?,?,?)',[b,now,now])).insertId;
    await q('INSERT INTO cart_items (cartId,productId,quantity,createdAt,updatedAt) VALUES (?,?,1,?,?)',[cart,p,now,now]);
    const order = (await q(`INSERT INTO orders (buyerId,sellerId,checkoutId,total,deliveryAddressSnapshot,createdAt,updatedAt)
      VALUES (?,?,?,0,?, ?,?)`,[b,s,crypto.randomUUID(),JSON.stringify({street:'Synthetic street'}),now,now])).insertId;
    const detail = (await q('INSERT INTO order_items (orderId,productId,productTitle,quantity,unitPrice) VALUES (?,?,?,1,0)',[order,p,'Synthetic app product'])).insertId;
    const history = (await q(`INSERT INTO order_status_history (orderId,newStatus,changedByUserId,occurredAt) VALUES (?,'PENDING',?,?)`,[order,b,now])).insertId;
    await q(`INSERT INTO audit_logs (actorUserId,action,outcome,occurredAt) VALUES (?,'stage4.app.synthetic','SUCCESS',?)`,[b,now]);
    await q("UPDATE orders SET status='PREPARING',updatedAt=? WHERE id=?",[now,order]);
    checks.push('application can insert into all 13 permitted tables and update order status');
    for (const table of business.filter(t => t !== 'audit_logs')) await q(`SELECT * FROM \`${table}\` LIMIT 1`);
    checks.push('application can read its 13 authorized business tables');
    await denied('no public admin provisioning','INSERT INTO admins (userId) VALUES (?)',[b]);
    await denied('order total immutable','UPDATE orders SET total=1 WHERE id=?',[order]);
    await denied('order snapshot immutable','UPDATE orders SET deliveryAddressSnapshot=? WHERE id=?',[JSON.stringify({street:'Changed'}),order]);
    await denied('order buyer immutable','UPDATE orders SET buyerId=? WHERE id=?',[b,order]);
    await denied('historical title immutable','UPDATE order_items SET productTitle=? WHERE id=?',['Changed',detail]);
    await denied('historical price immutable','UPDATE order_items SET unitPrice=1 WHERE id=?',[detail]);
    await denied('order history append only',"UPDATE order_status_history SET newStatus='CANCELED' WHERE id=?",[history]);
    await denied('audit append only',"UPDATE audit_logs SET outcome='DENIED' WHERE 1=0");
    await denied('audit read not yet authorized','SELECT * FROM audit_logs LIMIT 1');
    await denied('no migration metadata access','SELECT * FROM SequelizeMeta LIMIT 1');
    await denied('no administrative account access','SELECT User FROM mysql.user LIMIT 1');
    for (const table of business) await denied(`no physical DELETE on ${table}`,`DELETE FROM \`${table}\` WHERE 1=0`);
  } finally { try { await c.rollback(); } finally { await c.end(); } }
  const migrator = await connect('ecommerce_migrator');
  try { await assertEmpty(migrator,business); } finally { await migrator.end(); }
  artifact('application-tests.json',{ verifiedAt:new Date().toISOString(),grants,checks,syntheticRowsPersisted:0,cleanup:'ROLLBACK verified; all business tables empty' });
  console.log(`${checks.length} application permission checks passed; all synthetic rows rolled back.`);
}

if (require.main === module) {
  const action = { schema: verifySchema, data: verifyData, application: verifyApplication }[process.argv[2]];
  if (!action) throw new Error('Choose schema, data or application.');
  action().catch(error => { console.error(error); process.exitCode=1; });
}
module.exports = { verifySchema, verifyData, verifyApplication };
