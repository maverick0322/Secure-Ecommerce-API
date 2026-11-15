const { AccountError } = require('./accounts.service');
const gmail = require('./gmail.service');

async function sendVerificationCode(email, code,purpose='registration') {
  try {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Invalid verification code');
    await gmail.sendMessage({to:email,...require('./email-template.service').verification({code,purpose})});
    return;
  } catch {
    // Do not propagate provider diagnostics, which may contain recipient data.
  }
  throw new AccountError(503, 'El servicio de correo no está disponible.');
}

module.exports = { sendVerificationCode };
