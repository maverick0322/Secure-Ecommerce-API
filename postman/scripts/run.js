'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {fork}=require('node:child_process');
const iso=require('./isolation');
const postmanRoot=path.resolve(__dirname,'..');
const reports=path.join(postmanRoot,'reports');
const accountNames=['admin','buyer','buyerOther','seller','sellerOther'];
function publicFixture(f){return {runId:f.runId,name:f.name,containerId:f.containerId,database:f.database,
  uuid:f.uuid,port:f.port,deniedUuids:f.deniedUuids,protectedContainerId:f.protectedContainerId};}
function makeAccounts(runId){return Object.fromEntries(accountNames.map(name=>[name,{
  id:crypto.randomUUID(),email:name.toLowerCase()+'-'+runId+'@example.invalid',password:crypto.randomBytes(24).toString('base64url')
}]));}
async function freePort(port){
  await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Object.assign(new Error('API_PORT_BUSY'),{safe:true})));
    server.listen(port,'127.0.0.1',()=>server.close(resolve));});
}
function workspaceCopy(directory){
  const workspace=path.join(directory,'workspace');fs.mkdirSync(workspace,{recursive:true});
  const hash=crypto.createHash('sha256');
  for(const folder of ['controllers','middlewares','models','routes','services','validators','config']){
    fs.mkdirSync(path.join(workspace,folder));
    const names=folder==='config'?['config.js','claim-types.js']:fs.readdirSync(path.join(iso.root,folder)).filter(n=>n.endsWith('.js'));
    for(const name of names){const relative=path.join(folder,name);const data=fs.readFileSync(path.join(iso.root,relative));
      fs.writeFileSync(path.join(workspace,relative),data);hash.update(relative);hash.update(data);}
  }
  for(const name of ['index.js','package.json','swagger-output.json'])if(fs.existsSync(path.join(iso.root,name))){
    const data=fs.readFileSync(path.join(iso.root,name));fs.writeFileSync(path.join(workspace,name),data);hash.update(name);hash.update(data);
  }
  // Exact installed backend dependencies; no copied .env or mutable dependency tree.
  fs.symlinkSync(path.join(iso.root,'node_modules'),path.join(workspace,'node_modules'),process.platform==='win32'?'junction':'dir');
  return {workspace,sourceDigest:hash.digest('hex')};
}
function childEnvironment(fixture,accounts,key,workspace,port){
  const env={};for(const name of ['PATH','Path','SystemRoot','WINDIR','ComSpec','PATHEXT','TEMP','TMP','HOME','USERPROFILE']){
    if(process.env[name])env[name]=process.env[name];
  }
  return {...env,NODE_ENV:'test',POSTMAN_ISOLATED:'1',POSTMAN_WORKSPACE:workspace,POSTMAN_API_PORT:String(port),
    TEST_DB_HOST:'127.0.0.1',TEST_DB_PORT:String(fixture.port),TEST_DB_DATABASE:fixture.database,
    TEST_DB_USER:'ecommerce_app',TEST_DB_PASSWORD:fixture.appPassword,JWT_SECRET:crypto.randomBytes(48).toString('hex'),
    POSTMAN_ISOLATION_KEY:key,POSTMAN_FIXTURE_DESCRIPTOR:JSON.stringify(publicFixture(fixture)),
    POSTMAN_FIXTURE_ACCOUNTS:JSON.stringify(Object.fromEntries(Object.entries(accounts).filter(([name])=>name!=='admin'))),
    CLOUDINARY_CLEANUP_DIR:path.join(workspace,'log/cloudinary')};
}
async function startApi(fixture,accounts,key,workspace,port){
  const child=fork(path.join(__dirname,'api-server.js'),[],{cwd:workspace,env:childEnvironment(fixture,accounts,key,workspace,port),
    stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  try{
    const seeded=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Object.assign(new Error('ISOLATED_API_START_TIMEOUT'),{safe:true})),30000);
      child.once('error',()=>{clearTimeout(timeout);reject(Object.assign(new Error('ISOLATED_API_START_FAILED'),{safe:true}));});
      child.once('exit',()=>{clearTimeout(timeout);reject(Object.assign(new Error('ISOLATED_API_EXITED'),{safe:true}));});
      child.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);resolve(message.accounts);}
        if(message.type==='failed'){clearTimeout(timeout);reject(Object.assign(new Error('ISOLATED_API_GUARD_OR_START_FAILED'),{safe:true}));}});
    });return {child,seeded};
  }catch(error){if(child.exitCode===null)child.kill('SIGTERM');throw error;}
}
function environmentFor(fixture,accounts,key,port){
  const values={baseUrl:'http://127.0.0.1:'+port,apiPort:String(port),isolationRunId:fixture.runId,
    expectedDatabase:fixture.database,expectedServerUuid:fixture.uuid,isolationKey:key,
    imageFile:'scripts/fixtures/product.png',registrationEmail:'registered-'+fixture.runId+'@example.invalid',
    registrationPassword:crypto.randomBytes(24).toString('base64url'),unknownEmail:'absent-'+fixture.runId+'@example.invalid',
    wrongPassword:crypto.randomBytes(24).toString('base64url')};
  for(const [name,a]of Object.entries(accounts)){values[name+'Email']=a.email;values[name+'Password']=a.password;}
  return {id:fixture.runId,name:'LOCAL PRIVATE - '+fixture.runId,_postman_variable_scope:'environment',values:Object.entries(values).map(([key,value])=>({
    key,value,type:/Password$|isolationKey/.test(key)?'secret':'default',enabled:true}))};
}
async function runCollection(environment){
  // No proxy inheritance or cloud runner. Never emit Newman's raw request/response report.
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
  const runtime=require('./newman-runtime');
  const collection=JSON.parse(fs.readFileSync(path.join(postmanRoot,'collections/secure-ecommerce.postman_collection.json')));
  runtime.validateCollection(collection);const newman=runtime.load();
  return new Promise((resolve,reject)=>newman.run({
    collection,
    environment,workingDir:postmanRoot,reporters:[],silent:true,ignoreRedirects:true,
    timeoutRequest:10000,timeoutScript:15000,timeout:240000,bail:true
  },(error,summary)=>{
    if(error)return reject(Object.assign(new Error('NEWMAN_EXECUTION_FAILED'),{safe:true}));
    const failures=summary.run.failures.map(f=>({request:f.source?.name||'collection',test:f.error?.test||f.error?.name||'execution failure'}));
    const executions=summary.run.executions.map(e=>({name:e.item.name,status:e.response?.code||null,
      assertions:(e.assertions||[]).map(a=>({name:a.assertion,passed:!a.error}))}));
    resolve({requests:summary.run.stats.requests,assertions:summary.run.stats.assertions,failures,executions});
  }));
}
async function postconditions(fixture){
  await iso.verify(fixture,fixture.connection);
  const [[orders]]=await fixture.connection.query('SELECT COUNT(*) n FROM orders');
  const [[items]]=await fixture.connection.query('SELECT COUNT(*) n FROM order_items');
  const [[lines]]=await fixture.connection.query('SELECT COUNT(*) n FROM cart_items');
  const [[defaults]]=await fixture.connection.query('SELECT COUNT(*) n FROM user_addresses WHERE isDefault=1 AND deletedAt IS NULL');
  iso.ensure(orders.n===2&&items.n===2&&lines.n===2&&defaults.n===1,'PERSISTENCE_ASSERTION_FAILED');
  const [products]=await fixture.connection.query('SELECT stock FROM products ORDER BY id');
  iso.ensure(products.length===2&&products[0].stock===8&&products[1].stock===19,'INVENTORY_OR_IDEMPOTENCY_FAILED');
  const mysql=iso.appRequire('mysql2/promise');const app=await mysql.createConnection({host:'127.0.0.1',port:fixture.port,
    user:'ecommerce_app',password:fixture.appPassword,database:fixture.database});
  try{
    const [[identity]]=await app.query(iso.identitySql);iso.assertIdentity(identity,fixture,{account:'ecommerce_app'});
    for(const query of ["DELETE FROM audit_logs WHERE 1=0","UPDATE audit_logs SET outcome='ERROR' WHERE 1=0",
      'UPDATE order_items SET unitPrice=0 WHERE 1=0','UPDATE orders SET total=0 WHERE 1=0',
      "UPDATE order_status_history SET reason='forbidden' WHERE 1=0",'SELECT details FROM audit_logs LIMIT 1']){
      let denied=false;try{await app.query(query);}catch(error){denied=[1142,1143].includes(error.errno);}
      iso.ensure(denied,'SQL_MINIMUM_PRIVILEGE_ASSERTION_FAILED');
    }
  }finally{await app.end();}
  return {orders:orders.n,orderItems:items.n,uniqueCartLines:lines.n,activeDefaults:defaults.n,stock:[8,19],minimumPrivileges:true};
}
async function stopApi(child){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');},7000);timer.unref();
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
}
async function runOnce({port=3001,serve=false}={}){
  iso.ensure(Number.isInteger(port)&&port>=3001&&port<=3099,'INVALID_TEST_API_PORT');await freePort(port);
  const runId=crypto.randomUUID();const directory=path.join(reports,runId);fs.mkdirSync(directory,{recursive:true});
  let fixture,protectedInfo,child,workspace,privateFile,interrupted=false;
  let release;const signal=new Promise(resolve=>{release=resolve;});
  const onSignal=()=>{interrupted=true;release();};process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  const state={runId,parentPid:process.pid,apiPort:port,name:'secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12),status:'starting'};
  const stateFile=path.join(directory,'state.json');const saveState=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');saveState();
  const report={runId,startedAt:new Date().toISOString(),mode:serve?'manual':'newman',providers:{email:'in-memory',cloudinary:'simulated, not a live provider test'},success:false};
  try{
    console.log('Preparing isolated Postman run '+runId);
    try{({fixture,protectedInfo}=await iso.create(runId));}catch(error){fixture=error.fixture;protectedInfo=error.protectedInfo;throw error;}
    Object.assign(state,publicFixture(fixture));saveState();
    state.status='provisioning';saveState();
    const accounts=makeAccounts(runId);await iso.provision(fixture,accounts.admin);
    state.status='copying-public-backend';saveState();
    const copy=workspaceCopy(directory);workspace=copy.workspace;report.backendSourceSha256=copy.sourceDigest;
    iso.ensure(!interrupted,'RUN_INTERRUPTED');await iso.verify(fixture,fixture.connection);
    const key=crypto.randomBytes(32).toString('hex');const started=await startApi(fixture,accounts,key,workspace,port);child=started.child;
    for(const [name,seed]of Object.entries(started.seeded))accounts[name].id=seed.id;
    const environment=environmentFor(fixture,accounts,key,port);
    privateFile=path.join(directory,'private.postman_environment.json');fs.writeFileSync(privateFile,JSON.stringify(environment,null,2)+'\n',{flag:'wx',mode:0o600});
    Object.assign(state,{status:'ready',apiPid:child.pid});saveState();
    report.instance=publicFixture(fixture);report.apiPort=port;report.isolationVerifiedBeforeWrites=true;
    if(serve){
      console.log('Isolated API ready at http://127.0.0.1:'+port);
      console.log('Import the private local environment: '+path.relative(iso.root,privateFile));
      console.log('Use Collection Runner once, then Ctrl+C. Restart --serve for a fresh run.');
      await signal;report.success=true;report.collectionExecution='Manual results are not automatically certified by this process.';
    }else{
      state.status='newman';saveState();report.newman=await runCollection(environment);
      iso.ensure(report.newman.failures.length===0&&report.newman.assertions.failed===0,'COLLECTION_ASSERTIONS_FAILED');
      report.persistence=await postconditions(fixture);report.success=true;
    }
  }catch(error){report.failure={stage:state.status,code:error.safe?error.message:'ISOLATED_RUN_FAILED',
    kind:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'controlled failure'};}
  finally{
    try{
      await stopApi(child);
      if(fixture?.connection)await fixture.connection.end();
      iso.destroy(fixture);
      if(privateFile&&fs.existsSync(privateFile))fs.unlinkSync(privateFile);
      if(workspace){const link=path.join(workspace,'node_modules');
        if(fs.existsSync(link)){iso.ensure(fs.lstatSync(link).isSymbolicLink(),'UNEXPECTED_DEPENDENCY_LINK');fs.unlinkSync(link);}}
      report.cleanup=true;state.status='cleaned';
    }catch{report.cleanup=false;report.success=false;report.cleanupFailure='Cleanup refused or failed; use scripts/cleanup.js after inspecting state.';state.status='cleanup-required';}
    try{report.habitualContainerMetadataComparison=require('./container-metadata').compare(protectedInfo,iso.protectedSnapshot());
      report.habitualContainerMetadataUnchanged=report.habitualContainerMetadataComparison.unchanged;
      if(!report.habitualContainerMetadataUnchanged)report.success=false;
    }catch{report.habitualContainerMetadataUnchanged=false;report.habitualContainerMetadataComparison={error:'METADATA_INSPECTION_FAILED'};report.success=false;}
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
    report.finishedAt=new Date().toISOString();saveState();
    fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(report,null,2)+'\n');
    const stats=report.newman?.assertions;
    fs.writeFileSync(path.join(directory,'summary.md'),`# Isolated Postman run\n\nRun: ${runId}\n\nResult: ${report.success?'PASS':'FAIL'}\n\nAssertions: ${stats?.total??'manual'}; failed: ${stats?.failed??'not certified'}\n\nCleanup: ${report.cleanup}\n\nEmail/Cloudinary: simulated; HTTP/MySQL: real.\n`);
    console.log((report.success?'PASS':'FAIL')+' Postman run '+runId+'; report: '+path.relative(iso.root,path.join(directory,'summary.json')));
  }
  return report;
}
async function main(){
  const args=process.argv.slice(2);let port=3001,repeat=1,serve=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--port')port=Number(args[++i]);else if(args[i]==='--repeat')repeat=Number(args[++i]);
    else if(args[i]==='--serve')serve=true;else iso.ensure(false,'UNKNOWN_ARGUMENT');
  }
  iso.ensure(Number.isInteger(repeat)&&repeat>=1&&repeat<=10&&(!serve||repeat===1),'INVALID_REPEAT_COUNT');
  const summaries=[];for(let n=0;n<repeat;n++){const result=await runOnce({port,serve});summaries.push({runId:result.runId,success:result.success,cleanup:result.cleanup});if(!result.success)break;}
  fs.writeFileSync(path.join(reports,'latest.json'),JSON.stringify({verifiedAt:new Date().toISOString(),runs:summaries},null,2)+'\n');
  if(summaries.length!==repeat||summaries.some(r=>!r.success))process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error('Postman infrastructure stopped safely. Inspect the sanitized report and prerequisites.');process.exitCode=1;});
module.exports={runOnce,runCollection};
