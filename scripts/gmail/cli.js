'use strict';
const fs=require('node:fs');
const path=require('node:path');
const dotenv=require('dotenv');
const gmail=require('../../services/gmail.service');
const {PROJECT_ROOT}=require('../../services/secure-config-file.service');
async function main(args,env,{authorize=require('./authorize').authorize,send=gmail.sendMessage,output=console.log}={}) {
  if(args.length===1&&args[0]==='check') {
    const result={client:'INVALID',refreshToken:'NOT_READY',networkAttempted:false,emailSent:false};
    try{gmail.loadClientConfiguration(env);result.client='OK';}catch{/* Only sanitized states. */}
    try{gmail.loadConfiguration(env);result.refreshToken='FILE_OK_NOT_VALIDATED_WITH_GOOGLE';}catch{/* Offline check only. */}
    output(JSON.stringify(result,null,2));return result.client==='OK'&&result.refreshToken==='FILE_OK_NOT_VALIDATED_WITH_GOOGLE';
  }
  if(args.length===1&&args[0]==='authorize'){await authorize(env);output('Gmail autorizado. No se enviaron correos.');return true;}
  gmail.requireValid(args.length===4&&args[0]==='send-test'&&args[1]==='--to'&&gmail.validMailbox(args[2])&&args[3]==='--allow-send','GMAIL_EXPLICIT_SEND_REQUIRED');
  await send({to:args[2],subject:'Prueba de Gmail API - Secure Ecommerce',text:'Prueba de configuración de Gmail API. Este mensaje no contiene códigos de registro.'});
  output('Prueba de envío completada.');return true;
}
if(require.main===module){
  const envFile=path.join(PROJECT_ROOT,'.env');
  const env={...(fs.existsSync(envFile)?dotenv.parse(fs.readFileSync(envFile)):{}),...process.env};
  // The production sender reads process.env; the CLI uses the same merged local configuration.
  Object.assign(process.env,env);
  main(process.argv.slice(2),env).then(ok=>{if(!ok)process.exitCode=1;}).catch(error=>{
    console.error(error?.code==='GMAIL_REAUTH_REQUIRED'?'GMAIL_REAUTH_REQUIRED: ejecute npm run gmail:authorize':'Gmail no está listo. Revise la configuración o vuelva a autorizar con npm run gmail:authorize.');
    process.exitCode=1;
  });
}
module.exports={main};
