/* Mirage — script.js
 * Paisagens do mundo desenhadas à mão (canvas) atravessadas por um viajante (SVG).
 * JavaScript puro: sem bibliotecas, sem eval, sem innerHTML, sem coleta de dados.
 *
 * Mapa do arquivo
 *   0. Paleta e utilidades (aleatório com semente, ruído)
 *   1. Lápis: traços tremidos, hachuras em lote
 *   2. Peças de desenho reutilizáveis (cordilheira, nuvem, pinheiro, névoa…)
 *   3. Cenas (cada uma: build() desenha camadas estáticas; draw() anima)
 *   4. Viajante (SVG)
 *   5. Motor: laço de 60 fps, transições, controles, acessibilidade
 */
'use strict';

(() => {
  /* ================================================================
   * 0. Paleta e utilidades
   * ================================================================ */
  const PAL = Object.freeze({
    paper: '#F2EBDD',
    paper2: '#E6DCC8',
    ink: '#2B2724',
    g1: '#5A534C',
    g2: '#8C847A',
    g3: '#BDB4A6',
  });

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bell = (u, c, w) => Math.exp(-(((u - c) / w) ** 2));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

  /** Gerador pseudoaleatório com semente (mulberry32): o mesmo desenho sempre. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Ruído de valor 1D suave, em [-1, 1]. */
  function noise1(r) {
    const v = new Float32Array(512);
    for (let i = 0; i < 512; i++) v[i] = r() * 2 - 1;
    return (x) => {
      const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
      const a = v[i & 511], b = v[(i + 1) & 511];
      return a + (b - a) * u;
    };
  }
  function fbm(n, x, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * n(x * f + i * 17.31); a *= 0.5; f *= 2.03; }
    return s;
  }
  /** Ruído "de crista": picos afiados, bom para rochas. Em [0, ~1]. */
  function ridged(n, x, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(n(x * f + i * 7.13))); a *= 0.5; f *= 2.07; }
    return s;
  }

  /** Canvas fora da tela, já escalado para a densidade de pixels. */
  function makeLayer(w, h, res) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * res));
    cv.height = Math.max(1, Math.round(h * res));
    const c = cv.getContext('2d');
    c.setTransform(res, 0, 0, res, 0, 0);
    return { cv, c, res, w, h };
  }

  /** Amostra uma linha de cume y = f(x). */
  function sample(x0, x1, step, f) {
    const pts = [];
    for (let x = x0; x <= x1 + step * 0.5; x += step) pts.push([x, f(x)]);
    return pts;
  }

  /* ================================================================
   * 1. Lápis
   *    S = sorteio de ESTRUTURA (onde vai cada traço) — igual em todas as variantes
   *    J = sorteio de TREMOR (como a mão treme) — muda por variante → "boil" de animação
   * ================================================================ */
  class Pencil {
    constructor(c, seedS, seedJ, k) {
      this.c = c;
      this.S = rng(seedS);
      this.J = rng(seedJ);
      this.k = k; // escala da espessura do traço
    }

    /** Muitos traços curtos de uma vez (um único stroke = rápido). */
    lines(list, { w = 1, col = PAL.ink, a = 1, wob = 1 } = {}) {
      if (!list.length) return;
      const c = this.c, J = this.J;
      c.lineWidth = w * this.k;
      c.strokeStyle = col;
      c.globalAlpha = a;
      c.lineCap = 'round';
      c.beginPath();
      for (const s of list) {
        const x1 = s[0], y1 = s[1], x2 = s[2], y2 = s[3];
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
        const b = (J() - 0.5) * L * 0.09 * wob; // leve barriga no traço
        c.moveTo(x1 + (J() - 0.5) * wob, y1 + (J() - 0.5) * wob);
        c.quadraticCurveTo((x1 + x2) / 2 - (dy / L) * b, (y1 + y2) / 2 + (dx / L) * b,
          x2 + (J() - 0.5) * wob, y2 + (J() - 0.5) * wob);
      }
      c.stroke();
      c.globalAlpha = 1;
    }

    /** Contorno à mão: duas passadas, tremor suave, pequenas falhas. */
    path(pts, { w = 1.2, col = PAL.ink, a = 1, passes = 2, gap = 0.03, jit = 1, close = false } = {}) {
      if (pts.length < 2) return;
      const c = this.c;
      const nx = noise1(this.J), ny = noise1(this.J);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.strokeStyle = col;
      for (let p = 0; p < passes; p++) {
        c.lineWidth = w * this.k * (p ? 0.55 : 1);
        c.globalAlpha = a * (p ? 0.5 : 1);
        const amp = jit * (p ? 1.8 : 1), off = p * 13.7;
        c.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = pts[i][0] + nx(i * 0.07 + off) * amp;
          const y = pts[i][1] + ny(i * 0.07 + off) * amp;
          if (i === 0 || this.J() < gap) c.moveTo(x, y); else c.lineTo(x, y);
        }
        if (close) c.closePath();
        c.stroke();
      }
      c.globalAlpha = 1;
    }
  }

  /* ================================================================
   * 2. Peças de desenho
   * ================================================================ */

  /**
   * Cordilheira sombreada à mão.
   * Preenche com papel (cobre o que está atrás) e, recortado no polígono,
   * desenha: traços de queda (ravinas), hachura de sombra, cruzada nas sombras
   * fundas, faixa escura na base, estratos de rocha e "risquinhos" de floresta.
   */
  function drawRange(pen, o) {
    const c = pen.c, S = pen.S, pts = o.pts, base = o.base, N = pts.length;
    const poly = new Path2D();
    poly.moveTo(pts[0][0], base);
    for (const p of pts) poly.lineTo(p[0], p[1]);
    poly.lineTo(pts[N - 1][0], base);
    poly.closePath();

    c.fillStyle = o.fill;
    c.fill(poly);
    c.save();
    c.clip(poly);

    const fall = [], hatch = [], cross = [], band = [], ticks = [], strata = [];
    for (let i = 1; i < N - 1; i++) {
      const x = pts[i][0], y = pts[i][1];
      const depth = base - y;
      if (depth < 2) continue;
      const slope = (pts[i + 1][1] - pts[i - 1][1]) / (pts[i + 1][0] - pts[i - 1][0]);
      const s = clamp(o.shade(x, y, slope), 0, 1);
      const snow = o.snowY && y < o.snowY;

      if (i % o.fallEvery === 0 && S() < o.fallDensity * (0.35 + s)) {
        const L = Math.min(depth * (0.06 + S() * 0.32) * (0.4 + s * 0.8), o.maxFall || 1e9);
        const ang = Math.PI / 2 - Math.atan(slope) * 0.8 + (S() - 0.5) * 0.3;
        const y0 = y + S() * 3;
        if (!(snow && s < 0.6)) fall.push([x, y0, x + Math.cos(ang) * L, y0 + Math.sin(ang) * L]);
      }
      if (i % o.hatchEvery === 0 && s > o.hatchFrom) {
        const L = depth * (0.15 + S() * 0.6) * s;
        const y0 = y + 1 + S() * 4;
        if (!(snow && s < 0.75)) {
          hatch.push([x, y0, x - L * 0.45, y0 + L]);
          if (s > o.crossFrom && S() < 0.7) cross.push([x - L * 0.3, y0 + L * 0.15, x + L * 0.12, y0 + L * 0.75]);
        }
      }
      if (o.forest && depth > 18) {
        const fy0 = base - depth * o.forest;
        for (let j = 0; j < 3; j++) {
          if (S() < 0.5) {
            const yy = fy0 + S() * (base - fy0), h = (2 + S() * 4) * pen.k, xx = x + S() * 3;
            ticks.push([xx, yy, xx + (S() - 0.5), yy - h]);
          }
        }
      }
    }

    if (o.bandH) {
      const top = base - o.bandH, x1 = pts[N - 1][0];
      for (let yy = top; yy < base; yy += o.bandStep || 3) {
        const t = (yy - top) / o.bandH;
        let x = pts[0][0];
        while (x < x1) {
          const L = 8 + S() * 40;
          if (S() < 0.2 + t * 0.7) band.push([x, yy + S() * 2, x + L, yy + (S() - 0.5) * 2]);
          x += L + S() * 14;
        }
      }
    }

    for (let kk = 0; kk < (o.strata || 0); kk++) {
      const f = 0.12 + S() * 0.5;
      const st = Math.floor(S() * N * 0.7), len = Math.floor(N * (0.08 + S() * 0.3));
      const seg = [];
      for (let i = st; i < Math.min(N, st + len); i++) seg.push([pts[i][0], pts[i][1] + (base - pts[i][1]) * f]);
      if (seg.length > 3) strata.push(seg);
    }

    pen.lines(fall, { w: 0.7, col: o.hatchCol, a: o.fallA });
    pen.lines(hatch, { w: 0.75, col: o.hatchCol, a: o.hatchA });
    pen.lines(cross, { w: 0.65, col: o.hatchCol, a: o.hatchA * 0.7 });
    pen.lines(band, { w: 0.7, col: o.hatchCol, a: o.bandA || 0.3 });
    pen.lines(ticks, { w: 0.9, col: o.tickCol || o.hatchCol, a: 0.7, wob: 0.4 });
    for (const seg of strata) pen.path(seg, { w: 0.6, col: o.hatchCol, a: 0.45, passes: 1, gap: 0.08 });
    c.restore();

    pen.path(pts, { w: o.lineW, col: o.lineCol, a: o.lineA, gap: 0.025, jit: 0.8 });
  }

  /** Nuvem cúmulo: envoltória de círculos, sombra hachurada embaixo. */
  function cloudSprite(seed, w, h, k, res) {
    const L = makeLayer(w, h, res);
    const pen = new Pencil(L.c, seed, seed * 7 + 1, k), S = pen.S, c = L.c;
    const base = h * 0.8, n = 4 + Math.floor(S() * 3), circles = [];
    for (let i = 0; i < n; i++) {
      const mid = 1 - Math.abs(i - (n - 1) / 2) / n;
      const r = w * (0.09 + S() * 0.07) * (0.55 + mid * 0.9);
      const cx = w * (0.16 + (0.68 * (i + 0.5)) / n + (S() - 0.5) * 0.05);
      circles.push([cx, base - r * (0.08 + S() * 0.22), r]);
    }
    const top = [];
    for (let x = 0; x <= w; x += 2) {
      let y = Infinity;
      for (const [cx, cy, r] of circles) {
        const d = x - cx;
        if (Math.abs(d) < r) { const yy = cy - Math.sqrt(r * r - d * d); if (yy < y) y = yy; }
      }
      if (y < base) top.push([x, y]);
    }
    if (top.length < 4) return L;
    const xs = top[0][0], xe = top[top.length - 1][0];
    const pts = top.slice();
    for (let x = xe; x >= xs; x -= 4) pts.push([x, base + Math.sin(((x - xs) / (xe - xs)) * Math.PI) * h * 0.03]);
    const poly = new Path2D();
    pts.forEach((p, i) => (i ? poly.lineTo(p[0], p[1]) : poly.moveTo(p[0], p[1])));
    poly.closePath();
    c.fillStyle = PAL.paper;
    c.fill(poly);
    c.save();
    c.clip(poly);
    const hatch = [];
    for (let x = xs; x < xe; x += 2.6) {
      if (S() < 0.6) {
        const len = h * (0.05 + S() * 0.14);
        hatch.push([x, base + h * 0.04, x + len * 0.5, base + h * 0.04 - len]);
      }
    }
    pen.lines(hatch, { w: 0.6, col: PAL.g2, a: 0.5 });
    for (let i = 1; i < circles.length; i++) {
      const [cx, cy, r] = circles[i];
      if (S() < 0.6) {
        const arc = [];
        for (let a = Math.PI * 1.05; a < Math.PI * 1.55; a += 0.08) arc.push([cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75 + r * 0.25]);
        pen.path(arc, { w: 0.7, col: PAL.g2, a: 0.55, passes: 1 });
      }
    }
    c.restore();
    pen.path(pts, { w: 1, col: PAL.g1, a: 0.85, close: true, gap: 0.04 });
    return L;
  }

  /** Faixa de névoa: manchas de papel esfumadas, emendável nas bordas. */
  function mistSprite(seed, w, h, density = 70) {
    const L = makeLayer(w, h, 1), c = L.c, r = rng(seed);
    for (let i = 0; i < density; i++) {
      const x = r() * w, y = h * (0.3 + r() * 0.4), rad = h * (0.22 + r() * 0.45), a = 0.25 + r() * 0.35;
      for (const ox of [-w, 0, w]) {
        c.save();
        c.translate(x + ox, y);
        c.scale(2.6, 1);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
        g.addColorStop(0, `rgba(242,235,221,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(242,235,221,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, 0, rad, 0, TAU);
        c.fill();
        c.restore();
      }
    }
    c.strokeStyle = PAL.g3;
    c.globalAlpha = 0.18;
    c.lineWidth = 0.8;
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const x = r() * w, y = h * (0.4 + r() * 0.25), len = 40 + r() * 120;
      c.moveTo(x, y);
      c.quadraticCurveTo(x + len / 2, y + (r() - 0.5) * 3, x + len, y);
    }
    c.stroke();
    return L;
  }

  /** Pequena mancha clara (respingo, vapor). */
  function puffSprite(w, h) {
    const L = makeLayer(w, h, 1), c = L.c;
    c.save();
    c.translate(w / 2, h / 2);
    c.scale(w / h, 1);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, h / 2);
    g.addColorStop(0, 'rgba(242,235,221,0.95)');
    g.addColorStop(1, 'rgba(242,235,221,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, h / 2, 0, TAU);
    c.fill();
    c.restore();
    return L;
  }

  /** Pinheiro (abeto) escandinavo: silhueta serrilhada, galhos caídos, sombra à direita. */
  function spruce(pen, x, baseY, h, w) {
    const c = pen.c, S = pen.S;
    const tiers = Math.max(7, Math.round(h / (9 * pen.k)));
    const top = baseY - h, left = [], right = [], tierInfo = [];
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers, y = top + h * 0.88 * t;
      const half = w * 0.5 * Math.pow(t, 0.85) * (0.85 + S() * 0.3);
      const droop = (h / tiers) * (0.35 + S() * 0.35);
      const halfR = half * (0.9 + S() * 0.2);
      left.push([x - half, y + droop], [x - half * 0.35, y + (h / tiers) * 0.45]);
      right.push([x + half * 0.35, y + (h / tiers) * 0.45], [x + halfR, y + droop]);
      tierInfo.push([y, half, halfR, droop]);
    }
    const pts = [[x, top], ...left, [x, top + h * 0.9]];
    for (let i = right.length - 1; i >= 0; i--) pts.push(right[i]);
    pts.push([x, top]);
    const poly = new Path2D();
    pts.forEach((p, i) => (i ? poly.lineTo(p[0], p[1]) : poly.moveTo(p[0], p[1])));
    poly.closePath();

    pen.lines([[x - 1, top + h * 0.85, x - 1.4, baseY], [x + 1.6, top + h * 0.85, x + 2, baseY]], { w: 1.2, col: PAL.ink, a: 0.9 });
    c.globalAlpha = 0.4;
    c.fillStyle = PAL.g1;
    c.fill(poly);
    c.globalAlpha = 1;
    c.save();
    c.clip(poly);
    const br = [], nd = [], sh = [];
    for (const [y, half, halfR, droop] of tierInfo) {
      br.push([x, y - droop * 0.4, x - half, y + droop]);
      br.push([x, y - droop * 0.4, x + halfR, y + droop]);
      for (let j = 0; j < 8; j++) {
        const f = S(), side = S() < 0.5 ? -1 : 1, hw = side < 0 ? half : halfR;
        const px = x + side * hw * f, py = y - droop * 0.4 + (droop * 1.4) * f;
        nd.push([px, py, px + (S() - 0.5) * 2, py + (3 + S() * 5) * pen.k]);
      }
    }
    for (let yy = top; yy < top + h * 0.95; yy += 2.4 * pen.k) sh.push([x + 1, yy, x + w * 0.5, yy + w * 0.32]);
    pen.lines(sh, { w: 0.7, col: PAL.ink, a: 0.45 });
    pen.lines(br, { w: 1.1, col: PAL.ink, a: 0.85 });
    pen.lines(nd, { w: 0.7, col: PAL.ink, a: 0.6 });
    c.restore();
    pen.path(pts, { w: 1, col: PAL.ink, a: 0.9, passes: 1, gap: 0.05, jit: 0.6 });
  }

  /** Pedra: contorno irregular, lado direito sombreado. */
  function rock(pen, x, y, r) {
    const c = pen.c, S = pen.S, pts = [];
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      const rr = r * (0.8 + S() * 0.35);
      pts.push([x + Math.cos(a) * rr * 1.25, y + Math.sin(a) * rr * 0.75]);
    }
    const poly = new Path2D();
    pts.forEach((p, i) => (i ? poly.lineTo(p[0], p[1]) : poly.moveTo(p[0], p[1])));
    poly.closePath();
    c.fillStyle = PAL.paper;
    c.fill(poly);
    c.save();
    c.clip(poly);
    const h = [];
    for (let xx = x - r * 0.1; xx < x + r * 1.4; xx += 1.8) h.push([xx, y + 2, xx - r * 0.4, y - r]);
    pen.lines(h, { w: 0.6, col: PAL.ink, a: 0.55 });
    c.restore();
    pen.path(pts, { w: 1, col: PAL.ink, a: 0.9, passes: 2, jit: 0.4 });
  }

  /** Barco a vela, desenho pequeno (sprite). */
  function boatSprite(w, h, k, res) {
    const L = makeLayer(w, h, res), c = L.c, pen = new Pencil(c, 909, 919, k);
    const deck = h * 0.78;
    const hull = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      hull.push([w * 0.08 + t * w * 0.84, deck + Math.sin(t * Math.PI) * h * 0.13]);
    }
    const hp = new Path2D();
    hp.moveTo(w * 0.04, deck - h * 0.02);
    hull.forEach((p) => hp.lineTo(p[0], p[1]));
    hp.lineTo(w * 0.96, deck - h * 0.03);
    hp.closePath();
    c.fillStyle = PAL.g2;
    c.fill(hp);
    pen.path([[w * 0.04, deck - h * 0.02], ...hull, [w * 0.96, deck - h * 0.03]], { w: 1, col: PAL.ink, passes: 1 });
    pen.lines([[w * 0.04, deck - h * 0.02, w * 0.96, deck - h * 0.03]], { w: 1, col: PAL.ink });
    pen.lines([[w * 0.5, deck - 1, w * 0.5, h * 0.06]], { w: 1.1, col: PAL.ink });
    const sail = [[w * 0.54, h * 0.09], [w * 0.54, deck - h * 0.06], [w * 0.9, deck - h * 0.06]];
    const jib = [[w * 0.46, h * 0.14], [w * 0.46, deck - h * 0.06], [w * 0.16, deck - h * 0.06]];
    for (const [tri, dark] of [[sail, false], [jib, true]]) {
      const p = new Path2D();
      tri.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
      p.closePath();
      c.fillStyle = PAL.paper;
      c.fill(p);
      if (dark) {
        c.save();
        c.clip(p);
        const hs = [];
        for (let y = 0; y < h; y += 1.6) hs.push([0, y, w, y + w * 0.4]);
        pen.lines(hs, { w: 0.5, col: PAL.g1, a: 0.6 });
        c.restore();
      }
      pen.path([...tri, tri[0]], { w: 0.9, col: PAL.ink, passes: 1, jit: 0.3 });
    }
    return L;
  }

  /* ================================================================
   * 3. Cenas
   *    Contrato de uma cena:
   *      id, numeral, place, meta, mood, duration (s), stopAt (0–1)
   *      build(env) → estado com:
   *        draw(ctx, t, variant)  desenha um quadro (t = segundos de cena)
   *        ground(x)              altura do chão onde o viajante pisa
   *        addVariant()           desenha mais uma variante de "boil"; false quando acabou
   *        count                  variantes prontas
   * ================================================================ */

  /* ---------- Cena I · Fiordes (Geirangerfjord, Noruega) ---------- */
  const Fjord = {
    id: 'fiordes',
    numeral: 'I',
    place: 'Geirangerfjord',
    meta: 'Noruega · 62°06′N 7°06′E',
    mood: 'calma, contemplativa',
    duration: 30,
    stopAt: 0.34,

    build(env) {
      const { W, H, res, k } = env;
      const portrait = H > W * 1.1;
      const hf = portrait ? 0.8 : 1;                       // montanhas um pouco mais baixas no retrato
      const wf = portrait ? clamp(H / W / 1.4, 1, 1.7) : 1; // e mais largas, para não virarem agulhas
      const wY = H * (portrait ? 0.58 : 0.6);               // linha d'água
      const bottomWater = H * 0.87;

      const nF = noise1(rng(101)), nL = noise1(rng(202)), nR = noise1(rng(303));
      const nN = noise1(rng(404)), nB = noise1(rng(606));

      // ---- geometria (fixa entre variantes) ----
      const far = (x) => {
        const u = x / W;
        const h = 0.07 + 0.21 * bell(u, 0.53, 0.085 * wf) + 0.15 * bell(u, 0.665, 0.07 * wf) +
          0.08 * bell(u, 0.42, 0.06 * wf) + 0.05 * bell(u, 0.8, 0.08 * wf) + 0.035 * ridged(nF, u * 12);
        return wY - h * H * hf;
      };
      const midL = (x) => {
        const u = x / W;
        const h = 0.4 * Math.pow(1 - smooth(0, 0.5, u), 0.9) + 0.04 * bell(u, 0.18, 0.05) +
          0.03 * ridged(nL, u * 16) + 0.012 * fbm(nL, u * 45);
        return Math.min(wY + 2, wY - h * H * hf);
      };
      const midR = (x) => {
        const u = x / W;
        const h = 0.42 * Math.pow(smooth(0.46, 1, u), 0.8) + 0.05 * bell(u, 0.86, 0.04) +
          0.03 * ridged(nR, u * 15) + 0.012 * fbm(nR, u * 40);
        return Math.min(wY + 2, wY - h * H * hf);
      };
      const near = (x) => {
        const u = x / W;
        const h = 0.235 * Math.pow(1 - smooth(0, 0.34, u), 0.7) + 0.02 * ridged(nN, u * 20) - 0.004;
        return Math.min(wY + H * 0.012, wY - h * H * hf);
      };
      const bankY = (x) => H * (portrait ? 0.845 : 0.835) + H * 0.012 * Math.sin((x / W) * 2.8 + 0.6) + H * 0.008 * fbm(nB, x * 0.008);
      const trailY = (x) => bankY(x) + H * 0.038;

      const step = 3;
      const geo = {
        far: sample(-6, W + 6, step, far),
        midR: sample(W * 0.43, W + 6, step, midR),
        midL: sample(-6, W * 0.53, step, midL),
        near: sample(-6, W * 0.37, step, near),
        bank: sample(-6, W + 6, step, bankY),
      };
      const fallX = W * 0.735;
      const falls = [0, 1, 2].map((i) => {
        const x = fallX + i * 7 * k + (i === 2 ? 5 * k : 0);
        const top = midR(x) + (wY - midR(x)) * (0.12 + i * 0.05);
        return { x, top, bot: wY - 1, ph: i * 1.7, v: (38 + i * 6) * k, n: Math.max(4, Math.round((wY - top) / (9 * k))) };
      });

      // ---- céu + água de fundo (uma variante só) ----
      const sky = makeLayer(W, H, res);
      {
        const c = sky.c, pen = new Pencil(c, 55, 56, k), S = pen.S;
        c.fillStyle = PAL.paper;
        c.fillRect(0, 0, W, H);
        const skyL = [];
        for (let y = H * 0.015; y < H * 0.3; y += 6 * k) {
          const p = 0.5 * (1 - y / (H * 0.3));
          let x = -10;
          while (x < W) { const L = 30 + S() * 140; if (S() < p) skyL.push([x, y + S() * 2, x + L, y + (S() - 0.5) * 3]); x += L + 10 + S() * 60; }
        }
        pen.lines(skyL, { w: 0.6, col: PAL.g3, a: 0.4 });
        // sol baixo, atrás dos picos
        const sx = W * (portrait ? 0.62 : 0.3), sy = H * (portrait ? 0.27 : 0.2), r = Math.min(W, H) * 0.045;
        c.fillStyle = PAL.paper;
        c.beginPath();
        c.arc(sx, sy, r * 1.15, 0, TAU);
        c.fill();
        const circ = [];
        for (let a = 0; a <= TAU + 0.15; a += 0.08) circ.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
        pen.path(circ, { w: 1, col: PAL.g1, a: 0.85, gap: 0.01 });
        const halo = [];
        for (let a = 0.6; a <= 2.6; a += 0.08) halo.push([sx + Math.cos(a) * r * 1.35, sy + Math.sin(a) * r * 1.35]);
        pen.path(halo, { w: 0.6, col: PAL.g3, a: 0.7, passes: 1 });
        // traços horizontais da água
        const wl = [];
        for (let y = wY + 3; y < bottomWater; y += 4 * k) {
          const t = (y - wY) / (bottomWater - wY);
          let x = -10;
          while (x < W) { const L = 20 + S() * 120; if (S() < 0.2 + t * 0.45) wl.push([x, y, x + L, y + (S() - 0.5) * 1.5]); x += L + S() * 50; }
        }
        pen.lines(wl, { w: 0.6, col: PAL.g3, a: 0.45 });
      }

      // ---- nuvens, névoa, barco, respingo ----
      const cw = Math.min(W * 0.3, H * 0.5);
      const clouds = [0, 1, 2].map((i) => {
        const w = cw * (0.75 + i * 0.15), h = w * 0.42;
        return { L: cloudSprite(31 + i * 11, w, h, k, res), w, h, y: H * (0.06 + i * 0.075), x0: W * (0.15 + i * 0.37), v: (4 + i * 2.5) * k };
      });
      const mistLow = { L: mistSprite(71, Math.ceil(W * 1.5), Math.ceil(H * 0.11)), y: wY - H * 0.075, v: 7 * k, a: portrait ? 0.6 : 0.9 };
      const mistHigh = { L: mistSprite(72, Math.ceil(W * 1.5), Math.ceil(H * 0.08), 40), y: H * 0.36, v: -4 * k, a: 0.7 };
      const puff = puffSprite(Math.ceil(26 * k), Math.ceil(12 * k));
      const bw = 34 * k, bh = 40 * k;
      const boat = boatSprite(bw, bh, k, res);

      // ---- ondulações (pré-sorteadas) ----
      const rr = rng(707), depth = bottomWater - wY, ripples = [];
      for (let i = 0; i < 240; i++) {
        const d = Math.pow(rr(), 1.6);
        ripples.push({ x: rr() * (W + 60) - 30, y: wY + 4 + d * (depth - 4), d, len: (5 + d * 55 + rr() * 20) * k * 0.8, ph: rr() * TAU, glint: rr() < 0.22, b: i % 3 });
      }
      const rb = rng(808), birds = [];
      for (let i = 0; i < 5; i++) {
        birds.push({ x0: rb() * W, y: H * (0.12 + rb() * 0.14), v: (14 + rb() * 10) * k, s: (5 + rb() * 3) * k, f: 5 + rb() * 3, ph: rb() * TAU });
      }

      const st = { W, H, wY, count: 0, land: [], fg: [] };

      // ---- variantes de "boil": terra (montanhas) e primeiro plano ----
      st.addVariant = () => {
        if (st.count >= 3) return false;
        const seedJ = 1000 + st.count * 97;

        const land = makeLayer(W, H, res);
        const pen = new Pencil(land.c, 77, seedJ, k);
        drawRange(pen, {
          pts: geo.far, base: wY + 1, fill: '#EEE7DA', hatchCol: PAL.g2, hatchA: 0.5, fallA: 0.45,
          fallEvery: 2, fallDensity: 0.7, hatchEvery: 1, hatchFrom: 0.48, crossFrom: 0.82, strata: 3, maxFall: H * 0.08,
          lineW: 0.9, lineCol: PAL.g2, lineA: 0.9, snowY: wY - 0.17 * H * hf,
          shade: (x, y, sl) => 0.3 + 0.6 * Math.tanh(sl * 1.5) + 0.2 * nF(x * 0.02),
        });
        drawRange(pen, {
          pts: geo.midR, base: wY + 1, fill: '#EAE2D3', hatchCol: PAL.g1, hatchA: 0.48, fallA: 0.5,
          fallEvery: 2, fallDensity: 0.8, hatchEvery: 1, hatchFrom: 0.5, crossFrom: 0.8,
          bandH: H * 0.05, bandStep: 3, bandA: 0.32, strata: 5, forest: 0.28, maxFall: H * 0.12,
          lineW: 1.1, lineCol: PAL.g1, lineA: 0.95,
          shade: (x, y, sl) => 0.32 + 0.3 * Math.tanh(sl * 1.2) + 0.3 * nR(x * 0.018),
        });
        // cachoeiras "Sete Irmãs": papel raspado sobre a hachura
        for (const f of falls) {
          const pts = [];
          for (let y = f.top; y <= f.bot; y += 3) pts.push([f.x + Math.sin(y * 0.05 + f.ph) * 1.2 * k, y]);
          pen.path(pts, { w: 2.6, col: PAL.paper, a: 1, passes: 1, gap: 0, jit: 0.3 });
          pen.path(pts.map((p) => [p[0] + 1.8 * k, p[1]]), { w: 0.5, col: PAL.g2, a: 0.6, passes: 1, gap: 0.15 });
        }
        drawRange(pen, {
          pts: geo.midL, base: wY + 1, fill: '#E8E0D0', hatchCol: PAL.g1, hatchA: 0.52, fallA: 0.5,
          fallEvery: 2, fallDensity: 0.8, hatchEvery: 1, hatchFrom: 0.45, crossFrom: 0.75,
          bandH: H * 0.05, bandStep: 3, bandA: 0.35, strata: 5, forest: 0.3, maxFall: H * 0.12,
          lineW: 1.15, lineCol: PAL.g1, lineA: 0.95,
          shade: (x, y, sl) => 0.5 + 0.3 * Math.tanh(sl * 1.2) + 0.3 * nL(x * 0.018),
        });
        drawRange(pen, {
          pts: geo.near, base: wY + H * 0.014, fill: '#E4DBCA', hatchCol: PAL.ink, hatchA: 0.5, fallA: 0.55,
          fallEvery: 1, fallDensity: 0.9, hatchEvery: 1, hatchFrom: 0.4, crossFrom: 0.66,
          bandH: H * 0.06, bandStep: 3, bandA: 0.42, strata: 4, forest: 0.55, tickCol: PAL.ink,
          lineW: 1.5, lineCol: PAL.ink, lineA: 1,
          shade: (x, y, sl) => 0.6 + 0.25 * Math.tanh(sl) + 0.25 * nN(x * 0.02),
        });
        pen.path(sample(-4, W + 4, 6, () => wY), { w: 0.9, col: PAL.g1, a: 0.8, gap: 0.08, jit: 0.5 });
        st.land.push(land);

        // primeiro plano: margem com trilha, pedras, capim e abetos
        const fg = makeLayer(W, H, res);
        const pf = new Pencil(fg.c, 88, seedJ + 5, k), c = fg.c, S = pf.S;
        const top = geo.bank;
        const poly = new Path2D();
        poly.moveTo(-6, H + 6);
        top.forEach((p) => poly.lineTo(p[0], p[1]));
        poly.lineTo(W + 6, H + 6);
        poly.closePath();
        c.fillStyle = PAL.paper;
        c.fill(poly);
        c.save();
        c.clip(poly);
        const tone = [], tone2 = [];
        const nCl = Math.round((W * (H - bankY(W / 2))) / (60 * k * k));
        for (let i = 0; i < nCl; i++) {
          const px = S() * W, py = bankY(px) + 3 + S() * (H - bankY(px));
          const t = (py - bankY(px)) / (H - bankY(px));
          if (S() > 0.35 + t * 0.6) continue;
          const ang = -1.1 + (S() - 0.5) * 0.5, L = (5 + S() * 7) * k, n = 3 + Math.floor(S() * 4);
          for (let j = 0; j < n; j++) {
            const ox = px + j * 2.2 * k;
            (t > 0.55 ? tone2 : tone).push([ox, py, ox + Math.cos(ang) * L, py + Math.sin(ang) * L]);
          }
        }
        pf.lines(tone, { w: 0.65, col: PAL.g1, a: 0.5 });
        pf.lines(tone2, { w: 0.7, col: PAL.ink, a: 0.45 });
        // trilha: papel limpo com bordas pontilhadas
        const trail = sample(-6, W + 6, 6, trailY);
        pf.path(trail, { w: 9, col: PAL.paper, a: 1, passes: 1, gap: 0, jit: 0.4 });
        pf.path(trail.map((p) => [p[0], p[1] - 4.5 * k]), { w: 0.6, col: PAL.g2, a: 0.7, passes: 1, gap: 0.25 });
        pf.path(trail.map((p) => [p[0], p[1] + 5 * k]), { w: 0.6, col: PAL.g2, a: 0.7, passes: 1, gap: 0.3 });
        c.restore();
        // pedras
        for (let i = 0; i < 6; i++) {
          const rx = W * (0.08 + i * 0.16 + S() * 0.08), r = (5 + S() * 9) * k;
          rock(pf, rx, bankY(rx) + 3 * k + S() * 6 * k, r);
        }
        // borda da margem e capim
        pf.path(top, { w: 1.3, col: PAL.ink, a: 0.95, gap: 0.03, jit: 0.6 });
        const grass = [];
        for (let x = -4; x < W + 4; x += 2.2) {
          if (S() < 0.55) {
            const y = bankY(x) + 1, h = (2 + S() * 8) * k * (S() < 0.1 ? 1.8 : 1);
            grass.push([x, y, x + (S() - 0.3) * 4 * k, y - h]);
          }
        }
        pf.lines(grass, { w: 0.7, col: PAL.ink, a: 0.75, wob: 0.5 });
        // abetos emoldurando a vista
        const tf = portrait ? 0.8 : 1;
        spruce(pf, W * 0.03, H * 1.02, H * 0.46 * tf, H * 0.15 * tf);
        spruce(pf, W * 0.84, H * 0.99, H * 0.25 * tf, H * 0.085 * tf);
        spruce(pf, W * 0.92, H * 1.03, H * 0.52 * tf, H * 0.17 * tf);
        spruce(pf, W * 0.99, H * 1.02, H * 0.4 * tf, H * 0.13 * tf);
        st.fg.push(fg);

        st.count++;
        return st.count < 3;
      };
      st.addVariant(); // a primeira já sai pronta; as outras são desenhadas quando o navegador folgar

      st.ground = trailY;

      st.draw = (ctx, t, v) => {
        const land = st.land[v] || st.land[0];
        const fg = st.fg[v] || st.fg[0];
        ctx.drawImage(sky.cv, 0, 0, W, H);

        for (const cl of clouds) {
          const span = W + cl.w * 2;
          const x = ((cl.x0 + t * cl.v) % span + span) % span - cl.w;
          ctx.drawImage(cl.L.cv, x, cl.y, cl.w, cl.h);
        }

        ctx.drawImage(land.cv, 0, 0, W, H);
        drawMist(ctx, mistHigh, t);

        // reflexo: faixas espelhadas e deslocadas
        ctx.globalAlpha = 0.36;
        const lr = land.res, srcH = (2 / 0.72) * lr;
        for (let y = 0; y < depth; y += 2) {
          const sy = wY - (y + 2) / 0.72;
          if (sy < 0) break;
          const d = y / depth;
          const off = (Math.sin(y * 0.13 - t * 1.4) * 0.9 + Math.sin(y * 0.047 + t * 0.6) * 1.6) * (0.35 + d * 1.8) * k;
          ctx.drawImage(land.cv, 0, sy * lr, land.cv.width, srcH, off, wY + y, W, 2.2);
        }
        ctx.globalAlpha = 1;

        // ondulações e brilhos
        const alphas = [0.22, 0.36, 0.5];
        ctx.lineCap = 'round';
        for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          for (const r of ripples) {
            if (r.b !== b || r.glint) continue;
            rippleTo(ctx, r, t, W, k);
          }
          ctx.strokeStyle = PAL.g1;
          ctx.globalAlpha = alphas[b];
          ctx.lineWidth = 0.9 * k;
          ctx.stroke();
        }
        ctx.beginPath();
        for (const r of ripples) if (r.glint) rippleTo(ctx, r, t, W, k);
        ctx.strokeStyle = PAL.paper;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.4 * k;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // cachoeiras correndo
        ctx.beginPath();
        for (const f of falls) {
          const len = f.bot - f.top;
          for (let j = 0; j < f.n; j++) {
            const yy = f.top + ((t * f.v + (j * len) / f.n) % len);
            const xx = f.x + Math.sin(yy * 0.05 + f.ph) * 1.2 * k;
            ctx.moveTo(xx, yy);
            ctx.lineTo(xx + 0.3, Math.min(f.bot, yy + 5 * k));
          }
        }
        ctx.strokeStyle = PAL.paper;
        ctx.lineWidth = 1.3 * k;
        ctx.stroke();
        for (const f of falls) {
          ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 3 + f.ph);
          ctx.drawImage(puff.cv, f.x - puff.w / 2, f.bot - puff.h * 0.7, puff.w, puff.h);
        }
        ctx.globalAlpha = 1;

        // barco à deriva
        const span = W * 1.3;
        const bx = W * 1.12 - (((t * 9 * k + W * 0.45) % span) + span) % span;
        const by = wY + depth * 0.3 + Math.sin(t * 1.3) * 1.2 * k;
        ctx.save();
        ctx.translate(bx, by + 2 * k);
        ctx.scale(1, -0.55);
        ctx.globalAlpha = 0.25;
        ctx.drawImage(boat.cv, -bw / 2, -bh * 0.78, bw, bh);
        ctx.restore();
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(Math.sin(t * 1.1) * 0.035);
        ctx.drawImage(boat.cv, -bw / 2, -bh * 0.78, bw, bh);
        ctx.restore();

        drawMist(ctx, mistLow, t);

        // pássaros
        ctx.beginPath();
        for (const b of birds) {
          const span2 = W + 200;
          const x = W + 100 - (((b.x0 + t * b.v) % span2) + span2) % span2;
          const y = b.y + Math.sin(t * 0.5 + b.ph) * 6 * k;
          const s = b.s, f = Math.sin(t * b.f + b.ph) * s * 0.5;
          ctx.moveTo(x - s, y - f);
          ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.35 - f * 0.3, x, y);
          ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.35 - f * 0.3, x + s, y - f);
        }
        ctx.strokeStyle = PAL.ink;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.1 * k;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.drawImage(fg.cv, 0, 0, W, H);
      };

      return st;
    },
  };

  function drawMist(ctx, m, t) {
    const w = m.L.w;
    const x = -((((t * m.v) % w) + w) % w);
    ctx.globalAlpha = m.a;
    ctx.drawImage(m.L.cv, x, m.y, w, m.L.h);
    ctx.drawImage(m.L.cv, x + w, m.y, w, m.L.h);
    ctx.globalAlpha = 1;
  }

  function rippleTo(ctx, r, t, W, k) {
    const span = W + 60;
    const x = (((r.x + t * 2 * k + Math.sin(t * 0.35 + r.ph) * 6 * k * (0.4 + r.d)) % span) + span) % span - 30;
    const L = r.len * (0.75 + 0.25 * Math.sin(t * 0.9 + r.ph * 2));
    ctx.moveTo(x, r.y);
    ctx.quadraticCurveTo(x + L / 2, r.y + 0.8 * k * Math.sin(r.ph + t), x + L, r.y);
  }

  /** Ordem do roteiro: ao chegar na última, volta para a primeira. */
  const SCENES = [Fjord];

  /* ================================================================
   * 5. Motor
   * ================================================================ */
  const canvas = document.getElementById('scene');
  const ctx = canvas && canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reducedMQ.matches;

  let W = 0, H = 0, DPR = 1, K = 1;
  let idx = 0, state = null, sceneT = 0, animT = 0, boilT = 0, paused = false, dirty = true;
  let trans = null, snap = null, last = performance.now();

  const ui = {
    label: document.getElementById('label'),
    num: document.getElementById('label-num'),
    place: document.getElementById('label-place'),
    meta: document.getElementById('label-meta'),
    prev: document.getElementById('btn-prev'),
    play: document.getElementById('btn-play'),
    next: document.getElementById('btn-next'),
    dots: document.getElementById('dots'),
    svg: document.getElementById('traveler'),
  };

  const duration = () => SCENES[idx].duration * (reduced ? 1.1 : 1);

  function measure() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    let d = Math.min(window.devicePixelRatio || 1, 2);
    const maxPx = 3.6e6; // teto de pixels por camada: poupa memória em telas enormes
    if (W * H * d * d > maxPx) d = Math.sqrt(maxPx / (W * H));
    DPR = Math.max(0.5, d);
    K = clamp(H / 850, 0.65, 1.4);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    if (ui.svg) ui.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    snap = makeLayer(W, H, DPR);
    snap.c.fillStyle = PAL.paper;
    snap.c.fillRect(0, 0, W, H);
  }

  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 60));

  function build() {
    const st = SCENES[idx].build({ W, H, res: DPR, k: K });
    state = st;
    const more = () => { if (state === st && st.addVariant()) idle(more); };
    if (!reduced) idle(more);
  }

  function takeSnapshot() {
    snap.c.setTransform(1, 0, 0, 1, 0, 0);
    snap.c.drawImage(canvas, 0, 0);
    snap.c.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function updateLabel(animate) {
    const sc = SCENES[idx];
    ui.num.textContent = sc.numeral;
    ui.place.textContent = sc.place;
    ui.meta.textContent = sc.meta;
    if (animate && !reduced) {
      ui.label.classList.remove('is-new');
      void ui.label.offsetWidth; // reinicia a animação CSS
      ui.label.classList.add('is-new');
    }
    const items = ui.dots.querySelectorAll('button');
    items.forEach((b, i) => b.setAttribute('aria-current', i === idx ? 'true' : 'false'));
  }

  function goTo(i, first = false) {
    const n = SCENES.length;
    const next = ((i % n) + n) % n;
    if (!first) takeSnapshot();
    const reuse = !first && next === idx && state;
    idx = next;
    if (!reuse) build();
    sceneT = 0;
    animT = 0;
    trans = { p: 0, dur: reduced ? 1.2 : 2.2 };
    updateLabel(!first);
    dirty = true;
  }

  /** Revelação "desenhando": a cena nova surge atrás de uma borda de lápis. */
  function drawTransition() {
    const p = clamp(trans.p, 0, 1);
    if (reduced) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(snap.cv, 0, 0);
      ctx.restore();
      return;
    }
    const e = ease(p);
    const edge = (y) => -0.2 * W + e * 1.45 * W + Math.sin(y * 0.011 + 1.3) * 0.05 * W + Math.sin(y * 0.037) * 0.015 * W;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W + 20, -10);
    for (let y = -10; y <= H + 10; y += 12) ctx.lineTo(edge(y), y);
    ctx.lineTo(W + 20, H + 10);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(snap.cv, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = PAL.g1;
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = pass ? 0.25 : 0.5;
      ctx.lineWidth = (pass ? 3 : 1.2) * K;
      ctx.beginPath();
      for (let y = -10; y <= H + 10; y += 8) {
        const xx = edge(y) + Math.sin(y * 0.5 + pass * 3) * 1.5 + pass * 4;
        if (y === -10) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    const run = !paused;

    if (run) {
      sceneT += dt;
      animT += dt * (reduced ? 0.2 : 1); // movimento reduzido: o mundo quase parado
      if (!reduced) boilT += dt;
      if (!trans && sceneT >= duration()) goTo(idx + 1);
    }
    if (!run && !dirty && !trans) return; // pausado e nada mudou: não redesenha
    dirty = false;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const v = state.count ? Math.floor(boilT / 0.2) % state.count : 0;
    state.draw(ctx, animT, v);
    if (trans) {
      if (run) trans.p += dt / trans.dur;
      drawTransition();
      if (trans.p >= 1) trans = null;
    }
  }

  // ---------- controles ----------
  function setPaused(p) {
    paused = p;
    ui.play.setAttribute('aria-pressed', p ? 'true' : 'false');
    ui.play.setAttribute('aria-label', p ? 'Continuar' : 'Pausar');
    dirty = true;
  }

  function buildDots() {
    while (ui.dots.firstChild) ui.dots.removeChild(ui.dots.firstChild);
    SCENES.forEach((sc, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', `Paisagem ${i + 1}: ${sc.place}`);
      b.addEventListener('click', () => goTo(i));
      li.appendChild(b);
      ui.dots.appendChild(li);
    });
  }

  ui.prev.addEventListener('click', () => goTo(idx - 1));
  ui.next.addEventListener('click', () => goTo(idx + 1));
  ui.play.addEventListener('click', () => setPaused(!paused));
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === 'ArrowRight') goTo(idx + 1);
    else if (e.key === 'ArrowLeft') goTo(idx - 1);
    else if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  });

  const onReduce = (e) => {
    reduced = e.matches;
    if (!reduced) build();
    dirty = true;
  };
  if (reducedMQ.addEventListener) reducedMQ.addEventListener('change', onReduce);

  let rzTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      const oldW = W;
      measure();
      build();
      trans = null;
      dirty = true;
    }, 160);
  });

  // ---------- grão do papel (gerado aqui, sem arquivo de imagem) ----------
  (function paperGrain() {
    const el = document.querySelector('.paper');
    if (!el) return;
    const size = 180, L = makeLayer(size, size, 1), c = L.c, r = rng(99);
    const img = c.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const g = 195 + r() * 60;
      img.data[i] = g; img.data[i + 1] = g * 0.97; img.data[i + 2] = g * 0.9; img.data[i + 3] = r() * 40;
    }
    c.putImageData(img, 0, 0);
    c.strokeStyle = 'rgba(90,83,76,0.10)';
    c.lineWidth = 0.6;
    for (let i = 0; i < 30; i++) {
      const x = r() * size, y = r() * size, a = r() * TAU, l = 4 + r() * 10;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 1, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      c.stroke();
    }
    el.style.backgroundImage = `url("${L.cv.toDataURL('image/png')}")`;
  })();

  // ---------- partida ----------
  measure();
  buildDots();
  goTo(0, true);
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
