'use strict';
const {AccountError}=require('./accounts.service');
const policy=require('./image-policy');
function validateUpload(result,publicId,expected) {
  const invalid=()=>{throw new AccountError(502,'El proveedor no confirmó una imagen válida.');};
  if(!result||typeof result!=='object'||Array.isArray(result)||result.public_id!==publicId||
    result.resource_type!=='image'||result.type!=='upload'||!['jpg','png','webp'].includes(result.format)||
    (result.existing!==undefined&&typeof result.existing!=='boolean')||
    typeof result.asset_id!=='string'||!/^[a-f0-9]{32}$/.test(result.asset_id)||
    !Number.isSafeInteger(result.version)||result.version<1||result.error!==undefined||
    !Number.isSafeInteger(result.bytes)||result.bytes<1||result.bytes>policy.maxBytes||
    !Number.isInteger(result.width)||!Number.isInteger(result.height)||result.width<1||result.height<1||
    result.width>policy.maxDimension||result.height>policy.maxDimension||result.width*result.height>policy.maxPixels||
    (expected&&(result.format!==expected.format||result.width!==expected.width||result.height!==expected.height))) invalid();
  if(typeof result.secure_url!=='string'||result.secure_url.length>1024) invalid();
  let url;try{url=new URL(result.secure_url);}catch{invalid();}
  if(url.protocol!=='https:'||url.hostname!=='res.cloudinary.com'||url.port||url.username||url.password||url.hash||url.search||
    url.pathname!==`/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v${result.version}/${publicId}.${result.format}`) invalid();
}
module.exports={validateUpload};
