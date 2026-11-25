// ─────────────────────────────────────────────────────────────
// Pages servies par le serveur : conditions d'utilisation, politique de
// confidentialité, contact (formulaire → e-mail) et « Mon compte »
// (déconnexion, suppression du compte). HTML sans JavaScript, formulaires
// classiques ; chaque POST doit venir du site (en-tête Origin).
// ─────────────────────────────────────────────────────────────
import { headerSafe } from './mail.mjs';

const UPDATED = '25 novembre 2026';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = ms => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const CATEGORIES = {
  donnees: 'Mes données (accès, suppression, question)',
  signalement: 'Signaler un joueur ou une triche',
  bug: 'Signaler un problème',
  autre: 'Autre',
};

function layout(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Dojo des Songes</title>
<style>
  :root { color-scheme: dark; --bg: #14182e; --panel: #1d2242; --line: #2e3562; --text: #e8e9f3; --muted: #9aa0c3; --accent: #f0b84a; --bad: #ff8a8a; --ok: #7be0a0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; background: var(--bg); color: var(--text); }
  header, footer { padding: 12px 20px; display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
  header { border-bottom: 1px solid var(--line); } footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; margin-top: 40px; }
  header strong { margin-right: auto; }
  a { color: var(--accent); }
  main { max-width: 760px; margin: auto; padding: 8px 20px; }
  h1 { font-size: 26px; } h2 { font-size: 19px; margin-top: 28px; color: var(--accent); }
  .muted { color: var(--muted); } .bad { color: var(--bad); } .ok { color: var(--ok); }
  .box { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
  .danger { border-color: #7a3040; }
  label { display: block; margin: 12px 0 4px; }
  input[type=email], select, textarea { width: 100%; background: #0f1226; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px; font: inherit; }
  textarea { min-height: 160px; }
  button, .btn { display: inline-block; background: #2b3270; color: var(--text); border: 1px solid #4450a0; border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; text-decoration: none; margin: 4px 6px 4px 0; }
  button.danger { background: #5a1f2c; border-color: #a33a50; }
  .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
</style></head><body>
<header><strong>Dojo des Songes</strong><a href="/">Jouer</a><a href="/compte">Mon compte</a><a href="/contact">Contact</a></header>
<main>${body}</main>
<footer><a href="/conditions">Conditions d'utilisation</a><a href="/confidentialite">Politique de confidentialité</a><a href="/contact">Contact</a></footer>
</body></html>`;
}

// ── Textes ───────────────────────────────────────────────────
function terms() {
  return layout('Conditions d\'utilisation', `
<h1>Conditions d'utilisation</h1>
<p class="muted">Dernière mise à jour : ${UPDATED}</p>

<h2>1. Le service</h2>
<p>Le Dojo des Songes est un simulateur <strong>non officiel</strong> du jeu de cartes Dreamland TCG, réalisé par un fan, gratuit et sans publicité. Il n'est ni affilié, ni approuvé par les éditeurs de Dreamland. Les noms, textes et illustrations des cartes appartiennent à leurs ayants droit.</p>
<p>On peut y jouer contre des bots (sans compte, tout reste dans votre navigateur) ou contre d'autres joueurs (avec un compte).</p>

<h2>2. Votre compte</h2>
<ul>
  <li>Le jeu contre d'autres joueurs demande de se connecter avec un compte Discord. Le Dojo ne reçoit que votre identifiant Discord, votre pseudo, votre avatar et la date de création de votre compte (voir la <a href="/confidentialite">politique de confidentialité</a>).</li>
  <li><strong>Un seul compte par personne.</strong> Pour le mode classé, le compte Discord doit exister depuis au moins 7 jours.</li>
  <li>Vous pouvez supprimer votre compte à tout moment depuis <a href="/compte">Mon compte</a>.</li>
</ul>

<h2>3. Règles de conduite</h2>
<p>Il est interdit :</p>
<ul>
  <li>de <strong>tricher</strong> : modifier le jeu ou ses échanges avec le serveur, exploiter un bug pour obtenir un avantage, chercher à connaître les cartes cachées de l'adversaire ;</li>
  <li>de <strong>faire jouer un programme à votre place</strong> (bot, assistant automatique) contre d'autres joueurs ;</li>
  <li>d'<strong>arranger des résultats</strong> (perdre volontairement, s'entendre avec un adversaire) ou d'utiliser plusieurs comptes ;</li>
  <li>de <strong>perturber le service</strong> : le surcharger, tenter d'y accéder sans autorisation, contourner ses limites ;</li>
  <li>d'utiliser un pseudo injurieux, discriminatoire ou usurpant l'identité de quelqu'un.</li>
</ul>
<p>Une faille de sécurité découverte ? Merci de la signaler par le <a href="/contact">formulaire de contact</a> plutôt que de l'exploiter.</p>

<h2>4. Sanctions</h2>
<p>En cas de manquement, nous pouvons annuler des résultats, retirer un classement, suspendre ou supprimer un compte, selon la gravité. Vous pouvez contester une décision par le <a href="/contact">formulaire de contact</a>.</p>

<h2>5. Disponibilité</h2>
<p>Le Dojo est un projet personnel hébergé sur un petit serveur : il est fourni <strong>tel quel, sans garantie</strong> de disponibilité ni d'absence d'erreur. Une partie en cours peut être interrompue (panne, coupure, mise à jour des règles) ; elle est alors annulée sans effet sur le classement. Dans les limites permises par la loi, nous ne pouvons être tenus responsables d'un dommage lié à l'utilisation du service.</p>

<h2>6. Modifications</h2>
<p>Ces conditions peuvent évoluer ; la date de mise à jour figure en haut de la page. En cas de changement important, il sera signalé sur le site. Ces conditions sont soumises au droit français.</p>
`);
}

function privacy({ operator }) {
  return layout('Politique de confidentialité', `
<h1>Politique de confidentialité</h1>
<p class="muted">Dernière mise à jour : ${UPDATED}</p>
<p>Cette page explique quelles données le Dojo des Songes enregistre, pourquoi, combien de temps, et comment exercer vos droits (RGPD).</p>

<h2>1. Responsable</h2>
<p>Le Dojo des Songes est un projet personnel et non commercial${operator ? `, édité par <strong>${esc(operator)}</strong>` : ''}, hébergé sur un serveur personnel situé en France. Pour toute question : <a href="/contact">formulaire de contact</a>.</p>

<h2>2. Jouer contre les bots : aucune donnée</h2>
<p>Sans compte, rien n'est envoyé au serveur : vos decks, vos préférences et les illustrations que vous ajoutez restent <strong>dans votre navigateur</strong>.</p>

<h2>3. Ce que nous enregistrons avec un compte</h2>
<table>
  <tr><th>Données</th><th>Pourquoi</th><th>Durée</th></tr>
  <tr><td><strong>Compte</strong> : identifiant Discord, pseudo, avatar, date de création du compte Discord (déduite de l'identifiant), dates de création et de dernière connexion au Dojo</td><td>Vous identifier, afficher votre nom à vos adversaires, réserver le mode classé aux comptes de plus de 7 jours (lutte contre les comptes jetables)</td><td>Jusqu'à la suppression du compte</td></tr>
  <tr><td><strong>Session</strong> : un jeton aléatoire (seule son empreinte est enregistrée)</td><td>Rester connecté</td><td>30 jours sans visite, ou jusqu'à la déconnexion</td></tr>
  <tr><td><strong>Parties</strong> : adversaire, decks utilisés, choix faits pendant la partie, résultat, dates</td><td>Historique, classement, rejouer une partie, vérifier une suspicion de triche</td><td>Tant que le service existe ; sans lien avec vous après la suppression de votre compte</td></tr>
  <tr><td><strong>Partie en cours</strong> : connexion, temps de réflexion</td><td>Faire fonctionner la partie</td><td>En mémoire seulement, effacée à la fin de la partie</td></tr>
  <tr><td><strong>Contact</strong> : catégorie, message, adresse e-mail si vous la donnez, votre compte si vous êtes connecté</td><td>Répondre à votre demande</td><td>Transmis par e-mail, <strong>pas conservé sur le serveur</strong> ; l'e-mail est gardé le temps de traiter la demande, un an au plus</td></tr>
  <tr><td><strong>Sécurité</strong> : adresse IP</td><td>Limiter les abus (nombre de connexions et de messages)</td><td>En mémoire, quelques minutes ; journaux techniques du serveur web : 14 jours au plus</td></tr>
</table>
<p>Nous ne recevons <strong>jamais</strong> votre adresse e-mail Discord, vos serveurs, vos messages ni vos amis : la connexion Discord ne demande que l'autorisation « identify ».</p>

<h2>4. Bases légales</h2>
<ul>
  <li>Compte, sessions, parties : <strong>l'exécution du service</strong> que vous demandez (article 6.1.b du RGPD).</li>
  <li>Sécurité, lutte contre la triche et les abus : notre <strong>intérêt légitime</strong> à protéger le service et ses joueurs (article 6.1.f).</li>
  <li>Contact : répondre à <strong>votre demande</strong> (article 6.1.b).</li>
</ul>

<h2>5. Qui y a accès</h2>
<p>Seul l'administrateur du Dojo. Vos adversaires voient votre pseudo et vos parties communes. <strong>Aucune donnée n'est vendue, partagée à des fins commerciales ou utilisée pour de la publicité.</strong></p>
<p>Prestataires : <strong>Discord</strong> pour la connexion (sa propre <a href="https://discord.com/privacy" rel="noopener">politique de confidentialité</a> s'applique) ; le <strong>fournisseur de messagerie</strong> qui achemine les messages du formulaire de contact.</p>

<h2>6. Cookies</h2>
<table>
  <tr><th>Cookie</th><th>Rôle</th><th>Durée</th></tr>
  <tr><td><code>dojo_session</code></td><td>Vous garder connecté</td><td>30 jours</td></tr>
  <tr><td><code>dojo_oauth</code></td><td>Sécuriser la connexion avec Discord</td><td>10 minutes</td></tr>
</table>
<p>Ces cookies sont <strong>strictement nécessaires</strong> au service : ils ne demandent pas de consentement. Aucun cookie de mesure d'audience ou de publicité.</p>

<h2>7. Vos droits</h2>
<p>Vous pouvez accéder à vos données, les faire rectifier ou effacer, vous opposer à un traitement, en demander la limitation ou la portabilité.</p>
<ul>
  <li><strong>Supprimer votre compte</strong> : immédiatement, depuis <a href="/compte">Mon compte</a>.</li>
  <li><strong>Votre pseudo et votre avatar</strong> viennent de Discord : ils sont mis à jour à chaque connexion.</li>
  <li><strong>Toute autre demande</strong> : par le <a href="/contact">formulaire de contact</a> (catégorie « Mes données »). Réponse sous un mois.</li>
  <li>Vous pouvez aussi adresser une réclamation à la CNIL : <a href="https://www.cnil.fr/fr/plaintes" rel="noopener">www.cnil.fr</a>.</li>
</ul>
<p>Pour retirer l'accès donné au Dojo sur Discord : Discord → Paramètres utilisateur → Applications autorisées → Dojo des Songes → Retirer l'autorisation.</p>

<h2>8. Âge</h2>
<p>Discord est réservé aux personnes d'au moins 13 ans (ou l'âge requis dans votre pays) ; le jeu entre joueurs suit donc la même règle.</p>

<h2>9. Modifications</h2>
<p>Cette politique peut évoluer ; la date de mise à jour figure en haut de la page.</p>
`);
}

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
