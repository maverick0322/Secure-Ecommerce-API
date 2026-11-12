const jwt = require('jsonwebtoken');
const claims = require('../../config/claim-types');
const { generateToken, verifyToken, getRemainingTokenTime } = require('../../services/jwttoken.service');
const { makeAccount } = require('../support/auth-fixtures');

afterEach(() => jest.restoreAllMocks());

it('signs and verifies the UUID subject, profile, claims and 20-minute lifetime', () => {
  const account = { ...makeAccount('ADMIN'), profile: 'ADMIN' };
  const token = generateToken(account);
  const decoded = verifyToken(token);
  expect(token.split('.')).toHaveLength(3);
  expect(decoded).toMatchObject({ sub: account.id, [claims.Name]: account.email, [claims.GivenName]: account.name,
    [claims.Role]: 'ADMIN', iss: 'ServidorFeiJWT', aud: 'ClientesFeiJWT' });
  expect(decoded.exp - decoded.iat).toBe(1200);
  expect(getRemainingTokenTime(decoded)).toMatch(/^00:(19|20):[0-5]\d$/);
});

it.each(['issuer', 'audience', 'subject', 'algorithm', 'expiry'])('rejects an invalid %s', kind => {
  const options = { issuer: 'ServidorFeiJWT', audience: 'ClientesFeiJWT', subject: makeAccount('BUYER').id,
    algorithm: 'HS256', expiresIn: 60 };
  if (kind === 'algorithm') options.algorithm = 'HS384';
  else if (kind === 'expiry') options.expiresIn = -1;
  else options[kind] = 'invalid';
  const token = jwt.sign({}, process.env.JWT_SECRET, options);
  expect(() => verifyToken(token)).toThrow();
});

it.each(['', 'short', 'a'.repeat(64),'human-readable-secret-passphrase-without-randomness'])('refuses to sign with a missing or weak secret', secret => {
  jest.replaceProperty(process, 'env', { ...process.env, JWT_SECRET: secret });
  expect(() => generateToken(makeAccount('ADMIN'))).toThrow('JWT_SECRET');
});

it('accepts CSPRNG keys in canonical hexadecimal or base64url without printing them',()=>{
  for(const encoding of ['hex','base64url']){
    jest.replaceProperty(process,'env',{...process.env,JWT_SECRET:(encoding==='base64url'?'base64url:':'')+require('node:crypto').randomBytes(48).toString(encoding)});
    const account={...makeAccount('BUYER'),profile:'BUYER'};
    expect(verifyToken(generateToken(account)).sub).toBe(account.id);
  }
});
