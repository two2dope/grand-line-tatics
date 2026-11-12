/* Render-area demos (private file; namespace GLT._render_demos). Area: render. Contract: ARCHITECTURE.md §13.
 *   render.core / core     a voxel coast at game scale (zoom 1 = the game's 0.22 m/texel): a terraced island with
 *                          boulder cliffs, a village, a harbour with a moored ship, a lighthouse point, an arch and sea
 *                          stacks, a palm islet with a campfire, a sailing ship with its wake, torch buoys, a burning
 *                          wreck and clouds. It exercises every pipeline feature under ?tod=day|dusk|night|storm.
 *   render.core.raw        post pass off (raw 3D at low resolution)    render.core.flat     palette snap, no dither
 *   render.core.nolines    no outlines / creases / foam                render.core.px1|px3|px4  other pixel sizes
 *   render.core.pan        frozen scene, the camera pans with t (snap check: whole-texel shifts, no shimmer)
 *   render.core.orbit      frozen scene, the camera turns with t
 *   render.palette         the 90 swatches + dithered ramps
 * Every animation is a pure function of the clock (t); all randomness comes from hashes of ctx.seed: ?t= is exact. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  // ---- deterministic value noise ----
  function hash3(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash3(xi, yi, s), b = hash3(xi + 1, yi, s), c = hash3(xi, yi + 1, s), d = hash3(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s) { return vnoise(x, y, s) * 0.6 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.1; }
  const mod = (a, n) => ((a % n) + n) % n;

  const P = (role) => GLT.palette.get(role);
  const hexOf = (c) => (typeof c === 'number' ? c : (String(c).charAt(0) === '#' ? parseInt(String(c).slice(1), 16) : P(c)));
  const V3 = (c) => { const n = hexOf(c); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

  // ---- scene frame ----
  // (u, v) = ground coordinates along screen-right / screen-far for the default camera azimuth (45 deg). At zoom 1 the
  // frame shows u in [-71, 71] and v in [-70, 70] (minus 1.43 m of v per metre of height).
  const AZ = 45 * Math.PI / 180;
  const RX = Math.cos(AZ), RZ = -Math.sin(AZ), FX = -Math.sin(AZ), FZ = -Math.cos(AZ);
  const W = (u, v) => ({ x: u * RX + v * FX, z: u * RZ + v * FZ });
  const UV = (x, z) => ({ u: x * RX + z * RZ, v: x * FX + z * FZ });

  // ---- terrain: blobs in (u, v) metres, terraced into levels; 0.5 m voxels ----
  const VS = 0.5;
  const LEVEL_H = [0, 2, 9, 16, 23];            // voxels above the waterline per level (0, 1, 4.5, 8, 11.5 m)
  const ISLANDS = [
    { name: 'main', seed: 11, beach: 0.13, t: [0.33, 0.56], blobs: [
      { u: -50, v: 60, ru: 42, rv: 26 }, { u: -24, v: 38, ru: 17, rv: 12 }, { u: 3, v: 34, ru: 10, rv: 8.5 }, { u: -68, v: 36, ru: 13, rv: 12 }] },
    { name: 'islet', seed: 29, beach: 0.3, beachAll: true, t: [0.7, 9], blobs: [{ u: -50, v: -40, ru: 13, rv: 9.5 }, { u: -40, v: -46, ru: 6, rv: 5 }] }
  ];
  function shapeAt(isl, u, v) {
    let f = -9;
    for (let i = 0; i < isl.blobs.length; i++) {
      const b = isl.blobs[i];
      const du = (u - b.u) / b.ru, dv = (v - b.v) / b.rv;
      const q = 1 - Math.sqrt(du * du + dv * dv);
      if (q > f) f = q;
    }
    return f + (fbm(u * 0.07, v * 0.07, isl.seed) - 0.5) * 0.42;
  }
  function levelAt(isl, xv, zv) {
    const p = UV(xv * VS + VS / 2, zv * VS + VS / 2);
    if (p.v > 68 || p.u < -84 || p.u > 84) return 0;   // beyond the frame at the default view
    const g = shapeAt(isl, p.u, p.v) + (hash3(Math.floor(xv / 4), Math.floor(zv / 4), isl.seed + 77) - 0.5) * 0.06;
    if (g <= 0) return 0;
    const beachy = isl.beachAll || fbm(p.u * 0.045, p.v * 0.045, isl.seed + 9) > 0.46;
    if (g < (beachy ? isl.beach : 0.02)) return 1;
    if (g < isl.t[0]) return 2;
    if (g < isl.t[1]) return 3;
    return 4;
  }

  function grassCol(x, z, seed) {
    const n = fbm(x * 0.09, z * 0.09, seed + 3);
    const h = hash3(x, z, seed + 4);
    if (h > 0.994) return h > 0.997 ? 'yellow' : 'pink';
    return n > 0.62 ? 'foliage-light' : (n > 0.4 ? 'grass' : 'grass-dark');
  }
  // Columnar boulders (vertical, so a cliff step merges into one tall quad per colour): a lit edge, a body and a
  // shadowed edge per 3-4 voxel column, a light cap row under the soil and a wet dark foot.
  function rockCol(x, y, z, h, seed) {
    if (y < 2) return y < 1 ? 'rock-deep' : 'rock-dark';
    if (y === h - 4) return 'rock-light';
    const w = x + z;
    const g = Math.floor(w / 4);
    const pos = mod(w, 4);
    const tall = hash3(g, 0, seed + 5) > 0.5;
    if (pos === 0) return tall ? 'rock-light' : 'rock';
    if (pos === 3) return 'rock-dark';
    return (y + g) % 7 === 0 && !tall ? 'rock-dark' : 'rock';
  }

  function tree(vb, x, y, z, r, seed) {
    for (let k = 0; k < 3 + (r >> 1); k++) vb.set(x, y + k, z, 'wood-dark');
    const cy = y + 3 + r * 0.8;
    for (let dx = -r - 1; dx <= r + 1; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r - 1; dz <= r + 1; dz++) {
      const d = Math.hypot(dx, dy * 1.25, dz);
      if (d > r + 0.35 + (hash3(dx + x, dz + z, seed + dy) - 0.5) * 0.9) continue;
      const lit = dy * 1.1 - dx * 0.25 + dz * 0.45 + (hash3(dx + x * 3, dy + z, seed) - 0.5) * 0.5;   // sun from above / +z
      const col = lit > r * 0.62 ? 'foliage-sun' : (lit > r * 0.1 ? 'foliage-light' : (lit > -r * 0.55 ? 'grass' : 'grass-dark'));
      vb.set(x + dx, Math.round(cy + dy), z + dz, col);
    }
  }
  function palm(vb, x, y, z, i) {
    for (let k = 0; k < 9; k++) vb.set(x + (k > 5 ? 1 : 0), y + k, z, k % 2 ? 'wood' : 'wood-light');
    const cx = x + 1, cy = y + 9;
    vb.set(cx, cy, z, 'grass-dark');
    for (let a = 0; a < 7; a++) {
      const ang = (a * Math.PI * 2) / 7 + i;
      for (let r = 1; r <= 5; r++) {
        const lx = Math.round(cx + Math.cos(ang) * r), lz = Math.round(z + Math.sin(ang) * r);
        vb.set(lx, cy - (r > 2 ? 1 : 0) - (r > 4 ? 1 : 0), lz, r < 2 ? 'grass-dark' : (r % 2 ? 'grass' : 'foliage-light'));
      }
    }
  }
  function house(vb, db, nb, x, y, z, w, d, roof, seed) {
    const H = 6;
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) for (let dy = -4; dy < H; dy++) {
      const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      if (!edge && dy > -4) continue;
      const corner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
      vb.set(x + dx, y + dy, z + dz, dy < 0 ? 'rock' : (corner || dy === H - 1 ? 'wood-mid' : (dy === 0 ? 'sail-dark' : 'sail-shadow')));
    }
    const rh = Math.ceil(d / 2) + 1;
    for (let k = 0; k < rh; k++) for (let dx = -1; dx <= w; dx++) {
      [z - 1 + k, z + d - k].forEach((zz, side) => vb.set(x + dx, y + H + k, zz, (k === rh - 1) ? roof + '-dark' : (side ? roof : roof + '-light')));
      if (k < rh - 1) for (let zz = z + k; zz <= z + d - 1 - k; zz++) if (dx === 0 || dx === w - 1) vb.set(x + dx, y + H + k, zz, 'sail-dark');
    }
    vb.set(x + w - 1, y + H + rh, z + 1, 'rock-dark'); vb.set(x + w - 1, y + H + rh + 1, z + 1, 'rock');   // chimney
    for (let k = 0; k < 3; k++) vb.set(x + 1, y + k, z + d - 1, k < 2 ? 'wood-deep' : 'wood-dark');      // door
    const wins = [[x + w - 2, y + 3, z + d - 1], [x + w - 1, y + 3, z + 2], [x + w - 1, y + 3, z + d - 3]];
    if (w > 6) wins.push([x + 3, y + 3, z + d - 1]);
    wins.forEach((p) => {
      vb.remove(p[0], p[1], p[2]);
      db.set(p[0], p[1], p[2], 'ink-2');
      nb.set(p[0], p[1], p[2], hash3(p[0], p[2], seed) > 0.3 ? 'lantern' : 'fire-hot', 'emissive');
    });
  }

  // Builds every island into one voxel builder (+ day/night window twins). Returns the height map for placement.
  function makeLand(seed) {
    const vb = GLT.voxel.builder({ size: VS });
    const db = GLT.voxel.builder({ size: VS });
    const nb = GLT.voxel.builder({ size: VS });
    const hmap = new Map();
    const lmap = new Map();
    const K = (x, z) => (x + 2048) * 4096 + (z + 2048);
    const H = (x, z) => hmap.get(K(x, z)) || 0;
    const LV = (x, z) => lmap.get(K(x, z)) || 0;
    ISLANDS.forEach((isl) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      isl.blobs.forEach((b) => {
        const r = Math.max(b.ru, b.rv) * 1.25 + 4, c = W(b.u, b.v);
        x0 = Math.min(x0, c.x - r); x1 = Math.max(x1, c.x + r); z0 = Math.min(z0, c.z - r); z1 = Math.max(z1, c.z + r);
      });
      for (let x = Math.floor(x0 / VS); x <= Math.ceil(x1 / VS); x++) for (let z = Math.floor(z0 / VS); z <= Math.ceil(z1 / VS); z++) {
        const l = levelAt(isl, x, z);
        if (!l) continue;
        const k = K(x, z);
        if (l > (lmap.get(k) || 0)) { lmap.set(k, l); hmap.set(k, LEVEL_H[l]); }
      }
    });
    // beaches slope into the water; cliff lips get boulder bumps
    const edits = [];
    hmap.forEach((h, k) => {
      const x = Math.floor(k / 4096) - 2048, z = (k % 4096) - 2048;
      const l = lmap.get(k);
      const nmin = Math.min(H(x + 1, z), H(x - 1, z), H(x, z + 1), H(x, z - 1));
      if (l === 1 && nmin === 0) edits.push([k, 1]);
      else if (l >= 2 && nmin <= h - 4 && hash3(Math.floor(x / 2), Math.floor(z / 2), seed + 31) > 0.55) edits.push([k, h + 1]);
    });
    edits.forEach(([k, h]) => hmap.set(k, h));

    // the village terrace by the harbour, the lighthouse point, the islet hut
    const village = [[-24, 31, 8, 7, 'red'], [-36, 37, 7, 7, 'blue'], [-14, 40, 7, 6, 'red'], [-30, 46, 6, 6, 'red']].map(([u, v, w, d, roof]) => {
      const p = W(u, v);
      return { x: Math.round(p.x / VS), z: Math.round(p.z / VS), w, d, roof };
    });
    village.forEach((hs) => {
      let top = 0;
      for (let dx = -1; dx <= hs.w; dx++) for (let dz = -1; dz <= hs.d; dz++) top = Math.max(top, H(hs.x + dx, hs.z + dz));
      top = Math.max(top, LEVEL_H[2]);
      hs.y = top;
      for (let dx = -2; dx <= hs.w + 1; dx++) for (let dz = -2; dz <= hs.d + 1; dz++) {
        const k = K(hs.x + dx, hs.z + dz);
        hmap.set(k, top); lmap.set(k, Math.max(2, lmap.get(k) || 2));
      }
    });

    // columns
    hmap.forEach((h, k) => {
      const x = Math.floor(k / 4096) - 2048, z = (k % 4096) - 2048;
      const l = lmap.get(k);
      let nmin = h;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) nmin = Math.min(nmin, H(x + dx, z + dz));
      const y0 = Math.max(0, nmin - 2);
      const patch = fbm(x * 0.13, z * 0.13, seed + 3);
      for (let y = y0; y < h; y++) {
        const fromTop = h - 1 - y;
        let col;
        if (l === 1) col = fromTop === 0 ? (patch > 0.6 ? 'sand-light' : 'sand') : (y < 1 ? 'rock-light' : 'sand');
        else if (fromTop === 0) col = grassCol(x, z, seed);
        else if (fromTop === 1) col = 'vine';
        else if (fromTop === 2) col = 'soil';
        else col = rockCol(x, y, z, h, seed);
        vb.set(x, y, z, col);
      }
      // hanging vines and moss down tall faces
      if (l >= 3 && hash3(x, z, seed + 9) > 0.86) {
        const len = 3 + Math.floor(hash3(x, z, seed + 10) * 6);
        [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([dx, dz]) => {
          if (H(x + dx, z + dz) >= h - 3) return;
          for (let y = h - 2; y > h - 2 - len && y > 1; y--) if (H(x + dx, z + dz) <= y) vb.set(x + dx, y, z + dz, y === h - 2 ? 'grass-dark' : (y % 3 ? 'vine' : 'grass-dark'));
        });
      }
    });
    // columnar relief: pillars standing 1 voxel proud of every tall cliff face (a lit cap, rhythm of 5 voxels)
    hmap.forEach((h, k) => {
      const x = Math.floor(k / 4096) - 2048, z = (k % 4096) - 2048;
      if ((lmap.get(k) || 0) < 2) return;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz]) => {
        const hn = H(x + dx, z + dz);
        if (hn > h - 6) return;
        const along = dx ? z : x;
        const g = Math.floor(along / 5);
        const pos = mod(along, 5);
        if (pos > 1 + (hash3(g, dx * 3 + dz, seed + 61) > 0.5 ? 1 : 0)) return;
        const top = h - 3 - Math.floor(hash3(g, dz * 3 + dx + 7, seed + 62) * 3);
        for (let y = Math.max(0, hn); y < top; y++) {
          if (vb.get(x + dx, y, z + dz) != null) continue;
          vb.set(x + dx, y, z + dz, y === top - 1 ? 'rock-light' : (y < 1 ? 'rock-deep' : (pos === 0 ? 'rock-light' : 'rock')));
        }
      });
    });
    village.forEach((hs, i) => house(vb, db, nb, hs.x, hs.y, hs.z, hs.w, hs.d, hs.roof, seed + i));

    // trees on the terraces (not on the village or the lighthouse point), bushes on lips, palms on beaches
    const light = W(3, 33);
    const lx = Math.round(light.x / VS), lz = Math.round(light.z / VS);
    let trees = 0;
    hmap.forEach((h, k) => {
      const x = Math.floor(k / 4096) - 2048, z = (k % 4096) - 2048;
      const l = lmap.get(k);
      if (l < 2 || trees > 34) return;
      if (Math.abs(x - lx) + Math.abs(z - lz) < 14) return;
      if (village.some((hs) => x > hs.x - 6 && x < hs.x + hs.w + 5 && z > hs.z - 6 && z < hs.z + hs.d + 5)) return;
      const hr = hash3(x, z, seed + 21);
      if (hr > 0.982 && H(x + 4, z) >= h && H(x - 4, z) >= h && H(x, z + 4) >= h && H(x, z - 4) >= h) {
        tree(vb, x, h, z, 3 + (hash3(x, z, seed) > 0.5 ? 1 : 0) + (l > 3 ? 1 : 0), seed + trees); trees++;
      } else if (hr < 0.012) {
        const r = 1 + (hash3(z, x, seed) > 0.6 ? 1 : 0);
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = 0; dy <= r; dy++) {
          if (Math.hypot(dx, dy * 1.4, dz) > r + 0.3) continue;
          vb.set(x + dx, h + dy, z + dz, dy === r ? 'foliage-light' : (dz > 0 ? 'grass' : 'grass-dark'));
        }
      }
    });
    let palms = 0;
    hmap.forEach((h, k) => {
      const x = Math.floor(k / 4096) - 2048, z = (k % 4096) - 2048;
      if (lmap.get(k) !== 1 || h < 2 || palms > 9) return;
      if (hash3(x, z, seed + 41) > 0.988 && H(x + 2, z) && H(x - 2, z) && H(x, z + 2) && H(x, z - 2)) { palm(vb, x, h, z, palms); palms++; }
    });

    // lighthouse on the point
    const ly = H(lx, lz) || LEVEL_H[3];
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) if (Math.hypot(dx, dz) <= 5.2) { const k = K(lx + dx, lz + dz); if (!hmap.has(k)) continue; for (let y = H(lx + dx, lz + dz); y < ly; y++) vb.set(lx + dx, y, lz + dz, 'rock'); }
    for (let y = 0; y < 22; y++) {
      const rr = y < 16 ? 3.1 - y * 0.05 : 2.6;
      for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
        const d = Math.hypot(x, z);
        if (d > rr) continue;
        let col = Math.floor(y / 4) % 2 ? 'red' : 'white';
        if (y < 2) col = 'stone';
        if (y >= 17) col = 'gold-dark';
        if (y === 16) col = 'iron';
        if (y >= 17 && y < 20 && d > rr - 1) { db.set(lx + x, ly + y, lz + z, 'gold'); nb.set(lx + x, ly + y, lz + z, 'fire-hot', 'emissive'); }
        else vb.set(lx + x, ly + y, lz + z, col);
      }
    }
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) if (Math.hypot(x, z) <= 4.2) vb.set(lx + x, ly + 16, lz + z, 'iron');
    for (let y = 22; y < 25; y++) { const r = 24 - y; vb.box(lx - r, ly + y, lz - r, lx + r, ly + y, lz + r, 'red-dark'); }
    vb.set(lx + 3, ly + 8, lz, 'ink'); vb.set(lx, ly + 11, lz + 3, 'ink');

    // harbour dock: along +X from the shore to the open water, lantern posts
    const dEnd = W(-6, 12);
    const dzc = Math.round(dEnd.z / VS);
    const dxe = Math.round(dEnd.x / VS);
    let dxs = dxe;
    while (dxs > dxe - 80 && !(H(dxs, dzc) && H(dxs, dzc + 3))) dxs--;
    for (let x = dxs; x <= dxe; x++) for (let z = dzc; z <= dzc + 3; z++) if (H(x, z) <= 2) vb.set(x, 2, z, (x % 2 ? 'wood' : 'wood-light'));
    for (let x = dxs + 3; x <= dxe; x += 5) { vb.box(x, -3, dzc - 1, x, 3, dzc - 1, 'wood-dark'); vb.box(x, -3, dzc + 4, x, 3, dzc + 4, 'wood-dark'); }
    const lamps = [];
    [[dxe, dzc - 1], [dxe, dzc + 4], [dxe - 15, dzc + 4]].forEach(([x, z]) => {
      vb.box(x, 4, z, x, 5, z, 'wood-dark');
      db.set(x, 6, z, 'brass'); nb.set(x, 6, z, 'lantern', 'emissive');
      lamps.push({ x: (x + 0.5) * VS, y: 6.5 * VS, z: (z + 0.5) * VS });
    });
    vb.box(dxe - 6, 3, dzc + 1, dxe - 5, 4, dzc + 2, 'wood-light'); vb.set(dxe - 6, 5, dzc + 1, 'wood'); vb.box(dxe - 10, 3, dzc, dxe - 10, 3, dzc + 1, 'gold-dark');

    // islet: hut, campfire ring, rocks
    const camp = W(-46, -38);
    const cx = Math.round(camp.x / VS), cz = Math.round(camp.z / VS);
    const cy = H(cx, cz) || 2;
    for (let a = 0; a < 8; a++) vb.set(cx + Math.round(Math.cos(a * 0.785) * 2), cy, cz + Math.round(Math.sin(a * 0.785) * 2), 'rock-dark');
    vb.set(cx, cy, cz, 'wood-deep');
    const fire = GLT.voxel.builder({ size: VS });
    [[0, 0, 'fire'], [0, 1, 'fire-hot'], [1, 0, 'ember-hot'], [-1, 0, 'fire'], [0, 2, 'lantern']].forEach(([d, y, c], i) => fire.set(cx + (i === 4 ? 0 : d), cy + 1 + y, cz + (i === 2 ? 1 : 0), c, 'emissive'));
    const hut = W(-55, -42);
    const hx = Math.round(hut.x / VS), hz = Math.round(hut.z / VS), hy = H(hx, hz) || 2;
    for (let dx = 0; dx < 6; dx++) for (let dz = 0; dz < 5; dz++) for (let dy = 0; dy < 4; dy++) if (dx === 0 || dz === 0 || dx === 5 || dz === 4) vb.set(hx + dx, hy + dy, hz + dz, (dx === 0 || dx === 5) && (dz === 0 || dz === 4) ? 'wood-dark' : 'wood');
    for (let dx = -1; dx <= 6; dx++) for (let k = 0; k < 4; k++) { vb.set(hx + dx, hy + 4 + k, hz - 1 + k, k === 3 ? 'wood-light' : 'sand'); vb.set(hx + dx, hy + 4 + k, hz + 5 - k, k === 3 ? 'wood-light' : 'gold-dark'); }

    const group = vb.build({ castShadow: true, receiveShadow: true, minY: 0, maxRun: 12, ao: 0 });
    const day = db.build({ castShadow: false, ao: 0 });
    const night = nb.build({ castShadow: false });
    const fireG = fire.build({ castShadow: false });
    group.add(day, night, fireG);
    group.name = 'demo-land';
    return {
      group, day, night, H, hmap, K,
      lamp: { x: (lx + 0.5) * VS, y: (ly + 18.5) * VS, z: (lz + 0.5) * VS },
      dockLamps: lamps,
      campfire: { x: (cx + 0.5) * VS, y: (cy + 2) * VS, z: (cz + 0.5) * VS },
      dock: { x0: dxs * VS, x1: (dxe + 1) * VS, z: dzc * VS }
    };
  }

  // Sea stacks + an arch (slate), with grass caps. Returns footprint discs for the water field.
  function makeArch(seed, at, yaw) {
    const vb = GLT.voxel.builder({ size: VS });
    const discs = [];
    const pillar = (px, pz, r, h) => {
      discs.push({ x: px * VS, z: pz * VS, r: r * VS });
      for (let x = -r - 2; x <= r + 2; x++) for (let z = -r - 2; z <= r + 2; z++) {
        const d = Math.hypot(x, z);
        const hh = Math.round(h * (1 - Math.max(0, d - r * 0.6) / (r * 1.6)) + (fbm((px + x) * 0.3, (pz + z) * 0.3, seed) - 0.5) * 5);
        if (d > r + 0.3 || hh <= 0) continue;
        for (let y = -3; y < hh; y++) {
          const top = y === hh - 1;
          const b = Math.floor((x + z) / 3), off = Math.floor(hash3(b, 1, seed) * 3);
          let col = top ? (fbm((px + x) * 0.4, (pz + z) * 0.4, seed + 2) > 0.45 ? 'grass' : 'grass-dark')
            : (y === hh - 2 ? 'vine' : (mod(y + off, 4) === 3 ? 'slate-light' : (mod(y + off, 4) === 0 ? 'slate-dark' : 'slate')));
          if (!top && y < 2) col = 'slate-dark';
          vb.set(px + x, y, pz + z, col);
        }
      }
    };
    pillar(-12, 0, 5.2, 34); pillar(12, 2, 4.6, 30); pillar(26, -10, 3, 18); pillar(-24, 12, 2.4, 9);
    for (let x = -12; x <= 12; x++) {
      const u = x / 12;
      const yb = Math.round(24 + (1 - u * u) * 5);
      for (let y = yb; y < yb + 5 + Math.round(hash3(x, 0, seed) * 1.5); y++) for (let z = -2; z <= 3; z++) {
        if (Math.abs(z - 0.5) > 2.6 - (y - yb) * 0.15) continue;
        const top = y >= yb + 4;
        vb.set(x, y, z, y === yb ? 'slate-dark' : (top ? 'grass' : (y === yb + 3 ? 'vine' : 'slate')));
      }
    }
    const g = vb.build({ minY: 0 });
    g.position.set(at.x, 0, at.z);
    g.rotation.y = yaw;
    g.name = 'demo-arch';
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { group: g, discs: discs.map((d) => ({ x: at.x + d.x * c + d.z * s, z: at.z - d.x * s + d.z * c, r: d.r })) };
  }

  function makeRocks(seed, at, list) {
    const vb = GLT.voxel.builder({ size: VS });
    const discs = [];
    list.forEach(([cx, cz, r], i) => {
      discs.push({ x: at.x + cx * VS, z: at.z + cz * VS, r: r * VS * 0.9 });
      for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
        const d = Math.hypot(x, z);
        if (d > r) continue;
        const h = Math.round((r - d) * 1.4 + fbm((cx + x) * 0.4, (cz + z) * 0.4, seed + i) * 2);
        for (let y = -2; y <= h; y++) vb.set(cx + x, y, cz + z, y === h ? (fbm((cx + x) * 0.5, (cz + z) * 0.5, seed) > 0.58 ? 'kelp' : 'rock-light') : (y < 1 ? 'rock-deep' : (y > h - 2 ? 'rock' : 'rock-dark')));
      }
    });
    const g = vb.build({ minY: 0 });
    g.position.set(at.x, 0, at.z);
    g.name = 'demo-rocks';
    return { group: g, discs };
  }

  // ---- placeholder ship (0.25 m voxels, bow +X, waterline y = 0) ----
  function makeShip(o) {
    const vb = GLT.voxel.builder({ size: 0.25 });
    const L = o.len || 52, B = o.beam || 6.5, trim = o.trim || 'red';
    const masts = o.masts || [{ x: 8, h: 40, top: 36, bot: 13, half: 10 }, { x: -9, h: 35, top: 31, bot: 13, half: 9 }];
    const halfBeam = (x) => {
      const u = x / (L / 2);
      if (u > 0) return B * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.4)));
      return B * Math.sqrt(Math.max(0, 1 - Math.pow(-u, 6)));
    };
    const aft = -L / 2 + L * 0.2;
    for (let x = -L / 2; x <= L / 2; x++) {
      const hb = halfBeam(x);
      if (hb < 0.5) continue;
      const deckY = x < aft ? 8 : 5;
      for (let y = -4; y <= deckY; y++) {
        const w = Math.max(0.5, hb * (y < 0 ? 0.55 + (y + 4) * 0.11 : 1));
        for (let z = -Math.ceil(w); z <= Math.ceil(w); z++) {
          if (Math.abs(z) > w + 0.2) continue;
          const edge = Math.abs(z) > w - 1.2;
          let col;
          if (y === deckY && !edge) col = (z & 1) ? 'wood-light' : 'rope';
          else if (y === 1 || y === 2) col = trim;
          else if (y === 3) col = 'gold';
          else if (y < 0) col = 'wood-dark';
          else col = (x & 3) === 0 ? 'wood-mid' : 'wood';
          vb.set(x, y, z, col);
        }
      }
      const rw = Math.ceil(hb);
      if (x % 2 === 0 || x < aft) { vb.set(x, deckY + 1, rw, 'wood-dark'); vb.set(x, deckY + 1, -rw, 'wood-dark'); }
    }
    for (let i = 0; i < 7; i++) vb.set(L / 2 + i - 1, 6 + (i >> 1), 0, 'wood-light');
    vb.box(L / 2 - 1, 6, -1, L / 2, 8, 1, 'gold');
    [-L / 6, 0, L / 6].forEach((cx) => { cx = Math.round(cx); vb.set(cx, 2, B + 1, 'iron'); vb.set(cx, 2, -B - 1, 'iron'); vb.set(cx, 2, B, 'iron'); vb.set(cx, 2, -B, 'iron'); });
    vb.box(-L / 2 + 2, 6, -2, -L / 2 + 2, 7, 2, 'lantern', 'emissive');
    vb.box(-L / 2 + 2, 9, -3, -L / 2 + 3, 10, -3, 'fire-hot', 'emissive');
    vb.box(-L / 2 + 2, 9, 3, -L / 2 + 3, 10, 3, 'fire-hot', 'emissive');
    masts.forEach((m) => {
      for (let y = 5; y < m.h; y++) vb.set(m.x, y, 0, y % 4 === 0 ? 'wood-dark' : 'wood');
      vb.box(m.x, m.top + 1, -m.half - 1, m.x, m.top + 1, m.half + 1, 'wood-dark');
      vb.box(m.x, m.bot - 1, -m.half, m.x, m.bot - 1, m.half, 'wood-dark');
      for (let y = m.bot; y <= m.top; y++) for (let z = -m.half; z <= m.half; z++) {
        const u = (y - m.bot) / (m.top - m.bot), vv = z / m.half;
        const belly = Math.round((1 - vv * vv) * 2.4 * Math.sin(Math.PI * u) + 0.3);
        const col = (Math.abs(vv) > 0.88 || u < 0.06) ? 'sail-shadow' : (o.stripe && u > 0.42 && u < 0.6 ? trim : 'sail');
        vb.set(m.x + 1 + belly, y, z, col);
      }
    });
    const fx = masts[0].x + 1, fy = masts[0].h + 1;
    vb.box(fx - 1, fy - 1, 0, fx - 1, fy + 2, 0, 'wood-dark');
    for (let x = fx; x < fx + 6; x++) for (let y = fy; y < fy + 4; y++) vb.set(x, y, 0, (x === fx + 2 && y === fy + 2) || (x === fx + 3 && y === fy + 1) ? 'white' : 'ink');
    const group = vb.build({ castShadow: true, receiveShadow: true, center: false });
    group.name = 'demo-ship';
    return { group, lantern: { x: (-L / 2 + 2.5) * 0.25, y: 9.5 * 0.25, z: 0 }, length: L * 0.25 };
  }

  function makeBuoy() {
    const vb = GLT.voxel.builder({ size: 0.25 });
    for (let y = -2; y <= 3; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      if (Math.hypot(x, z) > 2.3) continue;
      vb.set(x, y, z, y === 1 ? 'red' : (y === 3 ? 'wood-dark' : 'wood'));
    }
    for (let y = 4; y < 10; y++) vb.set(0, y, 0, 'wood-dark');
    vb.box(-1, 10, -1, 1, 10, 1, 'iron');
    vb.set(-1, 11, -1, 'iron'); vb.set(1, 11, 1, 'iron'); vb.set(-1, 11, 1, 'iron'); vb.set(1, 11, -1, 'iron');
    const base = vb.build();
    const frames = [0, 1].map((f) => {
      const fb = GLT.voxel.builder({ size: 0.25 });
      fb.box(-1, 11, -1, 1, 11, 1, 'fire', 'emissive');
      fb.box(0, 12, 0, 0, 13 + f, 0, 'fire-hot', 'emissive');
      fb.set(f ? 1 : -1, 12, 0, 'fire', 'emissive'); fb.set(0, 12, f ? -1 : 1, 'fire', 'emissive');
      fb.set(f ? -1 : 0, 13 + f, f ? 0 : 1, 'ember-hot', 'emissive');
      fb.set(0, 14 + f, 0, f ? 'fire' : 'ember-hot', 'emissive');
      return fb.build({ castShadow: false });
    });
    const g = new THREE.Group();
    g.add(base, frames[0], frames[1]);
    g.name = 'demo-buoy';
    return { group: g, frames };
  }

  function makeWreck(seed) {
    const vb = GLT.voxel.builder({ size: 0.25 });
    for (let x = -14; x <= 12; x++) {
      const hb = 5 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(x) / 14, 3)));
      for (let y = -2; y <= 3; y++) for (let z = -6; z <= 6; z++) {
        if (Math.abs(z) > hb || (Math.abs(z) < hb - 1.1 && y > -2)) continue;
        if (hash3(x, y, z + seed) > 0.8 && y > 0) continue;
        vb.set(x, y + Math.round(x * 0.12), z, y > 1 ? 'wood-dark' : (y > -1 ? 'wood' : 'wood-deep'));
      }
    }
    for (let y = 3; y < 14; y++) vb.set(-2 + (y >> 2), y, 1, 'wood-dark');
    vb.box(-7, 0, -3, 5, 0, 3, 'ink-2');
    const base = vb.build();
    const frames = [0, 1, 2].map((f) => {
      const fb = GLT.voxel.builder({ size: 0.25 });
      for (let i = 0; i < 30; i++) {
        const x = Math.floor(hash3(i, f, seed) * 16) - 8, z = Math.floor(hash3(i, f + 9, seed) * 7) - 3;
        const h = 1 + Math.floor(hash3(i, f + 4, seed) * (5 - Math.abs(x) * 0.3));
        for (let y = 0; y < h; y++) fb.set(x, 1 + y, z, y === h - 1 ? 'fire-hot' : (y > h - 3 ? 'fire' : 'ember-hot'), 'emissive');
      }
      return fb.build({ castShadow: false });
    });
    const g = new THREE.Group();
    g.add(base);
    frames.forEach((f) => g.add(f));
    g.name = 'demo-wreck';
    return { group: g, frames, fire: { x: 0, y: 1.2, z: 0 } };
  }

  // Smoke: instanced voxel puffs, dark at the source, lighter and bigger as they rise (class 'none': no outline).
  function makeSmoke(count) {
    const geo = new THREE.IcosahedronGeometry(0.62, 1);
    const mat = GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), 'none');
    const m = GLT.voxel.instanced(geo, mat, count);
    m.castShadow = false;
    m.frustumCulled = false;
    const ramp = ['ink-2', 'storm-dark', 'smoke-dark', 'storm-mid', 'smoke'].map((r) => new THREE.Color(P(r)));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < count; i++) m.setColorAt(i, ramp[0]);
    function update(t, origin) {
      for (let i = 0; i < count; i++) {
        const life = (t * 0.3 + i / count) % 1;
        const sz = Math.round((0.6 + life * 1.8) * 4) / 4;
        p.set(origin.x + Math.sin(i * 2.3 + t * 0.6) * (0.3 + life * 1.2) + life * 5, origin.y + life * 13, origin.z + Math.cos(i * 1.7) * 0.6 * life - life * 2);
        s.set(sz, sz, sz);
        m4.compose(p, q, s);
        m.setMatrixAt(i, m4);
        m.setColorAt(i, ramp[Math.min(ramp.length - 1, Math.floor(life * ramp.length))]);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    return { mesh: m, update };
  }

  // Cumulus: merged spheres with flattened bottoms, toon-banded so they snap to white / cloud-shadow / lavender
  // bands (voxel clouds turn to noise; smooth Lambert turns to dithered contours).
  // Cloud material: three flat bands (sun side / body / core shadow + underside) picked per pixel from N.sun, each an
  // exact palette entry chosen per time of day. Drawn in the 'glow' class (no grade, no outline) so the bands land
  // on those entries untouched: clean SoS-style cel clouds instead of hue-hopping dither. One shared material.
  const CLOUD_BANDS = {
    day: ['white', 'cloud-shadow', 'cloud-dark'],
    dusk: ['dusk-gold', 'dusk-cloud', 'dusk-rose'],
    night: ['moonlight', 'night-glow', 'sky-night'],
    storm: ['storm-light', 'storm-mid', 'smoke-dark']
  };
  let cloudMat = null;
  function cloudMaterial() {
    if (cloudMat) return cloudMat;
    const v3 = () => new THREE.Vector3();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLit: { value: v3() }, uMid: { value: v3() }, uDark: { value: v3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uView: { value: new THREE.Vector3(0, -1, 0) }, uFlash: { value: 0 } },
      vertexShader: [
        'varying vec3 vN;',
        'void main() { vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uLit; uniform vec3 uMid; uniform vec3 uDark; uniform vec3 uSun; uniform vec3 uView; uniform float uFlash;',
        'varying vec3 vN;',
        'void main() {',
        '  vec3 n = normalize(vN);',
        '  float d = dot(n, uSun) + n.y * 0.35;',
        // rim: every puff's silhouette (also where it overlaps a neighbour) steps down one band, so puffs read apart
        '  float rim = 1.0 - abs(dot(n, uView));',
        '  float band = d > 0.5 ? 2.0 : (d > -0.2 && n.y > -0.55 ? 1.0 : 0.0);',
        '  if (rim > 0.82) band = max(0.0, band - 1.0);',
        '  vec3 c = band > 1.5 ? uLit : (band > 0.5 ? uMid : uDark);',
        '  gl_FragColor = vec4(mix(c, vec3(1.0), uFlash), ' + GLT.renderer.CLASS_ALPHA.glow.toFixed(2) + ');',
        '}'
      ].join('\n')
    });
    const cur = { lit: null, mid: null, dark: null };
    const toV = (role) => { const n = P(role); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    function update(realDt) {
      const L = GLT.lighting;
      const bands = CLOUD_BANDS[L.tod()] || CLOUD_BANDS.day;
      const k = cur.lit && realDt != null && L.blending() ? Math.min(1, realDt / 0.4) : 1;
      ['lit', 'mid', 'dark'].forEach((key, i) => {
        const tgt = toV(bands[i]);
        if (!cur[key] || k >= 1) cur[key] = tgt;
        else cur[key] = cur[key].map((v, j) => v + (tgt[j] - v) * k);
        const u = mat.uniforms[key === 'lit' ? 'uLit' : key === 'mid' ? 'uMid' : 'uDark'].value;
        u.set(cur[key][0], cur[key][1], cur[key][2]);
      });
      const s = L.sunDir();
      mat.uniforms.uSun.value.set(s.x, s.y, s.z);
      const cam = GLT.camera.three();
      if (cam) cam.getWorldDirection(mat.uniforms.uView.value);
      mat.uniforms.uFlash.value = Math.max(0, Math.min(0.5, (L.hemi() ? L.hemi().intensity - L.presets()[L.tod()].hemiI : 0) * 0.3));
    }
    update();
    cloudMat = { mat, update };
    return cloudMat;
  }

  function makeCloud(seed, scale) {
    const puffs = [[0, 0, 0, 4.4], [4.8, -0.8, 1.2, 3.5], [-4.6, -1, 0.4, 3.3], [1.2, 2.2, -0.8, 3.3], [8.4, -1.6, 0.4, 2.5], [-8.2, -1.8, 1.4, 2.3], [-1.5, 1.2, 2.6, 2.8]];
    const geos = puffs.map(([x, y, z, r], i) => {
      const g = new THREE.SphereGeometry(r * (0.92 + hash3(i, 3, seed) * 0.16), 18, 12);
      const pos = g.getAttribute('position');
      for (let k = 0; k < pos.count; k++) {
        const py = pos.getY(k) + y;
        pos.setXYZ(k, pos.getX(k) + x, Math.max(-1.6, py), pos.getZ(k) + z);
      }
      g.computeVertexNormals();
      return g.index ? g.toNonIndexed() : g;
    });
    const geo = GLT.voxel.mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, cloudMaterial().mat);
    m.castShadow = true; m.receiveShadow = false;
    const g = new THREE.Group();
    g.add(m);
    g.scale.setScalar(scale || 1);
    g.name = 'demo-cloud';
    return g;
  }

  function makeRain(count, seed) {
    const geo = new THREE.BoxGeometry(0.16, 1.7, 0.16);
    const mat = GLT.renderer.markMaterial(new THREE.MeshBasicMaterial({ color: P('sea-glint') }), 'none');
    const m = GLT.voxel.instanced(geo, mat, count);
    m.frustumCulled = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, 0.18)), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const rng = GLT.rng.create(seed);
    const base = [];
    for (let i = 0; i < count; i++) base.push([rng.range(-95, 95), rng.range(0, 34), rng.range(-95, 95), rng.range(0.8, 1.2)]);
    function update(t) {
      for (let i = 0; i < count; i++) {
        const b = base[i];
        const y = 34 - ((b[1] + t * 28 * b[3]) % 34);
        p.set(b[0] + (34 - y) * 0.2, y, b[2] + (34 - y) * 0.25);
        m4.compose(p, q, s);
        m.setMatrixAt(i, m4);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    return { mesh: m, update };
  }

  // ---- the water ----
  // A flat shared-vertex grid (3 m spacing so lantern/fire point lights still pool per vertex) inside a far ring. The
  // fragment shader paints flat palette zones from a coast-distance field (texture: R = metres to land / 32, G = static
  // noise), pulsing 1-texel echo lines parallel to every coast (fwidth-thin), sparse camera-aligned ripple dashes that
  // blink, a sun/moon path and V wakes behind sailing ships. Zone colours are authored as OUTPUT palette entries per
  // time of day and converted with GLT.lighting.albedoFor, so sunlit water snaps flat (no screen-door dither); shadows
  // and point lights still darken / warm it.
  const SEA_SETS = {
    day:   { deep: '#062440', base: '#0a3157', mid: '#103e68', shal: '#255553', shal2: '#367064', rip: '#174e78', rip2: '#428ea4', line: '#9cd2cc', path: '#64acb6', wake: '#dcf2ea' },
    dusk:  { deep: '#142048', base: '#22336a', mid: '#2e2050', shal: '#463f5c', shal2: '#6c6684', rip: '#5a2f68', rip2: '#c95c66', line: '#eda0a0', path: '#f8b878', wake: '#f8b878' },
    night: { deep: '#062440', base: '#0a3157', mid: '#103e68', shal: '#173d43', shal2: '#255553', rip: '#103e68', rip2: '#2d7493', line: '#428ea4', path: '#64acb6', wake: '#9cd2cc' },
    storm: { deep: '#283044', base: '#2f3e43', mid: '#2f3e43', shal: '#255553', shal2: '#367064', rip: '#4f6266', rip2: '#9cd2cc', line: '#9cd2cc', path: '#7d949a', wake: '#dcf2ea' }
  };
  const SEA_KEYS = ['deep', 'base', 'mid', 'shal', 'shal2', 'rip', 'rip2', 'line', 'path', 'wake'];
  const SEA_VERT_PARS = 'varying vec2 vXZ;\n';
  const SEA_VERT = '  vXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\n';
  const SEA_FRAG_PARS = [
    'varying vec2 vXZ;',
    'uniform float uTime;',
    'uniform sampler2D uField;',
    'uniform vec4 uFieldBox;',
    'uniform vec2 uRight;',
    'uniform float uDashH;',
    'uniform float uChop;',
    'uniform vec2 uSun;',
    'uniform float uPath;',
    'uniform vec4 uWake0; uniform vec4 uWake1;',
    'uniform vec3 uDeep; uniform vec3 uBase; uniform vec3 uMid; uniform vec3 uShal; uniform vec3 uShal2;',
    'uniform vec3 uRip; uniform vec3 uRip2; uniform vec3 uLine; uniform vec3 uPathC; uniform vec3 uWake;',
    'float seaHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float wakeAt(vec4 w, vec2 p, float t) {',
    '  vec2 rel = p - w.xy; float along = -dot(rel, w.zw); float perp = dot(rel, vec2(-w.w, w.z));',
    '  if (along < 0.0 || along > 24.0) return 0.0;',
    '  float fw = max(fwidth(perp), 0.05);',
    '  float arm = abs(abs(perp) - (1.1 + along * 0.26));',
    '  float k = 0.0;',
    '  if (arm < fw * 0.6 && (along < 8.0 || fract(along * 0.16 - t * 0.6) < 0.9 - along * 0.03)) k = 1.0;',
    '  if (along < 7.0 && abs(perp) < 1.2 - along * 0.1 && seaHash(floor(p * 2.6) + floor(t * 6.0)) > 0.45) k = 1.0;',
    '  return k;',
    '}',
    ''
  ].join('\n');
  const SEA_FRAG = [
    '{',
    '  vec2 fuv = (vXZ - uFieldBox.xy) / uFieldBox.zw;',
    '  vec4 F = texture2D(uField, clamp(fuv, 0.0, 1.0));',
    '  float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);',
    '  float d = mix(32.0, F.r * 32.0, inside);',
    '  float nz = mix(0.5, F.g, inside);',
    '  float dd = d + (nz - 0.5) * 5.0;',
    '  vec3 c = uBase;',
    '  float zone = 2.0;',
    '  if (dd < 2.2) { c = uShal2; zone = 0.0; } else if (dd < 5.5) { c = uShal; zone = 0.0; } else if (dd < 9.5) { c = uMid; zone = 1.0; } else if (dd > 19.0 && nz < 0.56) { c = uDeep; zone = 3.0; }',
    // camera-aligned ripple dashes, one texel tall, various lengths, blinking
    '  vec2 q = vec2(dot(vXZ, uRight), dot(vXZ, vec2(-uRight.y, uRight.x)));',
    '  float row = floor(q.y / uDashH);',
    '  float seg = 2.2 + seaHash(vec2(row, 3.7)) * 2.6;',
    '  float qx = q.x + uTime * 0.35 + seaHash(vec2(row, 9.1)) * 40.0;',
    '  float si = floor(qx / seg);',
    '  float fr = fract(qx / seg);',
    '  float blink = floor(uTime * 0.8 + seaHash(vec2(si, row)) * 7.0);',
    '  float hs = seaHash(vec2(si * 1.31 + blink * 0.37, row * 0.73));',
    '  float len = 0.25 + seaHash(vec2(si, row + 5.0)) * 0.35;',
    '  float onDash = step(fr, len);',
    // sun / moon path: a band through the scene centre toward the light (more and brighter dashes)
    '  float sp = abs(dot(vXZ, vec2(-uSun.y, uSun.x)));',
    '  float along = dot(vXZ, uSun);',
    '  float inPath = uPath * step(sp, 7.0 + along * 0.05) * step(-10.0, along);',
    '  float thr = 0.9 - uChop * 0.14 - inPath * 0.32 - (zone < 0.5 ? 0.04 : 0.0);',
    '  if (onDash > 0.5 && hs > thr) c = (inPath > 0.5 && hs > thr + 0.06) ? uPathC : (hs > 0.975 - uChop * 0.06 ? uRip2 : (zone < 0.5 ? uShal2 : uRip));',
    // echo lines parallel to the coast (thin: fwidth), breathing in and out
    '  float fw = max(fwidth(d), 0.02);',
    '  float l1 = 1.5 + 0.55 * sin(uTime * 1.1);',
    '  float l2 = 3.6 + 0.7 * sin(uTime * 1.1 - 1.3);',
    '  if (inside > 0.5 && ((abs(d - l1) < fw * 0.55 && nz > 0.3) || (abs(d - l2) < fw * 0.55 && nz > 0.42 && nz < 0.72))) c = uLine;',
    '  float wk = max(wakeAt(uWake0, vXZ, uTime), wakeAt(uWake1, vXZ, uTime));',
    '  if (wk > 0.5) c = uLine;',
    '  diffuseColor.rgb = c;',
    '}',
    ''
  ].join('\n');

  // Coast-distance field: land mask sampled at texel centres, two-pass 3-4 chamfer distance (metres), plus noise.
  function makeField(isLand, box, N, seed) {
    const cell = box.size / N;
    const INF = 1e9;
    const dist = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) dist[j * N + i] = isLand(box.x + (i + 0.5) * cell, box.z + (j + 0.5) * cell) ? 0 : INF;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let v = dist[j * N + i];
      if (i > 0) v = Math.min(v, dist[j * N + i - 1] + a);
      if (j > 0) { v = Math.min(v, dist[(j - 1) * N + i] + a); if (i > 0) v = Math.min(v, dist[(j - 1) * N + i - 1] + b); if (i < N - 1) v = Math.min(v, dist[(j - 1) * N + i + 1] + b); }
      dist[j * N + i] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      let v = dist[j * N + i];
      if (i < N - 1) v = Math.min(v, dist[j * N + i + 1] + a);
      if (j < N - 1) { v = Math.min(v, dist[(j + 1) * N + i] + a); if (i < N - 1) v = Math.min(v, dist[(j + 1) * N + i + 1] + b); if (i > 0) v = Math.min(v, dist[(j + 1) * N + i - 1] + b); }
      dist[j * N + i] = v;
    }
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = (j * N + i) * 4;
      const dm = Math.max(0, dist[j * N + i] * cell - cell * 0.5);
      data[o] = Math.min(255, Math.round((dm / 32) * 255));
      data[o + 1] = Math.round(fbm(i * 0.06, j * 0.06, seed) * 255);
      data[o + 2] = 0; data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  function makeSea(o) {
    const G = o.grid || 3, NG = o.n || 72, half = (NG * G) / 2;
    const U = {
      uTime: { value: 0 }, uField: { value: o.field }, uFieldBox: { value: new THREE.Vector4(o.box.x, o.box.z, o.box.size, o.box.size) },
      uRight: { value: new THREE.Vector2(1, 0) }, uDashH: { value: 0.4 }, uChop: { value: 0 },
      uSun: { value: new THREE.Vector2(1, 0) }, uPath: { value: 0 },
      uWake0: { value: new THREE.Vector4(0, 0, 1, 0) }, uWake1: { value: new THREE.Vector4(0, 0, 1, 0) }
    };
    const NAMES = { deep: 'uDeep', base: 'uBase', mid: 'uMid', shal: 'uShal', shal2: 'uShal2', rip: 'uRip', rip2: 'uRip2', line: 'uLine', path: 'uPathC', wake: 'uWake' };
    SEA_KEYS.forEach((k) => { U[NAMES[k]] = { value: new THREE.Vector3(0.1, 0.2, 0.4) }; });
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.extensions = { derivatives: true };
    mat.onBeforeCompile = function (shader) {
      Object.keys(U).forEach((k) => { shader.uniforms[k] = U[k]; });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SEA_VERT_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SEA_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SEA_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + SEA_FRAG);
    };
    mat.customProgramCacheKey = () => 'glt-demo-sea-2';
    GLT.renderer.markMaterial(mat, 'water');
    const p = [], ix = [];
    for (let j = 0; j <= NG; j++) for (let i = 0; i <= NG; i++) p.push(-half + i * G, 0, -half + j * G);
    for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
      const a = j * (NG + 1) + i, b = a + 1, c = a + NG + 1, d = c + 1;
      ix.push(a, c, b, b, c, d);
    }
    const R = 2400;
    [[-R, -R, R, -half], [-R, half, R, R], [-R, -half, -half, half], [half, -half, R, half]].forEach((r) => {
      const b = p.length / 3;
      p.push(r[0], 0, r[3], r[2], 0, r[3], r[2], 0, r[1], r[0], 0, r[1]);
      ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const nrm = new Float32Array(p.length);
    for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(ix);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.name = 'demo-sea';
    const tmp = [0, 0, 0];
    return {
      mesh, uniforms: U,
      update(t, wakes) {
        const L = GLT.lighting;
        U.uTime.value = t;
        U.uChop.value = L.stormFactor();
        // colours: blend the per-tod sets by the lighting state (tod transitions blend smoothly too)
        const set = SEA_SETS[L.tod()] || SEA_SETS.day;
        SEA_KEYS.forEach((k) => { L.albedoFor(set[k], tmp); U[NAMES[k]].value.set(tmp[0], tmp[1], tmp[2]); });
        const az = (GLT.camera.azimuth() * Math.PI) / 180;
        U.uRight.value.set(Math.cos(az), -Math.sin(az));
        const el = (GLT.camera.elevation() * Math.PI) / 180;
        U.uDashH.value = GLT.camera.worldPerPixel() / Math.max(0.2, Math.sin(el));
        const sd = L.sunDir();
        const sl = Math.hypot(sd.x, sd.z) || 1;
        U.uSun.value.set(sd.x / sl, sd.z / sl);
        U.uPath.value = L.tod() === 'dusk' || L.tod() === 'night' ? 1 : 0;
        if (wakes && wakes[0]) U.uWake0.value.set(wakes[0].x, wakes[0].z, wakes[0].dx, wakes[0].dz);
        if (wakes && wakes[1]) U.uWake1.value.set(wakes[1].x, wakes[1].z, wakes[1].dx, wakes[1].dz);
      }
    };
  }

  // ---- the core demo ----
  function buildCore(ctx, opt) {
    opt = opt || {};
    if (!ctx.webgl) return;
    const seed = ctx.seed >>> 0;
    const scene = GLT.scene;
    if (opt.px) GLT.renderer.setPixelSize(opt.px);
    if (opt.post) GLT.renderer.setPost(opt.post);

    const tm = {}; let tl = GLT.clock.realNow();
    const lap = (k) => { const n = GLT.clock.realNow(); tm[k] = Math.round(n - tl); tl = n; };
    GLT._render_demos.timing = tm;
    const land = makeLand(seed + 11);
    lap('land');
    scene.add(land.group, 'world');
    const archAt = W(48, 14);
    const arch = makeArch(seed + 23, archAt, 0.35);
    scene.add(arch.group, 'world');
    const rocks = makeRocks(seed + 31, W(30, 40), [[0, 0, 7], [11, 5, 4.5], [-8, 8, 3.5], [5, -10, 3]]);
    scene.add(rocks.group, 'world');
    const rocks2 = makeRocks(seed + 37, W(-6, -58), [[0, 0, 4], [6, 3, 2.6]]);
    scene.add(rocks2.group, 'world');
    lap('rocks');

    const discs = arch.discs.concat(rocks.discs, rocks2.discs);
    const isLand = (x, z) => {
      if ((land.H(Math.floor(x / VS), Math.floor(z / VS)) || 0) > 0) return true;
      for (let i = 0; i < discs.length; i++) { const d = discs[i]; if ((x - d.x) * (x - d.x) + (z - d.z) * (z - d.z) < d.r * d.r) return true; }
      return false;
    };
    const box = { x: -128, z: -128, size: 256 };
    const field = makeField(isLand, box, 256, seed + 5);
    const sea = makeSea({ field, box, grid: 3, n: 80 });
    scene.add(sea.mesh, 'world');
    lap('sea');

    // ships: one moored at the dock, one sailing with a wake, one sloop further out
    const moored = makeShip({ trim: 'red', stripe: true });
    const mooredRoot = new THREE.Group();
    mooredRoot.add(moored.group);
    mooredRoot.position.set((land.dock.x0 + land.dock.x1) / 2 + 2, 0, land.dock.z + 5.2);
    scene.add(mooredRoot, 'ships');
    const sail = makeShip({ trim: 'blue', len: 44, beam: 5.5, masts: [{ x: 5, h: 36, top: 32, bot: 12, half: 9 }, { x: -9, h: 30, top: 27, bot: 12, half: 7 }] });
    const sailRoot = new THREE.Group();
    sailRoot.add(sail.group);
    const sp = W(18, -14);
    const head = { x: -0.32, z: 0.95 };
    const hl = Math.hypot(head.x, head.z); head.x /= hl; head.z /= hl;
    sailRoot.position.set(sp.x, 0, sp.z);
    sailRoot.rotation.y = Math.atan2(-head.z, head.x);
    scene.add(sailRoot, 'ships');
    const sloop = makeShip({ trim: 'green', len: 32, beam: 4.5, masts: [{ x: 2, h: 30, top: 26, bot: 10, half: 7 }] });
    const sloopRoot = new THREE.Group();
    sloopRoot.add(sloop.group);
    const slp = W(46, -40);
    const head2 = { x: 0.95, z: -0.3 };
    sloopRoot.position.set(slp.x, 0, slp.z);
    sloopRoot.rotation.y = Math.atan2(-head2.z, head2.x);
    scene.add(sloopRoot, 'ships');

    const buoys = [[2, 2], [30, 6], [-30, -12], [12, -44]].map(([u, v], i) => {
      const b = makeBuoy();
      const p = W(u, v);
      b.group.position.set(p.x, 0, p.z);
      scene.add(b.group, 'props');
      return Object.assign(b, { p, i });
    });

    const wreck = makeWreck(seed + 41);
    const wp0 = W(-20, -20);
    wreck.group.position.set(wp0.x, 0, wp0.z);
    wreck.group.rotation.y = -0.6;
    scene.add(wreck.group, 'props');
    const smoke = makeSmoke(30);
    scene.add(smoke.mesh, 'fx');

    const clouds = [makeCloud(seed + 51, 1.2), makeCloud(seed + 52, 1)];
    const cloudBase = [W(58, 22), W(-56, -60)].map((p, i) => ({ x: p.x, y: i ? 18 : 24, z: p.z }));
    clouds.forEach((c) => scene.add(c, 'world'));

    const storm = ctx.tod === 'storm';
    const rain = storm ? makeRain(520, seed + 61) : null;
    if (rain) scene.add(rain.mesh, 'fx');
    lap('props');

    // lights (pool: 3 point + 1 spot)
    const L = GLT.lighting;
    const fireLamp = L.addLight({ type: 'point', intensity: 2.4, distance: 20, decay: 2, night: false, flicker: 0.9, seed: 3, color: P('fire') });
    const dockLamp = L.addLight({ type: 'point', intensity: 2.0, distance: 18, decay: 2, night: true, flicker: 0.15, seed: 1 });
    const campLamp = L.addLight({ type: 'point', intensity: 2.2, distance: 15, decay: 2, night: true, flicker: 0.7, seed: 2, color: P('fire') });
    L.lighthouse(land.lamp, { length: 80, radius: 8, speed: 0.5, phase: 2.5 });
    if (dockLamp) { const a = land.dockLamps[0], b = land.dockLamps[1]; dockLamp.set({ position: { x: (a.x + b.x) / 2, y: a.y + 0.8, z: (a.z + b.z) / 2 + 2 } }); }
    if (campLamp) campLamp.set({ position: { x: land.campfire.x, y: land.campfire.y + 1.2, z: land.campfire.z } });

    const fireWorld = new THREE.Vector3();
    const wakes = [{ x: 0, z: 0, dx: 1, dz: 0 }, { x: 0, z: 0, dx: 1, dz: 0 }];
    const tStatic = opt.staticT;
    GLT.clock.onFrame((dt, tt, realDt) => {
      const t = tStatic != null ? tStatic : tt;
      cloudMaterial().update(realDt);
      const nightOn = L.nightFactor() > 0.3;
      land.night.visible = nightOn;
      land.day.visible = !nightOn;
      // bob (<= 3 deg roll, 2 deg pitch, 0.25 m heave), heave quantised to 1/4 voxel
      moored.group.rotation.x = Math.sin(t * 1.1) * 0.025;
      moored.group.position.y = Math.round((Math.sin(t * 0.9) * 0.15) / 0.0625) * 0.0625;
      sail.group.rotation.x = Math.sin(t * 1.3) * 0.045;
      sail.group.rotation.z = Math.sin(t * 0.9 + 1) * 0.03;
      sail.group.position.y = Math.round((Math.sin(t * 1.1) * 0.22) / 0.0625) * 0.0625;
      sloop.group.rotation.x = Math.sin(t * 1.5 + 2) * 0.05;
      sloop.group.position.y = Math.round((Math.sin(t * 1.3 + 1) * 0.2) / 0.0625) * 0.0625;
      const sh = (s, root, hd, w, len) => { w.x = root.position.x - hd.x * len * 0.45; w.z = root.position.z - hd.z * len * 0.45; w.dx = hd.x; w.dz = hd.z; };
      sh(sail, sailRoot, head, wakes[0], sail.length);
      sh(sloop, sloopRoot, head2, wakes[1], sloop.length);
      buoys.forEach((b) => {
        b.group.position.y = Math.sin(t * 1.7 + b.i * 2) * 0.12;
        b.group.rotation.z = Math.sin(t * 1.3 + b.i) * 0.06;
        const f = Math.floor(t * 7 + b.i) % 2;
        b.frames[0].visible = f === 0; b.frames[1].visible = f === 1;
      });
      const wf = Math.floor(t * 9) % 3;
      wreck.frames.forEach((fr, i) => { fr.visible = i === wf; });
      fireWorld.set(wreck.fire.x, wreck.fire.y, wreck.fire.z);
      wreck.group.localToWorld(fireWorld);
      if (fireLamp) fireLamp.set({ position: { x: fireWorld.x, y: fireWorld.y + 1.5, z: fireWorld.z } });
      smoke.update(t, { x: fireWorld.x, y: fireWorld.y + 1.5, z: fireWorld.z });
      clouds.forEach((c, i) => { const b = cloudBase[i]; c.position.set(b.x + Math.round(((t * 0.8) % 30) * 4) / 4 - 15, b.y, b.z); });
      sea.update(t, wakes);
      if (rain) rain.update(t);
      if (storm) {
        const ph = t % 5.3;   // deterministic lightning: one strike every ~5.3 s
        if (ph < 0.016 && tt > 0.1) L.flash(0.9, 200);
      }
      // camera moves follow the real game time even when the scene animation is pinned (staticT), so a pan/orbit
      // sequence isolates what the camera snap alone does to static geometry
      if (opt.pan) GLT.camera.set({ target: { x: opt.pan.x0 + tt * opt.pan.vx, y: 0, z: opt.pan.z0 + tt * opt.pan.vz } }, { instant: true });
      if (opt.orbit) GLT.camera.set({ azimuth: 45 + tt * opt.orbit }, { instant: true });
    }, 100);

    // the scene is framed for zoom 1 at game scale: no 'both' auto-fit (it would widen the view)
    GLT.camera.setMode('own', { instant: true });
    GLT.camera.set({ azimuth: 45, elevation: 35, zoom: 1, target: { x: 0, y: 0, z: 0 } }, { instant: true });
    sea.update(0, wakes);
  }

  function palette(ctx) {
    if (!ctx.webgl) return;
    const board = new THREE.Group();
    const cols = GLT.palette.colors;
    const Wd = 112, Hd = 64;
    const sw = 10, rows = 9, cw = Wd / sw, ch = 4.6;
    const mats = {};
    cols.forEach((hex, i) => {
      const m = mats[hex] || (mats[hex] = new THREE.MeshBasicMaterial({ color: parseInt(hex.slice(1), 16), fog: false }));
      const q = new THREE.Mesh(new THREE.PlaneGeometry(cw - 0.8, ch - 0.8), m);
      q.position.set(-Wd / 2 + cw * ((i % sw) + 0.5), Hd / 2 - ch * (Math.floor(i / sw) + 0.5), 0);
      board.add(q);
    });
    const ramps = [
      ['sea-night', 'sea-abyss', 'sea-deep', 'sea', 'sea-mid', 'sea-light', 'sea-glint', 'sea-foam', 'foam'],
      ['sky-dusk-top', 'dusk-violet', 'dusk-rose', 'dusk-coral', 'sky-dusk', 'dusk-gold', 'sail'],
      ['fire-deep', 'ember', 'ember-hot', 'fire', 'lantern', 'fire-hot', 'white'],
      ['foliage-deep', 'foliage-dark', 'vine', 'grass-dark', 'grass', 'foliage-light', 'foliage-sun'],
      ['storm-dark', 'iron', 'storm-mid', 'storm-light', 'cloud-dark', 'cloud-shadow', 'cloud']
    ];
    const rampTop = Hd / 2 - ch * rows - 1.2;
    ramps.forEach((r, k) => {
      const seg = 64;
      const geo = new THREE.PlaneGeometry(Wd - 0.8, 2.2, seg, 1);
      const pos = geo.getAttribute('position');
      const colArr = new Float32Array(pos.count * 3);
      const c = new THREE.Color(), c2 = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const u = (pos.getX(i) + (Wd - 0.8) / 2) / (Wd - 0.8);
        const f = u * (r.length - 1), a = Math.min(r.length - 2, Math.floor(f));
        c.setHex(GLT.palette.get(r[a])); c2.setHex(GLT.palette.get(r[a + 1]));
        c.lerp(c2, f - a);
        colArr[i * 3] = c.r; colArr[i * 3 + 1] = c.g; colArr[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
      const q = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
      q.position.set(0, rampTop - k * 2.6, 0);
      board.add(q);
    });
    // 'glow' class: no outline and no time-of-day grade, so each swatch shows its exact palette entry under any ?tod=
    board.traverse((o) => { if (o.material) GLT.renderer.markMaterial(o.material, 'glow'); });
    GLT.scene.add(board, 'ui3d');
    GLT.scene.onBeforeRender(() => {
      const cam = GLT.camera.three();
      board.quaternion.copy(cam.quaternion);
      board.position.copy(GLT.camera.get().target);
    });
    GLT.camera.set({ zoom: 1.08, target: { x: 0, y: 0, z: 0 } }, { instant: true });
  }

  GLT._render_demos = { buildCore, palette, hash3, vnoise, fbm, makeSea, makeField, makeLand, makeShip, makeArch, makeCloud, SEA_SETS };
  GLT.demos = GLT.demos || {};
  GLT.demos['render.core'] = function (ctx) { return buildCore(ctx, {}); };
  GLT.demos['core'] = GLT.demos['render.core'];
  GLT.demos['render.core.raw'] = function (ctx) { return buildCore(ctx, { post: { raw: true } }); };
  GLT.demos['render.core.flat'] = function (ctx) { return buildCore(ctx, { post: { dither: false } }); };
  GLT.demos['render.core.nolines'] = function (ctx) { return buildCore(ctx, { post: { outlines: false } }); };
  GLT.demos['render.core.px1'] = function (ctx) { return buildCore(ctx, { px: 1 }); };
  GLT.demos['render.core.px3'] = function (ctx) { return buildCore(ctx, { px: 3 }); };
  GLT.demos['render.core.px4'] = function (ctx) { return buildCore(ctx, { px: 4 }); };
  GLT.demos['render.core.pan'] = function (ctx) { return buildCore(ctx, { staticT: 1.0, pan: { x0: -6, z0: 2, vx: 1.7, vz: -0.9 } }); };
  GLT.demos['render.core.orbit'] = function (ctx) { return buildCore(ctx, { staticT: 1.0, orbit: 9 }); };
  GLT.demos['render.palette'] = palette;
})();
