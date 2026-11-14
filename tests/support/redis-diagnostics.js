'use strict';
// Test-only aggregate telemetry. Never retains command arguments, keys, values,
// messages, user/session identifiers, tokens or connection configuration.
const {createClientPool,WatchError}=require('redis');
const {performance}=require('node:perf_hooks');
function redisDiagnostics(){
  let metrics={};
  let beforeGet;
  function record(operation,elapsed,error){
    const item=metrics[operation]||={calls:0,failures:0,maxMs:0};
    item.calls++;item.maxMs=Math.max(item.maxMs,Math.round(elapsed));
    if(error){
      item.failures++;
      item.lastCode=['SESSION_STORE_UNAVAILABLE','SESSION_CONFLICT','AUTH_REDIS_CONFIGURATION_INVALID'].includes(error.code)?error.code:'other';
      item.outcomeUnknown=error.outcomeUnknown===true;
      item.lastKind=error instanceof WatchError ? (error.message===new WatchError().message?'watch-conflict':'watch-topology') :
        ['TimeoutError','ConnectionTimeoutError','ClientClosedError','SocketClosedUnexpectedlyError'].includes(error.name)?error.name:'other';
    }
  }
  async function observed(operation,work){
    const start=performance.now();
    try{const value=await work();record(operation,performance.now()-start);return value;}
    catch(error){record(operation,performance.now()-start,error);throw error;}
  }
  function wrap(client){
    return {
      get isReady(){return client.isReady;},
      sendCommand:args=>observed(args[0],async()=>{
        if(args[0]==='GET'&&beforeGet)await beforeGet(args[1]);
        return client.sendCommand(args);
      }),
      watch:keys=>observed('WATCH',()=>client.watch(keys)),
      unwatch:()=>observed('UNWATCH',()=>client.unwatch()),
      multi(){
        const native=client.multi();
        const multi={addCommand(args){native.addCommand(args);return multi;},exec:()=>observed('EXEC',()=>native.exec())};
        return multi;
      }
    };
  }
  return {
    reset(){metrics={};},
    beforeGet(hook){beforeGet=hook;},
    snapshot(){return structuredClone(metrics);},
    poolFactory(options,settings){
      const pool=createClientPool(options,settings);
      pool.on('error',error=>record('POOL_EVENT',0,error));
      return {on:(...args)=>pool.on(...args),connect:()=>pool.connect(),destroy:()=>pool.destroy(),
        execute:work=>observed('LEASE',()=>pool.execute(client=>work(wrap(client))))};
    }
  };
}
module.exports={redisDiagnostics};
