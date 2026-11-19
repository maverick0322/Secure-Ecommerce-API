'use strict';
const {
  createVerifiedAdmin,
  validateBootstrapEnv,
  assertBootstrapIdentity,
  createOtpChallenge,
  verifyOtpAttempt
} = require('../../scripts/database/bootstrap-admin');

describe('bootstrap-admin transactional provisioning and security guards', () => {
  it('creates user, profile and audit in a single transaction with bind replacements', async () => {
    const transaction = {};
    const connection = { transaction: jest.fn(fn => fn(transaction)), query: jest.fn() };
    const values = { id: 'synthetic-id', email: 'admin@example.invalid', name: 'Synthetic', passwordHash: 'synthetic-hash', verifiedAt: new Date() };
    expect(await createVerifiedAdmin(connection, values)).toBe(values.id);
    expect(connection.query).toHaveBeenCalledTimes(3);
    for (const [sql, options] of connection.query.mock.calls) {
      expect(sql).not.toContain(values.email);
      expect(sql).not.toContain(values.passwordHash);
      expect(options.transaction).toBe(transaction);
      expect(options.replacements).toEqual(values);
    }
  });

  it('propagates profile failure so the transaction manager rolls back the user insert', async () => {
    const connection = { transaction: fn => fn({}), query: jest.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('profile denied')) };
    await expect(createVerifiedAdmin(connection, { id: 'id' })).rejects.toThrow('profile denied');
    expect(connection.query).toHaveBeenCalledTimes(2);
  });

  it('validates bootstrap environment credentials and rejects wrong user or missing UUID/password', () => {
    const valid = validateBootstrapEnv({
      BOOTSTRAP_DB_USER: 'ecommerce_admin_bootstrap',
      BOOTSTRAP_DB_PASSWORD: 'disposable-password',
      BOOTSTRAP_DB_UUID: '11111111-2222-4333-8444-555555555555'
    });
    expect(valid).toMatchObject({ user: 'ecommerce_admin_bootstrap', host: '127.0.0.1', port: 3307 });

    expect(() => validateBootstrapEnv({ BOOTSTRAP_DB_USER: 'root', BOOTSTRAP_DB_PASSWORD: 'p', BOOTSTRAP_DB_UUID: 'u' })).toThrow();
    expect(() => validateBootstrapEnv({ BOOTSTRAP_DB_USER: 'ecommerce_admin_bootstrap', BOOTSTRAP_DB_PASSWORD: '', BOOTSTRAP_DB_UUID: 'u' })).toThrow();
    expect(() => validateBootstrapEnv({ BOOTSTRAP_DB_USER: 'ecommerce_admin_bootstrap', BOOTSTRAP_DB_PASSWORD: 'p', BOOTSTRAP_DB_UUID: '' })).toThrow();
  });

  it('verifies MySQL server identity, account, strict mode and FK checks before provisioning', () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    const good = { db: 'secure_ecommerce', account: 'ecommerce_admin_bootstrap@127.0.0.1', uuid, fks: 1, mode: 'STRICT_TRANS_TABLES' };
    expect(() => assertBootstrapIdentity(good, uuid)).not.toThrow();

    for (const bad of [
      { ...good, db: 'mercadolibrenode' },
      { ...good, account: 'root@localhost' },
      { ...good, uuid: 'other-uuid' },
      { ...good, fks: 0 },
      { ...good, mode: 'NO_ENGINE_SUBSTITUTION' },
      null
    ]) {
      expect(() => assertBootstrapIdentity(bad, uuid)).toThrow('Destino inválido.');
    }
  });

  it('generates 6-digit OTP challenges and rejects wrong or expired codes', () => {
    const start = 1700000000000;
    const challenge = createOtpChallenge({ now: start, ttlMs: 600000 });
    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(verifyOtpAttempt(challenge, challenge.code, start + 1000)).toBe(true);
    expect(verifyOtpAttempt(challenge, challenge.code === '000000' ? '000001' : '000000', start + 1000)).toBe(false);
    expect(verifyOtpAttempt(challenge, challenge.code, start + 600001)).toBe(false);
    expect(verifyOtpAttempt(challenge, null, start + 1000)).toBe(false);
  });
});
