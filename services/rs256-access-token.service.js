'use strict';

const { readConfigFile } = require('./secure-config-file.service');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { isAccessUuid } = require('../validators/uuid');

const LIFETIME_SECONDS = 300;
const MAX_TOKEN_BYTES = 8192;
const MAX_KEYS = 16;
const CLAIMS = ['sub', 'sid', 'jti', 'iat', 'exp', 'iss', 'aud'];
const HEADERS = ['alg', 'kid', 'typ'];
const validKid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);

class Rs256ConfigurationError extends Error {
  constructor() {
    super('Invalid RS256 access-token configuration.');
    this.name = 'Rs256ConfigurationError';
    this.code = 'RS256_CONFIGURATION_INVALID';
  }
}

class AccessTokenError extends Error {
  constructor() {
    super('Invalid RS256 access token.');
    this.name = 'AccessTokenError';
    this.code = 'INVALID_ACCESS_TOKEN';
  }
}

function configured(condition) {
  if (!condition) throw new Rs256ConfigurationError();
}

function accepted(condition) {
  if (!condition) throw new AccessTokenError();
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function identifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
    value.trim() === value && !/[\s\u0000-\u001f\u007f]/u.test(value);
}

function rsaKey(key, type) {
  return key instanceof crypto.KeyObject && key.type === type &&
    key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength === 3072;
}

function epoch(now) {
  const milliseconds = now();
  configured(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
  const seconds = Math.floor(milliseconds / 1000);
  configured(seconds > 0 && Number.isSafeInteger(seconds + LIFETIME_SECONDS));
  return seconds;
}

function validClaims(payload, issuer, audience, seconds) {
  return record(payload) && Object.keys(payload).length === CLAIMS.length &&
    CLAIMS.every(key => Object.hasOwn(payload, key)) &&
    [payload.sub, payload.sid, payload.jti].every(isAccessUuid) &&
    Number.isSafeInteger(payload.iat) && payload.iat >= 0 && payload.iat <= seconds &&
    Number.isSafeInteger(payload.exp) && payload.exp > seconds && payload.exp > payload.iat &&
    payload.exp - payload.iat <= LIFETIME_SECONDS &&
    payload.iss === issuer && payload.aud === audience;
}

function validHeader(header) {
  return record(header) && Object.keys(header).length === HEADERS.length &&
    HEADERS.every(key => Object.hasOwn(header, key)) &&
    header.alg === 'RS256' && header.typ === 'at+jwt' && validKid(header.kid);
}

/** Trusted, in-process configuration only. No environment or file IO at import. */
function createAccessTokenService(options = {}) {
  configured(record(options));
  const { issuer, audience, activeKid, privateKey, publicKeys, now = Date.now } = options;
  configured(identifier(issuer) && identifier(audience) && validKid(activeKid) && typeof now === 'function');
  configured(rsaKey(privateKey, 'private') && publicKeys instanceof Map && publicKeys.size > 0 && publicKeys.size <= MAX_KEYS);
  const keys = new Map(publicKeys);
  for (const [kid, key] of keys) configured(validKid(kid) && rsaKey(key, 'public'));
  configured(keys.has(activeKid));
  const publicDer = key => key.export({ format: 'der', type: 'spki' });
  configured(publicDer(crypto.createPublicKey(privateKey)).equals(publicDer(keys.get(activeKid))));
  epoch(now);

  function sign(input) {
    accepted(record(input) && Object.keys(input).length === 2 &&
      Object.hasOwn(input, 'sub') && Object.hasOwn(input, 'sid') &&
      isAccessUuid(input.sub) && isAccessUuid(input.sid));
    const iat = epoch(now);
    // All other claims are server-generated; callers cannot override times,
    // audience, issuer, token ID, algorithm, key or header.
    return jwt.sign({ sub: input.sub, sid: input.sid, jti: crypto.randomUUID(),
      iat, exp: iat + LIFETIME_SECONDS, iss: issuer, aud: audience }, privateKey,
    { algorithm: 'RS256', keyid: activeKid, header: { typ: 'at+jwt' } });
  }

  function verify(token) {
    try {
      accepted(typeof token === 'string' && token.length <= MAX_TOKEN_BYTES &&
        /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
      const segments = token.split('.');
      // Reject alternative base64url encodings, including unused trailing bits.
      accepted(segments.every(value => Buffer.from(value, 'base64url').toString('base64url') === value));
      const decoded = jwt.decode(token, { complete: true });
      accepted(decoded && validHeader(decoded.header));
      const key = keys.get(decoded.header.kid);
      accepted(Boolean(key));
      const seconds = epoch(now);
      const payload = jwt.verify(token, key, { algorithms: ['RS256'], issuer, audience,
        clockTimestamp: seconds, clockTolerance: 0 });
      accepted(validClaims(payload, issuer, audience, seconds));
      return Object.freeze({ ...payload });
    } catch (error) {
      if (error instanceof Rs256ConfigurationError) throw error;
      // Never attach the token, key material, filesystem errors or library cause.
      throw new AccessTokenError();
    }
  }

  return Object.freeze({ sign, verify });
}

/** Invoke explicitly with server-owned configuration, never req.body/headers. */
function loadAccessTokenService(env = process.env) {
  try {
    const manifest = JSON.parse(readConfigFile(env.JWT_RS256_PUBLIC_KEYS_PATH, 65536, env).replace(/^\uFEFF/, ''));
    configured(record(manifest) && Object.keys(manifest).length > 0 && Object.keys(manifest).length <= MAX_KEYS);
    const publicKeys = new Map();
    for (const [kid, location] of Object.entries(manifest)) {
      configured(validKid(kid));
      const pem = readConfigFile(location, 16384, env);
      // A public-key location must not silently contain a private key.
      configured(/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----$/.test(pem.trim()));
      publicKeys.set(kid, crypto.createPublicKey(pem));
    }
    const privateKey = crypto.createPrivateKey(readConfigFile(env.JWT_RS256_PRIVATE_KEY_PATH, 16384, env));
    return createAccessTokenService({ issuer: env.JWT_RS256_ISSUER, audience: env.JWT_RS256_AUDIENCE,
      activeKid: env.JWT_RS256_ACTIVE_KID, privateKey, publicKeys });
  } catch {
    throw new Rs256ConfigurationError();
  }
}

module.exports = { createAccessTokenService, loadAccessTokenService, AccessTokenError, Rs256ConfigurationError, LIFETIME_SECONDS };
