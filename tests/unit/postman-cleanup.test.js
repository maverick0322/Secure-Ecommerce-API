'use strict';
jest.mock('../../postman/scripts/cleanup-paths',()=>({openRun:jest.fn()}));
jest.mock('../../postman/scripts/isolation',()=>({...jest.requireActual('../../postman/scripts/isolation'),
  assertLocalContext:jest.fn(),protectedSnapshot:jest.fn(),docker:jest.fn(),destroy:jest.fn()}));
const iso=require('../../postman/scripts/isolation');
const {openRun}=require('../../postman/scripts/cleanup-paths');
const {main}=require('../../postman/scripts/cleanup');
let state,files;
const runId='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{
  state={runId,parentPid:2147483647,containerId:'a'.repeat(64)};
  files={readState:jest.fn(()=>state),validateArtifacts:jest.fn(),cleanFiles:jest.fn()};
  openRun.mockReturnValue(files);iso.protectedSnapshot.mockReturnValue({id:'b'.repeat(64)});
  jest.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('Synthetic missing runner'),{code:'ESRCH'});});
  jest.spyOn(console,'log').mockImplementation(()=>{});
});
afterEach(()=>{jest.restoreAllMocks();jest.clearAllMocks();});
it('cleans only the validated stopped run and its private files',()=>{
  main(runId);
  expect(iso.destroy).toHaveBeenCalledWith(expect.objectContaining({runId,containerId:'a'.repeat(64),protectedContainerId:'b'.repeat(64)}));
  expect(files.cleanFiles).toHaveBeenCalledWith(expect.objectContaining({status:'cleaned'}));
  expect(files.validateArtifacts).toHaveBeenCalledTimes(2);
});
it('refuses a state from another run before contacting Docker',()=>{
  state.runId='different';expect(()=>main(runId)).toThrow('STATE_RUN_MISMATCH');
  expect(iso.assertLocalContext).not.toHaveBeenCalled();expect(iso.destroy).not.toHaveBeenCalled();
});
it.each([0,-1,'123',null,Number.MAX_SAFE_INTEGER+1])('rejects invalid runner PID %#',pid=>{
  state.parentPid=pid;expect(()=>main(runId)).toThrow('INVALID_PARENT_PID');expect(iso.destroy).not.toHaveBeenCalled();
});
it('refuses cleanup of a live runner or an unverifiable process',()=>{
  process.kill.mockReturnValue(true);expect(()=>main(runId)).toThrow('STOP_THE_RUNNER_FIRST');
  process.kill.mockImplementation(()=>{throw Object.assign(new Error('Synthetic permission denial'),{code:'EPERM'});});
  expect(()=>main(runId)).toThrow('Synthetic permission denial');expect(iso.destroy).not.toHaveBeenCalled();
});
it('discovers at most one owned container when startup did not record its ID',()=>{
  delete state.containerId;iso.docker.mockReturnValueOnce('c'.repeat(64)).mockReturnValueOnce(JSON.stringify([
    {Id:'c'.repeat(64),NetworkSettings:{Ports:{'3306/tcp':[{HostPort:'41337'}]}}}]));
  main(runId);expect(iso.destroy).toHaveBeenCalledWith(expect.objectContaining({containerId:'c'.repeat(64),port:41337}));
  expect(iso.docker.mock.calls[0][0]).toContain('label=secure-ecommerce.test-run='+runId);
});
it('does not choose among multiple containers or claim cleanup after a guard fails',()=>{
  delete state.containerId;iso.docker.mockReturnValue('c'.repeat(64)+'\n'+'d'.repeat(64));
  expect(()=>main(runId)).toThrow('AMBIGUOUS_TEST_CONTAINERS');expect(files.cleanFiles).not.toHaveBeenCalled();
});
it('allows filesystem cleanup after a run that never created a container',()=>{
  delete state.containerId;iso.docker.mockReturnValue('');iso.protectedSnapshot.mockReturnValue(null);
  main(runId);expect(files.cleanFiles).toHaveBeenCalled();expect(state.protectedContainerId).toBeUndefined();
});
it('preserves artifacts if owned container destruction fails',()=>{
  iso.destroy.mockImplementationOnce(()=>{throw new Error('Synthetic guard failure');});
  expect(()=>main(runId)).toThrow('Synthetic guard failure');expect(files.cleanFiles).not.toHaveBeenCalled();
});
it('accepts the validated run identifier from argv without using arbitrary filesystem paths',()=>{
  jest.replaceProperty(process,'argv',[process.execPath,'cleanup.js',runId]);main();
  expect(openRun).toHaveBeenCalledWith(expect.stringMatching(/postman[\\/]reports$/),runId);
});
