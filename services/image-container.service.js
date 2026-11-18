'use strict';
// Bounded container framing, not a pixel decoder. Actual decoding is done by libvips.
const policy = require('./image-policy');
const zlib = require('node:zlib');
const invalid = () => { throw new Error('Invalid image container'); };
const crcTable = Uint32Array.from({length:256},(_,index) => {
  let value=index; for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0); return value>>>0;
});
function crc32(buffer) {
  let value=0xffffffff; for(const byte of buffer) value=(value>>>8)^crcTable[(value^byte)&255];return (value^0xffffffff)>>>0;
}
function png(buffer) {
  let offset=8, chunks=0, header=false, data=false, endedData=false;
  let expected;
  const compressed=[];
  const allowed=new Set(['IHDR','PLTE','IDAT','IEND','tRNS','sRGB','gAMA','cHRM','pHYs','tIME','eXIf','tEXt']);
  while(offset+12<=buffer.length && ++chunks<=policy.maxChunks) {
    const size=buffer.readUInt32BE(offset),end=offset+12+size;
    if(end>buffer.length) invalid();
    const type=buffer.toString('ascii',offset+4,offset+8);
    if(!allowed.has(type)||crc32(buffer.subarray(offset+4,end-4))!==buffer.readUInt32BE(end-4)) invalid();
    if(!header) {if(type!=='IHDR'||size!==13) invalid();header=true;expected=pngScanBytes(buffer.subarray(offset+8,end-4));}
    else if(type==='IHDR') invalid();
    if(type==='IDAT') {if(endedData) invalid();data=true;compressed.push(buffer.subarray(offset+8,end-4));}
    else if(data) endedData=true;
    if(type==='IEND') {
      if(size!==0||!data||end!==buffer.length) invalid();
      const input=Buffer.concat(compressed);
      const inflated=zlib.inflateSync(input,{maxOutputLength:expected+1,info:true});
      if(inflated.buffer.length!==expected||inflated.engine.bytesWritten!==input.length) invalid();
      return;
    }
    offset=end;
  }
  invalid();
}
function pngScanBytes(header) {
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],color=header[9],interlace=header[12];
  const channels={0:1,2:3,3:1,4:2,6:4}[color];
  const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if(!channels||!depths[color].includes(depth)||width<1||height<1||width>policy.maxDimension||height>policy.maxDimension||
    width*height>policy.maxPixels||header[10]!==0||header[11]!==0||interlace>1) invalid();
  // PNG scanline sizes, including standard Adam7 passes. No pixel decoding here.
  const passes=interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  return passes.reduce((bytes,[x,y,dx,dy])=>{
    const columns=Math.max(0,Math.ceil((width-x)/dx)),rows=Math.max(0,Math.ceil((height-y)/dy));
    return bytes+(columns&&rows?(1+Math.ceil(columns*channels*depth/8))*rows:0);
  },0);
}
function jpeg(buffer) {
  let offset=2, scan=false, scans=0, segments=0;
  while(offset<buffer.length) {
    if(scan) {offset=buffer.indexOf(255,offset);if(offset<0) invalid();}
    if(buffer[offset++]!==255) invalid();
    while(buffer[offset]===255) offset++;
    const marker=buffer[offset++];
    if(scan&&(marker===0||(marker>=0xd0&&marker<=0xd7))) continue;
    if(++segments>policy.maxChunks) invalid();
    if(marker===0xd9) {if(!scans||offset!==buffer.length) invalid();return;}
    if(marker===undefined||marker===0||marker===0xd8||marker===1||(marker>=0xd0&&marker<=0xd7)||offset+2>buffer.length) invalid();
    const size=buffer.readUInt16BE(offset);if(size<2||offset+size>buffer.length) invalid();
    scan=marker===0xda;if(scan) scans++;
    offset+=size;
  }
  invalid();
}
function webp(buffer) {
  if(buffer.length<20||buffer.readUInt32LE(4)+8!==buffer.length) invalid();
  let offset=12,chunks=0,images=0,extended=false;
  const allowed=new Set(['VP8X','VP8 ','VP8L','ALPH','ICCP','EXIF','XMP ']);
  while(offset+8<=buffer.length && ++chunks<=policy.maxChunks) {
    const type=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),end=offset+8+size;
    if(!allowed.has(type)||end+(size&1)>buffer.length) invalid();
    if(type==='VP8X') {if(extended||offset!==12||size!==10||(buffer[offset+8]&2)) invalid();extended=true;}
    if(type==='VP8 '||type==='VP8L') images++;
    if((size&1)&&buffer[end]!==0) invalid();
    offset=end+(size&1);
  }
  if(offset!==buffer.length||images!==1) invalid();
}
function validateContainer(buffer, format) {
  if(!Buffer.isBuffer(buffer)||buffer.length===0||buffer.length>policy.maxBytes) invalid();
  if(format==='png') return png(buffer);
  if(format==='jpeg') return jpeg(buffer);
  if(format==='webp') return webp(buffer);
  invalid();
}
module.exports={validateContainer};
