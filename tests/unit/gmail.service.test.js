'use strict';
const fs=require('node:fs');
const {google}=require('googleapis');
const service=require('../../services/gmail.service');
const fixture=require('../support/gmail-fixture');
let f;
beforeEach(()=>{f=fixture();});
afterEach(()=>{jest.restoreAllMocks();f.cleanup();});
function provider(){
  const clients=[],transport=jest.fn(async()=>({data:{access_token:'synthetic-access',expires_in:3600,token_type:'Bearer'}}));
  const send=jest.fn(async()=>({data:{id:'synthetic-message'}}));
  const api={auth:{OAuth2:class extends google.auth.OAuth2{constructor(options){super(options);this.transporter.request=transport;clients.push(this);}}},
    gmail:jest.fn(()=>({users:{messages:{send}}}))};
  const warn=jest.fn(),sender=service.createGmailSender({google:api,load:()=>service.loadConfiguration(f.env),warn});
  return {clients,transport,send,api,warn,sender};
}
const message={to:'buyer@example.invalid',subject:'Verifica tu correo',text:'Código sintético. Caduca en 10 minutos.'};
it('loads protected downloaded JSON, enforces the existing redirect and binds refresh to client and sender',()=>{
  expect(service.loadConfiguration(f.env).refreshToken===f.refreshToken).toBe(true);
  const token=JSON.parse(fs.readFileSync(f.tokenFile));token.sender='other@example.invalid';fs.writeFileSync(f.tokenFile,JSON.stringify(token));
  expect(()=>service.loadConfiguration(f.env)).toThrow(service.GmailError);
});
it.each(['redirect','endpoint','client','secret','sender','path'])('rejects unsafe or missing configuration: %s',kind=>{
  if(kind==='redirect')f.client.web.redirect_uris=['http://localhost:3002/callback'];
  if(kind==='endpoint')f.client.web.token_uri='https://untrusted.invalid/token';
  if(kind==='client')f.client.web.client_id='not-a-google-client';
  if(kind==='secret')f.client.web.client_secret='';
  if(kind==='sender')f.env.GMAIL_SENDER_EMAIL='sender@example.invalid\r\nBcc: victim@example.invalid';
  if(kind==='path')f.env.GMAIL_CLIENT_PATH='../outside.json';
  fs.writeFileSync(f.clientFile,JSON.stringify(f.client));expect(()=>service.loadClientConfiguration(f.env)).toThrow(service.GmailError);
});
it('refreshes access tokens automatically in memory, reuses them and never rewrites the stored refresh',async()=>{
  const p=provider(),before=fs.readFileSync(f.tokenFile);
  await p.sender.send(message);await p.sender.send(message);
  expect(p.transport).toHaveBeenCalledTimes(1);expect(p.send).toHaveBeenCalledTimes(2);
  p.clients[0].credentials.expiry_date=Date.now()-1;await p.sender.send(message);
  expect(p.transport).toHaveBeenCalledTimes(2);
  expect(p.transport.mock.calls.every(([o])=>o.timeout===5000&&o.retry===false&&o.maxRedirects===0)).toBe(true);
  expect(fs.readFileSync(f.tokenFile).equals(before)).toBe(true);
});
it('shares a refresh in flight across concurrent OTP deliveries',async()=>{
  const p=provider();await Promise.all([p.sender.send(message),p.sender.send(message)]);
  expect(p.transport).toHaveBeenCalledTimes(1);expect(p.send).toHaveBeenCalledTimes(2);
});
it('builds RFC MIME/base64url with no transport retry and no refresh token in the message',async()=>{
  const p=provider();await p.sender.send(message);
  const [request,options]=p.send.mock.calls[0];expect(request.userId).toBe('me');expect(options).toMatchObject({retry:false,timeout:5000,maxRedirects:0});
  const raw=Buffer.from(request.requestBody.raw,'base64url').toString('utf8');
  expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');expect(raw).toContain('To: buyer@example.invalid');
  expect(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString('utf8')).toBe(message.text);
  expect(raw.includes(f.refreshToken)||raw.includes(f.clientSecret)).toBe(false);
});
it('blocks invalid_grant, emits only a safe reauthorization command and reloads after manual reauthorization',async()=>{
  const p=provider();p.transport.mockRejectedValueOnce({response:{data:{error:'invalid_grant',error_description:f.refreshToken}}});
  await expect(p.sender.send(message)).rejects.toMatchObject({code:'GMAIL_REAUTH_REQUIRED'});
  await expect(p.sender.send(message)).rejects.toMatchObject({code:'GMAIL_REAUTH_REQUIRED'});
  expect(p.warn).toHaveBeenCalledTimes(1);expect(p.warn).toHaveBeenCalledWith();expect(p.send).not.toHaveBeenCalled();
  const t=JSON.parse(fs.readFileSync(f.tokenFile));t.refreshToken=require('node:crypto').randomBytes(32).toString('hex');fs.writeFileSync(f.tokenFile,JSON.stringify(t));
  await p.sender.send(message);expect(p.send).toHaveBeenCalledTimes(1);
});
it('never retries ambiguous delivery failures or exposes provider diagnostics',async()=>{
  const p=provider();p.send.mockRejectedValue(new Error(f.refreshToken));
  try{await p.sender.send(message);throw new Error('Expected failure');}catch(error){
    expect(error.code).toBe('GMAIL_SEND_FAILED');expect(error.message.includes(f.refreshToken)).toBe(false);expect(error.cause).toBeUndefined();
  }
  expect(p.send).toHaveBeenCalledTimes(1);
});
it.each(['bad\r\nBcc: evil@example.invalid','buyer@example.invalid\n','not-an-address'])('rejects recipient/header injection %#',to=>{
  expect(()=>service.mimeMessage('sender@example.invalid',to,'Subject','Text')).toThrow();
});
