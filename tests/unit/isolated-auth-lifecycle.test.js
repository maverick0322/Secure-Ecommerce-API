'use strict';
jest.mock('../../scripts/database/stage2-redis-test',()=>({withRedisFixture:jest.fn()}));
jest.mock('../../services/auth-redis.service',()=>({createAuthRedisConnection:jest.fn()}));
const runner=require('../../scripts/database/stage2-redis-test');
const redis=require('../../services/auth-redis.service');
const runtime=require('../../services/auth-runtime.service');
const {start}=require('../support/isolated-auth');
let store;
beforeEach(()=>{
  store={connect:jest.fn().mockResolvedValue(),close:jest.fn(),transaction:jest.fn(),
    prefix:'secure-ecommerce-auth-test-unit:',expectedRunId:'a'.repeat(40)};
  redis.createAuthRedisConnection.mockReturnValue(store);
});
afterEach(()=>jest.clearAllMocks());
it('propagates a runner rejection during startup without launching Docker',async()=>{
  const error=new Error('Synthetic fixture startup failure');
  runner.withRedisFixture.mockRejectedValue(error);
  await expect(start()).rejects.toBe(error);
});
it('restores the runtime and closes the store when connection fails',async()=>{
  const original=runtime.getRuntime,error=new Error('Synthetic connection failure');
  runner.withRedisFixture.mockImplementation(exercise=>exercise({config:{namespace:'secure-ecommerce-auth-test-unit',port:16379},assertOwned:()=>{}}));
  store.connect.mockRejectedValue(error);
  await expect(start()).rejects.toBe(error);
  expect(runtime.getRuntime).toBe(original);expect(store.close).toHaveBeenCalledTimes(1);
});
it('keeps teardown failures observable through close after startup has resolved',async()=>{
  const original=runtime.getRuntime,error=new Error('Synthetic cleanup failure');
  runner.withRedisFixture.mockImplementation(async exercise=>{
    await exercise({config:{namespace:'secure-ecommerce-auth-test-unit',port:16379},assertOwned:()=>{}});
    throw error;
  });
  const handle=await start();
  expect(runtime.getRuntime).not.toBe(original);
  await expect(handle.close()).rejects.toBe(error);
  expect(runtime.getRuntime).toBe(original);expect(store.close).toHaveBeenCalledTimes(1);
});
