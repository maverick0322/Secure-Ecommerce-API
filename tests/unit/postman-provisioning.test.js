'use strict';
const fs=require('node:fs'),child=require('node:child_process'),crypto=require('node:crypto');
afterEach(()=>jest.restoreAllMocks());
it.each(['missing','wrong-digest'])('performs no SQL writes if the Word dictionary is %s',async kind=>{
  const runId=crypto.randomUUID(),name='secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12);
  const fixture={runId,name,containerId:'a'.repeat(64),database:'secure_ecommerce_postman_'+runId.replace(/-/g,''),port:41337,uuid:crypto.randomUUID()};
  const info={Id:fixture.containerId,Name:'/'+name,Config:{Hostname:name,Labels:{'secure-ecommerce.test-suite':'postman','secure-ecommerce.test-run':runId}},
    Mounts:[{Type:'tmpfs',Destination:'/var/lib/mysql'}],NetworkSettings:{Ports:{'3306/tcp':[{HostIp:'127.0.0.1',HostPort:'41337'}]}}};
  jest.spyOn(child,'spawnSync').mockImplementation((command,args)=>({status:0,stdout:args.includes('inspect')?JSON.stringify([info]):fixture.uuid}));
  const read=fs.readFileSync;
  jest.spyOn(fs,'readFileSync').mockImplementation((file,...args)=>{
    if(String(file).endsWith('.docx')){
      if(kind==='missing')throw Object.assign(new Error('Synthetic missing dictionary'),{code:'ENOENT'});
      return Buffer.from('Synthetic incorrect dictionary');
    }
    return read(file,...args);
  });
  let iso;jest.isolateModules(()=>{iso=require('../../postman/scripts/isolation');});
  fixture.connection={query:jest.fn(async sql=>sql===iso.identitySql?[[{uuid:fixture.uuid,host:name,port:3306,version:'8.0.46',db:null,
    account:'root@%',mode:'STRICT_TRANS_TABLES',fks:1}]]:[[]])};
  await expect(iso.provision(fixture,{})).rejects.toThrow(kind==='missing'?'Synthetic missing dictionary':'SCHEMA_DICTIONARY_MISMATCH');
  expect(fixture.connection.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
