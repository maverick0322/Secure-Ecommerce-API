'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readEnvSecret } = require('../../services/secret-env.service');

describe('SEC-11: readEnvSecret (*_FILE support)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-env-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads secret from <NAME>_FILE inside an allowed root and trims trailing whitespace', () => {
    const secretFile = path.join(tmpDir, 'db-pass');
    fs.writeFileSync(secretFile, 'synthetic-secret-value\n', 'utf8');
    const env = {
      DB_PASSWORD_FILE: secretFile,
      DB_PASSWORD: 'ignored-env-value',
      AUTH_CONFIG_ALLOWED_ROOTS: JSON.stringify([tmpDir])
    };
    expect(readEnvSecret('DB_PASSWORD', env)).toBe('synthetic-secret-value');
  });

  it('falls back to environment variable when <NAME>_FILE is not set', () => {
    expect(readEnvSecret('DB_PASSWORD', { DB_PASSWORD: 'direct-value' })).toBe('direct-value');
    expect(readEnvSecret('DB_PASSWORD', {})).toBeUndefined();
  });

  it('rejects <NAME>_FILE outside allowed roots', () => {
    const secretFile = path.join(tmpDir, 'secret');
    fs.writeFileSync(secretFile, 'val', 'utf8');
    expect(() => readEnvSecret('DB_PASSWORD', { DB_PASSWORD_FILE: secretFile })).toThrow();
  });
});
