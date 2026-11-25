// Serveur PvP de bout en bout : salons, invitations, reprise, forfait, limites.
// node test/server.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { startServer } from '../server/index.mjs';
import { formatDeck } from '../src/deckio.js';
import { mulberry32 } from '../src/engine.js';
import { J1, randomDeck } from './decks.mjs';

let clock = Date.now();
const srv = await startServer({ port: 0, dev: true, log: null, sweepEvery: 3_600_000, lobby: { now: () => clock } });
const URL = `ws://127.0.0.1:${srv.port}/ws`, ORIGIN = `http://127.0.0.1:${srv.port}`;
const DECK_A = formatDeck(J1), DECK_B = formatDeck(randomDeck(1001, 'FEU'));
const rnd = mulberry32(7);
const done = [];

/** Client de test : file de messages, attente d'un type donné. */
class Client {
  static async open(origin = ORIGIN) {
    const c = new Client();
    c.ws = new WebSocket(URL, origin ? { origin } : {});
    c.msgs = []; c.waiters = []; c.closed = null;
    c.ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); c.wake(); });
    c.ws.on('close', code => { c.closed = code; c.wake(); });
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); c.ws.once('unexpected-response', (_, r) => rej(Object.assign(new Error('http'), { status: r.statusCode }))); });
    return c;
  }
  send(m) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  wake() { for (const w of [...this.waiters]) w(); }
  /** Prochain message (depuis le dernier lu) qui satisfait `pred`. */
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

/** Réponse aléatoire valide. */
function pick(ask) {
  const ok = ask.options.filter(o => !o.blocked), pool = ok.length ? ok : ask.options;
  if (!ask.multi) return pool[Math.floor(rnd() * pool.length)].id;
  return ask.options.map(o => o.id).slice(0, ask.min);
}

/** Crée un salon et le fait rejoindre : renvoie [hôte, invité, jetons]. */
async function pair(mode = 'casu') {
  const a = await Client.open(), b = await Client.open();
  a.send({ type: 'create', name: 'Alice', deckText: DECK_A, mode });
  const created = await a.type('created');
  b.send({ type: 'join', invite: created.invite, name: 'Bob', deckText: DECK_B });
  const joined = await b.type('joined');
  assert.equal((await a.type('start')).you, 0);
  assert.equal((await b.type('start')).you, 1);
  return { a, b, created, joined };
}

// ── Origine et santé ────────────────────────────────────────
await assert.rejects(Client.open('https://evil.example'), e => e.status === 403);
await assert.rejects(Client.open(null), e => e.status === 403);
done.push('origine refusée');

// ── Contrôles à la création ─────────────────────────────────
{
  const c = await Client.open();
  c.send({ type: 'create', name: 'X', deckText: '1 001/FDS' });
  assert.equal((await c.type('error')).error, 'deck-invalid');
  c.send({ type: 'create', name: '\u0000\u0007', deckText: DECK_A });
  assert.equal((await c.type('error')).error, 'bad-name');
  c.send({ type: 'join', invite: 'nimportequoi', name: 'X', deckText: DECK_A });
  assert.equal((await c.type('error')).error, 'invite-invalid');
  c.send({ type: 'answer', seq: 1, answer: 'o0' });
  assert.equal((await c.type('error')).error, 'not-playing');
  c.send({ type: 'resume', token: 'faux' });
  assert.equal((await c.type('error')).error, 'token-invalid');
  c.send({ type: 'quoi' });
  assert.equal((await c.type('error')).error, 'bad-message');
  c.close();
  done.push('deck, pseudo, invitation, jeton et message invalides refusés');
}

// ── Partie complète, invitation à usage unique, reprise ─────
{
  const { a, b, created, joined } = await pair();
  const c = await Client.open();
  c.send({ type: 'join', invite: created.invite, name: 'Carl', deckText: DECK_B });
  assert.equal((await c.type('error')).error, 'invite-invalid');
  c.close();
  done.push('invitation à usage unique');

  let players = { 0: a, 1: b }, asks = 0, resumed = false, replaced = false;
  const tokens = { 0: created.token, 1: joined.token };
  // Les deux joueurs répondent tour à tour jusqu'à la fin
  for (;;) {
    const m = await firstOf([players[0], players[1]], x => x.type === 'ask' || x.type === 'over');
    if (m.x.type === 'over') {
      const other = players[1 - m.pid];
      const o2 = await other.type('over');
      for (const o of [m.x, o2]) {
        assert.ok(o.result && o.result.scores.length === 2);
        assert.equal(createHash('sha256').update(o.serverSeed).digest('hex'), o.commit, 'graine révélée ≠ engagement');
      }
      break;
    }
    asks++;
    const { pid, x: ask } = m;
    if (asks === 8 && !resumed) {
      // Bob perd la connexion puis revient : même question renvoyée
      resumed = true;
      players[pid].close();
      await players[pid].untilClosed();
      const other = players[1 - pid];
      assert.equal((await other.type('opponent')).connected, false);
      const back = await Client.open();
      back.send({ type: 'resume', token: tokens[pid] });
      assert.equal((await back.type('start')).resumed, true);
      await back.type('state');
      const again = await back.type('ask');
      assert.equal(again.seq, ask.seq);
      assert.deepEqual(again.options, ask.options);
      assert.equal((await other.type('opponent')).connected, true);
      players[pid] = back;
      players[pid].send({ type: 'answer', seq: again.seq, answer: pick(again) });
      continue;
    }
    if (asks === 16 && !replaced) {
      // Même joueur ouvert ailleurs : l'ancienne connexion est remplacée et fermée
      replaced = true;
      const old = players[pid], fresh = await Client.open();
      fresh.send({ type: 'resume', token: tokens[pid] });
      await old.type('replaced');
      assert.equal(await old.untilClosed(), 4000);
      const again = await fresh.type('ask');
      assert.equal(again.seq, ask.seq);
      players[pid] = fresh;
      fresh.send({ type: 'answer', seq: again.seq, answer: pick(again) });
      continue;
    }
    // L'adversaire ne peut pas répondre à sa place
    if (asks % 7 === 0) {
      players[1 - pid].send({ type: 'answer', seq: ask.seq, answer: ask.multi ? [] : 'o0' });
      const e = await players[1 - pid].type('error');
      assert.ok(['no-pending', 'stale', 'bad-option', 'bad-count'].includes(e.error));
    }
    players[pid].send({ type: 'answer', seq: ask.seq, answer: pick(ask) });
  }
  assert.ok(resumed && replaced && asks > 16, `${asks} questions`);
  done.push(`partie complète (${asks} questions), reprise après coupure, connexion remplacée, mélange vérifié`);
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
  clock += 10 * 60_000; srv.lobby.sweep();
  a.close();
  done.push('forfait après 3 min de déconnexion');
}

// ── Invitation expirée ──────────────────────────────────────
{
  const a = await Client.open();
  a.send({ type: 'create', name: 'Alice', deckText: DECK_A });
  const created = await a.type('created');
  clock += 16 * 60_000; srv.lobby.sweep();
  assert.equal((await a.type('error')).error, 'invite-expired');
  const b = await Client.open();
  b.send({ type: 'join', invite: created.invite, name: 'Bob', deckText: DECK_B });
  assert.equal((await b.type('error')).error, 'invite-invalid');
  a.close(); b.close();
  done.push('invitation expirée après 15 min');
}
assert.equal(srv.lobby.rooms.size, 0, 'salons non nettoyés');
assert.equal(srv.lobby.seats.size, 0, 'jetons non nettoyés');
done.push('salons et jetons nettoyés');

// ── Limites : débit, taille, JSON ───────────────────────────
{
  const c = await Client.open();
  for (let i = 0; i < 100; i++) c.send({ type: 'quoi' });
  assert.equal(await c.untilClosed(), 1008);
  const d = await Client.open();
  d.send('x'.repeat(20_000));
  assert.equal(await d.untilClosed(), 1009);
  const e = await Client.open();
  e.send('{pas du json');
  assert.equal(await e.untilClosed(), 1008);
  done.push('débit, taille et JSON invalide : connexion fermée');
}

await srv.close();
console.log('OK serveur :\n - ' + done.join('\n - '));
