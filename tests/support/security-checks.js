'use strict';
// Called only after the parent runner verifies its disposable server UUID.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const request=require('supertest');
const accounts=require('../../services/accounts.service');
const audit=require('../../services/audit.service');

module.exports=async function securityChecks({root,models,app,admin,adminHeader,buyerId,buyerHeader,isolatedAuth}) {
  const auth=req=>req.set('Authorization',adminHeader);
  const buyer=req=>req.set('Authorization',buyerHeader);
  const secret=crypto.randomBytes(32).toString('hex');
  const seller=await accounts.createPublicAccount({email:`${crypto.randomUUID()}@example.invalid`,
    name:'Synthetic security seller',password:secret,profile:'SELLER',storeName:'Isolated shop'});
  await accounts.reviewSeller(admin,seller.id,'APPROVED',null,'127.0.0.1');
  let token=await isolatedAuth.issue(seller);
  const merchant=req=>req.set('Authorization',`Bearer ${token}`);
  const productResponse=await merchant(request(app).post('/api/products')).send({title:'Security fixture',price:'8.25',stock:20});
  assert.equal(productResponse.status,201);const productId=productResponse.body.productId;
  const categoryResponse=await auth(request(app).post('/api/categories')).send({name:`Security ${crypto.randomUUID()}`});
  assert.equal(categoryResponse.status,201);const categoryId=categoryResponse.body.categoryId;
  const body={recipientName:'Synthetic recipient',street:'Test street',exteriorNumber:'1',neighborhood:'Test',city:'Test',state:'Test',postalCode:'01000'};
  const logger=require('../../services/structured-logger.service'),originalLog=logger.log,requestLogs=[];
  logger.log=(event,data)=>{if(event==='http.request')requestLogs.push(data);return originalLog(event,data);};
  let address;
  try {
    address=await buyer(request(app).post('/api/addresses')).send(body);assert.equal(address.status,201);
    const created=requestLogs.find(record=>record.method==='POST'&&record.route==='/api/addresses/');
    assert(created&&created.userId===buyerId);
    const [[persisted]]=await root.query("SELECT actorUserId,details FROM audit_logs WHERE action='address.create' AND targetId=?",[address.body.id]);
    const metadata=typeof persisted.details==='string'?JSON.parse(persisted.details):persisted.details;
    assert.equal(persisted.actorUserId,buyerId);assert.equal(metadata.requestId,created.requestId);
    requestLogs.length=0;
    assert.equal((await buyer(request(app).get('/api/addresses'))).status,200);
    assert.equal(requestLogs.length,1);
    const [[reads]]=await root.query("SELECT COUNT(*) n FROM audit_logs WHERE JSON_UNQUOTE(JSON_EXTRACT(details,'$.requestId'))=?",[requestLogs[0].requestId]);
    assert.equal(reads.n,0,'Read-only address listing must not create SQL audit events');
  } finally {logger.log=originalLog;}
  const addressId=address.body.id;

  async function fault(action,work){
    const original=audit.write;
    audit.write=(event,...args)=>event.action===action ? Promise.reject(new Error('Synthetic audit failure')) : original(event,...args);
    try {return await work();}finally{audit.write=original;}
  }
  async function rollback(action,work,sql,values=[]){
    const [before]=await root.query(sql,values);
    const response=await fault(action,work);assert.equal(response.status,500,`Expected atomic failure: ${action}`);
    const [after]=await root.query(sql,values);assert.deepEqual(after,before,`Business write escaped rollback: ${action}`);
    assert(!response.text.includes('Synthetic audit failure'));
  }
  await rollback('address.create',()=>buyer(request(app).post('/api/addresses')).send({...body,isDefault:true}),
    'SELECT id,isDefault FROM user_addresses WHERE buyerId=? ORDER BY id',[buyerId]);
  await rollback('address.update',()=>buyer(request(app).put(`/api/addresses/${addressId}`)).send({city:'Changed'}),
    'SELECT city FROM user_addresses WHERE id=?',[addressId]);
  await rollback('address.default',()=>buyer(request(app).put(`/api/addresses/${addressId}/default`)),
    'SELECT id,isDefault FROM user_addresses WHERE buyerId=? ORDER BY id',[buyerId]);
  await rollback('address.remove',()=>buyer(request(app).delete(`/api/addresses/${addressId}`)),
    'SELECT deletedAt FROM user_addresses WHERE id=?',[addressId]);
  await rollback('cart.add',()=>buyer(request(app).post('/api/cart/items')).send({productId,quantity:1}),
    'SELECT id,quantity FROM cart_items WHERE productId=?',[productId]);
  assert.equal((await buyer(request(app).post('/api/cart/items')).send({productId,quantity:2})).status,200);
  await rollback('cart.update',()=>buyer(request(app).put(`/api/cart/items/${productId}`)).send({quantity:3}),
    'SELECT quantity FROM cart_items WHERE productId=?',[productId]);
  await rollback('cart.remove',()=>buyer(request(app).delete(`/api/cart/items/${productId}`)),
    'SELECT deletedAt FROM cart_items WHERE productId=?',[productId]);
  await rollback('producto.crear',()=>merchant(request(app).post('/api/products')).send({title:'Must rollback',price:'2.00'}),
    'SELECT id FROM products WHERE sellerId=? ORDER BY id',[seller.id]);
  await rollback('producto.editar',()=>merchant(request(app).put(`/api/products/${productId}`)).send({price:'9.00'}),
    'SELECT price FROM products WHERE id=?',[productId]);
  await rollback('producto.eliminar',()=>merchant(request(app).delete(`/api/products/${productId}`)),
    'SELECT deletedAt FROM products WHERE id=?',[productId]);
  await rollback('productocategoria.agregar',()=>merchant(request(app).post(`/api/products/${productId}/categories`)).send({categoryId}),
    'SELECT productId,categoryId,deletedAt FROM product_categories WHERE productId=?',[productId]);
  assert.equal((await merchant(request(app).post(`/api/products/${productId}/categories`)).send({categoryId})).status,204);
  await rollback('productocategoria.remover',()=>merchant(request(app).delete(`/api/products/${productId}/categories/${categoryId}`)),
    'SELECT deletedAt FROM product_categories WHERE productId=? AND categoryId=?',[productId,categoryId]);
  await rollback('categoria.crear',()=>auth(request(app).post('/api/categories')).send({name:'Must rollback category'}),
    'SELECT id FROM categories ORDER BY id');
  await rollback('categoria.editar',()=>auth(request(app).put(`/api/categories/${categoryId}`)).send({name:'Changed category'}),
    'SELECT name FROM categories WHERE id=?',[categoryId]);
  await rollback('categoria.eliminar',()=>auth(request(app).delete(`/api/categories/${categoryId}`)),
    'SELECT deletedAt FROM categories WHERE id=?',[categoryId]);
  await rollback('usuarios.editar',()=>auth(request(app).put(`/api/users/${seller.email}`)).send({name:'Changed account'}),
    'SELECT name FROM users WHERE id=?',[seller.id]);
  await rollback('usuarios.eliminar',()=>auth(request(app).delete(`/api/users/${seller.email}`)),
    'SELECT deletedAt FROM users WHERE id=?',[seller.id]);
  assert.equal((await merchant(request(app).get('/api/auth/time'))).status,401,'Deletion rollback must not resurrect sessions');
  token=await isolatedAuth.issue(seller);

  // A provider upload can succeed while the atomic SQL/audit commit fails.
  const cloud=require('../../services/cloudinary.service');
  const fs=require('node:fs/promises');const filesPath=require('node:path');const os=require('node:os');
  const directory=await fs.mkdtemp(filesPath.join(os.tmpdir(),'security-images-'));
  const oldDirectory=process.env.CLOUDINARY_CLEANUP_DIR;
  const originalCloud={credentials:cloud.credentials,upload:cloud.upload,inspect:cloud.inspect,destroy:cloud.destroy};
  const remote=new Map();process.env.CLOUDINARY_CLEANUP_DIR=directory;
  cloud.credentials=()=>({});
  cloud.upload=async(buffer,publicId,id)=>{
    remote.set(publicId,{context:{custom:{catalog_owner:'secure-ecommerce-api',product_id:String(id)}}});
    return {public_id:publicId,format:'png'};
  };
  cloud.inspect=async id=>remote.get(id)||null;cloud.destroy=async id=>{remote.delete(id);};
  try{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
    const upload=()=>merchant(request(app).put(`/api/products/${productId}/image`)).attach('image',png,'synthetic.png');
    await rollback('producto.imagen',upload,'SELECT imagePublicId FROM products WHERE id=?',[productId]);
    assert.equal(remote.size,0);assert.equal((await fs.readdir(directory)).length,0);
    assert.equal((await upload()).status,200);assert.equal(remote.size,1);
    await rollback('producto.imagen.retirar',()=>merchant(request(app).delete(`/api/products/${productId}/image`)),
      'SELECT imagePublicId FROM products WHERE id=?',[productId]);
    assert.equal(remote.size,1);
    assert.equal((await merchant(request(app).delete(`/api/products/${productId}/image`))).status,204);
    assert.equal(remote.size,0);
  }finally{
    Object.assign(cloud,originalCloud);
    if(oldDirectory===undefined)delete process.env.CLOUDINARY_CLEANUP_DIR;else process.env.CLOUDINARY_CLEANUP_DIR=oldDirectory;
    for(const file of await fs.readdir(directory))await fs.unlink(path.join(directory,file));await fs.rmdir(directory);
  }

  // SQL password/audit remains atomic; Redis revocation is never rolled back.
  // Compare hashes as booleans, never print them.
  const [[beforeHash]]=await root.query('SELECT passwordHash FROM users WHERE id=?',[seller.id]);
  await fault('usuarios.editar',async()=>{
    assert.equal((await auth(request(app).put(`/api/users/${seller.email}`)).send({password:crypto.randomBytes(24).toString('base64')})).status,500);
  });
  const [[afterHash]]=await root.query('SELECT passwordHash FROM users WHERE id=?',[seller.id]);
  assert.equal(beforeHash.passwordHash===afterHash.passwordHash,true);
  assert.equal((await merchant(request(app).get('/api/auth/time'))).status,401,'SQL rollback must not restore revoked sessions');
  assert.equal((await auth(request(app).put(`/api/users/${seller.email}`)).send({password:'Password123456!'})).status,400);
  const changed=crypto.randomBytes(24).toString('base64');
  assert.equal((await auth(request(app).put(`/api/users/${seller.email}`)).send({password:changed})).status,204);
  const [[stored]]=await root.query('SELECT passwordHash FROM users WHERE id=?',[seller.id]);
  assert.equal(require('bcrypt').getRounds(stored.passwordHash),12);
  assert.equal(await require('bcrypt').compare(changed,stored.passwordHash),true);
  const loginResponse=await request(app).post('/api/auth').send({email:seller.email,password:changed});
  assert.equal(loginResponse.status,200,'New credentials must allow a fresh session');
  token=loginResponse.body.jwt;
  const refreshed=await request(app).post('/api/auth/refresh').send({refreshToken:loginResponse.body.refreshToken});
  assert.equal(refreshed.status,200,'Real Redis refresh must rotate');
  const replay=await request(app).post('/api/auth/refresh').send({refreshToken:loginResponse.body.refreshToken});
  assert.equal(replay.status,401,'Consumed refresh must revoke the session');
  assert.equal((await merchant(request(app).get('/api/auth/time'))).status,401,'Reuse revokes access immediately');
  const signedIn=await request(app).post('/api/auth').send({email:seller.email,password:changed});
  assert.equal(signedIn.status,200);
  const closed=await request(app).post('/api/auth/logout').set('Authorization',`Bearer ${signedIn.body.jwt}`);
  assert.equal(closed.status,204,'Real Redis logout must succeed');
  assert.equal((await request(app).get('/api/auth/time').set('Authorization',`Bearer ${signedIn.body.jwt}`)).status,401);
  const replacement=await request(app).post('/api/auth').send({email:seller.email,password:changed});
  assert.equal(replacement.status,200);token=replacement.body.jwt;
  const simultaneous=await Promise.all([1,2].map(()=>request(app).post('/api/auth/refresh').send({refreshToken:replacement.body.refreshToken})));
  assert(simultaneous.every(r=>[200,401].includes(r.status)),'Concurrent refresh must fail closed');
  assert(simultaneous.filter(r=>r.status===200).length<=1,'No two refresh successors may be returned');
  assert.equal((await merchant(request(app).get('/api/auth/time'))).status,401,'Concurrent reuse must revoke the family');
  const finalLogin=await request(app).post('/api/auth').send({email:seller.email,password:changed});
  assert.equal(finalLogin.status,200);token=finalLogin.body.jwt;

  const mail=require('../../services/registration-email.service');const originalMail=mail.sendVerificationCode;let code;
  mail.sendVerificationCode=async(email,value)=>{code=value;};
  try{
    const email=`${crypto.randomUUID()}@example.invalid`;
    assert.equal((await request(app).post('/api/auth/register').send({email})).status,202);
    const verify=()=>request(app).post('/api/auth/register/verify').send({email,code,name:'Atomic registration',password:secret,profile:'BUYER'});
    assert.equal((await request(app).post('/api/auth/register/verify').send({email,code,name:'Weak candidate',password:'Password123456!',profile:'BUYER'})).status,400);
    assert.equal((await fault('usuarios.crear',verify)).status,500);
    const [[n]]=await root.query('SELECT COUNT(*) AS n FROM users WHERE email=?',[email]);assert.equal(n.n,0);
    assert.equal((await verify()).status,201);
  }finally{mail.sendVerificationCode=originalMail;}
  await fault('usuario.login',async()=>{
    const response=await request(app).post('/api/auth').send({email:seller.email,password:changed});
    assert.equal(response.status,500);assert(!response.body.jwt);
  });

  // Snapshot and inventory remain untouched when suspension invalidates a quote.
  const quote=await buyer(request(app).post('/api/checkout/quote')).send({addressId});assert.equal(quote.status,200);
  const path=`/api/users/sellers/${seller.id}/suspend`;
  assert.equal((await buyer(request(app).put(path)).send({reason:'Unauthorized'})).status,403);
  assert.equal((await auth(request(app).put(path)).send({reason:''})).status,400);
  await rollback('seller.suspended',()=>auth(request(app).put(path)).send({reason:'Policy violation'}),
    'SELECT status,reviewedAt,reviewedByUserId FROM sellers WHERE userId=?',[seller.id]);
  const [historical]=await root.query('SELECT id,total,deliveryAddressSnapshot FROM orders ORDER BY id');
  const [details]=await root.query('SELECT id,productTitle,unitPrice,quantity FROM order_items ORDER BY id');
  const outcomes=await Promise.all([1,2].map(()=>auth(request(app).put(path)).send({reason:'Incumplimiento de las condiciones de venta'})));
  assert.deepEqual(outcomes.map(r=>r.status).sort((a,b)=>a-b),[200,409]);
  const [[state]]=await root.query('SELECT status,reviewedByUserId FROM sellers WHERE userId=?',[seller.id]);
  assert.equal(state.status,'SUSPENDED');assert.equal(state.reviewedByUserId,admin);
  const [[event]]=await root.query("SELECT COUNT(*) n FROM audit_logs WHERE action='seller.suspended' AND targetId=?",[seller.id]);assert.equal(event.n,1);
  const [[reason]]=await root.query("SELECT details FROM audit_logs WHERE action='seller.suspended' AND targetId=?",[seller.id]);
  assert.equal(reason.details.reason,'Incumplimiento de las condiciones de venta');
  assert.equal((await merchant(request(app).put(`/api/products/${productId}`)).send({price:'1.00'})).status,403);
  assert.equal((await merchant(request(app).get('/api/orders'))).status,403);
  assert.equal((await buyer(request(app).get(`/api/products/${productId}`))).status,404);
  const visible=await buyer(request(app).get('/api/products'));assert(!visible.body.some(p=>p.productId===productId));
  assert.equal((await buyer(request(app).post('/api/cart/items')).send({productId,quantity:1})).status,409);
  assert.equal((await buyer(request(app).post('/api/checkout')).send({quote:quote.body.quote})).status,409);
  const [historyAfter]=await root.query('SELECT id,total,deliveryAddressSnapshot FROM orders ORDER BY id');
  const [detailsAfter]=await root.query('SELECT id,productTitle,unitPrice,quantity FROM order_items ORDER BY id');
  assert.deepEqual(historyAfter,historical);assert.deepEqual(detailsAfter,details);
  assert.equal((await models.Seller.findByPk(seller.id)).status,'SUSPENDED');
  console.log('PASS: isolated security corrections, atomic business/audit rollback, password changes and concurrent seller suspension.');
};
