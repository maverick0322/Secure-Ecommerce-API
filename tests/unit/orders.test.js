'use strict';
const {quoteInput,confirmInput,transitionInput}=require('../../validators/orders');
const quotes=require('../../services/checkout-quote.service');
const orders=require('../../services/orders.service');
process.env.JWT_SECRET=require('../support/signing-secret');
it('validates checkout requests without accepting client prices, sellers or totals',()=>{
  expect(quoteInput({addressId:'1'})).toEqual({addressId:'1'});
  expect(confirmInput({quote:'signed'})).toBe('signed');
  for(const body of [null,[],{addressId:'0'},{addressId:1},{addressId:'1',price:0}]) expect(()=>quoteInput(body)).toThrow();
  for(const body of [{},null,{quote:'x',total:0},{quote:1}]) expect(()=>confirmInput(body)).toThrow();
});
it('requires a bounded cancellation reason and rejects arbitrary state/attribute changes',()=>{
  expect(transitionInput({status:'CANCELED',reason:' Reason '})).toEqual({status:'CANCELED',reason:'Reason'});
  expect(transitionInput({status:'PREPARING'})).toEqual({status:'PREPARING',reason:null});
  for(const body of [{status:'PENDING'},{status:'CANCELED'},{status:'CANCELED',reason:'x'.repeat(256)},
    {status:'SHIPPED',reason:'\n'},{status:'SHIPPED',total:0}]) expect(()=>transitionInput(body)).toThrow();
});
it('binds signed quotes to the buyer, domain and complete contents',()=>{
  const payload={checkoutId:'synthetic-id',items:[{productId:1,quantity:2}],address:{street:'Street'}};
  const signed=quotes.sign('buyer',payload);
  expect(quotes.verify(signed,'buyer')).toMatchObject(payload);
  expect(()=>quotes.verify(signed,'other')).toThrow('Cotización inválida');
  expect(()=>quotes.verify(signed.slice(0,-5)+'wrong','buyer')).toThrow();
  expect(()=>quotes.verify(null,'buyer')).toThrow();
});
it('groups exact totals by seller and rejects DECIMAL overflow',()=>{
  const groups=orders.grouped([{sellerId:'a',price:'0.10',quantity:3},{sellerId:'b',price:'12.50',quantity:1},{sellerId:'a',price:'0.20',quantity:1}]);
  expect(groups.map(g=>[g.sellerId,g.total])).toEqual([['a',50n],['b',1250n]]);
  expect(()=>orders.grouped([{sellerId:'a',price:'9999999999.99',quantity:2}])).toThrow('límite');
});
it('snapshots only delivery fields, excluding phone, owner and persistence metadata',()=>{
  const result=orders.addressSnapshot({id:1,buyerId:'b',street:'Street',phoneNumber:'private',deletedAt:null});
  expect(result.street).toBe('Street'); expect(result.interiorNumber).toBeNull();
  expect(result).not.toHaveProperty('phoneNumber');expect(result).not.toHaveProperty('buyerId');expect(result).not.toHaveProperty('id');
});
it('documents all checkout and order routes with safe inputs and JWT',()=>{
  const spec=require('../../services/swagger-contract.service').completeSpecification({paths:{}});
  for(const [p,m] of [['/api/checkout/quote','post'],['/api/checkout','post'],['/api/orders','get'],['/api/orders/{id}','get'],['/api/orders/{id}/status','put']]){
    expect(spec.paths[p][m].security).toEqual([{bearerAuth:[]}]);expect(spec.paths[p][m].responses[409]).toBeDefined();
  }
  expect(spec.paths['/api/checkout'].post.responses[200]).toBeDefined();
  expect(Object.keys(spec.paths['/api/checkout'].post.parameters[0].schema.properties)).toEqual(['quote']);
});
