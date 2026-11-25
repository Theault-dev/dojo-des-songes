// Parties à distance : aucune fuite d'information cachée, réponses invalides refusées, rejeu identique.
// node test/pvp.mjs [nombre de parties=40] [graine=1]
import assert from 'node:assert/strict';
import { Game, mulberry32 } from '../src/engine.js';
import { isVisible } from '../src/pvp/view.js';
import { createRemoteGame, mixSeed, commitSeed } from '../src/pvp/remote.js';
import { randomDeck, KWS } from './decks.mjs';

const N = +process.argv[2] || 40, S0 = +process.argv[3] || 1;
const stats = { games: 0, states: 0, asks: 0, rejected: 0, secretLogs: 0, maskedSeen: 0, pileOptions: 0 };

/** Toutes les cartes du moteur, toutes zones confondues. */
function allCards(g) {
  const out = [];
  for (const p of g.s.players) for (const z of ['groupe', 'songe', 'hand', 'reserve', 'arena', 'supports', 'fosse', 'exil']) out.push(...p[z]);
  if (g.s.combat) for (const sd of Object.values(g.s.combat.sides)) { out.push(...sd.kicks); if (sd.hidden) out.push(sd.hidden); }
  return out;
}

/** Cartes vues (avec identité) dans une vue de plateau. */
function viewCards(view) {
  const out = [];
  for (const p of view.players) {
    for (const z of ['hand', 'reserve', 'arena', 'fosse', 'exil']) out.push(...(p[z] ?? []));
    for (const pile of p.supports) out.push(...pile);
  }
  if (view.combat) for (const sd of Object.values(view.combat.sides)) { out.push(...sd.kicks); if (sd.fighter) out.push(sd.fighter); if (sd.hidden) out.push(sd.hidden); }
  return out;
}

function checkState(rg, viewer, view, openDecks) {
  stats.states++;
  const g = rg.game, json = JSON.stringify(view);
  for (const bad of ['"uid"', '"seed"', '"trace"', '"answers"', '"config"']) assert.ok(!json.includes(bad), `la vue contient ${bad}`);
  // Pioches : des nombres, jamais de liste (même pour leur propriétaire)
  for (const p of view.players) { assert.equal(p.songe, undefined); assert.equal(p.groupe, undefined); }
  // Main adverse : seulement un nombre
  const opp = view.players[1 - viewer];
  assert.equal(opp.hand, null, 'main adverse envoyée');
  assert.equal(opp.counts.hand, g.p(1 - viewer).hand.length);
  // Lieu adverse caché tant qu'il n'est pas révélé (sauf deck ouvert)
  if (!openDecks && !g.p(1 - viewer).lieuRevealed) assert.equal(opp.lieu, null, 'Lieu adverse révélé trop tôt');
  // Chaque carte montrée est bien visible pour ce joueur, et une carte cachée n'a pas de poignée
  const handles = rg.agents[0].handles.seen[viewer];
  const cards = allCards(g);
  const visibleIds = new Map();
  for (const c of cards) {
    const vis = isVisible(g, viewer, c);
    if (vis) visibleIds.set(c.id, (visibleIds.get(c.id) ?? 0) + 1);
    else assert.ok(!handles.get(c.uid)?.visible, `carte cachée ${c.id} (${c.zone}) avec poignée active`);
  }
  const shown = new Map();
  for (const v of viewCards(view)) {
    if (v.hidden) { assert.equal(v.id, undefined); assert.equal(v.h, null); assert.equal(v.label, undefined); continue; }
    shown.set(v.id, (shown.get(v.id) ?? 0) + 1);
  }
  // Le combattant est aussi dans l'Arène : on compte au plus deux fois chaque carte visible
  for (const [id, n] of shown) assert.ok(n <= 2 * (visibleIds.get(id) ?? 0), `carte ${id} montrée sans être visible`);
  // Journal : les lignes secrètes adverses sont masquées
  g.s.log.forEach((l, i) => {
    if (l.to == null) return;
    if (l.to !== viewer) { assert.equal(view.log[i].text, l.masked); stats.maskedSeen++; }
    else assert.equal(view.log[i].text, l.text);
  });
}

function checkAsk(msg) {
  stats.asks++;
  assert.ok(msg.options.length > 0);
  msg.options.forEach((o, i) => assert.equal(o.id, `o${i}`));
  const json = JSON.stringify(msg);
  assert.ok(!json.includes('"uid"'), 'question avec uid');
  for (const o of msg.options) if (o.card && !o.card.hidden && o.card.h === null) stats.pileOptions++;
}

/** Réponse aléatoire valide (évite les options « impossibles » quand c'est possible). */
function randomAnswer(msg, rnd) {
  const ok = msg.options.filter(o => !o.blocked);
  const pool = ok.length ? ok : msg.options;
  if (!msg.multi) return pool[Math.floor(rnd() * pool.length)].id;
  const ids = msg.options.map(o => o.id).sort(() => rnd() - 0.5);
  const n = msg.min + Math.floor(rnd() * (Math.min(msg.max, ids.length) - msg.min + 1));
  return ids.slice(0, n);
}

/** Réponses invalides : toutes doivent être refusées sans débloquer la question. */
function tryInvalid(rg, pid, msg) {
  const bad = [
    [{ seq: msg.seq + 1, answer: msg.multi ? [] : 'o0' }, 'stale'],
    [{ seq: msg.seq, answer: 'o999' }, msg.multi ? 'bad-answer' : 'bad-option'],
    [{ seq: msg.seq, answer: 42 }, msg.multi ? 'bad-answer' : 'bad-option'],
    [null, 'stale'],
  ];
  if (msg.multi) {
    bad.push([{ seq: msg.seq, answer: ['o0', 'o0'] }, msg.options.length >= 2 ? 'duplicate' : 'bad-answer']);
    if (msg.max < msg.options.length) bad.push([{ seq: msg.seq, answer: msg.options.map(o => o.id) }, 'bad-count']);
    if (msg.min > 0) bad.push([{ seq: msg.seq, answer: [] }, 'bad-count']);
  } else bad.push([{ seq: msg.seq, answer: ['o0'] }, 'bad-option']);
  for (const [m, err] of bad) {
    const r = rg.answer(pid, m);
    assert.equal(r.ok, false); assert.equal(r.error, err, `réponse ${JSON.stringify(m)}`);
    stats.rejected++;
  }
  // L'autre joueur ne peut pas répondre à sa place
  const other = rg.agents[1 - pid];
  if (!other.pending) { assert.equal(rg.answer(1 - pid, { seq: msg.seq, answer: msg.multi ? [] : 'o0' }).ok, false); stats.rejected++; }
}

async function playOne(seed, openDecks) {
  const decks = [randomDeck(seed * 2, KWS[seed % KWS.length]), randomDeck(seed * 2 + 1, KWS[(seed * 7 + 3) % KWS.length])];
  const rnd = mulberry32(seed * 977);
  let rg;
  const send = (pid, msg) => {
    if (msg.type === 'state') checkState(rg, pid, msg.view, openDecks);
    if (msg.type !== 'ask') return;
    checkAsk(msg);
    // On répond plus tard, comme un vrai client
    setImmediate(() => {
      if (rnd() < 0.15) tryInvalid(rg, pid, msg);
      const r = rg.answer(pid, { seq: msg.seq, answer: randomAnswer(msg, rnd) });
      assert.ok(r.ok, `réponse valide refusée : ${r.error}`);
      assert.equal(rg.answer(pid, { seq: msg.seq, answer: 'o0' }).error, 'no-pending');
    });
  };
  rg = createRemoteGame({ decks, names: ['A', 'B'], seed, openDecks, send });
  const result = await Promise.race([rg.run(), new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT graine ${seed}`)), 30000))]);
  assert.ok(rg.game.s.over, 'partie non terminée');
  stats.secretLogs += rg.game.s.log.filter(l => l.to != null).length;

  // Deck ouvert : decklist adverse triée, jamais la sienne
  const v0 = rg.view(0);
  if (openDecks) {
    assert.deepEqual(v0.players[1].decklist.songe, [...decks[1].songe].sort());
    assert.equal(v0.players[0].decklist, undefined);
  } else assert.equal(v0.players[1].decklist, undefined);

  // Rejeu : configuration + réponses enregistrées → même partie
  const answers = [...rg.game.s.answers];
  let i = 0;
  const replayer = { ask: async () => answers[i++] };
  const g2 = new Game({ decks, names: ['A', 'B'], agents: [replayer, replayer], seed });
  const r2 = await g2.run();
  assert.deepEqual(r2, result, `rejeu différent (graine ${seed})`);
  assert.equal(i, answers.length);
  stats.games++;
}

const t0 = Date.now();
for (let k = 0; k < N; k++) await playOne(S0 + k, k % 3 === 2);

// Graine partagée : déterministe, dépend de chaque contribution
assert.equal(await mixSeed('s', ['a', 'b']), await mixSeed('s', ['a', 'b']));
assert.notEqual(await mixSeed('s', ['a', 'b']), await mixSeed('s', ['a', 'c']));
assert.match(await commitSeed('s'), /^[0-9a-f]{64}$/);

assert.ok(stats.rejected > 0 && stats.asks > 0);
console.log(`OK ${stats.games}/${N} parties, ${stats.states} vues et ${stats.asks} questions vérifiées, ${stats.rejected} réponses invalides refusées,`
  + ` ${stats.secretLogs} lignes secrètes (${stats.maskedSeen} vues masquées), ${stats.pileOptions} options tirées d'une pioche — ${((Date.now() - t0) / N).toFixed(0)} ms/partie`);
