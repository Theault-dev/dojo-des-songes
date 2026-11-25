// ─────────────────────────────────────────────────────────────
// Textes légaux : conditions d'utilisation et politique de confidentialité.
// Sans dépendance : servis par le serveur de jeu (pages.mjs) et générés en
// pages statiques par build.mjs (dist/conditions/, dist/confidentialite/).
// `online` : faux tant que le jeu en ligne n'est pas ouvert (textes « à venir »,
// sans liens vers /contact et /compte, qui n'existent pas encore).
// ─────────────────────────────────────────────────────────────

export const UPDATED = '25 novembre 2026';
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Liens vers le contact et le compte, ou leur mention « à venir ». */
function links(online) {
  return online
    ? { contact: '<a href="/contact">formulaire de contact</a>', account: '<a href="/compte">Mon compte</a>' }
    : { contact: 'formulaire de contact (il ouvrira avec le jeu en ligne)', account: 'la page « Mon compte » (à l\'ouverture du jeu en ligne)' };
}

export function layout(title, body, { online = true } = {}) {
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
<header><strong>Dojo des Songes</strong><a href="/">Jouer</a>${online ? '<a href="/compte">Mon compte</a><a href="/contact">Contact</a>' : ''}</header>
<main>${body}</main>
<footer><a href="/conditions">Conditions d'utilisation</a><a href="/confidentialite">Politique de confidentialité</a>${online ? '<a href="/contact">Contact</a>' : ''}</footer>
</body></html>`;
}

// ── Textes ───────────────────────────────────────────────────
export function terms({ online = true } = {}) {
  const { contact, account } = links(online);
  return layout('Conditions d\'utilisation', `
<h1>Conditions d'utilisation</h1>
<p class="muted">Dernière mise à jour : ${UPDATED}</p>

<h2>1. Le service</h2>
<p>Le Dojo des Songes est un simulateur <strong>non officiel</strong> du jeu de cartes Dreamland TCG, réalisé par un fan, gratuit et sans publicité. Il n'est ni affilié, ni approuvé par les éditeurs de Dreamland. Les noms, textes et illustrations des cartes appartiennent à leurs ayants droit.</p>
${online ? `<p>On peut y jouer contre des bots (sans compte, tout reste dans votre navigateur) ou contre d'autres joueurs (avec un compte).</p>`
  : `<p>On peut y jouer contre des bots, sans compte : tout reste dans votre navigateur. <strong>Le jeu contre d'autres joueurs arrive bientôt</strong> ; il demandera un compte, et les règles ci-dessous s'y appliqueront.</p>`}

<h2>2. Votre compte</h2>
<ul>
  <li>Le jeu contre d'autres joueurs demande de se connecter avec un compte Discord. Le Dojo ne reçoit que votre identifiant Discord, votre pseudo, votre avatar et la date de création de votre compte (voir la <a href="/confidentialite">politique de confidentialité</a>).</li>
  <li><strong>Un seul compte par personne.</strong> Pour le mode classé, le compte Discord doit exister depuis au moins 7 jours.</li>
  <li>Vous pouvez supprimer votre compte à tout moment depuis ${account}.</li>
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
<p>Une faille de sécurité découverte ? Merci de la signaler par le ${contact} plutôt que de l'exploiter.</p>

<h2>4. Sanctions</h2>
<p>En cas de manquement, nous pouvons annuler des résultats, retirer un classement, suspendre ou supprimer un compte, selon la gravité. Vous pouvez contester une décision par le ${contact}.</p>

<h2>5. Disponibilité</h2>
<p>Le Dojo est un projet personnel hébergé sur un petit serveur : il est fourni <strong>tel quel, sans garantie</strong> de disponibilité ni d'absence d'erreur. Une partie en cours peut être interrompue (panne, coupure, mise à jour des règles) ; elle est alors annulée sans effet sur le classement. Dans les limites permises par la loi, nous ne pouvons être tenus responsables d'un dommage lié à l'utilisation du service.</p>

<h2>6. Modifications</h2>
<p>Ces conditions peuvent évoluer ; la date de mise à jour figure en haut de la page. En cas de changement important, il sera signalé sur le site. Ces conditions sont soumises au droit français.</p>
`, { online });
}

export function privacy({ operator = null, online = true } = {}) {
  const { contact, account } = links(online);
  return layout('Politique de confidentialité', `
<h1>Politique de confidentialité</h1>
<p class="muted">Dernière mise à jour : ${UPDATED}</p>
<p>Cette page explique quelles données le Dojo des Songes enregistre, pourquoi, combien de temps, et comment exercer vos droits (RGPD).</p>

<h2>1. Responsable</h2>
<p>Le Dojo des Songes est un projet personnel et non commercial${operator ? `, édité par <strong>${esc(operator)}</strong>` : ''}, hébergé sur un serveur personnel situé en France. Pour toute question : ${contact}.</p>

<h2>2. Jouer contre les bots : aucune donnée</h2>
<p>Sans compte, rien n'est envoyé au serveur : vos decks, vos préférences et les illustrations que vous ajoutez restent <strong>dans votre navigateur</strong>.</p>

<h2>3. Ce que nous enregistrons avec un compte</h2>
${online ? '' : '<p class="box"><strong>Le jeu en ligne n\'est pas encore ouvert : aucune de ces données n\'est collectée aujourd\'hui.</strong> Ce tableau décrit ce qui le sera à son ouverture ; seuls les journaux techniques du serveur web (dernière ligne) existent déjà.</p>'}
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
  <li><strong>Supprimer votre compte</strong> : immédiatement, depuis ${account}.</li>
  <li><strong>Votre pseudo et votre avatar</strong> viennent de Discord : ils sont mis à jour à chaque connexion.</li>
  <li><strong>Toute autre demande</strong> : par le ${contact} (catégorie « Mes données »). Réponse sous un mois.</li>
  <li>Vous pouvez aussi adresser une réclamation à la CNIL : <a href="https://www.cnil.fr/fr/plaintes" rel="noopener">www.cnil.fr</a>.</li>
</ul>
<p>Pour retirer l'accès donné au Dojo sur Discord : Discord → Paramètres utilisateur → Applications autorisées → Dojo des Songes → Retirer l'autorisation.</p>

<h2>8. Âge</h2>
<p>Discord est réservé aux personnes d'au moins 13 ans (ou l'âge requis dans votre pays) ; le jeu entre joueurs suit donc la même règle.</p>

<h2>9. Modifications</h2>
<p>Cette politique peut évoluer ; la date de mise à jour figure en haut de la page.</p>
`, { online });
}

/** Pages statiques : chemin dans dist/ → HTML. */
export function staticPages({ online = true, operator = null } = {}) {
  return {
    'conditions/index.html': terms({ online }),
    'confidentialite/index.html': privacy({ online, operator }),
  };
}
