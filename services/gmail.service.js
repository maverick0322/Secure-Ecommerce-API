'use strict';
const { createHash } = require('node:crypto');
const { readConfigFile, resolveConfigPath } = require('./secure-config-file.service');
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const REDIRECT_URI = 'http://localhost:3001/oauth2/callback';
const TIMEOUT_MS = 5000;
class GmailError extends Error {
  constructor(code) { super('Gmail is unavailable.'); this.name = 'GmailError'; this.code = code; }
}
const requireValid = (value, code = 'GMAIL_CONFIGURATION_INVALID') => { if (!value) throw new GmailError(code); };
function validMailbox(value) {
  return typeof value === 'string' && value.length <= 254 && value.length > 3 &&
    !/[\s\u0000-\u001f\u007f]/.test(value) && value.split('@')[0].length <= 64 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value) &&
    !value.startsWith('.') && !value.includes('..') && !value.includes('.@') &&
    value.split('@')[1]?.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}
const validSecret = value => typeof value === 'string' && value.length >= 8 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(value);
function loadClientConfiguration(env = process.env) {
  try {
    requireValid(validMailbox(env.GMAIL_SENDER_EMAIL));
    requireValid(!env.GMAIL_REDIRECT_URI || env.GMAIL_REDIRECT_URI === REDIRECT_URI);
    const file = JSON.parse(readConfigFile(env.GMAIL_CLIENT_PATH, 32768, env).replace(/^\uFEFF/, ''));
    requireValid(file && !Array.isArray(file) && Boolean(file.web) !== Boolean(file.installed));
    const c = file.web || file.installed;
    requireValid(typeof c.client_id === 'string' && /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(c.client_id));
    requireValid(validSecret(c.client_secret) && Array.isArray(c.redirect_uris) && c.redirect_uris.includes(REDIRECT_URI));
    requireValid(!c.token_uri || c.token_uri === 'https://oauth2.googleapis.com/token');
    requireValid(!c.auth_uri || ['https://accounts.google.com/o/oauth2/auth','https://accounts.google.com/o/oauth2/v2/auth'].includes(c.auth_uri));
    const tokenPath = resolveConfigPath(env.GMAIL_TOKEN_PATH, env, { allowMissingLeaf: true });
    return { clientId:c.client_id, clientSecret:c.client_secret, sender:env.GMAIL_SENDER_EMAIL, tokenPath, redirectUri:REDIRECT_URI };
  } catch { throw new GmailError('GMAIL_CONFIGURATION_INVALID'); }
}
function loadConfiguration(env = process.env) {
  const config = loadClientConfiguration(env);
  try {
    const token = JSON.parse(readConfigFile(env.GMAIL_TOKEN_PATH, 16384, env).replace(/^\uFEFF/, ''));
    requireValid(token.version === 1 && token.clientId === config.clientId && token.sender === config.sender &&
      token.scope === SCOPE && validSecret(token.refreshToken));
    return { ...config, refreshToken:token.refreshToken };
  } catch { throw new GmailError('GMAIL_REAUTH_REQUIRED'); }
}
function createOAuthClient(config, google = require('googleapis').google) {
  const client = new google.auth.OAuth2({ clientId:config.clientId, clientSecret:config.clientSecret, redirectUri:REDIRECT_URI,
    transporterOptions:{ timeout:TIMEOUT_MS, retry:false, maxRedirects:0 } });
  // OAuth token calls add their own retry defaults. Enforce bounded requests on
  // this instance, and never replay an uncertain non-idempotent mail delivery.
  const request = client.transporter.request.bind(client.transporter);
  client.transporter.request = options => request({ ...options, timeout:TIMEOUT_MS, retry:false, maxRedirects:0 });
  return client;
}
function isInvalidGrant(error) {
  return error?.response?.data?.error === 'invalid_grant' || error?.code === 'invalid_grant' || error?.message === 'invalid_grant';
}
function mimeMessage(from, to, subject, text) {
  requireValid(validMailbox(from) && validMailbox(to), 'GMAIL_INPUT_INVALID');
  requireValid(typeof subject === 'string' && subject.length <= 120 && !/[\r\n\u0000-\u001f\u007f]/.test(subject), 'GMAIL_INPUT_INVALID');
  requireValid(typeof text === 'string' && Buffer.byteLength(text) <= 8192 && !text.includes('\0'), 'GMAIL_INPUT_INVALID');
  const encodedSubject = '=?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=';
  const body = Buffer.from(text).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';
  return Buffer.from([`From: ${from}`,`To: ${to}`,`Subject: ${encodedSubject}`,'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',body,''].join('\r\n')).toString('base64url');
}
function createGmailSender({ google = require('googleapis').google, load = loadConfiguration,
  warn = () => require('./structured-logger.service').log('gmail.reauthorization.required') } = {}) {
  let current;
  return Object.freeze({ async send({ to, subject, text }) {
    const config = load();
    const fingerprint = createHash('sha256').update(JSON.stringify([config.clientId,config.clientSecret,config.refreshToken,config.sender])).digest('hex');
    if (!current || current.fingerprint !== fingerprint) {
      const oauth = createOAuthClient(config, google);
      oauth.setCredentials({ refresh_token:config.refreshToken });
      current = { fingerprint, oauth, gmail:google.gmail({version:'v1',auth:oauth}), blocked:false };
    }
    const active = current;
    if (active.blocked) throw new GmailError('GMAIL_REAUTH_REQUIRED');
    const raw = mimeMessage(config.sender,to,subject,text);
    try {
      // google-auth-library caches and refreshes expiring access tokens in memory.
      // Only the refresh token is persisted by the explicit authorization tool.
      await active.oauth.getAccessToken();
      await active.gmail.users.messages.send({userId:'me',requestBody:{raw}}, { timeout:TIMEOUT_MS,retry:false,maxRedirects:0 });
    } catch (error) {
      if (isInvalidGrant(error)) {
        if (!active.blocked) warn(); active.blocked = true;
        throw new GmailError('GMAIL_REAUTH_REQUIRED');
      }
      throw new GmailError('GMAIL_SEND_FAILED');
    }
  } });
}
let sender;
function sendMessage(message) { return (sender ||= createGmailSender()).send(message); }
module.exports = { SCOPE,REDIRECT_URI,TIMEOUT_MS,GmailError,validMailbox,validSecret,requireValid,loadClientConfiguration,
  loadConfiguration,createOAuthClient,isInvalidGrant,mimeMessage,createGmailSender,sendMessage };
