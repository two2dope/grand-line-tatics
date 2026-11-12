/* GLT.plates: the two floating sea-plates. Area: world. Contract: ARCHITECTURE.md §9, §11.1.
 *
 * Per plate (both plates share every mesh below, so the draw-call cost does not grow with n):
 *  - body: ONE merged voxel mesh (0.5 m voxels, baked AO) for both plates: square stone rim with raised A-L / 1-12
 *    plaques, terraced ledges (grass tops, banded soil + slate strata), hanging vines, kelp at the waterline, boulder
 *    piles, a dark basin floor under the grid and corner lantern posts (emissive mesh).
 *  - border: the owner's colour as a 1 m lip on the rim's inner edge (rebuilt by setColors only).
 *  - water: an InstancedMesh of n*n voxel water columns per plate; heights follow a travelling swell (quantised to
 *    1/8 m so it stays "voxel"), colours band by height (trough / sea / light / crest), plus marks and foam tints. A
 *    small shader adds 0.5 m sub-voxel ripples and glints on the tops (world-space, so cells never repeat).
 *  - waterfalls: notches in the rim feed cascades that step down the terraces into the ocean (one mesh, scrolling
 *    streak texture) with instanced splash foam where each step lands; instanced pebbles fall from the cliffs.
 *  - markers (miss ring / hit peg / sunk flag / revealed gem) instanced per kind; they pop in and ride the swell.
 *  - overlays: ghost tiles (setup), annotations (Haki 3x3, Room line), cursor frames (hover + main), sunk outlines.
 *  - plate name plaque ("Suas águas" / "Águas inimigas", GLT.T) drawn on the front rim with a canvas texture.
 * Picking: GLT.plates.pick(clientX, clientY) / pickRay(origin, dir) intersect the plane y = PLATE_Y and map with
 * GLT.layout.worldToCell, so the cell under the pointer is exact (the swell never moves the logical surface). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const PLATES = ['own', 'enemy'];
  const VS = 0.5;               // body voxel size (m)
  const CELL_GAP = 0.04;        // columns almost touch; the grid line is drawn by the water shader (uLineW)
  const CELL_BASE = 7.3;        // bottom of a water column (y)
  const MARK_KINDS = ['miss', 'hit', 'sunk', 'seen', 'faded'];   // mark 5 'faded': a miss under fog / absorbed shot

  const S = {
    ok: false, n: 0, root: null, body: null, border: null, water: null, waterMat: null, falls: null, splash: null,
    pebbles: null, markers: {}, ghost: null, overlay: null, cursorMain: null, cursorHover: null, outline: { own: null, enemy: null },
    plaques: { own: null, enemy: null }, roomGlyphs: null,
    colors: { own: '#e0b030', enemy: '#2d63c8' },
    marks: { own: null, enemy: null }, markBorn: { own: null, enemy: null }, foam: { own: null, enemy: null },
    heights: { own: null, enemy: null }, ships: { own: [], enemy: [] }, outlines: { own: [], enemy: [] },
    ghostCells: null, ghostValid: true, annotations: { own: [], enemy: [] },
    cursor: { plate: null, r: 0, c: 0, state: 'selected', born: 0 }, hover: { plate: null, r: 0, c: 0 },
    hintUntil: -1, splashPts: [], pebblePts: [], offs: [], storm: 0, waterCols: null
  };

  function K() { return GLT._world_kit; }
  function L() { return GLT.layout; }
  function Cn() { return GLT.C; }
  const pIdx = (p) => (p === 'enemy' ? 1 : 0);

  // ------------------------------------------------------------------ swell
  // A calm, slow swell: long diagonal crests (about 7 cells apart) that rise one 1/8 m step, so the grid reads as one
  // quiet sheet of water with a gentle light band moving across it instead of a patchwork.
  function swell(pi, r, c, t, amp) {
    const a = Math.sin(c * 0.62 + r * 0.38 - t * 1.1 + pi * 1.3);
    const b = Math.sin(r * 0.71 - c * 0.24 + t * 0.8 + pi * 0.7);
    const h = (0.085 * a + 0.05 * b) * amp;
    return Math.round(h * 8) / 8;
  }

  // ------------------------------------------------------------------ body (voxels)
  // Column top (voxel j index, top face at (j+1)*VS) for a column outside the grid; -99 = empty (ocean).
  function columnInfo(i, k, G, notch) {
    const ax = Math.abs(i + 0.5), ak = Math.abs(k + 0.5);
    const ex = ax - G, ek = ak - G;
    if (ex < 0 && ek < 0) return { zone: 'grid', jt: 13 };
    const dc = Math.max(ex, ek);
    const k2 = K();
    if (dc <= 8) {
      if (notch) return { zone: 'notch', jt: 15, dc };
      return { zone: 'rim', jt: dc <= 2 ? 15 : 16, dc };
    }
    const dr = ex > 0 && ek > 0 ? Math.hypot(ex, ek) : dc;
    const nz = notch ? 0 : (k2.noise2(i * 0.17, k * 0.17, 3) - 0.5) * 3.2;
    const d = dr + nz;
    if (d <= 11) return { zone: 't1', jt: 11, dc };
    if (d <= 14) return { zone: 't2', jt: 6, dc };
    if (d <= 17.5) return { zone: 'base', jt: 1, dc };
    return { zone: 'sea', jt: -99, dc };
  }

  function stratumColor(j, i, k, seedOff) {
    const n = K().noise2(i * 0.09 + seedOff, k * 0.09, 17);
    const yy = j + Math.floor(n * 3.2 - 1.2);
    if (yy >= 10) return K().hash3(i >> 1, j >> 1, k >> 1) < 0.14 ? 'soil-dark' : 'soil';
    if (yy >= 8) return 'soil-dark';
    if (yy >= 6) return K().hash3(i >> 2, j, k >> 2) < 0.2 ? 'slate-dark' : 'slate';
    if (yy === 5) return 'sand';
    if (yy >= 3) return 'slate-dark';
    if (yy >= 1) return K().hash3(i >> 1, j >> 1, k >> 1) < 0.25 ? 'rock-dark' : 'slate';
    return 'rock-dark';
  }

  // Waterfall notches in plate-local metres: side + offset along it.
  function notchesFor(plate, n) {
    const half = n * Cn().CELL / 2;
    const a = Math.round(half * 0.55);
    const list = [{ side: '+z', o: -a }, { side: '+z', o: a }];
    list.push({ side: plate === 'own' ? '+x' : '-x', o: Math.round(half * 0.3) });   // into the channel between plates
    if (plate === 'enemy') list.push({ side: '+x', o: -Math.round(half * 0.35) });   // own -x / -z rims carry the plaques
    return list;
  }
  function inNotch(list, i, k, G) {
    // i,k voxel indices relative to plate centre; width 6 voxels (3 m)
    for (let q = 0; q < list.length; q++) {
      const nt = list[q];
      const ov = nt.o / VS;
      const ax = i + 0.5, ak = k + 0.5;
      if ((nt.side === '+z' && ak > G) || (nt.side === '-z' && ak < -G)) { if (Math.abs(ax - ov) < 3) return true; }
      if ((nt.side === '+x' && ax > G) || (nt.side === '-x' && ax < -G)) { if (Math.abs(ak - ov) < 3) return true; }
    }
    return false;
  }

  function buildBody(plate, n, acc, accGlow) {
    const k2 = K();
    const C = Cn();
    const G = n * C.CELL / 2 / VS;        // grid half extent in voxels
    const E = G + 18;                       // footprint half extent
    const vb = K().vb(VS);
    const r = k2.rng(plate === 'own' ? 101 : 202, 'plate');
    const notches = notchesFor(plate, n);
    const seedOff = plate === 'own' ? 0 : 37;
    const top = new Map();
    const key = (i, k) => (i + 512) * 1024 + (k + 512);
    for (let i = -E; i < E; i++) for (let k = -E; k < E; k++) {
      const info = columnInfo(i, k, G, inNotch(notches, i, k, G));
      top.set(key(i, k), info);
    }
    const jtAt = (i, k) => { const v = top.get(key(i, k)); return v ? v.jt : -99; };
    const isGrid = (i, k) => Math.abs(i + 0.5) < G && Math.abs(k + 0.5) < G;
    for (let i = -E; i < E; i++) for (let k = -E; k < E; k++) {
      const info = top.get(key(i, k));
      if (info.jt < -50) continue;
      const jt = info.jt;
      let low = Math.min(jtAt(i + 1, k), jtAt(i - 1, k), jtAt(i, k + 1), jtAt(i, k - 1));
      low = Math.max(-2, Math.min(jt - 1, low < -50 ? -2 : low + 1));
      if (info.zone === 'grid') {
        // basin floor: one dark layer (only seen through the grid gaps)
        const c = ((i >> 3) + (k >> 3)) & 1 ? 'sea-abyss' : 'sea-deep';
        vb.set(i, jt, k, c);
        continue;
      }
      for (let j = low; j <= jt; j++) {
        let col;
        if (info.zone === 'rim' || info.zone === 'notch') {
          if (j === jt) {
            // rim top: warm stone flags with mortar every cell
            const along = Math.abs(i + 0.5) > G ? k : i;
            const mort = ((along % 8) + 8) % 8 === 0;
            const outer = info.dc > 7;
            col = info.zone === 'notch' ? 'rock-dark' : mort ? 'rock' : outer ? 'rock-light' : (k2.hash3(i >> 1, j, k >> 1) < 0.18 ? 'sand' : 'sand-light');
          } else if (j >= 12) {
            const brick = ((j + (((Math.abs(i) + Math.abs(k)) >> 2) & 1)) & 1);
            col = k2.hash3(i >> 1, j >> 1, k >> 1) < 0.12 ? 'moss' : brick ? 'rock' : 'rock-light';
          } else col = stratumColor(j, i, k, seedOff);
        } else if (j === jt) {
          if (info.zone === 'base') col = k2.hash3(i >> 1, 3, k >> 1) < 0.3 ? 'sand-light' : 'sand';
          else col = k2.hash3(i >> 1, 1, k >> 1) < 0.25 ? 'grass-dark' : 'grass';
        } else if (j === jt - 1 && info.zone !== 'base') col = k2.hash3(i >> 1, 2, k >> 1) < 0.5 ? 'grass-dark' : 'soil';
        else col = stratumColor(j, i, k, seedOff);
        vb.set(i, j, k, col);
      }
      // decorations on terrace tops
      if ((info.zone === 't1' || info.zone === 't2') && !isGrid(i, k)) {
        const h = k2.hash3(i, 9, k);
        if (h < 0.035) vb.set(i, jt + 1, k, 'grass-dark');
        else if (h < 0.045) vb.set(i, jt + 1, k, k2.hash3(i, 5, k) < 0.5 ? 'yellow' : 'pink');
        else if (h < 0.05 && info.zone === 't1') { vb.set(i, jt + 1, k, 'foliage-dark'); vb.set(i, jt + 2, k, 'leaf'); }
      }
    }
    // hanging vines (outside each terrace face) and kelp at the waterline
    for (let i = -E; i < E; i++) for (let k = -E; k < E; k++) {
      const me = jtAt(i, k);
      if (me < -50) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let q = 0; q < 4; q++) {
        const ni = i + nb[q][0], nk = k + nb[q][1];
        const other = jtAt(ni, nk);
        if (other >= me - 2) continue;
        const h = k2.hash3(i * 3 + q, 31, k * 5);
        if (me >= 11 && h < 0.16) {
          const len = 2 + Math.floor(k2.hash3(i, 33, k) * (me - Math.max(other, 0) - 1));
          for (let j = me; j > me - len && j > other; j--) vb.set(ni, j, nk, k2.hash3(ni, j, nk) < 0.2 ? 'leaf' : 'vine');
        } else if (other < -50 && h < 0.2) {
          const len = 2 + Math.floor(k2.hash3(i, 35, k) * 4);
          for (let j = -1; j < len; j++) vb.set(ni, j, nk, j > 1 ? 'moss' : 'kelp');
        }
      }
    }
    // boulder piles (rock falls) at the base
    for (let b = 0; b < 9; b++) {
      const ang = r.next() * Math.PI * 2;
      const rad = (G + 17.5 + r.next() * 2) / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
      const bi = Math.round(Math.cos(ang) * Math.min(rad, G + 19)), bk = Math.round(Math.sin(ang) * Math.min(rad, G + 19));
      const sz = 1 + r.int(3);
      for (let x = -sz; x <= sz; x++) for (let z = -sz; z <= sz; z++) for (let y = -1; y <= sz; y++) {
        if (x * x + z * z + (y + 0.5) * (y + 0.5) > sz * sz + 1) continue;
        vb.set(bi + x, y, bk + z, k2.hash3(bi + x, y, bk + z) < 0.4 ? 'rock-dark' : 'rock');
      }
    }
    // rim label plaques with raised glyphs (letters along -X, numbers along -Z)
    const plaque = (i0, k0, text) => {
      const w = k2.glyphWidth(text);
      for (let x = -1; x <= w; x++) for (let z = -1; z <= 5; z++) vb.set(i0 + x, 16, k0 + z, 'slate-dark');
      k2.glyphPixels(text, (px, py) => vb.set(i0 + px, 17, k0 + py, 'sand-light'));
    };
    const half = (n - 1) / 2;
    for (let rr = 0; rr < n; rr++) {
      const letter = GLT.board.label(rr, 0).replace(/[0-9]+$/, '');
      const zc = (rr - half) * C.CELL / VS;
      plaque(-G - 5, Math.round(zc - 2.5), letter);
    }
    for (let cc = 0; cc < n; cc++) {
      const num = GLT.board.label(0, cc).replace(/^[A-Z]+/, '');
      const xc = (cc - half) * C.CELL / VS;
      const w = k2.glyphWidth(num);
      plaque(Math.round(xc - w / 2), -G - 7, num);
    }
    // corner lantern posts
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => {
      const ci = s[0] > 0 ? G + 5 : -G - 6, ck = s[1] > 0 ? G + 5 : -G - 6;
      for (let y = 17; y <= 21; y++) vb.set(ci, y, ck, 'wood-dark');
      vb.box(ci - 1, 17, ck - 1, ci + 1, 17, ck + 1, 'rock-dark');
      vb.box(ci - 1, 22, ck - 1, ci + 1, 22, ck + 1, 'iron');
      vb.box(ci - 1, 23, ck - 1, ci + 1, 23, ck + 1, 'lantern', 'emissive');
      vb.set(ci, 24, ck, 'iron');
    });
    const cx = L().plateCenter(plate).x;
    K().addVox(acc, vb, K().mtx(cx, 0, 0), { ao: 0.55 });
    void accGlow;
    // shoreline foam hugging the base, the boulders and the kelp (one ring set per plate, merged in build())
    const land = (i, k) => vb.get(i, 0, k) != null || vb.get(i, -1, k) != null || vb.get(i, 1, k) != null;
    return K().foamGeometry(land, -E - 6, E + 6, -E - 6, E + 6, VS, cx, 0, { y: 0.06, phase: plate === 'own' ? 0 : 17 });
  }

  function buildBorder(n) {
    const a = K().acc();
    const C = Cn();
    const G = n * C.CELL / 2 / VS;
    PLATES.forEach((plate) => {
      const vb = K().vb(VS);
      const col = K().hex(S.colors[plate]);
      const dark = K().shade(col, 0.62);
      const notches = notchesFor(plate, n);
      for (let i = -G - 2; i < G + 2; i++) for (let k = -G - 2; k < G + 2; k++) {
        const ex = Math.abs(i + 0.5) - G, ek = Math.abs(k + 0.5) - G;
        const dc = Math.max(ex, ek);
        if (dc <= 0 || dc > 2) continue;
        if (inNotch(notches, i, k, G)) continue;
        const stripe = (((Math.abs(i) + Math.abs(k)) >> 2) & 1) === 0;
        vb.set(i, 16, k, dc > 1 ? dark : (stripe ? col : K().mix(col, 0xffffff, 0.18)));
      }
      K().addVox(a, vb, K().mtx(L().plateCenter(plate).x, 0, 0), { ao: 0.3 });
    });
    return K().flush(a, { name: 'plate-border', cast: false });
  }

  // ------------------------------------------------------------------ water columns
  function waterMaterial() {
    if (S.waterMat) return S.waterMat;
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.userData.uT = { value: 0 };
    m.userData.uNight = { value: 0 };
    m.userData.uLineW = { value: 0.15 };               // half-width of the grid line inside each cell edge (m)
    m.userData.uLineCol = { value: new THREE.Color(0x1a3d8a) };   // lit-exact albedo of the line colour (update())
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = m.userData.uT;
      sh.uniforms.uNight = m.userData.uNight;
      sh.uniforms.uLineW = m.userData.uLineW;
      sh.uniforms.uLineCol = m.userData.uLineCol;
      sh.vertexShader = 'varying vec3 vGltW;\nvarying float vGltTop;\nvarying vec2 vGltL;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n#ifdef USE_INSTANCING\n vGltW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n vGltW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif\n vGltTop = normal.y;\n vGltL = position.xz;');
      sh.fragmentShader = 'uniform float uT;\nuniform float uNight;\nuniform float uLineW;\nuniform vec3 uLineCol;\nvarying vec3 vGltW;\nvarying float vGltTop;\nvarying vec2 vGltL;\n' +
        'float gH(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
        sh.fragmentShader.replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'if (vGltTop > 0.5) {',
          // grid line: a band along each cell edge, as wide as ~1 low-res texel at any zoom (uLineW follows the camera),
          // in one exact palette colour, so the grid never breaks up or dithers
          '  vec2 e = ' + ((Cn().CELL - CELL_GAP) / 2).toFixed(4) + ' - abs(vGltL);',
          '  if (min(e.x, e.y) < uLineW) diffuseColor.rgb = uLineCol;',
          '  else {',
          '    vec2 q = floor(vGltW.xz * 2.0);',
          '    float w = sin(q.x * 0.55 + q.y * 0.32 - uT * 2.1) + 0.6 * sin(q.y * 0.8 - q.x * 0.21 + uT * 1.3);',
          '    float g = gH(q + floor(uT * 1.5) * vec2(7.0, 3.0));',
          // rare single glints only: the rest of a cell stays one flat palette colour (no ripple dither noise)
          '    if (g > 0.996 && w > 0.4) diffuseColor.rgb = vec3(1.0);',
          '  }',
          '} else { diffuseColor.rgb *= 0.78; }'
        ].join('\n'));
    };
    m.customProgramCacheKey = () => 'glt-plate-water';
    K().outline(m, 'water');
    S.waterMat = m;
    return m;
  }

  function buildWater(n) {
    const C = Cn();
    const w = C.CELL - CELL_GAP;
    const geo = new THREE.BoxGeometry(w, 1, w);
    geo.translate(0, 0.5, 0);
    const m = K().inst(geo, waterMaterial(), 2 * n * n, { colors: true, receive: true, name: 'plate-water' });
    m.count = 2 * n * n;
    return m;
  }

  // water colours by height band
  function waterPalette() {
    const k2 = K();
    const sea = GLT.ocean && GLT.ocean.sea ? GLT.ocean.sea() : 'calmo';
    const storm = sea === 'tempestade' || k2.stormFactor() > 0.5;
    const deep = sea === 'novomundo';
    const tod = GLT.lighting && GLT.lighting.tod ? GLT.lighting.tod() : 'day';
    const key = sea + '|' + tod + '|' + storm;
    if (palCache.key === key) return palCache.pal;
    palCache.key = key;
    palCache.pal = makePalette(k2, storm, deep, tod);
    return palCache.pal;
  }
  const palCache = { key: null, pal: null };
  // Every cell state is ONE palette colour (src/render/palette.js), so after lighting.albedoFor() a sunlit cell lands
  // exactly on it and snaps flat: calm water, no dither noise. ONE water tone: the swell only lifts cells (the post
  // pass draws a crest line on each raised lip), it never recolours them, so a tinted cell always means a shot: two
  // steps darker (miss), red (hit), dark red (sunk) or gold (revealed).
  function makePalette(k2, storm, deep, tod) {
    const P = storm ? { base: '#205f86', miss: '#103e68', line: '#0a3157' }
      : tod === 'night' || tod === 'dusk' ? { base: '#34508c', miss: '#22336a', line: '#142048' }
        : deep ? { base: '#2d62c6', miss: '#1a3d8a', line: '#142048' }
          : { base: '#3f74c4', miss: '#1a3d8a', line: '#142048' };
    return {
      base: k2.hex(P.base), miss: k2.hex(P.miss), line: k2.hex(P.line),
      foam: k2.hex(tod === 'night' ? '#428ea4' : '#93bdea'),
      hit: k2.hex('#bc302e'), sunk: k2.hex('#6a1424'), seen: k2.hex('#c48e26'), faded: k2.hex('#463f5c')
    };
  }
  // hex -> lit-exact albedo [r,g,b], cached per frame (the lighting blends between times of day)
  const flat = { stamp: -1, map: new Map() };
  function flatAlbedo(hexv, stamp) {
    if (flat.stamp !== stamp) { flat.stamp = stamp; flat.map.clear(); }
    let a = flat.map.get(hexv);
    if (!a) {
      a = GLT.lighting && GLT.lighting.albedoFor ? GLT.lighting.albedoFor(hexv) : [(hexv >> 16 & 255) / 255, (hexv >> 8 & 255) / 255, (hexv & 255) / 255];
      flat.map.set(hexv, a);
    }
    return a;
  }
  let frameN = 0;

  // ------------------------------------------------------------------ waterfalls + splashes + pebbles
  function buildFalls(n) {
    const C = Cn();
    const k2 = K();
    const b = k2.batch();
    S.splashPts = [];
    S.pebblePts = [];
    const half = n * C.CELL / 2;
    const W = 3;
    // path in (u = outward distance from the grid edge, y)
    const path = [[0, 8.03], [4.02, 8.03], [4.1, 6.03], [5.5, 6.03], [5.58, 3.53], [7.0, 3.53], [7.08, 1.03], [8.75, 1.03], [8.85, 0.02]];
    PLATES.forEach((plate) => {
      const cx = L().plateCenter(plate).x;
      notchesFor(plate, n).forEach((nt, ni) => {
        const out = nt.side === '+z' ? [0, 1] : nt.side === '-z' ? [0, -1] : nt.side === '+x' ? [1, 0] : [-1, 0];
        const tan = [out[1], out[0]];
        const bx = cx + (out[0] ? out[0] * half : nt.o), bz = out[1] ? out[1] * half : nt.o;
        const P = (u, y, s) => [bx + out[0] * u + tan[0] * s, y, bz + out[1] * u + tan[1] * s];
        let v = 0;
        for (let q = 0; q < path.length - 1; q++) {
          const a = path[q], c = path[q + 1];
          const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
          const v1 = v + len / 2.2;
          const shade = c[1] < a[1] - 0.5 ? '#e8f8ff' : '#bfe6f4';
          b.quad(P(a[0], a[1], -W / 2), P(a[0], a[1], W / 2), P(c[0], c[1], W / 2), P(c[0], c[1], -W / 2), shade,
            [0, v, 1.5, v, 1.5, v1, 0, v1]);
          // side lips so the sheet reads as a volume from grazing angles
          if (c[1] < a[1] - 0.5) {
            b.quad(P(a[0] - 0.25, a[1], -W / 2), P(a[0], a[1], -W / 2), P(c[0], c[1], -W / 2), P(c[0] - 0.25, c[1], -W / 2), '#9fd8ec', [0, v, 0.1, v, 0.1, v1, 0, v1]);
            b.quad(P(a[0], a[1], W / 2), P(a[0] - 0.25, a[1], W / 2), P(c[0] - 0.25, c[1], W / 2), P(c[0], c[1], W / 2), '#9fd8ec', [0, v, 0.1, v, 0.1, v1, 0, v1]);
            const land = P(c[0] + 0.5, c[1], 0);
            for (let s = 0; s < 7; s++) S.splashPts.push({ x: land[0] + tan[0] * (s - 3) * 0.45, y: c[1], z: land[2] + tan[1] * (s - 3) * 0.45, ph: (ni * 7 + s * 0.37 + q * 0.21) % 1, big: q === path.length - 2 });
          }
          v = v1;
        }
      });
      // pebbles falling from the cliff faces
      const r = k2.rng(plate === 'own' ? 7 : 8, 'pebbles');
      for (let q = 0; q < 10; q++) {
        const side = r.int(4);
        const s = (r.next() - 0.5) * 2 * (half + 2);
        const out = side === 0 ? [0, 1] : side === 1 ? [0, -1] : side === 2 ? [1, 0] : [-1, 0];
        const u = 4.3 + r.next() * 0.4;
        const x = cx + (out[0] ? out[0] * (half + u) : s), z = out[1] ? out[1] * (half + u) : s;
        S.pebblePts.push({ x, z, y0: 6 + r.next() * 2.5, per: 2.5 + r.next() * 4, ph: r.next() * 5, ox: out[0], oz: out[1], s: 0.25 + r.next() * 0.25 });
      }
    });
    const g = b.geometry();
    const mesh = new THREE.Mesh(g, k2.flowMaterial());
    mesh.name = 'plate-falls';
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildSplash() {
    const b = K().batch();
    b.box(-0.3, 0, -0.3, 0.3, 0.6, 0.3, '#e0f6f0', { top: '#fffdf7', bottom: '#a6e2df' });
    const m = K().inst(b.geometry(), K().mat('water'), S.splashPts.length + 1, { name: 'plate-splash' });
    m.count = S.splashPts.length;
    return m;
  }
  function buildPebbles() {
    const b = K().batch();
    b.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 'rock', { top: 'rock-light' });
    const m = K().inst(b.geometry(), K().mat('solid'), S.pebblePts.length + 1, { name: 'plate-pebbles', cast: false });
    m.count = S.pebblePts.length;
    return m;
  }

  // ------------------------------------------------------------------ markers
  function markerGeometry(kind) {
    const vb = K().vb(0.25);
    if (kind === 'miss') {
      for (let x = -5; x <= 4; x++) for (let z = -5; z <= 4; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > 3.4 && d < 4.9) vb.set(x, 0, z, (x + z) & 1 ? 'foam' : 'sea-foam');
      }
      vb.box(-1, 0, -1, 0, 1, 0, 'white');
      vb.box(-1, 2, -1, 0, 2, 0, 'sea-foam');
      vb.set(-1, 3, 0, 'white'); vb.set(0, 3, -1, 'white');
    } else if (kind === 'faded') {
      // a broken grey ring: the shot is known but its marker has drifted away in the fog
      for (let x = -5; x <= 4; x++) for (let z = -5; z <= 4; z++) {
        const d = Math.hypot(x + 0.5, z + 0.5);
        if (d > 3.4 && d < 4.9 && ((x + 10) >> 1 & 1) === ((z + 10) >> 1 & 1)) vb.set(x, 0, z, 'smoke');
      }
    } else if (kind === 'hit') {
      vb.box(-2, 0, -2, 1, 0, 1, 'iron');
      for (let y = 1; y <= 5; y++) vb.box(-1, y, -1, 0, y, 0, y % 2 ? 'red' : 'white');
      vb.box(-2, 6, -2, 1, 6, 1, 'red-dark');
      vb.box(-1, 7, -1, 0, 7, 0, 'fire', 'emissive');
      vb.set(-1, 8, 0, 'fire-hot', 'emissive');
    } else if (kind === 'sunk') {
      vb.box(-2, 0, -2, 1, 0, 1, 'wood-dark');
      for (let y = 1; y <= 9; y++) vb.set(-1, y, -1, 'wood');
      vb.box(0, 5, -1, 4, 9, -1, 'black');
      vb.set(2, 7, -1, 'white'); vb.set(1, 8, -1, 'white'); vb.set(3, 8, -1, 'white'); vb.set(2, 6, -1, 'white');
      vb.box(-3, 0, 1, -2, 0, 3, 'wood');
      vb.box(1, 0, 1, 3, 0, 1, 'wood-dark');
    } else {
      // revealed (Observação): a gold gem buoy
      vb.box(-2, 0, -2, 1, 0, 1, 'gold-dark');
      vb.box(-1, 1, -1, 0, 4, 0, 'gold');
      vb.box(-2, 2, -1, 1, 3, 0, 'gold'); vb.box(-1, 2, -2, 0, 3, 1, 'gold');
      vb.set(-1, 5, -1, 'yellow', 'emissive');
    }
    const g = K().build(vb, { castShadow: false, receiveShadow: false, ao: 0.3 });
    const geos = [];
    g.children.forEach((m) => geos.push({ geo: m.geometry, cls: m.name.replace('voxel-', '') }));
    return geos;
  }

  function buildMarkers(n) {
    const out = {};
    MARK_KINDS.forEach((kind) => {
      const parts = markerGeometry(kind);
      const group = new THREE.Group();
      group.name = 'marks-' + kind;
      const list = [];
      parts.forEach((p) => {
        const m = K().inst(p.geo, GLT.voxel.material(p.cls), 2 * n * n, { cast: p.cls === 'solid', name: 'mark-' + kind + '-' + p.cls });
        group.add(m);
        list.push(m);
      });
      out[kind] = { group, meshes: list };
    });
    return out;
  }

  // ------------------------------------------------------------------ overlays (ghost, annotations, cursors, outlines)
  function tileGeometry(inset) {
    const C = Cn();
    const b = K().batch();
    const h = C.CELL / 2 - inset;
    b.box(-h, 0, -h, h, 0.08, h, '#ffffff', { faces: 4 });
    return b.geometry();
  }

  function frameGeometry() {
    const C = Cn();
    const b = K().batch();
    const h = C.CELL / 2 - 0.05, t = 0.3, y0 = 0, y1 = 0.35;
    b.box(-h, y0, -h, h, y1, -h + t, '#ffffff'); b.box(-h, y0, h - t, h, y1, h, '#ffffff');
    b.box(-h, y0, -h + t, -h + t, y1, h - t, '#ffffff'); b.box(h - t, y0, -h + t, h, y1, h - t, '#ffffff');
    // corner studs
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => b.box(s[0] * h - 0.35, y0, s[1] * h - 0.35, s[0] * h + 0.35, y1 + 0.25, s[1] * h + 0.35, '#ffffff'));
    return b.geometry();
  }
  function arrowGeometry() {
    const b = K().batch();
    b.box(-0.25, 1.4, -0.25, 0.25, 2.6, 0.25, '#ffffff');
    b.box(-0.75, 1.0, -0.25, 0.75, 1.4, 0.25, '#ffffff');
    b.box(-0.45, 0.6, -0.25, 0.45, 1.0, 0.25, '#ffffff');
    b.box(-0.2, 0.25, -0.25, 0.2, 0.6, 0.25, '#ffffff');
    return b.geometry();
  }

  function makeCursor(name) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    K().outline(mat, 'glow');
    const g = new THREE.Group();
    g.name = name;
    const frame = new THREE.Mesh(frameGeometry(), mat);
    const arrow = new THREE.Mesh(arrowGeometry(), mat);
    arrow.visible = false;
    g.add(frame, arrow);
    g.visible = false;
    g.userData = { mat, frame, arrow };
    return g;
  }

  const CURSOR_COL = { hover: 0xfffdf7, selected: 0xffd86a, invalid: 0xee6a52, hint: 0xf4c443 };

  function rebuildOutline(plate) {
    const old = S.outline[plate];
    if (old) { K().disposeObj(old); S.outline[plate] = null; }
    const ships = S.outlines[plate];
    if (!ships.length) return;
    const C = Cn();
    const b = K().batch();
    ships.forEach((ship) => {
      const a = L().cellToWorld(plate, ship.r, ship.c);
      const e = ship.dir === 'v' ? L().cellToWorld(plate, ship.r + ship.len - 1, ship.c) : L().cellToWorld(plate, ship.r, ship.c + ship.len - 1);
      const x0 = Math.min(a.x, e.x) - C.CELL / 2 + 0.25, x1 = Math.max(a.x, e.x) + C.CELL / 2 - 0.25;
      const z0 = Math.min(a.z, e.z) - C.CELL / 2 + 0.25, z1 = Math.max(a.z, e.z) + C.CELL / 2 - 0.25;
      const y0 = C.PLATE_Y + 0.22, y1 = C.PLATE_Y + 0.5, t = 0.32;
      const col = '#ee6a52', dk = '#6e1424';
      b.box(x0, y0, z0, x1, y1, z0 + t, col, { bottom: dk });
      b.box(x0, y0, z1 - t, x1, y1, z1, col, { bottom: dk });
      b.box(x0, y0, z0 + t, x0 + t, y1, z1 - t, col, { bottom: dk });
      b.box(x1 - t, y0, z0 + t, x1, y1, z1 - t, col, { bottom: dk });
      // rope knots every cell
      for (let q = 0; q <= ship.len; q++) {
        const f = q / ship.len;
        const kx = ship.dir === 'v' ? x0 : x0 + (x1 - x0) * f, kz = ship.dir === 'v' ? z0 + (z1 - z0) * f : z0;
        b.box(kx - 0.3, y0, kz - 0.3, kx + 0.3, y1 + 0.2, kz + 0.3, '#f4c443', { bottom: '#8a5c1a' });
      }
    });
    const mesh = b.mesh(K().mat('glow'), { name: 'outline-' + plate, receive: false });
    S.outline[plate] = mesh;
    S.root.add(mesh);
  }

  // Room counts: small voxel numbers floating past the rim at the end of the line
  function rebuildRoomGlyphs() {
    if (S.roomGlyphs) { K().disposeObj(S.roomGlyphs); S.roomGlyphs = null; }
    const a = K().acc();
    let any = false;
    PLATES.forEach((plate) => {
      S.annotations[plate].forEach((an) => {
        if (an.tech !== 'room') return;
        any = true;
        const vb = K().vb(0.25);
        const txt = String(an.count);
        const w = K().glyphWidth(txt);
        for (let x = -1; x <= w; x++) for (let y = -1; y <= 5; y++) vb.set(x, y, 0, 'purple-dark');
        K().glyphPixels(txt, (px, py) => vb.set(px, 4 - py, -1, 'lavender', 'emissive'));
        const p = an.axis === 'row' ? L().rowLabelPos(plate, an.index) : L().colLabelPos(plate, an.index);
        const off = an.axis === 'row' ? [-3.2, 0] : [0, -3.2];
        K().addVox(a, vb, K().mtx(p.x + off[0] - (w * 0.25) / 2, p.y + 0.8, p.z + off[1]), { ao: 0 });
      });
    });
    if (!any) return;
    S.roomGlyphs = K().flush(a, { name: 'room-glyphs' });
    S.root.add(S.roomGlyphs);
  }

  // ------------------------------------------------------------------ plate name plaques
  function drawPlaque(plate) {
    const pq = S.plaques[plate];
    if (!pq) return;
    const cv = pq.canvas, g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.fillStyle = '#48281a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8e562e'; g.fillRect(2, 2, W - 4, H - 4);
    g.fillStyle = '#b4763e';
    for (let x = 4; x < W - 4; x += 24) g.fillRect(x, 3, 1, H - 6);
    g.fillStyle = '#d6a05e'; g.fillRect(2, 2, W - 4, 2);
    const txt = GLT.T(plate === 'own' ? 'plate.own' : 'plate.enemy');
    g.font = '22px "Pirata One", "Pixelify Sans", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#2a1812';
    g.fillText(txt, W / 2 + 1, H / 2 + 2);
    g.fillStyle = plate === 'own' ? '#ffd86a' : '#fff2d8';
    g.fillText(txt, W / 2, H / 2 + 1);
    pq.tex.needsUpdate = true;
  }

  function buildPlaque(plate, n) {
    const C = Cn();
    const cv = document.createElement('canvas');
    cv.width = 192; cv.height = 28;
    const tex = K().canvasTexture(cv);
    const W = 17, D = 2.5;
    const geo = new THREE.PlaneGeometry(W, D);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshLambertMaterial({ map: tex });
    const mesh = new THREE.Mesh(geo, m);
    const half = n * C.CELL / 2;
    mesh.position.set(L().plateCenter(plate).x, C.PLATE_Y + C.RIM_TOP + 0.03, half + C.RIM / 2 + 0.1);
    mesh.receiveShadow = true;
    mesh.name = 'plaque-' + plate;
    S.plaques[plate] = { canvas: cv, tex, mesh };
    drawPlaque(plate);
    return mesh;
  }

  // ------------------------------------------------------------------ build
  function clearBuilt() {
    ['body', 'border', 'water', 'falls', 'splash', 'pebbles', 'ghost', 'overlay', 'cursorMain', 'cursorHover', 'roomGlyphs', 'glow'].forEach((k) => {
      if (S[k]) { K().disposeObj(S[k]); S[k] = null; }
    });
    MARK_KINDS.forEach((k) => { if (S.markers[k]) K().disposeObj(S.markers[k].group); });
    S.markers = {};
    PLATES.forEach((p) => {
      if (S.outline[p]) { K().disposeObj(S.outline[p]); S.outline[p] = null; }
      if (S.plaques[p]) { K().disposeObj(S.plaques[p].mesh); S.plaques[p].tex.dispose(); S.plaques[p] = null; }
    });
  }

  // Invisible shadow caster: rim frame + terrace slabs per plate (colorWrite/depthWrite off, so it only shows up in the
  // shadow map). The grid interior is left open so the rim's shadow falls on the water exactly like the real rim's.
  function shadowProxy(n) {
    const C = Cn();
    const b = K().batch();
    PLATES.forEach((p) => {
      const g = L().gridBounds(p, n), r = L().rimBounds(p, n);
      const top = C.PLATE_Y + C.RIM_TOP;
      b.box(r.minX, 0, r.minZ, r.maxX, top, g.minZ, '#000000');
      b.box(r.minX, 0, g.maxZ, r.maxX, top, r.maxZ, '#000000');
      b.box(r.minX, 0, g.minZ, g.minX, top, g.maxZ, '#000000');
      b.box(g.maxX, 0, g.minZ, r.maxX, top, g.maxZ, '#000000');
      b.box(g.minX, 0, g.minZ, g.maxX, 7, g.maxZ, '#000000');
      [[1.5, 6], [3, 3.5], [4.75, 1]].forEach((t) => b.box(r.minX - t[0], 0, r.minZ - t[0], r.maxX + t[0], t[1], r.maxZ + t[0], '#000000'));
    });
    const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const mesh = new THREE.Mesh(b.geometry(), m);
    mesh.name = 'plate-shadow-proxy';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }

  // Warm light pools under the corner lanterns (night / storm charm): one additive mesh, opacity from nightFactor.
  let glowTex = null;
  function lampGlow(n) {
    {                                   // fresh texture per build: GLT.voxel.dispose frees it with the material
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const g = cv.getContext('2d');
      const im = g.createImageData(32, 32);
      const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const d = Math.hypot(x - 15.5, y - 15.5) / 16;
        const a = Math.max(0, 1 - d);
        const q = Math.floor(Math.pow(a, 1.3) * 4 * 16 + B[(y & 3) * 4 + (x & 3)]) >> 4;       // 4 dithered steps
        const o = (y * 32 + x) * 4;
        im.data[o] = 255; im.data[o + 1] = 150; im.data[o + 2] = 50; im.data[o + 3] = Math.min(255, q * 64);
      }
      g.putImageData(im, 0, 0);
      glowTex = K().canvasTexture(cv);
    }
    const G = n * Cn().CELL / 2 / VS;
    const p = [], uv = [], idx = [];
    PLATES.forEach((plate) => {
      const cx = L().plateCenter(plate).x;
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((s) => {
        const x = cx + ((s[0] > 0 ? G + 5 : -G - 6) + 0.5) * VS, z = ((s[1] > 0 ? G + 5 : -G - 6) + 0.5) * VS, R = 6.5, y = 8.56;
        const b = p.length / 3;
        p.push(x - R, y, z + R, x + R, y, z + R, x + R, y, z - R, x - R, y, z - R);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const m = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    m.userData.gltOutline = 'none';
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = 'plate-lamp-glow';
    mesh.renderOrder = 3;
    mesh.visible = false;
    return mesh;
  }

  function build(n) {
    if (!S.ok) return;
    n = n || L().size();
    clearBuilt();
    S.n = n;
    PLATES.forEach((p) => {
      S.marks[p] = new Uint8Array(n * n);
      S.markBorn[p] = new Float32Array(n * n).fill(-1e9);
      S.foam[p] = new Uint8Array(n * n);
      S.heights[p] = new Float32Array(n * n);
      S.outlines[p] = [];
      S.annotations[p] = [];
      S.ships[p] = [];
    });
    const acc = K().acc();
    const foams = PLATES.map((p) => buildBody(p, n, acc));
    S.body = K().flush(acc, { name: 'plate-body', cast: false });
    S.body.add(shadowProxy(n));          // a few boxes cast the plates' shadows instead of ~100k voxel triangles
    const foam = K().foamMesh(foams, { name: 'plate-shore-foam' });
    if (foam) S.body.add(foam);
    S.root.add(S.body);
    S.border = buildBorder(n);
    S.root.add(S.border);
    S.water = buildWater(n);
    S.root.add(S.water);
    S.falls = buildFalls(n);
    S.root.add(S.falls);
    S.splash = buildSplash();
    S.root.add(S.splash);
    S.pebbles = buildPebbles();
    S.root.add(S.pebbles);
    S.markers = buildMarkers(n);
    MARK_KINDS.forEach((k) => S.root.add(S.markers[k].group));
    S.ghost = K().inst(tileGeometry(0.18), K().mat('overlay'), 12, { colors: true, name: 'plate-ghost' });
    S.overlay = K().inst(tileGeometry(0.1), K().mat('overlay'), 2 * n * n, { colors: true, name: 'plate-annot' });
    S.root.add(S.ghost, S.overlay);
    S.cursorMain = makeCursor('cursor-main');
    S.cursorHover = makeCursor('cursor-hover');
    S.root.add(S.cursorMain, S.cursorHover);
    PLATES.forEach((p) => S.root.add(buildPlaque(p, n)));
    S.glow = lampGlow(n);
    S.root.add(S.glow);
    S.cursor.plate = null; S.hover.plate = null;
    S.ghostCells = null;
    update(0, K().t());
  }

  // ------------------------------------------------------------------ per-frame update
  function update(dt, t) {
    if (!S.ok || !S.water) return;
    const n = S.n, C = Cn(), k2 = K();
    const amp = (GLT.ocean && GLT.ocean.sea && GLT.ocean.sea() === 'tempestade') ? 1.7 : 1 + k2.stormFactor() * 0.6;
    const pal = waterPalette();
    const arr = S.water.instanceMatrix.array, col = S.water.instanceColor.array;
    const half = (n - 1) / 2;
    const stamp = ++frameN;
    let i = 0;
    for (let pi = 0; pi < 2; pi++) {
      const plate = PLATES[pi];
      const cx = pi ? C.PLATE_CX : -C.PLATE_CX;
      const H = S.heights[plate], M = S.marks[plate], F = S.foam[plate];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++, i++) {
        const h = swell(pi, r, c, t, amp);
        const idx = r * n + c;
        H[idx] = h;
        k2.setInst(arr, i, cx + (c - half) * C.CELL, CELL_BASE, (r - half) * C.CELL, 0, 1, C.PLATE_Y + h - CELL_BASE, 1);
        const mk = M[idx];
        const hx = mk === 1 ? pal.miss : mk === 2 ? pal.hit : mk === 3 ? pal.sunk : mk === 4 ? pal.seen : mk === 5 ? pal.faded
          : F[idx] ? pal.foam : pal.base;
        const a = flatAlbedo(hx, stamp);
        col[i * 3] = a[0]; col[i * 3 + 1] = a[1]; col[i * 3 + 2] = a[2];
      }
    }
    S.water.instanceMatrix.needsUpdate = true;
    S.water.instanceColor.needsUpdate = true;
    if (S.waterMat) {
      const nf = k2.nightFactor();
      S.waterMat.userData.uT.value = t; S.waterMat.userData.uNight.value = nf;
      // grid line about 1.3 low-res texels wide on screen at any zoom / elevation, capped so far views keep the cells
      const cam = GLT.camera;
      const wpp = cam && cam.worldPerPixel ? cam.worldPerPixel() : 0.2;
      const el = cam && cam.get ? cam.get().elevation : 38;
      S.waterMat.userData.uLineW.value = Math.min(0.6, Math.max(0.08, 0.5 * wpp * 1.3 / Math.max(0.35, Math.sin(el * Math.PI / 180))));
      const la = flatAlbedo(pal.line, stamp);
      S.waterMat.userData.uLineCol.value.setRGB(la[0], la[1], la[2]);
      // no emissive lift: the night palette (flatAlbedo) already keeps the moonlit grid readable
    }
    const tex = k2.streakTexture();
    tex.offset.y = -((t * 0.9) % 1);
    k2.foamT.value = t;
    if (S.glow) {
      const nf = k2.nightFactor(), sf = k2.stormFactor();
      const op = Math.max(nf * 0.85, sf * 0.4) * (0.92 + 0.08 * Math.sin(t * 9.1) * Math.sin(t * 5.3));
      S.glow.material.opacity = op;
      S.glow.visible = op > 0.02;
    }
    updateSplash(t);
    updatePebbles(t);
    updateMarkers(t);
    updateOverlays(t);
    updateCursors(t);
  }

  function updateSplash(t) {
    const m = S.splash;
    if (!m) return;
    const arr = m.instanceMatrix.array;
    for (let q = 0; q < S.splashPts.length; q++) {
      const p = S.splashPts[q];
      const ph = (t * 1.6 + p.ph) % 1;
      const s = (p.big ? 1.4 : 1) * (0.45 + Math.sin(ph * Math.PI) * 0.9);
      K().setInst(arr, q, p.x, p.y - 0.15 + ph * 0.25, p.z, ph * 3, s, s * (0.6 + ph), s);
    }
    m.instanceMatrix.needsUpdate = true;
  }
  function updatePebbles(t) {
    const m = S.pebbles;
    if (!m) return;
    const arr = m.instanceMatrix.array;
    for (let q = 0; q < S.pebblePts.length; q++) {
      const p = S.pebblePts[q];
      const ph = ((t + p.ph) % p.per);
      const fall = Math.min(ph, 1.4);
      const y = p.y0 - 4.9 * fall * fall;
      const vis = y > -0.3 && ph < 1.4;
      const s = vis ? p.s : 0.0001;
      K().setInst(arr, q, p.x + p.ox * fall * 0.8, y, p.z + p.oz * fall * 0.8, ph * 4, s, s, s);
    }
    m.instanceMatrix.needsUpdate = true;
  }

  const KIND_OF = { 1: 'miss', 2: 'hit', 3: 'sunk', 4: 'seen', 5: 'faded' };
  const counts = { miss: 0, hit: 0, sunk: 0, seen: 0, faded: 0 };
  function updateMarkers(t) {
    if (!S.markers.miss) return;
    const n = S.n, C = Cn(), k2 = K();
    counts.miss = counts.hit = counts.sunk = counts.seen = counts.faded = 0;
    const half = (n - 1) / 2;
    for (let pi = 0; pi < 2; pi++) {
      const plate = PLATES[pi];
      const cx = pi ? C.PLATE_CX : -C.PLATE_CX;
      const M = S.marks[plate], B = S.markBorn[plate], H = S.heights[plate];
      for (let idx = 0; idx < n * n; idx++) {
        const mk = M[idx];
        if (!mk) continue;
        const kind = KIND_OF[mk];
        const slot = counts[kind]++;
        const r = (idx / n) | 0, c = idx % n;
        const age = t - B[idx];
        const s = age >= 0.35 || age < 0 ? 1 : Math.max(0.001, k2.easeOutBack(age / 0.35));
        const yaw = kind === 'seen' ? t * 1.5 : kind === 'miss' ? t * 0.3 + idx : 0.4;
        const bob = kind === 'seen' ? 0.25 + Math.sin(t * 2 + idx) * 0.15 : 0;
        const list = S.markers[kind].meshes;
        for (let q = 0; q < list.length; q++) {
          k2.setInst(list[q].instanceMatrix.array, slot, cx + (c - half) * C.CELL, C.PLATE_Y + H[idx] + 0.01 + bob, (r - half) * C.CELL, yaw, s, s, s);
        }
      }
    }
    MARK_KINDS.forEach((kind) => {
      S.markers[kind].meshes.forEach((m) => { m.count = counts[kind]; m.instanceMatrix.needsUpdate = true; });
    });
  }

  function updateOverlays(t) {
    const C = Cn(), k2 = K(), n = S.n;
    // ghost
    const g = S.ghost;
    if (g) {
      const cells = S.ghostCells || [];
      const pulse = 0.85 + 0.15 * Math.sin(t * 6);
      const colr = S.ghostValid ? k2.shade(0x6ad0bc, pulse) : k2.shade(0xee6a52, pulse);
      let q = 0;
      for (let i = 0; i < cells.length && q < 12; i++) {
        const cl = cells[i];
        if (cl.r < 0 || cl.c < 0 || cl.r >= n || cl.c >= n) continue;
        const p = L().cellToWorld(cl.plate || 'own', cl.r, cl.c);
        const H = S.heights[cl.plate || 'own'];
        k2.setInst(g.instanceMatrix.array, q, p.x, C.PLATE_Y + H[cl.r * n + cl.c] + 0.04, p.z, 0, 1, 1, 1);
        k2.setCol(g.instanceColor.array, q, colr);
        q++;
      }
      g.count = q;
      g.instanceMatrix.needsUpdate = true;
      g.instanceColor.needsUpdate = true;
    }
    // annotations
    const o = S.overlay;
    if (o) {
      let q = 0;
      PLATES.forEach((plate) => {
        const H = S.heights[plate];
        S.annotations[plate].forEach((an) => {
          const cells = [];
          let colr;
          if (an.tech === 'haki') {
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) cells.push([an.r + dr, an.c + dc]);
            colr = an.found ? 0xee6a52 : 0x98a2c4;
          } else if (an.tech === 'room') {
            for (let x = 0; x < n; x++) cells.push(an.axis === 'row' ? [an.index, x] : [x, an.index]);
            colr = an.count > 0 ? 0xb090e0 : 0x7a7390;
          } else return;
          const pulse = 0.82 + 0.18 * Math.sin(t * 3);
          cells.forEach((rc) => {
            if (rc[0] < 0 || rc[1] < 0 || rc[0] >= n || rc[1] >= n || q >= 2 * n * n) return;
            const p = L().cellToWorld(plate, rc[0], rc[1]);
            k2.setInst(o.instanceMatrix.array, q, p.x, C.PLATE_Y + H[rc[0] * n + rc[1]] + 0.03, p.z, 0, 1, 1, 1);
            k2.setCol(o.instanceColor.array, q, k2.shade(colr, pulse));
            q++;
          });
        });
      });
      o.count = q;
      o.instanceMatrix.needsUpdate = true;
      o.instanceColor.needsUpdate = true;
    }
  }

  function placeCursor(cur, plate, r, c, t, state) {
    const C = Cn(), n = S.n;
    if (!plate || r == null || c == null || r < 0 || c < 0 || r >= n || c >= n) { cur.visible = false; return; }
    const p = L().cellToWorld(plate, r, c);
    const h = S.heights[plate][r * n + c];
    cur.visible = true;
    cur.position.set(p.x, C.PLATE_Y + Math.max(0, h) + 0.08, p.z);
    const u = cur.userData;
    u.mat.color.setHex(CURSOR_COL[state] || CURSOR_COL.selected);
    const pulse = state === 'hover' ? 1 : 1 + 0.06 * Math.sin(t * 7);
    u.frame.scale.set(pulse, 1, pulse);
    u.arrow.visible = state === 'hint' || state === 'selected';
    u.arrow.position.y = (state === 'hint' ? 1.2 : 0.6) + Math.abs(Math.sin(t * 4)) * 0.8;
    u.arrow.rotation.y = t * 1.2;
  }

  function updateCursors(t) {
    if (!S.cursorMain) return;
    const cu = S.cursor;
    let state = cu.state;
    if (state === 'hint' && t > S.hintUntil && S.hintUntil > 0) { cu.plate = null; S.hintUntil = -1; }
    placeCursor(S.cursorMain, cu.plate, cu.r, cu.c, t, state);
    const hv = S.hover;
    const same = cu.plate && hv.plate === cu.plate && hv.r === cu.r && hv.c === cu.c;
    placeCursor(S.cursorHover, same ? null : hv.plate, hv.r, hv.c, t, 'hover');
  }

  // ------------------------------------------------------------------ public API
  function setColors(colors) {
    if (!colors) return;
    if (colors.own) S.colors.own = colors.own;
    if (colors.enemy) S.colors.enemy = colors.enemy;
    if (!S.ok || !S.n) return;
    if (S.border) K().disposeObj(S.border);
    S.border = buildBorder(S.n);
    S.root.add(S.border);
  }

  function setMark(plate, r, c, mark, o) {
    if (!S.marks[plate]) return;
    const n = S.n;
    if (r < 0 || c < 0 || r >= n || c >= n) return;
    const idx = r * n + c;
    const prev = S.marks[plate][idx];
    S.marks[plate][idx] = mark | 0;
    if (mark && (prev !== mark)) S.markBorn[plate][idx] = o && o.animate ? K().t() : -1e9;
  }

  function clearMarks() {
    PLATES.forEach((p) => {
      if (S.marks[p]) S.marks[p].fill(0);
      S.outlines[p] = [];
      S.annotations[p] = [];
      rebuildOutline(p);
    });
    rebuildRoomGlyphs();
  }

  function shipCells(ship) {
    const out = [];
    for (let q = 0; q < ship.len; q++) out.push(ship.dir === 'v' ? { r: ship.r + q, c: ship.c } : { r: ship.r, c: ship.c + q });
    return out;
  }

  function setFoam(plate, ships) {
    if (!S.foam[plate]) return;
    S.foam[plate].fill(0);
    S.ships[plate] = (ships || []).slice();
    const n = S.n;
    S.ships[plate].forEach((s) => shipCells(s).forEach((cl) => { if (cl.r >= 0 && cl.c >= 0 && cl.r < n && cl.c < n) S.foam[plate][cl.r * n + cl.c] = 1; }));
  }

  function revealOutline(plate, ship) {
    if (!S.ok || !ship || !S.outlines[plate]) return;
    if (S.outlines[plate].some((s) => s.r === ship.r && s.c === ship.c && s.dir === ship.dir)) return;
    S.outlines[plate].push(ship);
    rebuildOutline(plate);
  }

  function annotate(plate, a) {
    if (!S.ok || !a || !S.annotations[plate]) return;
    if (a.tech === 'observation') { if (a.r != null) setMark(plate, a.r, a.c, 4, { animate: true }); return; }
    S.annotations[plate].push(a);
    if (a.tech === 'room') rebuildRoomGlyphs();
  }

  function sync(view) {
    if (!S.ok || !view) return;
    if (view.size && view.size !== S.n) build(view.size);
    const n = S.n;
    const me = view.me == null ? 0 : view.me, opp = view.opp == null ? 1 - me : view.opp;
    const pairs = [['own', view.players[me]], ['enemy', view.players[opp]]];
    pairs.forEach((pp) => {
      const plate = pp[0], pv = pp[1];
      if (!pv) return;
      S.marks[plate].fill(0);
      S.markBorn[plate].fill(-1e9);
      if (pv.marks) for (let i = 0; i < n * n && i < pv.marks.length; i++) S.marks[plate][i] = pv.marks[i] | 0;
      S.outlines[plate] = plate === 'enemy' ? (pv.sunk || []).slice() : [];
      rebuildOutline(plate);
      S.annotations[plate] = (pv.annotations || []).filter((a) => a.tech !== 'observation');
      (pv.annotations || []).forEach((a) => { if (a.tech === 'observation' && S.marks[plate][a.r * n + a.c] === 0) S.marks[plate][a.r * n + a.c] = 4; });
      setFoam(plate, pv.fleet ? pv.fleet.ships : []);
    });
    rebuildRoomGlyphs();
  }

  function setCursor(plate, r, c, state) {
    S.cursor.plate = plate || null;
    S.cursor.r = r; S.cursor.c = c;
    S.cursor.state = state || 'selected';
    if (state === 'hint') S.hintUntil = K().t() + 4;
    else S.hintUntil = -1;
  }

  function setGhostCells(cells, valid) {
    S.ghostCells = cells ? cells.map((c) => ({ plate: c.plate || 'own', r: c.r, c: c.c })) : null;
    S.ghostValid = !!valid;
  }

  // ---- exact picking ----
  function pickRay(origin, dir) {
    const C = Cn();
    if (!dir || Math.abs(dir.y) < 1e-9) return { plate: null, r: null, c: null, point: null };
    const s = (C.PLATE_Y - origin.y) / dir.y;
    if (s < 0) return { plate: null, r: null, c: null, point: null };
    const point = { x: origin.x + dir.x * s, y: C.PLATE_Y, z: origin.z + dir.z * s };
    const plate = L().plateAt(point.x, point.z);
    if (!plate) return { plate: null, r: null, c: null, point };
    const cell = L().worldToCell(plate, point.x, point.z);
    return cell ? { plate, r: cell.r, c: cell.c, point } : { plate: null, r: null, c: null, point };
  }
  let rc = null, ndc = null;
  function pick(clientX, clientY) {
    const cam = GLT.camera && GLT.camera.three ? GLT.camera.three() : null;
    const cv = GLT.renderer && GLT.renderer.canvas ? GLT.renderer.canvas() : null;
    if (!cam || !cv) return { plate: null, r: null, c: null, point: null };
    const rect = cv.getBoundingClientRect();
    rc = rc || new THREE.Raycaster(); ndc = ndc || new THREE.Vector2();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    return pickRay(rc.ray.origin, rc.ray.direction);
  }
  // Client (CSS px) position of a cell centre at the waterline: the inverse of pick(), used by tests and UI.
  function cellToClient(plate, r, c) {
    const cam = GLT.camera.three(), cv = GLT.renderer.canvas();
    const p = L().cellToWorld(plate, r, c);
    const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
    const rect = cv.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
  }

  // ------------------------------------------------------------------ events
  const RESULT_MARK = { agua: 1, acerto: 2, afundou: 2, absorvido: 0 };
  function subscribe() {
    const E = GLT.events;
    const on = (type, fn) => S.offs.push(E.on(type, fn));
    on('layout:changed', (e) => build(e && e.size));
    on('match:created', (e) => {
      if (!e || !e.colors) return;
      const local = e.local == null ? 0 : e.local;
      setColors({ own: e.colors[local], enemy: e.colors[1 - local] });
    });
    on('game:setup', () => { clearMarks(); setCursor(null); setGhostCells(null); });
    on('view:sync', (e) => { if (e && e.view) sync(e.view); });
    on('shot:resolved', (e) => {
      if (!e || !e.plate) return;
      const m = RESULT_MARK[e.result];
      if (m) setMark(e.plate, e.r, e.c, m, { animate: true });
    });
    on('ship:sunk', (e) => {
      if (!e || !e.ship) return;
      shipCells(e.ship).forEach((cl) => setMark(e.plate, cl.r, cl.c, 3, { animate: true }));
      if (e.plate === 'enemy') revealOutline('enemy', e.ship);
    });
    on('technique:resolved', (e) => {
      if (!e || !e.result) return;
      const res = e.result;
      if (res.tech === 'haki') annotate(e.plate, { tech: 'haki', r: res.r, c: res.c, found: res.found, turnNo: 0 });
      else if (res.tech === 'room') annotate(e.plate, { tech: 'room', axis: res.axis, index: res.index, count: res.count, turnNo: 0 });
      else if (res.tech === 'observation' && res.cell) annotate(e.plate, { tech: 'observation', r: res.cell.r, c: res.cell.c, turnNo: 0 });
    });
    on('cell:selected', (e) => {
      if (!e || !e.plate) { if (S.cursor.state !== 'hint') setCursor(null); return; }
      setCursor(e.plate, e.r, e.c, e.legal === false ? 'invalid' : 'selected');
    });
    on('cell:hover', (e) => { S.hover.plate = e ? e.plate : null; S.hover.r = e ? e.r : null; S.hover.c = e ? e.c : null; });
    on('setup:ghost', (e) => {
      if (!e || !e.ship) { setGhostCells(null); return; }
      setGhostCells(shipCells(e.ship).map((cl) => ({ plate: 'own', r: cl.r, c: cl.c })), e.valid);
    });
    on('setup:changed', (e) => { if (e && e.fleet) setFoam('own', e.fleet.ships); });
    on('hint:used', (e) => { if (e && e.r != null) setCursor('enemy', e.r, e.c, 'hint'); });
    on('game:ended', (e) => {
      if (!e || !e.fleets) return;
      const local = GLT.app && GLT.app.local ? GLT.app.local() : 0;
      const opp = e.fleets[local == null ? 1 : 1 - local];
      if (opp && opp.ships) setFoam('enemy', opp.ships);
    });
    on('tod:changed', () => { /* water colours are recomputed every frame */ });
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root() || !GLT._world_kit || !GLT.voxel) return false;
    S.root = new THREE.Group();
    S.root.name = 'world-plates';
    GLT.scene.add(S.root, 'plates');
    S.ok = true;
    subscribe();
    S.offs.push(GLT.clock.onFrame(update, 130));
    build(L().size());
    if (GLT.i18n && GLT.i18n.fontsReady) GLT.i18n.fontsReady().then(() => { PLATES.forEach(drawPlaque); }, () => {});
    return true;
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    clearBuilt();
    if (S.root) K().disposeObj(S.root);
    S.root = null; S.ok = false;
  }

  GLT.plates = {
    init, build, setColors, setMark, clearMarks, sync, setCursor, setGhostCells, revealOutline, setFoam, annotate, dispose,
    // additions (world area)
    pick, pickRay, cellToClient,
    mark(plate, r, c) { return S.marks[plate] ? S.marks[plate][r * S.n + c] : 0; },
    heightAt(plate, r, c) { return S.heights[plate] ? S.heights[plate][r * S.n + c] : 0; },
    root() { return S.root; },
    size() { return S.n; }
  };

  // ------------------------------------------------------------------ demos
  GLT.demos = GLT.demos || {};
  function platesDemo(ctx) {
    GLT.layout.setSize(10);
    if (GLT.ocean) GLT.ocean.init();
    init();
    build(10);
    if (GLT.backdrop) GLT.backdrop.init();
    if (GLT.props) GLT.props.init();
    if (GLT.crowd) { GLT.crowd.init(); GLT.crowd.build(['strawHat', 'marine'], ['#e0b030', '#1a3f8c']); }
    setColors({ own: GLT.data.crews.strawHat.colors.primary, enemy: GLT.data.crews.marine.colors.primary });
    const fleet = ctx.sampleFleet('classica');
    setFoam('own', fleet.ships);
    if (GLT.fleet3d && GLT.fleet3d.init && GLT.fleet3d.init()) {
      GLT.fleet3d.setFleet('own', fleet, { crew: 'strawHat', colors: GLT.data.crews.strawHat.colors, visible: true });
    }
    // a game in progress on the enemy plate
    const shots = [[1, 1, 1], [2, 4, 1], [4, 2, 2], [4, 3, 2], [6, 7, 1], [7, 1, 1], [0, 8, 1], [8, 5, 4], [3, 8, 1], [5, 5, 1]];
    shots.forEach((s) => setMark('enemy', s[0], s[1], s[2]));
    const sunk = { id: 'goingMerry', r: 6, c: 2, dir: 'h', len: 2 };
    setMark('enemy', 6, 2, 3); setMark('enemy', 6, 3, 3);
    revealOutline('enemy', sunk);
    annotate('enemy', { tech: 'haki', r: 2, c: 7, found: true, turnNo: 3 });
    [[3, 3, 1], [5, 0, 2], [8, 8, 1]].forEach((s) => setMark('own', s[0], s[1], s[2]));
    setCursor('enemy', 1, 6, 'selected');
    S.hover = { plate: 'enemy', r: 3, c: 5 };
    if (GLT.ocean && ctx.params && ctx.params.sea) GLT.ocean.setSea(ctx.params.sea);
    if (GLT.backdrop) GLT.backdrop.setLift(true);
  }
  GLT.demos['world.plates'] = platesDemo;
  GLT.demos['plates'] = platesDemo;
})();
