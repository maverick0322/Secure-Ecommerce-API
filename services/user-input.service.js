'use strict';
const accounts=require('./accounts.service');
function object(value,allowed,required=[]){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw new accounts.AccountError(400,'Campos inválidos.');
  return value;
}
function name(value){const text=accounts.text(value,120,'Nombre inválido.');if(/[\u0000-\u001f\u007f]/u.test(text))throw new accounts.AccountError(400,'Nombre inválido.');return text;}
function phone(value){
  if(value===null||value===undefined)return null;
  if(typeof value!=='string'||!/^\+?[0-9][0-9 ()-]{5,19}$/.test(value.trim())||value.trim().length>20)throw new accounts.AccountError(400,'Teléfono inválido.');
  return value.trim();
}
async function registration(value){
  object(value,['profile','email','name','password','phoneNumber','storeName'],['profile','email','name','password']);
  if(!['BUYER','SELLER'].includes(value.profile)||(value.profile==='BUYER'&&Object.hasOwn(value,'storeName')))throw new accounts.AccountError(400,'Seleccione BUYER o SELLER y sus campos correspondientes.');
  return {profile:value.profile,email:await accounts.normalizeEmail(value.email),name:name(value.name),password:accounts.newPassword(value.password),phoneNumber:phone(value.phoneNumber),
    ...(value.profile==='SELLER'?{storeName:name(value.storeName)}:{})};
}
module.exports={object,name,phone,registration};
