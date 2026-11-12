const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { AccountError } = require('./accounts.service');
const mailer = require('./registration-email.service');

const TTL = 10 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_PENDING = 1000;
const entries = new Map();
const key = randomBytes(32);

function digest(email, code) {
  return createHmac('sha256', key).update(email).update('\0').update(code).digest();
}

function removeExpired(now) {
  for (const [address, entry] of entries) {
    if (!entry.busy && entry.expiresAt <= now) entries.delete(address);
  }
}

setInterval(() => removeExpired(Date.now()), COOLDOWN).unref();

async function issue(email) {
  const now = Date.now();
  removeExpired(now);
  const previous = entries.get(email);
  if (previous?.busy || (previous && previous.sentAt + COOLDOWN > now)) return;
  if (!previous && entries.size >= MAX_PENDING) throw new AccountError(429, 'Intente solicitar el código más tarde.');

  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const entry = { hash: digest(email, code), sentAt: now, expiresAt: now + TTL,
    attempts: previous?.attempts ?? MAX_ATTEMPTS, busy: true };
  if (entry.attempts === 0) return;
  entries.set(email, entry);
  try {
    await mailer.sendVerificationCode(email, code);
  } catch (error) {
    if (previous) entries.set(email, previous);
    else entries.delete(email);
    throw error;
  } finally {
    entry.busy = false;
  }
}

async function verify(email, code, create) {
  const entry = entries.get(email);
  const invalid = () => new AccountError(400, 'El código es inválido o ha caducado.');
  if (!entry || entry.expiresAt <= Date.now() || entry.attempts <= 0 || entry.busy) throw invalid();
  if (!timingSafeEqual(entry.hash, digest(email, code))) {
    entry.attempts--;
    throw invalid();
  }

  entry.busy = true;
  try {
    const account = await create();
    entries.delete(email);
    return account;
  } catch (error) {
    if (error instanceof AccountError && error.status === 409) entries.delete(email);
    throw error;
  } finally {
    entry.busy = false;
  }
}

module.exports = { issue, verify };
