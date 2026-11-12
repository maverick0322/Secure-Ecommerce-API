'use strict';
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const mysql=require('mysql2/promise');
const password=crypto.randomBytes(32).toString('hex');
const name='secure-ecommerce-stage5-addresses';
const environment={...process.env,MYSQL_ROOT_PASSWORD:password,STAGE5_EXTERNAL_ROOT_PASSWORD:password};
function docker(args,timeout=60000){const r=spawnSync('docker',['--context','desktop-linux',...args],{env:environment,encoding:'utf8',timeout,windowsHide:true,maxBuffer:8*1024*1024});if(r.status!==0)throw new Error(r.stderr||'Docker failed');return r.stdout.trim();}
async function main(){let id,root;try{
 id=docker(['run','--detach','--name',name,'--hostname',name,'--publish','127.0.0.1:13308:3306','--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0']);
 const detail=JSON.parse(docker(['inspect','--format','{{json .}}',name]));assert.equal(detail.Id,id);assert(detail.Mounts.every(m=>m.Type!=='volume'&&m.Type!=='bind'));
 for(let n=0;n<60;n++){try{root=await mysql.createConnection({host:'127.0.0.1',port:13308,user:'root',password});break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}}
 assert(root);const [[identity]]=await root.query('SELECT @@server_uuid AS uuid,@@hostname AS host');assert.equal(identity.host,name);
 environment.STAGE5_EXTERNAL_UUID=identity.uuid;
 const output=docker(['run','--rm','--network',`container:${id}`,'--env','STAGE5_EXTERNAL_ROOT_PASSWORD','--env','STAGE5_EXTERNAL_UUID','--env','STAGE5_EXTERNAL_FIXTURE=1',
   '--entrypoint','node','secure-ecommerce-stage5-node20:local','/workspace/scripts/database/stage5-addresses-test.js'],240000);
 fs.writeFileSync('log/stage5/node20-mysql.log',output+'\n');console.log(output);
}finally{if(root)await root.end();if(id){assert.equal(docker(['inspect','--format','{{.Id}}',name]),id);docker(['stop',name]);docker(['rm',name]);}}}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
