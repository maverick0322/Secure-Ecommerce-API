'use strict';
const {verifyConnection,tables}=require('../../services/database.service');
function fixture(overrides={}){
 const server={db:'secure_ecommerce',account:'ecommerce_app@%',version:'8.0.46',uuid:'expected',mode:'STRICT_TRANS_TABLES',fks:1,...overrides};
 return {authenticate:jest.fn(),query:jest.fn().mockResolvedValueOnce([[server]]).mockResolvedValueOnce([tables.map(name=>({name}))])};
}
it('verifies server, account, schema, strict mode and final table set',async()=>{
 expect(await verifyConnection(fixture(),{uuid:'expected'})).toMatchObject({database:'secure_ecommerce',account:'ecommerce_app@%'});
});
it.each([{db:'mercadolibrenode'},{account:'root@localhost'},{version:'5.7.44'},{mode:''},{fks:0},{uuid:'other'}])('fails closed for incompatible identity %j',async identity=>{
 await expect(verifyConnection(fixture(identity),{uuid:'expected'})).rejects.toThrow('verification failed');
});
it('rejects unexpected or missing tables and propagates connection failure',async()=>{
 const db=fixture();db.query.mockReset().mockResolvedValueOnce([[{db:'secure_ecommerce',account:'ecommerce_app@%',version:'8.0.46',uuid:'expected',mode:'STRICT_TRANS_TABLES',fks:1}]]).mockResolvedValueOnce([[{name:'roles'}]]);
 await expect(verifyConnection(db)).rejects.toThrow('14 business tables');
 const failed=fixture();failed.authenticate.mockRejectedValue(new Error('offline'));await expect(verifyConnection(failed)).rejects.toThrow('offline');
});
