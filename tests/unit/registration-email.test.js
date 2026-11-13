'use strict';
const {sendVerificationCode}=require('../../services/registration-email.service');
const gmail=require('../../services/gmail.service');
afterEach(()=>jest.restoreAllMocks());
it('preserves the OTP message, subject and expiry with the Gmail adapter',async()=>{
  const send=jest.spyOn(gmail,'sendMessage').mockResolvedValue();
  await sendVerificationCode('buyer@example.invalid','123456');
  expect(send).toHaveBeenCalledWith({to:'buyer@example.invalid',subject:'Verifica tu correo',text:'Tu código de verificación es 123456. Caduca en 10 minutos.'});
});
it.each(['GMAIL_CONFIGURATION_INVALID','GMAIL_REAUTH_REQUIRED','GMAIL_SEND_FAILED'])('preserves the generic HTTP 503 contract for %s',async code=>{
  jest.spyOn(gmail,'sendMessage').mockRejectedValue(new gmail.GmailError(code));
  await expect(sendVerificationCode('buyer@example.invalid','123456')).rejects.toMatchObject({status:503,message:'El servicio de correo no está disponible.'});
});
it.each(['bad','12345','1234567',null])('does not send malformed OTP %#',async code=>{
  const send=jest.spyOn(gmail,'sendMessage');
  await expect(sendVerificationCode('buyer@example.invalid',code)).rejects.toMatchObject({status:503});expect(send).not.toHaveBeenCalled();
});
