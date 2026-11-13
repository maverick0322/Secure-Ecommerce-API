'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const iso = require('../../postman/scripts/isolation');
const { openRun } = require('../../postman/scripts/cleanup-paths');
let temporary, reports, runId, directory, outside;
beforeEach(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sonar-security-'));
  reports = path.join(temporary, 'reports'); runId = crypto.randomUUID();
  directory = path.join(reports, runId); fs.mkdirSync(directory, { recursive: true });
  outside = path.join(temporary, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'unchanged');
  fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify({ runId }));
});
afterEach(() => {
  jest.restoreAllMocks();
  expect(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8')).toBe('unchanged');
  fs.rmSync(temporary, { recursive: true, force: true });
});
it.each(['../outside', '..\\outside', '--all', 'a'.repeat(36), 'a'.repeat(10000), '/tmp', null])('rejects invalid run identifier %#', value => {
  expect(() => openRun(reports, value)).toThrow('INVALID_RUN_ID');
  expect(() => iso.validateRunId(value)).toThrow('INVALID_RUN_ID');
});
it('reads and replaces only owned regular state files and removes private fixtures', () => {
  const files = openRun(reports, runId);
  expect(files.readState().runId).toBe(runId);
  fs.writeFileSync(path.join(directory, 'private.postman_environment.json'), '{}');
  files.cleanFiles({ runId, status: 'cleaned' });
  expect(files.readState().status).toBe('cleaned');
  expect(fs.existsSync(path.join(directory, 'private.postman_environment.json'))).toBe(false);
});
it('rejects a run directory junction before reading', () => {
  fs.rmSync(directory, { recursive: true });
  fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => openRun(reports, runId)).toThrow('UNSAFE_REPORT_DIRECTORY');
});
it('rejects a junction at the reports root', () => {
  fs.renameSync(reports, reports + '-old');
  fs.symlinkSync(outside, reports, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => openRun(reports, runId)).toThrow('UNSAFE_REPORT_DIRECTORY');
});
it.each(['state.json','private.postman_environment.json'])('rejects a symbolic directory at file target %s', name => {
  if(name==='state.json')fs.unlinkSync(path.join(directory,name));
  fs.symlinkSync(outside,path.join(directory,name),process.platform==='win32'?'junction':'dir');
  expect(() => openRun(reports,runId).validateArtifacts()).toThrow('UNSAFE_REPORT_FILE');
});
it('rejects linked state files without overwriting the external inode', () => {
  fs.unlinkSync(path.join(directory, 'state.json'));
  fs.linkSync(path.join(outside, 'sentinel'), path.join(directory, 'state.json'));
  expect(() => openRun(reports, runId).readState()).toThrow('UNSAFE_REPORT_FILE');
});
it('rejects linked private files before any deletion', () => {
  fs.linkSync(path.join(outside, 'sentinel'), path.join(directory, 'private.postman_environment.json'));
  expect(() => openRun(reports, runId).cleanFiles({ runId })).toThrow('UNSAFE_REPORT_FILE');
});
it('rejects a workspace junction instead of deleting external node_modules', () => {
  fs.symlinkSync(outside, path.join(directory, 'workspace'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => openRun(reports, runId).cleanFiles({ runId })).toThrow('UNSAFE_WORKSPACE');
});
it('unlinks the dependency junction without traversing its target', () => {
  fs.mkdirSync(path.join(directory, 'workspace'));
  fs.symlinkSync(outside, path.join(directory, 'workspace/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  openRun(reports, runId).cleanFiles({ runId });
  expect(fs.existsSync(path.join(directory, 'workspace/node_modules'))).toBe(false);
});
it('revalidates the parents if a directory is replaced after opening the run', () => {
  const files = openRun(reports, runId);
  fs.renameSync(directory, directory + '-old');
  fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => files.cleanFiles({ runId })).toThrow('UNSAFE_REPORT_DIRECTORY');
});
it.each([['inspect', '--all'], ['rm', 'ecommerce_db'], ['stop', '--time', '10', '--all'],
  ['exec', 'a'.repeat(64), 'sh', '-c', 'malicious'], ['compose', 'down'], ['inspect', 'a'.repeat(64) + '\n--all']])('rejects Docker argument injection %#', (...args) => {
  expect(() => iso.validateDockerArgs(args)).toThrow();
});
it('accepts only literal Docker command templates', () => {
  expect(() => iso.validateDockerArgs(['inspect', 'a'.repeat(64)])).not.toThrow();
  const args=['run','--detach','--pull','never','--name','secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12),
    '--hostname','secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12),
    '--label','secure-ecommerce.test-suite=postman','--label','secure-ecommerce.test-run='+runId,
    '--publish','127.0.0.1::3306','--tmpfs','/var/lib/mysql:rw','--env','MYSQL_ROOT_PASSWORD','--env','MYSQL_ROOT_HOST=%','mysql:8.0'];
  expect(() => iso.validateDockerArgs(args)).not.toThrow();
  args[13]='3307:3306'; expect(() => iso.validateDockerArgs(args)).toThrow();
});
it('rejects malformed create/destroy inputs before invoking Docker', async () => {
  await expect(iso.create('--privileged')).rejects.toThrow('INVALID_RUN_ID');
  expect(() => iso.destroy({ runId, containerId: '--all' })).toThrow('INVALID_CONTAINER_ID');
});
it('rejects foreign containers at the existing metadata barrier', () => {
  const name='secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12);
  const fixture={runId,name,database:'secure_ecommerce_postman_'+runId.replace(/-/g,''),containerId:'a'.repeat(64)};
  expect(() => iso.assertMetadata({Id:'b'.repeat(64)},fixture)).toThrow('CONTAINER_ID_MISMATCH');
  expect(() => iso.assertMetadata({}, {...fixture,database:'secure_ecommerce'})).toThrow('DATABASE_RUN_MISMATCH');
});
it('passes Docker arguments without a shell and refuses remote cleanup contexts', () => {
  const child=require('node:child_process');
  const spawn=jest.spyOn(child,'spawnSync').mockReturnValue({status:0,stdout:JSON.stringify([{Endpoints:{docker:{Host:'tcp://remote:2375'}}}])});
  jest.isolateModules(() => {
    const isolated=require('../../postman/scripts/isolation');
    expect(() => isolated.destroy({runId,containerId:'a'.repeat(64)})).toThrow('REMOTE_DOCKER_CONTEXT_FORBIDDEN');
  });
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0][2].shell).toBe(false);
  expect(spawn.mock.calls[0][1]).not.toContain('stop');
});
it('rejects a remote DOCKER_HOST and endpoint overrides before spawning Docker', () => {
  const saved=process.env.DOCKER_HOST;
  try {
    process.env.DOCKER_HOST='tcp://remote:2375';
    expect(() => iso.docker(['inspect','a'.repeat(64)])).toThrow('REMOTE_DOCKER_HOST_FORBIDDEN');
    delete process.env.DOCKER_HOST;
    expect(() => iso.docker(['inspect','a'.repeat(64)],{env:{DOCKER_CONTEXT:'other'}})).toThrow('DOCKER_ENDPOINT_OVERRIDE_FORBIDDEN');
  } finally {
    if(saved===undefined)delete process.env.DOCKER_HOST;else process.env.DOCKER_HOST=saved;
  }
});
it('does not stop or remove an unrelated inspected container', () => {
  const child=require('node:child_process');
  const spawn=jest.spyOn(child,'spawnSync').mockImplementation((command,args)=>({status:0,stdout:JSON.stringify(
    args.includes('context')?[{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}]:[{Id:'b'.repeat(64)}])}));
  jest.isolateModules(() => {
    const isolated=require('../../postman/scripts/isolation');
    expect(() => isolated.destroy({runId,containerId:'a'.repeat(64),
      name:'secure-ecommerce-postman-'+runId.replace(/-/g,'').slice(0,12),
      database:'secure_ecommerce_postman_'+runId.replace(/-/g,'')})).toThrow('CONTAINER_ID_MISMATCH');
  });
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(spawn.mock.calls.every(call=>!call[1].includes('stop')&&!call[1].includes('rm'))).toBe(true);
});
it('performs a real bcrypt cost-12 comparison on an absent account without creating a session', async () => {
  const bcrypt=require('bcrypt'), accounts=require('../../services/accounts.service');
  const runtime=require('../../services/auth-runtime.service');
  jest.spyOn(accounts,'findAccountByEmail').mockResolvedValue(null);
  const compare=jest.spyOn(bcrypt,'compare');
  const session=jest.spyOn(runtime,'getRuntime');
  await expect(require('../../services/authentication.service').login({email:'absent@example.invalid',password:'synthetic test password'})).rejects.toMatchObject({status:401});
  expect(compare).toHaveBeenCalledTimes(1);
  expect(bcrypt.getRounds(compare.mock.calls[0][1])).toBe(12);
  expect(session).not.toHaveBeenCalled();
}, 20000);
it('keeps SQL type metadata and publishes no password example', () => {
  expect(require('../../scripts/database/stage4-contract').contract.users.passwordHash).toBe('varchar(255)');
  const spec=require('../../services/swagger-contract.service').completeSpecification({paths:{}});
  expect(spec.paths['/api/auth'].post.parameters[0].schema.properties.password.example).toBeUndefined();
});
it('uses explicit Docker inputs and non-root runtime, with only log/uploads writable in the API', () => {
  const root=path.resolve(__dirname,'../..');
  const api=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const verify=fs.readFileSync(path.join(root,'scripts/database/Dockerfile.node20-verify'),'utf8');
  for (const dockerfile of [api,verify]) {
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\./m);
    expect(dockerfile).toMatch(/^USER node$/m);
  }
  expect(api).toContain('chown node:node uploads log');
  expect(api).not.toContain('chown -R');
  const ignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8');
  for(const entry of ['.secrets/','.env','postman/reports/','**/*.key','**/*.pem'])expect(ignore.split(/\r?\n/)).toContain(entry);
});
