// ─────────────────────────────────────────────────────────────
// Base SQLite : comptes et sessions (les parties en cours restent en RAM).
// Écritures limitées pour ménager la carte SD du Pi : une session n'est
// prolongée qu'une fois par jour au plus.
// ─────────────────────────────────────────────────────────────
import Database from 'better-sqlite3';

const DAY = 86_400_000;
export const SESSION_TTL = 30 * DAY;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY,
  discord_id       TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  avatar           TEXT,
  discord_created  INTEGER NOT NULL,   -- création du compte Discord (ms), pour l'âge minimum
  created_at       INTEGER NOT NULL,
  last_login       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,        -- SHA-256 du jeton : le jeton lui-même n'est jamais stocké
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS games (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL,
  p0           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  p1           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  winner       INTEGER,               -- 0, 1 ou NULL (nul, partie interrompue)
  outcome      TEXT NOT NULL,         -- 'result' | 'forfeit' | 'time' | 'aborted'
  scores       TEXT,                  -- JSON [Renommée J1, Renommée J2]
  replay       TEXT NOT NULL,         -- JSON { config, answers } : de quoi rejouer la partie
  started_at   INTEGER NOT NULL,
  finished_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_p0 ON games(p0);
CREATE INDEX IF NOT EXISTS games_p1 ON games(p1);
`;

/** Date de création d'un compte Discord, lue dans son identifiant (snowflake). */
export const discordCreated = id => Number((BigInt(id) >> 22n) + 1420070400000n);

export function openDb(path = 'dojo.db', { now = () => Date.now() } = {}) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const q = {
    userByDiscord: db.prepare('SELECT * FROM users WHERE discord_id = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (discord_id, name, avatar, discord_created, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)'),
    updateUser: db.prepare('UPDATE users SET name = ?, avatar = ?, last_login = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
    extend: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertGame: db.prepare('INSERT OR REPLACE INTO games (id, mode, p0, p1, winner, outcome, scores, replay, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    game: db.prepare('SELECT * FROM games WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  };
  // Suppression du compte : sessions effacées (CASCADE), parties gardées sans lien avec le joueur (SET NULL)
  const deleteUser = db.transaction(id => { q.deleteUserSessions.run(id); return q.deleteUser.run(id).changes; });

  return {
    raw: db,
    /** Crée ou met à jour le compte lié à un identifiant Discord. */
    upsertUser({ discordId, name, avatar = null, created }) {
      const t = now(), u = q.userByDiscord.get(discordId);
      if (u) { q.updateUser.run(name, avatar, t, u.id); return q.userById.get(u.id); }
      const r = q.insertUser.run(discordId, name, avatar, created, t, t);
      return q.userById.get(r.lastInsertRowid);
    },
    createSession(tokenHash, userId) {
      const t = now();
      q.insertSession.run(tokenHash, userId, t, t + SESSION_TTL);
    },
    /** Compte de la session (null si inconnue ou expirée) ; prolonge la session au plus une fois par jour. */
    sessionUser(tokenHash) {
      const r = q.session.get(tokenHash), t = now();
      if (!r) return null;
      if (r.expires_at <= t) { q.deleteSession.run(tokenHash); return null; }
      if (r.expires_at - t < SESSION_TTL - DAY) q.extend.run(t + SESSION_TTL, tokenHash);
      const { expires_at, ...user } = r;
      return user;
    },
    deleteSession: tokenHash => q.deleteSession.run(tokenHash).changes,
    deleteUserSessions: userId => q.deleteUserSessions.run(userId).changes,
    purgeSessions: () => q.purge.run(now()).changes,
    /** Partie terminée : une seule écriture (~1 Ko), en fin de partie. Les noms de decks (texte libre) ne sont pas gardés. */
    saveGame(g) {
      const config = { ...g.config, decks: g.config.decks.map(d => ({ lieu: d.lieu, groupe: d.groupe, songe: d.songe })) };
      q.insertGame.run(g.id, g.mode, g.players[0], g.players[1], g.winner ?? null, g.outcome, g.scores ? JSON.stringify(g.scores) : null,
        JSON.stringify({ config, answers: g.answers }), g.startedAt, g.finishedAt);
    },
    deleteUser,
    game: id => q.game.get(id),
    close: () => db.close(),
  };
}
