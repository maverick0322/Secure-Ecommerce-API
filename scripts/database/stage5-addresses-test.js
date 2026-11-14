'use strict';

// Disposable MySQL only: no command targets ecommerce_db or published port 3307.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const name = 'secure-ecommerce-stage5-addresses';
const external = process.env.STAGE5_EXTERNAL_FIXTURE === '1';
const port = external ? 3306 : 13308;
const rootPassword = external ? process.env.STAGE5_EXTERNAL_ROOT_PASSWORD : crypto.randomBytes(32).toString('hex');
const appPassword = crypto.randomBytes(32).toString('hex');
const docker = (args, input) => {
  const result = spawnSync('docker', [...(process.platform==='win32'?['--context','desktop-linux']:[]),...args], {
    encoding:'utf8',input,timeout:60000,windowsHide:true,
    env:{ ...process.env,MYSQL_ROOT_PASSWORD:rootPassword }
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker failed');
  return result.stdout.trim();
};

async function main() {
  let containerId, root, models, isolatedAuth;
  try {
    if(!external){
    containerId = docker(['run','--detach','--name',name,'--hostname',name,'--publish',`127.0.0.1:${port}:3306`,
      '--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0']);
    const details = JSON.parse(docker(['inspect','--format','{{json .}}',name]));
    assert.equal(details.Id,containerId);
    assert.equal(details.NetworkSettings.Ports['3306/tcp'][0].HostPort,String(port));
    assert(details.Mounts.every(m => m.Type !== 'volume' && m.Type !== 'bind'));
    }else{assert(rootPassword && process.env.STAGE5_EXTERNAL_UUID,'External fixture identity is required');}
    for (let attempt=0;attempt<60;attempt++) {
      try { root = await mysql.createConnection({ host:'127.0.0.1',port,user:'root',password:rootPassword }); break; }
      catch { await new Promise(resolve => setTimeout(resolve,1000)); }
    }
    assert(root,'Isolated MySQL did not become ready');
    const [[identity]] = await root.query('SELECT @@hostname AS host,@@server_uuid AS uuid,VERSION() AS version,CURRENT_USER() AS account');
    assert.equal(identity.host,name); assert.match(identity.version,/^8\.0\./);
    assert(['root@%','root@localhost'].includes(identity.account));
    const socketUuid = external ? process.env.STAGE5_EXTERNAL_UUID : docker(['exec','-i',name,'sh','-c',
      'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names'],
      'SELECT @@server_uuid;');
    assert.equal(identity.uuid,socketUuid);
    await root.query('CREATE DATABASE secure_ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await root.changeUser({database:'secure_ecommerce'});
    const schema = JSON.parse(fs.readFileSync('tests/support/final-schema.json'));
    // Verified final DDL only; no creation/cutover migration or historical seeder.
    for (const table of ['users','admins','sellers','buyers','user_addresses','categories','products',
      'product_categories','carts','cart_items','orders','order_items','order_status_history','audit_logs','SequelizeMeta']) {
      await root.query(schema.ddl[table]);
    }
    await root.query("CREATE USER 'ecommerce_app'@'%' IDENTIFIED BY ?",[appPassword]);
    const grants = schema.grants;
    for (const grant of grants) await root.query(grant);
    Object.assign(process.env,{ NODE_ENV:'test',TEST_DB_HOST:'127.0.0.1',TEST_DB_PORT:String(port),
      TEST_DB_DATABASE:'secure_ecommerce',TEST_DB_USER:'ecommerce_app',TEST_DB_PASSWORD:appPassword,
      JWT_SECRET:crypto.randomBytes(40).toString('hex') });
    models = require('../../models');
    const [[appIdentity]] = await models.sequelize.query('SELECT DATABASE() AS db,CURRENT_USER() AS account,@@server_uuid AS uuid');
    assert.deepEqual(appIdentity,{db:'secure_ecommerce',account:'ecommerce_app@%',uuid:identity.uuid});
    await require('../../services/database.service').verifyConnection(models.sequelize,{uuid:identity.uuid});
    assert.equal(Object.keys(models.sequelize.models).length,14);
    const buyers = [crypto.randomUUID(),crypto.randomUUID()];
    for (const id of buyers) {
      await root.query(`INSERT INTO users (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt)
        VALUES (?,'Synthetic buyer',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [id,`${id}@example.invalid`,await require('bcrypt').hash(crypto.randomBytes(32).toString('hex'),10)]);
      await root.query('INSERT INTO buyers (userId) VALUES (?)',[id]);
    }
    const request = require('supertest');
    const app = require('../../index');
    isolatedAuth = await require('../../tests/support/isolated-auth').start();
    const token = account => isolatedAuth.issue(account);
    const headers = await Promise.all(buyers.map(async id => `Bearer ${await token({id})}`));
    const body = { recipientName:'Synthetic',street:'Street',exteriorNumber:'1',neighborhood:'District',city:'City',state:'State',postalCode:'01000',isDefault:true };
    const created = await Promise.all([1,2].map(() => request(app).post('/api/addresses').set('Authorization',headers[0]).send(body)));
    assert(created.every(r => r.status === 201),JSON.stringify(created.map(r => ({status:r.status,body:r.body}))));
    const [[defaults]] = await root.query('SELECT COUNT(*) AS n FROM user_addresses WHERE buyerId=? AND isDefault=1 AND deletedAt IS NULL',[buyers[0]]);
    assert.equal(defaults.n,1);
    const id = String(created[0].body.id);
    assert.equal((await request(app).put(`/api/addresses/${id}`).set('Authorization',headers[1]).send({city:'Foreign'})).status,404);
    assert.equal((await request(app).delete(`/api/addresses/${id}`).set('Authorization',headers[1])).status,404);
    assert.equal((await request(app).put(`/api/addresses/${id}/default`).set('Authorization',headers[0])).status,204);
    assert.equal((await request(app).delete(`/api/addresses/${id}`).set('Authorization',headers[0])).status,204);
    const listed = await request(app).get('/api/addresses').set('Authorization',headers[0]);
    assert.equal(listed.status,200); assert.equal(listed.body.length,1);
    const [[deleted]] = await root.query('SELECT deletedAt FROM user_addresses WHERE id=?',[id]); assert(deleted.deletedAt);
    const seller = crypto.randomUUID();
    await root.query(`INSERT INTO users (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt)
      VALUES (?,'Synthetic seller',?,'synthetic-not-a-login-hash',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[seller,`${seller}@example.invalid`]);
    await root.query("INSERT INTO sellers (userId,storeName,status,requestedAt,updatedAt) VALUES (?,'Synthetic','APPROVED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[seller]);
    const [product] = await root.query("INSERT INTO products (sellerId,title,price,stock,createdAt,updatedAt) VALUES (?,'Synthetic product',12.50,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[seller]);
    const post = () => request(app).post('/api/cart/items').set('Authorization',headers[0]).send({productId:product.insertId,quantity:2});
    const added = await Promise.all([post(),post()]);
    assert(added.every(r => r.status === 200),JSON.stringify(added.map(r => r.body)));
    let cart = await request(app).get('/api/cart').set('Authorization',headers[0]);
    assert.equal(cart.body.items.length,1); assert.equal(cart.body.items[0].quantity,4); assert.equal(cart.body.subtotal,'50.00');
    const own = await request(app).get('/api/cart').set('Authorization',headers[1]);
    assert.deepEqual(own.body.items,[]); assert.notEqual(own.body.id,cart.body.id);
    assert.equal((await request(app).put(`/api/cart/items/${product.insertId}`).set('Authorization',headers[1]).send({quantity:1})).status,404);
    assert.equal((await request(app).put(`/api/cart/items/${product.insertId}`).set('Authorization',headers[0]).send({quantity:11})).status,409);
    assert.equal((await request(app).delete(`/api/cart/items/${product.insertId}`).set('Authorization',headers[0])).status,204);
    assert.equal((await post()).status,200);
    const [[count]] = await root.query('SELECT COUNT(*) AS n FROM cart_items WHERE productId=?',[product.insertId]); assert.equal(count.n,1);
    await root.query('UPDATE products SET price=13.00 WHERE id=?',[product.insertId]);
    cart = await request(app).get('/api/cart').set('Authorization',headers[0]); assert.equal(cart.body.subtotal,'26.00');
    await root.query("UPDATE sellers SET status='SUSPENDED' WHERE userId=?",[seller]);
    assert.equal((await post()).status,409);
    const [[events]]=await root.query('SELECT COUNT(*) AS n FROM audit_logs WHERE actorUserId=?',[buyers[0]]); assert(events.n>=8);
    const [[event]]=await root.query("SELECT actorUserId,action,outcome,ipAddress,details FROM audit_logs WHERE action='cart.add' LIMIT 1");
    assert.equal(event.actorUserId,buyers[0]); assert.equal(event.outcome,'SUCCESS'); assert(event.ipAddress);
    assert(!JSON.stringify(event.details).includes('password'));
    await assert.rejects(models.AuditLog.update({outcome:'ERROR'},{where:{id:1}}),/append-only/);
    await assert.rejects(models.sequelize.query("UPDATE audit_logs SET outcome='ERROR' WHERE id=1"));
    await assert.rejects(models.sequelize.query('DELETE FROM audit_logs WHERE id=1'));
    await assert.rejects(require('../../services/audit.service').list(),error=>error.status===503);
    await root.query("UPDATE sellers SET status='APPROVED' WHERE userId=?",[seller]);
    const addressId=String(listed.body[0].id);
    const quoteRequest=()=>request(app).post('/api/checkout/quote').set('Authorization',headers[0]).send({addressId});
    const quoted=await quoteRequest(); assert.equal(quoted.status,200,JSON.stringify(quoted.body));
    await root.query('UPDATE products SET price=14.00 WHERE id=?',[product.insertId]);
    const confirmRequest=quote=>request(app).post('/api/checkout').set('Authorization',headers[0]).send({quote});
    assert.equal((await confirmRequest(quoted.body.quote)).status,409);
    const fresh=await quoteRequest(); assert.equal(fresh.status,200);
    const confirmations=await Promise.all([confirmRequest(fresh.body.quote),confirmRequest(fresh.body.quote)]);
    assert.deepEqual(confirmations.map(r=>r.status).sort(),[200,201],JSON.stringify(confirmations.map(r=>r.body)));
    const order=confirmations[0].body.orders[0]; assert.equal(order.total,'28.00');
    const [[inventory]]=await root.query('SELECT stock FROM products WHERE id=?',[product.insertId]); assert.equal(inventory.stock,8);
    const [[orderCount]]=await root.query('SELECT COUNT(*) AS n FROM orders'); assert.equal(orderCount.n,1);
    const empty=await request(app).get('/api/cart').set('Authorization',headers[0]); assert.equal(empty.body.items.length,0);
    const foreign=await request(app).get(`/api/orders/${order.id}`).set('Authorization',headers[1]); assert.equal(foreign.status,404);
    await root.query("UPDATE products SET title='Changed title',price=15.00 WHERE id=?",[product.insertId]);
    await root.query("UPDATE user_addresses SET street='Changed street' WHERE id=?",[addressId]);
    const detail=await request(app).get(`/api/orders/${order.id}`).set('Authorization',headers[0]);
    assert.equal(detail.status,200);assert.equal(detail.body.items[0].productTitle,'Synthetic product');assert.equal(detail.body.items[0].unitPrice,'14.00');assert.equal(detail.body.deliveryAddressSnapshot.street,'Street');
    assert.equal((await confirmRequest(fresh.body.quote)).status,200);
    assert.equal((await request(app).post('/api/checkout').set('Authorization',headers[1]).send({quote:fresh.body.quote})).status,400);
    assert.equal((await request(app).put(`/api/orders/${order.id}/status`).set('Authorization',headers[0]).send({status:'CANCELED'})).status,400);
    assert.equal((await request(app).put(`/api/orders/${order.id}/status`).set('Authorization',headers[0]).send({status:'CANCELED',reason:'Synthetic cancellation'})).status,200);
    const history=await request(app).get(`/api/orders/${order.id}`).set('Authorization',headers[0]); assert.equal(history.body.history.length,2);
    await assert.rejects(models.sequelize.query('UPDATE order_items SET unitPrice=0 WHERE orderId=?',{replacements:[order.id]}));
    // Two buyers compete for the final unit; quotations do not reserve stock.
    await root.query('UPDATE products SET stock=1 WHERE id=?',[product.insertId]);
    const otherAddress=await request(app).post('/api/addresses').set('Authorization',headers[1]).send(body);
    assert.equal(otherAddress.status,201);
    for(const header of headers){
      const result=await request(app).post('/api/cart/items').set('Authorization',header).send({productId:product.insertId,quantity:1});assert.equal(result.status,200);
    }
    const otherQuote=await request(app).post('/api/checkout/quote').set('Authorization',headers[1]).send({addressId:String(otherAddress.body.id)});
    const lastQuote=await quoteRequest();assert.equal(otherQuote.status,200);assert.equal(lastQuote.status,200);
    const competed=await Promise.all([confirmRequest(lastQuote.body.quote),request(app).post('/api/checkout').set('Authorization',headers[1]).send({quote:otherQuote.body.quote})]);
    assert.deepEqual(competed.map(r=>r.status).sort(),[201,409],JSON.stringify(competed.map(r=>r.body)));
    const [[lastStock]]=await root.query('SELECT stock FROM products WHERE id=?',[product.insertId]);assert.equal(lastStock.stock,0);
    // Fail after the stock/detail write and prove the transaction leaves no partial order.
    await root.query('UPDATE products SET stock=5 WHERE id=?',[product.insertId]);
    await request(app).delete(`/api/cart/items/${product.insertId}`).set('Authorization',headers[0]);
    assert.equal((await post()).status,200);
    const failureQuote=await quoteRequest();assert.equal(failureQuote.status,200);
    const [[beforeFailure]]=await root.query('SELECT COUNT(*) AS n FROM orders');
    const audit=require('../../services/audit.service');const originalWrite=audit.write;
    audit.write=async()=>{throw new Error('Synthetic mid-checkout failure');};
    try{assert.equal((await confirmRequest(failureQuote.body.quote)).status,500);}finally{audit.write=originalWrite;}
    const [[afterFailure]]=await root.query('SELECT COUNT(*) AS n FROM orders');assert.equal(afterFailure.n,beforeFailure.n);
    const [[stockAfterFailure]]=await root.query('SELECT stock FROM products WHERE id=?',[product.insertId]);assert.equal(stockAfterFailure.stock,5);
    assert.equal((await confirmRequest(failureQuote.body.quote)).status,201);
    // Exercise existing account and catalog HTTP paths on the same final schema.
    const admin=crypto.randomUUID();const adminPassword=crypto.randomBytes(24).toString('base64');
    await root.query(`INSERT INTO users (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt)
      VALUES (?,'Synthetic admin',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[admin,`${admin}@example.invalid`,await require('bcrypt').hash(adminPassword,10)]);
    await root.query('INSERT INTO admins (userId) VALUES (?)',[admin]);
    const adminLogin=await request(app).post('/api/auth').send({email:`${admin}@example.invalid`,password:adminPassword});assert.equal(adminLogin.status,200);
    const adminHeader=`Bearer ${adminLogin.body.jwt}`;
    const mail=require('../../services/registration-email.service');const originalMail=mail.sendVerificationCode;let code;
    mail.sendVerificationCode=async(email,value)=>{code=value;};
    const email=`${crypto.randomUUID()}@example.invalid`;const accountPassword=crypto.randomBytes(24).toString('base64');
    try{
      assert.equal((await request(app).post('/api/auth/register').send({email})).status,202);
      const registered=await request(app).post('/api/auth/register/verify').send({email,code,name:'Synthetic merchant',password:accountPassword,profile:'SELLER',storeName:'Synthetic shop'});
      assert.equal(registered.status,201,JSON.stringify(registered.body));assert(!registered.body.passwordHash);
      const logged=await request(app).post('/api/auth').send({email,password:accountPassword});assert.equal(logged.status,200);
      const sellerHeader=`Bearer ${logged.body.jwt}`;
      assert.equal((await request(app).post('/api/products').set('Authorization',sellerHeader).send({title:'Not approved',price:'1.00'})).status,403);
      const reviews=await Promise.all([1,2].map(()=>request(app).put(`/api/users/sellers/${registered.body.id}/review`).set('Authorization',adminHeader).send({status:'APPROVED'})));
      assert.deepEqual(reviews.map(r=>r.status).sort(),[200,409]);
      const category=await request(app).post('/api/categories').set('Authorization',adminHeader).send({name:'Synthetic HTTP category'});assert.equal(category.status,201);
      const createdProduct=await request(app).post('/api/products').set('Authorization',sellerHeader).send({title:'HTTP product',price:'123.45',stock:5});assert.equal(createdProduct.status,201,JSON.stringify(createdProduct.body));
      const productId=createdProduct.body.productId;
      assert.equal((await request(app).post(`/api/products/${productId}/categories`).set('Authorization',sellerHeader).send({categoryId:category.body.categoryId})).status,204);
      assert.equal((await request(app).get('/api/products').set('Authorization',headers[0])).status,200);
      assert.equal((await request(app).put(`/api/products/${productId}`).set('Authorization',sellerHeader).send({price:'124.00',stock:4})).status,204);
      // One transaction spans multiple sellers; a failure on seller two rolls back seller one.
      for(const selected of [product.insertId,productId]){
        const result=await request(app).post('/api/cart/items').set('Authorization',headers[0]).send({productId:selected,quantity:1});assert.equal(result.status,200);
      }
      const multiple=await quoteRequest();assert.equal(multiple.status,200);assert.equal(multiple.body.orders.length,2);
      const [[beforeMultiple]]=await root.query('SELECT COUNT(*) AS n FROM orders');
      let writes=0;const beforeMultiAudit=audit.write;
      audit.write=async(...args)=>{if(++writes===2)throw new Error('Synthetic second-seller failure');return beforeMultiAudit(...args);};
      try{assert.equal((await confirmRequest(multiple.body.quote)).status,500);}finally{audit.write=beforeMultiAudit;}
      const [[afterMultiple]]=await root.query('SELECT COUNT(*) AS n FROM orders');assert.equal(afterMultiple.n,beforeMultiple.n);
      const confirmedMultiple=await confirmRequest(multiple.body.quote);assert.equal(confirmedMultiple.status,201);assert.equal(confirmedMultiple.body.orders.length,2);
      const ownOrders=await request(app).get('/api/orders').set('Authorization',sellerHeader);assert.equal(ownOrders.status,200);assert.equal(ownOrders.body.length,1);
      const merchantOrder=ownOrders.body[0];
      const change=(header,status)=>request(app).put(`/api/orders/${merchantOrder.id}/status`).set('Authorization',header).send({status});
      assert.equal((await change(sellerHeader,'DELIVERED')).status,409);
      assert.equal((await change(sellerHeader,'PREPARING')).status,200);
      assert.equal((await change(headers[0],'SHIPPED')).status,403);
      assert.equal((await change(sellerHeader,'SHIPPED')).status,200);
      assert.equal((await change(sellerHeader,'DELIVERED')).status,200);
      assert.equal((await change(sellerHeader,'CANCELED')).status,400);
      assert.equal((await request(app).delete(`/api/products/${productId}`).set('Authorization',sellerHeader)).status,204);
      await root.query("UPDATE users SET status='SUSPENDED' WHERE id=?",[registered.body.id]);
      assert.equal((await request(app).get('/api/products').set('Authorization',sellerHeader)).status,403);
    }finally{mail.sendVerificationCode=originalMail;}
    await require('../../tests/support/security-checks')({root,models,app,admin,adminHeader,
      buyerId:buyers[0],buyerHeader:headers[0],isolatedAuth});
    // Re-run the pre-existing account/catalog scenarios against independent final-schema fixtures.
    const adminFixture='00000000-0000-4000-8000-000000000003';
    const fixtureHash=await require('bcrypt').hash('synthetic-stage3a-password',10);
    for(const database of ['secure_ecommerce_3a_test','secure_ecommerce_3b_final_test','secure_ecommerce_3b_repeat_test']){
      await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await root.changeUser({database});
      for(const table of ['users','admins','sellers','buyers','user_addresses','categories','products','product_categories','carts','cart_items','orders','order_items','order_status_history','audit_logs','SequelizeMeta']) await root.query(schema.ddl[table]);
      for(const grant of grants) await root.query(grant.replace(/`secure_ecommerce`/g,`\`${database}\``));
      await root.query(`GRANT SELECT (id,actorUserId,action,targetType,targetId,ipAddress,outcome,occurredAt) ON \`${database}\`.audit_logs TO 'ecommerce_app'@'%'`);
      await root.query(`INSERT INTO users (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt) VALUES (?,'Synthetic fixture admin','admin@example.invalid',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,[adminFixture,fixtureHash]);
      await root.query('INSERT INTO admins (userId) VALUES (?)',[adminFixture]);
      await root.query("INSERT INTO categories (id,name,protected,createdAt,updatedAt) VALUES (1,'Synthetic protected category',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))");
    }
    assert(!(process.env.STAGE5_CATALOG_ONLY==='1'&&process.env.STAGE5_ACCOUNTS_ONLY==='1'),'Select only one focused suite');
    const testPaths=process.env.STAGE5_ACCOUNTS_ONLY==='1'?['tests/database/accounts.mysql.test.js']:
      process.env.STAGE5_CATALOG_ONLY==='1'?['tests/database/catalog.mysql.test.js']:
      ['tests/database/accounts.mysql.test.js','tests/database/catalog.mysql.test.js','tests/database/account-session-security.mysql.test.js'];
    const reporterArgs=process.env.STAGE3A_TIMINGS==='1'?['--reporters=default','--reporters=./tests/support/setup-timing-reporter.cjs']:[];
    const child=spawnSync(process.execPath,['node_modules/jest/bin/jest.js','--runInBand',...reporterArgs,'--runTestsByPath',...testPaths],{
      encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024,windowsHide:true,
      env:{...process.env,NODE_ENV:'test',STAGE3A_MYSQL_UUID:identity.uuid,STAGE3A_TEST_PASSWORD:appPassword,
        STAGE3A_TEST_HOSTNAME:name,STAGE3A_TEST_PORT:String(port),STAGE3B_MYSQL_UUID:identity.uuid,
        STAGE3B_TEST_PASSWORD:appPassword,STAGE3B_TEST_HOSTNAME:name,STAGE3B_TEST_PORT:String(port)}
    });
    process.stdout.write((child.stdout||'')+(child.stderr||''));assert.equal(child.status,0,'Final-schema account/catalog regressions failed');
    console.log('PASS: isolated MySQL final DDL, application SQL grants, HTTP authentication, concurrent defaults and cart writes, ownership, live prices and soft-delete reactivation.');
  } finally {
    if (isolatedAuth) await isolatedAuth.close();
    if (models) await models.sequelize.close();
    if (root) await root.end();
    if (containerId) {
      const current = docker(['inspect','--format','{{.Id}}',name]); assert.equal(current,containerId);
      docker(['stop',name]); docker(['rm',name]);
    }
  }
}
if(require.main===module) main().catch(error => { console.error(error.message); process.exitCode=1; });
module.exports={main};
