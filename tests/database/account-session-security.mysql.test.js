'use strict';
const crypto=require('node:crypto');
const request=require('supertest');
const mysql=require('mysql2/promise');
const {createClient}=require('redis');
const isolated=process.env.STAGE3A_MYSQL_UUID?describe:describe.skip;
isolated('Account session security with isolated MySQL and Redis',()=>{
  jest.setTimeout(60000);
  let app,models,accounts,auth,db,reader,adminHeader;
  const password=crypto.randomBytes(24).toString('base64url');
  beforeAll(async()=>{
    const port=Number(process.env.STAGE3A_TEST_PORT);
    expect(Number.isInteger(port)&&port>1024&&port!==3307).toBe(true);
    expect(process.env.STAGE3A_MYSQL_UUID===require('../../postman/scripts/isolation').protectedUuid).toBe(false);
    const config={host:'127.0.0.1',port,database:'secure_ecommerce_3a_test',user:'ecommerce_app',password:process.env.STAGE3A_TEST_PASSWORD};
    db=await mysql.createConnection(config);
    const [[identity]]=await db.query('SELECT @@server_uuid uuid,@@hostname host,DATABASE() db,CURRENT_USER() account');
    expect(identity).toEqual({uuid:process.env.STAGE3A_MYSQL_UUID,host:process.env.STAGE3A_TEST_HOSTNAME,
      db:config.database,account:'ecommerce_app@%'});
    Object.assign(process.env,{NODE_ENV:'test',TEST_DB_HOST:config.host,TEST_DB_PORT:String(port),TEST_DB_DATABASE:config.database,
      TEST_DB_USER:config.user,TEST_DB_PASSWORD:config.password,JWT_SECRET:require('../support/signing-secret')});
    app=require('../../index');models=require('../../models');accounts=require('../../services/accounts.service');
    auth=await require('../support/isolated-auth').start();
    const c=auth.config;
    reader=createClient({username:c.username,password:c.password,disableOfflineQueue:true,disableClientInfo:true,
      maintNotifications:'disabled',commandOptions:{timeout:1000},socket:{host:c.host,port:c.port,reconnectStrategy:false,connectTimeout:1000}});
    reader.on('error',()=>{});await reader.connect();
    const info=await reader.sendCommand(['INFO','server']);
    expect(info.includes('run_id:'+c.expectedRunId)).toBe(true);
    adminHeader='Bearer '+await auth.issue(await accounts.findAccountByEmail('admin@example.invalid'));
  });
  afterAll(async()=>{
    if(reader?.isOpen)reader.destroy();if(auth)await auth.close();if(models)await models.sequelize.close();if(db)await db.end();
  });
  const create=profile=>accounts.createPublicAccount({email:crypto.randomUUID()+'@example.invalid',name:'Session security fixture',
    password,profile,storeName:'Isolated store'});
  const login=user=>request(app).post('/api/auth').send({email:user.email,password});
  const access=jwt=>request(app).get('/api/auth/time').set('Authorization','Bearer '+jwt);
  const update=(user,status)=>request(app).put('/api/users/'+user.email).set('Authorization',adminHeader).send({status});
  async function record(jwt){
    const key=`${auth.config.namespace}:{${auth.config.generation}}:session:${auth.tokens.verify(jwt).sid}`;
    return reader.sendCommand(['GET',key]);
  }
  it.each(['SUSPENDED','DISABLED'])('never restores earlier sessions after %s and reactivation',async status=>{
    const user=await create('BUYER'),first=await login(user),second=await login(user);
    expect(first.status).toBe(200);expect(second.status).toBe(200);
    expect((await update(user,status)).status).toBe(204);
    expect((await access(first.body.jwt)).status).toBe(403);
    expect((await update(user,'ACTIVE')).status).toBe(204);
    expect((await access(first.body.jwt)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({refreshToken:second.body.refreshToken})).status).toBe(401);
    const fresh=await login(user);expect(fresh.status).toBe(200);expect((await access(fresh.body.jwt)).status).toBe(200);
  });
  it('does not resurrect deleted-account sessions even after a controlled fixture-only SQL restore',async()=>{
    const user=await create('BUYER'),first=await login(user),second=await login(user);
    expect(first.status).toBe(200);expect(second.status).toBe(200);
    expect((await request(app).delete('/api/users/'+user.email).set('Authorization',adminHeader)).status).toBe(204);
    // No restore endpoint is introduced. Only the verified disposable fixture is updated.
    await db.query('UPDATE users SET deletedAt=NULL WHERE id=?',[user.id]);
    expect((await access(first.body.jwt)).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({refreshToken:second.body.refreshToken})).status).toBe(401);
    expect((await login(user)).status).toBe(200);
  });
  it('leaves real Redis session metadata unchanged on profile denial and still detects revocation',async()=>{
    const user=await create('BUYER'),signed=await login(user);expect(signed.status).toBe(200);
    const before=await record(signed.body.jwt);
    expect((await request(app).get('/api/users').set('Authorization','Bearer '+signed.body.jwt)).status).toBe(403);
    expect((await record(signed.body.jwt))===before).toBe(true);
    await auth.sessions.revokeAll({userId:user.id});
    expect((await request(app).get('/api/users').set('Authorization','Bearer '+signed.body.jwt)).status).toBe(401);
  });
  it('leaves real Redis session metadata unchanged when seller approval denies commerce',async()=>{
    const user=await create('SELLER'),signed=await login(user);expect(signed.status).toBe(200);
    const before=await record(signed.body.jwt);
    expect((await request(app).post('/api/products').set('Authorization','Bearer '+signed.body.jwt).send({title:'Denied',price:'1.00'})).status).toBe(403);
    expect((await record(signed.body.jwt))===before).toBe(true);
  });
});
