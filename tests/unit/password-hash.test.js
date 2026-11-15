'use strict';
const hashes=require('../../services/password-hash.service'),policy=require('../../services/password-policy.service');
const bcrypt=require('bcrypt');
it('uses every byte after the bcrypt boundary and supports 128 Unicode characters with astral symbols',async()=>{
  const prefix='Ab19!?Xy'.repeat(9),password=prefix+'m'.repeat(56),other=prefix+'n'.repeat(56);
  const encoded=await hashes.hash(password);expect(await hashes.verify(password,encoded)).toBe(true);
  expect(await hashes.verify(other,encoded)).toBe(false);
  const unicode='ñ1!'+Array.from({length:125},(_,i)=>String.fromCodePoint(0x1f300+i)).join('');
  expect(Buffer.byteLength(unicode)).toBe(504);expect([...unicode]).toHaveLength(128);
  expect(await hashes.verify(unicode,await hashes.hash(unicode))).toBe(true);
});
it('preserves spaces, normalization differences and legacy credential versions',async()=>{
  const password='  Brisa7!?  ',encoded=await hashes.hash(password);
  expect(await hashes.verify(password.trim(),encoded)).toBe(false);
  const wide='Ａbcde7!?',wideHash=await hashes.hash(wide);
  expect(await hashes.verify(wide.normalize('NFKC'),wideHash)).toBe(false);
  const crypto=require('node:crypto'),key=crypto.randomBytes(32),legacy=await bcrypt.hash('Legacy83!?',4);
  const versions=require('../../services/credential-version.service').createCredentialVersionService(key);
  expect(versions.derive(legacy)).toBe(crypto.createHmac('sha256',key).update('secure-ecommerce-credentials-v1\0').update(legacy).digest('hex'));
  expect(versions.derive(encoded)).not.toBe(versions.derive(wideHash));
});
it.each(['2a','2y'])('verifies the supported legacy bcrypt variant %s',async variant=>{
  const original=await bcrypt.hash('Legacy83!?',4),encoded=original.replace('$2b$','$'+variant+'$');
  expect(await hashes.verify('Legacy83!?',encoded)).toBe(true);
});
it('does not apply new-password composition retroactively to existing bcrypt accounts',async()=>{
  expect(policy.acceptable('abcdefgh')).toBe(false);
  expect(await hashes.verify('abcdefgh',await bcrypt.hash('abcdefgh',4))).toBe(true);
});
it('verifies existing scrypt hashes whose password no longer meets new-password composition',async()=>{
  const crypto=require('node:crypto'),password='historical lowercase password',salt=crypto.randomBytes(16);
  const digest=await require('node:util').promisify(crypto.scrypt)(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});
  const encoded='$scrypt$v1$32768$8$3$'+salt.toString('base64url')+'$'+digest.toString('base64url');
  expect(policy.acceptable(password)).toBe(false);expect(await hashes.verify(password,encoded)).toBe(true);
});
it.each(['Brisa7!?','  Brisa7!?  ','ñ1!'+Array.from({length:125},(_,i)=>String.fromCodePoint(0x400+i)).join('')])('round-trips the entire password without normalization or truncation %#',async password=>{
  expect(policy.acceptable(password)).toBe(true);
  const hash=await hashes.hash(password);expect(hash.length).toBeLessThan(255);expect(hash.startsWith('$scrypt$v1$')).toBe(true);
  expect(await hashes.verify(password,hash)).toBe(true);expect(await hashes.verify(password+'x',hash)).toBe(false);
});
it('retains bcrypt compatibility without accepting truncated long candidates',async()=>{
  const password='Historical Brisa7!?',hash=await bcrypt.hash(password,4);
  expect(await hashes.verify(password,hash)).toBe(true);expect(await hashes.verify('wrong',hash)).toBe(false);
  const prefix='A1b2c3D4'.repeat(9),legacy=await bcrypt.hash(prefix,4);
  expect(await hashes.verify(prefix+'different',legacy)).toBe(false);
});
it.each(['short7!','password123','12345678','x'.repeat(129),'abc\0defgh','\ud800abc123!?',{},null])('rejects invalid new passwords %#',async password=>{
  await expect(hashes.hash(password)).rejects.toThrow();
});
it.each(['plain','sha256:synthetic','$scrypt$v1$999999999$8$3$x$y','$2b$99$'+'a'.repeat(53)])('rejects unknown or attacker-selected hash parameters %#',async hash=>{
  expect(await hashes.verify('Brisa7!?',hash)).toBe(false);
});
it('salts independently and limits pending expensive work',async()=>{
  const [a,b]=await Promise.all([hashes.hash('Brisa7!?'),hashes.hash('Brisa7!?')]);expect(a).not.toBe(b);
  const results=await Promise.allSettled(Array.from({length:20},()=>hashes.hash('Brisa7!?')));
  expect(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='PASSWORD_SERVICE_BUSY')).toBe(true);
  expect(results.filter(x=>x.status==='rejected').length).toBe(2);
},15000);
