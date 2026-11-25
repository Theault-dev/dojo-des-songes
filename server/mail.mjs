// ─────────────────────────────────────────────────────────────
// Envoi des messages du formulaire de contact.
//
// Variables : SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS,
// SMTP_FROM (expéditeur ; défaut SMTP_USER), CONTACT_TO (destinataire).
// L'adresse CONTACT_TO ne quitte jamais le serveur : elle n'apparaît ni
// dans les pages ni dans les réponses.
// Sans SMTP : en DEV, le message est affiché dans la console ; sinon le
// formulaire indique que le contact est indisponible.
// ─────────────────────────────────────────────────────────────

/** Une ligne d'en-tête sûre : ni retour à la ligne (injection d'en-têtes), ni caractère de contrôle. */
export const headerSafe = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200);

export function createMailer(env = {}, { dev = false, log = console.log } = {}) {
  const configured = !!(env.SMTP_HOST && env.CONTACT_TO);
  let transport = null;
  return {
    available: configured || dev,
    /** `{ subject, text, replyTo? }` → envoie au destinataire configuré. */
    async send({ subject, text, replyTo }) {
      if (!configured) {
        if (!dev) throw new Error('contact non configuré');
        log?.(`\n── Message de contact (DEV, non envoyé) ──\nSujet : ${subject}\nRépondre à : ${replyTo ?? '—'}\n${text}\n`);
        return;
      }
      if (!transport) {
        const { default: nodemailer } = await import('nodemailer');
        const port = +(env.SMTP_PORT ?? 465);
        transport = nodemailer.createTransport({
          host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
          disableFileAccess: true, disableUrlAccess: true,
        });
      }
      await transport.sendMail({
        from: env.SMTP_FROM || env.SMTP_USER, to: env.CONTACT_TO,
        subject: headerSafe(subject), text, ...(replyTo ? { replyTo: headerSafe(replyTo) } : {}),
      });
    },
  };
}
