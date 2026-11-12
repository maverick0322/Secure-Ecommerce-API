'use strict';
const audit=require('../services/audit.service');
const {respondError}=require('../services/accounts.service');
module.exports.getAll=async(req,res)=>{
  try {return res.json(await audit.list(req.query));} catch(error){return respondError(res,error);}
};
