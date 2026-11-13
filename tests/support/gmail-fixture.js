'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PROJECT_ROOT}=require('../../services/secure-config-file.service');
const {SCOPE,REDIRECT_URI}=require('../../services/gmail.service');
module.exports=function fixture({token=true}={}){
  const parent=path.join(PROJECT_ROOT,'.secrets/gmail');fs.mkdirSync(parent,{recursive:true});
  const directory=fs.mkdtempSync(path.join(parent,'test-'));
  const clientId='synthetic-client.apps.googleusercontent.com',clientSecret=crypto.randomBytes(24).toString('base64url');
  const refreshToken=crypto.randomBytes(32).toString('base64url');
  const clientFile=path.join(directory,'client.json'),tokenFile=path.join(directory,'token.json');
  const env={GMAIL_CLIENT_PATH:clientFile,GMAIL_TOKEN_PATH:tokenFile,GMAIL_SENDER_EMAIL:'sender@example.invalid',GMAIL_REDIRECT_URI:REDIRECT_URI};
  const client={web:{client_id:clientId,client_secret:clientSecret,redirect_uris:[REDIRECT_URI],token_uri:'https://oauth2.googleapis.com/token'}};
  fs.writeFileSync(clientFile,JSON.stringify(client));
  if(token)fs.writeFileSync(tokenFile,JSON.stringify({version:1,clientId,sender:env.GMAIL_SENDER_EMAIL,scope:SCOPE,refreshToken}));
  return {env,client,clientFile,tokenFile,refreshToken,clientSecret,directory,cleanup(){
    if(!directory.startsWith(path.join(parent,'test-')))throw new Error('Unsafe fixture cleanup');
    fs.rmSync(directory,{recursive:true,force:true});
  }};
};
