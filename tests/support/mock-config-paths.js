'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Virtual filesystem metadata for loader unit tests; real containment and link
// behavior is exercised against disk in secure-config-file.test.js.
module.exports = locations => {
  const files = locations.map(value => path.resolve(value));
  jest.spyOn(fs, 'openSync').mockImplementation(location => location);
  jest.spyOn(fs, 'fstatSync').mockImplementation(location => fs.statSync(location));
  jest.spyOn(fs, 'closeSync').mockImplementation(() => {});
  jest.spyOn(fs, 'lstatSync').mockImplementation(value => {
    const resolved = path.resolve(value), leaf = files.includes(resolved);
    if (!leaf && !files.some(file => file.startsWith(resolved.endsWith(path.sep) ? resolved : resolved + path.sep))) {
      throw Object.assign(new Error('Synthetic unavailable file'), { code: 'ENOENT' });
    }
    return { isSymbolicLink: () => false, isDirectory: () => !leaf, isFile: () => leaf };
  });
};
