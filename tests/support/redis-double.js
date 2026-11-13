'use strict';
// Command-level in-memory Redis double. No authentication/session rules here.
const { EventEmitter } = require('node:events');
const { randomBytes } = require('node:crypto');
const { WatchError } = require('redis');

class RedisDouble {
  constructor() {
    this.data = new Map(); this.versions = new Map(); this.clients = [];
    this.now = 1800000000000; this.runId = randomBytes(20).toString('hex');
    this.role = 'master'; this.version = '8.2.3'; this.online = true;
    this.writes = 0; this.execs = 0; this.conflicts = 0; this.forcedConflicts = 0;
  }
  changed(key) { this.versions.set(key, (this.versions.get(key) || 0) + 1); }
  get(key) {
    const record = this.data.get(key);
    if (record?.expiresAt !== null && record?.expiresAt <= this.now) {
      this.data.delete(key); this.changed(key); return null;
    }
    return record || null;
  }
  serializedData() { return JSON.stringify([...this.data]); }
  command(args) {
    if (!this.online) throw new Error('offline');
    const [name, key, value] = args;
    if (name === 'INFO') return `run_id:${this.runId}\r\nrole:${this.role}\r\nredis_version:${this.version}\r\n`;
    if (name === 'TIME') return [String(Math.floor(this.now / 1000)), String((this.now % 1000) * 1000)];
    if (name === 'GET') return this.get(key)?.value ?? null;
    if (name === 'SET' || name === 'DEL') {
      this.writes++;
      if (this.writes === this.failWriteAt) throw new Error('simulated command failure');
      if (name === 'DEL') { const found = this.get(key); this.data.delete(key); this.changed(key); return found ? 1 : 0; }
      if (args.includes('NX') && this.get(key)) return null;
      const expiresAt = args[3] === 'PXAT' ? Number(args[4]) : null;
      this.data.set(key, { value, expiresAt }); this.changed(key); this.get(key); return 'OK';
    }
    throw new Error('Unexpected native command');
  }
  clientFactory(options) {
    const server = this, client = new EventEmitter();
    client.options = options; client.isOpen = false; client.isReady = false;
    client.watched = new Map(); client.leased = false;
    client.connect = async () => { if (!server.online) throw new Error('offline'); client.isOpen = client.isReady = true; return client; };
    client.destroy = () => { client.isOpen = client.isReady = false; client.watched.clear(); };
    client.sendCommand = async args => { if (!client.isReady) throw new Error('closed'); return server.command(args); };
    client.watch = async keys => {
      if (!server.online || !client.isReady) throw new Error('offline');
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        server.get(key); if (!client.watched.has(key)) client.watched.set(key, server.versions.get(key) || 0);
      }
      return 'OK';
    };
    client.unwatch = async () => { if (!server.online || !client.isReady) throw new Error('offline'); client.watched.clear(); return 'OK'; };
    client.multi = () => {
      const commands = [];
      const multi = {
        addCommand(args) { commands.push(args); return multi; },
        async exec() {
          server.execs++;
          if (server.beforeExec) await server.beforeExec(client, commands);
          if (!server.online || !client.isReady) throw new Error('offline');
          if (server.forcedConflicts > 0) {
            server.forcedConflicts--; server.changed(client.watched.keys().next().value);
          }
          for (const [key, version] of client.watched) {
            server.get(key);
            if ((server.versions.get(key) || 0) !== version) {
              client.watched.clear(); server.conflicts++; throw new WatchError();
            }
          }
          client.watched.clear();
          // Like Redis, an execution-time command error does not roll back or
          // prevent the remaining queued commands from running.
          const result = commands.map(args => { try { return server.command(args); } catch (error) { return error; } });
          if (server.dropCommitReply && commands.some(args => args[0] === 'SET' && args[1].includes(':session:'))) {
            server.dropCommitReply = false; throw new Error('reply lost after commit');
          }
          if (result.some(reply => reply instanceof Error)) throw new Error('partial EXEC error');
          return result;
        }
      };
      return multi;
    };
    this.clients.push(client); return client;
  }
  poolFactory(options, poolOptions) {
    const server = this, pool = new EventEmitter(), idle = [], waiters = [], owned = [];
    let count = 0, destroyed = false;
    const make = async () => {
      count++; const client = server.clientFactory(options); owned.push(client); client.on('error', error => pool.emit('error', error));
      await client.connect(); return client;
    };
    pool.options = poolOptions;
    pool.connect = async () => { idle.push(await make()); };
    pool.execute = async work => {
      if (destroyed) throw new Error('closed pool');
      const client = idle.pop() || (count < poolOptions.maximum ? await make() : await new Promise((resolve, reject) => {
        const entry = { resolve, reject }; entry.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(entry), 1); reject(new Error('pool acquire timeout'));
        }, poolOptions.acquireTimeout); waiters.push(entry);
      }));
      if (client.leased) throw new Error('nonexclusive lease'); client.leased = true;
      try { return await work(client); }
      finally {
        client.leased = false;
        if (!destroyed) {
          const next = waiters.shift();
          if (next) { clearTimeout(next.timer); next.resolve(client); } else idle.push(client);
        }
      }
    };
    pool.destroy = () => {
      destroyed = true;
      for (const client of owned) client.destroy();
      for (const entry of waiters.splice(0)) { clearTimeout(entry.timer); entry.reject(new Error('closed pool')); }
    };
    return pool;
  }
}
module.exports = { RedisDouble };
