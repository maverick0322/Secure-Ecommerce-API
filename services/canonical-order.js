'use strict';
// Match Array#sort's previous UTF-16 code-unit order for string identifiers.
// Locale collation must never change hashes, schema checks or lock acquisition.
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
module.exports = { compareCodeUnits };
