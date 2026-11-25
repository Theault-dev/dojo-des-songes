// ─────────────────────────────────────────────────────────────
// Interface : plateau, invites de décision, inspecteur, journal,
// effets, conseils et réglages.
// ─────────────────────────────────────────────────────────────
import { Game, NIGHTS } from './engine.js';
import { Bot } from './bot.js';
import { ExpertBot } from './expert.js';
import { CARDS, LIEUX, validateDeck, numLabel, DECK_RULES, maxCopies } from './data.js';
import { parseDecks, formatDecks, newDeckId } from './deckio.js';
import { DeckStore } from './store.js';
import { ArtStore } from './art.js';
import { starfield, Particles, Sound } from './fx.js';
import { RemoteView, NetClient } from './netplay.js';

const HUMAN = 0, BOT = 1;
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SPEEDS = { lent: 900, normal: 450, rapide: 120 };
const LEVELS = { debutant: 'Débutant (instantané)', expert: 'Expert (réfléchit jusqu’à 15 s)' };

/** Workers du bot Expert : chacun construit son arbre de recherche ; leurs statistiques sont fusionnées. */
class SearchPool {
  constructor() { this.workers = []; this.pending = new Map(); this.seq = 0; }
  ensure() {
    if (this.workers.length) return;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      w.onmessage = e => { const cb = this.pending.get(e.data.id); this.pending.delete(e.data.id); cb?.(e.data); };
      w.onerror = () => {};
      this.workers.push(w);
    }
  }
  /** Lance la recherche sur tous les workers ; renvoie les stats concaténées. */
  run(job) {
    try { this.ensure(); } catch { return Promise.resolve([]); }
    const n = this.workers.length;
    return Promise.all(this.workers.map((w, i) => new Promise(resolve => {
      const id = ++this.seq;
      this.pending.set(id, r => resolve(r.stats ?? []));
      w.postMessage({ id, job: { ...job, seed: Math.floor(Math.random() * 1e9) + i, maxSims: job.maxSims / n } });
    }))).then(all => all.flat());
  }
  /** Coupe les recherches en cours (nouvelle partie, abandon). */
  reset() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    for (const cb of this.pending.values()) cb({ stats: [] });
    this.pending.clear();
  }
}
const FAM_COLOR = {
  feu: '#ff6a45', glace: '#5ec9ff', killer: '#c08bff', titan: '#e6be4f', foudre: '#c4e35a', felin: '#f4a259',
  eau: '#3fd6c1', motif: '#ff8fc8', cerebral: '#8aa4ff', son: '#e879f9', sang: '#ef5f67', base: '#9ea3c6',
};
// Famille visuelle d'une carte : son premier mot-clé reconnu.
const KW_FAMILY = {
  FEU: 'feu', 'ATTILA BAND': 'feu', GLACE: 'glace', FLOCONS: 'glace', FOUDRE: 'foudre', 'FÉLIN': 'felin', TRANCHANT: 'felin', OR: 'felin',
  TITAN: 'titan', ROCHE: 'titan', BRUTAL: 'titan', KILLER: 'killer', VENIN: 'killer', CIEL: 'killer', 'V.NOIRS': 'killer', CORBEAU: 'killer',
  POISSON: 'eau', EAU: 'eau', MOTIF: 'motif', ART: 'motif', 'LUCKY STARS': 'motif', 'CÉRÉBRAL': 'cerebral', VIDE: 'cerebral',
  'FANTASY STARS': 'cerebral', SPATIAL: 'cerebral', SON: 'son', 'KILL STARS': 'son', DRAGON: 'sang', SANG: 'sang', INDOMPTABLES: 'sang',
  GARDE: 'glace', VIF: 'feu', SEIGNEUR: 'feu', KAISER: 'feu',
};
const family = def => {
  if (!def?.kw || def.kw.includes('BASE')) return 'base';
  for (const k of def.kw) if (KW_FAMILY[k]) return KW_FAMILY[k];
  return 'base';
};
const deckFamily = deck => {
  const c = {};
  for (const id of deck?.groupe ?? []) { const f = family(CARDS[id]); c[f] = (c[f] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'base';
};
const KW_HELP = {
  FEU: 'Active les Kicks « Feu » (Boule de Feu, Première Flamme…).', GLACE: 'Active les Kicks « Glace » et J’ai froid.',
  GARDE: 'Active Blocage et Combattant aguerri.', VIF: 'Active Combattant aguerri et Réflexe instinctif.', BRUTAL: 'Active Étalé en un coup et Plus de violence !',
  KILLER: 'Active Coup en traître et Sans pitié.', VENIN: 'Active Intrusion mortelle et Blessure venimeuse.',
  CIEL: 'Active Prendre son envol et Danse des vents.', VIDE: 'Active Prendre son envol et Danse des vents.',
  TITAN: 'Active les Kicks « Titan », Mur de force et les Provoc’.', SEIGNEUR: 'Active Libérer son potentiel. Cible favorite de Toro Picana.',
  KAISER: 'Active Libérer son potentiel.', FLOCONS: 'Team En mission pour la Reine : exil remplacé par un retour sous le Groupe.',
  'V.NOIRS': 'Team Se débarrasser des inutiles.', TRANCHANT: 'Active Taillade et Couper court.', 'FÉLIN': 'Active Négociation féroce et Crocs saillants (Accepter / Refuser).',
  FOUDRE: 'Active Attaque foudroyante et Electro choc.', POISSON: 'Active Kanine et Moustik.', MOTIF: 'Active Nadine.', 'CÉRÉBRAL': "Active J'ai un plan et Préparer la fuite.",
  SON: 'Active Déviation sonique et Explosion de tympans.', EAU: 'Active Virtuosité.', DRAGON: 'Active Fureur du dragon.', SANG: 'Active Envie de sang.',
  ROCHE: 'Active Projection tellurique et Éboulement de terrain.', LARBIN: 'Griffes empoisonnées : peut perdre de l’Aura à l’Aurore.',
  'LUCKY STARS': 'Team Fouteurs de merde.', 'ATTILA BAND': "Team L'art de la destruction.", 'FANTASY STARS': 'Team Survivre une nuit de plus.',
  'KILL STARS': 'Team Danse des Kill stars.', INDOMPTABLES: 'Team Puissance des Indomptables.',
};
const RANK_ORDER = { S: 0, M: 1, B: 2, '★': 3 };
/** Vrai si l'option consiste à choisir la carte elle-même (et non une décision à propos de la carte). */
const isCardPick = o => !!o.card && (o.pick ?? (o.id === o.card.uid || o.id === `kick:${o.card.uid}`));
/** Option « passer » (en ligne, le serveur la signale : ses identifiants sont opaques). */
const isPassOpt = o => o.pass ?? ['pass', 'end', 'no', 'none'].includes(o.id);
const PVP_ERRORS = {
  'invite-invalid': 'Cette invitation est inconnue, déjà utilisée ou expirée.', 'invite-expired': 'Personne n\'a rejoint votre salon à temps : il est fermé.',
  'deck-invalid': 'Ce deck n\'est pas valide.', 'server-full': 'Le serveur est complet. Réessayez dans quelques minutes.',
  'already-in-game': 'Vous avez déjà un salon ou une partie en cours.', 'own-invite': 'C\'est votre propre invitation : envoyez ce lien à votre adversaire.',
  'too-many-rooms': 'Trop de salons créés cette heure-ci. Réessayez plus tard.', 'nothing-to-cancel': 'Aucun salon à annuler.',
};
const TYPE_LABEL = { P: 'Persos', K: 'Kicks', S: 'Soutiens', L: 'Lieux' };
const fmtClock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const RULES = `
  <h3>Une nuit</h3>
  <ol><li><b>Crépuscule</b> de chaque joueur : on relève ses cartes, on recrute 1 Perso, on pioche jusqu'à 7, puis on peut faire entrer des Persos (somme des Auras ≤ numéro de la nuit) et poser jusqu'à 2 Soutiens sur ses 2 zones (un Soutien posé sur un autre le recouvre : seul celui du dessus est actif).</li>
  <li><b>Baston</b> de chaque joueur : un combat entre un de vos Persos et un Perso adverse, ou passer.</li>
  <li><b>Aurore</b> : le plus haut Contrôle (somme des Auras visibles dans l'Arène) gagne 1 de Renommée.</li></ol>
  <h3>Un combat</h3>
  <p>Chacun pose autant de Kicks que l'Aura de son combattant, en alternant. La Puissance est la somme des Forces, plus le bonus Combo si les Rangs du Combo sont réunis (★ remplace n'importe quel Rang). Le vainqueur gagne une Renommée égale à l'Aura du combattant adverse, puis peut infliger <b>un</b> dégât. En cas d'égalité, les deux gagnent.</p>
  <h3>Fin</h3><p>Après la 6ᵉ nuit, le plus de Renommée gagne. Égalité : le plus de Persos visibles dans l'Arène l'emporte.</p>
  <h3>Construire un deck</h3><p>1 Lieu, un Groupe de Persos dont la somme des Auras ne dépasse pas ${DECK_RULES.maxAura} (un seul exemplaire de chaque Perso), un Songe de ${DECK_RULES.minSonge} à ${DECK_RULES.maxSonge} Kicks et Soutiens (${DECK_RULES.maxCopies} exemplaires maximum par carte).</p>
  <h3>Raccourcis</h3><p><kbd>1</kbd>–<kbd>9</kbd> boutons, <kbd>P</kbd> passer, <kbd>Entrée</kbd> valider, <kbd>C</kbd> conseil, <kbd>Échap</kbd> annuler / fermer.</p>`;

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const countIds = arr => arr.reduce((m, id) => ((m[id] = (m[id] || 0) + 1), m), {});

/** Rangs requis satisfaits (★ en joker), dans l'ordre du Combo. */
function rankCoverage(required, ranks) {
  const pool = [...ranks];
  const lit = required.map(r => { const i = pool.indexOf(r); if (i >= 0) { pool.splice(i, 1); return true; } return null; });
  return lit.map(v => { if (v) return true; const i = pool.indexOf('★'); if (i >= 0) { pool.splice(i, 1); return true; } return false; });
}

function loadPrefs() {
  const def = { me: null, bot: 'random', speed: 'normal', sound: true, first: 'random', reveal: false, art: true, level: 'debutant', knowList: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem('dojo-prefs') || '{}') }; } catch { return def; }
}

class UI {
  constructor() {
    this.prefs = loadPrefs();
    this.game = null;
    this.pending = null;
    this.inspect = null;
    this.logFilter = 'all';
    this.paused = false;
    this.modal = null;
    this.screen = 'setup';
    this.advisor = new Bot();
    this.sound = new Sound();
    this.sound.on = this.prefs.sound;
    this.store = new DeckStore(() => { if (this.screen === 'setup') this.renderSetup(); });
    this.art = new ArtStore(() => { if (this.screen === 'setup') this.renderSetup(); else if (this.screen === 'builder') this.renderCatalog?.(); else if (this.game) this.scheduleRender(); });
    this.downloads = null;
    window.claude?.use?.('downloads').then(d => { this.downloads = d; }).catch(() => {});
    starfield($('#sky'));
    this.particles = new Particles($('#fx'));
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('keydown', e => this.onKey(e));
    document.addEventListener('mouseover', e => {
      if (!matchMedia('(hover: hover)').matches) return;
      const el = e.target.closest('[data-uid], [data-insp]');
      if (el) this.showInspect(+(el.dataset.uid ?? el.dataset.insp));
      const def = this.screen === 'builder' && e.target.closest('[data-def]');
      if (def) this.previewDef(def.dataset.def);
    });
    addEventListener('resize', () => this.game && this.scheduleRender());
    // Jeu entre joueurs : seulement sur le site (le serveur répond à /auth/me)
    const invite = new URLSearchParams(location.search).get('invite') ?? sessionStorage.getItem('dojo-pvp-invite');
    sessionStorage.removeItem('dojo-pvp-invite');
    if (new URLSearchParams(location.search).has('invite')) history.replaceState(null, '', location.pathname);
    this.pvp = { available: false, user: null, invite, room: null, msg: null, clock: null, opp: true };
    NetClient.probe().then(r => {
      Object.assign(this.pvp, r);
      if (r.user) this.netConnect();
      if (this.screen === 'setup') this.renderSetup();
    });
    setInterval(() => this.tickClock(), 500);
    this.renderSetup();
  }

  /** Vrai pendant une partie contre un autre joueur. */
  get online() { return this.game instanceof RemoteView; }
  /** Nom de l'adversaire. */
  get oppName() { return this.online ? this.game.pname(BOT) : 'Bot'; }

  savePrefs() { try { localStorage.setItem('dojo-prefs', JSON.stringify(this.prefs)); } catch { /* stockage indisponible */ } }

  // ── Écran d'accueil : mes decks + partie ──────────────────
  renderSetup() {
    this.screen = 'setup';
    document.title = 'Dojo des Songes';
    const decks = this.store.decks;
    const valid = decks.filter(d => validateDeck(d).ok);
    if (!valid.some(d => d.id === this.prefs.me)) this.prefs.me = valid[0]?.id ?? null;
    if (this.prefs.bot !== 'random' && !valid.some(d => d.id === this.prefs.bot)) this.prefs.bot = 'random';
    const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const deckOpts = valid.map(d => [d.id, d.name]);
    const importBtns = `
      <button class="btn primary" data-act="new-deck">Nouveau deck</button>
      <label class="btn" for="import-file" tabindex="0">Importer un fichier</label>
      <input type="file" id="import-file" accept=".txt,.json,.csv,.dek,.text,text/plain,application/json" multiple hidden>
      <button class="btn" data-act="paste-open">Coller une liste</button>`;
    $('#app').innerHTML = `
      <section class="setup">
        <header class="setup-head">
          <p class="eyebrow">Fracture des Songes · règles simplifiées v1.1</p>
          <h1>Dojo des Songes</h1>
          <p class="lede">Construisez vos decks avec les 178 cartes du set, puis affrontez le bot d'entraînement sur six nuits.</p>
        </header>
        <div class="mydecks">
          <div class="md-head">
            <h2>Mes decks <small>${decks.length}</small></h2>
            <div class="buttons">${importBtns}${decks.length ? '<button class="btn ghost" data-act="export-all">Tout exporter</button>' : ''}</div>
          </div>
          <p class="store-note">${esc(this.store.label)}</p>
          ${decks.length ? `<div class="decks">${decks.map(d => this.deckTile(d)).join('')}</div>` : `
          <div class="empty-decks">
            <h3>Aucun deck pour l'instant</h3>
            <p>Créez votre premier deck carte par carte, ou importez la liste exportée par votre outil de deck (« 4 012/FDS   # BOULE DE FEU »). Les listes par nom de carte et le JSON fonctionnent aussi.</p>
          </div>`}
        </div>
        <div class="artbox">
          <div class="md-head">
            <h2>Illustrations <small>${this.art.count}/${Object.keys(CARDS).length + Object.keys(LIEUX).length}</small></h2>
            <div class="buttons">
              <label class="btn" for="art-files" tabindex="0">Importer des images</label>
              <input type="file" id="art-files" accept="image/*,.json,application/json" multiple hidden>
              <label class="btn" for="art-dir" tabindex="0">Importer un dossier</label>
              <input type="file" id="art-dir" webkitdirectory multiple hidden>
              ${this.art.count ? '<button class="btn ghost danger" data-act="art-clear">Effacer</button>' : ''}
            </div>
          </div>
          <p class="store-note">Les images restent dans ce navigateur. Importez un pack <code>.json</code> d’illustrations, ou des images dont le nom contient le numéro de la carte : « 081.png », « FDS1-081.jpg »…</p>
          <label class="check"><input type="checkbox" id="art" ${this.prefs.art ? 'checked' : ''}> Afficher les illustrations sur les cartes</label>
        </div>
        <div class="match">
          <h2>Partie d'entraînement</h2>
          <div class="opts">
            <label>Votre deck ${valid.length ? sel('me', deckOpts, this.prefs.me) : '<span class="muted">aucun deck prêt</span>'}</label>
            <label>Deck du bot ${valid.length ? sel('bot', [['random', 'Surprise (au hasard)'], ...deckOpts], this.prefs.bot) : '<span class="muted">—</span>'}</label>
            <label>Niveau du bot ${sel('level', Object.entries(LEVELS), this.prefs.level)}</label>
            ${this.prefs.level === 'expert' ? `<label class="check"><input type="checkbox" id="knowList" ${this.prefs.knowList ? 'checked' : ''}> Le bot connaît ma decklist (comme en tournoi)</label>` : ''}
            <label>Vitesse ${sel('speed', Object.keys(SPEEDS).map(s => [s, s[0].toUpperCase() + s.slice(1)]), this.prefs.speed)}</label>
            <label>Premier joueur ${sel('first', [['random', 'Au hasard'], ['me', 'Vous'], ['bot', 'Le bot']], this.prefs.first)}</label>
            <label class="check"><input type="checkbox" id="reveal" ${this.prefs.reveal ? 'checked' : ''}> Main du bot visible</label>
            <label class="check"><input type="checkbox" id="sound" ${this.prefs.sound ? 'checked' : ''}> Sons</label>
          </div>
          <div class="match-go">
            ${valid.length ? '' : '<p class="hint">Il faut au moins un deck prêt (Lieu, Groupe ≤ 20 d’Aura, Songe de 30 à 60 cartes) pour jouer.</p>'}
            <button class="btn primary big" data-act="start" ${valid.length ? '' : 'disabled'}>Lancer la partie</button>
          </div>
        </div>
        ${this.pvpHTML(valid)}
      </section>`;
    for (const id of ['pvpDeck', 'pvpMode']) $(`#${id}`)?.addEventListener('change', e => { this.prefs[id] = e.target.value; this.savePrefs(); });
    for (const id of ['speed', 'first', 'me', 'bot']) $(`#${id}`)?.addEventListener('change', e => { this.prefs[id] = e.target.value; this.savePrefs(); });
    $('#level')?.addEventListener('change', e => { this.prefs.level = e.target.value; this.savePrefs(); this.renderSetup(); });
    $('#knowList')?.addEventListener('change', e => { this.prefs.knowList = e.target.checked; this.savePrefs(); });
    for (const id of ['art-files', 'art-dir']) $(`#${id}`).addEventListener('change', e => this.importArt([...e.target.files]));
    for (const id of ['reveal', 'sound', 'art']) $(`#${id}`).addEventListener('change', e => { this.prefs[id] = e.target.checked; this.sound.on = this.prefs.sound; this.savePrefs(); });
    $('#import-file').addEventListener('change', e => this.importFiles([...e.target.files]));
    this.renderModal();
  }

  async importArt(files) {
    if (!files.length) return;
    const r = await this.art.importFiles(files);
    const miss = r.ignored.length ? ` ${r.ignored.length} fichier(s) sans numéro reconnu : ${r.ignored.slice(0, 5).join(', ')}${r.ignored.length > 5 ? '…' : ''}` : '';
    this.openModal('notice', { title: 'Illustrations', text: `${r.added} image(s) importée(s).${miss}` });
  }

  /** URL de l'illustration d'une carte, si le joueur l'a importée et l'affichage est activé. */
  artUrl(d) { return this.prefs.art ? this.art.url(d.num) : null; }

  deckTile(d) {
    const v = validateDeck(d), lieu = LIEUX[d.lieu];
    return `
      <article class="deck fam-${deckFamily(d)}">
        <div class="deck-top"><span class="deck-name">${esc(d.name)}</span><span class="state ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Prêt' : 'À compléter'}</span></div>
        <span class="deck-lieu">${esc(lieu?.name ?? 'Sans Lieu')}</span>
        <span class="deck-meta">${d.groupe.length} Persos · ${v.aura}/${DECK_RULES.maxAura} d'Aura · ${d.songe.length} cartes de Songe</span>
        ${v.ok ? '' : `<p class="deck-err">${esc(v.errors[0])}${v.errors.length > 1 ? ` (+${v.errors.length - 1})` : ''}</p>`}
        <div class="deck-actions">
          <button class="btn small" data-act="edit-deck" data-id="${d.id}">Modifier</button>
          <button class="btn ghost small" data-act="dup-deck" data-id="${d.id}">Dupliquer</button>
          <button class="btn ghost small" data-act="export-deck" data-id="${d.id}">Exporter</button>
          <button class="btn ghost small danger" data-act="del-deck" data-id="${d.id}">Supprimer</button>
        </div>
      </article>`;
  }

  // ── Import / export ───────────────────────────────────────
  async importFiles(files) {
    const all = { decks: [], errors: [], warnings: [] };
    for (const f of files) {
      let text = '';
      try { text = await f.text(); } catch { all.errors.push(`${f.name} : lecture impossible.`); continue; }
      const r = parseDecks(text, f.name.replace(/\.[^.]+$/, ''));
      all.decks.push(...r.decks);
      all.errors.push(...r.errors.map(e => `${f.name} — ${e}`));
      all.warnings.push(...r.warnings.map(e => `${f.name} — ${e}`));
    }
    await this.finishImport(all);
  }

  async finishImport(r) {
    const saved = [];
    for (const d of r.decks) saved.push(await this.store.save({ ...d, id: newDeckId() }).catch(() => null));
    this.openModal('imported', { saved: saved.filter(Boolean), errors: r.errors, warnings: r.warnings });
  }

  exportText(ids) { return formatDecks(ids.map(id => this.store.get(id)).filter(Boolean)); }

  async downloadExport() {
    const m = this.modal;
    const name = m.ids.length === 1 ? this.store.get(m.ids[0])?.name ?? 'deck' : 'mes-decks-dreamland';
    try {
      await this.downloads.save({ filename: `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck'}.txt`, data: this.exportText(m.ids) });
      m.note = 'Fichier enregistré.';
    } catch (e) {
      m.note = e?.code === 'declined' ? 'Téléchargement annulé.' : 'Téléchargement impossible : copiez le texte à la place.';
    }
    this.renderModal();
  }

  async downloadReport() {
    const m = this.modal;
    try { await this.downloads.save({ filename: 'dojo-rapport.json', data: JSON.stringify(this.game.report()) }); m.note = 'Fichier enregistré.'; }
    catch (e) { m.note = e?.code === 'declined' ? 'Téléchargement annulé.' : 'Téléchargement impossible : copiez le texte à la place.'; }
    this.renderModal();
  }

  async copyExport() {
    const ta = $('#export-text');
    try { await navigator.clipboard.writeText(ta.value); this.modal.note = 'Liste copiée.'; }
    catch { ta.select(); this.modal.note = 'Texte sélectionné : copiez-le avec Ctrl+C (Cmd+C sur Mac).'; }
    this.renderModal();
    if (this.modal.note.startsWith('Texte')) $('#export-text')?.select();
  }

  // ── Éditeur de deck ───────────────────────────────────────
  openBuilder(deck = null) {
    this.screen = 'builder';
    this.edit = deck
      ? { id: deck.id, name: deck.name, lieu: deck.lieu, groupe: [...deck.groupe], songe: [...deck.songe] }
      : { id: newDeckId(), name: 'Nouveau deck', lieu: null, groupe: [], songe: [] };
    this.dirty = false;
    this.bf = this.bf ?? { q: '', type: 'P', kw: '' };
    this.renderBuilder();
  }

  renderBuilder() {
    document.title = `${this.edit.name} — Dojo des Songes`;
    const kws = [...new Set(Object.values(CARDS).flatMap(d => d.kw))].filter(k => k !== 'BASE').sort((a, b) => a.localeCompare(b, 'fr'));
    $('#app').innerHTML = `
      <section class="builder">
        <header class="bd-head">
          <button class="btn ghost small" data-act="bd-back">← Mes decks</button>
          <input id="bd-name" value="${esc(this.edit.name)}" maxlength="40" aria-label="Nom du deck" autocomplete="off">
          <span class="bd-status" id="bd-status"></span>
          <button class="btn primary" data-act="bd-save">Enregistrer</button>
        </header>
        <div class="bd-grid">
          <div class="catalog">
            <div class="cat-filters">
              <input id="bd-q" type="search" placeholder="Rechercher un nom, un mot-clé, un effet…" value="${esc(this.bf.q)}" autocomplete="off">
              <div class="tabs" role="tablist" id="bd-tabs"></div>
              <select id="bd-kw" aria-label="Filtrer par mot-clé"><option value="">Tous les mots-clés</option>${kws.map(k => `<option value="${esc(k)}" ${k === this.bf.kw ? 'selected' : ''}>${esc(k.toLowerCase())}</option>`).join('')}</select>
            </div>
            <div class="cat-grid" id="bd-cat"></div>
          </div>
          <aside class="deckpanel" id="bd-panel"></aside>
        </div>
      </section>`;
    $('#bd-name').addEventListener('input', e => { this.edit.name = e.target.value || 'Sans nom'; this.dirty = true; this.renderStatus(); });
    $('#bd-q').addEventListener('input', e => { this.bf.q = e.target.value; this.renderCatalog(); });
    $('#bd-kw').addEventListener('change', e => { this.bf.kw = e.target.value; this.renderCatalog(); });
    this.renderCatalog();
    this.renderPanel();
    this.renderModal();
  }

  catalogDefs(type) {
    const q = norm(this.bf.q).trim();
    const pool = type === 'L' ? Object.values(LIEUX) : Object.values(CARDS).filter(d => d.type === type);
    return pool.filter(d => {
      if (this.bf.kw && !d.kw.includes(this.bf.kw)) return false;
      if (!q) return true;
      const hay = norm([d.name, d.sub, d.text, d.kw.join(' '), d.abilities?.map(a => a.text).join(' '), d.rang, numLabel(d.num)].join(' '));
      return q.split(/\s+/).every(w => hay.includes(w));
    }).sort((a, b) => a.num - b.num);
  }

  renderCatalog() {
    const counts = countIds([...this.edit.groupe, ...this.edit.songe]);
    $('#bd-tabs').innerHTML = ['P', 'K', 'S', 'L'].map(t => `<button class="tab ${t === this.bf.type ? 'on' : ''}" data-act="bd-type" data-t="${t}" role="tab" aria-selected="${t === this.bf.type}">${TYPE_LABEL[t]} <small>${this.catalogDefs(t).length}</small></button>`).join('');
    const defs = this.catalogDefs(this.bf.type);
    $('#bd-cat').innerHTML = defs.map(d => this.builderTile(d, d.type === 'L' ? (this.edit.lieu === d.id ? 1 : 0) : counts[d.id] ?? 0)).join('')
      || '<p class="empty">Aucune carte ne correspond à cette recherche.</p>';
  }

  builderTile(d, n) {
    const fam = d.type === 'L' ? 'base' : family(d);
    const max = maxCopies(d);
    const full = d.type !== 'L' && n >= max;
    let badge;
    if (d.type === 'P') badge = `<span class="badge aura" title="Aura">${d.aura}</span><span class="type">Perso</span>`;
    else if (d.type === 'K') badge = `<span class="badge force" title="Force">${d.force}</span><span class="rank" title="Rang">${d.rang}</span>`;
    else if (d.type === 'S') badge = `<span class="badge sup">S</span><span class="type">Soutien</span>`;
    else badge = `<span class="badge sup">L</span><span class="type">Lieu</span>`;
    const text = d.type === 'L' ? d.abilities.map(a => a.text).join(' · ') : d.text;
    return `
      <div class="bt fam-${fam} ${n ? 'in' : ''} ${full ? 'full' : ''} ${this.artUrl(d) ? 'art' : ''}" ${this.artUrl(d) ? `style="--art:url('${this.artUrl(d)}')"` : ''} data-def="${d.id}" data-act="bd-add" tabindex="0" title="${esc(full ? (max === 1 ? 'Un seul exemplaire par Perso' : `${max} exemplaires maximum`) : 'Ajouter au deck')}">
        <div class="card-top">${badge}<span class="bt-num">${numLabel(d.num)}</span></div>
        <div class="card-name">${esc(d.name)}</div>
        ${d.sub ? `<div class="card-sub">${esc(d.sub)}</div>` : ''}
        ${d.combo ? `<div class="card-combo">Combo ${d.combo.ranks.join(' ')} <b>+${d.combo.bonus}</b></div>` : ''}
        <p class="bt-text">${esc(text)}</p>
        <div class="card-kw">${d.kw.filter(k => k !== 'BASE').map(k => `<span>${esc(k.toLowerCase())}</span>`).join('')}</div>
        ${n ? `<div class="bt-count">${d.type === 'L' ? '<b>Lieu choisi</b>' : `<button class="mini" data-act="bd-rem" data-def="${d.id}" aria-label="Retirer un exemplaire">−</button><b>${n}</b><button class="mini" data-act="bd-add" data-def="${d.id}" aria-label="Ajouter un exemplaire" ${full ? 'disabled' : ''}>+</button>`}</div>` : ''}
      </div>`;
  }

  renderPanel() {
    const e = this.edit, v = validateDeck(e);
    const lieu = LIEUX[e.lieu];
    const row = ([id, n]) => {
      const d = CARDS[id];
      const stat = d.type === 'P' ? `${d.aura}` : d.type === 'K' ? d.rang : 'S';
      return `<li class="dp-row fam-${family(d)}" data-def="${id}">
        <span class="dp-q">${n}×</span><span class="dp-name"><small class="dp-num">${numLabel(d.num)}</small> ${esc(d.name)}${d.sub ? ` <i>${esc(d.sub)}</i>` : ''}</span>
        <span class="dp-stat">${stat}</span>
        <button class="mini" data-act="bd-rem" data-def="${id}" aria-label="Retirer">−</button><button class="mini" data-act="bd-add" data-def="${id}" aria-label="Ajouter" ${n >= maxCopies(d) ? 'disabled' : ''}>+</button></li>`;
    };
    const sortBy = ids => Object.entries(countIds(ids)).sort((a, b) => {
      const da = CARDS[a[0]], db = CARDS[b[0]];
      return (da.type > db.type ? 1 : da.type < db.type ? -1 : 0) || (da.aura ?? RANK_ORDER[da.rang] ?? 9) - (db.aura ?? RANK_ORDER[db.rang] ?? 9) || da.num - db.num;
    });
    const ranks = countIds(e.songe.map(id => CARDS[id].type === 'S' ? 'Soutien' : CARDS[id].rang));
    const meter = (val, max, min = 0) => `<div class="meter ${val > max || val < min ? 'bad' : val >= min ? 'ok' : ''}"><span style="width:${Math.min(100, (val / max) * 100)}%"></span></div>`;
    $('#bd-panel').innerHTML = `
      <div class="dp-section">
        <h3>Lieu</h3>
        ${lieu ? `<div class="dp-lieu" data-def="${lieu.id}"><b>${esc(lieu.name)}</b><button class="mini" data-act="bd-unlieu" aria-label="Retirer le Lieu">×</button></div>` : '<p class="hint">Choisissez un Lieu dans l’onglet Lieux.</p>'}
      </div>
      <div class="dp-section">
        <h3>Groupe <small>${e.groupe.length} Persos · ${v.aura}/${DECK_RULES.maxAura} d'Aura</small></h3>
        ${meter(v.aura, DECK_RULES.maxAura)}
        <ul class="dp-list">${sortBy(e.groupe).map(row).join('') || '<li class="hint">Ajoutez des Persos (onglet Persos).</li>'}</ul>
      </div>
      <div class="dp-section">
        <h3>Songe <small>${e.songe.length} cartes · ${DECK_RULES.minSonge} à ${DECK_RULES.maxSonge}</small></h3>
        ${meter(e.songe.length, DECK_RULES.maxSonge, DECK_RULES.minSonge)}
        <p class="dp-ranks">${['B', 'M', 'S', '★', 'Soutien'].map(r => `<span><b>${ranks[r] ?? 0}</b> ${r === 'Soutien' ? 'Soutiens' : r}</span>`).join('')}</p>
        <ul class="dp-list">${sortBy(e.songe).map(row).join('') || '<li class="hint">Ajoutez des Kicks et des Soutiens.</li>'}</ul>
      </div>
      <div class="dp-check ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Deck prêt à jouer.' : `<ul>${v.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}</div>
      <div id="bd-insp" class="bd-insp"><p class="insp-empty">Survolez une carte pour la lire en grand.</p></div>`;
    this.renderStatus();
  }

  renderStatus() {
    const el = $('#bd-status');
    if (el) el.textContent = this.dirty ? 'Modifications non enregistrées' : this.store.get(this.edit.id) ? 'Enregistré' : 'Nouveau deck';
    document.title = `${this.edit.name} — Dojo des Songes`;
  }

  bdAdd(id) {
    const e = this.edit;
    if (LIEUX[id]) { e.lieu = id; this.bf.type = 'L'; }
    else {
      const d = CARDS[id];
      if ([...e.groupe, ...e.songe].filter(x => x === id).length >= maxCopies(d)) return;
      (d.type === 'P' ? e.groupe : e.songe).push(id);
    }
    this.dirty = true;
    this.renderCatalog();
    this.renderPanel();
  }

  bdRemove(id) {
    const e = this.edit, zone = CARDS[id]?.type === 'P' ? e.groupe : e.songe;
    const i = zone.lastIndexOf(id);
    if (i >= 0) zone.splice(i, 1);
    this.dirty = true;
    this.renderCatalog();
    this.renderPanel();
  }

  async bdSave() {
    try {
      await this.store.save(this.edit);
      this.dirty = false;
      this.renderStatus();
      const el = $('#bd-status');
      if (el) el.textContent = validateDeck(this.edit).ok ? 'Enregistré, prêt à jouer' : 'Enregistré (incomplet)';
    } catch {
      const el = $('#bd-status');
      if (el) el.textContent = 'Échec de l’enregistrement : réessayez.';
    }
  }

  previewDef(id) {
    const el = $('#bd-insp');
    const d = CARDS[id] ?? LIEUX[id];
    if (!el || !d) return;
    const fam = d.type === 'L' ? 'base' : family(d);
    const type = { P: 'Perso', K: 'Kick', S: 'Soutien', L: 'Lieu' }[d.type];
    const big = d.type === 'P' ? `<span class="big-stat">${d.aura}</span>` : d.type === 'K' ? `<span class="big-stat">${d.force}</span><span class="big-rank">${d.rang}</span>` : `<span class="big-stat sup">${d.type}</span>`;
    const body = d.type === 'L'
      ? d.abilities.map(a => `<p><span class="bc-cond">${{ crepuscule: 'Crépuscule', aurore: 'Aurore', combat: 'Baston', denouement: 'Dénouement', finCombat: 'Fin de combat' }[a.when]}</span> ${esc(a.text)}</p>`).join('')
      : `<p class="bc-cond">${d.abType === 'DÉGÂT' ? 'Dégât' : 'Capacité'} · ${esc(d.cond)}</p><p>${esc(d.text)}</p>`;
    el.innerHTML = `
      <article class="bigcard fam-${fam}">
        ${this.artUrl(d) ? `<img class="bc-art" src="${this.artUrl(d)}" alt="${esc(d.name)}">` : ''}
        <header><div class="bc-stats">${big}</div><div class="bc-type">${type}<small>${numLabel(d.num)}</small></div></header>
        <h3>${esc(d.name)}</h3>
        ${d.sub ? `<p class="bc-sub">${esc(d.sub)}</p>` : ''}
        ${d.combo ? `<p class="bc-combo">Combo ${d.combo.ranks.map(r => `<i>${r}</i>`).join('')} <b>+${d.combo.bonus}</b></p>` : ''}
        <div class="bc-text">${body}</div>
        ${d.kw.length ? `<p class="bc-kw">${d.kw.map(k => `<span title="${esc(KW_HELP[k] ?? '')}">${esc(k)}</span>`).join('')}</p>` : ''}
      </article>`;
  }

  // ── Partie ────────────────────────────────────────────────
  start() {
    const valid = this.store.decks.filter(d => validateDeck(d).ok);
    const me = this.store.get(this.prefs.me);
    const bot = this.prefs.bot === 'random' ? valid[Math.floor(Math.random() * valid.length)] : this.store.get(this.prefs.bot);
    if (!me || !bot || !validateDeck(me).ok || !validateDeck(bot).ok) { this.openModal('notice', { title: 'Deck incomplet', text: 'Choisissez deux decks prêts à jouer.' }); return; }
    const copy = d => ({ id: d.id, name: d.name, lieu: d.lieu, groupe: [...d.groupe], songe: [...d.songe] });
    this.screen = 'game';
    this.pool ??= new SearchPool();
    this.pool.reset();
    this.thinking = null;
    this.bot = this.prefs.level === 'expert'
      ? new ExpertBot({
        delay: SPEEDS[this.prefs.speed], knowList: this.prefs.knowList,
        budget: { key: 15000, kick: 6000, mid: 2500 }, maxSims: { key: 9000, kick: 3500, mid: 900 },
        runner: job => this.pool.run(job),
        onThink: (on, tier) => { this.thinking = on ? tier : null; this.render(); },
      })
      : new Bot({ delay: SPEEDS[this.prefs.speed] });
    const human = { ask: (g, pid, req) => this.humanAsk(g, req) };
    const botAgent = { ask: async (g, pid, req) => { while (this.paused) await sleep(150); if (g.s.over) return new Promise(() => {}); return this.bot.ask(g, pid, req); } };
    const first = { me: HUMAN, bot: BOT }[this.prefs.first] ?? null;
    const game = new Game({
      decks: [copy(me), copy(bot)], names: ['Joueur', 'Bot'], agents: [human, botAgent], first,
      seed: Math.floor(Math.random() * 1e9), trace: true,
      onUpdate: () => game === this.game && this.scheduleRender(),
      onEvent: (t, d) => game === this.game && this.onGameEvent(t, d),
    });
    Object.assign(this, {
      game, pending: null, inspect: null, paused: false, modal: null, fxQueue: [], advice: null,
      prev: { scores: [0, 0], power: {}, kicks: new Set(), hand: new Set(), down: new Set(), phase: '' },
      fresh: new Set(),
      stats: { combats: 0, won: [0, 0], combos: [0, 0], dmg: [0, 0], counters: [0, 0] },
    });
    this.sound.ensure();
    this.renderModal();
    $('#app').innerHTML = this.shell();
    game.run().then(() => game === this.game && this.render());
  }

  // ── Agent humain ──────────────────────────────────────────
  humanAsk(g, req) {
    if (g.s.over) return new Promise(() => {});
    return new Promise(resolve => {
      this.pending = { req, resolve, selected: new Set() };
      this.advice = null;
      if (req.kind === 'kickTurn' || req.kind === 'crepuscule' || req.kind === 'bastonFighter') this.sound.play('turn');
      this.render();
    });
  }

  answer(value) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.advice = null;
    p.resolve(value);
    this.render();
  }

  isMulti(req) { return req.max > 1 || req.min === 0; }

  // ── Entrées ───────────────────────────────────────────────
  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (t) {
      const a = t.dataset.act;
      switch (a) {
        case 'new-deck': this.openBuilder(); return;
        case 'art-clear': this.art.clear(); return;
        case 'edit-deck': this.openBuilder(this.store.get(t.dataset.id)); return;
        case 'dup-deck': { const d = this.store.get(t.dataset.id); if (d) this.store.save({ ...d, id: newDeckId(), name: `${d.name} (copie)` }); return; }
        case 'del-deck': this.openModal('delDeck', { id: t.dataset.id }); return;
        case 'del-now': this.store.remove(this.modal.id).catch(() => {}); this.closeModal(); return;
        case 'export-deck': this.openModal('export', { ids: [t.dataset.id] }); return;
        case 'export-all': this.openModal('export', { ids: this.store.decks.map(d => d.id) }); return;
        case 'copy-export': this.copyExport(); return;
        case 'dl-report': this.downloadReport(); return;
        case 'dl-export': this.downloadExport(); return;
        case 'paste-open': this.openModal('paste'); return;
        case 'paste-import': { const txt = $('#paste-text')?.value ?? ''; this.closeModal(); this.finishImport(parseDecks(txt, 'Deck collé')); return; }
        case 'bd-type': this.bf.type = t.dataset.t; this.renderCatalog(); return;
        case 'bd-add': if (!t.disabled) this.bdAdd(t.dataset.def); return;
        case 'bd-rem': this.bdRemove(t.dataset.def); return;
        case 'bd-unlieu': this.edit.lieu = null; this.dirty = true; this.renderCatalog(); this.renderPanel(); return;
        case 'bd-save': this.bdSave(); return;
        case 'bd-back': if (this.dirty) this.openModal('leaveBuilder'); else { this.closeModal(); this.renderSetup(); } return;
        case 'bd-leave': this.dirty = false; this.closeModal(); this.renderSetup(); return;
        case 'bd-save-leave': this.bdSave().then(() => { this.closeModal(); this.renderSetup(); }); return;
        case 'start': this.start(); return;
        case 'rematch': if (this.online) { this.leaveOnline(); return; } this.start(); return;
        case 'menu': if (this.online && this.game.s.over) { this.leaveOnline(); return; } this.openModal(this.online ? 'forfeit' : 'quit'); return;
        case 'pvp-create': this.pvpCreate(); return;
        case 'pvp-join': this.pvpJoin(); return;
        case 'pvp-cancel': this.net?.send({ type: 'cancel' }); return;
        case 'pvp-copy': navigator.clipboard?.writeText(this.inviteUrl()).then(() => { this.pvp.msg = { ok: 'Lien copié.' }; this.renderSetup(); }).catch(() => {}); return;
        case 'pvp-forget-invite': this.pvp.invite = null; this.renderSetup(); return;
        case 'pvp-dev-login': { const n = $('#pvp-dev-name')?.value.trim(); if (n) { this.saveInviteForLogin(); location.href = `/auth/dev?name=${encodeURIComponent(n)}`; } return; }
        case 'pvp-login': this.saveInviteForLogin(); location.href = '/auth/discord'; return;
        case 'forfeit': this.openModal('forfeit'); return;
        case 'forfeit-now': this.forfeit(); return;
        case 'menu-now': if (this.online) { this.leaveOnline(); return; } this.game = null; this.pending = null; document.querySelector('.end')?.remove(); this.closeModal(); this.renderSetup(); return;
        case 'opt': this.chooseOption(t.dataset.id); return;
        case 'confirm': this.answer([...this.pending.selected]); return;
        case 'clear': this.pending.selected.clear(); this.render(); return;
        case 'advice': this.giveAdvice(); return;
        case 'pause': this.paused = !this.paused; this.render(); return;
        case 'mute': this.sound.on = this.prefs.sound = !this.sound.on; this.savePrefs(); this.render(); return;
        case 'rules': this.openModal('rules'); return;
        case 'pile': this.openModal('pile', { pid: +t.dataset.pid, zone: t.dataset.zone }); return;
        case 'close': this.closeModal(); return;
        case 'logf': this.logFilter = t.dataset.f; this.render(); return;
        case 'report': this.openModal('report'); return;
        case 'toggle-log': document.body.classList.toggle('log-open'); return;
      }
    }
    const c = e.target.closest('[data-uid]');
    if (c) {
      const uid = +c.dataset.uid;
      const opt = this.pending?.req.options.find(o => isCardPick(o) && o.card.uid === uid);
      if (opt && !c.closest('.modal')) return this.chooseOption(String(opt.id));
      this.showInspect(uid);
    }
  }

  onKey(e) {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'Escape') { if (this.modal) return this.closeModal(); if (this.pending?.selected.size) { this.pending.selected.clear(); this.render(); } return; }
    if (!this.pending || this.modal) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') { $('[data-act=confirm]:not([disabled])')?.click(); return; }
    if (k === 'c') return this.giveAdvice();
    if (k === 'p') { $('#prompt [data-pass]')?.click(); return; }
    if (/^[1-9]$/.test(k)) { $(`#prompt [data-key="${k}"]`)?.click(); }
  }

  chooseOption(id) {
    const p = this.pending;
    if (!p) return;
    const opt = p.req.options.find(o => String(o.id) === String(id));
    if (!opt) return;
    if (this.isMulti(p.req) && opt.card) {
      // L'ordre des clics est conservé (Set) : il compte pour le mulligan (R69)
      p.selected.has(opt.id) ? p.selected.delete(opt.id) : p.selected.size < p.req.max && p.selected.add(opt.id);
      this.render();
      return;
    }
    this.answer(opt.id);
  }

  giveAdvice() {
    if (!this.pending || this.online) return; // pas d'aide du bot contre un joueur
    const ans = this.advisor.suggest(this.game, HUMAN, this.pending.req);
    this.advice = new Set([].concat(ans ?? []).map(String));
    this.render();
  }

  showInspect(uid) {
    if (!this.game) return;
    const c = this.game.find(uid);
    if (!c) return;
    this.inspect = c;
    const el = $('#inspector');
    if (el) el.innerHTML = this.inspectorHTML();
  }

  forfeit() {
    const g = this.game;
    if (!g || g.s.over) return;
    if (this.online) { this.closeModal(); this.net?.send({ type: 'concede' }); return; }
    this.closeModal();
    this.pending = null;
    g.s.combat = null;
    g.s.over = true;
    g.s.phase = 'Abandon';
    g.s.result = { winner: BOT, scores: [g.p(HUMAN).renommee, g.p(BOT).renommee], forfeit: true };
    g.log('Joueur abandonne la partie.', HUMAN);
    this.pool?.reset();
    this.thinking = null;
    this.render();
  }

  openModal(type, data = {}) { this.modal = { type, ...data }; this.renderModal(); }
  closeModal() { this.modal = null; this.renderModal(); }

  // ── Événements du moteur ──────────────────────────────────
  onGameEvent(type, d) {
    const g = this.game;
    switch (type) {
      case 'combo':
        this.stats.combos[d.pid]++;
        this.sound.play('combo');
        this.fxQueue.push(() => this.particles.burst($(`[data-fx="fighter-${d.pid}"]`), { color: [FAM_COLOR[deckFamily(g.p(d.pid).deck)], '#fff'], count: 50 }));
        this.toast(`Combo ${d.pid === HUMAN ? 'activé' : 'adverse activé'} !`, d.pid);
        break;
      case 'victory': {
        this.stats.combats++;
        d.winners.forEach(w => this.stats.won[w]++);
        const me = d.winners.includes(HUMAN), them = d.winners.includes(BOT);
        this.sound.play(me ? 'win' : 'lose');
        const [mine, theirs] = d.att === HUMAN ? [d.pa, d.pb] : [d.pb, d.pa];
        this.banner(me && them ? 'Égalité' : me ? 'Victoire' : 'Défaite', `${mine} — ${theirs}`, me && !them ? 'good' : !me ? 'bad' : '');
        this.fxQueue.push(() => d.winners.forEach(w => this.particles.burst($(`[data-fx="pow-${w}"]`), { color: [FAM_COLOR[deckFamily(g.p(w).deck)], '#ffb44c'], count: 45, up: true, spread: 2.2 })));
        break;
      }
      case 'damage':
        this.stats.dmg[d.w]++;
        this.sound.play('damage');
        this.toast(`Dégât : ${d.label}`, d.w);
        document.body.classList.remove('shake');
        void document.body.offsetWidth;
        document.body.classList.add('shake');
        break;
      case 'counter':
        this.stats.counters[d.pid]++;
        this.sound.play('counter');
        this.toast(`Contre : ${d.label}`, d.pid);
        break;
      case 'reshuffle': this.toast(`${g.pname(d.pid)} reconstitue son Songe`, d.pid); break;
      case 'night':
        this.fresh.clear();
        this.drawnOnce?.clear();
        this.sound.play('night');
        this.banner(`Nuit ${d.n}`, d.n === NIGHTS ? 'Dernière nuit' : `${NIGHTS - d.n} nuit${NIGHTS - d.n > 1 ? 's' : ''} ensuite`, 'night');
        break;
      case 'phase':
        document.body.classList.add('aurore');
        setTimeout(() => document.body.classList.remove('aurore'), 2600);
        break;
    }
  }

  toast(text, pid) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${pid === HUMAN ? 'me' : pid === BOT ? 'bot' : ''}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

  banner(title, sub, tone = '') {
    const el = $('#banner');
    if (!el) return;
    el.className = `banner show ${tone}`;
    el.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => (el.className = 'banner'), 1500);
  }

  // ── Rendu ─────────────────────────────────────────────────
  scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); });
  }

  shell() {
    return `
      <div class="game">
        <header class="topbar" id="topbar"></header>
        <main class="board" id="board">
          <section class="side opp" id="opp"></section>
          <section class="combat" id="combat"></section>
          <section class="side me" id="me"></section>
          <section class="prompt" id="prompt" aria-live="polite"></section>
          <section class="hand" id="hand"></section>
        </main>
        <aside class="rail">
          <div class="inspector" id="inspector"></div>
          <div class="log-wrap">
            <div class="log-head"><button class="log-toggle" data-act="toggle-log">Journal</button>
              <div class="tabs">${[['all', 'Tout'], ['fight', 'Combats'], ['me', 'Vous']].map(([f, l]) => `<button data-act="logf" data-f="${f}" class="tab">${l}</button>`).join('')}${this.online ? '' : '<button data-act="report" class="tab" title="Rapport de diagnostic : partie rejouable + décisions du bot">Rapport</button>'}</div></div>
            <ol class="log" id="log"></ol>
          </div>
        </aside>
        <div class="toasts" id="toasts"></div>
        <div class="banner" id="banner"></div>
      </div>`;
  }

  render() {
    const g = this.game;
    if (!g || !$('#topbar')) return;
    const choosable = new Set((this.pending?.req.options ?? []).filter(isCardPick).map(o => o.card.uid));
    this.ctx = { choosable, selected: this.pending?.selected ?? new Set(), advised: this.advice ?? new Set() };
    document.title = this.pending ? '● À vous — Dojo des Songes' : 'Dojo des Songes';
    $('#topbar').innerHTML = this.topbarHTML();
    const mat = matchMedia('(min-width: 1100px)').matches;
    $('#board').classList.toggle('mat-mode', mat);
    $('#opp').innerHTML = mat ? this.matHTML(BOT) : this.sideHTML(BOT);
    $('#me').innerHTML = mat ? this.matHTML(HUMAN) : this.sideHTML(HUMAN);
    $('#opp').classList.toggle('active', g.s.active === BOT);
    $('#me').classList.toggle('active', g.s.active === HUMAN);
    $('#combat').innerHTML = mat ? this.combatStripHTML() : this.combatHTML();
    $('#combat').classList.toggle('live', !!g.s.combat);
    $('#hand').innerHTML = this.handHTML();
    $('#prompt').innerHTML = this.promptHTML();
    $('#prompt').classList.toggle('mine', !!this.pending);
    $('#inspector').innerHTML = this.inspectorHTML();
    this.renderLog();
    this.afterRender();
    if (g.s.over && !this.pending) this.renderEnd();
  }

  /** Animations déclenchées par les différences avec le rendu précédent. */
  afterRender() {
    const g = this.game, prev = this.prev;
    // Renommée : « +N » flottant et gerbe dorée
    [0, 1].forEach(pid => {
      const now = g.p(pid).renommee, diff = now - prev.scores[pid];
      if (!diff) return;
      const el = $(`.score.${pid === HUMAN ? 'me' : 'bot'}`);
      if (el) {
        const f = document.createElement('span');
        f.className = `float ${diff > 0 ? 'up' : 'down'}`;
        f.textContent = diff > 0 ? `+${diff}` : diff;
        el.appendChild(f);
        if (diff > 0) { this.particles.burst(el, { color: ['#ffb44c', '#ffe2a8'], count: 14 + diff * 6, speed: 3 }); if (pid === HUMAN) this.sound.play('fame'); }
      }
      prev.scores[pid] = now;
    });
    // Puissance qui change
    if (g.s.combat) [0, 1].forEach(pid => {
      const p = g.power(pid);
      if (prev.power[pid] != null && p !== prev.power[pid]) $(`[data-fx="pow-${pid}"]`)?.classList.add('bump');
      prev.power[pid] = p;
    }); else prev.power = {};
    // Kicks posés, cartes piochées, cartes retournées
    document.querySelectorAll('.kicks [data-uid]').forEach(el => { if (!prev.kicks.has(+el.dataset.uid)) { el.classList.add('enter'); prev.kicks.add(+el.dataset.uid); this.sound.play('kick'); } });
    const handNow = new Set(g.p(HUMAN).hand.map(c => c.uid));
    if (g.s.night) handNow.forEach(u => { if (!prev.hand.has(u)) this.fresh.add(u); });
    prev.hand = handNow;
    this.drawnOnce ??= new Set();
    document.querySelectorAll('#hand .card.fresh[data-uid]').forEach(el => {
      const uid = +el.dataset.uid;
      if (!this.drawnOnce.has(uid)) { this.drawnOnce.add(uid); el.classList.add('drawn'); }
    });
    document.querySelectorAll('.side .card.down[data-uid]').forEach(el => { if (!prev.down.has(+el.dataset.uid)) el.classList.add('flipping'); });
    prev.down = new Set([...document.querySelectorAll('.side .card.down[data-uid]')].map(el => +el.dataset.uid));
    const q = this.fxQueue.splice(0);
    q.forEach(f => f());
  }

  topbarHTML() {
    const g = this.game, s = g.s;
    const phase = n => (n < s.night ? 'past' : n === s.night ? 'now' : '');
    const moons = Array.from({ length: NIGHTS }, (_, i) => {
      const n = i + 1, lit = n / NIGHTS;
      return `<li class="moon ${phase(n)}" title="Nuit ${n}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="m-dark"/><path class="m-lit" d="M12 2a10 10 0 0 1 0 20a${Math.abs(10 * (1 - 2 * lit)).toFixed(2)} 10 0 0 ${lit > 0.5 ? 1 : 0} 0-20z"/></svg><span>${n}</span></li>`;
    }).join('');
    const score = pid => `<div class="score ${pid === HUMAN ? 'me' : 'bot'}"><span class="who">${pid === HUMAN ? 'Vous' : esc(this.oppName)}</span><span class="pts">${g.p(pid).renommee}</span><span class="unit">Renommée</span></div>`;
    return `
      <div class="brand"><button class="btn ghost small" data-act="menu" title="${this.online ? 'Revenir à l\'accueil' : 'Quitter la partie'}">Decks</button><span>Dojo des Songes</span></div>
      <ol class="nights" aria-label="Nuits">${moons}</ol>
      <div class="phase"><span class="phase-name">${esc(s.phase)}</span>${s.night ? `<span class="first">1ᵉʳ joueur : ${esc(g.pname(s.first))}</span>` : ''}</div>
      <div class="tools">
        ${this.online ? `<span class="pvp-clock" id="pvp-clock">${this.clockHTML()}</span>${this.pvp.opp ? '' : '<span class="pvp-off" title="Votre adversaire a perdu la connexion">Adversaire déconnecté</span>'}` : `
        <button class="icon-btn" data-act="pause" title="${this.paused ? 'Reprendre le bot' : 'Mettre le bot en pause'}">${this.paused ? '▶' : '❚❚'}</button>
        <select id="speed-live" title="Vitesse du bot">${Object.keys(SPEEDS).map(s2 => `<option value="${s2}" ${s2 === this.prefs.speed ? 'selected' : ''}>${s2}</option>`).join('')}</select>`}
        <button class="icon-btn" data-act="mute" title="${this.sound.on ? 'Couper le son' : 'Activer le son'}">${this.sound.on ? '♪' : '✕'}</button>
        <button class="icon-btn" data-act="rules" title="Règles et raccourcis">?</button>
        ${!s.over ? '<button class="btn ghost small forfeit" data-act="forfeit" title="Abandonner la partie">Abandonner</button>' : ''}
      </div>
      <div class="scores">${score(HUMAN)}${score(BOT)}</div>`;
  }

  sideHTML(pid) {
    const g = this.game, p = g.p(pid), lieu = g.lieu(pid);
    const ctrl = g.control(pid), octrl = g.control(1 - pid);
    const pile = (k, z, v) => `<button class="count" data-act="pile" data-pid="${pid}" data-zone="${z}" title="Voir la ${k}"><b>${v}</b>${k}</button>`;
    const counts = [
      `<span class="count"><b>${p.groupe.length}</b>Groupe</span>`, `<span class="count"><b>${p.songe.length}</b>Songe</span>`,
      pile('Fosse', 'fosse', p.fosse.length), pile('Exil', 'exil', p.exil.length),
    ].join('');
    const tags = [...p.teams].map(t => `<span class="team" title="${esc(KW_HELP[t] ?? '')}">${esc(t.toLowerCase())}</span>`).join('') + (p.gold ? `<span class="team" title="Pièces d'or">${p.gold} or</span>` : '');
    const readyLieu = new Set((this.pending?.req.options ?? []).filter(o => o.lieuIndex != null).map(o => o.lieuIndex));
    const whenLabel = { crepuscule: 'Crépuscule', aurore: 'Aurore', combat: 'Baston', denouement: 'Dénouement', finCombat: 'Fin de combat' };
    const lieuHTML = `
      <div class="lieu fam-${deckFamily(p.deck)} ${p.lieuUsedNight ? 'spent' : ''}">
        <div class="lieu-name">${esc(lieu.name)}${p.lieuUsedNight ? '<small>utilisé cette nuit</small>' : ''}</div>
        <ol>${lieu.abilities.map((a, i) => `<li class="${p.lieuUsed[i] ? 'used' : ''} ${pid === HUMAN && readyLieu.has(i) ? 'ready' : ''}"><span class="when">${whenLabel[a.when]}</span>${esc(a.text)}</li>`).join('')}</ol>
      </div>`;
    const botHand = pid === BOT ? `<div class="zone opp-hand"><h3>Main <small>${p.hand.length}</small></h3><div class="row">${
      this.prefs.reveal && !this.online ? p.hand.map(c => this.cardHTML(c, { small: true })).join('') : p.hand.map(() => '<div class="card back small" aria-hidden="true"></div>').join('')}</div></div>` : '';
    return `
      <div class="side-head">
        <h2>${pid === HUMAN ? 'Votre camp' : this.online ? `Camp de ${esc(this.oppName)}` : 'Camp du bot'} <small>${esc(p.deck.name)}</small></h2>
        <div class="counts">${counts}${tags}<span class="count ctrl ${ctrl > octrl ? 'lead' : ''}" title="Contrôle : somme des Auras visibles dans l'Arène"><b>${ctrl}</b>Contrôle${ctrl > octrl ? ' · mène' : ''}</span></div>
      </div>
      <div class="side-body">
        <div class="zone arena"><h3>Arène</h3><div class="row">${p.arena.map(c => this.cardHTML(c)).join('') || '<p class="empty">Aucun Perso</p>'}</div></div>
        <div class="zone supports"><h3>Soutiens</h3><div class="row">${g.supportStacks(pid).map(s => this.stackHTML(s, true)).join('') || '<p class="empty">—</p>'}</div></div>
        <div class="zone reserve"><h3>Réserve</h3><div class="row">${p.reserve.map(c => this.cardHTML(c, { small: true, hint: g.aura(c) <= g.s.night && pid === HUMAN ? 'peut entrer' : null })).join('') || '<p class="empty">Vide</p>'}</div></div>
        ${lieuHTML}
        ${botHand}
      </div>`;
  }

  combatHTML() {
    const g = this.game, c = g.s.combat;
    if (!c) {
      const s = g.s;
      return `<div class="no-combat"><span>${s.over ? 'Partie terminée' : s.night ? 'Pas de combat en cours' : 'Mise en place'}</span></div>`;
    }
    const pw = pid => (c.final ? c.final[pid] : g.power(pid));
    const mine = pw(HUMAN), theirs = pw(BOT), total = Math.max(1, mine + theirs);
    const sideRow = pid => {
      const sd = c.sides[pid], f = g.find(sd.fighter);
      const combo = f && !f.hidden && g.def(f).combo;
      const ranks = sd.kicks.map(k => k.rang).filter(Boolean);
      let comboChips = '<span class="combo none">Pas de Combo</span>';
      if (combo) {
        const lit = rankCoverage(combo.ranks, ranks);
        const state = sd.comboActive ? 'on' : sd.comboBlocked ? 'blocked' : '';
        const missing = combo.ranks.filter((_, i) => !lit[i]);
        comboChips = `<span class="combo ${state}" title="${sd.comboActive ? 'Combo activé' : sd.comboBlocked ? 'Capacité du Combo bloquée' : `Il manque : ${missing.join(', ')}`}">Combo ${combo.ranks.map((r, i) => `<i class="${lit[i] ? 'lit' : ''}">${r}</i>`).join('')} +${sd.comboActive ? g.comboBonus(pid) : combo.bonus}</span>`;
      }
      const left = Math.max(0, sd.max - sd.turns);
      const pips = Array.from({ length: Math.max(sd.max, sd.turns) }, (_, i) => `<i class="${i < sd.turns ? 'used' : ''}"></i>`).join('');
      return `
        <div class="fight-row ${pid === HUMAN ? 'me' : 'bot'} ${c.winners?.includes(pid) ? 'winner' : ''}">
          <div class="fighter" data-fx="fighter-${pid}">${f ? this.cardHTML(f) : ''}</div>
          <div class="kicks">${sd.kicks.map(k => this.cardHTML(k, { kick: true })).join('') || '<p class="empty">Aucun Kick posé</p>'}</div>
          <div class="power">
            <span class="pow" data-fx="pow-${pid}">${pw(pid)}</span>
            <span class="pow-label">Puissance</span>
            <span class="pips" title="${left} Kick(s) restant(s) sur ${sd.max}">${pips}</span>
            ${comboChips}
            ${sd.puissanceMod ? `<span class="mod">${sd.puissanceMod} Puissance</span>` : ''}
          </div>
        </div>`;
    };
    return `
      <div class="combat-head"><span class="stage">${c.provoc ? "Provoc' · " : ''}${esc(c.stage)}</span><span>Joueur 1 : ${esc(g.pname(c.attacker))} · En jeu : ${g.aura(g.fighter(BOT))} contre ${g.aura(g.fighter(HUMAN))} de Renommée</span></div>
      ${sideRow(BOT)}
      <div class="tug" title="Rapport de Puissance"><span style="width:${(mine / total) * 100}%"></span></div>
      ${sideRow(HUMAN)}`;
  }


  // ── Tapis de jeu (écrans larges) ──────────────────────────
  /** Zones du tapis en % (joueur du bas). Le tapis adverse est retourné : x → 100−x−w, y → 100−y−h. */
  static ZONES = {
    night: [4.4, 4.4, 3.2, 5.8], lieu: [4.6, 11.2, 14.2, 17.8], fighter: [26.1, 3.8, 10, 25.2],
    kicks: [37.5, 3, 57.5, 26.5], arena: [16.5, 31, 67.5, 34], supL: [4.6, 40.8, 10.2, 24.7],
    supR: [84.8, 40, 10.3, 25], groupe: [4.6, 71, 10.2, 24.5], exil: [1.5, 72, 2.6, 25],
    reserve: [16.5, 73, 56.8, 24], songe: [73.7, 70.5, 10.5, 25], fosse: [84.9, 70.5, 10.5, 25],
  };

  zone(name, flip, inner, cls = '') {
    let [x, y, w, h] = UI.ZONES[name];
    if (flip) { x = 100 - x - w; y = 100 - y - h; }
    return `<div class="mz mz-${name} ${cls}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%">${inner}</div>`;
  }

  matHTML(pid) {
    const g = this.game, p = g.p(pid), lieu = g.lieu(pid), flip = pid === BOT;
    const c = g.s.combat, fighter = c?.sides[pid] ? g.fighter(pid) : null;
    const ctrl = g.control(pid), octrl = g.control(1 - pid);
    const sups = g.supportStacks(pid);
    const readyLieu = new Set((this.pending?.req.options ?? []).filter(o => o.lieuIndex != null).map(o => o.lieuIndex));
    const whenLabel = { crepuscule: 'Crép.', aurore: 'Aurore', combat: 'Baston', denouement: 'Dén.', finCombat: 'Fin' };
    const deck = (n, label) => `<div class="pile-back" title="${label} : ${n} carte(s)"><span>${n}</span></div>`;
    const top = p.fosse[p.fosse.length - 1];
    const tags = [...p.teams].map(t => `<span class="team" title="${esc(KW_HELP[t] ?? '')}">${esc(t.toLowerCase())}</span>`).join('') + (p.gold ? `<span class="team">${p.gold} or</span>` : '');
    const head = `
      <div class="mat-head">
        <h2>${pid === HUMAN ? 'Votre tapis' : this.online ? `Tapis de ${esc(this.oppName)}` : 'Tapis du bot'} <small>${esc(p.deck.name)}</small></h2>
        <div class="counts">${tags}<span class="count ctrl ${ctrl > octrl ? 'lead' : ''}"><b>${ctrl}</b>Contrôle${ctrl > octrl ? ' · mène' : ''}</span>
        ${pid === BOT ? `<span class="count"><b>${p.hand.length}</b>Main</span>` : ''}</div>
      </div>`;
    const botHand = pid === BOT ? `<div class="mat-hand">${this.prefs.reveal && !this.online ? p.hand.map(x => this.cardHTML(x, { small: true })).join('') : p.hand.map(() => '<div class="card back small" aria-hidden="true"></div>').join('')}</div>` : '';
    const zones = [
      this.zone('night', flip, `<span class="night-die">${g.s.night || '–'}</span>`),
      this.zone('lieu', flip, `<div class="mat-lieu fam-${deckFamily(p.deck)} ${p.lieuUsedNight ? 'spent' : ''}"><b>${esc(lieu.name)}</b>${lieu.abilities.map((a, i) =>
        `<span class="${p.lieuUsed[i] ? 'used' : ''} ${pid === HUMAN && readyLieu.has(i) ? 'ready' : ''}" title="${esc(a.text)}"><i>${whenLabel[a.when]}</i>${esc(a.text)}</span>`).join('')}</div>`),
      this.zone('fighter', flip, fighter ? this.cardHTML(fighter) : '', fighter ? 'filled' : ''),
      this.zone('kicks', flip, `<div class="kicks" data-fx="fighter-${pid}">${(c?.sides[pid]?.kicks ?? []).map(k => this.cardHTML(k, { kick: true })).join('')}</div>`),
      this.zone('arena', flip, `<div class="row">${p.arena.filter(x => x.uid !== fighter?.uid).map(x => this.cardHTML(x)).join('')}</div>`),
      this.zone('supL', flip, sups[0] ? this.stackHTML(sups[0]) : ''),
      this.zone('supR', flip, `<div class="stack">${sups.slice(1).map(s => this.stackHTML(s)).join('')}</div>`),
      this.zone('groupe', flip, deck(p.groupe.length, 'Groupe')),
      this.zone('songe', flip, deck(p.songe.length, 'Songe')),
      this.zone('fosse', flip, `<button class="pile-btn" data-act="pile" data-pid="${pid}" data-zone="fosse" title="Voir la Fosse">${top ? this.cardHTML(top, { small: true }) : ''}<span class="pile-count">${p.fosse.length}</span></button>`),
      this.zone('exil', flip, `<button class="exil-btn" data-act="pile" data-pid="${pid}" data-zone="exil" title="Voir l'Exil">${p.exil.length}</button>`),
      this.zone('reserve', flip, `<div class="row">${p.reserve.map(x => this.cardHTML(x, { small: true, hint: g.aura(x) <= g.s.night && pid === HUMAN ? 'peut entrer' : null })).join('')}</div>`),
    ].join('');
    return `${pid === BOT ? head + botHand : ''}<div class="mat ${flip ? 'flip' : ''}"><div class="mat-bg" aria-hidden="true"></div>${zones}</div>${pid === HUMAN ? head : ''}`;
  }

  combatStripHTML() {
    const g = this.game, c = g.s.combat;
    if (!c) return `<div class="strip idle"><span class="strip-arena">L'Arène</span><span>${g.s.over ? 'Partie terminée' : g.s.night ? 'Pas de combat en cours' : 'Mise en place'}</span></div>`;
    const pw = pid => (c.final ? c.final[pid] : g.power(pid));
    const mine = pw(HUMAN), theirs = pw(BOT), total = Math.max(1, mine + theirs);
    const side = pid => {
      const sd = c.sides[pid], f = g.find(sd.fighter), combo = f && !f.hidden && g.def(f).combo;
      const lit = combo ? rankCoverage(combo.ranks, sd.kicks.map(k => k.rang).filter(Boolean)) : [];
      const pips = Array.from({ length: Math.max(sd.max, sd.turns) }, (_, i) => `<i class="${i < sd.turns ? 'used' : ''}"></i>`).join('');
      const comboChip = combo ? `<span class="combo ${sd.comboActive ? 'on' : sd.comboBlocked ? 'blocked' : ''}">Combo ${combo.ranks.map((r, i) => `<i class="${lit[i] ? 'lit' : ''}">${r}</i>`).join('')} +${sd.comboActive ? g.comboBonus(pid) : combo.bonus}</span>` : '<span class="combo none">Pas de Combo</span>';
      return `<div class="strip-side ${pid === HUMAN ? 'me' : 'bot'} ${c.winners?.includes(pid) ? 'winner' : ''}">
        <span class="who">${pid === HUMAN ? 'Vous' : esc(this.oppName)}</span><span class="pow" data-fx="pow-${pid}">${pw(pid)}</span>
        <span class="pips">${pips}</span>${comboChip}${sd.puissanceMod ? `<span class="mod">${sd.puissanceMod}</span>` : ''}</div>`;
    };
    return `<div class="strip live">
      ${side(BOT)}
      <div class="strip-mid"><span class="stage">${c.provoc ? "Provoc' · " : ''}${esc(c.stage)}</span><div class="tug"><span style="width:${(mine / total) * 100}%"></span></div><span class="strip-arena">L'Arène</span></div>
      ${side(HUMAN)}</div>`;
  }

  handHTML() {
    const g = this.game, hand = [...g.p(HUMAN).hand];
    hand.sort((a, b) => {
      const da = g.def(a), db = g.def(b);
      return (da.type > db.type ? 1 : da.type < db.type ? -1 : 0) || (RANK_ORDER[da.rang] ?? 9) - (RANK_ORDER[db.rang] ?? 9) || db.force - da.force;
    });
    const kickTurn = this.pending?.req.kind === 'kickTurn';
    const f = g.s.combat ? g.fighter(HUMAN) : null;
    const fkw = f ? g.keywords(f) : [];
    const html = hand.map(c => {
      const d = g.def(c);
      let hint = null, dim = false, warn = false;
      if (kickTurn) {
        if (d.type !== 'K') dim = true;
        else if (!this.online) {
          const v = this.advisor.kickValue(g, HUMAN, c);
          hint = `≈ ${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
        }
      }
      if (f && d.type === 'K' && d.abType === 'CAPACITÉ' && !d.kw.includes('BASE') && !d.kw.some(k => fkw.includes(k))) warn = true;
      return this.cardHTML(c, { hint, dim, warn, fresh: this.fresh.has(c.uid) });
    }).join('');
    return `<h3>Votre Main <small>${hand.length}/10</small>${kickTurn && !this.online ? '<span class="legend">≈ gain de marge estimé si vous posez ce Kick</span>' : ''}</h3><div class="row">${html || '<p class="empty">Main vide</p>'}</div>`;
  }

  /** Indication contextuelle sur une carte proposée (choix du combattant, de la cible…). */
  optionHint(req, o) {
    const g = this.game;
    if (!o.card) return null;
    if ((req.kind === 'bastonFighter' || req.kind === 'provocFighter') && !this.online) {
      const t = g.targetCandidates(HUMAN).sort((a, b) => g.aura(b) - g.aura(a))[0];
      return t ? `≈ ${this.advisor.estimatePower(g, HUMAN, o.card, t).toFixed(0)} Puissance` : null;
    }
    if (req.kind === 'bastonTarget' || req.kind === 'provocTarget') return `+${g.aura(o.card)} si victoire`;
    if (req.kind === 'enter') return `Aura ${g.aura(o.card)}`;
    // Mulligan : l'ordre de sélection est l'ordre de remise sous la pile (R69)
    if (req.kind === 'mulligan') { const i = [...(this.pending?.selected ?? [])].indexOf(o.id); return i >= 0 ? `n° ${i + 1}` : null; }
    return null;
  }

  promptHTML() {
    const g = this.game, p = this.pending;
    if (g.s.over) return `<div class="prompt-body"><p class="prompt-title">Partie terminée</p></div>`;
    if (!p && this.online) return `<div class="prompt-body waiting"><span class="dots"></span><p>${this.pvp.opp ? `Au tour de ${esc(this.oppName)}…` : `${esc(this.oppName)} a perdu la connexion : la partie reprend dès son retour.`}</p></div>`;
    if (!p) return `<div class="prompt-body waiting"><span class="dots"></span><p>${this.paused ? 'Bot en pause' : this.thinking === 'key' ? 'Le bot Expert explore des milliers de suites possibles (15 s max)…' : this.thinking === 'kick' ? 'Le bot Expert choisit son Kick (6 s max)…' : 'Le bot réfléchit…'}</p></div>`;
    const { req } = p;
    const multi = this.isMulti(req);
    const cardOpts = req.options.filter(o => isCardPick(o) && !o.action && o.lieuIndex == null);
    // Décision à propos d'une seule carte (dessus / dessous…) : on montre la carte, et les choix en boutons
    const about = !cardOpts.length ? [...new Set(req.options.filter(o => o.card && !o.action && !String(o.id).startsWith('act:')).map(o => o.card))] : [];
    const otherOpts = req.options.filter(o => !cardOpts.includes(o));
    const hints = [];
    if (req.kind === 'enter') {
      const sum = [...p.selected].reduce((a, id) => a + g.aura(req.options.find(o => o.id === id).card), 0);
      hints.push(`<p class="hint ${sum > g.s.night ? 'bad' : ''}">Aura sélectionnée : ${sum} / ${g.s.night}</p>`);
    }
    if (req.kind === 'crepuscule') hints.push(`<p class="hint">Budget d'Aura pour entrer dans l'Arène cette nuit : ${g.s.night}.</p>`);
    if (req.kind === 'mulligan') {
      const pile = req.ctx?.zone === 'groupe' ? 'le Groupe' : 'le Songe';
      hints.push(`<p class="hint">Touchez, dans l'ordre, les cartes à remettre sous ${pile} : la première touchée passe sous la pile en premier, la dernière se retrouve tout en bas. Validez ensuite (aucune = garder la main). Votre adversaire ne voit que leur nombre.</p>`);
    }
    if (req.kind === 'counter' && req.options[0].ev) hints.push(`<p class="hint">${this.online ? esc(this.oppName) : 'Le bot'} active « ${esc(req.options[0].ev.label)} ».</p>`);
    if (req.kind === 'kickTurn') hints.push('<p class="hint">Touchez un Kick de votre Main pour le poser.</p>');
    if (req.options.some(o => o.blocked)) hints.push('<p class="hint">Les actions marquées « impossible » restent possibles à la table : le coût est payé, l’effet est sans objet.</p>');
    if (this.advice) {
      const labels = req.options.filter(o => this.advice.has(String(o.id))).map(o => o.label);
      hints.push(`<p class="hint advice">Le bot jouerait : ${esc(labels.join(', ') || 'rien')}</p>`);
    }
    const onBoard = new Set([...document.querySelectorAll('.board [data-uid]')].map(el => +el.dataset.uid));
    const showList = multi || cardOpts.some(o => !onBoard.has(o.card.uid)) || cardOpts.length <= 6;
    const cardList = cardOpts.length && showList && req.kind !== 'kickTurn'
      ? `<div class="row opts">${cardOpts.map(o => this.cardHTML(o.card, { small: true, mirror: true, optId: o.id, hint: this.optionHint(req, o) })).join('')}</div>` : '';
    let key = 0;
    const isPass = isPassOpt;
    const buttons = otherOpts.map(o => {
      const k = isPass(o) ? '' : ++key <= 9 ? key : '';
      const cls = isPass(o) ? 'ghost' : o.action || String(o.id).startsWith('act:') ? 'action' : 'primary';
      return `<button class="btn ${cls} ${this.advice?.has(String(o.id)) ? 'advised' : ''}" ${o.blocked ? 'style="opacity:.62"' : ''} data-act="opt" data-id="${esc(o.id)}" ${k ? `data-key="${k}"` : ''} ${isPass(o) ? 'data-pass' : ''}>${k ? `<kbd>${k}</kbd>` : isPass(o) ? '<kbd>P</kbd>' : ''}${esc(o.label)}</button>`;
    }).join('');
    const confirm = multi ? `<button class="btn primary" data-act="confirm" ${p.selected.size < req.min || p.selected.size > req.max ? 'disabled' : ''}><kbd>↵</kbd>Valider (${p.selected.size})</button>${p.selected.size ? '<button class="btn ghost" data-act="clear">Tout désélectionner</button>' : ''}` : '';
    return `
      <div class="prompt-body">
        <div class="prompt-head"><p class="prompt-title">${esc(req.title)}</p>${this.online ? '' : '<button class="btn ghost small" data-act="advice" title="Raccourci : C">Conseil</button>'}</div>
        ${hints.join('')}
        ${cardList}
        ${about.length === 1 ? `<div class="about"><div class="about-card">${this.cardHTML(about[0])}</div><div class="buttons about-btns">${buttons}${confirm}</div></div>` : `<div class="buttons">${buttons}${confirm}</div>`}
      </div>`;
  }

  /** Pile de Soutiens identiques : la carte du dessus, avec le nombre de cartes empilées. */
  stackHTML(stack, small = false) {
    const top = stack[stack.length - 1];
    const n = stack.length;
    const under = stack.slice(0, -1).reverse().map(c => this.game.label(c)).join(', ');
    return `<div class="sup-pile ${n > 1 ? 'multi' : ''}" style="--n:${n}" title="${n > 1 ? esc(`Recouvert (face cachée) : ${under}. Si le Soutien du dessus est défaussé, le suivant redevient visible.`) : ''}">${this.cardHTML(top, { small })}${n > 1 ? `<span class="pile-n">×${n}</span>` : ''}</div>`;
  }

  /** Raison pour laquelle la capacité d'un Kick posé ne s'applique pas (ou null). */
  kickOff(c) {
    const g = this.game, d = CARDS[c.id];
    if (c.zone !== 'kicks' || d.type !== 'K' || !d.text) return null;
    if (c.countered) return 'Contré';
    if (c.silenced) return 'Neutralisé';
    if (!g.kickCondMet(c)) return 'Inactif';
    return null;
  }

  cardHTML(c, { small = false, kick = false, mirror = false, optId, hint = null, dim = false, warn = false, fresh = false } = {}) {
    // Carte adverse cachée (partie en ligne) : un dos, rien d'autre
    if (c.hidden) return `<div class="card back ${small ? 'small' : ''}" data-uid="${c.uid}" aria-label="Carte cachée"></div>`;
    const g = this.game, d = CARDS[c.id];
    const { choosable = new Set(), selected = new Set(), advised = new Set() } = this.ctx ?? {};
    const optKey = optId ?? this.pending?.req.options.find(o => isCardPick(o) && o.card.uid === c.uid)?.id;
    const isChoosable = choosable.has(c.uid);
    const isSel = optKey != null && selected.has(optKey);
    const isAdv = optKey != null && (advised.has(String(optKey)) || advised.has(`kick:${c.uid}`));
    const fam = family(d);
    const cls = ['card', `fam-${fam}`, `t-${d.type}`, small ? 'small' : '', isChoosable ? 'choosable' : '', isSel ? 'selected' : '',
      isAdv ? 'advised' : '', c.faceDown ? 'down' : '', dim ? 'dim' : '', fresh ? 'fresh' : ''];
    const art = !c.faceDown && this.artUrl(d);
    if (art) cls.push('art');
    const attr = (mirror ? `data-act="opt" data-id="${esc(optId)}" data-insp="${c.uid}"` : `data-uid="${c.uid}"`) + (art ? ` style="--art:url('${art}')"` : '');
    let badge = '';
    if (d.type === 'P') {
      const a = g.aura(c);
      badge = `<span class="badge aura ${a !== d.aura ? 'mod' : ''}" title="Aura">${a}</span><span class="type">Perso</span>`;
    } else if (d.type === 'K') {
      const live = kick && c.zone === 'kicks';
      const f = live ? g.kickForce(c) : d.force;
      const rang = live ? c.rang ?? '–' : d.rang;
      badge = `<span class="badge force ${live && f !== d.force ? 'mod' : ''}" title="Force">${f}</span><span class="rank" title="Rang">${rang}</span>`;
    } else badge = `<span class="badge sup" title="Soutien">S</span><span class="type">Soutien</span>`;
    // Mots-clés gagnés en jeu (Team, Larbin, capacités…) : d'une autre couleur, et toujours affichés
    const added = d.type === 'P' && c.owner != null ? g.keywords(c).filter(k => !d.kw.includes(k)) : [];
    const kws = [...added, ...d.kw.filter(k => k !== 'BASE')].slice(0, Math.max(3, added.length));
    const states = [];
    if (c.tmp?.inciblable) states.push('Inciblable');
    if (c.shielded) states.push('Inciblable');
    if (c.tmp?.protected) states.push('Protégé');
    if (c.tmp?.lockFaceDown) states.push('Bloqué');
    if (c.countered) states.push('Contré');
    if (c.cap != null) states.push('Max 3');
    const off = this.kickOff(c);
    if (off && !c.countered) states.push(off);
    if (off) cls.push('off');
    if (warn) states.push(`Requiert ${d.kw.filter(k => k !== 'BASE').map(k => k.toLowerCase()).join('/')}`);
    if (g.s.combat && g.isFighter(c)) states.push('Combattant');
    const markers = (c.markers ?? []).filter(m => m.v).map(m => `<span class="${m.v > 0 ? 'pos' : 'neg'}">${m.v > 0 ? '+' : ''}${m.v}</span>`).join('');
    return `
      <div class="${cls.join(' ')}" ${attr} tabindex="${isChoosable || mirror ? 0 : -1}" title="${esc(`${d.name}${d.sub ? ' — ' + d.sub : ''} (${numLabel(d.num)})\n${d.text}`)}">
        <div class="card-top">${badge}</div>
        <div class="card-name">${esc(d.name)}</div>
        ${!small ? `<div class="card-num">${numLabel(d.num)}</div>` : ''}
        ${d.sub ? `<div class="card-sub">${esc(d.sub)}</div>` : ''}
        ${!small && d.combo ? `<div class="card-combo">${d.combo.ranks.join(' ')} <b>+${d.combo.bonus}</b></div>` : ''}
        ${!small ? `<div class="card-kw">${kws.map(k => `<span class="${added.includes(k) ? 'kw-add' : ''}" title="${esc((added.includes(k) ? 'Mot-clé gagné en jeu. ' : '') + (KW_HELP[k] ?? ''))}">${esc(k.toLowerCase())}</span>`).join('')}</div>` : ''}
        ${added.length && (small || cls.includes('art')) ? `<div class="kw-add-strip">${added.map(k => `<span class="kw-add">${esc(k.toLowerCase())}</span>`).join('')}</div>` : ''}
        ${markers ? `<div class="markers">${markers}</div>` : ''}
        ${states.length || hint ? `<div class="card-foot">${states.length ? `<div class="card-state">${states.map(s => `<span>${esc(s)}</span>`).join('')}</div>` : ''}${hint ? `<div class="card-hint">${esc(hint)}</div>` : ''}</div>` : ''}
        ${fresh ? '<span class="new-dot" title="Piochée cette nuit"></span>' : ''}
        ${c.faceDown ? '<div class="down-label">Face cachée</div>' : ''}
      </div>`;
  }

  inspectorHTML() {
    const g = this.game, c = this.inspect;
    if (!c) return `<p class="insp-empty">Survolez ou touchez une carte pour l'afficher en grand.</p>`;
    if (c.hidden) return '<article class="bigcard down"><h3>Carte cachée</h3><p class="bc-sub">Vous ne pouvez pas voir cette carte.</p></article>';
    const d = CARDS[c.id];
    const type = { P: 'Perso', K: 'Kick', S: 'Soutien' }[d.type];
    const fam = family(d);
    const kws = d.type === 'P' && c.owner != null ? g.keywords(c) : d.kw;
    const big = d.type === 'P' ? `<span class="big-stat" title="Aura">${g.aura(c)}</span>` : d.type === 'K' ? `<span class="big-stat" title="Force">${c.zone === 'kicks' && g.s.combat ? g.kickForce(c) : d.force}</span><span class="big-rank">${c.zone === 'kicks' ? c.rang ?? '–' : d.rang}</span>` : '<span class="big-stat sup">S</span>';
    const zoneLabel = { groupe: 'Groupe', songe: 'Songe', hand: 'Main', reserve: 'Réserve', arena: 'Arène', supports: 'Soutiens', fosse: 'Fosse', exil: 'Exil', kicks: 'Combat' }[c.zone];
    const markers = (c.markers ?? []).map(m => `${m.v > 0 ? '+' : ''}${m.v} (${m.src === c.owner ? 'votre capacité' : 'capacité adverse'})`.replace('votre', c.owner === HUMAN ? 'votre' : 'sa'));
    const art = this.artUrl(d) && !c.faceDown ? this.artUrl(d) : null;
    // Classe (Seigneur, Créature…) et mots-clés (Glace, Base…) bien visibles, juste sous le nom
    const tags = [d.cls && `<span class="cls">${esc(d.cls.toLowerCase())}</span>`, ...kws.map(k => `<span class="${d.kw.includes(k) ? '' : 'kw-add'}" title="${esc((d.kw.includes(k) ? '' : 'Mot-clé gagné en jeu. ') + (KW_HELP[k] ?? ''))}">${esc(k.toLowerCase())}</span>`)].filter(Boolean).join('');
    return `
      <article class="bigcard fam-${fam} ${c.faceDown ? 'down' : ''} ${art ? 'has-art' : ''}">
        <div class="bc-top">
          ${art ? `<img class="bc-art" src="${art}" alt="${esc(d.name)}">` : ''}
          <div class="bc-id">
            <header><div class="bc-stats">${big}</div><div class="bc-type">${type}<small>${numLabel(d.num)}</small></div></header>
            <h3>${esc(d.name)}</h3>
            ${d.sub ? `<p class="bc-sub">${esc(d.sub)}</p>` : ''}
            ${tags ? `<p class="bc-kw">${tags}</p>` : ''}
            ${d.combo ? `<p class="bc-combo">Combo ${d.combo.ranks.map(r => `<i>${r}</i>`).join('')} <b>+${d.combo.bonus}</b></p>` : ''}
          </div>
        </div>
        <div class="bc-text ${this.kickOff(c) ? 'off' : ''}">${this.kickOff(c) ? `<p class="bc-off">${{ Contré: 'Capacité contrée', Neutralisé: 'Capacité neutralisée par une capacité adverse', Inactif: `Inactif : le combattant n'a pas le mot-clé requis (${d.kw.map(k => k.toLowerCase()).join(' / ')})` }[this.kickOff(c)]}</p>` : ''}<p class="bc-cond">${d.abType === 'DÉGÂT' ? 'Dégât' : 'Capacité'} · ${esc(d.cond)}</p><p>${esc(d.text)}</p></div>
        <footer>${c.owner === HUMAN ? 'À vous' : this.online ? `À ${esc(this.oppName)}` : 'Au bot'} · ${zoneLabel ?? ''}${c.faceDown ? ' · face cachée' : ''}${markers.length ? `<br>Marqueurs : ${markers.join(', ')}` : ''}</footer>
      </article>`;
  }

  renderLog() {
    const g = this.game;
    const cls = t => t.startsWith('── ') ? 'l-phase' : /^Combo/.test(t) ? 'k-combo' : /inflige le dégât/.test(t) ? 'k-dmg' : /Renommée/.test(t) ? 'k-fame' : /contre|contré/i.test(t) ? 'k-counter' : '';
    const fightRx = / affronte |Dénouement|pose |Combo|dégât|victoire|contre/;
    const lines = g.s.log.filter(l => this.logFilter === 'all' || l.text.startsWith('══') || l.text.startsWith('── ') || (this.logFilter === 'me' ? l.pid === HUMAN : fightRx.test(l.text))).slice(-200);
    const log = $('#log');
    log.innerHTML = lines.map(l => `<li class="${l.pid === HUMAN ? 'l-me' : l.pid === BOT ? 'l-bot' : 'l-sys'} ${l.text.startsWith('══') ? 'l-night' : cls(l.text)}">${esc(l.text.replace(/══/g, '').replace(/^── /, '').trim())}</li>`).join('');
    log.scrollTop = log.scrollHeight;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.f === this.logFilter));
  }

  renderModal() {
    const box = $('#modal');
    if (!box) return;
    const m = this.modal;
    if (!m) { box.innerHTML = ''; return; }
    let inner = '';
    if (m.type === 'rules') inner = `<h2>Règles express</h2><div class="rules">${RULES}</div>`;
    if (m.type === 'quit') inner = `<h2>Quitter la partie ?</h2><p>La partie en cours sera perdue.</p><div class="buttons"><button class="btn primary" data-act="menu-now">Quitter</button><button class="btn ghost" data-act="close">Continuer à jouer</button></div>`;
    if (m.type === 'forfeit' && this.online) inner = `<h2>Abandonner la partie ?</h2><p>Votre adversaire gagne immédiatement. Quitter la page sans abandonner ne suffit pas : votre pendule continue de tourner, et après 3 minutes de déconnexion vous perdez par forfait.</p><div class="buttons"><button class="btn primary" data-act="forfeit-now">Abandonner</button><button class="btn ghost" data-act="close">Continuer à jouer</button></div>`;
    else if (m.type === 'forfeit') inner = `<h2>Abandonner ?</h2><p>La partie s'arrête et compte comme une défaite.</p><div class="buttons"><button class="btn primary" data-act="forfeit-now">Abandonner</button><button class="btn ghost" data-act="close">Continuer à jouer</button></div>`;
    if (m.type === 'notice') inner = `<h2>${esc(m.title)}</h2><p>${esc(m.text)}</p><div class="buttons"><button class="btn primary" data-act="close">OK</button></div>`;
    if (m.type === 'delDeck') {
      const d = this.store.get(m.id);
      inner = `<h2>Supprimer « ${esc(d?.name)} » ?</h2><p>Ce deck sera effacé. Exportez-le d'abord si vous voulez le garder.</p><div class="buttons"><button class="btn primary danger-fill" data-act="del-now">Supprimer</button><button class="btn ghost" data-act="close">Annuler</button></div>`;
    }
    if (m.type === 'leaveBuilder') inner = `<h2>Quitter l'éditeur ?</h2><p>Ce deck a des modifications non enregistrées.</p><div class="buttons"><button class="btn primary" data-act="bd-save-leave">Enregistrer et quitter</button><button class="btn ghost danger" data-act="bd-leave">Quitter sans enregistrer</button><button class="btn ghost" data-act="close">Rester</button></div>`;
    if (m.type === 'paste') inner = `<h2>Coller une liste</h2>
      <p class="hint">Format des outils de deck (« 4 012/FDS   # BOULE DE FEU »), ou une carte par ligne avec son nom (« 4 Boule de Feu », « Boule de Feu x4 »). Plusieurs decks se séparent par « # Nom du deck ». Le JSON est accepté aussi.</p>
      <textarea id="paste-text" rows="12" placeholder="# Feu&#10;&#10;# Lieu&#10;1 197/FDS   # DÉLIRIUM CITY&#10;&#10;# Groupe (Persos)&#10;1 001/FDS   # NEIL&#10;&#10;# Songe (Kicks/Soutiens)&#10;4 012/FDS   # BOULE DE FEU"></textarea>
      <div class="buttons"><button class="btn primary" data-act="paste-import">Importer</button><button class="btn ghost" data-act="close">Annuler</button></div>`;
    if (m.type === 'imported') {
      const ok = m.saved.length;
      inner = `<h2>${ok ? `${ok} deck${ok > 1 ? 's' : ''} importé${ok > 1 ? 's' : ''}` : 'Aucun deck importé'}</h2>
        ${m.saved.length ? `<ul class="imp-list">${m.saved.map(d => { const v = validateDeck(d); return `<li><b>${esc(d.name)}</b> — ${v.ok ? 'prêt à jouer' : `à compléter : ${esc(v.errors[0])}`}</li>`; }).join('')}</ul>` : ''}
        ${m.errors.length ? `<h3>Lignes ignorées</h3><ul class="imp-errors">${m.errors.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${m.warnings.length ? `<ul class="imp-list">${m.warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <div class="buttons"><button class="btn primary" data-act="close">OK</button></div>`;
    }
    if (m.type === 'export') {
      const n = m.ids.length;
      inner = `<h2>Exporter ${n > 1 ? `${n} decks` : `« ${esc(this.store.get(m.ids[0])?.name)} »`}</h2>
        <p class="hint">Même format que les outils de deck Dreamland : ce texte se réimporte ici ou se colle ailleurs.</p>
        <textarea id="export-text" rows="14" readonly>${esc(this.exportText(m.ids))}</textarea>
        ${m.note ? `<p class="hint good">${esc(m.note)}</p>` : ''}
        <div class="buttons"><button class="btn primary" data-act="copy-export">Copier</button>${this.downloads ? '<button class="btn" data-act="dl-export">Télécharger (.txt)</button>' : ''}<button class="btn ghost" data-act="close">Fermer</button></div>`;
    }
    if (m.type === 'report') {
      inner = `<h2>Rapport de diagnostic</h2>
        <p class="hint">Partie rejouable (decks, graine, réponses) + décisions du bot et états aux combats. À coller dans la conversation si le bot joue mal.</p>
        <textarea id="export-text" rows="14" readonly>${esc(JSON.stringify(this.game.report()))}</textarea>
        ${m.note ? `<p class="hint good">${esc(m.note)}</p>` : ''}
        <div class="buttons"><button class="btn primary" data-act="copy-export">Copier</button>${this.downloads ? '<button class="btn" data-act="dl-report">Télécharger (.json)</button>' : ''}<button class="btn ghost" data-act="close">Fermer</button></div>`;
    }
    if (m.type === 'pile') {
      const p = this.game.p(m.pid);
      const cards = [...p[m.zone]].reverse();
      inner = `<h2>${m.zone === 'fosse' ? 'Fosse' : 'Exil'} — ${esc(p.name)} <small>${cards.length}</small></h2><div class="row">${cards.map(c => this.cardHTML(c, { small: true })).join('') || '<p class="empty">Vide</p>'}</div>`;
    }
    box.innerHTML = `<div class="modal" data-act-bg><div class="modal-card" role="dialog" aria-modal="true">${inner}<button class="close" data-act="close" aria-label="Fermer">×</button></div></div>`;
    box.querySelector('.modal').addEventListener('click', e => { if (e.target.classList.contains('modal')) this.closeModal(); });
  }

  // ── Jeu entre joueurs ─────────────────────────────────────
  pvpHTML(valid) {
    const v = this.pvp;
    if (!v.available) return '';
    const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (!valid.some(d => d.id === this.prefs.pvpDeck)) this.prefs.pvpDeck = valid[0]?.id ?? null;
    const msg = v.msg ? `<p class="hint ${v.msg.ok ? 'good' : 'bad'}">${esc(v.msg.ok ?? v.msg.error)}</p>` : '';
    const legal = '<p class="store-note"><a href="/compte">Mon compte</a> · <a href="/conditions">Conditions d\'utilisation</a> · <a href="/confidentialite">Confidentialité</a> · <a href="/contact">Contact</a></p>';
    let body;
    if (!v.user) {
      body = `
        <p>Affrontez d'autres joueurs : partagez un lien d'invitation, votre adversaire le rejoint. Il faut un compte Discord (seuls votre identifiant, votre pseudo et votre avatar sont utilisés).</p>
        ${v.invite ? '<p class="hint good">Vous avez reçu une invitation : connectez-vous pour la rejoindre.</p>' : ''}
        <div class="match-go">${v.discord ? '<button class="btn primary big" data-act="pvp-login">Se connecter avec Discord</button>' : '<p class="hint">Connexion Discord indisponible pour le moment.</p>'}</div>
        ${v.devLogin ? '<div class="opts"><label>Connexion factice (développement) <input id="pvp-dev-name" maxlength="24" placeholder="Pseudo"></label><button class="btn" data-act="pvp-dev-login">Se connecter</button></div>' : ''}`;
    } else if (v.room) {
      const left = Math.max(0, v.room.expiresAt - Date.now());
      body = `
        <p>Salon ${v.room.mode === 'open' ? '<b>deck ouvert</b>' : '<b>casu</b>'} créé. Envoyez ce lien à votre adversaire : il ne sert qu'une fois et expire dans ${Math.ceil(left / 60000)} min.</p>
        <div class="pvp-invite"><input readonly value="${esc(this.inviteUrl())}" onclick="this.select()"><button class="btn primary" data-act="pvp-copy">Copier le lien</button></div>
        <div class="match-go"><span class="dots"></span> En attente de l'adversaire… <button class="btn ghost" data-act="pvp-cancel">Annuler le salon</button></div>`;
    } else {
      body = `
        <p class="store-note">Connecté : <b>${esc(v.user.name)}</b></p>
        <div class="opts">
          <label>Votre deck ${valid.length ? sel('pvpDeck', valid.map(d => [d.id, d.name]), this.prefs.pvpDeck) : '<span class="muted">aucun deck prêt</span>'}</label>
          ${v.invite ? '' : `<label>Format ${sel('pvpMode', [['casu', 'Casu'], ['open', 'Casu, deck ouvert (chacun voit la decklist adverse, jamais l\'ordre)']], this.prefs.pvpMode ?? 'casu')}</label>`}
        </div>
        <div class="match-go">
          ${v.invite ? `<p class="hint good">Vous êtes invité à une partie.</p><button class="btn primary big" data-act="pvp-join" ${valid.length ? '' : 'disabled'}>Rejoindre la partie</button><button class="btn ghost" data-act="pvp-forget-invite">Ignorer l'invitation</button>`
            : `<button class="btn primary big" data-act="pvp-create" ${valid.length ? '' : 'disabled'}>Créer un salon</button>`}
        </div>`;
    }
    return `<div class="match pvp"><h2>Jouer contre un joueur</h2>${msg}${body}${legal}</div>`;
  }

  inviteUrl() { return this.pvp.room ? `${location.origin}${location.pathname}?invite=${encodeURIComponent(this.pvp.room.invite)}` : ''; }
  saveInviteForLogin() { if (this.pvp.invite) sessionStorage.setItem('dojo-pvp-invite', this.pvp.invite); }

  netConnect() {
    this.net ??= new NetClient({
      onMessage: m => this.onNet(m),
      onStatus: (st, code) => {
        if (st === 'closed' && code === 4000) this.pvpNotice('Partie ouverte sur un autre appareil ou onglet.');
        if (st === 'closed' && code === 4001) { this.pvp.user = null; this.pvpNotice('Votre session a été fermée. Reconnectez-vous.'); }
      },
    });
    this.net.connect();
  }

  pvpNotice(text, error = true) {
    this.pvp.msg = error ? { error: text } : { ok: text };
    if (this.screen === 'setup') this.renderSetup();
    else this.toast(text);
  }

  /** Deck choisi, au format attendu par le serveur (revérifié là-bas). */
  pvpDeck() {
    const d = this.store.get(this.prefs.pvpDeck);
    if (!d || !validateDeck(d).ok) { this.pvpNotice('Choisissez un deck prêt à jouer.'); return null; }
    try { localStorage.setItem('dojo-pvp-deck', d.id); } catch { /* stockage indisponible */ }
    return { name: d.name, lieu: d.lieu, groupe: [...d.groupe], songe: [...d.songe] };
  }

  clientSeed() { return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); }

  pvpCreate() {
    const deck = this.pvpDeck();
    if (deck) { this.pvp.msg = null; this.net?.send({ type: 'create', deck, mode: this.prefs.pvpMode ?? 'casu', seed: this.clientSeed() }); }
  }

  pvpJoin() {
    const deck = this.pvpDeck();
    if (deck) { this.pvp.msg = null; this.net?.send({ type: 'join', invite: this.pvp.invite, deck, seed: this.clientSeed() }); }
  }

  onNet(m) {
    const v = this.pvp, g = this.online ? this.game : null;
    switch (m.type) {
      case 'hello': v.user = { ...v.user, ...m.user }; break;
      case 'created': case 'waiting': v.room = { invite: m.invite, mode: m.mode, expiresAt: m.expiresAt }; v.msg = null; if (this.screen === 'setup') this.renderSetup(); break;
      case 'cancelled': v.room = null; this.pvpNotice('Salon annulé.', false); break;
      case 'joined': v.invite = null; break;
      case 'start': this.startOnline(m); break;
      case 'state': if (g) { g.load(m.view); this.scheduleRender(); } break;
      case 'ask': if (g) this.onlineAsk(m); break;
      case 'clock': v.clock = { ...m, at: Date.now() }; this.tickClock(); break;
      case 'opponent': v.opp = m.connected; if (g) { this.toast(m.connected ? `${this.oppName} est de retour` : `${this.oppName} a perdu la connexion`, BOT); this.render(); } break;
      case 'event': if (g) this.onlineEvent(m.name, m.data); break;
      case 'over': this.onlineOver(m); break;
      case 'replaced': break;
      case 'error':
        if (m.seq != null && this.lastAsk?.seq === m.seq && g) { this.onlineAsk(this.lastAsk.raw); this.toast('Réponse refusée par le serveur : choisissez de nouveau.'); break; }
        if (m.error === 'invite-invalid') v.invite = null;
        if (m.error === 'invite-expired') v.room = null;
        if (m.error !== 'not-playing') this.pvpNotice(PVP_ERRORS[m.error] ? `${PVP_ERRORS[m.error]}${m.detail ? ` ${m.detail}` : ''}` : `Erreur : ${m.error}`);
        break;
    }
  }

  startOnline(m) {
    const v = this.pvp;
    v.room = null; v.invite = null; v.msg = null; v.opp = true;
    let myDeck = null;
    try { myDeck = this.store.get(localStorage.getItem('dojo-pvp-deck')); } catch { /* stockage indisponible */ }
    const game = new RemoteView({ names: m.names, you: m.you, mode: m.mode, myDeck: myDeck ? { name: myDeck.name, groupe: [...myDeck.groupe] } : { name: 'Votre deck', groupe: [] } });
    this.screen = 'game';
    this.pool?.reset();
    this.thinking = null;
    Object.assign(this, {
      game, pending: null, inspect: null, paused: false, modal: null, fxQueue: [], advice: null, lastAsk: null,
      prev: { scores: [0, 0], power: {}, kicks: new Set(), hand: new Set(), down: new Set(), phase: '' },
      fresh: new Set(),
      stats: { combats: 0, won: [0, 0], combos: [0, 0], dmg: [0, 0], counters: [0, 0] },
    });
    this.sound.ensure();
    this.renderModal();
    $('#app').innerHTML = this.shell();
    if (m.resumed) this.toast('Partie reprise');
  }

  onlineAsk(m) {
    const g = this.game;
    this.lastAsk = { seq: m.seq, raw: m };
    const req = g.request(m);
    this.pending = { req, selected: new Set(), resolve: ans => this.net.send({ type: 'answer', seq: m.seq, answer: ans }) };
    this.advice = null;
    if (req.kind === 'kickTurn' || req.kind === 'crepuscule' || req.kind === 'bastonFighter') this.sound.play('turn');
    this.render();
  }

  /** Événement du serveur : numéros de joueurs ramenés au point de vue local, puis effets habituels. */
  onlineEvent(name, d) {
    const P = x => this.game.P(x);
    const data = { ...d };
    if ('pid' in data) data.pid = P(data.pid);
    if ('w' in data) data.w = P(data.w);
    if ('att' in data) data.att = P(data.att); // pa / pb : Puissances de l'attaquant et du défenseur, inchangées
    if (Array.isArray(data.winners)) data.winners = data.winners.map(P);
    this.onGameEvent(name, data);
  }

  async onlineOver(m) {
    const g = this.online ? this.game : null;
    this.pvp.clock = null;
    if (!g) { this.pvpNotice(m.aborted ? `Votre dernière partie a été annulée (${m.aborted}).` : 'Votre dernière partie est terminée.', false); return; }
    const P = x => g.P(x);
    const scores = m.result ? (g.you === 0 ? m.result.scores : [...m.result.scores].reverse()) : [g.p(HUMAN).renommee, g.p(BOT).renommee];
    g.s.over = true;
    g.s.combat = null;
    g.s.result = { winner: m.result ? P(m.result.winner) : m.winner != null ? P(m.winner) : null, scores, reason: m.reason ?? null, aborted: m.aborted ?? null, fair: null };
    this.pending = null;
    // Mélange vérifiable : SHA-256(graine serveur) doit être l'engagement publié au début
    try {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m.serverSeed)));
      g.s.result.fair = [...d].map(b => b.toString(16).padStart(2, '0')).join('') === m.commit;
    } catch { /* crypto.subtle indisponible (page non sécurisée) */ }
    document.querySelector('.end')?.remove();
    this.render();
  }

  /** Quitter le plateau d'une partie en ligne terminée (ou abandonnée). */
  leaveOnline() {
    this.game = null; this.pending = null; this.lastAsk = null;
    document.querySelector('.end')?.remove();
    this.closeModal();
    this.renderSetup();
  }

  clockHTML() {
    const c = this.pvp.clock;
    if (!c) return '';
    const t = c.remaining.map((x, pid) => (c.running === pid ? x - (Date.now() - c.at) : x));
    const me = this.game.you, mine = t[me], theirs = t[1 - me];
    const run = pid => (c.running === pid ? ' run' : '');
    return `<span class="clk me${run(me)} ${mine < 60000 ? 'low' : ''}" title="Votre temps de réflexion">⏱ ${fmtClock(mine)}</span><span class="clk${run(1 - me)}" title="Temps de ${esc(this.oppName)}">${fmtClock(theirs)}</span>`;
  }

  tickClock() {
    if (this.online && !this.game.s.over) { const el = $('#pvp-clock'); if (el) el.innerHTML = this.clockHTML(); }
    if (this.screen === 'setup' && this.pvp?.room) {
      const el = document.querySelector('.pvp .match-go');
      if (el && this.pvp.room.expiresAt < Date.now()) { this.pvp.room = null; this.renderSetup(); }
    }
  }

  renderEnd() {
    if (document.querySelector('.end')) return;
    const g = this.game, r = g.s.result, s = this.stats;
    if (!r) return;
    const why = { time: ' au temps', abandon: ' par abandon', disconnect: ' par forfait' }[r.reason] ?? '';
    const msg = r.aborted ? 'Partie annulée' : this.online && r.reason ? (r.winner === HUMAN ? `Victoire${why}` : `Défaite${why}`)
      : r.forfeit ? 'Abandon' : r.winner === HUMAN ? 'Victoire' : r.winner === BOT ? 'Défaite' : 'Match nul';
    const hist = [[0, 0], ...g.s.history];
    const max = Math.max(1, ...hist.flat());
    const pts = pid => hist.map(([a, b], i) => `${(i / (hist.length - 1)) * 260 + 20},${110 - ((pid ? b : a) / max) * 90}`).join(' ');
    const el = document.createElement('div');
    el.className = 'end';
    el.innerHTML = `
      <div class="end-card">
        <p class="eyebrow">${r.aborted ? esc(r.aborted) : r.forfeit || r.reason ? `Nuit ${g.s.night}` : 'Fin de la sixième nuit'} · ${this.online ? `contre ${esc(this.oppName)}` : `vs ${esc(g.p(BOT).deck.name)}`}</p>
        <h2>${msg}</h2>
        <p class="end-score"><span>Vous ${r.scores[0]}</span><span>${r.scores[1]} ${esc(this.oppName)}</span></p>
        ${this.online && r.fair != null ? `<p class="hint ${r.fair ? 'good' : 'bad'}">${r.fair ? '✔ Mélange vérifié : la graine révélée correspond à l\'engagement publié avant la partie.' : '✘ La graine révélée ne correspond pas à l\'engagement.'}</p>` : ''}
        <svg class="spark" viewBox="0 0 300 130" role="img" aria-label="Renommée par nuit">
          ${hist.map((_, i) => `<text x="${(i / (hist.length - 1)) * 260 + 20}" y="126" text-anchor="middle">${i || ''}</text>`).join('')}
          <polyline points="${pts(1)}" class="l-bot"/><polyline points="${pts(0)}" class="l-me"/>
        </svg>
        <dl class="end-stats">
          <div><dt>Combats gagnés</dt><dd>${s.won[0]} / ${s.combats}</dd></div>
          <div><dt>Combos</dt><dd>${s.combos[0]} — ${s.combos[1]}</dd></div>
          <div><dt>Dégâts infligés</dt><dd>${s.dmg[0]} — ${s.dmg[1]}</dd></div>
          <div><dt>Contres</dt><dd>${s.counters[0]} — ${s.counters[1]}</dd></div>
        </dl>
        <div class="buttons">${this.online ? '<button class="btn primary" data-act="menu-now">Retour à l\'accueil</button>' : '<button class="btn primary" data-act="rematch">Rejouer</button><button class="btn ghost" data-act="menu-now">Changer de decks</button>'}</div>
      </div>`;
    document.querySelector('.game').appendChild(el);
    if (r.winner === HUMAN) { this.particles.confetti(['#ffb44c', FAM_COLOR[deckFamily(g.p(HUMAN).deck)], '#fff', '#c08bff']); this.sound.play('combo'); }
  }
}

const ui = new UI();
document.addEventListener('change', e => {
  if (e.target.id === 'speed-live') { ui.prefs.speed = e.target.value; ui.savePrefs(); if (ui.bot) ui.bot.delay = SPEEDS[ui.prefs.speed]; }
});
window.__dojo = ui; // accès pour les tests automatisés