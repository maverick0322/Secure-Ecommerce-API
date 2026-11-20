'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, generateKeyPairSync } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, '.secrets');
const ownedFile = path.join(dir, 'team-setup.json');
const [docker, openssl, sid, apiText, redisText, mode] = process.argv.slice(2);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const projectName = /^sce-team-[0-9a-f]{24}$/;
const hex = /^[0-9a-f]{64}$/;
const idPattern = /^[0-9a-f]{64}$/;
const externalKeys = ['GMAIL_SENDER_EMAIL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CORS_ORIGIN'];
const tables = ['users','admins','sellers','buyers','user_addresses','categories','products','product_categories',
  'carts','cart_items','orders','order_items','order_status_history','audit_logs'];
const services = ['db', 'redis', 'app'];
const platformEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|systemroot|windir|comspec|pathext|programfiles|programdata|userprofile|home|appdata|localappdata|temp|tmp)$/i.test(key)));
let phase = 'prerrequisitos';

function requireThat(condition, message) {
  if (!condition) throw new SetupError(message);
}
class SetupError extends Error {}
function command(file, args, env = platformEnv, timeout = 60_000) {
  const result = spawnSync(file, args, { cwd: root, env, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  requireThat(result.status === 0, 'Falló una herramienta local. No se muestran sus argumentos ni diagnósticos privados.');
  return result.stdout.trim();
}
const cli = args => command(docker, ['--context', 'desktop-linux', ...args]);
function write(relative, data) {
  fs.writeFileSync(path.join(dir, relative), data, { flag: 'wx', mode: 0o600 });
}
function localFile(relative) {
  let location = dir;
  const parts = relative.split('/');
  for (const name of parts) {
    location = path.join(location, name);
    const stat = fs.lstatSync(location, { throwIfNoEntry: false });
    if (!stat) return false;
    requireThat(!stat.isSymbolicLink(), 'La instalación contiene un enlace en una ruta protegida.');
    requireThat(name === parts.at(-1) ? stat.isFile() : stat.isDirectory(), 'Una ruta protegida no tiene el tipo esperado.');
  }
  return true;
}
function read(relative, max = 131072) {
  requireThat(localFile(relative), 'Falta un archivo de la instalación. No se vuelve a generar automáticamente.');
  const file = path.join(dir, relative);
  requireThat(fs.statSync(file).size <= max, 'Un archivo protegido supera el tamaño permitido.');
  return fs.readFileSync(file, 'utf8');
}
function port(text) {
  if (!/^\d{4,5}$/.test(text)) return 0;
  const number = Number(text);
  return number >= 1024 && number <= 65535 ? number : 0;
}

function configuration() {
  requireThat(Number(process.versions.node.split('.')[0]) >= 20, 'Se requiere Node.js 20 o superior.');
  const input = path.join(root, '.env');
  const stat = fs.lstatSync(input, { throwIfNoEntry: false });
  requireThat(stat?.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'Se requiere un .env local regular.');
  const config = require('dotenv').parse(fs.readFileSync(input));
  requireThat(config.DB_USER === 'ecommerce_app' && config.DB_DATABASE === 'secure_ecommerce',
    'El backend requiere DB_USER=ecommerce_app y DB_DATABASE=secure_ecommerce.');
  for (const key of externalKeys) {
    requireThat(!/[\0\r\n]/.test(config[key] || ''), 'Una opción externa contiene caracteres no admitidos.');
  }
  requireThat(!(config.CORS_ORIGIN || '').split(',').some(origin => origin.trim() === '*'),
    'CORS_ORIGIN requiere orígenes explícitos.');
  return { ...Object.fromEntries(externalKeys.map(key => [key, config[key] || ''])) };
}

function makePrivateDirectory() {
  fs.mkdirSync(dir, { mode: 0o700 });
  if (process.platform === 'win32') {
    requireThat(/^S-1-\d+(?:-\d+)+$/.test(sid), 'Identidad Windows inválida.');
    const system32 = path.join(process.env.SystemRoot, 'System32');
    command(path.join(system32, 'icacls.exe'), [dir, '/inheritance:r', '/grant:r', '*'+sid+':(OI)(CI)F']);
  }
}

function certificates() {
  const redis = path.join(dir, 'redis');
  const out = file => path.join(redis, file);
  const quietEnv = { ...platformEnv, RANDFILE: out('.openssl-random') };
  const run = args => command(openssl, args, quietEnv);
  // All OpenSSL sections are supplied by the installer, including on Windows.
  write('redis/openssl.cnf', '[req]\ndistinguished_name=dn\n[dn]\n[ca_ext]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n[server_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:redis,DNS:localhost,IP:127.0.0.1\n');
  run(['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','730','-subj','/CN=Secure Ecommerce Team Redis CA',
    '-config',out('openssl.cnf'),'-extensions','ca_ext','-keyout',out('ca.key'),'-out',out('ca.crt')]);
  run(['req','-new','-newkey','rsa:3072','-nodes','-sha256','-subj','/CN=redis',
    '-config',out('openssl.cnf'),'-keyout',out('server.key'),'-out',out('server.csr')]);
  run(['x509','-req','-in',out('server.csr'),'-CA',out('ca.crt'),'-CAkey',out('ca.key'),'-set_serial','0x'+randomBytes(16).toString('hex'),
    '-days','365','-sha256','-extfile',out('openssl.cnf'),'-extensions','server_ext','-out',out('server.crt')]);
  run(['verify','-CAfile',out('ca.crt'),'-verify_hostname','redis',out('server.crt')]);
  run(['verify','-CAfile',out('ca.crt'),'-verify_ip','127.0.0.1',out('server.crt')]);
  // The CA signer is needed only for this issuance and is never mounted.
  for (const file of ['ca.key','server.csr','openssl.cnf','.openssl-random']) {
    fs.rmSync(out(file), { force: true });
  }
}

function initialize(redisControl) {
  const apiPort = port(apiText), redisPort = port(redisText);
  requireThat(apiPort && redisPort && apiPort !== redisPort, 'Los puertos nuevos deben ser distintos y estar entre 1024 y 65535.');
  const state = { version: 1, project: 'sce-team-'+randomBytes(12).toString('hex'), apiPort, redisPort };
  const schema = require('../tests/support/final-schema.json');
  makePrivateDirectory();
  for (const name of ['mysql','auth','auth/public-keys','gmail']) fs.mkdirSync(path.join(dir,name), { mode: 0o700 });
  write('compose.env', '');
  const password = randomBytes(32).toString('hex');
  write('mysql/root-password', randomBytes(32).toString('hex'));
  write('mysql/app-password', password);
  // This script is read only by the MySQL image when its own data directory is new.
  const sql = ['CREATE DATABASE secure_ecommerce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    'USE secure_ecommerce', ...tables.map(name => schema.ddl[name]),
    "CREATE USER 'ecommerce_app'@'%' IDENTIFIED WITH caching_sha2_password BY '"+password+"'", ...schema.grants];
  write('mysql/initial-schema.sql', sql.join(';\n')+';\n');
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072,
    privateKeyEncoding: { type:'pkcs8', format:'pem' }, publicKeyEncoding: { type:'spki', format:'pem' } });
  write('auth/access-private.pem', pair.privateKey);
  write('auth/public-keys/access-v1.pem', pair.publicKey);
  write('auth/public-keys.windows.json', JSON.stringify({ 'access-v1': '.secrets/auth/public-keys/access-v1.pem' }));
  write('auth/public-keys.docker.json', JSON.stringify({ 'access-v1': '/run/auth/public-keys/access-v1.pem' }));
  write('auth/credential-version.key', randomBytes(32));
  write('auth/checkout-hmac', randomBytes(32).toString('hex'));
  redisControl.prepare(path.join(dir, 'redis'));
  certificates();
  write('team-setup.json', JSON.stringify(state));
  return state;
}

function loadState(redisControl) {
  if (!fs.existsSync(dir)) return initialize(redisControl);
  const stat = fs.lstatSync(dir);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink() && localFile('team-setup.json'),
    'Se detectó .secrets ajeno o incompleto. Usar un clon nuevo o revisar el estado manualmente.');
  const state = JSON.parse(read('team-setup.json', 1024));
  requireThat(state.version === 1 && projectName.test(state.project) &&
    state.apiPort === port(String(state.apiPort)) && state.redisPort === port(String(state.redisPort)) &&
    state.apiPort !== state.redisPort, 'Identidad de instalación inválida.');
  return state;
}

function compose(state, env, args) {
  return command(docker, ['--context','desktop-linux','compose','--env-file',path.join(dir,'compose.env'),
    '-f',path.join(__dirname,'compose.yaml'),'-p',state.project,...args], { ...platformEnv, ...env }, 600_000);
}
function inventory(state) {
  const all = cli(['ps','-aq','--filter','label=com.docker.compose.project='+state.project]);
  const result = {};
  for (const id of all.split(/\r?\n/).filter(Boolean)) {
    requireThat(/^[a-f0-9]{12,64}$/.test(id), 'Identidad de contenedor no válida.');
    const row = cli(['inspect','--format','{{.Id}} {{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}}',id]);
    const [full,name,running] = row.split(' ');
    requireThat(services.includes(name) && idPattern.test(full) && !result[name], 'Se detectaron contenedores inesperados.');
    const previous = localFile(name+'.container') && read(name+'.container', 128);
    requireThat(previous === full, 'Se detectó un contenedor sin identidad local o reemplazado. No se adoptará.');
    result[name] = { id: full, running: running === 'true' };
  }
  for (const name of services) {
    requireThat(!localFile(name+'.container') || result[name], 'Falta un contenedor registrado. No se recreará.');
  }
  return result;
}
function createService(state, env, name) {
  const volumes = { db:'mysql_data', redis:'redis_data', app:'api_log' };
  const reserved = state.project+'_'+volumes[name];
  const present = cli(['volume','ls','-q','--filter','name='+reserved]).split(/\r?\n/);
  requireThat(!present.includes(reserved), 'Se encontró un volumen no registrado. No se adoptará.');
  compose(state, env, ['create','--no-build','--no-recreate',name]);
  const id = compose(state, env, ['ps','-a','-q',name]);
  requireThat(idPattern.test(id), 'No se pudo registrar el nuevo contenedor.');
  write(name+'.container',id);
}
function checkVolume(state, name, id) {
  const nameByService = { db:'mysql_data', redis:'redis_data', app:'api_log' };
  const volume = state.project+'_'+nameByService[name];
  const label = cli(['volume','inspect','--format','{{index .Labels "com.docker.compose.project"}}',volume]);
  const mounts = cli(['inspect','--format','{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}',id]).split(/\r?\n/);
  requireThat(label === state.project && mounts.length === 1 && mounts[0] === volume, 'El volumen del contenedor no coincide con la instalación.');
}

async function eventually(work, failure, attempts = 100) {
  for (let i=0; i<attempts; i++) {
    try {
      const value = await work();
      if (value) return value;
    } catch { /* Startup errors are never printed, including SQL diagnostics. */ }
    await sleep(1000);
  }
  throw new SetupError(failure);
}
function mysqlUuid(id) {
  const sql = "SELECT @@server_uuid WHERE CURRENT_USER()='root@localhost' AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='secure_ecommerce' AND table_type='BASE TABLE')=14";
  return cli(['exec', id, 'sh','-ec',
    'mysqladmin --host=127.0.0.1 --user=root ping --silent >/dev/null 2>&1; export MYSQL_PWD="$(cat /run/secrets/mysql_root)"; exec mysql --protocol=SOCKET -uroot --batch --skip-column-names -e "$1"',
    'team-mysql',sql]);
}
function redisSettings(state) {
  return { AUTH_REDIS_HOST:'127.0.0.1',AUTH_REDIS_PORT:String(state.redisPort),AUTH_REDIS_TLS:'true',
    AUTH_REDIS_USER:'auth_session_app',AUTH_REDIS_NAMESPACE:'secure-ecommerce-auth',
    AUTH_REDIS_PASSWORD_PATH:'.secrets/redis/app-password',AUTH_REDIS_CA_PATH:'.secrets/redis/ca.crt',
    AUTH_REDIS_STATE_PATH:'.secrets/redis/state/state.json' };
}
async function redisIdentity(state, control) {
  const client = require('redis').createClient({
    username:'auth_session_app',password:read('redis/app-password',256),
    disableOfflineQueue:true, disableClientInfo:true, maintNotifications:'disabled',
    commandOptions:{timeout:1000},
    socket:{host:'127.0.0.1',port:state.redisPort,tls:true,ca:read('redis/ca.crt'),
      rejectUnauthorized:true,reconnectStrategy:false,connectTimeout:1000}
  });
  client.on('error', () => {});
  try {
    await client.connect();
    return control.parseIdentity(await client.sendCommand(['INFO','server','replication']));
  } finally {
    if (client.isOpen) client.destroy();
  }
}
function confirmPort(id, internal, port) {
  requireThat(cli(['port',id,internal+'/tcp']) === '127.0.0.1:'+port, 'La publicación del servicio no coincide con su puerto loopback.');
}

async function main() {
  requireThat(path.isAbsolute(docker) && path.isAbsolute(openssl) && ['normal','recover'].includes(mode),
    'Ejecuta el instalador con las herramientas locales y los argumentos previstos.');
  const existing = fs.lstatSync(dir, { throwIfNoEntry:false });
  requireThat(!existing || (existing.isDirectory() && !existing.isSymbolicLink() && localFile('team-setup.json')),
    'Se detectó .secrets ajeno o incompleto. Usa un clon nuevo.');
  const external = configuration();
  const redisControl = require('../scripts/redis/control');
  requireThat(cli(['context','inspect','desktop-linux','--format','{{.Endpoints.docker.Host}}']).toLowerCase() ===
    'npipe:////./pipe/dockerdesktoplinuxengine', 'El contexto desktop-linux debe apuntar a la tubería local de Docker Desktop.');
  requireThat(cli(['info','--format','{{.OSType}}']) === 'linux', 'Docker Desktop debe estar ejecutando contenedores Linux.');
  cli(['compose','version','--short']);
  requireThat(/^OpenSSL (?:[3-9]|[1-9]\d+)\./.test(command(openssl,['version'])), 'Se requiere OpenSSL 3 o posterior.');

  phase = 'generación o lectura de identidad local';
  const state = loadState(redisControl);
  const lock = path.join(dir, 'install.lock');
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new SetupError('Ya hay una instalación en curso o un bloqueo pendiente de revisar.');
    throw error;
  }
  try {
    await installServices(state, external, redisControl);
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

async function installServices(state, external, redisControl) {
  const env = { ...external, TEAM_API_PORT:String(state.apiPort), TEAM_REDIS_PORT:String(state.redisPort),
    TEAM_DB_PASSWORD:read('mysql/app-password',128), TEAM_JWT_SECRET:read('auth/checkout-hmac',128),
    TEAM_DB_UUID:'00000000-0000-0000-0000-000000000000',
    JWT_RS256_ISSUER:'secure-ecommerce-api/access-v2',JWT_RS256_AUDIENCE:'secure-ecommerce-clients/access-v2',
    JWT_RS256_ACTIVE_KID:'access-v1' };
  requireThat(hex.test(env.TEAM_DB_PASSWORD) && hex.test(env.TEAM_JWT_SECRET), 'La configuración local de autenticación no es válida.');
  const owned = inventory(state);
  for (const name of services) if (owned[name]) checkVolume(state,name,owned[name].id);
  const previousRedis = localFile('redis/state/state.json') ? JSON.parse(read('redis/state/state.json',1024)) : null;
  const dbInitialized = localFile('mysql/server-uuid');
  requireThat(!dbInitialized || owned.db, 'Falta MySQL ya aprovisionado. No se reinicializará.');
  requireThat(!dbInitialized || owned.db.running, 'MySQL ya aprovisionado está detenido. Revisa su volumen antes de iniciarlo manualmente.');
  if (previousRedis) {
    requireThat(previousRedis.version === 1 && previousRedis.namespace === 'secure-ecommerce-auth' &&
      uuid.test(previousRedis.generation) && /^[0-9a-f]{40}$/.test(previousRedis.expectedRunId),
      'Estado Redis inválido. Se requiere revisión manual.');
    requireThat(owned.redis, 'Falta el Redis registrado. No se recreará.');
    requireThat(owned.redis.running || mode === 'recover', 'Redis está detenido. Para iniciarlo con una generación nueva, usa -RecoverRedis.');
  }
  requireThat(!owned.app || (dbInitialized && previousRedis), 'Faltan identidades requeridas para la aplicación registrada.');

  phase = 'MySQL y esquema definitivo';
  if (!owned.db) createService(state,env,'db');
  const db = read('db.container',128);
  if (!owned.db?.running) cli(['start',db]);
  const server = await eventually(() => {
    const candidate = mysqlUuid(db);
    return uuid.test(candidate) && candidate;
  },'MySQL no verificó su identidad o sus 14 tablas.');
  if (!dbInitialized) write('mysql/server-uuid',server);
  requireThat(read('mysql/server-uuid',128) === server, 'El UUID de MySQL cambió. No se reconfigurará.');
  env.TEAM_DB_UUID = server;

  phase = 'Redis 8.2 con TLS y ACL';
  if (!owned.redis) createService(state,env,'redis');
  const redis = read('redis.container',128);
  if (!owned.redis?.running) cli(['start',redis]);
  confirmPort(redis,6379,state.redisPort);
  const runId = await eventually(() => redisIdentity(state,redisControl),'Redis no autenticó con su ACL y certificado locales.');
  const needsState = previousRedis?.expectedRunId !== runId;
  if (needsState) {
    requireThat(!previousRedis || mode === 'recover', 'Redis cambió de proceso. Usa -RecoverRedis para invalidar sesiones expresamente.');
    await redisControl.recover(redisSettings(state));
    requireThat(JSON.parse(read('redis/state/state.json',1024)).expectedRunId === runId,
      'Redis cambió durante la preparación. Revisa su identidad.');
  }

  phase = 'API, permisos y claves';
  if (!owned.app) {
    compose(state,env,['build','app']);
    createService(state,env,'app');
    cli(['start',read('app.container',128)]);
  } else if (owned.app.running && needsState) {
    cli(['restart',owned.app.id]);
  } else if (!owned.app.running) {
    cli(['start',owned.app.id]);
  }
  const app = read('app.container',128);
  confirmPort(app,3000,state.apiPort);
  const grants = require('../tests/support/final-schema.json').grants;
  command(docker,['--context','desktop-linux','exec',app,'node','-e',verifyApp.toString()+';verifyApp()',JSON.stringify(grants)]);
  await eventually(async () => {
    const response = await fetch('http://127.0.0.1:'+state.apiPort+'/api/setup-readiness', {
      redirect:'error',signal:AbortSignal.timeout(1000)
    });
    await response.arrayBuffer();
    return response.status === 404 && response.headers.get('content-type')?.includes('application/json');
  }, 'La API no respondió en su puerto loopback.',45);
  console.log('Infraestructura verificada: MySQL (14 tablas y cuenta limitada), Redis TLS/ACL y JWT RS256.');
  console.log('API local: http://127.0.0.1:'+state.apiPort);
  console.log('Proyecto Compose: '+state.project);
  console.log(localFile('gmail/client.json') && localFile('gmail/token.json') && external.GMAIL_SENDER_EMAIL
    ? 'Gmail: archivos detectados, envío no comprobado.'
    : 'Gmail pendiente: agrega client.json y autoriza token.json en .secrets/gmail. Configura el remitente.');
  console.log(external.CLOUDINARY_CLOUD_NAME && external.CLOUDINARY_API_KEY && external.CLOUDINARY_API_SECRET
    ? 'Cloudinary: configuración detectada, sin consultas al proveedor.'
    : 'Cloudinary pendiente: completa la configuración propia del proveedor en .env.');
}
// Run inside the existing unprivileged app image using its own mounts and config.
async function verifyApp() {
  const {randomUUID}=require('node:crypto');
  const {getRuntime,close}=require('./services/auth-runtime.service');
  const {sequelize}=require('./models');
  try {
    await require('./services/database.service').verifyConnection(sequelize);
    const [rows]=await sequelize.query('SHOW GRANTS');
    const canonical=grant=>grant.replaceAll(String.fromCharCode(96),'').replace(/\s+/g,' ').toLowerCase();
    const actual=rows.map(row=>canonical(Object.values(row)[0])).sort();
    const expected=JSON.parse(process.argv[1]).map(canonical).sort();
    if(JSON.stringify(actual)!==JSON.stringify(expected)){
      throw new Error('Invalid application grants');
    }
    const {tokens}=await getRuntime(),sub=randomUUID(),sid=randomUUID();
    if(tokens.verify(tokens.sign({sub,sid})).sub!==sub) throw new Error('Access keys mismatch');
  } catch {
    process.exitCode=1;
  } finally {
    close();
    await sequelize.close();
  }
}
main().catch(error => {
  console.error('Instalación detenida durante '+phase+'. '+(error instanceof SetupError ? error.message :
    'Revisa los prerrequisitos y las rutas locales. No se muestran datos privados.'));
  process.exitCode = 1;
});
