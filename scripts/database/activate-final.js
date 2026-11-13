'use strict';
// Activates only local configuration; every operation on habitual MySQL is a read.
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const dotenv=require('dotenv');
const expectedUuid='b68c7b62-dc02-11f1-b706-caca74da477e';
async function main(){
  const prepared=dotenv.parse(fs.readFileSync('.env.secure-ecommerce.local'));
  assert.equal(prepared.DB_HOST,'127.0.0.1');assert.equal(prepared.DB_PORT,'3307');
  assert.equal(prepared.DB_DATABASE,'secure_ecommerce');assert.equal(prepared.DB_USER,'ecommerce_app');assert(prepared.DB_PASSWORD);
  const active=fs.existsSync('.env')?dotenv.parse(fs.readFileSync('.env')):null;
  if(active){
    const keys=['DB_HOST','DB_PORT','DB_DATABASE','DB_USER','DB_PASSWORD'];
    if(keys.some(key=>active[key]!==prepared[key])||!active.JWT_SECRET||Buffer.byteLength(active.JWT_SECRET)<32) throw new Error('La configuración activa difiere de la preparada o carece de un JWT_SECRET válido; no se sobrescribirá.');
  }
  Object.assign(process.env,prepared,{NODE_ENV:'production',DB_EXPECTED_UUID:expectedUuid,
    JWT_SECRET:active?.JWT_SECRET||crypto.randomBytes(48).toString('hex')});
  const models=require('../../models');let server;
  try{
    const identity=await require('../../services/database.service').verifyConnection(models.sequelize,{uuid:expectedUuid});
    const all=Object.values(models.sequelize.models);assert.equal(all.length,14);
    const [columns]=await models.sequelize.query('SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    for(const model of all){
      assert.deepEqual(Object.keys(model.rawAttributes).sort(),columns.filter(r=>r.t===model.tableName).map(r=>r.c).sort(),model.tableName);
    }
    await models.Product.findAll({limit:1});await models.User.findAll({limit:1});
    let auditReadConfigured=true;
    try{await require('../../services/audit.service').list({limit:'1'});}catch(error){if(error.status!==503)throw error;auditReadConfigured=false;}
    if(!active){
      const config={...prepared,DB_EXPECTED_UUID:expectedUuid,JWT_SECRET:process.env.JWT_SECRET,NODE_ENV:'production',SERVER_PORT:'3000',
        CORS_ORIGIN:'http://localhost:8080,http://localhost:8081'};
      fs.writeFileSync('.env',Object.entries(config).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{flag:'wx',mode:0o600});
    }
    const app=require('../../index');server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/swagger`)).status,200);
    assert.equal((await fetch(`${base}/api/nonexistent-read-probe`)).status,404);
    const result={verifiedAt:new Date().toISOString(),identity,models:all.map(m=>m.tableName).sort(),columnsCompared:columns.filter(r=>r.t!=='SequelizeMeta').length,
      configurationActivated:true,httpStartVerified:true,habitualOperations:'read only',auditReadConfigured};
    fs.mkdirSync('log/stage5',{recursive:true});fs.writeFileSync('log/stage5/activation.json',JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await models.sequelize.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
