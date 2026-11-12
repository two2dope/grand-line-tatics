/* GLT._fx_wanted (private, fx area): the procedural pixel-art WANTED poster. Public entry: GLT.fireworks.poster(canvas, o),
 * same options as GLT.wanted.draw (ARCHITECTURE.md §11.5): { crew, bounty, progress 0..1, seed?, hero? }.
 *
 * Everything is drawn into one 168x240 pixel buffer (the caller scales the canvas with image-rendering: pixelated):
 * aged parchment (two octaves of seeded value noise, 4x4 Bayer-dithered into four paper tones, burnt ragged edges, a torn
 * corner, coffee rings, fold creases, a brass pin), the title and names in the build's Google Fonts rasterised and
 * alpha-thresholded so they stay crisp pixels, a framed captain portrait (original procedural pixel art per crew, with
 * an automatic 1 px outline), and the bounty in a hand-made 5x7 bitmap numeral font with a pixel Berry sign (no font
 * carries ฿ as a crisp glyph). The static layer is cached per (crew, seed, hero, fonts); a count-up frame only restamps
 * the bounty line, so ceremonyUi can call draw() every frame. When progress reaches 1 an ink seal with the crew's
 * Jolly Roger (GLT.flags.glyph) is stamped across the corner. All words come from GLT.T. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const W = 168, H = 240;
  const PAL = {
    p0: 0xf1e2b6, p1: 0xe6cf98, p2: 0xd2b277, p3: 0xb48a52, burn: 0x7c5230, edge: 0x4e321e,
    ink: 0x2e1c12, ink2: 0x5a3a22, hi: 0xfaf0cc, red: 0xa62c26, red2: 0x7e1e1e, blue: 0x2a4f9a,
    brass: 0xd8a640, brass2: 0x8a6424, out: 0x22140e
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // ------------------------------------------------------------------ pixel buffer helpers
  function Buf(w, h) { this.w = w; this.h = h; this.c = new Int32Array(w * h).fill(-1); }
  Buf.prototype.set = function (x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = c; };
  Buf.prototype.get = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : -1; };
  Buf.prototype.rect = function (x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); };
  Buf.prototype.ell = function (cx, cy, rx, ry, c, test) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && (!test || test(x, y))) this.set(x, y, c);
    }
  };
  Buf.prototype.line = function (x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let i = 0; i <= n; i++) { const u = n ? i / n : 0; this.set(Math.round(x0 + (x1 - x0) * u), Math.round(y0 + (y1 - y0) * u), c); }
  };
  // composite b over this at (ox, oy)
  Buf.prototype.over = function (b, ox, oy) {
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const c = b.c[y * b.w + x]; if (c >= 0) this.set(ox + x, oy + y, c); }
  };
  // 1 px outline around opaque pixels (4-neighbourhood)
  Buf.prototype.outline = function (col) {
    const w = this.w, h = this.h, src = this.c.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (src[y * w + x] >= 0) continue;
      if ((x > 0 && src[y * w + x - 1] >= 0) || (x < w - 1 && src[y * w + x + 1] >= 0) || (y > 0 && src[(y - 1) * w + x] >= 0) || (y < h - 1 && src[(y + 1) * w + x] >= 0)) this.c[y * w + x] = col;
    }
  };

  function mix(a, b, k) {
    const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k);
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k);
    const bl = (a & 255) + (((b & 255) - (a & 255)) * k);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  function hexN(s) { return typeof s === 'number' ? s : parseInt(String(s).slice(1), 16); }

  // ------------------------------------------------------------------ noise
  function valueNoise(rng, w, h, cell) {
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rng.next();
    return function (x, y) {
      const fx = x / cell, fy = y / cell, ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  }

  // ------------------------------------------------------------------ text (font raster, alpha threshold)
  let scratch = null;
  function textMask(str, family, weight, maxW, maxSize, minSize, thr) {
    if (!scratch) { scratch = document.createElement('canvas'); scratch.width = 520; scratch.height = 96; }
    const g = scratch.getContext('2d');
    let size = maxSize;
    for (; size > minSize; size--) {
      g.font = weight + ' ' + size + 'px ' + family;
      if (g.measureText(str).width <= maxW) break;
    }
    g.font = weight + ' ' + size + 'px ' + family;
    g.clearRect(0, 0, scratch.width, scratch.height);
    g.fillStyle = '#000';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(str, 8, Math.round(size * 1.15) + 4);
    const d = g.getImageData(0, 0, scratch.width, scratch.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const T = thr || 120;
    for (let y = 0; y < scratch.height; y++) for (let x = 0; x < scratch.width; x++) {
      if (d[(y * scratch.width + x) * 4 + 3] >= T) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return { w: 0, h: 0, m: new Uint8Array(0), size };
    const w = x1 - x0 + 1, h = y1 - y0 + 1, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = d[((y + y0) * scratch.width + x + x0) * 4 + 3] >= T ? 1 : 0;
    return { w, h, m, size };
  }
  function stampMask(buf, tm, x, y, col, shadow) {
    for (let j = 0; j < tm.h; j++) for (let i = 0; i < tm.w; i++) {
      if (!tm.m[j * tm.w + i]) continue;
      if (shadow != null) buf.set(x + i, y + j + 1, shadow);
    }
    for (let j = 0; j < tm.h; j++) for (let i = 0; i < tm.w; i++) if (tm.m[j * tm.w + i]) buf.set(x + i, y + j, col);
  }

  // ------------------------------------------------------------------ bitmap numerals (5x7) + Berry sign
  const DIG = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
  };
  const BERRY = ['00100', '11110', '10101', '10101', '11110', '10101', '10101', '11110', '00100'];
  function glyphW(ch) { return ch === '.' ? 1 : 5; }
  // draws `str` (digits and dots) at scale s; returns width
  function numWidth(str, s) { let w = 0; for (const ch of str) w += (glyphW(ch) + 1) * s; return w - s; }
  function drawNum(buf, str, x, y, s, col, shade) {
    let cx = x;
    for (const ch of str) {
      if (ch === '.') { buf.rect(cx, y + 6 * s, s, s, col); cx += 2 * s; continue; }
      const g = DIG[ch];
      if (!g) { cx += 6 * s; continue; }
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
        if (g[r].charAt(c) !== '1') continue;
        buf.rect(cx + c * s, y + r * s, s, s, col);
        if (shade != null && s > 1) buf.set(cx + c * s + s - 1, y + r * s + s - 1, shade);
      }
      cx += 6 * s;
    }
  }
  function drawBerry(buf, x, y, s, col) {
    for (let r = 0; r < 9; r++) for (let c = 0; c < 5; c++) if (BERRY[r].charAt(c) === '1') buf.rect(x + c * s, y + (r - 1) * s, s, s, col);
  }

  // ------------------------------------------------------------------ portraits (original procedural pixel art)
  const SKIN = { a: 0xf2c290, b: 0xd99868, c: 0xb06e48 };
  const SKIN_TAN = { a: 0xe0a676, b: 0xc07e52, c: 0x8e5636 };
  const BG = {
    strawHat:   [0x7ec4ec, 0xa8daf2, 0xd8f0f6, 0x3a8ac8],
    whitebeard: [0x8aa8d8, 0xb6c8e8, 0xe6e4f0, 0x2a5c9a],
    redHair:    [0xe89a6a, 0xf2bc84, 0xf8dca8, 0x4a6aa0],
    heart:      [0x86b8d2, 0xb0d2e0, 0xdcecef, 0x2e6e8e],
    blackbeard: [0x5a4a78, 0x8a6a8a, 0xc49088, 0x2a3458],
    marine:     [0x90c8f0, 0xbce0f6, 0xe8f6fa, 0x2e7ac0]
  };

  function portrait(crew, rng) {
    const PW = 134, PH = 94;
    const bg = new Buf(PW, PH), fg = new Buf(PW, PH);
    const B = BG[crew] || BG.strawHat;
    // sky bands, sun/cloud, sea with wave dashes
    const horizon = 66 + ((rng.next() * 4) | 0);
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      let c;
      if (y < horizon) {
        const u = y / horizon + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.18;
        c = u < 0.38 ? B[0] : u < 0.75 ? B[1] : B[2];
      } else {
        c = B[3];
        if (((x + y * 7) % 11 === 0) && y > horizon + 2) c = mix(B[3], 0xffffff, 0.35);
      }
      bg.set(x, y, c);
    }
    bg.rect(0, horizon, PW, 1, mix(B[2], 0xffffff, 0.5));
    // a couple of puffy clouds
    for (let k = 0; k < 2; k++) {
      const cx = 12 + rng.next() * 110, cy = 10 + rng.next() * 26;
      bg.ell(cx, cy, 10, 3.5, mix(B[2], 0xffffff, 0.6)); bg.ell(cx - 5, cy - 2, 5, 3, mix(B[2], 0xffffff, 0.75)); bg.ell(cx + 4, cy - 3, 6, 3.5, 0xffffff);
    }
    // a tiny ship silhouette on the horizon
    const sx = rng.next() < 0.5 ? 10 + (rng.next() * 16 | 0) : 104 + (rng.next() * 16 | 0);
    bg.rect(sx, horizon - 2, 9, 2, 0x4a3a40); bg.rect(sx + 4, horizon - 9, 1, 7, 0x4a3a40); bg.rect(sx + 1, horizon - 8, 3, 5, 0xf0ead8); bg.rect(sx + 5, horizon - 7, 3, 4, 0xf0ead8);

    const cx = 67, hy = 44;
    const skin = crew === 'whitebeard' || crew === 'blackbeard' ? SKIN_TAN : SKIN;
    const faceRx = crew === 'blackbeard' ? 17.5 : crew === 'whitebeard' ? 16.5 : 14.5, faceRy = crew === 'blackbeard' ? 17 : 17;
    const inFace = (x, y) => { const dx = (x + 0.5 - cx) / faceRx, dy = (y + 0.5 - hy) / faceRy; return dx * dx + dy * dy <= 1; };

    // ---- torso / clothes
    const torso = (main, shade, open, inner) => {
      fg.ell(cx, 104, 44, 30, main);
      fg.ell(cx + 22, 108, 26, 30, shade, (x, y) => fg.get(x, y) === main);
      if (open) {
        for (let y = 74; y < PH; y++) {
          const w = Math.max(0, (y - 74) * 0.55 + 3);
          for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) if (fg.get(x, y) >= 0) fg.set(x, y, inner);
        }
      }
    };
    // neck
    const neck = () => { fg.rect(cx - 6, 58, 13, 18, skin.a); fg.rect(cx + 2, 58, 5, 18, skin.b); fg.rect(cx - 6, 60, 13, 2, skin.b); };
    // head with side shading, ears
    const head = () => {
      fg.ell(cx - faceRx, hy + 2, 3, 4.5, skin.b); fg.ell(cx + faceRx, hy + 2, 3, 4.5, skin.c);
      fg.ell(cx, hy, faceRx, faceRy, skin.a);
      fg.ell(cx + faceRx * 0.95, hy + 2, faceRx * 0.62, faceRy * 0.95, skin.b, inFace);
      fg.ell(cx - 5, hy - 9, 4, 2, mix(skin.a, 0xffffff, 0.35), inFace);
    };
    const eyes = (o) => {
      o = o || {};
      const ey = hy + (o.dy || 1), sep = o.sep || 6;
      [-1, 1].forEach((s) => {
        const ex = cx + s * sep;
        if (o.narrow) { fg.rect(ex - 2, ey, 4, 1, PAL.out); fg.rect(ex - 1, ey + 1, 2, 1, PAL.out); }
        else {
          fg.rect(ex - 2, ey - 1, 4, 3, 0xffffff);
          fg.rect(ex - (s < 0 ? 0 : 1), ey - 1, 2, 3, PAL.out);
          fg.set(ex - (s < 0 ? 0 : 1), ey - 1, 0xffffff);
        }
        // brows
        const by = ey - (o.browUp || 4);
        if (o.angry) { fg.line(ex - 3 * s * -1, by - 1, ex + 2 * s * -1, by + 1, PAL.out); fg.line(ex - 3 * s * -1, by, ex + 2 * s * -1, by + 2, PAL.out); }
        else fg.rect(ex - 3, by, 6, o.thick ? 2 : 1, o.brow != null ? o.brow : PAL.out);
      });
      if (o.bags) [-1, 1].forEach((s) => fg.rect(cx + s * sep - 2, ey + 3, 4, 1, mix(skin.b, 0x5a3a6a, 0.5)));
    };
    const nose = (big) => { fg.rect(cx + 1, hy + 4, 2, big ? 5 : 4, skin.b); fg.rect(cx - 1, hy + (big ? 8 : 7), big ? 5 : 3, 1, skin.c); };

    if (crew === 'strawHat') {
      torso(0xc8302c, 0x962022, true, skin.a);
      fg.rect(cx - 1, 82, 3, 1, skin.b); fg.rect(cx - 4, 86, 8, 1, skin.b);
      neck(); head();
      // messy black hair under the hat
      for (let x = cx - 16; x <= cx + 16; x++) {
        const k = Math.abs(x - cx);
        const h = 8 + ((x * 7) % 5) - (k > 12 ? 2 : 0);
        for (let y = hy - 16; y < hy - 16 + h; y++) if (fg.get(x, y) >= 0 || k < 16) fg.set(x, y, k > 10 ? 0x141018 : 0x221a24);
      }
      [[cx - 15, hy - 4], [cx - 16, hy + 1], [cx + 15, hy - 4], [cx + 16, hy], [cx - 9, hy - 7], [cx + 8, hy - 7], [cx - 3, hy - 6]].forEach((p) => fg.rect(p[0] - 1, p[1] - 4, 3, 5, 0x1a1420));
      eyes({ dy: 1, sep: 6, browUp: 5 });
      nose();
      // big grin
      fg.ell(cx, hy + 10, 9, 4.5, PAL.out, (x, y) => y >= hy + 10);
      fg.rect(cx - 7, hy + 10, 15, 2, 0xffffff);
      fg.ell(cx, hy + 13, 5, 1.5, 0xc04a4a, (x, y) => y >= hy + 13);
      // scar under the eye
      fg.rect(cx + 4, hy + 5, 5, 1, 0x9a4a3a); fg.set(cx + 5, hy + 4, 0x9a4a3a); fg.set(cx + 7, hy + 6, 0x9a4a3a);
      // straw hat
      const hatY = hy - 17;
      fg.ell(cx, hatY + 4, 31, 6.5, 0xd8a838);
      fg.ell(cx, hatY + 3, 30, 5, 0xf2cc56);
      for (let x = cx - 28; x < cx + 28; x += 3) fg.set(x, hatY + 3 + ((x & 1) ? 1 : 0), 0xc99a2e);
      fg.ell(cx, hatY - 3, 17, 10, 0xf2cc56, (x, y) => y <= hatY + 1);
      fg.ell(cx + 8, hatY - 3, 9, 9.5, 0xd8a838, (x, y) => y <= hatY + 1 && fg.get(x, y) === 0xf2cc56);
      fg.rect(cx - 16, hatY - 3, 33, 4, 0xc8302c); fg.rect(cx + 6, hatY - 3, 11, 4, 0x962022);
      fg.rect(cx - 13, hatY - 11, 8, 1, 0xfbe08a);
    } else if (crew === 'whitebeard') {
      torso(0xf2eee4, 0xc8c2b8, true, skin.a);
      fg.rect(cx - 2, 80, 5, 14, skin.b);
      neck(); head();
      // navy bandana over the scalp, knot on the side
      fg.ell(cx, hy - 9, faceRx + 1.5, 10.5, 0x2a3260, (x, y) => y <= hy - 6);
      fg.rect(cx - faceRx - 1, hy - 8, faceRx * 2 + 3, 3, 0x1c2246);
      fg.rect(cx + faceRx - 2, hy - 6, 4, 9, 0x2a3260); fg.rect(cx + faceRx + 1, hy - 2, 3, 6, 0x1c2246);
      eyes({ dy: 2, sep: 6, narrow: true, angry: true, browUp: 4 });
      nose(true);
      // the great white crescent moustache sweeping up past the face
      for (let i = -30; i <= 30; i++) {
        const x = cx + i, u = Math.abs(i) / 30;
        const y = Math.round(hy + 11 - u * u * 26);
        const th = u > 0.85 ? 2 : 3;
        for (let k = 0; k < th; k++) fg.set(x, y + k, u > 0.6 ? 0xe8e8f0 : 0xffffff);
        fg.set(x, y + th, 0xb8b8c8);
      }
      fg.rect(cx - 4, hy + 15, 9, 1, PAL.out);
    } else if (crew === 'redHair') {
      torso(0x22202e, 0x14121c, true, 0xf2eee4);
      fg.rect(cx - 6, 76, 13, 18, 0xf2eee4); fg.rect(cx - 2, 76, 5, 18, skin.a);
      neck(); head();
      // red hair: fringe, sides falling past the ears
      fg.ell(cx, hy - 8, faceRx + 3, 12, 0xc22a2a, (x, y) => y <= hy - 4);
      fg.rect(cx - faceRx - 3, hy - 8, 6, 22, 0xc22a2a); fg.rect(cx + faceRx - 2, hy - 8, 6, 22, 0x9a1e24);
      for (let x = cx - 12; x <= cx + 12; x += 4) fg.rect(x, hy - 6, 3, 4 + ((x * 3) & 3), 0xd83a34);
      fg.ell(cx + 6, hy - 10, 8, 5, 0x9a1e24, (x, y) => fg.get(x, y) === 0xc22a2a);
      eyes({ dy: 2, sep: 6, browUp: 4, narrow: false });
      nose();
      fg.rect(cx - 4, hy + 11, 9, 1, PAL.out); fg.set(cx + 5, hy + 10, PAL.out);
      // three scars over the left eye
      [-1, 1, 3].forEach((d) => fg.line(cx + 4 + d, hy - 6, cx + 7 + d, hy + 6, 0x9a3a32));
      // stubble
      for (let x = cx - 8; x <= cx + 8; x += 2) fg.set(x, hy + 14 + ((x >> 1) & 1), skin.c);
    } else if (crew === 'heart') {
      torso(0xf2c43a, 0xc89a22, true, 0x1c1a24);
      fg.rect(cx - 15, 80, 4, 14, 0x1c1a24); fg.rect(cx + 12, 80, 4, 14, 0x1c1a24);
      neck(); head();
      fg.rect(cx - faceRx, hy - 4, 3, 12, 0x1c1a24); fg.rect(cx + faceRx - 2, hy - 4, 3, 12, 0x1c1a24);
      eyes({ dy: 2, sep: 6, narrow: true, bags: true, browUp: 4 });
      nose();
      fg.rect(cx - 3, hy + 11, 7, 1, PAL.out);
      // goatee
      fg.rect(cx - 2, hy + 14, 5, 3, 0x1c1a24);
      // fluffy spotted hat
      const hatY = hy - 14;
      fg.ell(cx, hatY - 2, 19, 13, 0xf4f0e8, (x, y) => y <= hatY + 4);
      fg.ell(cx + 9, hatY - 2, 10, 12, 0xd8d2c8, (x, y) => fg.get(x, y) === 0xf4f0e8);
      for (let x = cx - 20; x <= cx + 20; x += 3) fg.ell(x, hatY + 4, 2.4, 2.4, (x >> 1) & 1 ? 0xf4f0e8 : 0xe2dcd0);
      [[cx - 9, hatY - 8], [cx + 4, hatY - 10], [cx - 2, hatY - 2], [cx + 10, hatY - 3], [cx - 13, hatY - 1]].forEach((p) => fg.rect(p[0], p[1], 3, 2, 0x5a4a34));
      // gold earrings
      fg.rect(cx - faceRx - 2, hy + 6, 1, 2, PAL.brass); fg.rect(cx + faceRx + 1, hy + 6, 1, 2, PAL.brass);
    } else if (crew === 'blackbeard') {
      torso(0x7a2a2e, 0x561c22, true, skin.a);
      for (let y = 80; y < 94; y += 3) for (let x = cx - 4; x <= cx + 4; x += 3) fg.set(x + ((y >> 1) & 1), y, skin.c);
      neck(); head();
      // bandana
      fg.ell(cx, hy - 9, faceRx + 1, 10.5, 0x2a2430, (x, y) => y <= hy - 7);
      fg.rect(cx - faceRx, hy - 8, faceRx * 2 + 1, 2, 0x5a2a38);
      // black hair tufts at the sides
      fg.rect(cx - faceRx - 2, hy - 6, 5, 10, 0x18141e); fg.rect(cx + faceRx - 2, hy - 6, 5, 10, 0x18141e);
      eyes({ dy: 0, sep: 7, browUp: 4, thick: true });
      nose(true); fg.ell(cx + 1, hy + 6, 3.5, 2.5, skin.b);
      // huge beard around the jaw and chin
      fg.ell(cx, hy + 14, faceRx + 3, 13, 0x18141e, (x, y) => y >= hy + 6);
      for (let x = cx - 14; x <= cx + 14; x += 3) fg.set(x, hy + 20 + ((x * 5) % 4), 0x2e2834);
      // gap-toothed grin
      fg.ell(cx, hy + 11, 8, 3.5, PAL.out);
      fg.rect(cx - 6, hy + 10, 13, 2, 0xfff4dc);
      [cx - 3, cx + 2, cx + 4].forEach((x) => fg.rect(x, hy + 10, 1, 2, PAL.out));
    } else {   // marine: Garp
      torso(0xf4f2ec, 0xcac6bc, true, 0x2a3a6a);
      fg.rect(cx - 2, 76, 5, 18, 0x2a3a6a);
      fg.rect(cx - 1, 78, 3, 10, 0x6a8ac8);
      neck(); head();
      // grey sideburns + beard along the jaw
      fg.rect(cx - faceRx, hy - 2, 3, 10, 0xa8a8b0); fg.rect(cx + faceRx - 2, hy - 2, 3, 10, 0x8a8a96);
      fg.ell(cx, hy + 13, faceRx, 7, 0xb8b8c0, (x, y) => y >= hy + 10 && inFace(x, y));
      eyes({ dy: 2, sep: 6, angry: true, browUp: 4 });
      nose(true);
      fg.rect(cx - 4, hy + 11, 9, 1, PAL.out);
      // scar over the left eye
      fg.line(cx + 5, hy - 6, cx + 8, hy + 7, 0x9a4a3a); fg.line(cx + 3, hy - 2, cx + 10, hy, 0x9a4a3a);
      // marine cap: white crown, navy band, short visor
      const capY = hy - 13;
      fg.ell(cx, capY - 1, 18, 8, 0xf4f2ec, (x, y) => y <= capY + 2);
      fg.ell(cx + 8, capY - 1, 10, 8, 0xd2cec4, (x, y) => fg.get(x, y) === 0xf4f2ec);
      fg.rect(cx - 16, capY + 1, 33, 3, 0x2a4f9a);
      fg.rect(cx - 12, capY + 4, 25, 2, 0x18264a);
      fg.rect(cx - 2, capY - 4, 5, 4, 0x6a8ac8); fg.rect(cx - 1, capY - 3, 3, 2, 0xf4f2ec);
    }
    fg.outline(PAL.out);
    bg.over(fg, 0, 0);
    // photo print: pull slightly toward the paper so it sits in the poster
    for (let i = 0; i < bg.c.length; i++) bg.c[i] = mix(bg.c[i], PAL.p1, 0.14);
    return bg;
  }

  // ------------------------------------------------------------------ poster
  const cache = { key: null, base: null, layout: null, work: null, img: null };
  let fontKick = false;

  function fontsOk() {
    try { return typeof document !== 'undefined' && document.fonts && document.fonts.check('20px "Pirata One"') && document.fonts.check('12px "Pixelify Sans"'); } catch (e) { return false; }
  }
  function kickFonts() {
    if (fontKick || typeof document === 'undefined' || !document.fonts || !document.fonts.load) return null;
    fontKick = true;
    return Promise.all([
      document.fonts.load('32px "Pirata One"', 'PROCURADOÇÃÉ'), document.fonts.load('700 12px "Pixelify Sans"', 'Chapéus ção'),
      document.fonts.load('400 12px "Pixelify Sans"', 'Chapéus ção')
    ]).catch(() => null);
  }
  function ready() {
    const p = kickFonts();
    return Promise.resolve(p).then(() => (GLT.i18n && GLT.i18n.fontsReady ? GLT.i18n.fontsReady() : null)).then(() => undefined, () => undefined);
  }

  function buildBase(crew, seed, hero) {
    const T = GLT.T;
    const rng = GLT.rng.create((seed >>> 0) ^ 0x7a11ed);
    const buf = new Buf(W, H);
    const n1 = valueNoise(rng, W, H, 22), n2 = valueNoise(rng, W, H, 6), n3 = valueNoise(rng, W, H, 3);
    // ragged edges
    const left = [], right = [], top = [], bot = [];
    for (let y = 0; y < H; y++) { left.push(1 + Math.round(n2(2, y) * 3)); right.push(1 + Math.round(n2(W - 3, y) * 3)); }
    for (let x = 0; x < W; x++) { top.push(1 + Math.round(n2(x, 2) * 2.5)); bot.push(1 + Math.round(n2(x, H - 3) * 3)); }
    const tear = 16 + (rng.next() * 8 | 0);
    const inside = (x, y) => x >= left[y] && x < W - right[y] && y >= top[x] && y < H - bot[x] && (W - x) + (H - y) > tear;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const d = Math.min(x - left[y], W - right[y] - 1 - x, y - top[x], H - bot[x] - 1 - y, (W - x) + (H - y) - tear - 1);
      let a = n1(x, y) * 0.55 + n2(x, y) * 0.3 + n3(x, y) * 0.15;
      a = (a - 0.32) * 1.1;
      if (d < 9) a += (9 - d) / 9 * 0.95;
      const lv = a * 3 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;
      let c = lv < 0.55 ? PAL.p0 : lv < 1.45 ? PAL.p1 : lv < 2.35 ? PAL.p2 : lv < 3.0 ? PAL.p3 : PAL.burn;
      if (d === 0) c = PAL.edge; else if (d === 1 && c !== PAL.p0) c = mix(c, PAL.burn, 0.5);
      buf.set(x, y, c);
    }
    // the torn corner is folded back: the flap shows the paper's darker back with a crisp fold line
    for (let y = H - tear; y < H; y++) for (let x = W - tear; x < W; x++) {
      const sd = (W - x) + (H - y);
      if (sd <= tear || buf.get(x, y) < 0) continue;
      if (sd <= tear + 1) buf.set(x, y, PAL.edge);
      else if ((W - x) < 2 || (H - y) < 2 || x === W - tear || y === H - tear) buf.set(x, y, PAL.burn);
      else buf.set(x, y, (sd + BAYER[(y & 3) * 4 + (x & 3)] / 4) < tear + 6 ? PAL.p3 : PAL.p2);
    }
    // coffee rings
    for (let k = 0; k < 2; k++) {
      const cx = 20 + rng.next() * (W - 40), cy = 150 + rng.next() * 70, r = 7 + rng.next() * 6;
      for (let a = 0; a < 6.283; a += 0.04) {
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.9);
        if (buf.get(x, y) >= 0 && ((x + y) & 1)) buf.set(x, y, mix(buf.get(x, y), PAL.burn, 0.45));
      }
    }
    // fold creases
    const fy = Math.round(H * 0.56), fx = Math.round(W * 0.5);
    for (let x = 0; x < W; x++) if (buf.get(x, fy) >= 0 && n3(x, fy) > 0.25) { buf.set(x, fy, mix(buf.get(x, fy), PAL.p3, 0.6)); if (buf.get(x, fy + 1) >= 0) buf.set(x, fy + 1, mix(buf.get(x, fy + 1), PAL.hi, 0.5)); }
    for (let y = 0; y < H; y++) if (buf.get(fx, y) >= 0 && n3(fx, y) > 0.3) { buf.set(fx, y, mix(buf.get(fx, y), PAL.p3, 0.5)); if (buf.get(fx + 1, y) >= 0) buf.set(fx + 1, y, mix(buf.get(fx + 1, y), PAL.hi, 0.45)); }

    // title
    const title = hero ? T('ceremony.hero') : T('ceremony.wanted');
    const tm = textMask(title.toLocaleUpperCase('pt-BR'), '"Pirata One", Georgia, serif', '400', W - 26, 40, 14, 118);
    const ty = 12 + Math.max(0, Math.round((30 - tm.h) / 2));
    stampMask(buf, tm, Math.round((W - tm.w) / 2), ty, PAL.ink, PAL.burn);
    // rule under the title
    const ry = 46;
    buf.rect(12, ry, W - 24, 1, PAL.ink2);
    // photo frame
    const fx0 = 15, fy0 = 50, fw = 138, fh = 98;
    buf.rect(fx0, fy0, fw, fh, PAL.ink);
    buf.rect(fx0 + 1, fy0 + 1, fw - 2, fh - 2, PAL.p1);
    buf.over(portrait(GLT.data.crews[crew] ? crew : 'strawHat', rng), fx0 + 2, fy0 + 2);
    buf.rect(fx0 + 2, fy0 + fh - 2, fw - 4, 1, PAL.ink2);
    // inner shadow line on the photo top/left
    for (let x = fx0 + 2; x < fx0 + fw - 2; x++) buf.set(x, fy0 + 2, mix(buf.get(x, fy0 + 2), PAL.ink, 0.35));
    // "VIVO OU MORTO" with flanking rules (hero: "RECOMPENSA")
    const sub = (hero ? T('ceremony.bounty') : T('ceremony.deadOrAlive')).toLocaleUpperCase('pt-BR');
    const sm = textMask(sub, '"Pirata One", Georgia, serif', '400', W - 60, 17, 10, 118);
    const sy = fy0 + fh + 4;
    const sx = Math.round((W - sm.w) / 2);
    stampMask(buf, sm, sx, sy, PAL.ink);
    const midY = sy + Math.round(sm.h / 2);
    buf.rect(14, midY, sx - 19, 1, PAL.ink2); buf.rect(sx + sm.w + 5, midY, W - 14 - (sx + sm.w + 5), 1, PAL.ink2);
    buf.rect(sx - 4, midY - 1, 1, 3, PAL.ink2); buf.rect(sx + sm.w + 3, midY - 1, 1, 3, PAL.ink2);
    // captain name
    const cr = GLT.data.crews[crew] || GLT.data.crews.strawHat;
    const name = T(cr.captainKey).toLocaleUpperCase('pt-BR');
    const nm = textMask(name, '"Pirata One", Georgia, serif', '400', W - 22, 26, 12, 118);
    const ny = sy + sm.h + 5;
    stampMask(buf, nm, Math.round((W - nm.w) / 2), ny, PAL.ink, PAL.p3);
    // crew line
    const crewName = T(cr.nameKey);
    const cm = textMask(crewName, '"Pixelify Sans", monospace', '600', W - 30, 12, 8, 128);
    const cy = ny + nm.h + 4;
    stampMask(buf, cm, Math.round((W - cm.w) / 2), cy, PAL.ink2);
    const by = Math.max(cy + cm.h + 6, 203);
    // bounty plate rules
    buf.rect(16, by - 3, W - 32, 1, PAL.ink2);
    buf.rect(16, by + 19, W - 32, 1, PAL.ink2);
    // brass pin at the top centre with a drop shadow
    const px = Math.round(W / 2) - 2;
    buf.rect(px + 1, 6, 5, 4, PAL.p3); buf.rect(px, 4, 5, 5, PAL.brass2); buf.rect(px + 1, 4, 3, 3, PAL.brass); buf.set(px + 1, 4, 0xfff0b0);
    return { buf, by, seal: { x: fx0 + fw - 20, y: fy0 + fh - 18 } };
  }

  function draw(canvas, o) {
    if (!canvas || !canvas.getContext) return null;
    o = o || {};
    kickFonts();
    const crew = GLT.data.crews[o.crew] ? o.crew : 'strawHat';
    const seed = o.seed != null ? (o.seed >>> 0) : 1;
    const hero = !!o.hero;
    const key = crew + '|' + seed + '|' + hero + '|' + fontsOk();
    if (cache.key !== key) { const b = buildBase(crew, seed, hero); cache.key = key; cache.base = b.buf; cache.layout = { by: b.by, seal: b.seal }; }
    const prog = Math.max(0, Math.min(1, o.progress == null ? 1 : +o.progress));
    const bounty = Math.max(0, Math.round(+o.bounty || 0));
    // count-up: fast start, digits settle at the end
    const e = 1 - Math.pow(1 - prog, 3);
    const shown = prog >= 1 ? bounty : Math.floor(bounty * e);
    const str = GLT.i18n && GLT.i18n.num ? GLT.i18n.num(shown) : String(shown);
    if (!cache.work) cache.work = new Buf(W, H);
    const buf = cache.work;
    buf.c.set(cache.base.c);
    const by = cache.layout.by;
    const s = 2;
    let tw = numWidth(str, s) + 5 * s + 6;
    let sc = s;
    if (tw > W - 12) { sc = 1; tw = numWidth(str, 1) + 5 + 6; }
    const x0 = Math.round((W - tw) / 2);
    drawBerry(buf, x0, by + 2, sc, PAL.ink);
    drawNum(buf, str, x0 + 5 * sc + 6, by + 2, sc, PAL.ink, PAL.ink2);
    // the seal slams down when the count settles
    if (prog >= 1) seal(buf, crew, hero, cache.layout.seal);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const g = canvas.getContext('2d');
    if (!cache.img) cache.img = g.createImageData(W, H);
    const img = cache.img;
    const d = img.data;
    for (let i = 0; i < buf.c.length; i++) {
      const c = buf.c[i];
      if (c < 0) { d[i * 4 + 3] = 0; continue; }
      d[i * 4] = (c >> 16) & 255; d[i * 4 + 1] = (c >> 8) & 255; d[i * 4 + 2] = c & 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return { w: W, h: H, shown, fonts: fontsOk() };
  }

  // round ink seal with the crew's Jolly Roger glyph, dithered like a real stamp
  function seal(buf, crew, hero, at) {
    const cx = at.x, cy = at.y, R = 15;
    const ink = hero ? PAL.blue : PAL.red;
    const rng = GLT.rng.create(0x5ea1 ^ crew.length);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const d = Math.sqrt(x * x + y * y);
      const ring = (d <= R && d > R - 2.2) || (d <= R - 4 && d > R - 5);
      if (ring && rng.next() > 0.18) buf.set(cx + x, cy + y, ink);
    }
    let G = null;
    if (GLT.flags && GLT.flags.glyph) { try { G = GLT.flags.glyph(GLT.data.crews[crew].flag, false); } catch (e) { G = null; } }
    if (G) {
      const ox = cx - Math.floor(G.w / 2), oy = cy - Math.floor(G.h / 2);
      for (let r = 0; r < G.h; r++) for (let c = 0; c < G.w; c++) if (G.at(c, r) && rng.next() > 0.12) buf.set(ox + c, oy + r, ink);
    } else {
      buf.ell(cx, cy - 1, 4, 4, ink); buf.set(cx - 2, cy - 1, PAL.p1); buf.set(cx + 1, cy - 1, PAL.p1);
    }
  }

  GLT._fx_wanted = { draw, ready, W, H };
})();
