'use strict';
// Serialized synthetic Redis transaction boundary. No sockets, credentials or real stores.
function createAdmissionDouble() {
  const data = new Map();
  let tail = Promise.resolve();
  const connection = { prefix: 'synthetic:{isolated}:', now: 1800000000000, data, offline: false,
    transaction(work) {
      const next = tail.then(async () => {
        if (connection.offline) throw new Error('Synthetic offline');
        return work({ watch: async () => {}, time: async () => connection.now,
          get: async key => { const row = data.get(key); return row && row.until > connection.now ? row.value : null; },
          commit: async (commands = []) => {
            for (const [cmd, key, value, , until] of commands) {
              if (cmd === 'DEL') data.delete(key);
              else data.set(key, { value, until: Number(until) });
            }
          } });
      });
      tail = next.catch(() => {}); return next;
    } };
  return connection;
}
module.exports = { createAdmissionDouble };
