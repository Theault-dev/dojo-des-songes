// ─────────────────────────────────────────────────────────────
// Salons et parties à distance, indépendants du transport.
//
// Chaque connexion (`conn` : send(texte), close(code, raison), événements
// 'message' et 'close') appartient à un compte connecté (`user`). Messages :
//   { type: 'create', deck | deckText, seed?, mode? }   → 'created'
//   { type: 'join', invite, deck | deckText, seed? }    → 'joined' puis 'start'
//   { type: 'cancel' }                                  → ferme son salon en attente
//   { type: 'answer', seq, answer }                     → réponse à 'ask'
// Le serveur envoie : hello, created, waiting, cancelled, start, state,
// ask, clock, event, opponent, over, replaced, error. Voir docs/PVP.md.
//
// Pendule : chaque joueur dispose d'un temps total (+ un incrément par
// réponse) qui ne s'écoule que pendant ses questions ; à zéro, il perd.
//
// Le siège est lié au compte : se connecter depuis un autre appareil
// reprend la partie (la connexion la plus récente gagne).
// ─────────────────────────────────────────────────────────────
import { createHash, randomBytes } from 'node:crypto';
import { validateDeck } from '../src/data.js';
import { parseDecks } from '../src/deckio.js';
import { createRemoteGame, mixSeed, commitSeed } from '../src/pvp/remote.js';

const MIN = 60_000;
export const DEFAULTS = {
  maxRooms: 100,            // salons simultanés (en attente + en cours)
  inviteTtl: 15 * MIN,      // durée de vie d'une invitation non utilisée
  grace: 3 * MIN,           // délai de reconnexion avant forfait
  finishedTtl: 5 * MIN,     // salon terminé gardé pour une reprise tardive
  rate: 10, burst: 30,      // messages par seconde par connexion (seau à jetons)
  roomsPerHour: 10,         // salons créés par compte et par heure
  clockBank: 20 * MIN,      // temps de réflexion par joueur et par partie
  clockIncrement: 5000,     // temps rendu à chaque réponse
  counterDelay: [800, 2000],// pause (ms) quand aucun contre n'est possible : cache qu'on en avait un
  version: null,            // version du moteur : une partie sauvegardée n'est reprise que par le même moteur
};
const MODES = new Set(['casu', 'open']);

const token = (n = 32) => randomBytes(n).toString('base64url');
const hash = t => createHash('sha256').update(String(t)).digest('hex');
const isStr = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;

/** Nom de deck affichable : 1 à 24 caractères, sans caractères de contrôle. */
function cleanName(x) {
  if (typeof x !== 'string') return null;
  const n = x.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 24);
  return n || null;
}

/** Deck reçu d'un client : objet ou texte de decklist, toujours revalidé ici. */
export function readDeck(msg) {
  let d = null;
  if (isStr(msg.deckText, 20_000)) d = parseDecks(msg.deckText).decks?.[0] ?? null;
  else if (msg.deck && typeof msg.deck === 'object') d = msg.deck;
  if (!d) return { error: 'Deck absent ou illisible.' };
  const ids = a => (Array.isArray(a) && a.length <= 100 && a.every(x => isStr(x, 40)) ? [...a] : null);
  const deck = { id: 'pvp', name: cleanName(d.name) ?? 'Deck', lieu: typeof d.lieu === 'string' ? d.lieu : null, groupe: ids(d.groupe), songe: ids(d.songe) };
  if (!deck.groupe || !deck.songe) return { error: 'Deck mal formé.' };
  const v = validateDeck(deck);
  return v.ok ? { deck } : { error: v.errors.join(' ') };
}

export class Lobby {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.now = opts.now ?? (() => Date.now());
    this.onFinished = opts.onFinished ?? (() => {});   // (résumé de partie) → base de données
    this.rooms = new Map();     // id → salon
    this.invites = new Map();   // haché d'invitation → salon
    this.byUser = new Map();    // compte → { room, pid } (salon en attente ou partie en cours)
    this.created = new Map();   // compte → dates de création de salons (dernière heure)
    this.lastOver = new Map();  // compte → fin de partie non reçue (déconnecté à ce moment-là)
  }

  // ── Connexions ──────────────────────────────────────────
  /** `user` : { id, name } du compte connecté (vérifié par le serveur HTTP avant). */
  attach(conn, user) {
    const st = { conn, user, seat: null, tokens: this.o.burst, last: this.now() };
    conn.on('message', text => this.onMessage(st, text));
    conn.on('close', () => this.onClose(st));
    this.send(conn, { type: 'hello', user: { id: user.id, name: user.name } });
    if (this.byUser.has(user.id)) this.resume(st);
    else if (this.lastOver.has(user.id)) { this.send(conn, this.lastOver.get(user.id).msg); this.lastOver.delete(user.id); }
    return st;
  }

  send(conn, msg) { if (conn?.open !== false) try { conn.send(JSON.stringify(msg)); } catch { /* connexion perdue */ } }
  error(st, error, extra = {}) { this.send(st.conn, { type: 'error', error, ...extra }); }

  onMessage(st, text) {
    // Seau à jetons : au-delà du débit autorisé, la connexion est fermée
    const t = this.now();
    st.tokens = Math.min(this.o.burst, st.tokens + ((t - st.last) / 1000) * this.o.rate);
    st.last = t;
    if (--st.tokens < 0) return st.conn.close(1008, 'trop de messages');
    let msg;
    try { msg = JSON.parse(text); } catch { return st.conn.close(1008, 'JSON invalide'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return st.conn.close(1008, 'message invalide');
    switch (msg.type) {
      case 'create': return this.create(st, msg);
      case 'join': return this.join(st, msg);
      case 'cancel': return this.cancel(st);
      case 'answer': return this.answer(st, msg);
      default: return this.error(st, 'bad-message');
    }
  }

  onClose(st) {
    const s = st.seat;
    st.seat = null;
    if (!s) return;
    const seat = s.room.seats[s.pid];
    if (seat.conn !== st.conn) return; // déjà remplacée par une reprise
    seat.conn = null;
    seat.leftAt = this.now();
    if (s.room.status === 'playing') this.toSeat(s.room, 1 - s.pid, { type: 'opponent', connected: false, graceUntil: seat.leftAt + this.o.grace });
  }

  // ── Salons ─────────────────────────────────────────────
  seatFor(st, room, pid, { deck, seed }) {
    room.seats[pid] = { userId: st.user.id, name: st.user.name, deck, seed, conn: st.conn, leftAt: null };
    this.byUser.set(st.user.id, { room, pid });
    st.seat = { room, pid };
  }

  /** Contrôles communs à 'create' et 'join' : renvoie { deck, seed } ou null (erreur envoyée). */
  readPlayer(st, msg) {
    if (this.byUser.has(st.user.id)) { this.error(st, 'already-in-game'); return null; }
    const { deck, error } = readDeck(msg);
    if (!deck) { this.error(st, 'deck-invalid', { detail: error }); return null; }
    const seed = isStr(msg.seed, 64) ? msg.seed : token(16);
    return { deck, seed };
  }

  async create(st, msg) {
    const p = this.readPlayer(st, msg);
    if (!p) return;
    if (this.rooms.size >= this.o.maxRooms) return this.error(st, 'server-full');
    const hourAgo = this.now() - 60 * MIN, recent = (this.created.get(st.user.id) ?? []).filter(t => t > hourAgo);
    if (recent.length >= this.o.roomsPerHour) return this.error(st, 'too-many-rooms');
    recent.push(this.now());
    this.created.set(st.user.id, recent);
    const mode = MODES.has(msg.mode) ? msg.mode : 'casu';
    const invite = token(16), serverSeed = token(32);
    const room = {
      id: token(9), mode, status: 'waiting', createdAt: this.now(), invite, inviteHash: hash(invite), inviteExpires: this.now() + this.o.inviteTtl,
      serverSeed, commit: await commitSeed(serverSeed), seats: [null, null], rg: null, over: null, finishedAt: null,
    };
    this.rooms.set(room.id, room);
    this.invites.set(room.inviteHash, room);
    this.seatFor(st, room, 0, p);
    this.send(st.conn, { type: 'created', invite, mode, commit: room.commit, expiresAt: room.inviteExpires });
  }

  async join(st, msg) {
    // Même réponse pour une invitation inconnue, utilisée ou expirée : rien à deviner
    const room = isStr(msg.invite, 64) ? this.invites.get(hash(msg.invite)) : null;
    if (!room || room.status !== 'waiting' || room.inviteExpires <= this.now()) return this.error(st, 'invite-invalid');
    if (room.seats[0].userId === st.user.id) return this.error(st, 'own-invite');
    const p = this.readPlayer(st, msg);
    if (!p) return;
    this.invites.delete(room.inviteHash); // usage unique
    room.inviteHash = null;
    room.invite = null;
    this.seatFor(st, room, 1, p);
    this.send(st.conn, { type: 'joined', mode: room.mode, commit: room.commit });
    await this.start(room);
  }

  async start(room) {
    room.status = 'playing';
    room.startedAt = this.now();
    const [a, b] = room.seats;
    room.seed = await mixSeed(room.serverSeed, [a.seed, b.seed]);
    room.clock = { remaining: [this.o.clockBank, this.o.clockBank], running: null, since: null };
    for (const pid of [0, 1]) this.toSeat(room, pid, { type: 'start', you: pid, names: [a.name, b.name], mode: room.mode, commit: room.commit });
    this.launch(room);
  }

  /** Lance le moteur (en rejouant `replay` d'abord, après un redémarrage du serveur). */
  launch(room, replay = []) {
    const [a, b] = room.seats, [lo, hi] = this.o.counterDelay;
    room.rg = createRemoteGame({
      decks: [a.deck, b.deck], names: [a.name, b.name], seed: room.seed, openDecks: room.mode === 'open', replay,
      send: (pid, m) => this.toSeat(room, pid, m),
      counterDelay: () => lo + Math.random() * (hi - lo),
      onAsk: pid => { room.clock.running = pid; room.clock.since = this.now(); this.sendClock(room); },
      onAnswer: pid => {
        const c = room.clock;
        c.remaining[pid] = Math.max(0, c.remaining[pid] - (this.now() - c.since)) + this.o.clockIncrement;
        c.running = null; c.since = null;
        this.sendClock(room);
      },
    });
    room.rg.run().then(result => this.finish(room, { result }), err => this.finish(room, { aborted: 'erreur du moteur', detail: String(err?.message ?? err) }));
  }

  /** Temps restant de chaque joueur, à l'instant présent. */
  clockNow(room) {
    const c = room.clock, t = this.now();
    return c.remaining.map((x, pid) => (c.running === pid ? Math.max(0, x - (t - c.since)) : x));
  }

  sendClock(room, only = null) {
    const msg = { type: 'clock', remaining: this.clockNow(room), running: room.clock.running };
    for (const pid of only == null ? [0, 1] : [only]) this.toSeat(room, pid, msg);
  }

  finish(room, over) {
    if (room.over) return;
    room.status = 'over';
    room.over = over;
    room.finishedAt = this.now();
    this.release(room); // les joueurs peuvent relancer une partie tout de suite
    const g = room.rg?.game;
    // Révélation de la graine : chacun peut vérifier le mélange (SHA-256(graine serveur) = engagement)
    const reveal = { serverSeed: room.serverSeed, clientSeeds: room.seats.map(s => s?.seed ?? null), commit: room.commit };
    for (const pid of [0, 1]) {
      const msg = { type: 'over', you: pid, names: room.seats.map(s => s?.name ?? null), ...over, ...reveal };
      const s = room.seats[pid];
      if (s?.conn) this.send(s.conn, msg);
      else if (s) this.lastOver.set(s.userId, { msg, at: this.now() });
    }
    if (g) {
      const outcome = over.result ? 'result' : over.reason === 'time' ? 'time' : over.forfeit != null ? 'forfeit' : 'aborted';
      try {
        this.onFinished({
          id: room.id, mode: room.mode, players: room.seats.map(s => s.userId), names: room.seats.map(s => s.name),
          winner: over.result ? over.result.winner : over.winner ?? null, outcome, scores: over.result?.scores ?? null,
          config: g.config, answers: g.s.answers, startedAt: room.startedAt, finishedAt: room.finishedAt,
        });
      } catch (e) { console.error('Enregistrement de la partie :', e.message); }
    }
  }

  toSeat(room, pid, msg) { const s = room.seats[pid]; if (s?.conn) this.send(s.conn, msg); }

  /** Reprise automatique du siège du compte (nouvel appareil, rechargement, coupure). */
  resume(st) {
    const { room, pid } = this.byUser.get(st.user.id), seat = room.seats[pid];
    // La connexion la plus récente gagne
    if (seat.conn && seat.conn !== st.conn) { this.send(seat.conn, { type: 'replaced' }); seat.conn.close(4000, 'ouvert ailleurs'); }
    seat.conn = st.conn;
    seat.leftAt = null;
    st.seat = { room, pid };
    if (room.status === 'waiting') return this.send(st.conn, { type: 'waiting', invite: room.invite, mode: room.mode, commit: room.commit, expiresAt: room.inviteExpires });
    const [a, b] = room.seats;
    this.send(st.conn, { type: 'start', you: pid, names: [a.name, b.name], mode: room.mode, commit: room.commit, resumed: true });
    room.rg.reconnect(pid);
    this.sendClock(room, pid);
    this.toSeat(room, 1 - pid, { type: 'opponent', connected: true });
  }

  cancel(st) {
    const s = st.seat;
    if (!s || s.room.status !== 'waiting') return this.error(st, 'nothing-to-cancel');
    this.drop(s.room);
    st.seat = null;
    this.send(st.conn, { type: 'cancelled' });
  }

  answer(st, msg) {
    const s = st.seat;
    if (!s || s.room.status !== 'playing') return this.error(st, 'not-playing');
    if (this.outOfTime(s.room)) return;
    const r = s.room.rg.answer(s.pid, { seq: msg.seq, answer: msg.answer });
    if (!r.ok) this.error(st, r.error, { seq: msg.seq });
  }

  // ── Nettoyage (appelé régulièrement) ────────────────────
  sweep() {
    const t = this.now();
    for (const room of [...this.rooms.values()]) {
      if (room.status === 'waiting' && room.inviteExpires <= t) {
        this.toSeat(room, 0, { type: 'error', error: 'invite-expired' });
        this.drop(room);
      } else if (room.status === 'playing') {
        if (this.outOfTime(room)) continue;
        const gone = room.seats.findIndex(s => s.leftAt != null && t - s.leftAt >= this.o.grace);
        if (gone >= 0) this.finish(room, { forfeit: gone, winner: 1 - gone, reason: 'disconnect' });
      } else if (room.status === 'over' && t - room.finishedAt >= this.o.finishedTtl) this.drop(room);
    }
    for (const [u, list] of this.created) if (list.every(x => x <= t - 60 * MIN)) this.created.delete(u);
    for (const [u, x] of this.lastOver) if (t - x.at >= this.o.finishedTtl) this.lastOver.delete(u);
  }

  /** Pendule tombée : le joueur qui devait répondre perd. */
  outOfTime(room) {
    const pid = room.clock?.running;
    if (pid == null || this.clockNow(room)[pid] > 0) return false;
    this.finish(room, { forfeit: pid, winner: 1 - pid, reason: 'time' });
    return true;
  }

  // ── Arrêt et redémarrage du serveur ─────────────────────
  /** Parties en cours, de quoi les reprendre : configuration, réponses, pendules. */
  snapshot() {
    const games = [];
    for (const r of this.rooms.values()) {
      if (r.status !== 'playing' || !r.rg || r.rg.replaying) continue;
      games.push({
        id: r.id, mode: r.mode, serverSeed: r.serverSeed, commit: r.commit, seed: r.seed, startedAt: r.startedAt,
        seats: r.seats.map(s => ({ userId: s.userId, name: s.name, deck: s.deck, seed: s.seed })),
        answers: [...r.rg.game.s.answers], remaining: this.clockNow(r),
      });
    }
    return { version: this.o.version, savedAt: this.now(), games };
  }

  /**
   * Reprend les parties d'un instantané. Les joueurs ont `grace` pour revenir (leurs pages se
   * reconnectent seules). Si le moteur a changé, les parties sont annulées, sans effet sur l'Elo.
   */
  async restore(snap) {
    const out = { restored: 0, aborted: 0 };
    for (const x of snap?.games ?? []) {
      const room = {
        id: x.id, mode: x.mode, status: 'playing', createdAt: x.startedAt, startedAt: x.startedAt, invite: null, inviteHash: null, inviteExpires: 0,
        serverSeed: x.serverSeed, commit: x.commit, seed: x.seed, rg: null, over: null, finishedAt: null,
        seats: x.seats.map(s => ({ ...s, conn: null, leftAt: this.now() })),
        clock: { remaining: [...x.remaining], running: null, since: null },
      };
      this.rooms.set(room.id, room);
      room.seats.forEach((s, pid) => this.byUser.set(s.userId, { room, pid }));
      if (snap.version !== this.o.version) { this.finish(room, { aborted: 'mise à jour du serveur' }); out.aborted++; continue; }
      this.launch(room, x.answers);
      // Le rejeu est immédiat (aucune attente) : on le laisse aller au bout
      for (let i = 0; i < 100_000 && room.rg.replaying && !room.over; i++) await new Promise(r => setImmediate(r));
      if (room.rg?.replaying) { this.finish(room, { aborted: 'reprise impossible' }); out.aborted++; continue; }
      if (!room.over) out.restored++;
    }
    return out;
  }

  /** Les comptes de ce salon n'y sont plus rattachés. */
  release(room) {
    for (const s of room.seats) if (s && this.byUser.get(s.userId)?.room === room) this.byUser.delete(s.userId);
  }

  drop(room) {
    this.rooms.delete(room.id);
    if (room.inviteHash) this.invites.delete(room.inviteHash);
    this.release(room);
    for (const s of room.seats) if (s) s.conn = null;
    room.rg = null; // la partie (et sa question en attente) part avec le salon
  }

  stats() {
    const by = { waiting: 0, playing: 0, over: 0 };
    for (const r of this.rooms.values()) by[r.status]++;
    return by;
  }
}
