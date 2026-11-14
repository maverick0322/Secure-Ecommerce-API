'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {PROJECT_ROOT,resolveConfigPath,readConfigFile}=require('../../services/secure-config-file.service');
const {loadAccessTokenService}=require('../../services/rs256-access-token.service');
const {loadCredentialVersionService}=require('../../services/credential-version.service');
const {loadRedisConfiguration,createAuthRedisConnection}=require('../../services/auth-redis.service');
const {RedisDouble}=require('../support/redis-double');
const {checkConfiguration}=require('../../scripts/auth/check-config');
let directory,external,relative,keys;
beforeAll(()=>{keys=crypto.generateKeyPairSync('rsa',{modulusLength:3072});});
beforeEach(()=>{
  fs.mkdirSync(path.join(PROJECT_ROOT,'.secrets'),{recursive:true});
  directory=fs.mkdtempSync(path.join(PROJECT_ROOT,'.secrets','portable-test-'));
  external=fs.mkdtempSync(path.join(os.tmpdir(),'secure-config-test-'));
  relative=path.relative(PROJECT_ROOT,directory).replaceAll('\\','/');
  fs.writeFileSync(path.join(directory,'value'),crypto.randomBytes(32));
});
afterEach(()=>{
  jest.restoreAllMocks();
  if(!directory.startsWith(path.join(PROJECT_ROOT,'.secrets','portable-test-'))||
    !external.startsWith(path.join(os.tmpdir(),'secure-config-test-')))throw new Error('Unsafe test cleanup');
  fs.rmSync(directory,{recursive:true,force:true});fs.rmSync(external,{recursive:true,force:true});
});
it('roots relative paths at the project independently of cwd and accepts either separator',()=>{
  jest.spyOn(process,'cwd').mockReturnValue(external);
  const posix=relative+'/value',windows=posix.replaceAll('/','\\');
  expect(resolveConfigPath(posix,{})).toBe(path.join(directory,'value'));
  expect(resolveConfigPath(windows,{})).toBe(path.join(directory,'value'));
  expect(Buffer.isBuffer(readConfigFile(windows,32,{},null))).toBe(true);
});
it.each(['../.secrets/value','.secrets/../value','.secrets/test/../../value','config/value','/etc/passwd',
  'https://example.invalid/key','file:///etc/passwd','C:relative.key','\\\\server\\share\\key','//server/share/key',
  '.secrets/value:stream','.secrets/value\0',' .secrets/value','',undefined])('rejects unsafe paths before reading %#',value=>{
  const read=jest.spyOn(fs,'readFileSync');let failure,calls;
  try {readConfigFile(value,128,{});}catch(error){failure=error;}
  finally {calls=read.mock.calls.slice();read.mockRestore();}
  // Assert after restoring: Jest's lazy stack/source-map rendering may itself
  // read dependency files. Only reads during the guarded operation are relevant.
  expect(failure).toBeInstanceOf(Error);expect(calls).toEqual([]);
});
it('allows explicit managed roots but never uses them to escape through a relative path',()=>{
  const file=path.join(external,'value');fs.writeFileSync(file,'managed');
  expect(()=>readConfigFile(file,128,{})).toThrow();
  const env={AUTH_CONFIG_ALLOWED_ROOTS:JSON.stringify([external])};
  expect(readConfigFile(file,128,env)).toBe('managed');
  expect(()=>resolveConfigPath(path.relative(PROJECT_ROOT,file),env)).toThrow();
  expect(()=>resolveConfigPath(external+'-sibling/value',env)).toThrow();
});
it.each(['bad-json','{}','["relative"]','["https://invalid"]'])('rejects malformed managed allowlists %#',value=>{
  expect(()=>resolveConfigPath(path.join(directory,'value'),{AUTH_CONFIG_ALLOWED_ROOTS:value})).toThrow();
});
it('rejects a directory symlink/junction escaping to an external root even when that root is allowed',()=>{
  fs.writeFileSync(path.join(external,'value'),'outside');
  fs.symlinkSync(external,path.join(directory,'linked'),process.platform==='win32'?'junction':'dir');
  const env={AUTH_CONFIG_ALLOWED_ROOTS:JSON.stringify([external])};
  expect(()=>readConfigFile(relative+'/linked/value',128,env)).toThrow();
});
it('rejects a leaf link and checks path identity again after reading',()=>{
  const original=fs.lstatSync;
  jest.spyOn(fs,'lstatSync').mockImplementation(location=>location===path.join(directory,'value')?
    {isSymbolicLink:()=>true}:original(location));
  expect(()=>readConfigFile(relative+'/value',128,{})).toThrow();
  fs.lstatSync.mockRestore();
  const read=fs.readFileSync;
  jest.spyOn(fs,'readFileSync').mockImplementation((...args)=>{const result=read(...args);fs.appendFileSync(path.join(directory,'value'),'changed');return result;});
  expect(()=>readConfigFile(relative+'/value',128,{})).toThrow();
});
it('rejects directories, oversized files and missing ancestors; allows only a missing final state leaf',()=>{
  expect(()=>readConfigFile(relative,128,{})).toThrow();expect(()=>readConfigFile(relative+'/value',31,{})).toThrow();
  expect(()=>resolveConfigPath(relative+'/missing',{})).toThrow();
  expect(resolveConfigPath(relative+'/missing',{}, {allowMissingLeaf:true})).toBe(path.join(directory,'missing'));
  expect(()=>resolveConfigPath(relative+'/missing-parent/file',{}, {allowMissingLeaf:true})).toThrow();
});
it('does not read a file descriptor redirected between path validation and open',()=>{
  const outside=path.join(external,'outside');fs.writeFileSync(outside,crypto.randomBytes(32));
  const open=fs.openSync,read=jest.spyOn(fs,'readFileSync');
  jest.spyOn(fs,'openSync').mockImplementation(()=>open(outside,'r'));
  expect(()=>readConfigFile(relative+'/value',128,{})).toThrow();
  expect(read).not.toHaveBeenCalled();
});
function fixture(){
  fs.writeFileSync(path.join(directory,'private.pem'),keys.privateKey.export({type:'pkcs8',format:'pem'}));
  fs.writeFileSync(path.join(directory,'public.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
  fs.writeFileSync(path.join(directory,'manifest.json'),'\uFEFF'+JSON.stringify({'access-v1':relative+'/public.pem'}));
  const password=crypto.randomBytes(32).toString('hex'),key=crypto.randomBytes(32),server=new RedisDouble();
  fs.writeFileSync(path.join(directory,'password'),password);fs.writeFileSync(path.join(directory,'hmac'),key);
  fs.writeFileSync(path.join(directory,'ca.crt'),require('node:tls').rootCertificates[0]);
  const generation=crypto.randomUUID();
  fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({version:1,namespace:'isolated-portable',generation,expectedRunId:server.runId}));
  const env={JWT_RS256_ISSUER:'isolated-access',JWT_RS256_AUDIENCE:'isolated-client',JWT_RS256_ACTIVE_KID:'access-v1',
    JWT_RS256_PRIVATE_KEY_PATH:relative+'/private.pem',JWT_RS256_PUBLIC_KEYS_PATH:relative+'/manifest.json',
    AUTH_CREDENTIAL_VERSION_KEY_PATH:relative+'/hmac',AUTH_REDIS_HOST:'127.0.0.1',AUTH_REDIS_PORT:'16379',
    AUTH_REDIS_TLS:'true',AUTH_REDIS_USER:'isolated',AUTH_REDIS_NAMESPACE:'isolated-portable',
    AUTH_REDIS_PASSWORD_PATH:relative+'/password',AUTH_REDIS_STATE_PATH:relative+'/state.json',AUTH_REDIS_CA_PATH:relative+'/ca.crt'};
  return {env,password,key,server};
}
it('loads RSA, relative/BOM public manifest and HMAC without changing the existing key pair or kid',()=>{
  const {env}=fixture();const before=fs.readFileSync(path.join(directory,'private.pem'));
  const service=loadAccessTokenService(env),token=service.sign({sub:crypto.randomUUID(),sid:crypto.randomUUID()});
  expect(service.verify(token).iss).toBe('isolated-access');
  expect(require('jsonwebtoken').decode(token,{complete:true}).header.kid).toBe('access-v1');
  expect(typeof loadCredentialVersionService(env).derive).toBe('function');
  expect(fs.readFileSync(path.join(directory,'private.pem')).equals(before)).toBe(true);
});
it('blocks relative manifest traversal and private/public mismatch',()=>{
  const {env}=fixture();
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({'access-v1':'../public.pem'}));
  expect(()=>loadAccessTokenService(env)).toThrow();
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({'other':relative+'/public.pem'}));
  expect(()=>loadAccessTokenService(env)).toThrow();
});
it('loads Redis password, state and explicit CA, passing certificate verification to the pool',async()=>{
  const {env,password,server}=fixture(),config=loadRedisConfiguration(env);
  expect(config.password===password).toBe(true);expect(config.ca.includes('BEGIN CERTIFICATE')).toBe(true);
  const connection=createAuthRedisConnection(config,{poolFactory:(o,p)=>server.poolFactory(o,p)});
  try{await connection.connect();expect(server.clients[0].options.socket.ca===config.ca).toBe(true);
    expect(server.clients[0].options.socket.rejectUnauthorized).toBe(true);}finally{connection.close();}
});
it('rejects invalid CA bundles and CA configuration with plaintext transport',()=>{
  const {env}=fixture();fs.writeFileSync(path.join(directory,'ca.crt'),'invalid certificate');
  expect(()=>loadRedisConfiguration(env)).toThrow();
  expect(()=>loadRedisConfiguration({...env,AUTH_REDIS_TLS:'false'})).toThrow();
});
it('rejects a valid PEM envelope with invalid DER and preserves a valid multi-certificate bundle',()=>{
  const {env}=fixture();
  fs.writeFileSync(path.join(directory,'ca.crt'),'-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----');
  expect(()=>loadRedisConfiguration(env)).toThrow();
  const bundle=require('node:tls').rootCertificates.slice(0,2).join('\n');
  fs.writeFileSync(path.join(directory,'ca.crt'),bundle);
  expect(loadRedisConfiguration(env).ca).toBe(bundle);
});
it('reports sanitized file/loader status and does not connect to Redis',()=>{
  const {env,password}=fixture(),report=checkConfiguration(env);
  expect(report.rs256).toBe('OK');expect(report.hmac).toBe('OK');expect(report.redis).toBe('OK');
  expect(report.redisConnectionAttempted).toBe(false);expect(JSON.stringify(report).includes(password)).toBe(false);
  const missing=checkConfiguration({...env,JWT_RS256_PRIVATE_KEY_PATH:''});
  expect(missing.rs256).toBe('INVALID');expect(missing.missingRs256Variables).toContain('JWT_RS256_PRIVATE_KEY_PATH');
});
