// ─────────────────────────────────────────────────────────────
// Effets visuels et sonores : ciel étoilé, particules, sons synthétisés.
// ─────────────────────────────────────────────────────────────
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ciel nocturne animé derrière la page. */
export function starfield(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [], w = 0, h = 0;
  const resize = () => {
    w = canvas.width = innerWidth * devicePixelRatio;
    h = canvas.height = innerHeight * devicePixelRatio;
    stars = Array.from({ length: Math.round((innerWidth * innerHeight) / 9000) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.2 + 0.3) * devicePixelRatio,
      t: Math.random() * Math.PI * 2, s: 0.004 + Math.random() * 0.012,
    }));
  };
  resize();
  addEventListener('resize', resize);
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (const st of stars) {
      st.t += st.s;
      ctx.globalAlpha = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(st.t));
      ctx.fillStyle = '#dfe0ff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduced()) requestAnimationFrame(frame);
  };
  frame();
}

/** Couche de particules plein écran. */
export class Particles {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.ps = [];
    this.running = false;
    const resize = () => { canvas.width = innerWidth * devicePixelRatio; canvas.height = innerHeight * devicePixelRatio; };
    resize();
    addEventListener('resize', resize);
  }
  /** Gerbe de particules depuis un élément (ou un point). */
  burst(target, { color = '#ffb44c', count = 40, speed = 5, spread = Math.PI * 2, up = false, size = 3 } = {}) {
    if (reduced() || !target) return;
    const r = target.getBoundingClientRect ? target.getBoundingClientRect() : target;
    const x = (r.left + r.width / 2) * devicePixelRatio, y = (r.top + r.height / 2) * devicePixelRatio;
    const colors = [].concat(color);
    for (let i = 0; i < count; i++) {
      const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * spread : Math.random() * spread;
      const v = (0.4 + Math.random()) * speed * devicePixelRatio;
      this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.012 + Math.random() * 0.02,
        r: (0.6 + Math.random()) * size * devicePixelRatio, col: colors[i % colors.length], sq: Math.random() < 0.3 });
    }
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.tick()); }
  }
  /** Confettis depuis le haut de l'écran. */
  confetti(colors) {
    if (reduced()) return;
    for (let i = 0; i < 160; i++)
      this.ps.push({ x: Math.random() * this.c.width, y: -20 * devicePixelRatio * Math.random(), vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
        life: 1, decay: 0.004 + Math.random() * 0.004, r: (3 + Math.random() * 4) * devicePixelRatio, col: colors[i % colors.length], sq: true, g: 0.04 });
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.tick()); }
  }
  tick() {
    const { ctx, c } = this;
    ctx.clearRect(0, 0, c.width, c.height);
    this.ps = this.ps.filter(p => p.life > 0);
    for (const p of this.ps) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g ?? 0.12; p.vx *= 0.985; p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.col;
      if (p.sq) ctx.fillRect(p.x, p.y, p.r, p.r * 0.6);
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    }
    if (this.ps.length) requestAnimationFrame(() => this.tick());
    else { this.running = false; ctx.clearRect(0, 0, c.width, c.height); }
  }
}

/** Petits sons synthétisés (aucun fichier). */
export class Sound {
  constructor() { this.on = true; this.ctx = null; }
  ensure() {
    if (!this.ctx) try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.on = false; }
    return this.ctx;
  }
  tone(freq, dur = 0.12, type = 'sine', vol = 0.08, delay = 0, slide = 0) {
    if (!this.on || !this.ensure()) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  play(name) {
    switch (name) {
      case 'kick': this.tone(220, 0.08, 'triangle', 0.09, 0, -80); break;
      case 'combo': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.06, i * 0.06)); break;
      case 'win': [392, 523, 659].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.07, i * 0.08)); break;
      case 'lose': [330, 262].forEach((f, i) => this.tone(f, 0.25, 'sine', 0.06, i * 0.1)); break;
      case 'damage': this.tone(110, 0.25, 'sawtooth', 0.07, 0, -60); break;
      case 'counter': this.tone(880, 0.1, 'square', 0.04); this.tone(440, 0.15, 'square', 0.04, 0.08); break;
      case 'fame': this.tone(1318, 0.15, 'sine', 0.05); this.tone(1760, 0.2, 'sine', 0.04, 0.06); break;
      case 'turn': this.tone(660, 0.07, 'sine', 0.04); break;
      case 'night': [196, 247, 294].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.05, i * 0.12)); break;
    }
  }
}
