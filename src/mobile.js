// ─────────────────────────────────────────────────────────────
// Mobile : un appui long sur une carte l'affiche en grand ; elle reste
// ouverte jusqu'à un tap. Aucun import : s'appuie sur window.__dojo (ui.js),
// donc le contenu est exactement celui de l'inspecteur du plateau.
// ─────────────────────────────────────────────────────────────
const LONG_MS = 400;   // durée d'appui
const MOVE_TOL = 10;   // au-delà (px), c'est un défilement et non un appui long
const TARGETS = '[data-uid], [data-insp], [data-def]';
const HUMAN = 0;

let timer = 0, from = { x: 0, y: 0 }, zoom = null, justOpened = false, swallowUntil = 0;

/** HTML de la grande carte pour l'élément pressé ('' s'il n'y a rien à montrer). */
function bigCardHTML(el) {
  const ui = window.__dojo;
  if (!ui) return '';
  const uid = el.dataset.uid ?? el.dataset.insp;
  if (uid != null) {
    const c = ui.game?.find(+uid);
    if (!c) return '';
    // Une carte adverse face cachée reste secrète
    if (c.faceDown && c.owner !== HUMAN) return '<article class="bigcard down"><h3>Carte face cachée</h3><p class="bc-sub">Ni nom, ni Aura, ni mot-clé.</p></article>';
    const keep = ui.inspect;
    ui.inspect = c;
    try { return ui.inspectorHTML(); } finally { ui.inspect = keep; }
  }
  // Éditeur de deck : même aperçu que le survol sur ordinateur
  if (el.dataset.def && ui.screen === 'builder') {
    ui.previewDef(el.dataset.def);
    return document.querySelector('#bd-insp article')?.outerHTML ?? '';
  }
  return '';
}

function open(html) {
  close();
  zoom = document.createElement('div');
  zoom.className = 'zoom';
  zoom.setAttribute('role', 'dialog');
  zoom.setAttribute('aria-label', 'Carte en grand');
  zoom.innerHTML = `<div class="zoom-card">${html}<p class="zoom-hint">Touchez pour fermer</p></div>`;
  document.body.appendChild(zoom);
  justOpened = true;
  try { navigator.vibrate?.(12); } catch { /* sans vibreur */ }
}

function close() {
  zoom?.remove();
  zoom = null;
  justOpened = false;
}

const cancel = () => { clearTimeout(timer); timer = 0; };

document.addEventListener('pointerdown', e => {
  cancel();
  if (e.pointerType === 'mouse' || !e.isPrimary || zoom) return;
  const el = e.target.closest?.(TARGETS);
  if (!el) return;
  from = { x: e.clientX, y: e.clientY };
  timer = setTimeout(() => { timer = 0; const html = bigCardHTML(el); if (html) open(html); }, LONG_MS);
}, { passive: true });

document.addEventListener('pointermove', e => {
  if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > MOVE_TOL) cancel();
}, { passive: true });

// Le relâchement qui suit l'ouverture ne doit ni fermer l'aperçu ni déclencher l'action de la carte
const release = () => {
  cancel();
  if (justOpened) { justOpened = false; swallowUntil = Date.now() + 450; }
};
document.addEventListener('pointerup', release);
document.addEventListener('pointercancel', release);
document.addEventListener('scroll', cancel, { capture: true, passive: true });

// Sans ça, Android ouvre son menu contextuel et iOS sa loupe pendant l'appui long
document.addEventListener('contextmenu', e => {
  if (matchMedia('(pointer: coarse)').matches && e.target.closest?.(TARGETS)) e.preventDefault();
});

// Phase de capture : passe avant le gestionnaire de clics de l'interface
document.addEventListener('click', e => {
  if (Date.now() < swallowUntil) { e.stopPropagation(); e.preventDefault(); return; }
  if (zoom) { e.stopPropagation(); e.preventDefault(); close(); }
}, true);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && zoom) { e.stopImmediatePropagation(); close(); }
}, true);

// ─────────────────────────────────────────────────────────────
// Plateau compact : retouches du DOM après chaque rendu (avant l'affichage).
// ─────────────────────────────────────────────────────────────
function sync() {
  const ui = window.__dojo;
  if (!ui?.game) return;
  // Bouton ☰ : ouvre le Journal (volet), qui ne tient plus dans la page
  const tools = document.querySelector('.topbar .tools');
  if (tools && !tools.querySelector('[data-act="toggle-log"]'))
    tools.insertAdjacentHTML('afterbegin', '<button class="icon-btn" data-act="toggle-log" title="Journal" aria-label="Journal">☰</button>');
  // La liste de cartes de la barre de décision fait doublon quand toutes ces cartes sont déjà touchables sur le plateau
  for (const row of document.querySelectorAll('#prompt .row.opts')) {
    const ids = [...row.querySelectorAll('[data-insp]')].map(c => c.dataset.insp);
    row.classList.toggle('dup', ids.length > 0 && ids.every(id => document.querySelector(`#board [data-uid="${id}"]`)));
  }
  // Mulligan : le titre long double l'aide juste dessous, on le raccourcit pour gagner de la place
  const req = ui.pending?.req;
  const title = document.querySelector('#prompt .prompt-title');
  const short = req?.ctx?.zone === 'groupe' ? 'Mulligan des Persos' : 'Mulligan du Songe';
  if (title && req?.kind === 'mulligan' && title.textContent !== short) title.textContent = short; // sans effet si déjà fait : évite de relancer l'observateur
  // Mulligan : l'ordre de sélection compte, on le numérote sur les cartes de la Main
  const sel = ui.pending?.req.kind === 'mulligan' ? [...ui.pending.selected] : [];
  document.querySelectorAll('#hand [data-uid]').forEach(el => {
    const i = sel.indexOf(+el.dataset.uid);
    if (i >= 0) el.dataset.order = i + 1; else delete el.dataset.order;
  });
}
const app = document.getElementById('app');
if (app) new MutationObserver(() => queueMicrotask(sync)).observe(app, { childList: true, subtree: true });