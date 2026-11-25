// ─────────────────────────────────────────────────────────────
// Partie à distance : ce qu'un joueur a le droit de voir.
//
// Le serveur fait tourner le moteur complet ; chaque navigateur ne
// reçoit que `viewFor(...)` et les questions qui lui sont posées
// (`requestFor(...)`). Règles :
//  - jamais de graine RNG, de suivi (`trace`) ni de `uid` du moteur
//    (les `uid` suivent l'ordre de la decklist : ils trahiraient la carte) ;
//  - Songe et Groupe : seulement leur nombre de cartes, y compris pour
//    leur propriétaire (personne ne connaît l'ordre de sa pioche) ;
//  - Main, carte cachée de combat (Dolche), cartes face cachée et
//    Soutiens recouverts : visibles par leur seul propriétaire ;
//  - chaque carte visible porte une poignée opaque `h`, propre à chaque
//    joueur, renouvelée chaque fois que la carte redevient visible pour
//    lui (on ne suit pas une carte à travers une zone cachée) ;
//  - lignes de journal « secrètes » : texte masqué pour l'adversaire.
// ─────────────────────────────────────────────────────────────
import { CARDS, LIEUX } from '../data.js';

// Node 18 n'expose pas `crypto` en global (Node ≥ 20 et les navigateurs, si)
const webcrypto = globalThis.crypto ?? (await import('node:crypto')).webcrypto;

const HIDDEN_PILES = new Set(['songe', 'groupe']);

const randomHandle = () => {
  const b = new Uint8Array(8);
  webcrypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};

/** Poignées opaques des cartes, une table par joueur. */
export class HandleMap {
  constructor() { this.seen = [new Map(), new Map()]; }
  /** Poignée de `card` pour `viewer` (null si la carte lui est cachée). */
  get(viewer, card, visible) {
    const m = this.seen[viewer], e = m.get(card.uid);
    if (!visible) { if (e) e.visible = false; return null; }
    if (e?.visible) return e.h;
    const h = randomHandle();
    m.set(card.uid, { h, visible: true });
    return h;
  }
}

/** Index des Soutiens recouverts (pas au-dessus de leur pile). */
function coveredSupports(g, pid) {
  const covered = new Set();
  for (const pile of g.supportStacks(pid)) pile.slice(0, -1).forEach(c => covered.add(c));
  return covered;
}

/** Vrai si `viewer` voit l'identité de `card` sur le plateau. */
export function isVisible(g, viewer, card, covered = null) {
  if (HIDDEN_PILES.has(card.zone)) return false;
  if (card.owner === viewer) return true;
  if (card.faceDown || card.zone === 'hand' || card.zone === 'hidden') return false;
  if (card.zone === 'supports' && (covered ?? coveredSupports(g, card.owner)).has(card)) return false;
  return true;
}

const safe = fn => { try { return fn(); } catch { return null; } };

/** Vue d'une carte : identité et valeurs calculées si visible, carte vierge sinon. */
function cardView(g, viewer, handles, card, visible, { noHandle = false } = {}) {
  const h = noHandle ? null : handles.get(viewer, card, visible);
  if (!visible) return { h: null, owner: card.owner, zone: card.zone, hidden: true };
  const d = CARDS[card.id];
  const v = {
    h, id: card.id, owner: card.owner, zone: card.zone, label: g.label(card), type: d.type,
    faceDown: !!card.faceDown, kw: safe(() => g.keywords(card)) ?? [],
    markers: card.markers.filter(m => m.v).map(m => ({ v: m.v, src: m.src ?? null })),
  };
  // États visibles sur la carte (badges de l'interface)
  const tmp = {};
  for (const k of ['inciblable', 'protected', 'lockFaceDown']) if (card.tmp?.[k]) tmp[k] = true;
  if (Object.keys(tmp).length) v.tmp = tmp;
  for (const k of ['countered', 'silenced', 'shielded']) if (card[k]) v[k] = true;
  if (card.cap != null) v.cap = card.cap;
  if (d.type === 'P') v.aura = safe(() => g.aura(card));
  if (d.type === 'K') {
    v.rang = card.zone === 'kicks' ? card.rang ?? null : d.rang;
    v.force = card.zone === 'kicks' && g.s.combat ? safe(() => g.kickForce(card)) : d.force;
    if (card.zone === 'kicks') v.condMet = !!safe(() => g.kickCondMet(card));
  }
  if (card.slot != null) v.slot = card.slot;
  return v;
}

/** Copie des seules valeurs simples d'un objet (pas de cartes, de fonctions ni d'objets). */
const scalars = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x === null || ['number', 'string', 'boolean'].includes(typeof x)));

/**
 * État de la partie vu par `viewer`.
 * `opts.openDecks` : format « deck ouvert », la decklist adverse est montrée (jamais l'ordre).
 */
export function viewFor(g, viewer, handles, { openDecks = false } = {}) {
  const s = g.s;
  // Une carte passée par une zone cachée (pioche, Main adverse…) perd sa poignée, même si on ne la montre pas
  for (const p of s.players) for (const z of ['groupe', 'songe', 'hand']) for (const c of p[z]) if (!isVisible(g, viewer, c)) handles.get(viewer, c, false);
  const card = (c, covered) => cardView(g, viewer, handles, c, isVisible(g, viewer, c, covered));
  const players = s.players.map(p => {
    const mine = p.pid === viewer, covered = coveredSupports(g, p.pid);
    const showLieu = mine || p.lieuRevealed || openDecks;
    const v = {
      pid: p.pid, name: p.name, renommee: p.renommee, gold: p.gold, control: safe(() => g.control(p.pid)),
      lieu: showLieu ? { id: p.lieuId, name: LIEUX[p.lieuId]?.name ?? null, used: [...p.lieuUsed], usedNight: !!p.lieuUsedNight } : null,
      teams: [...p.teams],
      counts: { groupe: p.groupe.length, songe: p.songe.length, hand: p.hand.length },
      hand: mine ? p.hand.map(c => card(c, covered)) : null,
      reserve: p.reserve.map(c => card(c, covered)),
      arena: p.arena.map(c => card(c, covered)),
      supports: g.supportStacks(p.pid).map(pile => pile.map(c => card(c, covered))),
      fosse: p.fosse.map(c => card(c, covered)),
      exil: p.exil.map(c => card(c, covered)),
    };
    if (openDecks && !mine) v.decklist = { lieu: p.deck.lieu, groupe: [...p.deck.groupe].sort(), songe: [...p.deck.songe].sort() };
    return v;
  });

  let combat = null;
  if (s.combat) {
    const c = s.combat;
    combat = { attacker: c.attacker, provoc: !!c.provoc, stage: c.stage ?? null, sides: {}, final: c.final ? { ...c.final } : null, winners: c.winners ? [...c.winners] : null };
    for (const [pid, sd] of Object.entries(c.sides)) {
      const f = g.find(sd.fighter);
      combat.sides[pid] = {
        ...scalars(sd),
        fighter: f ? card(f) : null,
        kicks: sd.kicks.map(k => card(k)),
        hidden: sd.hidden ? card(sd.hidden) : null,
        power: safe(() => g.power(+pid)),
        comboBonus: safe(() => g.comboBonus(+pid)),
      };
    }
  }

  const log = s.log.map(l => ({ night: l.night, pid: l.pid, text: l.to == null || l.to === viewer ? l.text : l.masked }));
  return {
    you: viewer, night: s.night, first: s.first, phase: s.phase, active: s.active ?? null, over: s.over, result: s.result,
    history: s.history.map(x => [...x]), players, combat, log,
  };
}

/** Une carte, un objet du moteur ? (on la reconnaît à sa forme) */
const isCard = x => x && typeof x === 'object' && 'uid' in x && 'owner' in x && 'zone' in x && 'id' in x;

/** Contexte d'une question : valeurs simples et cartes (vues par `viewer`), rien d'autre. */
function cleanCtx(g, viewer, handles, x, depth = 0) {
  if (x === null || ['number', 'string', 'boolean'].includes(typeof x)) return x;
  if (depth > 3 || typeof x !== 'object') return undefined;
  if (isCard(x)) return requestCard(g, viewer, handles, x);
  if (Array.isArray(x)) return x.map(y => cleanCtx(g, viewer, handles, y, depth + 1)).filter(y => y !== undefined);
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === 'uid') continue;
    const y = cleanCtx(g, viewer, handles, v, depth + 1);
    if (y !== undefined) out[k] = y;
  }
  return out;
}

/**
 * Carte citée dans une question. Le joueur qu'on interroge la voit (c'est l'objet du choix : chercher
 * dans son Songe, regarder la 1ʳᵉ carte de son Groupe…), mais une carte de pioche n'a pas de poignée.
 * Une carte adverse cachée reste vierge.
 */
function requestCard(g, viewer, handles, c) {
  if (c.owner !== viewer && !isVisible(g, viewer, c)) return cardView(g, viewer, handles, c, false);
  if (HIDDEN_PILES.has(c.zone)) return cardView(g, viewer, handles, c, true, { noHandle: true });
  return cardView(g, viewer, handles, c, true);
}

/**
 * Question posée à `viewer`, prête à envoyer. Les identifiants d'options sont remplacés par des
 * identifiants opaques (`o0`, `o1`…) ; `map` permet de retrouver la réponse du moteur.
 * Des cartes tirées d'une pioche sont triées par carte : leur ordre trahirait celui de la pioche.
 */
export function requestFor(g, viewer, handles, req, seq) {
  let opts = req.options.map((o, i) => ({ o, i }));
  const fromPile = opts.filter(x => x.o.card && HIDDEN_PILES.has(x.o.card.zone));
  if (fromPile.length > 1 && fromPile.length === opts.filter(x => x.o.card).length) {
    const sorted = [...fromPile].sort((a, b) => String(a.o.card.id).localeCompare(String(b.o.card.id)));
    let k = 0;
    opts = opts.map(x => (x.o.card ? sorted[k++] : x));
  }
  const map = opts.map(x => x.o.id);
  const options = opts.map(({ o }, i) => {
    const v = { id: `o${i}`, label: String(o.label ?? '') };
    if (o.card) v.card = requestCard(g, viewer, handles, o.card);
    if (o.blocked) v.blocked = typeof o.blocked === 'string' ? o.blocked : true;
    if (o.action || String(o.id).startsWith('act:')) v.action = true;
    // Ce que l'interface déduisait des identifiants du moteur, devenus opaques
    if (o.card && (o.id === o.card.uid || o.id === `kick:${o.card.uid}`)) v.pick = true;
    if (['pass', 'end', 'no', 'none'].includes(o.id)) v.pass = true;
    if (o.ev?.label) v.ev = { label: String(o.ev.label) };
    if (o.lieuIndex != null) v.lieuIndex = o.lieuIndex;
    return v;
  });
  const multi = req.max > 1 || req.min === 0;
  return {
    wire: { seq, kind: req.kind, title: String(req.title ?? ''), multi, min: req.min, max: req.max, options, ctx: cleanCtx(g, viewer, handles, req.ctx ?? null) ?? null },
    map,
  };
}
