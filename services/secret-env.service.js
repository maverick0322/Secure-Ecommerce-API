'use strict';
const { readConfigFile } = require('./secure-config-file.service');

function readEnvSecret(name, env = process.env, { maxBytes = 4096 } = {}) {
  const fileVar = `${name}_FILE`;
  if (env[fileVar]) {
    return readConfigFile(env[fileVar], maxBytes, env).trim();
  }
  return env[name];
}

module.exports = { readEnvSecret };
