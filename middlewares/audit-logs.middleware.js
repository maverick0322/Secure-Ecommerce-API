'use strict';
const audit=require('../services/audit.service');
module.exports=(req,res,next)=>{
  req.logAudit=async(action,id,actorOverride=null,outcome='SUCCESS',details=null)=>{
    try {await audit.write({actorUserId:req.account?.id || actorOverride,action,targetId:id,
      targetType:action.split('.')[0],ipAddress:req.ip,outcome,details});}
    catch {console.error('No se pudo registrar el evento de auditor?a.');}
  };
  next();
};
