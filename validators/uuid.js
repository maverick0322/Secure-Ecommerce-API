'use strict';

// Preserve the existing application's UUID validation during extraction.
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

// The new access-token contract additionally requires an RFC UUID version and
// variant. Nil/Max UUIDs are not account, session or token identifiers here.
const isAccessUuid = value => isUuid(value) && /[1-8]/.test(value[14]) && /[89ab]/i.test(value[19]);

module.exports = { isUuid, isAccessUuid };
