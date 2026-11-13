'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const iso=require('./isolation');
const guard=require('./collection-guard');
function fixture(){
  const runId=crypto.randomUUID();const name='secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12);
  const f={runId,name,containerId:'a'.repeat(64),database:'secure_ecommerce_postman_'+runId.replace(/-/g,''),port:41337,
    uuid:crypto.randomUUID(),protectedContainerId:'b'.repeat(64),deniedUuids:[iso.protectedUuid]};
  const info={Id:f.containerId,Name:'/'+name,Config:{Hostname:name,Labels:{'secure-ecommerce.test-suite':'postman','secure-ecommerce.test-run':runId}},
    Mounts:[{Type:'tmpfs',Destination:'/var/lib/mysql'}],NetworkSettings:{Ports:{'3306/tcp':[{HostIp:'127.0.0.1',HostPort:'41337'}]}}};
  const row={uuid:f.uuid,host:name,port:3306,version:'8.0.46',db:f.database,account:'ecommerce_app@%',mode:'STRICT_TRANS_TABLES',fks:1};
  return {f,info,row};
}
test('accepts only an owned disposable server and a distinct test database',()=>{
  const {f,info,row}=fixture();iso.assertMetadata(info,f);iso.assertIdentity(row,f,{account:'ecommerce_app'});
});
test('accepts Docker tmpfs declarations that are absent from Mounts',()=>{
  const {f,info}=fixture();info.Mounts=[];info.HostConfig={Tmpfs:{'/var/lib/mysql':'rw'}};iso.assertMetadata(info,f);
});
test('rejects additional persistent mounts even with a valid tmpfs',()=>{
  const {f,info}=fixture();info.HostConfig={Binds:['foreign:/other']};assert.throws(()=>iso.assertMetadata(info,f));
});
for(const [name,modify]of [
  ['habitual database',x=>{x.f.database='secure_ecommerce';}],
  ['legacy database',x=>{x.f.database='mercadolibrenode';}],
  ['habitual SQL port',x=>{x.f.port=3307;x.info.NetworkSettings.Ports['3306/tcp'][0].HostPort='3307';}],
  ['protected container',x=>{x.f.protectedContainerId=x.f.containerId;}],
  ['named production volume',x=>{x.info.Mounts=[{Type:'volume',Name:iso.protectedVolume,Destination:'/var/lib/mysql'}];}],
  ['bind mount',x=>{x.info.Mounts=[{Type:'bind',Destination:'/var/lib/mysql'}];}],
  ['wrong ownership label',x=>{x.info.Config.Labels['secure-ecommerce.test-run']=crypto.randomUUID();}],
  ['foreign container id',x=>{x.info.Id='c'.repeat(64);}],
  ['public SQL publication',x=>{x.info.NetworkSettings.Ports['3306/tcp'][0].HostIp='0.0.0.0';}]
])test('refuses '+name+' before SQL writes',()=>{const x=fixture();modify(x);assert.throws(()=>iso.assertMetadata(x.info,x.f));});
for(const [name,modify]of [
  ['protected UUID',x=>{x.row.uuid=iso.protectedUuid;}],
  ['unexpected UUID',x=>{x.row.uuid=crypto.randomUUID();}],
  ['habitual database name',x=>{x.row.db='secure_ecommerce';}],
  ['wrong account',x=>{x.row.account='root@%';}],
  ['foreign hostname',x=>{x.row.host='ecommerce_db';}],
  ['disabled FK checks',x=>{x.row.fks=0;}],
  ['non-strict session',x=>{x.row.mode='';}]
])test('rejects connection with '+name,()=>{const x=fixture();modify(x);assert.throws(()=>iso.assertIdentity(x.row,x.f,{account:'ecommerce_app'}));});
test('blocks vulnerable dynamic templates without suppressing the dependency advisory',()=>{
  const runtime=require('./newman-runtime');runtime.load();const faker=require('../node_modules/@faker-js/faker');
  assert.throws(()=>faker.fake('{{name.firstName}}'),/disabled/);
  assert.throws(()=>faker.helpers.fake('{{name.firstName}}'),/disabled/);
  assert.throws(()=>runtime.validateCollection({value:'{{$randomFirstName}}'}),/FORBIDDEN/);
});
function runGuard(environment){
  const newman=require('./newman-runtime').load();
  return new Promise((resolve,reject)=>newman.run({collection:{info:{name:'Barrier proof',schema:'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
    event:[{listen:'prerequest',script:{exec:['('+guard.toString()+')();']}}],
    item:[{name:'Must not reach business endpoint',request:{method:'POST',url:'{{baseUrl}}/business-must-not-run'}}]},
    environment:{values:Object.entries(environment).map(([key,value])=>({key,value:String(value)}))},reporters:[],silent:true,bail:true,ignoreRedirects:true,
    timeoutRequest:3000,timeoutScript:5000},(error,summary)=>error?reject(error):resolve(summary)));
}
test('collection guard sends no HTTP request to a mismatched origin',async()=>{
  let hits=0;const server=http.createServer((req,res)=>{hits++;res.end('{}');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const summary=await runGuard({apiPort:3001,baseUrl:'http://127.0.0.1:'+server.address().port});
    assert.equal(hits,0);assert(summary.run.failures.length>0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('collection guard refuses a wrong server UUID after a read-only probe',async()=>{
  const f=fixture().f;let probes=0,writes=0;
  const server=http.createServer((req,res)=>{
    if(req.url==='/__postman/isolation'){probes++;res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({isolated:true,runId:f.runId,database:f.database,serverUuid:crypto.randomUUID(),storage:'tmpfs'}));}
    writes++;res.end('{}');
  });
  let port;
  for(let p=3002;p<=3099;p++){
    const bound=await new Promise(resolve=>{const failed=()=>resolve(false);server.once('error',failed);
      server.listen(p,'127.0.0.1',()=>{server.removeListener('error',failed);resolve(true);});});
    if(bound){port=p;break;}
  }
  assert(port,'No free guard-test port');
  try{const summary=await runGuard({apiPort:port,baseUrl:'http://127.0.0.1:'+port,expectedDatabase:f.database,
    expectedServerUuid:f.uuid,isolationRunId:f.runId,isolationKey:crypto.randomBytes(32).toString('hex')});
    assert.equal(probes,1);assert.equal(writes,0);assert(summary.run.failures.length>0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
