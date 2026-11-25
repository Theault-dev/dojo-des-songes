// Outils communs aux tests du serveur : connexion factice, client WebSocket, attente de messages.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

export const cookieOf = (res, name) => (res.headers.get('set-cookie') ?? '').match(new RegExp(`${name}=([^;,]*)`))?.[1] ?? null;

/** Connexion factice (serveur DEV) : renvoie l'en-tête Cookie de la session. */
export async function login(base, name) {
  const r = await fetch(`${base}/auth/dev?name=${encodeURIComponent(name)}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  return `dojo_session=${cookieOf(r, 'dojo_session')}`;
}

export class Client {
  static async open(base, cookie, origin = base) {
    const c = new Client();
    c.ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: cookie ? { Cookie: cookie } : {}, ...(origin ? { origin } : {}) });
    c.msgs = []; c.waiters = []; c.closed = null;
    c.ws.on('message', d => { c.msgs.push(JSON.parse(d)); c.wake(); });
    c.ws.on('close', code => { c.closed = code; c.wake(); });
    await new Promise((res, rej) => { c.ws.once('open', res); c.ws.once('error', rej); c.ws.once('unexpected-response', (_, r) => rej(Object.assign(new Error('http'), { status: r.statusCode }))); });
    return c;
  }
  send(m) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  wake() { for (const w of [...this.waiters]) w(); }
  next(pred, ms = 5000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`attente dépassée : ${pred}`)), ms);
      const check = () => {
        const i = this.msgs.findIndex(pred);
        if (i >= 0) { const m = this.msgs[i]; this.msgs.splice(0, i + 1); clearTimeout(t); this.waiters = this.waiters.filter(w => w !== check); res(m); }
      };
      this.waiters.push(check); check();
    });
  }
  type(t, ms) { return this.next(m => m.type === t, ms); }
  /** Dernier message d'un type déjà reçu (sans le consommer). */
  last(t) { return [...this.msgs].reverse().find(m => m.type === t) ?? null; }
  untilClosed(ms = 3000) { return new Promise((res, rej) => { if (this.closed != null) return res(this.closed); const t = setTimeout(() => rej(new Error('pas fermé')), ms); this.ws.once('close', c => { clearTimeout(t); res(c); }); }); }
  close() { this.ws.close(); }
}

/** Premier message satisfaisant `pred` chez l'un des clients ; un seul message est consommé. */
export function firstOf(clients, pred, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('attente dépassée (deux joueurs)')); }, ms);
    const cleanup = () => clients.forEach(c => { c.waiters = c.waiters.filter(w => w !== check); });
    const check = () => {
      for (const [pid, c] of clients.entries()) {
        const i = c.msgs.findIndex(pred);
        if (i >= 0) { const x = c.msgs[i]; c.msgs.splice(0, i + 1); clearTimeout(t); cleanup(); return res({ pid, x }); }
      }
    };
    clients.forEach(c => c.waiters.push(check));
    check();
  });
}

/** Réponse valide (aléatoire). */
export function pick(ask, rnd = Math.random) {
  const ok = ask.options.filter(o => !o.blocked), pool = ok.length ? ok : ask.options;
  if (!ask.multi) return pool[Math.floor(rnd() * pool.length)].id;
  return ask.options.map(o => o.id).slice(0, ask.min);
}
