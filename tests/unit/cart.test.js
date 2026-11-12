'use strict';
const {cartInput,productId} = require('../../validators/cart');
const cart = require('../../services/cart.service');
const db = require('../../models');
afterEach(() => jest.restoreAllMocks());
it('validates quantities and disallows ownership or price assignment', () => {
  expect(cartInput({productId:1,quantity:2},true)).toEqual({productId:1,quantity:2});
  expect(cartInput({quantity:1})).toEqual({quantity:1}); expect(productId('2147483647')).toBe(2147483647);
  for (const body of [null,[],{}, {quantity:0},{quantity:-1},{quantity:1.5},{quantity:4294967296},{quantity:'1'},{quantity:1,buyerId:'x'}]) expect(() => cartInput(body)).toThrow();
  for (const id of [null,0,-1,'1 OR 1=1','1e2',2147483648]) expect(() => productId(id)).toThrow();
});
it('calculates exact monetary values without floats', () => {
  expect(cart.money(cart.cents('9999999999.99')*4294967295n)).toBe('42949672949957050327.05');
  expect(cart.money(cart.cents('0.01')*3n)).toBe('0.03');
  expect(() => cart.cents('-1.00')).toThrow(); expect(() => cart.cents('1.001')).toThrow();
});
function fixture() {
  jest.spyOn(db.AuditLog,'create').mockResolvedValue({});
  const tx = {LOCK:{UPDATE:'UPDATE'}};
  const row = {id:'1',restore:jest.fn(),changed:jest.fn(),save:jest.fn()};
  jest.spyOn(db.sequelize,'transaction').mockImplementation(fn => fn(tx));
  jest.spyOn(db.User,'findByPk').mockResolvedValue({status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Buyer,'findByPk').mockResolvedValue({});
  jest.spyOn(db.Cart,'findOne').mockResolvedValue(row);
  jest.spyOn(db.Cart,'create').mockResolvedValue(row);
  jest.spyOn(db.Product,'findByPk').mockResolvedValue({id:5,sellerId:'seller',title:'Product',price:'12.50',stock:10});
  jest.spyOn(db.Seller,'findByPk').mockResolvedValue({userId:'seller',status:'APPROVED'});
  jest.spyOn(db.CartItem,'findAll').mockResolvedValue([]);
  jest.spyOn(db.CartItem,'findOne').mockResolvedValue(null);
  jest.spyOn(db.CartItem,'create').mockResolvedValue({});
  return {tx,row};
}
it('serializes initial cart creation and revives the existing cart', async () => {
  const {tx,row} = fixture(); db.Cart.findOne.mockResolvedValueOnce(null);
  expect(await cart.get('buyer')).toEqual({id:'1',items:[],subtotal:'0.00'});
  expect(db.User.findByPk).toHaveBeenCalledWith('buyer',{transaction:tx,lock:'UPDATE'});
  expect(db.Cart.create).toHaveBeenCalledWith({buyerId:'buyer'},{transaction:tx});
  row.deletedAt=new Date(); await cart.get('buyer'); expect(row.restore).toHaveBeenCalledWith({transaction:tx});
});
it('rejects inactive and missing buyer profiles', async () => {
  fixture(); db.User.findByPk.mockResolvedValueOnce(null);
  await expect(cart.get('buyer')).rejects.toMatchObject({status:403});
  db.Buyer.findByPk.mockResolvedValue(null); await expect(cart.get('buyer')).rejects.toMatchObject({status:403});
});
it('inserts, increments and revives without storing price', async () => {
  const {tx} = fixture(); await cart.put('buyer',5,2,true);
  expect(db.CartItem.create).toHaveBeenCalledWith({cartId:'1',productId:5,quantity:2},{transaction:tx});
  const item={quantity:2,update:jest.fn(),restore:jest.fn()}; db.CartItem.findOne.mockResolvedValue(item);
  await cart.put('buyer',5,3,true); expect(item.update).toHaveBeenLastCalledWith({quantity:5},{transaction:tx});
  item.deletedAt=new Date(); await cart.put('buyer',5,1,true);
  expect(item.restore).toHaveBeenCalledWith({transaction:tx}); expect(item.update).toHaveBeenLastCalledWith({quantity:1},{transaction:tx});
});
it('rejects unavailable products, sellers, missing lines and insufficient stock', async () => {
  fixture(); db.Product.findByPk.mockResolvedValueOnce(null);
  await expect(cart.put('buyer',5,1,true)).rejects.toMatchObject({status:404});
  db.Seller.findByPk.mockResolvedValueOnce(null);
  await expect(cart.put('buyer',5,1,true)).rejects.toMatchObject({status:409});
  await expect(cart.put('buyer',5,1)).rejects.toMatchObject({status:404});
  await expect(cart.put('buyer',5,11,true)).rejects.toMatchObject({status:409});
});
it('calculates current totals and marks unavailable products', async () => {
  fixture(); db.CartItem.findAll.mockResolvedValue([{productId:5,quantity:2}]);
  expect((await cart.get('buyer')).subtotal).toBe('25.00');
  db.Product.findByPk.mockResolvedValue(null);
  expect((await cart.get('buyer')).items[0]).toMatchObject({available:false,unitPrice:null,subtotal:null});
});
it('removes only an owned active item using paranoid deletion', async () => {
  const {tx}=fixture(); await expect(cart.remove('buyer',5)).rejects.toMatchObject({status:404});
  const item={destroy:jest.fn()}; db.CartItem.findOne.mockResolvedValue(item);
  await cart.remove('buyer',5); expect(item.destroy).toHaveBeenCalledWith({transaction:tx});
  expect(db.CartItem.options.paranoid).toBe(true);
});
it('documents every cart endpoint and excludes price/owner from request bodies', () => {
  const spec=require('../../services/swagger-contract.service').completeSpecification({paths:{}});
  for (const [p,m] of [['/api/cart','get'],['/api/cart/items','post'],['/api/cart/items/{productId}','put'],['/api/cart/items/{productId}','delete']]) {
    expect(spec.paths[p][m].security).toEqual([{bearerAuth:[]}]); expect(spec.paths[p][m].responses[409]).toBeDefined();
  }
  expect(Object.keys(spec.paths['/api/cart/items'].post.parameters[0].schema.properties).sort()).toEqual(['productId','quantity']);
});
