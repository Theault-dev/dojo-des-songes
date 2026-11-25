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
// ask, event, opponent, over, replaced, error. Voir docs/PVP.md.
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
    this.onFinished = opts.onFinished ?? (() => {});   // (résumé de partie) → base de données, plus tard
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
    const [a, b] = room.seats;
    const seed = await mixSeed(room.serverSeed, [a.seed, b.seed]);
    room.rg = createRemoteGame({
      decks: [a.deck, b.deck], names: [a.name, b.name], seed, openDecks: room.mode === 'open',
      send: (pid, m) => this.toSeat(room, pid, m),
    });
    for (const pid of [0, 1]) this.toSeat(room, pid, { type: 'start', you: pid, names: [a.name, b.name], mode: room.mode, commit: room.commit });
    room.rg.run().then(result => this.finish(room, { result }), err => this.finish(room, { aborted: 'erreur du moteur', detail: String(err?.message ?? err) }));
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
    if (g) try { this.onFinished({ id: room.id, mode: room.mode, names: room.seats.map(s => s.name), config: g.config, answers: g.s.answers, ...over }); } catch { /* journalisation seulement */ }
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
        const gone = room.seats.findIndex(s => s.leftAt != null && t - s.leftAt >= this.o.grace);
        if (gone >= 0) this.finish(room, { forfeit: gone, winner: 1 - gone });
      } else if (room.status === 'over' && t - room.finishedAt >= this.o.finishedTtl) this.drop(room);
    }
    for (const [u, list] of this.created) if (list.every(x => x <= t - 60 * MIN)) this.created.delete(u);
    for (const [u, x] of this.lastOver) if (t - x.at >= this.o.finishedTtl) this.lastOver.delete(u);
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
