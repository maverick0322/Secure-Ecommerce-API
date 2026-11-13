'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { PROJECT_ROOT,resolveConfigPath } = require('../../services/secure-config-file.service');
const gmail = require('../../services/gmail.service');
function localTokenPath(env) {
  const target=resolveConfigPath(env.GMAIL_TOKEN_PATH,env,{allowMissingLeaf:true});
  const relative=path.relative(path.join(PROJECT_ROOT,'.secrets/gmail'),target);
  gmail.requireValid(relative && !path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep));
  gmail.requireValid(target!==resolveConfigPath(env.GMAIL_CLIENT_PATH,env));
  return target;
}
function saveToken(env,config,tokens) {
  gmail.requireValid(gmail.validSecret(tokens.refresh_token),'GMAIL_REAUTH_REQUIRED');
  const target=localTokenPath(env),temporary=target+'.'+crypto.randomUUID()+'.tmp';
  const value={version:1,clientId:config.clientId,sender:config.sender,scope:gmail.SCOPE,refreshToken:tokens.refresh_token};
  let descriptor;
  try {
    descriptor=fs.openSync(temporary,'wx',0o600);
    fs.writeFileSync(descriptor,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
    gmail.requireValid(localTokenPath(env)===target);
    fs.renameSync(temporary,target);
  } finally {
    if(descriptor!==undefined)fs.closeSync(descriptor);
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}
function openBrowser(url) {
  const commands={win32:['rundll32.exe',['url.dll,FileProtocolHandler',url]],darwin:['open',[url]],linux:['xdg-open',[url]]};
  const command=commands[process.platform];gmail.requireValid(command,'GMAIL_BROWSER_UNAVAILABLE');
  return new Promise((resolve,reject)=>{
    const child=spawn(command[0],command[1],{shell:false,windowsHide:true,stdio:'ignore'});
    child.once('error',()=>reject(new gmail.GmailError('GMAIL_BROWSER_UNAVAILABLE')));
    child.once('exit',code=>code===0?resolve():reject(new gmail.GmailError('GMAIL_BROWSER_UNAVAILABLE')));
  });
}
function matchingState(value,state) {
  return typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value) &&
    crypto.timingSafeEqual(Buffer.from(value),Buffer.from(state));
}
async function authorize(env,{google=require('googleapis').google,browser=openBrowser,port=3001,timeoutMs=300000}={}) {
  const config=gmail.loadClientConfiguration(env);localTokenPath(env);
  const oauth=gmail.createOAuthClient(config,google),state=crypto.randomBytes(32).toString('base64url');
  const verifier=crypto.randomBytes(32).toString('base64url');
  const consent=oauth.generateAuthUrl({access_type:'offline',prompt:'consent',scope:[gmail.SCOPE],
    include_granted_scopes:false,login_hint:config.sender,state,
    code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  return new Promise((resolve,reject)=>{
    let finished=false,busy=false,timer;
    const server=http.createServer((req,res)=>{callback(req,res).catch(()=>{
      if(!res.headersSent)res.writeHead(400);res.end('Invalid callback.');finish(new gmail.GmailError('GMAIL_AUTHORIZATION_FAILED'));
    });});
    function finish(error) {
      if(finished)return;finished=true;clearTimeout(timer);
      server.close();if(error)server.closeAllConnections();else server.closeIdleConnections();
      if(error)reject(new gmail.GmailError(error.code==='GMAIL_REAUTH_REQUIRED'?error.code:'GMAIL_AUTHORIZATION_FAILED'));else resolve();
    }
    async function callback(req,res) {
      res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Connection','close');
      if(req.method!=='GET'||req.headers.host!=='localhost:3001'||!req.url||req.url.length>8192){res.writeHead(400);res.end('Invalid callback.');return;}
      const url=new URL(req.url,gmail.REDIRECT_URI);
      if(url.pathname!=='/oauth2/callback'){res.writeHead(404);res.end();return;}
      if(url.searchParams.getAll('state').length!==1||!matchingState(url.searchParams.get('state'),state)) {
        res.writeHead(403);res.end('Invalid authorization state.');return;
      }
      if(busy||finished){res.writeHead(409);res.end('Authorization already processed.');return;}
      busy=true;
      try {
        const code=url.searchParams.get('code');
        gmail.requireValid(!url.searchParams.has('error')&&url.searchParams.getAll('code').length===1&&
          typeof code==='string'&&code.length>0&&code.length<=4096&&!/[\u0000-\u001f\u007f]/.test(code));
        const {tokens}=await oauth.getToken({code,codeVerifier:verifier,redirect_uri:gmail.REDIRECT_URI});
        let scopes=tokens.scope?.split(' ').filter(Boolean);
        if(!scopes&&tokens.access_token)scopes=(await oauth.getTokenInfo(tokens.access_token)).scopes;
        gmail.requireValid(scopes?.length===1&&scopes[0]===gmail.SCOPE,'GMAIL_SCOPE_INVALID');
        gmail.requireValid(!finished,'GMAIL_AUTHORIZATION_EXPIRED');
        saveToken(env,config,tokens);
        res.end('Gmail authorization completed. You may close this window.');finish();
      } catch(error) {
        res.writeHead(400);res.end('Authorization failed. Restart the local authorization command.');
        finish(gmail.isInvalidGrant(error)?new gmail.GmailError('GMAIL_REAUTH_REQUIRED'):error);
      }
    }
    server.on('error',()=>finish(new gmail.GmailError('GMAIL_CALLBACK_UNAVAILABLE')));
    server.headersTimeout=10000;server.requestTimeout=10000;server.maxHeadersCount=30;
    timer=setTimeout(()=>finish(new gmail.GmailError('GMAIL_AUTHORIZATION_EXPIRED')),timeoutMs);
    server.listen(port,'127.0.0.1',()=>{Promise.resolve().then(()=>browser(consent,server.address().port)).catch(finish);});
  });
}
module.exports={authorize,matchingState,localTokenPath,saveToken};
