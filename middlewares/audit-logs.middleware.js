'use strict';
const audit=require('../services/audit.service');
module.exports=(req,res,next)=>{
  let denied=false;
  req.logAudit=async(action,id,actorOverride=null,outcome='SUCCESS',details=null)=>{
    if(outcome==='DENIED'){
      if(denied)return false;
      denied=true;
    }
    const actorId=req.account?.id||req.authenticatedActorId;
    // A legacy override may corroborate server authentication, never establish it.
    try {await audit.write({actorUserId:!actorOverride||actorOverride===actorId?actorId:null,action,targetId:id,
      targetType:action.split('.')[0],ipAddress:req.ip,outcome,details});}
    catch {return false;} // audit.write reports metadata; denial remains denied.
    return true;
  };
  // Covers invalid JWTs, owner/profile denials and controller-returned errors.
  // Existing explicit denial events suppress this fallback. Ordinary GETs and
  // rate-limit floods are technical HTTP logs, not SQL events per request.
  if(typeof res.once==='function')res.once('finish',()=>{
    if([401,403].includes(res.statusCode)&&!denied)void req.logAudit('access.denied',null,null,'DENIED');
  });
  next();
};
