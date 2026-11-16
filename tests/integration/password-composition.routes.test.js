'use strict';
const request=require('supertest'),app=require('../../index');
const {tokenFor,mockAccountLookups,sessions}=require('../support/auth-fixtures');
const mail=require('../../services/registration-email.service'),db=require('../../models');
let buyer,admin;
beforeEach(()=>{
  mockAccountLookups();buyer=tokenFor('BUYER');admin=tokenFor('ADMIN');
  jest.spyOn(mail,'sendVerificationCode').mockResolvedValue();
  jest.spyOn(db.sequelize,'transaction');sessions.revokeAll.mockClear();
});
afterEach(()=>jest.restoreAllMocks());
it.each(['NoNumber!','NoSymbol1','1234567!'])('enforces composition in registration, own/admin password change and reset %#',async password=>{
  const register=await request(app).post('/api/auth/register').send({email:'policy@example.invalid',name:'Persona',profile:'BUYER',password});
  const own=await request(app).put('/api/users/me/password').set('Authorization','Bearer '+buyer.token).send({currentPassword:'Brisa7!?',newPassword:password});
  const reset=await request(app).post('/api/auth/password/reset').send({email:buyer.account.email,code:'123456',newPassword:password});
  const administrative=await request(app).put('/api/users/'+buyer.account.email).set('Authorization','Bearer '+admin.token).send({password});
  for(const result of [register,own,reset,administrative]){expect(result.status).toBe(400);expect(result.body.message).toContain('una letra, un número y un carácter especial');}
  expect(mail.sendVerificationCode).not.toHaveBeenCalled();expect(sessions.revokeAll).not.toHaveBeenCalled();
  expect(db.sequelize.transaction).not.toHaveBeenCalled();
});
