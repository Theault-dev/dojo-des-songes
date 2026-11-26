import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { validateDeck, sharesName, CARDS, DECK_RULES } from '../data.js';
import { randomDeck } from './decks.mjs';
import assert from 'node:assert/strict';

// R40 / R67 / R54
assert(sharesName(CARDS.HUAM, CARDS.ALANA_HUAM)); assert(!sharesName(CARDS.HUAM, CARDS.ALANA1)); assert(sharesName(CARDS.LION2, CARDS.LION4));
const base = randomDeck(5, 'FEU');
assert(!validateDeck({ ...base, groupe: ['HUAM', 'ALANA_HUAM'] }).errors.some(e => /exemplaires/.test(e)));
assert(!validateDeck({ ...base, groupe: ['HUAM', 'HUAM'] }).errors.some(e => /exemplaires/.test(e)));
assert(validateDeck({ ...base, groupe: Array(5).fill('HUAM') }).errors.some(e => /exemplaires/.test(e)));
assert(validateDeck({ ...base, groupe: [] }).ok);
assert(!('minPersos' in DECK_RULES));

// R69/R70 : ordre des mulligans et placement sous la pile
const log = [];
class Scripted extends Bot {
  async ask(g, pid, req) {
    if (req.kind === 'mulligan') {
      const z = req.ctx.zone;
      const hand = req.options.map(o => o.card);
      const pick = [...req.options].reverse().slice(0, 3);          // 3 dernières cartes, dans cet ordre
      log.push({ pid, z, n: req.options.length, picked: pick.map(o => o.card.uid), pile: z === 'songe' ? null : null });
      this.last = { z, pick: pick.map(o => o.card) };
      return pick.map(o => o.id);
    }
    return super.ask(g, pid, req);
  }
}
const decks = [randomDeck(11, 'FEU'), randomDeck(12, 'GLACE')];
const g = new Game({ decks, names: ['A', 'B'], agents: [new Scripted(), new Scripted()], seed: 3, first: 1 });
// on intercepte après chaque mulligan pour vérifier le fond de la pile
const orig = g.mulligan.bind(g);
g.mulligan = async (pid, persos) => {
  await orig(pid, persos);
  const a = g.agents[pid].last; if (!a) return;
  const pile = g.p(pid)[persos ? 'groupe' : 'songe'];
  // première sélectionnée posée en premier → la dernière est tout en bas (index 0)
  const n = a.pick.length, bottom = pile.slice(0, n).map(c => c.uid);
  assert.deepEqual(bottom, [...a.pick].reverse().map(c => c.uid), `ordre sous la pile ${pid} ${persos}`);
  g.agents[pid].last = null;
};
await g.run();
const order = log.map(l => `${l.pid}:${l.z}`);
assert.deepEqual(order.slice(0, 4), ['1:songe', '1:groupe', '0:songe', '0:groupe'], order.join(' '));
console.log('rules OK', order.join(' '));
