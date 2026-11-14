'use strict';
jest.mock('redis',()=>({...jest.requireActual('redis'),createClientPool:jest.fn()}));
const {createClientPool,WatchError}=require('redis');
const {RedisDouble}=require('../support/redis-double');
const {redisDiagnostics}=require('../support/redis-diagnostics');
let server,diagnostics,pool,native;
beforeEach(async()=>{
  server=new RedisDouble();diagnostics=redisDiagnostics();
  createClientPool.mockImplementation((options,settings)=>(native=server.poolFactory(options,settings)));
  pool=diagnostics.poolFactory({password:'synthetic-test-only-password'},{minimum:1,maximum:4,acquireTimeout:100});
  await pool.connect();
});
afterEach(()=>{pool.destroy();jest.clearAllMocks();});
it('preserves native command results and hooks without recording keys or values',async()=>{
  const hook=jest.fn();diagnostics.beforeGet(hook);
  await pool.execute(async client=>{
    expect(client.isReady).toBe(true);
    await client.watch(['synthetic-private-key']);
    await client.multi().addCommand(['SET','synthetic-private-key','synthetic-private-value']).exec();
    expect(await client.sendCommand(['GET','synthetic-private-key'])).toBe('synthetic-private-value');
    await client.sendCommand(['TIME']);await client.unwatch();
  });
  expect(hook).toHaveBeenCalledWith('synthetic-private-key');expect(hook).toHaveBeenCalledTimes(1);
  const snapshot=diagnostics.snapshot();expect(snapshot.EXEC.calls).toBe(1);expect(snapshot.GET.failures).toBe(0);
  const text=JSON.stringify(snapshot);expect(text).not.toContain('synthetic-private');expect(text).not.toContain('password');
  snapshot.GET.calls=100;expect(diagnostics.snapshot().GET.calls).toBe(1);
  diagnostics.beforeGet(undefined);diagnostics.reset();expect(diagnostics.snapshot()).toEqual({});
  await pool.execute(client=>client.sendCommand(['GET','synthetic-private-key']));expect(hook).toHaveBeenCalledTimes(1);
});
it.each([
  [()=>new WatchError(),'watch-conflict','other'],
  [()=>new WatchError('Client reconnected after WATCH'),'watch-topology','other'],
  [()=>Object.assign(new Error('Do not copy private payload'),{name:'TimeoutError'}),'TimeoutError','other'],
  [()=>Object.assign(new Error('Do not copy private payload'),{code:'SESSION_STORE_UNAVAILABLE',outcomeUnknown:true}),'other','SESSION_STORE_UNAVAILABLE']
])('propagates SDK failure %# unchanged with only approved diagnostics',async(factory,kind,code)=>{
  const error=factory();server.beforeExec=()=>{throw error;};
  await expect(pool.execute(client=>client.multi().addCommand(['GET','private-key']).exec())).rejects.toBe(error);
  const report=diagnostics.snapshot();expect(report.EXEC).toMatchObject({failures:1,lastKind:kind,lastCode:code});
  expect(report.LEASE.failures).toBe(1);expect(JSON.stringify(report)).not.toContain('private');
});
it('observes pool events without swallowing errors from the consumer',()=>{
  const listener=jest.fn();pool.on('error',listener);
  const error=Object.assign(new Error('private event payload'),{name:'ClientClosedError'});native.emit('error',error);
  expect(listener).toHaveBeenCalledWith(error);expect(diagnostics.snapshot().POOL_EVENT.lastKind).toBe('ClientClosedError');
  expect(JSON.stringify(diagnostics.snapshot())).not.toContain('private event payload');
});
