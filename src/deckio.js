// ─────────────────────────────────────────────────────────────
// Import / export de decks.
// Formats acceptés à l'import :
//  • texte, une carte par ligne : « 4 Boule de Feu (012/FDS) », « Boule de Feu x4 », « 012/FDS ; 4 »…
//    avec sections facultatives (LIEU, GROUPE, SONGE) et plusieurs decks séparés par « # Nom » ;
//  • JSON : { name, lieu, groupe, songe } ou une liste de decks, avec ids, numéros ou noms de cartes.
// ─────────────────────────────────────────────────────────────
import { CARDS, LIEUX, BY_NUM } from './data.js';

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’`´]/g, "'").replace(/[^a-z0-9&' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Index des noms : « neil », « neil epee diderot », « epee diderot »…
const BY_NAME = new Map();
const index = (key, d) => { if (!key) return; const k = norm(key); (BY_NAME.get(k) ?? BY_NAME.set(k, []).get(k)).push(d); };
for (const d of [...Object.values(CARDS), ...Object.values(LIEUX)]) {
  index(d.name, d);
  if (d.sub) { index(`${d.name} ${d.sub}`, d); index(d.sub, d); }
  index(d.id, d);
}

export const newDeckId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Retrouve une carte à partir d'un id, d'un numéro de set ou d'un nom. */
export function resolveCard(ref) {
  if (ref == null) return { error: 'Référence vide.' };
  if (typeof ref === 'number') return BY_NUM[ref] ? { def: BY_NUM[ref] } : { error: `Numéro inconnu : ${ref}.` };
  const s = String(ref).trim();
  if (CARDS[s]) return { def: CARDS[s] };
  if (LIEUX[s]) return { def: LIEUX[s] };
  const num = s.match(/(\d{1,3})\s*\/\s*FDS/i) ?? s.match(/^(\d{1,3})$/);
  if (num) return BY_NUM[+num[1]] ? { def: BY_NUM[+num[1]] } : { error: `Numéro inconnu : ${num[1]}/FDS.` };
  const key = norm(s.replace(/[—–-]/g, ' ').replace(/[()]/g, ' '));
  let hits = BY_NAME.get(key);
  if (!hits) {
    const near = [...BY_NAME.entries()].filter(([k]) => k.startsWith(key) || key.startsWith(k + ' '));
    hits = [...new Set(near.flatMap(([, v]) => v))];
    if (hits.length > 1) {
      // « Neil Épée Diderot » mal orthographié : on garde la correspondance la plus longue
      const best = near.sort((a, b) => b[0].length - a[0].length)[0];
      if (best && key.startsWith(best[0])) hits = best[1];
    }
  }
  hits = [...new Set(hits ?? [])];
  if (hits.length === 1) return { def: hits[0] };
  if (hits.length > 1) return { error: `« ${s} » est ambigu : précisez la version (${hits.map(d => d.sub ?? d.name).join(', ')}).` };
  return { error: `Carte inconnue : « ${s} ».` };
}

/** Ajoute `qty` exemplaires d'une carte au deck, au bon endroit. */
function place(deck, def, qty, issues, ctx) {
  if (def.type === 'L') {
    if (deck.lieu && deck.lieu !== def.id) issues.warnings.push(`${ctx} : plusieurs Lieux, « ${LIEUX[deck.lieu].name} » est conservé.`);
    else deck.lieu = def.id;
    return;
  }
  const zone = def.type === 'P' ? deck.groupe : deck.songe;
  for (let i = 0; i < qty; i++) zone.push(def.id);
}

// « LIEU », « # Lieu », « # Groupe (Persos) », « SONGE (30) »… : sections, pas des noms de deck
const SECTION = /^\s*#*\s*(lieu|lieux|groupe|songe|persos?|kicks?|soutiens?|main|cartes?)\s*(\([^)]*\))?\s*:?\s*$/i;
const HEADER = /^\s*(#+|={2,}|deck\s*:|nom\s*:|name\s*:)\s*(.*?)\s*=*\s*$/i;

function parseText(text, fallbackName) {
  const decks = [], issues = { errors: [], warnings: [] };
  let cur = null;
  const start = name => { cur = { name: name || `${fallbackName}${decks.length ? ' ' + (decks.length + 1) : ''}`, lieu: null, groupe: [], songe: [] }; decks.push(cur); };
  text.split(/\r?\n/).forEach((raw, i) => {
    // Commentaires en fin de ligne (« 1 197/FDS   # DÉLIRIUM CITY ») : ignorés, le numéro suffit
    let line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) return;
    if (SECTION.test(line)) { if (!cur) start(); return; }
    const h = line.match(HEADER);
    if (h && !/\d{1,3}\s*\/\s*fds/i.test(line)) { start(h[2]); return; }
    if (/\d{1,3}\s*\/\s*fds/i.test(line)) line = line.replace(/\s+#.*$/, '');
    if (!cur) start();
    let rest = line.replace(/[;\t|]+/g, ' ');
    let qty = 1;
    // « (081/FDS 1) » ou « <081/FDS 1> » : le chiffre après FDS est l'édition ; sans crochets, « 081/FDS » seul
    const boxed = /[(<[]\s*(\d{1,3})\s*\/\s*FDS(?:\s+\d)?\s*[)>\]]/i;
    const bare = /(\d{1,3})\s*\/\s*FDS/i;
    const num = rest.match(boxed) ?? rest.match(bare);
    rest = rest.replace(rest.match(boxed) ? boxed : bare, ' ');
    let m;
    if ((m = rest.match(/^\s*(\d+)\s*[x×]?\s+(.*)$/i))) { qty = +m[1]; rest = m[2]; }
    else if ((m = rest.match(/^(.*?)\s+[x×]?\s*(\d+)\s*$/i))) { qty = +m[2]; rest = m[1]; }
    else if ((m = rest.match(/^\s*[x×]\s*(\d+)\s+(.*)$/i))) { qty = +m[1]; rest = m[2]; }
    rest = rest.replace(/^[\s\-–—•*]+|[\s\-–—•*]+$/g, '');
    const r = num ? resolveCard(`${num[1]}/FDS`) : resolveCard(rest);
    if (r.error) { issues.errors.push(`Ligne ${i + 1} : ${r.error}`); return; }
    if (qty < 1 || qty > 60) { issues.errors.push(`Ligne ${i + 1} : quantité ${qty} invalide.`); return; }
    place(cur, r.def, qty, issues, cur.name);
  });
  return { decks: decks.filter(d => d.lieu || d.groupe.length || d.songe.length), ...issues };
}

function parseJson(data, fallbackName) {
  const list = Array.isArray(data) ? data : Array.isArray(data.decks) ? data.decks : [data];
  const decks = [], issues = { errors: [], warnings: [] };
  list.forEach((src, n) => {
    if (!src || typeof src !== 'object') return;
    const deck = { name: String(src.name ?? src.nom ?? `${fallbackName}${list.length > 1 ? ' ' + (n + 1) : ''}`), lieu: null, groupe: [], songe: [] };
    const add = (ref, qty = 1) => {
      if (ref && typeof ref === 'object') { qty = ref.qty ?? ref.count ?? ref.quantite ?? ref.quantity ?? 1; ref = ref.id ?? ref.num ?? ref.number ?? ref.setNumber ?? ref.name ?? ref.nom; }
      const r = resolveCard(ref);
      if (r.error) issues.errors.push(`${deck.name} : ${r.error}`);
      else place(deck, r.def, +qty || 1, issues, deck.name);
    };
    if (src.lieu ?? src.location) add(src.lieu ?? src.location);
    for (const key of ['groupe', 'songe', 'cards', 'cartes', 'persos', 'kicks', 'soutiens']) {
      const v = src[key];
      if (Array.isArray(v)) v.forEach(x => add(x));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([ref, qty]) => add(ref, qty));
    }
    decks.push(deck);
  });
  return { decks, ...issues };
}

/** Analyse le contenu d'un fichier ou d'un texte collé. */
export function parseDecks(text, fallbackName = 'Deck importé') {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  if (!t) return { decks: [], errors: ['Le contenu est vide.'], warnings: [] };
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return parseJson(JSON.parse(t), fallbackName); }
    catch { /* pas du JSON valide : on tente le texte */ }
  }
  return parseText(t, fallbackName);
}

/** Texte d'export, au format des outils de deck Dreamland (« 4 012/FDS   # BOULE DE FEU »), relisible par l'import. */
export function formatDeck(deck) {
  const counts = arr => Object.entries(arr.reduce((m, id) => ((m[id] = (m[id] || 0) + 1), m), {}))
    .sort((a, b) => CARDS[a[0]].num - CARDS[b[0]].num);
  const code = n => `${String(n).padStart(3, '0')}/FDS`;
  const line = (n, d) => `${n} ${code(d.num)}   # ${d.name.toUpperCase()}`;
  const out = [`# ${deck.name}`, ''];
  if (deck.lieu) out.push('# Lieu', line(1, LIEUX[deck.lieu]), '');
  out.push('# Groupe (Persos)', ...counts(deck.groupe).map(([id, n]) => line(n, CARDS[id])), '');
  out.push('# Songe (Kicks/Soutiens)', ...counts(deck.songe).map(([id, n]) => line(n, CARDS[id])));
  return out.join('\n');
}

export const formatDecks = decks => decks.map(formatDeck).join('\n\n');
