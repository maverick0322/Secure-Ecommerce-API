'use strict';
const cart = require('../services/cart.service');
const {cartInput,productId} = require('../validators/cart');
const {respondError} = require('../services/accounts.service');
const handle = work => async (req,res) => {try {await work(req,res);} catch(error) {respondError(res,error);} };
module.exports = {
  get:handle(async (req,res) => res.json(await cart.get(req.account.id,{ipAddress:req.ip}))),
  add:handle(async (req,res) => {
    const input=cartInput(req.body,true); const result=await cart.put(req.account.id,input.productId,input.quantity,true,{ipAddress:req.ip});
    res.status(200).json(result);
  }),
  update:handle(async (req,res) => {
    const input=cartInput(req.body); const id=productId(req.params.productId); const result=await cart.put(req.account.id,id,input.quantity,false,{ipAddress:req.ip});
    res.json(result);
  }),
  remove:handle(async (req,res) => {
    const id=productId(req.params.productId); await cart.remove(req.account.id,id,{ipAddress:req.ip});
    res.status(204).end();
  })
};
