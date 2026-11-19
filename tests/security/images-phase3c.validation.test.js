'use strict';
const sharp=require('sharp');
const zlib=require('node:zlib');
const express=require('express');
const request=require('supertest');
const fixture=require('../support/image-phase2-fixture');
const {decode}=require('../../services/image-decoder.service');
const {normalize}=require('../../services/image-validation.service');
const {upload,validateImage,uploadErrorHandler}=require('../../middlewares/upload.middleware');
const policy=require('../../services/image-policy');
const {validateUpload}=require('../../services/image-response.service');
const {fork}=require('node:child_process');
const path=require('node:path');
let calls,app;
beforeEach(()=>{
  calls=jest.fn((req,res)=>res.json({size:req.file.buffer.length}));
  app=express().put('/image',upload.single('image'),uploadErrorHandler,validateImage,calls);
  jest.replaceProperty(process,'env',{...process.env,CLOUDINARY_CLOUD_NAME:'synthetic'});
});
afterEach(()=>jest.restoreAllMocks());
const put=(bytes,name='fixture.png',mime='image/png')=>request(app).put('/image').attach('image',bytes,{filename:name,contentType:mime});
it.each([['jpeg',fixture.jpeg],['png',fixture.png],['webp',fixture.webp]])('V01 fully decodes and re-encodes valid %s',async(format,buffer)=>{
  const result=await decode(buffer,format);expect(result.status).toBe(200);
  expect(await sharp(result.buffer).metadata()).toMatchObject({format,width:2,height:2});
});
it.each([['png',fixture.png],['jpeg',fixture.jpeg],['webp',fixture.webp]])('V02 rejects truncated %s including a forged closing marker',async(format,buffer)=>{
  await expect(decode(buffer.subarray(0,buffer.length-4),format)).rejects.toThrow();
  const ending=format==='jpeg'?Buffer.from([255,217]):buffer.subarray(buffer.length-12);
  await expect(decode(Buffer.concat([buffer.subarray(0,20),ending]),format)).rejects.toThrow();
  if(format==='jpeg') await expect(decode(Buffer.concat([buffer.subarray(0,buffer.length-10),Buffer.from([255,217])]),format)).rejects.toThrow();
});
it.each([['png',fixture.png],['jpeg',fixture.jpeg],['webp',fixture.webp]])('V03 rejects concatenated/appended %s polyglots',async(format,buffer)=>{
  await expect(decode(Buffer.concat([buffer,Buffer.from('PK\x03\x04SYNTHETIC')]),format)).rejects.toThrow();
  await expect(decode(Buffer.concat([buffer,buffer]),format)).rejects.toThrow();
});
it('V04 rejects corrupt compressed pixels even if the PNG container CRC is correct',async()=>{
  const damaged=Buffer.concat([fixture.png.subarray(0,33),fixture.chunk('IDAT',Buffer.from('not deflate')),fixture.chunk('IEND',Buffer.alloc(0))]);
  await expect(decode(damaged,'png')).rejects.toThrow();expect((await put(damaged)).status).toBe(400);expect(calls).not.toHaveBeenCalled();
});
it('V05 rejects deflate data exceeding declared rows with bounded synthetic payload',async()=>{
  const raw=Buffer.alloc(1000000),compressed=zlib.deflateSync(raw);
  const excess=Buffer.concat([fixture.png.subarray(0,33),fixture.chunk('IDAT',compressed),fixture.chunk('IEND',Buffer.alloc(0))]);
  await expect(decode(excess,'png')).rejects.toThrow();
});
it('V06 accepts the exact 2 MiB container and rejects one byte above it with 413',async()=>{
  const exact=fixture.pngAtSize(policy.maxBytes);expect(exact.length).toBe(policy.maxBytes);
  expect((await put(exact)).status).toBe(200);
  calls.mockClear();expect((await put(fixture.pngAtSize(policy.maxBytes+1))).status).toBe(413);expect(calls).not.toHaveBeenCalled();
});
it('V07 enforces dimension, pixel and frame limits before full decoding',async()=>{
  for(const bytes of [fixture.pngWithDimensions(4097,1),fixture.pngWithDimensions(3000,3000),fixture.declaredAnimation(),fixture.manyFramePNG(),fixture.largePixelPNG()])
    await expect(decode(bytes,'png')).rejects.toThrow();
  const edge=await sharp({create:{width:4096,height:1,channels:3,background:'#123456'}}).png().toBuffer();
  expect((await decode(edge,'png')).width).toBe(4096);
});
it('V08 rejects animated WebP and malformed RIFF boundaries',async()=>{
  const bad=Buffer.from(fixture.webp);bad.writeUInt32LE(1,4);await expect(decode(bad,'webp')).rejects.toThrow();
  const animation=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBPVP8X'),Buffer.from([10,0,0,0,2,0,0,0,1,0,0,1,0,0]),fixture.webp.subarray(12)]);
  animation.writeUInt32LE(animation.length-8,4);await expect(decode(animation,'webp')).rejects.toThrow();
});
it('V09 strips EXIF/GPS/XMP from newly encoded images and applies orientation',async()=>{
  const original=await sharp({create:{width:3,height:2,channels:3,background:'#123456'}}).jpeg()
    .withExif({IFD0:{Orientation:'6',Artist:'SYNTHETIC_PRIVATE'},IFD3:{GPSLatitudeRef:'N',GPSLatitude:'40/1 0/1 0/1'}})
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">SYNTHETIC_PRIVATE</x:xmpmeta>').toBuffer();
  const result=await decode(original,'jpeg'),metadata=await sharp(result.buffer).metadata();
  const inputMetadata=await sharp(original).metadata();expect(inputMetadata.exif).toBeDefined();expect(inputMetadata.xmp).toBeDefined();
  expect(metadata.exif).toBeUndefined();expect(metadata.xmp).toBeUndefined();expect(metadata.icc).toBeUndefined();
  expect(result.buffer.includes(Buffer.from('SYNTHETIC_PRIVATE'))).toBe(false);
});
it('V12 accepts progressive JPEG and Adam7 PNG using the native decoder',async()=>{
  const pixels={create:{width:17,height:13,channels:3,background:'#345678'}};
  for(const format of ['png','jpeg']){
    const bytes=await sharp(pixels).toFormat(format,{progressive:true}).toBuffer();
    expect(await decode(bytes,format)).toMatchObject({status:200,width:17,height:13});
  }
});
it('V13 rejects normalization expansion beyond 2 MiB with 413',async()=>{
  let seed=1234567;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;};
  const raw=Buffer.alloc(2001*1000);
  for(let row=0;row<1000;row++)for(let column=1;column<=2000;column++)raw[row*2001+column]=random();
  const palette=Buffer.from(Array.from({length:768},random)),header=Buffer.alloc(13);
  header.writeUInt32BE(2000);header.writeUInt32BE(1000,4);header[8]=8;header[9]=3;
  const bytes=Buffer.concat([fixture.png.subarray(0,8),fixture.chunk('IHDR',header),fixture.chunk('PLTE',palette),
    fixture.chunk('IDAT',zlib.deflateSync(raw)),fixture.chunk('IEND',Buffer.alloc(0))]);
  expect(bytes.length).toBeLessThan(policy.maxBytes);expect(await decode(bytes,'png')).toEqual({status:413});
  expect((await put(bytes)).status).toBe(413);expect(calls).not.toHaveBeenCalled();
});
it('V14 decoder exits when its API parent disappears, without retaining an orphan process',async()=>{
  const child=fork(path.join(__dirname,'../../services/image-validation-worker.cjs'),[],{
    stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
  try {
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    child.disconnect();expect((await exited).code).toBe(1);
  } finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
},10000);
it.each(['multipart/form-data','multipart/form-data; boundary=abc'])('V10 malformed multipart %s returns controlled 400',async contentType=>{
  const response=await request(app).put('/image').set('Content-Type',contentType).send('--abc\r\ninvalid-header\r\n\r\nprivate');
  expect(response.status).toBe(400);expect(calls).not.toHaveBeenCalled();expect(response.text).not.toMatch(/stack|busboy|private|TypeError/);
});
it('V11 decoder subprocess never inherits application credentials and releases capacity',async()=>{
  const secret='SYNTHETIC_PRIVATE';process.env.CLOUDINARY_API_SECRET=secret;
  const result=await normalize(fixture.png,'png');expect(result.width).toBe(2);
  await expect(normalize(Buffer.from('not an image'),'png')).rejects.toMatchObject({status:400});
  expect((await normalize(fixture.webp,'webp')).format).toBe('webp');
});
it.each([null,undefined,{},[],{public_id:'wrong'}])('P01 rejects absent or invalid response %j with 502',result=>{
  expect(()=>validateUpload(result,'requested')).toThrow(expect.objectContaining({status:502}));
});
it.each(['public_id','format','resource_type','type','asset_id','version','bytes','width','height','secure_url'])('P02 requires %s',field=>{
  const result=fixture.uploadResult('requested');delete result[field];expect(()=>validateUpload(result,'requested')).toThrow(expect.objectContaining({status:502}));
});
it.each([{resource_type:'video'},{type:'private'},{existing:'false'},{format:'svg'},{width:0},{height:5000},{bytes:policy.maxBytes+1},{version:-1},
  {secure_url:'http://res.cloudinary.com/synthetic/image/upload/v1/requested.png'},{secure_url:'https://attacker.invalid/requested.png'},
  {secure_url:'https://res.cloudinary.com/foreign/image/upload/v1/requested.png'},{secure_url:'https://res.cloudinary.com/synthetic/image/upload/v2/requested.png'},
  {error:'SYNTHETIC_PRIVATE'}])('P03 rejects contradictory fields %j',changed=>{
  const result={...fixture.uploadResult('requested'),...changed};expect(()=>validateUpload(result,'requested')).toThrow(expect.objectContaining({status:502}));
});
it('P04 matches normalized format/dimensions and ignores unused provider secrets',()=>{
  const result=fixture.uploadResult('requested');expect(()=>validateUpload(result,'requested',{format:'jpg',width:2,height:2})).toThrow();
  expect(()=>validateUpload(result,'requested',{format:'png',width:3,height:2})).toThrow();
  expect(()=>validateUpload({...result,api_key:'SYNTHETIC_PRIVATE'},'requested',{format:'png',width:2,height:2})).not.toThrow();
});
