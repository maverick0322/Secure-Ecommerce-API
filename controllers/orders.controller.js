'use strict';
const orders=require('../services/orders.service');
const input=require('../validators/orders');
const {respondError,AccountError}=require('../services/accounts.service');
const handle=work=>async(req,res)=>{try{await work(req,res);}catch(error){
  if([1213,1205,1062].includes(error.original?.errno)) error=new AccountError(409,'Conflicto concurrente; reintente la misma solicitud.');
  respondError(res,error);
}};
module.exports={
  quote:handle(async(req,res)=>res.json(await orders.quote(req.account.id,input.quoteInput(req.body).addressId))),
  confirm:handle(async(req,res)=>{const result=await orders.confirm(req.account.id,input.confirmInput(req.body),req.ip);res.status(result.replayed?200:201).json(result);}),
  list:handle(async(req,res)=>res.json(await orders.list(req.account))),
  get:handle(async(req,res)=>res.json(await orders.get(req.account,input.orderId(req.params.id)))),
  transition:handle(async(req,res)=>res.json(await orders.transition(req.account,input.orderId(req.params.id),input.transitionInput(req.body),req.ip)))
};
