// Illustrations des cartes fournies par le joueur, gardées dans ce navigateur (IndexedDB).
// Le fichier est reconnu par le numéro de la carte dans son nom : « 081.png », « FDS1-081.jpg », « 081_FDS_kain.webp »…
import { BY_NUM, CARDS, LIEUX } from './data.js';

const DB_NAME = 'dojo-art', STORE = 'art', MAX_H = 700;

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const UNIQUE_NAMES = (() => {
  const count = new Map();
  for (const d of [...Object.values(CARDS), ...Object.values(LIEUX)]) count.set(norm(d.name), [...(count.get(norm(d.name)) ?? []), d.num]);
  return new Map([...count].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
})();

/** Numéro de carte déduit d'un nom de fichier, ou null. */
export function numFromName(file) {
  const base = file.replace(/\.[^.]+$/, '');
  const near = base.match(/(?<!\d)(\d{1,3})\s*[-_ ]?\s*FDS/i) ?? base.match(/FDS\s*\d?\s*[-_ ]\s*(\d{1,3})(?!\d)/i);
  if (near && BY_NUM[+near[1]]) return +near[1];
  const nums = [...base.matchAll(/(?<!\d)(\d{1,3})(?!\d)/g)].map(m => m[1]);
  const pick = nums.find(n => n.length === 3 && BY_NUM[+n]) ?? (nums.length === 1 && BY_NUM[+nums[0]] ? nums[0] : null);
  if (pick) return +pick;
  return UNIQUE_NAMES.get(norm(base.replace(/\d+/g, ' '))) ?? null;
}

/** data: URI → Blob sans fetch (le CSP de l'artefact peut refuser fetch sur data:). */
function dataUriToBlob(uri) {
  const [head, b64] = uri.split(',');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: head.slice(5).split(';')[0] });
}

function openDb() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
const tx = (db, mode, fn) => new Promise((ok, ko) => {
  const t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
  t.oncomplete = () => ok(out?.result ?? out);
  t.onerror = () => ko(t.error);
});

/** Réduit l'image (les scans font souvent plusieurs Mo) pour garder l'affichage fluide. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.height <= MAX_H) return file;
    const k = MAX_H / bmp.height, cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = MAX_H;
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(ok => cv.toBlob(b => ok(b ?? file), 'image/webp', 0.88));
  } catch { return file; }
}

export class ArtStore {
  constructor(onChange) {
    this.urls = new Map();
    this.onChange = onChange;
    this.ready = this.load();
  }
  get count() { return this.urls.size; }
  url(num) { return this.urls.get(num) ?? null; }

  async load() {
    try {
      const db = await openDb();
      const rows = await tx(db, 'readonly', st => {
        const acc = [];
        st.openCursor().onsuccess = e => { const c = e.target.result; if (c) { acc.push([c.key, c.value]); c.continue(); } };
        return acc;
      });
      for (const [num, blob] of rows) this.urls.set(num, URL.createObjectURL(blob));
      if (rows.length) this.onChange?.();
    } catch { /* stockage indisponible : on garde l'affichage texte */ }
  }

  /** Importe des images ; renvoie { added, ignored: [noms de fichiers non reconnus] }. */
  async importFiles(files) {
    const ignored = [], items = [];
    for (const f of files) {
      // Pack d'illustrations : { format: 'dojo-art', cards: { '081': 'data:image/…' } }
      if (/\.json$/i.test(f.name)) {
        try {
          const pack = JSON.parse(await f.text());
          for (const [n, uri] of Object.entries(pack.cards ?? {}))
            if (BY_NUM[+n] && /^data:image\//.test(uri)) items.push([+n, dataUriToBlob(uri)]);
        } catch { ignored.push(f.name); }
        continue;
      }
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|webp|gif|avif)$/i.test(f.name)) continue;
      const num = numFromName(f.name);
      if (num == null) { ignored.push(f.name); continue; }
      items.push([num, await shrink(f)]);
    }
    try {
      const db = await openDb();
      await tx(db, 'readwrite', st => { for (const [num, blob] of items) st.put(blob, num); });
    } catch { /* on les garde au moins pour cette session */ }
    for (const [num, blob] of items) {
      if (this.urls.has(num)) URL.revokeObjectURL(this.urls.get(num));
      this.urls.set(num, URL.createObjectURL(blob));
    }
    this.onChange?.();
    return { added: items.length, ignored };
  }

  async clear() {
    try { const db = await openDb(); await tx(db, 'readwrite', st => st.clear()); } catch { /* rien à effacer */ }
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.onChange?.();
  }
}
