// Serveur PvP de bout en bout : connexion (factice et Discord simulé), sessions, salons,
// invitations, reprise sur un autre appareil, forfait, limites.
// node test/server.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import WebSocket from 'ws';
import { startServer } from '../server/index.mjs';
import { discordCreated } from '../server/db.mjs';
import { formatDeck } from '../src/deckio.js';
import { mulberry32 } from '../src/engine.js';
import { J1, randomDeck } from './decks.mjs';

let clock = Date.now();
const now = () => clock;
const srv = await startServer({ port: 0, dev: true, dbPath: ':memory:', log: null, sweepEvery: 3_600_000, now, lobby: { now } });
const BASE = srv.publicUrl, URL_WS = `${BASE.replace('http', 'ws')}/ws`, ORIGIN = BASE;
const DECK_A = formatDeck(J1), DECK_B = formatDeck(randomDeck(1001, 'FEU'));
const rnd = mulberry32(7);
const done = [];

const cookieOf = (res, name) => (res.headers.get('set-cookie') ?? '').match(new RegExp(`${name}=([^;,]*)`))?.[1] ?? null;

/** Connexion factice : renvoie l'en-tête Cookie de la session. */
async function login(name, base = BASE) {
  const r = await fetch(`${base}/auth/dev?name=${encodeURIComponent(name)}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const t = cookieOf(r, 'dojo_session');
  assert.ok(t, 'pas de cookie de session');
  return `dojo_session=${t}`;
}

/** Client de test : file de messages, attente d'un type donné. */
class Client {
  static async open(cookie, origin = ORIGIN) {
    const c = new Client();
    const headers = cookie ? { Cookie: cookie } : {};
    c.ws = new WebSocket(URL_WS, { headers, ...(origin ? { origin } : {}) });
    c.msgs = []; c.waiters = []; c.closed = null;
    c.ws.on('message', d => { c.msgs.push(JSON.parse(d)); c.wake(); });
    c.ws.on('close', code => { c.closed = code; c.wake(); });
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); c.ws.once('unexpected-response', (_, r) => rej(Object.assign(new Error('http'), { status: r.statusCode }))); });
    return c;
  }
  send(m) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  wake() { for (const w of [...this.waiters]) w(); }
  next(pred, ms = 5000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`attente dépassée : ${pred}`)), ms);
      const check = () => {
        const i = this.msgs.findIndex(pred);
        if (i >= 0) { const m = this.msgs[i]; this.msgs.splice(0, i + 1); clearTimeout(t); this.waiters = this.waiters.filter(w => w !== check); res(m); }
      };
      this.waiters.push(check); check();
    });
  }
  type(t, ms) { return this.next(m => m.type === t, ms); }
  untilClosed(ms = 3000) { return new Promise((res, rej) => { if (this.closed != null) return res(this.closed); const t = setTimeout(() => rej(new Error('pas fermé')), ms); this.ws.once('close', c => { clearTimeout(t); res(c); }); }); }
  close() { this.ws.close(); }
}

/** Premier message satisfaisant `pred` chez l'un des clients ; un seul message est consommé. */
function firstOf(clients, pred, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('attente dépassée (deux joueurs)')); }, ms);
    const cleanup = () => clients.forEach(c => { c.waiters = c.waiters.filter(w => w !== check); });
    const check = () => {
      for (const [pid, c] of clients.entries()) {
        const i = c.msgs.findIndex(pred);
        if (i >= 0) { const x = c.msgs[i]; c.msgs.splice(0, i + 1); clearTimeout(t); cleanup(); return res({ pid, x }); }
      }
    };
    clients.forEach(c => c.waiters.push(check));
    check();
  });
}

function pick(ask) {
  const ok = ask.options.filter(o => !o.blocked), pool = ok.length ? ok : ask.options;
  if (!ask.multi) return pool[Math.floor(rnd() * pool.length)].id;
  return ask.options.map(o => o.id).slice(0, ask.min);
}

const ALICE = await login('Alice'), BOB = await login('Bob'), CARL = await login('Carl');

/** Alice crée un salon, Bob le rejoint. */
async function pair(mode = 'casu', a = ALICE, b = BOB) {
  const ca = await Client.open(a), cb = await Client.open(b);
  await ca.type('hello'); await cb.type('hello');
  ca.send({ type: 'create', deckText: DECK_A, mode });
  const created = await ca.type('created');
  cb.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  await cb.type('joined');
  assert.equal((await ca.type('start')).you, 0);
  assert.equal((await cb.type('start')).you, 1);
  return { a: ca, b: cb, created };
}

// ── Accès au WebSocket ──────────────────────────────────────
await assert.rejects(Client.open(ALICE, 'https://evil.example'), e => e.status === 403);
await assert.rejects(Client.open(ALICE, null), e => e.status === 403);
await assert.rejects(Client.open(null), e => e.status === 401);
await assert.rejects(Client.open('dojo_session=faux'), e => e.status === 401);
done.push('origine étrangère, absence de session, session inconnue : refusés');

// ── Sessions ────────────────────────────────────────────────
{
  const me = await (await fetch(`${BASE}/auth/me`, { headers: { Cookie: ALICE } })).json();
  assert.equal(me.user.name, 'Alice');
  assert.equal((await fetch(`${BASE}/auth/me`)).status, 401);
  // POST sans origine du site : refusé (CSRF)
  assert.equal((await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: ALICE } })).status, 403);
  assert.equal((await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: ALICE, Origin: 'https://evil.example' } })).status, 403);
  // Déconnexion : la session ne marche plus, ni en HTTP ni en WebSocket
  const tmp = await login('Temp');
  assert.equal((await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: tmp, Origin: ORIGIN } })).status, 200);
  assert.equal((await fetch(`${BASE}/auth/me`, { headers: { Cookie: tmp } })).status, 401);
  await assert.rejects(Client.open(tmp), e => e.status === 401);
  // Déconnexion de tous les appareils
  const t1 = await login('Multi'), t2 = await login('Multi');
  assert.equal((await fetch(`${BASE}/auth/logout-all`, { method: 'POST', headers: { Cookie: t1, Origin: ORIGIN } })).status, 200);
  assert.equal((await fetch(`${BASE}/auth/me`, { headers: { Cookie: t2 } })).status, 401);
  // Expiration après 30 jours sans visite, prolongation à l'usage
  const old = await login('Ancien');
  clock += 20 * 86_400_000;
  assert.equal((await fetch(`${BASE}/auth/me`, { headers: { Cookie: old } })).status, 200); // prolongée
  clock += 25 * 86_400_000;
  assert.equal((await fetch(`${BASE}/auth/me`, { headers: { Cookie: old } })).status, 200);
  clock += 31 * 86_400_000;
  assert.equal((await fetch(`${BASE}/auth/me`, { headers: { Cookie: old } })).status, 401);
  clock = Date.now();
  // En base : uniquement le haché du jeton
  const rows = srv.db.raw.prepare('SELECT token_hash FROM sessions').all();
  assert.ok(rows.every(r => /^[0-9a-f]{64}$/.test(r.token_hash)));
  assert.ok(!rows.some(r => ALICE.includes(r.token_hash)));
  done.push('sessions : déconnexion, déconnexion de tous les appareils, expiration glissante, CSRF, jetons hachés');
}

// ── Contrôles des salons ────────────────────────────────────
{
  const c = await Client.open(CARL);
  await c.type('hello');
  c.send({ type: 'create', deckText: '1 001/FDS' });
  assert.equal((await c.type('error')).error, 'deck-invalid');
  // Clés héritées d'Object : ni Lieu ni carte (le Lieu « constructor » faisait planter l'écran adverse)
  for (const lieu of ['constructor', '__proto__', 'toString']) {
    c.send({ type: 'create', deck: { ...J1, lieu } });
    assert.equal((await c.type('error')).error, 'deck-invalid', `Lieu « ${lieu} » accepté`);
  }
  c.send({ type: 'create', deck: { ...J1, songe: [...J1.songe.slice(1), 'constructor'] } });
  assert.equal((await c.type('error')).error, 'deck-invalid');
  c.send({ type: 'join', invite: 'nimportequoi', deckText: DECK_A });
  assert.equal((await c.type('error')).error, 'invite-invalid');
  c.send({ type: 'answer', seq: 1, answer: 'o0' });
  assert.equal((await c.type('error')).error, 'not-playing');
  c.send({ type: 'quoi' });
  assert.equal((await c.type('error')).error, 'bad-message');
  // Un seul salon à la fois, pas sa propre invitation, annulation
  c.send({ type: 'create', deckText: DECK_A });
  const created = await c.type('created');
  c.send({ type: 'create', deckText: DECK_A });
  assert.equal((await c.type('error')).error, 'already-in-game');
  c.send({ type: 'join', invite: created.invite, deckText: DECK_A });
  assert.equal((await c.type('error')).error, 'own-invite');
  // Recharger la page (autre connexion) redonne le lien d'invitation
  const c2 = await Client.open(CARL);
  const w = await c2.type('waiting');
  assert.equal(w.invite, created.invite);
  await c.type('replaced');
  c2.send({ type: 'cancel' });
  await c2.type('cancelled');
  const b = await Client.open(BOB);
  b.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  assert.equal((await b.type('error')).error, 'invite-invalid');
  // Nombre de salons par heure
  for (let i = 0; i < 9; i++) { c2.send({ type: 'create', deckText: DECK_A }); await c2.type('created'); c2.send({ type: 'cancel' }); await c2.type('cancelled'); }
  c2.send({ type: 'create', deckText: DECK_A });
  assert.equal((await c2.type('error')).error, 'too-many-rooms');
  clock += 61 * 60_000; srv.lobby.sweep();
  c2.send({ type: 'create', deckText: DECK_A });
  await c2.type('created');
  c2.send({ type: 'cancel' }); await c2.type('cancelled');
  clock = Date.now();
  c2.close(); b.close();
  done.push('deck et invitation invalides, un salon à la fois, propre invitation, annulation, 10 salons par heure');
}

// ── Partie complète, invitation à usage unique, autre appareil ─
{
  const { a, b, created } = await pair();
  const c = await Client.open(CARL);
  c.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  assert.equal((await c.type('error')).error, 'invite-invalid');
  c.close();

  const cookies = { 0: ALICE, 1: BOB };
  let players = { 0: a, 1: b }, asks = 0, resumed = false, replaced = false;
  for (;;) {
    const m = await firstOf([players[0], players[1]], x => x.type === 'ask' || x.type === 'over');
    if (m.x.type === 'over') {
      const o2 = await players[1 - m.pid].type('over');
      for (const o of [m.x, o2]) {
        assert.ok(o.result && o.result.scores.length === 2);
        assert.equal(createHash('sha256').update(o.serverSeed).digest('hex'), o.commit, 'graine révélée ≠ engagement');
      }
      break;
    }
    asks++;
    const { pid, x: ask } = m;
    if (asks === 8 && !resumed) {
      // Coupure, puis retour avec le même compte : la question en attente revient
      resumed = true;
      players[pid].close();
      await players[pid].untilClosed();
      const other = players[1 - pid];
      assert.equal((await other.type('opponent')).connected, false);
      const back = await Client.open(cookies[pid]);
      assert.equal((await back.type('start')).resumed, true);
      await back.type('state');
      const again = await back.type('ask');
      assert.equal(again.seq, ask.seq);
      assert.deepEqual(again.options, ask.options);
      assert.equal((await other.type('opponent')).connected, true);
      players[pid] = back;
      back.send({ type: 'answer', seq: again.seq, answer: pick(again) });
      continue;
    }
    if (asks === 16 && !replaced) {
      // Même compte sur un autre appareil (nouvelle session) : l'ancienne connexion est remplacée
      replaced = true;
      const phone = await login(pid === 0 ? 'Alice' : 'Bob');
      const old = players[pid], fresh = await Client.open(phone);
      await old.type('replaced');
      assert.equal(await old.untilClosed(), 4000);
      const again = await fresh.type('ask');
      assert.equal(again.seq, ask.seq);
      players[pid] = fresh;
      fresh.send({ type: 'answer', seq: again.seq, answer: pick(again) });
      continue;
    }
    if (asks % 7 === 0) {
      players[1 - pid].send({ type: 'answer', seq: ask.seq, answer: ask.multi ? [] : 'o0' });
      const e = await players[1 - pid].type('error');
      assert.ok(['no-pending', 'stale', 'bad-option', 'bad-count'].includes(e.error));
    }
    players[pid].send({ type: 'answer', seq: ask.seq, answer: pick(ask) });
  }
  assert.ok(resumed && replaced && asks > 16, `${asks} questions`);
  // Partie finie : on peut en recréer une tout de suite
  players[0].send({ type: 'create', deckText: DECK_A });
  await players[0].type('created');
  players[0].send({ type: 'cancel' }); await players[0].type('cancelled');
  done.push(`partie complète (${asks} questions), invitation à usage unique, reprise après coupure, autre appareil, mélange vérifié`);
  for (const p of Object.values(players)) p.close();
}

// ── Forfait après le délai de grâce ─────────────────────────
{
  const { a, b } = await pair('open');
  b.close();
  await b.untilClosed();
  await a.type('opponent');
  clock += 2 * 60_000; srv.lobby.sweep();
  assert.equal(srv.lobby.stats().playing, 1, 'forfait trop tôt');
  clock += 2 * 60_000; srv.lobby.sweep();
  const over = await a.type('over');
  assert.equal(over.forfeit, 1); assert.equal(over.winner, 0);
  // Bob revient : il apprend le résultat
  const back = await Client.open(BOB);
  assert.equal((await back.type('over')).forfeit, 1);
  clock += 10 * 60_000; srv.lobby.sweep();
  a.close(); back.close();
  done.push('forfait après 3 min, résultat transmis au retour du joueur');
}

// ── Invitation expirée ──────────────────────────────────────
{
  const a = await Client.open(ALICE);
  a.send({ type: 'create', deckText: DECK_A });
  const created = await a.type('created');
  clock += 16 * 60_000; srv.lobby.sweep();
  assert.equal((await a.type('error')).error, 'invite-expired');
  const b = await Client.open(BOB);
  b.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  assert.equal((await b.type('error')).error, 'invite-invalid');
  a.close(); b.close();
  done.push('invitation expirée après 15 min');
}
assert.equal(srv.lobby.rooms.size, 0, 'salons non nettoyés');
assert.equal(srv.lobby.byUser.size, 0, 'comptes encore rattachés');

// ── Limites : débit, taille, JSON ───────────────────────────
{
  const c = await Client.open(CARL);
  for (let i = 0; i < 100; i++) c.send({ type: 'quoi' });
  assert.equal(await c.untilClosed(), 1008);
  const d = await Client.open(CARL);
  d.send('x'.repeat(20_000));
  assert.equal(await d.untilClosed(), 1009);
  const e = await Client.open(CARL);
  e.send('{pas du json');
  assert.equal(await e.untilClosed(), 1008);
  done.push('débit, taille et JSON invalide : connexion fermée');
}
await srv.close();

// ── Discord (simulé) et mode production ─────────────────────
{
  const DID = '80351110224678912';
  let tokenCalls = 0;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      if (req.url === '/api/oauth2/token' && req.method === 'POST') {
        tokenCalls++;
        const p = new URLSearchParams(body);
        const ok = p.get('code') === 'bon-code' && p.get('client_secret') === 'secret' && p.get('grant_type') === 'authorization_code';
        res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(ok ? { access_token: 'acces', token_type: 'Bearer' } : { error: 'invalid_grant' }));
      }
      if (req.url === '/api/users/@me' && req.headers.authorization === 'Bearer acces') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: DID, username: 'nelly', global_name: 'Nelly <b>', avatar: 'a_1234abcd' }));
      }
      res.writeHead(401); res.end();
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const F = `http://127.0.0.1:${fake.address().port}`;
  const prod = await startServer({ port: 0, dev: false, dbPath: ':memory:', log: null, discord: { clientId: 'cid', clientSecret: 'secret', api: `${F}/api`, authorize: `${F}/authorize` } });
  const P = prod.publicUrl;
  // Pas de connexion factice ni de client de test hors DEV
  assert.equal((await fetch(`${P}/auth/dev?name=x`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${P}/`)).status, 404);
  assert.equal((await fetch(`${P}/auth/me`)).status, 401);

  const start = async () => {
    const r = await fetch(`${P}/auth/discord`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get('location'));
    return { loc, state: loc.searchParams.get('state'), cookie: `dojo_oauth=${cookieOf(r, 'dojo_oauth')}` };
  };
  const cb = (q, cookie) => fetch(`${P}/auth/discord/callback?${new URLSearchParams(q)}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });

  const s1 = await start();
  assert.equal(s1.loc.origin + s1.loc.pathname, `${F}/authorize`);
  assert.equal(s1.loc.searchParams.get('scope'), 'identify');
  assert.equal(s1.loc.searchParams.get('redirect_uri'), `${P}/auth/discord/callback`);
  assert.equal(s1.cookie, `dojo_oauth=${s1.state}`);
  // Lien de retour sans le cookie d'état (volé et ouvert ailleurs) : refusé, et l'état est consommé
  assert.equal((await cb({ code: 'bon-code', state: s1.state })).status, 400);
  assert.equal((await cb({ code: 'bon-code', state: s1.state }, s1.cookie)).status, 400);
  // État inconnu
  const s2 = await start();
  assert.equal((await cb({ code: 'bon-code', state: 'inconnu' }, s2.cookie)).status, 400);
  // Code refusé par Discord
  const s3 = await start();
  assert.equal((await cb({ code: 'mauvais-code', state: s3.state }, s3.cookie)).status, 502);
  assert.equal(tokenCalls, 1);
  // Bon parcours
  const s4 = await start();
  const ok = await cb({ code: 'bon-code', state: s4.state }, s4.cookie);
  assert.equal(ok.status, 302);
  const session = `dojo_session=${cookieOf(ok, 'dojo_session')}`;
  const me = (await (await fetch(`${P}/auth/me`, { headers: { Cookie: session } })).json()).user;
  assert.equal(me.name, 'Nelly <b>'); // stocké tel quel, échappé à l'affichage
  assert.equal(me.discordCreated, discordCreated(DID));
  assert.equal(new Date(me.discordCreated).getUTCFullYear(), 2015);
  assert.equal(me.dev, false);
  // Même état rejoué : refusé
  assert.equal((await cb({ code: 'bon-code', state: s4.state }, s4.cookie)).status, 400);
  // La session Discord ouvre le WebSocket
  const ws = new WebSocket(`${P.replace('http', 'ws')}/ws`, { headers: { Cookie: session }, origin: P });
  const hello = await new Promise((res, rej) => { ws.once('message', d => res(JSON.parse(d))); ws.once('error', rej); });
  assert.equal(hello.user.name, 'Nelly <b>');
  ws.close();
  // Nouvelle connexion du même compte Discord : pas de doublon
  const s5 = await start();
  assert.equal((await cb({ code: 'bon-code', state: s5.state }, s5.cookie)).status, 302);
  assert.equal(prod.db.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  // DEV interdit hors local
  await assert.rejects(startServer({ port: 0, dev: true, host: '0.0.0.0', dbPath: ':memory:', log: null }), /DEV=1/);
  await assert.rejects(startServer({ port: 0, dev: true, publicUrl: 'https://dreamland.harruis.fr', dbPath: ':memory:', log: null }), /DEV=1/);
  await prod.close();
  fake.close();
  done.push('Discord simulé : état lié au navigateur et à usage unique, code refusé, compte créé sans doublon, âge du compte, WebSocket');
  done.push('production : ni connexion factice ni client de test ; DEV refusé hors local');
}

console.log('OK serveur :\n - ' + done.join('\n - '));
