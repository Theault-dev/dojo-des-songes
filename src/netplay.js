// ─────────────────────────────────────────────────────────────
// Jeu entre joueurs, côté navigateur.
//
// `RemoteView` présente l'état filtré envoyé par le serveur avec la même
// interface que le moteur (`g.p(pid)`, `g.aura(c)`, `g.s.combat`…), pour
// que l'interface l'affiche comme une partie locale. Il est toujours vu
// depuis le joueur local : vous êtes le joueur 0, l'adversaire le 1 (le
// serveur, lui, numérote selon l'ordre d'arrivée).
//
// `NetClient` : compte connecté (/auth/me) et WebSocket (/ws) avec
// reconnexion automatique.
// ─────────────────────────────────────────────────────────────
import { CARDS, LIEUX } from './data.js';

const HIDDEN_LIEU = { name: 'Lieu caché', abilities: [] };

export class RemoteView {
  /** `myDeck` : le deck envoyé par ce joueur (nom, famille de couleur). */
  constructor({ names, you, mode, myDeck }) {
    this.you = you;
    this.mode = mode;
    this.names = you === 0 ? [...names] : [names[1], names[0]];
    this.myDeck = myDeck;
    this.uidOf = new Map();   // poignée opaque → identifiant numérique local
    this.byUid = new Map();
    this.nextUid = 1;
    this.s = { night: 0, phase: 'Mise en place', first: 0, active: null, over: false, result: null, combat: null, log: [], history: [] };
    this.players = [0, 1].map(pid => this.emptyPlayer(pid));
  }

  /** Numéro de joueur du serveur → numéro local (vous = 0). */
  P(pid) { return pid == null ? pid : this.you === 0 ? +pid : 1 - pid; }

  emptyPlayer(pid) {
    return {
      pid, name: this.names[pid], deck: pid === 0 ? this.myDeck : { name: 'Deck adverse', groupe: [] },
      renommee: 0, gold: 0, teams: new Set(), control: 0, lieuId: null, lieuUsed: [false, false, false], lieuUsedNight: false,
      hand: [], reserve: [], arena: [], supports: [], piles: [], fosse: [], exil: [], groupe: [], songe: [],
    };
  }

  /** Identifiant numérique stable pour une poignée ; une carte sans poignée en reçoit un neuf. */
  uidFor(h) {
    if (h == null) return -(this.nextUid++);
    if (!this.uidOf.has(h)) this.uidOf.set(h, this.nextUid++);
    return this.uidOf.get(h);
  }

  card(v) {
    if (!v) return null;
    const c = {
      uid: this.uidFor(v.hidden ? null : v.h), owner: this.P(v.owner), zone: v.zone,
      markers: (v.markers ?? []).map(m => ({ v: m.v, src: this.P(m.src) })), tmp: { ...(v.tmp ?? {}) },
    };
    if (v.hidden) Object.assign(c, { hidden: true, faceDown: true });
    else Object.assign(c, {
      id: v.id, faceDown: !!v.faceDown, rang: v.rang, slot: v.slot, cap: v.cap,
      countered: !!v.countered, silenced: !!v.silenced, shielded: !!v.shielded,
      _aura: v.aura, _force: v.force, _kw: v.kw ?? [], _cond: v.condMet,
    });
    this.byUid.set(c.uid, c);
    return c;
  }

  /** Nouvel état reçu du serveur. */
  load(view) {
    this.byUid = new Map();
    const P = x => this.P(x);
    const players = [view.players[this.you], view.players[1 - this.you]];
    this.players = players.map((v, pid) => {
      const p = this.emptyPlayer(pid);
      const cards = arr => arr.map(x => this.card(x));
      Object.assign(p, {
        renommee: v.renommee, gold: v.gold, teams: new Set(v.teams), control: v.control ?? 0,
        lieuId: v.lieu?.id ?? null, lieuUsed: v.lieu?.used ?? [false, false, false], lieuUsedNight: !!v.lieu?.usedNight,
        // Main adverse : des dos de carte, seulement leur nombre
        hand: v.hand ? cards(v.hand) : Array.from({ length: v.counts.hand }, () => ({ uid: this.uidFor(null), owner: pid, zone: 'hand', hidden: true, faceDown: true, markers: [], tmp: {} })),
        reserve: cards(v.reserve), arena: cards(v.arena), fosse: cards(v.fosse), exil: cards(v.exil),
        piles: v.supports.map(pile => cards(pile)),
        groupe: Array(v.counts.groupe).fill(null), songe: Array(v.counts.songe).fill(null),
        decklist: v.decklist ?? null,
      });
      p.supports = p.piles.flat();
      if (pid === 1) {
        // Couleur du deck adverse : d'après sa decklist (deck ouvert) ou les Persos déjà vus
        const seen = [...p.arena, ...p.reserve, ...p.fosse, ...p.exil].filter(c => c.id && CARDS[c.id]?.type === 'P').map(c => c.id);
        p.deck = { name: v.decklist ? 'Deck ouvert' : 'Deck adverse', groupe: v.decklist?.groupe ?? seen };
      }
      return p;
    });
    let combat = null;
    if (view.combat) {
      const c = view.combat;
      combat = {
        attacker: P(c.attacker), provoc: c.provoc, stage: c.stage, sides: {},
        final: c.final ? { [P(0)]: c.final[0], [P(1)]: c.final[1] } : null,
        winners: c.winners ? c.winners.map(P) : null,
      };
      for (const [spid, sd] of Object.entries(c.sides)) {
        const f = this.card(sd.fighter);
        combat.sides[P(+spid)] = { ...sd, fighter: f?.uid ?? null, fighterCard: f, kicks: sd.kicks.map(k => this.card(k)), hidden: this.card(sd.hidden) };
      }
    }
    // Le combattant figure aussi dans l'Arène : même identifiant, on garde l'objet de l'Arène
    for (const p of this.players) for (const c of p.arena) this.byUid.set(c.uid, c);
    Object.assign(this.s, {
      // La fin de partie ne vient que du message « over » du serveur (raison, graine révélée)
      night: view.night, phase: view.phase, first: P(view.first), active: P(view.active),
      combat, history: view.history.map(h => (this.you === 0 ? h : [h[1], h[0]])),
      log: view.log.map(l => ({ night: l.night, pid: P(l.pid), text: l.text })),
    });
  }

  /** Question du serveur, au format de l'interface (cartes converties, mêmes champs). */
  request(m) {
    return {
      seq: m.seq, kind: m.kind, title: m.title, min: m.min, max: m.max, multi: m.multi, ctx: m.ctx,
      options: m.options.map(o => ({ ...o, card: o.card ? this.card(o.card) : undefined })),
    };
  }

  // ── Interface du moteur utilisée par l'affichage ──────────
  p(pid) { return this.players[pid]; }
  other(pid) { return 1 - pid; }
  def(c) { return CARDS[c.id]; }
  label(c) { if (c.hidden) return 'Carte cachée'; const d = CARDS[c.id]; return d.sub ? `${d.name} (${d.sub})` : d.name; }
  pname(pid) { return this.players[pid]?.name ?? ''; }
  lieu(pid) { return LIEUX[this.players[pid].lieuId] ?? HIDDEN_LIEU; }
  aura(c) { return c?.hidden ? 0 : c?._aura ?? CARDS[c?.id]?.aura ?? 0; }
  keywords(c) { return c?._kw ?? []; }
  kickForce(c) { return c._force ?? CARDS[c.id]?.force ?? 0; }
  kickCondMet(c) { return c._cond !== false; }
  control(pid) { return this.players[pid].control; }
  supportStacks(pid) { return this.players[pid].piles; }
  find(uid) { return this.byUid.get(uid) ?? null; }
  side(pid) { return this.s.combat?.sides[pid] ?? null; }
  fighter(pid) { const sd = this.side(pid); return sd ? this.find(sd.fighter) ?? sd.fighterCard : null; }
  isFighter(c) { return this.side(c.owner)?.fighter === c.uid; }
  power(pid) { return this.side(pid)?.power ?? 0; }
  comboBonus(pid) { return this.side(pid)?.comboBonus ?? 0; }
  targetCandidates() { return []; }
}

/** Connexion au serveur de jeu (même origine que la page). */
export class NetClient {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.retry = 0;
    this.stopped = false;
    this.queue = [];   // messages envoyés avant l'ouverture de la connexion
  }

  /** Compte connecté : { available, user, discord, devLogin } ; `available` faux hors du site (pas de serveur). */
  static async probe() {
    try {
      if (!/^https?:$/.test(location.protocol)) return { available: false };
      const r = await fetch('/auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!(r.headers.get('content-type') ?? '').includes('application/json')) return { available: false };
      const j = await r.json();
      if (r.ok && j.user) return { available: true, user: j.user, discord: true };
      if (r.status === 401 && j.error === 'not-logged-in') return { available: true, user: null, discord: !!j.discord, devLogin: !!j.devLogin };
    } catch { /* hors ligne ou pas de serveur */ }
    return { available: false };
  }

  connect() {
    this.stopped = false;
    if (this.ws && this.ws.readyState <= 1) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      this.onStatus?.('open');
    };
    ws.onmessage = e => { try { this.onMessage(JSON.parse(e.data)); } catch { /* message illisible */ } };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.onStatus?.('closed', e.code);
      // 4000 : ouvert ailleurs ; 4001 : session fermée — pas de reconnexion automatique
      if (this.stopped || e.code === 4000 || e.code === 4001) return;
      const wait = Math.min(15000, 1000 * 2 ** this.retry++);
      setTimeout(() => !this.stopped && this.connect(), wait);
    };
  }

  /** Envoie tout de suite, ou dès que la connexion est (r)ouverte. */
  send(msg) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    if (this.queue.length < 10) this.queue.push(msg);
    if (!this.stopped) this.connect();
    return false;
  }
  close() { this.stopped = true; this.ws?.close(); this.ws = null; }
}
