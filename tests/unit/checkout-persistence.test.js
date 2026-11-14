'use strict';
const db=require('../../models');
const orders=require('../../services/orders.service');
const quotes=require('../../services/checkout-quote.service');
const audit=require('../../services/audit.service');
const tx={LOCK:{UPDATE:'UPDATE'}},buyer='buyer',seller='seller';
let product,line,content,order;
beforeEach(()=>{
  product={id:1,sellerId:seller,title:'Historical title',price:'12.50',stock:5,update:jest.fn()};
  line={productId:1,quantity:2,destroy:jest.fn()};
  content={checkoutId:'checkout',addressId:'1',items:[{productId:1,sellerId:seller,title:product.title,price:'12.50',quantity:2}],
    address:orders.addressSnapshot({street:'Original street'}),exp:Math.floor(Date.now()/1000)+600};
  order={id:7,buyerId:buyer,sellerId:seller,deliveryAddressSnapshot:content.address,status:'PENDING',update:jest.fn()};
  jest.spyOn(db.sequelize,'transaction').mockImplementation(work=>work(tx));
  jest.spyOn(db.User,'findByPk').mockResolvedValue({status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Buyer,'findByPk').mockResolvedValue({});jest.spyOn(db.Seller,'findByPk').mockResolvedValue({status:'APPROVED'});
  jest.spyOn(db.UserAddress,'findOne').mockResolvedValue(content.address);
  jest.spyOn(db.Cart,'findOne').mockResolvedValue({id:1});jest.spyOn(db.CartItem,'findAll').mockResolvedValue([line]);
  jest.spyOn(db.Product,'findAll').mockResolvedValue([product]);jest.spyOn(db.Product,'findByPk').mockResolvedValue(product);
  jest.spyOn(db.Order,'findAll').mockResolvedValue([]);jest.spyOn(db.Order,'create').mockResolvedValue(order);
  jest.spyOn(db.OrderItem,'create').mockResolvedValue({});jest.spyOn(db.OrderItem,'findAll').mockResolvedValue([
    {id:9,orderId:7,productId:1,productTitle:product.title,unitPrice:'12.50',quantity:2}]);
  jest.spyOn(db.OrderStatusHistory,'create').mockResolvedValue({});jest.spyOn(audit,'write').mockResolvedValue({});
  jest.spyOn(quotes,'verify').mockImplementation(()=>content);
});
afterEach(()=>jest.restoreAllMocks());
it('writes server totals, immutable snapshots, inventory, history and audit in one transaction',async()=>{
  const result=await orders.confirm(buyer,'signed','127.0.0.1');
  expect(result.replayed).toBe(false);
  expect(db.Order.create).toHaveBeenCalledWith(expect.objectContaining({buyerId:buyer,sellerId:seller,total:'25.00',deliveryAddressSnapshot:content.address}),{transaction:tx});
  expect(db.OrderItem.create).toHaveBeenCalledWith({orderId:7,productId:1,productTitle:'Historical title',quantity:2,unitPrice:'12.50'},{transaction:tx});
  expect(product.update).toHaveBeenCalledWith({stock:3},{transaction:tx});expect(line.destroy).toHaveBeenCalledWith({transaction:tx});
  expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({action:'order.create'}),{transaction:tx});
  expect(db.OrderStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({newStatus:'PENDING',previousStatus:null}),{transaction:tx});
});
it('replays only matching historical contents without decrementing stock or rewriting snapshots',async()=>{
  db.Order.findAll.mockResolvedValue([order]);content.exp=0;
  expect((await orders.confirm(buyer,'signed')).replayed).toBe(true);
  expect(product.update).not.toHaveBeenCalled();expect(db.Order.create).not.toHaveBeenCalled();expect(line.destroy).not.toHaveBeenCalled();
});
it.each(['owner','quantity','address'])('rejects an idempotency collision in %s',async field=>{
  db.Order.findAll.mockResolvedValue([order]);
  if(field==='owner')order.buyerId='other';else if(field==='quantity')content.items[0].quantity=3;else content.address={street:'Changed'};
  await expect(orders.confirm(buyer,'signed')).rejects.toMatchObject({status:409});expect(product.update).not.toHaveBeenCalled();
});
it.each(['expired','price','address','stock','seller','missing-product'])('requires reconfirmation or denies checkout for %s',async field=>{
  if(field==='expired')content.exp=0;
  if(field==='price')product.price='13.00';if(field==='address')content.address={street:'Changed'};
  if(field==='stock')product.stock=1;if(field==='seller')db.Seller.findByPk.mockResolvedValue({status:'SUSPENDED'});
  if(field==='missing-product')db.Product.findAll.mockResolvedValue([]);
  await expect(orders.confirm(buyer,'signed')).rejects.toMatchObject({status:409});expect(db.Order.create).not.toHaveBeenCalled();
});
it('does not report success or clear the cart when order-item persistence fails',async()=>{
  db.OrderItem.create.mockRejectedValue(new Error('Synthetic database failure'));
  await expect(orders.confirm(buyer,'signed')).rejects.toThrow('Synthetic database failure');
  expect(line.destroy).not.toHaveBeenCalled();expect(audit.write).not.toHaveBeenCalled();
});
it.each([['ADMIN',{}],['BUYER',{buyerId:'owner'}],['SELLER',{sellerId:'owner'}]])('scopes %s listing and historical reads to the current owner',async(profile,where)=>{
  const actor={id:'owner',profile};await orders.list(actor);expect(db.Order.findAll).toHaveBeenLastCalledWith({where,order:[['id','DESC']],limit:100});
  jest.spyOn(db.Order,'findOne').mockResolvedValue(order);jest.spyOn(db.OrderStatusHistory,'findAll').mockResolvedValue([{newStatus:'PENDING'}]);
  const result=await orders.get(actor,'7');expect(db.Order.findOne).toHaveBeenCalledWith({where:{id:'7',...where}});expect(result.history).toEqual([{newStatus:'PENDING'}]);
  db.Order.findOne.mockResolvedValue(null);await expect(orders.get(actor,'8')).rejects.toMatchObject({status:404});
});
it.each(['ADMIN','SELLER','BUYER'])('records an authorized %s cancellation without touching snapshots or stock',async profile=>{
  const actor={id:profile==='SELLER'?seller:buyer,profile};
  jest.spyOn(db.Admin,'findByPk').mockResolvedValue({});jest.spyOn(db.Order,'findOne').mockResolvedValue(order);
  await orders.transition(actor,'7',{status:'CANCELED',reason:'Synthetic reason'},'127.0.0.1');
  expect(order.update).toHaveBeenCalledWith({status:'CANCELED',updatedAt:expect.any(Date)},{transaction:tx,fields:['status','updatedAt']});
  expect(db.OrderStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({previousStatus:'PENDING',newStatus:'CANCELED',reason:'Synthetic reason'}),{transaction:tx});
  expect(product.update).not.toHaveBeenCalled();
});
it.each(['inactive','unapproved','missing','backward','buyer-shipping','reason'])('rejects an unauthorized transition: %s',async kind=>{
  jest.spyOn(db.Order,'findOne').mockResolvedValue(order);
  const actor={id:buyer,profile:'BUYER'},input={status:'CANCELED',reason:'Synthetic'};
  if(kind==='inactive')db.User.findByPk.mockResolvedValue(null);
  if(kind==='unapproved'){actor.profile='SELLER';db.Seller.findByPk.mockResolvedValue({status:'SUSPENDED'});}
  if(kind==='missing')db.Order.findOne.mockResolvedValue(null);
  if(kind==='backward')order.status='DELIVERED';
  if(kind==='buyer-shipping')input.status='PREPARING';if(kind==='reason')input.reason=null;
  await expect(orders.transition(actor,'7',input)).rejects.toMatchObject({status:{inactive:403,unapproved:403,missing:404,backward:409,'buyer-shipping':403,reason:400}[kind]});
  expect(order.update).not.toHaveBeenCalled();expect(db.OrderStatusHistory.create).not.toHaveBeenCalled();
});
