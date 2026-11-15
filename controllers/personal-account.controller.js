'use strict';
const service=require('../services/personal-account.service');
const {respondError}=require('../services/accounts.service');
const handle=work=>async(req,res)=>{try{res.set('Cache-Control','no-store');await work(req,res);}catch(error){respondError(res,error);}};
module.exports={
  forgot:handle(async(req,res)=>{await service.forgot(req.body);res.status(202).json({message:'Si corresponde, recibirá instrucciones para recuperar su contraseña.'});}),
  reset:handle(async(req,res)=>{await service.reset(req.body,{ipAddress:req.ip});res.status(204).end();}),
  changePassword:handle(async(req,res)=>{await service.changePassword(req.account.id,req.body,{ipAddress:req.ip});res.status(204).end();}),
  get:handle(async(req,res)=>res.json(await service.profile(req.account.id))),
  update:handle(async(req,res)=>res.json(await service.updateProfile(req.account.id,req.body,{ipAddress:req.ip})))
};
