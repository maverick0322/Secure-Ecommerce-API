'use strict';
const fs=require('node:fs');
const http=require('node:http');
const {google}=require('googleapis');
const fixture=require('../support/gmail-fixture');
const gmail=require('../../services/gmail.service');
const {authorize,localTokenPath,saveToken}=require('../../scripts/gmail/authorize');
const {main}=require('../../scripts/gmail/cli');
let f;
beforeEach(()=>{f=fixture({token:false});});
afterEach(()=>{jest.restoreAllMocks();f.cleanup();});
function provider(tokens={scope:gmail.SCOPE,refresh_token:'synthetic-refresh-token',access_token:'synthetic-access'}){
  const getToken=jest.fn(async()=>({tokens})),getTokenInfo=jest.fn(async()=>({scopes:[gmail.SCOPE]}));
  const api={auth:{OAuth2:class extends google.auth.OAuth2{constructor(options){super(options);this.getToken=getToken;this.getTokenInfo=getTokenInfo;}}}};
  return {api,getToken,getTokenInfo};
}
function callback(port,query,pathname='/oauth2/callback'){
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:pathname+'?'+new URLSearchParams(query),headers:{Host:'localhost:3001'}},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode));
    });req.on('error',reject);
  });
}
it('requests only gmail.send, offline consent and PKCE, and atomically saves only the refresh token',async()=>{
  const p=provider();let response;
  await authorize(f.env,{google:p.api,port:0,browser:async(url,port)=>{
    const u=new URL(url);expect(u.origin).toBe('https://accounts.google.com');
    expect(u.searchParams.get('scope')).toBe(gmail.SCOPE);expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(gmail.REDIRECT_URI);
    response=callback(port,{state:u.searchParams.get('state'),code:'synthetic-code'});await response;
  }});
  expect(await response).toBe(200);expect(p.getToken).toHaveBeenCalledTimes(1);
  const request=p.getToken.mock.calls[0][0];expect(request.codeVerifier.length).toBeGreaterThanOrEqual(43);
  const token=JSON.parse(fs.readFileSync(f.tokenFile));expect(token.scope).toBe(gmail.SCOPE);expect(token.version).toBe(1);
  expect(Object.hasOwn(token,'access_token')||Object.hasOwn(token,'clientSecret')).toBe(false);
});
it('rejects invalid state without exchanging a code, then accepts the real callback once',async()=>{
  const p=provider();let bad;
  await authorize(f.env,{google:p.api,port:0,browser:async(url,port)=>{
    bad=await callback(port,{state:'x'.repeat(43),code:'fake'});expect(p.getToken).not.toHaveBeenCalled();
    await callback(port,{state:new URL(url).searchParams.get('state'),code:'synthetic-code'});
  }});
  expect(bad).toBe(403);expect(p.getToken).toHaveBeenCalledTimes(1);
});
it.each(['extra-scope','missing-refresh','access-denied'])('does not publish unusable credentials: %s',async kind=>{
  const tokens={scope:gmail.SCOPE,refresh_token:'synthetic-refresh-token'};
  if(kind==='extra-scope')tokens.scope+=' https://mail.google.com/';if(kind==='missing-refresh')delete tokens.refresh_token;
  const p=provider(tokens);
  await expect(authorize(f.env,{google:p.api,port:0,browser:async(url,port)=>{
    const query={state:new URL(url).searchParams.get('state'),code:'synthetic-code'};
    if(kind==='access-denied'){delete query.code;query.error='access_denied';}
    await callback(port,query).catch(()=>{});
  }})).rejects.toBeInstanceOf(gmail.GmailError);
  expect(fs.existsSync(f.tokenFile)).toBe(false);
});
it('handles browser failure and callback timeout without token files',async()=>{
  const p=provider();
  await expect(authorize(f.env,{google:p.api,port:0,browser:async()=>{throw new Error('No browser');}})).rejects.toBeInstanceOf(gmail.GmailError);
  await expect(authorize(f.env,{google:p.api,port:0,timeoutMs:30,browser:async()=>{}})).rejects.toBeInstanceOf(gmail.GmailError);
  expect(fs.existsSync(f.tokenFile)).toBe(false);
});
it('exchanges a code only once when two valid callbacks arrive concurrently',async()=>{
  const p=provider();let requests;
  p.getToken.mockImplementation(async()=>{await new Promise(resolve=>setTimeout(resolve,30));return {tokens:{scope:gmail.SCOPE,refresh_token:'synthetic-refresh-token'}};});
  await authorize(f.env,{google:p.api,port:0,browser:async(url,port)=>{
    const query={state:new URL(url).searchParams.get('state'),code:'synthetic-code'};
    requests=Promise.all([callback(port,query),callback(port,query)]);await requests;
  }});
  expect((await requests).sort()).toEqual([200,409]);expect(p.getToken).toHaveBeenCalledTimes(1);
});
it('does not persist a token returned after the authorization timeout',async()=>{
  const p=provider();let release,response;
  p.getToken.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
  await expect(authorize(f.env,{google:p.api,port:0,timeoutMs:150,browser:async(url,port)=>{
    response=callback(port,{state:new URL(url).searchParams.get('state'),code:'synthetic-code'}).catch(()=>{});await response;
  }})).rejects.toBeInstanceOf(gmail.GmailError);
  release({tokens:{scope:gmail.SCOPE,refresh_token:'synthetic-late-refresh'}});
  await new Promise(resolve=>setTimeout(resolve,10));await response;expect(fs.existsSync(f.tokenFile)).toBe(false);
});
it('leaves an occupied port untouched and never opens a browser',async()=>{
  const occupied=http.createServer((req,res)=>res.end('fixture'));
  await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));const browser=jest.fn();
  try{await expect(authorize(f.env,{google:provider().api,port:occupied.address().port,browser})).rejects.toBeInstanceOf(gmail.GmailError);
    expect(browser).not.toHaveBeenCalled();expect(occupied.listening).toBe(true);}finally{await new Promise(resolve=>occupied.close(resolve));}
});
it('never overwrites client credentials or files outside the Gmail directory',()=>{
  expect(()=>localTokenPath({...f.env,GMAIL_TOKEN_PATH:f.clientFile})).toThrow();
  expect(()=>localTokenPath({...f.env,GMAIL_TOKEN_PATH:require('node:path').join(f.directory,'../../auth/access-private.pem')})).toThrow();
});
it('preserves the current token if atomic replacement fails and cleans its private temporary file',()=>{
  fs.writeFileSync(f.tokenFile,JSON.stringify({refreshToken:'existing-synthetic-value'}));const before=fs.readFileSync(f.tokenFile);
  jest.spyOn(fs,'renameSync').mockImplementation(()=>{throw new Error('Synthetic lock');});
  expect(()=>saveToken(f.env,gmail.loadClientConfiguration(f.env),{refresh_token:'synthetic-replacement-token'})).toThrow();
  expect(fs.readFileSync(f.tokenFile).equals(before)).toBe(true);expect(fs.readdirSync(f.directory).some(n=>n.endsWith('.tmp'))).toBe(false);
});
it('checks offline and requires an explicit send command; neither check nor authorization sends email',async()=>{
  const output=jest.fn(),send=jest.fn(),auth=jest.fn(async()=>{});
  expect(await main(['check'],f.env,{output,send})).toBe(false);expect(send).not.toHaveBeenCalled();
  await main(['authorize'],f.env,{output,send,authorize:auth});expect(auth).toHaveBeenCalledTimes(1);expect(send).not.toHaveBeenCalled();
  await expect(main(['send-test','--to','buyer@example.invalid'],f.env,{output,send})).rejects.toMatchObject({code:'GMAIL_EXPLICIT_SEND_REQUIRED'});
  await main(['send-test','--to','buyer@example.invalid','--allow-send'],f.env,{output,send});expect(send).toHaveBeenCalledTimes(1);
});
