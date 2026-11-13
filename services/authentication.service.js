'use strict';
const bcrypt = require('bcrypt');
const accounts = require('./accounts.service');
const runtime = require('./auth-runtime.service');
const { AccountError } = accounts;
const DUMMY_HASH = '$2b$12$yIYsFG/CLkHoQu1IXqg0Ke4Vy3kGCImKQPBR0tcNW5QXxWLnxZH3y';
function body(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).length !== fields.length || fields.some(key => !Object.hasOwn(input, key))) {
    throw new AccountError(400, 'Campos de autenticación inválidos.');
  }
  return input;
}
function validAccount(account) {
  if (!accounts.isActive(account) || !accounts.accountType(account)) throw new AccountError(401, 'Sesión inválida o expirada.');
  return account;
}
function result(account, session, tokens) {
  return { ...accounts.serializeAccount(account), jwt: tokens.sign({ sub: account.id, sid: session.sessionId }),
    refreshToken: session.refreshToken, expiresIn: 300, tokenType: 'Bearer' };
}
async function login(input, context = {}) {
  const { email: address, password } = body(input, ['email', 'password']);
  const email = await accounts.normalizeEmail(address);
  if (!accounts.validPassword(password)) throw new AccountError(400, 'La contraseña no es válida.');
  const account = await accounts.findAccountByEmail(email, true);
  const matched = await bcrypt.compare(password, account?.passwordHash || DUMMY_HASH);
  if (!account || !matched || !accounts.isActive(account) || !accounts.accountType(account)) {
    throw new AccountError(401, 'Usuario o contraseña incorrectos.');
  }
  const { sessions, versions, tokens } = await runtime.getRuntime();
  const session = await sessions.create({ userId: account.id, credentialVersion: versions.derive(account.passwordHash) });
  try {
    // Re-read after creation: a password/status update racing with bcrypt or
    // Redis cannot return a usable login based only on stale credentials.
    const current = validAccount(await accounts.findAccountById(account.id, { withPassword: true }));
    if (current.passwordHash !== account.passwordHash) throw new AccountError(401, 'Usuario o contraseña incorrectos.');
    await sessions.check({ userId: current.id, sessionId: session.sessionId, credentialVersion: versions.derive(current.passwordHash) });
    await require('./audit.service').write({ actorUserId: current.id, action: 'usuario.login',
      targetType: 'user', targetId: current.id, ipAddress: context.ipAddress });
    return result(current, session, tokens);
  } catch (error) {
    // Do not return a token pair when audit or final account validation fails.
    await sessions.revoke({ userId: account.id, sessionId: session.sessionId }); throw error;
  }
}
async function refresh(input, context = {}) {
  const { refreshToken } = body(input, ['refreshToken']);
  if (typeof refreshToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) throw new AccountError(400, 'Refresh token inválido.');
  const { sessions, versions, tokens } = await runtime.getRuntime();
  const reference = await sessions.lookupRefresh(refreshToken);
  const account = await accounts.findAccountById(reference.userId, { withPassword: true });
  try { validAccount(account); }
  catch (error) { await sessions.revoke({ userId: reference.userId, sessionId: reference.sessionId }); throw error; }
  const session = await sessions.rotate({ refreshToken, credentialVersion: versions.derive(account.passwordHash) });
  try {
    const current = validAccount(await accounts.findAccountById(account.id, { withPassword: true }));
    await sessions.check({ userId: current.id, sessionId: session.sessionId, credentialVersion: versions.derive(current.passwordHash) });
    await require('./audit.service').write({ actorUserId: current.id, action: 'auth.refresh', targetType: 'user',
      targetId: current.id, ipAddress: context.ipAddress });
    return result(current, session, tokens);
  } catch (error) { await sessions.revoke({ userId: account.id, sessionId: session.sessionId }); throw error; }
}
async function logout(account, claims, context = {}) {
  const { sessions } = await runtime.getRuntime();
  await sessions.revoke({ userId: account.id, sessionId: claims.sid });
  // Revocation remains effective even if this independent SQL audit fails.
  await require('./audit.service').write({ actorUserId: account.id, action: 'auth.logout', targetType: 'user',
    targetId: account.id, ipAddress: context.ipAddress });
}
module.exports = { login, refresh, logout };
