'use strict';
// Ephemeral test key, never a credential/default for the application.
module.exports = require('node:crypto').randomBytes(48).toString('hex');
