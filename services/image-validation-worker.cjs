'use strict';
// No application, models, credentials or provider SDK in the decoder process.
const {decode}=require('./image-decoder.service');
const policy=require('./image-policy');
process.once('disconnect',()=>process.exit(1));
const deadline=setTimeout(()=>process.exit(1),policy.timeoutMs);
process.once('message',async ({buffer,format}) => {
  let result;
  try {result=await decode(buffer,format);}
  catch {result={status:400};}
  process.send(result,error=>{clearTimeout(deadline);process.exit(error?1:0);});
});
