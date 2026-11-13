const verification = require('../../services/email-verification.service');
const mailer = require('../../services/registration-email.service');

afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

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
