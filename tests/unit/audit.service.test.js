'use strict';
const audit=require('../../services/audit.service');
const {AuditLog}=require('../../models');
afterEach(()=>jest.restoreAllMocks());
it('keeps only bounded structured metadata and excludes all credentials',()=>{
  expect(audit.sanitize({password:'secret',jwt:'secret',code:'123456',status:'PENDING',quantity:2,checkoutId:'x-y'}))
    .toEqual({status:'PENDING',quantity:2,checkoutId:'x-y'});
  expect(audit.sanitize(null)).toBeNull(); expect(audit.sanitize([])).toBeNull();
  expect(audit.sanitize({status:'x'.repeat(65),quantity:Infinity})).toBeNull();
});
it('writes only the final schema with a verified actor identifier and sanitized IP',async()=>{
  const write=jest.spyOn(AuditLog,'create').mockResolvedValue({});
  await audit.write({actorUserId:'00000000-0000-4000-8000-000000000001',action:'cart.add',targetId:1,ipAddress:'::1'});
  expect(write).toHaveBeenCalledWith(expect.objectContaining({actorUserId:'00000000-0000-4000-8000-000000000001',targetId:'1',ipAddress:'::1',outcome:'SUCCESS',occurredAt:expect.any(Date)}),{});
  expect(AuditLog.options.timestamps).toBe(false);
  expect(()=>audit.write({action:'invalid action'})).toThrow();
});
it('validates pagination, never reads details, and reports missing SQL SELECT safely',async()=>{
  const read=jest.spyOn(AuditLog,'findAll').mockResolvedValue([]);
  await audit.list({limit:'2',before:'10'});
  expect(read).toHaveBeenCalledWith(expect.objectContaining({limit:2,attributes:expect.not.arrayContaining(['details'])}));
  for(const query of [{limit:'0'},{limit:'101'},{before:'x'},{before:'2147483648'},{secret:'x'}]) await expect(audit.list(query)).rejects.toMatchObject({status:400});
  read.mockRejectedValue({original:{errno:1143}});
  await expect(audit.list()).rejects.toMatchObject({status:503});
  read.mockRejectedValue(new Error('offline')); await expect(audit.list()).rejects.toThrow('offline');
});
it('blocks ORM updates and deletes, including bulk operations',()=>{
  for(const name of ['beforeUpdate','beforeBulkUpdate','beforeDestroy','beforeBulkDestroy']) expect(()=>AuditLog.options.hooks[name][0]()).toThrow('append-only');
});
it('requires an explicit business transaction and never logs an arbitrary context',async()=>{
  expect(()=>audit.business('actor','action','target','1')).toThrow('transaction');
  const write=jest.spyOn(audit,'write').mockResolvedValue({});const transaction={};
  await audit.business('actor','action','target','1',transaction,{ipAddress:'127.0.0.1',password:'synthetic'});
  expect(write).toHaveBeenCalledWith({actorUserId:'actor',action:'action',targetType:'target',targetId:'1',ipAddress:'127.0.0.1',details:undefined},{transaction});
});
