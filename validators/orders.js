'use strict';
const {AccountError}=require('../services/accounts.service');
const {addressId}=require('./address');
function only(body,keys){
  if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!keys.includes(k))) throw new AccountError(400,'Campos de solicitud inválidos.');
}
function quoteInput(body){only(body,['addressId']);return {addressId:addressId(body.addressId)};}
function confirmInput(body){only(body,['quote']);if(typeof body.quote!=='string'||!body.quote||body.quote.length>100000) throw new AccountError(400,'Indique la cotización firmada.');return body.quote;}
function transitionInput(body){
  only(body,['status','reason']);
  if(!['PREPARING','SHIPPED','DELIVERED','CANCELED'].includes(body.status)) throw new AccountError(400,'Estado inválido.');
  let reason=null;
  if(body.reason!==undefined){if(typeof body.reason!=='string'||!body.reason.trim()||[...body.reason.trim()].length>255||/[\u0000-\u001f\u007f]/.test(body.reason)) throw new AccountError(400,'Motivo inválido.'); reason=body.reason.trim();}
  if(body.status==='CANCELED'&&!reason) throw new AccountError(400,'La cancelación requiere un motivo.');
  return {status:body.status,reason};
}
module.exports={quoteInput,confirmInput,transitionInput,orderId:addressId};
