/* GLT.flags: procedural pixel Jolly Rogers and ship flags (canvas + cached textures). Area: ships. Contract: ARCHITECTURE.md §11.2.
 *
 * Every flag is ONE hand-placed 13x11 pixel glyph (original tribute art, no official artwork). The same glyph feeds:
 *  - jollyRoger(flag, size): a crisp canvas (width = size, height = round(size * 3/4)), integer-scaled glyph on its field;
 *  - texture(flag) / pennant(color): cached nearest-filtered THREE.CanvasTextures (call time only);
 *  - GLT.shipModels: stamps the glyph onto voxel sails and voxel mast-top flags (glyph(flag) is the shared source).
 * Glyph legend: '.' field, 'w' bone, 'k' hole (field colour on a flag, sail colour on a sail), 'y' straw, 'r' red,
 * 's' steel, 'g' gold, 'b' wood, 'u' marine blue.
 * No THREE/DOM/GLT access at load time (call time only). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const GW = 13, GH = 11;

  const GLYPHS = {
    // Straw Hat: skull with the straw hat (red band), crossbones behind.
    strawHat: [
      '....yyyyy....',
      '...yyyyyyy...',
      '...rrrrrrr...',
      '.yyyyyyyyyyy.',
      'ww.wwwwwww.ww',
      '.w.wkkwkkw.w.',
      '..wwkkwkkww..',
      '...wwwkwww...',
      '..w.wwwww.w..',
      '.w..wkwkw..w.',
      'ww.........ww'
    ],
    // Whitebeard: skull with the huge crescent moustache, a cross behind.
    whitebeard: [
      '......w......',
      '....wwwww....',
      '...wwwwwww...',
      'wwwwkkwkkwwww',
      '...wkkwkkw...',
      '...wwwkwww...',
      'w...wwwww...w',
      'ww.........ww',
      '.wwwwwwwwwww.',
      '....wkwkw....',
      '......w......'
    ],
    // Red-Haired: skull with three scars over one eye, crossed sabres behind.
    redHair: [
      's...........s',
      '.s..wwwww..s.',
      '..swwwwwrws..',
      '...wkkwkrw...',
      '...wkkwkrw...',
      '...wwwkwww...',
      '....wwwww....',
      '...swkwkws...',
      '..gg.....gg..',
      '.b.........b.',
      'b...........b'
    ],
    // Heart: a grinning, smiley-like skull.
    heart: [
      '....wwwww....',
      '..wwwwwwwww..',
      '.wwkkwwwkkww.',
      '.wwkkwwwkkww.',
      'wwwwwwwwwwwww',
      'wwkwwwkwwwkww',
      'wwwkwwwwwkwww',
      '.wwwkkkkkwww.',
      '.wwwwwwwwwww.',
      '..wwwwwwwww..',
      '....wwwww....'
    ],
    // Blackbeard: three skulls.
    blackbeard: [
      '..www...www..',
      '.wkwkw.wkwkw.',
      '.wwwww.wwwww.',
      '..w.w...w.w..',
      '.............',
      '.....www.....',
      '....wkwkw....',
      '....wwwww....',
      '.....w.w.....',
      '..w.......w..',
      '.w.wwwwwww.w.'
    ],
    // Marines: a gull over an anchor (blue on white; original drawing, no lettering).
    marine: [
      '.............',
      '.uu.......uu.',
      '...uu...uu...',
      '.....uuu.....',
      '.............',
      '.....uuu.....',
      '...uuuuuuu...',
      '......u......',
      '..u...u...u..',
      '...u..u..u...',
      '....uuuuu....'
    ],
    // Roger: skull, curled moustache, crossbones.
    roger: [
      'ww.........ww',
      '.w..wwwww..w.',
      '..wwwwwwwww..',
      '...wkkwkkw...',
      '...wkkwkkw...',
      '...wwwkwww...',
      '..w.wwkww.w..',
      '..wwww.wwww..',
      '....wkwkw....',
      '.w.........w.',
      'ww.........ww'
    ],
    // Baratie: skull in a chef's toque, crossed cutlery.
    baratie: [
      '...wwwwwww...',
      '..wwwwwwwww..',
      '...wwwwwww...',
      '....sssss....',
      's...wwwww...s',
      '.s.wkkwkkw.s.',
      '..swkkwkkws..',
      '...wwwkwww...',
      '..s.wwwww.s..',
      '.s..wkwkw..s.',
      'b...........b'
    ]
  };

  // Field (background) colour per flag, and the per-letter colours on a flag / on a cream sail.
  const FIELD = { marine: '#fffbf0' };
  const FIELD_DEFAULT = '#1a1628';
  const INK = { w: '#fffbf0', y: '#f4c443', r: '#bc302e', s: '#a29cb4', g: '#c48e26', b: '#683a22', u: '#2d62c6' };
  const ON_SAIL = { w: '#1a1628', y: '#f4c443', r: '#bc302e', s: '#463f5c', g: '#c48e26', b: '#683a22', u: '#2d62c6' };

  function known(flag) { return Object.prototype.hasOwnProperty.call(GLYPHS, flag) ? flag : 'strawHat'; }

  // Shared glyph description: rows top-down, plus colour lookups.
  // On a flag: bone white on the field, holes show the field. On a cream sail (`onSail`), the emblem is painted the way
  // the series paints sails: an ink OUTLINE around the bone shapes (interior left cream), ink eye/nose holes, and the
  // coloured parts (straw hat, scars, hilts, anchor) kept in colour. Returns null where the cloth shows through.
  function glyph(flag, onSail) {
    const id = known(flag);
    const field = FIELD[id] || FIELD_DEFAULT;
    const rows = GLYPHS[id];
    const ch = (c, r) => (r >= 0 && r < GH && c >= 0 && c < GW ? rows[r].charAt(c) : '.');
    return {
      id, w: GW, h: GH, rows, field,
      at(c, r) {
        const k = ch(c, r);
        if (k === '.' || !k) return null;
        if (!onSail) return k === 'k' ? null : (INK[k] || null);
        if (k === 'k') return ON_SAIL.w;
        if (k === 'w') {
          const edge = ch(c - 1, r) === '.' || ch(c + 1, r) === '.' || ch(c, r - 1) === '.' || ch(c, r + 1) === '.' ||
            (c === 0 || r === 0 || c === GW - 1 || r === GH - 1);
          return edge ? ON_SAIL.w : null;
        }
        return ON_SAIL[k] || null;
      }
    };
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  // Draws a flag into ctx2d at (x0,y0) with size w x h: field, darker hem, cloth folds, integer-scaled glyph.
  function drawFlag(g2, flag, x0, y0, w, h) {
    const G = glyph(flag, false);
    g2.fillStyle = G.field;
    g2.fillRect(x0, y0, w, h);
    const s = Math.max(1, Math.floor(Math.min((w - 2) / GW, (h - 2) / GH)));
    const ox = x0 + Math.floor((w - GW * s) / 2), oy = y0 + Math.floor((h - GH * s) / 2);
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const col = G.at(c, r);
      if (!col) continue;
      g2.fillStyle = col;
      g2.fillRect(ox + c * s, oy + r * s, s, s);
    }
    // cloth folds: two soft vertical bands (one pixel wide per glyph pixel), hem on the fly end
    const dark = shade(G.field, G.field === FIELD_DEFAULT ? 0.55 : 0.86);
    g2.globalAlpha = 0.28;
    g2.fillStyle = '#000000';
    const fold = Math.max(1, s);
    g2.fillRect(x0 + Math.round(w * 0.36), y0, fold, h);
    g2.fillRect(x0 + Math.round(w * 0.72), y0, fold, h);
    g2.globalAlpha = 1;
    g2.fillStyle = dark;
    g2.fillRect(x0 + w - fold, y0, fold, h);
    g2.fillRect(x0, y0 + h - 1, w, 1);
  }

  const canvasCache = {};
  function jollyRoger(flag, size) {
    size = Math.max(16, Math.round(size || 32));
    const id = known(flag);
    const key = id + '@' + size;
    if (canvasCache[key]) return canvasCache[key];
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = Math.round(size * 0.75);
    const g2 = cv.getContext('2d');
    g2.imageSmoothingEnabled = false;
    drawFlag(g2, id, 0, 0, cv.width, cv.height);
    canvasCache[key] = cv;
    return cv;
  }

  function nearestTexture(cv) {
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const texCache = {};
  function texture(flag) {
    const id = known(flag);
    if (!texCache[id]) texCache[id] = nearestTexture(jollyRoger(id, 52));
    return texCache[id];
  }

  // Swallow-tailed streamer in the owner's colour (32 x 8), transparent outside the cloth.
  const penCache = {};
  function pennant(color, color2) {
    const c1 = /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#e23b2e';
    const c2 = /^#[0-9a-f]{6}$/i.test(color2 || '') ? color2 : '#fffbf0';
    const key = c1 + c2;
    if (penCache[key]) return penCache[key];
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 8;
    const g2 = cv.getContext('2d');
    for (let x = 0; x < 32; x++) {
      const half = 4 - Math.floor((x / 32) * 3);           // tapers 4 -> 2 rows each side
      for (let y = 4 - half; y < 4 + half; y++) {
        if (x > 26 && (y === 3 || y === 4)) continue;     // swallow tail notch
        g2.fillStyle = (y === 3 || y === 4) && x > 4 && x < 24 ? c2 : (y === 4 - half ? shade(c1, 1.15) : c1);
        g2.fillRect(x, y, 1, 1);
      }
    }
    penCache[key] = nearestTexture(cv);
    return penCache[key];
  }

  GLT.flags = {
    jollyRoger,
    texture,
    pennant,
    // additions (ships area)
    glyph,
    drawFlag,
    ids() { return Object.keys(GLYPHS); },
    GW, GH
  };
})();
