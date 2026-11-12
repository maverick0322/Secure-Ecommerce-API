'use strict';

// Administrative operations are explicit subcommands; never load the API's .env.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const container = 'ecommerce_db';
const expectedContainer = '29e92b602f717a55be5195e1ef823545844d7cd6ef87eca45bd59800ec823142';
const expectedUuid = 'b68c7b62-dc02-11f1-b706-caca74da477e';
const database = 'secure_ecommerce';
const artifactDirectory = path.resolve('log/stage4');
const historical = fs.readdirSync('migrations').filter(n => /^(202401|20261108).*\.js$/.test(n)).sort();
const additive = ['20261110000001-create-secure-ecommerce-tables.js', '20261110000002-prepare-existing-ecommerce-tables.js'];
const cutover = '20261110000003-finalize-secure-ecommerce-schema.js';
const business = ['users','admins','sellers','buyers','user_addresses','categories','products',
  'product_categories','carts','cart_items','orders','order_items','order_status_history','audit_logs'].sort();
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

function docker(args, input) {
  const result = spawnSync('docker', ['--context', 'desktop-linux', ...args], {
    input, encoding: 'utf8', timeout: 60000, windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Docker operation failed');
  return result.stdout;
}

function checkContainer() {
  const details = JSON.parse(docker(['inspect', '--format',
    '{{json .}}', container]));
  assert.equal(details.Id, expectedContainer);
  assert.equal(details.Config.Image, 'mysql:8.0');
  assert(details.NetworkSettings.Ports['3306/tcp'].some(p => p.HostPort === '3307'));
  return details;
}

function admin(sql, db) {
  // The container's existing secret stays inside the container, out of argv and logs.
  return docker(['exec', '-i', container, 'sh', '-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --protocol=SOCKET --user=root --batch --raw' +
    (db ? ' --database=secure_ecommerce' : '')], sql);
}

function inspect() {
  const details = checkContainer();
  console.log(JSON.stringify({ container: details.Id, ports: details.NetworkSettings.Ports,
    mounts: details.Mounts.map(m => ({ type: m.Type, name: m.Name, destination: m.Destination })) }));
  console.log(admin(`SELECT @@hostname AS hostname, @@server_uuid AS uuid, @@port AS port,
    VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account,
    @@session.sql_mode AS sqlMode, @@session.foreign_key_checks AS foreignKeys,
    @@global.partial_revokes AS partialRevokes;
    SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
      WHERE SCHEMA_NAME IN ('secure_ecommerce','mercadolibrenode');
    SELECT User, Host, plugin, account_locked FROM mysql.user
      WHERE User IN ('ecommerce_migrator','ecommerce_app');
    SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA='secure_ecommerce';`));
  if (admin("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='secure_ecommerce';").includes(database)) {
    console.log(admin('SELECT name FROM SequelizeMeta ORDER BY name; SHOW CREATE TABLE users; SHOW CREATE TABLE categories; SHOW CREATE TABLE products; SHOW CREATE TABLE product_categories; SHOW CREATE TABLE audit_logs;', true));
  }
}

function verifyAdmin(db = false) {
  checkContainer();
  const lines = admin(`SELECT @@server_uuid, @@port, VERSION(), COALESCE(DATABASE(),'NONE'), CURRENT_USER(), @@session.foreign_key_checks;`, db).trim().split('\n');
  const [uuid, port, version, selected, account, fks] = lines.at(-1).split('\t');
  assert.equal(uuid, expectedUuid);
  assert.equal(port, '3306');
  assert.match(version, /^8\.0\./);
  assert.equal(selected, db ? database : 'NONE');
  assert.equal(account, 'root@localhost');
  assert.equal(fks, '1');
}

async function connect(user) {
  const file = user === 'ecommerce_migrator' ? '.env.migration.local' : '.env.secure-ecommerce.local';
  const env = require('dotenv').parse(fs.readFileSync(file));
  const password = env[user === 'ecommerce_migrator' ? 'MIGRATION_DB_PASSWORD' : 'DB_PASSWORD'];
  const connection = await mysql.createConnection({ host: '127.0.0.1', port: 3307,
    database, user, password, dateStrings: true, timezone: 'Z' });
  try {
    const [[identity]] = await connection.query(`SELECT @@server_uuid AS uuid, @@port AS port,
      VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account,
      @@session.foreign_key_checks AS fks, @@session.sql_mode AS mode`);
    assert.equal(identity.uuid, expectedUuid);
    assert.equal(identity.port, 3306);
    assert.equal(identity.db, database);
    assert.equal(identity.account, `${user}@%`);
    assert.match(identity.version, /^8\.0\./);
    assert.equal(identity.fks, 1);
    assert.match(identity.mode, /STRICT_(TRANS|ALL)_TABLES/);
    await connection.query("SET time_zone = '+00:00'");
    console.log(JSON.stringify({ endpoint: '127.0.0.1:3307', ...identity }));
    return connection;
  } catch (error) { await connection.end(); throw error; }
}

function artifact(name, data) {
  fs.mkdirSync(artifactDirectory, { recursive: true });
  fs.writeFileSync(path.join(artifactDirectory, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2), { flag: 'wx' });
}

async function provision() {
  verifyAdmin();
  assert.equal(admin("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='secure_ecommerce';").trim(), '');
  assert.equal(admin("SELECT User FROM mysql.user WHERE User IN ('ecommerce_migrator','ecommerce_app');").trim(), '');
  for (const file of ['.env.migration.local', '.env.secure-ecommerce.local']) assert(!fs.existsSync(file), `Refusing to overwrite ${file}`);
  artifact('origin.json', { container: expectedContainer, uuid: expectedUuid, endpoint: '127.0.0.1:3307', database,
    absentBeforeCreation: true, createdAt: new Date().toISOString(),
    originalFiles: Object.fromEntries([...historical.map(n => `migrations/${n}`), 'docs/Propuesta_BD_Secure_Ecommerce_14_tablas.docx'].map(n => [n, sha(fs.readFileSync(n))])) });
  // No IF NOT EXISTS: concurrent creation must fail rather than adopt an unknown schema.
  admin('CREATE DATABASE secure_ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
  verifyAdmin(true);
  const result = admin("CREATE USER 'ecommerce_migrator'@'%' IDENTIFIED WITH caching_sha2_password BY RANDOM PASSWORD;", true);
  const password = result.trim().split('\n').at(-1).split('\t')[2];
  assert(password && !password.includes('\n'));
  fs.writeFileSync('.env.migration.local', `MIGRATION_DB_HOST=127.0.0.1\nMIGRATION_DB_PORT=3307\nMIGRATION_DB_USER=ecommerce_migrator\nMIGRATION_DB_PASSWORD=${JSON.stringify(password)}\n`, { flag: 'wx', mode: 0o600 });
  verifyAdmin(true);
  admin("GRANT SELECT, INSERT, UPDATE, CREATE, ALTER, INDEX, REFERENCES, DROP ON `secure\\_ecommerce`.* TO 'ecommerce_migrator'@'%';", true);
  console.log(admin("SHOW GRANTS FOR 'ecommerce_migrator'@'%';", true));
  const c = await connect('ecommerce_migrator');
  try { assert.deepEqual((await c.query('SHOW TABLES'))[0], []); } finally { await c.end(); }
  artifact('provisioned.json', { uuid: expectedUuid, database, empty: true });
}

async function assertEmpty(c, tables) {
  for (const table of tables.filter(t => t !== 'SequelizeMeta')) {
    assert.match(table, /^[a-z_]+$/);
    assert.equal((await c.query(`SELECT COUNT(*) AS n FROM \`${table}\``))[0][0].n, 0, `Data exists in ${table}; stop`);
  }
}

async function backup(c, label) {
  verifyAdmin(true);
  const tables = (await c.query('SHOW TABLES'))[0].map(row => Object.values(row)[0]).sort();
  await assertEmpty(c, tables);
  const dump = docker(['exec', container, 'sh', '-c',
    'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --protocol=SOCKET --user=root --single-transaction --skip-add-drop-table --set-gtid-purged=OFF --no-tablespaces --hex-blob secure_ecommerce']);
  assert(dump.includes('-- Dump completed on'));
  for (const table of tables) assert(dump.includes(`CREATE TABLE \`${table}\``));
  artifact(`${label}.sql`, dump);
  const disk = fs.readFileSync(path.join(artifactDirectory, `${label}.sql`));
  assert.equal(sha(disk), sha(dump));
  const manifest = { uuid: expectedUuid, database, tables, bytes: disk.length, sha256: sha(disk), businessRows: 0 };
  artifact(`${label}.json`, manifest);
  console.log(`Backup verified: ${label}.sql (${disk.length} bytes, SHA256 ${manifest.sha256})`);
}

function cli(args = []) {
  const migrationEnv = require('dotenv').parse(fs.readFileSync('.env.migration.local'));
  assert.equal(migrationEnv.MIGRATION_DB_HOST, '127.0.0.1');
  assert.equal(migrationEnv.MIGRATION_DB_PORT, '3307');
  assert.equal(migrationEnv.MIGRATION_DB_USER, 'ecommerce_migrator');
  const result = spawnSync(process.execPath, ['node_modules/sequelize-cli/lib/sequelize', 'db:migrate',
    '--config', 'config/secure-ecommerce-migrations.js', '--env', 'migration', ...args], {
    env: { ...process.env, ...migrationEnv, SECURE_ECOMMERCE_CUTOVER_APPROVED: args.includes('migrations/cutover') ? '1' : '' },
    encoding: 'utf8', timeout: 120000, windowsHide: true
  });
  console.log(result.stdout);
  if (result.status !== 0) throw new Error(result.stderr || 'Migration failed; inspect before resuming.');
  return result.stdout;
}

async function finalSnapshot() {
  const c = await connect('ecommerce_migrator');
  try {
    const origin = JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'origin.json')));
    for (const [file, hash] of Object.entries(origin.originalFiles)) assert.equal(sha(fs.readFileSync(file)),hash, `${file} changed`);
    const [tables] = await c.query('SHOW TABLES');
    assert.deepEqual(tables.map(r => Object.values(r)[0]).sort(),[...business,'SequelizeMeta'].sort());
    await assertEmpty(c,business);
    const [history] = await c.query('SELECT name FROM SequelizeMeta ORDER BY name');
    assert.deepEqual(history.map(r => r.name),[...historical,...additive,cutover].sort());
    const [grants] = await c.query('SHOW GRANTS');
    const migratorGrants = grants.map(r => Object.values(r)[0]);
    assert(migratorGrants.every(g => g === 'GRANT USAGE ON *.* TO `ecommerce_migrator`@`%`' || g.includes(' ON `secure\\_ecommerce`.* ')));
    assert(migratorGrants.every(g => !/GRANT OPTION|\bDELETE\b/.test(g)));
    const [identity] = await c.query(`SELECT @@hostname AS hostname, @@server_uuid AS uuid, @@port AS serverPort,
      VERSION() AS version, DATABASE() AS db, CURRENT_USER() AS account, @@session.time_zone AS timeZone`);
    const result = { verifiedAt: new Date().toISOString(), endpoint:'127.0.0.1:3307', identity:identity[0], tables,
      migrations:history, migratorGrants, businessRowCount:0, originalFilesUnchanged:true };
    artifact('final-result.json',result);
    console.log('Tables_in_secure_ecommerce\n' + tables.map(r => Object.values(r)[0]).join('\n'));
    console.log('Exactly 14 business tables + SequelizeMeta; 0 business rows; 11 migrations.');
  } finally { await c.end(); }
}

async function build() {
  verifyAdmin(true);
  const origin = JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'origin.json')));
  assert.equal(origin.uuid, expectedUuid);
  const c = await connect('ecommerce_migrator');
  try {
    assert.deepEqual((await c.query('SHOW TABLES'))[0], []);
    await backup(c, 'before-migrations');
    cli(['--to', historical.at(-1)]);
    assert.deepEqual((await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0].map(r => r.name), historical);
    await assertEmpty(c, (await c.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]));
    cli(['--to', additive.at(-1)]);
    const tables = (await c.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]).sort();
    assert.deepEqual(tables, [...business, 'roles', 'files', 'SequelizeMeta'].sort());
    await backup(c, 'before-cutover');
    // Explicit user approval is restricted to this schema, created empty by provision().
    cli(['--migrations-path', 'migrations/cutover', '--to', cutover]);
    assert.deepEqual((await c.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]).sort(), [...business, 'SequelizeMeta'].sort());
    const before = (await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0];
    assert.deepEqual(before.map(r => r.name), [...historical, ...additive, cutover].sort());
    assert.match(cli(), /No migrations were executed/);
    assert.deepEqual((await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0], before);
    await backup(c, 'final-empty');
    artifact('migrations.json', { applied: before, normalSecondRun: 'No migrations were executed', tables: [...business, 'SequelizeMeta'].sort() });
  } finally { await c.end(); }
}

async function resumeCutover() {
  verifyAdmin(true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'origin.json'))).uuid, expectedUuid);
  assert(fs.existsSync(path.join(artifactDirectory, 'before-cutover.sql')));
  const c = await connect('ecommerce_migrator');
  try {
    assert.deepEqual((await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0].map(r => r.name), [...historical, ...additive].sort());
    const tables = (await c.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]).sort();
    assert.deepEqual(tables, [...business, 'roles', 'files', 'SequelizeMeta'].sort());
    await assertEmpty(c, tables);
    await backup(c, 'before-cutover-resume');
    cli(['--migrations-path', 'migrations/cutover', '--to', cutover]);
    const afterTables = (await c.query('SHOW TABLES'))[0].map(r => Object.values(r)[0]).sort();
    assert.deepEqual(afterTables, [...business, 'SequelizeMeta'].sort());
    const history = (await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0];
    assert.deepEqual(history.map(r => r.name), [...historical, ...additive, cutover].sort());
    assert.match(cli(), /No migrations were executed/);
    assert.deepEqual((await c.query('SELECT name FROM SequelizeMeta ORDER BY name'))[0], history);
    await backup(c, 'final-empty');
    artifact('migrations.json', { applied: history, normalSecondRun: 'No migrations were executed', tables: afterTables });
    console.log((await c.query('SHOW TABLES'))[0]);
  } finally { await c.end(); }
}

async function application() {
  verifyAdmin(true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(artifactDirectory, 'origin.json'))).uuid, expectedUuid);
  assert(fs.existsSync(path.join(artifactDirectory, 'schema-verification.json')));
  assert.equal(admin("SELECT User FROM mysql.user WHERE User='ecommerce_app';", true).trim(), '');
  assert(!fs.existsSync('.env.secure-ecommerce.local'));
  const c = await connect('ecommerce_migrator');
  try { await assertEmpty(c, business); } finally { await c.end(); }
  verifyAdmin(true);
  const result = admin("CREATE USER 'ecommerce_app'@'%' IDENTIFIED WITH caching_sha2_password BY RANDOM PASSWORD;", true);
  const password = result.trim().split('\n').at(-1).split('\t')[2];
  assert(password);
  fs.writeFileSync('.env.secure-ecommerce.local', `# Prepared for later integration. Never loaded by the active API.\nDB_HOST=127.0.0.1\nDB_PORT=3307\nDB_DATABASE=secure_ecommerce\nDB_USER=ecommerce_app\nDB_PASSWORD=${JSON.stringify(password)}\nDOCKER_DB_HOST=db\nDOCKER_DB_PORT=3306\n`, { flag: 'wx', mode: 0o600 });
  const privileges = {
    users: 'SELECT, INSERT, UPDATE', admins: 'SELECT', sellers: 'SELECT, INSERT, UPDATE', buyers: 'SELECT, INSERT',
    user_addresses: 'SELECT, INSERT, UPDATE', categories: 'SELECT, INSERT, UPDATE', products: 'SELECT, INSERT, UPDATE',
    product_categories: 'SELECT, INSERT, UPDATE', carts: 'SELECT, INSERT, UPDATE', cart_items: 'SELECT, INSERT, UPDATE',
    orders: 'SELECT, INSERT, UPDATE (status, updatedAt)', order_items: 'SELECT, INSERT', order_status_history: 'SELECT, INSERT', audit_logs: 'INSERT'
  };
  for (const [table, permissions] of Object.entries(privileges)) {
    verifyAdmin(true);
    admin(`GRANT ${permissions} ON \`secure_ecommerce\`.\`${table}\` TO 'ecommerce_app'@'%';`, true);
  }
  const grants = admin("SHOW GRANTS FOR 'ecommerce_app'@'%'; SHOW GRANTS FOR 'ecommerce_migrator'@'%';", true);
  console.log(grants);
  artifact('account-grants.txt', grants);
  const app = await connect('ecommerce_app');
  try { console.log('Application account authenticated with its separate local configuration.'); } finally { await app.end(); }
}

if (require.main === module) {
  const commands = { inspect, provision, build, 'resume-cutover': resumeCutover, application, final: finalSnapshot };
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Choose an explicit stage4 command.');
  Promise.resolve().then(command).catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { docker, admin, inspect, database, expectedContainer, expectedUuid, verifyAdmin, connect, business, artifact, assertEmpty, sha };
