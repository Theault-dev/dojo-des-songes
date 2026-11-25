// Étape 4 : pendule, temps marqué sans contre possible, arrêt et reprise du serveur, parties enregistrées.
// node test/lifecycle.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../server/index.mjs';
import { createRemoteGame } from '../src/pvp/remote.js';
import { Game, mulberry32 } from '../src/engine.js';
import { formatDeck } from '../src/deckio.js';
import { J1, randomDeck } from './decks.mjs';
import { login, Client, firstOf, pick } from './helpers.mjs';

const DECK_A = formatDeck(J1), DECK_B = formatDeck(randomDeck(1001, 'FEU'));
const rnd = mulberry32(11);
const done = [];
const dir = mkdtempSync(join(tmpdir(), 'dojo-test-'));
let clock = Date.now();
const now = () => clock;
const serverOpts = (extra = {}) => ({
  port: 0, dev: true, log: null, sweepEvery: 3_600_000, now, dbPath: join(dir, 'dojo.db'),
  lobby: { now, counterDelay: [0, 0], ...extra },
});

async function pair(base, ca, cb) {
  const a = await Client.open(base, ca), b = await Client.open(base, cb);
  a.send({ type: 'create', deckText: DECK_A });
  const created = await a.type('created');
  b.send({ type: 'join', invite: created.invite, deckText: DECK_B });
  await a.type('start'); await b.type('start');
  return [a, b];
}

/** Joue `n` réponses (ou jusqu'à la fin) ; renvoie la question en attente, s'il y en a une. */
async function play(players, n) {
  for (let i = 0; i < n; i++) {
    const m = await firstOf(players, x => x.type === 'ask' || x.type === 'over');
    if (m.x.type === 'over') return { over: m.x, pid: m.pid };
    if (i === n - 1) return { ask: m.x, pid: m.pid };
    players[m.pid].send({ type: 'answer', seq: m.x.seq, answer: pick(m.x, rnd) });
  }
}

// ── Temps marqué sans contre possible ───────────────────────
{
  let delays = 0;
  const answer = (rg, pid, m) => setImmediate(() => rg.answer(pid, { seq: m.seq, answer: pick(m, rnd) }));
  let rg;
  rg = createRemoteGame({
    decks: [J1, randomDeck(1001, 'FEU')], names: ['A', 'B'], seed: 5,
    send: (pid, m) => m.type === 'ask' && answer(rg, pid, m),
    counterDelay: () => { delays++; return 1; },
  });
  await rg.run();
  assert.ok(delays > 0, 'aucune fenêtre de contre sans contre possible');
  // Rejeu de cette partie : aucune pause, aucun envoi
  let sentDuring = 0, asks = 0, delays2 = 0, rg2;
  rg2 = createRemoteGame({
    decks: [J1, randomDeck(1001, 'FEU')], names: ['A', 'B'], seed: 5, replay: rg.game.s.answers,
    send: (pid, m) => { if (rg2.replaying) sentDuring++; if (m.type === 'ask') asks++; }, counterDelay: () => { delays2++; return 1000; },
  });
  const t0 = Date.now();
  assert.deepEqual(await rg2.run(), rg.game.s.result);
  assert.equal(delays2, 0); assert.ok(Date.now() - t0 < 2000);
  assert.equal(sentDuring, 0, 'envois pendant le rejeu');
  assert.equal(asks, 0, 'question posée alors que toutes les réponses étaient connues');
  done.push(`fenêtre de contre : ${delays} pauses sans contre possible, aucune pendant un rejeu`);
}

// ── Pendule ─────────────────────────────────────────────────
{
  const srv = await startServer(serverOpts({ clockBank: 60_000, clockIncrement: 1000 }));
  const B = srv.publicUrl, A = await login(B, 'Alice'), Bo = await login(B, 'Bob');
  const players = await pair(B, A, Bo);
  const m = await firstOf(players, x => x.type === 'ask');
  const c0 = await players[m.pid].next(x => x.type === 'clock' && x.running === m.pid);
  assert.deepEqual(c0.remaining, [60_000, 60_000]);
  clock += 30_000;
  players[m.pid].send({ type: 'answer', seq: m.x.seq, answer: pick(m.x, rnd) });
  const c1 = await players[m.pid].next(x => x.type === 'clock' && x.running === null);
  assert.equal(c1.remaining[m.pid], 31_000, '60 s − 30 s + 1 s d\'incrément');
  assert.equal(c1.remaining[1 - m.pid], 60_000);
  // Le temps ne s'écoule que pendant ses propres questions
  const n = await firstOf(players, x => x.type === 'ask');
  const left = n.pid === m.pid ? 31_000 : 60_000;
  clock += left - 1; srv.lobby.sweep();
  assert.equal(srv.lobby.stats().playing, 1, 'pendule tombée trop tôt');
  // Répondre après la chute de la pendule : défaite au temps
  clock += 2;
  players[n.pid].send({ type: 'answer', seq: n.x.seq, answer: pick(n.x, rnd) });
  const over = await players[1 - n.pid].type('over');
  assert.equal(over.reason, 'time'); assert.equal(over.forfeit, n.pid); assert.equal(over.winner, 1 - n.pid);
  const row = srv.db.raw.prepare('SELECT * FROM games').get();
  assert.equal(row.outcome, 'time'); assert.equal(row.winner, 1 - n.pid);
  // Pendule tombée sans réponse : détectée par le nettoyage
  const p2 = await pair(B, A, Bo);
  const q = await firstOf(p2, x => x.type === 'ask');
  clock += 61_000; srv.lobby.sweep();
  assert.equal((await p2[1 - q.pid].type('over')).reason, 'time');
  players.concat(p2).forEach(p => p.close());
  await srv.close();
  rmSync(join(dir, 'dojo.db')); rmSync(join(dir, 'dojo.db-wal'), { force: true }); rmSync(join(dir, 'dojo.db-shm'), { force: true });
  done.push('pendule : décompte pendant ses questions seulement, incrément, défaite au temps (réponse tardive ou nettoyage), partie enregistrée');
}

// ── Arrêt propre et reprise ─────────────────────────────────
{
  const srv = await startServer(serverOpts());
  const B = srv.publicUrl, A = await login(B, 'Alice'), Bo = await login(B, 'Bob');
  let players = await pair(B, A, Bo);
  const before = await play(players, 12);
  assert.ok(before.ask, 'partie finie trop tôt');
  const remaining = srv.lobby.clockNow([...srv.lobby.rooms.values()][0]);
  const answersBefore = [...[...srv.lobby.rooms.values()][0].rg.game.s.answers];
  await srv.shutdown();
  const snapPath = join(dir, 'parties-en-cours.json');
  assert.ok(existsSync(snapPath));
  assert.equal(statSync(snapPath).mode & 0o777, 0o600, 'droits du fichier');
  const snapText = readFileSync(snapPath, 'utf8');

  // Redémarrage : la partie est reprise, le fichier supprimé, les joueurs reviennent
  clock += 5_000;
  const srv2 = await startServer({ ...serverOpts(), port: 0 });
  assert.ok(!existsSync(snapPath), 'instantané non supprimé');
  assert.equal(srv2.lobby.stats().playing, 1);
  const B2 = srv2.publicUrl;
  players = [await Client.open(B2, A), await Client.open(B2, Bo)];
  const back = players[before.pid];
  assert.equal((await back.type('start')).resumed, true);
  const again = await back.type('ask');
  assert.equal(again.title, before.ask.title);
  assert.deepEqual(again.options.map(o => o.label), before.ask.options.map(o => o.label));
  const clk = await back.type('clock');
  assert.deepEqual(clk.remaining, remaining, 'pendules non conservées (l\'arrêt ne compte pas)');
  const room = [...srv2.lobby.rooms.values()][0];
  assert.deepEqual(room.rg.game.s.answers, answersBefore);
  // Fin de la partie
  back.send({ type: 'answer', seq: again.seq, answer: pick(again, rnd) });
  const end = await play(players, 10_000);
  assert.ok(end.over?.result, 'partie non terminée');
  // Enregistrée en base, et rejouable à l'identique
  const row = srv2.db.raw.prepare('SELECT * FROM games WHERE id = ?').get(room.id);
  assert.equal(row.outcome, 'result');
  const { config, answers } = JSON.parse(row.replay);
  let i = 0;
  const r = await new Game({ decks: config.decks, names: ['A', 'B'], agents: [{ ask: async () => answers[i++] }, { ask: async () => answers[i++] }], seed: config.seed, first: config.first }).run();
  assert.deepEqual(r, end.over.result);
  assert.deepEqual(JSON.parse(row.scores), end.over.result.scores);
  players.forEach(p => p.close());
  await srv2.close();
  done.push('arrêt propre : partie écrite (droits 600), reprise au redémarrage, même question, pendules intactes, partie enregistrée et rejouable');

  // ── Moteur modifié entre-temps : parties annulées, joueurs prévenus ─
  const snap = JSON.parse(snapText);
  snap.version = 'autre-moteur';
  writeFileSync(snapPath, JSON.stringify(snap), { mode: 0o600 });
  const srv3 = await startServer(serverOpts());
  assert.equal(srv3.lobby.stats().playing, 0);
  const a3 = await Client.open(srv3.publicUrl, A);
  const o3 = await a3.type('over');
  assert.equal(o3.aborted, 'mise à jour du serveur');
  // Les joueurs peuvent rejouer aussitôt
  a3.send({ type: 'create', deckText: DECK_A });
  await a3.type('created');
  a3.close();
  // Arrêt sans partie en cours : pas de fichier
  await srv3.shutdown();
  assert.ok(!existsSync(snapPath));
  done.push('moteur modifié : parties annulées (sans Elo), joueurs prévenus ; pas de fichier sans partie en cours');
}

rmSync(dir, { recursive: true, force: true });
console.log('OK étape 4 :\n - ' + done.join('\n - '));
