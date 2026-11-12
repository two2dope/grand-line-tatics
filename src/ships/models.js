/* GLT.shipModels: voxel models of the 7 canon ships, merged per material. Area: ships. Contract: ARCHITECTURE.md §9, §11.2.
 *
 * Conventions (§9): bow toward local +X, waterline at local y = 0, centred on the origin, length along X, beam along Z.
 * Voxel edge 0.25 m (C.SHIP_VOXEL). Every model fits GLT.layout.shipEnvelope(len): length <= len*4 - 0.5, beam <= 3.4,
 * height <= 9 (checked by report()).
 *
 * Each ship is a recipe painted into voxel builders (hull, guns, sails, flags) by a small kit (hullForm, mast, sail,
 * flag, pennant, gun, lantern, crew spots). Assembly merges per material, so a ship costs 3 draw calls:
 *   main  : hull + figurehead + rigging + sails + mast-top flag + owner pennant, ONE geometry with a per-vertex
 *           `flutter` attribute (0 hull, >0 sail billow along X, <0 flag/pennant ripple along Z) animated in the
 *           vertex shader by one shared uniform (GLT.shipModels.tick(t)). Lambert, vertex colours, outlined.
 *   glow  : emissive voxels (windows, lanterns, embers), one shared Basic material dimmed by day / full at night.
 *   guns  : the cannons, a separate mesh so fleet3d can recoil the whole battery (scale.z dip).
 * Owner identity is ONLY the hull trim band (gunwale row) and the pennant (o.trim, o.pennant, o.pennant2); the canon
 * colours, sails, figurehead and Jolly Roger never change.
 * Damage: build(id, {damage: [segment indices]}) carves a charred hole, scorched deck, broken rail and torn sail into
 * the voxels of that cell segment (seeded per ship + segment, so it is identical on every client and every rebuild).
 * Sail bracing: o.brace (radians) yaws every sail about its mast, so fleet3d can turn the canvas toward the camera.
 * No THREE/DOM/GLT access at load time (call time only). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const VS = 0.25;      // ship voxel (m)
  const FS = 0.125;     // flag voxel (m)
  // Ship visuals use their own seeded RNG (ships/kit.js) when present; the game's GLT.rng belongs to the rules.
  const RNG = () => GLT.shipRng || GLT.rng;

  // ------------------------------------------------------------------ materials (shared, created lazily)
  const U = { time: { value: 0 }, glow: 1, lift: { value: 0 }, mark: { value: 0 } };
  let shipMat = null, glowMat = null, flatMat = null, solidMat = null;

  // setMark(a): every ship fragment writes alpha = a into the (opaque) scene target, so a host post pass can tell
  // ship pixels apart (pilot palette shader: no luma-edge ink inside ships). 0 = off (our own pipeline).
  const MARK_FRAG = '#include <dithering_fragment>\nif (uShipMark > 0.0) gl_FragColor.a = uShipMark;';
  function withMark(sh) {
    sh.uniforms.uShipMark = U.mark;
    sh.fragmentShader = 'uniform float uShipMark;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', MARK_FRAG);
  }

  function mark(m, cls) {
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(m, cls);
    m.userData.gltShared = true;
    return m;
  }

  function shipMaterial() {
    if (shipMat) return shipMat;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uFlutterT = U.time;
      sh.uniforms.uShipLift = U.lift;
      // cloth (sails, flags, pennants) gets a little sky light through the canvas so shaded sails stay cream, not grey;
      // uShipLift (setLift) lets a host pipeline with darker lighting keep every ship voxel legible
      sh.fragmentShader = 'varying float vCloth;\nuniform float uShipLift;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.3 * vCloth + uShipLift);');
      withMark(sh);
      sh.vertexShader = 'attribute float flutter;\nuniform float uFlutterT;\nvarying float vCloth;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'vCloth = flutter != 0.0 ? 1.0 : 0.0;',
        'if (flutter > 0.0) {',
        '  transformed.x += flutter * (0.62 + 0.38 * sin(uFlutterT * 2.1 + position.y * 1.1 + position.z * 0.8 + position.x * 0.6));',
        '} else if (flutter < 0.0) {',
        '  float fa = -flutter;',
        '  transformed.z += fa * sin(uFlutterT * 7.0 + position.x * 6.0 + position.y);',
        '  transformed.y += fa * 0.25 * sin(uFlutterT * 4.3 + position.x * 4.0);',
        '}'
      ].join('\n'));
    };
    m.customProgramCacheKey = function () { return 'glt-ship-flutter-v3'; };
    shipMat = mark(m, 'full');
    return shipMat;
  }

  function glowMaterial() {
    if (glowMat) return glowMat;
    const m = new THREE.MeshBasicMaterial({ vertexColors: true });
    m.onBeforeCompile = withMark;
    m.customProgramCacheKey = function () { return 'glt-ship-glow-mark'; };
    glowMat = mark(m, 'glow');
    return glowMat;
  }

  // Lit voxel material for ship parts outside the merged body (guns, deck crew), with the ship lift and mark.
  function solidMaterial() {
    if (solidMat) return solidMat;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uShipLift = U.lift;
      sh.fragmentShader = 'uniform float uShipLift;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uShipLift;');
      withMark(sh);
    };
    m.customProgramCacheKey = function () { return 'glt-ship-solid-mark'; };
    solidMat = mark(m, 'full');
    return solidMat;
  }

  // Flat material for decals that must not be outlined (oil slick, foam).
  function flatMaterial() {
    if (flatMat) return flatMat;
    flatMat = mark(new THREE.MeshLambertMaterial({ vertexColors: true }), 'none');
    return flatMat;
  }

  // Per frame (fleet3d): flag/sail time and day/night lantern strength.
  function tick(t, night) {
    U.time.value = t;
    if (glowMat) {
      const k = 0.72 + 0.28 * Math.max(0, Math.min(1, night || 0));
      glowMat.color.setRGB(k, k, k);
    }
  }

  // ------------------------------------------------------------------ colour helpers
  function hx(c) {
    if (typeof c === 'number') return c >>> 0;
    if (typeof c === 'string' && c.charAt(0) === '#') return parseInt(c.slice(1), 16) >>> 0;
    return GLT.palette.get(c);
  }
  function shade(c, f) {
    const n = hx(c);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return (r << 16) | (g << 8) | b;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

  // Hull plan shape: stern width -> max -> rounded bow.
  function taper(u, sternW, maxW, bowW, sternF, bowF, bowPow) {
    if (u < sternF) return sternW + (maxW - sternW) * Math.sin((u / sternF) * Math.PI / 2);
    if (u > 1 - bowF) {
      const t = (u - (1 - bowF)) / bowF;
      return bowW + (maxW - bowW) * Math.pow(Math.max(0, Math.cos(t * Math.PI / 2)), bowPow);
    }
    return maxW;
  }

  // Canonical palette picks (raw hex so post snapping is predictable; all are palette colours).
  const P = {
    ink: '#1a1628', ink2: '#2c2640', ink3: '#463f5c', grey: '#6c6684', grey2: '#a29cb4', white: '#fffbf0',
    sailL: '#fff3da', sail: '#e8d8b2', sailD: '#c2ab88',
    woodDeep: '#2a1812', woodDark: '#47271a', woodMid: '#683a22', wood: '#8c542e', woodL: '#b2743e', woodXL: '#d49e5e',
    red: '#bc302e', redD: '#6a1424', redL: '#ec6a52', gold: '#f4c443', brass: '#c48e26', goldD: '#8a5c1a',
    fire: '#d4441a', orange: '#f27620', amber: '#ffaa38', yellow: '#ffd86a',
    grass: '#557f34', grassD: '#356a33', grassL: '#7f9a3c', leaf: '#21502f',
    teal: '#367064', tealD: '#255553', tealL: '#58967e', tealX: '#173d43',
    cloud: '#ccd2e8', cloudD: '#9aa2c2', slate: '#435068', iron: '#2f3e43', iron2: '#4f6266',
    blue: '#2d62c6', blueD: '#1a3d8a', blueL: '#5a90ea', skin: '#f2c8a0', skinD: '#c88a64',
    lantern: '#ffaa38', window: '#ffd86a', ember: '#f27620', glass: '#93bdea', pink: '#d0609a', terra: '#9c5232', soilD: '#5c2c22'
  };

  // ------------------------------------------------------------------ recipe kit
  function makeCtx(id, o) {
    const len = GLT.data.ships[id].len;
    const L = len * 16 - 2;
    const B = GLT.voxel.builder({ size: VS });
    const G = GLT.voxel.builder({ size: VS });
    const ctx = {
      id, o, len, L, xs: -L / 2, xe: L / 2 - 1,
      hull: B, guns: G, sails: [], flags: [], pennants: [], masts: [],
      a: { muzzles: [], crew: [], lanterns: [], flag: null },
      deckAt: null, rng: RNG().create(RNG().hashString('ship:' + id)),
      trim: o.trim || '#e23b2e', pen: o.pennant || o.trim || '#e23b2e', pen2: o.pennant2 || '#fffbf0'
    };
    // Variant livery (pilot-api.js): o.recolor maps canon hex -> hex for every voxel (masts, cabins, figureheads);
    // o.shell / o.deck / o.sail map the hull shell + rail, the deck and the sail cloth first (falling back to o.recolor);
    // o.flag replaces every flag and sail emblem; o.crewKinds remaps deck-crew figures. Canon ships pass none of these.
    const rc = o.recolor || null;
    const look = (m, c) => (m && typeof c === 'string' && m[c.toLowerCase()]) || null;
    ctx.remap = (c) => look(rc, c) || c;
    ctx.mapShell = (c) => look(o.shell, c) || ctx.remap(c);
    ctx.mapDeck = (c) => look(o.deck, c) || ctx.remap(c);
    ctx.mapSail = (c) => look(o.sail, c) || ctx.remap(c);
    const set0 = B.set, box0 = B.box;
    ctx.paint = (x, y, z, c, cls) => { set0(x, y, z, c, cls); return ctx; };   // bypasses the livery remap
    ctx.paintBox = (x0, y0, z0, x1, y1, z1, c, cls) => { box0(x0, y0, z0, x1, y1, z1, c, cls); return ctx; };
    if (rc) {
      B.set = (x, y, z, c, cls) => set0(x, y, z, ctx.remap(c), cls);
      B.box = (x0, y0, z0, x1, y1, z1, c, cls) => box0(x0, y0, z0, x1, y1, z1, ctx.remap(c), cls);
    }
    ctx.set =(x, y, z, c, cls) => { B.set(x, y, z, c, cls); return ctx; };
    ctx.box = (x0, y0, z0, x1, y1, z1, c, cls) => { B.box(x0, y0, z0, x1, y1, z1, c, cls); return ctx; };
    ctx.sym = (x, y, z, c, cls) => { B.set(x, y, z, c, cls); B.set(x, y, -z, c, cls); return ctx; };
    ctx.boxSym = (x0, y0, z0, x1, y1, z1, c, cls) => { B.box(x0, y0, z0, x1, y1, z1, c, cls); B.box(x0, y0, -z0, x1, y1, -z1, c, cls); return ctx; };
    ctx.del = (x, y, z) => { B.remove(x, y, z); return ctx; };
    ctx.line = (x0, y0, z0, x1, y1, z1, c, b) => {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        (b || B).set(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t)), Math.round(lerp(z0, z1, t)), c);
      }
      return ctx;
    };
    ctx.mast = (x, y0, y1, c) => { ctx.box(x, y0, 0, x, y1, 0, c || P.woodDark); ctx.masts.push({ x, y0, y1 }); return ctx; };
    // Square sail on mast x: rows y0..y1, half width hw (<= 6) tapering to hwTop; emblem = FlagId stamped in ink.
    ctx.sail = (s) => {
      const sl = Object.assign({ hw: 6, belly: 1, col: P.sailL, seam: P.sail, hem: P.sailD, yard: P.woodDark }, s);
      sl.col = ctx.mapSail(sl.col); sl.seam = ctx.mapSail(sl.seam); sl.hem = ctx.mapSail(sl.hem);
      if (o.flag && sl.emblem) sl.emblem = o.flag;
      ctx.sails.push(sl);
      return ctx;
    };
    ctx.flag = (x, yTop, flag) => { flag = o.flag || flag; ctx.flags.push({ x, yTop, flag }); if (!ctx.a.flag) ctx.a.flag = { x: (x + 0.5) * VS, y: (yTop + 1) * VS, z: 0 }; return ctx; };
    ctx.pennant = (x, yTop) => { ctx.pennants.push({ x, yTop }); return ctx; };
    // Cannon through the hull shell at |z| = zHull (gun port), barrel protruding one voxel toward `side` (+1/-1).
    ctx.gun = (x, y, zHull, side) => {
      G.set(x, y, (zHull + 1) * side, P.iron);
      ctx.set(x, y, zHull * side, P.ink).set(x - 1, y, zHull * side, P.ink2).set(x + 1, y, zHull * side, P.ink2);
      ctx.set(x, y + 1, zHull * side, P.ink2);
      ctx.a.muzzles.push({ x: (x + 0.5) * VS, y: (y + 0.5) * VS, z: side * ((zHull + 1) * VS + VS / 2) });
      return ctx;
    };
    ctx.guns2 = (x, y, zHull) => { ctx.gun(x, y, zHull, 1); ctx.gun(x, y, zHull, -1); return ctx; };
    ctx.lantern = (x, y, z, c) => {
      ctx.set(x, y, z, c || P.lantern, 'emissive');
      ctx.a.lanterns.push({ x: (x + 0.5) * VS, y: (y + 0.5) * VS, z: z * VS });
      return ctx;
    };
    // A crew member standing ON TOP of voxel (x, y, z).
    ctx.crew = (x, y, z, kind) => {
      kind = kind || 'pirateA';
      ctx.a.crew.push({ x: (x + 0.5) * VS, y: (y + 1) * VS, z: z * VS, kind: (o.crewKinds && o.crewKinds[kind]) || kind });
      return ctx;
    };
    ctx.shrouds = (xm, yTop, xb, yb, zb, c) => { ctx.line(xm, yTop, 0, xb, yb, zb, c || P.woodDeep); ctx.line(xm, yTop, 0, xb, yb, -zb, c || P.woodDeep); return ctx; };
    return ctx;
  }

  // Generic hull: plan shape hb(u), deck height deck(u), keel, colour callbacks. u = 0 at the stern, 1 at the bow.
  function hullForm(ctx, f) {
    const B = ctx.hull;
    const n = f.x1 - f.x0 + 1;
    const keel = f.keel != null ? f.keel : -2;
    const tum = f.tumble != null ? f.tumble : 0.55;
    const Uof = (x) => (x - f.x0 + 0.5) / n;
    const D = (x) => f.deck(Uof(x));
    const W = (x, y) => {
      if (x < f.x0 || x > f.x1) return -1;
      const u = Uof(x);
      if (y > f.deck(u) || y < keel) return -1;
      const k = y < 1 ? tum + (1 - tum) * ((y - keel) / (1 - keel)) : (f.flare ? f.flare(y, u) : 1);
      return Math.floor(f.hb(u) * k + 0.001);
    };
    ctx.deckAt = (x) => (x < f.x0 || x > f.x1 ? null : D(x));
    for (let x = f.x0; x <= f.x1; x++) {
      const u = Uof(x), d = D(x);
      for (let y = keel; y <= d; y++) {
        const w = W(x, y);
        if (w < 0) continue;
        for (let z = -w; z <= w; z++) {
          const az = Math.abs(z);
          const side = az === w;
          const endEdge = W(x - 1, y) < az || W(x + 1, y) < az;
          // a step up to a higher deck (neighbour column exists but lower) is an inner wall, not the hull shell
          const nb = W(x - 1, y) < az ? x - 1 : x + 1;
          const step = !side && endEdge && nb >= f.x0 && nb <= f.x1 && D(nb) < y && W(nb, D(nb)) >= az;
          let c;
          if (y === d && !side && !(endEdge && !step)) c = ctx.mapDeck(f.deckCol(x, z, u));
          else if (step) c = ctx.remap(f.wall ? f.wall(x, y, z, u) : P.woodMid);
          else if (side || endEdge || y === keel) {
            const trimOk = y === d && (!f.trimRange || (u >= f.trimRange[0] && u <= f.trimRange[1]));
            c = trimOk ? ctx.trim : ctx.mapShell(f.shell(x, y, z, u, w, d));
          }
          else c = ctx.remap(f.wall ? f.wall(x, y, z, u) : P.woodMid);
          ctx.paint(x, y, z, c);
        }
      }
    }
    if (f.rail) {
      for (let x = f.x0; x <= f.x1; x++) {
        const u = Uof(x);
        if (f.railRange && (u < f.railRange[0] || u > f.railRange[1])) continue;
        const d = D(x), w = W(x, d);
        if (w < 0) continue;
        for (let z = -w; z <= w; z++) {
          const az = Math.abs(z);
          if (az === w || W(x - 1, d) < az || W(x + 1, d) < az) {
            const post = ((x + 64) % 3) === 0;
            ctx.paint(x, d + 1, z, ctx.mapShell(post ? (f.railPost || f.rail) : f.rail));
          }
        }
      }
    }
    return { W, D, Uof };
  }

  // Plank rows: shell colour by height band with darker seams every other row and butt joints every 9 voxels.
  function planks(base, seam, every) {
    return (x, y) => (((y + 64) % (every || 2)) === 0 || ((x + 3 * y + 640) % 11) === 0 ? seam : base);
  }

  // ------------------------------------------------------------------ the seven ships
  const RECIPES = {};

  // ---- Going Merry (2): little caravel, curly-horned sheep figurehead, stern cabin, one big sail.
  RECIPES.goingMerry = function (c) {
    const lower = planks(P.woodL, P.wood, 2);
    const h = hullForm(c, {
      x0: -15, x1: 11, keel: -2,
      hb: (u) => taper(u, 3.7, 5.2, 1.2, 0.25, 0.42, 0.7),
      deck: (u) => (u < 0.26 ? 6 : u > 0.84 ? 5 : 4),
      shell: (x, y) => (y <= 0 ? P.woodMid : y === 1 ? P.sail : lower(x, y)),
      deckCol: (x, z) => ((z + 32) % 2 ? P.woodXL : P.woodL),
      wall: () => P.woodL,
      rail: P.sail, railPost: P.woodXL
    });
    // stern cabin with glowing windows
    c.box(-15, 7, -3, -10, 9, 3, P.sail);
    c.box(-15, 7, -3, -15, 9, -3, P.woodL).box(-15, 7, 3, -15, 9, 3, P.woodL).box(-10, 7, -3, -10, 9, 3, P.woodL);
    c.box(-15, 10, -4, -9, 10, 4, P.woodMid).box(-14, 11, -3, -10, 11, 3, P.wood);
    c.set(-15, 8, -1, P.window, 'emissive').set(-15, 8, 1, P.window, 'emissive');
    c.sym(-12, 8, 3, P.window, 'emissive');
    c.set(-10, 7, 0, P.woodMid).set(-10, 8, 0, P.woodMid);
    c.lantern(-15, 12, 0);
    // bow: BIG sheep figurehead (the Merry's signature): fluffy cream wool, light face, golden curled horns, ink eyes + nose
    c.box(8, 5, -2, 12, 7, 2, P.woodMid);                                   // neck block on the stem
    c.box(9, 7, -3, 13, 11, 3, P.sailL).box(10, 12, -2, 12, 12, 2, P.sailL); // wool mane (7 wide, 5 tall)
    c.box(9, 8, -3, 13, 8, -3, P.sail).box(9, 8, 3, 13, 8, 3, P.sail);       // wool shading
    c.box(13, 6, -1, 14, 9, 1, P.skin).box(14, 5, 0, 14, 5, 0, P.skin);       // face + chin
    c.set(14, 8, -1, P.ink).set(14, 8, 1, P.ink).set(14, 7, 0, P.ink).set(14, 6, 0, P.skinD); // eyes, nose, mouth
    c.set(13, 10, -2, P.sail).set(13, 10, 2, P.sail);
    // curly golden horns, one spiral each side (outside the wool)
    [[10, 10], [10, 11], [11, 12], [12, 12], [13, 11], [13, 10], [12, 9]].forEach((p) => c.sym(p[0], p[1], 4, P.gold));
    c.sym(11, 11, 4, P.brass).sym(12, 10, 4, P.brass).sym(10, 9, 4, P.brass);
    c.sym(11, 11, 3, P.gold).sym(12, 11, 3, P.gold);
    c.line(8, 6, 0, 12, 8, 0, P.wood);
    // masts and sails (pennant at the main truck, Jolly Roger just below it)
    c.mast(-1, 5, 34);
    c.box(-2, 21, -1, 0, 22, 1, P.woodMid).set(-1, 22, 0, P.woodDark);
    c.sail({ x: -1, y0: 8, y1: 19, hw: 6, emblem: 'strawHat', belly: 1 });
    c.flag(-1, 30, 'strawHat');
    c.pennant(-1, 34);
    c.mast(7, 5, 18);
    c.sail({ x: 7, y0: 8, y1: 15, hw: 4, hwTop: 3, belly: 1 });
    c.shrouds(-1, 20, -7, 5, 4).shrouds(7, 16, 3, 5, 4);
    c.line(7, 18, 0, 11, 13, 0, P.woodDeep);
    c.guns2(-5, 2, 5).guns2(3, 2, 5);
    c.crew(-6, 4, 2, 'pirateA').crew(3, 4, -2, 'pirateB').crew(-12, 11, 1, 'pirateB').crew(-1, 22, 1, 'pirateA');
    return h;
  };

  // ---- Thousand Sunny (4): sunflower-maned lion figurehead, lawn deck, round crow's-nest observatory.
  RECIPES.thousandSunny = function (c) {
    const body = planks(P.woodL, P.wood, 3);
    const h = hullForm(c, {
      x0: -31, x1: 25, keel: -2,
      hb: (u) => taper(u, 4.3, 5.4, 2.2, 0.16, 0.3, 0.55),
      deck: (u) => (u < 0.22 ? 9 : u > 0.8 ? 8 : 6),
      shell: (x, y) => (y <= 0 ? P.woodMid : y >= 7 ? P.sailL : (y === 6 ? P.sail : body(x, y))),
      deckCol: (x, z, u) => (u < 0.22 || u > 0.8 ? ((z + 32) % 2 ? P.woodXL : P.woodL) : (((x + z * 3 + 99) % 7) === 0 ? P.grassL : ((x + z + 64) % 2 ? P.grass : P.grassD))),
      wall: () => P.sailL,
      rail: P.woodMid, railPost: P.woodDark
    });
    // aft cabin (white walls, round windows), roof deck with a railing
    c.box(-30, 10, -4, -22, 14, 4, P.sailL);
    c.box(-30, 10, -4, -22, 10, 4, P.sail);
    [-28, -25].forEach((x) => { c.sym(x, 12, 4, P.window, 'emissive'); c.sym(x + 1, 12, 4, P.window, 'emissive'); });
    c.set(-22, 11, -1, P.woodMid).set(-22, 12, -1, P.woodMid).set(-22, 11, 1, P.woodMid).set(-22, 12, 1, P.woodMid);
    c.box(-31, 15, -5, -21, 15, 5, P.woodMid);
    for (let x = -31; x <= -21; x += 2) { c.sym(x, 16, 5, P.woodDark); }
    c.lantern(-31, 16, 0);
    // tangerine trees on the aft deck
    c.sym(-19, 10, 3, P.woodDark).sym(-19, 11, 3, P.woodDark);
    c.boxSym(-20, 12, 2, -18, 13, 4, P.leaf);
    c.sym(-19, 14, 3, P.grassD).sym(-20, 13, 4, P.orange).sym(-18, 12, 2, P.orange).sym(-18, 13, 4, P.amber);
    // main mast + round observatory
    c.mast(-2, 6, 35);
    const room = (y0, y1, r, col) => {
      for (let y = y0; y <= y1; y++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        if (x * x + z * z <= r * r + 1) c.set(-2 + x, y, z, typeof col === 'function' ? col(x, y, z) : col);
      }
    };
    room(22, 22, 3, P.woodMid);
    room(23, 25, 3, (x, y, z) => (y === 24 && (x * x + z * z) >= 7 && ((x + z + 8) % 2 === 0) ? P.window : P.sailL));
    room(26, 26, 3, P.woodMid);
    room(27, 27, 2, P.wood);
    for (let x = -5; x <= 1; x++) for (let z = -3; z <= 3; z++) {
      const v = c.hull.get(x, 24, z);
      if (v === hx(P.window)) c.set(x, 24, z, P.window, 'emissive');
    }
    c.sail({ x: -2, y0: 8, y1: 20, hw: 6, emblem: 'strawHat', belly: 2 });
    c.flag(-2, 33, 'strawHat');
    c.pennant(-2, 35);
    // fore mast
    c.mast(13, 8, 25);
    c.sail({ x: 13, y0: 11, y1: 21, hw: 5, hwTop: 4, belly: 1 });
    c.shrouds(-2, 21, -10, 7, 5).shrouds(13, 22, 7, 7, 5);
    c.line(13, 26, 0, 26, 12, 0, P.woodDeep);
    // lion figurehead: sunflower mane (petals) + round face
    const cy = 12;
    for (let y = cy - 8; y <= cy + 8; y++) for (let z = -6; z <= 6; z++) {
      const dy = (y - cy) * (6 / 7.6), r = Math.sqrt(dy * dy + z * z);
      if (r > 6.45) continue;
      const a = Math.atan2(dy, z);
      const petal = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 14 + 0.5) % 2;
      const tip = Math.abs(Math.cos(((a + Math.PI) / (2 * Math.PI)) * 14 * Math.PI));
      if (r > 5.4 && tip < 0.45) continue;            // scalloped petal edge
      const col = r > 5 ? (petal ? P.fire : P.orange) : r > 3.6 ? (petal ? P.amber : P.gold) : P.yellow;
      if (r > 3.2) c.set(25, y, z, shade(col, 0.8));
      c.set(26, y, z, r > 3.6 ? shade(col, 0.9) : P.amber);
      c.set(27, y, z, col);
      if (r <= 3.4) c.set(28, y, z, P.yellow);
    }
    c.set(28, cy + 1, -2, P.ink).set(28, cy + 1, 2, P.ink).set(28, cy + 2, -2, P.woodMid).set(28, cy + 2, 2, P.woodMid);
    c.box(29, cy - 1, -1, 29, cy, 1, P.amber).set(30, cy, 0, P.woodMid);
    c.box(28, cy - 3, -2, 28, cy - 3, 2, P.redD).set(28, cy - 2, -2, P.redD).set(28, cy - 2, 2, P.redD);
    c.sym(29, cy - 1, 2, P.woodMid).sym(29, cy - 2, 3, P.woodMid);
    // cannons and crew
    c.guns2(-10, 3, 5).guns2(4, 3, 5);
    c.crew(-8, 6, 2, 'pirateA').crew(4, 6, -2, 'pirateB').crew(8, 6, 3, 'pirateA').crew(-14, 6, -3, 'pirateB')
      .crew(-26, 15, 2, 'pirateA').crew(19, 8, 1, 'pirateB');
    return h;
  };

  // ---- Moby Dick (5): white whale-head bow with eyes and mouth, three masts, crescent-moustache flag.
  RECIPES.mobyDick = function (c) {
    const hullPl = planks(P.white, P.sail, 3);
    const head = (x) => clamp01((x - 12) / 6);   // 0 hull .. 1 whale head
    const h = hullForm(c, {
      x0: -39, x1: 38, keel: -2, tumble: 0.6,
      hb: (u) => taper(u, 4.6, 5.45, 2.2, 0.16, 0.2, 0.32),
      deck: (u) => {
        const x = -39 + u * 78;
        if (u < 0.17) return 10;
        if (x < 13) return 7;
        if (x < 30) return Math.round(7 + 7 * Math.sin(clamp01((x - 13) / 12) * Math.PI / 2));
        return Math.round(14 - 7 * smooth(30, 39, x));
      },
      flare: (y, u) => { const x = -39 + u * 78; return x > 26 && y > 9 ? 1 - (y - 9) * 0.07 * smooth(26, 34, x) : 1; },
      shell: (x, y, z) => {
        const hd = head(x);
        if (y <= 0) return hd > 0 ? P.cloud : P.cloudD;
        if (hd > 0) {
          if (x > 21 && y === 3) return P.ink2;                                          // mouth line
          if (x > 21 && y < 3) return P.cloud;
          return y > 10 ? P.white : P.sailL;
        }
        if (y === 4) return P.woodMid;                                                  // gun deck strake
        return y <= 2 ? P.sail : hullPl(x, y);
      },
      deckCol: (x, z, u) => (x >= 13 ? (Math.abs(z) > 3 ? P.sailL : P.white) : ((z + 32) % 2 ? P.woodL : P.wood)),
      wall: (x) => (x >= 13 ? P.sailL : P.woodL),
      rail: P.woodMid, railPost: P.woodDark, railRange: [0, 0.66], trimRange: [0, 0.66]
    });
    // whale eyes, blowhole, mouth corner
    c.boxSym(26, 7, 5, 27, 8, 5, P.ink); c.sym(27, 8, 5, P.white);
    c.sym(26, 6, 5, P.ink2);
    c.box(24, 15, 0, 25, 15, 0, P.ink2);
    c.sym(21, 4, 5, P.ink2).sym(20, 5, 5, P.ink2);
    // stern castle windows + lanterns
    for (let z = -3; z <= 3; z += 2) c.set(-39, 7, z, P.window, 'emissive');
    c.sym(-34, 8, 5, P.window, 'emissive');
    c.lantern(-39, 11, 4).lantern(-39, 11, -4);
    c.box(-38, 11, -3, -33, 13, 3, P.sailL).box(-38, 14, -4, -32, 14, 4, P.woodMid);
    c.sym(-35, 12, 3, P.window, 'emissive');
    // masts and sails
    c.mast(-6, 7, 35);
    c.box(-7, 25, -1, -5, 25, 1, P.woodMid);
    c.sail({ x: -6, y0: 11, y1: 23, hw: 6, emblem: 'whitebeard', belly: 2 });
    c.sail({ x: -6, y0: 26, y1: 28, hw: 4, hwTop: 4, belly: 0 });
    c.flag(-6, 35, 'whitebeard');
    c.mast(9, 7, 31);
    c.sail({ x: 9, y0: 11, y1: 22, hw: 6, belly: 2 });
    c.sail({ x: 9, y0: 25, y1: 29, hw: 4, hwTop: 3, belly: 1 });
    c.mast(-25, 10, 31);
    c.sail({ x: -25, y0: 14, y1: 24, hw: 5, hwTop: 4, belly: 1 });
    c.sail({ x: -25, y0: 26, y1: 28, hw: 3, belly: 0 });
    c.pennant(-25, 31);
    c.shrouds(-6, 24, -14, 8, 5).shrouds(9, 23, 3, 8, 5).shrouds(-25, 25, -31, 11, 5);
    c.line(9, 31, 0, 22, 13, 0, P.woodDeep);
    // cannons
    c.guns2(-18, 4, 5).guns2(-8, 4, 5).guns2(2, 4, 5);
    c.crew(-12, 7, 2, 'pirateA').crew(-2, 7, -3, 'pirateB').crew(4, 7, 2, 'pirateA').crew(-18, 7, -2, 'pirateB')
      .crew(20, 11, 1, 'pirateA').crew(-35, 14, 0, 'pirateB').crew(-30, 10, 3, 'pirateA');
    return h;
  };

  // ---- Oro Jackson (4): Adam-wood galleon, gold ornament, towering stern castle, sea-dragon figurehead.
  RECIPES.oroJackson = function (c) {
    const body = planks(P.woodMid, P.woodDark, 2);
    const h = hullForm(c, {
      x0: -31, x1: 23, keel: -2,
      hb: (u) => taper(u, 4.6, 5.4, 1.4, 0.12, 0.3, 0.75),
      deck: (u) => (u < 0.22 ? 12 : u < 0.3 ? 9 : u > 0.8 ? 9 : 7),
      shell: (x, y, z, u, w, d) => {
        if (y <= 0) return P.woodDeep;
        if (y === d - 1 || y === 3) return P.brass;
        if (u < 0.22 && y >= 8 && ((x + 64) % 3) === 0) return P.gold;
        return body(x, y);
      },
      deckCol: (x, z) => ((z + 32) % 2 ? P.wood : P.woodL),
      wall: () => P.woodMid,
      rail: P.brass, railPost: P.gold
    });
    // stern gallery: gold-framed windows across the transom and the quarters
    for (let z = -4; z <= 4; z += 2) { c.set(-31, 8, z, P.window, 'emissive'); c.set(-31, 10, z, P.window, 'emissive'); c.set(-31, 9, z, P.gold); }
    c.sym(-28, 9, 5, P.window, 'emissive').sym(-25, 9, 5, P.window, 'emissive');
    c.box(-31, 13, -1, -31, 15, 1, P.brass).set(-31, 16, 0, P.gold);
    c.lantern(-31, 14, 4).lantern(-31, 14, -4).lantern(-32 + 1, 17, 0);
    // figurehead: golden sea-dragon (thick neck, horned head, curled crest), long bowsprit
    for (let k = 0; k <= 4; k++) c.box(20 + k, 5 + k, -1, 21 + k, 6 + k, 1, k % 2 ? P.brass : P.gold);
    c.box(24, 10, -2, 27, 13, 2, P.gold);
    c.box(28, 10, -1, 28, 12, 1, P.gold).set(29, 11, 0, P.brass).set(29, 10, 0, P.brass);
    c.box(27, 9, -1, 28, 9, 1, P.brass);
    c.sym(27, 12, 2, P.ink).sym(26, 12, 2, P.white);
    [[23, 14], [24, 15], [25, 16], [26, 16], [27, 15], [26, 14]].forEach((p) => c.set(p[0], p[1], 0, P.amber));
    c.sym(25, 14, 2, P.brass).sym(24, 15, 2, P.brass);
    c.line(20, 9, 0, 30, 14, 0, P.woodDark);
    // masts: fore, main, mizzen
    c.mast(-3, 7, 35);
    c.box(-4, 25, -1, -2, 25, 1, P.woodDark);
    c.sail({ x: -3, y0: 11, y1: 23, hw: 6, emblem: 'roger', belly: 2, col: P.sailL, seam: P.sail });
    c.sail({ x: -3, y0: 26, y1: 28, hw: 4, hwTop: 4, belly: 0 });
    c.flag(-3, 35, 'roger');
    c.mast(12, 9, 31);
    c.sail({ x: 12, y0: 13, y1: 22, hw: 6, hwTop: 5, belly: 1 });
    c.sail({ x: 12, y0: 25, y1: 29, hw: 4, hwTop: 3, belly: 1 });
    c.mast(-18, 12, 32);
    c.sail({ x: -18, y0: 16, y1: 26, hw: 5, hwTop: 4, belly: 1 });
    c.pennant(-18, 32);
    c.shrouds(-3, 24, -11, 8, 5).shrouds(12, 23, 6, 10, 5).shrouds(-18, 27, -24, 13, 5);
    c.line(12, 31, 0, 29, 14, 0, P.woodDeep);
    c.guns2(-12, 4, 5).guns2(-2, 4, 5).guns2(8, 4, 5);
    c.crew(-8, 7, 2, 'pirateA').crew(2, 7, -2, 'pirateB').crew(6, 7, 3, 'pirateB').crew(-26, 12, 0, 'pirateA')
      .crew(18, 9, -1, 'pirateA');
    return h;
  };

  // ---- Red Force (3): crimson galleon (black lower hull, gold line), red sea-horse dragon figurehead.
  RECIPES.redForce = function (c) {
    const red = planks(P.red, P.redD, 3);
    const h = hullForm(c, {
      x0: -23, x1: 16, keel: -2,
      hb: (u) => taper(u, 4.2, 5.3, 1.2, 0.16, 0.34, 0.7),
      deck: (u) => (u < 0.24 ? 9 : u > 0.8 ? 7 : 6),
      shell: (x, y) => (y <= 1 ? P.ink2 : y === 2 ? P.brass : red(x, y)),
      deckCol: (x, z) => ((z + 32) % 2 ? P.woodL : P.wood),
      wall: () => P.redD,
      rail: P.woodDeep, railPost: P.brass
    });
    for (let z = -3; z <= 3; z += 3) c.set(-23, 7, z, P.window, 'emissive');
    c.sym(-20, 7, 5, P.window, 'emissive');
    c.lantern(-23, 11, 4).lantern(-23, 11, -4);
    // figurehead: red sea-horse dragon with a gold crest
    for (let k = 0; k <= 4; k++) c.box(15 + k * 0.6 | 0, 4 + k, -1, (16 + k * 0.6) | 0, 5 + k, 1, k % 2 ? P.redD : P.red);
    c.box(18, 9, -2, 21, 12, 2, P.red).box(22, 9, -1, 22, 11, 1, P.red).set(22, 12, 0, P.redD);
    c.sym(21, 12, 2, P.gold).sym(20, 12, 2, P.ink).set(22, 9, 0, P.redD).set(22, 10, 0, P.ink2);
    [[16, 12], [17, 13], [18, 14], [19, 14], [20, 13], [16, 11]].forEach((p) => c.set(p[0], p[1], 0, P.gold));
    c.sym(17, 9, 2, P.gold).sym(16, 8, 2, P.gold);
    c.line(16, 8, 0, 22, 13, 0, P.woodDark);
    // masts
    c.mast(1, 6, 35);
    c.box(0, 24, -1, 2, 24, 1, P.woodDark);
    c.sail({ x: 1, y0: 10, y1: 22, hw: 6, emblem: 'redHair', belly: 2 });
    c.sail({ x: 1, y0: 26, y1: 28, hw: 4, hwTop: 4, belly: 0 });
    c.flag(1, 35, 'redHair');
    c.mast(-13, 9, 30);
    c.sail({ x: -13, y0: 13, y1: 23, hw: 5, hwTop: 4, belly: 1 });
    c.pennant(-13, 30);
    c.shrouds(1, 24, -6, 7, 5).shrouds(-13, 25, -19, 10, 5);
    c.line(1, 33, 0, 21, 12, 0, P.woodDeep);
    c.guns2(-8, 3, 5).guns2(6, 3, 5);
    c.crew(-5, 6, 2, 'pirateB').crew(8, 6, -2, 'pirateA').crew(-18, 9, 1, 'pirateA').crew(4, 6, 3, 'pirateB');
    return h;
  };

  // ---- Polar Tang (3): yellow submarine with conning tower, periscope, portholes, tail fins and a smiley emblem.
  RECIPES.polarTang = function (c) {
    const yc = 1.5;
    const R = (x) => {
      const u = (x + 23 + 0.5) / 46;
      if (u > 0.82) return 5.6 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.82) / 0.18, 2)));
      if (u < 0.3) return 2.2 + 3.4 * Math.sin((u / 0.3) * Math.PI / 2);
      return 5.6;
    };
    for (let x = -23; x <= 22; x++) {
      const r = R(x);
      if (r < 0.6) continue;
      for (let y = -2; y <= 8; y++) for (let z = -6; z <= 6; z++) {
        const dy = (y + 0.5 - yc) / (r * 0.98), dz = z / (r + 0.35);
        if (dy * dy + dz * dz > 1) continue;
        if (y > 6) continue;   // flat walkway on top
        let col = y <= -1 ? P.brass : y <= 1 ? P.gold : P.yellow;
        if (y === 6) col = Math.abs(z) <= 1 && x > -16 && x < 18 ? (((x + 64) % 4) === 0 ? P.gold : P.yellow) : P.yellow;
        if (y === 2 && ((x + 64) % 8) === 0) col = P.gold;
        if (y === 5 && Math.abs(z) >= Math.floor(r * 0.75)) col = c.trim;
        c.set(x, y, z, col);
      }
    }
    c.deckAt = (x) => (x > -18 && x < 19 ? 6 : null);
    // portholes
    for (let x = -14; x <= 16; x += 5) { c.sym(x, 3, 5, P.window, 'emissive'); c.sym(x - 1, 3, 5, P.brass); c.sym(x + 1, 3, 5, P.brass); }
    // conning tower with a black smiley emblem on both sides
    for (let x = -6; x <= 6; x++) for (let y = 7; y <= 13; y++) for (let z = -2; z <= 2; z++) {
      if (x === 6 && (y === 13 || Math.abs(z) === 2)) continue;
      c.set(x, y, z, y === 13 ? P.brass : P.yellow);
    }
    c.box(-6, 14, -2, 5, 14, 2, P.goldD);
    c.set(6, 11, -1, P.window, 'emissive').set(6, 11, 1, P.window, 'emissive');
    const EMB = ['..xxx..', '.xxxxx.', 'xx.x.xx', 'xxxxxxx', 'x.xxx.x', '.x...x.', '..xxx..'];
    EMB.forEach((row, r) => { for (let i = 0; i < 7; i++) if (row.charAt(i) === 'x') { c.set(-3 + i, 13 - r, 2, P.ink); c.set(3 - i, 13 - r, -2, P.ink); } });
    // periscope, flag pole, hatch, rails
    c.box(-2, 15, 0, -2, 18, 0, P.iron).box(-1, 18, 0, 0, 18, 0, P.iron);
    c.set(1, 18, 0, P.glass, 'emissive');
    c.mast(-5, 15, 21, P.iron);
    c.flag(-5, 21, 'heart');
    c.pennant(-2, 18);
    c.box(11, 7, -1, 12, 7, 1, P.iron2).box(-12, 7, -1, -11, 7, 1, P.iron2);
    for (let x = -15; x <= 17; x += 3) c.sym(x, 7, 2, P.ink2);
    // tail: dorsal fin, side planes, propeller
    for (let x = -23; x <= -19; x++) for (let y = 5; y <= 5 + (x + 24); y++) c.set(x, y, 0, y > 7 ? P.amber : P.brass);
    c.boxSym(-22, 1, 3, -19, 1, 5, P.brass);
    c.box(-24 + 1, 0, -1, -23, 2, 1, P.iron);
    // bow torpedo tubes (muzzles, no cannons on a submarine)
    c.sym(20, 2, 2, P.ink);
    c.a.muzzles.push({ x: 5.6, y: 0.6, z: 0.6 }, { x: 5.6, y: 0.6, z: -0.6 });
    c.crew(-10, 6, 1, 'heart').crew(9, 6, -1, 'heart').crew(14, 6, 1, 'heart').crew(-2, 6, 0, 'bear').crew(0, 14, 0, 'heart');
    c.lantern(-6, 15, 0);
    return null;
  };

  // ---- Baratie (3): fish-shaped floating restaurant (fish head, eye, mouth, tail fin) with a two-storey diner.
  RECIPES.baratie = function (c) {
    const scales = (x, y, z) => ((x + (y % 2) * 2 + 64) % 4 === 0 ? P.tealD : (y >= 4 ? P.tealL : P.teal));
    const h = hullForm(c, {
      x0: -17, x1: 22, keel: -2, tumble: 0.6,
      hb: (u) => (u < 0.55 ? 3.2 + 2.4 * Math.sin((u / 0.55) * Math.PI / 2) : taper(u, 5.6, 5.6, 1.5, 0.01, 0.3, 0.6)),
      deck: (u) => { const x = -17 + u * 40; return x < 10 ? 5 : x < 19 ? 5 + Math.round(4 * Math.sin(clamp01((x - 10) / 7) * Math.PI / 2)) : 9 - Math.round(4 * smooth(19, 23, x)); },
      shell: (x, y, z) => {
        if (y <= 1) return P.sail;
        if (x >= 13) {
          if (y === 3 && x >= 16) return P.ink;
          if (x === 13 && y > 2) return P.tealD;
          return y >= 7 ? P.tealL : P.teal;
        }
        return scales(x, y, z);
      },
      deckCol: (x, z) => (x >= 11 ? P.tealL : ((x + 64) % 3 === 0 ? P.woodL : P.woodXL)),
      wall: () => P.teal,
      rail: P.woodMid, railPost: P.woodDark, railRange: [0, 0.68], trimRange: [0, 0.7]
    });
    // eye + mouth
    c.boxSym(16, 6, 5, 18, 7, 5, P.white); c.sym(17, 6, 5, P.ink).sym(17, 7, 5, P.ink2); c.sym(18, 7, 5, P.white);
    c.box(22, 2, -1, 22, 4, 1, P.redD); c.set(22, 3, 0, P.ink);
    // tail fin (forked), dorsal fin, pectoral fins
    for (let x = -23; x <= -17; x++) {
      const k = -17 - x;
      for (let y = 3 - Math.floor(k * 0.8); y <= 6 + Math.floor(k * 1.3); y++) {
        if (k > 3 && y > 2 && y < 5 + Math.floor((k - 3) * 0.6)) continue;   // fork
        c.set(x, y, 0, (x + y + 64) % 3 === 0 ? P.fire : P.orange);
      }
    }
    c.boxSym(6, 2, 6, 9, 3, 6, P.orange); c.sym(9, 3, 6, P.fire);
    // diner: ground floor (timber-framed cream walls, warm windows, door to the bow deck)
    c.box(-11, 6, -4, 8, 10, 4, P.sailL);
    for (let x = -11; x <= 8; x += 6) c.boxSym(x, 6, 4, x, 10, 4, P.woodMid);
    c.boxSym(-11, 10, 4, 8, 10, 4, P.woodMid);
    for (let x = -9; x <= 6; x += 3) if ((x + 11) % 6) { c.sym(x, 8, 4, P.window, 'emissive'); c.sym(x, 7, 4, P.window, 'emissive'); }
    c.box(8, 6, -1, 8, 8, 1, P.woodDark).set(8, 9, 0, P.brass);
    c.box(-12, 11, -5, 9, 11, 5, P.woodDark);
    c.box(-11, 12, -4, 8, 12, 4, P.terra);
    // second floor + red roof
    c.box(-7, 13, -3, 4, 16, 3, P.sailL);
    c.boxSym(-7, 13, 3, -7, 16, 3, P.woodMid).boxSym(4, 13, 3, 4, 16, 3, P.woodMid);
    for (let x = -5; x <= 2; x += 3) c.sym(x, 15, 3, P.window, 'emissive');
    c.box(4, 13, -1, 4, 14, 1, P.woodDark);
    for (let y = 17; y <= 19; y++) c.box(-8, y, -(4 - (y - 17) * 2), 5, y, 4 - (y - 17) * 2, y === 19 ? P.redD : P.red);
    // the sign (blank wooden board with a gold rim and a little fish) on both sides of the upper floor
    [4, -4].forEach((z) => {
      c.box(-5, 13, z, 2, 15, z, P.woodL);
      c.set(-5, 15, z, P.brass).set(2, 15, z, P.brass).set(-5, 13, z, P.brass).set(2, 13, z, P.brass);
      c.box(-3, 14, z, -1, 14, z, P.teal).set(0, 14, z, P.orange).set(-4, 14, z, P.orange);
    });
    // chimney
    c.box(-6, 18, 2, -5, 22, 2, P.ink3); c.box(-6, 23, 2, -5, 23, 2, P.ink2);
    // string of lanterns along the eaves
    for (let x = -10; x <= 7; x += 4) { c.lantern(x, 10, 5); c.lantern(x, 10, -5); }
    // mast on the fish head
    c.mast(14, 9, 31);
    c.sail({ x: 14, y0: 14, y1: 25, hw: 6, emblem: 'baratie', belly: 1 });
    c.flag(14, 31, 'baratie');
    c.mast(-2, 20, 26);
    c.pennant(-2, 26);
    c.shrouds(14, 26, 10, 9, 4);
    c.guns2(-9, 3, 5);
    c.crew(10, 5, 2, 'chef').crew(11, 5, -3, 'chef').crew(-14, 5, 0, 'chef').crew(6, 12, 3, 'chef').crew(-15, 5, -2, 'pirateB');
    return h;
  };

  // ------------------------------------------------------------------ sail / flag / pennant geometry
  function addFlutter(geo, fn) {
    const pos = geo.getAttribute('position');
    const arr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) arr[i] = fn ? fn(pos.getX(i), pos.getY(i), pos.getZ(i)) : 0;
    geo.setAttribute('flutter', new THREE.BufferAttribute(arr, 1));
    return geo;
  }

  function solidGeo(group) {
    let g = null;
    group.children.forEach((m) => { if (m.name === 'voxel-solid') g = m.geometry; else if (m.geometry) m.geometry.dispose(); });
    return g;
  }

  function sailBuilder(s) {
    const b = GLT.voxel.builder({ size: VS });
    const H = s.y1 - s.y0 + 1;
    const hwTop = s.hwTop != null ? s.hwTop : s.hw;
    const G = s.emblem ? GLT.flags.glyph(s.emblem, true) : null;
    const gTop = s.y1 - Math.floor((H - (G ? G.h : 0)) / 2);
    for (let y = s.y0; y <= s.y1; y++) {
      const v = (y - s.y0) / Math.max(1, H - 1);
      const w = Math.round(lerp(s.hw, hwTop, v));
      for (let z = -w; z <= w; z++) {
        if (y === s.y0 && Math.abs(z) === w && w > 2) continue;            // rounded foot corners
        const belly = Math.round(s.belly * Math.sin(Math.PI * clamp01(0.15 + v * 0.85)) * (1 - Math.pow(z / (w + 1), 2)));
        let col = ((z + 64) % 4 === 0) ? s.seam : s.col;
        if (y === s.y0) col = s.hem;
        if (G && w >= 6) {
          const gc = 6 - z, gr = gTop - y;
          if (gc >= 0 && gc < G.w && gr >= 0 && gr < G.h) { const e = G.at(gc, gr); if (e) col = e; }
        }
        b.set(belly, y, z, col);
      }
    }
    for (let z = -Math.min(6, hwTop + 1); z <= Math.min(6, hwTop + 1); z++) b.set(0, s.y1 + 1, z, s.yard);
    return b;
  }

  function sailGeometry(s, brace) {
    const b = s.b;
    const geo = solidGeo(b.build({ maxRun: 3, ao: 0.25 }));
    if (!geo) return null;
    const yTop = (s.y1 + 1) * VS, yBot = s.y0 * VS, hw = (s.hw + 1) * VS;
    addFlutter(geo, (x, y, z) => {
      if (y >= yTop - 0.001) return 1e-4;   // yard/top edge: no motion, but still lit as cloth
      const v = clamp01((y - yBot) / (yTop - yBot));
      return 0.16 * Math.pow(Math.sin(Math.PI * v), 0.8) * (1 - 0.55 * Math.pow(z / hw, 2)) * (s.belly ? 1 : 0.5);
    });
    const m = new THREE.Matrix4();
    geo.applyMatrix4(m.makeTranslation(VS / 2, 0, -VS / 2));
    geo.applyMatrix4(m.makeRotationY(brace || 0));
    geo.applyMatrix4(m.makeTranslation((s.x + 0.5) * VS, 0, 0));
    return geo;
  }

  // Voxel flag from a glyph (0.125 m voxels): field 15 x 13 with the glyph inside; extends toward -X from x = 0.
  function flagBuilder(flag, scale) {
    const b = GLT.voxel.builder({ size: FS * (scale || 1) });
    const G = GLT.flags.glyph(flag, false);
    const FW = G.w + 2, FH = G.h;
    for (let i = 0; i < FW; i++) for (let j = 0; j < FH; j++) {
      const gc = i - 1, gr = FH - 1 - j;
      let col = G.at(gc, gr) || G.field;
      if (i === 0) col = shade(G.field, G.field === '#fffbf0' ? 0.85 : 1.6);
      b.set(-FW + i, j, 0, col);
    }
    return { b, FW, FH, size: FS * (scale || 1) };
  }

  function flagGeometry(flag, x, yTop, scale) {
    const F = flagBuilder(flag, scale);
    const geo = solidGeo(F.b.build({ maxRun: 2, ao: 0 }));
    const len = F.FW * F.size;
    addFlutter(geo, (px) => -0.11 * (scale || 1) * clamp01(-px / len));
    const m = new THREE.Matrix4();
    geo.applyMatrix4(m.makeTranslation(0, 0, -F.size / 2));
    geo.applyMatrix4(m.makeTranslation(x * VS, (yTop + 1) * VS - F.FH * F.size, 0));
    return geo;
  }

  function pennantGeometry(ctx, p) {
    const b = GLT.voxel.builder({ size: FS });
    const N = 16;
    for (let i = 0; i < N; i++) {
      const hh = i < 5 ? 3 : i < 11 ? 2 : 1;
      for (let j = 0; j < hh; j++) {
        if (i >= N - 2 && j === 0 && hh > 1) continue;
        b.set(-1 - i, -j, 0, (j === 1 && i > 2 && i < 12) ? ctx.pen2 : ctx.pen);
      }
    }
    const geo = solidGeo(b.build({ maxRun: 2, ao: 0 }));
    addFlutter(geo, (px) => -0.09 * clamp01(-px / (N * FS)));
    const m = new THREE.Matrix4();
    geo.applyMatrix4(m.makeTranslation(p.x * VS, (p.yTop + 1) * VS - FS, -FS / 2));
    return geo;
  }

  // Merge geometries that carry position/normal/color/flutter.
  function mergeShip(geos) {
    geos = geos.filter(Boolean);
    let nv = 0, ni = 0;
    geos.forEach((g) => { nv += g.getAttribute('position').count; ni += g.getIndex().count; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), fl = new Float32Array(nv);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    geos.forEach((g) => {
      const n = g.getAttribute('position').count;
      pos.set(g.getAttribute('position').array, ov * 3);
      nor.set(g.getAttribute('normal').array, ov * 3);
      col.set(g.getAttribute('color').array, ov * 3);
      const f = g.getAttribute('flutter');
      if (f) fl.set(f.array, ov);
      const ix = g.getIndex();
      for (let i = 0; i < ix.count; i++) idx[oi++] = ix.getX(i) + ov;
      ov += n;
      g.dispose();
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('flutter', new THREE.BufferAttribute(fl, 1));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }

  // ------------------------------------------------------------------ damage (per cell segment, seeded)
  const CHAR = ['#1a1628', '#2c2640', '#2a1812', '#47271a'];
  function applyDamage(ctx, seg) {
    const B = ctx.hull;
    const rng = RNG().create(RNG().hashString(ctx.id + ':dmg:' + seg));
    const xa = -ctx.len * 8 + seg * 16, xb = xa + 15;
    const topAt = (x, z, yMax) => { for (let y = yMax || 40; y >= -2; y--) if (B.get(x, y, z) != null) return y; return null; };
    // o.damageFace (+1/-1) keeps the single hole on the side the camera sees; otherwise a seeded side.
    const sides = rng.chance(0.35) ? [1, -1] : [ctx.o.damageFace || (rng.chance(0.5) ? 1 : -1)];
    sides.forEach((side) => {
      const hxp = xa + 4 + rng.int(8);
      const deck = ctx.deckAt ? ctx.deckAt(hxp) : 6;
      const top = deck != null ? deck : (topAt(hxp, 0, 14) || 5);
      const hy = 1 + rng.int(Math.max(1, Math.min(top - 2, 5)));
      let ze = null;
      for (let z = 7; z >= 0; z--) if (B.get(hxp, hy, z * side) != null) { ze = z; break; }
      if (ze == null) return;
      const rx = 2.2 + rng.next() * 1.4, ry = 1.6 + rng.next() * 0.8;
      for (let dx = -5; dx <= 5; dx++) for (let dy = -4; dy <= 4; dy++) {
        const d = (dx / rx) * (dx / rx) + (dy / ry) * (dy / ry);
        const x = hxp + dx, y = hy + dy;
        if (y < 0) continue;
        if (d <= 1) {
          for (let k = 0; k <= 1; k++) B.remove(x, y, (ze - k) * side);
          if (B.get(x, y, (ze - 2) * side) != null) B.set(x, y, (ze - 2) * side, CHAR[0]);
        } else if (d <= 2.1 + rng.next() * 0.6) {
          for (let k = 0; k <= 1; k++) if (B.get(x, y, (ze - k) * side) != null) B.set(x, y, (ze - k) * side, CHAR[rng.int(CHAR.length)]);
        }
      }
      B.set(hxp, hy, (ze - 2) * side, P.ember, 'emissive');
      if (rng.chance(0.6)) B.set(hxp + 1, hy - 1, (ze - 2) * side, P.fire, 'emissive');
      // splintered planks sticking out of the hole
      B.set(hxp - 2, hy + 1, (ze + 1) * side, P.woodL);
      B.set(hxp + 2, hy - 1, (ze + 1) * side, P.wood);
    });
    // scorched deck, broken rail
    for (let i = 0; i < 14; i++) {
      const x = xa + rng.int(16), z = rng.int(11) - 5;
      const y = topAt(x, z, 16);
      if (y == null || y < 2) continue;
      const cur = B.get(x, y, z);
      if (cur == null) continue;
      if (Math.abs(z) >= 4 && rng.chance(0.5)) B.remove(x, y, z);
      else B.set(x, y, z, CHAR[rng.int(CHAR.length)]);
    }
    // torn sails on masts standing in (or next to) this segment
    ctx.sails.forEach((s) => {
      if (s.x < xa - 3 || s.x > xb + 3) return;
      const sb = s.b;
      const cz = rng.int(7) - 3, cy = s.y0 + 2 + rng.int(Math.max(1, s.y1 - s.y0 - 3));
      const r = 1.6 + rng.next() * 1.2;
      for (let z = -7; z <= 7; z++) for (let y = s.y0; y <= s.y1; y++) {
        const d = Math.sqrt((z - cz) * (z - cz) + (y - cy) * (y - cy) * 1.3);
        for (let bx = 0; bx <= 2; bx++) {
          if (sb.get(bx, y, z) == null) continue;
          if (d <= r) sb.remove(bx, y, z);
          else if (d <= r + 1.3) sb.set(bx, y, z, rng.chance(0.5) ? P.sailD : P.ink3);
        }
      }
      if (rng.chance(0.5)) for (let z = -6; z <= 6; z++) if (rng.chance(0.4)) for (let bx = 0; bx <= 2; bx++) sb.remove(bx, s.y0, z);
    });
  }

  // ------------------------------------------------------------------ build
  function recipe(id, o) {
    if (!RECIPES[id]) throw new Error('GLT.shipModels.build: unknown ship ' + id);
    const ctx = makeCtx(id, o || {});
    RECIPES[id](ctx);
    if (o && typeof o.post === 'function') o.post(ctx, P);   // variant figurehead / rig edits (pilot-api.js)
    ctx.sails.forEach((s) => { s.b = sailBuilder(s); });
    return ctx;
  }

  function build(id, o) {
    o = o || {};
    const ctx = recipe(id, o);
    (o.damage || []).forEach((seg) => applyDamage(ctx, seg));
    const brace = o.brace || 0;
    const geos = [];
    const hullGroup = ctx.hull.build({ materials: { emissive: glowMaterial() } });
    let glow = null;
    hullGroup.children.slice().forEach((m) => {
      if (m.name === 'voxel-solid') geos.push(addFlutter(m.geometry));
      else if (m.name === 'voxel-emissive') glow = m;
      else if (m.geometry) m.geometry.dispose();
    });
    ctx.sails.forEach((s) => geos.push(sailGeometry(s, brace)));
    // o.rigSquash (0..1): compress the rig above the deck (masts, sails, lanterns) so a tall ship does not hide the
    // row behind it in a 3/4 board view. Flags and pennants keep their shape and ride down with their mast top.
    const rs = o.rigSquash > 0 && o.rigSquash < 1 && ctx.masts.length ? o.rigSquash : 0;
    const pivot = rs ? (((ctx.deckAt && ctx.deckAt(0)) || 6) + 4) * VS : 0;
    const warpY = (y) => (y > pivot ? pivot + (y - pivot) * rs : y);
    const squash = (g) => {
      if (!rs || !g) return g;
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) p.setY(i, warpY(p.getY(i)));
      p.needsUpdate = true;
      g.computeBoundingBox();
      return g;
    };
    const lower = (g, yTop) => {
      const top = (yTop + 1) * VS;
      if (rs && top > pivot) g.translate(0, warpY(top) - top, 0);
      return g;
    };
    geos.forEach(squash);
    ctx.flags.forEach((f) => geos.push(lower(flagGeometry(f.flag, f.x, f.yTop), f.yTop)));
    ctx.pennants.forEach((p) => geos.push(lower(pennantGeometry(ctx, p), p.yTop)));
    if (glow) squash(glow.geometry);
    const shiftZ = new THREE.Matrix4().makeTranslation(0, 0, -VS / 2);
    geos[0].applyMatrix4(shiftZ);
    const merged = mergeShip(geos);
    const group = new THREE.Group();
    group.name = 'ship-' + id;
    const main = new THREE.Mesh(merged, shipMaterial());
    main.name = 'ship-main';
    main.castShadow = true; main.receiveShadow = true;
    group.add(main);
    if (glow) {
      glow.geometry.applyMatrix4(shiftZ);
      glow.name = 'ship-glow';
      glow.castShadow = false; glow.receiveShadow = false;
      group.add(glow);
    }
    let guns = null;
    if (ctx.guns.count()) {
      const gg = ctx.guns.build();
      gg.children.forEach((m) => { if (m.name === 'voxel-solid') guns = m; });
      if (guns) {
        guns.geometry.applyMatrix4(shiftZ);
        guns.name = 'ship-guns';
        guns.castShadow = true;
        group.add(guns);
      }
    }
    // measurements
    const bb = merged.boundingBox.clone();
    if (guns) { guns.geometry.computeBoundingBox(); bb.union(guns.geometry.boundingBox); }
    const tris = (g) => (g ? g.getIndex().count / 3 : 0);
    const L = ctx.len * GLT.C.CELL;
    const anchors = {
      muzzles: ctx.a.muzzles.map((p) => ({ x: p.x, y: p.y, z: p.z - (p.z ? 0 : 0) })),
      flag: ctx.a.flag || { x: 0, y: bb.max.y, z: 0 },
      crew: ctx.a.crew,
      bow: { x: bb.max.x, y: 0.5, z: 0 },
      stern: { x: bb.min.x, y: 0.5, z: 0 },
      lanterns: ctx.a.lanterns
    };
    const model = {
      group, id,
      length: bb.max.x - bb.min.x, beam: bb.max.z - bb.min.z, height: bb.max.y,
      cellLength: L,
      anchors,
      parts: { hull: main, sails: [main], flag: main, cannons: guns ? [guns] : [], figurehead: null, glow },
      bounds: { min: { x: bb.min.x, y: bb.min.y, z: bb.min.z }, max: { x: bb.max.x, y: bb.max.y, z: bb.max.z } },
      triangles: tris(merged) + tris(glow && glow.geometry) + tris(guns && guns.geometry),
      voxels: ctx.hull.count() + ctx.sails.reduce((a, s) => a + s.b.count(), 0),
      wake: wakePoints(ctx),
      flagId: o.flag || GLT.data.ships[id].flag,
      len: ctx.len
    };
    group.userData.shipId = id;   // (never store objects here: Object3D.clone() JSON-copies userData)
    return model;
  }

  // Foam points around the hull at the waterline (local metres), used by fleet3d for the wake ring.
  function wakePoints(ctx) {
    const B = ctx.hull;
    const pts = [];
    for (let x = ctx.xs; x <= ctx.xe; x += 3) {
      for (const side of [1, -1]) {
        for (let z = 7; z >= 0; z--) if (B.get(x, 0, z * side) != null) { pts.push({ x: (x + 0.5) * VS, z: (z + 1) * side * VS, k: 0 }); break; }
      }
    }
    let bowX = ctx.xs;
    for (let x = ctx.xe; x >= ctx.xs; x--) if (B.get(x, 0, 0) != null) { bowX = x; break; }
    pts.push({ x: (bowX + 1.5) * VS, z: 0, k: 1 }, { x: (bowX + 0.5) * VS, z: 0.45, k: 1 }, { x: (bowX + 0.5) * VS, z: -0.45, k: 1 });
    pts.push({ x: (ctx.xs - 0.5) * VS, z: 0.3, k: 2 }, { x: (ctx.xs - 0.5) * VS, z: -0.3, k: 2 });
    return pts;
  }

  // A floating flag on a bit of wreckage (flag stays afloat after a sinking). Local origin = waterline centre.
  function flotsam(flag) {
    const b = GLT.voxel.builder({ size: VS });
    b.box(-3, -1, -2, 3, 0, 2, P.wood).box(-3, 0, -2, 3, 0, -2, P.woodL).box(-2, 0, 1, 2, 0, 1, P.woodMid);
    b.set(4, 0, 0, P.woodDark).set(-4, 0, 1, P.woodL);
    b.box(0, 1, 0, 0, 10, 0, P.woodDark);
    const geos = [addFlutter(solidGeo(b.build())), flagGeometry(flag, 0, 10)];
    geos[0].applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -VS / 2));
    const mesh = new THREE.Mesh(mergeShip(geos), shipMaterial());
    mesh.castShadow = true;
    mesh.name = 'ship-flotsam';
    return mesh;
  }

  // A big victory flag on its own pole (ceremony): Group { pole, cloth }. The cloth's origin is its hoist top, so
  // fleet3d raises it by animating cloth.position.y from the pole foot to the truck. 0.25 m flag voxels.
  function victoryFlag(flag, poleH) {
    const b = GLT.voxel.builder({ size: VS });
    const top = Math.round((poleH || 6) / VS);
    b.box(0, 0, 0, 0, top, 0, P.woodDark).set(0, top + 1, 0, P.gold).box(-1, 0, -1, 1, 0, 1, P.ink3);
    const pg = solidGeo(b.build());
    pg.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, -VS / 2));
    const pole = new THREE.Mesh(pg, GLT.voxel.material('solid'));
    pole.castShadow = true;
    const cg = flagGeometry(flag, 0, -1, 2);
    const cloth = new THREE.Mesh(mergeShip([cg]), shipMaterial());
    cloth.castShadow = true;
    const g = new THREE.Group();
    g.name = 'ship-victory-flag';
    g.add(pole, cloth);
    g.userData.top = (top + 1) * VS;
    g.gltCloth = cloth;
    return g;
  }

  // Thin iridescent oil slick (Polar Tang). radius in metres.
  function oilSlick(radius, seed) {
    const b = GLT.voxel.builder({ size: VS });
    const rng = RNG().create(seed || 7);
    const R = Math.round(radius / VS);
    const ph = [rng.next() * 6, rng.next() * 6, rng.next() * 6];
    const rim = ['#3c2670', '#255553', '#7856b6', '#367064', '#8a5c1a'];
    for (let x = -R - 4; x <= R + 4; x++) for (let z = -R; z <= R; z++) {
      const a = Math.atan2(z, x * 0.7);
      const rr = R * (0.8 + 0.12 * Math.sin(a * 3 + ph[0]) + 0.08 * Math.sin(a * 5 + ph[1]));
      const d = Math.sqrt(x * x * 0.55 + z * z);
      if (d > rr) continue;
      const edge = rr - d;
      b.set(x, 0, z, edge < 1.3 ? rim[(Math.abs(x * 3 + z * 7)) % rim.length] : (edge < 2.6 ? '#2c2640' : '#0a0912'));
    }
    const g = solidGeo(b.build({ ao: 0 }));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, -VS * 0.8, 0));
    const mesh = new THREE.Mesh(g, flatMaterial());
    mesh.name = 'ship-oil';
    mesh.receiveShadow = true;
    return mesh;
  }

  // ------------------------------------------------------------------ deck crew figures (0.125 m voxels)
  const CREW_KINDS = ['pirateA', 'pirateB', 'chef', 'heart', 'bear', 'marine'];
  const crewGeo = {};
  function crewGeometry(kind) {
    if (crewGeo[kind]) return crewGeo[kind];
    const b = GLT.voxel.builder({ size: FS });
    const body = (y0, y1, c) => b.box(0, y0, 0, 3, y1, 2, c);
    const head = (skin, hair) => { b.box(0, 9, 0, 3, 11, 2, skin); b.box(0, 12, 0, 3, 12, 2, hair); b.set(1, 10, 2, P.ink).set(2, 10, 2, P.ink); };
    const arms = (c, hand) => { b.box(-1, 6, 1, -1, 8, 1, c).box(4, 6, 1, 4, 8, 1, c); b.set(-1, 5, 1, hand).set(4, 5, 1, hand); };
    if (kind === 'pirateA') {
      body(0, 1, P.ink2); body(2, 4, P.blueD); body(5, 5, P.woodDark);
      for (let y = 6; y <= 8; y++) body(y, y, y % 2 ? P.red : P.white);
      arms(P.white, P.skin); head(P.skin, P.red); b.box(0, 12, 0, 0, 12, 2, P.redD);
    } else if (kind === 'pirateB') {
      body(0, 1, P.woodDeep); body(2, 4, P.woodXL); body(5, 8, P.white); b.box(0, 6, 2, 0, 8, 2, P.teal).box(3, 6, 2, 3, 8, 2, P.teal);
      arms(P.skinD, P.skinD); head(P.skin, P.ink2);
    } else if (kind === 'chef') {
      body(0, 1, P.ink2); body(2, 4, P.ink3); body(5, 8, P.white); b.set(1, 7, 2, P.cloudD).set(2, 7, 2, P.cloudD);
      arms(P.white, P.skin); head(P.skin, P.white); b.box(0, 13, 0, 3, 15, 2, P.white); b.box(-1, 15, 0, 4, 15, 2, P.white);
    } else if (kind === 'heart') {
      body(0, 0, P.ink2); body(1, 8, P.white); b.box(0, 5, 2, 3, 5, 2, P.cloudD);
      arms(P.white, P.skin); head(P.skin, P.ink2); b.box(0, 12, 3, 3, 12, 3, P.ink2);
    } else if (kind === 'marine') {   // Marine sailor: white uniform, blue collar and trousers, white cap
      body(0, 1, P.ink2); body(2, 4, P.blueD); body(5, 8, P.white); b.box(0, 8, 0, 3, 8, 2, P.blue);
      arms(P.white, P.skin); head(P.skin, P.white); b.box(0, 13, 0, 3, 13, 2, P.white).box(0, 12, 3, 3, 12, 3, P.blueD);
    } else {   // bear: Bepo-like, white fur in an orange boilersuit
      b.box(-1, 0, 0, 4, 1, 2, P.ink2); b.box(-1, 2, 0, 4, 8, 3, P.orange); b.box(-2, 5, 1, -2, 7, 2, P.orange).box(5, 5, 1, 5, 7, 2, P.orange);
      b.set(-2, 4, 1, P.white).set(5, 4, 1, P.white);
      b.box(-1, 9, 0, 4, 12, 3, P.white); b.set(-1, 13, 1, P.white).set(4, 13, 1, P.white);
      b.set(1, 11, 3, P.ink).set(3, 11, 3, P.ink).set(2, 10, 4, P.ink);
    }
    const g = solidGeo(b.build({ ao: 0.2 }));
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(-2 * FS, 0, -1.5 * FS));
    crewGeo[kind] = g;
    return g;
  }

  // ------------------------------------------------------------------ report (envelope check + triangle counts)
  function report() {
    const out = {};
    GLT.data.shipOrder.forEach((id) => {
      const m = build(id, { trim: '#e23b2e', pennant: '#e23b2e', crew: 'strawHat' });
      const env = GLT.layout.shipEnvelope(m.len);
      const halfLen = env.length / 2;
      out[id] = {
        length: +m.length.toFixed(3), beam: +m.beam.toFixed(3), height: +m.height.toFixed(3),
        minX: +m.bounds.min.x.toFixed(3), maxX: +m.bounds.max.x.toFixed(3), minZ: +m.bounds.min.z.toFixed(3), maxZ: +m.bounds.max.z.toFixed(3),
        envelope: env,
        fits: m.bounds.min.x >= -halfLen - 1e-6 && m.bounds.max.x <= halfLen + 1e-6 &&
          m.bounds.max.z - m.bounds.min.z <= env.beam + 1e-6 && Math.abs(m.bounds.min.z + m.bounds.max.z) < 0.26 && m.height <= env.height + 1e-6,
        triangles: m.triangles, voxels: m.voxels, crew: m.anchors.crew.length, muzzles: m.anchors.muzzles.length
      };
      GLT.voxel.dispose(m.group);
    });
    return out;
  }

  GLT.shipModels = {
    build,
    // additions (ships area)
    tick, setLift(v) { U.lift.value = +v || 0; }, setMark(v) { U.mark.value = +v || 0; }, solidMaterial, flotsam, victoryFlag, oilSlick, crewGeometry, report, shipMaterial, glowMaterial, flatMaterial,
    CREW_KINDS, VS, FS, RECIPES, P
  };

  // Convenience facade (task brief): GLT.ships.build(shipId, ownerCrew) -> THREE.Group sized to its cell length.
  // The owner shows only through hull trim + pennant. Animation (bob, damage, sinking) lives in GLT.fleet3d.
  GLT.ships = {
    build(shipId, ownerCrew) {
      const col = (GLT.data.crews[ownerCrew] || GLT.data.crews.strawHat).colors || {};
      const trim = col.trim || col.primary || '#e23b2e';
      const m = build(shipId, { trim, pennant: col.primary || trim, crew: ownerCrew });
      m.group.userData.model = m.id;
      return m.group;
    }
  };
})();
