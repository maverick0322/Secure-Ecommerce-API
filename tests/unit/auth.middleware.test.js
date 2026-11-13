const jwt = require('jsonwebtoken');
const { User } = require('../../models');
const authorize = require('../../middlewares/auth.middleware');
const { issueToken: generateToken } = require('../support/auth-fixtures');
beforeEach(() => jest.spyOn(User, 'unscoped').mockReturnValue(User));
const { makeAccount } = require('../support/auth-fixtures');

afterEach(() => jest.restoreAllMocks());

function requestWith(token) {
  const req = { get: jest.fn().mockReturnValue(token && `Bearer ${token}`) };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn() };
  return { req, res, next: jest.fn() };
}

it.each([null, 'invalid'])('rejects a missing or invalid token before a lookup', async token => {
  const lookup = jest.spyOn(User, 'findByPk');
  const { req, res, next } = requestWith(token);
  await authorize('ADMIN')(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(lookup).not.toHaveBeenCalled();
});

it.each(['SUSPENDED', 'DISABLED', 'deleted', 'unverified', 'duplicate', 'none'])('refuses an account with state %s', async state => {
  const account = makeAccount('ADMIN');
  if (state === 'deleted') account.deletedAt = new Date();
  else if (state === 'unverified') account.emailVerifiedAt = null;
  else if (state === 'duplicate') account.buyer = { userId: account.id };
  else if (state === 'none') delete account.admin;
  else account.status = state;
  jest.spyOn(User, 'findByPk').mockResolvedValue(account);
  const { req, res, next } = requestWith(generateToken({ ...account, profile: 'ADMIN' }));
  await authorize('ADMIN')(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.set).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

it('ignores an administrative claim when the persisted profile is BUYER', async () => {
  const account = makeAccount('BUYER');
  jest.spyOn(User, 'findByPk').mockResolvedValue(account);
  const { req, res, next } = requestWith(generateToken({ ...account, profile: 'ADMIN' }));
  await authorize('ADMIN')(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
});

it('checks seller approval for commerce and allows a pending seller to check session time', async () => {
  const account = makeAccount('SELLER');
  jest.spyOn(User, 'findByPk').mockResolvedValue(account);
  const { req, res, next } = requestWith(generateToken({ ...account, profile: 'SELLER' }));
  await authorize('SELLER')(req, res, next);
  expect(res.status).toHaveBeenCalledWith(403);
  await authorize('SELLER', { allowUnapprovedSeller: true })(req, res, next);
  account.seller.status = 'APPROVED';
  await authorize('SELLER')(req, res, next);
  expect(next).toHaveBeenCalledTimes(2);
});

it('rejects legacy HS256 access tokens without renewal or account lookup', async () => {
  const account = makeAccount('BUYER');
  const token = jwt.sign({}, process.env.JWT_SECRET, { issuer: 'ServidorFeiJWT', audience: 'ClientesFeiJWT', subject: account.id, expiresIn: 180 });
  const lookup = jest.spyOn(User, 'findByPk');
  const { req, res, next } = requestWith(token);
  await authorize('Usuario')(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401); expect(lookup).not.toHaveBeenCalled();
  expect(res.set).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
});
it('does not emit automatic renewal headers for an accepted RS256 access token', async () => {
  const account = makeAccount('BUYER'); jest.spyOn(User, 'findByPk').mockResolvedValue(account);
  const { req, res, next } = requestWith(generateToken(account));
  await authorize('BUYER')(req, res, next);
  expect(next).toHaveBeenCalledTimes(1); expect(res.set).not.toHaveBeenCalled();
});
