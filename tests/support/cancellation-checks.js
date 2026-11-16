'use strict';
// Invoked only by the existing tmpfs runner, after its socket/TCP identity checks.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),request=require('supertest');
module.exports=async function cancellationChecks({root,models,app,isolatedAuth,expectedUuid}){
  const [[identity]]=await root.query('SELECT @@server_uuid AS uuid,DATABASE() AS db,@@hostname AS host');
  assert.equal(identity.uuid,expectedUuid);assert.equal(identity.host,'secure-ecommerce-stage5-addresses');assert.equal(identity.db,'secure_ecommerce');
  await require('../../services/database.service').verifyConnection(models.sequelize,{uuid:expectedUuid});
  const hashes=await require('bcrypt').hash(crypto.randomBytes(24).toString('hex'),4);
  async function account(profile){
    const id=crypto.randomUUID();
    await root.query("INSERT INTO users (id,name,email,passwordHash,emailVerifiedAt,createdAt,updatedAt) VALUES (?,'Cancellation fixture',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,id+'@example.invalid',hashes]);
    if(profile==='SELLER')await root.query("INSERT INTO sellers (userId,storeName,status,requestedAt,updatedAt) VALUES (?,'Cancellation shop','APPROVED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id]);
    else await root.query('INSERT INTO '+(profile==='ADMIN'?'admins':'buyers')+' (userId) VALUES (?)',[id]);
    return {id,header:'Bearer '+await isolatedAuth.issue({id})};
  }
  const buyer=await account('BUYER'),other=await account('BUYER'),seller=await account('SELLER'),secondSeller=await account('SELLER'),admin=await account('ADMIN');
  const groups=[];const snapshot={recipientName:'Synthetic owner',street:'Original street',exteriorNumber:'1',interiorNumber:null,neighborhood:'Test',city:'City',state:'State',postalCode:'01000',country:'MX'};
  const change=(id,actor,status='CANCELED',reason='Synthetic cancellation')=>request(app).put('/api/orders/'+id+'/status').set('Authorization',actor.header).send({status,...(reason===undefined?{}:{reason})});
  async function fixture({status='PENDING',quantities=[2,3],stocks=[7,11]}={}){
    const products=[];
    for(let i=0;i<quantities.length;i++)products.push(await models.Product.create({sellerId:seller.id,title:'Original product '+i,price:'2.50',stock:stocks[i]}));
    const order=await models.Order.create({buyerId:buyer.id,sellerId:seller.id,checkoutId:crypto.randomUUID(),status:status==='CANCELED'?'CANCELED':'PENDING',total:'12.50',deliveryAddressSnapshot:snapshot});
    for(let i=0;i<products.length;i++)await models.OrderItem.create({orderId:order.id,productId:products[i].id,productTitle:products[i].title,quantity:quantities[i],unitPrice:'2.50'});
    await models.OrderStatusHistory.create({orderId:order.id,previousStatus:null,newStatus:order.status,changedByUserId:buyer.id,occurredAt:new Date()});
    if(status==='PREPARING')assert.equal((await change(order.id,seller,'PREPARING')).status,200);
    return {order,products,quantities};
  }
  async function state(f){
    const [order]=await root.query('SELECT * FROM orders WHERE id=?',[f.order.id]);
    const [items]=await root.query('SELECT * FROM order_items WHERE orderId=? ORDER BY id',[f.order.id]);
    const [products]=await root.query('SELECT * FROM products WHERE id IN (?) ORDER BY id',[f.products.map(p=>p.id)]);
    const [history]=await root.query('SELECT * FROM order_status_history WHERE orderId=? ORDER BY id',[f.order.id]);
    const [audit]=await root.query("SELECT * FROM audit_logs WHERE action='order.transition' AND targetType='order' AND targetId=? ORDER BY id",[String(f.order.id)]);
    return {order,items,products,history,audit};
  }
  for(const [actor,status] of [[buyer,'PENDING'],[seller,'PENDING'],[seller,'PREPARING'],[admin,'PENDING'],[admin,'PREPARING']]){
    const f=await fixture({status}),before=await state(f);assert.equal((await change(f.order.id,actor)).status,200);const after=await state(f);
    assert.equal(after.order[0].status,'CANCELED');assert.equal(after.order[0].total,before.order[0].total);assert.deepEqual(after.order[0].deliveryAddressSnapshot,before.order[0].deliveryAddressSnapshot);assert.deepEqual(after.items,before.items);
    assert.deepEqual(after.products.map(p=>p.stock),[9,14]);assert.equal(after.history.length,before.history.length+1);assert.equal(after.audit.length,before.audit.length+1);
    assert.equal((await change(f.order.id,actor)).status,409);assert.deepEqual(await state(f),after);
  }groups.push('buyer/seller/admin permissions, PENDING/PREPARING, exact multi-product restock and replay 409');
  {
    const f=await fixture(),before=await state(f);
    const statuses=(await Promise.all([buyer,seller,admin].map(actor=>change(f.order.id,actor)))).map(r=>r.status).sort((a,b)=>a-b);
    assert.deepEqual(statuses,[200,409,409]);const after=await state(f);assert.deepEqual(after.products.map(p=>p.stock),[9,14]);assert.equal(after.history.length,before.history.length+1);assert.equal(after.audit.length,before.audit.length+1);
  }groups.push('three concurrent actors, single restock/history/audit');
  {
    const f=await fixture({status:'PREPARING'}),before=await state(f);
    assert.equal((await change(f.order.id,buyer)).status,403);assert.equal((await change(f.order.id,other)).status,404);assert.equal((await change(f.order.id,secondSeller)).status,404);assert.deepEqual(await state(f),before);
    for(const status of ['SHIPPED','DELIVERED']){
      assert.equal((await change(f.order.id,seller,status)).status,200);const terminal=await state(f);assert.equal((await change(f.order.id,admin)).status,409);assert.deepEqual(await state(f),terminal);
    }
    const old=await fixture({status:'CANCELED'}),historical=await state(old);assert.equal((await change(old.order.id,admin)).status,409);assert.deepEqual(await state(old),historical);
  }groups.push('ownership, invalid transitions and historical cancellation preserved');
  {
    const f=await fixture(),before=await state(f);
    const result=await request(app).put('/api/orders/'+f.order.id+'/status').set('Authorization',buyer.header).send({status:'CANCELED'});assert.equal(result.status,400);assert.deepEqual(await state(f),before);
    await models.Product.destroy({where:{id:f.products[0].id}});const deleted=await state(f);assert.equal((await change(f.order.id,buyer)).status,200);const restored=await state(f);
    assert.equal(restored.products[0].stock,9);assert.deepEqual(restored.products[0].deletedAt,deleted.products[0].deletedAt);assert.deepEqual(restored.items,deleted.items);
  }groups.push('mandatory reason and soft-deleted product remains deleted');
  for(const failure of ['overflow','inventory','history','audit']){
    const f=await fixture({stocks:failure==='overflow'?[7,4294967295]:[7,11]}),before=await state(f);let undo=()=>{};
    if(failure==='inventory'){
      const original=models.Product.prototype.update;models.Product.prototype.update=function(...args){if(this.id===f.products[1].id)throw new Error('Synthetic inventory failure');return original.apply(this,args);};undo=()=>{models.Product.prototype.update=original;};
    }
    if(failure==='history'){const original=models.OrderStatusHistory.create;models.OrderStatusHistory.create=async()=>{throw new Error('Synthetic history failure');};undo=()=>{models.OrderStatusHistory.create=original;};}
    if(failure==='audit'){const audit=require('../../services/audit.service'),original=audit.write;audit.write=async()=>{throw new Error('Synthetic audit failure');};undo=()=>{audit.write=original;};}
    try{assert.equal((await change(f.order.id,admin)).status,failure==='overflow'?409:500);}finally{undo();}
    assert.deepEqual(await state(f),before);
  }groups.push('overflow and inventory/history/audit failures roll back every table');
  async function address(actor){const r=await request(app).post('/api/addresses').set('Authorization',actor.header).send(snapshot);assert.equal(r.status,201);return r.body.id;}
  async function quote(actor,addressId,lines){
    for(const [productId,quantity] of lines)assert.equal((await request(app).post('/api/cart/items').set('Authorization',actor.header).send({productId,quantity})).status,200);
    const result=await request(app).post('/api/checkout/quote').set('Authorization',actor.header).send({addressId:String(addressId)});assert.equal(result.status,200);return result.body.quote;
  }
  const confirm=(actor,token)=>request(app).post('/api/checkout').set('Authorization',actor.header).send({quote:token});
  {
    const p=await models.Product.create({sellerId:seller.id,title:'First seller',price:'2.50',stock:10}),q=await models.Product.create({sellerId:secondSeller.id,title:'Second seller',price:'3.00',stock:10});
    const token=await quote(buyer,await address(buyer),[[p.id,2],[q.id,3]]),created=await confirm(buyer,token);assert.equal(created.status,201);assert.equal(created.body.orders.length,2);
    const first=created.body.orders.find(o=>o.sellerId===seller.id),otherOrder=created.body.orders.find(o=>o.sellerId===secondSeller.id);
    assert.equal((await change(first.id,buyer)).status,200);assert.equal((await models.Product.findByPk(p.id)).stock,10);assert.equal((await models.Product.findByPk(q.id)).stock,7);
    const replay=await confirm(buyer,token);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.orders.find(o=>o.id===first.id).status,'CANCELED');assert.equal(replay.body.orders.find(o=>o.id===otherOrder.id).status,'PENDING');
    assert.equal(await models.Order.count({where:{checkoutId:first.checkoutId}}),2);assert.equal((await models.Product.findByPk(p.id)).stock,10);assert.equal((await models.Product.findByPk(q.id)).stock,7);
  }groups.push('separate seller orders and unchanged checkout idempotency after cancellation');
  {
    const f=await fixture({quantities:[2],stocks:[3]});const token=await quote(other,await address(other),[[f.products[0].id,1]]);
    const [cancel,checkout]=await Promise.all([change(f.order.id,seller),confirm(other,token)]);assert.equal(cancel.status,200);assert.equal(checkout.status,201);assert.equal((await models.Product.findByPk(f.products[0].id)).stock,4);
  }groups.push('checkout competing with cancellation respects lock order and exact stock');
  console.log('PASS: '+groups.length+' isolated cancellation HTTP/MySQL scenario groups: '+groups.join('; '));
};
