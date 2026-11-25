// ─────────────────────────────────────────────────────────────
// Serveur de parties à distance (Node ≥ 18, WebSocket : paquet `ws`).
//
//   node server/index.mjs            → http://127.0.0.1:8787 (client de test)
//
// Variables : PORT (8787), HOST (127.0.0.1 : nginx sera devant),
// ORIGINS (origines autorisées, séparées par des virgules ; par défaut
// celle du client de test), DEV=0 pour couper le client de test,
// TRUST_PROXY=1 pour lire l'IP dans X-Forwarded-For (derrière nginx).
// ─────────────────────────────────────────────────────────────
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { Lobby } from './lobby.mjs';

const MAX_CONN_PER_IP = 8;
const MAX_PAYLOAD = 16 * 1024;

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

export async function startServer({
  port = 8787, host = '127.0.0.1', dev = true, origins = null, trustProxy = false, lobby: lobbyOpts = {}, sweepEvery = 5000, log = console.log,
} = {}) {
  const lobby = new Lobby(lobbyOpts);
  const perIp = new Map();
  // Pas de compression (perMessageDeflate) : inutile ici et source d'attaques mémoire
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  let devPage = null, devDecks = null;
  if (dev) {
    devPage = await readFile(fileURLToPath(new URL('./dev-client.html', import.meta.url)), 'utf8');
    const { J1, randomDeck, KWS } = await import('../test/decks.mjs');
    const { formatDeck } = await import('../src/deckio.js');
    devDecks = [J1, ...KWS.slice(0, 6).map((kw, i) => randomDeck(1000 + i, kw))].map(d => ({ name: d.name, text: formatDeck(d) }));
  }

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const out = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    if (req.method !== 'GET') return out(405, 'text/plain', 'Method Not Allowed');
    if (path === '/health') return out(200, 'application/json', JSON.stringify({ ok: true, rooms: lobby.stats() }));
    if (dev && path === '/') return out(200, 'text/html; charset=utf-8', devPage);
    if (dev && path === '/dev/decks') return out(200, 'application/json', JSON.stringify(devDecks));
    out(404, 'text/plain', 'Not Found');
  });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path !== '/ws') return reject(socket, 404, 'Not Found');
    // Origine : un autre site ne doit pas pouvoir ouvrir une partie au nom du joueur
    const allowed = origins ?? [`http://${host}:${server.address().port}`, `http://localhost:${server.address().port}`];
    if (!allowed.includes(req.headers.origin)) return reject(socket, 403, 'Forbidden');
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim()) || socket.remoteAddress;
    if ((perIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) return reject(socket, 429, 'Too Many Requests');
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    const release = () => { const n = (perIp.get(ip) ?? 1) - 1; n > 0 ? perIp.set(ip, n) : perIp.delete(ip); };
    socket.once('close', release);
    wss.handleUpgrade(req, socket, head, ws => lobby.attach(adapt(ws)));
  });

  const timer = setInterval(() => lobby.sweep(), sweepEvery);
  timer.unref();
  await new Promise(r => server.listen(port, host, r));
  log?.(`Dojo PvP : http://${host}:${server.address().port}${dev ? ' (client de test)' : ''}`);
  return {
    server, lobby, port: server.address().port,
    close: () => new Promise(r => { clearInterval(timer); for (const c of wss.clients) c.terminate(); server.closeAllConnections?.(); server.close(r); }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  const srv = await startServer({
    port: +(env.PORT ?? 8787), host: env.HOST ?? '127.0.0.1', dev: env.DEV !== '0',
    origins: env.ORIGINS ? env.ORIGINS.split(',').map(s => s.trim()) : null, trustProxy: env.TRUST_PROXY === '1',
  });
  // Arrêt propre. À venir (étape 4) : écrire les parties en cours sur disque pour les reprendre au démarrage.
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => srv.close().then(() => process.exit(0)));
}
