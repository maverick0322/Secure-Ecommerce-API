'use strict';
const {fork}=require('node:child_process');
const path=require('node:path');
const {AccountError}=require('./accounts.service');
const policy=require('./image-policy');
let running=0;
function normalize(buffer,format,signal) {
  if(running>=policy.workers) {
    const error=new AccountError(429,'Validación de imágenes ocupada.');error.retryAfter=1;return Promise.reject(error);
  }
  if(signal?.aborted) return Promise.reject(new AccountError(400,'Carga interrumpida.'));
  running++;
  return new Promise((resolve,reject) => {
    let child,timer,finished=false,result,terminalError;
    function finish(error) {
      if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(result);
    }
    const invalid=()=>new AccountError(400,'La imagen no es válida o supera los límites de procesamiento.');
    function abort(){terminalError=invalid();child?.kill('SIGKILL');}
    try {
      child=fork(path.join(__dirname,'image-validation-worker.cjs'),[],{serialization:'advanced',windowsHide:true,
        stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=64'],
        env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,SHARP_IGNORE_GLOBAL_LIBVIPS:'1'}});
      child.once('error',()=>{terminalError=new AccountError(503,'Validación de imágenes no disponible.');});
      child.once('close',()=>{running--;finish(terminalError || (result ? null : invalid()));});
      child.once('message',message=>{
        if(message?.status===200&&Buffer.isBuffer(message.buffer)&&message.buffer.length<=policy.maxBytes&&
          message.format===format&&Number.isInteger(message.width)&&Number.isInteger(message.height)) result=message;
        child.kill('SIGKILL');
        if(!result)terminalError=message?.status===413?new AccountError(413,'La imagen normalizada supera 2 MiB.'):invalid();
      });
      timer=setTimeout(abort,policy.timeoutMs);timer.unref();
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) {abort();return;}
      child.send({buffer,format},error=>{if(error)abort();});
    } catch {
      terminalError=new AccountError(503,'Validación de imágenes no disponible.');
      if(child) child.kill('SIGKILL');
      else {running--;finish(terminalError);}
    }
  });
}
module.exports={normalize};
