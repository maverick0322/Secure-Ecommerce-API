'use strict';
const db=require('../../models');
const accounts=require('../../services/accounts.service');
const audit=require('../../services/audit.service');
const {randomUUID}=require('node:crypto');
const actor=randomUUID(), sellerId=randomUUID();
const tx={LOCK:{UPDATE:'UPDATE'}};
function fixture(status='APPROVED'){
  const seller={status,update:jest.fn()};
  jest.spyOn(db.sequelize,'transaction').mockImplementation(work=>work(tx));
  jest.spyOn(db.User,'findByPk').mockResolvedValue({id:actor,status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Admin,'findByPk').mockResolvedValue({userId:actor});
  jest.spyOn(db.Seller,'findByPk').mockResolvedValue(seller);
  jest.spyOn(audit,'write').mockResolvedValue({});
  return seller;
}
afterEach(()=>jest.restoreAllMocks());
it('suspends with locked actor/account/profile and an event in the same transaction',async()=>{
  const seller=fixture();const result=await accounts.suspendSeller(actor,sellerId,'Incumplimiento de condiciones',{ipAddress:'127.0.0.1'});
  expect(result.status).toBe('SUSPENDED');
  expect(db.User.findByPk).toHaveBeenCalledWith(sellerId,{transaction:tx,lock:'UPDATE'});
  expect(db.Seller.findByPk).toHaveBeenCalledWith(sellerId,{transaction:tx,lock:'UPDATE'});
  expect(seller.update).toHaveBeenCalledWith({status:'SUSPENDED',reviewedAt:expect.any(Date),reviewedByUserId:actor},{transaction:tx});
  expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({actorUserId:actor,action:'seller.suspended',
    details:expect.objectContaining({reason:'Incumplimiento de condiciones',previousStatus:'APPROVED'})}),{transaction:tx});
});
it.each(['PENDING','REJECTED','SUSPENDED'])('rejects suspension from %s before any write',async status=>{
  const seller=fixture(status);await expect(accounts.suspendSeller(actor,sellerId,'Policy')).rejects.toMatchObject({status:409});
  expect(seller.update).not.toHaveBeenCalled();expect(audit.write).not.toHaveBeenCalled();
});
it.each(['',null,'x'.repeat(256),'line\nbreak'])('rejects invalid reasons %#',reason=>{
  expect(()=>accounts.suspendSeller(actor,sellerId,reason)).toThrow();
});
it('rejects missing sellers, revoked admins and suspended actors',async()=>{
  fixture();db.Seller.findByPk.mockResolvedValue(null);
  await expect(accounts.suspendSeller(actor,sellerId,'Policy')).rejects.toMatchObject({status:404});
  db.Admin.findByPk.mockResolvedValue(null);
  await expect(accounts.suspendSeller(actor,sellerId,'Policy')).rejects.toMatchObject({status:403});
  db.User.findByPk.mockResolvedValue({status:'SUSPENDED'});
  await expect(accounts.suspendSeller(actor,sellerId,'Policy')).rejects.toMatchObject({status:403});
});
it('propagates audit failure to the transaction manager instead of confirming suspension',async()=>{
  fixture();audit.write.mockRejectedValue(new Error('synthetic audit failure'));
  await expect(accounts.suspendSeller(actor,sellerId,'Policy')).rejects.toThrow('synthetic audit failure');
});
it('sanitizes sensitive-looking material in a suspension reason',()=>{
  const result=audit.sanitize({reason:'Policy password=synthetic-value admin@example.invalid '+'x'.repeat(40)});
  expect(result.reason).not.toContain('synthetic-value');expect(result.reason).not.toContain('@');
  expect(result.reason).not.toContain('x'.repeat(40));
});

it('validates account changes before hashing or entering a transaction',async()=>{
  fixture();
  for(const body of [null,[],{}, {profile:'ADMIN'}, {status:'INVALID'}, {name:''}, {password:'Password123456!'}]){
    await expect(accounts.updateAccount(actor,'target@example.invalid',body)).rejects.toMatchObject({status:400});
  }
  expect(db.sequelize.transaction).not.toHaveBeenCalled();
});
it('rejects edits or deletion of other administrators and hides missing targets',async()=>{
  fixture();const row={id:sellerId,update:jest.fn(),destroy:jest.fn()};
  jest.spyOn(db.User,'findOne').mockResolvedValue(row);
  await expect(accounts.updateAccount(actor,'admin@example.invalid',{name:'Changed'})).rejects.toMatchObject({status:403});
  await expect(accounts.removeAccount(actor,'admin@example.invalid')).rejects.toMatchObject({status:403});
  expect(row.update).not.toHaveBeenCalled();expect(row.destroy).not.toHaveBeenCalled();
  db.User.findOne.mockResolvedValue(null);
  await expect(accounts.removeAccount(actor,'missing@example.invalid')).rejects.toMatchObject({status:404});
});
it('allows a safe self edit but refuses to suspend the administrator itself',async()=>{
  fixture();const row={id:actor,status:'ACTIVE',update:jest.fn()};jest.spyOn(db.User,'findOne').mockResolvedValue(row);
  await accounts.updateAccount(actor,'admin@example.invalid',{name:'Updated admin',status:'ACTIVE'});
  expect(row.update).toHaveBeenCalledWith({name:'Updated admin',status:'ACTIVE'},{transaction:tx});
  await expect(accounts.updateAccount(actor,'admin@example.invalid',{status:'DISABLED'})).rejects.toMatchObject({status:403});
});
