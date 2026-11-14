'use strict';
const crypto=require('node:crypto');
const child=require('node:child_process');
let iso,spawn,runId,id,info;
beforeEach(()=>{
  runId=crypto.randomUUID();id='a'.repeat(64);
  const name='secure-ecommerce-redis-test-'+runId.slice(0,8);
  info={Id:id,Name:'/'+name,State:{Running:true},Config:{Hostname:name,Image:'redis:8.2',Labels:{'secure-ecommerce.redis-test':runId}},
    Mounts:[],HostConfig:{Tmpfs:{'/data':'rw'},PortBindings:{'6379/tcp':[{HostIp:'127.0.0.1',HostPort:'41337'}]}},
    NetworkSettings:{Ports:{'6379/tcp':[{HostIp:'127.0.0.1',HostPort:'41337'}]}}};
  spawn=jest.spyOn(child,'spawnSync').mockImplementation((command,args)=>({status:0,stdout:
    args.includes('context')?JSON.stringify([{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]):
      args.includes('inspect')?JSON.stringify([info]):'confirmed'}));
  jest.isolateModules(()=>{iso=require('../../postman/scripts/isolation');});
});
afterEach(()=>jest.restoreAllMocks());
it.each(['start','restart','stop','exec'])('allows only an owned disposable Redis for %s',operation=>{
  const args=operation==='stop'?['stop','--time','5',id]:operation==='exec'?['exec',id,'sh','-c',
    'export REDISCLI_AUTH="$REDIS_TEST_PASSWORD"; exec redis-cli -s /data/redis.sock INFO server']:[operation,id];
  expect(iso.docker(args)).toBe('confirmed');
  expect(spawn.mock.calls.at(-1)[1]).toEqual(expect.arrayContaining(args));
  expect(spawn.mock.calls.at(-1)[2].shell).toBe(false);
});
it.each(['wrong-name','volume','public-port'])('refuses a Redis mutation when metadata changes: %s',kind=>{
  if(kind==='wrong-name')info.Name='/habitual_redis';if(kind==='volume')info.Mounts=[{Type:'volume',Destination:'/data'}];
  if(kind==='public-port')info.HostConfig.PortBindings['6379/tcp'][0].HostIp='0.0.0.0';
  expect(()=>iso.docker(['stop','--time','5',id])).toThrow();
  expect(spawn.mock.calls.some(call=>call[1].includes('stop'))).toBe(false);
});
it('validates the full labeled list command and refuses appended Docker options',()=>{
  const args=['ps','--all','--no-trunc','--filter','label=secure-ecommerce.test-suite=postman','--filter',
    'label=secure-ecommerce.test-run='+runId,'--format','{{.ID}}'];
  expect(()=>iso.validateDockerArgs(args)).not.toThrow();expect(()=>iso.validateDockerArgs([...args,'--filter','name=ecommerce_db'])).toThrow();
});
it('fails on Docker errors, but permits explicitly read-only missing-container inspection',()=>{
  spawn.mockReturnValue({status:1,stdout:''});
  expect(()=>iso.docker(['inspect',id])).toThrow('DOCKER_OPERATION_FAILED');
  expect(iso.docker(['inspect',id],{allowMissing:true})).toBeNull();
});
it('uses the active local context on Linux without inventing a Windows context',()=>{
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  try{
    Object.defineProperty(process,'platform',{...descriptor,value:'linux'});
    jest.isolateModules(()=>{iso=require('../../postman/scripts/isolation');});
    iso.assertLocalContext();expect(spawn.mock.calls.at(-1)[1]).toEqual(['context','inspect']);
  }finally{Object.defineProperty(process,'platform',descriptor);}
});
