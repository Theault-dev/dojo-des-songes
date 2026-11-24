// Scénario de la nuit 5 du rapport : Arène du bot = Charly (Uzi Flam), Terrence, Epony (Aurora Annihilation), Asmodheus ;
// Arène adverse = Asmodheus seul. Que fait le bot au lancement de la Baston ? (nouveau bot / bot d'avant)
import { Game } from '../engine.js';
import { Bot } from '../bot.js';
import { Bot as Prev } from './bot_prev.js';
import { J1 } from './decks.mjs';
const deck = { ...J1, groupe: ['CHARLY2', 'TERRENCE1', 'EPONY4', 'ASMODHEUS', 'NEIL2', 'CHARLY3'] };
for (const [name, B] of [['nouveau', Bot], ['avant', Prev]]) {
  const rows = [];
  for (const seen of [false, true]) for (const hand of [3, 5, 7]) {
    const g = new Game({ decks: [deck, deck], names: ['Joueur', 'Bot'], agents: [new B(), new B()], seed: 7, trace: true });
    g.s.night = 5;
    if (seen) g.s.fights.push({ pid: 0, id: 'JERZEY1', aura: 1, power: 3 }, { pid: 0, id: 'TORO', aura: 3, power: 12 }, { pid: 0, id: 'MANIAC4', aura: 4, power: 23 }); // le joueur a déjà montré 3, 12 puis 23
    const put = (pid, id, zone) => { const p = g.p(pid), i = p.groupe.findIndex(c => c.id === id), [c] = p.groupe.splice(i, 1); c.zone = zone; p[zone].push(c); };
    for (const id of ['CHARLY2', 'TERRENCE1', 'EPONY4', 'ASMODHEUS']) put(1, id, 'arena');
    put(0, 'ASMODHEUS', 'arena');
    for (const pid of [0, 1]) { const p = g.p(pid); for (let k = 0; k < hand; k++) { const c = p.songe.shift(); c.zone = 'hand'; p.hand.push(c); } }
    const bot = new B(), p = g.p(1);
    const req = { kind: 'bastonFighter', options: g.fighterCandidates(1).map(c => ({ id: c.uid, card: c, label: g.label(c) })).concat([{ id: 'none', label: 'Aucune' }]) };
    const ans = bot.bastonFighter(g, 1, req);
    if (name === "nouveau" && hand === 7) console.log(g.s.trace.filter(l => /paires/.test(l)).map(l => l.slice(0, 330)).join("\n"));
    rows.push(`${seen ? 'adv. fort' : 'adv. inconnu'}, main ${hand} → ${ans === 'none' ? 'passe' : g.label(p.arena.find(c => c.uid === ans))}`);
  }
  console.log(`${name} : ${rows.join(' | ')}`);
}
