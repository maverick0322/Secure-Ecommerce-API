const { AccountError } = require('./accounts.service');
const gmail = require('./gmail.service');

async function sendVerificationCode(email, code) {
  try {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('Invalid verification code');
    await gmail.sendMessage({ to:email, subject:'Verifica tu correo', text:`Tu código de verificación es ${code}. Caduca en 10 minutos.` });
    return;
  } catch {
    // Do not propagate provider diagnostics, which may contain recipient data.
  }
  throw new AccountError(503, 'El servicio de correo no está disponible.');
}

module.exports = { sendVerificationCode };
