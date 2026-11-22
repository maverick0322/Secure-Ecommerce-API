'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('config/config.js security guards and *_FILE selection', () => {
  let tmpDir;
  const envKeys = [
    'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_DATABASE', 'DB_PASSWORD', 'DB_PASSWORD_FILE',
    'TEST_DB_USER', 'TEST_DB_DATABASE', 'TEST_DB_PASSWORD', 'TEST_DB_PASSWORD_FILE',
    'PROD_DB_USERNAME', 'PROD_DB_NAME', 'PROD_DB_PASSWORD', 'PROD_DB_PASSWORD_FILE',
    'AUTH_CONFIG_ALLOWED_ROOTS'
  ];
  let savedEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    savedEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
    for (const k of envKeys) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function loadConfig(overrides = {}) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    let cfg;
    jest.isolateModules(() => {
      jest.doMock('dotenv', () => ({ config: () => ({}) }));
      cfg = require('../../config/config');
    });
    return cfg;
  }

  it('enforces requireUnprivilegedAccount on development and production hooks', () => {
    const cfg = loadConfig({ DB_USER: 'ecommerce_app', DB_DATABASE: 'secure_ecommerce', DB_PASSWORD: 'valid' });
    for (const envName of ['development', 'production']) {
      const hook = cfg[envName].hooks.beforeConnect;
      expect(() => hook({ username: 'ecommerce_app', password: 'secret', database: 'secure_ecommerce' })).not.toThrow();
      expect(() => hook({ username: 'root', password: 'secret', database: 'secure_ecommerce' })).toThrow(/dedicated ecommerce_app/);
      expect(() => hook({ username: 'ecommerce_app', password: '', database: 'secure_ecommerce' })).toThrow(/dedicated ecommerce_app/);
      expect(() => hook({ username: 'ecommerce_app', password: 'secret', database: 'mercadolibrenode' })).toThrow(/dedicated ecommerce_app/);
    }
  });

  it('selects *_FILE secrets per environment and falls back to DB_PASSWORD_FILE when env-specific files are unset', () => {
    const baseFile = path.join(tmpDir, 'base-pass');
    const testFile = path.join(tmpDir, 'test-pass');
    const prodFile = path.join(tmpDir, 'prod-pass');
    fs.writeFileSync(baseFile, 'base-secret\n');
    fs.writeFileSync(testFile, 'test-secret\n');
    fs.writeFileSync(prodFile, 'prod-secret\n');

    const separate = loadConfig({
      AUTH_CONFIG_ALLOWED_ROOTS: JSON.stringify([tmpDir]),
      DB_PASSWORD_FILE: baseFile,
      TEST_DB_PASSWORD_FILE: testFile,
      PROD_DB_PASSWORD_FILE: prodFile
    });
    expect(separate.development.password).toBe('base-secret');
    expect(separate.test.password).toBe('test-secret');
    expect(separate.production.password).toBe('prod-secret');

    const fallback = loadConfig({
      AUTH_CONFIG_ALLOWED_ROOTS: JSON.stringify([tmpDir]),
      DB_PASSWORD_FILE: baseFile,
      TEST_DB_PASSWORD_FILE: undefined,
      PROD_DB_PASSWORD_FILE: undefined
    });
    expect(fallback.development.password).toBe('base-secret');
    expect(fallback.test.password).toBe('base-secret');
    expect(fallback.production.password).toBe('base-secret');
  });
});
