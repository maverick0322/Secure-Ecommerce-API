'use strict';
const { compareCodeUnits } = require('../../services/canonical-order');
const { inspectOwned: inspectRedisTest } = require('./redis-test-metadata');

const path=require('node:path');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..');
const appRequire=createRequire(path.join(root,'package.json'));
const protectedUuid='b68c7b62-dc02-11f1-b706-caca74da477e';
const protectedVolume='secure-ecommerce-api_mysql_data';
const ownerLabel='secure-ecommerce.test-suite';
const runLabel='secure-ecommerce.test-run';
function ensure(condition,code){if(!condition){const e=new Error(code);e.safe=true;throw e;}}
const dockerArgs=process.platform==='win32'?['--context','desktop-linux']:[];
// Fixed test-only script; the generated password is passed via the environment.
const redisTestStartup='umask 077\nprintf \'bind 0.0.0.0\\nport 6379\\nprotected-mode yes\\nsave ""\\nappendonly no\\nmaxmemory 64mb\\nmaxmemory-policy noeviction\\nlogfile /data/redis.log\\nunixsocket /data/redis.sock\\nunixsocketperm 700\\nrequirepass %s\\n\' "$REDIS_TEST_PASSWORD" > /data/redis.conf\nexec redis-server /data/redis.conf';
const redisTestInfo='export REDISCLI_AUTH="$REDIS_TEST_PASSWORD"; exec redis-cli -s /data/redis.sock INFO server';
function validateRedisDockerArgs(args){
  ensure(Array.isArray(args)&&args.every(a=>typeof a==='string'&&!a.includes('\0')),'INVALID_REDIS_DOCKER_ARGUMENTS');
  const id=value=>/^[a-f0-9]{64}$/.test(value);
  if(args[0]==='create'){
    const runId=args[8]?.slice('secure-ecommerce.redis-test='.length);validateRunId(runId);
    const name='secure-ecommerce-redis-test-'+runId.slice(0,8);
    ensure(JSON.stringify(args)===JSON.stringify(['create','--pull','never','--name',name,'--hostname',name,
      '--label','secure-ecommerce.redis-test='+runId,'--publish','127.0.0.1::6379','--tmpfs','/data:rw',
      '--env','REDIS_TEST_PASSWORD','--entrypoint','sh','redis:8.2','-c',redisTestStartup]),'INVALID_REDIS_CREATE');
  }else if(['start','restart'].includes(args[0]))ensure(args.length===2&&id(args[1]),'INVALID_REDIS_TARGET');
  else if(args[0]==='stop')ensure(args.length===4&&args[1]==='--time'&&args[2]==='5'&&id(args[3]),'INVALID_REDIS_TARGET');
  else ensure(args.length===5&&args[0]==='exec'&&id(args[1])&&args[2]==='sh'&&args[3]==='-c'&&args[4]===redisTestInfo,'INVALID_REDIS_EXEC');
}
function isRedisTestCommand(args){
  return Array.isArray(args)&&(['create','start','restart'].includes(args[0])||
    (args[0]==='exec'&&args[4]===redisTestInfo)||(args[0]==='stop'&&args[2]==='5'));
}
function validateRunId(runId){
  ensure(typeof runId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId),'INVALID_RUN_ID');
  return runId;
}
function validateDockerArgs(args){
  if(isRedisTestCommand(args)){validateRedisDockerArgs(args);return;}
  ensure(Array.isArray(args)&&args.every(a=>typeof a==='string'&&!/[\0\r\n]/.test(a)),'INVALID_DOCKER_ARGUMENTS');
  const id=value=>/^[a-f0-9]{64}$/.test(value);
  const equal=value=>JSON.stringify(args)===JSON.stringify(value);
  const socketCommand='export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names --execute="SELECT @@server_uuid"';
  if(args[0]==='inspect')ensure(args.length===2&&(id(args[1])||args[1]==='ecommerce_db'),'INVALID_INSPECT_TARGET');
  else if(args[0]==='context')ensure(equal(['context','inspect',...(process.platform==='win32'?['desktop-linux']:[])]),'INVALID_CONTEXT_ARGUMENTS');
  else if(args[0]==='stop')ensure(args.length===4&&args[1]==='--time'&&args[2]==='10'&&id(args[3]),'INVALID_STOP_TARGET');
  else if(args[0]==='rm')ensure(args.length===2&&id(args[1]),'INVALID_REMOVE_TARGET');
  else if(args[0]==='exec')ensure(args.length===5&&id(args[1])&&args[2]==='sh'&&args[3]==='-c'&&args[4]===socketCommand,'INVALID_EXEC_ARGUMENTS');
  else if(args[0]==='ps'){
    const runId=args[6]?.slice(('label='+runLabel+'=').length);validateRunId(runId);
    ensure(equal(['ps','--all','--no-trunc','--filter','label='+ownerLabel+'=postman','--filter','label='+runLabel+'='+runId,'--format','{{.ID}}']),'INVALID_LIST_ARGUMENTS');
  }else if(args[0]==='run'){
    const runId=args[11]?.slice((runLabel+'=').length);validateRunId(runId);
    const name='secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12);
    ensure(equal(['run','--detach','--pull','never','--name',name,'--hostname',name,
      '--label',ownerLabel+'=postman','--label',runLabel+'='+runId,'--publish','127.0.0.1::3306',
      '--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0']),'INVALID_RUN_ARGUMENTS');
  }else ensure(false,'FORBIDDEN_DOCKER_OPERATION');
}
function assertLocalContext(){
  const context=JSON.parse(docker(['context','inspect',...(process.platform==='win32'?['desktop-linux']:[])]))[0];
  ensure(/^(?:unix:|npipe:)/.test(context.Endpoints.docker.Host),'REMOTE_DOCKER_CONTEXT_FORBIDDEN');
}
function docker(args,{input,env={},allowMissing=false}={}){
  validateDockerArgs(args);
  ensure(!process.env.DOCKER_HOST||/^(?:unix:|npipe:)/.test(process.env.DOCKER_HOST),'REMOTE_DOCKER_HOST_FORBIDDEN');
  ensure(!Object.hasOwn(env,'DOCKER_HOST')&&!Object.hasOwn(env,'DOCKER_CONTEXT'),'DOCKER_ENDPOINT_OVERRIDE_FORBIDDEN');
  if(isRedisTestCommand(args)){
    assertLocalContext();
    if(args[0]!=='create'){
      const id=args[0]==='stop'?args[3]:args[1];
      const info=JSON.parse(docker(['inspect',id]))[0];
      const runId=info.Config?.Labels?.['secure-ecommerce.redis-test'];validateRunId(runId);
      // Reuse the runner's independent, complete ownership/port/mount barrier.
      inspectRedisTest(info,
        {id,name:'secure-ecommerce-redis-test-'+runId.slice(0,8),runId},!info.State?.Running);
    }
  }
  const result=spawnSync('docker',[...dockerArgs,...args],{encoding:'utf8',input,
    env:{...process.env,...env},shell:false,windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});
  if(allowMissing&&result.status!==0)return null;
  ensure(result.status===0,'DOCKER_OPERATION_FAILED');return result.stdout.trim();
}
function assertMetadata(info,fixture,{cleanup=false}={}){
  validateRunId(fixture.runId);
  ensure(fixture.name==='secure-ecommerce-postman-'+fixture.runId.replace(/-/g,'').slice(0,12),'CONTAINER_NAME_MISMATCH');
  ensure(fixture.database==='secure_ecommerce_postman_'+fixture.runId.replace(/-/g,''),'DATABASE_RUN_MISMATCH');
  ensure(/^[a-f0-9]{64}$/.test(fixture.containerId)&&info.Id===fixture.containerId,'CONTAINER_ID_MISMATCH');
  ensure(info.Name==='/'+fixture.name&&fixture.name.startsWith('secure-ecommerce-postman-'),'CONTAINER_NAME_MISMATCH');
  ensure(info.Config.Hostname===fixture.name,'CONTAINER_HOSTNAME_MISMATCH');
  ensure(info.Config.Labels?.[ownerLabel]==='postman'&&info.Config.Labels?.[runLabel]===fixture.runId,'CONTAINER_OWNER_MISMATCH');
  const tmpfs=info.HostConfig?.Tmpfs||{};
  const explicitTmpfs=info.Mounts.length===1&&info.Mounts[0].Type==='tmpfs'&&info.Mounts[0].Destination==='/var/lib/mysql';
  const legacyTmpfs=info.Mounts.length===0&&Object.keys(tmpfs).length===1&&tmpfs['/var/lib/mysql']==='rw';
  ensure((explicitTmpfs||legacyTmpfs)&&!(info.HostConfig?.Binds?.length)&&!(info.HostConfig?.Mounts?.some(m=>m.Type!=='tmpfs')),
    'PERSISTENT_OR_UNEXPECTED_MOUNT');
  ensure(!info.Mounts.some(m=>m.Name===protectedVolume),'PROTECTED_VOLUME');
  const ports=cleanup&&info.State?.Running===false?info.HostConfig.PortBindings['3306/tcp']:info.NetworkSettings.Ports['3306/tcp'];
  if(cleanup&&info.State?.Running===false&&ports?.[0]?.HostPort===''){
    ensure(ports.length===1&&ports[0].HostIp==='127.0.0.1','MYSQL_PORT_MISMATCH');
  }else{
  ensure(ports?.length===1&&ports[0].HostIp==='127.0.0.1'&&Number(ports[0].HostPort)===fixture.port,'MYSQL_PORT_MISMATCH');
  }
  ensure(Number.isInteger(fixture.port)&&fixture.port>1024&&fixture.port!==3307&&fixture.port!==3306,'PROTECTED_MYSQL_PORT');
  ensure(/^secure_ecommerce_postman_[a-f0-9]{32}$/.test(fixture.database),'PROTECTED_DATABASE');
  ensure(info.Id!==fixture.protectedContainerId,'PROTECTED_CONTAINER');
}
function assertIdentity(row,fixture,{account='root',unselected=false}={}){
  ensure(row.uuid===fixture.uuid&&row.uuid!==protectedUuid&&!fixture.deniedUuids?.includes(row.uuid),'SERVER_UUID_MISMATCH');
  ensure(row.host===fixture.name&&Number(row.port)===3306&&/^8\.0\./.test(row.version),'SERVER_IDENTITY_MISMATCH');
  ensure(row.db===fixture.database||(unselected&&row.db===null),'DATABASE_IDENTITY_MISMATCH');
  ensure(row.account.startsWith(account+'@'),'SQL_ACCOUNT_MISMATCH');
  ensure(/STRICT_(TRANS|ALL)_TABLES/.test(row.mode)&&Number(row.fks)===1,'UNSAFE_SQL_SESSION');
}
const identitySql=`SELECT @@server_uuid uuid,@@hostname host,@@port port,VERSION() version,
  DATABASE() db,CURRENT_USER() account,@@session.sql_mode mode,@@session.foreign_key_checks fks`;
function protectedSnapshot(){
  const raw=docker(['inspect','ecommerce_db'],{allowMissing:true});if(!raw)return null;
  const [c]=JSON.parse(raw);
  return {id:c.Id,image:c.Image,startedAt:c.State.StartedAt,
    mounts:c.Mounts.map(m=>({type:m.Type,name:m.Name,source:m.Source,destination:m.Destination})),
    ports:c.HostConfig.PortBindings};
}
async function verify(fixture,connection,{unselected=false}={}){
  const info=JSON.parse(docker(['inspect',fixture.containerId]))[0];assertMetadata(info,fixture);
  const socketUuid=docker(['exec',fixture.containerId,'sh','-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names --execute="SELECT @@server_uuid"']);
  ensure(socketUuid===fixture.uuid&&socketUuid!==protectedUuid,'SOCKET_UUID_MISMATCH');
  const [[row]]=await connection.query(identitySql);assertIdentity(row,fixture,{unselected});
  const [usual]=await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('secure_ecommerce','mercadolibrenode')");
  ensure(usual.length===0,'HABITUAL_DATABASE_ON_TEST_SERVER');
}
async function create(runId){
  validateRunId(runId);
  const crypto=require('node:crypto');const mysql=appRequire('mysql2/promise');
  assertLocalContext();
  const fixture={runId,name:'secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12),
    database:'secure_ecommerce_postman_'+runId.replace(/-/g,''),deniedUuids:[protectedUuid]};
  const protectedInfo=protectedSnapshot();fixture.protectedContainerId=protectedInfo?.id;
  // Read only the expected UUID; never load the habitual credentials into a process environment.
  const envPath=path.join(root,'.env');if(fs.existsSync(envPath)){
    const known=appRequire('dotenv').parse(fs.readFileSync(envPath)).DB_EXPECTED_UUID;
    if(known)fixture.deniedUuids.push(known);
  }
  const rootPassword=crypto.randomBytes(32).toString('hex');
  fixture.rootPassword=rootPassword;fixture.appPassword=crypto.randomBytes(32).toString('hex');
  fixture.containerId=docker(['run','--detach','--pull','never','--name',fixture.name,'--hostname',fixture.name,
    '--label',ownerLabel+'=postman','--label',runLabel+'='+runId,'--publish','127.0.0.1::3306',
    '--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0'],
    {env:{MYSQL_ROOT_PASSWORD:rootPassword}});
  // Keep the descriptor on errors so the caller can clean up only its own instance.
  try{
    const info=JSON.parse(docker(['inspect',fixture.containerId]))[0];
    fixture.port=Number(info.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);assertMetadata(info,fixture);
    for(let n=0;n<60;n++){
      try{fixture.connection=await mysql.createConnection({host:'127.0.0.1',port:fixture.port,user:'root',password:rootPassword});break;}
      catch{await new Promise(resolve=>setTimeout(resolve,1000));}
    }
    ensure(fixture.connection,'MYSQL_START_TIMEOUT');
    fixture.uuid=docker(['exec',fixture.containerId,'sh','-c',
      'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names --execute="SELECT @@server_uuid"']);
    await verify(fixture,fixture.connection,{unselected:true});
    return {fixture,protectedInfo};
  }catch(error){error.fixture=fixture;error.protectedInfo=protectedInfo;throw error;}
}
async function provision(fixture,admin){
  const connection=fixture.connection;await verify(fixture,connection,{unselected:true});
  const schemaPath=path.join(root,'tests/support/final-schema.json');const schema=JSON.parse(fs.readFileSync(schemaPath));
  const digest=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'docs/Propuesta_BD_Secure_Ecommerce_14_tablas.docx'))).digest('hex');
  ensure(schema.dictionarySha256===digest,'SCHEMA_DICTIONARY_MISMATCH');
  await connection.query('CREATE DATABASE `'+fixture.database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.changeUser({database:fixture.database});await verify(fixture,connection);
  const tables=['users','admins','sellers','buyers','user_addresses','categories','products','product_categories',
    'carts','cart_items','orders','order_items','order_status_history','audit_logs','SequelizeMeta'];
  for(const table of tables)await connection.query(schema.ddl[table]);
  const migrations=fs.readdirSync(path.join(root,'migrations')).filter(isMigrationFile)
    .concat(fs.readdirSync(path.join(root,'migrations/cutover')).filter(isMigrationFile)).sort(compareCodeUnits);
  ensure(migrations.length===11,'FIXTURE_MIGRATIONS_MISMATCH');
  for(const migration of migrations)await connection.query('INSERT INTO SequelizeMeta (name) VALUES (?)',[migration]);
  await verify(fixture,connection);
  await connection.query("CREATE USER 'ecommerce_app'@'%' IDENTIFIED BY ?",[fixture.appPassword]);
  for(const grant of schema.grants)await connection.query(grant.replace(/`secure_ecommerce`/g,'`'+fixture.database+'`'));
  // Same public-column-only grant used by existing isolated account/catalog tests.
  await connection.query('GRANT SELECT (id,actorUserId,action,targetType,targetId,ipAddress,outcome,occurredAt) ON `'+
    fixture.database+"`.audit_logs TO 'ecommerce_app'@'%'");
  await verify(fixture,connection);
  const hash=await appRequire('bcrypt').hash(admin.password,12);const now=new Date();
  await connection.beginTransaction();
  try{
    await connection.query("INSERT INTO users (id,name,email,passwordHash,status,emailVerifiedAt,createdAt,updatedAt) VALUES (?,?,?,?,'ACTIVE',?,?,?)",
      [admin.id,'Postman synthetic ADMIN',admin.email,hash,now,now,now]);
    await connection.query('INSERT INTO admins (userId) VALUES (?)',[admin.id]);
    await connection.query("INSERT INTO categories (id,name,protected,createdAt,updatedAt) VALUES (1,'Postman protected fixture',1,?,?)",[now,now]);
    await connection.commit();
  }catch(error){await connection.rollback();throw error;}
}
function destroy(fixture){
  if(!fixture?.containerId)return;
  validateRunId(fixture.runId);
  ensure(/^[a-f0-9]{64}$/.test(fixture.containerId),'INVALID_CONTAINER_ID');
  assertLocalContext();
  const raw=docker(['inspect',fixture.containerId],{allowMissing:true});if(!raw)return;
  assertMetadata(JSON.parse(raw)[0],fixture,{cleanup:true});
  docker(['stop','--time','10',fixture.containerId]);docker(['rm',fixture.containerId]);
}
function isMigrationFile(name){
  return typeof name==='string'&&name.length<=255&&name[0]>='0'&&name[0]<='9'&&
    name.endsWith('.js')&&!/[\r\n\u2028\u2029]/u.test(name);
}
module.exports={root,appRequire,ensure,docker,create,provision,verify,destroy,assertMetadata,assertIdentity,isMigrationFile,redisTestStartup,
  identitySql,protectedSnapshot,protectedUuid,protectedVolume,validateRunId,validateDockerArgs,assertLocalContext};
