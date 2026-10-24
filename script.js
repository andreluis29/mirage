/* Mirage — script.js
 * Paisagens do mundo desenhadas à mão (canvas) atravessadas por um viajante (SVG).
 * JavaScript puro: sem bibliotecas, sem eval, sem innerHTML, sem coleta de dados.
 *
 * Mapa do arquivo
 *   0. Paleta e utilidades (aleatório com semente, ruído)
 *   1. Lápis: traços tremidos, hachuras em lote
 *   2. Peças de desenho reutilizáveis (cordilheira, nuvem, pinheiro, névoa…)
 *  2b. Peças comuns às cenas (margem, reflexo, ondas, aves, capim, partículas)
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
   * 2b. Peças comuns às cenas (estáticas e animadas)
   * ================================================================ */

  /** Céu: riscos horizontais leves, mais densos no alto. */
  function skyStrokes(pen, W, y0, y1, dens = 0.5) {
    const S = pen.S, L = [];
    for (let y = y0; y < y1; y += 6 * pen.k) {
      const p = dens * (1 - (y - y0) / (y1 - y0));
      let x = -10;
      while (x < W) {
        const len = 30 + S() * 140;
        if (S() < p) L.push([x, y + S() * 2, x + len, y + (S() - 0.5) * 3]);
        x += len + 10 + S() * 60;
      }
    }
    pen.lines(L, { w: 0.6, col: PAL.g3, a: 0.4 });
  }

  /** Água parada: riscos longos, mais frequentes perto de quem olha. */
  function waterStrokes(pen, W, wY, y1, dens = 1) {
    const S = pen.S, L = [];
    for (let y = wY + 3; y < y1; y += 4 * pen.k) {
      const t = (y - wY) / (y1 - wY);
      let x = -10;
      while (x < W) {
        const len = 20 + S() * 120;
        if (S() < (0.2 + t * 0.45) * dens) L.push([x, y, x + len, y + (S() - 0.5) * 1.5]);
        x += len + S() * 50;
      }
    }
    pen.lines(L, { w: 0.6, col: PAL.g3, a: 0.45 });
  }

  /** Sol desenhado: disco de papel, contorno duplo e meia auréola. */
  function sunDisc(pen, sx, sy, r, rings = 1) {
    const c = pen.c;
    c.fillStyle = PAL.paper;
    c.beginPath();
    c.arc(sx, sy, r * 1.15, 0, TAU);
    c.fill();
    const circ = [];
    for (let a = 0; a <= TAU + 0.15; a += 0.08) circ.push([sx + Math.cos(a) * r, sy + Math.sin(a) * r]);
    pen.path(circ, { w: 1, col: PAL.g1, a: 0.85, gap: 0.01 });
    for (let i = 1; i <= rings; i++) {
      const rr = r * (1 + 0.35 * i), arc = [];
      for (let a = 0.6 - i * 0.3; a <= 2.6 + i * 0.3; a += 0.08) arc.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr]);
      pen.path(arc, { w: 0.6, col: PAL.g3, a: 0.7 / i, passes: 1 });
    }
  }

  /** Margem de terra: tom hachurado, trilha limpa, pedras, borda e capim. */
  function drawBank(pen, W, H, bankY, trailY, o = {}) {
    const c = pen.c, S = pen.S, k = pen.k;
    const top = sample(-6, W + 6, 3, bankY);
    const poly = new Path2D();
    poly.moveTo(-6, H + 6);
    top.forEach((p) => poly.lineTo(p[0], p[1]));
    poly.lineTo(W + 6, H + 6);
    poly.closePath();
    c.fillStyle = o.fill || PAL.paper;
    c.fill(poly);
    c.save();
    c.clip(poly);
    const tone = [], tone2 = [], dens = o.tone == null ? 1 : o.tone, ang0 = o.angle == null ? -1.1 : o.angle;
    const nCl = Math.round(((W * (H - bankY(W / 2))) / (60 * k * k)) * dens);
    for (let i = 0; i < nCl; i++) {
      const px = S() * W, py = bankY(px) + 3 + S() * (H - bankY(px));
      const t = (py - bankY(px)) / (H - bankY(px));
      if (S() > 0.35 + t * 0.6) continue;
      const ang = ang0 + (S() - 0.5) * 0.5, L = (5 + S() * 7) * k, n = 3 + Math.floor(S() * 4);
      for (let j = 0; j < n; j++) {
        const ox = px + j * 2.2 * k;
        (t > 0.55 ? tone2 : tone).push([ox, py, ox + Math.cos(ang) * L, py + Math.sin(ang) * L]);
      }
    }
    pen.lines(tone, { w: 0.65, col: PAL.g1, a: 0.5 });
    pen.lines(tone2, { w: 0.7, col: PAL.ink, a: 0.45 });
    if (trailY) {
      const trail = sample(-6, W + 6, 6, trailY);
      pen.path(trail, { w: 9, col: PAL.paper, a: 1, passes: 1, gap: 0, jit: 0.4 });
      pen.path(trail.map((p) => [p[0], p[1] - 4.5 * k]), { w: 0.6, col: PAL.g2, a: 0.7, passes: 1, gap: 0.25 });
      pen.path(trail.map((p) => [p[0], p[1] + 5 * k]), { w: 0.6, col: PAL.g2, a: 0.7, passes: 1, gap: 0.3 });
    }
    c.restore();
    const nRocks = o.rocks == null ? 6 : o.rocks;
    for (let i = 0; i < nRocks; i++) {
      const rx = W * (0.08 + i * (0.96 / nRocks) + S() * 0.08), r = (5 + S() * 9) * k;
      rock(pen, rx, bankY(rx) + 3 * k + S() * 6 * k, r);
    }
    pen.path(top, { w: 1.3, col: PAL.ink, a: 0.95, gap: 0.03, jit: 0.6 });
    if (o.grass !== false) {
      const grass = [];
      for (let x = -4; x < W + 4; x += 2.2) {
        if (S() < 0.55) {
          const y = bankY(x) + 1, h = (2 + S() * 8) * k * (S() < 0.1 ? 1.8 : 1);
          grass.push([x, y, x + (S() - 0.3) * 4 * k, y - h]);
        }
      }
      pen.lines(grass, { w: 0.7, col: PAL.ink, a: 0.75, wob: 0.5 });
    }
    return top;
  }

  /** Reflexo: faixas finas da camada, espelhadas, achatadas e onduladas. */
  function reflect(ctx, layer, wY, depth, t, k, o = {}) {
    const a = o.alpha == null ? 0.36 : o.alpha, comp = o.comp || 0.72, amp = o.amp || 1, sp = o.speed || 1;
    const lr = layer.res, srcH = (2 / comp) * lr;
    ctx.globalAlpha = a;
    for (let y = 0; y < depth; y += 2) {
      const sy = wY - (y + 2) / comp;
      if (sy < 0) break;
      const d = y / depth;
      const off = (Math.sin(y * 0.13 - t * 1.4 * sp) * 0.9 + Math.sin(y * 0.047 + t * 0.6 * sp) * 1.6) * (0.35 + d * 1.8) * k * amp;
      ctx.drawImage(layer.cv, 0, sy * lr, layer.cv.width, srcH, off, wY + y, layer.w, 2.2);
    }
    ctx.globalAlpha = 1;
  }

  /** Ondulações: traços curtos que derivam; alguns são brilhos de papel. */
  function makeRipples(seed, n, W, wY, depth, k) {
    const r = rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      const d = Math.pow(r(), 1.6);
      out.push({ x: r() * (W + 60) - 30, y: wY + 4 + d * (depth - 4), d, len: (5 + d * 55 + r() * 20) * k * 0.8, ph: r() * TAU, glint: r() < 0.22, b: i % 3 });
    }
    return out;
  }
  function drawRipples(ctx, rip, t, W, k, o = {}) {
    const sp = o.speed || 1, chop = o.chop || 0;
    const alphas = [0.22, 0.36, 0.5];
    const to = (r) => {
      const span = W + 60;
      const x = (((r.x + t * 2 * k * sp + Math.sin(t * 0.35 * sp + r.ph) * 6 * k * (0.4 + r.d)) % span) + span) % span - 30;
      const L = r.len * (0.75 + 0.25 * Math.sin(t * 0.9 * sp + r.ph * 2));
      const lift = chop ? (1.5 + chop * 2.5) * k * (0.5 + 0.5 * Math.sin(t * 3 * sp + r.ph * 3)) : 0;
      ctx.moveTo(x, r.y);
      ctx.quadraticCurveTo(x + L / 2, r.y + 0.8 * k * Math.sin(r.ph + t) - lift, x + L, r.y);
    };
    ctx.lineCap = 'round';
    for (let b = 0; b < 3; b++) {
      ctx.beginPath();
      for (const r of rip) if (r.b === b && !r.glint) to(r);
      ctx.strokeStyle = PAL.g1;
      ctx.globalAlpha = alphas[b];
      ctx.lineWidth = 0.9 * k;
      ctx.stroke();
    }
    ctx.beginPath();
    for (const r of rip) if (r.glint) to(r);
    ctx.strokeStyle = PAL.paper;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.4 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Aves em "m" batendo asas, atravessando o céu. dir = -1 voam para a esquerda. */
  function makeBirds(seed, n, W, H, y0, y1, k, o = {}) {
    const r = rng(seed), out = [];
    for (let i = 0; i < n; i++) {
      out.push({ x0: r() * W, y: H * (y0 + r() * (y1 - y0)), v: ((o.speed || 14) + r() * 10) * k, s: ((o.size || 5) + r() * 3) * k, f: 5 + r() * 3, ph: r() * TAU });
    }
    return out;
  }
  function drawBirds(ctx, birds, t, W, k, dir = -1) {
    ctx.beginPath();
    for (const b of birds) {
      const span = W + 200;
      const p = (((b.x0 + t * b.v) % span) + span) % span;
      const x = dir < 0 ? W + 100 - p : p - 100;
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
  }

  /** Nuvens cúmulo que derivam com o vento. */
  function makeClouds(seed, n, W, H, k, res, o = {}) {
    const size = o.size || Math.min(W * 0.3, H * 0.5);
    return Array.from({ length: n }, (_, i) => {
      const w = size * (0.75 + (i % 3) * 0.15), h = w * 0.42;
      return {
        L: cloudSprite(seed + i * 11, w, h, k, res), w, h,
        y: H * ((o.y0 == null ? 0.06 : o.y0) + i * (o.dy == null ? 0.075 : o.dy)),
        x0: W * (0.15 + i * 0.37), v: ((o.speed || 4) + i * 2.5) * k,
      };
    });
  }
  function drawClouds(ctx, clouds, t, W) {
    for (const cl of clouds) {
      const span = W + cl.w * 2;
      const x = (((cl.x0 + t * cl.v) % span) + span) % span - cl.w;
      ctx.drawImage(cl.L.cv, x, cl.y, cl.w, cl.h);
    }
  }

  function drawMist(ctx, m, t) {
    const w = m.L.w;
    const x = -((((t * m.v) % w) + w) % w);
    ctx.globalAlpha = m.a;
    ctx.drawImage(m.L.cv, x, m.y, w, m.L.h);
    ctx.drawImage(m.L.cv, x + w, m.y, w, m.L.h);
    ctx.globalAlpha = 1;
  }

  /** Capim alto animado: lâminas que dobram com o vento (desenhadas a cada quadro). */
  function makeGrass(seed, W, groundY, k, o = {}) {
    const r = rng(seed), out = [], step = (o.step || 2.6) * k;
    for (let x = -10; x < W + 10; x += step * (0.5 + r())) {
      const tall = r() < (o.tallP || 0.25);
      out.push({ x, y: groundY(x) + r() * (o.depth || 6) * k, h: ((o.h || 10) * (tall ? 1.8 : 1) * (0.5 + r())) * k, lean: (r() - 0.3) * 4 * k, ph: r() * TAU, b: tall ? 1 : 0 });
    }
    return out;
  }
  function drawGrass(ctx, blades, t, k, wind = 1, col = PAL.ink) {
    for (let b = 0; b < 2; b++) {
      ctx.beginPath();
      for (const g of blades) {
        if (g.b !== b) continue;
        const sway = (Math.sin(t * 2.2 * wind + g.x * 0.025 + g.ph * 0.3) * 0.6 + Math.sin(t * 5.1 + g.ph) * 0.15) * g.h * 0.35 * wind;
        const tx = g.x + g.lean + sway, ty = g.y - g.h + Math.abs(sway) * 0.3;
        ctx.moveTo(g.x, g.y);
        ctx.quadraticCurveTo(g.x + g.lean * 0.5, g.y - g.h * 0.55, tx, ty);
      }
      ctx.strokeStyle = col;
      ctx.globalAlpha = b ? 0.85 : 0.6;
      ctx.lineWidth = (b ? 0.9 : 0.7) * k;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Padrão de hachura para preencher figuras animadas (animais, balões). */
  function hatchPattern(ctx, bg, ink, gap = 3, angle = 0.7, w = 0.7) {
    const s = Math.max(4, Math.round(gap * 4));
    const L = makeLayer(s, s, 1), c = L.c;
    c.fillStyle = bg;
    c.fillRect(0, 0, s, s);
    c.strokeStyle = ink;
    c.lineWidth = w;
    c.beginPath();
    for (let i = -s; i <= s * 2; i += gap) { c.moveTo(i, 0); c.lineTo(i + s * Math.tan(angle), s); }
    c.stroke();
    return ctx.createPattern(L.cv, 'repeat');
  }

  /** Partículas que caem/derivam em laço (neve, chuva, pétalas, areia). */
  function makeParticles(seed, n) {
    const r = rng(seed);
    return Array.from({ length: n }, () => ({ x: r(), y: r(), v: 0.6 + r() * 0.8, s: 0.6 + r() * 0.8, ph: r() * TAU }));
  }
  const wrap = (v, m) => ((v % m) + m) % m;

  /** Gerencia variantes de "boil": paint(seedJ) desenha uma variante de cada camada animada. */
  function withVariants(st, paint, max = 3) {
    st.count = 0;
    st.addVariant = () => {
      if (st.count >= max) return false;
      paint(1000 + st.count * 97);
      st.count++;
      return st.count < max;
    };
    st.addVariant();
    return st;
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
   *        wind                   (opcional) força do vento no cachecol do viajante
   *    env = { W, H, res, k, ctx }: tamanho em px CSS, densidade de pixels, escala do traço, contexto principal
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
      const bottomWater = H * 0.87, depth = bottomWater - wY;

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
        const pen = new Pencil(sky.c, 55, 56, k);
        sky.c.fillStyle = PAL.paper;
        sky.c.fillRect(0, 0, W, H);
        skyStrokes(pen, W, H * 0.015, H * 0.3);
        sunDisc(pen, W * (portrait ? 0.62 : 0.3), H * (portrait ? 0.27 : 0.2), Math.min(W, H) * 0.045);
        waterStrokes(pen, W, wY, bottomWater);
      }

      // ---- nuvens, névoa, barco, respingo, ondas, aves ----
      const clouds = makeClouds(31, 3, W, H, k, res);
      const mistLow = { L: mistSprite(71, Math.ceil(W * 1.5), Math.ceil(H * 0.11)), y: wY - H * 0.075, v: 7 * k, a: portrait ? 0.6 : 0.9 };
      const mistHigh = { L: mistSprite(72, Math.ceil(W * 1.5), Math.ceil(H * 0.08), 40), y: H * 0.36, v: -4 * k, a: 0.7 };
      const puff = puffSprite(Math.ceil(26 * k), Math.ceil(12 * k));
      const bw = 34 * k, bh = 40 * k;
      const boat = boatSprite(bw, bh, k, res);
      const ripples = makeRipples(707, 240, W, wY, depth, k);
      const birds = makeBirds(808, 5, W, H, 0.12, 0.26, k);

      const st = { W, H, wY, land: [], fg: [], wind: 0.8 };

      // ---- variantes de "boil": terra (montanhas) e primeiro plano ----
      withVariants(st, (seedJ) => {
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
        const pf = new Pencil(fg.c, 88, seedJ + 5, k);
        drawBank(pf, W, H, bankY, trailY);
        const tf = portrait ? 0.8 : 1;
        spruce(pf, W * 0.03, H * 1.02, H * 0.46 * tf, H * 0.15 * tf);
        spruce(pf, W * 0.84, H * 0.99, H * 0.25 * tf, H * 0.085 * tf);
        spruce(pf, W * 0.92, H * 1.03, H * 0.52 * tf, H * 0.17 * tf);
        spruce(pf, W * 0.99, H * 1.02, H * 0.4 * tf, H * 0.13 * tf);
        st.fg.push(fg);
      });

      st.ground = trailY;

      st.draw = (ctx, t, v) => {
        const land = st.land[v] || st.land[0];
        const fg = st.fg[v] || st.fg[0];
        ctx.drawImage(sky.cv, 0, 0, W, H);
        drawClouds(ctx, clouds, t, W);
        ctx.drawImage(land.cv, 0, 0, W, H);
        drawMist(ctx, mistHigh, t);
        reflect(ctx, land, wY, depth, t, k);
        drawRipples(ctx, ripples, t, W, k);

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
        const bx = W * 1.12 - wrap(t * 9 * k + W * 0.45, span);
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
        drawBirds(ctx, birds, t, W, k);
        ctx.drawImage(fg.cv, 0, 0, W, H);
      };

      return st;
    },
  };

  /* ---------- Cena II · Monte Fuji (Lago Kawaguchi, Japão) ---------- */

  /** Cerejeira: galhos recursivos em tinta escura e cachos de flores miúdas. */
  function cherryTree(pen, x0, y0, sc, ang0) {
    const c = pen.c, S = pen.S, J = pen.J, segs = [], clusters = [];
    const grow = (x, y, ang, len, w, depth) => {
      let px = x, py = y, a = ang;
      for (let i = 0; i < 4; i++) {
        a += (S() - 0.5) * 0.35;
        const nx = px + (Math.cos(a) * len) / 4, ny = py + (Math.sin(a) * len) / 4;
        segs.push([px, py, nx, ny, w * (1 - i * 0.08)]);
        px = nx; py = ny;
      }
      if (depth <= 0) { clusters.push([px, py, (16 + S() * 16) * sc]); return; }
      const n = 2 + (S() < 0.4 ? 1 : 0);
      for (let j = 0; j < n; j++) {
        grow(px, py, a + (j - (n - 1) / 2) * 0.62 + (S() - 0.5) * 0.3, len * (0.62 + S() * 0.16), w * 0.64, depth - 1);
      }
      if (depth < 3 && S() < 0.6) clusters.push([px, py, (12 + S() * 12) * sc]);
    };
    grow(x0, y0, ang0, 170 * sc, 18 * sc, 5);

    c.lineCap = 'round';
    c.strokeStyle = PAL.ink;
    c.globalAlpha = 0.92;
    for (const [x1, y1, x2, y2, w] of segs) {
      c.lineWidth = Math.max(0.8, w);
      c.beginPath();
      c.moveTo(x1 + (J() - 0.5), y1);
      c.lineTo(x2 + (J() - 0.5), y2);
      c.stroke();
    }
    c.globalAlpha = 1;
    const light = [];
    for (const [x1, y1, x2, y2, w] of segs) if (w > 4) light.push([x1 - w * 0.25, y1, x2 - w * 0.25, y2]);
    pen.lines(light, { w: 0.8, col: PAL.g3, a: 0.7 });

    const fl = [];
    for (const [cx, cy, r] of clusters) {
      const n = Math.round((r * r) / (14 * sc * sc)) + 5;
      for (let i = 0; i < n; i++) {
        const a = S() * TAU, d = Math.sqrt(S()) * r;
        fl.push([cx + Math.cos(a) * d * 1.25, cy + Math.sin(a) * d * 0.8, (2 + S() * 2) * sc]);
      }
    }
    c.beginPath();
    for (const [x, y, r] of fl) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
    c.fillStyle = PAL.paper;
    c.fill();
    c.strokeStyle = PAL.g1;
    c.lineWidth = 0.6 * pen.k;
    c.globalAlpha = 0.6;
    c.stroke();
    c.globalAlpha = 1;
    const sh = [], dots = [];
    for (const [x, y, r] of fl) {
      if (S() < 0.25) sh.push([x - r, y + r * 0.6, x + r * 0.3, y + r * 1.4]);
      if (S() < 0.3) dots.push([x, y, x + 0.4, y + 0.4]);
    }
    pen.lines(sh, { w: 0.6, col: PAL.g2, a: 0.6 });
    pen.lines(dots, { w: 1, col: PAL.g1, a: 0.7, wob: 0 });
  }

  /** Pagode de cinco andares (Chureito), telhados com pontas viradas. */
  function pagoda(pen, x, baseY, h) {
    const c = pen.c, th = h * 0.16, w0 = h * 0.5;
    let y = baseY;
    pen.lines([[x - w0 * 0.32, y, x + w0 * 0.32, y]], { w: 1.2, col: PAL.ink });
    for (let i = 0; i < 5; i++) {
      const f = 1 - i * 0.12, bw = w0 * 0.42 * f, rw = w0 * f;
      const by = y - th * 0.55;
      c.fillStyle = PAL.paper;
      c.fillRect(x - bw / 2, by, bw, y - by);
      pen.lines([[x - bw / 2, y, x - bw / 2, by], [x + bw / 2, y, x + bw / 2, by], [x - bw / 6, y, x - bw / 6, by], [x + bw / 6, y, x + bw / 6, by]], { w: 0.7, col: PAL.ink, a: 0.85, wob: 0.3 });
      const rh = th * 0.5, roof = [
        [x - rw / 2, by - rh * 0.55], [x - rw * 0.32, by - rh * 0.05], [x - bw * 0.5, by + 1],
        [x + bw * 0.5, by + 1], [x + rw * 0.32, by - rh * 0.05], [x + rw / 2, by - rh * 0.55],
        [x + rw * 0.17, by - rh], [x - rw * 0.17, by - rh],
      ];
      const p = new Path2D();
      roof.forEach((q, j) => (j ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
      p.closePath();
      c.fillStyle = PAL.g1;
      c.fill(p);
      pen.path([...roof, roof[0]], { w: 0.8, col: PAL.ink, passes: 1, jit: 0.2 });
      y = by - rh * 0.85;
    }
    const top = y - h * 0.24, rings = [];
    for (let i = 1; i < 8; i++) { const yy = y - (h * 0.22 * i) / 8; rings.push([x - 1.6 * pen.k, yy, x + 1.6 * pen.k, yy]); }
    pen.lines([[x, y, x, top], ...rings], { w: 0.8, col: PAL.ink, wob: 0.2 });
  }

  /** Lanterna de pedra (tōrō). */
  function stoneLantern(pen, x, baseY, h) {
    const c = pen.c;
    const parts = [ // [altura, largura] de baixo para cima (frações de h)
      [0.1, 0.42], [0.34, 0.13], [0.07, 0.36], [0.19, 0.25], [0.13, 0.52], [0.07, 0.1],
    ];
    let y = baseY;
    parts.forEach(([ph, pw], i) => {
      const hh = ph * h, ww = pw * h, top = y - hh;
      let pts;
      if (i === 4) pts = [[x - ww / 2, y - hh * 0.25], [x - ww * 0.1, top], [x + ww * 0.1, top], [x + ww / 2, y - hh * 0.25], [x + ww * 0.42, y], [x - ww * 0.42, y]];
      else if (i === 5) pts = Array.from({ length: 13 }, (_, j) => { const a = (j / 12) * TAU; return [x + Math.cos(a) * ww / 2, top + hh / 2 + Math.sin(a) * hh / 2]; });
      else pts = [[x - ww / 2, y], [x - ww / 2, top], [x + ww / 2, top], [x + ww / 2, y]];
      const p = new Path2D();
      pts.forEach((q, j) => (j ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
      p.closePath();
      c.fillStyle = PAL.paper;
      c.fill(p);
      c.save();
      c.clip(p);
      const hs = [];
      for (let xx = x; xx < x + ww; xx += 1.8 * pen.k) hs.push([xx, y, xx - hh * 0.3, top]);
      pen.lines(hs, { w: 0.55, col: PAL.g1, a: 0.6 });
      if (i === 3) { c.fillStyle = PAL.ink; c.fillRect(x - ww * 0.22, top + hh * 0.25, ww * 0.44, hh * 0.45); }
      c.restore();
      pen.path([...pts, pts[0]], { w: 0.9, col: PAL.ink, passes: 2, jit: 0.3 });
      y = top;
    });
  }

  const Fuji = {
    id: 'fuji',
    numeral: 'II',
    place: 'Monte Fuji',
    meta: 'Japão · 35°21′N 138°43′E',
    mood: 'delicada, serena',
    duration: 28,
    stopAt: 0.5,
    stopAtPortrait: 0.36,

    build(env) {
      const { W, H, res, k } = env;
      const portrait = H > W * 1.1;
      const hf = portrait ? 0.82 : 1;
      const wY = H * (portrait ? 0.6 : 0.62), bottomWater = H * 0.87, depth = bottomWater - wY;
      const nF = noise1(rng(1101)), nS = noise1(rng(1102)), nH = noise1(rng(1103)), nB = noise1(rng(1104));

      const cx = W * (portrait ? 0.5 : 0.44);
      const R = Math.max(W * 0.48, H * 0.5) * (portrait ? 1.15 : 1);
      const Hpk = H * 0.4 * hf;
      const fujiY = (x) => {
        const d = Math.abs(x - cx) / R, dd = Math.max(0, d - 0.035);
        if (dd >= 1) return wY + 2;
        const crater = d < 0.035 ? H * 0.003 * Math.sin(x * 0.35) : 0;
        return wY - Hpk * Math.pow(1 - dd, 1.9) + H * 0.004 * fbm(nF, x * 0.05) + crater;
      };
      // linha de neve em altura absoluta, com "dedos" de neve descendo pelas ravinas
      const snowY = (x) => Math.max(fujiY(x) + 2, wY - Hpk * (0.66 + 0.03 * nS(x * 0.02)) + Hpk * 0.16 * Math.pow(Math.max(0, nS(x * 0.07 + 3)), 2));
      const hills = (x) => {
        const u = x / W;
        return wY - H * hf * (0.035 + 0.06 * bell(u, 0.12, 0.13) + 0.035 * bell(u, 0.86, 0.14) + 0.012 * fbm(nH, u * 30));
      };
      const bankY = (x) => H * (portrait ? 0.85 : 0.84) + H * 0.01 * Math.sin((x / W) * 3.1 + 1.2) + H * 0.006 * fbm(nB, x * 0.01);
      const trailY = (x) => bankY(x) + H * 0.036;
      const fujiPts = sample(-6, W + 6, 3, fujiY);
      const hillPts = sample(-6, W + 6, 3, hills);
      const pagX = W * (portrait ? 0.16 : 0.15);

      const sky = makeLayer(W, H, res);
      {
        const pen = new Pencil(sky.c, 1150, 1151, k);
        sky.c.fillStyle = PAL.paper;
        sky.c.fillRect(0, 0, W, H);
        skyStrokes(pen, W, H * 0.01, H * 0.28, 0.4);
        sunDisc(pen, W * (portrait ? 0.78 : 0.74), H * 0.16, Math.min(W, H) * 0.035, 1);
        waterStrokes(pen, W, wY, bottomWater);
      }

      const clouds = makeClouds(1160, 2, W, H, k, res, { y0: 0.05, dy: 0.06, size: Math.min(W * 0.22, H * 0.4), speed: 3 });
      const band = { L: mistSprite(1170, Math.ceil(W * 1.5), Math.ceil(H * 0.07), 55), y: wY - Hpk * 0.62, v: 6 * k, a: 0.95 };
      const mistLow = { L: mistSprite(1171, Math.ceil(W * 1.5), Math.ceil(H * 0.08)), y: wY - H * 0.05, v: -5 * k, a: 0.7 };
      const ripples = makeRipples(1180, 200, W, wY, depth, k);
      const birds = makeBirds(1190, 3, W, H, 0.14, 0.3, k);
      const petals = makeParticles(1199, portrait ? 45 : 70);

      const st = { W, H, wY, land: [], fg: [], wind: 0.7 };
      withVariants(st, (seedJ) => {
        const land = makeLayer(W, H, res), c = land.c;
        const pen = new Pencil(c, 1200, seedJ, k), S = pen.S;

        // o cone: neve no alto, rocha hachurada embaixo, floresta na base
        const poly = new Path2D();
        poly.moveTo(-6, wY + 2);
        fujiPts.forEach((p) => poly.lineTo(p[0], p[1]));
        poly.lineTo(W + 6, wY + 2);
        poly.closePath();
        c.fillStyle = '#ECE5D7';
        c.fill(poly);
        c.save();
        c.clip(poly);
        const fall = [], hatch = [], gul = [], snowSh = [], ticks = [];
        for (let i = 1; i < fujiPts.length - 1; i++) {
          const [x, y] = fujiPts[i];
          if (y >= wY - 2) continue;
          const sy = Math.min(snowY(x), wY), slope = (fujiPts[i + 1][1] - fujiPts[i - 1][1]) / 6;
          const shadow = x > cx, s = shadow ? 0.62 + 0.2 * nF(x * 0.02) : 0.25 + 0.15 * nF(x * 0.02);
          if (sy < wY - 4 && S() < 0.75) {
            const L = (wY - sy) * (0.12 + S() * 0.5), ang = Math.PI / 2 - Math.atan(slope) * 0.85 + (S() - 0.5) * 0.15;
            fall.push([x, sy + S() * 3, x + Math.cos(ang) * L, sy + Math.sin(ang) * L]);
          }
          if (shadow && S() < s) {
            const L = (wY - sy) * (0.2 + S() * 0.6);
            hatch.push([x, sy + 2, x - L * 0.4, sy + 2 + L]);
          }
          if (S() < 0.16) {
            const L = (sy - y) * (0.3 + S() * 0.6);
            gul.push([x, y + 2, x + (shadow ? 1 : -1) * L * 0.12, y + 2 + L]);
          }
          if (shadow && S() < 0.45) snowSh.push([x, y + 3, x - (sy - y) * 0.25, sy - 2]);
          if (S() < 0.9) { const yy = wY - S() * Hpk * 0.13, hh = (2 + S() * 4) * k; ticks.push([x, yy, x, yy - hh]); }
        }
        pen.lines(snowSh, { w: 0.6, col: PAL.g3, a: 0.55 });
        pen.lines(gul, { w: 0.6, col: PAL.g2, a: 0.6 });
        pen.lines(fall, { w: 0.7, col: PAL.g1, a: 0.5 });
        pen.lines(hatch, { w: 0.7, col: PAL.g1, a: 0.5 });
        pen.lines(ticks, { w: 0.8, col: PAL.g1, a: 0.6, wob: 0.3 });
        c.restore();
        const snowLine = fujiPts.filter((p) => snowY(p[0]) > p[1] + 3).map((p) => [p[0], snowY(p[0])]);
        pen.path(snowLine, { w: 0.7, col: PAL.g2, a: 0.8, passes: 1, gap: 0.12 });
        pen.path(fujiPts.filter((p) => p[1] < wY), { w: 1.1, col: PAL.g1, a: 0.95, gap: 0.02 });

        // colinas com floresta e o pagode
        drawRange(pen, {
          pts: hillPts, base: wY + 1, fill: '#E6DDCD', hatchCol: PAL.g1, hatchA: 0.5, fallA: 0.45,
          fallEvery: 2, fallDensity: 0.7, hatchEvery: 1, hatchFrom: 0.5, crossFrom: 0.8,
          bandH: H * 0.02, bandA: 0.4, forest: 0.85, lineW: 1.1, lineCol: PAL.g1, lineA: 0.95,
          shade: (x, y, sl) => 0.45 + 0.3 * Math.tanh(sl * 2) + 0.3 * nH(x * 0.02),
        });
        pagoda(pen, pagX, hills(pagX) + 2 * k, H * 0.13 * hf);
        pen.path(sample(-4, W + 4, 6, () => wY), { w: 0.9, col: PAL.g1, a: 0.8, gap: 0.08, jit: 0.5 });
        st.land.push(land);

        const fg = makeLayer(W, H, res);
        const pf = new Pencil(fg.c, 1300, seedJ + 5, k);
        drawBank(pf, W, H, bankY, trailY, { rocks: 4 });
        stoneLantern(pf, W * (portrait ? 0.2 : 0.24), bankY(W * 0.24) + 6 * k, H * 0.14);
        const sc = portrait ? H / 1400 : H / 820;
        cherryTree(pf, W * (portrait ? 1.04 : 0.97), H * 1.02, sc, -Math.PI / 2 - (portrait ? 0.45 : 0.32));
        st.fg.push(fg);
      });

      st.ground = trailY;
      st.draw = (ctx, t, v) => {
        const land = st.land[v] || st.land[0], fg = st.fg[v] || st.fg[0];
        ctx.drawImage(sky.cv, 0, 0, W, H);
        drawClouds(ctx, clouds, t, W);
        ctx.drawImage(land.cv, 0, 0, W, H);
        drawMist(ctx, band, t);
        reflect(ctx, land, wY, depth, t, k, { alpha: 0.4, amp: 0.8 });
        drawRipples(ctx, ripples, t, W, k, { speed: 0.8 });
        drawMist(ctx, mistLow, t);
        drawBirds(ctx, birds, t, W, k, 1);
        ctx.drawImage(fg.cv, 0, 0, W, H);

        // pétalas soltas no vento
        ctx.beginPath();
        for (const p of petals) {
          const x = wrap(p.x * W * 1.3 - t * (14 + 20 * p.v) * k + Math.sin(t * 0.8 + p.ph) * 25 * k, W + 60) - 30;
          const y = wrap(p.y * H + t * (12 + 14 * p.v) * k, H + 40) - 20;
          const s = 2.6 * p.s * k, rot = t * 1.5 * p.v + p.ph;
          ctx.moveTo(x + Math.cos(rot) * s, y + Math.sin(rot) * s);
          ctx.ellipse(x, y, s, s * 0.55, rot, 0, TAU);
        }
        ctx.fillStyle = PAL.paper;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.strokeStyle = PAL.g1;
        ctx.lineWidth = 0.6 * k;
        ctx.globalAlpha = 0.8;
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      return st;
    },
  };

  /* ---------- Cena III · Saara (Erg Chebbi, Marrocos) ---------- */

  /**
   * Campo de dunas: barlavento suave à esquerda, crista afiada e face de
   * deslizamento íngreme à direita (o vento sopra da esquerda).
   */
  function duneField(list, base) {
    return (x) => {
      let h = 0;
      for (const d of list) {
        const dx = x - d.c;
        let v = 0;
        if (dx < 0) { const t = 1 + dx / d.wl; if (t > 0) v = Math.pow(smooth(0, 1, t), 1.15); }
        else { const t = dx / d.wr; if (t < 1) v = Math.pow(1 - t, 1.3); }
        if (v * d.h > h) h = v * d.h;
      }
      return base - h;
    };
  }
  function randomDunes(seed, n, W, H, hMin, hMax, wl, wr) {
    const r = rng(seed), Wd = Math.max(W, H * 0.8); // no retrato as dunas não afinam
    return Array.from({ length: n }, (_, i) => ({
      c: W * ((i + 0.2 + r() * 0.6) / Math.max(1, n - 1)) - W * 0.08,
      h: H * (hMin + r() * (hMax - hMin)),
      wl: Wd * wl * (0.7 + r() * 0.6),
      wr: Wd * wr * (0.7 + r() * 0.6),
    }));
  }
  /** Cristas (pontos mais altos) de um campo de dunas, para soltar areia ao vento. */
  const crestsOf = (list, f) => list.map((d) => [d.c, f(d.c)]);

  /** Dromedário de perfil, pernas em passo; rider = com cavaleiro. */
  function drawCamel(ctx, x, y, sc, ph, rider, pat) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const [lx, o] of [[-6, 0], [-3.5, Math.PI], [6, Math.PI], [8.5, 0]]) {
      const sw = Math.sin(ph + o) * 3;
      ctx.moveTo(lx, -14);
      ctx.lineTo(lx + sw * 0.4, -7);
      ctx.lineTo(lx + sw, 0);
    }
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const body = [[-9.5, -18], [-8, -21], [-4, -29], [1, -29.5], [4.5, -22], [8, -20], [11, -21], [13, -27], [15.5, -29.5],
      [19.5, -28.6], [20, -26.8], [16, -26], [13.6, -18.6], [11, -14], [2, -12.6], [-7, -13.4]];
    ctx.beginPath();
    body.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = pat;
    ctx.fill();
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9.5, -18);
    ctx.quadraticCurveTo(-11.5, -15, -10.6, -11);
    ctx.stroke();
    if (rider) {
      ctx.beginPath();
      ctx.moveTo(-3.5, -29);
      ctx.lineTo(-1.2, -38);
      ctx.lineTo(1.6, -29);
      ctx.closePath();
      ctx.fillStyle = PAL.g1;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-0.8, -39.6, 1.9, 0, TAU);
      ctx.fillStyle = PAL.ink;
      ctx.fill();
    }
    ctx.restore();
  }

  const Sahara = {
    id: 'saara',
    numeral: 'III',
    place: 'Erg Chebbi, Saara',
    meta: 'Marrocos · 31°08′N 4°01′W',
    mood: 'vasta, quente, silenciosa',
    duration: 28,
    stopAt: 0.45,
    stopAtPortrait: 0.45,

    build(env) {
      const { W, H, res, k } = env;
      const portrait = H > W * 1.1;
      const hY = H * (portrait ? 0.56 : 0.58);          // horizonte
      const farL = randomDunes(2101, portrait ? 6 : 9, W, H, 0.02, 0.06, 0.13, 0.05);
      const midL = randomDunes(2102, portrait ? 3 : 4, W, H, 0.07, 0.14, 0.26, 0.1);
      const nearL = [
        { c: W * 0.45, h: H * 0.14, wl: W * 0.75, wr: W * 0.36 },
        { c: W * 1.15, h: H * 0.12, wl: W * 0.45, wr: W * 0.3 },
      ];
      const far = duneField(farL, hY + 1);
      const mid = duneField(midL, H * 0.74);
      const near = duneField(nearL, H * 0.92);
      const farPts = sample(-6, W + 6, 3, far), midPts = sample(-6, W + 6, 3, mid), nearPts = sample(-6, W + 6, 3, near);
      const shadeDune = (base, n) => (x, y, sl) => base + 0.95 * smooth(0.04, 0.35, sl) + 0.1 * n(x * 0.02);
      const nD = noise1(rng(2103));
      const crests = [...crestsOf(midL, mid).filter((c) => c[1] < H * 0.74 - 4), ...crestsOf(nearL, near)].filter((c) => c[0] > -20 && c[0] < W + 20);

      const sky = makeLayer(W, H, res);
      {
        const pen = new Pencil(sky.c, 2150, 2151, k), S = pen.S;
        sky.c.fillStyle = PAL.paper;
        sky.c.fillRect(0, 0, W, H);
        skyStrokes(pen, W, H * 0.01, H * 0.22, 0.3);
        sunDisc(pen, W * (portrait ? 0.62 : 0.68), H * (portrait ? 0.3 : 0.28), Math.min(W, H) * 0.085, 3);
        // chão plano até o horizonte: traços finos e horizontais
        const L = [];
        for (let y = hY + 2; y < H; y += 5 * k) {
          let x = -10;
          while (x < W) { const len = 20 + S() * 90; if (S() < 0.35) L.push([x, y, x + len, y + (S() - 0.5)]); x += len + S() * 60; }
        }
        pen.lines(L, { w: 0.5, col: PAL.g3, a: 0.45 });
      }

      const pat = hatchPattern(env.ctx, PAL.g2, PAL.ink, 2.2, 0.6, 0.6);
      const sand = makeParticles(2190, portrait ? 90 : 160);
      const camels = [0, 1, 2, 3, 4];
      const camelSc = clamp(H / 900, 0.6, 1.3) * (portrait ? 0.85 : 1);

      const st = { W, H, far: [], mid: [], fg: [], wind: 1.5 };
      withVariants(st, (seedJ) => {
        const fl = makeLayer(W, H, res);
        const pen = new Pencil(fl.c, 2200, seedJ, k);
        drawRange(pen, {
          pts: farPts, base: hY + 2, fill: '#EEE7DA', hatchCol: PAL.g2, hatchA: 0.45, fallA: 0.3,
          fallEvery: 3, fallDensity: 0.25, hatchEvery: 1, hatchFrom: 0.45, crossFrom: 0.95, strata: 6,
          lineW: 0.8, lineCol: PAL.g2, lineA: 0.9, shade: shadeDune(0.05, nD),
        });
        st.far.push(fl);

        const ml = makeLayer(W, H, res);
        const pm = new Pencil(ml.c, 2300, seedJ + 1, k);
        drawRange(pm, {
          pts: midPts, base: H * 0.75, fill: '#EFE8DB', hatchCol: PAL.g1, hatchA: 0.6, fallA: 0.35,
          fallEvery: 2, fallDensity: 0.45, hatchEvery: 1, hatchFrom: 0.3, crossFrom: 0.62, strata: 9,
          bandH: H * 0.025, bandStep: 3, bandA: 0.25,
          lineW: 1, lineCol: PAL.g1, lineA: 0.95, shade: shadeDune(0.04, nD), maxFall: H * 0.05,
        });
        st.mid.push(ml);

        // duna próxima: onde o viajante caminha
        const fg = makeLayer(W, H, res), c = fg.c;
        const pf = new Pencil(c, 2400, seedJ + 2, k), S = pf.S;
        const poly = new Path2D();
        poly.moveTo(-6, H + 6);
        nearPts.forEach((p) => poly.lineTo(p[0], p[1]));
        poly.lineTo(W + 6, H + 6);
        poly.closePath();
        c.fillStyle = '#F0E9DC';
        c.fill(poly);
        c.save();
        c.clip(poly);
        const hatch = [], cross = [], marks = [];
        for (let i = 1; i < nearPts.length - 1; i++) {
          const [x, y] = nearPts[i];
          const sl = (nearPts[i + 1][1] - nearPts[i - 1][1]) / 6;
          const s = smooth(0.04, 0.3, sl);
          if (s > 0.2) {
            const L = (H - y) * (0.4 + S() * 0.6) * s;
            hatch.push([x, y + 1, x - L * 0.35, y + 1 + L]);
            if (s > 0.6 && S() < 0.6) cross.push([x - L * 0.2, y + L * 0.1, x + L * 0.15, y + L * 0.7]);
          }
        }
        // marcas de vento na areia (ondinhas paralelas)
        for (let i = 0; i < (portrait ? 140 : 260); i++) {
          const x = S() * W, top = near(x), y = top + 6 * k + S() * (H - top) * 0.9;
          const sl = (near(x + 3) - near(x - 3)) / 6;
          if (sl > 0.08) continue;
          const len = (18 + S() * 40) * k, tilt = sl * 0.8;
          const seg = [];
          for (let j = 0; j <= 8; j++) { const f = j / 8; seg.push([x + f * len, y + f * len * tilt + Math.sin(f * Math.PI) * -1.5 * k]); }
          marks.push(seg);
        }
        // volume do barlavento: tom suave que escurece em direção ao vale
        const body = [];
        for (let i = 0; i < nearPts.length; i += 2) {
          const [x, y] = nearPts[i];
          const sl = (near(x + 3) - near(x - 3)) / 6;
          if (sl > 0.08) continue;
          const d = H - y;
          for (let j = 0; j < 2; j++) {
            if (S() < 0.5) continue;
            const y0 = y + d * (0.35 + S() * 0.5), L = d * (0.1 + S() * 0.25);
            body.push([x, y0, x + L * 0.9, y0 + L * 0.35]);
          }
        }
        pf.lines(body, { w: 0.6, col: PAL.g2, a: 0.35 });
        pf.lines(hatch, { w: 0.7, col: PAL.ink, a: 0.45 });
        pf.lines(cross, { w: 0.6, col: PAL.ink, a: 0.3 });
        for (const m of marks) pf.path(m, { w: 0.7, col: PAL.g1, a: 0.55, passes: 1, gap: 0, jit: 0.3 });
        c.restore();
        pf.path(nearPts, { w: 1.3, col: PAL.ink, a: 0.95, gap: 0.02, jit: 0.5 });
        st.fg.push(fg);
      });

      st.ground = (x) => near(x) + 2 * k;

      st.draw = (ctx, t, v) => {
        const fl = st.far[v] || st.far[0], ml = st.mid[v] || st.mid[0], fg = st.fg[v] || st.fg[0];
        ctx.drawImage(sky.cv, 0, 0, W, H);

        // miragem: o horizonte tremula com o calor e se espelha como água
        const lr = fl.res, band = H * 0.11;
        for (let y = hY - band; y < hY + 2; y += 3) {
          const q = 1 - (hY - y) / band;
          const off = (Math.sin(y * 0.22 + t * 3.1) + 0.5 * Math.sin(y * 0.61 - t * 4.3)) * 1.6 * k * q;
          ctx.drawImage(fl.cv, 0, y * lr, fl.cv.width, 3 * lr, off, y, W, 3.2);
        }
        ctx.drawImage(fl.cv, 0, 0, fl.cv.width, (hY - band) * lr, 0, 0, W, hY - band);
        ctx.globalAlpha = 0.28;
        const mir = H * 0.035;
        for (let y = 0; y < mir; y += 2) {
          const off = Math.sin(y * 0.5 + t * 3.6) * 2.2 * k;
          ctx.drawImage(fl.cv, 0, (hY - (y + 2) / 0.6) * lr, fl.cv.width, (2 / 0.6) * lr, off, hY + y, W, 2.2);
        }
        ctx.globalAlpha = 1;

        ctx.drawImage(ml.cv, 0, 0, W, H);

        // caravana atravessando a crista do meio
        const span = W + 320;
        camels.forEach((i) => {
          const x = wrap(t * 7 * k + W * 0.35 - i * 30 * camelSc, span) - 160;
          drawCamel(ctx, x, mid(x) + 1, camelSc * 0.9, t * 4.2 + i * 1.3, i % 2 === 0, pat);
        });

        ctx.drawImage(fg.cv, 0, 0, W, H);

        // areia soprada das cristas
        if (crests.length) {
          for (let b = 0; b < 3; b++) {
            ctx.beginPath();
            sand.forEach((p, i) => {
              if (i % 3 !== b) return;
              const cr = crests[i % crests.length], L = 70 * k * p.s + 30 * k;
              const a = wrap(t * 22 * k * p.v + p.ph * L, L) / L;
              const x = cr[0] + a * L * 1.4, y = cr[1] - 2 + a * L * 0.18 + Math.sin(t * 3 + p.ph) * 2 * k;
              ctx.moveTo(x, y);
              ctx.lineTo(x + 2.5 * k, y + 0.3);
            });
            ctx.strokeStyle = PAL.g1;
            ctx.globalAlpha = [0.55, 0.38, 0.22][b];
            ctx.lineWidth = 0.8 * k;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      };
      return st;
    },
  };

  /* ---------- Cena IV · Torres del Paine (Patagônia, Chile) ---------- */

  /** Torre de granito: lados quase verticais, topo arredondado, estrias e sombra à direita. */
  function graniteTower(pen, cx, baseY, topY, w, seed) {
    const c = pen.c, S = pen.S, n = noise1(rng(seed)), h = baseY - topY;
    const left = [], right = [];
    for (let i = 0; i <= 24; i++) {
      const f = i / 24, y = baseY - f * h;
      const wf = (1 - f * 0.3) * (f > 0.82 ? Math.sqrt(Math.max(0, (1 - f) / 0.18)) : 1);
      left.push([cx - (w / 2) * wf + n(f * 6) * w * 0.07, y]);
      right.push([cx + (w / 2) * wf + n(f * 6 + 9) * w * 0.07, y]);
    }
    const pts = [...left, ...right.reverse()];
    const p = new Path2D();
    pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    p.closePath();
    c.fillStyle = '#E9E1D2';
    c.fill(p);
    c.save();
    c.clip(p);
    const st = [], cracks = [], dark = [];
    for (let x = cx - w * 0.6; x < cx + w * 0.6; x += 2.4 * pen.k) {
      const sh = clamp((x - cx) / w + 0.5, 0, 1);
      let y = topY - 4;
      while (y < baseY) {
        const L = h * (0.05 + S() * 0.25);
        if (S() < 0.2 + sh * 0.75) st.push([x + (S() - 0.5), y, x + (S() - 0.5) * 2, y + L]);
        y += L + S() * h * 0.08;
      }
      if (sh > 0.45 && S() < 0.85) dark.push([x, topY, x - w * 0.12, baseY]);
    }
    for (let i = 0; i < 6; i++) { const y = topY + h * (0.2 + S() * 0.75), x = cx - w * 0.4 + S() * w * 0.5; cracks.push([x, y, x + w * (0.1 + S() * 0.25), y + (S() - 0.5) * 4]); }
    pen.lines(st, { w: 0.65, col: PAL.g1, a: 0.6 });
    pen.lines(dark, { w: 0.65, col: PAL.ink, a: 0.5 });
    pen.lines(cracks, { w: 0.6, col: PAL.g1, a: 0.6 });
    c.restore();
    pen.path([...pts, pts[0]], { w: 1.2, col: PAL.ink, a: 0.95, gap: 0.03, jit: 0.4 });
  }

  /** Nuvem lenticular: lentes empilhadas, típicas do vento da Patagônia. */
  function lensCloud(seed, w, h, k, res) {
    const L = makeLayer(w, h, res), c = L.c, pen = new Pencil(c, seed, seed + 1, k), S = pen.S;
    for (let i = 0; i < 3; i++) {
      const cx = w / 2 + (S() - 0.5) * w * 0.15, cy = h * (0.3 + i * 0.2), rx = w * (0.48 - i * 0.09), ry = h * (0.11 + S() * 0.04);
      const pts = [];
      for (let a = 0; a <= TAU + 0.1; a += 0.1) pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry * (Math.sin(a) > 0 ? 0.7 : 1)]);
      const p = new Path2D();
      pts.forEach((q, j) => (j ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
      c.fillStyle = PAL.paper;
      c.fill(p);
      c.save();
      c.clip(p);
      const hs = [];
      for (let x = cx - rx; x < cx + rx; x += 2.4) hs.push([x, cy + ry * 0.8, x + ry * 0.6, cy - ry * 0.1]);
      pen.lines(hs, { w: 0.5, col: PAL.g2, a: 0.5 });
      c.restore();
      pen.path(pts, { w: 0.9, col: PAL.g1, a: 0.85, passes: 2 });
    }
    return L;
  }

  /** Arbusto (calafate): rabiscos em laço dentro de uma meia-lua. */
  function bush(pen, x, y, r) {
    const c = pen.c, S = pen.S, pts = [];
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI + (i / 18) * Math.PI;
      pts.push([x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * (0.8 + S() * 0.35)]);
    }
    const p = new Path2D();
    pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
    p.closePath();
    c.fillStyle = PAL.paper;
    c.fill(p);
    c.save();
    c.clip(p);
    c.beginPath();
    for (let i = 0; i < r * 1.6; i++) {
      const lx = x + (S() - 0.5) * r * 2.4, ly = y - S() * r, lr = (1.5 + S() * 2.5) * pen.k;
      c.moveTo(lx + lr, ly);
      c.arc(lx, ly, lr, 0, TAU);
    }
    c.strokeStyle = PAL.g1;
    c.lineWidth = 0.6 * pen.k;
    c.globalAlpha = 0.65;
    c.stroke();
    c.globalAlpha = 1;
    const hs = [];
    for (let xx = x; xx < x + r * 1.3; xx += 1.8) hs.push([xx, y, xx - r * 0.3, y - r]);
    pen.lines(hs, { w: 0.6, col: PAL.ink, a: 0.4 });
    c.restore();
    pen.path(pts, { w: 0.9, col: PAL.ink, a: 0.9, passes: 1 });
  }

  /** Guanaco parado, de perfil. */
  function guanaco(pen, x, y, s, dir = 1) {
    const c = pen.c;
    c.save();
    c.translate(x, y);
    c.scale(dir * s, s);
    c.lineCap = 'round';
    c.strokeStyle = PAL.ink;
    c.lineWidth = 1.1;
    c.beginPath();
    for (const lx of [-4.6, -3.2, 3.4, 4.8]) { c.moveTo(lx, -11); c.lineTo(lx + (lx > 0 ? 0.5 : -0.5), 0); }
    c.stroke();
    c.beginPath();
    c.ellipse(0, -12.5, 6.5, 3, 0, 0, TAU);
    c.fillStyle = PAL.g2;
    c.fill();
    c.lineWidth = 0.8;
    c.stroke();
    c.beginPath();
    c.moveTo(5, -13.5);
    c.quadraticCurveTo(6.6, -18, 6.8, -23);
    c.lineWidth = 2.2;
    c.stroke();
    c.beginPath();
    c.ellipse(8.2, -23, 2.2, 1.2, 0.2, 0, TAU);
    c.fillStyle = PAL.ink;
    c.fill();
    c.lineWidth = 0.9;
    c.beginPath();
    c.moveTo(6.6, -23.6);
    c.lineTo(6.3, -25.6);
    c.moveTo(-6.3, -13);
    c.lineTo(-7.4, -11);
    c.stroke();
    c.restore();
  }

  const Patagonia = {
    id: 'patagonia',
    numeral: 'IV',
    place: 'Torres del Paine',
    meta: 'Chile · 50°57′S 72°59′W',
    mood: 'selvagem, ventosa',
    duration: 28,
    stopAt: 0.38,
    stopAtPortrait: 0.42,

    build(env) {
      const { W, H, res, k } = env;
      const portrait = H > W * 1.1;
      const hf = portrait ? 0.85 : 1;
      const wY = H * (portrait ? 0.64 : 0.66), bottomWater = H * 0.86, depth = bottomWater - wY;
      const nA = noise1(rng(4101)), nM = noise1(rng(4102)), nH = noise1(rng(4103)), nB = noise1(rng(4104));
      const tw = portrait ? 1.6 : 1;                      // torres mais largas no retrato
      const tBase = wY - H * 0.1 * hf;
      const towers = [
        { x: W * 0.465, top: tBase - H * 0.3 * hf, w: W * 0.05 * tw },
        { x: W * 0.54, top: tBase - H * 0.24 * hf, w: W * 0.042 * tw },
        { x: W * 0.615, top: tBase - H * 0.33 * hf, w: W * 0.055 * tw },
      ];
      const farR = (x) => {
        const u = x / W;
        return wY - H * hf * (0.17 + 0.07 * bell(u, 0.2, 0.1) + 0.08 * bell(u, 0.82, 0.1) + 0.03 * ridged(nA, u * 14));
      };
      const massif = (x) => {
        const u = x / W;
        const core = 0.09 * bell(u, 0.54, 0.14 * tw) + 0.035 * ridged(nM, u * 22);
        return Math.min(wY + 1, wY - H * hf * (0.06 + core));
      };
      const hills = (x) => {
        const u = x / W;
        return wY - H * (0.02 + 0.035 * bell(u, 0.15, 0.15) + 0.03 * bell(u, 0.85, 0.12) + 0.01 * fbm(nH, u * 20));
      };
      const bankY = (x) => H * (portrait ? 0.86 : 0.85) + H * 0.012 * Math.sin((x / W) * 2.3 + 2) + H * 0.008 * fbm(nB, x * 0.01);
      const trailY = (x) => bankY(x) + H * 0.032;
      const farPts = sample(-6, W + 6, 3, farR), masPts = sample(-6, W + 6, 3, massif), hillPts = sample(-6, W + 6, 3, hills);

      const sky = makeLayer(W, H, res);
      {
        const pen = new Pencil(sky.c, 4150, 4151, k);
        sky.c.fillStyle = PAL.paper;
        sky.c.fillRect(0, 0, W, H);
        skyStrokes(pen, W, H * 0.01, H * 0.4, 0.55);
        waterStrokes(pen, W, wY, bottomWater, 1.3);
      }
      const lw = Math.min(W * 0.34, H * 0.5);
      const lens = [0, 1, 2].map((i) => ({
        L: lensCloud(4160 + i * 7, lw * (1 - i * 0.2), lw * 0.32, k, res), w: lw * (1 - i * 0.2), h: lw * 0.32,
        y: H * (0.04 + i * 0.09), x0: W * (0.1 + i * 0.4), v: (18 + i * 6) * k,
      }));
      const ripples = makeRipples(4180, 300, W, wY, depth, k);
      const grass = makeGrass(4190, W, bankY, k, { h: 13, tallP: 0.35, step: 3.2 });
      const mist = { L: mistSprite(4170, Math.ceil(W * 1.5), Math.ceil(H * 0.06), 40), y: tBase - H * 0.06, v: 22 * k, a: 0.75 };

      const st = { W, H, land: [], fg: [], wind: 2 };
      withVariants(st, (seedJ) => {
        const land = makeLayer(W, H, res);
        const pen = new Pencil(land.c, 4200, seedJ, k);
        drawRange(pen, {
          pts: farPts, base: wY + 1, fill: '#EEE7DA', hatchCol: PAL.g2, hatchA: 0.45, fallA: 0.4,
          fallEvery: 2, fallDensity: 0.6, hatchEvery: 1, hatchFrom: 0.5, crossFrom: 0.85, strata: 2, maxFall: H * 0.06,
          lineW: 0.9, lineCol: PAL.g2, lineA: 0.9, snowY: wY - H * hf * 0.2,
          shade: (x, y, sl) => 0.3 + 0.6 * Math.tanh(sl * 1.5) + 0.2 * nA(x * 0.03),
        });
        for (const [i, t] of towers.entries()) graniteTower(pen, t.x, tBase + H * 0.06, t.top, t.w, 4300 + i);
        drawRange(pen, {
          pts: masPts, base: wY + 1, fill: '#E7DFCF', hatchCol: PAL.g1, hatchA: 0.55, fallA: 0.5,
          fallEvery: 1, fallDensity: 0.85, hatchEvery: 1, hatchFrom: 0.42, crossFrom: 0.72,
          bandH: H * 0.04, bandA: 0.3, strata: 6, maxFall: H * 0.09,
          lineW: 1.2, lineCol: PAL.ink, lineA: 0.95,
          shade: (x, y, sl) => 0.45 + 0.35 * Math.tanh(sl * 1.4) + 0.25 * nM(x * 0.02),
        });
        drawRange(pen, {
          pts: hillPts, base: wY + 1, fill: '#E4DBCA', hatchCol: PAL.g1, hatchA: 0.5, fallA: 0.4,
          fallEvery: 2, fallDensity: 0.6, hatchEvery: 1, hatchFrom: 0.5, crossFrom: 0.85,
          bandH: H * 0.015, bandA: 0.35, strata: 3, lineW: 1.1, lineCol: PAL.g1, lineA: 0.95,
          shade: (x, y, sl) => 0.4 + 0.3 * Math.tanh(sl * 2) + 0.2 * nH(x * 0.03),
        });
        const gs = clamp(H / 900, 0.6, 1.2);
        guanaco(pen, W * 0.12, hills(W * 0.12) + 2, gs, 1);
        guanaco(pen, W * 0.16, hills(W * 0.16) + 3, gs * 0.9, -1);
        guanaco(pen, W * 0.86, hills(W * 0.86) + 2, gs * 0.95, -1);
        pen.path(sample(-4, W + 4, 6, () => wY), { w: 0.9, col: PAL.g1, a: 0.8, gap: 0.08, jit: 0.5 });
        st.land.push(land);

        const fg = makeLayer(W, H, res);
        const pf = new Pencil(fg.c, 4400, seedJ + 5, k);
        drawBank(pf, W, H, bankY, trailY, { rocks: 3, grass: false, tone: 1.2 });
        bush(pf, W * 0.07, bankY(W * 0.07) + 10 * k, 22 * k);
        bush(pf, W * 0.8, bankY(W * 0.8) + 8 * k, 16 * k);
        bush(pf, W * 0.95, bankY(W * 0.95) + 12 * k, 26 * k);
        st.fg.push(fg);
      });

      st.ground = trailY;
      st.draw = (ctx, t, v) => {
        const land = st.land[v] || st.land[0], fg = st.fg[v] || st.fg[0];
        ctx.drawImage(sky.cv, 0, 0, W, H);
        for (const l of lens) {
          const span = W + l.w * 2;
          ctx.drawImage(l.L.cv, wrap(l.x0 + t * l.v, span) - l.w, l.y, l.w, l.h);
        }
        ctx.drawImage(land.cv, 0, 0, W, H);
        drawMist(ctx, mist, t);
        reflect(ctx, land, wY, depth, t, k, { alpha: 0.3, amp: 2.2, speed: 2.2 });
        drawRipples(ctx, ripples, t, W, k, { speed: 2.5, chop: 1 });

        // condor planando em círculos largos
        const cx = W * 0.72 + Math.cos(t * 0.18) * W * 0.12, cy = H * 0.22 + Math.sin(t * 0.18) * H * 0.05;
        const s = 18 * k, tilt = Math.cos(t * 0.18) * 0.15, dip = Math.sin(t * 0.7) * 1.5 * k;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.beginPath();
        ctx.moveTo(-s, -2 * k + dip);
        ctx.quadraticCurveTo(-s * 0.5, -s * 0.12, -s * 0.1, 0);
        ctx.lineTo(s * 0.1, 0);
        ctx.quadraticCurveTo(s * 0.5, -s * 0.12, s, -2 * k + dip);
        ctx.quadraticCurveTo(s * 0.5, s * 0.05, s * 0.08, s * 0.12);
        ctx.lineTo(-s * 0.08, s * 0.12);
        ctx.quadraticCurveTo(-s * 0.5, s * 0.05, -s, -2 * k + dip);
        ctx.fillStyle = PAL.g1;
        ctx.fill();
        ctx.strokeStyle = PAL.ink;
        ctx.lineWidth = 0.9 * k;
        ctx.stroke();
        ctx.restore();

        ctx.drawImage(fg.cv, 0, 0, W, H);
        drawGrass(ctx, grass, t, k, 2);
      };
      return st;
    },
  };

  /** Ordem do roteiro: ao chegar na última, volta para a primeira. */
  const SCENES = [Fjord, Fuji, Sahara, Patagonia];

  /*<T>*/
  /* ================================================================
   * 4. Viajante (SVG)
   *    Unidade: 1 cabeça = 10. Altura total 75 (+ chapéu). Pés em y = 0.
   *    Pernas e braços são recalculados a cada quadro (cinemática simples).
   * ================================================================ */
  const Traveler = (() => {
    const q = (id) => document.getElementById(id);
    const root = q('tv');
    if (!root) return null;
    const P = {
      legBo: q('tv-legB-o'), legBi: q('tv-legB-i'), bootB: q('tv-bootB'),
      legFo: q('tv-legF-o'), legFi: q('tv-legF-i'), bootF: q('tv-bootF'),
      armBo: q('tv-armB-o'), armBi: q('tv-armB-i'), handB: q('tv-handB'),
      armFo: q('tv-armF-o'), armFi: q('tv-armF-i'), handF: q('tv-handF'),
      upper: q('tv-upper'), upperB: q('tv-upper-back'), head: q('tv-head'),
      scarf: q('tv-scarf'), noise: q('tv-noise'),
    };
    const HIP = -37, THIGH = 18, SHIN = 17.5, FOOT = 5.4, UARM = 12.6, FARM = 11.8;
    const SH = [0.6, -59.6];        // ombro
    const STRIDE = 60;              // avanço (unidades) por ciclo completo de passos
    const FIG_H = 80;               // altura com chapéu
    const CYCLE = 1.1;              // segundos por ciclo no passo natural

    let s = 1, x = -999, v = 60, speed = 0, phase = 0, t = 0, boil = 0, seed = 3, look = 0;
    let mode = 'wait', hold = 0;
    let plan = { delay: 1.6, startX: -50, stopX: 300, endX: 1200, pause: 4 };

    const n2 = (n) => (Math.round(n * 100) / 100).toString();

    function leg(phi, a, stand) {
      const th = a * 0.44 * Math.sin(phi) + (1 - a) * stand;                                   // coxa (+ = para frente)
      const kn = 0.06 + a * 0.95 * Math.pow(Math.max(0, Math.cos(phi)), 1.7); // joelho dobra no balanço
      const kx = Math.sin(th) * THIGH, ky = Math.cos(th) * THIGH;
      const sh = th - kn;
      const ax = kx + Math.sin(sh) * SHIN, ay = ky + Math.cos(sh) * SHIN;
      const fa = -0.22 * a * Math.max(0, Math.cos(phi)) + 0.38 * a * Math.max(0, -Math.sin(phi)) ** 3;
      const toe = [ax + Math.cos(fa) * FOOT, ay + Math.sin(fa) * FOOT];
      const heel = [ax - Math.cos(fa) * 1.4, ay - Math.sin(fa) * 1.4];
      return { kx, ky, ax, ay, toe, heel, low: Math.max(ay + 1.6, toe[1] + 0.9) };
    }

    function arm(phi, a) {
      const ang = -a * 0.42 * Math.sin(phi) + 0.06;
      const el = 0.2 + a * 0.32 * Math.max(0, -Math.sin(phi));
      const ex = SH[0] + Math.sin(ang) * UARM, ey = SH[1] + Math.cos(ang) * UARM;
      const a2 = ang + el;
      return { ex, ey, wx: ex + Math.sin(a2) * FARM, wy: ey + Math.cos(a2) * FARM };
    }

    function setLeg(o, i, boot, L, hy) {
      const d = `M0 ${n2(hy)} L${n2(L.kx)} ${n2(hy + L.ky)} L${n2(L.ax)} ${n2(hy + L.ay)}`;
      o.setAttribute('d', d);
      i.setAttribute('d', d);
      boot.setAttribute('d', `M${n2(L.heel[0])} ${n2(hy + L.heel[1])} L${n2(L.toe[0])} ${n2(hy + L.toe[1])}`);
    }

    function setArm(o, i, hand, A) {
      const d = `M${SH[0]} ${SH[1]} L${n2(A.ex)} ${n2(A.ey)} L${n2(A.wx)} ${n2(A.wy)}`;
      o.setAttribute('d', d);
      i.setAttribute('d', d);
      hand.setAttribute('cx', n2(A.wx));
      hand.setAttribute('cy', n2(A.wy + 0.6));
    }

    /** Planeja a travessia para caber na duração da cena (entra, para e contempla, sai). */
    function setup(scene, W, H, D) {
      s = clamp(H * 0.125, 64, 170) / FIG_H;
      const stopU = H > W * 1.1 ? (scene.stopAtPortrait || 0.5) : scene.stopAt;
      const startX = -18 * s, endX = W + 18 * s, stopX = W * stopU, delay = 1.6;
      v = (STRIDE * s) / CYCLE;
      const overhead = 1.6 + 1.0; // aceleração/frenagem + folga de saída
      let pause = D - delay - (endX - startX) / v - overhead;
      if (pause < 2.5) { pause = 2.5; v = (endX - startX) / (D - delay - overhead - pause); }
      plan = { delay, startX, stopX, endX, pause };
    }

    function reset(scene, W, H, D) {
      setup(scene, W, H, D);
      x = plan.startX;
      speed = 0;
      phase = 0;
      look = 0;
      mode = 'wait';
    }

    function resize(scene, W, H, D, oldW) {
      const ratio = oldW ? W / oldW : 1;
      setup(scene, W, H, D);
      x *= ratio;
    }

    function update(dt, sceneT, ground, reduced, wind = 1) {
      t += dt;
      let target = 0;
      if (reduced) {
        x = plan.stopX; speed = 0; mode = 'rest'; hold = Infinity;
      } else {
        switch (mode) {
          case 'wait': if (sceneT >= plan.delay) mode = 'walk1'; break;
          case 'walk1':
            target = v;
            if (plan.stopX - x <= speed / 2.8 + 0.5) { mode = 'rest'; hold = plan.pause; }
            break;
          case 'rest': hold -= dt; if (hold <= 0) mode = 'walk2'; break;
          case 'walk2': target = v; break;
          default: break;
        }
        speed += (target - speed) * Math.min(1, dt * 2.8);
        if (mode === 'wait') speed = 0;
        x += speed * dt;
        phase += (TAU * speed / (STRIDE * s)) * dt;
      }
      const a = clamp(speed / v, 0, 1);
      look += ((mode === 'rest' ? 1 : 0) - look) * Math.min(1, dt * 1.5);

      const LF = leg(phase, a, 0.09), LB = leg(phase + Math.PI, a, -0.07);
      const hy = -Math.max(LF.low, LB.low);
      const breathe = reduced ? 0 : (1 - a) * Math.sin(t * 1.7) * 0.3;
      const dy = hy - HIP + breathe;
      setLeg(P.legBo, P.legBi, P.bootB, LB, hy);
      setLeg(P.legFo, P.legFi, P.bootF, LF, hy);
      const lean = a * 4;
      const tr = `translate(0 ${n2(dy)}) rotate(${n2(lean)} 0 ${HIP})`;
      P.upper.setAttribute('transform', tr);
      P.upperB.setAttribute('transform', tr);
      setArm(P.armFo, P.armFi, P.handF, arm(phase, a));
      setArm(P.armBo, P.armBi, P.handB, arm(phase + Math.PI, a));
      const nod = reduced ? 0 : Math.sin(t * 0.9) * 0.8 * (1 - a);
      P.head.setAttribute('transform', `rotate(${n2(-8 * look + nod)} 1.2 -64)`);

      const w = reduced ? 0 : wind;
      const fq = 0.75 + 0.25 * wind;
      const f1 = Math.sin(t * 6.3 * fq) * 1.4 * w, f2 = Math.sin(t * 7.7 * fq + 1) * 1.8 * w;
      P.scarf.setAttribute('d', `M-3.2 -62.4 Q${n2(-8 - a * 2)} ${n2(-63.2 + f1 * 0.5)} ${n2(-11.5 - a * 2.5 - w)} ${n2(-60.8 + f1)} T${n2(-16 - a * 3 - w * 2)} ${n2(-58.6 + f2)}`);

      const gy = ground(clamp(x, 0, 1e6));
      root.setAttribute('transform', `translate(${n2(x)} ${n2(gy)}) scale(${n2(s)})`);

      if (!reduced && dt > 0) {
        boil += dt;
        if (boil > 0.2) { boil = 0; seed = (seed % 6) + 1; P.noise.setAttribute('seed', String(seed)); }
      }
    }

    return { reset, resize, update };
  })();
  /*</T>*/

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
    const st = SCENES[idx].build({ W, H, res: DPR, k: K, ctx });
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
    /*<T>*/ if (Traveler) Traveler.reset(SCENES[idx], W, H, duration()); /*</T>*/
    updateLabel(!first);
    // link direto para a paisagem (ex.: …/#saara). Não guarda nada, só atualiza o endereço.
    try { history.replaceState(null, '', `#${SCENES[idx].id}`); } catch (e) { /* file:// em alguns navegadores */ }
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
    /*<T>*/ if (Traveler) Traveler.update(run ? dt : 0, sceneT, state.ground, reduced, state.wind || 1); /*</T>*/
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
      /*<T>*/ if (Traveler) Traveler.resize(SCENES[idx], W, H, duration(), oldW); /*</T>*/
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
  const fromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = SCENES.findIndex((sc) => sc.id === id);
    return i < 0 ? 0 : i;
  };
  window.addEventListener('hashchange', () => { const i = fromHash(); if (i !== idx) goTo(i); });

  measure();
  buildDots();
  idx = fromHash();
  goTo(idx, true);
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
