// Tombé à pic (★) posé par un combattant « Lucky stars » avec Fouteurs de merde en jeu : Fouteurs doit se déclencher
// à la pose du ★, même si Tombé à pic est ensuite défaussé pour poser un autre Kick.
import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import assert from 'node:assert/strict';

const songe = ['TOMBE_PIC', 'TOMBE_PIC', 'FOUTEURS', ...Array(12).fill('BOULE_FEU'), ...Array(12).fill('PREMIERE_FLAMME')];
const deck = { id: 'x', name: 'x', lieu: Object.keys((await import('../data.js')).LIEUX)[0], groupe: ['TERRENCE1', 'JERZEY1', 'NEIL1'], songe };

async function play(answerTombe) {
  const bot = new Bot();
  const agent = { ask: async (g, pid, req) => {
    if (pid === 0) {
      if (req.kind === 'kickTurn') { const k = req.options.find(o => o.card?.id === 'TOMBE_PIC' && o.id.startsWith('kick:')); return k ? k.id : 'pass'; }
      if (req.kind === 'tombePic') return answerTombe;
      if (req.kind === 'search') return req.options[0].id;
    }
    return bot.ask(g, pid, req);
  } };
  const g = new Game({ decks: [deck, deck], names: ['Joueur', 'Bot'], agents: [agent, agent], seed: 3, trace: true });
  g.s.night = 1;
  const move = (pid, id, zone) => { const p = g.p(pid), src = p.groupe.some(c => c.id === id) ? 'groupe' : 'songe'; const i = p[src].findIndex(c => c.id === id), [c] = p[src].splice(i, 1); c.zone = zone; p[zone].push(c); return c; };
  const f = move(0, 'TERRENCE1', 'arena'), t = move(1, 'JERZEY1', 'arena');
  const sup = move(0, 'FOUTEURS', 'supports'); sup.slot = 0; g.p(0).teams.add('LUCKY STARS');
  move(0, 'TOMBE_PIC', 'hand');
  await g.runCombat(0, f, t);
  return g.s.log.map(l => l.text);
}
for (const [label, ans] of [['Tombé à pic activé (remplacé par un autre Kick)', 'yes'], ['Tombé à pic refusé (le ★ reste)', 'no']]) {
  const log = await play(ans);
  const rolls = log.filter(l => /Fouteurs de merde : le dé/.test(l)).length;
  console.log(`${label} : ${rolls} jet(s) de Fouteurs`);
  assert.equal(rolls, 1, `${label} : Fouteurs de merde doit se déclencher une fois`);
}
console.log('fouteurs OK');
