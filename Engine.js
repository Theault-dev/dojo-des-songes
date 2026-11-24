// ─────────────────────────────────────────────────────────────
// Moteur de règles Dreamland TCG (règles simplifiées v1.1).
// Le moteur est séquentiel et asynchrone : chaque décision est
// demandée à l'agent du joueur (humain ou bot) via `ask`.
// ─────────────────────────────────────────────────────────────
import { CARDS, LIEUX, TEAMS, teamMatches, sharesName } from './data.js';
import * as FX from './effects.js';

export const NIGHTS = 6;
const HAND_DRAW = 7;
const HAND_MAX = 10;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vrai si les Rangs posés couvrent les Rangs requis (★ = joker). */
export function comboSatisfied(required, ranks) {
  const need = { S: 0, M: 0, B: 0 }, have = { S: 0, M: 0, B: 0 };
  required.forEach(r => need[r]++);
  let stars = 0;
  ranks.forEach(r => (r === '★' ? stars++ : r in have && have[r]++));
  let deficit = 0;
  for (const r of ['S', 'M', 'B']) deficit += Math.max(0, need[r] - have[r]);
  return deficit <= stars;
}

/** Deux zones de Soutien : on peut empiler n'importe quel Soutien par-dessus un autre (règles v1.1). */
export const SUPPORT_SLOTS = 2;

export class GameOver extends Error {}

const NIGHT_TMP = ['nightAura', 'protected', 'notInControl', 'cannotFight', 'nightKw', 'nightInciblable', 'auraZero', 'ownLocked'];

export class Game {
  /** decks : deux objets { id, name, lieu, groupe: [ids], songe: [ids] } */
  constructor({ decks, names, agents, seed = Date.now(), onUpdate = () => {}, onEvent = () => {}, first = null, trace = false }) {
    this.onEvent = onEvent;
    this.traceOn = trace; // suivi de diagnostic (hors journal) : coupé dans les mondes simulés
    this.firstChoice = first;
    this.rand = mulberry32(seed);
    // De quoi rejouer la partie à l'identique (bot Expert) : configuration + réponses données
    this.config = { decks, seed, first };
    this.uidSeq = 0;
    this.agents = agents;
    this.onUpdate = onUpdate;
    this.queue = [];
    this.s = {
      night: 0, first: 0, phase: 'Mise en place', combat: null, log: [], over: false, result: null, history: [],
      phaseUsed: new Set(), crepDone: null, answers: [], ar: null, trace: [], fights: [],
      players: [0, 1].map(pid => this.makePlayer(pid, decks[pid], names[pid])),
    };
  }

  // ── Construction ───────────────────────────────────────────
  makePlayer(pid, deck, name) {
    const mk = zone => id => ({ uid: ++this.uidSeq, id, owner: pid, zone, faceDown: false, markers: [], tmp: {} });
    return {
      pid, name, deck, deckId: deck.id, lieuId: deck.lieu, lieuUsed: [false, false, false], lieuUsedNight: false,
      groupe: deck.groupe.map(mk('groupe')), songe: deck.songe.map(mk('songe')),
      hand: [], reserve: [], arena: [], supports: [], fosse: [], exil: [],
      renommee: 0, gold: 0, teams: new Set(),
      nightUsed: new Set(), controlMod: 0, provocUsed: false, fought: new Set(),
      oneMandatory: false, drawTo8: false, lionCurse: false, oppMustRefuse: false, magossVictim: false,
    };
  }

  // ── Accès ─────────────────────────────────────────────────
  p(pid) { return this.s.players[pid]; }
  other(pid) { return 1 - pid; }
  def(card) { return CARDS[card.id]; }
  lieu(pid) { return LIEUX[this.p(pid).lieuId]; }
  label(card) { const d = this.def(card); return d.sub ? `${d.name} (${d.sub})` : d.name; }
  pname(pid) { return this.p(pid).name; }
  lieuActivated(pid) { return this.p(pid).lieuUsed.filter(Boolean).length; }
  get phaseKey() { return `${this.s.night}:${this.s.phase}`; }

  find(uid) {
    for (const p of this.s.players)
      for (const z of ['groupe', 'songe', 'hand', 'reserve', 'arena', 'supports', 'fosse', 'exil']) {
        const c = p[z].find(x => x.uid === uid);
        if (c) return c;
      }
    const c = this.s.combat;
    if (c) for (const sd of Object.values(c.sides)) {
      const k = sd.kicks.find(x => x.uid === uid);
      if (k) return k;
      if (sd.hidden?.uid === uid) return sd.hidden;
    }
    return null;
  }

  keywords(card) {
    if (card.faceDown) return []; // une carte retournée est une carte vierge : ni nom, ni Aura, ni mot-clé
    const d = this.def(card), p = this.p(card.owner), kw = [...d.kw];
    if (d.type === 'P') {
      for (const [sup, team] of Object.entries(TEAMS))
        if (p.teams.has(team.kw) && teamMatches(team, d) && !kw.includes(team.kw)) kw.push(team.kw);
      if (card.tmp.nightKw) kw.push(...card.tmp.nightKw);
      if (card.tmp.larbin) kw.push('LARBIN');
      const sd = this.s.combat?.sides[card.owner];
      if (sd?.extraKw && sd.fighter === card.uid) kw.push(...sd.extraKw);
    }
    return [...new Set(kw)];
  }
  hasKw(card, kw) { return !!card && this.keywords(card).includes(kw); }

  aura(card) {
    const d = this.def(card);
    if (card.faceDown || card.tmp.auraZero) return 0;
    const m = card.markers.reduce((a, x) => a + x.v, 0) + (card.tmp.nightAura || 0);
    return Math.max(0, (d.aura ?? 0) + m);
  }

  visibleArena(pid) { return this.p(pid).arena.filter(c => !c.faceDown); }
  /**
   * Piles de Soutiens, une par zone dédiée : la dernière carte posée est au-dessus, les autres sont
   * recouvertes et comptent comme face cachée. Si celle du dessus part, la suivante redevient visible.
   */
  supportStacks(pid) {
    const piles = Array.from({ length: SUPPORT_SLOTS }, () => []);
    for (const c of this.p(pid).supports) piles[c.slot ?? 0].push(c);
    return piles.filter(s => s.length);
  }
  /** Soutiens visibles : le dessus de chaque pile, s'il n'est pas face cachée. */
  visibleSupports(pid) { return this.supportStacks(pid).map(s => s[s.length - 1]).filter(c => !c.faceDown); }
  hasSupport(pid, id) { return this.visibleSupports(pid).find(c => c.id === id) ?? null; }
  control(pid) {
    const sum = this.visibleArena(pid).filter(c => !c.tmp.notInControl).reduce((a, c) => a + this.aura(c), 0);
    return Math.max(0, sum + this.p(pid).controlMod);
  }

  // ── Journal / événements / agents ─────────────────────────
  emit(type, data = {}) { try { this.onEvent(type, data); } catch (e) { /* l'interface ne bloque jamais le moteur */ } }

  log(text, pid = null) {
    this.s.log.push({ night: this.s.night, text, pid });
    this.onUpdate();
  }

  /** Suivi de diagnostic : une ligne compacte, jamais affichée dans le journal de partie. */
  trace(text) { if (this.traceOn) this.s.trace.push(`N${this.s.night} ${this.s.phase} | ${text}`); }

  /** État des deux joueurs (Main comprise : c'est un outil de mise au point, pas une vue de partie). */
  traceState(tag, hand = true) {
    if (!this.traceOn) return;
    const nm = c => `${c.faceDown ? '▼' : ''}${this.def(c).name}[${this.aura(c)}]`;
    const L = cs => cs.map(nm).join(' ') || '—';
    for (const pid of [0, 1]) {
      const p = this.p(pid);
      this.trace(`${tag} ${p.name} R${p.renommee} | Arène ${L(p.arena)} | Réserve ${L(p.reserve)}${hand ? ` | Main ${p.hand.map(c => this.def(c).name).join(', ') || '—'}` : ''} | Songe ${p.songe.length}`);
    }
  }

  /** Rapport de diagnostic : de quoi rejouer la partie (configuration + réponses) et la lire (suivi + journal). */
  report() {
    return { v: 1, config: this.config, answers: this.s.answers, result: this.s.result, trace: this.s.trace, log: this.s.log.map(l => `N${l.night} ${l.text}`) };
  }

  /** Demande une décision. `options` = [{id, label, card?}] ; renvoie un id (ou un tableau si multi). */
  async ask(pid, req) {
    req = { min: 1, max: 1, ...req };
    if (req.max === 1 && req.options.length === 1 && req.min === 1 && !req.forcePrompt) return req.options[0].id;
    this.onUpdate();
    const ans = await this.agents[pid].ask(this, pid, req);
    this.s.answers.push(ans);
    if (this.traceOn) {
      const lab = id => req.options.find(o => o.id === id)?.label ?? id;
      this.trace(`#${this.s.answers.length - 1} ${this.p(pid).name} ${req.kind} → ${[].concat(ans).map(lab).join(' + ') || '—'} (${req.options.length} options)`);
    }
    return ans;
  }

  async chooseCard(pid, kind, title, cards, { optional = false, ctx } = {}) {
    if (!cards.length) return null;
    const options = cards.map(c => ({ id: c.uid, label: this.label(c), card: c }));
    if (optional) options.push({ id: 'none', label: 'Aucune' });
    const id = await this.ask(pid, { kind, title, options, ctx, forcePrompt: optional });
    return id === 'none' ? null : cards.find(c => c.uid === id);
  }

  /** Choix de plusieurs cartes. Le résultat suit l'ordre dans lequel le joueur les a désignées. */
  async chooseCards(pid, kind, title, cards, min, max, { ctx } = {}) {
    if (!cards.length || max === 0) return [];
    const options = cards.map(c => ({ id: c.uid, label: this.label(c), card: c }));
    const ids = await this.ask(pid, { kind, title, options, ctx, min, max: Math.min(max, cards.length), forcePrompt: true });
    const byUid = new Map(cards.map(c => [c.uid, c]));
    const out = [];
    for (const id of [].concat(ids)) { const c = byUid.get(id); if (c && !out.includes(c)) out.push(c); }
    return out;
  }

  async chooseOption(pid, kind, title, options, ctx) {
    return this.ask(pid, { kind, title, options, ctx, forcePrompt: true });
  }

  async chooseRank(pid, title, exclude = null, card = null) {
    const ranks = ['S', 'M', 'B', '★'].filter(r => r !== exclude);
    return this.chooseOption(pid, 'rank', title, ranks.map(r => ({ id: r, label: `Rang ${r}` })), { card });
  }

  roll(pid, label) {
    const v = 1 + Math.floor(this.rand() * 6);
    this.log(`${label} : le dé donne ${v}.`, pid);
    this.emit('dice', { pid, v });
    return v;
  }

  // ── Mouvements de cartes ──────────────────────────────────
  remove(card) {
    if (card.zone === 'kicks') {
      const sd = this.s.combat?.sides[card.owner];
      if (sd) sd.kicks = sd.kicks.filter(k => k !== card);
    } else if (card.zone === 'hidden') {
      const sd = this.s.combat?.sides[card.owner];
      if (sd?.hidden === card) sd.hidden = null;
    } else {
      const z = this.p(card.owner)[card.zone];
      const i = z.indexOf(card);
      if (i >= 0) z.splice(i, 1);
    }
  }

  reset(card) { card.faceDown = false; card.markers = []; card.tmp = {}; delete card.byEffectNight; }

  put(card, zone, { bottom = false } = {}) {
    if (card.zone === 'arena' && zone !== 'arena' && this.hasKw(card, 'ATTILA BAND'))
      this.queue.push(() => FX.onAttilaLeaves(this, card.owner, card));
    this.remove(card);
    this.reset(card);
    card.zone = zone;
    const z = this.p(card.owner)[zone];
    bottom ? z.unshift(card) : z.push(card);
  }

  /** Résout les déclencheurs mis en attente pendant un déplacement de carte. */
  async flush() {
    while (this.queue.length) await this.queue.shift()();
  }

  /** Vrai si un effet de `by` ne peut pas déplacer ce Perso (Tempo Temperus). */
  isProtected(card, by) {
    if (by == null || by === card.owner || !card.tmp.protected) return false;
    this.log(`${this.label(card)} est protégé par Tempo Temperus.`, card.owner);
    return true;
  }

  underGroupe(card, by) {
    if (this.isProtected(card, by)) return false;
    this.put(card, 'groupe', { bottom: true });
    this.log(`${this.label(card)} retourne sous le Groupe.`, card.owner);
    return true;
  }
  toReserve(card, by) {
    if (this.isProtected(card, by)) return false;
    this.put(card, 'reserve');
    this.log(`${this.label(card)} retourne dans la Réserve.`, card.owner);
    return true;
  }
  /**
   * `ownCost` : l'exil est le coût de la capacité de la carte elle-même (Alana & Huam qui contre) ;
   * son effet « quand cette carte est exilée » fait alors partie de la même activation (R39).
   */
  exile(card, by, { self = false, ownCost = false } = {}) {
    // Le mot-clé « Flocons » reste, mais l'effet d'En mission pour la Reine exige le Soutien visible
    if (self && this.hasKw(card, 'FLOCONS') && this.hasSupport(card.owner, 'EN_MISSION')) return this.underGroupe(card, null);
    if (this.isProtected(card, by)) return false;
    this.put(card, 'exil');
    this.log(`${this.label(card)} est exilé.`, card.owner);
    if (card.id === 'ALANA_HUAM' && !ownCost) this.queue.push(() => FX.onAlanaHuamExiled(this, card.owner, card));
    return true;
  }
  flipDown(card) {
    card.faceDown = true;
    card.markers = [];
    this.log(`${this.label(card)} est retourné face cachée.`, card.owner);
  }
  discard(card) { this.put(card, 'fosse'); }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /** Pioche avec la règle du Songe vide : on reconstitue avec la Fosse et on arrête de piocher. */
  draw(pid, n) {
    const p = this.p(pid);
    if (this.s.combat?.sides[pid]?.noDraw) { this.log(`${p.name} ne peut pas piocher (Projection de pics).`, pid); return 0; }
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (!p.songe.length) { this.reshuffle(pid); break; }
      const c = p.songe.pop();
      c.zone = 'hand';
      p.hand.push(c);
      drawn++;
      if (!p.songe.length) { this.reshuffle(pid); break; }
    }
    return drawn;
  }
  reshuffle(pid) {
    const p = this.p(pid);
    if (!p.fosse.length) return;
    p.fosse.forEach(c => { this.reset(c); c.zone = 'songe'; });
    p.songe.push(...p.fosse);
    p.fosse = [];
    this.shuffle(p.songe);
    this.log(`${p.name} reconstitue son Songe avec sa Fosse.`, pid);
    this.emit('reshuffle', { pid });
  }

  recruit(pid, card = null) {
    const p = this.p(pid);
    card ??= p.groupe[p.groupe.length - 1];
    if (!card) return null;
    this.put(card, 'reserve');
    this.log(`${p.name} recrute ${this.label(card)}.`, pid);
    return card;
  }

  async searchSonge(pid, filter, title) {
    const p = this.p(pid);
    const cands = p.songe.filter(c => filter(this.def(c)));
    const uniq = [...new Map(cands.map(c => [c.id, c])).values()];
    const pick = await this.chooseCard(pid, 'search', title, uniq);
    if (pick) { this.put(pick, 'hand'); this.log(`${p.name} ajoute ${this.label(pick)} à sa Main.`, pid); }
    this.shuffle(p.songe);
    return pick;
  }

  /** L'adversaire défausse une carte de sa Main (sauf protection Projection de pics). */
  async forceDiscard(victim) {
    if (this.s.combat?.sides[victim]?.noDiscardByOpp) { this.log(`${this.pname(victim)} est protégé des défausses.`, victim); return; }
    const c = await this.chooseCard(victim, 'discardOwn', 'Défaussez une carte de votre Main', this.p(victim).hand);
    if (c) { this.discard(c); this.log(`${this.pname(victim)} défausse ${this.label(c)}.`, victim); }
  }

  gainGold(pid, n) {
    if (n <= 0) return;
    this.p(pid).gold += n;
    this.log(`${this.pname(pid)} gagne ${n} pièce${n > 1 ? 's' : ''} d'or (${this.p(pid).gold}).`, pid);
  }
  gainFame(pid, n, why = '') {
    const p = this.p(pid);
    p.renommee = Math.max(0, p.renommee + n);
    this.log(`${p.name} ${n >= 0 ? 'gagne' : 'perd'} ${Math.abs(n)} de Renommée${why ? ` (${why})` : ''}.`, pid);
  }

  // ── Capacités, contres, ciblage ───────────────────────────
  usedTonight(pid, key) { return this.p(pid).nightUsed.has(key); }
  markUsed(pid, key) { this.p(pid).nightUsed.add(key); }
  usedThisPhase(key) { return this.s.phaseUsed.has(`${this.phaseKey}|${key}`); }
  markPhase(key) { this.s.phaseUsed.add(`${this.phaseKey}|${key}`); }

  /** Un Perso peut-il activer sa capacité maintenant ? (Arène, visible, Big Nova Bang) */
  persoCanAct(card) {
    if (card.zone !== 'arena' || card.faceDown) return false;
    const c = this.s.combat;
    if (c?.restrict?.[card.owner] && !this.isFighter(card)) return false;
    return true;
  }

  /** Fan Boy : ce Perso ne peut pas activer une capacité qui le renvoie, l'exile, l'échange ou le retourne. */
  fanboyLocked(card) {
    const by = card.tmp.fanboyBy;
    return by != null && this.visibleArena(by).some(c => c.id === 'FANBOY');
  }

  /**
   * Active une capacité : propose un contre à l'adversaire, puis résout le texte.
   * Le coût (exil, défausse…) doit avoir été payé avant l'appel.
   * `felin` ({ values }) : la capacité contient un choix Accepter / Refuser ; Young Infinity et Rafaelo
   * se décident à l'annonce, avant la fenêtre de réponse (R58).
   */
  async activate(pid, source, label, fn, { isCombo = false, felin = null } = {}) {
    this.log(`${this.pname(pid)} active ${label}.`, pid);
    await this.flush();
    const ar = felin ? await this.preAcceptRefuse(pid, label, felin) : null;
    const countered = await this.offerCounter(this.other(pid), { kind: isCombo ? 'combo' : 'capacity', by: pid, source, label });
    if (countered) { this.log(`${label} est contré.`, pid); await this.flush(); return false; }
    const prev = this.s.ar;
    this.s.ar = ar;
    try { await fn(); } finally { this.s.ar = prev; }
    await this.flush();
    await this.checkCombos();
    return true;
  }

  /**
   * Propose à `pid` ses contres disponibles pour l'événement. Renvoie vrai si contré.
   * Un contre est une réponse : il ne peut pas être contré à son tour (R1).
   */
  async offerCounter(pid, ev) {
    const opts = FX.counterOptions(this, pid, ev);
    if (!opts.length) return false;
    const choice = await this.chooseOption(pid, 'counter', `Contrer « ${ev.label} » ?`, [
      ...opts.map(o => ({ id: o.id, label: o.label, card: o.card, ev })),
      { id: 'no', label: 'Ne pas contrer' },
    ]);
    const o = opts.find(x => x.id === choice);
    if (!o) return false;
    this.log(`${this.pname(pid)} contre avec ${o.label}.`, pid);
    this.emit('counter', { pid, label: o.label });
    await o.pay();
    await this.flush();
    await o.after?.();
    await this.flush();
    return true;
  }

  /**
   * Young Infinity / Rafaelo : décisions prises à l'annonce de la capacité « Félin » de `actor` (R58).
   * Renvoie { both } (Accepter ET Refuser), { self } (on choisit à la place de l'adversaire) ou {}.
   * Si la capacité est contrée, Young Infinity retourne quand même dans la Réserve en fin de phase.
   */
  async preAcceptRefuse(actor, label, { values = { accept: 0, refuse: 0 } } = {}) {
    const p = this.p(actor);
    if (p.oppMustRefuse) return {};
    const yi = this.visibleArena(actor).find(c => c.id === 'YOUNG_INF' && this.persoCanAct(c));
    if (yi && !this.usedTonight(actor, "L'aîné Midas")) {
      const ans = await this.chooseOption(actor, 'youngInf', `Young Infinity : obtenir Accepter ET Refuser pour « ${label} » ?`,
        [{ id: 'yes', label: 'Oui, les deux (Young Infinity retourne en Réserve)' }, { id: 'no', label: 'Non' }], { values });
      if (ans === 'yes') {
        this.markUsed(actor, "L'aîné Midas");
        yi.tmp.returnEndPhase = true;
        this.log(`${this.pname(actor)} active L'aîné Midas (Young Infinity).`, actor);
        return { both: true };
      }
    }
    const rafaelo = this.visibleArena(actor).find(c => c.id === 'RAFAELO' && this.persoCanAct(c));
    if (this.s.combat?.chooseFor !== actor && rafaelo && !this.usedTonight(actor, 'Roi des chats')) {
      const ans = await this.chooseOption(actor, 'rafaelo', `Rafaelo (1×/nuit) : choisir vous-même pour « ${label} » ?`,
        [{ id: 'yes', label: 'Oui, je choisis à sa place' }, { id: 'no', label: "Non, l'adversaire choisit" }], { values });
      if (ans === 'yes') {
        this.markUsed(actor, 'Roi des chats');
        this.log(`${this.pname(actor)} choisit à la place de l'adversaire (Rafaelo).`, actor);
        return { self: true };
      }
    }
    return {};
  }

  /**
   * Choix Accepter / Refuser d'une carte « Félin » activée par `actor`.
   * `values` = intérêt pour `actor` de chaque option (aide le bot). Renvoie 'accept', 'refuse' ou 'both'.
   */
  async acceptRefuse(actor, label, acceptText, refuseText, values = { accept: 0, refuse: 0 }) {
    const victim = this.other(actor), p = this.p(actor);
    let pre = this.s.ar;
    this.s.ar = null;
    if (p.oppMustRefuse) {
      p.oppMustRefuse = false;
      this.log(`${this.pname(victim)} doit Refuser (Négociation féroce).`, victim);
      return 'refuse';
    }
    // Hors d'une activation annoncée (Griffes empoisonnées à l'Aurore, Saturn) : on décide ici, sans fenêtre de réponse
    pre ??= await this.preAcceptRefuse(actor, label, { values });
    if (pre.both) {
      this.log(`${this.pname(actor)} obtient Accepter et Refuser (Young Infinity).`, actor);
      this.fiestaDraw(actor);
      return 'both';
    }
    const chooseSelf = !!pre.self || this.s.combat?.chooseFor === actor;
    const chooser = chooseSelf ? actor : victim;
    const ans = await this.chooseOption(chooser, 'acceptRefuse', `${label} : Accepter ou Refuser ?`, [
      { id: 'accept', label: `Accepter : ${acceptText}` }, { id: 'refuse', label: `Refuser : ${refuseText}` }], { actor, values });
    this.log(`${this.pname(chooser)} choisit ${ans === 'accept' ? 'Accepter' : 'Refuser'}.`, chooser);
    this.fiestaDraw(actor);
    return ans;
  }

  /**
   * Fiesta féline : se déclenche aussi avec Rafaelo (choix à la place de l'adversaire)
   * et Young Infinity (l'adversaire est obligé de choisir les deux) — décisions d'arbitrage.
   */
  fiestaDraw(actor) {
    if (!this.hasSupport(actor, 'FIESTA') || this.usedThisPhase(`fiesta${actor}`)) return;
    this.markPhase(`fiesta${actor}`);
    this.draw(actor, 1);
    this.log(`${this.pname(actor)} pioche une carte (Fiesta féline).`, actor);
  }

  /** Vrai si `card` ne peut pas être ciblé par `actor`. */
  isInciblable(card, actor) {
    if (card.faceDown) return true;
    if (card.owner === actor) return false;
    if (card.tmp.inciblable || card.tmp.nightInciblable) return true;
    const sd = this.s.combat?.sides[card.owner];
    if (!sd) return false;
    const f = this.fighter(card.owner);
    if (f?.id === 'GERIKO3' && (card === f || card.zone === 'kicks')) return true;
    if (card.zone === 'kicks') {
      if (sd.gerikoFirstTwo && sd.kicks.indexOf(card) < 2) return true;
      if (card.shielded) return true;
    }
    return false;
  }

  /**
   * `actor` cible une carte parmi `cards`. Si la carte appartient à l'adversaire,
   * celui-ci peut la rediriger (Huam) et Piège incendiaire se renforce.
   */
  async target(actor, cards, title, { optional = false, purpose } = {}) {
    const valid = cards.filter(c => !this.isInciblable(c, actor));
    let t = await this.chooseCard(actor, 'target', title, valid, { optional, ctx: { purpose } });
    if (!t || t.owner === actor) return t;
    t = await FX.onTargeted(this, actor, t, valid);
    return t;
  }

  // ── Combat : accès ────────────────────────────────────────
  side(pid) { return this.s.combat?.sides[pid]; }
  fighter(pid) { const sd = this.side(pid); return sd ? this.find(sd.fighter) : null; }
  isFighter(card) { const sd = this.side(card.owner); return !!sd && sd.fighter === card.uid; }
  ownKicks(pid) { return this.side(pid)?.kicks ?? []; }
  kickHasKw(k, kw) { return this.def(k).kw.includes(kw); }
  isBase(k) { return this.def(k).kw.includes('BASE'); }
  lastKick(pid) { const ks = this.ownKicks(pid); return ks[ks.length - 1] ?? null; }

  /** Le combattant remplit la condition de mot-clé du Kick. */
  kickCondMet(k) {
    const d = this.def(k);
    if (d.kw.includes('BASE')) return true;
    const f = this.fighter(k.owner);
    if (!f) return false;
    const kw = this.keywords(f);
    return d.kw.some(x => kw.includes(x));
  }
  kickActive(k) { return !k.countered && !k.silenced && this.kickCondMet(k); }

  addMarker(card, v, src) {
    card.markers.push({ v, src });
    const sign = v >= 0 ? `+${v}` : `${v}`;
    this.log(`${this.label(card)} reçoit [${sign}].`, card.owner);
  }

  damageCardsVisible() {
    let n = 0;
    for (const pid of [0, 1]) {
      n += this.visibleArena(pid).filter(c => this.def(c).abType === 'DÉGÂT').length;
      n += this.ownKicks(pid).filter(k => this.def(k).abType === 'DÉGÂT').length;
    }
    return n;
  }

  /**
   * Marqueurs [+X] « continus » d'un Kick : ceux du texte officiel qui s'appliquent « tant que » une condition
   * dure (Première Flamme, Boule de Feu, Fureur du dragon, Virtuosité, Déviation sonique adverse, effets de
   * combat des Persos, et le marqueur propre du Kick). Calculés à la volée, à leur valeur du moment.
   * Renvoie [{ v, label }].
   */
  contMarkers(k) {
    const c = this.s.combat, sd = c.sides[k.owner], os = c.sides[this.other(k.owner)];
    const d = this.def(k), out = [];
    let boules = 0, fureurs = 0, virt = false;
    for (const kk of sd.kicks) {
      if (!this.kickActive(kk)) continue;
      if (kk.id === 'PREMIERE_FLAMME' && d.kw.includes('FEU')) out.push({ v: 1, label: this.def(kk).name });
      if (kk.id === 'BOULE_FEU' && boules < 2) { boules++; if (k.rang === 'M') out.push({ v: 1, label: this.def(kk).name }); }
      if (kk.id === 'FUREUR' && fureurs < 2) { fureurs++; if (this.isInciblable(k, this.other(k.owner))) out.push({ v: 1, label: this.def(kk).name }); }
      if (kk.id === 'VIRTUOSITE' && kk.virtRank && !virt) { virt = true; if (k.rang === kk.virtRank) out.push({ v: 2, label: this.def(kk).name }); }
    }
    // Déviation sonique adverse : les Kicks du Rang ciblé reçoivent −1 (2 activations max)
    let devs = 0;
    for (const kk of os.kicks) {
      if (kk.id !== 'DEVIATION' || !this.kickActive(kk) || !kk.devRank || devs >= 2) continue;
      devs++;
      if (k.rang === kk.devRank) out.push({ v: -1, label: this.def(kk).name });
    }
    // Marqueur propre du Kick (Libérer son potentiel, Blocage, Piège incendiaire…)
    const own = this.liveMarker(k);
    if (own) out.push({ v: own, label: this.def(k).name });
    // Effets de combat des Persos (Epony, Terrence, Maniac, Angélito…)
    for (const e of sd.effects) {
      if (e.rang && k.rang === e.rang) out.push({ v: e.v, label: e.label });
      if (e.kws && d.kw.some(w => e.kws.includes(w))) out.push({ v: e.v, label: e.label });
    }
    return out;
  }

  /** Force globale d'un Kick posé. */
  kickForce(k) {
    let f = k.base + k.markers.reduce((a, m) => a + m.v, 0);
    for (const m of this.contMarkers(k)) f += m.v;
    if (k.cap != null) f = Math.min(f, k.cap);
    return Math.max(0, f);
  }

  /**
   * Marqueurs de Force que le joueur de `k` peut copier avec Envie de sang (R68) : ceux posés sur ses autres
   * Kicks et les marqueurs continus du texte officiel, à leur valeur du moment. Renvoie [{ kick, v, label }].
   */
  copyableMarkers(k) {
    const out = [];
    for (const x of this.ownKicks(k.owner)) {
      if (x === k) continue;
      for (const m of x.markers) if (m.v) out.push({ kick: x, v: m.v, label: 'posé' });
      for (const m of this.contMarkers(x)) if (m.v) out.push({ kick: x, v: m.v, label: m.label });
    }
    return out;
  }

  /**
   * Valeur du marqueur continu d'un Kick (Libérer son potentiel, Blocage, Piège incendiaire…).
   * Sur la carte c'est un marqueur [+X] : Envie de sang peut donc le copier.
   */
  liveMarker(k) {
    if (!this.kickActive(k)) return 0;
    const c = this.s.combat, sd = c?.sides[k.owner], os = c?.sides[this.other(k.owner)];
    if (!sd) return 0;
    const fk = this.fighter(k.owner);
    switch (k.id) {
      case 'PIEGE': return Math.min(3, k.piege || 0);
      case 'LIBERER': {
        const fkw = fk ? this.keywords(fk) : [];
        return Math.min(3, sd.kicks.filter(x => this.def(x).kw.some(w => fkw.includes(w))).length);
      }
      case 'BLOCAGE': return Math.min(3, os.realPosed);
      case 'ATTAQUE_TITANS': return Math.min(3, this.damageCardsVisible());
      case 'ETALE': return sd.realPosed < sd.max ? 3 : 0;
      case 'FOU_RAGE': {
        const ranks = sd.kicks.map(x => x.rang).filter(r => r);
        return ranks.some((r, i) => ranks.indexOf(r) !== i) ? 2 : 0;
      }
    }
    return 0;
  }

  comboBonus(pid) {
    const sd = this.side(pid), f = this.fighter(pid);
    if (sd.comboZero) return 0;
    let base = sd.comboOverride ?? this.def(f).combo?.bonus ?? 0;
    if (f.id === 'DJKILLA3' && sd.comboOverride == null) base = this.lieuActivated(0) + this.lieuActivated(1);
    return base + sd.comboExtra;
  }

  power(pid) {
    const sd = this.side(pid);
    let total = sd.kicks.reduce((a, k) => a + this.kickForce(k), 0);
    if (sd.comboActive) total += this.comboBonus(pid);
    return Math.max(0, total + sd.puissanceMod);
  }

  // ── Partie ────────────────────────────────────────────────
  async run() {
    try {
      await this.setup();
      for (let n = 1; n <= NIGHTS; n++) await this.playNight(n);
      this.endGame();
    } catch (e) {
      if (!(e instanceof GameOver)) throw e;
    }
    this.onUpdate();
    return this.s.result;
  }

  async setup() {
    this.s.first = this.firstChoice ?? (this.rand() < 0.5 ? 0 : 1);
    for (const pid of [0, 1]) {
      const p = this.p(pid);
      this.shuffle(p.groupe);
      this.shuffle(p.songe);
      const persos = p.groupe.splice(-3);
      const songe = p.songe.splice(-HAND_DRAW);
      [...persos, ...songe].forEach(c => { c.zone = 'hand'; p.hand.push(c); });
    }
    this.log(`${this.pname(this.s.first)} commence (premier Crépuscule et première Baston).`);
    // R69/R70 : deux mulligans partiels (Songe puis Persos) ; le premier joueur fait les deux, puis l'adversaire
    this.s.phase = 'Mulligan';
    for (const pid of [this.s.first, this.other(this.s.first)]) {
      await this.mulligan(pid, false);
      await this.mulligan(pid, true);
    }
    for (const pid of [0, 1]) {
      const p = this.p(pid);
      p.hand.filter(c => this.def(c).type === 'P').forEach(c => this.put(c, 'reserve'));
      this.log(`${p.name} révèle son Lieu : ${this.lieu(pid).name}.`, pid);
    }
  }

  /**
   * Mulligan partiel (R69) : les Persos (3 cartes) ou le Songe (7 cartes) de la Main.
   * Les cartes choisies retournent sous leur pile dans l'ordre où le joueur les a désignées (la première
   * passe sous la pile en premier, la dernière se retrouve tout en bas), puis on repioche. L'adversaire
   * ne voit que le nombre de cartes remises (R53).
   */
  async mulligan(pid, persos) {
    const p = this.p(pid);
    const isP = c => (this.def(c).type === 'P') === persos;
    const pile = persos ? 'groupe' : 'songe', want = persos ? 3 : HAND_DRAW;
    const cards = p.hand.filter(isP);
    if (!cards.length) return;
    const title = persos
      ? 'Mulligan des Persos : choisissez, dans l\'ordre, les cartes à remettre sous le Groupe (aucune pour garder)'
      : 'Mulligan du Songe : choisissez, dans l\'ordre, les cartes à remettre sous le Songe (aucune pour garder)';
    const back = await this.chooseCards(pid, 'mulligan', title, cards, 0, cards.length, { ctx: { zone: pile } });
    if (!back.length) return;
    for (const c of back) this.put(c, pile, { bottom: true });
    while (p.hand.filter(isP).length < want && p[pile].length) { const c = p[pile].pop(); c.zone = 'hand'; p.hand.push(c); }
    this.log(`${p.name} remet ${back.length} carte${back.length > 1 ? 's' : ''} sous son ${persos ? 'Groupe' : 'Songe'} (mulligan).`, pid);
  }

  async playNight(n) {
    this.s.night = n;
    const a = this.s.first, b = this.other(a);
    this.log(`══ Nuit ${n} ══`);
    this.s.phase = 'Début de nuit';
    this.traceState('début', false);
    this.emit('night', { n });
    await this.crepuscule(a);
    await this.crepuscule(b);
    await this.baston(a);
    await this.baston(b);
    await this.aurore();
    await this.endOfNight();
  }

  /** Fin de phase : Young Infinity retourne en Réserve s'il a donné Accepter et Refuser. */
  async endPhase() {
    for (const pid of [0, 1])
      for (const c of [...this.p(pid).arena])
        if (c.tmp.returnEndPhase) this.toReserve(c, null);
    await this.flush();
  }

  // ── Crépuscule ────────────────────────────────────────────
  async crepuscule(pid) {
    const p = this.p(pid);
    this.s.phase = `Crépuscule — ${p.name}`;
    this.log(`── Crépuscule — ${p.name}`);
    this.s.active = pid;
    // Fan Boy : son verrou dure jusqu'au prochain Crépuscule de son propriétaire
    for (const c of this.p(this.other(pid)).arena) if (c.tmp.fanboyBy === pid) delete c.tmp.fanboyBy;

    const flip = () => {
      for (const c of [...p.arena, ...p.reserve, ...p.supports]) {
        if (!c.faceDown) continue;
        if (c.tmp.lockFaceDown) { c.tmp.lockFaceDown = false; continue; }
        c.faceDown = false;
      }
    };
    const recruit = () => this.recruit(pid);
    const draw = () => {
      const target = p.drawTo8 ? 8 : HAND_DRAW;
      p.drawTo8 = false;
      const need = target - p.hand.length;
      if (need > 0) this.draw(pid, need);
    };
    if (p.oneMandatory) {
      p.oneMandatory = false;
      const ans = await this.chooseOption(pid, 'oneMandatory', 'Fulguro Flash : une seule action obligatoire ce Crépuscule', [
        { id: 'flip', label: 'Retourner face visible vos cartes' }, { id: 'recruit', label: 'Recruter une carte' }, { id: 'draw', label: 'Piocher jusqu’à 7' }]);
      ({ flip, recruit, draw })[ans]();
      this.log(`${p.name} ne fait qu'une action obligatoire (Fulguro Flash).`, pid);
    } else { flip(); recruit(); draw(); }

    this.s.crepDone = { enter: false, support: false };
    for (let guard = 0; guard < 40; guard++) {
      const done = this.s.crepDone;
      const opts = [];
      const enterable = p.reserve.filter(c => !c.faceDown && this.aura(c) <= this.s.night);
      if (!done.enter && enterable.length) opts.push({ id: 'enter', label: "Entrer dans l'Arène" });
      const sups = p.hand.filter(c => this.def(c).type === 'S' && this.canPoseSupport(pid, c));
      if (!done.support && sups.length) opts.push({ id: 'support', label: 'Soutenir' });
      const acts = FX.actionsFor(this, pid, 'crepuscule');
      acts.forEach((x, i) => opts.push({ id: `act:${i}`, label: x.label, card: x.card, lieuIndex: x.lieuIndex, blocked: x.blocked }));
      opts.push({ id: 'end', label: 'Terminer le Crépuscule' });
      const ans = await this.chooseOption(pid, 'crepuscule', 'Crépuscule : vos actions', opts);
      if (ans === 'end') break;
      if (ans === 'enter') { done.enter = true; await this.enterArenaAction(pid); }
      else if (ans === 'support') { done.support = true; await this.supportAction(pid); }
      else if (ans.startsWith('act:')) await acts[+ans.slice(4)].run();
      await this.flush();
    }
    await this.endPhase();
  }

  async enterArenaAction(pid) {
    const p = this.p(pid);
    const cands = p.reserve.filter(c => !c.faceDown && this.aura(c) <= this.s.night);
    let chosen;
    for (let tries = 0; ; tries++) {
      chosen = await this.chooseCards(pid, 'enter', `Entrer dans l'Arène (somme des Auras ≤ ${this.s.night})`, cands, 0, cands.length);
      const sum = chosen.reduce((a, c) => a + this.aura(c), 0);
      // R40 : deux Persos qui partagent un nom (Huam / Alana & Huam…) ne peuvent pas entrer ensemble
      const dup = chosen.some((a, i) => chosen.some((b, j) => i < j && sharesName(this.def(a), this.def(b))));
      if (sum <= this.s.night && !dup) break;
      this.log(`Sélection invalide (Aura totale ${sum} ou nom en double), recommencez.`, pid);
      if (tries > 20) { chosen = []; break; }
    }
    await this.enterArena(pid, chosen);
  }

  /** Fait entrer des Persos (sans contrainte d'Aura) et applique la règle du nom unique (R40). */
  async enterArena(pid, cards) {
    const p = this.p(pid);
    for (const c of cards) {
      this.put(c, 'arena');
      this.log(`${p.name} fait entrer ${this.label(c)} dans l'Arène.`, pid);
    }
    for (const c of cards) {
      if (c.zone !== 'arena') continue;
      const same = p.arena.filter(x => !x.faceDown && sharesName(this.def(x), this.def(c)));
      if (same.length > 1) {
        const keep = await this.chooseCard(pid, 'keepSameName', `Nom en double : quel Perso reste dans l'Arène (${this.def(c).name}) ?`, same);
        same.filter(x => x !== keep).forEach(x => this.toReserve(x, null));
      }
    }
    await this.flush();
    for (const c of cards) if (c.zone === 'arena') await FX.onEnter(this, pid, c);
  }

  async supportAction(pid) {
    const p = this.p(pid);
    const cands = p.hand.filter(c => this.def(c).type === 'S');
    const chosen = await this.chooseCards(pid, 'support', 'Soutenir : posez jusqu’à 2 Soutiens (2 zones ; un Soutien posé sur un autre le recouvre)', cands, 0, 2);
    for (const c of chosen) await this.poseSupport(pid, c);
  }

  /** Tout Soutien peut être posé : il recouvre une pile si les deux zones sont prises. */
  canPoseSupport() { return true; }

  /** `byEffect` : posé par un effet (Angélito via Sacha, carte révélée par Dolche) : inactivable cette nuit. */
  async poseSupport(pid, c, { byEffect = false } = {}) {
    const p = this.p(pid);
    const piles = Array.from({ length: SUPPORT_SLOTS }, (_, i) => p.supports.filter(x => x.slot === i));
    const top = i => piles[i][piles[i].length - 1];
    // Un Soutien identique va sur sa pile (deux identiques ne peuvent pas être visibles ensemble)
    let slot = piles.findIndex((pl, i) => pl.length && top(i).id === c.id);
    const same = slot >= 0;
    if (!same) slot = piles.findIndex(pl => !pl.length);
    if (slot < 0) {
      const opts = piles.map((pl, i) => ({ id: `slot${i}`, label: `Recouvrir ${this.label(top(i))}`, card: top(i) }));
      const ans = await this.chooseOption(pid, 'supportSlot', `Les deux zones de Soutien sont prises : quel Soutien recouvrir avec ${this.label(c)} ?`, opts, { card: c });
      slot = +String(ans).slice(4) || 0;
    }
    const covered = piles[slot].length ? top(slot) : null;
    this.put(c, 'supports');
    c.slot = slot;
    if (byEffect) c.byEffectNight = this.s.night;
    if (same) { this.log(`${p.name} empile ${this.label(c)} (pile de ${piles[slot].length + 1}).`, pid); return; }
    this.log(covered ? `${p.name} pose ${this.label(c)} par-dessus ${this.label(covered)} (recouvert).` : `${p.name} pose le Soutien ${this.label(c)}.`, pid);
    await FX.onSupportPosed(this, pid, c);
  }

  // ── Baston ────────────────────────────────────────────────
  async baston(pid) {
    const p = this.p(pid);
    this.s.phase = `Baston — ${p.name}`;
    this.log(`── Baston — ${p.name}`);
    this.s.active = pid;
    const mine = this.fighterCandidates(pid);
    const theirs = this.targetCandidates(pid);
    let launched = false;
    if (mine.length && theirs.length) {
      const f = await this.chooseCard(pid, 'bastonFighter', 'Baston : choisissez votre combattant (ou passez)', mine, { optional: true });
      if (f) {
        const t = await this.chooseCard(pid, 'bastonTarget', 'Choisissez le combattant adverse', this.targetCandidates(pid));
        await this.runCombat(pid, f, t);
        launched = true;
      } else this.log(`${p.name} passe sa Baston.`, pid);
    } else this.log(`${p.name} ne peut pas lancer de combat.`, pid);

    // Fin de la Baston : Provoc' — seulement si un combat a été lancé, pour l'un ou l'autre joueur (R24, R59)
    if (launched) {
      for (const q of [pid, this.other(pid)]) {
        for (let guard = 0; guard < 6; guard++) {
          const acts = FX.actionsFor(this, q, 'finBaston');
          if (!acts.length) break;
          const ans = await this.chooseOption(q, 'finBaston', "Fin de Baston : lancer une Provoc' ?", [
            ...acts.map((x, i) => ({ id: `act:${i}`, label: x.label, card: x.card, lieuIndex: x.lieuIndex, blocked: x.blocked })), { id: 'no', label: 'Non' }]);
          if (ans === 'no') break;
          await acts[+ans.slice(4)].run();
          await this.flush();
        }
      }
    }
    // Sabba / Fukmi / Gériko se retournent ; Elvis est exilé ou payé
    for (const q of [0, 1])
      for (const c of [...this.p(q).arena]) {
        if (c.tmp.flipEndBaston) { c.tmp.flipEndBaston = false; if (!c.faceDown) this.flipDown(c); }
        if (c.tmp.elvisDue) await FX.elvisPayment(this, q, c);
      }
    await this.endPhase();
  }

  fighterCandidates(pid) { return this.visibleArena(pid).filter(c => !c.tmp.cannotFight && !c.tmp.ownLocked); }
  targetCandidates(pid) {
    return this.visibleArena(this.other(pid)).filter(c => !this.isInciblable(c, pid) && !c.tmp.cannotFight);
  }

  async runCombat(att, fA, fB, { provoc = false } = {}) {
    const def = this.other(att);
    // Aqua Bomb : en lançant un combat, le joueur maudit renvoie un Perso face cachée sous le Groupe
    if (this.p(att).lionCurse) {
      const downs = this.p(att).arena.filter(c => c.faceDown);
      const c = await this.chooseCard(att, 'lionCurse', 'Aqua Bomb : renvoyez sous le Groupe un de vos Persos face cachée', downs);
      if (c) this.underGroupe(c, def);
      await this.flush();
    }
    const mkSide = (pid, f) => ({
      pid, fighter: f.uid, kicks: [], max: this.aura(f), turns: 0, realPosed: 0, comboActive: false,
      comboBlocked: false, comboOverride: null, comboExtra: 0, comboZero: false, puissanceMod: 0, effects: [],
      noDraw: false, noDiscardByOpp: false, roiFury: false, silenceNext: 0, silenceAll: false, nextBase: null,
      extraKw: null, hidden: null, akim: false, gerikoFirstTwo: false, damaged: false,
    });
    this.s.combat = { attacker: att, provoc, sides: { [att]: mkSide(att, fA), [def]: mkSide(def, fB) }, restrict: {}, usedCombat: new Set(), stage: 'Début du combat' };
    const c = this.s.combat;
    this.p(att).fought.add(fA.uid);
    this.p(def).fought.add(fB.uid);
    this.log(`${provoc ? "Provoc' ! " : ''}${this.label(fA)} affronte ${this.label(fB)}.`, att);
    this.trace(`COMBAT ${this.p(att).name} ${this.label(fA)}[${this.aura(fA)}] contre ${this.label(fB)}[${this.aura(fB)}]${provoc ? " (Provoc')" : ''}`);
    this.traceState('combat');

    // Shun (Hagen Dass Cross) : l'adversaire pose 1 Kick de moins (min 1)
    for (const pid of [att, def]) {
      const f = this.fighter(pid);
      if (f.id === 'SHUN1') {
        const o = c.sides[this.other(pid)];
        o.max = o.max > 1 ? o.max - 1 : o.max;
        this.log(`Hagen Dass Cross : ${this.pname(this.other(pid))} pose 1 Kick de moins.`, pid);
      }
      if (f.id === 'GERIKO3') this.log('Dragon en chasse : Gériko et vos Kicks sont inciblables.', pid);
    }

    // Début du combat
    await this.window('combatStart', [att, def]);

    // Pose des Kicks en alternance
    // Pose des Kicks, puis dernière fenêtre de capacités. Si une capacité y ajoute un Kick
    // (Isaak « Je reviens »), le joueur concerné peut encore le poser.
    c.stage = 'Pose des Kicks';
    for (let round = 0; round < 6; round++) {
      let cur = att;
      for (let guard = 0; guard < 40; guard++) {
        const ra = c.sides[att].max - c.sides[att].turns, rb = c.sides[def].max - c.sides[def].turns;
        if (ra <= 0 && rb <= 0) break;
        if (c.sides[cur].max - c.sides[cur].turns > 0) await this.kickTurn(cur);
        cur = this.other(cur);
      }
      await this.window('combat', [def, att]);
      if (c.sides[att].turns >= c.sides[att].max && c.sides[def].turns >= c.sides[def].max) break;
    }

    // Dénouement
    c.stage = 'Dénouement';
    for (const pid of [att, def]) await FX.denouementTriggers(this, pid);
    await this.window('denouement', [att, def]);
    const pa = this.power(att), pb = this.power(def);
    c.final = { [att]: pa, [def]: pb };
    const winners = pa === pb ? [att, def] : pa > pb ? [att] : [def];
    this.log(`Dénouement : ${this.pname(att)} ${pa} — ${pb} ${this.pname(def)}.`);
    const fa = this.fighter(att), fb = this.fighter(def);
    const auraA = this.aura(fa), auraB = this.aura(fb);
    // Puissances observées (publiques) : le bot s'en sert pour jauger la force réelle d'un adversaire à Main inconnue
    this.s.fights.push({ pid: att, id: fa.id, aura: auraA, power: pa }, { pid: def, id: fb.id, aura: auraB, power: pb });
    for (const w of winners) {
      const gain = w === att ? auraB : auraA;
      this.p(w).renommee += gain;
      this.log(`${this.pname(w)} remporte la victoire et gagne ${gain} de Renommée.`, w);
    }
    c.winners = winners;
    this.emit('victory', { winners, att, pa, pb });

    // Fin du combat : les capacités « à la fin d'un combat » se jouent avant les dégâts (livret 3.2),
    // puis les vainqueurs infligent leur dégât, puis ce qui dépend des dégâts reçus (« sans dégât »).
    c.stage = 'Fin du combat';
    await FX.endOfCombatTriggers(this, att);
    await this.window('finCombat', [att, def]);
    for (const w of winners) await this.damageStep(w, pa === pb);
    await FX.afterDamageTriggers(this, att);

    // Nettoyage : les Kicks partent en Fosse, une carte cachée (Dolche) revient en Main
    for (const pid of [att, def]) {
      for (const k of [...c.sides[pid].kicks]) this.discard(k);
      const h = c.sides[pid].hidden;
      if (h) { this.put(h, 'hand'); this.log(`${this.pname(pid)} reprend sa carte cachée en Main.`, pid); }
    }
    this.s.combat = null;
    await this.flush();
    this.onUpdate();
  }

  async kickTurn(pid) {
    const p = this.p(pid), sd = this.side(pid);
    for (let guard = 0; guard < 20; guard++) {
      const kicks = p.hand.filter(c => this.def(c).type === 'K');
      const acts = FX.actionsFor(this, pid, 'combat');
      const left = sd.max - sd.turns;
      const opts = [
        ...kicks.map(k => ({ id: `kick:${k.uid}`, label: this.label(k), card: k })),
        ...acts.map((x, i) => ({ id: `act:${i}`, label: x.label, card: x.card, lieuIndex: x.lieuIndex, action: true, blocked: x.blocked })),
        { id: 'pass', label: 'Je passe' },
      ];
      const ans = await this.chooseOption(pid, 'kickTurn', `Posez un Kick (${left} restant${left > 1 ? 's' : ''})`, opts);
      if (ans === 'pass') { sd.turns++; this.log(`${p.name} passe.`, pid); return; }
      if (ans.startsWith('act:')) { await acts[+ans.slice(4)].run(); continue; }
      const k = kicks.find(x => `kick:${x.uid}` === ans);
      sd.turns++;
      await this.poseKick(pid, k);
      return;
    }
  }

  /**
   * Pose un Kick. `reveal` : carte cachée par Dolche et révélée (R57) — seules les capacités « Continue »
   * s'activent à la révélation, pas celles de « Pose » ; ne consomme pas de Kick posable.
   */
  async poseKick(pid, k, { reveal = false } = {}) {
    const sd = this.side(pid), d = this.def(k);
    this.remove(k);
    Object.assign(k, { zone: 'kicks', base: d.force, rang: d.rang, markers: [], activated: false, countered: false, silenced: false, piege: 0, cap: null, shielded: false });
    if (sd.nextBase != null) { k.base = sd.nextBase; this.log(`${d.name} a une Force de base de ${sd.nextBase}.`, pid); sd.nextBase = null; }
    if (sd.silenceAll || sd.silenceNext > 0) {
      k.silenced = true;
      if (!sd.silenceAll) sd.silenceNext--;
      this.log(`${d.name} n'active pas sa capacité.`, pid);
    }
    sd.kicks.push(k);
    sd.realPosed++;
    this.log(`${this.pname(pid)} ${reveal ? 'révèle et pose' : 'pose'} ${d.name} (${d.rang}, Force ${d.force}).`, pid);
    if (d.abType === 'CAPACITÉ' && !k.silenced && this.kickCondMet(k) && (!reveal || d.cond === 'Continue')) {
      const values = FX.felinValues(this, pid, k);
      const ok = await this.activate(pid, k, d.name, async () => { k.activated = true; await FX.onKickPosed(this, pid, k); }, { felin: values ? { values } : null });
      if (!ok) k.countered = true;
    }
    await FX.afterKickPosed(this, pid, k);
    await this.checkCombos();
  }

  /** Active les Combos dont les Rangs sont réunis (dans l'ordre : attaquant puis défenseur). */
  async checkCombos() {
    const c = this.s.combat;
    if (!c) return;
    for (const pid of [c.attacker, this.other(c.attacker)]) {
      const sd = c.sides[pid], f = this.fighter(pid);
      if (!f || sd.comboActive) continue;
      const combo = this.def(f).combo;
      if (!combo || !comboSatisfied(combo.ranks, sd.kicks.map(k => k.rang).filter(Boolean))) continue;
      sd.comboActive = true;
      const d = this.def(f);
      this.log(`Combo de ${this.label(f)} activé (+${this.comboBonus(pid)}) !`, pid);
      this.emit('combo', { pid });
      // Combattant aguerri : Force de base 3 si le combattant est Garde ou Vif
      if (this.hasKw(f, 'GARDE') || this.hasKw(f, 'VIF'))
        for (const k of sd.kicks) if (k.id === 'AGUERRI' && !k.countered && !k.silenced) { k.base = 3; this.log('Combattant aguerri passe à 3 de Force.', pid); }
      // Nathalie (R66) : seul le texte de la capacité de Combo est bloqué, pas le bonus de Force
      if (d.abType === 'CAPACITÉ' && FX.COMBO_CAPS[d.id]) {
        if (sd.comboBlocked) this.log(`La capacité de Combo de ${this.label(f)} ne peut pas s'activer (Nathalie).`, pid);
        else await this.activate(pid, f, `${d.sub} (Combo)`, () => FX.COMBO_CAPS[d.id](this, pid), { isCombo: true });
      }
    }
  }

  /** Fenêtre de priorité : les joueurs alternent jusqu'à deux passes consécutives. */
  async window(name, order) {
    let idx = 0, passes = 0;
    for (let guard = 0; guard < 30 && passes < 2; guard++) {
      const pid = order[idx % 2];
      idx++;
      const acts = FX.actionsFor(this, pid, name);
      if (!acts.length) { passes++; continue; }
      const titles = { combatStart: 'Début du combat', combat: 'Avant le Dénouement', denouement: 'Dénouement', finCombat: 'Fin du combat', aurore: 'Aurore', finNuit: 'Fin de la nuit' };
      const ans = await this.chooseOption(pid, 'window:' + name, `${titles[name]} : activer une capacité ?`, [
        ...acts.map((x, i) => ({ id: `act:${i}`, label: x.label, card: x.card, lieuIndex: x.lieuIndex, action: true, blocked: x.blocked })), { id: 'pass', label: 'Continuer' }]);
      if (ans === 'pass') { passes++; continue; }
      passes = 0;
      await acts[+ans.slice(4)].run();
      await this.flush();
    }
  }

  async damageStep(w, tie) {
    const c = this.s.combat, l = this.other(w);
    const dmgs = FX.availableDamages(this, w);
    if (!dmgs.length) return;
    const ans = await this.chooseOption(w, 'damage', 'Victoire : infliger un dégât ?', [
      ...dmgs.map((d, i) => ({ id: `d:${i}`, label: d.label, card: d.card, dmgId: d.id })), { id: 'none', label: 'Aucun dégât' }]);
    if (ans === 'none') return;
    const dmg = dmgs[+ans.slice(2)];
    if (dmg.cost) await dmg.cost();
    this.log(`${this.pname(w)} inflige le dégât ${dmg.label}.`, w);
    // R60 : un dégât contré compte quand même comme infligé (un seul dégât par Perso et par combat)
    c.sides[l].damaged = true;
    if (dmg.id === 'MEGA_MANDALE' && tie) { this.log('Égalité : Méga mandale est contré.', w); return; }
    const target = this.fighter(l);
    const targetAura = target ? this.aura(target) : 0;
    c.targetAura = targetAura;
    // Debordman : contre le dégât et s'exile à la place
    if (target?.id === 'DEBORDMAN' && target.zone === 'arena') {
      this.log('Debordman contre le dégât et s’exile à la place.', l);
      this.exile(target, null);
      await this.flush();
      return;
    }
    const countered = await this.offerCounter(l, { kind: 'damage', by: w, label: dmg.label, dmgId: dmg.id, target });
    if (countered) return;
    this.emit('damage', { w, label: dmg.label });
    await dmg.apply(target);
    await this.flush();
    // Roi Fury : le même dégât frappe un autre Perso adverse
    if (c.sides[w].roiFury && dmg.onTarget) {
      const others = this.visibleArena(l).filter(x => x !== target && this.aura(x) <= targetAura);
      const t2 = await this.chooseCard(l, 'roiFury', 'Roi Fury : choisissez le Perso qui subit le même dégât', others);
      if (t2) { this.log(`Roi Fury : ${this.label(t2)} subit aussi le dégât.`, w); await dmg.onTarget(t2); await this.flush(); }
    }
  }

  // ── Aurore & fin de nuit ──────────────────────────────────
  async aurore() {
    this.s.phase = 'Aurore';
    this.log('── Aurore');
    this.emit('phase', { name: 'Aurore' });
    this.s.active = null;
    for (const pid of [this.s.first, this.other(this.s.first)])
      if (this.p(pid).magossVictim) { this.p(pid).magossVictim = false; await FX.magossAurore(this, pid); }
    await this.window('aurore', [this.s.first, this.other(this.s.first)]);
    const c0 = this.control(0), c1 = this.control(1);
    this.log(`Contrôle : ${this.pname(0)} ${c0} — ${c1} ${this.pname(1)}.`);
    if (c0 !== c1) {
      const w = c0 > c1 ? 0 : 1;
      this.p(w).renommee += 1;
      this.log(`${this.pname(w)} a le Contrôle et gagne 1 de Renommée.`, w);
    }
    await this.endPhase();
  }

  async endOfNight() {
    this.s.phase = 'Fin de la nuit';
    this.log('── Fin de la nuit');
    await this.window('finNuit', [this.s.first, this.other(this.s.first)]);
    this.s.history.push([this.p(0).renommee, this.p(1).renommee]);
    for (const pid of [0, 1]) {
      const p = this.p(pid);
      if (p.hand.length > HAND_MAX) {
        const n = p.hand.length - HAND_MAX;
        const out = await this.chooseCards(pid, 'discardOwn', `Main limitée à ${HAND_MAX} : défaussez ${n} carte(s)`, p.hand, n, n);
        out.forEach(c => this.discard(c));
      }
      p.nightUsed.clear();
      p.controlMod = 0;
      p.lieuUsedNight = false;
      p.provocUsed = false;
      p.lionCurse = false;
      p.oppMustRefuse = false;
      p.fought.clear();
      for (const c of [...p.arena, ...p.reserve]) for (const k of NIGHT_TMP) delete c.tmp[k];
    }
    this.s.first = this.other(this.s.first);
  }

  endGame() {
    const [a, b] = this.s.players;
    let winner = a.renommee > b.renommee ? 0 : b.renommee > a.renommee ? 1 : null;
    if (winner === null) {
      const va = this.visibleArena(0).length, vb = this.visibleArena(1).length;
      if (va !== vb) {
        winner = va > vb ? 0 : 1;
        this.p(winner).renommee += 1;
        this.log(`Égalité : ${this.pname(winner)} a plus de Persos visibles et gagne 1 de Renommée.`, winner);
      }
    }
    this.s.over = true;
    this.s.phase = 'Fin de partie';
    this.s.result = { winner, scores: [a.renommee, b.renommee] };
    this.log(winner === null ? 'Match nul !' : `🏆 ${this.pname(winner)} remporte la partie (${a.renommee} — ${b.renommee}).`, winner);
  }
}