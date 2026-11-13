'use strict';

const { AccountError } = require('../services/accounts.service');
const required = { recipientName: 120, street: 255, exteriorNumber: 20, neighborhood: 120, city: 120, state: 120, postalCode: 12 };
const optional = { label: 40, interiorNumber: 20 };

function addressInput(body, partial = false) {
  const fail = () => { throw new AccountError(400, 'Los campos de la dirección no son válidos.'); };
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) fail();
  const allowed = [...Object.keys(required), ...Object.keys(optional), 'country', 'isDefault'];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail();
  const result = {};
  for (const [key, max] of Object.entries({ ...required, ...optional })) {
    if (!Object.hasOwn(body, key)) {
      if (!partial && Object.hasOwn(required, key)) fail();
      continue;
    }
    const value = body[key];
    if (value === null && Object.hasOwn(optional, key)) { result[key] = null; continue; }
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max || /[\u0000-\u001f\u007f]/.test(value)) fail();
    result[key] = value.trim();
  }
  if (Object.hasOwn(body, 'country')) {
    if (typeof body.country !== 'string' || !/^[A-Z]{2}$/.test(body.country)) fail();
    result.country = body.country;
  }
  if (Object.hasOwn(body, 'isDefault')) {
    if (typeof body.isDefault !== 'boolean') fail();
    result.isDefault = body.isDefault;
  }
  return result;
}

function addressId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) > 18446744073709551615n) {
    throw new AccountError(400, 'Identificador de dirección inválido.');
  }
  return value;
}

module.exports = { addressInput, addressId };
