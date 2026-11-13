'use strict';
let runtime, store, tokens;
beforeEach(() => {
  jest.resetModules();
  tokens = { verify: jest.fn(), sign: jest.fn() };
  store = { connect: jest.fn(async () => {}), close: jest.fn() };
  jest.doMock('../../services/rs256-access-token.service', () => ({ loadAccessTokenService: jest.fn(() => tokens) }));
  jest.doMock('../../services/credential-version.service', () => ({ loadCredentialVersionService: jest.fn(() => ({ derive: jest.fn() })) }));
  jest.doMock('../../services/auth-redis.service', () => ({ loadRedisConfiguration: jest.fn(() => ({})), createAuthRedisConnection: jest.fn(() => store) }));
  jest.doMock('../../services/auth-session.service', () => ({ createSessionService: jest.fn(() => ({})) }));
  runtime = require('../../services/auth-runtime.service');
});
afterEach(() => { runtime.close(); jest.restoreAllMocks(); });
it('loads lazily and initializes a single shared runtime under concurrent calls', async () => {
  expect(store.connect).not.toHaveBeenCalled(); expect(runtime.getTokens()).toBe(tokens);
  const [a, b] = await Promise.all([runtime.getRuntime(), runtime.getRuntime()]);
  expect(a).toBe(b); expect(a.tokens).toBe(tokens); expect(store.connect).toHaveBeenCalledTimes(1);
});
it('retains a failed initialization instead of silently reconnecting or using legacy authentication', async () => {
  store.connect.mockRejectedValue(new Error('Synthetic connection failure'));
  await expect(runtime.getRuntime()).rejects.toThrow(); await expect(runtime.getRuntime()).rejects.toThrow();
  expect(store.connect).toHaveBeenCalledTimes(1);
});
