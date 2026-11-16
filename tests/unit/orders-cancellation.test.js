'use strict';
const db=require('../../models'),orders=require('../../services/orders.service'),audit=require('../../services/audit.service');
const tx={LOCK:{UPDATE:'UPDATE'}};
let order,products,items;
beforeEach(()=>{
  order={id:7,buyerId:'buyer',sellerId:'seller',status:'PENDING',total:'15.00',deliveryAddressSnapshot:{street:'Original'},update:jest.fn(async values=>Object.assign(order,values))};
  products=[{id:1,sellerId:'seller',stock:5,deletedAt:new Date()},{id:2,sellerId:'seller',stock:10}];
  for(const product of products)product.update=jest.fn(async values=>Object.assign(product,values));
  items=[{id:3,productId:2,quantity:4},{id:1,productId:1,quantity:2},{id:2,productId:1,quantity:3}];
  jest.spyOn(db.sequelize,'transaction').mockImplementation(work=>work(tx));
  jest.spyOn(db.User,'findByPk').mockResolvedValue({status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Buyer,'findByPk').mockResolvedValue({});jest.spyOn(db.Admin,'findByPk').mockResolvedValue({});
  jest.spyOn(db.Seller,'findByPk').mockResolvedValue({status:'APPROVED'});
  jest.spyOn(db.Order,'findOne').mockImplementation(async({where})=>
    (where.buyerId&&where.buyerId!==order.buyerId)||(where.sellerId&&where.sellerId!==order.sellerId)?null:order);
  jest.spyOn(db.OrderItem,'findAll').mockResolvedValue(items);
  jest.spyOn(db.Product,'findByPk').mockImplementation(async id=>products.find(p=>p.id===id));
  jest.spyOn(db.OrderStatusHistory,'create').mockResolvedValue({});jest.spyOn(audit,'write').mockResolvedValue({});
});
afterEach(()=>jest.restoreAllMocks());
const cancel=actor=>orders.transition(actor,'7',{status:'CANCELED',reason:'Valid reason'},'127.0.0.1');
it.each([['BUYER','PENDING'],['SELLER','PENDING'],['SELLER','PREPARING'],['ADMIN','PENDING'],['ADMIN','PREPARING']])('restocks exactly for %s from %s, without rewriting historical data',async(profile,status)=>{
  order.status=status;const deletedAt=products[0].deletedAt;
  const result=await cancel({id:profile.toLowerCase(),profile});
  expect(result.status).toBe('CANCELED');expect(result.total).toBe('15.00');expect(result.deliveryAddressSnapshot).toEqual({street:'Original'});
  expect(products.map(p=>p.stock)).toEqual([10,14]);expect(products[0].deletedAt).toBe(deletedAt);
  expect(db.Product.findByPk.mock.calls.map(c=>c[0])).toEqual([1,2]);
  for(const product of products)expect(product.update).toHaveBeenCalledWith({stock:product.stock},{transaction:tx,fields:['stock','updatedAt']});
  expect(db.OrderStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({previousStatus:status,newStatus:'CANCELED',reason:'Valid reason'}),{transaction:tx});
  expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({action:'order.transition',details:{status:'CANCELED',previousStatus:status}}),{transaction:tx});
});
it('acquires the seller lock before the order and products, without locking immutable order_items',async()=>{
  await cancel({id:'buyer',profile:'BUYER'});
  expect(db.User.findByPk.mock.calls.map(c=>c[0])).toEqual(['buyer','seller']);
  expect(db.Order.findOne.mock.calls[1][0].lock).toBe('UPDATE');
  expect(db.User.findByPk.mock.invocationCallOrder[1]).toBeLessThan(db.Order.findOne.mock.invocationCallOrder[1]);
  expect(db.Order.findOne.mock.invocationCallOrder[1]).toBeLessThan(db.Product.findByPk.mock.invocationCallOrder[0]);
  expect(db.OrderItem.findAll.mock.calls[0][0]).not.toHaveProperty('lock');
  expect(db.Product.findByPk).toHaveBeenCalledWith(1,{transaction:tx,paranoid:false,lock:'UPDATE'});
});
it.each(['SHIPPED','DELIVERED','CANCELED'])('does not restock or create events for historical %s',async status=>{
  order.status=status;await expect(cancel({id:'admin',profile:'ADMIN'})).rejects.toMatchObject({status:409});
  expect(db.OrderItem.findAll).not.toHaveBeenCalled();expect(order.update).not.toHaveBeenCalled();expect(audit.write).not.toHaveBeenCalled();
});
it('rejects a repeat after the first cancellation without another inventory write or event',async()=>{
  await cancel({id:'buyer',profile:'BUYER'});await expect(cancel({id:'buyer',profile:'BUYER'})).rejects.toMatchObject({status:409});
  expect(products[0].update).toHaveBeenCalledTimes(1);expect(audit.write).toHaveBeenCalledTimes(1);
});
it.each([['BUYER','other','PENDING',404],['SELLER','other','PENDING',404],['BUYER','buyer','PREPARING',403]])('rejects unauthorized %s cancellation %#',async(profile,id,status,code)=>{
  order.status=status;await expect(cancel({id,profile})).rejects.toMatchObject({status:code});expect(db.Product.findByPk).not.toHaveBeenCalled();
});
it('allows a buyer cancellation when the seller is suspended, but not cancellation by that seller',async()=>{
  db.Seller.findByPk.mockResolvedValue({status:'SUSPENDED'});
  await expect(cancel({id:'seller',profile:'SELLER'})).rejects.toMatchObject({status:403});
  await cancel({id:'buyer',profile:'BUYER'});expect(products[0].stock).toBe(10);
});
it('validates all stock bounds before writing any product',async()=>{
  products[1].stock=4294967295;await expect(cancel({id:'buyer',profile:'BUYER'})).rejects.toMatchObject({status:409});
  for(const p of products)expect(p.update).not.toHaveBeenCalled();expect(order.update).not.toHaveBeenCalled();
});
it('permits restitution exactly at the unsigned maximum',async()=>{
  products[0].stock=4294967290;await cancel({id:'buyer',profile:'BUYER'});expect(products[0].stock).toBe(4294967295);
});
it.each(['empty','invalid-quantity','missing-product','foreign-product'])('rejects inconsistent historical content: %s',async kind=>{
  if(kind==='empty')db.OrderItem.findAll.mockResolvedValue([]);if(kind==='invalid-quantity')items[0].quantity=0;
  if(kind==='missing-product')db.Product.findByPk.mockResolvedValue(null);if(kind==='foreign-product')products[0].sellerId='other';
  await expect(cancel({id:'admin',profile:'ADMIN'})).rejects.toMatchObject({status:409});expect(order.update).not.toHaveBeenCalled();
});
it.each(['inventory','history','audit'])('propagates %s failure to the transaction instead of reporting success',async kind=>{
  const failure=new Error('Synthetic failure');if(kind==='inventory')products[1].update.mockRejectedValue(failure);
  if(kind==='history')db.OrderStatusHistory.create.mockRejectedValue(failure);if(kind==='audit')audit.write.mockRejectedValue(failure);
  await expect(cancel({id:'admin',profile:'ADMIN'})).rejects.toBe(failure);
  if(kind==='inventory'){expect(order.update).not.toHaveBeenCalled();expect(db.OrderStatusHistory.create).not.toHaveBeenCalled();}
  if(kind!=='audit')expect(audit.write).not.toHaveBeenCalled();
});
