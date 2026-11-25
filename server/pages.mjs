// ─────────────────────────────────────────────────────────────
// Pages servies par le serveur : conditions d'utilisation, politique de
// confidentialité, contact (formulaire → e-mail) et « Mon compte »
// (déconnexion, suppression du compte). HTML sans JavaScript, formulaires
// classiques ; chaque POST doit venir du site (en-tête Origin).
// ─────────────────────────────────────────────────────────────
import { headerSafe } from './mail.mjs';
import { layout, terms, privacy, esc } from './legal.mjs';

const date = ms => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const CATEGORIES = {
  donnees: 'Mes données (accès, suppression, question)',
  signalement: 'Signaler un joueur ou une triche',
  bug: 'Signaler un problème',
  autre: 'Autre',
};

// ── Formulaires ──────────────────────────────────────────────
async function readForm(req, limit = 16_384) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('trop long'), { status: 413 });
    chunks.push(c);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,}$/i;

function contactPage({ user, available, values = {}, error = null, sent = false }) {
  if (sent) return layout('Contact', `<h1>Message envoyé</h1><p class="ok">Merci, votre message a bien été transmis.</p><p>${values.email ? 'Vous recevrez une réponse à l\'adresse indiquée.' : 'Vous n\'avez pas laissé d\'adresse e-mail : nous ne pourrons pas vous répondre directement.'}</p><p><a href="/">Retour au jeu</a></p>`);
  if (!available) return layout('Contact', '<h1>Contact</h1><p class="bad">Le formulaire de contact est momentanément indisponible. Réessayez plus tard.</p>');
  return layout('Contact', `
<h1>Contact</h1>
<p>Une question, un problème, une demande sur vos données ? Écrivez-nous ici.</p>
${error ? `<p class="bad">${esc(error)}</p>` : ''}
<form method="post" action="/contact" class="box">
  <label for="category">Sujet</label>
  <select id="category" name="category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${values.category === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
  <label for="email">Votre adresse e-mail <span class="muted">(facultative, pour recevoir une réponse)</span></label>
  <input id="email" name="email" type="email" maxlength="254" autocomplete="email" value="${esc(values.email)}">
  <label for="message">Message</label>
  <textarea id="message" name="message" maxlength="4000" required>${esc(values.message)}</textarea>
  <div class="hp" aria-hidden="true"><label for="website">Ne pas remplir</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
  ${user ? `<p class="muted">Vous êtes connecté : votre compte (<strong>${esc(user.name)}</strong>) sera joint au message.</p>` : ''}
  <p class="muted">Votre message est transmis par e-mail à l'administrateur et n'est pas conservé sur le serveur (voir la <a href="/confidentialite">politique de confidentialité</a>).</p>
  <button>Envoyer</button>
</form>`);
}

function accountPage({ user, stats, notice = null, error = null, devLogin, discord }) {
  if (!user) {
    return layout('Mon compte', `
<h1>Mon compte</h1>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p>Vous n'êtes pas connecté.</p>
${discord ? '<p><a class="btn" href="/auth/discord">Se connecter avec Discord</a></p>' : ''}
${devLogin ? '<form method="get" action="/auth/dev" class="box"><label for="name">Connexion factice (développement)</label><input id="name" name="name" maxlength="24" required style="width:auto"> <button>Se connecter</button></form>' : ''}`);
  }
  return layout('Mon compte', `
<h1>Mon compte</h1>
${notice ? `<p class="ok">${esc(notice)}</p>` : ''}${error ? `<p class="bad">${esc(error)}</p>` : ''}
<div class="box">
  <p>Connecté en tant que <strong>${esc(user.name)}</strong>${user.discord_id.startsWith('dev:') ? ' <span class="muted">(compte de développement)</span>' : ''}.</p>
  <p class="muted">Compte créé le ${date(user.created_at)} · ${stats.games} partie${stats.games > 1 ? 's' : ''} jouée${stats.games > 1 ? 's' : ''}.</p>
  <form method="post" action="/compte/deconnexion" style="display:inline"><button>Se déconnecter</button></form>
  <form method="post" action="/compte/deconnexion-partout" style="display:inline"><button>Se déconnecter de tous mes appareils</button></form>
</div>

<h2>Supprimer mon compte</h2>
<div class="box danger">
  <p><strong>Ce qui se passe si vous supprimez votre compte :</strong></p>
  <ul>
    <li>Votre compte est <strong>supprimé immédiatement</strong> : pseudo, avatar, identifiant Discord et date de création de votre compte Discord sont effacés du Dojo.</li>
    <li>Vous êtes <strong>déconnecté de tous vos appareils</strong>.</li>
    <li>Si vous avez un salon en attente, il est fermé ; <strong>si une partie est en cours, vous la perdez par abandon</strong>.</li>
    <li>Votre classement est supprimé.</li>
    <li>Les parties déjà jouées restent dans l'historique de vos adversaires, mais <strong>sans votre nom ni aucun lien avec vous</strong> : vous y apparaissez comme « Joueur supprimé ».</li>
    <li>C'est <strong>définitif</strong>. Si vous vous reconnectez plus tard avec Discord, un nouveau compte vierge sera créé.</li>
    <li>Vos decks et préférences enregistrés dans votre navigateur ne sont pas concernés.</li>
    <li>L'autorisation donnée au Dojo sur Discord reste à retirer de votre côté : Discord → Paramètres utilisateur → Applications autorisées → Dojo des Songes → Retirer l'autorisation.</li>
  </ul>
  <form method="post" action="/compte/supprimer">
    <label><input type="checkbox" name="confirm" value="oui" required> J'ai compris : supprimer définitivement mon compte.</label>
    <button class="danger">Supprimer mon compte</button>
  </form>
</div>`);
}

/**
 * Routes : GET /conditions, /confidentialite, /contact, /compte ; POST /contact, /compte/…
 * Renvoie vrai si la requête a été traitée.
 */
export function createPages({ db, auth, lobby, mailer, publicUrl, operator = null, devLogin = false, discord = false, now = () => Date.now(), limiter }) {
  const origin = new URL(publicUrl).origin;
  const contactLimit = limiter(5, 3_600_000);  // messages par heure, par IP et par compte
  const html = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'same-origin', ...headers,
    });
    res.end(body);
  };
  const redirect = (res, to, headers = {}) => { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...headers }); res.end(); };
  const stats = u => ({ games: db.raw.prepare('SELECT COUNT(*) n FROM games WHERE p0 = ? OR p1 = ?').get(u.id, u.id).n });
  const NOTICES = { deconnecte: 'Vous êtes déconnecté.', partout: 'Vous êtes déconnecté de tous vos appareils.', supprime: 'Votre compte a été supprimé.' };

  return {
    contactLimit,
    async handle(req, res, path, query, ip) {
      if (req.method === 'GET') {
        if (path === '/conditions') return html(res, 200, terms()), true;
        if (path === '/confidentialite') return html(res, 200, privacy({ operator })), true;
        if (path === '/contact') return html(res, 200, contactPage({ user: auth.userFrom(req), available: mailer.available })), true;
        if (path === '/compte') {
          const user = auth.userFrom(req);
          return html(res, 200, accountPage({ user, stats: user ? stats(user) : null, notice: NOTICES[query.get('ok')] ?? null, devLogin, discord })), true;
        }
        return false;
      }
      if (req.method !== 'POST' || !['/contact', '/compte/deconnexion', '/compte/deconnexion-partout', '/compte/supprimer'].includes(path)) return false;
      if (req.headers.origin !== origin) return html(res, 403, layout('Refusé', '<h1>Requête refusée</h1><p>Cette action doit être faite depuis le site.</p>')), true;
      let form;
      try { form = await readForm(req); } catch (e) { return html(res, e.status ?? 400, layout('Erreur', '<h1>Message trop long</h1>')), true; }
      const user = auth.userFrom(req);

      if (path === '/contact') {
        const values = { category: CATEGORIES[form.get('category')] ? form.get('category') : 'autre', email: (form.get('email') ?? '').trim(), message: (form.get('message') ?? '').trim() };
        if (form.get('website')) return html(res, 200, contactPage({ sent: true, values })), true; // robot : on fait comme si
        const again = error => html(res, 400, contactPage({ user, available: mailer.available, values, error }));
        if (values.message.length < 10) return again('Votre message est trop court.'), true;
        if (values.message.length > 4000) return again('Votre message est trop long (4 000 caractères au plus).'), true;
        if (values.email && (values.email.length > 254 || !EMAIL.test(values.email))) return again('Cette adresse e-mail ne semble pas valide.'), true;
        if (!contactLimit.hit(`ip:${ip}`) || (user && !contactLimit.hit(`user:${user.id}`))) return again('Trop de messages envoyés : réessayez dans une heure.'), true;
        const who = user ? `Compte : ${user.name} (n° ${user.id}, ${user.discord_id.startsWith('dev:') ? 'développement' : `Discord ${user.discord_id}`})` : 'Non connecté';
        try {
          await mailer.send({
            subject: `[Dojo] ${CATEGORIES[values.category]}`, replyTo: values.email || undefined,
            text: `${who}\nAdresse de réponse : ${values.email || '(aucune)'}\nReçu le : ${new Date(now()).toISOString()}\n\n${values.message}\n`,
          });
        } catch (e) {
          console.error('Envoi du contact :', e.message);
          return html(res, 503, contactPage({ user, available: false })), true;
        }
        return html(res, 200, contactPage({ sent: true, values })), true;
      }

      if (!user) return redirect(res, '/compte'), true;
      if (path === '/compte/deconnexion') { auth.logout(req); return redirect(res, '/compte?ok=deconnecte', { 'Set-Cookie': auth.clearCookie() }), true; }
      if (path === '/compte/deconnexion-partout') {
        db.deleteUserSessions(user.id);
        lobby.kickUser(user.id, 'déconnecté');
        return redirect(res, '/compte?ok=partout', { 'Set-Cookie': auth.clearCookie() }), true;
      }
      if (path === '/compte/supprimer') {
        if (form.get('confirm') !== 'oui') return html(res, 400, accountPage({ user, stats: stats(user), error: 'Cochez la case de confirmation pour supprimer votre compte.', devLogin, discord })), true;
        lobby.removeUser(user.id);   // salon fermé, partie en cours perdue par abandon, connexions fermées
        db.deleteUser(user.id);      // compte + sessions ; parties anonymisées (joueur = NULL)
        return redirect(res, '/compte?ok=supprime', { 'Set-Cookie': auth.clearCookie() }), true;
      }
      return false;
    },
  };
}
