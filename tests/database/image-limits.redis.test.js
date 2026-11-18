'use strict';
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const isolated = process.env.RUN_STAGE2_REDIS === '1' ? describe : describe.skip;
isolated('Image limits with real disposable Redis and independent processes', () => {
  jest.setTimeout(120000);
  it('arbitrates seller/global concurrency, release and crashed process leases without touching habitual stores', async () => {
    const result = await require('../../scripts/database/stage2-redis-test').withRedisFixture(async ({ config, admin, assertOwned }) => {
      assertOwned(); const workers = [];
      function start() {
        const child = fork(path.join(__dirname,'../support/image-limits-worker.cjs'),[],{silent:true,env:{
          PATH:process.env.PATH, SystemRoot:process.env.SystemRoot, NODE_ENV:'test' }});
        child.stdout.resume(); child.stderr.resume(); let sequence=0; const pending=new Map();
        child.on('message',reply=>{const entry=pending.get(reply.id);if(entry){clearTimeout(entry.timer);pending.delete(reply.id);entry.resolve(reply);}});
        const worker={child,command(command,extra={}){const id=++sequence; return new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Synthetic worker timeout'));},10000);
          pending.set(id,{resolve,timer});child.send({command,id,...extra});
        });},async stop(){if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}};
        workers.push(worker); return worker;
      }
      try {
        const first=start(),second=start();
        expect((await first.command('start',{config})).status).toBe(200);
        expect((await second.command('start',{config})).status).toBe(200);
        const user=randomUUID();
        const results=await Promise.all([first.command('acquire',{user}),second.command('acquire',{user})]);
        expect(results.map(r=>r.status).sort()).toEqual([200,429]);
        const winner=results[0].status===200?first:second, loser=winner===first?second:first;
        await winner.stop();
        expect((await loser.command('acquire',{user})).status).toBe(429);
        // Advance only this synthetic lease deadline, never the Redis/host clock.
        const key=`${config.namespace}:{${config.generation}}:image-admission`;
        const state=JSON.parse(await admin.get(key));
        for(const lease of Object.values(state.leases)) lease.until=1;
        await admin.set(key,JSON.stringify(state));
        expect((await loser.command('acquire',{user})).status).toBe(200);
        for(let i=0;i<7;i++) expect((await loser.command('acquire',{user:randomUUID()})).status).toBe(200);
        expect((await loser.command('acquire',{user:randomUUID()})).status).toBe(429);
      } finally {await Promise.all(workers.map(w=>w.stop()));}
    });
    expect(result.success).toBe(true);expect(result.cleanup).toBe(true);
  });
});
