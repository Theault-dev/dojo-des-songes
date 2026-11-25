// ─────────────────────────────────────────────────────────────
// Serveur de parties à distance (Node ≥ 18 ; paquets `ws` et `better-sqlite3`).
//
//   DEV=1 node server/index.mjs     → http://127.0.0.1:8787 (client de test, connexion factice)
//
// Variables (lues aussi dans le fichier ENV_FILE, par défaut `.env`) :
//   PORT (8787), HOST (127.0.0.1 : nginx sera devant), DB_PATH (dojo.db),
//   PUBLIC_URL (adresse publique ; défaut http://HOST:PORT),
//   ORIGINS (origines WebSocket autorisées ; défaut : celle de PUBLIC_URL),
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
//   DEV=1 : client de test + connexion factice (refusé hors 127.0.0.1 ou en HTTPS),
//   TRUST_PROXY=1 : IP lue dans X-Forwarded-For (derrière nginx).
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.mjs';
import { openDb } from './db.mjs';
import { createAuth } from './auth.mjs';

const MAX_CONN_PER_IP = 8;
const MAX_PAYLOAD = 16 * 1024;
const AUTH_PER_MIN = 30;   // requêtes /auth/* par IP et par minute
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

const reject = (socket, status, text) => socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);

/** Connexion vue par le salon : messages texte seulement, `open`, `send`, `close`. */
function adapt(ws) {
  const conn = new EventEmitter();
  Object.defineProperty(conn, 'open', { get: () => ws.readyState === ws.OPEN });
  conn.send = text => ws.send(text);
  conn.close = (code, reason) => ws.close(code, reason);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.close(1003, 'messages texte seulement');
    conn.emit('message', data.toString('utf8'));
  });
  ws.on('close', () => conn.emit('close'));
  ws.on('error', () => ws.terminate());
  return conn;
}

/** Fenêtre glissante simple : `hit(clé)` vrai tant que la limite n'est pas atteinte. */
function limiter(max, windowMs, now) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now(), list = (hits.get(key) ?? []).filter(x => x > t - windowMs);
      if (list.length >= max) { hits.set(key, list); return false; }
      list.push(t); hits.set(key, list); return true;
    },
    sweep() { const t = now(); for (const [k, l] of hits) if (l.every(x => x <= t - windowMs)) hits.delete(k); },
  };
}

export async function startServer({
  port = 8787, host = '127.0.0.1', publicUrl = null, origins = null, dev = false, trustProxy = false,
  dbPath = 'dojo.db', discord = {}, lobby: lobbyOpts = {}, sweepEvery = 5000, log = console.log, now = () => Date.now(), fetch,
} = {}) {
  if (dev && (!LOOPBACK.has(host) || publicUrl?.startsWith('https://'))) throw new Error('DEV=1 est réservé au développement local (HOST=127.0.0.1, sans HTTPS).');
  const db = openDb(dbPath, { now });
  const lobby = new Lobby({ now, ...lobbyOpts });
  const perIp = new Map();
  const authLimit = limiter(AUTH_PER_MIN, 60_000, now);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false }); // pas de compression : attaques mémoire
  let auth, devPage = null, devDecks = null;
  if (dev) {
    devPage = await readFile(fileURLToPath(new URL('./dev-client.html', import.meta.url)), 'utf8');
    const { J1, randomDeck, KWS } = await import('../test/decks.mjs');
    const { formatDeck } = await import('../src/deckio.js');
    devDecks = [J1, ...KWS.slice(0, 6).map((kw, i) => randomDeck(1000 + i, kw))].map(d => ({ name: d.name, text: formatDeck(d) }));
  }
  const ipOf = (req, socket) => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim()) || socket.remoteAddress;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), path = url.pathname;
    const out = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    try {
      if (path.startsWith('/auth/')) {
        if (!authLimit.hit(ipOf(req, req.socket))) return out(429, 'text/plain', 'Too Many Requests');
        await auth.handle(req, res, path, url.searchParams);
        return;
      }
      if (req.method !== 'GET') return out(405, 'text/plain', 'Method Not Allowed');
      if (path === '/health') return out(200, 'application/json', JSON.stringify({ ok: true, rooms: lobby.stats() }));
      if (dev && path === '/') return out(200, 'text/html; charset=utf-8', devPage);
      if (dev && path === '/dev/decks') return out(200, 'application/json', JSON.stringify(devDecks));
      out(404, 'text/plain', 'Not Found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) out(500, 'text/plain', 'Internal Server Error');
    }
  });

  await new Promise(r => server.listen(port, host, r));
  const base = publicUrl ?? `http://${host}:${server.address().port}`;
  auth = createAuth({ db, publicUrl: base, discord, devLogin: dev, now, ...(fetch ? { fetch } : {}) });
  const allowed = origins ?? [new URL(base).origin, ...(dev ? [`http://localhost:${server.address().port}`] : [])];

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path !== '/ws') return reject(socket, 404, 'Not Found');
    // Origine : un autre site ne doit pas pouvoir ouvrir une partie au nom du joueur
    if (!allowed.includes(req.headers.origin)) return reject(socket, 403, 'Forbidden');
    const user = auth.userFrom(req);
    if (!user) return reject(socket, 401, 'Unauthorized');
    const ip = ipOf(req, socket);
    if ((perIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return reject(socket, 429, 'Too Many Requests');
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    socket.once('close', () => { const n = (perIp.get(ip) ?? 1) - 1; n > 0 ? perIp.set(ip, n) : perIp.delete(ip); });
    wss.handleUpgrade(req, socket, head, ws => lobby.attach(adapt(ws), { id: user.id, name: user.name }));
  });

  let lastPurge = 0;
  const timer = setInterval(() => {
    lobby.sweep();
    authLimit.sweep();
    if (now() - lastPurge > 3_600_000) { lastPurge = now(); db.purgeSessions(); }
  }, sweepEvery);
  timer.unref();
  log?.(`Dojo PvP : ${base}${dev ? ' (client de test, connexion factice)' : ''}`);
  return {
    server, lobby, db, port: server.address().port, publicUrl: base,
    close: () => new Promise(r => { clearInterval(timer); for (const c of wss.clients) c.terminate(); server.closeAllConnections?.(); server.close(() => { db.close(); r(); }); }),
  };
}

/** Lit un fichier KEY=VALUE sans écraser les variables déjà définies. */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnv(process.env.ENV_FILE ?? '.env');
  const env = process.env;
  const srv = await startServer({
    port: +(env.PORT ?? 8787), host: env.HOST ?? '127.0.0.1', publicUrl: env.PUBLIC_URL || null, dev: env.DEV === '1',
    origins: env.ORIGINS ? env.ORIGINS.split(',').map(s => s.trim()) : null, trustProxy: env.TRUST_PROXY === '1',
    dbPath: env.DB_PATH ?? 'dojo.db', discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET },
  });
  // Arrêt propre. À venir (étape 4) : écrire les parties en cours sur disque pour les reprendre au démarrage.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => srv.close().then(() => process.exit(0)));
}
