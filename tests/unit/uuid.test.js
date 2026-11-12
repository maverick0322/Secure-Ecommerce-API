'use strict';
const { randomUUID } = require('node:crypto');
const { isUuid, isAccessUuid } = require('../../validators/uuid');

it('preserves the legacy validator and exposes an RFC identifier check for new access tokens', () => {
  const id = randomUUID(); expect(isUuid(id)).toBe(true); expect(isAccessUuid(id)).toBe(true);
  expect(isAccessUuid(id.toUpperCase())).toBe(true);
  const nil = '00000000-0000-0000-0000-000000000000';
  expect(isUuid(nil)).toBe(true); expect(isAccessUuid(nil)).toBe(false);
  expect(isAccessUuid('00000000-0000-4000-0000-000000000001')).toBe(false);
});
it.each([null, undefined, {}, [], 1, '', 'not-a-uuid', randomUUID() + '\n'])('rejects invalid UUID input %#', value => {
  expect(isUuid(value)).toBe(false); expect(isAccessUuid(value)).toBe(false);
});
