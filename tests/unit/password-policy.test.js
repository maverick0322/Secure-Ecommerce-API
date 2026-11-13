'use strict';
const policy=require('../../services/password-policy.service');
const {newPassword,validPassword}=require('../../services/accounts.service');
it.each(['Password123456!', 'passwordpassword', 'Qwertyuiop123456!', 'aaaaaaaaaaaaaaaa',
  'abcabcabcabcabcabc', '123456789012345', '١٢٣٤٥٦٧٨٩٠١٢٣٤٥', 'correct horse battery staple', 'aaaaaaaaaaaaaaB', '', null, {},
  'shortPassword!', 'a'.repeat(73), '🙂'.repeat(19), 'Phrase with a \0 null', '\ud800'.repeat(15)])(
  'rejects weak, invalid, common or overlong candidate %# without returning it', value=>{
    expect(()=>newPassword(value)).toThrow('contraseña');expect(policy.acceptable(value)).toBe(false);
  });
it('accepts passphrases and Unicode without changing the original bytes',()=>{
  for(const value of ['Orquídea lunar sobre siete montañas', 'Albatross circles the quiet bay 47',
    require('node:crypto').randomBytes(54).toString('base64')]) expect(newPassword(value)).toBe(value);
});
it('counts Unicode characters and enforces the bcrypt byte boundary before hashing',()=>{
  const exact='é'.repeat(20)+'Olas azules al sol de noviembre!';
  expect(Buffer.byteLength(exact)).toBe(72);expect(newPassword(exact)).toBe(exact);
  expect(()=>newPassword(exact+'!')).toThrow();
  expect(policy.acceptable('🙂'.repeat(4))).toBe(false);
});
it('keeps legacy short passwords eligible for login but never truncates bcrypt inputs',()=>{
  expect(validPassword('legacy')).toBe(true);
  expect(validPassword('x'.repeat(73))).toBe(false);expect(validPassword('a\0b')).toBe(false);
});
