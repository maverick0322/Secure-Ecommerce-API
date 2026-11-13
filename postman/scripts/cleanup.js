'use strict';
const path=require('node:path');
const iso=require('./isolation');
const {openRun}=require('./cleanup-paths');
function main(runId=process.argv[2]){
  const files=openRun(path.join(__dirname,'../reports'),runId);
  const state=files.readState();iso.ensure(state.runId===runId,'STATE_RUN_MISMATCH');
  files.validateArtifacts();
  iso.assertLocalContext();
  state.database=state.database||'secure_ecommerce_postman_'+runId.replace(/-/g,'');
  state.protectedContainerId=iso.protectedSnapshot()?.id;
  iso.ensure(Number.isSafeInteger(state.parentPid)&&state.parentPid>0,'INVALID_PARENT_PID');
  let alive=false;try{process.kill(state.parentPid,0);alive=true;}catch(error){if(error.code!=='ESRCH')throw error;}
  iso.ensure(!alive,'STOP_THE_RUNNER_FIRST');
  if(!state.containerId){
    const ids=iso.docker(['ps','--all','--no-trunc','--filter','label=secure-ecommerce.test-suite=postman',
      '--filter','label=secure-ecommerce.test-run='+runId,'--format','{{.ID}}']).split('\n').filter(Boolean);
    iso.ensure(ids.length<=1,'AMBIGUOUS_TEST_CONTAINERS');
    if(ids[0]){const c=JSON.parse(iso.docker(['inspect',ids[0]]))[0];state.containerId=c.Id;
      state.port=Number(c.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);}
  }
  files.validateArtifacts();
  iso.destroy(state);
  state.status='cleaned';files.cleanFiles(state);console.log('Owned disposable instance cleaned.');
}
if(require.main===module)try{main();}catch(error){console.error(error.safe?error.message:'Cleanup stopped; no unrelated resources were removed.');process.exitCode=1;}
module.exports={main};
