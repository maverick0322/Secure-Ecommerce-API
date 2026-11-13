'use strict';
// Protected interactive provisioning tool, never imported by an HTTP route.
const readline=require('node:readline/promises');
const {Writable}=require('node:stream');
const {randomInt,randomBytes,createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {Sequelize}=require('sequelize');
const bcrypt=require('bcrypt');
require('dotenv').config();
require('dotenv').config({path:'.env.admin-bootstrap.local'});
async function createVerifiedAdmin(connection,{id,email,name,passwordHash,verifiedAt}){
  return connection.transaction(async transaction=>{
    const options={transaction,replacements:{id,email,name,passwordHash,verifiedAt}};
    await connection.query(`INSERT INTO users (id,email,name,passwordHash,status,emailVerifiedAt,createdAt,updatedAt)
      VALUES (:id,:email,:name,:passwordHash,'ACTIVE',:verifiedAt,:verifiedAt,:verifiedAt)`,options);
    await connection.query('INSERT INTO admins (userId) VALUES (:id)',options);
    await connection.query(`INSERT INTO audit_logs (actorUserId,action,targetType,targetId,outcome,occurredAt)
      VALUES (:id,'admin.bootstrap','user',:id,'SUCCESS',:verifiedAt)`,options);
    return id;
  });
}
async function main(){
  if(!process.stdin.isTTY || process.argv.length!==2)throw new Error('Use una terminal protegida sin argumentos de credenciales.');
  const {BOOTSTRAP_DB_USER,BOOTSTRAP_DB_PASSWORD,BOOTSTRAP_DB_UUID}=process.env;
  if(BOOTSTRAP_DB_USER!=='ecommerce_admin_bootstrap'||!BOOTSTRAP_DB_PASSWORD||!BOOTSTRAP_DB_UUID)throw new Error('Configure la cuenta de aprovisionamiento y UUID esperado.');
  let muted=false;
  const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
  const input=readline.createInterface({input:process.stdin,output,terminal:true});let connection;
  try{
    const accounts=require('../../services/accounts.service');
    const email=await accounts.normalizeEmail(await input.question('Correo real a verificar: '));
    const name=accounts.text(await input.question('Nombre: '),120,'Nombre inválido.');
    process.stdout.write('Contraseña (entrada oculta): ');muted=true;
    const password=accounts.newPassword(await input.question(''));muted=false;process.stdout.write('\n');
    const code=String(randomInt(1000000)).padStart(6,'0');const key=randomBytes(32);
    const digest=value=>createHmac('sha256',key).update(value).digest();const expected=digest(code);const expires=Date.now()+600000;
    await require('../../services/registration-email.service').sendVerificationCode(email,code);
    let verified=false;
    for(let attempt=0;attempt<5;attempt++){
      process.stdout.write('Código recibido (entrada oculta): ');muted=true;const supplied=await input.question('');muted=false;process.stdout.write('\n');
      if(Date.now()>expires)break;
      if(timingSafeEqual(expected,digest(supplied))){verified=true;break;}
    }
    if(!verified)throw new Error('Verificación fallida o expirada.');
    connection=new Sequelize('secure_ecommerce',BOOTSTRAP_DB_USER,BOOTSTRAP_DB_PASSWORD,{host:process.env.BOOTSTRAP_DB_HOST||'127.0.0.1',port:Number(process.env.BOOTSTRAP_DB_PORT||3307),dialect:'mysql',timezone:'+00:00',logging:false});
    const [[identity]]=await connection.query('SELECT DATABASE() AS db,CURRENT_USER() AS account,@@server_uuid AS uuid,@@session.foreign_key_checks AS fks,@@session.sql_mode AS mode');
    if(identity.db!=='secure_ecommerce'||!identity.account.startsWith('ecommerce_admin_bootstrap@')||identity.uuid!==BOOTSTRAP_DB_UUID||Number(identity.fks)!==1||!/STRICT_(TRANS|ALL)_TABLES/.test(identity.mode))throw new Error('Destino inválido.');
    await createVerifiedAdmin(connection,{id:randomUUID(),email,name,passwordHash:await bcrypt.hash(password,12),verifiedAt:new Date()});
    console.log('Cuenta administrativa verificada y creada atómicamente.');
  }finally{muted=false;input.close();if(connection)await connection.close();}
}
if(require.main===module)main().catch(()=>{console.error('No se creó la cuenta. Revise verificación, destino y permisos de aprovisionamiento.');process.exitCode=1;});
module.exports={createVerifiedAdmin};
