import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { randomDeck, KWS } from './decks.mjs';

const N = +process.argv[2] || 60, S0 = +process.argv[3] || 1;
let crashes = 0, done = 0; const errs = {};
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const seed = S0 + i;
  const decks = [randomDeck(seed * 2, KWS[seed % KWS.length]), randomDeck(seed * 2 + 1, KWS[(seed * 7 + 3) % KWS.length])];
  const g = new Game({ decks, names: ['A', 'B'], agents: [new Bot(), new Bot()], seed });
  try {
    const r = await Promise.race([g.run(), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 20000))]);
    done++;
    if (!g.s.over) throw new Error('not over');
  } catch (e) {
    crashes++;
    const k = String(e.stack).split('\n').slice(0, 3).join(' | ');
    (errs[k] ??= []).push(seed);
  }
}
console.log(`${done}/${N} parties ok, ${crashes} crashs, ${((Date.now() - t0) / N).toFixed(0)} ms/partie`);
for (const [k, v] of Object.entries(errs)) console.log(v.slice(0, 6).join(','), '→', k);
