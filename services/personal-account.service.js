'use strict';
const {createHash}=require('node:crypto');
const db=require('../models'),accounts=require('./accounts.service'),hashes=require('./password-hash.service');
const input=require('./user-input.service'),otp=require('./email-verification.service');
const invalid=()=>new accounts.AccountError(400,'El código es inválido o ha caducado.');
const version=hash=>createHash('sha256').update(hash).digest('hex');
const recoveryQueue=[],recoveryPending=new Set(),recoveryIdle=[];
let recoveryActive=0;
function startRecoveryWorkers(){
  while(recoveryActive<2&&recoveryQueue.length){
    const job=recoveryQueue.shift();recoveryActive++;
    const logger=require('./structured-logger.service');
    void logger.context.run({requestId:job.requestId},async()=>{
      try {
        const account=await accounts.findAccountByEmail(job.email,true);
        const pending=accounts.isActive(account)&&accounts.accountType(account)?Object.freeze({userId:account.id,version:version(account.passwordHash)}):null;
        // Unknown/ineligible addresses consume no OTP storage. Their HTTP
        // response was already accepted before this private lookup completed.
        if(pending)await otp.issue(job.email,pending,'recovery');
      } catch {logger.log('auth.recovery.delivery.failed');}
    }).finally(()=>{
      recoveryActive--;recoveryPending.delete(job.email);startRecoveryWorkers();
      if(!recoveryPending.size)for(const resolve of recoveryIdle.splice(0))resolve();
    });
  }
}
// Internal drain hook for tests/shutdown coordination, never an HTTP endpoint.
function whenRecoveryIdle(){return recoveryPending.size?new Promise(resolve=>recoveryIdle.push(resolve)):Promise.resolve();}
async function beginRegistration(body){
  const form=await input.registration(body),{password,...data}=form;
  // Include soft-deleted accounts: their email is still protected by UNIQUE.
  if(await db.User.findOne({where:{email:data.email},paranoid:false})){
    throw new accounts.AccountError(409,'El correo electrónico ya está registrado.');
  }
  const pending=Object.freeze({...data,passwordHash:await hashes.hash(password)});
  await otp.issue(pending.email,pending,'registration');
}
async function finishRegistration(body,context={}){
  input.object(body,['email','code'],['email','code']);const email=await accounts.normalizeEmail(body.email);
  return otp.verify(email,body.code,pending=>{
    if(!pending||pending.email!==email)throw invalid();
    return accounts.createVerifiedRegistration(pending,context);
  },'registration');
}
async function forgot(body){
  input.object(body,['email'],['email']);const email=await accounts.normalizeEmail(body.email);
  // Neither SQL account lookup nor provider latency is on the public response
  // path. Admission/deduplication is the same for known and unknown addresses.
  if(recoveryPending.has(email))return;
  if(recoveryPending.size>=32){require('./structured-logger.service').log('auth.recovery.delivery.failed');return;}
  recoveryPending.add(email);
  recoveryQueue.push({email,requestId:require('./structured-logger.service').context.getStore()?.requestId});
  setImmediate(startRecoveryWorkers);
}
async function writePassword(user,passwordHash,transaction,action,context){
  const {sessions}=await require('./auth-runtime.service').getRuntime();
  await sessions.revokeAll({userId:user.id});
  await user.update({passwordHash},{transaction,fields:['passwordHash','updatedAt']});
  await require('./audit.service').business(user.id,action,'user',user.id,transaction,context);
}
async function reset(body,context={}){
  input.object(body,['email','code','newPassword'],['email','code','newPassword']);
  const email=await accounts.normalizeEmail(body.email),password=accounts.newPassword(body.newPassword);
  return otp.verify(email,body.code,async pending=>{
    if(!pending)throw invalid();const passwordHash=await hashes.hash(password);
    return db.sequelize.transaction(async transaction=>{
      const user=await db.User.unscoped().findByPk(pending.userId,{transaction,lock:transaction.LOCK.UPDATE});
      if(!accounts.isActive(user)||user.email.trim().toLowerCase()!==email||version(user.passwordHash)!==pending.version)throw invalid();
      await writePassword(user,passwordHash,transaction,'password.reset',context);
    });
  },'recovery');
}
async function changePassword(userId,body,context={}){
  input.object(body,['currentPassword','newPassword'],['currentPassword','newPassword']);
  if(!accounts.validPassword(body.currentPassword))throw new accounts.AccountError(400,'Contraseña actual inválida.');
  const passwordHash=await hashes.hash(accounts.newPassword(body.newPassword));
  return db.sequelize.transaction(async transaction=>{
    const user=await db.User.unscoped().findByPk(userId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!accounts.isActive(user))throw new accounts.AccountError(403,'Cuenta no disponible.');
    if(!await hashes.verify(body.currentPassword,user.passwordHash))throw new accounts.AccountError(400,'Contraseña actual incorrecta.');
    await writePassword(user,passwordHash,transaction,'password.change',context);
  });
}
function serialize(user){
  return {...accounts.serializeAccount(user),phoneNumber:user.phoneNumber??null,
    ...(user.seller?{storeName:user.seller.storeName,sellerStatus:user.seller.status}:{})};
}
async function profile(userId){
  const user=await db.User.findByPk(userId,{include:[{association:'admin'},{association:'seller'},{association:'buyer'}]});
  if(!accounts.isActive(user)||!accounts.accountType(user))throw new accounts.AccountError(403,'Cuenta no disponible.');
  return serialize(user);
}
async function updateProfile(userId,body,context={}){
  input.object(body,['name','phoneNumber','storeName']);if(!Object.keys(body).length)throw new accounts.AccountError(400,'Indique campos del perfil.');
  const changes={};if(Object.hasOwn(body,'name'))changes.name=input.name(body.name);
  if(Object.hasOwn(body,'phoneNumber'))changes.phoneNumber=input.phone(body.phoneNumber);
  const storeName=Object.hasOwn(body,'storeName')?input.name(body.storeName):undefined;
  await db.sequelize.transaction(async transaction=>{
    const user=await db.User.findByPk(userId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!accounts.isActive(user))throw new accounts.AccountError(403,'Cuenta no disponible.');
    if(storeName!==undefined){const seller=await db.Seller.findByPk(userId,{transaction,lock:transaction.LOCK.UPDATE});
      if(!seller)throw new accounts.AccountError(403,'Solo SELLER puede editar storeName.');
      await seller.update({storeName},{transaction,fields:['storeName','updatedAt']});}
    if(Object.keys(changes).length)await user.update(changes,{transaction,fields:[...Object.keys(changes),'updatedAt']});
    await require('./audit.service').business(userId,'profile.update','user',userId,transaction,context);
  });
  return profile(userId);
}
module.exports={beginRegistration,finishRegistration,forgot,reset,changePassword,profile,updateProfile,whenRecoveryIdle};
