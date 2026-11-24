import { CARDS, LIEUX, validateDeck, maxCopies } from '../src/data.js';
import { mulberry32 } from '../src/engine.js';

const persos = Object.values(CARDS).filter(c => c.type === 'P');
const songeCards = Object.values(CARDS).filter(c => c.type === 'K' || c.type === 'S');
const lieux = Object.values(LIEUX);

/** Deck aléatoire valide, orienté par un mot-clé (pour que les Kicks s'activent). */
export function randomDeck(seed, kw = null) {
  const rnd = mulberry32(seed);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const lieu = pick(lieux).id;
  const pool = kw ? persos.filter(c => c.kw.includes(kw)) : persos;
  const groupe = [];
  let aura = 0;
  for (let t = 0; t < 200 && groupe.length < 9; t++) {
    const c = pick(pool.length ? pool : persos);
    if (groupe.includes(c.id) || aura + c.aura > 20) continue;
    groupe.push(c.id); aura += c.aura;
  }
  const pk = kw ? songeCards.filter(c => c.kw.includes(kw) || c.kw.includes('BASE')) : songeCards;
  const songe = [];
  const cnt = {};
  for (let t = 0; t < 2000 && songe.length < 40; t++) {
    const c = rnd() < 0.8 ? pick(pk) : pick(songeCards);
    if ((cnt[c.id] ?? 0) >= maxCopies(c)) continue;
    cnt[c.id] = (cnt[c.id] ?? 0) + 1; songe.push(c.id);
  }
  const d = { id: `d${seed}`, name: `Deck ${seed}${kw ? ' ' + kw : ''}`, lieu, groupe, songe };
  const v = validateDeck(d);
  if (!v.ok) throw new Error(`deck invalide ${d.name}: ${v.errors.join(' | ')}`);
  return d;
}
export const KWS = ['FEU', 'GLACE', 'FOUDRE', 'FÉLIN', 'TITAN', 'POISSON', 'ROCHE', 'CÉRÉBRAL', 'KILLER', 'SANG', 'SON', 'VIF', 'GARDE', 'DRAGON', 'MOTIF', 'FANTASY STARS', null];

/** Deck officiel J1 (état du projet, section 6). */
const rep = (id, n) => Array(n).fill(id);
export const J1 = { id: 'j1', name: 'J1', lieu: 'ZONE3',
  groupe: ['JERZEY1', 'TERRENCE1', 'FRERES', 'TORO', 'MANIAC4', 'ASMODHEUS'],
  songe: [...rep('PREMIERE_FLAMME', 4), 'PAS_VU_VENIR', 'FORCE_ENFOUIE', ...rep('PIEGE', 2), ...rep('PUNCH', 2), ...rep('BOULE_FEU', 4),
    ...rep('VIOLENCE', 4), ...rep('ETALE', 3), 'MANDALE_TITAN', ...rep('DEBOITAGE', 3), ...rep('LIBERER', 2), 'ENVIE_SANG', 'BAGUE_FEU', 'MUR_FORCE'] };