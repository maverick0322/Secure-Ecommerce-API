'use strict';

const MIN_CHARACTERS = 15;
const MAX_BYTES = 72;
// Public, deliberately limited offline denylist. No password or digest is sent
// to a provider. This is not a complete database of compromised passwords.
const common = new Set([
  'password', 'passwordpassword', 'password123456789', 'passw0rd', 'p@ssw0rd',
  'securepassword', 'strongpassword', 'mypassword', 'thisisapassword',
  'contraseña', 'contrasena', 'contraseñasegura', 'contrasenasegura',
  'admin', 'administrator', 'administrador', 'administradorseguro',
  'qwerty', 'qwertyuiop', 'qwertyuiopasdfgh', 'asdfghjkl', 'zxcvbnm',
  'letmein', 'letmeinletmein', 'iloveyou', 'iloveyouiloveyou', 'welcome',
  'welcomehome', 'changeme', 'changemepassword', 'default', 'secret',
  'monkey', 'dragon', 'football', 'baseball', 'superman', 'princess',
  'sunshine', 'summer', 'winter', 'spring', 'autumn', 'verano', 'invierno',
  'correcthorsebatterystaple', '123456789012345', '12345678901234567890'
]);

function validBcryptInput(value) {
  return typeof value === 'string' && value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_BYTES && !value.includes('\0') &&
    !/\p{Surrogate}/u.test(value);
}

function acceptable(value) {
  if (!validBcryptInput(value) || [...value].length < MIN_CHARACTERS) return false;
  // Normalize only the denylist comparison; bcrypt always receives the original.
  const comparable = value.normalize('NFKC').toLowerCase().replace(/[\s_-]/gu, '');
  const base = comparable.replace(/[\p{N}\p{P}\p{S}]+$/gu, '');
  return !common.has(comparable) && !common.has(base) &&
    new Set(comparable).size >= 5 && !/^(.{1,8})\1+$/u.test(comparable) && !/^\p{N}+$/u.test(comparable);
}

module.exports = { acceptable, validBcryptInput, MIN_CHARACTERS, MAX_BYTES };
