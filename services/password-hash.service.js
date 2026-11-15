'use strict';
const {scrypt,randomBytes,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const bcrypt=require('bcrypt');
const policy=require('./password-policy.service');
const derive=promisify(scrypt);
const format=/^\$scrypt\$v1\$32768\$8\$3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;
const legacy=/^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;
let active=0;const waiting=[];
async function bounded(work){
  if(active>=2){
    if(waiting.length>=16){const error=new Error('Password service unavailable.');error.code='PASSWORD_SERVICE_BUSY';throw error;}
    await new Promise(resolve=>waiting.push(resolve));
  }else active++;
  try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}
}
async function key(password,salt){return derive(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});}
function isEncodedHash(value){return typeof value==='string'&&(legacy.test(value)||format.test(value));}
async function hash(password){
  if(!policy.acceptable(password))throw new TypeError('Invalid new password.');
  return bounded(async()=>{const salt=randomBytes(16),digest=await key(password,salt);
    return '$scrypt$v1$32768$8$3$'+salt.toString('base64url')+'$'+digest.toString('base64url');});
}
async function verify(password,encoded){
  if(!policy.validInput(password)||!isEncodedHash(encoded))return false;
  return bounded(async()=>{
    if(legacy.test(encoded)){
      // Do the work even for an overlong legacy candidate, but never authorize
      // using bcrypt's silent truncation of that candidate.
      const fits=Buffer.byteLength(password,'utf8')<=72;
      const match=await bcrypt.compare(fits?password:'invalid-overlong-legacy-candidate',encoded.replace(/^\$2y\$/,'$2b$'));
      return fits&&match;
    }
    const [,saltText,digestText]=format.exec(encoded);
    const salt=Buffer.from(saltText,'base64url'),expected=Buffer.from(digestText,'base64url');
    if(salt.toString('base64url')!==saltText||expected.toString('base64url')!==digestText)return false;
    return timingSafeEqual(await key(password,salt),expected);
  });
}
module.exports={hash,verify,isEncodedHash};
