'use strict';
const request=require('supertest'),app=require('../../index'),db=require('../../models');
const {tokenFor,mockAccountLookups,sessions}=require('../support/auth-fixtures');
const hashes=require('../../services/password-hash.service'),mail=require('../../services/registration-email.service');
const accounts=require('../../services/accounts.service'),personal=require('../../services/personal-account.service');
let buyer,seller,tx,storedHash;
beforeAll(async()=>{storedHash=await hashes.hash('Brisa7!?');});
beforeEach(()=>{
  mockAccountLookups();tx={LOCK:{UPDATE:'UPDATE'}};
  buyer=tokenFor('BUYER',{passwordHash:storedHash,phoneNumber:null});seller=tokenFor('SELLER',{passwordHash:storedHash});
  for(const entry of [buyer,seller]){entry.account.update=jest.fn(async values=>Object.assign(entry.account,values));entry.account.seller&&(entry.account.seller.update=jest.fn());}
  jest.spyOn(db.sequelize,'transaction').mockImplementation(work=>work(tx));
  jest.spyOn(db.Seller,'findByPk').mockImplementation(async id=>id===seller.account.id?seller.account.seller:null);
  jest.spyOn(mail,'sendVerificationCode').mockResolvedValue();
  jest.spyOn(db.User,'findOne').mockResolvedValue(null);
  sessions.revokeAll.mockClear();
});
afterEach(async()=>{await personal.whenRecoveryIdle();jest.restoreAllMocks();});
it.each(['BUYER','SELLER'])('validates the %s form before sending and binds verification to its server snapshot',async profile=>{
  const email=profile.toLowerCase()+'-new@example.invalid';
  const form={email,name:'Owner',password:'Brisa7!?',profile,...(profile==='SELLER'?{storeName:'Tienda'}:{})};
  expect((await request(app).post('/api/auth/register').send({...form,profile:'ADMIN'})).status).toBe(400);
  expect(mail.sendVerificationCode).not.toHaveBeenCalled();
  const create=jest.spyOn(accounts,'createVerifiedRegistration').mockImplementation(async pending=>({email:pending.email,profile:pending.profile}));
  expect((await request(app).post('/api/auth/register').send(form)).status).toBe(202);
  const code=mail.sendVerificationCode.mock.calls[0][1];
  expect((await request(app).post('/api/auth/register/verify').send({email,code,profile:'ADMIN'})).status).toBe(400);
  expect((await request(app).post('/api/auth/register/verify').send({email:'other@example.invalid',code})).status).toBe(400);
  const result=await request(app).post('/api/auth/register/verify').send({email,code});expect(result.status).toBe(201);
  const pending=create.mock.calls[0][0];expect(pending.password).toBeUndefined();expect(pending.passwordHash.startsWith('$scrypt$')).toBe(true);
  expect(await hashes.verify(form.password,pending.passwordHash)).toBe(true);
  expect((await request(app).post('/api/auth/register/verify').send({email,code})).status).toBe(400);
});
it('edits only the authenticated owner and prevents mass assignment',async()=>{
  const auth=req=>req.set('Authorization','Bearer '+buyer.token);
  expect((await auth(request(app).get('/api/users/me'))).body.id).toBe(buyer.account.id);
  expect((await auth(request(app).put('/api/users/me')).send({name:'Nuevo',phoneNumber:'+52 555 1234567'})).status).toBe(200);
  expect(buyer.account.update).toHaveBeenCalledWith({name:'Nuevo',phoneNumber:'+52 555 1234567'},expect.objectContaining({transaction:tx}));
  for(const fields of [{id:seller.account.id},{status:'ACTIVE'},{profile:'ADMIN'},{emailVerifiedAt:new Date()},{storeName:'Buyer shop'},{phoneNumber:42}])expect((await auth(request(app).put('/api/users/me')).send(fields)).status).toBeGreaterThanOrEqual(400);
  expect(seller.account.update).not.toHaveBeenCalled();expect((await request(app).get('/api/users/me')).status).toBe(401);
});

it.each([false,true])('rejects duplicate email before hashing, OTP or delivery, including deleted accounts: %s',async deleted=>{
  db.User.findOne.mockResolvedValue({id:buyer.account.id,deletedAt:deleted?new Date():null});
  const issue=jest.spyOn(require('../../services/email-verification.service'),'issue');
  const hash=jest.spyOn(hashes,'hash');
  const result=await request(app).post('/api/auth/register').send({email:' DUPLICATE@EXAMPLE.INVALID ',name:'Persona',password:'contraseña123?',profile:'BUYER'});
  expect(result.status).toBe(409);expect(result.body.message).toBe('El correo electrónico ya está registrado.');
  expect(db.User.findOne).toHaveBeenCalledWith({where:{email:'duplicate@example.invalid'},paranoid:false});
  expect(hash).not.toHaveBeenCalled();expect(issue).not.toHaveBeenCalled();expect(mail.sendVerificationCode).not.toHaveBeenCalled();
});
it('fails closed before OTP on lookup failure and preserves final UNIQUE conflict handling',async()=>{
  const issue=jest.spyOn(require('../../services/email-verification.service'),'issue');
  db.User.findOne.mockRejectedValue(new Error('private SQL failure'));
  const body={email:'lookup-failure@example.invalid',name:'Persona',password:'contraseña123?',profile:'BUYER'};
  expect((await request(app).post('/api/auth/register').send(body)).status).toBe(500);expect(issue).not.toHaveBeenCalled();
  db.User.findOne.mockResolvedValue(null);
  expect((await request(app).post('/api/auth/register').send(body)).status).toBe(202);
  const code=mail.sendVerificationCode.mock.calls[0][1];
  jest.spyOn(db.User,'create').mockRejectedValue(new db.Sequelize.UniqueConstraintError({errors:[]}));
  const verified=await request(app).post('/api/auth/register/verify').send({email:body.email,code});
  expect(verified.status).toBe(409);expect(verified.body.message).toBe('El correo electrónico ya está registrado.');
});
it('allows a pending seller to change own password, validates the old one and revokes before SQL update',async()=>{
  const auth=req=>req.set('Authorization','Bearer '+seller.token);
  expect((await auth(request(app).put('/api/users/me/password')).send({currentPassword:'wrong',newPassword:'Nueva72!?'})).status).toBe(400);
  expect(sessions.revokeAll).not.toHaveBeenCalled();
  expect((await auth(request(app).put('/api/users/me/password')).send({currentPassword:'Brisa7!?',newPassword:'Nueva72!?'})).status).toBe(204);
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:seller.account.id});
  expect(await hashes.verify('Nueva72!?',seller.account.passwordHash)).toBe(true);
  expect(db.AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({action:'password.change',actorUserId:seller.account.id}),{transaction:tx});
});
it('uses a purpose-isolated recovery OTP and gives the same request response to unknown accounts and delivery failures',async()=>{
  jest.spyOn(accounts,'findAccountByEmail').mockImplementation(async email=>email===buyer.account.email?buyer.account:null);
  const known=await request(app).post('/api/auth/password/forgot').send({email:buyer.account.email});
  const unknown=await request(app).post('/api/auth/password/forgot').send({email:'unknown@example.invalid'});expect(known.status).toBe(202);expect(unknown.body).toEqual(known.body);
  expect(known.body.message).toBe('Revisa tu correo electrónico. Si existe una cuenta asociada a esta dirección, recibirás un código para restablecer tu contraseña.');
  await personal.whenRecoveryIdle();
  const code=mail.sendVerificationCode.mock.calls[0][1];expect(mail.sendVerificationCode.mock.calls[0][2]).toBe('recovery');
  expect((await request(app).post('/api/auth/register/verify').send({email:buyer.account.email,code})).status).toBe(400);
  const reset={email:buyer.account.email,code,newPassword:'Nueva72!?'};
  expect((await request(app).post('/api/auth/password/reset').send(reset)).status).toBe(204);
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:buyer.account.id});expect(await hashes.verify('Nueva72!?',buyer.account.passwordHash)).toBe(true);
  expect((await request(app).post('/api/auth/password/reset').send(reset)).status).toBe(400);
  mail.sendVerificationCode.mockRejectedValue(new Error('private provider data'));
  const another=tokenFor('BUYER');accounts.findAccountByEmail.mockResolvedValue(another.account);
  const failed=await request(app).post('/api/auth/password/forgot').send({email:another.account.email});expect(failed.body).toEqual(unknown.body);
  await personal.whenRecoveryIdle();
});
it('propagates audit failure and never restores sessions on rollback',async()=>{
  db.AuditLog.create.mockRejectedValue(new Error('private audit failure'));
  await expect(personal.changePassword(buyer.account.id,{currentPassword:'Brisa7!?',newPassword:'Nueva72!?'})).rejects.toThrow();
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:buyer.account.id});
});
it('rejects stale recovery challenges after a concurrent credential change',async()=>{
  jest.spyOn(accounts,'findAccountByEmail').mockResolvedValue(buyer.account);
  await personal.forgot({email:buyer.account.email});await personal.whenRecoveryIdle();const code=mail.sendVerificationCode.mock.calls[0][1];
  buyer.account.passwordHash=await hashes.hash('Changed83!?');
  await expect(personal.reset({email:buyer.account.email,code,newPassword:'Nueva72!?'})).rejects.toMatchObject({status:400});
  expect(sessions.revokeAll).not.toHaveBeenCalled();
});
it('returns generic HTTP acceptance before any SQL lookup or mail delivery completes',async()=>{
  let releaseLookup,releaseSend;
  const lookupGate=new Promise(resolve=>{releaseLookup=resolve;}),sendGate=new Promise(resolve=>{releaseSend=resolve;});
  const issued=jest.spyOn(require('../../services/email-verification.service'),'issue');
  const lookup=jest.spyOn(accounts,'findAccountByEmail').mockImplementation(async email=>{
    await lookupGate;return email===buyer.account.email?buyer.account:null;
  });
  mail.sendVerificationCode.mockImplementation(()=>sendGate);
  try {
    const known=await request(app).post('/api/auth/password/forgot').send({email:buyer.account.email});
    const unknown=await request(app).post('/api/auth/password/forgot').send({email:'gated-unknown@example.invalid'});
    expect(known.status).toBe(202);expect(unknown.body).toEqual(known.body);
    expect(mail.sendVerificationCode).not.toHaveBeenCalled();expect(lookup).toHaveBeenCalled();
  } finally {releaseLookup();releaseSend();await personal.whenRecoveryIdle();}
  expect(issued).toHaveBeenCalledTimes(1);
  expect(issued).toHaveBeenCalledWith(buyer.account.email,expect.objectContaining({userId:buyer.account.id}),'recovery');
});
it('bounds and deduplicates recovery work while preserving uniform responses',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const lookup=jest.spyOn(accounts,'findAccountByEmail').mockImplementation(async()=>{await gate;return null;});
  try {
    await Promise.all(Array.from({length:40},(_,i)=>personal.forgot({email:'bounded-'+i+'@example.invalid'})));
    await personal.forgot({email:'bounded-0@example.invalid'});
    await new Promise(resolve=>setImmediate(resolve));expect(lookup).toHaveBeenCalledTimes(2);
  } finally {release();await personal.whenRecoveryIdle();}
  expect(lookup).toHaveBeenCalledTimes(32);expect(mail.sendVerificationCode).not.toHaveBeenCalled();
});
it('recovers a historical mixed-case email without accepting another identity',async()=>{
  buyer.account.email=buyer.account.email.toUpperCase();
  jest.spyOn(accounts,'findAccountByEmail').mockResolvedValue(buyer.account);
  await personal.forgot({email:buyer.account.email});await personal.whenRecoveryIdle();
  const code=mail.sendVerificationCode.mock.calls[0][1];
  await expect(personal.reset({email:buyer.account.email.toLowerCase(),code,newPassword:'Nueva72!?'})).resolves.toBeUndefined();
  expect(sessions.revokeAll).toHaveBeenCalledWith({userId:buyer.account.id});
});
