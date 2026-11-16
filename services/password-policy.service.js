'use strict';

const MIN_CHARACTERS = 8;
const MAX_CHARACTERS = 128;
const MAX_BYTES = 512;

function validInput(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && [...value].length<=MAX_CHARACTERS &&
    Buffer.byteLength(value, 'utf8') <= MAX_BYTES && !value.includes('\0') &&
    !/\p{Surrogate}/u.test(value);
}

function acceptable(value) {
  if (!validInput(value) || [...value].length < MIN_CHARACTERS) return false;
  // Test the original string; never trim or normalize password bytes.
  // Whitespace is permitted but does not count as punctuation/a symbol.
  return /\p{L}/u.test(value) && /\p{N}/u.test(value) && /[\p{P}\p{S}]/u.test(value);
}

module.exports = { acceptable, validInput, validBcryptInput:validInput, MIN_CHARACTERS, MAX_CHARACTERS, MAX_BYTES };
