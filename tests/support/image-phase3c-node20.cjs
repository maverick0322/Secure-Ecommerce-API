'use strict';
// Secret-excluding snapshot and local dependency image; never pulls or publishes images.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const directory='log/stage3c-deps';fs.mkdirSync(directory,{recursive:true});
for(const name of ['package.json','package-lock.json'])fs.copyFileSync(name,path.join(directory,name));
fs.writeFileSync(path.join(directory,'Dockerfile'), ['FROM secure-ecommerce-stage5-node20:local','WORKDIR /dependencies',
  'COPY --chown=node:node package.json package-lock.json ./','RUN npm ci --ignore-scripts --no-fund','RUN node --version',''].join('\n'));
const build=spawnSync('docker',[...(process.platform==='win32'?['--context','desktop-linux']:[]),'build','--pull=false','--tag','secure-ecommerce-stage3c-node20:local',directory],{encoding:'utf8',timeout:300000,windowsHide:true,maxBuffer:8*1024*1024});
fs.writeFileSync('log/images-phase3c-node20-install.log',(build.stdout||'')+(build.stderr||''));assert.equal(build.status,0,'Isolated Node20 dependency installation failed');
const archive = 'log/stage3c/node20-source.tar';
fs.mkdirSync('log/stage3c',{recursive:true});
const excluded=['.git','node_modules','log','coverage','.env','.env.*','uploads','dist','swagger-output.json',
  '.aws','.codex','.agents','.secrets','config/config.json','postman/reports','postman/node_modules',
  '*.sql','*.sql.*','*.dump','*.bak','*.pem','*.key','*.p12','*.pfx','*credentials*.json','*token*.json','*.tar','*.tar.gz','*.tgz','*.zip'];
assert.equal(spawnSync('tar',['-cf',archive,...excluded.map(name=>`--exclude=${name}`),'.']).status,0);
const examples=['.env.example','.env.migration.example','.env.secure-ecommerce.example'];
assert.equal(spawnSync('tar',['-rf',archive,'bd.sql',...examples]).status,0);
const listing=spawnSync('tar',['-tf',archive],{encoding:'utf8'});assert.equal(listing.status,0);
assert(!listing.stdout.split(/\r?\n/).map(name=>name.replace(/^\.\//,'')).some(name=>
  !examples.includes(name)&&/(^|\/)\.env(?:\.[^/]*)?$|\.local$|^(log|uploads|node_modules|\.git|\.aws|\.codex|\.agents|\.secrets|postman\/reports|postman\/node_modules)\//.test(name)),'Unsafe verification archive');
const script = [
  'set -e',
  'tar -xf /source.tar -C /review',
  `node -e "const fs=require('fs'),a=fs.readFileSync('/dependencies/package-lock.json'),b=fs.readFileSync('/review/package-lock.json');if(!a.equals(b))throw Error('Cached dependency tree differs');"`,
  'ln -s /dependencies/node_modules /review/node_modules',
  'node --version',
  'npm run test:coverage -- --runInBand',
  'npm run swagger',
  'npm run docs:build'
].join('\n');
const run = spawnSync('docker',[...(process.platform==='win32'?['--context','desktop-linux']:[]),
  'run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--memory','2g','--cpus','2','--pids-limit','128',
  '--tmpfs','/review:rw,uid=1000,gid=1000,size=512m','--tmpfs','/tmp:rw,size=128m',
  '--mount',`type=bind,src=${path.resolve('log/stage3c/node20-source.tar')},dst=/source.tar,readonly`,
  '--workdir','/review','--entrypoint','sh','secure-ecommerce-stage3c-node20:local','-c',script],
  {encoding:'utf8',timeout:600000,windowsHide:true,maxBuffer:32*1024*1024});
fs.writeFileSync('log/images-phase3c-node20-compat.log',(run.stdout||'')+(run.stderr||''));
process.stdout.write(`Node20 isolated compatibility exit=${run.status}; details in log/images-phase3c-node20-compat.log\n`);
if(run.error)throw run.error;
process.exitCode=run.status??1;
