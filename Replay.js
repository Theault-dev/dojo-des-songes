// Rejoue un rapport de diagnostic (JSON copié depuis le bouton « Rapport ») et réaffiche son suivi.
//   node test/replay.mjs rapport.json          → vérifie le rejeu et imprime le suivi
//   node test/replay.mjs --selftest [seed]     → joue une partie bot contre bot, en fait un rapport et le rejoue
import fs from 'node:fs';
import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { J1 } from './decks.mjs';

const arg = process.argv[2];
let rep;
if (arg === '--selftest') {
  const g = new Game({ decks: [J1, J1], names: ['Joueur', 'Bot'], agents: [new Bot(), new Bot()], seed: +process.argv[3] || 4242, trace: true });
  await g.run();
  rep = JSON.parse(JSON.stringify(g.report()));
} else rep = JSON.parse(fs.readFileSync(arg, 'utf8'));

let i = 0;
const scripted = { ask: async () => rep.answers[i++] };
const g = new Game({ ...rep.config, names: ['Joueur', 'Bot'], agents: [scripted, scripted], trace: true });
await g.run();
const same = JSON.stringify(g.s.result) === JSON.stringify(rep.result) && JSON.stringify(g.s.log.map(l => `N${l.night} ${l.text}`)) === JSON.stringify(rep.log);
console.log(`Rejeu ${same ? 'identique' : 'DIFFÉRENT'} (${i}/${rep.answers.length} réponses consommées)`);
// Le suivi à relire est celui du rapport (il contient les raisons du bot) : le rejeu ne fait que vérifier la fidélité.
if (arg !== '--selftest') console.log(rep.trace.join('\n'));
else console.log(rep.trace.filter(l => /COMBAT|↳/.test(l)).slice(0, 14).join('\n') + `\n… ${rep.trace.length} lignes de suivi, ${rep.log.length} lignes de journal`);