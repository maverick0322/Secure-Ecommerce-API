'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {isIP}=require('node:net');
const {writeSync}=require('node:fs');
const {isUuid}=require('../validators/uuid');
const context=new AsyncLocalStorage();
const events=new Set(['http.request','logging.failed','audit.write.failed','api.started','api.start.failed',
  'image.cleanup.pending','image.cleanup.invalid','image.recovery.failed','gmail.reauthorization.required']);

// Allowlisted metadata only: never serialize a request, response or Error.
function createLogger({sink,fallback}={}) {
  let failures=0;
  const failed=()=>{
    failures++;
    try {
      const line=JSON.stringify({timestamp:new Date().toISOString(),level:'error',event:'logging.failed'})+'\n';
      if(fallback)fallback(line);else writeSync(2,line);
    } catch { failures++; } // Logging must not change the business result.
  };
  const output=sink||((line)=>{
    if(process.stdout.writableLength>65536)throw new Error('Logging backpressure');
    // One listener even when tests reload modules; no error payload is retained.
    if(!process.stdout.listeners('error').some(listener=>listener.name==='structuredLoggingOutputError')) {
      process.stdout.on('error',function structuredLoggingOutputError(){failed();});
    }
    process.stdout.write(line);
  });
  function log(event,data={}) {
    try {
      if(!events.has(event))return;
      const entry={timestamp:new Date().toISOString(),level:['logging.failed','audit.write.failed','api.start.failed'].includes(event)?'error':'info',event};
      const requestId=context.getStore()?.requestId;
      if(isUuid(requestId))entry.requestId=requestId;
      if(event==='http.request') {
        entry.requestId=isUuid(data.requestId)?data.requestId:null;
        entry.userId=isUuid(data.userId)?data.userId:null;
        entry.ipAddress=isIP(data.ipAddress||'')?data.ipAddress:null;
        entry.method=/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(data.method)?data.method:'OTHER';
        entry.route=typeof data.route==='string'&&data.route.length<=200&&/^\/[A-Za-z0-9_/:.*()-]*$/.test(data.route)?data.route:'unmatched';
        entry.statusCode=Number.isInteger(data.statusCode)&&data.statusCode>=100&&data.statusCode<=599?data.statusCode:null;
        entry.durationMs=Number.isFinite(data.durationMs)&&data.durationMs>=0?Math.round(data.durationMs*1000)/1000:null;
        entry.completed=data.completed===true;
        if(!entry.completed||entry.statusCode>=500)entry.level='error';
        else if(entry.statusCode>=400)entry.level='warn';
      } else if(event==='audit.write.failed') {
        entry.action=typeof data.action==='string'&&/^[\w.-]{1,80}$/.test(data.action)?data.action:'unknown';
        entry.transactional=data.transactional===true;
        entry.critical=data.critical===true;
      }
      const result=output(JSON.stringify(entry)+'\n');
      if(result&&typeof result.then==='function')void result.catch(failed);
    } catch { failed(); }
  }
  return {log,failureCount:()=>failures};
}
const logger=createLogger();
module.exports={log:(...args)=>logger.log(...args),createLogger,context};
