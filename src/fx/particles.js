/* GLT.particles: pooled instanced voxel particles (smoke, fire, sparks, splash, bubbles, planks, oil, foam, confetti,
 * rain, plus fx-internal kinds: flash, star, trail, ember, ring, mist, glitter). Area: fx. Contract: ARCHITECTURE.md §11.3.
 *
 * Three banks, one InstancedMesh each (3 draw calls whatever the load):
 *   glow  MeshBasic, outline class 'glow'  : fire, sparks, flashes, fireworks stars (bright at night, never graded)
 *   solid MeshLambert, outline class 'full': planks, debris, water droplets, confetti, cannon smoke in daylight
 *   soft  MeshLambert, outline class 'none': smoke, foam, mist, oil, rain (no outline noise on big soft shapes)
 * Storage is structure-of-arrays (typed arrays) per bank; dead particles are swap-removed so the instance count is
 * always the live count, and only that range is uploaded. The update loop allocates nothing.
 * Colour is a stepped ramp (pixel-art: no smooth fades), optionally multiplied by a per-particle tint and pushed toward
 * white by the ramp's 4th channel (white-hot starts for tinted fireworks). Particles vanish by shrinking, never alpha.
 * Cosmetic randomness comes from a seeded GLT.rng, so frozen ?t= demos are reproducible. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  // ---- ramps: [r,g,b,white] per step, from hex ----
  function hx(h, w) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, w || 0]; }
  const RAMP_DEFS = {
    fire:     [hx(0xffe35a), hx(0xffc23a), hx(0xff9a26), hx(0xff6a1e), hx(0xd8381e), hx(0x9a2230)],
    fireHot:  [hx(0xffffff), hx(0xffe35a), hx(0xffb02a), hx(0xff8a22), hx(0xff5a1e), hx(0xc8301e)],
    flash:    [hx(0xffffff), hx(0xfffbe0), hx(0xffe680), hx(0xffb43a)],
    spark:    [hx(0xffffff), hx(0xfff2a0), hx(0xffc24a), hx(0xff8a2a), hx(0xd04a22)],
    ember:    [hx(0xffd25a), hx(0xff9a2a), hx(0xe0582a), hx(0x8a2a3a)],
    smoke:    [hx(0xf2ece4), hx(0xd6cfd2), hx(0xb4abb8), hx(0x948aa0), hx(0x766c86), hx(0x5c5470)],
    smokeDark:[hx(0x6a5660), hx(0x55465a), hx(0x463c52), hx(0x3a3348), hx(0x2e2a3e), hx(0x26233a)],
    smokeFire:[hx(0xff9a3a), hx(0xb8706a), hx(0x8a7484), hx(0x6e6278), hx(0x5a5068), hx(0x4a4460)],
    water:    [hx(0xffffff), hx(0xeafcff), hx(0xbfeaf8), hx(0x8fd0ec), hx(0x5aa8d8)],
    foam:     [hx(0xffffff), hx(0xf0fbff), hx(0xd2eef8), hx(0xaedcee)],
    mist:     [hx(0xffffff), hx(0xe6f6fc), hx(0xc8e6f2)],
    wood:     [hx(0xb07a46), hx(0x9a6438), hx(0x7a4a2c)],
    woodDark: [hx(0x6a4028), hx(0x553222), hx(0x40261c)],
    iron:     [hx(0x4a4656), hx(0x3a3646), hx(0x2c2838)],
    bubble:   [hx(0xffffff), hx(0xd8f6ff), hx(0xa8e4f8)],
    oil:      [hx(0x2a2436), hx(0x231e30), hx(0x1c1828), hx(0x241e34)],
    rain:     [hx(0xcfe6f2), hx(0xb6d4e8)],
    // tinted (multiplied by the particle tint; w pushes toward white)
    star:     [hx(0xffffff, 1), hx(0xffffff, 0), hx(0xffffff, 0), hx(0xffffff, 0), hx(0xcccccc, 0), hx(0x8c8c8c, 0)],
    tint:     [hx(0xffffff, 0)],
    tintFade: [hx(0xffffff, 0.35), hx(0xffffff, 0), hx(0xffffff, 0), hx(0xc0c0c0, 0)],
    glitter:  [hx(0xffffff, 1), hx(0xfff2c0, 0), hx(0xffd870, 0), hx(0xffb040, 0)]
  };
  const RAMP_NAMES = Object.keys(RAMP_DEFS);
  const RAMP_ID = {};
  let RAMP_OFF = null, RAMP_LEN = null, RAMP_DATA = null;
  function compileRamps() {
    if (RAMP_DATA) return;
    let total = 0;
    RAMP_NAMES.forEach((n) => { total += RAMP_DEFS[n].length; });
    RAMP_DATA = new Float32Array(total * 4);
    RAMP_OFF = new Uint16Array(RAMP_NAMES.length);
    RAMP_LEN = new Uint8Array(RAMP_NAMES.length);
    let o = 0;
    RAMP_NAMES.forEach((n, i) => {
      RAMP_ID[n] = i; RAMP_OFF[i] = o; RAMP_LEN[i] = RAMP_DEFS[n].length;
      RAMP_DEFS[n].forEach((c) => { RAMP_DATA.set(c, o * 4); o++; });
    });
  }

  // ---- presets ----
  // bank, ramp, life [a,b], size [a,b], end (s1 = s0*end), curve (0 lin, 1 pop, 2 hold, 3 flash), shape [x,y,z],
  // speed [a,b] (random direction speed), up [a,b] (added vertical), mode ('ring'|'sphere'|'cone'|'flat'|'column'),
  // grav (m/s², negative = buoyant), drag (1/s), floor (0 none, 1 die, 2 float, 3 die above floor+ceil), spin [a,b] rad/s,
  // jitter (m position noise), flick (0..1 twinkle), wob (m/s lateral wobble), wind (0..1)
  const P = {
    fire:     { bank: 0, ramp: 'fire', life: [0.42, 0.8], size: [0.85, 1.35], end: 0.2, curve: 0, shape: [1, 1, 1], speed: [0.4, 1.4], up: [3, 5.5], mode: 'flat', grav: -2.5, drag: 2.2, floor: 0, spin: [0, 3], jitter: 0.35, wob: 0.6, wind: 0.5 },
    spark:    { bank: 0, ramp: 'spark', life: [0.35, 0.8], size: [0.24, 0.36], end: 0.6, curve: 2, shape: [1, 1, 1], speed: [5, 12], up: [2, 7], mode: 'sphere', grav: 16, drag: 1.2, floor: 1, spin: [0, 0], jitter: 0.1, flick: 0.25 },
    ember:    { bank: 0, ramp: 'ember', life: [0.8, 1.6], size: [0.18, 0.3], end: 0.5, curve: 2, shape: [1, 1, 1], speed: [0.2, 0.9], up: [1.5, 3.5], mode: 'flat', grav: -0.6, drag: 0.8, floor: 0, spin: [0, 0], jitter: 0.4, flick: 0.35, wob: 1.2, wind: 1 },
    flash:    { bank: 0, ramp: 'flash', life: [0.08, 0.16], size: [0.9, 1.4], end: 1.7, curve: 3, shape: [1, 1, 1], speed: [1, 5], up: [0, 1.5], mode: 'sphere', grav: 0, drag: 8, floor: 0, spin: [0, 6], jitter: 0.3 },
    fireball: { bank: 0, ramp: 'fireHot', life: [0.4, 0.75], size: [1.3, 2.0], end: 0.15, curve: 0, shape: [1, 1, 1], speed: [4, 10], up: [3, 7], mode: 'sphere', grav: -3, drag: 4.5, floor: 0, spin: [0, 5], jitter: 0.4 },
    trail:    { bank: 0, ramp: 'ember', life: [0.2, 0.36], size: [0.3, 0.42], end: 0.2, curve: 0, shape: [1, 1, 1], speed: [0, 0.6], up: [0, 0.4], mode: 'sphere', grav: 0, drag: 2, floor: 0, spin: [0, 0], jitter: 0.08 },
    star:     { bank: 0, ramp: 'star', life: [1.1, 1.7], size: [0.42, 0.6], end: 0.5, curve: 2, shape: [1, 1, 1], speed: [9, 12], up: [0, 0], mode: 'sphere', grav: 3.2, drag: 1.4, floor: 0, spin: [0, 0], jitter: 0, flick: 0.12, tint: true },
    glitter:  { bank: 0, ramp: 'glitter', life: [0.5, 1.1], size: [0.28, 0.42], end: 0.6, curve: 2, shape: [1, 1, 1], speed: [0.2, 1.2], up: [-0.5, 0.5], mode: 'sphere', grav: 2, drag: 1, floor: 0, spin: [0, 0], jitter: 0.3, flick: 0.5 },
    rocket:   { bank: 0, ramp: 'glitter', life: [0.25, 0.4], size: [0.32, 0.46], end: 0.3, curve: 0, shape: [1, 1, 1], speed: [0.3, 1.4], up: [-2, 0], mode: 'sphere', grav: 4, drag: 1.5, floor: 0, spin: [0, 0], jitter: 0.1, flick: 0.2 },
    tglow:    { bank: 0, ramp: 'tintFade', life: [0.45, 0.85], size: [0.55, 0.85], end: 0.2, curve: 0, shape: [1, 1, 1], speed: [0.5, 2], up: [0.5, 2], mode: 'sphere', grav: 0, drag: 2, floor: 0, spin: [0, 4], jitter: 0.2, tint: true },
    splash:   { bank: 1, ramp: 'water', life: [0.7, 1.2], size: [0.5, 0.8], end: 0.45, curve: 0, shape: [1, 1, 1], speed: [0.2, 1.3], up: [12, 20], mode: 'column', grav: 22, drag: 0.4, floor: 1, spin: [0, 0], jitter: 0.3 },
    spray:    { bank: 1, ramp: 'water', life: [0.45, 0.85], size: [0.3, 0.48], end: 0.5, curve: 0, shape: [1, 1, 1], speed: [3, 7], up: [3, 7], mode: 'flat', grav: 20, drag: 0.6, floor: 1, spin: [0, 0], jitter: 0.2 },
    plank:    { bank: 1, ramp: 'wood', life: [3.0, 5.0], size: [1.3, 2.0], end: 0.6, curve: 2, shape: [1, 0.2, 0.32], speed: [3, 7], up: [5, 11], mode: 'flat', grav: 18, drag: 0.4, floor: 2, spin: [4, 11], jitter: 0.3 },
    debris:   { bank: 1, ramp: 'woodDark', life: [0.8, 1.6], size: [0.32, 0.55], end: 0.5, curve: 2, shape: [1, 1, 1], speed: [3, 8], up: [4, 9], mode: 'flat', grav: 20, drag: 0.5, floor: 1, spin: [5, 14], jitter: 0.3 },
    ironbit:  { bank: 1, ramp: 'iron', life: [0.6, 1.2], size: [0.26, 0.4], end: 0.5, curve: 2, shape: [1, 1, 1], speed: [3, 7], up: [4, 8], mode: 'flat', grav: 22, drag: 0.5, floor: 1, spin: [5, 12], jitter: 0.2 },
    confetti: { bank: 1, ramp: 'tint', life: [2.8, 4.2], size: [0.55, 0.8], end: 0.7, curve: 2, shape: [1, 0.08, 0.62], speed: [2, 6], up: [6, 11], mode: 'flat', grav: 4.5, drag: 1.6, floor: 1, spin: [3, 9], jitter: 1.2, tint: true, wob: 1.6 },
    smoke:    { bank: 2, ramp: 'smoke', life: [1.1, 1.9], size: [0.95, 1.4], end: 2.4, curve: 1, shape: [1, 1, 1], speed: [0.3, 1.2], up: [1.0, 2.2], mode: 'flat', grav: -0.4, drag: 1.1, floor: 0, spin: [0, 1.5], jitter: 0.3, wind: 1, wob: 0.3 },
    smokeDark:{ bank: 2, ramp: 'smokeDark', life: [1.4, 2.4], size: [1.0, 1.5], end: 2.0, curve: 1, shape: [1, 1, 1], speed: [0.3, 1.0], up: [2.6, 4.0], mode: 'flat', grav: -0.5, drag: 1.0, floor: 0, spin: [0, 1.2], jitter: 0.3, wind: 1, wob: 0.3 },
    smokeFire:{ bank: 2, ramp: 'smokeFire', life: [1.3, 2.2], size: [0.95, 1.4], end: 2.6, curve: 1, shape: [1, 1, 1], speed: [0.2, 0.8], up: [2.2, 3.4], mode: 'flat', grav: -0.5, drag: 1.0, floor: 0, spin: [0, 1.2], jitter: 0.25, wind: 1, wob: 0.3 },
    puff:     { bank: 2, ramp: 'smoke', life: [0.6, 1.1], size: [1.2, 1.8], end: 1.9, curve: 1, shape: [1, 1, 1], speed: [2, 6], up: [0.3, 1.4], mode: 'cone', grav: -0.3, drag: 3.2, floor: 0, spin: [0, 2], jitter: 0.2, wind: 0.6 },
    mist:     { bank: 2, ramp: 'mist', life: [0.55, 0.95], size: [1.0, 1.6], end: 1.8, curve: 1, shape: [1, 1, 1], speed: [1, 3], up: [0.5, 2], mode: 'flat', grav: 0, drag: 2.5, floor: 0, spin: [0, 1], jitter: 0.4 },
    foam:     { bank: 2, ramp: 'foam', life: [0.7, 1.1], size: [0.7, 1.0], end: 0.0, curve: 2, shape: [1, 0.3, 1], speed: [6.5, 7.5], up: [0, 0], mode: 'ring', grav: 0, drag: 2.6, floor: 0, spin: [0, 0], jitter: 0 },
    bubble:   { bank: 2, ramp: 'bubble', life: [0.45, 0.9], size: [0.3, 0.55], end: 1.4, curve: 3, shape: [1, 1, 1], speed: [0.2, 1.2], up: [0.6, 1.6], mode: 'flat', grav: 0, drag: 2, floor: 0, spin: [0, 0], jitter: 0.8, wob: 0.8 },
    oil:      { bank: 2, ramp: 'oil', life: [6, 9], size: [0.9, 1.5], end: 1.6, curve: 2, shape: [1, 0.12, 1], speed: [0.4, 1.6], up: [0, 0], mode: 'flat', grav: 0, drag: 0.7, floor: 0, spin: [0, 0.3], jitter: 1.2 },
    rain:     { bank: 2, ramp: 'rain', life: [0.9, 1.4], size: [0.9, 1.3], end: 1, curve: 0, shape: [0.07, 1, 0.07], speed: [0, 0], up: [-26, -20], mode: 'flat', grav: 0, drag: 0, floor: 1, spin: [0, 0], jitter: 0 }
  };
  // public kinds of the contract map onto presets
  const ALIAS = { debris: 'debris', smoke: 'smoke', fire: 'fire', spark: 'spark', splash: 'splash', bubble: 'bubble', plank: 'plank', oil: 'oil', foam: 'foam', confetti: 'confetti', rain: 'rain' };

  const CAPS = [1600, 900, 1600];
  const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'ex', 'ey', 'ez', 'rx', 'ry', 'wx', 'wy',
    'grav', 'drag', 'floorY', 'tr', 'tg', 'tb', 'flick', 'wob', 'ph', 'wind'];
  const UFIELDS = ['curve', 'floorMode', 'ramp'];

  const S = { ok: false, banks: [], rng: null, offs: [], wind: { x: 0.9, z: 0.35 }, reduced: false, t: 0, dirty: false, scale: 1 };

  function makeBank(i, cap) {
    const b = { i, cap, n: 0, mesh: null, arrs: [], uarrs: [] };
    FIELDS.forEach((f) => { b[f] = new Float32Array(cap); b.arrs.push(b[f]); });
    UFIELDS.forEach((f) => { b[f] = new Uint8Array(cap); b.uarrs.push(b[f]); });
    return b;
  }

  // Unit "puff": a 4x4x4 voxel block with its 8 corners removed, so smoke and flames read as chunky round pixel
  // blobs instead of rocks; ~50 triangles after greedy merging. Solid debris keeps the plain cube.
  function puffGeometry() {
    const b = GLT.voxel.builder({ size: 0.25 });
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 4; z++) {
      const edge = (x === 0 || x === 3) + (y === 0 || y === 3) + (z === 0 || z === 3);
      if (edge < 3) b.set(x, y, z, 0xffffff);
    }
    const g = b.build({ center: true, ao: 0, castShadow: false, receiveShadow: false });
    const geo = g.children[0].geometry;
    geo.translate(0, -0.5, 0);
    geo.deleteAttribute('color');
    return geo;
  }

  function makeMesh(i, cap) {
    const geo = i === 1 ? new THREE.BoxBufferGeometry(1, 1, 1) : puffGeometry();
    let mat;
    if (i === 0) mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    else mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(mat, i === 0 ? 'glow' : i === 1 ? 'full' : 'none');
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = i === 1;
    mesh.receiveShadow = false;
    mesh.name = 'fx-particles-' + ['glow', 'solid', 'soft'][i];
    mesh.renderOrder = 2;
    return mesh;
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root || !GLT.scene.root()) return false;
    compileRamps();
    S.rng = GLT.rng.create(0x9e3779b1 ^ ((GLT.params && GLT.params.seed) | 0));
    S.reduced = !!(GLT.prefs && GLT.prefs.reducedMotion && GLT.prefs.reducedMotion());
    for (let i = 0; i < 3; i++) {
      const b = makeBank(i, CAPS[i]);
      b.mesh = makeMesh(i, CAPS[i]);
      GLT.scene.add(b.mesh, 'fx');
      S.banks.push(b);
    }
    S.offs.push(GLT.clock.onFrame(update, 500));
    if (GLT.events) {
      S.offs.push(GLT.events.on('settings:changed', (e) => {
        if (e && e.key === 'reducedMotion') S.reduced = !!GLT.prefs.reducedMotion();
      }));
      S.offs.push(GLT.events.on('game:setup', () => clear()));
    }
    S.ok = true;
    return true;
  }

  function reseed(seed) { if (GLT.rng) S.rng = GLT.rng.create((seed >>> 0) ^ 0x51ed27); }
  function rnd() { return S.rng.next(); }
  function rr(a) { return a[0] + (a[1] - a[0]) * S.rng.next(); }
  function toRgb(c, out) {
    let n;
    if (typeof c === 'number') n = c;
    else if (typeof c === 'string' && c.charAt(0) === '#') n = parseInt(c.slice(1), 16);
    else if (typeof c === 'string' && GLT.palette && GLT.palette.has && GLT.palette.has(c)) n = GLT.palette.get(c);
    else n = 0xffffff;
    out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
    return out;
  }
  const TINT = [1, 1, 1];

  // emit(kind, pos, o?): o = { count, vel:{x,y,z}, spread (speed multiplier), color, life (multiplier), size (multiplier),
  //   floor (y), dir:{x,y,z} (cone axis for 'cone' kinds or when given), radius (ring/jitter radius), up (multiplier) }
  function emit(kind, pos, o) {
    if (!S.ok && !init()) return 0;
    const p = P[kind] || P[ALIAS[kind]];
    if (!p || !pos) return 0;
    o = o || {};
    let count = o.count != null ? o.count : 8;
    if (S.reduced) count = Math.ceil(count * 0.5);
    const b = S.banks[p.bank];
    const spread = o.spread != null ? o.spread : 1;
    const lifeK = o.life != null ? o.life : 1;
    const sizeK = (o.size != null ? o.size : 1) * S.scale;
    const upK = o.up != null ? o.up : 1;
    const radius = o.radius != null ? o.radius : p.jitter;
    const floorY = o.floor != null ? o.floor : pos.y - 60;
    if (p.tint || o.color != null) toRgb(o.color != null ? o.color : 0xffffff, TINT); else { TINT[0] = 1; TINT[1] = 1; TINT[2] = 1; }
    const vel = o.vel;
    const dir = o.dir;
    const ramp = RAMP_ID[o.ramp || p.ramp] || 0;
    let made = 0;
    for (let k = 0; k < count; k++) {
      if (b.n >= b.cap) break;
      const i = b.n++;
      made++;
      let dx = 0, dy = 0, dz = 0;
      const spd = rr(p.speed) * spread;
      if (p.mode === 'sphere') {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        dx = s * Math.cos(th); dy = u; dz = s * Math.sin(th);
      } else if (p.mode === 'ring') {
        const th = (k / count) * Math.PI * 2 + rnd() * 0.12;
        dx = Math.cos(th); dz = Math.sin(th);
      } else {
        const th = rnd() * Math.PI * 2;
        const m = p.mode === 'column' ? Math.sqrt(rnd()) : 1;
        dx = Math.cos(th) * m; dz = Math.sin(th) * m;
      }
      if (dir) {
        // cone around dir: mostly along dir, with the random direction as spread
        const cs = o.cone != null ? o.cone : 0.45;
        dx = dir.x + dx * cs; dy = dir.y + dy * cs; dz = dir.z + dz * cs;
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      let jx = 0, jy = 0, jz = 0;
      if (p.mode === 'ring') { jx = dx * radius; jz = dz * radius; }
      else if (radius > 0) {
        const th = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * radius;
        jx = Math.cos(th) * rad; jz = Math.sin(th) * rad; jy = (rnd() - 0.5) * radius * 0.5;
      }
      b.px[i] = pos.x + jx; b.py[i] = pos.y + jy; b.pz[i] = pos.z + jz;
      b.vx[i] = dx * spd + (vel ? vel.x : 0);
      b.vy[i] = dy * spd + rr(p.up) * upK + (vel ? vel.y : 0);
      b.vz[i] = dz * spd + (vel ? vel.z : 0);
      b.age[i] = 0;
      b.life[i] = rr(p.life) * lifeK;
      const s0 = rr(p.size) * sizeK;
      b.s0[i] = s0; b.s1[i] = s0 * p.end;
      b.ex[i] = p.shape[0]; b.ey[i] = p.shape[1]; b.ez[i] = p.shape[2];
      b.rx[i] = rnd() * 6.283; b.ry[i] = rnd() * 6.283;
      const sp = rr(p.spin);
      b.wx[i] = (rnd() < 0.5 ? -1 : 1) * sp; b.wy[i] = (rnd() < 0.5 ? -1 : 1) * sp * 0.7;
      b.grav[i] = o.grav != null ? o.grav : p.grav;
      b.drag[i] = o.drag != null ? o.drag : p.drag;
      b.floorY[i] = floorY;
      b.tr[i] = TINT[0]; b.tg[i] = TINT[1]; b.tb[i] = TINT[2];
      b.flick[i] = p.flick || 0;
      b.wob[i] = p.wob || 0;
      b.ph[i] = rnd() * 100;
      b.wind[i] = p.wind || 0;
      b.curve[i] = p.curve;
      b.floorMode[i] = o.floorMode != null ? o.floorMode : p.floor;
      b.ramp[i] = ramp;
    }
    S.dirty = true;
    return made;
  }

  // A single particle with explicit fields (fireworks rockets, cannon smoke rings...). Returns true if placed.
  function spawn(kind, x, y, z, vx, vy, vz, o) {
    const p = P[kind];
    if (!p || (!S.ok && !init())) return false;
    const b = S.banks[p.bank];
    if (b.n >= b.cap) return false;
    o = o || {};
    const i = b.n++;
    if (p.tint || o.color != null) toRgb(o.color != null ? o.color : 0xffffff, TINT); else { TINT[0] = 1; TINT[1] = 1; TINT[2] = 1; }
    b.px[i] = x; b.py[i] = y; b.pz[i] = z; b.vx[i] = vx; b.vy[i] = vy; b.vz[i] = vz;
    b.age[i] = 0; b.life[i] = o.life != null ? o.life : rr(p.life);
    const s0 = (o.size != null ? o.size : rr(p.size)) * S.scale;
    b.s0[i] = s0; b.s1[i] = s0 * (o.end != null ? o.end : p.end);
    b.ex[i] = p.shape[0]; b.ey[i] = p.shape[1]; b.ez[i] = p.shape[2];
    b.rx[i] = rnd() * 6.283; b.ry[i] = rnd() * 6.283;
    const sp = rr(p.spin);
    b.wx[i] = sp; b.wy[i] = -sp * 0.7;
    b.grav[i] = o.grav != null ? o.grav : p.grav; b.drag[i] = o.drag != null ? o.drag : p.drag;
    b.floorY[i] = o.floor != null ? o.floor : y - 60;
    b.tr[i] = TINT[0]; b.tg[i] = TINT[1]; b.tb[i] = TINT[2];
    b.flick[i] = p.flick || 0; b.wob[i] = p.wob || 0; b.ph[i] = rnd() * 100; b.wind[i] = p.wind || 0;
    b.curve[i] = p.curve; b.floorMode[i] = o.floorMode != null ? o.floorMode : p.floor;
    b.ramp[i] = RAMP_ID[o.ramp || p.ramp] || 0;
    S.dirty = true;
    return true;
  }

  function kill(b, i) {
    const last = --b.n;
    if (i === last) return;
    const A = b.arrs, U = b.uarrs;
    for (let a = 0; a < A.length; a++) A[a][i] = A[a][last];
    for (let a = 0; a < U.length; a++) U[a][i] = U[a][last];
  }

  function hash(a, b) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function update(dt, t) {
    if (!S.ok) return;
    S.t = t;
    if (dt <= 0 && !S.dirty) return;
    S.dirty = false;
    const wx = S.wind.x, wz = S.wind.z;
    for (let bi = 0; bi < 3; bi++) {
      const b = S.banks[bi];
      const m = b.mesh.instanceMatrix.array, col = b.mesh.instanceColor.array;
      let i = 0;
      while (i < b.n) {
        let age = b.age[i] + dt;
        const life = b.life[i];
        if (age >= life) { kill(b, i); continue; }
        b.age[i] = age;
        // integrate
        if (dt > 0) {
          const dk = Math.max(0, 1 - b.drag[i] * dt);
          let vx = b.vx[i] * dk, vy = b.vy[i] * dk - b.grav[i] * dt, vz = b.vz[i] * dk;
          const wd = b.wind[i];
          if (wd > 0) { vx += wx * wd * dt * 1.6; vz += wz * wd * dt * 1.6; }
          const wob = b.wob[i];
          let ox = 0, oz = 0;
          if (wob > 0) { const ph = b.ph[i] + age * 5.3; ox = Math.sin(ph) * wob * dt; oz = Math.cos(ph * 0.83) * wob * dt; }
          let x = b.px[i] + vx * dt + ox, y = b.py[i] + vy * dt, z = b.pz[i] + vz * dt + oz;
          const fm = b.floorMode[i];
          if (fm && y <= b.floorY[i]) {
            if (fm === 1) { kill(b, i); continue; }
            // float: settle on the water, drift, rock gently
            y = b.floorY[i] + 0.04 + Math.sin(b.ph[i] + age * 2.6) * 0.05;
            vy = 0; vx *= 0.92; vz *= 0.92;
            b.wx[i] *= 0.85; b.wy[i] *= 0.9;
            b.rx[i] *= 0.9;
          }
          b.vx[i] = vx; b.vy[i] = vy; b.vz[i] = vz;
          b.px[i] = x; b.py[i] = y; b.pz[i] = z;
          b.rx[i] += b.wx[i] * dt; b.ry[i] += b.wy[i] * dt;
        }
        // size over life
        const u = age / life;
        const s0 = b.s0[i], s1 = b.s1[i];
        let s;
        const cv = b.curve[i];
        if (cv === 0) s = s0 + (s1 - s0) * u;
        else if (cv === 1) s = u < 0.3 ? s0 + (s1 - s0) * (u / 0.3) : s1 * (1 - Math.pow((u - 0.3) / 0.7, 2.2));
        else if (cv === 2) s = u < 0.7 ? s0 + (s1 - s0) * (u / 0.7) * 0.3 : (s0 + (s1 - s0) * 0.3) * (1 - (u - 0.7) / 0.3);
        else s = u < 0.25 ? s0 + (s1 - s0) * Math.sin((u / 0.25) * 1.5708) : s1 * (1 - (u - 0.25) / 0.75);
        if (b.flick[i] > 0 && hash(i * 7 + (b.ph[i] * 1000 | 0), (age * 24) | 0) < b.flick[i]) s *= 0.35;
        if (s < 0.001) s = 0.001;
        // matrix: R = Ry(ry) * Rx(rx), then scale (ex,ey,ez)*s, column-major
        const ca = Math.cos(b.rx[i]), sa = Math.sin(b.rx[i]);
        const cy = Math.cos(b.ry[i]), sy = Math.sin(b.ry[i]);
        const sx = b.ex[i] * s, syy = b.ey[i] * s, sz = b.ez[i] * s;
        const o = i * 16;
        m[o] = cy * sx; m[o + 1] = 0; m[o + 2] = -sy * sx; m[o + 3] = 0;
        m[o + 4] = sy * sa * syy; m[o + 5] = ca * syy; m[o + 6] = cy * sa * syy; m[o + 7] = 0;
        m[o + 8] = sy * ca * sz; m[o + 9] = -sa * sz; m[o + 10] = cy * ca * sz; m[o + 11] = 0;
        m[o + 12] = b.px[i]; m[o + 13] = b.py[i]; m[o + 14] = b.pz[i]; m[o + 15] = 1;
        // stepped colour ramp
        const rid = b.ramp[i];
        const len = RAMP_LEN[rid];
        let step = (u * len) | 0; if (step >= len) step = len - 1;
        const ro = (RAMP_OFF[rid] + step) * 4;
        const w = RAMP_DATA[ro + 3];
        let r = RAMP_DATA[ro] * b.tr[i], g = RAMP_DATA[ro + 1] * b.tg[i], bl = RAMP_DATA[ro + 2] * b.tb[i];
        if (w > 0) { r += (1 - r) * w; g += (1 - g) * w; bl += (1 - bl) * w; }
        const co = i * 3;
        col[co] = r; col[co + 1] = g; col[co + 2] = bl;
        i++;
      }
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.updateRange.offset = 0;
      b.mesh.instanceMatrix.updateRange.count = b.n * 16;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor.updateRange.offset = 0;
      b.mesh.instanceColor.updateRange.count = b.n * 3;
      b.mesh.instanceColor.needsUpdate = true;
    }
  }

  function clear() {
    S.banks.forEach((b) => { b.n = 0; if (b.mesh) b.mesh.count = 0; });
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    S.banks.forEach((b) => {
      if (b.mesh) { if (b.mesh.parent) b.mesh.parent.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    });
    S.banks = [];
    S.ok = false;
  }

  GLT.particles = {
    init, emit, clear, dispose,
    // additions (fx area)
    spawn, reseed,
    kinds() { return Object.keys(P); },
    setWind(x, z) { S.wind.x = x; S.wind.z = z; },
    // global size multiplier (the game's default camera is farther than our demos': particles must stay readable)
    setScale(k) { S.scale = k > 0 ? k : 1; },
    reduced() { return S.reduced; },
    rand() { return S.ok ? S.rng.next() : 0.5; },
    stats() { return { glow: S.banks[0] ? S.banks[0].n : 0, solid: S.banks[1] ? S.banks[1].n : 0, soft: S.banks[2] ? S.banks[2].n : 0, caps: CAPS.slice() }; }
  };
})();
