'use strict';
const fs=require('node:fs'),path=require('node:path');
const iso=require('./isolation');
function main(){
  const runId=process.argv[2];iso.ensure(/^[a-f0-9-]{36}$/.test(runId||''),'INVALID_RUN_ID');
  const directory=path.join(__dirname,'../reports',runId);const stateFile=path.join(directory,'state.json');
  const state=JSON.parse(fs.readFileSync(stateFile));iso.ensure(state.runId===runId,'STATE_RUN_MISMATCH');
  state.database=state.database||'secure_ecommerce_postman_'+runId.replace(/-/g,'');
  state.protectedContainerId=iso.protectedSnapshot()?.id;
  let alive=false;try{process.kill(state.parentPid,0);alive=true;}catch(error){alive=error.code==='EPERM';}
  iso.ensure(!alive,'STOP_THE_RUNNER_FIRST');
  if(!state.containerId){
    const ids=iso.docker(['ps','--all','--no-trunc','--filter','label=secure-ecommerce.test-suite=postman',
      '--filter','label=secure-ecommerce.test-run='+runId,'--format','{{.ID}}']).split('\n').filter(Boolean);
    iso.ensure(ids.length<=1,'AMBIGUOUS_TEST_CONTAINERS');
    if(ids[0]){const c=JSON.parse(iso.docker(['inspect',ids[0]]))[0];state.containerId=c.Id;
      state.port=Number(c.NetworkSettings.Ports['3306/tcp']?.[0]?.HostPort);}
  }
  iso.destroy(state);
  const privateFile=path.join(directory,'private.postman_environment.json');if(fs.existsSync(privateFile))fs.unlinkSync(privateFile);
  const link=path.join(directory,'workspace/node_modules');if(fs.existsSync(link)){
    iso.ensure(fs.lstatSync(link).isSymbolicLink(),'UNEXPECTED_DEPENDENCY_LINK');fs.unlinkSync(link);
  }
  state.status='cleaned';fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n');console.log('Owned disposable instance cleaned.');
}
try{main();}catch(error){console.error(error.safe?error.message:'Cleanup stopped; no unrelated resources were removed.');process.exitCode=1;}
