// node test/ui-offline.mjs  (rebâtir le site avant : node build.mjs)
// Le vrai site sans serveur de jeu (fichier statique) : partie contre le bot, section PvP absente.
import { JSDOM, VirtualConsole } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { J1 } = await import(`${P}/test/decks.mjs`);
const page = readFileSync(`${P}/dist/index.html`, 'utf8');
// Serveur statique : seulement la page, 404 ailleurs (comme l'artifact, sans /auth)
const srv = http.createServer((q, r) => { if (q.url === '/') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); } else { r.writeHead(404, { 'Content-Type': 'text/html' }); r.end('<h1>404</h1>'); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000, what = '') => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`attente dépassée : ${what}`); await sleep(20); } };
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(e.message));
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'canvas' ? { width: 1, height: 1 } : () => ({ addColorStop() {} })), set: () => true });
for (const wide of [true, false]) {
  const dom = new JSDOM(page.replace('<script type="module">', '<script>"use strict";'), {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.localStorage.setItem('dojo-decks', JSON.stringify([{ ...J1, id: 'j1', updatedAt: 1 }]));
      w.localStorage.setItem('dojo-prefs', JSON.stringify({ speed: 'rapide', reveal: true }));
      w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
      w.matchMedia = q => ({ matches: q.includes('min-width: 1100px') ? wide : false, addEventListener() {}, removeEventListener() {}, addListener() {} });
      Object.defineProperty(w, 'crypto', { value: webcrypto });
      w.fetch = (u, o) => fetch(new URL(u, url), o);
    },
  });
  const w = dom.window;
  await until(() => w.__dojo, 5000, 'ui');
  await sleep(500);
  assert.ok(!w.document.querySelector('.match.pvp'), 'section PvP affichée sans serveur');
  w.document.querySelector('[data-act=start]').click();
  const t0 = Date.now();
  let n = 0;
  while (!w.__dojo.game?.s.over) {
    const ui = w.__dojo, p = ui.pending;
    if (p) {
      const req = p.req;
      if (req.max > 1 || req.min === 0) ui.answer(req.options.filter(o => o.card).slice(0, req.min).map(o => o.id));
      else { const ok = req.options.filter(o => !o.blocked); ui.chooseOption((ok.length ? ok : req.options)[0].id); }
      n++;
    }
    if (n === 5) { ui.giveAdvice(); assert.ok(ui.advice || !ui.pending, 'conseil hors ligne'); }
    if (Date.now() - t0 > 180000) throw new Error('partie trop longue');
    await sleep(10);
  }
  await until(() => w.document.querySelector('.end h2'), 5000, 'écran de fin');
  console.log(`${wide ? 'Grand écran' : 'Petit écran'} : ${n} décisions, « ${w.document.querySelector('.end h2').textContent} », Rapport : ${!!w.document.querySelector('[data-act=report]')}`);
  dom.window.close();
}
assert.deepEqual(errors, []);
console.log('OK hors ligne : aucune erreur JavaScript, pas de section PvP');
srv.close();
process.exit(0);
