'use strict';
const {isIP}=require('node:net');
const {AuditLog,Sequelize}=require('../models');
const {isUuid}=require('./jwttoken.service');
const {AccountError}=require('./accounts.service');
const fields=['id','actorUserId','action','targetType','targetId','ipAddress','outcome','occurredAt'];
function sanitize(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const result={};
  for (const key of ['status','previousStatus','productId','quantity','checkoutId','orderId']) {
    const value=details[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key]=value;
    if (typeof value === 'string' && value.length <= 64 && /^[\w-]+$/.test(value)) result[key]=value;
  }
  if (typeof details.reason === 'string') {
    result.reason = [...details.reason].slice(0,255).join('')
      .replace(/[\u0000-\u001f\u007f]/g,' ')
      .replace(/(?:password|contraseña|token|secret|api[_ -]?key|otp|code)\s*[:=].*/gi,'[REDACTED]')
      .replace(/[A-Za-z0-9_+\/=-]{32,}(?:\.[A-Za-z0-9_+\/=-]+)*/g,'[REDACTED]')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[REDACTED]');
  }
  return Object.keys(result).length ? result : null;
}
function write({actorUserId,action,targetType=null,targetId=null,ipAddress=null,outcome='SUCCESS',details=null},options={}) {
  if (typeof action !== 'string' || !/^[\w.-]{1,80}$/.test(action) || !['SUCCESS','DENIED','ERROR'].includes(outcome)) throw new AccountError(400,'Evento de auditoría inválido.');
  return AuditLog.create({actorUserId:isUuid(actorUserId) ? actorUserId : null,action,
    targetType:typeof targetType === 'string' ? targetType.slice(0,40) : null,
    targetId:targetId == null ? null : String(targetId).slice(0,64),
    ipAddress:isIP(ipAddress || '') ? ipAddress : null,outcome,details:sanitize(details),occurredAt:new Date()},options);
}
async function list(query={}) {
  if (Object.keys(query).some(key => !['before','limit'].includes(key))) throw new AccountError(400,'Consulta inválida.');
  const limit=query.limit === undefined ? 50 : Number(query.limit);
  if((query.limit!==undefined && (typeof query.limit!=='string'||!/^\d{1,3}$/.test(query.limit)))||
    (query.before!==undefined && typeof query.before!=='string')) throw new AccountError(400,'Paginación inválida.');
  if (!Number.isInteger(limit) || limit<1 || limit>100 || (query.before !== undefined && !/^[1-9]\d{0,9}$/.test(query.before))) throw new AccountError(400,'Paginación inválida.');
  const before=query.before === undefined ? null : Number(query.before);
  if (before !== null && before>2147483647) throw new AccountError(400,'Paginación inválida.');
  try {return await AuditLog.findAll({attributes:fields,where:before ? {id:{[Sequelize.Op.lt]:before}} : {},limit,order:[['id','DESC']]});}
  catch(error) {
    if ([1142,1143].includes(error.original?.errno)) throw new AccountError(503,'La lectura de auditoría requiere aprovisionamiento autorizado.');
    throw error;
  }
}
function business(actorUserId,action,targetType,targetId,transaction,context={}) {
  if (!transaction) throw new Error('Business audit requires a transaction.');
  return module.exports.write({actorUserId,action,targetType,targetId,
    ipAddress:context.ipAddress,details:context.details},{transaction});
}
module.exports={write,list,sanitize,business};
