const { randomUUID } = require('node:crypto');
const { User, AuditLog } = require('../../models');
const runtime = require('../../services/auth-runtime.service');
const { cryptography } = require('./isolated-auth');
const cryptoServices = cryptography();
const syntheticHash = require('bcrypt').hashSync(require('node:crypto').randomBytes(32).toString('hex'), 4);
const sessions = { create: jest.fn(async ({ userId }) => ({ sessionId: randomUUID(), userId,
  refreshToken: require('node:crypto').randomBytes(32).toString('base64url') })), check: jest.fn(async () => ({})),
revoke: jest.fn(async () => ({})), revokeAll: jest.fn(async () => ({})) };
function mockAuthRuntime() {
  jest.spyOn(runtime, 'getTokens').mockReturnValue(cryptoServices.tokens);
  jest.spyOn(runtime, 'getRuntime').mockResolvedValue({ ...cryptoServices, sessions });
}
beforeEach(mockAuthRuntime);

const registry = new Map();
process.env.JWT_SECRET = require('./signing-secret');

function makeAccount(profile, values = {}) {
  const id = randomUUID();
  return { id, email: `${id}@example.invalid`, name: 'Synthetic account', status: 'ACTIVE', emailVerifiedAt: new Date(),
    deletedAt: null, passwordHash: syntheticHash, [profile.toLowerCase()]: { userId: id, ...(profile === 'SELLER' && { status: 'PENDING' }) }, ...values };
}

function generateToken(email, name, role) {
  const profile = { Administrador: 'ADMIN', Usuario: 'BUYER' }[role] || role;
  return tokenFor(profile, { email, name }).token;
}

function tokenFor(profile, values = {}) {
  const account = makeAccount(profile, values);
  registry.set(account.id, account);
  return { account, token: issueToken(account) };
}
function issueToken(account) { return cryptoServices.tokens.sign({ sub: account.id, sid: randomUUID() }); }

function mockAccountLookups() {
  jest.spyOn(AuditLog,'create').mockResolvedValue({});
  jest.spyOn(User, 'unscoped').mockReturnValue(User);
  return jest.spyOn(User, 'findByPk').mockImplementation(async id => registry.get(id) || null);
}

module.exports = { makeAccount, generateToken, mockAccountLookups, tokenFor, issueToken, mockAuthRuntime, sessions };
