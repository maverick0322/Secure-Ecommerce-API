'use strict';
// Only our deterministic, repository-controlled collection is supported.
// Keep npm audit's remaining Faker advisory visible; do not claim a patched SDK.
let hardened=false;
function load(){
  if(!hardened){
    const faker=require('../node_modules/@faker-js/faker');
    const disabled=()=>{throw new Error('Dynamic Faker templates are disabled for this isolated suite.');};
    Object.defineProperty(faker,'fake',{value:disabled,writable:false,configurable:false});
    Object.defineProperty(faker.helpers,'fake',{value:disabled,writable:false,configurable:false});
    hardened=true;
  }
  return require('../node_modules/newman');
}
function validateCollection(collection){
  if(/\{\{\s*\$random|faker\.(?:fake|helpers)/i.test(JSON.stringify(collection))){
    const error=new Error('DYNAMIC_DATA_GENERATORS_FORBIDDEN');error.safe=true;throw error;
  }
}
module.exports={load,validateCollection};
