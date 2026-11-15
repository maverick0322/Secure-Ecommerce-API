'use strict';
// No environment, provider client or credentials are loaded by this script.
const fs=require('node:fs'),path=require('node:path');
const {verification}=require('../../services/email-template.service');
const output=path.resolve(__dirname,'../../log/email-preview');
fs.mkdirSync(output,{recursive:true});
for(const purpose of ['registration','recovery']){
  const message=verification({code:'123456',purpose,name:'Persona de ejemplo'});
  fs.writeFileSync(path.join(output,purpose+'.html'),message.html);
  fs.writeFileSync(path.join(output,purpose+'.txt'),message.text);
}
console.log('Vistas previas ficticias: log/email-preview/registration.html y recovery.html');
