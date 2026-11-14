'use strict';
const crypto = require('node:crypto');
const { inspectOwned } = require('../../scripts/database/stage2-redis-test');
function fixture() {
  const runId = crypto.randomUUID(), name = 'secure-ecommerce-redis-test-' + runId.slice(0, 8);
  const expected = { runId, name, id: 'a'.repeat(64), imageId: 'sha256:' + 'b'.repeat(64) };
  const info = { Id: expected.id, Name: '/' + name, Image: expected.imageId,
    Config: { Hostname: name, Image: 'redis:8.2', Labels: { 'secure-ecommerce.redis-test': runId } },
    Mounts: [], HostConfig: { Tmpfs: { '/data': 'rw' }, PortBindings: { '6379/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } },
    NetworkSettings: { Ports: { '6379/tcp': [{ HostIp: '127.0.0.1', HostPort: '16379' }] } } };
  return { expected, info };
}
it('accepts only an owned tmpfs Redis with an isolated loopback port', () => {
  const f = fixture(); expect(inspectOwned(f.info, f.expected)).toBe(16379);
  expect(inspectOwned(f.info, f.expected, true)).toBeNull();
});
it('permits only the exact Redis test startup and rejects flag/target injection',()=>{
  const {validateDockerArgs,redisTestStartup}=require('../../postman/scripts/isolation');
  const {expected:f}=fixture();
  const args=['create','--pull','never','--name',f.name,'--hostname',f.name,
    '--label','secure-ecommerce.redis-test='+f.runId,'--publish','127.0.0.1::6379','--tmpfs','/data:rw',
    '--env','REDIS_TEST_PASSWORD','--entrypoint','sh','redis:8.2','-c',redisTestStartup];
  expect(()=>validateDockerArgs(args)).not.toThrow();
  args[10]='6379:6379';expect(()=>validateDockerArgs(args)).toThrow();
  expect(()=>validateDockerArgs(['start','ecommerce_db'])).toThrow();
  expect(()=>validateDockerArgs(['restart','--all'])).toThrow();
});
it('refuses to start a container with missing Redis test ownership before mutation',()=>{
  const spawn=jest.spyOn(require('node:child_process'),'spawnSync').mockImplementation((cmd,args)=>({status:0,stdout:JSON.stringify(
    args.includes('context')?[{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]:[{Config:{Labels:{}}}])}));
  try {
    jest.isolateModules(()=>{
      expect(()=>require('../../postman/scripts/isolation').docker(['start','a'.repeat(64)])).toThrow('INVALID_RUN_ID');
    });
    expect(spawn.mock.calls.every(call=>!call[1].includes('start'))).toBe(true);
  }finally {spawn.mockRestore();}
});
it.each([
  f => { f.info.Id = 'c'.repeat(64); },
  f => { f.info.Name = '/ecommerce_db'; },
  f => { f.info.Config.Labels['secure-ecommerce.redis-test'] = crypto.randomUUID(); },
  f => { f.info.Config.Image = 'mysql:8.0'; },
  f => { f.info.Image = 'sha256:other-image'; },
  f => { f.info.Mounts = [{ Type: 'volume', Name: 'secure-ecommerce-api_mysql_data', Destination: '/data' }]; },
  f => { f.info.Mounts = [{ Type: 'bind', Destination: '/data' }]; },
  f => { f.info.HostConfig.Binds = ['usual:/data']; },
  f => { f.info.HostConfig.Tmpfs = {}; },
  f => { f.info.HostConfig.PortBindings['6379/tcp'][0].HostIp = '0.0.0.0'; },
  f => { f.info.NetworkSettings.Ports['6379/tcp'][0].HostIp = '0.0.0.0'; },
  f => { f.info.NetworkSettings.Ports['6379/tcp'][0].HostPort = '6379'; },
  f => { f.info.NetworkSettings.Ports['6379/tcp'][0].HostPort = '3307'; },
  f => { f.info.HostConfig.PortBindings['6379/tcp'][0].HostPort = '3307'; }
])('rejects a protected or ambiguous target before any setup write %#', mutate => {
  const f = fixture(); mutate(f); expect(() => inspectOwned(f.info, f.expected)).toThrow();
});
