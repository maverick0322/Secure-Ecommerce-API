const verification = require('../../services/email-verification.service');
const mailer = require('../../services/registration-email.service');

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('keeps registration and recovery purposes separate, including expiry and replay',async()=>{
  jest.useFakeTimers();const send=jest.spyOn(mailer,'sendVerificationCode').mockResolvedValue();
  const email='purpose@example.invalid';await verification.issue(email,{userId:'server-only'},'recovery');
  const code=send.mock.calls[0][1],work=jest.fn();
  await expect(verification.verify(email,code,work,'registration')).rejects.toMatchObject({status:400});
  expect(work).not.toHaveBeenCalled();jest.advanceTimersByTime(600001);
  await expect(verification.verify(email,code,work,'recovery')).rejects.toMatchObject({status:400});
});
it('serializes two simultaneous recovery confirmations without admitting two mutations',async()=>{
  const send=jest.spyOn(mailer,'sendVerificationCode').mockResolvedValue();const email='race-reset@example.invalid';
  await verification.issue(email,{userId:'server-only'},'recovery');const code=send.mock.calls[0][1];let release;
  const gate=new Promise(resolve=>{release=resolve;}),work=jest.fn(async()=>{await gate;return 'done';});
  const first=verification.verify(email,code,work,'recovery');
  await expect(verification.verify(email,code,work,'recovery')).rejects.toMatchObject({status:400});
  release();await expect(first).resolves.toBe('done');expect(work).toHaveBeenCalledTimes(1);
});
it('limits pending storage globally without contacting real mail providers',async()=>{
  jest.useFakeTimers();jest.advanceTimersByTime(1200000);
  jest.spyOn(mailer,'sendVerificationCode').mockResolvedValue();
  for(let i=0;i<1000;i++)await verification.issue('capacity-'+i+'@example.invalid',null,'registration');
  await expect(verification.issue('overflow@example.invalid')).rejects.toMatchObject({status:429});
  jest.advanceTimersByTime(600001);await expect(verification.issue('after-capacity@example.invalid')).resolves.toBeUndefined();
});

it('expires a code after ten minutes and limits delivery during the cooldown', async () => {
  jest.useFakeTimers();
  const send = jest.spyOn(mailer, 'sendVerificationCode').mockResolvedValue();
  const email = 'expires@example.invalid';
  await verification.issue(email);
  await verification.issue(email);
  expect(send).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(600001);
  await expect(verification.verify(email, send.mock.calls[0][1], jest.fn())).rejects.toMatchObject({ status: 400 });
});

it('limits guesses even if a new code is requested during the same challenge', async () => {
  jest.useFakeTimers();
  const send = jest.spyOn(mailer, 'sendVerificationCode').mockResolvedValue();
  const email = 'attempts@example.invalid';
  const create = jest.fn();
  await verification.issue(email);
  const wrong = code => code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 4; i++) await expect(verification.verify(email, wrong(send.mock.calls[0][1]), create)).rejects.toMatchObject({ status: 400 });
  jest.advanceTimersByTime(60001);
  await verification.issue(email);
  expect(send).toHaveBeenCalledTimes(2);
  const code = send.mock.calls[1][1];
  await expect(verification.verify(email, wrong(code), create)).rejects.toMatchObject({ status: 400 });
  await expect(verification.verify(email, code, create)).rejects.toMatchObject({ status: 400 });
  expect(create).not.toHaveBeenCalled();
});

it('keeps the code available after a failed write and consumes it after success', async () => {
  const send = jest.spyOn(mailer, 'sendVerificationCode').mockResolvedValue();
  const email = 'retry@example.invalid';
  await verification.issue(email);
  const code = send.mock.calls[0][1];
  const create = jest.fn().mockRejectedValueOnce(new Error('transaction failed')).mockResolvedValueOnce('created');
  await expect(verification.verify(email, code, create)).rejects.toThrow('transaction failed');
  await expect(verification.verify(email, code, create)).resolves.toBe('created');
  await expect(verification.verify(email, code, create)).rejects.toMatchObject({ status: 400 });
});
