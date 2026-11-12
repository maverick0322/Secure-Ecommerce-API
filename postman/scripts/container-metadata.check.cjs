'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./container-metadata');

function snapshot() {
  return {
    id: 'original-container', image: 'sha256:original-image', startedAt: '2026-11-12T03:42:49.843243184Z',
    mounts: [
      { type: 'volume', name: 'secure-ecommerce-api_mysql_data', source: '/volumes/mysql', destination: '/var/lib/mysql' },
      { type: 'bind', source: '/project/bd.sql', destination: '/docker-entrypoint-initdb.d/01-init.sql' }
    ],
    ports: { '3306/tcp': [{ HostIp: '127.0.0.1', HostPort: '3307' }] }
  };
}

test('mount ordering and object key ordering do not report a change; snapshots are retained without mutation', () => {
  const before = snapshot(), after = snapshot();
  after.mounts.reverse();
  after.mounts[0] = Object.fromEntries(Object.entries(after.mounts[0]).reverse());
  const original = JSON.stringify({ before, after });
  assert.notEqual(JSON.stringify(before), JSON.stringify(after));
  assert.deepEqual(compare(before, after).differences, []);
  assert.equal(compare(before, after).unchanged, true);
  assert.equal(compare(before, after).before, before);
  assert.equal(compare(before, after).after, after);
  assert.equal(JSON.stringify({ before, after }), original);
});

for (const [field, mutate] of [
  ['id', s => { s.id = 'replacement'; }],
  ['image', s => { s.image = 'sha256:replacement'; }],
  ['startedAt', s => { s.startedAt = '2026-11-12T06:29:00Z'; }],
  ['mounts', s => { s.mounts[0].name = 'other-volume'; }],
  ['mounts', s => { s.mounts[0].source = '/other/source'; }],
  ['mounts', s => { s.mounts[0].destination = '/other/destination'; }],
  ['mounts', s => { s.mounts[0].type = 'bind'; }],
  ['mounts', s => { s.mounts.pop(); }],
  ['mounts', s => { s.mounts.push({ ...s.mounts[0] }); }],
  ['ports', s => { s.ports['3306/tcp'][0].HostIp = '0.0.0.0'; }],
  ['ports', s => { s.ports['3306/tcp'][0].HostPort = '3308'; }],
  ['ports', s => { s.ports['3307/tcp'] = s.ports['3306/tcp']; delete s.ports['3306/tcp']; }],
  ['ports', s => { s.ports['3306/tcp'].push({ ...s.ports['3306/tcp'][0] }); }]
]) test('still detects a real change in ' + field + ': ' + mutate.toString(), () => {
  const before = snapshot(), after = snapshot(); mutate(after);
  const result = compare(before, after);
  assert.equal(result.unchanged, false); assert.deepEqual(result.differences, [field]);
});

test('port binding list ordering is insignificant, but no values are discarded', () => {
  const before = snapshot();
  before.ports['3306/tcp'].push({ HostIp: '::1', HostPort: '3307' });
  const after = structuredClone(before); after.ports['3306/tcp'].reverse();
  assert.equal(compare(before, after).unchanged, true);
});

test('container appearance and disappearance remain failures', () => {
  assert.equal(compare(null, snapshot()).unchanged, false);
  assert.equal(compare(snapshot(), null).unchanged, false);
});
