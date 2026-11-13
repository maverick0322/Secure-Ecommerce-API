'use strict';

const addresses = require('../services/addresses.service');
const { addressInput, addressId } = require('../validators/address');
const { respondError } = require('../services/accounts.service');

const handler = work => async (req, res) => {
  try { await work(req, res); } catch (error) { respondError(res, error); }
};
const serialize = row => ({ ...(row.toJSON ? row.toJSON() : row), id: String(row.id) });

module.exports = {
  list: handler(async (req, res) => res.json((await addresses.list(req.account.id)).map(serialize))),
  create: handler(async (req, res) => {
    const row=await addresses.create(req.account.id,addressInput(req.body),{ipAddress:req.ip});
    res.status(201).json(serialize(row));
  }),
  update: handler(async (req, res) => {
    await addresses.update(req.account.id, addressId(req.params.id), addressInput(req.body, true),{ipAddress:req.ip});
    res.status(204).end();
  }),
  remove: handler(async (req, res) => {
    await addresses.remove(req.account.id, addressId(req.params.id),{ipAddress:req.ip});
    res.status(204).end();
  }),
  setDefault: handler(async (req, res) => {
    await addresses.update(req.account.id, addressId(req.params.id), { isDefault: true },{ipAddress:req.ip});
    res.status(204).end();
  })
};
