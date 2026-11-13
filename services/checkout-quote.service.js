'use strict';
const jwt=require('jsonwebtoken');
const {createHmac}=require('node:crypto');
const {getJwtSecret}=require('./jwttoken.service');
const {AccountError}=require('./accounts.service');
function key(){return createHmac('sha256',getJwtSecret()).update('secure-ecommerce-checkout-v1').digest();}
function sign(buyerId,content){
  const token=jwt.sign(content,key(),{algorithm:'HS256',subject:buyerId,issuer:'secure-ecommerce',audience:'checkout',expiresIn:'10m'});
  if(token.length>90000)throw new AccountError(409,'El contenido de la compra supera el tamaño permitido.');
  return token;
}
function verify(token,buyerId){
  try{
    if(typeof token!=='string' || token.length>100000) throw new Error('invalid');
    const content=jwt.verify(token,key(),{algorithms:['HS256'],issuer:'secure-ecommerce',audience:'checkout',subject:buyerId,ignoreExpiration:true});
    if(!Number.isInteger(content.exp) || !Array.isArray(content.items) || !content.checkoutId) throw new Error('invalid');
    return content;
  }catch{throw new AccountError(400,'Cotización inválida.');}
}
module.exports={sign,verify};
