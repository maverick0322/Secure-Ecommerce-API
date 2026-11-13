'use strict';
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const target='log/stage5/node20-source.tar';
fs.mkdirSync('log/stage5',{recursive:true});
const excluded=['.git','node_modules','log','coverage','.env','.env.*','uploads','dist','swagger-output.json',
  '.aws','.codex','.agents','.secrets','postman/reports','postman/node_modules','*.sql','*.sql.*','*.dump','*.bak','*.pem','*.key','*.tar','*.tar.gz','*.tgz','*.zip'];
const archive=spawnSync('tar',['-cf',target,...excluded.map(name=>`--exclude=${name}`),'.'],{encoding:'utf8'});
assert.equal(archive.status,0,archive.stderr);
const bootstrap=spawnSync('tar',['-rf',target,'bd.sql'],{encoding:'utf8'});
assert.equal(bootstrap.status,0,'Could not include the public legacy bootstrap');
const listing=spawnSync('tar',['-tf',target],{encoding:'utf8'});assert.equal(listing.status,0);
assert(!listing.stdout.split('\n').some(n=>/(^|\/)\.env(?:\.[^/]*)?$|\.local$|^\.\/(log|uploads|node_modules|\.git|\.aws|\.codex|\.agents|\.secrets)\//.test(n)),'Unsafe verification archive');
const result=spawnSync('docker',[...(process.platform==='win32'?['--context','desktop-linux']:[]),'build','--file','scripts/database/Dockerfile.node20-verify','--tag','secure-ecommerce-stage5-node20:local','-'],{
  input:fs.readFileSync(target),encoding:'utf8',timeout:600000,windowsHide:true,maxBuffer:16*1024*1024
});
const output=(result.stdout||'')+(result.stderr||'');fs.writeFileSync('log/stage5/node20-build.log',output);
process.stdout.write(output);if(result.error)throw result.error;process.exitCode=result.status||0;
