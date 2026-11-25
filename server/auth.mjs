// ─────────────────────────────────────────────────────────────
// Connexion : Discord OAuth2 (scope `identify`) et sessions par cookie.
//
//   GET  /auth/discord            → redirection vers Discord
//   GET  /auth/discord/callback   → retour de Discord, ouverture de session
//   GET  /auth/me                 → compte connecté (401 sinon)
//   POST /auth/logout             → ferme cette session
//   POST /auth/logout-all         → ferme toutes les sessions du compte
//   GET  /auth/dev?name=…         → connexion factice (DEV uniquement, jamais en production)
//
// Cookie de session : jeton aléatoire de 256 bits, HttpOnly, SameSite=Lax,
// Secure + préfixe __Host- en HTTPS. Seul son SHA-256 est en base.
// ─────────────────────────────────────────────────────────────
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_TTL, discordCreated } from './db.mjs';

const STATE_TTL = 10 * 60_000;
const token = (n = 32) => randomBytes(n).toString('base64url');
export const hash = t => createHash('sha256').update(String(t)).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const sameStr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 32);

/**
 * `publicUrl` : adresse publique du site (https://dreamland.harruis.fr), sert au retour Discord et au cookie.
 * `discord` : { clientId, clientSecret, api, authorize } (api / authorize remplaçables pour les tests).
 * `devLogin` : connexion factice autorisée (développement local uniquement).
 */
export function createAuth({ db, publicUrl, discord = {}, devLogin = false, now = () => Date.now(), fetch = globalThis.fetch }) {
  const secure = publicUrl.startsWith('https://');
  const COOKIE = secure ? '__Host-dojo_session' : 'dojo_session';
  const STATE_COOKIE = secure ? '__Host-dojo_oauth' : 'dojo_oauth';
  const redirectUri = new URL('/auth/discord/callback', publicUrl).href;
  const api = discord.api ?? 'https://discord.com/api/v10';
  const authorizeUrl = discord.authorize ?? 'https://discord.com/oauth2/authorize';
  const states = new Map(); // état OAuth → expiration (RAM : rien sur la SD)

  const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  const publicUser = u => ({ id: u.id, name: u.name, avatar: u.avatar, discordCreated: u.discord_created, dev: u.discord_id.startsWith('dev:') });

  /** Compte connecté pour une requête HTTP ou une demande de WebSocket (null sinon). */
  function userFrom(req) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    if (!t || t.length > 100) return null;
    return db.sessionUser(hash(t));
  }

  function openSession(res, user, to = '/') {
    const t = token();
    db.createSession(hash(t), user.id);
    res.writeHead(302, { Location: to, 'Set-Cookie': [cookie(COOKIE, t, SESSION_TTL / 1000), cookie(STATE_COOKIE, '', 0)], 'Cache-Control': 'no-store' });
    res.end();
  }

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, msg) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(msg); };

  /** Renvoie vrai si la requête concernait /auth/ (et y a répondu). */
  async function handle(req, res, path, query) {
    if (!path.startsWith('/auth/')) return false;

    if (req.method === 'POST') {
      // Protection CSRF : un POST doit venir du site lui-même
      if (req.headers.origin !== new URL(publicUrl).origin) { fail(res, 403, 'Origine refusée'); return true; }
      const t = parseCookies(req.headers.cookie)[COOKIE];
      const u = userFrom(req);
      if (path === '/auth/logout') { if (t) db.deleteSession(hash(t)); json(res, 200, { ok: true }, { 'Set-Cookie': cookie(COOKIE, '', 0) }); return true; }
      if (path === '/auth/logout-all') {
        if (!u) { json(res, 401, { error: 'not-logged-in' }); return true; }
        db.deleteUserSessions(u.id);
        json(res, 200, { ok: true }, { 'Set-Cookie': cookie(COOKIE, '', 0) });
        return true;
      }
      fail(res, 404, 'Not Found'); return true;
    }
    if (req.method !== 'GET') { fail(res, 405, 'Method Not Allowed'); return true; }

    if (path === '/auth/me') {
      const u = userFrom(req);
      u ? json(res, 200, { user: publicUser(u) }) : json(res, 401, { error: 'not-logged-in', devLogin, discord: !!discord.clientId });
      return true;
    }

    if (path === '/auth/discord') {
      if (!discord.clientId || !discord.clientSecret) { fail(res, 503, 'Connexion Discord non configurée'); return true; }
      const state = token(16);
      for (const [k, exp] of states) if (exp <= now()) states.delete(k);
      if (states.size > 10_000) { fail(res, 503, 'Réessayez dans un instant'); return true; }
      states.set(state, now() + STATE_TTL);
      const u = new URL(authorizeUrl);
      u.search = new URLSearchParams({ client_id: discord.clientId, response_type: 'code', scope: 'identify', redirect_uri: redirectUri, state, prompt: 'none' });
      // L'état est aussi lié au navigateur par un cookie : un lien de retour volé ne connecte pas quelqu'un d'autre
      res.writeHead(302, { Location: u.href, 'Set-Cookie': cookie(STATE_COOKIE, state, STATE_TTL / 1000), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    if (path === '/auth/discord/callback') {
      const state = query.get('state'), code = query.get('code');
      const exp = states.get(state);
      states.delete(state); // usage unique
      if (!state || !exp || exp <= now() || !sameStr(parseCookies(req.headers.cookie)[STATE_COOKIE], state)) { fail(res, 400, 'Demande de connexion invalide ou expirée. Recommencez.'); return true; }
      if (!code || code.length > 200) { fail(res, 400, 'Connexion annulée.'); return true; }
      try {
        const tr = await fetch(`${api}/oauth2/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: discord.clientId, client_secret: discord.clientSecret }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!tr.ok) throw new Error(`token ${tr.status}`);
        const { access_token } = await tr.json();
        const ur = await fetch(`${api}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
        if (!ur.ok) throw new Error(`users/@me ${ur.status}`);
        const d = await ur.json();
        if (!/^\d{1,20}$/.test(String(d.id))) throw new Error('identifiant Discord invalide');
        const user = db.upsertUser({
          discordId: String(d.id), name: cleanName(d.global_name || d.username) || 'Joueur',
          avatar: typeof d.avatar === 'string' && /^[a-z0-9_]{1,64}$/i.test(d.avatar) ? d.avatar : null, created: discordCreated(d.id),
        });
        openSession(res, user);
      } catch (e) {
        console.error('Connexion Discord :', e.message);
        fail(res, 502, 'Discord n\'a pas répondu correctement. Réessayez.');
      }
      return true;
    }

    if (path === '/auth/dev' && devLogin) {
      const name = cleanName(query.get('name')).slice(0, 24);
      if (!name) { fail(res, 400, 'Pseudo manquant'); return true; }
      const user = db.upsertUser({ discordId: `dev:${name.toLowerCase()}`, name, created: now() - 365 * 86_400_000 });
      openSession(res, user);
      return true;
    }

    fail(res, 404, 'Not Found');
    return true;
  }

  return { handle, userFrom, publicUser, cookieName: COOKIE };
}
