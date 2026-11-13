const jwt = require('jsonwebtoken');
const { generateToken, verifyToken, getJwtSecret, getRemainingTokenTime } = require('../../services/jwttoken.service');
const { makeAccount } = require('../support/auth-fixtures');
const crypto = require('node:crypto');
afterEach(() => jest.restoreAllMocks());
it('uses the RS256 facade with a mandatory session UUID and five-minute lifetime', () => {
  const account = makeAccount('BUYER'), sessionId = crypto.randomUUID();
  const decoded = verifyToken(generateToken({ id: account.id, sessionId }));
  expect(decoded).toMatchObject({ sub: account.id, sid: sessionId }); expect(decoded.exp - decoded.iat).toBe(300);
  expect(getRemainingTokenTime(decoded)).toMatch(/^00:0[45]:[0-5]\d$/);
  expect(() => generateToken(account)).toThrow();
});
it.each(['HS256','HS384','none'])('rejects legacy/symmetric access algorithm %s', algorithm => {
  const token = jwt.sign({ sub: crypto.randomUUID() }, algorithm === 'none' ? null : process.env.JWT_SECRET, { algorithm });
  expect(() => verifyToken(token)).toThrow();
});
it.each(['','short','a'.repeat(64),'human-readable-secret-passphrase-without-randomness'])('retains checkout secret validation %#', secret => {
  jest.replaceProperty(process, 'env', { ...process.env, JWT_SECRET: secret });
  expect(() => getJwtSecret()).toThrow('JWT_SECRET');
});
it('retains the existing checkout secret bytes without rotation or changes', () => {
  for (const encoding of ['hex','base64url']) {
    const secret = (encoding === 'base64url' ? 'base64url:' : '') + crypto.randomBytes(48).toString(encoding);
    jest.replaceProperty(process, 'env', { ...process.env, JWT_SECRET: secret });
    expect(getJwtSecret() === secret).toBe(true);
  }
});
