'use strict';
// Test-only dependency injection, never imported by production modules.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {performance}=require('node:perf_hooks');
const { createAccessTokenService } = require('../../services/rs256-access-token.service');
const { createCredentialVersionService } = require('../../services/credential-version.service');
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { createSessionService } = require('../../services/auth-session.service');
const runtime = require('../../services/auth-runtime.service');
function cryptography() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  return { tokens: createAccessTokenService({ issuer: 'isolated-auth', audience: 'isolated-client', activeKid: 'ephemeral',
    privateKey, publicKeys: new Map([['ephemeral', publicKey]]) }),
  versions: createCredentialVersionService(crypto.randomBytes(32)) };
}
async function start({ applicationRoot, poolFactory, onTiming=()=>{} } = {}) {
  const started=performance.now();
  const targetRuntime = applicationRoot ? require(require('node:path').join(applicationRoot, 'services/auth-runtime.service')) : runtime;
  let done, ready, rejectReady, handle;
  const opened = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const stop = new Promise(resolve => { done = resolve; });
  const run = require('../../scripts/database/stage2-redis-test').withRedisFixture(async ({ config, assertOwned }) => {
    assertOwned();
    onTiming('redis-fixture-ready',performance.now()-started);
    assert(config.namespace.startsWith('secure-ecommerce-auth-test-'));
    assert(![6379, 6380, 3306, 3307].includes(config.port));
    const keyStart=performance.now();
    const store = createAuthRedisConnection(config, poolFactory ? {poolFactory} : undefined), cryptoServices = cryptography();
    onTiming('ephemeral-rsa',performance.now()-keyStart);
    const originals = { getTokens: targetRuntime.getTokens, getRuntime: targetRuntime.getRuntime };
    try {
      const connectStart=performance.now();
      await store.connect(); const services = { ...cryptoServices, sessions: createSessionService(store) };
      onTiming('redis-connect',performance.now()-connectStart);
      targetRuntime.getTokens = () => services.tokens; targetRuntime.getRuntime = async () => services;
      handle = { ...services, config, async issue(account) {
        const accounts = applicationRoot ? require(require('node:path').join(applicationRoot, 'services/accounts.service')) : require('../../services/accounts.service');
        const full = await accounts.findAccountById(account.id, { withPassword: true });
        const session = await services.sessions.create({ userId: full.id, credentialVersion: services.versions.derive(full.passwordHash) });
        return services.tokens.sign({ sub: full.id, sid: session.sessionId });
      }, close: async () => { done(); await run; } };
      ready(handle); await stop;
    } finally { targetRuntime.getTokens = originals.getTokens; targetRuntime.getRuntime = originals.getRuntime; store.close(); }
  });
  // Own the startup rejection immediately; close() still awaits the original
  // promise so teardown errors after ready() remain observable by the caller.
  void run.catch(error => { rejectReady(error); });
  return opened;
}
module.exports = { start, cryptography };
