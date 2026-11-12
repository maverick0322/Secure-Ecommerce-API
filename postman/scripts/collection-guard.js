'use strict';
// This function is serialized into the collection's pre-request event.
module.exports=function collectionGuard(){
  function deny(){
    pm.test('Isolation barrier accepted the target',function(){pm.expect(false).to.eql(true);});
    if(pm.execution&&typeof pm.execution.skipRequest==='function')pm.execution.skipRequest();
    else pm.request.url.update('blocked://isolation.invalid');
    throw new Error('Isolation barrier rejected the target; no business request authorized.');
  }
  const port=Number(pm.environment.get('apiPort'));
  const base=pm.environment.get('baseUrl');
  const origin='http://127.0.0.1:'+port;
  const database=pm.environment.get('expectedDatabase')||'';
  const uuid=pm.environment.get('expectedServerUuid')||'';
  const run=pm.environment.get('isolationRunId')||'';
  const key=pm.environment.get('isolationKey')||'';
  const resolved=pm.variables.replaceIn(pm.request.url.toString());
  if(!Number.isInteger(port)||port<3001||port>3099||base!==origin||!resolved.startsWith(origin+'/')||
    !/^secure_ecommerce_postman_[a-f0-9]{32}$/.test(database)||
    !/^[a-f0-9-]{36}$/.test(uuid)||uuid==='b68c7b62-dc02-11f1-b706-caca74da477e'||
    !/^[a-f0-9-]{36}$/.test(run)||!/^[a-f0-9]{64}$/.test(key))return deny();
  pm.request.headers.upsert({key:'X-Postman-Isolation-Key',value:key});
  pm.sendRequest({url:origin+'/__postman/isolation',method:'GET',
    header:{'X-Postman-Isolation-Key':key}},function(error,response){
    if(error||response.code!==200)return deny();
    let identity;try{identity=response.json();}catch{return deny();}
    if(identity.isolated!==true||identity.runId!==run||identity.database!==database||identity.serverUuid!==uuid||identity.storage!=='tmpfs')return deny();
    pm.test('Isolation barrier accepted the target',function(){pm.expect(true).to.eql(true);});
  });
};
