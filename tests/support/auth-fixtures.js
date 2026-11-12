const { randomUUID } = require('node:crypto');
const { User, AuditLog } = require('../../models');
const jwt = require('../../services/jwttoken.service');

const registry = new Map();
process.env.JWT_SECRET = require('./signing-secret');

function makeAccount(profile, values = {}) {
  const id = randomUUID();
  return { id, email: `${id}@example.invalid`, name: 'Synthetic account', status: 'ACTIVE', emailVerifiedAt: new Date(),
    deletedAt: null, [profile.toLowerCase()]: { userId: id, ...(profile === 'SELLER' && { status: 'PENDING' }) }, ...values };
}

function generateToken(email, name, role) {
  const profile = { Administrador: 'ADMIN', Usuario: 'BUYER' }[role] || role;
  return tokenFor(profile, { email, name }).token;
}

function tokenFor(profile, values = {}) {
  const account = makeAccount(profile, values);
  registry.set(account.id, account);
  return { account, token: jwt.generateToken({ ...account, profile }) };
}

function mockAccountLookups() {
  jest.spyOn(AuditLog,'create').mockResolvedValue({});
  return jest.spyOn(User, 'findByPk').mockImplementation(async id => registry.get(id) || null);
}

module.exports = { makeAccount, generateToken, mockAccountLookups, tokenFor };
