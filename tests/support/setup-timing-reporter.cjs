'use strict';
const path=require('node:path');
class SetupTimingReporter {
  onTestResult(test,result){
    if(process.env.STAGE3A_TIMINGS!=='1'||path.basename(result.testFilePath)!=='accounts.mysql.test.js')return;
    const cases=result.testResults.map(item=>({name:item.title,status:item.status,ms:item.duration,
      setupTimeout:item.failureMessages.some(message=>/Exceeded timeout of [0-9]+ ms for a hook/.test(message))}));
    process.stdout.write(JSON.stringify({scenario:'accounts-results',runtimeMs:result.perfStats.runtime,cases})+'\n');
  }
}
module.exports=SetupTimingReporter;
