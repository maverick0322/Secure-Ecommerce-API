'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const source=require('./stage4');
const target=path.resolve('log/stage5/legacy-backup');
const name='secure-ecommerce-stage5-restore';
const port=13309;
const password=crypto.randomBytes(32).toString('hex');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function run(command,args,input,env=process.env){
  const result=spawnSync(command,args,{input,encoding:'utf8',env,timeout:120000,windowsHide:true});
  if(result.status!==0) throw new Error(result.stderr||`${command} failed`);return result.stdout;
}
function docker(args,input){return run('docker',['--context','desktop-linux',...args],input,{...process.env,MYSQL_ROOT_PASSWORD:password});}
async function main(){
  // Pinned existing server; all source operations are reads.
  source.verifyAdmin();
  assert(!fs.existsSync(target),'Refusing to overwrite an existing backup');
  assert(source.admin("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='mercadolibrenode';").includes('mercadolibrenode'),'Source database does not exist');
  const names=source.admin("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='mercadolibrenode' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;").trim().split('\n').slice(1).filter(Boolean);
  assert(names.every(n=>/^[a-zA-Z0-9_]+$/.test(n)));
  const original={};
  for(const table of names){
    const count=Number(source.admin(`SELECT COUNT(*) FROM mercadolibrenode.\`${table}\`;`).trim().split('\n').at(-1));
    const checksum=source.admin(`CHECKSUM TABLE mercadolibrenode.\`${table}\` EXTENDED;`).trim().split('\n').at(-1).split('\t')[1];
    original[table]={count,checksum};
  }
  fs.mkdirSync(target,{recursive:true});
  const dump=source.docker(['exec','ecommerce_db','sh','-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --protocol=SOCKET --user=root --single-transaction --routines --events --triggers --hex-blob --no-tablespaces --set-gtid-purged=OFF --databases mercadolibrenode']);
  assert(dump.includes('-- Dump completed on'));
  fs.writeFileSync(path.join(target,'mercadolibrenode.sql'),dump,{flag:'wx'});
  const dumpHash=hash(fs.readFileSync(path.join(target,'mercadolibrenode.sql')));assert.equal(dumpHash,hash(dump));
  run('tar',['-cf',path.join(target,'uploads.tar'),'-C',process.cwd(),'uploads']);
  const uploadsHash=hash(fs.readFileSync(path.join(target,'uploads.tar')));
  run('tar',['-tf',path.join(target,'uploads.tar')]);
  let id,connection;
  try{
    id=docker(['run','--detach','--name',name,'--hostname',name,'--publish',`127.0.0.1:${port}:3306`,
      '--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0']).trim();
    const detail=JSON.parse(docker(['inspect','--format','{{json .}}',name]));
    assert.equal(detail.Id,id);assert(detail.Mounts.every(m=>m.Type!=='volume'&&m.Type!=='bind'));
    for(let n=0;n<60;n++){
      try{connection=await mysql.createConnection({host:'127.0.0.1',port,user:'root',password});break;}
      catch{await new Promise(resolve=>setTimeout(resolve,1000));}
    }
    assert(connection);
    const [[identity]]=await connection.query('SELECT @@hostname AS host,@@server_uuid AS uuid,VERSION() AS version,CURRENT_USER() AS account');
    assert.equal(identity.host,name);assert.equal(identity.account,'root@%');assert.match(identity.version,/^8\.0\./);
    const socket=docker(['exec','-i',name,'sh','-c','export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --skip-column-names'],'SELECT @@server_uuid;').trim();
    assert.equal(socket,identity.uuid);
    docker(['exec','-i',name,'sh','-c','export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root'],dump);
    const [tables]=await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA='mercadolibrenode' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    assert.deepEqual(tables.map(r=>r.name),names);
    for(const table of names){
      const [[count]]=await connection.query(`SELECT COUNT(*) AS n FROM mercadolibrenode.\`${table}\``);assert.equal(count.n,original[table].count);
      const [[checksum]]=await connection.query(`CHECKSUM TABLE mercadolibrenode.\`${table}\` EXTENDED`);assert.equal(String(checksum.Checksum),original[table].checksum);
    }
    // Extract to an independent directory and compare every regular file byte-for-byte.
    const restored=path.join(target,'restored-files');fs.mkdirSync(restored);
    run('tar',['-xf',path.join(target,'uploads.tar'),'-C',restored]);
    const files=[];
    function compare(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const sourcePath=path.join(dir,item.name);const relative=path.relative(process.cwd(),sourcePath);
      if(item.isDirectory()) compare(sourcePath);
      else if(item.isFile()){
        const bytes=fs.readFileSync(sourcePath);assert.equal(hash(bytes),hash(fs.readFileSync(path.join(restored,relative))));files.push({path:relative,bytes:bytes.length,sha256:hash(bytes)});
      }else throw new Error('Historical storage contains a special file; manual review required');
    }}compare(path.resolve('uploads'));
    const manifest={verifiedAt:new Date().toISOString(),sourceUuid:source.expectedUuid,sourceDatabase:'mercadolibrenode',
      tables:original,dumpSha256:dumpHash,uploadsSha256:uploadsHash,files,restoredServer:identity,restorationVerified:true,sourceModified:false};
    fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({tables:original,files:files.length,dumpSha256:dumpHash,uploadsSha256:uploadsHash,restorationVerified:true}));
  }finally{
    if(connection) await connection.end();
    if(id){assert.equal(docker(['inspect','--format','{{.Id}}',name]).trim(),id);docker(['stop',name]);docker(['rm',name]);}
  }
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
