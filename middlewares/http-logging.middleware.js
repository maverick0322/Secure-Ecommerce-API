'use strict';
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const logger=require('../services/structured-logger.service');

function normalizedRoute(req) {
  // Mounts are server-owned constants. Never include req.url, query or params.
  const mount=/^\/api\/(categories|products|users|roles|auth|files|audit-logs|addresses|cart|checkout|orders)$/.test(req.baseUrl||'')?req.baseUrl:'';
  return typeof req.route?.path==='string'?mount+req.route.path:'unmatched';
}
function createHttpLogger({log=(...args)=>logger.log(...args),now=()=>performance.now()}={}) {
  return (req,res,next)=>{
    const requestId=randomUUID(),started=now();
    req.requestId=requestId;
    let recorded=false;
    function record(completed) {
      if(recorded)return;
      recorded=true;
      // A broken custom transport must not escape an HTTP lifecycle callback.
      try {log('http.request',{requestId,method:req.method,route:normalizedRoute(req),userId:req.account?.id||req.authenticatedActorId,
        ipAddress:req.ip,statusCode:completed||res.headersSent?res.statusCode:null,durationMs:now()-started,completed});}
      catch { logger.log('logging.failed'); }
    }
    res.once('finish',()=>record(true));
    res.once('close',()=>record(false));
    logger.context.run({requestId},next);
  };
}
module.exports=createHttpLogger();
module.exports.createHttpLogger=createHttpLogger;
module.exports.normalizedRoute=normalizedRoute;
