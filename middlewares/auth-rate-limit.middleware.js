'use strict';
const {AccountError,respondError}=require('../services/accounts.service');
module.exports=function createLimiter({max=30,windowMs=60000,maxKeys=1000,now=Date.now}={}){
  const buckets=new Map();
  return (req,res,next)=>{
    const time=now();const key=req.ip||'unknown';let bucket=buckets.get(key);
    if(!bucket || bucket.until<=time){
      if(buckets.size>=maxKeys){for(const [address,value]of buckets)if(value.until<=time)buckets.delete(address);}
      if(!bucket && buckets.size>=maxKeys){res.set('Retry-After','60');return respondError(res,new AccountError(429,'Demasiadas solicitudes; intente más tarde.'));}
      bucket={until:time+windowMs,count:0};buckets.set(key,bucket);
    }
    if(++bucket.count>max){res.set('Retry-After',String(Math.max(1,Math.ceil((bucket.until-time)/1000))));return respondError(res,new AccountError(429,'Demasiadas solicitudes; intente más tarde.'));}
    next();
  };
};
