// Usage : node test/mull.mjs [parties par deck] [nb decks adverses]
// Compare l'ancien bot (test/bot_old.js) et le nouveau (bot.js) côté J1 : nuit d'entrée de Jerzey, Perso en nuit 1, victoires.
import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { Bot as OldBot } from './bot_old.js';
import { randomDeck, KWS, J1 } from './decks.mjs';

const N = +process.argv[2] || 40, D = +process.argv[3] || 12;
async function run(Mine, label) {
  const st = { games: 0, jerzey: [0, 0, 0, 0, 0, 0, 0], arena1: 0, wins: 0, fame: 0 };
  for (let d = 0; d < D; d++) {
    const opp = randomDeck(500 + d, KWS[d % KWS.length]);
    for (let i = 0; i < N; i++) {
      const seed = 9000 + d * 1000 + i, me = i % 2; // J1 alterne côté et premier joueur
      const g = new Game({ decks: me === 0 ? [J1, opp] : [opp, J1], names: ['A', 'B'], agents: me === 0 ? [new Mine(), new Bot()] : [new Bot(), new Mine()], seed });
      await g.run();
      const log = g.s.log;
      const e = log.find(l => l.pid === me && /fait entrer Jerzey/.test(l.text));
      st.jerzey[e ? e.night : 0]++;
      if (log.some(l => l.pid === me && l.night === 1 && /fait entrer/.test(l.text))) st.arena1++;
      st.games++; st.fame += g.s.result.scores[me];
      if (g.s.result.winner === me) st.wins++;
    }
  }
  const pct = x => (100 * x / st.games).toFixed(0) + '%';
  console.log(`${label}: ${st.games} parties | Jerzey entre nuit 1:${pct(st.jerzey[1])} 2:${pct(st.jerzey[2])} 3:${pct(st.jerzey[3])} 4+:${pct(st.jerzey[4] + st.jerzey[5] + st.jerzey[6])} jamais:${pct(st.jerzey[0])} | Perso en Arène nuit 1: ${pct(st.arena1)} | victoires J1: ${pct(st.wins)} (Renommée ${(st.fame / st.games).toFixed(2)})`);
}
await run(OldBot, 'avant');
await run(Bot, 'après');
