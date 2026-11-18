'use strict';
jest.mock('node:child_process',()=>({fork:jest.fn()}));
const {fork}=require('node:child_process');
const {EventEmitter}=require('node:events');
const {normalize}=require('../../services/image-validation.service');
let children;
beforeEach(()=>{
  children=[];
  fork.mockImplementation(()=>{
    const child=new EventEmitter();child.send=jest.fn();child.kill=jest.fn(()=>{queueMicrotask(()=>child.emit('close'));return true;});children.push(child);return child;
  });
});
afterEach(async()=>{for(const child of children)child.emit('close');await Promise.resolve();jest.useRealTimers();jest.restoreAllMocks();fork.mockReset();});
const good={status:200,buffer:Buffer.from('synthetic'),format:'png',width:2,height:2};
it('bounds native workers without queuing and frees slots only when processes close',async()=>{
  const first=normalize(Buffer.from('synthetic'),'png'),second=normalize(Buffer.from('synthetic'),'png');
  await expect(normalize(Buffer.from('synthetic'),'png')).rejects.toMatchObject({status:429,retryAfter:1});
  children.forEach(c=>c.emit('message',good));await Promise.all([first,second]);
  const next=normalize(Buffer.from('synthetic'),'png');children[2].emit('message',good);await next;
  expect(fork.mock.calls[0][2]).toMatchObject({execArgv:['--max-old-space-size=64'],stdio:['ignore','ignore','ignore','ipc']});
  expect(Object.keys(fork.mock.calls[0][2].env).sort()).toEqual(['PATH','SHARP_IGNORE_GLOBAL_LIBVIPS','SystemRoot']);
});
it('kills timed-out decoder instead of retaining native work behind a rejected promise',async()=>{
  jest.useFakeTimers({doNotFake:['queueMicrotask']});const result=normalize(Buffer.from('synthetic'),'png').catch(e=>e);
  await jest.advanceTimersByTimeAsync(5000);expect(await result).toMatchObject({status:400});expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
});
it('cancels on disconnect and rejects already-aborted requests without spawning',async()=>{
  const cancellation=new AbortController();const result=normalize(Buffer.from('synthetic'),'png',cancellation.signal).catch(e=>e);
  cancellation.abort();expect(await result).toMatchObject({status:400});
  const count=fork.mock.calls.length;await expect(normalize(Buffer.from('synthetic'),'png',cancellation.signal)).rejects.toMatchObject({status:400});expect(fork).toHaveBeenCalledTimes(count);
});
it.each([null,{status:200,buffer:Buffer.from('synthetic'),format:'jpeg',width:2,height:2},{status:400},{status:413}])('handles malformed/error worker replies %j',async reply=>{
  const result=normalize(Buffer.from('synthetic'),'png');children[0].emit('message',reply);
  await expect(result).rejects.toMatchObject({status:reply?.status===413?413:400});
});
it('handles child spawn failure, IPC send failure and premature exit with no capacity leak',async()=>{
  fork.mockImplementationOnce(()=>{throw new Error('SYNTHETIC_PRIVATE');});
  await expect(normalize(Buffer.from('synthetic'),'png')).rejects.toMatchObject({status:503});
  let result=normalize(Buffer.from('synthetic'),'png');children[0].emit('error',new Error('SYNTHETIC_PRIVATE'));children[0].emit('close');await expect(result).rejects.toMatchObject({status:503});
  result=normalize(Buffer.from('synthetic'),'png');children[1].emit('close');await expect(result).rejects.toMatchObject({status:400});
  result=normalize(Buffer.from('synthetic'),'png');children[2].send.mock.calls[0][1](new Error('SYNTHETIC_PRIVATE'));await expect(result).rejects.toMatchObject({status:400});
});
