const { createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const { AccountError } = require('./accounts.service');
const mailer = require('./registration-email.service');

const TTL = 10 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_PENDING = 1000;
const entries = new Map();
const key = randomBytes(32);

function digest(email, code,purpose) {
  return createHmac('sha256', key).update(purpose).update('\0').update(email).update('\0').update(code).digest();
}

function removeExpired(now) {
  for (const [address, entry] of entries) {
    if (!entry.busy && entry.expiresAt <= now) entries.delete(address);
  }
}

setInterval(() => removeExpired(Date.now()), COOLDOWN).unref();

async function issue(email,payload=null,purpose='registration') {
  if(!['registration','recovery'].includes(purpose))throw new AccountError(400,'Propósito inválido.');
  const id=purpose+'\0'+email;
  const now = Date.now();
  removeExpired(now);
  const previous = entries.get(id);
  if (previous?.busy || (previous && previous.sentAt + COOLDOWN > now)) return;
  if (!previous && entries.size >= MAX_PENDING) throw new AccountError(429, 'Intente solicitar el código más tarde.');

  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const entry = { hash: digest(email, code,purpose),payload, sentAt: now, expiresAt: now + TTL,
    attempts: previous?.attempts ?? MAX_ATTEMPTS, busy: true };
  if (entry.attempts === 0) return;
  entries.set(id, entry);
  try {
    if(purpose==='registration'||payload)await mailer.sendVerificationCode(email, code,purpose);
  } catch (error) {
    if (previous) entries.set(id, previous);
    else entries.delete(id);
    throw error;
  } finally {
    entry.busy = false;
  }
}

async function verify(email, code, create,purpose='registration') {
  const id=purpose+'\0'+email;
  const entry = entries.get(id);
  const invalid = () => new AccountError(400, 'El código es inválido o ha caducado.');
  if (!entry || entry.expiresAt <= Date.now() || entry.attempts <= 0 || entry.busy) throw invalid();
  if (typeof code!=='string'||!/^\d{6}$/.test(code)||!timingSafeEqual(entry.hash, digest(email, code,purpose))) {
    entry.attempts--;
    throw invalid();
  }

  entry.busy = true;
  try {
    const account = await create(entry.payload);
    entries.delete(id);
    return account;
  } catch (error) {
    if (error instanceof AccountError && error.status === 409) entries.delete(id);
    throw error;
  } finally {
    entry.busy = false;
  }
}

module.exports = { issue, verify };
