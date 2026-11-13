'use strict';

class RedisConfigurationError extends Error {
  constructor() {
    super('Invalid authentication Redis configuration.');
    this.name = 'RedisConfigurationError';
    this.code = 'AUTH_REDIS_CONFIGURATION_INVALID';
  }
}
class SessionStoreUnavailableError extends Error {
  constructor(outcomeUnknown = false) {
    super('Authentication session storage is unavailable.');
    this.name = 'SessionStoreUnavailableError';
    this.code = 'SESSION_STORE_UNAVAILABLE';
    this.outcomeUnknown = outcomeUnknown;
  }
}
class AuthSessionError extends Error {
  constructor(code) {
    super('Authentication session operation rejected.');
    this.name = 'AuthSessionError';
    this.code = code;
  }
}
module.exports = { RedisConfigurationError, SessionStoreUnavailableError, AuthSessionError };
