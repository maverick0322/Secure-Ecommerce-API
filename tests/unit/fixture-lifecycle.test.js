'use strict';
const {fixtureLifecycle}=require('../support/fixture-lifecycle');
it('joins pending initialization before cleaning a late resource',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;}),events=[];
  const lifecycle=fixtureLifecycle(async()=>{await gate;events.push('created');},async()=>{events.push('cleaned');});
  const preparation=lifecycle.start(),closed=lifecycle.close();
  await Promise.resolve();expect(events).toEqual([]);
  release();await preparation;await closed;
  expect(events).toEqual(['created','cleaned']);expect(()=>lifecycle.start()).toThrow();
});
it('cleans partial setup and preserves its failure',async()=>{
  const error=new Error('Synthetic setup failure'),cleanup=jest.fn();
  const lifecycle=fixtureLifecycle(async()=>{throw error;},cleanup);
  await expect(lifecycle.start()).rejects.toBe(error);
  await expect(lifecycle.close()).rejects.toBe(error);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
it('propagates cleanup failures instead of claiming successful teardown',async()=>{
  const error=new Error('Synthetic cleanup failure');
  const lifecycle=fixtureLifecycle(async()=>{},async()=>{throw error;});
  await lifecycle.start();await expect(lifecycle.close()).rejects.toBe(error);
});
it('retains both failures if setup and cleanup fail',async()=>{
  const setup=new Error('Synthetic setup failure'),cleanup=new Error('Synthetic cleanup failure');
  const lifecycle=fixtureLifecycle(async()=>{throw setup;},async()=>{throw cleanup;});
  await expect(lifecycle.start()).rejects.toBe(setup);
  await expect(lifecycle.close()).rejects.toMatchObject({errors:[setup,cleanup]});
});
