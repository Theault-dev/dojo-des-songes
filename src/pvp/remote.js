// ─────────────────────────────────────────────────────────────
// Partie à distance côté serveur : agents distants et câblage.
//
// `RemoteAgent` remplace un joueur local : chaque question du moteur
// est envoyée au navigateur (version filtrée, voir view.js) et la
// réponse n'est acceptée que si elle correspond exactement à la
// question en attente (numéro `seq`, options proposées, min / max).
// Le transport (WebSocket…) est fourni par l'appelant via `send`.
// ─────────────────────────────────────────────────────────────
import { Game } from '../engine.js';
import { HandleMap, viewFor, requestFor } from './view.js';

// Node 18 n'expose pas `crypto` en global (Node ≥ 20 et les navigateurs, si)
const webcrypto = globalThis.crypto ?? (await import('node:crypto')).webcrypto;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class RemoteAgent {
  /**
   * `send(msg)` : envoie un message au joueur `pid`.
   * `shared` (commun aux deux agents) : `replay` (réponses à rejouer d'abord, dans l'ordre du moteur),
   * `counterDelay()` (temps marqué sans contre possible, en ms), `onAsk(pid)` / `onAnswer(pid)` (pendule).
   */
  constructor({ pid, handles, send, shared = {} }) {
    this.pid = pid;
    this.handles = handles;
    this.send = send;
    this.shared = shared;
    this.seq = 0;
    this.pending = null;
  }

  get replaying() { return !!this.shared.replay?.length; }

  ask(g, pid, req) {
    if (pid !== this.pid) throw new Error(`RemoteAgent ${this.pid} interrogé pour le joueur ${pid}`);
    if (this.replaying) return Promise.resolve(this.shared.replay.shift());
    const seq = ++this.seq;
    const { wire, map } = requestFor(g, pid, this.handles, req, seq);
    return new Promise(resolve => {
      this.pending = { seq, wire, map, resolve };
      this.send({ type: 'ask', ...wire });
      this.shared.onAsk?.(pid);
    });
  }

  /** Aucun contre possible : on attend quand même un peu, comme si le joueur avait réfléchi. */
  async noCounter() {
    if (this.replaying) return;
    const ms = this.shared.counterDelay?.() ?? 0;
    if (ms > 0) await sleep(ms);
  }

  /** Question en attente, à renvoyer après une reconnexion. */
  resend() { if (this.pending) this.send({ type: 'ask', ...this.pending.wire }); }

  /**
   * Réponse reçue du joueur : `{ seq, answer }`, `answer` = identifiant d'option (`o3`) ou tableau
   * d'identifiants pour un choix multiple. Renvoie `{ ok: true }` ou `{ ok: false, error }` ; une
   * réponse refusée laisse la question en attente.
   */
  receive(msg) {
    const p = this.pending;
    if (!p) return { ok: false, error: 'no-pending' };
    if (!msg || typeof msg !== 'object' || msg.seq !== p.seq) return { ok: false, error: 'stale' };
    const { wire, map } = p, valid = new Set(wire.options.map(o => o.id));
    const toEngine = id => map[+id.slice(1)];
    let answer;
    if (wire.multi) {
      const a = msg.answer;
      if (!Array.isArray(a) || a.length > wire.options.length) return { ok: false, error: 'bad-answer' };
      if (!a.every(id => typeof id === 'string' && valid.has(id))) return { ok: false, error: 'bad-option' };
      if (new Set(a).size !== a.length) return { ok: false, error: 'duplicate' };
      if (a.length < wire.min || a.length > wire.max) return { ok: false, error: 'bad-count' };
      answer = a.map(toEngine);
    } else {
      if (typeof msg.answer !== 'string' || !valid.has(msg.answer)) return { ok: false, error: 'bad-option' };
      answer = toEngine(msg.answer);
    }
    this.pending = null;
    this.shared.onAnswer?.(this.pid);
    p.resolve(answer);
    return { ok: true };
  }
}

/** Graine de la partie : SHA-256(graine serveur ‖ graines des joueurs), sur 32 bits. */
export async function mixSeed(serverSeed, clientSeeds = []) {
  const bytes = new TextEncoder().encode([serverSeed, ...clientSeeds].map(String).join('|'));
  const d = new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
  return ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
}

/** Engagement publié avant la partie : SHA-256 de la graine serveur, en hexadécimal. */
export async function commitSeed(serverSeed) {
  const d = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(String(serverSeed))));
  return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Partie entre deux joueurs distants. `send(pid, msg)` transmet un message à un joueur :
 *  - `{ type: 'state', view }` : état filtré (regroupé : au plus un envoi par tour de boucle) ;
 *  - `{ type: 'ask', seq, kind, title, multi, min, max, options, ctx }` : question à ce joueur ;
 *  - `{ type: 'event', name, data }` : événement visuel (dé, combo, dégâts…), public.
 * `replay` : réponses déjà données (reprise après redémarrage du serveur) ; rien n'est envoyé pendant le rejeu.
 * `counterDelay`, `onAsk`, `onAnswer` : voir RemoteAgent.
 * Renvoie `{ game, agents, run(), view(pid), answer(pid, msg), reconnect(pid) }`.
 */
export function createRemoteGame({ decks, names, seed, first = null, openDecks = false, send, replay = [], counterDelay, onAsk, onAnswer }) {
  const handles = new HandleMap();
  const shared = { replay: [...replay], counterDelay, onAsk, onAnswer };
  const agents = [0, 1].map(pid => new RemoteAgent({ pid, handles, send: msg => send(pid, msg), shared }));
  let scheduled = false, game = null;
  const view = pid => viewFor(game, pid, handles, { openDecks });
  const flush = () => { scheduled = false; if (shared.replay.length) return; for (const pid of [0, 1]) send(pid, { type: 'state', view: view(pid) }); };
  const onUpdate = () => { if (!scheduled) { scheduled = true; queueMicrotask(flush); } };
  const onEvent = (name, data) => {
    if (shared.replay.length) return;
    const pub = Object.fromEntries(Object.entries(data ?? {}).filter(([, x]) => x === null || ['number', 'string', 'boolean'].includes(typeof x) || Array.isArray(x)));
    for (const pid of [0, 1]) send(pid, { type: 'event', name, data: pub });
  };
  game = new Game({ decks, names, agents, seed, first, onUpdate, onEvent });
  return {
    game, agents, view,
    /** Vrai tant que des réponses à rejouer restent (le rejeu n'est pas allé à son terme). */
    get replaying() { return shared.replay.length > 0; },
    run: async () => { const r = await game.run(); flush(); return r; },
    answer: (pid, msg) => agents[pid].receive(msg),
    reconnect: pid => { send(pid, { type: 'state', view: view(pid) }); agents[pid].resend(); },
  };
}
