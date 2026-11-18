'use strict';
const sharp=require('sharp');
const {validateContainer}=require('./image-container.service');
const policy=require('./image-policy');
sharp.cache(false);sharp.concurrency(1);
async function decode(buffer,format) {
  validateContainer(buffer,format);
  const options={failOn:'warning',limitInputPixels:policy.maxPixels,animated:false,sequentialRead:true};
  let warned=false;
  // Some native codecs emit warnings even with failOn:'warning'. Never accept repaired/truncated input.
  const input=()=>sharp(buffer,options).on('warning',()=>{warned=true;});
  const metadata=await input().metadata();
  if(metadata.format!==format||!Number.isInteger(metadata.width)||!Number.isInteger(metadata.height)||
    metadata.width<1||metadata.height<1||metadata.width>policy.maxDimension||metadata.height>policy.maxDimension||
    metadata.width*metadata.height>policy.maxPixels||(metadata.pages||1)>policy.maxFrames) throw new Error('Image limits');
  const {data,info}=await input().autoOrient().toFormat(format).toBuffer({resolveWithObject:true});
  if(warned) throw new Error('Image decoder warning');
  if(data.length>policy.maxBytes) return {status:413};
  return {status:200,buffer:data,format,width:info.width,height:info.height};
}
module.exports={decode};
