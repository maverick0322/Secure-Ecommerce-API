'use strict';
// Historical migrations are tested only on this new tmpfs server, never port 3307.
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const password=crypto.randomBytes(32).toString('hex');
const migrationPassword=crypto.randomBytes(32).toString('hex');
const name='secure-ecommerce-stage25';
function docker(args){const r=spawnSync('docker',[...(process.platform==='win32'?['--context','desktop-linux']:[]),...args],{encoding:'utf8',env:{...process.env,MYSQL_ROOT_PASSWORD:password},timeout:60000,windowsHide:true});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();}
function node(args,env){const r=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,...env},timeout:180000,windowsHide:true,maxBuffer:8*1024*1024});process.stdout.write((r.stdout||'')+(r.stderr||''));if(r.status!==0)throw new Error('Historical isolated tests failed');}
async function main(){let id,root;try{
 id=docker(['run','--detach','--name',name,'--hostname',name,'--publish','127.0.0.1:13307:3306','--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0']);
 const detail=JSON.parse(docker(['inspect','--format','{{json .}}',name]));assert.equal(detail.Id,id);assert(detail.Mounts.every(m=>m.Type!=='volume'&&m.Type!=='bind'));
 for(let n=0;n<60;n++){try{root=await mysql.createConnection({host:'127.0.0.1',port:13307,user:'root',password});break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}}
 assert(root);const [[identity]]=await root.query('SELECT @@hostname AS host,@@server_uuid AS uuid,VERSION() AS version');assert.equal(identity.host,name);assert.match(identity.version,/^8\.0\./);
 node(['node_modules/jest/bin/jest.js','--runInBand','--runTestsByPath','tests/database/schema.mysql.test.js'],{TEST_MYSQL_URL:`mysql://root:${password}@127.0.0.1:13307`,NODE_ENV:'test'});
 await root.query('CREATE DATABASE secure_ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
 await root.query("CREATE USER 'ecommerce_migrator'@'%' IDENTIFIED BY ?",[migrationPassword]);
 await root.query("GRANT SELECT,INSERT,UPDATE,CREATE,ALTER,INDEX,REFERENCES,DROP ON `secure\\_ecommerce`.* TO 'ecommerce_migrator'@'%'");
 const env={MIGRATION_DB_HOST:'127.0.0.1',MIGRATION_DB_PORT:'13307',MIGRATION_DB_USER:'ecommerce_migrator',MIGRATION_DB_PASSWORD:migrationPassword};
 node(['node_modules/sequelize-cli/lib/sequelize','db:migrate','--config','config/secure-ecommerce-migrations.js','--env','migration','--to','20261108000001-normalize-english-schema.js'],env);
 node(['node_modules/jest/bin/jest.js','--runInBand','--runTestsByPath','tests/database/secure-ecommerce-transition.mysql.test.js'],{...env,STAGE25_MYSQL_UUID:identity.uuid,NODE_ENV:'test'});
 console.log('PASS: three historical migration tests and eight transition integrity tests on isolated MySQL.');
}finally{if(root)await root.end();if(id){assert.equal(docker(['inspect','--format','{{.Id}}',name]),id);docker(['stop',name]);docker(['rm',name]);}}}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
