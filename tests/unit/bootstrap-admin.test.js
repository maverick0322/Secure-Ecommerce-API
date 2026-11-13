'use strict';
const {createVerifiedAdmin}=require('../../scripts/database/bootstrap-admin');
it('creates user, profile and audit in a single transaction with bind replacements',async()=>{
 const transaction={};const connection={transaction:jest.fn(fn=>fn(transaction)),query:jest.fn()};
 const values={id:'synthetic-id',email:'admin@example.invalid',name:'Synthetic',passwordHash:'synthetic-hash',verifiedAt:new Date()};
 expect(await createVerifiedAdmin(connection,values)).toBe(values.id);expect(connection.query).toHaveBeenCalledTimes(3);
 for(const [sql,options]of connection.query.mock.calls){expect(sql).not.toContain(values.email);expect(sql).not.toContain(values.passwordHash);expect(options.transaction).toBe(transaction);expect(options.replacements).toEqual(values);}
});
it('propagates profile failure so the transaction manager rolls back the user insert',async()=>{
 const connection={transaction:fn=>fn({}),query:jest.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('profile denied'))};
 await expect(createVerifiedAdmin(connection,{id:'id'})).rejects.toThrow('profile denied');expect(connection.query).toHaveBeenCalledTimes(2);
});
