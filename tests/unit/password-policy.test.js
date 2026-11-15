'use strict';
const policy=require('../../services/password-policy.service');
const {newPassword,validPassword}=require('../../services/accounts.service');
it.each(['contraseña123?','abcde1!?','Password123456!','Qwertyuiop123456!',
  'a1!a1!a1!','ñáéíóú١?','  Brisa7!?  ','a1!'+'🙂'.repeat(125)])('accepts the explicit composition policy without changing bytes %#',value=>{
  expect(newPassword(value)).toBe(value);expect(policy.acceptable(value)).toBe(true);
});
it.each(['abcdefgh!','1234567!','abcdefg1','abcdef1 ', '12345678','abcdefgh',
  '',null,{},[], 'abc1!?x','a1!'+'🙂'.repeat(126),'abc1!?\0z','\ud800abc123!?'])('rejects missing components, invalid Unicode or limits %#',value=>{
  expect(()=>newPassword(value)).toThrow('una letra, un número y un carácter especial');
  expect(policy.acceptable(value)).toBe(false);
});
it('counts Unicode code points and preserves the technical limits',()=>{
  const exact='é'.repeat(20)+'Olas azules al sol de noviembre1';
  expect(Buffer.byteLength(exact)).toBe(72);expect(newPassword(exact+'!')).toBe(exact+'!');
  expect(policy.validInput('🙂'.repeat(128))).toBe(true);
  expect(policy.validInput('🙂'.repeat(129))).toBe(false);
});
it('does not apply the new composition rules to login',()=>{
  for(const value of ['legacy','abcdefgh','x'.repeat(73)])expect(validPassword(value)).toBe(true);
  expect(validPassword('x'.repeat(129))).toBe(false);expect(validPassword('a\0b')).toBe(false);
});
