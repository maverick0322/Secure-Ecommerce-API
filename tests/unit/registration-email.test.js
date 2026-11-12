'use strict';
const {sendVerificationCode}=require('../../services/registration-email.service');
afterEach(()=>jest.restoreAllMocks());
it('fails closed without provider credentials',async()=>{
  jest.replaceProperty(process,'env',{...process.env,RESEND_API_KEY:'',REGISTRATION_EMAIL_FROM:''});
  const fetch=jest.spyOn(global,'fetch');
  await expect(sendVerificationCode('buyer@example.invalid','123456')).rejects.toMatchObject({status:503});expect(fetch).not.toHaveBeenCalled();
});
it('uses bounded POST requests and does not propagate provider diagnostics',async()=>{
  jest.replaceProperty(process,'env',{...process.env,RESEND_API_KEY:'synthetic-provider-key',REGISTRATION_EMAIL_FROM:'verify@example.invalid'});
  const fetch=jest.spyOn(global,'fetch').mockResolvedValue({ok:true});
  await sendVerificationCode('buyer@example.invalid','123456');
  expect(fetch).toHaveBeenCalledWith('https://api.resend.com/emails',expect.objectContaining({method:'POST',redirect:'error',signal:expect.any(AbortSignal)}));
  const payload=JSON.parse(fetch.mock.calls[0][1].body);expect(payload.to).toEqual(['buyer@example.invalid']);
  fetch.mockResolvedValue({ok:false});await expect(sendVerificationCode('buyer@example.invalid','123456')).rejects.toMatchObject({status:503});
  fetch.mockRejectedValue(new Error('secret provider diagnostics'));
  await expect(sendVerificationCode('buyer@example.invalid','123456')).rejects.toThrow('El servicio de correo no está disponible.');
});
