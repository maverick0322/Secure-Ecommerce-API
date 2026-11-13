'use strict';
const { loadAccessTokenService } = require('./rs256-access-token.service');
const { loadCredentialVersionService } = require('./credential-version.service');
const { loadRedisConfiguration, createAuthRedisConnection } = require('./auth-redis.service');
const { createSessionService } = require('./auth-session.service');
let tokens, pending, connection;
function getTokens() { return tokens ||= loadAccessTokenService(); }
function getRuntime() {
  // No offline fallback and no automatic reconnect/recovery. A failed runtime
  // remains failed until the operator restarts this process.
  return pending ||= Promise.resolve().then(async () => {
    const access = getTokens(), versions = loadCredentialVersionService();
    connection = createAuthRedisConnection(loadRedisConfiguration());
    await connection.connect();
    return Object.freeze({ tokens: access, versions, sessions: createSessionService(connection) });
  });
}
function close() { connection?.close(); }
module.exports = { getTokens, getRuntime, close };
