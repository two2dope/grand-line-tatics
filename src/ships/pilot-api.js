/* GLT.shipsVoxel: the game's ship API (createShipMesh, createGhostShipMesh, updateShip, setShipDamage,
 * startShipSinking) on top of OUR voxel models (GLT.shipModels, ships/models.js). Area: ships.
 *
 * Scale: our models are built in metres for a 4 m cell (bow +X, waterline y = 0, centred). The game plate uses
 * `cellSize` units per cell, so every ship is scaled by k = cellSize / 4 and fills (len - 1/8) cells.
 * Every crew ship id maps to a model: the 7 canon ships use their own recipe; the thematic-fleet ships are variants
 * of a canon hull with a crew livery (hull/deck/sail recolour), the crew's flag, their own figurehead and, for the
 * small ones, a single mast. When a fleet asks for a length the hull was not built for (Red Force 4, the 5-cell
 * galleons, Nodachi), the hull is stretched along its keel only; deck crew, wake and wreckage stay unstretched.
 * Owner identity: hull trim + pennant (ownerColor); canon colours, sails, figureheads and flags never change.
 * Hierarchy: group (game sets position/rotation) > bob (heave/roll/pitch, sinking) > fit (k*stretch, k, k) > body,
 * plus crew (instanced per kind), wake foam (instanced), and wreckage (flag on flotsam, oil slick, bubbles), all
 * children of the group so removing the group removes everything. Draw calls per ship: 3 (hull+sails+flags merged,
 * glow, guns) + 1 per crew kind + 1 wake. Visual only: no Math.random (seeded GLT.shipRng), no rules. */
(function (root) {
  'use strict';
  const GLT = (root.GLT = root.GLT || {});

  const CELL = 4;                 // metres per cell in our models
  const DEG = Math.PI / 180;
  const BRACE = { h: -0.7, v: 0.7 };   // sail yaw so the canvas faces the default 45 deg camera
  const SINK_S = 3.6, DIVE_S = 3.2, BUBBLES = 40;
  const SHIP_LIFT = 0.06;          // a little self-light so hulls and sails stay legible on the darker seas (night)
  const RIG_SQUASH = 0.55;         // rig height above deck x0.55: front-row sails no longer cover the row behind
  const SHIP_MARK = 0;             // our post pass (src/render/renderer.js) reads material classes, no ship marker
  let liftSet = false;

  // ------------------------------------------------------------------ palette (hex, same values as models.js P)
  const C = {
    ink: '#1a1628', ink2: '#2c2640', ink3: '#463f5c', grey: '#6c6684', white: '#fffbf0',
    sailL: '#fff3da', sail: '#e8d8b2', sailD: '#c2ab88',
    woodDeep: '#2a1812', woodDark: '#47271a', woodMid: '#683a22', wood: '#8c542e', woodL: '#b2743e', woodXL: '#d49e5e',
    red: '#bc302e', redD: '#6a1424', gold: '#f4c443', brass: '#c48e26', goldD: '#8a5c1a',
    fire: '#d4441a', orange: '#f27620', amber: '#ffaa38', yellow: '#ffd86a',
    grass: '#557f34', grassD: '#356a33', grassL: '#7f9a3c',
    grey2: '#a29cb4', teal: '#367064', tealL: '#58967e', cloud: '#ccd2e8', cloudD: '#9aa2c2', slate: '#435068', iron: '#2f3e43', iron2: '#4f6266',
    blue: '#2d62c6', blueD: '#1a3d8a', blueL: '#5a90ea', skin: '#f2c8a0', purple: '#7856b6', purpleD: '#3c2670'
  };
  const map = (o) => { const m = {}; Object.keys(o).forEach((k) => { m[C[k].toLowerCase()] = o[k]; }); return m; };
  const NO_LAWN = { grass: C.woodL, grassD: C.wood, grassL: C.woodXL };

  // ------------------------------------------------------------------ crew liveries
  const LIVERY = {
    marine: {
      flag: 'marine', crewKinds: { pirateA: 'marine', pirateB: 'marine' },
      shell: map({ woodL: C.white, wood: C.cloud, woodXL: C.white, woodMid: C.blueD, woodDark: C.blueD, woodDeep: C.blueD,
        red: C.white, redD: C.cloud, ink2: C.blueD, brass: C.blue, sail: C.blue, sailL: C.white }),
      deck: map(NO_LAWN), all: map(NO_LAWN),
      sail: map({ sailL: C.white, sail: C.cloud, sailD: C.cloudD })
    },
    whitebeard: {
      flag: 'whitebeard',
      shell: map({ woodL: C.white, wood: C.sailL, woodXL: C.white, woodMid: C.cloud, woodDark: C.cloudD, red: C.white,
        redD: C.sailL, ink2: C.cloudD, brass: C.purpleD, sail: C.purpleD, sailL: C.white }),
      deck: map(NO_LAWN), all: map(NO_LAWN)
    },
    red: {
      flag: 'redHair',
      shell: map({ woodL: C.red, wood: C.redD, woodXL: C.red, woodMid: C.ink2, woodDark: C.ink2, sail: C.brass, sailL: C.red, brass: C.gold }),
      deck: map(NO_LAWN), all: map({ gold: C.red, brass: C.redD })
    },
    redAlt: { flag: 'redHair', sail: map({ sail: C.red, sailD: C.redD }) },     // Red Force hull, red-striped canvas
    heart: {
      flag: 'heart', crewKinds: { pirateA: 'heart', pirateB: 'heart' },
      shell: map({ woodL: C.yellow, wood: C.gold, woodXL: C.yellow, woodMid: C.brass, woodDark: C.brass, red: C.yellow,
        redD: C.gold, sail: C.ink2, sailL: C.yellow }),
      deck: map(NO_LAWN), all: map(NO_LAWN)
    },
    hospital: {
      flag: 'heart', crewKinds: { pirateA: 'heart', pirateB: 'heart' },
      shell: map({ woodL: C.white, wood: C.sailL, woodXL: C.white, woodMid: C.gold, woodDark: C.gold, sail: C.yellow, sailL: C.white }),
      deck: map(NO_LAWN), all: map(NO_LAWN)
    },
    bepo: {
      flag: 'heart', crewKinds: { pirateA: 'bear', pirateB: 'heart' },
      shell: map({ woodL: C.orange, wood: C.fire, woodXL: C.orange, woodMid: C.ink2, sail: C.white }),
      all: map({ sail: C.orange, sailL: C.white })
    },
    black: {
      flag: 'blackbeard',
      shell: map({ woodL: C.ink3, wood: C.ink2, woodXL: C.ink3, woodMid: C.ink, woodDark: C.ink, red: C.ink3, redD: C.ink2,
        ink2: C.ink, sail: C.purpleD, sailL: C.ink3, brass: C.goldD, gold: C.goldD, white: C.ink3, cloud: C.ink2 }),
      deck: map({ woodL: C.woodMid, wood: C.woodDark, woodXL: C.woodMid, grass: C.woodMid, grassD: C.woodDark, grassL: C.wood }),
      sail: map({ sailL: C.grey, sail: C.ink3, sailD: C.ink2 }),
      all: map({ gold: C.purple, brass: C.purpleD, grass: C.woodMid, grassD: C.woodDark, grassL: C.wood })
    },
    barto: {
      flag: 'strawHat',
      shell: map({ woodMid: C.grassD, woodDark: C.grassD, brass: C.gold, gold: C.yellow }),
      sail: map({ sail: C.grassL })
    },
    merry: { flag: 'strawHat', shell: map({ red: C.woodL, redD: C.wood, ink2: C.woodMid, brass: C.sail }), all: map({ red: C.woodL, redD: C.wood }) },
    shark: { flag: 'strawHat', towerCol: C.grey2, all: map({ yellow: C.grey2, gold: C.grey, brass: C.ink3, amber: C.white, goldD: C.ink2 }) },
    nodachi: { flag: 'heart', all: map({ yellow: C.orange, gold: C.fire, brass: C.redD, goldD: C.ink2 }) },
    capsule: { flag: 'heart', all: map({ yellow: C.white, gold: C.cloud, brass: C.cloudD, goldD: C.slate }) }
  };

  // ------------------------------------------------------------------ crew ship id -> model
  const V = (base, o) => Object.assign({ base }, o || {});
  const VARIANTS = {
    // the seven canon ships
    moby_dick: V('mobyDick'), thousand_sunny: V('thousandSunny'), oro_jackson: V('oroJackson'), red_force: V('redForce'),
    polar_tang: V('polarTang'), baratie: V('baratie'), going_merry: V('goingMerry'),
    // Chapéus de Palha
    barto_club: V('oroJackson', { livery: 'barto', fig: 'strawHead' }),
    mini_merry: V('redForce', { livery: 'merry', fig: 'sheep', oneMast: true }),
    shark_submerge: V('polarTang', { livery: 'shark', fig: 'shark' }),
    // Marinha
    marine_warship: V('oroJackson', { livery: 'marine', fig: 'gull' }),
    marine_battleship: V('thousandSunny', { livery: 'marine', fig: 'gull' }),
    marine_cruiser: V('redForce', { livery: 'marine', fig: 'gull' }),
    marine_cutter: V('redForce', { livery: 'marine', fig: 'anchor', oneMast: true }),
    marine_scout: V('goingMerry', { livery: 'marine', fig: 'gull', oneMast: true }),
    // Barba Branca
    whitebeard_whale_flag: V('thousandSunny', { livery: 'whitebeard', fig: 'phoenix' }),
    whitebeard_vanguard: V('redForce', { livery: 'whitebeard', fig: 'whale' }),
    whitebeard_corvette: V('redForce', { livery: 'whitebeard', fig: 'whale', oneMast: true }),
    whitebeard_skiff: V('goingMerry', { livery: 'whitebeard', fig: 'whale' }),
    // Cabelo Vermelho
    red_galleon: V('oroJackson', { livery: 'red' }),
    red_corvette: V('redForce', { livery: 'redAlt', fig: 'skull' }),
    red_cutter: V('redForce', { livery: 'redAlt', fig: 'anchor', oneMast: true }),
    red_skiff: V('goingMerry', { livery: 'red', fig: 'skull' }),
    // Piratas do Coração
    heart_nodachi: V('polarTang', { livery: 'nodachi' }),
    heart_hospital: V('thousandSunny', { livery: 'hospital', fig: 'cross' }),
    heart_capsule: V('polarTang', { livery: 'capsule', fig: 'capsuleCross' }),
    heart_bepo_boat: V('goingMerry', { livery: 'bepo', fig: 'bear', oneMast: true }),
    // Barba Negra
    blackbeard_colossal: V('oroJackson', { livery: 'black', fig: 'skull' }),
    saber_of_xebec: V('oroJackson', { livery: 'black' }),
    blackbeard_galley: V('redForce', { livery: 'black', fig: 'skull' }),
    blackbeard_corvette: V('redForce', { livery: 'black', fig: 'vortex', oneMast: true }),
    blackbeard_skiff: V('goingMerry', { livery: 'black', fig: 'skull' })
  };
  const CREW_LIVERY = { straw_hats: null, marines: 'marine', whitebeard: 'whitebeard', red_haired: 'red', heart: 'heart', blackbeard: 'black' };
  const BY_LEN = { 2: 'goingMerry', 3: 'redForce', 4: 'thousandSunny', 5: 'oroJackson' };

  const baseId = (id) => String(id || '').replace(/_alt$/, '');

  function rulesEntry(shipId, crewId) {
    const R = GLT.rules;
    if (!R) return null;
    const id = baseId(shipId);
    const TF = R.THEMATIC_FLEETS || {};
    let e = TF[crewId] ? TF[crewId].find((s) => s.id === id) : null;
    if (!e && R.SHIPS_MAP && R.SHIPS_MAP[id]) e = R.SHIPS_MAP[id];
    if (!e) Object.keys(TF).some((k) => (e = TF[k].find((s) => s.id === id)));
    return e || null;
  }

  // Unknown ids (future fleets) still get our voxels: a crew-livery hull chosen by length, never the pilot mesh.
  function variantFor(shipId, crewId, len) {
    const v = VARIANTS[baseId(shipId)];
    if (v) return v;
    const e = rulesEntry(shipId, crewId);
    const n = len || (e && e.length) || 3;
    if (e && e.isSubmarine) return V('polarTang', { livery: CREW_LIVERY[crewId] === 'heart' ? 'nodachi' : 'shark' });
    return V(BY_LEN[Math.max(2, Math.min(5, n))], { livery: CREW_LIVERY[crewId] || undefined, fig: 'skull' });
  }

  function getShipConfig(shipId, crewId) {
    const e = rulesEntry(shipId, crewId) || {};
    const v = variantFor(shipId, crewId, e.length);
    const L = e.length || (GLT.data && GLT.data.ships[v.base] ? GLT.data.ships[v.base].len : 3);
    return { id: shipId, crewId: e.crewId || crewId || 'straw_hats', length: L, isSubmarine: v.base === 'polarTang', model: v.base };
  }

  // ------------------------------------------------------------------ figureheads and rig edits (voxel units)
  const BOW = {
    goingMerry: { fx: 11, fy: 6, room: 3, clear: (x, y) => (x >= 9 && y >= 6 && y <= 12) || (x >= 12 && y >= 5) },
    thousandSunny: { fx: 25, fy: 9, room: 4, clear: (x, y) => x >= 26 || (x >= 25 && y >= 9) },
    redForce: { fx: 16, fy: 8, room: 5, clear: (x, y) => x >= 17 || (x >= 15 && y >= 8 && y <= 14) },
    oroJackson: { fx: 23, fy: 10, room: 6, clear: (x, y) => x >= 24 || (x >= 20 && y >= 10 && y <= 16) },
    polarTang: { fx: 22, fy: 2, room: 0, clear: null }
  };

  function clearBow(ctx, bow) {
    const kill = [];
    ctx.hull.forEach((x, y, z) => { if (bow.clear(x, y)) kill.push([x, y, z]); });
    kill.forEach((p) => ctx.hull.remove(p[0], p[1], p[2]));
  }

  // Outermost hull voxel at (x, y) on side s (+1/-1), or null.
  function sideZ(ctx, x, y, s) {
    for (let z = 7; z >= 0; z--) if (ctx.hull.get(x, y, z * s) != null) return z * s;
    return null;
  }

  const FIG = {
    sheep(c, x, y) {
      c.paintBox(x - 1, y, -2, x + 1, y + 3, 2, C.sailL).paintBox(x, y + 4, -1, x + 1, y + 4, 1, C.sailL);
      c.paintBox(x + 2, y, -1, x + 2, y + 2, 1, C.skin);
      c.paint(x + 2, y + 2, -1, C.ink).paint(x + 2, y + 2, 1, C.ink).paint(x + 2, y + 1, 0, C.ink);
      [[0, 3], [1, 4], [1, 2], [0, 2]].forEach((p) => { c.paint(x + p[0] - 1, y + p[1], 3, C.gold); c.paint(x + p[0] - 1, y + p[1], -3, C.gold); });
    },
    strawHead(c, x, y) {
      c.paintBox(x, y, -2, x + 3, y + 3, 2, C.skin).paintBox(x, y + 1, -2, x, y + 3, 2, C.ink2);
      c.paint(x + 3, y + 2, -1, C.ink).paint(x + 3, y + 2, 1, C.ink).paintBox(x + 3, y, -1, x + 3, y, 1, C.redD);
      c.paintBox(x - 1, y + 4, -3, x + 4, y + 4, 3, C.yellow).paintBox(x, y + 5, -2, x + 3, y + 6, 2, C.yellow);
      c.paintBox(x, y + 5, -2, x + 3, y + 5, 2, C.red);
    },
    gull(c, x, y) {
      c.paintBox(x, y, 0, x, y + 1, 0, C.woodDark);
      c.paintBox(x - 1, y + 2, -1, x + 2, y + 3, 1, C.white).paintBox(x + 2, y + 4, -1, x + 3, y + 5, 1, C.white);
      c.paint(x + 4, y + 4, 0, C.amber).paint(x + 3, y + 5, -1, C.ink).paint(x + 3, y + 5, 1, C.ink);
      c.paintBox(x + 2, y + 6, -1, x + 3, y + 6, 1, C.blue);
      [2, 3].forEach((s) => { c.paintBox(x - 1, y + 3, s, x + 1, y + 3 + (s - 2), s, C.cloud); c.paintBox(x - 1, y + 3, -s, x + 1, y + 3 + (s - 2), -s, C.cloud); });
      c.paint(x - 1, y + 5, 3, C.grey).paint(x - 1, y + 5, -3, C.grey);
    },
    whale(c, x, y) {
      c.paintBox(x - 1, y - 1, -2, x + 3, y + 2, 2, C.white).paintBox(x - 1, y - 1, -2, x + 3, y - 1, 2, C.cloud);
      c.paintBox(x + 2, y, -2, x + 3, y, 2, C.ink2).paintBox(x + 4, y, -1, x + 4, y + 1, 1, C.white);
      c.paint(x + 2, y + 1, 2, C.ink).paint(x + 2, y + 1, -2, C.ink).paint(x, y + 3, 0, C.ink2);
    },
    phoenix(c, x, y) {
      c.paintBox(x, y, -1, x + 2, y + 3, 1, C.blueL).paintBox(x + 3, y + 3, 0, x + 3, y + 4, 0, C.blue).paint(x + 4, y + 4, 0, C.yellow);
      c.paint(x + 2, y + 5, 0, C.yellow).paint(x + 3, y + 5, 0, C.amber);
      [2, -2].forEach((z) => { c.paintBox(x - 1, y + 3, z, x + 1, y + 5, z, C.blue); c.paint(x - 2, y + 6, z + Math.sign(z), C.yellow).paint(x - 1, y + 6, z, C.amber); });
    },
    skull(c, x, y) {
      c.paintBox(x, y, -2, x + 3, y + 3, 2, C.white).paintBox(x, y - 1, -1, x + 3, y - 1, 1, C.white);
      c.paint(x + 3, y + 2, -1, C.ink).paint(x + 3, y + 2, 1, C.ink).paint(x + 3, y + 1, 0, C.ink).paint(x + 3, y - 1, 0, C.ink);
      [3, -3].forEach((z) => { c.paint(x - 1, y - 1, z, C.white).paint(x, y, z, C.white).paint(x + 2, y + 2, z, C.white).paint(x + 3, y + 3, z, C.white).paint(x + 3, y - 1, z, C.white).paint(x - 1, y + 3, z, C.white); });
    },
    cross(c, x, y) {
      c.paintBox(x, y, -2, x + 1, y + 4, 2, C.white);
      c.paintBox(x + 1, y + 1, 0, x + 1, y + 3, 0, C.red).paintBox(x + 1, y + 2, -1, x + 1, y + 2, 1, C.red);
      [2, -2].forEach((z) => c.paintBox(x, y + 1, z, x + 1, y + 3, z, C.red));
    },
    bear(c, x, y) {
      c.paintBox(x, y - 1, -2, x + 3, y - 1, 2, C.orange);
      c.paintBox(x, y, -2, x + 3, y + 3, 2, C.white).paint(x + 1, y + 4, 2, C.white).paint(x + 1, y + 4, -2, C.white);
      c.paintBox(x + 4, y, -1, x + 4, y + 1, 1, C.cloud).paint(x + 4, y + 1, 0, C.ink);
      c.paint(x + 3, y + 2, -1, C.ink).paint(x + 3, y + 2, 1, C.ink);
    },
    vortex(c, x, y) {
      c.paintBox(x, y, -2, x + 1, y + 4, 2, C.ink2);
      [[0, 2], [0, 3], [1, 3], [1, 2], [1, 1], [0, 1], [-1, 1], [-1, 2], [-1, 3], [-1, 4], [0, 4], [1, 4], [2, 4]]
        .forEach((p) => { c.paint(x + 1, y + p[1] - 0, p[0], C.purple); });
      c.paint(x + 1, y + 2, 0, C.ink);
    },
    anchor(c, x, y) {
      c.paintBox(x + 1, y, 0, x + 1, y + 4, 0, C.iron2).paintBox(x + 1, y + 4, -2, x + 1, y + 4, 2, C.iron2);
      c.paintBox(x + 1, y, -2, x + 1, y, 2, C.iron2).paint(x + 1, y + 1, -2, C.iron2).paint(x + 1, y + 1, 2, C.iron2);
      c.paint(x + 1, y + 5, 0, C.brass).paintBox(x, y, 0, x, y + 1, 0, C.woodDark);
    },
    // submarines: paint over the round hull (no clearing)
    shark(c, x, y, col) {
      for (let i = 0; i <= 4; i++) for (let yy = 7; yy <= 11 - i; yy++) c.paint(6 + i, yy, 0, C.slate);
      for (let xx = 16; xx <= 21; xx++) [1, -1].forEach((s) => {
        const z = sideZ(c, xx, 0, s);
        if (z != null) c.paint(xx, 0, z, (xx % 2) ? C.white : C.ink2);
      });
      [1, -1].forEach((s) => { const z = sideZ(c, 16, 3, s); if (z != null) c.paint(16, 3, z, C.ink).paint(17, 3, z, C.white); });
      tower(c, col || C.blueL);
    },
    capsuleCross(c, x, y, col) {
      tower(c, col || C.white);
      [2, -2].forEach((z) => { c.paintBox(0, 8, z, 0, 12, z, C.red).paintBox(-2, 10, z, 2, 10, z, C.red); });
    }
  };
  // Repaint the Polar Tang smiley on the conning tower (sub variants carry their own crew identity).
  function tower(c, col) {
    for (let x = -3; x <= 3; x++) for (let y = 7; y <= 13; y++) [2, -2].forEach((z) => { if (c.hull.get(x, y, z) != null) c.paint(x, y, z, col); });
  }

  // Keep the tallest mast; drop the shortest one with its sails, flags, yards and the rigging nearest to it.
  function dropMast(ctx) {
    if (ctx.masts.length < 2) return;
    const h = (m) => m.y1 - m.y0;
    const drop = ctx.masts.reduce((a, b) => (h(b) < h(a) ? b : a));
    const keep = ctx.masts.reduce((a, b) => (h(b) > h(a) ? b : a));
    const rig = new Set([parseInt(C.woodDeep.slice(1), 16), parseInt(C.woodDark.slice(1), 16), parseInt(C.blueD.slice(1), 16), parseInt(C.ink.slice(1), 16), parseInt(C.cloudD.slice(1), 16)]);
    const kill = [];
    ctx.hull.forEach((x, y, z, hex) => {
      const deck = ctx.deckAt ? ctx.deckAt(x) : null;
      if (deck == null || y <= deck + 1) return;
      if (x === drop.x && z === 0 && y <= drop.y1) { kill.push([x, y, z]); return; }
      if (rig.has(hex) && Math.abs(x - drop.x) < Math.abs(x - keep.x) && !(x === keep.x && z === 0)) kill.push([x, y, z]);
    });
    kill.forEach((p) => ctx.hull.remove(p[0], p[1], p[2]));
    ctx.sails = ctx.sails.filter((s) => s.x !== drop.x);
    ctx.flags = ctx.flags.filter((f) => f.x !== drop.x);
    const keepHasPennant = ctx.pennants.some((p) => p.x === keep.x);
    ctx.pennants = ctx.pennants.filter((p) => p.x !== drop.x || !keepHasPennant).map((p) => (p.x === drop.x ? { x: keep.x, yTop: keep.y1 } : p));
    ctx.masts = ctx.masts.filter((m) => m !== drop);
  }

  function postFor(v) {
    if (!v.fig && !v.oneMast) return null;
    return function (ctx) {
      if (v.oneMast) dropMast(ctx);
      const bow = BOW[v.base];
      if (!v.fig || !bow) return;
      if (bow.clear) {
        clearBow(ctx, bow);
        ctx.line(bow.fx, bow.fy, 0, bow.fx + Math.min(4, bow.room), bow.fy + 4, 0, C.woodDark);  // short bowsprit
      }
      const lv = v.livery && LIVERY[v.livery];
      FIG[v.fig](ctx, bow.fx, bow.fy, lv && lv.towerCol);
    };
  }

  // ------------------------------------------------------------------ model build / template cache
  const tplCache = new Map();
  const toHex = (n) => (typeof n === 'number' && isFinite(n) ? '#' + ('000000' + (n >>> 0).toString(16)).slice(-6) : (typeof n === 'string' && /^#[0-9a-f]{6}$/i.test(n) ? n : null));

  function modelOptions(v, trim, brace, damage) {
    const lv = (v.livery && LIVERY[v.livery]) || {};
    return {
      trim, pennant: trim, pennant2: '#fffbf0', brace, damage, damageFace: 1, rigSquash: RIG_SQUASH,
      flag: lv.flag, recolor: lv.all, shell: lv.shell, deck: lv.deck, sail: lv.sail, crewKinds: lv.crewKinds,
      post: postFor(v)
    };
  }

  function template(vid, v, trim, brace) {
    const key = vid + '|' + trim + '|' + brace;
    let m = tplCache.get(key);
    if (!m) { m = GLT.shipModels.build(v.base, modelOptions(v, trim, brace)); tplCache.set(key, m); }
    return m;
  }

  // ------------------------------------------------------------------ shared materials / geometry
  let ghostMat = null, foamMat = null, foamGeo = null, bubbleMat = null, bubbleGeo = null;
  function ghostMaterial() {
    if (!ghostMat) {
      ghostMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x9cc2e6, emissive: 0x0c2244, transparent: true, opacity: 0.74, depthWrite: false });
      ghostMat.userData.gltShared = true;
    }
    return ghostMat;
  }
  function foam() {
    if (!foamMat) {
      foamMat = new THREE.MeshLambertMaterial({ color: 0xdcf2ea });
      foamGeo = new THREE.BoxGeometry(0.5, 0.07, 0.5);
    }
    return { mat: foamMat, geo: foamGeo };
  }
  function bubbles() {
    if (!bubbleMat) {
      bubbleMat = new THREE.MeshLambertMaterial({ color: 0x9cd2cc });
      bubbleGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    }
    return { mat: bubbleMat, geo: bubbleGeo };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeIn = (x) => Math.pow(clamp(x, 0, 1), 3);
  const easeInOut = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  // ------------------------------------------------------------------ instance parts
  function attachBody(S, model, own) {
    if (S.body) {
      S.fit.remove(S.body);
      if (S.own) S.body.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const body = own ? model.group : model.group.clone();
    if (S.ghost) {
      const gm = ghostMaterial();
      body.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; } });
    } else {
      const guns = body.getObjectByName('ship-guns');
      if (guns) guns.material = GLT.shipModels.solidMaterial();
    }
    S.fit.add(body);
    S.body = body;
    S.model = model;
    S.own = !!own;
    S.guns = body.getObjectByName('ship-guns') || null;
  }

  function buildCrew(S) {
    const groups = {};
    S.model.anchors.crew.forEach((a, i) => { (groups[a.kind] = groups[a.kind] || []).push(i); });
    S.crew = [];
    const mat = GLT.shipModels.solidMaterial();
    Object.keys(groups).forEach((kind) => {
      const idx = groups[kind];
      const m = new THREE.InstancedMesh(GLT.shipModels.crewGeometry(kind), mat, idx.length);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true; m.receiveShadow = true;
      m.name = 'ship-crew-' + kind;
      S.crewRoot.add(m);
      S.crew.push({ mesh: m, idx });
    });
  }

  function buildWake(S) {
    const f = foam();
    const n = S.model.wake.length;
    const m = new THREE.InstancedMesh(f.geo, f.mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.name = 'ship-wake';
    S.wakeRoot.add(m);
    S.wake = m;
  }

  // ------------------------------------------------------------------ public: create
  function createShipMesh(shipId, options) {
    options = options || {};
    if (typeof THREE === 'undefined' || !GLT.shipModels) return { id: shipId, isMock: true, options };
    if (!liftSet) { GLT.shipModels.setLift(SHIP_LIFT); GLT.shipModels.setMark(SHIP_MARK); liftSet = true; }
    const crewId = options.crewId || (rulesEntry(shipId) || {}).crewId || 'straw_hats';
    const cfg = getShipConfig(shipId, crewId);
    const len = options.length || cfg.length;
    const v = variantFor(shipId, crewId, len);
    const vid = VARIANTS[baseId(shipId)] ? baseId(shipId) : 'auto:' + v.base + ':' + (v.livery || '') + ':' + (v.fig || '');
    const cellSize = options.cellSize || 1;
    const isGhost = !!options.isGhost;
    const crewDef = GLT.rules && GLT.rules.CREWS_MAP && GLT.rules.CREWS_MAP[crewId];
    const trim = toHex(options.ownerColor) || (crewDef && toHex(crewDef.colors.primary)) || '#e23b2e';
    const horizontal = options.horizontal !== false;
    const brace = horizontal ? BRACE.h : BRACE.v;
    const modelLen = GLT.data.ships[v.base].len;
    const k = cellSize / CELL;
    const stretch = len / modelLen;
    const isSub = v.base === 'polarTang';

    const group = new THREE.Group();
    group.name = 'ship_' + shipId;
    group.userData = {
      shipId, crewId, length: len, cellSize, ownerColor: options.ownerColor, isGhost, isSubmarine: isSub,
      model: v.base, damageMask: [], sinking: null, cannonAnim: { side: null, t: 0, active: false }, cheering: 0, basePosY: 0, hasGlb: false
    };
    const bob = new THREE.Group(); bob.name = 'ship-bob';
    const fit = new THREE.Group(); fit.name = 'ship-fit';
    fit.scale.set(k * stretch, k, k);
    const crewRoot = new THREE.Group(); crewRoot.name = 'deckCrewGroup';
    crewRoot.scale.set(k, k, k);
    bob.add(fit, crewRoot);
    const wakeRoot = new THREE.Group(); wakeRoot.name = 'wakeFoamGroup';
    wakeRoot.scale.set(k, k, k);
    const fx = new THREE.Group(); fx.name = 'ship-wreckage';
    fx.scale.set(k, k, k);
    group.add(bob, wakeRoot, fx);

    const rng = GLT.shipRng.create(GLT.shipRng.hashString(shipId + ':' + crewId + ':' + (isGhost ? 'g' : 's')));
    const S = {
      vid, v, trim, brace, k, stretch, len, isSub, ghost: false, bob, fit, crewRoot, wakeRoot, fx,
      body: null, model: null, own: false, guns: null, crew: [], wake: null, segs: [],
      rng, phase: rng.next() * 6.28, side: rng.chance(0.5) ? 1 : -1,
      faces: null, recoilT: -99, panicT: -99, sinkT0: null, kind: isSub ? 'dive' : 'sink',
      flotsam: null, slick: null, bubbles: null, pool: null, ghostBody: null
    };
    group.gltShip = S;
    attachBody(S, template(vid, v, trim, brace), false);
    S.faces = S.model.anchors.crew.map(() => rng.next() * 6.28);
    buildCrew(S);
    buildWake(S);

    if (isGhost) {
      // Revealed enemy wreck: the real ship sinks first, then its translucent outline stays on the plate.
      const ghost = template(vid, v, trim, brace).group.clone();
      const gm = ghostMaterial();
      ghost.traverse((o) => { if (o.isMesh) { o.material = gm; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; } });
      ghost.scale.set(k * stretch, k, k);
      ghost.visible = false;
      ghost.name = 'ship-ghost-outline';
      group.add(ghost);
      S.ghostBody = ghost;
      startShipSinking(group);
    }

    group.fireCannon = function (side, onFired) {
      group.userData.cannonAnim.side = side || 'port';
      group.userData.cannonAnim.t = 0;
      group.userData.cannonAnim.active = true;
      S.recoilT = null;   // stamped with the frame time on the next update
      if (typeof onFired === 'function') onFired();
    };
    group.setDamage = function (hits) { setShipDamage(group, hits); };
    group.startSinking = function (onComplete) { startShipSinking(group, onComplete); };
    return group;
  }

  function createGhostShipMesh(shipId, options) {
    return createShipMesh(shipId, Object.assign({}, options || {}, { isGhost: true }));
  }

  // ------------------------------------------------------------------ public: damage
  // hitIndices are positions in the ship's cell list (sorted by row/column). They become model segments counted
  // from the stern, taking the group's yaw into account (the game turns vertical ships by +90 deg: bow to row 0).
  function setShipDamage(group, hitIndices) {
    const S = group && group.gltShip;
    if (!S) return;
    const u = group.userData;
    const yaw = group.rotation.y || 0;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const horizontal = Math.abs(cs) >= Math.abs(sn);
    const flipped = horizontal ? cs < 0 : sn > 0;
    const modelLen = GLT.data.ships[S.v.base].len;
    const segs = [];
    (hitIndices || []).forEach((i) => {
      if (typeof i !== 'number' || i < 0 || i >= S.len) return;
      const along = flipped ? S.len - 1 - i : i;
      const seg = Math.min(modelLen - 1, Math.floor(((along + 0.5) * modelLen) / S.len));
      if (segs.indexOf(seg) < 0) segs.push(seg);
    });
    segs.sort((a, b) => a - b);
    u.damageMask = (hitIndices || []).slice();
    if (segs.join(',') === S.segs.join(',')) return;
    const fresh = segs.some((s) => S.segs.indexOf(s) < 0);
    S.segs = segs;
    const model = segs.length
      ? GLT.shipModels.build(S.v.base, modelOptions(S.v, S.trim, S.brace, segs))
      : template(S.vid, S.v, S.trim, S.brace);
    attachBody(S, model, segs.length > 0);
    if (fresh) S.panicT = null;   // stamped on the next update
  }

  // ------------------------------------------------------------------ public: sinking
  function startShipSinking(group, onComplete) {
    const S = group && group.gltShip;
    if (!S) return;
    const u = group.userData;
    if (u.sinking && u.sinking.active) return;
    u.sinking = { progress: 0, duration: S.isSub ? DIVE_S : SINK_S, onComplete: onComplete || null, active: true };
    S.sinkT0 = null;
    if (!S.bubbles) {
      const b = bubbles();
      S.bubbles = new THREE.InstancedMesh(b.geo, b.mat, BUBBLES);
      S.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      S.bubbles.count = 0;
      S.bubbles.frustumCulled = false;
      S.bubbles.name = 'ship-bubbles';
      S.fx.add(S.bubbles);
      S.pool = [];
      for (let i = 0; i < BUBBLES; i++) S.pool.push({ on: false, x: 0, y: 0, z: 0, vy: 0, age: 0, life: 1, s: 1 });
    }
  }

  function spawnFlotsam(S) {
    const flag = S.model.flagId || 'strawHat';
    const m = GLT.shipModels.flotsam(flag);
    m.castShadow = false;
    S.flotsam = { mesh: m, x: S.len * CELL * 0.18 * S.side, t0: null };
    S.fx.add(m);
  }

  function spawnSlick(S) {
    const m = GLT.shipModels.oilSlick(S.len * CELL * 0.3, GLT.shipRng.hashString(S.vid + S.trim));
    m.scale.set(0.15, 1, 0.15);
    S.slick = { mesh: m, t0: null };
    S.fx.add(m);
  }

  function emitBubble(S, big) {
    const wk = S.model.wake;
    if (!wk.length) return;
    const w = wk[S.rng.int(wk.length)];
    for (const b of S.pool) {
      if (b.on) continue;
      b.on = true;
      b.x = (w.x * 0.8 + (S.rng.next() - 0.5)) * S.stretch;
      b.z = w.z * (0.4 + S.rng.next() * 0.9);
      b.y = -0.35;
      b.vy = 0.5 + S.rng.next() * 0.6; b.age = 0; b.life = 0.7 + S.rng.next() * 0.7; b.s = (big ? 1.6 : 0.8) + S.rng.next() * 0.7;
      return;
    }
  }

  // ------------------------------------------------------------------ per frame
  const _o = { m: null, d: null };
  function dummy() { if (!_o.d) _o.d = new THREE.Object3D(); return _o.d; }

  function updateShip(group, dt, time) {
    const S = group && group.gltShip;
    if (!S) return;
    const u = group.userData;
    const t = time || 0;
    dt = dt || 0;
    GLT.shipModels.tick(t, 0.6);
    if (S.recoilT === null) S.recoilT = t;
    if (S.panicT === null) S.panicT = t;
    const d = dummy();

    // swell (metres, then * k)
    const ph = t * 1.8 + group.position.x * 0.25 + group.position.z * 0.25 + S.phase * 0.2;
    let heave = 0.13 * Math.sin(ph) + 0.05 * Math.sin(ph * 1.7 + S.phase);
    let roll = clamp(0.024 * Math.sin(t * 0.95 + S.phase) + 0.012 * Math.sin(t * 1.7 + S.phase * 2), -3 * DEG, 3 * DEG);
    let pitch = clamp(0.03 * Math.cos(ph * 0.9), -2 * DEG, 2 * DEG);
    const rk = t - S.recoilT;
    if (rk >= 0 && rk < 0.6) roll += -0.03 * Math.sin(rk * 10) * Math.exp(-rk * 5) * (u.cannonAnim.side === 'starboard' ? 1 : -1);
    let dx = 0;

    const sk = u.sinking;
    if (sk && sk.active) {
      if (S.sinkT0 == null) S.sinkT0 = t;
      const tau = t - S.sinkT0;
      sk.progress = clamp(tau / sk.duration, 0, 1);
      if (S.kind === 'dive') {
        pitch = -10 * DEG * easeInOut(tau / 0.9);
        roll *= 1 - clamp(tau, 0, 1);
        heave -= 4.6 * easeInOut((tau - 0.15) / 2.7);
        dx = 1.1 * easeInOut(tau / 2.9);
        if (tau > 0.35 && !S.slick) spawnSlick(S);
        if (tau > 1.5 && !S.flotsam) spawnFlotsam(S);
        if (dt > 0 && tau < 2.9 && S.rng.chance(Math.min(1, dt * 14))) emitBubble(S, true);
      } else {
        roll = S.side * 17 * DEG * easeOut(tau / 1.0) + 0.3 * roll;
        pitch = 11 * DEG * easeOut(tau / 1.4);
        heave -= (S.model.height + 1.2) * easeIn((tau - 0.3) / 3.0);
        if (tau > 0.85 && !S.flotsam) spawnFlotsam(S);
        if (dt > 0 && tau < 3.3 && S.rng.chance(Math.min(1, dt * 30))) emitBubble(S, false);
      }
      if (tau >= sk.duration) {
        sk.active = false;
        sk.progress = 1;
        S.bob.visible = false;
        S.wakeRoot.visible = false;
        if (S.ghostBody) S.ghostBody.visible = true;
        if (!S.flotsam) spawnFlotsam(S);
        if (S.kind === 'dive' && !S.slick) spawnSlick(S);
        if (typeof sk.onComplete === 'function') sk.onComplete();
      }
    }

    const sunkOrSinking = !!sk;
    if (S.bob.visible) {
      S.bob.position.set(dx * S.k, heave * S.k, 0);
      S.bob.rotation.set(roll, 0, pitch);
      if (S.guns) S.guns.scale.z = rk >= 0 && rk < 0.5 ? 1 - 0.13 * Math.sin(Math.min(1, rk / 0.5) * Math.PI) * (rk < 0.08 ? rk / 0.08 : 1) : 1;
      // deck crew (hidden on the revealed enemy wreck)
      const cheer = u.cheering > 0, panic = t - S.panicT < 1.6;
      if (cheer) u.cheering = Math.max(0, u.cheering - dt);
      const anchors = S.model.anchors.crew;
      S.crew.forEach((g) => {
        g.mesh.visible = !sunkOrSinking;
        if (sunkOrSinking) return;
        g.idx.forEach((ai, j) => {
          const a = anchors[ai];
          let jy = 0, face = S.faces[ai] + 0.35 * Math.sin(t * 0.5 + ai * 1.9);
          if (cheer) jy = Math.abs(Math.sin(t * 9 + ai * 1.3)) * 0.32;
          else if (panic) { jy = Math.abs(Math.sin((t - S.panicT) * 14 + ai)) * 0.12; face += Math.sin(t * 13 + ai) * 0.8; }
          else jy = Math.max(0, Math.sin(t * 1.3 + ai * 2.1 + S.phase)) * 0.03;
          d.position.set(a.x * S.stretch, a.y + jy, a.z);
          d.rotation.set(0, face, 0);
          d.scale.set(1, 1, 1);
          d.updateMatrix();
          g.mesh.setMatrixAt(j, d.matrix);
        });
        g.mesh.instanceMatrix.needsUpdate = true;
      });
    }

    // wake / waterline foam (follows heave, not roll)
    if (S.wake && S.wakeRoot.visible) {
      const wk = S.model.wake;
      let n = 0;
      for (let i = 0; i < wk.length; i++) {
        const w = wk[i];
        const p2 = t * 2.2 + i * 1.7 + S.phase;
        let x = w.x * S.stretch, z = w.z, s = 0.55 + 0.3 * Math.sin(p2);
        if (w.k === 1) { x += 0.15 + 0.2 * Math.sin(p2 * 0.7); s = 0.9 + 0.25 * Math.sin(p2); }
        else if (w.k === 2) { const f = ((t * 0.45 + i * 0.37) % 1); x -= f * 1.6; z *= 1 + f * 1.5; s = 0.9 * (1 - f); }
        else z += Math.sign(z) * (0.08 + 0.08 * Math.sin(p2));
        if (s <= 0.05) continue;
        if (sk) s *= 1 - clamp((t - (S.sinkT0 || t)) / 1.5, 0, 1);
        d.position.set(x, heave + 0.06, z);
        d.rotation.set(0, 0, 0);
        d.scale.set(s, 1, s);
        d.updateMatrix();
        S.wake.setMatrixAt(n++, d.matrix);
      }
      S.wake.count = n;
      S.wake.instanceMatrix.needsUpdate = true;
    }

    // wreckage: flag on flotsam, oil slick, bubbles
    if (S.flotsam) {
      const F = S.flotsam;
      if (F.t0 == null) F.t0 = t;
      const pop = easeOut((t - F.t0) / 0.8);
      F.mesh.position.set(F.x + 0.3 * Math.sin(t * 0.3 + S.phase), 0.13 * Math.sin(ph) - 0.6 * (1 - pop), 0.3 * Math.cos(t * 0.27 + S.phase));
      F.mesh.rotation.set(0.07 * Math.sin(t * 1.2 + S.phase), S.side * 0.5 + 0.15 * Math.sin(t * 0.2 + S.phase), 0.06 * Math.sin(t * 0.9 + S.phase * 2));
    }
    if (S.slick) {
      if (S.slick.t0 == null) S.slick.t0 = t;
      const g = 0.15 + 0.85 * easeOut((t - S.slick.t0) / 2.6);
      S.slick.mesh.scale.set(g, 1, g);
      S.slick.mesh.position.y = 0.3;
    }
    if (S.bubbles) {
      let n = 0;
      for (const b of S.pool) {
        if (!b.on) continue;
        b.age += dt;
        if (b.age >= b.life) { b.on = false; continue; }
        b.y += b.vy * dt;
        const kk = b.age / b.life;
        const s = b.s * (kk < 0.75 ? 0.5 + kk : Math.max(0.05, (1 - kk) * 5));
        d.position.set(b.x + Math.sin(b.age * 7 + b.s * 9) * 0.06, b.y, b.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(s, s, s);
        d.updateMatrix();
        S.bubbles.setMatrixAt(n++, d.matrix);
      }
      S.bubbles.count = n;
      S.bubbles.visible = n > 0;
      S.bubbles.instanceMatrix.needsUpdate = true;
    }
    if (S.ghostBody && S.ghostBody.visible) {
      S.ghostBody.position.y = (0.13 * Math.sin(ph) - 0.25) * S.k;
      S.ghostBody.rotation.set(roll * 0.5, 0, pitch * 0.5);
    }
    if (u.cannonAnim.active) { u.cannonAnim.t += dt * 4; if (u.cannonAnim.t >= 1) u.cannonAnim.active = false; }
  }

  function getJollyRogerTexture(shipId, crewId) {
    const v = variantFor(shipId, crewId);
    const lv = (v.livery && LIVERY[v.livery]) || {};
    return GLT.flags.texture(lv.flag || GLT.data.ships[v.base].flag);
  }

  GLT.shipsVoxel = {
    SHIPS_VOXEL_CONFIG: VARIANTS,
    LIVERY,
    getShipConfig,
    variantFor,
    createShipMesh,
    createGhostShipMesh,
    setShipDamage,
    startShipSinking,
    updateShip,
    getJollyRogerTexture
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
