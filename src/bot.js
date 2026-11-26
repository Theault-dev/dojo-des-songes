// ─────────────────────────────────────────────────────────────
// Bot d'entraînement heuristique.
// Il évalue chaque décision localement (Puissance simulée, valeur
// des cartes, Renommée en jeu) sans chercher plusieurs coups à l'avance.
// ─────────────────────────────────────────────────────────────
import { comboSatisfied, NIGHTS } from './engine.js';
import { sharesName, TEAMS } from './data.js';

const SUPPORT_PRIORITY = {
  FOUTEURS: 9, ART_DESTRUCTION: 8, SURVIVRE: 8, DANSE_KILL: 7, INDOMPTABLES: 8, FIESTA: 6, IMPERIAL_VEGA: 4,
  CITY_VOLT: 5, EXTREMIS: 5, MALICE: 4, REJOINS: 4,
  EN_MISSION: 10, DEBARRASSER: 9, COURAGE: 7, MUR_FORCE: 6, BATTE: 6, BAGUE_FEU: 5,
  JAI_FROID: 5, TEMPO: 4, ANGELITO: 3, NATHALIE: 4,
};
/** Valeur par nuit restante d'une capacité utile dès l'entrée dans l'Arène (pioche, recrutement, recherche). */
const ENTRY_ABILITY = { JERZEY1: 1.1, SEALVIA1: 1.0, SAVANE2: 0.7, EVE2: 0.7, FELIX: 0.6, DIEU_CHAT: 0.5, NAORA1: 0.5, VULCAIN: 0.6, TERRENCE1: 0.4, JUNG: 0.3 };
/** Écart sous la valeur moyenne du Songe en dessous duquel une carte est remise au mulligan. */
const MULL_MARGIN = 0.5;
const sigmoid = x => 1 / (1 + Math.exp(-x));
const maxBy = (arr, f) => arr.reduce((best, x) => (best === undefined || f(x) > f(best) ? x : best), undefined);
const minBy = (arr, f) => maxBy(arr, x => -f(x));

/** Les options « impossibles » (R64/R65) restent visibles pour un humain mais le bot ne les choisit jamais. */
export function withoutBlocked(req) {
  if (!req.options.some(o => o.blocked)) return req;
  const options = req.options.filter(o => !o.blocked);
  return options.length ? { ...req, options } : req;
}

export class Bot {
  constructor({ delay = 0 } = {}) { this.delay = delay; this.plan = null; this.quiet = false; }

  /** Raison d'une décision, pour le rapport de diagnostic (hors journal de partie, sans coût si le suivi est coupé). */
  note(g, text) { if (g.traceOn && !this.quiet) g.trace(`  ↳ ${text}`); }

  async ask(g, pid, req) {
    if (this.delay) await new Promise(r => setTimeout(r, this.delay));
    req = withoutBlocked(req);
    const h = this[req.kind.replace(':', '_')] ?? this.fallback;
    const ans = h.call(this, g, pid, req);
    return ans ?? this.fallback(g, pid, req);
  }

  /** Conseil pour le joueur humain : la réponse que le bot donnerait à sa place. */
  suggest(g, pid, req) {
    req = withoutBlocked(req);
    const h = this[req.kind.replace(':', '_')];
    this.quiet = true;
    try { return h ? h.call(this, g, pid, req) ?? this.fallback(g, pid, req) : this.fallback(g, pid, req); } catch { return null; }
    finally { this.quiet = false; }
  }

  fallback(g, pid, req) {
    if (req.max > 1 || req.min === 0) return req.min === 0 ? [] : req.options.slice(0, req.min).map(o => o.id);
    const none = req.options.find(o => o.id === 'none' || o.id === 'no' || o.id === 'pass' || o.id === 'end');
    return (none ?? req.options[0]).id;
  }

  // ── Valeurs génériques ────────────────────────────────────
  cardValue(g, c) {
    const d = g.def(c);
    if (d.type === 'P') return d.aura * 1.5 + (d.combo ? 1 : 0);
    if (d.type === 'S') return (SUPPORT_PRIORITY[d.id] ?? 3) / 2;
    if (c.zone === 'kicks') return g.kickForce(c);
    return d.force + (d.abType === 'DÉGÂT' ? 1.5 : 0) + (d.rang === '★' ? 0.5 : 0) + (d.id === 'PAS_VU_VENIR' ? 1.5 : 0) + (d.id === 'FORCE_ENFOUIE' ? 1.5 : 0);
  }

  /** Force approximative d'un Kick en Main pour un combattant donné. */
  approxForce(g, d, fighter, opp) {
    const kw = g.keywords(fighter);
    const cond = d.kw.includes('BASE') || d.kw.some(k => kw.includes(k));
    let f = d.force;
    if (!cond) return f;
    switch (d.id) {
      case 'BOULE_FEU': f += 1.5; break;
      case 'PREMIERE_FLAMME': f += 1.5; break;
      case 'PIEGE': f += 0.5; break;
      case 'ETALE': f += g.aura(fighter) >= 2 ? 3 : 0; break;
      case 'BLOCAGE': f += Math.min(3, opp ? g.aura(opp) : 2); break;
      case 'ATTAQUE_TITANS': f += 1.5; break;
      case 'LIBERER': f += 2; break;
      case 'FORCE_ENFOUIE': f += opp && g.aura(fighter) < g.aura(opp) ? 3 : 0; break;
      case 'FOU_RAGE': f += 1.5; break;
      case 'AGUERRI': f += d.id && (kw.includes('GARDE') || kw.includes('VIF')) ? 2 : 0; break;
      case 'COUP_TRAITRE': f += 2; break;
      case 'PAS_VU_VENIR': f += 1; break;
      case 'TAILLADE': f += 2; break;
      case 'MOUSTIK': case 'CROCS': case 'KANINE': case 'ENVIE_SANG': case 'FUREUR': f += 1; break;
      case 'NADINE': f += Math.min(3, opp ? g.aura(opp) : 2); break;
      case 'TRAVAIL': f += Math.min(3, g.visibleArena(fighter.owner).filter(c => g.hasKw(c, 'KILL STARS')).length); break;
      case 'TELLURIQUE': f += g.lieuActivated(fighter.owner); break;
      case 'VIOLENCE': f += 1.2; break;
      case 'VIRTUOSITE': f += 2; break;
      case 'ATT_FOUDROYANTE': f += 1.5; break;
      case 'DEVIATION': case 'PATATE': f += 0.8; break;
    }
    return f;
  }

  /** Estimation de la Puissance qu'un camp peut atteindre. */
  estimatePower(g, pid, fighter, opp, { known = true } = {}) {
    let n = g.aura(fighter);
    if (opp?.id === 'SHUN1' && n > 1) n -= 1;
    if (!known) return this.blindPower(g, fighter, n) * this.scaleOf(g, pid);
    const kicks = g.p(pid).hand.filter(c => g.def(c).type === 'K');
    const scored = kicks.map(c => ({ c, f: this.approxForce(g, g.def(c), fighter, opp) })).sort((a, b) => b.f - a.f);
    const combo = g.def(fighter).combo;
    let chosen = scored.slice(0, n);
    let bonus = 0;
    if (combo && n >= combo.ranks.length) {
      const pick = this.comboPick(g, scored.map(x => x.c), combo.ranks);
      if (pick) {
        const rest = scored.filter(x => !pick.includes(x.c)).slice(0, n - pick.length);
        const withCombo = [...scored.filter(x => pick.includes(x.c)), ...rest];
        const sumCombo = withCombo.reduce((a, x) => a + x.f, 0) + combo.bonus;
        if (sumCombo > chosen.reduce((a, x) => a + x.f, 0)) { chosen = withCombo; bonus = combo.bonus; }
      }
    }
    return chosen.reduce((a, x) => a + x.f, 0) + bonus;
  }

  /** Puissance attendue d'un combattant dont la Main est inconnue (modèle a priori, calé sur des parties bot contre bot). */
  blindPower(g, f, n = g.aura(f)) {
    const combo = g.def(f).combo;
    return n * 2.3 + (combo && n >= combo.ranks.length ? combo.bonus * 0.45 : 0);
  }

  /**
   * Écart entre ce qu'un joueur a réellement produit lors des combats passés (public) et le modèle a priori.
   * Un adversaire qui a déjà aligné 23 à Aura 4 ne sera pas jugé à 11 : le facteur monte, borné, avec un a priori de 6 points.
   */
  scaleOf(g, pid) {
    let obs = 0, mod = 0;
    for (const x of g.s.fights) if (x.pid === pid) { obs += x.power; mod += this.blindPower(g, { id: x.id }, x.aura); }
    return Math.min(2, Math.max(0.8, (obs + 6) / (mod + 6)));
  }

  /** Choisit des Kicks de la Main qui réalisent les Rangs requis (ou null). */
  comboPick(g, cards, ranks) {
    const pool = [...cards], pick = [];
    for (const r of ranks) {
      let i = pool.findIndex(c => g.def(c).rang === r);
      if (i < 0) i = pool.findIndex(c => g.def(c).rang === '★');
      if (i < 0) return null;
      pick.push(pool.splice(i, 1)[0]);
    }
    return pick;
  }

  /**
   * Valeur attendue du dégât de `w` (combattant `wf`) si `wf` bat `lf` : Combo de dégât du combattant (public)
   * et Kick de dégât en Main. La Main n'est lue que pour soi (`known`) : pour l'adversaire, on retient un a priori.
   * Les dégâts de zone (Asmodheus…) sont chiffrés sur toute l'Arène de `lf`, pas sur le seul combattant.
   */
  dmgExpect(g, w, wf, lf, known) {
    let v = 0;
    const d = g.def(wf);
    if (d.abType === 'DÉGÂT') v += 0.6 * this.damageValue(g, w, d.id, lf);
    if (known) {
      const ks = g.p(w).hand.map(c => g.def(c)).filter(x => x.type === 'K' && x.abType === 'DÉGÂT');
      if (ks.length) v += Math.max(...ks.map(x => this.damageValue(g, w, x.id, lf)));
    } else v += 0.5 * (g.aura(lf) * 0.4 + 0.5);
    return v;
  }

  /** Deck qui grandit avec les capacités de Lieu activées (Roche : DJ Killa, Projection tellurique, Éboulement). */
  lieuEager(g, pid) {
    const ids = [...g.p(pid).deck.groupe, ...g.p(pid).deck.songe];
    return ids.some(id => ['TELLURIQUE', 'EBOULEMENT', 'DJKILLA2', 'DJKILLA3'].includes(id));
  }
  /** Une sortie d'Arène de Persos « Attila band » déclencherait L'art de la destruction. */
  artReady(g, pid) { return !!g.hasSupport(pid, 'ART_DESTRUCTION') && !g.usedThisPhase(`art${pid}`); }

  // ── Mise en place ─────────────────────────────────────────
  /**
   * Deux mulligans (R69/R70). `ctx.zone` : 'groupe' (3 Persos) ou 'songe' (7 cartes).
   * L'ordre de la réponse est l'ordre de remise sous la pile : la première carte remise est la première
   * que l'on retrouvera (recrutée ou piochée), la dernière est tout au fond.
   */
  mulligan(g, pid, req) {
    const ids = o => o.map(x => x.id);
    if (req.ctx?.zone === 'groupe') return ids(this.persoMulligan(g, pid, req.options));
    return ids(this.songeMulligan(g, pid, req.options));
  }

  /**
   * Mulligan des Persos : on connaît son Groupe (donc les cartes de la pile), pas leur ordre. Pour chaque
   * choix (quelles cartes remettre, dans quel ordre) on simule les premières nuits sur des ordres de pile
   * tirés au hasard : Persos recrutés, entrées dans l'Arène nuit après nuit (somme des Auras ≤ nuit), et on
   * garde le choix qui développe le mieux (un Perso d'Aura 1 dès la nuit 1, un Aura 2 en nuit 2…).
   */
  persoMulligan(g, pid, options) {
    const hand = options, pile = g.p(pid).groupe;
    const sets = [];
    const perms = arr => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r])));
    for (let m = 0; m < 1 << hand.length; m++) {
      const sub = hand.filter((_, i) => m & (1 << i));
      sets.push(...perms(sub));
    }
    const SAMPLES = 24;
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const worlds = Array.from({ length: SAMPLES }, () => {
      const a = pile.map(c => c.id);
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a; // a[0] = dessus de la pile
    });
    let best = [], bestV = -Infinity;
    for (const set of sets) {
      const out = new Set(set.map(o => o.id));
      let total = 0;
      for (const w of worlds) {
        const draw = w.slice(0, set.length), rest = w.slice(set.length);
        const reserve = [...hand.filter(o => !out.has(o.id)).map(o => o.card.id), ...draw];
        total += this.developmentValue(g, reserve, [...rest, ...set.map(o => o.card.id)]);
      }
      const v = total / SAMPLES - 0.01 * set.length;
      if (v > bestV) { bestV = v; best = set; }
    }
    return best;
  }

  /** Valeur d'un développement : on recrute à chaque Crépuscule puis on fait entrer ce qui vaut le plus. */
  developmentValue(g, reserveIds, pileIds, nights = 4) {
    const reserve = [...reserveIds], pile = [...pileIds], arena = [];
    let total = 0;
    for (let n = 1; n <= nights; n++) {
      if (pile.length) reserve.push(pile.shift());
      const set = this.bestEntry(g, reserve.map(id => ({ id, owner: 0, markers: [], tmp: {} })), n, arena);
      for (const c of set) { total += this.entryValue(g, c, n); reserve.splice(reserve.indexOf(c.id), 1); arena.push(c); }
    }
    return total;
  }

  /**
   * Valeur d'un Perso qui entre à la nuit `night` : son Aura (Contrôle, Kicks du combattant) et sa capacité
   * utile chaque nuit (pioche, recrutement…), multipliées par les nuits qu'il lui reste à jouer.
   */
  entryValue(g, c, night) {
    const d = g.def(c), left = NIGHTS - night + 1;
    return ((d.aura ?? 0) * 1.1 + (d.combo ? 0.5 : 0) + (ENTRY_ABILITY[d.id] ?? 0)) * left;
  }

  /** Meilleur ensemble de Persos à faire entrer (somme des Auras ≤ nuit, pas de nom partagé avec l'Arène). */
  bestEntry(g, reserve, night, arena = []) {
    const cands = reserve.filter(c => g.def(c).aura <= night && !arena.some(x => sharesName(g.def(x), g.def(c))));
    const N = Math.min(cands.length, 12);
    let best = [], bestV = 0;
    for (let mask = 1; mask < 1 << N; mask++) {
      const set = cands.filter((_, i) => mask & (1 << i));
      if (set.reduce((a, c) => a + g.def(c).aura, 0) > night) continue;
      if (set.some((a, i) => set.some((b, j) => i < j && sharesName(g.def(a), g.def(b))))) continue;
      const v = set.reduce((a, c) => a + this.entryValue(g, c, night), 0);
      if (v > bestV) { bestV = v; best = set; }
    }
    return best;
  }

  /**
   * Mulligan du Songe : une carte garde sa place si elle vaut mieux qu'une carte moyenne du reste du Songe.
   * Les valeurs dépendent du deck : un Kick ne vaut que s'il s'active avec les Persos du Groupe, un Soutien
   * « Team » que si ses membres y figurent.
   */
  songeMulligan(g, pid, options) {
    const prof = this.deckProfile(g, pid);
    const val = c => this.deckCardValue(g, c, prof);
    const rest = g.p(pid).songe;
    const avg = rest.length ? rest.reduce((a, c) => a + val(c), 0) / rest.length : 0;
    const scored = options.map(o => ({ o, v: val(o.card) }));
    let out = scored.filter(x => x.v < avg - MULL_MARGIN);
    // Il faut de quoi poser quelques Kicks : on ne garde pas une Main sans Kick jouable
    const kicksKept = scored.filter(x => g.def(x.o.card).type === 'K' && !out.includes(x)).length;
    if (kicksKept < 3) out = scored.filter(x => g.def(x.o.card).type !== 'K' || x.v < avg - MULL_MARGIN);
    return out.sort((a, b) => b.v - a.v).map(x => x.o);
  }

  /** Persos du Groupe (poids = Aura) : sert à estimer si un Kick ou un Soutien trouvera son combattant. */
  deckProfile(g, pid) {
    const persos = g.p(pid).deck.groupe.map(id => ({ id, owner: pid, zone: 'groupe', faceDown: false, markers: [], tmp: {} }));
    const w = persos.map(c => Math.max(1, g.def(c).aura));
    return { persos, w, total: w.reduce((a, b) => a + b, 0) };
  }

  deckCardValue(g, c, prof) {
    const d = g.def(c);
    const share = f => prof.persos.reduce((a, p, i) => a + (f(p) ? prof.w[i] : 0), 0) / prof.total;
    if (d.type === 'K') {
      const play = d.kw.includes('BASE') ? 1 : share(p => d.kw.some(k => g.keywords(p).includes(k)));
      const force = prof.persos.reduce((a, p, i) => a + this.approxForce(g, d, p, null) * prof.w[i], 0) / prof.total;
      return play * (force + (d.abType === 'DÉGÂT' ? 1.2 : 0) + (d.rang === '★' ? 0.4 : 0));
    }
    if (d.type === 'S') {
      const team = TEAMS[d.id];
      const rel = team ? share(p => team.match ? team.match(g.def(p)) : team.names.includes(g.def(p).name)) : share(p => d.kw.some(k => g.keywords(p).includes(k)));
      return ((SUPPORT_PRIORITY[d.id] ?? 3) / 2) * (team ? Math.min(1, rel * 2.5) : 0.4 + 0.6 * Math.min(1, rel * 2));
    }
    return 0;
  }

  // ── Crépuscule ────────────────────────────────────────────
  crepuscule(g, pid, req) {
    const p = g.p(pid), n = g.s.night;
    const acts = req.options.filter(o => o.id.startsWith('act:'));
    const byCard = id => acts.find(o => o.card?.id === id);
    const lieu = i => acts.find(o => o.lieuIndex === i);
    const has = id => p.hand.some(c => c.id === id) || g.visibleSupports(pid).some(c => c.id === id);

    const s = byCard('SEALVIA1'); if (s) return s.id;
    for (const id of ['JERZEY1', 'DIEU_CHAT', 'FELIX', 'SAVANE2', 'EVE2', 'NAORA1', 'NAORA2', 'ALANA2', 'FANBOY', 'IMPERIAL_VEGA']) {
      const a = byCard(id);
      if (a) return a.id;
    }
    const volt = byCard('CITY_VOLT');
    if (volt && g.visibleArena(1 - pid).some(c => g.aura(c) >= 2)) return volt.id;
    const austin = byCard('AUSTIN');
    if (austin && p.reserve.some(c => g.aura(c) === n + 1 && g.aura(c) >= 3)) return austin.id;
    const boro = byCard('BORO');
    if (boro && (!p.teams.has('FLOCONS') || p.groupe.some(c => g.hasKw(c, 'FLOCONS')))) return boro.id;
    const tempo = byCard('TEMPO');
    if (tempo && n >= 3 && g.visibleArena(pid).some(c => g.aura(c) >= 4)) return tempo.id;

    const lieuActs = acts.filter(o => o.lieuIndex != null);
    if (lieuActs.length && this.lieuEager(g, pid)) {
      // Projection tellurique, Éboulement et DJ Killa grandissent avec chaque capacité activée
      const pick = lieuActs.find(o => !(g.lieu(pid).effect === 'DELIRIUM' && o.lieuIndex === 1) || p.fosse.some(c => this.cardValue(g, c) >= 2.5));
      if (pick) return pick.id;
    }
    const deb = byCard('DEBORDMAN');
    if (deb && g.s.crepDone) {
      const d = g.s.crepDone;
      const redo = (d.support && this.supportPick(g, pid).length) || (d.enter && this.enterPick(g, pid).reduce((a, c) => a + g.aura(c), 0) >= 2);
      if (redo) return deb.id;
    }
    switch (g.lieu(pid).effect) {
      case 'DEESSES':
        if (lieu(1) && !has('EN_MISSION') && !p.teams.has('FLOCONS')) return lieu(1).id;
        if (lieu(2) && n >= 2) return lieu(2).id;
        if (lieu(0) && n >= 3) return lieu(0).id;
        break;
      case 'DELIRIUM':
        if (lieu(0) && n >= 2) return lieu(0).id;
        if (lieu(1) && n >= 4 && p.fosse.some(c => this.cardValue(g, c) >= 3)) return lieu(1).id;
        break;
    }
    if (req.options.some(o => o.id === 'support') && this.supportPick(g, pid).length) return 'support';
    if (req.options.some(o => o.id === 'enter') && this.enterPick(g, pid).length) return 'enter';
    return 'end';
  }

  supportPick(g, pid) {
    const vis = new Set(g.supportStacks(pid).map(s => s[s.length - 1].id));
    const hasSacha = [...g.p(pid).arena, ...g.p(pid).reserve].some(c => c.id === 'SACHA');
    const cands = g.p(pid).hand.filter(c => g.def(c).type === 'S' && !(c.id === 'ANGELITO' && !hasSacha));
    const uniq = [...new Map(cands.map(c => [c.id, c])).values()];
    // Un Soutien déjà en jeu s'empile : utile mais moins prioritaire qu'un nouveau Soutien
    const prio = c => (SUPPORT_PRIORITY[c.id] ?? 3) - (vis.has(c.id) ? 4 : 0);
    // Au-delà de 2 Soutiens différents, un nouveau recouvre un ancien : on n'en pose que s'il vaut mieux
    const picked = [], names = new Set(vis);
    for (const c of uniq.filter(c => prio(c) > 0).sort((a, b) => prio(b) - prio(a))) {
      if (picked.length === 2) break;
      if (!names.has(c.id) && names.size >= 2) {
        const worst = Math.min(...[...names].map(id => SUPPORT_PRIORITY[id] ?? 3));
        if (prio(c) <= worst + 0.5) continue;
      }
      names.add(c.id); picked.push(c);
    }
    return picked;
  }
  support(g, pid) { return this.supportPick(g, pid).map(c => c.uid); }
  /** Zones pleines : on recouvre le Soutien le moins utile. */
  supportSlot(g, pid, req) { return minBy(req.options, o => SUPPORT_PRIORITY[o.card?.id] ?? 3).id; }

  enterPick(g, pid) {
    const p = g.p(pid), night = g.s.night, arena = g.visibleArena(pid);
    // Un Perso qui partage son nom avec l'Arène la remplace : on ne le compte que s'il vaut mieux
    const cands = p.reserve.filter(c => g.aura(c) <= night && !c.faceDown);
    const N = Math.min(cands.length, 12);
    let best = [], bestV = 0;
    for (let mask = 1; mask < 1 << N; mask++) {
      const set = cands.filter((_, i) => mask & (1 << i));
      if (set.reduce((a, c) => a + g.aura(c), 0) > night) continue;
      // R40 : pas deux Persos qui partagent un nom (« Huam » et « Alana & Huam »)
      if (set.some((a, i) => set.some((b, j) => i < j && sharesName(g.def(a), g.def(b))))) continue;
      let v = 0;
      for (const c of set) {
        const same = arena.find(x => sharesName(g.def(x), g.def(c)));
        v += this.entryValue(g, c, night) - (same ? this.entryValue(g, same, night) : 0);
      }
      if (v > bestV) { bestV = v; best = set; }
    }
    this.lastEntry = { night, best, bestV, cands };
    return best;
  }
  enter(g, pid) {
    const set = this.enterPick(g, pid), e = this.lastEntry;
    this.note(g, `entrée nuit ${e.night} : ${set.map(c => g.label(c)).join(', ') || 'personne'} (v${e.bestV.toFixed(1)}) parmi ${e.cands.map(c => `${g.label(c)}[${g.aura(c)}]`).join(', ') || '—'}`);
    return set.map(c => c.uid);
  }

  keepSameName(g, pid, req) { return maxBy(req.options, o => g.aura(o.card)).id; }

  // ── Baston ────────────────────────────────────────────────
  evalPair(g, pid, f, t) {
    const o = 1 - pid;
    const mine = this.estimatePower(g, pid, f, t);
    const theirs = this.estimatePower(g, o, t, f, { known: false });
    const pWin = sigmoid((mine - theirs) / 2.2);
    const gain = g.aura(t) + this.dmgExpect(g, pid, f, t, true);
    // Perdre : son combattant, plus ce que le dégât adverse emporte avec lui (toute l'Arène pour Asmodheus)
    const loss = g.aura(f) + this.dmgExpect(g, o, t, f, false);
    return { v: pWin * gain - (1 - pWin) * loss * 0.8, pWin, gain, loss };
  }

  bestPair(g, pid, mine, theirs) {
    let best = null;
    const all = [];
    for (const f of mine) for (const t of theirs) {
      const e = this.evalPair(g, pid, f, t);
      all.push({ f, t, ...e });
      if (!best || e.v > best.v) best = { f, t, v: e.v };
    }
    if (g.traceOn && !this.quiet) {
      all.sort((a, b) => b.v - a.v);
      this.note(g, `paires : ${all.slice(0, 4).map(x => `${g.label(x.f)}→${g.label(x.t)} v${x.v.toFixed(2)} (P ${x.pWin.toFixed(2)}, +${x.gain.toFixed(1)}/−${x.loss.toFixed(1)})`).join(' | ')}`);
    }
    return best;
  }

  bastonFighter(g, pid, req) {
    const mine = req.options.filter(o => o.card).map(o => o.card);
    const best = this.bestPair(g, pid, mine, g.targetCandidates(pid));
    this.plan = best;
    if (!(best && best.v > 0.15)) this.note(g, 'passe la Baston (meilleure valeur ≤ 0,15)');
    return best && best.v > 0.15 ? best.f.uid : 'none';
  }
  bastonTarget(g, pid, req) {
    const t = this.plan?.t;
    return req.options.find(o => o.card === t)?.id ?? maxBy(req.options, o => g.aura(o.card)).id;
  }
  provocFighter(g, pid, req) {
    const best = this.bestPair(g, pid, req.options.map(o => o.card), g.targetCandidates(pid));
    this.plan = best;
    return best.f.uid;
  }
  provocTarget(g, pid, req) { return this.bastonTarget(g, pid, req); }
  finBaston(g, pid, req) {
    const mine = g.fighterCandidates(pid).filter(c => g.hasKw(c, 'TITAN'));
    const best = this.bestPair(g, pid, mine, g.targetCandidates(pid));
    const act = req.options.find(o => o.id.startsWith('act:'));
    return best && best.v > 0.3 && act ? act.id : 'no';
  }

  // ── Combat ────────────────────────────────────────────────
  margin(g, pid) { return g.power(pid) - g.power(1 - pid); }

  /** Simule la pose d'un Kick de la Main et renvoie le gain de marge estimé. */
  kickValue(g, pid, card) {
    const sd = g.side(pid), d = g.def(card);
    const before = this.margin(g, pid);
    const k = { ...card, zone: 'kicks', base: d.force, rang: d.rang, markers: [], activated: true, countered: false, piege: 0, cap: null, shielded: false };
    const undo = [];
    sd.kicks.push(k); sd.realPosed++;
    undo.push(() => { sd.kicks.pop(); sd.realPosed--; });
    let extra = 0;
    const cond = g.kickCondMet(k);
    const oLast = g.lastKick(1 - pid);
    if (cond) {
      switch (d.id) {
        case 'COUP_TRAITRE': if (oLast) { const b = oLast.base; oLast.base = 0; undo.push(() => (oLast.base = b)); } break;
        case 'FORCE_ENFOUIE': if (g.aura(g.fighter(pid)) < g.aura(g.fighter(1 - pid))) k.markers.push({ v: 3, src: pid }); break;
        case 'PAS_VU_VENIR': extra += 1.3; break;
        case 'BLESSURE': extra += 0.6; break;
        case 'DANSE_VENTS': extra += g.p(pid).fosse.length ? 0.8 : 0; break;
        case 'ENVOL': extra += g.visibleSupports(1 - pid).length ? 1 : 0; break;
        case 'INTRUSION': extra += Math.max(0, ...g.ownKicks(1 - pid).flatMap(x => x.markers.map(m => m.v))); break;
        case 'PICS': extra += 0.3; break;
        case 'BIG_NOVA': extra += 0.5; break;
        case 'DAGUE': extra += Math.max(0, ...g.ownKicks(1 - pid).map(x => g.kickForce(x) - 3)) + 0.8; break;
        case 'SAUVE': extra += 0.4; break;
        case 'SANS_PITIE': extra += 0.2; break;
        case 'TAILLADE': k.markers.push({ v: 2, src: pid }); break;
        case 'MOUSTIK': k.markers.push({ v: 1, src: pid }); extra += 0.6; break;
        case 'NADINE': { const x = Math.min(3, g.aura(g.fighter(1 - pid))); if (x) k.markers.push({ v: x, src: pid }); break; }
        case 'TRAVAIL': { const x = Math.min(3, g.visibleArena(pid).filter(c => g.hasKw(c, 'KILL STARS')).length); if (x) k.markers.push({ v: x, src: pid }); break; }
        case 'TELLURIQUE': { const x = g.lieuActivated(pid); if (x) k.markers.push({ v: x, src: pid }); break; }
        case 'VIOLENCE': extra += 1.2; break;
        case 'CROCS': extra += 1.4; break;
        case 'ATT_FOUDROYANTE': extra += Math.min(2, Math.max(0, ...g.ownKicks(1 - pid).map(x => g.kickForce(x)))); break;
        case 'KANINE': extra += 0.6 + (g.ownKicks(1 - pid).length ? 1 : 0); break;
        case 'REFLEXE': case 'NEGOCIATION': extra += g.side(1 - pid).turns < g.side(1 - pid).max ? 1 : 0.2; break;
        case 'PATATE': extra += sd.turns + 1 < sd.max ? 1.5 : 0; break;
        case 'PLAN': extra += 1.2; break;
        case 'FUITE': case 'TYMPANS': case 'ELECTRO_CHOC': extra += 0.6; break;
        case 'SUCETTE': {
          const prev = sd.kicks[sd.kicks.length - 2], kw = prev ? g.def(prev).kw : [];
          if (kw.includes('FEU') || kw.includes('POISSON')) k.markers.push({ v: 1, src: pid });
          if (kw.includes('MOTIF') || kw.includes('ART')) extra += sd.kicks.filter(x => x.rang === 'B').length;
          if (kw.includes('LUCKY STARS') && g.hasSupport(pid, 'FOUTEURS')) extra += 1.3;
          break;
        }
        case 'DEVIATION': extra += 0.8; break;
        case 'VIRTUOSITE': extra += 2 * Math.max(1, sd.kicks.length - 1); break;
        case 'COUPER_COURT': extra += g.visibleSupports(1 - pid).length ? 1 : 0; break;
        case 'TOMBE_PIC': extra += 1; break;
        case 'ENVIE_SANG': extra += Math.max(0, ...g.copyableMarkers(k).map(m => m.v)); break;
      }
    }
    // Combo complété par ce Kick ? (Nathalie ne bloque que le texte de la capacité, pas le bonus — R66)
    const f = g.fighter(pid), combo = g.def(f).combo;
    if (combo && !sd.comboActive && comboSatisfied(combo.ranks, sd.kicks.map(x => x.rang).filter(Boolean))) {
      sd.comboActive = true;
      undo.push(() => (sd.comboActive = false));
      if (g.hasKw(f, 'GARDE') || g.hasKw(f, 'VIF'))
        for (const x of sd.kicks) if (x.id === 'AGUERRI') { const b = x.base; x.base = 3; undo.push(() => (x.base = b)); }
      if (!(sd.comboBlocked && g.def(f).abType === 'CAPACITÉ')) extra += this.comboCapValue(g, pid, f);
    }
    if (d.rang === '★' && g.hasKw(g.fighter(pid), 'LUCKY STARS') && g.hasSupport(pid, 'FOUTEURS') && !g.s.combat.usedCombat.has(`fouteurs${pid}`)) extra += 1.3;
    const after = this.margin(g, pid);
    undo.reverse().forEach(u => u());
    const winning = after > 0;
    if (d.abType === 'DÉGÂT' && cond) extra += winning ? 1.5 : 0.3;
    return after - before + extra - 0.15;
  }

  comboCapValue(g, pid, f) {
    const o = 1 - pid, ok = g.ownKicks(o);
    switch (f.id) {
      case 'PREVICE': return ok.reduce((a, k) => a + k.base, 0);
      case 'SHUN2': return Math.max(0, ...ok.filter(k => k.rang === 'B' || k.rang === 'M').map(k => k.base));
      case 'SHUN3': return g.lastKick(o)?.base ?? 0;
      case 'ZERO2': return 1;
      case 'ZERO3': return 2;
      case 'TORO': return ['SEIGNEUR', 'KAISER', 'DUC'].some(k => g.hasKw(g.fighter(o), k)) ? 7.5 : 0.5;
      case 'ROI_FURY': return 1.5;
      case 'CHARLY2': return g.visibleSupports(o).length ? 1 : 0;
      case 'JERZEY2': case 'SATURN': case 'RAIDEN': case 'DOLCHE': return 1.5;
      case 'INNA': return g.p(o).reserve.length ? 1.5 : 0;
      case 'MAGOSS': case 'EVE3': case 'SONIC3': return 1;
      case 'TERRENCE2': return 1.5;
      case 'TERRENCE3': return 2.5;
      case 'SAVANE3': return g.side(o).turns < g.side(o).max ? 2 : 0;
      case 'AKIM': return 2;
      case 'HIKARI_RAIDEN': return ok.length ? 2 : 0;
      case 'FLAM3': return g.side(o).comboActive ? g.comboBonus(o) : 1;
      case 'MANIAC4': return 2;
      default: return g.def(f).abType === 'DÉGÂT' ? 1.5 : 0;
    }
  }

  /** Gain et coût estimés d'une action de combat. */
  actionValue(g, pid, opt) {
    const o = 1 - pid, c = opt.card, kicks = g.ownKicks(pid);
    const forceOf = arr => Math.max(0, ...arr.map(k => g.kickForce(k)));
    if (opt.lieuIndex != null) {
      const lieu = g.lieu(pid).effect;
      if (this.lieuEager(g, pid)) return { gain: 1.5, cost: 0, late: false };
      if (lieu === 'CRANE' && opt.lieuIndex === 0) return { gain: 0, cost: g.p(pid).hand.length <= 4 ? -0.5 : 1, late: false };
      if (lieu === 'CRANE' && opt.lieuIndex === 1) return { gain: 1, cost: 0.4, late: true };
      return { gain: 0, cost: 1 };
    }
    switch (c?.id) {
      case 'NEIL1': return { gain: forceOf(kicks.filter(k => g.kickHasKw(k, 'FEU'))), cost: 1.3, late: true };
      case 'CHARLY1': return { gain: kicks.filter(k => k.rang === 'B').length, cost: 1.2, late: true };
      case 'CHARLY3': return { gain: 2 * kicks.length, cost: 2, late: true };
      case 'TERRENCE1': return { gain: kicks.filter(k => k.rang === '★').length + 0.5, cost: 0, late: false };
      case 'SABBA': return { gain: 0.8, cost: 0.4, late: true };
      case 'PAULY': return { gain: g.hasKw(g.fighter(pid), 'LUCKY STARS') ? 2 : 1, cost: 0.2, late: true };
      case 'KAIN0': return { gain: g.hasKw(g.fighter(pid), 'V.NOIRS') ? 2 : 1, cost: 0.3, late: true };
      case 'KAIN2': {
        const theirs = maxBy(g.ownKicks(o), k => k.base), mine = minBy(kicks, k => k.base);
        return { gain: theirs && mine ? 2 * (theirs.base - mine.base) : 0, cost: 1.5, late: true };
      }
      case 'FUKMI': return { gain: g.ownKicks(o).reduce((a, k) => a + k.markers.filter(m => m.src === o && m.v > 0).reduce((s, m) => s + m.v, 0), 0), cost: 1, late: true };
      case 'CELESTE2': return { gain: 2 * kicks.filter(k => g.kickHasKw(k, 'TITAN')).length, cost: 0, late: true };
      case 'ISAAK1': return { gain: g.p(pid).hand.some(x => g.def(x).type === 'K') ? 2 : 0, cost: 1, late: false };
      case 'BAGUE_FEU': return { gain: 1, cost: 0.4, late: true };
      case 'DEBARRASSER': return { gain: kicks.filter(k => !k.activated).length, cost: 0, late: true };
      // Nathalie ne bloque que le texte du Combo adverse (R66) : on évalue cette capacité
      case 'NATHALIE': return { gain: this.comboCapValue(g, o, g.fighter(o)) * 0.9, cost: 0.4, late: false };
      case 'ANGELITO': return { gain: 1.5, cost: 0, late: false };
      case 'EPONY3': return { gain: kicks.filter(k => k.rang === 'M').length + 0.5, cost: g.aura(c) > 2 ? 1.5 : 0.5, late: true };
      case 'VULCAIN': return { gain: g.side(pid).comboActive ? 3 : 1.5, cost: 0, late: true };
      case 'HIKARI1': return { gain: kicks.filter(k => k.rang === '★').length, cost: 0, late: true };
      case 'SHAKA1': return { gain: 2, cost: 0, late: true };
      case 'SHAKA3': return { gain: kicks.filter(k => g.def(k).kw.some(w => g.keywords(c).includes(w))).length, cost: 0, late: true };
      case 'FLAM2': return { gain: 1, cost: 1, late: false };
      case 'GERIKO2': return { gain: 0.5, cost: 1, late: false };
      case 'MANIAC1': return { gain: Math.max(0, ...g.p(pid).hand.map(x => g.def(x).force ?? 0)), cost: 1.5, late: true };
      case 'MILAN': return { gain: kicks.filter(k => g.kickHasKw(k, 'FÉLIN')).length, cost: 0, late: true };
      case 'DANSE_KILL': {
        // Kicks en Main qui s'activeraient grâce aux mots-clés empruntés
        const f = g.fighter(pid), now = g.keywords(f);
        const extra = new Set(g.visibleArena(pid).filter(x => x !== f && g.hasKw(x, 'KILL STARS')).flatMap(x => g.keywords(x)));
        const unlocked = g.p(pid).hand.filter(x => { const d = g.def(x); return d.type === 'K' && !d.kw.includes('BASE') && !d.kw.some(w => now.includes(w)) && d.kw.some(w => extra.has(w)); }).length;
        return { gain: 0.6 + unlocked, cost: 0, late: false };
      }
      default:
        if (opt.label?.startsWith('Révéler')) return { gain: g.def(c).force ?? 1, cost: 0, late: true };
        return { gain: 0.5, cost: 0.5, late: true };
    }
  }

  kickTurn(g, pid, req) {
    // Actions « tôt » rentables
    for (const o of req.options.filter(x => x.action)) {
      const v = this.actionValue(g, pid, o);
      if (!v.late && v.gain - v.cost >= 1) return o.id;
    }
    const sd = g.side(pid);
    const left = sd.max - sd.turns;
    const isaak = req.options.find(o => o.card?.id === 'ISAAK1');
    if (isaak && left === 1 && g.p(pid).hand.filter(c => g.def(c).type === 'K').length >= 2) return isaak.id;
    const kicks = req.options.filter(o => o.id.startsWith('kick:'));
    if (!kicks.length) { this.note(g, 'passe : aucun Kick jouable'); return 'pass'; }
    const scored = kicks.map(o => ({ o, v: this.kickValue(g, pid, o.card) }));
    const best = maxBy(scored, x => x.v);
    if (!(best.v > 0)) this.note(g, `passe : ${scored.map(x => `${g.label(x.o.card)} v${x.v.toFixed(1)}`).join(', ')}`);
    return best.v > 0 ? best.o.id : 'pass';
  }

  /** Fenêtre finale : on utilise les boosts pour renverser ou sécuriser le combat. */
  window_combat(g, pid, req) {
    const m = this.margin(g, pid);
    const acts = req.options.filter(o => o.action).map(o => ({ o, ...this.actionValue(g, pid, o) }));
    const stake = g.aura(g.fighter(1 - pid)) + g.aura(g.fighter(pid));
    const useful = acts.filter(a => a.gain > 0 && a.gain - a.cost > -1 && m + a.gain >= 0 && m <= 0 && stake > a.cost);
    if (useful.length) return minBy(useful, a => a.cost - a.gain * 0.1).o.id;
    const cheap = acts.filter(a => a.cost <= 0 && a.gain > 0 && m <= 2);
    return cheap.length ? cheap[0].o.id : 'pass';
  }
  window_denouement(g, pid, req) {
    const m = this.margin(g, pid);
    const a = req.options.find(o => o.action);
    return a && m <= 0 && m >= -1 ? a.id : 'pass';
  }
  window_combatStart(g, pid, req) {
    const ang = req.options.find(o => o.card?.id === 'ANGELITO');
    if (ang) return ang.id;
    const mal = req.options.find(o => o.card?.id === 'MALICE');
    if (mal) {
      const of = g.fighter(1 - pid), cur = g.fighter(pid);
      const cands = g.visibleArena(pid).filter(x => x !== cur && g.aura(x) > g.aura(cur));
      const best = maxBy(cands, x => this.estimatePower(g, pid, x, of));
      if (best && this.estimatePower(g, pid, best, of) > this.estimatePower(g, pid, cur, of) + 1) return mal.id;
    }
    return 'pass';
  }
  malice(g, pid, req) { const of = g.fighter(1 - pid); return maxBy(req.options, o => this.estimatePower(g, pid, o.card, of)).id; }
  window_finCombat(g, pid, req) {
    const p = g.p(pid);
    const mur = req.options.find(o => o.card?.id === 'MUR_FORCE');
    if (mur && p.hand.length + g.aura(g.fighter(pid)) <= 9) return mur.id;
    const crane = req.options.find(o => o.lieuIndex === 2);
    if (crane && (this.lieuEager(g, pid) || (p.hand.length <= 4 && p.reserve.some(c => g.def(c).aura >= 2)))) return crane.id;
    return 'pass';
  }
  window_aurore(g, pid, req) {
    const o = 1 - pid;
    const me = g.control(pid), them = g.control(o);
    const froid = req.options.find(x => x.card?.id === 'JAI_FROID');
    if (froid && me <= them) {
      const top = maxBy(g.visibleArena(o), c => g.aura(c));
      if (top && me > them - Math.min(2, g.aura(top))) return froid.id;
    }
    const lieu = i => req.options.find(x => x.lieuIndex === i);
    if (g.lieu(pid).effect === 'PLAINES') {
      if (lieu(0) && me <= them && me + 1 > them) return lieu(0).id;
      if (lieu(1) && g.s.night >= 2) return lieu(1).id;
      if (lieu(2) && g.s.night >= 3) return lieu(2).id;
    }
    if (g.lieu(pid).effect === 'DELIRIUM' && lieu(2) && g.s.night >= 3) return lieu(2).id;
    const any = req.options.find(x => x.lieuIndex != null);
    if (any && this.lieuEager(g, pid)) return any.id;
    return 'pass';
  }

  // ── Contres ───────────────────────────────────────────────
  counter(g, pid, req) {
    const ev = req.options[0].ev;
    const o = req.options.find(x => x.id !== 'no');
    let value = 0;
    if (ev.kind === 'combo') value = ev.source ? this.comboCapValue(g, ev.by, ev.source) : 0;
    if (ev.kind === 'capacity') value = this.capacityThreat(g, pid, ev);
    if (ev.kind === 'damage') {
      value = this.damageValue(g, ev.by, ev.dmgId);
      if (o.card?.id === 'SAUVE') value -= g.aura(ev.target) * 0.5 + 1.5;
    }
    const cost = o.card?.id === 'SAUVE' ? 0 : g.p(pid).teams.has('FLOCONS') ? 1 : 1.8;
    return value > cost + 0.4 ? o.id : 'no';
  }

  capacityThreat(g, pid, ev) {
    const s = ev.source;
    if (!s) return 1;
    const d = g.def(s);
    const myLast = g.lastKick(pid);
    switch (d.id) {
      case 'COUP_TRAITRE': return myLast?.base ?? 0;
      case 'FORCE_ENFOUIE': return 3;
      case 'ETALE': return 3;
      case 'BOULE_FEU': case 'LIBERER': case 'BLOCAGE': case 'FOU_RAGE': return 2;
      case 'NEIL1': return 3;
      case 'CELESTE2': case 'CHARLY3': return 3;
      case 'EN_MISSION': case 'DEBARRASSER': return 2.5;
      case 'PAS_VU_VENIR': return 1.2;
      default: return 1;
    }
  }

  damageValue(g, w, id, t = g.fighter(1 - w)) {
    const l = 1 - w;
    const a = t ? g.aura(t) : 0;
    const arena = g.visibleArena(l);
    switch (id) {
      case 'ARKA': return a + 3;
      case 'ASMODHEUS': return arena.filter(c => g.aura(c) <= a).reduce((s, c) => s + g.aura(c) + 1, 0);
      case 'EPONY4': return a + 2;
      case 'SEALVIA3': return a + arena.filter(c => c !== t && g.aura(c) < 3).length;
      case 'PUNCH': case 'SACHA': return a + 1;
      case 'MANDALE_TITAN': return a * 0.7 + 2;
      case 'CELESTE3': return a * 0.5 + 2;
      case 'MEGA_MANDALE': return a * 0.5 + 1;
      case 'COUP_BOULE': return a * 0.5;
      case 'BATTE': return g.s.combat?.final?.[w] >= 17 ? a + 1 : a * 0.5;
      case 'SEALVIA2': return g.p(l).reserve.filter(c => g.aura(c) < 2).length;
      case 'EXTHA': return 1;
      case 'DEBOITAGE': return 1.2;
      case 'UPPERCUT': case 'MOBY': case 'JIMMY3': return a * 0.6 + 1;
      case 'EBOULEMENT': return g.lieuActivated(w) >= 3 ? a + 1 : a * 0.5;
      case 'JIMMY2': return a * 0.5 + 1;
      case 'ROMUALD': return 1.5;
      case 'ATTILA': return (a + 2) * 0.6;
      case 'ACTARUS': return 2;
      case 'LION2': return a * 0.5 + 1.5;
      case 'LION4': return a * 0.5 + arena.filter(c => c !== t && g.aura(c) < a).length;
      default: return 1;
    }
  }

  damage(g, pid, req) {
    const opts = req.options.filter(o => o.dmgId && !o.countered);
    const best = maxBy(opts, o => this.damageValue(g, pid, o.dmgId) - (o.dmgId === 'BATTE' ? 0.5 : 0));
    return best?.id ?? 'none';
  }

  // ── Ciblage & choix divers ────────────────────────────────
  target(g, pid, req) {
    const opts = req.options.filter(o => o.card);
    if (!opts.length) return 'none';
    const val = c => (c.zone === 'kicks' ? g.kickForce(c) + (c.markers.reduce((a, m) => a + Math.max(0, m.v), 0) * 0.3)
      : g.def(c).type === 'P' ? g.aura(c) : SUPPORT_PRIORITY[c.id] ?? 3);
    const theirs = opts.filter(o => o.card.owner !== pid);
    if (theirs.length) {
      if (req.title.startsWith('Nouveau combattant')) {
        const cur = g.fighter(1 - pid);
        const better = theirs.filter(o => g.aura(o.card) > g.aura(cur));
        return better.length ? maxBy(better, o => g.aura(o.card)).id : 'none';
      }
      return maxBy(theirs, o => val(o.card)).id;
    }
    return maxBy(opts, o => val(o.card)).id;
  }

  huam(g, pid, req) {
    const orig = req.ctx?.original;
    const val = c => (c.zone === 'kicks' ? g.kickForce(c) : g.def(c).type === 'P' ? g.aura(c) : SUPPORT_PRIORITY[c.id] ?? 3);
    const alt = minBy(req.options.filter(o => o.card), o => val(o.card));
    return alt && orig && val(alt.card) + 0.5 < val(orig) ? alt.id : 'none';
  }

  pick(g, req, f, best = true) {
    const opts = req.options.filter(o => o.card);
    if (!opts.length) return req.options[0].id;
    return (best ? maxBy : minBy)(opts, o => f(o.card)).id;
  }

  search(g, pid, req) {
    const p = g.p(pid);
    const need = req.options.find(o => o.card?.id === 'EN_MISSION' && !p.teams.has('FLOCONS') && !p.hand.some(c => c.id === 'EN_MISSION'));
    if (need) return need.id;
    return this.pick(g, req, c => (c.zone === 'reserve' ? -100 : 0) + this.cardValue(g, c) + (g.def(c).type === 'S' ? (SUPPORT_PRIORITY[c.id] ?? 0) / 3 : 0));
  }
  fromFosse(g, pid, req) { return this.pick(g, req, c => this.cardValue(g, c)); }
  discardOwn(g, pid, req) {
    if (req.max > 1 || req.min > 1) {
      return [...req.options].sort((a, b) => this.cardValue(g, a.card) - this.cardValue(g, b.card)).slice(0, req.min).map(o => o.id);
    }
    return this.pick(g, req, c => this.cardValue(g, c), false);
  }
  reserveToBottom(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  lowestToReserve(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  arkaFlip(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  roiFury(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  cost(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  recycle(g, pid, req) { return this.pick(g, req, c => g.aura(c)); }
  takeBack(g, pid, req) { return this.pick(g, req, c => g.def(c).force); }
  protect(g, pid, req) { return this.pick(g, req, c => g.aura(c)); }
  recruitPick(g, pid, req) { return this.pick(g, req, c => g.def(c).aura - (c.id === 'BORO' ? 10 : 0)); }
  teleport(g, pid, req) { return this.pick(g, req, c => g.def(c).aura); }
  auraBoost(g, pid, req) { return this.pick(g, req, c => g.aura(c)); }
  swapOwn(g, pid, req) { return this.pick(g, req, c => c.base, false); }
  pics(g, pid) { return g.p(1 - pid).deck.songe.some(id => ['BLESSURE', 'KANINE', 'MOUSTIK'].includes(id)) ? 'discard' : 'draw'; }
  boro(g, pid, req) {
    const others = g.p(pid).groupe.some(c => g.hasKw(c, 'FLOCONS') && c.id !== 'BORO');
    return req.options.some(o => o.id === 'recruit') && others ? 'recruit' : 'search';
  }
  sachaAngelito() { return 'yes'; }
  topBottom(g, pid, req) {
    const c = req.options[0].card, d = g.def(c);
    return (d.type === 'K' && this.cardValue(g, c) >= 2.5) || (d.type === 'S' && (SUPPORT_PRIORITY[d.id] ?? 0) >= 6) ? 'top' : 'bottom';
  }
  topBottomGroupe(g, pid, req) { return g.def(req.options[0].card).aura >= 2 ? 'top' : 'bottom'; }

  // ── Nouvelles cartes du catalogue ─────────────────────────
  acceptRefuse(g, pid, req) {
    const v = req.ctx?.values ?? { accept: 0, refuse: 0 };
    const mine = req.ctx?.actor === pid;
    return (mine ? v.accept >= v.refuse : v.accept <= v.refuse) ? 'accept' : 'refuse';
  }
  /** Rafaelo : vaut le coup si l'option qu'on imposerait vaut nettement plus que celle que l'adversaire prendrait. */
  rafaelo(g, pid, req) {
    const v = req.ctx?.values ?? { accept: 0, refuse: 0 };
    return Math.abs(v.accept - v.refuse) >= 0.8 ? 'yes' : 'no';
  }
  youngInf(g, pid, req) { const v = req.ctx?.values ?? {}; return Math.min(v.accept ?? 0, v.refuse ?? 0) >= 0.8 ? 'yes' : 'no'; }
  rank(g, pid, req) {
    const card = req.ctx?.card, ids = req.options.map(o => o.id);
    if (req.title.startsWith('Virtuosité')) {
      const ranks = [...g.ownKicks(pid), ...g.p(pid).hand.filter(c => g.def(c).type === 'K')].map(k => k.rang ?? g.def(k).rang);
      return maxBy(ids, r => ranks.filter(x => x === r).length);
    }
    const owner = card?.owner ?? 1 - pid;
    const f = g.fighter(owner), combo = f && g.def(f).combo;
    if (owner === pid) {
      // Compléter son propre Combo
      const have = g.ownKicks(pid).filter(k => k !== card).map(k => k.rang);
      const miss = combo?.ranks.find(r => { const i = have.indexOf(r); if (i >= 0) { have.splice(i, 1); return false; } return true; });
      return ids.includes(miss) ? miss : ids.includes('★') ? '★' : ids[0];
    }
    // Casser le Combo adverse : un Rang dont il n'a pas besoin
    const useless = ids.filter(r => r !== '★' && !combo?.ranks.includes(r));
    return useless[0] ?? ids.find(r => r !== '★') ?? ids[0];
  }
  maniacKw(g, pid, req) {
    const kicks = [...g.ownKicks(pid), ...g.p(pid).hand.filter(c => g.def(c).type === 'K')];
    return maxBy(req.options, o => kicks.filter(k => g.def(k).kw.includes(o.id)).length).id;
  }
  dolcheHide(g, pid, req) {
    const k = req.options.filter(o => o.card && g.def(o.card).type === 'K');
    return k.length ? maxBy(k, o => g.def(o.card).force).id : 'none';
  }
  reactivate(g, pid, req) { return this.pick(g, req, c => this.cardValue(g, c)); }
  boostOwn(g, pid, req) { return this.pick(g, req, c => g.kickForce(c)); }
  lionCurse(g, pid, req) { return this.pick(g, req, c => g.aura(c), false); }
  groupePos() { return 'top'; }
  flipOwn(g, pid, req) { return [...req.options].sort((a, b) => g.aura(a.card) - g.aura(b.card)).slice(0, req.min).map(o => o.id); }
  auraZero(g, pid, req) { return this.flipOwn(g, pid, req); }
  artDestruction(g, pid, req) {
    if (req.options.some(o => o.id === 'lieu')) return 'lieu';
    return req.options.some(o => o.id === 'support') ? 'support' : req.options[0].id;
  }
  wasteLieu(g, pid, req) { return req.options[req.options.length - 1].id; }
  envieSang(g, pid, req) { return maxBy(req.options, o => o.value ?? 0).id; }
  /** Envie de sang / Étalé en un coup simultanés : Envie d'abord garde Étalé actif, donc une liste plus riche. */
  envieOrder() { return 'envie'; }
  alanaFlip() { return 'none'; }
  jung(g, pid, req) {
    const { effect, idx } = req.ctx ?? {};
    const good = { DEESSES: [0, 2] }[effect] ?? []; // recruter compense le retour de Jung sous le Groupe
    return g.s.night >= 2 && good.includes(idx) ? 'yes' : 'no';
  }
  partage() { return 'no'; }
  tombePic() { return 'yes'; }
  elvis(g, pid) { return g.p(pid).gold >= 3 ? 'pay' : 'exile'; }
  oneMandatory(g, pid) {
    const p = g.p(pid);
    if ([...p.arena, ...p.supports].some(c => c.faceDown)) return 'flip';
    return p.hand.length < 5 ? 'draw' : 'recruit';
  }
}