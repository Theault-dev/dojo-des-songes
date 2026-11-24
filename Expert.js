// Bot Expert : recherche arborescente (ISMCTS) sur des « mondes possibles ».
//
// Le moteur est asynchrone (une décision = un `await` au fond de la pile), il ne se clone pas.
// On rejoue donc la partie depuis le début avec les mêmes réponses, jusqu'à la décision en cours.
// À chaque itération : tout ce que le bot ne peut pas savoir (Main adverse, ordre des paquets…) est
// remplacé par un tirage plausible (« détermination » — sans la decklist adverse), puis on descend dans
// un arbre de décisions commun à toutes les déterminations (UCB, en comptant les disponibilités des
// options), on étend d'une option, et on finit au bot heuristique jusqu'à un horizon de quelques nuits
// où un modèle estime la probabilité de victoire. L'option la plus visitée est jouée.
// Pas de triche : seules les cartes visibles du bot restent à leur vraie place.
import { CARDS } from './data.js';
import { Game, mulberry32 } from './engine.js';
import { Bot, withoutBlocked } from './bot.js';

/** Décisions qui valent une vraie réflexion (jusqu'au budget « key ») ou une courte (« mid »). */
const KEY_KINDS = new Set(['bastonFighter', 'bastonTarget', 'provocFighter', 'provocTarget', 'counter', 'damage', 'acceptRefuse', 'rafaelo']);
const MID_KINDS = new Set(['crepuscule', 'window:combat', 'window:denouement', 'window:combatStart', 'window:finCombat', 'window:aurore', 'window:finNuit',
  'target', 'finBaston', 'search', 'recruitPick', 'jung', 'partage', 'malice', 'teleport', 'boostOwn', 'discardOwn', 'protect', 'fromFosse', 'dolcheHide', 'envieSang', 'envieOrder']);

export function searchTier(req) {
  if (req.max > 1 || req.min === 0 || req.options.length < 2) return null;
  // Les Kicks reviennent souvent dans un combat : budget intermédiaire pour garder un rythme jouable
  return KEY_KINDS.has(req.kind) ? 'key' : req.kind === 'kickTurn' ? 'kick' : MID_KINDS.has(req.kind) ? 'mid' : null;
}

const PUBLIC_ZONES = ['arena', 'reserve', 'supports', 'fosse', 'exil'];

function shuffleIds(cards, rand) {
  const ids = cards.map(c => c.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  cards.forEach((c, i) => { c.id = ids[i]; });
}

/** Cartes de l'adversaire déjà vues par le bot (zones publiques et Kicks posés). */
function publicCards(g, o) {
  const out = PUBLIC_ZONES.flatMap(z => g.p(o)[z]);
  const sd = g.s.combat && g.side?.(o);
  if (sd?.kicks) out.push(...sd.kicks);
  return out.filter(c => !c.faceDown || c.zone !== 'hidden');
}

/**
 * Sans la decklist adverse : on devine les cartes cachées à partir de ce qui a été vu.
 * Les cartes déjà jouées reviennent plus souvent (exemplaires multiples), puis celles qui partagent
 * leurs mots-clés, puis le reste du catalogue.
 */
function guessIds(g, o, slots, isPerso, rand) {
  const seen = publicCards(g, o).map(c => c.id);
  const kw = new Set(seen.flatMap(id => CARDS[id].kw).filter(k => k !== 'BASE'));
  const count = new Map();
  for (const id of seen) count.set(id, (count.get(id) ?? 0) + 1);
  const pool = Object.values(CARDS).filter(d => (d.type === 'P') === isPerso);
  const maxN = isPerso ? 1 : 4; // un Perso n'existe qu'une fois par Groupe (R67)
  const weight = d => {
    const n = count.get(d.id) ?? 0;
    if (n >= maxN) return 0;
    if (n) return 6;
    return d.kw.some(k => kw.has(k)) || d.kw.includes('BASE') ? 1 : 0.15;
  };
  for (const c of slots) {
    const ws = pool.map(weight), total = ws.reduce((a, b) => a + b, 0);
    let r = rand() * total, k = 0;
    while (k < pool.length - 1 && (r -= ws[k]) > 0) k++;
    c.id = pool[k].id;
    count.set(c.id, (count.get(c.id) ?? 0) + 1);
  }
}

/** Remplace l'information cachée au joueur `pid` par un tirage compatible avec ce qu'il sait. */
export function determinize(g, pid, rand, knowList) {
  const me = g.p(pid), o = 1 - pid, op = g.p(o);
  shuffleIds(me.songe, rand);
  shuffleIds(me.groupe, rand);
  const hidden = g.s.combat && g.side?.(o)?.hidden;
  const handP = op.hand.filter(c => CARDS[c.id].type === 'P'), handO = op.hand.filter(c => CARDS[c.id].type !== 'P');
  const persos = [...op.groupe, ...handP], others = [...op.songe, ...handO, ...(hidden ? [hidden] : [])];
  if (knowList) { shuffleIds(persos, rand); shuffleIds(others, rand); }
  else { guessIds(g, o, persos, true, rand); guessIds(g, o, others, false, rand); }
  g.rand = mulberry32(Math.floor(rand() * 2 ** 31));
}

class ReachedMismatch extends Error {}
class Truncated { constructor(v) { this.v = v; } }

const now = () => (globalThis.performance ?? Date).now();

// ── Arbre d'information (SO-ISMCTS) ─────────────────────────
// Une arête = une option d'une décision ; ses statistiques sont du point de vue du joueur qui cherche.
// `avail` compte les itérations où l'option était disponible (les mains cachées changent les options).
const C_UCB = 0.9, PRIOR = 0.35;
class Node { constructor() { this.edges = new Map(); } }

/** Une itération : rejoue jusqu'à la décision racine, descend dans l'arbre, étend, termine au bot, rétropropage. */
async function iterate({ cfg, answers, pid, kind, root, worldSeed, knowList, model, horizon }) {
  const rollout = new Bot();
  const rnd = mulberry32(worldSeed ^ 0x9e3779b9);
  let i = 0, reached = false, stopNight = Infinity, node = root, inTree = true;
  const path = [];
  const agent = {
    async ask(g, who, req) {
      if (i < answers.length) return answers[i++];
      if (!reached) {
        reached = true;
        if (who !== pid || req.kind !== kind) throw new ReachedMismatch();
        determinize(g, pid, mulberry32(worldSeed), knowList);
        stopNight = g.s.night + horizon;
      } else if (g.s.night >= stopNight) throw new Truncated(predict(model, features(g, pid)));
      const heur = await rollout.ask(g, who, req);
      const r = withoutBlocked(req);
      if (!inTree || !searchTier(r)) return heur;
      const ids = r.options.map(o => o.id);
      for (const id of ids) {
        let e = node.edges.get(id);
        if (!e) node.edges.set(id, (e = { n: 0, w: 0, avail: 0, next: null }));
        e.avail++;
      }
      const untried = ids.filter(id => node.edges.get(id).n === 0);
      let id;
      if (untried.length) {
        id = untried.includes(heur) ? heur : untried[Math.floor(rnd() * untried.length)];
        inTree = false;
      } else {
        let bestV = -Infinity;
        for (const c of ids) {
          const e = node.edges.get(c), m = e.w / e.n;
          const v = (who === pid ? m : 1 - m) + C_UCB * Math.sqrt(Math.log(e.avail) / e.n) + (c === heur ? PRIOR / (e.n + 1) : 0);
          if (v > bestV) { bestV = v; id = c; }
        }
      }
      const edge = node.edges.get(id);
      path.push(edge);
      if (inTree) node = edge.next ??= new Node();
      return id;
    },
  };
  const g = new Game({ decks: cfg.decks, names: ['A', 'B'], agents: [agent, agent], seed: cfg.seed, first: cfg.first });
  let value;
  try {
    const res = await g.run();
    if (!reached) throw new ReachedMismatch();
    value = res.winner === pid ? 1 : res.winner == null || res.winner < 0 ? 0.5 : 0;
  } catch (e) {
    if (e instanceof Truncated) value = e.v; else throw e;
  }
  for (const e of path) { e.n++; e.w += value; }
}

/**
 * Cherche la meilleure option de la décision courante. S'arrête au budget de temps ou au plafond
 * d'itérations. Renvoie { stats: [{ id, n, w }], sims } — n = visites de l'option à la racine ;
 * fusionnable entre plusieurs workers (chacun construit son arbre).
 */
export async function search({ cfg, answers, pid, kind, optionIds, budgetMs, maxSims = Infinity, knowList, seed = 1, model = null, horizon = 1 }) {
  const root = new Node(), rand = mulberry32(seed), t0 = now();
  let sims = 0;
  while (now() - t0 < budgetMs && sims < maxSims) {
    try { await iterate({ cfg, answers, pid, kind, root, worldSeed: Math.floor(rand() * 2 ** 31), knowList, model, horizon }); }
    catch (e) { if (e instanceof ReachedMismatch) return { stats: [], sims, error: 'replay' }; throw e; }
    sims++;
    // Une option nettement devant, avec assez de visites : inutile d'insister
    if (sims >= 200 && sims % 20 === 0) {
      const ns = optionIds.map(id => root.edges.get(id)?.n ?? 0).sort((a, b) => b - a);
      if (ns[0] > 0.85 * sims) break;
    }
  }
  return { stats: optionIds.map(id => { const e = root.edges.get(id); return { id, n: e?.n ?? 0, w: e?.w ?? 0 }; }), sims };
}

/** Choix final : l'option la plus visitée (statistiques éventuellement fusionnées). `fallback` départage. */
export function bestOf(stats, fallback) {
  const merged = new Map();
  for (const s of stats) { const m = merged.get(s.id) ?? { id: s.id, n: 0, w: 0 }; m.n += s.n; m.w += s.w; merged.set(s.id, m); }
  const list = [...merged.values()].filter(s => s.n > 0);
  if (!list.length) return fallback;
  const score = s => s.n + 0.5 * ((s.w + 1) / (s.n + 2)) + (s.id === fallback ? 0.01 : 0);
  return list.reduce((a, b) => (score(b) > score(a) ? b : a)).id;
}

/**
 * Bot Expert : bot heuristique + recherche sur les décisions importantes.
 * `runner(job)` exécute la recherche (dans le même fil en Node, dans des workers en navigateur)
 * et renvoie une liste de stats.
 */
export class ExpertBot extends Bot {
  constructor({ model = VALUE_MODEL, horizon = 2, knowList = false, budget = { key: 15000, kick: 6000, mid: 2500 }, maxSims = { key: Infinity, kick: Infinity, mid: Infinity }, runner = null, onThink = null, ...rest } = {}) {
    super(rest);
    Object.assign(this, { knowList, budget, maxSims, onThink, model, horizon });
    this.runner = runner ?? (async job => (await search(job)).stats);
  }

  async ask(g, pid, req) {
    const r = withoutBlocked(req);
    const tier = searchTier(r);
    const heuristic = await super.ask(g, pid, req);
    if (!tier || !g.config) return heuristic;
    this.onThink?.(true, tier);
    try {
      const stats = await this.runner({
        cfg: g.config, answers: [...g.s.answers], pid, kind: req.kind,
        optionIds: r.options.map(o => o.id), budgetMs: this.budget[tier], maxSims: this.maxSims[tier], knowList: this.knowList, model: this.model, horizon: this.horizon,
      });
      const pick = bestOf(stats, heuristic);
      const lab = id => r.options.find(o => o.id === id)?.label ?? id;
      if (pick !== heuristic) this.note(g, `Expert ${tier} : ${[].concat(pick).map(lab).join(' + ')} au lieu de ${[].concat(heuristic).map(lab).join(' + ')}`);
      return pick;
    } finally { this.onThink?.(false, tier); }
  }
}

// ── Évaluation apprise ──────────────────────────────────────
// Décrit une position (au début d'une nuit) du point de vue de `pid`, pour un modèle qui estime
// la probabilité de victoire. Utilisé à l'intérieur des mondes simulés : tout y est connu.
export function features(g, pid) {
  const side = q => {
    const p = g.p(q), ar = g.visibleArena(q);
    const hand = p.hand.map(c => CARDS[c.id]);
    const kicks = hand.filter(d => d.type === 'K');
    return [
      p.renommee,
      ar.reduce((a, c) => a + g.aura(c), 0), ar.length,
      p.reserve.reduce((a, c) => a + g.aura(c), 0), p.reserve.length,
      p.arena.length - ar.length,
      hand.length, kicks.length, kicks.reduce((a, d) => a + d.force, 0), hand.filter(d => d.type === 'P').length,
      p.songe.length, p.groupe.reduce((a, c) => a + CARDS[c.id].aura, 0),
      new Set(p.supports.map(c => c.id)).size, p.supports.length,
      p.lieuUsed.filter(Boolean).length, p.gold ?? 0, p.fosse.length,
    ];
  };
  const me = side(pid), op = side(1 - pid), n = g.s.night;
  const rd = me[0] - op[0];
  return [1, n / 6, rd, rd * n / 6, (g.s.first === pid ? 1 : 0), ...me.map((v, i) => v - op[i]), ...me, ...op];
}

export function predict(model, f) {
  let z = 0;
  for (let i = 0; i < f.length; i++) z += model.w[i] * (f[i] - model.mu[i]) / model.sd[i];
  return 1 / (1 + Math.exp(-z));
}

/** Régression logistique entraînée sur 120 000 positions de parties bot contre bot (10 decks). */
export const VALUE_MODEL = {"w":[-0.0,-0.0,0.15288,1.33489,-0.16293,0.15288,0.39117,0.4038,0.54139,0.20353,0.21239,-0.11725,0.12538,0.06726,0.0,0.0591,0.72417,0.04502,0.01883,-0.12237,0.05233,0.01591,0.08341,0.1526,0.1871,0.37709,0.14054,0.15826,-0.09978,0.09808,0.05068,0.0,0.02699,0.40701,0.03351,0.01342,-0.0508,0.03591,0.00669,-0.08341,-0.1526,-0.1871,-0.37709,-0.14054,-0.15826,0.09978,-0.09808,-0.05068,0.0,-0.02699,-0.40701,-0.03351,-0.01342,0.0508,-0.03591,-0.00669],"mu":[0.0,0.66667,0.0,0.0,0.5,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,5.21266,4.71739,2.48915,8.83371,3.6727,0.16152,5.38457,4.5438,6.14717,0.0,14.92612,5.73054,1.17649,1.82382,1.94412,0.14183,7.86548,5.21266,4.71739,2.48915,8.83371,3.6727,0.16152,5.38457,4.5438,6.14717,0.0,14.92612,5.73054,1.17649,1.82382,1.94412,0.14183,7.86548],"sd":[1.0,0.2357,4.79157,4.18456,0.5,4.79157,3.0207,1.55836,5.04537,1.98427,0.66736,3.78617,3.40555,5.60873,1.0,5.54336,4.77048,0.92056,1.69388,0.83591,0.77403,5.30373,4.39115,3.87171,1.68166,3.62182,1.43683,0.44781,2.22441,2.17679,3.72192,1.0,6.06871,4.24392,0.61839,1.18877,1.00677,0.56398,6.31059,4.39115,3.87171,1.68166,3.62182,1.43683,0.44781,2.22441,2.17679,3.72192,1.0,6.06871,4.24392,0.61839,1.18877,1.00677,0.56398,6.31059]};