const request=require('supertest');
const app=require('../../index');
const models=require('../../models');
const {tokenFor,mockAccountLookups}=require('../support/auth-fixtures');
const admin=tokenFor('ADMIN'); beforeEach(mockAccountLookups); afterEach(()=>jest.restoreAllMocks());
it('retires public binary reads without reading historical storage',async()=>{
 const query=jest.spyOn(models.sequelize,'query');
 expect((await request(app).get('/api/files/1')).status).toBe(410);expect(query).not.toHaveBeenCalled();
});
it.each(['post','put','delete'])('retires historical %s without database access',async method=>{
 const query=jest.spyOn(models.sequelize,'query');
 const result=await request(app)[method](method==='post'?'/api/files':'/api/files/1').set('Authorization','Bearer '+admin.token);
 expect(result.status).toBe(410);expect(query).not.toHaveBeenCalled();
});
it('does not register File in Sequelize',()=>{expect(models.File).toBeUndefined();expect(models.sequelize.models.File).toBeUndefined();});
