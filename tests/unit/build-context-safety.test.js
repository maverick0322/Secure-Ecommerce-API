'use strict';
jest.mock('node:fs',()=>({mkdirSync:jest.fn(),readFileSync:jest.fn(()=>Buffer.from('Synthetic archive')),writeFileSync:jest.fn()}));
jest.mock('node:child_process',()=>({spawnSync:jest.fn()}));
const fs=require('node:fs'),child=require('node:child_process');
let listing,savedExit;
beforeEach(()=>{
  savedExit=process.exitCode;listing='./package.json\n.env.example\n.env.migration.example\n.env.secure-ecommerce.example\n';
  child.spawnSync.mockImplementation((command,args)=>({status:0,stdout:command==='tar'&&args[0]==='-tf'?listing:'',stderr:''}));
  jest.spyOn(process.stdout,'write').mockReturnValue(true);
});
afterEach(()=>{process.exitCode=savedExit;jest.restoreAllMocks();jest.clearAllMocks();});
function run(){jest.isolateModules(()=>require('../../scripts/database/verify-node20'));}
it('packages public examples explicitly while excluding local credentials and reports',()=>{
  run();const commands=child.spawnSync.mock.calls;
  expect(commands[0][1]).toEqual(expect.arrayContaining(['--exclude=.secrets','--exclude=.env','--exclude=postman/reports']));
  expect(commands[1][1]).toContain('.env.example');expect(commands.some(([command])=>command==='docker')).toBe(true);
  expect(fs.readFileSync).toHaveBeenCalledWith('log/stage5/node20-source.tar');
});
it.each(['./.env','./.secrets/private.key','.secrets/private.key','./postman/reports/private.json'])('refuses an unsafe archive entry before Docker receives it: %s',entry=>{
  listing+=entry+'\n';expect(run).toThrow('Unsafe verification archive');
  expect(child.spawnSync.mock.calls.some(([command])=>command==='docker')).toBe(false);
});
