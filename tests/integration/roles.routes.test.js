const request=require('supertest');
const app=require('../../index');
const models=require('../../models');
const {tokenFor,mockAccountLookups}=require('../support/auth-fixtures');
const admin=tokenFor('ADMIN'),buyer=tokenFor('BUYER');
beforeEach(mockAccountLookups); afterEach(()=>jest.restoreAllMocks());
it('requires authentication',async()=>{expect((await request(app).get('/api/roles')).status).toBe(401);});
it('restricts the retired route to ADMIN',async()=>{expect((await request(app).get('/api/roles').set('Authorization','Bearer '+buyer.token)).status).toBe(403);});
it('retires role enumeration without querying a removed table',async()=>{
 const query=jest.spyOn(models.sequelize,'query');
 expect((await request(app).get('/api/roles').set('Authorization','Bearer '+admin.token)).status).toBe(410);
 expect(query).not.toHaveBeenCalled();
});
it('does not register Role in Sequelize',()=>{expect(models.Role).toBeUndefined();expect(models.sequelize.models.Role).toBeUndefined();});
