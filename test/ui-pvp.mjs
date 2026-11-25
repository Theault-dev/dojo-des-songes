// node test/ui-pvp.mjs  (rebâtir le site avant : node build.mjs)
// Deux joueurs chargent le vrai site (dist/index.html) dans jsdom et jouent une partie complète.
import { JSDOM, CookieJar, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { startServer } = await import(`${P}/server/index.mjs`);
const { J1, randomDeck } = await import(`${P}/test/decks.mjs`);

const srv = await startServer({ port: 0, dev: true, dbPath: ':memory:', log: null, lobby: { counterDelay: [0, 0] } });
const BASE = srv.publicUrl;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000, what = '') => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`attente dépassée : ${what}`); await sleep(20); } };
const errors = [];

async function login(name) {
  const r = await fetch(`${BASE}/auth/dev?name=${name}`, { redirect: 'manual' });
  return r.headers.get('set-cookie').match(/dojo_session=[^;]+/)[0];
}
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : () => ({ addColorStop() {} })), set: () => true });

async function openPage(path, cookie, deck, wide) {
  const url = `${BASE}${path}`;
  const jar = new CookieJar();
  jar.setCookieSync(`${cookie}; Path=/`, BASE);
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(`${deck.name}: ${e.message}`));
  vc.on('error', e => errors.push(`${deck.name}: console.error ${e?.message ?? e}`));
  // jsdom n'exécute pas les scripts « module » : le bundle n'a pas d'import, on le charge en script classique strict
  const html = (await (await fetch(url)).text()).replace('<script type="module">', '<script>"use strict";');
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true, cookieJar: jar, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('dojo-decks', JSON.stringify([{ ...deck, updatedAt: 1 }]));
      w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
      w.matchMedia = q => ({ matches: q.includes('min-width: 1100px') ? wide : false, addEventListener() {}, removeEventListener() {}, addListener() {} });
      Object.defineProperty(w, 'crypto', { value: webcrypto });
      w.TextEncoder = TextEncoder;
      w.fetch = (u, o = {}) => fetch(new URL(u, url), { ...o, headers: { ...(o.headers ?? {}), Cookie: jar.getCookieStringSync(BASE), Origin: BASE } });
      w.navigator.vibrate = () => {};
    },
  });
  return dom.window;
}

const deckA = { id: 'da', name: 'Deck Alice', lieu: J1.lieu, groupe: J1.groupe, songe: J1.songe };
const r2 = randomDeck(1001, 'FEU');
const deckB = { id: 'db', name: 'Deck Bob', lieu: r2.lieu, groupe: r2.groupe, songe: r2.songe };
const A = await openPage('/', await login('Alice'), deckA, true);
await until(() => A.document.querySelector('[data-act=pvp-create]'), 5000, 'bouton Créer un salon');
A.document.querySelector('[data-act=pvp-create]').click();
const inviteUrl = await until(() => A.document.querySelector('.pvp-invite input')?.value, 5000, 'lien d\'invitation');
console.log('Lien :', inviteUrl.replace(/invite=.*/, 'invite=…'));

const B = await openPage(new URL(inviteUrl).pathname + new URL(inviteUrl).search, await login('Bob'), deckB, false);
await until(() => B.document.querySelector('[data-act=pvp-join]'), 5000, 'bouton Rejoindre');
assert.equal(B.location.search, '', 'invitation laissée dans l\'URL');
B.document.querySelector('[data-act=pvp-join]').click();
await until(() => A.__dojo.online && B.__dojo.online, 5000, 'début de partie');
await until(() => A.document.querySelector('.score.bot .who') && B.document.querySelector('.score.bot .who'), 5000, 'plateau');
console.log('Partie lancée. Alice voit :', A.document.querySelector('.score.bot .who').textContent, '| Bob voit :', B.document.querySelector('.score.bot .who').textContent);

let n = 0, clicks = 0;
const play = w => {
  const ui = w.__dojo, p = ui.pending;
  if (!p) return false;
  const req = p.req;
  if (req.max > 1 || req.min === 0) {
    const cards = req.options.filter(o => o.card && o.pick);
    const want = req.min + Math.floor(Math.random() * (Math.min(req.max, cards.length) - req.min + 1));
    for (const o of cards.sort(() => Math.random() - 0.5).slice(0, want)) ui.chooseOption(o.id);
    ui.answer([...p.selected]);
  } else {
    const ok = req.options.filter(o => !o.blocked), pool = ok.length ? ok : req.options;
    const o = pool[Math.floor(Math.random() * pool.length)];
    const btn = w.document.querySelector(`#prompt [data-act=opt][data-id="${o.id}"]`);
    if (btn && n % 2) { btn.click(); clicks++; } else ui.chooseOption(o.id);
  }
  n++;
  return true;
};
let checked = false;
const t0 = Date.now();
while (!(A.__dojo.game?.s.over && B.__dojo.game?.s.over)) {
  play(A) || play(B);
  // Une fois en cours de partie : la Main adverse n'est que des dos de carte
  if (!checked && A.__dojo.game.s.night >= 1 && B.__dojo.game.p(1).hand.length) {
    B.__dojo.render(); A.__dojo.render();
    const backs = B.document.querySelectorAll('.opp-hand .card.back').length;
    assert.equal(backs, B.__dojo.game.p(1).hand.length, 'main adverse');
    assert.ok(B.__dojo.game.p(1).hand.every(c => c.hidden && !c.id), 'identité d\'une carte adverse');
    assert.ok(!A.document.querySelector('[data-act=advice]'), 'bouton Conseil en ligne');
    assert.ok(A.document.querySelector('#pvp-clock .clk'), 'pendule absente');
    checked = true;
  }
  if (Date.now() - t0 > 120000) throw new Error('partie trop longue');
  await sleep(5);
}
await sleep(300);
const endA = A.document.querySelector('.end h2')?.textContent, endB = B.document.querySelector('.end h2')?.textContent;
console.log(`Fin après ${n} décisions (${clicks} par clic) : Alice « ${endA} », Bob « ${endB} »`);
console.log('Alice :', A.document.querySelector('.end-score').textContent.replace(/\s+/g, ' ').trim(), '|', A.document.querySelector('.end .hint')?.textContent);
assert.ok(endA && endB, 'écran de fin');
assert.match(A.document.querySelector('.end .hint')?.textContent ?? '', /Mélange vérifié/);
assert.ok(checked, 'vérifications en cours de partie');
// Retour à l'accueil, puis abandon d'une seconde partie
A.document.querySelector('.end [data-act=menu-now]').click();
await until(() => A.document.querySelector('[data-act=pvp-create]'), 3000, 'accueil');
A.document.querySelector('[data-act=pvp-create]').click();
const inv2 = await until(() => A.document.querySelector('.pvp-invite input')?.value, 5000, 'second lien');
B.__dojo.pvp.invite = new URL(inv2).searchParams.get('invite');
B.document.querySelector('.end [data-act=menu-now]').click();
await until(() => B.document.querySelector('[data-act=pvp-join]'), 3000, 'accueil Bob');
B.document.querySelector('[data-act=pvp-join]').click();
await until(() => A.__dojo.online && B.__dojo.online && !A.__dojo.game.s.over, 5000, 'seconde partie');
B.document.querySelector('[data-act=forfeit]').click();
B.document.querySelector('[data-act=forfeit-now]').click();
await until(() => A.document.querySelector('.end h2'), 5000, 'fin par abandon');
console.log('Abandon : Alice « ' + A.document.querySelector('.end h2').textContent + ' », Bob « ' + (await until(() => B.document.querySelector('.end h2'))).textContent + ' »');
assert.deepEqual(errors, [], 'erreurs JavaScript');
console.log('OK : aucune erreur JavaScript');
A.close(); B.close();
await srv.close();
process.exit(0);
