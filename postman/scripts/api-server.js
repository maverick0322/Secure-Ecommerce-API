'use strict';
// Test-only launcher. Never imported by index.js and never deployed as the API.
const path=require('node:path');
const crypto=require('node:crypto');
const {ensure,assertIdentity,identitySql,protectedUuid}=require('./isolation');
let models,server,isolatedAuth,closing=false;
function fail(){if(process.send)process.send({type:'failed',code:'ISOLATED_API_FAILURE'});void close(1);}
async function close(code=0){
  if(closing)return;closing=true;
  const timeout=setTimeout(()=>process.exit(1),6000);timeout.unref();
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});
  if(isolatedAuth)try{await isolatedAuth.close();}catch{code=1;}
  if(models)try{await models.sequelize.close();}catch{}
  process.exit(code);
}
async function main(){
  ensure(process.env.NODE_ENV==='test'&&process.env.POSTMAN_ISOLATED==='1'&&typeof process.send==='function','NOT_A_TEST_CHILD');
  const fixture=JSON.parse(process.env.POSTMAN_FIXTURE_DESCRIPTOR);
  const workspace=process.env.POSTMAN_WORKSPACE;
  ensure(path.resolve(workspace)===process.cwd()&&workspace.includes(path.sep+'postman'+path.sep+'reports'+path.sep),'UNSAFE_WORKSPACE');
  const port=Number(process.env.POSTMAN_API_PORT);
  ensure(Number.isInteger(port)&&port>=3001&&port<=3099,'PROTECTED_API_PORT');
  ensure(/^secure_ecommerce_postman_[a-f0-9]{32}$/.test(fixture.database)&&fixture.uuid!==protectedUuid,'PROTECTED_DATABASE');
  ensure(Number(process.env.TEST_DB_PORT)===fixture.port&&fixture.port!==3307&&process.env.TEST_DB_DATABASE===fixture.database,'UNSAFE_DB_CONFIGURATION');
  const key=process.env.POSTMAN_ISOLATION_KEY;
  ensure(/^[a-f0-9]{64}$/.test(key),'MISSING_TEST_CAPABILITY');
  models=require(path.join(workspace,'models'));
  models.sequelize.addHook('beforeConnect',config=>{
    ensure(config.host==='127.0.0.1'&&Number(config.port)===fixture.port&&config.database===fixture.database&&config.username==='ecommerce_app','CONNECTION_BARRIER');
  });
  models.sequelize.addHook('afterConnect',connection=>new Promise((resolve,reject)=>{
    connection.query(identitySql,(error,rows)=>{
      if(error)return reject(new Error('CONNECTION_IDENTITY_FAILED'));
      try{assertIdentity(rows[0],fixture,{account:'ecommerce_app'});resolve();}catch{reject(new Error('CONNECTION_UUID_BARRIER'));}
    });
  }));
  async function databaseBarrier(){
    const [[row]]=await models.sequelize.query(identitySql);assertIdentity(row,fixture,{account:'ecommerce_app'});
    return row;
  }
  await databaseBarrier();
  const [tables]=await models.sequelize.query('SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const expected=Object.values(models.sequelize.models).map(m=>m.tableName).sort();
  ensure(expected.length===14&&JSON.stringify(tables.map(t=>t.n).sort())===JSON.stringify(expected),'SCHEMA_BARRIER');
  const mailbox=new Map();
  const mail=require(path.join(workspace,'services/registration-email.service'));
  mail.sendVerificationCode=async(email,code)=>{mailbox.set(email,code);};
  const remote=new Map();const cloud=require(path.join(workspace,'services/cloudinary.service'));
  cloud.credentials=()=>({});
  cloud.upload=async(buffer,publicId,productId)=>{
    remote.set(publicId,{context:{custom:{catalog_owner:'secure-ecommerce-api',product_id:String(productId)}}});
    return {public_id:publicId,format:'png'};
  };
  cloud.inspect=async id=>remote.get(id)||null;
  cloud.destroy=async id=>{remote.delete(id);};
  cloud.deliveryUrl=id=>id?'https://example.invalid/postman-images/'+encodeURIComponent(id):null;
  const accounts=require(path.join(workspace,'services/accounts.service'));
  const fixtures=JSON.parse(process.env.POSTMAN_FIXTURE_ACCOUNTS);
  const ids={};
  for(const [name,value]of Object.entries(fixtures)){
    await databaseBarrier();
    const created=await accounts.createPublicAccount({email:value.email,password:value.password,name:'Postman '+name,
      profile:name.startsWith('seller')?'SELLER':'BUYER',storeName:'Postman synthetic shop'},{ipAddress:'127.0.0.1'});
    ids[name]={id:created.id,email:created.email};
  }
  const express=require(path.join(workspace,'node_modules/express'));
  const app=express();app.disable('x-powered-by');
  app.use(async(req,res,next)=>{
    const supplied=req.get('X-Postman-Isolation-Key')||'';
    if(!/^[a-f0-9]{64}$/.test(supplied)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(key))||
      req.get('host')!=='127.0.0.1:'+port||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){
      return res.status(403).json({message:'Isolated test capability required.'});
    }
    try{await databaseBarrier();res.set('X-Postman-Test-Run',fixture.runId);return next();}
    catch{return res.status(503).json({message:'Isolation barrier rejected this connection.'});}
  });
  app.get('/__postman/isolation',(req,res)=>res.json({isolated:true,runId:fixture.runId,
    database:fixture.database,serverUuid:fixture.uuid,storage:'tmpfs',email:'memory',cloudinary:'memory'}));
  app.get('/__postman/mailbox',(req,res)=>{
    if(typeof req.query.email!=='string'||!req.query.email.endsWith('@example.invalid'))return res.status(400).json({message:'Synthetic address required.'});
    const code=mailbox.get(req.query.email);return code?res.json({code}):res.status(404).json({message:'No test message.'});
  });
  isolatedAuth=await require('../../tests/support/isolated-auth').start({applicationRoot:workspace});
  app.use(require(path.join(workspace,'index.js')));
  require(path.join(workspace,'services/product-images.service')).startRecovery();
  server=app.listen(port,'127.0.0.1',()=>process.send({type:'ready',accounts:ids}));
  server.on('error',fail);
}
process.on('disconnect',()=>{void close();});
process.on('SIGTERM',()=>{void close();});
process.on('SIGINT',()=>{void close();});
process.on('uncaughtException',fail);
process.on('unhandledRejection',fail);
main().catch(fail);
