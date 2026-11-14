'use strict';
const assert = require('node:assert/strict');
function inspectOwned(info, fixture, beforeStart = false) {
  assert(/^[a-f0-9]{64}$/.test(fixture.id) && info.Id === fixture.id);
  assert.equal(info.Name, '/' + fixture.name); assert(fixture.name.startsWith('secure-ecommerce-redis-test-'));
  assert.equal(info.Config.Hostname, fixture.name);
  assert.equal(info.Config.Labels['secure-ecommerce.redis-test'], fixture.runId);
  assert.equal(info.Config.Image, 'redis:8.2'); if (fixture.imageId) assert.equal(info.Image, fixture.imageId);
  assert(info.Mounts.every(m => m.Type === 'tmpfs' && m.Destination === '/data'));
  assert.equal(info.HostConfig.Tmpfs['/data'], 'rw'); assert(!info.HostConfig.Binds?.length);
  assert(!info.HostConfig.Mounts?.length);
  const configured = info.HostConfig.PortBindings['6379/tcp'];
  assert.equal(configured.length, 1); assert.equal(configured[0].HostIp, '127.0.0.1');
  if (configured[0].HostPort) {
    const bound = Number(configured[0].HostPort);
    assert(Number.isInteger(bound) && bound > 1024 && ![6379, 3306, 3307].includes(bound));
  }
  if (beforeStart) return null;
  const published = info.NetworkSettings.Ports['6379/tcp'];
  assert.equal(published.length, 1); assert.equal(published[0].HostIp, '127.0.0.1');
  const port = Number(published[0].HostPort);
  assert(Number.isInteger(port) && port > 1024 && ![6379, 3306, 3307].includes(port)); return port;
}
module.exports = { inspectOwned };
