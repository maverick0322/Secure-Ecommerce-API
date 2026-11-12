const { AccountError } = require('./accounts.service');

async function sendVerificationCode(email, code) {
  const { RESEND_API_KEY, REGISTRATION_EMAIL_FROM } = process.env;
  if (!RESEND_API_KEY || !REGISTRATION_EMAIL_FROM) {
    throw new AccountError(503, 'El servicio de correo no está disponible.');
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: REGISTRATION_EMAIL_FROM, to: [email], subject: 'Verifica tu correo',
        text: `Tu código de verificación es ${code}. Caduca en 10 minutos.` })
    });
    if (response.ok) return;
  } catch {
    // Do not propagate provider diagnostics, which may contain recipient data.
  }
  throw new AccountError(503, 'El servicio de correo no está disponible.');
}

module.exports = { sendVerificationCode };
