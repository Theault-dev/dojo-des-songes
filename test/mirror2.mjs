// J1 contre J1 : bot actuel contre bot d'avant correctif de la Baston (côté et premier joueur alternés).
import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { Bot as Prev } from './bot_prev.js';
import { J1 } from './decks.mjs';
const N = +process.argv[2] || 400; let wins = 0, ties = 0, asm = [0, 0];
for (let i = 0; i < N; i++) {
  const me = i % 2, g = new Game({ decks: [J1, J1], names: ['A', 'B'], agents: me === 0 ? [new Bot(), new Prev()] : [new Prev(), new Bot()], seed: 52000 + i });
  await g.run();
  const w = g.s.result.winner; if (w === me) wins++; else if (w == null) ties++;
  for (const l of g.s.log) if (/inflige le dégât Asmodheus/.test(l.text)) asm[l.pid === me ? 0 : 1]++;
}
console.log(`J1 nouveau bot contre J1 bot d'avant : ${wins}/${N} (${(100 * wins / N).toFixed(1)} %, nuls ${ties}) ± ${(196 * Math.sqrt(.25 / N)).toFixed(1)} | dégâts Asmodheus infligés : nouveau ${asm[0]}, avant ${asm[1]}`);
