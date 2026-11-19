'use strict';
// Disposable Redis credentials arrive only over IPC and are never logged or persisted.
const { createAuthRedisConnection } = require('../../services/auth-redis.service');
const { createImageLimits } = require('../../services/image-limits.service');
let connection, limits;
const held = new Map();
process.on('message', async message => {
  try {
    if (message.command === 'start') {
      connection = createAuthRedisConnection(message.config); await connection.connect(); limits = createImageLimits(connection);
    } else if (message.command === 'acquire') {
      held.set(message.id, await limits.acquire(message.user));
    } else if (message.command === 'release') {
      await held.get(message.token)?.release(); held.delete(message.token);
    }
    process.send({ id:message.id, status:200 });
  } catch(error) { process.send({id:message.id,status:error.status===429?429:503}); }
});
process.on('disconnect', () => { connection?.close(); process.exit(0); });
