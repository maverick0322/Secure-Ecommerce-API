'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const jwt = require('jsonwebtoken');
const { createAccessTokenService, loadAccessTokenService, AccessTokenError, Rs256ConfigurationError } =
  require('../../services/rs256-access-token.service');

const issuer = 'secure-ecommerce-api/access-v2';
const audience = 'secure-ecommerce-clients/access-v2';
const activeKid = 'access-current';
const previousKid = 'access-previous';
const initialTime = Date.UTC(2026, 10, 12, 12);
let active, previous, weak, ec, service, milliseconds;

beforeAll(() => {
  // Private keys are ephemeral KeyObjects. No PEM is written to disk.
  active = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  previous = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}, 30000);

function configuration(overrides = {}) {
  return { issuer, audience, activeKid, privateKey: active.privateKey,
    publicKeys: new Map([[activeKid, active.publicKey], [previousKid, previous.publicKey]]),
    now: () => milliseconds, ...overrides };
}

beforeEach(() => {
  milliseconds = initialTime;
  service = createAccessTokenService(configuration());
});
afterEach(() => jest.restoreAllMocks());

const input = () => ({ sub: crypto.randomUUID(), sid: crypto.randomUUID() });
function payload() {
  const iat = Math.floor(initialTime / 1000);
  return { ...input(), jti: crypto.randomUUID(), iat, exp: iat + 300, iss: issuer, aud: audience };
}

// Independent primitive lets negative tests exercise *our* verifier with signed
// malformed claims that jsonwebtoken.sign would reject before verification.
function signedRaw(body = payload(), header = {}, key = active.privateKey) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = encode({ alg: 'RS256', typ: 'at+jwt', kid: activeKid, ...header }) + '.' + encode(body);
  return signingInput + '.' + crypto.sign('RSA-SHA256', Buffer.from(signingInput), key).toString('base64url');
}

it('emits a minimal RS256 access token with a 3072-bit key, active kid and exactly five minutes', () => {
  const requested = input();
  const token = service.sign(requested);
  const decoded = jwt.decode(token, { complete: true });
  expect(active.publicKey.asymmetricKeyDetails.modulusLength).toBe(3072);
  expect(decoded.header).toEqual({ alg: 'RS256', typ: 'at+jwt', kid: activeKid });
  const verified = service.verify(token);
  expect(verified.sub).toBe(requested.sub); expect(verified.sid).toBe(requested.sid);
  expect(verified.iss).toBe(issuer); expect(verified.aud).toBe(audience);
  expect(verified.iat).toBe(initialTime / 1000); expect(verified.exp - verified.iat).toBe(300);
  expect(Object.keys(verified).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'jti', 'sid', 'sub']);
  expect(Object.isFrozen(verified)).toBe(true);
  expect(service.verify(service.sign(requested)).jti).not.toBe(verified.jti);
});

it('accepts a trusted previous verification key and a shorter valid signed lifetime', () => {
  expect(service.verify(signedRaw(payload(), { kid: previousKid }, previous.privateKey)).iss).toBe(issuer);
  const body = payload(); body.exp = body.iat + 1;
  expect(service.verify(signedRaw(body)).exp).toBe(body.exp);
});

it('expires at the exact boundary without tolerance and rejects future-issued tokens', () => {
  const token = service.sign(input());
  milliseconds += 299999; expect(() => service.verify(token)).not.toThrow();
  milliseconds += 1; expect(() => service.verify(token)).toThrow(AccessTokenError);
  milliseconds = initialTime - 1000; expect(() => service.verify(token)).toThrow(AccessTokenError);
});

it('rejects invalid signatures and payload tampering', () => {
  expect(() => service.verify(signedRaw(payload(), {}, previous.privateKey))).toThrow(AccessTokenError);
  const segments = service.sign(input()).split('.');
  const body = JSON.parse(Buffer.from(segments[1], 'base64url')); body.sub = crypto.randomUUID();
  segments[1] = Buffer.from(JSON.stringify(body)).toString('base64url');
  expect(() => service.verify(segments.join('.'))).toThrow(AccessTokenError);
});

it('rejects HS256, including use of the RSA public PEM as an HMAC secret, and unsigned tokens', () => {
  const body = payload();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'at+jwt', kid: activeKid })).toString('base64url');
  const signingInput = header + '.' + Buffer.from(JSON.stringify(body)).toString('base64url');
  const secret = active.publicKey.export({ type: 'spki', format: 'pem' });
  const token = signingInput + '.' + crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  expect(() => service.verify(token)).toThrow(AccessTokenError);
  const unsigned = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt', kid: activeKid })).toString('base64url') +
    '.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.';
  expect(() => service.verify(unsigned)).toThrow(AccessTokenError);
});

it.each(['HS384', 'RS384', 'RS512', 'none'])('rejects a header with algorithm %s', alg => {
  expect(() => service.verify(signedRaw(payload(), { alg }))).toThrow(AccessTokenError);
});

it.each(['unknown', '../private.pem', 'https://example.invalid/key', '__proto__', 'constructor', '', null, 42, [], 'x'.repeat(65)])(
  'rejects an untrusted or malformed kid %#', kid => {
    expect(() => service.verify(signedRaw(payload(), { kid }))).toThrow(AccessTokenError);
  });

it.each(['jku', 'x5u', 'jwk', 'x5c', 'crit', 'b64'])('rejects header extension %s without file or network access', name => {
  const token = signedRaw(payload(), { [name]: 'https://example.invalid/key' });
  const forbidden = () => { throw new Error('Unexpected verification IO'); };
  const read = jest.spyOn(fs, 'readFileSync').mockImplementation(forbidden);
  const stat = jest.spyOn(fs, 'statSync').mockImplementation(forbidden);
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(forbidden);
  const plain = jest.spyOn(http, 'request').mockImplementation(forbidden);
  const secure = jest.spyOn(https, 'request').mockImplementation(forbidden);
  const plainGet = jest.spyOn(http, 'get').mockImplementation(forbidden);
  const secureGet = jest.spyOn(https, 'get').mockImplementation(forbidden);
  expect(() => service.verify(token)).toThrow(AccessTokenError);
  expect(read).not.toHaveBeenCalled(); expect(stat).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled(); expect(plain).not.toHaveBeenCalled(); expect(secure).not.toHaveBeenCalled();
  expect(plainGet).not.toHaveBeenCalled(); expect(secureGet).not.toHaveBeenCalled();
});

it.each(['alg', 'kid', 'typ'])('rejects a missing header %s', name => {
  expect(() => service.verify(signedRaw(payload(), { [name]: undefined }))).toThrow(AccessTokenError);
});
it('rejects a generic JWT type and snapshots the trusted key map', () => {
  expect(() => service.verify(signedRaw(payload(), { typ: 'JWT' }))).toThrow(AccessTokenError);
  const options = configuration(); const configured = createAccessTokenService(options);
  options.publicKeys.set('injected-later', previous.publicKey);
  expect(() => configured.verify(signedRaw(payload(), { kid: 'injected-later' }, previous.privateKey))).toThrow(AccessTokenError);
});

it.each(['sub', 'sid', 'jti', 'iat', 'exp', 'iss', 'aud'])('rejects a missing signed claim %s', name => {
  const body = payload(); delete body[name];
  expect(() => service.verify(signedRaw(body))).toThrow(AccessTokenError);
});
it.each(['sub', 'sid', 'jti'])('rejects malformed %s identifiers', name => {
  for (const value of [null, {}, [], 1, '', 'not-a-uuid', crypto.randomUUID() + '\n', '00000000-0000-0000-0000-000000000000']) {
    expect(() => service.verify(signedRaw({ ...payload(), [name]: value }))).toThrow(AccessTokenError);
  }
});
it.each(['iat', 'exp'])('rejects non-integer or unsafe %s timestamps', name => {
  for (const value of [null, '123', true, {}, [], 0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => service.verify(signedRaw({ ...payload(), [name]: value }))).toThrow(AccessTokenError);
  }
});
it('rejects future iat, expired/reversed/overlong lifetimes, wrong issuer and non-string audiences', () => {
  const p = payload();
  for (const change of [{ iat: p.iat + 1 }, { exp: p.iat }, { exp: p.iat - 1 }, { exp: p.iat + 301 },
    { iss: 'other' }, { iss: [issuer] }, { aud: 'other' }, { aud: [audience] }]) {
    expect(() => service.verify(signedRaw({ ...p, ...change }))).toThrow(AccessTokenError);
  }
  expect(() => service.verify(signedRaw({ ...p, role: 'ADMIN' }))).toThrow(AccessTokenError);
  expect(() => service.verify(signedRaw(['not', 'a', 'payload']))).toThrow(AccessTokenError);
});

it.each([null, 1, {}, '', 'a.b', 'a.b.c.d', 'a=.b.c', 'x'.repeat(8193)])('rejects a malformed or overlong token %#', value => {
  expect(() => service.verify(value)).toThrow(AccessTokenError);
});
it('rejects non-canonical base64url, even if it decodes to the same signature bytes', () => {
  const token = service.sign(input()); const segments = token.split('.');
  // A whitespace suffix would otherwise be ignored by permissive base64 decoders.
  segments[2] += '\n'; expect(() => service.verify(segments.join('.'))).toThrow(AccessTokenError);
  let json = JSON.stringify({ alg: 'RS256', typ: 'at+jwt', kid: activeKid });
  while (Buffer.byteLength(json) % 3 === 0) json += ' ';
  const header = Buffer.from(json).toString('base64url');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const index = alphabet.indexOf(header.at(-1));
  const alternative = header.slice(0, -1) + alphabet[index + 1];
  expect(Buffer.from(alternative, 'base64url').equals(Buffer.from(header, 'base64url'))).toBe(true);
  const encodedPayload = Buffer.from(JSON.stringify(payload())).toString('base64url');
  const signingInput = alternative + '.' + encodedPayload;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), active.privateKey).toString('base64url');
  expect(() => service.verify(signingInput + '.' + signature)).toThrow(AccessTokenError);
});

it('does not let signing callers override registered claims, headers or keys', () => {
  for (const invalid of [null, [], {}, { sub: crypto.randomUUID() }, { ...input(), sid: 'invalid' },
    ...['exp', 'iat', 'iss', 'aud', 'jti', 'kid', 'privateKey', 'role'].map(name => ({ ...input(), [name]: 'override' }))]) {
    expect(() => service.sign(invalid)).toThrow(AccessTokenError);
  }
});

it('requires exact RSA-3072 key types, a matching active pair and valid trusted identifiers', () => {
  const invalid = [null, [], { issuer: '' }, { audience: [] }, { issuer: ' issuer ' },
    { audience: 'bad\nidentifier' }, { activeKid: '../key' }, { activeKid: 'missing' },
    { privateKey: weak.privateKey, publicKeys: new Map([[activeKid, weak.publicKey]]) },
    { privateKey: ec.privateKey }, { privateKey: active.publicKey },
    { publicKeys: new Map([[activeKid, previous.publicKey]]) },
    { publicKeys: new Map([[activeKid, active.privateKey]]) }, { publicKeys: new Map() }, { publicKeys: {} },
    { publicKeys: new Map([['../key', active.publicKey]]) },
    { publicKeys: new Map(Array.from({ length: 17 }, (_, i) => ['key-' + i, active.publicKey])) },
    { now: 1 }, { now: () => NaN }, { now: () => -1 }];
  for (const change of invalid) {
    const options = change === null || Array.isArray(change) ? change : { ...configuration(), ...change };
    expect(() => createAccessTokenService(options)).toThrow(Rs256ConfigurationError);
  }
  expect(() => createAccessTokenService()).toThrow(Rs256ConfigurationError);
});

function mockedFiles() {
  const directory = path.resolve(path.parse(process.cwd()).root, 'rs256-test-memory');
  const privatePath = path.join(directory, 'private.pem'), publicPath = path.join(directory, 'public.pem');
  const manifestPath = path.join(directory, 'public-keys.json');
  const files = new Map([[privatePath, active.privateKey.export({ format: 'pem', type: 'pkcs8' })],
    [publicPath, active.publicKey.export({ format: 'pem', type: 'spki' })],
    [manifestPath, JSON.stringify({ [activeKid]: publicPath })]]);
  const env = { JWT_RS256_ISSUER: issuer, JWT_RS256_AUDIENCE: audience, JWT_RS256_ACTIVE_KID: activeKid,
    JWT_RS256_PRIVATE_KEY_PATH: privatePath, JWT_RS256_PUBLIC_KEYS_PATH: manifestPath };
  jest.spyOn(fs, 'statSync').mockImplementation(location => {
    if (!files.has(location)) throw new Error('Synthetic inaccessible file');
    return { isFile: () => true, size: Buffer.byteLength(files.get(location)) };
  });
  const read = jest.spyOn(fs, 'readFileSync').mockImplementation(location => {
    if (!files.has(location)) throw new Error('Synthetic inaccessible file');
    return files.get(location);
  });
  return { files, env, read, manifestPath, privatePath, publicPath };
}

it('loads configured absolute paths once and never reads a file to verify a token kid', () => {
  const { env, read } = mockedFiles(); const loaded = loadAccessTokenService(env);
  const token = loaded.sign(input()); expect(loaded.verify(token).iss).toBe(issuer);
  expect(read).toHaveBeenCalledTimes(3); read.mockClear();
  expect(() => loaded.verify(token)).not.toThrow();
  expect(() => loaded.verify(signedRaw(payload(), { kid: '../outside.pem' }))).toThrow(AccessTokenError);
  expect(read).not.toHaveBeenCalled();
});

it('rejects relative, remote, missing, oversized and invalid key files without exposing their content', () => {
  const f = mockedFiles();
  for (const value of ['relative.pem', 'https://example.invalid/key', '', undefined]) {
    expect(() => loadAccessTokenService({ ...f.env, JWT_RS256_PRIVATE_KEY_PATH: value })).toThrow(Rs256ConfigurationError);
  }
  f.files.set(f.manifestPath, '{invalid'); expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  f.files.set(f.manifestPath, '[]'); expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  f.files.set(f.manifestPath, JSON.stringify({ '../key': f.publicPath }));
  expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  f.files.set(f.manifestPath, JSON.stringify({ [activeKid]: f.publicPath }));
  f.files.set(f.publicPath, f.files.get(f.privatePath));
  expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  const publicPem = active.publicKey.export({ format: 'pem', type: 'spki' });
  f.files.set(f.publicPath, publicPem + f.files.get(f.privatePath));
  expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  f.files.set(f.publicPath, 'x'.repeat(16385)); expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  f.files.set(f.publicPath, '-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----');
  expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
});

it.each(['missing', 'directory', 'empty', 'oversized', 'corrupt'])('rejects a %s private-key file', kind => {
  const f = mockedFiles();
  if (kind === 'missing') f.files.delete(f.privatePath);
  if (kind === 'empty') f.files.set(f.privatePath, '');
  if (kind === 'oversized') f.files.set(f.privatePath, 'x'.repeat(16385));
  if (kind === 'corrupt') f.files.set(f.privatePath, 'invalid private-key encoding');
  if (kind === 'directory') {
    const stat = fs.statSync.getMockImplementation();
    fs.statSync.mockImplementation(location => location === f.privatePath ? { isFile: () => false, size: 1 } : stat(location));
  }
  expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
});

it.each([null, [], {}, Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['key-' + i, 'unused']))])(
  'rejects a malformed or excessive manifest %#', manifest => {
    const f = mockedFiles(); f.files.set(f.manifestPath, JSON.stringify(manifest));
    expect(() => loadAccessTokenService(f.env)).toThrow(Rs256ConfigurationError);
  });

it('does not depend on JWT_SECRET or any existing authentication configuration', () => {
  jest.replaceProperty(process, 'env', {});
  expect(() => service.verify(service.sign(input()))).not.toThrow();
});

it('returns generic errors without tokens, key material or filesystem causes', () => {
  try { service.verify('synthetic.invalid.token'); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(AccessTokenError);
    expect(error.message).toBe('Invalid RS256 access token.'); expect(error.cause).toBeUndefined();
  }
  const { env } = mockedFiles(); fs.statSync.mockImplementation(() => { throw new Error('Sensitive underlying diagnostic'); });
  try { loadAccessTokenService(env); throw new Error('Expected rejection'); }
  catch (error) {
    expect(error).toBeInstanceOf(Rs256ConfigurationError);
    expect(error.message).toBe('Invalid RS256 access-token configuration.'); expect(error.cause).toBeUndefined();
  }
});
