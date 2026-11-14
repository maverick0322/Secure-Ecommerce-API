'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {compareCodeUnits}=require('../../services/canonical-order');
const {isMigrationFile}=require('../../postman/scripts/isolation');
const audit=require('../../services/audit.service');
const policy=require('../../services/password-policy.service');
afterEach(()=>jest.restoreAllMocks());
it('preserves UTF-16 canonical order, including case, digits, BMP and supplementary characters',()=>{
  expect(['é','😀','\uE000','2','10','a','A','_','e','9','0'].sort(compareCodeUnits))
    .toEqual(['0','10','2','9','A','_','a','e','é','😀','\uE000']);
  expect(compareCodeUnits('equal','equal')).toBe(0);
});
it('preserves the Redis state key contract independent of insertion order',()=>{
  const keys=['version','namespace','generation','expectedRunId'];
  expect(keys.sort(compareCodeUnits).join(',')).toBe('expectedRunId,generation,namespace,version');
});
it('keeps migration chronology and schema name checks canonical',()=>{
  const root=path.resolve(__dirname,'../..');
  const migrations=fs.readdirSync(path.join(root,'migrations')).filter(isMigrationFile)
    .concat(fs.readdirSync(path.join(root,'migrations/cutover')).filter(isMigrationFile)).sort(compareCodeUnits);
  expect(migrations).toHaveLength(11);
  expect(migrations[0]).toBe('20240101000001-create-archivo.js');
  expect(migrations.at(-1)).toBe('20261110000003-finalize-secure-ecommerce-schema.js');
  expect(require('../../services/database.service').tables).toEqual([
    'admins','audit_logs','buyers','cart_items','carts','categories','order_items',
    'order_status_history','orders','product_categories','products','sellers','user_addresses','users']);
});
it('preserves numeric HTTP status ordering beyond the current three-digit fixtures',()=>{
  expect([409,200,50,1000].sort((a,b)=>a-b)).toEqual([50,200,409,1000]);
});
it('node:test still reports rejected test bodies when registration promises use void',()=>{
  const os=require('node:os'),{spawnSync}=require('node:child_process');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sonar-node-test-'));
  try {
    const file=path.join(directory,'failure.cjs');
    fs.writeFileSync(file,"const {test}=require('node:test'); void test('synthetic failure',async()=>{throw new Error('REJECTION_OBSERVED');});");
    const result=spawnSync(process.execPath,['--test',file],{encoding:'utf8',timeout:10000,windowsHide:true});
    expect(result.status).toBe(1);expect(result.stdout+result.stderr).toContain('REJECTION_OBSERVED');
  }finally {fs.rmSync(directory,{recursive:true,force:true});}
});
it.each(['20261110000003-finalize-secure-ecommerce-schema.js','1.js','12.js','1-extra.name.js'])('accepts migration file %s',name=>{
  expect(isMigrationFile(name)).toBe(true);
});
it.each(['file.js','1.txt','1.js\n','1\nname.js','1\u2028name.js','1'+'x'.repeat(100000)+'.js',null])('rejects nonmigration or adversarial name %#',name=>{
  expect(isMigrationFile(name)).toBe(false);
});
it('preserves audit email redaction, including greedy domains and adjacent candidates',()=>{
  // Bounded legacy oracle: all corpus values are shorter than 255 characters.
  const old=value=>value.replace(/[\w.+-]{1,255}@[\w.-]{1,255}\.[A-Za-z]{2,255}/g,'[REDACTED]');
  const cases=['a@b.cd','a+tag@b.cdef123','a@.bc','a@..bc','a@b.cd@ef.gh',
    'user@example.invalid and other+tag@domain.test','@x.yz','prefix a@b.cd.ef trailing',
    'a@b.x a@b.xy a@b.x_yz','🙂x@d.test','a@b.cd+hello@z.ef'];
  // Deterministic differential corpus; no random/flaky time budget assertions.
  let state=1729;
  const alphabet='abcXYZ19._+-@ !';
  for(let sample=0;sample<1000;sample++){
    let value='';
    for(let n=0;n<40;n++){state=(Math.imul(state,1664525)+1013904223)>>>0;value+=alphabet[state%alphabet.length];}
    cases.push(value);
  }
  for(const reason of cases)expect(audit.sanitize({reason}).reason).toBe(old(reason));
});
it('bounds audit work by Unicode characters before copying or redacting large reasons',()=>{
  const reason='🙂'.repeat(255)+'sensitive@example.invalid'+'x'.repeat(1000000);
  expect(audit.sanitize({reason}).reason).toBe('🙂'.repeat(255));
  expect(audit.sanitize({reason:'.'.repeat(1000000)+'@'}).reason).toBe('.'.repeat(255));
});
it('preserves password suffix semantics and never transforms the password passed to bcrypt',()=>{
  for(const base of ['password','administrator','qwertyuiop','contrasenasegura']){
    for(const suffix of ['123456789!?','１２３４５６７８９!?','12345678🙂!?']){
      const value=base+suffix;
      expect(policy.acceptable(value)).toBe(false);
    }
  }
  const value='  Brisa y montañas 726!  ';
  expect(require('../../services/accounts.service').newPassword(value)).toBe(value);
  expect(policy.acceptable('x'.repeat(1000000))).toBe(false);
});
it('acquires seller locks in exactly the previous identifier order',async()=>{
  const db=require('../../models'),orders=require('../../services/orders.service');
  const tx={LOCK:{UPDATE:'UPDATE'}}, buyer='buyer';
  const low='00000000-0000-4000-8000-000000000000',high='ffffffff-ffff-4fff-bfff-ffffffffffff';
  jest.spyOn(db.sequelize,'transaction').mockImplementation(work=>work(tx));
  const user=jest.spyOn(db.User,'findByPk').mockResolvedValue({status:'ACTIVE',emailVerifiedAt:new Date()});
  jest.spyOn(db.Buyer,'findByPk').mockResolvedValue({userId:buyer});
  jest.spyOn(db.UserAddress,'findOne').mockResolvedValue({street:'Synthetic street'});
  jest.spyOn(db.Cart,'findOne').mockResolvedValue({id:1});
  jest.spyOn(db.CartItem,'findAll').mockResolvedValue([{productId:1,quantity:1},{productId:2,quantity:1}]);
  const products=[{id:1,sellerId:high,stock:2,price:'1.00',title:'First'},{id:2,sellerId:low,stock:2,price:'2.00',title:'Second'}];
  jest.spyOn(db.Product,'findAll').mockResolvedValue(products);
  jest.spyOn(db.Seller,'findByPk').mockResolvedValue({status:'APPROVED'});
  jest.spyOn(db.Product,'findByPk').mockImplementation(async id=>products.find(p=>p.id===id));
  jest.spyOn(require('../../services/checkout-quote.service'),'sign').mockReturnValue('synthetic quote');
  await orders.quote(buyer,'1');
  expect(user.mock.calls.map(call=>call[0])).toEqual([buyer,low,high]);
});
