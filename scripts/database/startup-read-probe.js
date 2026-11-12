'use strict';
const {spawn}=require('node:child_process');
const net=require('node:net');
const fs=require('node:fs');
const assert=require('node:assert/strict');
async function main(){
 const port=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
 const child=spawn(process.execPath,['index.js'],{env:{...process.env,SERVER_PORT:String(port),SERVER_HOST:'127.0.0.1',CLOUDINARY_CLEANUP_DIR:'log/stage5/startup-journal'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='';let diagnostic='';let timeout;
 try{
  await new Promise((resolve,reject)=>{
   timeout=setTimeout(()=>reject(new Error('Startup timed out')),20000);
   child.stdout.on('data',data=>{output+=data;if(output.includes('API conectada a secure_ecommerce'))resolve();});
   child.stderr.on('data',data=>{diagnostic+=data;});
   child.on('error',reject);child.on('exit',()=>reject(new Error('API exited before startup verification')));
  });
  clearTimeout(timeout);
  assert.equal((await fetch(`http://127.0.0.1:${port}/swagger`)).status,200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/nonexistent-read-probe`)).status,404);
  fs.writeFileSync('log/stage5/startup.json',JSON.stringify({verifiedAt:new Date().toISOString(),normalEntrypoint:true,bind:'127.0.0.1',swagger:200,notFound:404,habitualOperations:'read only'},null,2)+'\n');
  console.log('PASS: normal Node entrypoint verified, local HTTP started, Swagger/404 read probes passed; no business data inserted.');
 }finally{clearTimeout(timeout);if(child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed;}}
}
main().catch(()=>{console.error('Normal API startup verification failed; inspect configuration safely.');process.exitCode=1;});
