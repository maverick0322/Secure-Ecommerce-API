'use strict';
function fixtureLifecycle(initialize,cleanup){
  let preparation,closing=false;
  return {
    start(){
      if(preparation||closing)throw new Error('Fixture already started or closing.');
      preparation=Promise.resolve().then(initialize);return preparation;
    },
    async close(){
      closing=true;
      let setupError;
      try{await preparation;}catch(error){setupError=error;}
      try{await cleanup();}catch(error){
        if(setupError)throw new AggregateError([setupError,error],'Fixture setup and cleanup failed.');
        throw error;
      }
      if(setupError)throw setupError;
    }
  };
}
module.exports={fixtureLifecycle};
