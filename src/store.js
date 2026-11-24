// ─────────────────────────────────────────────────────────────
// Sauvegarde des decks : base de données de l'artifact (privée par
// compte, sous data/users/<id>) quand elle est disponible, sinon
// mémoire du navigateur. Les deux restent synchronisées.
// ─────────────────────────────────────────────────────────────
const LOCAL_KEY = 'dojo-decks';
const clean = d => ({ name: d.name, lieu: d.lieu ?? null, groupe: [...d.groupe], songe: [...d.songe], updatedAt: d.updatedAt ?? Date.now() });

export class DeckStore {
  constructor(onChange) {
    this.onChange = onChange;
    this.mode = 'local';     // 'local' | 'sync'
    this.status = 'ready';   // 'ready' | 'loading' | 'slow' | 'error'
    this.col = null;
    this.decks = this.readLocal();
    this.connect();
  }

  readLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]').filter(d => d && d.id); } catch { return []; }
  }
  writeLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.decks)); } catch { /* stockage indisponible */ }
  }
  changed() { this.writeLocal(); this.onChange?.(); }

  async connect() {
    if (!window.claude?.use) return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.col = db.collection(`data/users/${uid}`);
      this.mode = 'sync';
      this.status = 'loading';
      this.onChange?.();
      let migrated = false;
      const timer = setTimeout(() => { if (this.status === 'loading') { this.status = 'slow'; this.onChange?.(); } }, 10000);
      this.unsub = this.col.onSnapshot(snap => {
        const remote = snap.docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
        if (!snap.metadata.fromCache) {
          clearTimeout(timer);
          this.status = 'ready';
          // Première réponse définitive : on envoie les decks qui n'existaient que dans ce navigateur
          if (!migrated) {
            migrated = true;
            const ids = new Set(remote.map(d => d.id));
            const localOnly = this.decks.filter(d => !ids.has(d.id));
            localOnly.forEach(d => this.col.doc(d.id).set(clean(d)).catch(() => {}));
            remote.push(...localOnly);
          }
        }
        this.decks = remote.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        this.changed();
      }, () => {
        clearTimeout(timer);
        this.status = 'error';
        this.mode = 'local';
        this.col = null;
        this.onChange?.();
      });
    } catch { /* capacité indisponible : on reste en local */ }
  }

  get(id) { return this.decks.find(d => d.id === id) ?? null; }

  async save(deck) {
    const d = { ...clean(deck), id: deck.id, updatedAt: Date.now() };
    const i = this.decks.findIndex(x => x.id === d.id);
    if (i >= 0) this.decks[i] = d; else this.decks.unshift(d);
    this.changed();
    if (this.col) await this.col.doc(d.id).set(clean(d));
    return d;
  }

  async remove(id) {
    this.decks = this.decks.filter(d => d.id !== id);
    this.changed();
    if (this.col) await this.col.doc(id).delete();
  }

  get label() {
    if (this.mode === 'sync') return this.status === 'slow' ? 'Connexion lente à votre compte : decks affichés depuis ce navigateur.' : 'Decks sauvegardés sur votre compte.';
    return this.status === 'error' ? 'Sauvegarde du compte indisponible : decks gardés dans ce navigateur.' : 'Decks gardés dans ce navigateur. Exportez-les pour les conserver.';
  }
}
