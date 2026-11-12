'use strict';
const request=require('supertest');
const express=require('express');
const {tokenFor,mockAccountLookups}=require('../support/auth-fixtures');
const cart=require('../../services/cart.service');
const app=express(); app.use(express.json()); app.use('/api/cart',require('../../routes/cart.routes'));
const buyer=tokenFor('BUYER'); const other=tokenFor('BUYER'); const admin=tokenFor('ADMIN');
const auth=(r,account=buyer) => r.set('Authorization',`Bearer ${account.token}`);
beforeEach(mockAccountLookups); afterEach(() => jest.restoreAllMocks());
it('requires a verified buyer and derives ownership from the current account',async () => {
  const get=jest.spyOn(cart,'get').mockResolvedValue({id:'1',items:[],subtotal:'0.00'});
  expect((await request(app).get('/api/cart')).status).toBe(401);
  expect((await auth(request(app).get('/api/cart'),admin)).status).toBe(403);
  expect((await auth(request(app).get('/api/cart'))).status).toBe(200);
  expect(get).toHaveBeenLastCalledWith(buyer.account.id,{ipAddress:expect.any(String)});
  await auth(request(app).get('/api/cart'),other); expect(get).toHaveBeenLastCalledWith(other.account.id,{ipAddress:expect.any(String)});
});
it('validates and dispatches mutations without accepting ownership or prices',async () => {
  const put=jest.spyOn(cart,'put').mockResolvedValue({items:[]}); const remove=jest.spyOn(cart,'remove').mockResolvedValue();
  expect((await auth(request(app).post('/api/cart/items')).send({productId:2,quantity:1,price:0})).status).toBe(400);
  expect(put).not.toHaveBeenCalled();
  expect((await auth(request(app).post('/api/cart/items')).send({productId:2,quantity:1})).status).toBe(200);
  expect(put).toHaveBeenLastCalledWith(buyer.account.id,2,1,true,{ipAddress:expect.any(String)});
  expect((await auth(request(app).put('/api/cart/items/2')).send({quantity:3})).status).toBe(200);
  expect(put).toHaveBeenLastCalledWith(buyer.account.id,2,3,false,{ipAddress:expect.any(String)});
  expect((await auth(request(app).delete('/api/cart/items/2'))).status).toBe(204);
  expect(remove).toHaveBeenCalledWith(buyer.account.id,2,{ipAddress:expect.any(String)});
});
it('returns conflicts safely and hides unexpected database errors',async () => {
  const {AccountError}=require('../../services/accounts.service');
  jest.spyOn(cart,'put').mockRejectedValue(new AccountError(409,'Inventario insuficiente.'));
  expect((await auth(request(app).post('/api/cart/items')).send({productId:2,quantity:1})).status).toBe(409);
  jest.spyOn(cart,'get').mockRejectedValue(new Error('sensitive database error'));
  const result=await auth(request(app).get('/api/cart')); expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain('sensitive');
});
