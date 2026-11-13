'use strict';
const { AccountError } = require('../services/accounts.service');
function productId(value) {
  const number = typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) throw new AccountError(400,'Producto inválido.');
  return number;
}
function cartInput(body, create = false) {
  const fields = create ? ['productId','quantity'] : ['quantity'];
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== fields.length ||
    fields.some(key => !Object.hasOwn(body,key)) || !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 4294967295) {
    throw new AccountError(400,'Indique únicamente una cantidad entera positiva y, al agregar, productId.');
  }
  return {quantity:body.quantity,...(create && {productId:productId(body.productId)})};
}
module.exports = {cartInput,productId};
