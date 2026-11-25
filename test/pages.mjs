// Pages légales, formulaire de contact, « Mon compte » : déconnexion et suppression du compte.
// node test/pages.mjs
import assert from 'node:assert/strict';
import { startServer } from '../server/index.mjs';
import { headerSafe } from '../server/mail.mjs';
import { formatDeck } from '../src/deckio.js';
import { J1, randomDeck } from './decks.mjs';
import { login, Client, firstOf, pick } from './helpers.mjs';

const SECRET_TO = 'destinataire-secret@example.org';
const sent = [];
let failMail = false;
const mailer = { available: true, async send(m) { if (failMail) throw new Error('SMTP en panne'); sent.push(m); } };
const srv = await startServer({ port: 0, dev: true, dbPath: ':memory:', log: null, sweepEvery: 3_600_000, mailer, mailEnv: { CONTACT_TO: SECRET_TO }, operator: 'Théault', lobby: { counterDelay: [0, 0] } });
const B = srv.publicUrl;
const done = [];
const get = (path, cookie) => fetch(`${B}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
const post = (path, fields, { cookie, origin = B } = {}) => fetch(`${B}${path}`, {
  method: 'POST', redirect: 'manual', body: new URLSearchParams(fields),
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
});

// ── Pages légales ───────────────────────────────────────────
{
  const terms = await get('/conditions'), privacy = await get('/confidentialite');
  assert.equal(terms.status, 200); assert.equal(privacy.status, 200);
  const t = await terms.text(), p = await privacy.text();
  assert.match(t, /non officiel/); assert.match(t, /Un seul compte par personne/);
  assert.match(p, /identify/); assert.match(p, /CNIL/); assert.match(p, /dojo_session/); assert.match(p, /Théault/);
  assert.match(terms.headers.get('content-security-policy'), /default-src 'none'/);
  for (const page of ['/conditions', '/confidentialite', '/contact', '/compte']) assert.ok(!(await (await get(page)).text()).includes(SECRET_TO), `adresse dévoilée sur ${page}`);
  done.push('conditions et confidentialité servies, CSP stricte, adresse de contact jamais affichée');
}

// ── Contact ─────────────────────────────────────────────────
{
  const ok = { category: 'donnees', email: 'joueur@example.com', message: 'Bonjour, je voudrais une copie de mes données.' };
  assert.equal((await post('/contact', ok, { origin: null })).status, 403);
  assert.equal((await post('/contact', ok, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/contact', { ...ok, message: 'court' })).status, 400);
  assert.equal((await post('/contact', { ...ok, email: 'pas-une-adresse' })).status, 400);
  assert.equal((await post('/contact', { ...ok, email: 'a@b.com\r\nBcc: victime@example.com' })).status, 400);
  assert.equal((await post('/contact', { ...ok, message: 'x'.repeat(4001) })).status, 400);
  assert.equal(sent.length, 0);
  // Robot (champ piège rempli) : réponse normale, rien d'envoyé
  assert.equal((await post('/contact', { ...ok, website: 'http://spam' })).status, 200);
  assert.equal(sent.length, 0);
  // Message valide, connecté : compte joint, réponse à l'adresse donnée
  const alice = await login(B, 'Alice');
  const r = await post('/contact', ok, { cookie: alice });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Message envoyé/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyTo, 'joueur@example.com');
  assert.match(sent[0].subject, /Mes données/);
  assert.match(sent[0].text, /Compte : Alice/);
  // Sans adresse : envoyé quand même
  await post('/contact', { category: 'autre', message: 'Un message sans adresse de réponse.' });
  assert.equal(sent[1].replyTo, undefined);
  // Panne d'envoi : message clair
  failMail = true;
  assert.equal((await post('/contact', ok)).status, 503);
  failMail = false;
  // 5 messages par heure et par IP (3 déjà comptés)
  for (let i = 0; i < 2; i++) assert.equal((await post('/contact', ok)).status, 200);
  const limited = await post('/contact', ok);
  assert.equal(limited.status, 400); assert.match(await limited.text(), /Trop de messages/);
  assert.equal(headerSafe('a\r\nBcc: x'), 'a Bcc: x');
  done.push('contact : origine, longueur, adresse invalide ou injection d\'en-têtes refusées, champ piège, compte joint, 5 messages/heure, panne SMTP');
}

// ── Mon compte ──────────────────────────────────────────────
const DECK_A = formatDeck(J1), DECK_B = formatDeck(randomDeck(1001, 'FEU'));
{
  assert.match(await (await get('/compte')).text(), /pas connecté/);
  const bob = await login(B, 'Bob');
  const page = await (await get('/compte', bob)).text();
  assert.match(page, /Connecté en tant que <strong>Bob/);
  assert.match(page, /supprimé immédiatement/); assert.match(page, /définitif/); assert.match(page, /Joueur supprimé/);

  // Déconnexion de tous les appareils : sessions fermées, WebSocket fermé
  const bob2 = await login(B, 'Bob');
  const ws = await Client.open(B, bob2);
  await ws.type('hello');
  assert.equal((await post('/compte/deconnexion-partout', {}, { cookie: bob, origin: null })).status, 403);
  const r = await post('/compte/deconnexion-partout', {}, { cookie: bob });
  assert.equal(r.status, 303);
  assert.equal(await ws.untilClosed(), 4001);
  assert.equal((await get('/auth/me', bob2)).status, 401);
  done.push('mon compte : page, déconnexion de tous les appareils (WebSocket fermé)');
}

// ── Suppression du compte pendant une partie ────────────────
{
  const carl = await login(B, 'Carl'), dana = await login(B, 'Dana');
  const carlId = (await (await get('/auth/me', carl)).json()).user.id;
  // Une partie terminée pour vérifier l'anonymisation
  const a = await Client.open(B, carl), d = await Client.open(B, dana);
  a.send({ type: 'create', deckText: DECK_A });
  const created = await a.type('created');
  d.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  await a.type('start'); await d.type('start');
  for (;;) {
    const m = await firstOf([a, d], x => x.type === 'ask' || x.type === 'over');
    if (m.x.type === 'over') { await [a, d][1 - m.pid].type('over'); break; }
    [a, d][m.pid].send({ type: 'answer', seq: m.x.seq, answer: pick(m.x) });
  }
  // Seconde partie, en cours au moment de la suppression
  a.send({ type: 'create', deckText: DECK_A });
  const c2 = await a.type('created');
  d.send({ type: 'join', invite: c2.invite, deckText: DECK_B });
  await d.type('start');
  // Sans confirmation : refusé
  assert.equal((await post('/compte/supprimer', {}, { cookie: carl })).status, 400);
  assert.ok((await get('/auth/me', carl)).status === 200);
  const r = await post('/compte/supprimer', { confirm: 'oui' }, { cookie: carl });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  // L'adversaire gagne par abandon, la connexion de Carl est fermée
  const over = await d.type('over');
  assert.equal(over.reason, 'abandon'); assert.equal(over.winner, 1);
  assert.equal(await a.untilClosed(), 4001);
  // Plus de compte ni de session ; parties gardées sans lien avec lui
  assert.equal((await get('/auth/me', carl)).status, 401);
  const db = srv.db.raw;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(carlId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(carlId).n, 0);
  const games = db.prepare('SELECT * FROM games').all();
  assert.equal(games.length, 2);
  assert.ok(games.every(g => g.p0 === null && g.p1 !== null), 'parties non anonymisées');
  assert.ok(games.every(g => !g.replay.includes('"name"')), 'nom de deck conservé');
  assert.equal(games.find(g => g.outcome === 'forfeit').winner, 1);
  assert.match(await (await get('/compte?ok=supprime')).text(), /a été supprimé/);
  // Reconnexion plus tard : nouveau compte vierge
  const again = await login(B, 'Carl');
  assert.notEqual((await (await get('/auth/me', again)).json()).user.id, carlId);
  d.close();
  done.push('suppression : confirmation exigée, partie en cours perdue par abandon, connexions fermées, compte et sessions effacés, parties anonymisées, nouveau compte vierge ensuite');
}
// Salon en attente fermé à la suppression
{
  const eve = await login(B, 'Eve');
  const e = await Client.open(B, eve);
  e.send({ type: 'create', deckText: DECK_A });
  const created = await e.type('created');
  await post('/compte/supprimer', { confirm: 'oui' }, { cookie: eve });
  const f = await Client.open(B, await login(B, 'Fred'));
  f.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  assert.equal((await f.type('error')).error, 'invite-invalid');
  f.close();
  done.push('suppression : salon en attente fermé');
}

await srv.close();
console.log('OK pages :\n - ' + done.join('\n - '));
