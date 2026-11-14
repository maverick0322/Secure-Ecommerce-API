'use strict';
const Reporter=require('../support/setup-timing-reporter.cjs');
afterEach(()=>jest.restoreAllMocks());
it.each([5000,30000])('reports names, durations and setup timeout classification without raw errors: %d',deadline=>{
  jest.replaceProperty(process,'env',{...process.env,STAGE3A_TIMINGS:'1'});
  const write=jest.spyOn(process.stdout,'write').mockReturnValue(true);
  new Reporter().onTestResult({}, {testFilePath:'/isolated/accounts.mysql.test.js',perfStats:{runtime:5001},testResults:[
    {title:'Synthetic test',status:'failed',duration:0,failureMessages:[`Exceeded timeout of ${deadline} ms for a hook; private diagnostic payload`]}]});
  const report=JSON.parse(write.mock.calls[0][0]);
  expect(report.cases[0]).toEqual({name:'Synthetic test',status:'failed',ms:0,setupTimeout:true});
  expect(write.mock.calls[0][0]).not.toContain('private diagnostic payload');
});
it('does not emit when timing diagnostics are disabled',()=>{
  jest.replaceProperty(process,'env',{...process.env,STAGE3A_TIMINGS:''});
  const write=jest.spyOn(process.stdout,'write').mockReturnValue(true);
  new Reporter().onTestResult({},{});expect(write).not.toHaveBeenCalled();
});
