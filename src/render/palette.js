/* GLT.palette: the fixed 90-colour palette (OKLab), named roles and the ordered-dither lookup table.
 * Area: render. Contract: ARCHITECTURE.md §10.3.
 *
 * Design: every family is a hand-tuned, hue-shifted ramp. Shadows drift toward blue/violet, highlights drift
 * warm, as in hand-painted pixel art. The post pass (renderer.js) snaps each pixel to this palette in OKLab and dithers
 * with a 4x4 Bayer matrix, but only between two NEIGHBOURING ramp colours (pair distance <= PAIR_MAX), so flat areas
 * stay flat and gradients (sky, fog, swell, light pools) get clean checker transitions instead of noise. The mix ratio
 * is quantised to 0 / 25 % / 50 %, so only the regular Bayer grid and checker patterns ever appear (no lone dots).
 * Pure math: no THREE, no DOM (the LUT builder runs in Node too). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  // ---- the 90 colours, by ramp (dark -> light). Order is the index order of `colors`. ----
  // Tuned against the reference bar (ref/sea-of-stars): saturated navy open water (#062849-ish), desaturated teal
  // shallows, warm violet-brown rock, olive-leaning foliage, cream sails. Dark ends lean blue/violet, light ends warm.
  const RAMPS = {
    ink:     ['#0a0912', '#1a1628', '#2c2640', '#463f5c', '#6c6684', '#a29cb4'],               // outlines, night darks, violet greys
    white:   ['#fffbf0'],
    sea:     ['#03101f', '#062440', '#0a3157', '#103e68', '#174e78', '#205f86', '#2d7493', '#428ea4', '#64acb6', '#9cd2cc', '#dcf2ea'],
    shallow: ['#173d43', '#255553', '#367064', '#58967e'],                                   // teal shallows over sand / reef
    sky:     ['#3f74c4', '#6497da', '#93bdea', '#c6e0f4'],
    cloud:   ['#9aa2c2', '#ccd2e8'],
    dusk:    ['#2e2050', '#5a2f68', '#93406a', '#c95c66', '#ec8a5e', '#f8b878', '#eda0a0'],
    night:   ['#142048', '#22336a', '#34508c'],
    storm:   ['#1b2529', '#2f3e43', '#4f6266', '#7d949a'],                                   // teal-grey mist
    wood:    ['#2a1812', '#47271a', '#683a22', '#8c542e', '#b2743e', '#d49e5e'],
    sail:    ['#c2ab88', '#e8d8b2', '#fff3da'],
    fire:    ['#5a1410', '#9a2216', '#d4441a', '#f27620', '#ffaa38', '#ffd86a'],
    rock:    ['#30242a', '#4e3a36', '#765a48', '#a68466'],                                   // warm violet-brown cliffs
    slate:   ['#283044', '#435068', '#6a7892'],
    soil:    ['#5c2c22', '#9c5232'],                                                         // terracotta earth
    sand:    ['#d6b678'],
    foliage: ['#0d2318', '#16392a', '#21502f', '#356a33', '#557f34', '#7f9a3c', '#b2c45c'],
    kelp:    ['#5a6626'],
    skin:    ['#c88a64', '#f2c8a0'],
    gold:    ['#8a5c1a', '#c48e26', '#f4c443'],
    red:     ['#6a1424', '#bc302e', '#ec6a52'],
    blue:    ['#1a3d8a', '#2d62c6', '#5a90ea'],
    purple:  ['#3c2670', '#7856b6', '#ae8ede'],
    pink:    ['#d0609a']
  };

  // Guaranteed roles (§10.3) + extras, as [ramp, index]. Every role is one of the 90 colours by construction.
  const ROLE_REFS = {
    'sea-deep': ['sea', 2], 'sea': ['sea', 3], 'sea-light': ['sea', 6], 'sea-foam': ['sea', 9], 'foam': ['sea', 10],
    'sky-day': ['sky', 2], 'sky-day-top': ['sky', 0], 'sky-dusk': ['dusk', 4], 'sky-dusk-top': ['dusk', 0],
    'sky-night': ['night', 0], 'sky-night-top': ['sea', 0], 'sky-storm': ['storm', 2], 'cloud': ['white', 0], 'cloud-shadow': ['cloud', 1],
    'sand': ['sand', 0], 'soil': ['soil', 1], 'soil-dark': ['soil', 0], 'rock': ['rock', 2], 'rock-dark': ['rock', 1],
    'slate': ['slate', 1], 'slate-dark': ['slate', 0], 'grass': ['foliage', 4], 'grass-dark': ['foliage', 3], 'vine': ['foliage', 2], 'kelp': ['kelp', 0],
    'wood-dark': ['wood', 1], 'wood': ['wood', 3], 'wood-light': ['wood', 4], 'hull-white': ['sail', 2], 'sail': ['sail', 2],
    'sail-shadow': ['sail', 1], 'rope': ['wood', 5], 'gold': ['gold', 2], 'brass': ['gold', 1], 'iron': ['storm', 1],
    'fire': ['fire', 3], 'fire-hot': ['fire', 5], 'ember': ['fire', 1], 'smoke': ['storm', 3], 'smoke-dark': ['storm', 1],
    'lantern': ['fire', 4], 'skin': ['skin', 1], 'red': ['red', 1], 'orange': ['fire', 3], 'yellow': ['fire', 5],
    'green': ['foliage', 3], 'blue': ['blue', 1], 'purple': ['purple', 1], 'black': ['ink', 0], 'white': ['white', 0],
    'marine-blue': ['blue', 0], 'marine-white': ['white', 0],
    // extras (any area may use them)
    'ink': ['ink', 1], 'ink-2': ['ink', 2], 'outline': ['ink', 1], 'sea-abyss': ['sea', 1], 'sea-mid': ['sea', 5], 'sea-shallow': ['shallow', 2],
    'sea-night': ['sea', 0], 'sea-crest': ['sea', 7], 'sea-glint': ['sea', 8],
    'teal': ['shallow', 1], 'teal-deep': ['shallow', 0], 'teal-light': ['shallow', 3], 'sand-light': ['sail', 1], 'rock-light': ['rock', 3],
    'rock-deep': ['rock', 0], 'slate-light': ['slate', 2], 'stone': ['rock', 2], 'terracotta': ['soil', 1],
    'foliage-deep': ['foliage', 0], 'foliage-dark': ['foliage', 1], 'foliage-light': ['foliage', 5], 'foliage-sun': ['foliage', 6], 'leaf': ['foliage', 4],
    'moss': ['kelp', 0], 'wood-deep': ['wood', 0], 'wood-mid': ['wood', 2],
    'sail-dark': ['sail', 0], 'fire-deep': ['fire', 0], 'fire-white': ['white', 0], 'ember-hot': ['fire', 2], 'gold-dark': ['gold', 0],
    'red-dark': ['red', 0], 'red-light': ['red', 2], 'blue-dark': ['blue', 0], 'blue-light': ['blue', 2], 'purple-dark': ['purple', 0], 'lavender': ['purple', 2],
    'pink': ['pink', 0], 'skin-shadow': ['skin', 0], 'dusk-violet': ['dusk', 1], 'dusk-rose': ['dusk', 2], 'dusk-coral': ['dusk', 3],
    'dusk-gold': ['dusk', 5], 'dusk-cloud': ['dusk', 6],
    'night-glow': ['night', 1], 'moonlight': ['night', 2], 'storm-dark': ['storm', 0], 'storm-mid': ['storm', 2], 'storm-light': ['storm', 3],
    'cloud-dark': ['cloud', 0], 'sky-day-mid': ['sky', 1], 'sky-day-light': ['sky', 3], 'violet-grey': ['ink', 4], 'violet-light': ['ink', 5],
    'ink-3': ['ink', 3]
  };

  const colors = [];
  const rampIndex = {};
  Object.keys(RAMPS).forEach((name) => {
    rampIndex[name] = RAMPS[name].map((h) => { colors.push(h.toLowerCase()); return colors.length - 1; });
  });
  if (colors.length !== 90 || new Set(colors).size !== 90) throw new Error('GLT.palette: palette must hold exactly 90 unique colours');
  const roles = {};
  Object.keys(ROLE_REFS).forEach((k) => { const ref = ROLE_REFS[k]; roles[k] = colors[rampIndex[ref[0]][ref[1]]]; });

  const hexToNum = (h) => parseInt(String(h).replace('#', ''), 16) >>> 0;
  const numToHex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);

  // ---- OKLab (Björn Ottosson) from sRGB 0..255 ----
  function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function labFromLin(lr, lg, lb, out) {
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return out;
  }
  function oklabRGB(r, g, b) { return labFromLin(srgbToLin(r), srgbToLin(g), srgbToLin(b), [0, 0, 0]); }
  function oklab(hex) {
    const n = typeof hex === 'number' ? hex : hexToNum(hex);
    return oklabRGB((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  // Lightness counts a little more than chroma: shading must survive the snap (form reads through value).
  const WL = 1.25;
  let labs = null;   // Float64Array(90*3)
  function ensureLabs() {
    if (labs) return labs;
    labs = new Float64Array(colors.length * 3);
    colors.forEach((h, i) => { const q = oklab(h); labs[i * 3] = q[0]; labs[i * 3 + 1] = q[1]; labs[i * 3 + 2] = q[2]; });
    return labs;
  }
  function dist2(i, L, A, B) {
    const dl = labs[i * 3] - L, da = labs[i * 3 + 1] - A, db = labs[i * 3 + 2] - B;
    return WL * dl * dl + da * da + db * db;
  }
  function nearestLab(L, A, B) {
    ensureLabs();
    let best = 0, bd = Infinity;
    for (let i = 0; i < colors.length; i++) { const d = dist2(i, L, A, B); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function nearest(r, g, b) { const q = oklabRGB(r, g, b); return nearestLab(q[0], q[1], q[2]); }

  // ---- dither LUT ----
  // For every quantised input colour (N levels per channel) the LUT stores: index A (nearest), index B (the
  // neighbour that best explains the input as a mix A..B) and the mix ratio t in [0, 0.5]. The shader shows B where
  // the Bayer threshold < t. Ratios below T_MIN are dropped (no lonely speckles); pairs further apart than PAIR_MAX
  // never dither (no blue/orange salt-and-pepper).
  const PAIR_MAX = 0.165;
  const PAIR_CLOSE = 0.07;
  const T_MIN = 0.15;    // below: flat A
  const T_HALF = 0.36;   // below: 25 % B (ordered grid); above: 50 % checker
  const lutCache = {};
  function buildLut(N) {
    N = N || 64;
    if (lutCache[N]) return lutCache[N];
    ensureLabs();
    const P = colors.length;
    // Neighbour candidates per colour: the adjacent steps of its own ramp (within PAIR_MAX), plus any colour closer
    // than PAIR_CLOSE. Dithering between unrelated hues that merely sit near each other (white vs pink skin vs pale
    // teal) turns bright, softly lit surfaces into confetti, so cross-ramp pairs must be genuinely close.
    const rampOfIdx = new Int16Array(P), posOfIdx = new Int16Array(P);
    Object.keys(rampIndex).forEach((name, ri) => rampIndex[name].forEach((idx, k) => { rampOfIdx[idx] = ri; posOfIdx[idx] = k; }));
    const nb = [];
    for (let i = 0; i < P; i++) {
      const list = [];
      for (let j = 0; j < P; j++) {
        if (j === i) continue;
        const dl = labs[i * 3] - labs[j * 3], da = labs[i * 3 + 1] - labs[j * 3 + 1], db = labs[i * 3 + 2] - labs[j * 3 + 2];
        const d = Math.sqrt(dl * dl + da * da + db * db);
        const adjacent = rampOfIdx[i] === rampOfIdx[j] && Math.abs(posOfIdx[i] - posOfIdx[j]) === 1;
        if ((adjacent && d <= PAIR_MAX) || d <= PAIR_CLOSE) list.push(j);
      }
      nb.push(list);
    }
    const lin = new Float64Array(N);
    for (let i = 0; i < N; i++) lin[i] = srgbToLin((i * 255) / (N - 1));
    const tiles = Math.ceil(Math.sqrt(N));          // blue slices laid out as tiles x tiles
    const W = N * tiles, H = N * tiles;
    const data = new Uint8Array(W * H * 4);
    const q = [0, 0, 0];
    for (let bi = 0; bi < N; bi++) {
      const tx = (bi % tiles) * N, ty = Math.floor(bi / tiles) * N;
      for (let gi = 0; gi < N; gi++) {
        for (let ri = 0; ri < N; ri++) {
          labFromLin(lin[ri], lin[gi], lin[bi], q);
          const a = nearestLab(q[0], q[1], q[2]);
          const aL = labs[a * 3], aA = labs[a * 3 + 1], aB = labs[a * 3 + 2];
          const pL = q[0] - aL, pA = q[1] - aA, pB = q[2] - aB;
          let bestB = a, bestT = 0, bestE = WL * pL * pL + pA * pA + pB * pB;
          const cand = nb[a];
          for (let k = 0; k < cand.length; k++) {
            const j = cand[k];
            const vL = labs[j * 3] - aL, vA = labs[j * 3 + 1] - aA, vB = labs[j * 3 + 2] - aB;
            const vv = WL * vL * vL + vA * vA + vB * vB;
            let t = (WL * pL * vL + pA * vA + pB * vB) / vv;
            if (t <= 0) continue;
            if (t > 0.5) t = 0.5;
            const eL = pL - t * vL, eA = pA - t * vA, eB = pB - t * vB;
            const e = WL * eL * eL + eA * eA + eB * eB;
            if (e < bestE - 1e-12) { bestE = e; bestB = j; bestT = t; }
          }
          // Quantised to the three clean ordered patterns pixel artists use: flat, 25 % grid, 50 % checker.
          // (A continuous ratio would leave lonely 1-in-16 dots on near-flat surfaces: visual salt.)
          let t = bestT < T_MIN ? 0 : (bestT < T_HALF ? 0.25 : 0.5);
          if (bestB === a) t = 0;
          const o = ((ty + gi) * W + (tx + ri)) * 4;
          data[o] = a; data[o + 1] = bestB; data[o + 2] = Math.round(t * 255); data[o + 3] = 255;
        }
      }
    }
    const res = { data, width: W, height: H, levels: N, tiles };
    lutCache[N] = res;
    return res;
  }

  // Palette as an RGBA strip (width 128, 90 used) for the shader.
  function paletteData(width) {
    width = width || 128;
    const out = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) {
      const n = hexToNum(colors[Math.min(i, colors.length - 1)]);
      out[i * 4] = (n >> 16) & 255; out[i * 4 + 1] = (n >> 8) & 255; out[i * 4 + 2] = n & 255; out[i * 4 + 3] = 255;
    }
    return out;
  }

  function get(role) {
    const h = roles[role];
    if (h === undefined) throw new Error('GLT.palette.get: unknown role ' + role);
    return hexToNum(h);
  }

  // Snap any colour (hex string or 0xRRGGBB) to the palette; returns 0xRRGGBB.
  function snap(c) {
    const n = typeof c === 'number' ? c >>> 0 : hexToNum(c);
    return hexToNum(colors[nearest((n >> 16) & 255, (n >> 8) & 255, n & 255)]);
  }

  // Step along the colour's own ramp: shade('wood', +1) = one step lighter. Returns 0xRRGGBB.
  function shade(roleOrHex, steps) {
    const hex = (typeof roleOrHex === 'string' && roleOrHex.charAt(0) !== '#') ? roles[roleOrHex] : (typeof roleOrHex === 'number' ? numToHex(roleOrHex) : roleOrHex);
    if (hex === undefined) throw new Error('GLT.palette.shade: unknown role ' + roleOrHex);
    const idx = colors.indexOf(numToHex(snap(hex)));
    for (const name in rampIndex) {
      const ramp = rampIndex[name];
      const k = ramp.indexOf(idx);
      if (k >= 0) return hexToNum(colors[ramp[Math.max(0, Math.min(ramp.length - 1, k + (steps | 0)))]]);
    }
    return hexToNum(colors[idx]);
  }

  GLT.palette = {
    colors,
    roles,
    ramps: RAMPS,
    get,
    has(role) { return Object.prototype.hasOwnProperty.call(roles, role); },
    nearest,
    oklab,
    snap,
    shade,
    hex: numToHex,
    buildLut,
    paletteData,
    PAIR_MAX,
    T_MIN,
    T_HALF,
    rampOf(hex) {                      // ramp name holding this palette colour (or null)
      const idx = colors.indexOf(String(hex).toLowerCase());
      for (const name in rampIndex) if (rampIndex[name].indexOf(idx) >= 0) return name;
      return null;
    }
  };
})();
