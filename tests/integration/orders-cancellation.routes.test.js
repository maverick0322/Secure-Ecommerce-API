'use strict';
const request=require('supertest'),app=require('../../index');
const {tokenFor,mockAccountLookups}=require('../support/auth-fixtures');
const orders=require('../../services/orders.service'),{AccountError}=require('../../services/accounts.service');
const buyer=tokenFor('BUYER'),seller=tokenFor('SELLER',{seller:{status:'APPROVED'}}),admin=tokenFor('ADMIN');
beforeEach(mockAccountLookups);afterEach(()=>jest.restoreAllMocks());
it.each([buyer,seller,admin])('passes only validated identity/status/reason to cancellation %#',async actor=>{
  const transition=jest.spyOn(orders,'transition').mockResolvedValue({id:'7',status:'CANCELED'});
  const result=await request(app).put('/api/orders/7/status').set('Authorization','Bearer '+actor.token).send({status:'CANCELED',reason:' Changed plans '});
  expect(result.status).toBe(200);expect(transition).toHaveBeenCalledWith(expect.objectContaining({id:actor.account.id}),'7',{status:'CANCELED',reason:'Changed plans'},expect.any(String));
});
it.each([{status:'CANCELED'},{status:'CANCELED',reason:''},{status:'CANCELED',reason:'  '},{status:'CANCELED',reason:'x',stock:100},{status:'CANCELED',reason:'x',buyerId:'other'}])('rejects missing reason and client-controlled restitution/ownership %#',async body=>{
  const transition=jest.spyOn(orders,'transition');
  expect((await request(app).put('/api/orders/7/status').set('Authorization','Bearer '+buyer.token).send(body)).status).toBe(400);
  expect(transition).not.toHaveBeenCalled();
});
it('requires authentication and approval for a seller',async()=>{
  expect((await request(app).put('/api/orders/7/status').send({status:'CANCELED',reason:'x'})).status).toBe(401);
  const pending=tokenFor('SELLER',{seller:{status:'PENDING'}});
  expect((await request(app).put('/api/orders/7/status').set('Authorization','Bearer '+pending.token).send({status:'CANCELED',reason:'x'})).status).toBe(403);
});
it('preserves conflict and safe error responses',async()=>{
  const transition=jest.spyOn(orders,'transition').mockRejectedValue(new AccountError(409,'Transición no permitida.'));
  const send=()=>request(app).put('/api/orders/7/status').set('Authorization','Bearer '+buyer.token).send({status:'CANCELED',reason:'x'});
  expect((await send()).status).toBe(409);
  transition.mockRejectedValue({original:{errno:1213}});expect((await send()).status).toBe(409);
  transition.mockRejectedValue(new Error('private database diagnostics'));const result=await send();expect(result.status).toBe(500);expect(result.text).not.toContain('private');
});
