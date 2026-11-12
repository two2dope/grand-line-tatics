/* GLT.backdrop: the 8-sector scenery ring + the doll's-house lift. Area: world. Contract: ARCHITECTURE.md §9, §11.1.
 *
 * Sector k covers azimuths [k*45-22.5, k*45+22.5) (az 0 = +Z, south). Every object beyond 70 m lives in exactly one
 * sector group; each group holds ONE merged static mesh per material class plus its few animated parts:
 *   0 S  rock arch islet                                (+ props: small Den Den Mushi board, torch buoys)
 *   1 SE Sea Kings, group A (surfacing loop)
 *   2 E  Laboon (bob + spout)                            (+ props: lighthouse)
 *   3 NE Marineford split plaza + HQ, Marine warships in formation (instanced), Red Line piece
 *   4 N  Red Line wall, Reverse Mountain with the canal flowing UP to Skypiea (cloud island + swinging golden bell)
 *                                                        (+ props: big Den Den Mushi board)
 *   5 NW Sabaody mangroves + rising soap bubbles (instanced), Red Line piece
 *   6 W  Sea Kings, group B, rock-fall sea stack (instanced falling rocks)
 *   7 SW floating chunks (bobbing)                       (+ props: torch buoys)
 * Content stays within ±16° of its sector centre, so a sector that is not lifted can never cover the plates.
 *
 * Lift: sector k is near when angDist(k*45, camera azimuth) <= 67.5° (GLT.layout.nearSectors). Near sectors rise
 * C.LIFT_H with easeInOutCubic over C.T.liftS (real time, so pause does not freeze it); on arrival they stop casting
 * shadows and are hidden. Lowering shows them first and restores shadows on landing. Active only when prefs.lift is on
 * and the camera mode is neither 'ceremony' nor 'panorama'. Reduced motion = instant. Emits lift:changed.
 * Ambient life: a blimp and a News Coo flock always cruise on the far side of the arena (relative to the camera), so
 * they add life without ever crossing in front of the plates. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const S = {
    ok: false, root: null, groups: [], lift: [0, 0, 0, 0, 0, 0, 0, 0], liftDir: [0, 0, 0, 0, 0, 0, 0, 0], landed: [true, true, true, true, true, true, true, true],
    enabled: true, active: false, anim: [], offs: [], first: true, shadowFlags: [], ambient: null, forceLow: false
  };
  function K() { return GLT._world_kit; }
  const D2R = Math.PI / 180;

  // sector frame: world point from (sector k, radial distance, lateral offset)
  function sp(k, r, lat) {
    const a = k * 45 * D2R;
    return { x: Math.sin(a) * r + Math.cos(a) * (lat || 0), z: Math.cos(a) * r - Math.sin(a) * (lat || 0), yaw: a };
  }

  // ------------------------------------------------------------------ voxel shape helpers (world coords / voxel size)
  function colOf(col, x, y, z, info) { return typeof col === 'function' ? col(x, y, z, info) : col; }
  // filled ellipsoid shell (voxel units)
  function ell(vb, cx, cy, cz, rx, ry, rz, col, cls) {
    const ins = (x, y, z) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          // filled solid (not a shell) so overlapping blobs cull each other's hidden faces
          if (!ins(x + 0.5, y + 0.5, z + 0.5)) continue;
          vb.set(x, y, z, colOf(col, x, y, z, (y - cy) / ry), cls);
        }
  }
  // heightfield: h(x,z) -> top voxel j (or < -50 = empty); fills down to the lowest neighbour so cliffs are solid.
  function hf(vb, xa, xb, za, zb, h, col, floor) {
    const fl = floor == null ? -1 : floor;
    const W = xb - xa + 3, cache = new Float64Array(W * (zb - za + 3));
    const at = (x, z) => cache[(x - xa + 1) * (zb - za + 3) + (z - za + 1)];
    for (let x = xa - 1; x <= xb + 1; x++) for (let z = za - 1; z <= zb + 1; z++) cache[(x - xa + 1) * (zb - za + 3) + (z - za + 1)] = h(x, z);
    for (let x = xa; x <= xb; x++) for (let z = za; z <= zb; z++) {
      const top = Math.floor(at(x, z));
      if (top < -50) continue;
      let low = Math.min(at(x + 1, z), at(x - 1, z), at(x, z + 1), at(x, z - 1));
      low = low < -50 ? fl : Math.max(fl, Math.min(top - 1, Math.floor(low) + 1));
      for (let y = low; y <= top; y++) vb.set(x, y, z, colOf(col, x, y, z, top));
    }
  }
  // vertical cylinder shell
  function cyl(vb, cx, cz, r, y0, y1, col, cls) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d > r) continue;
      for (let y = y0; y <= y1; y++) vb.set(x, y, z, colOf(col, x, y, z, d), cls);
    }
  }

  // shoreline foam for an island voxel builder (cells of size s; land = a voxel at the waterline layers)
  let FOAMS = null;
  function addFoam(vb, s, i0, i1, k0, k1, ph) {
    if (!FOAMS) return;
    const g = K().foamGeometry((i, k) => vb.get(i, 0, k) != null || vb.get(i, -1, k) != null, i0, i1, k0, k1, s, 0, 0, { y: 0.06, phase: ph || 0 });
    if (g) FOAMS.push(g);
  }

  // ------------------------------------------------------------------ content per sector
  // Red Line wall piece for sector k (2 m voxels), radius 286..306, height ~150 m with strata and a cloud belt.
  function redLine(k, vb) {
    const s = 2, r0 = 284, r1 = 306;
    const a0 = (k * 45 - 22.5) * D2R, a1 = (k * 45 + 22.5) * D2R;
    const k2 = K();
    const xs = [], zs = [];
    for (let q = 0; q <= 8; q++) { const a = a0 + (a1 - a0) * q / 8; [r0, r1].forEach((r) => { xs.push(Math.sin(a) * r); zs.push(Math.cos(a) * r); }); }
    const xa = Math.floor(Math.min.apply(null, xs) / s) - 1, xb = Math.ceil(Math.max.apply(null, xs) / s) + 1;
    const za = Math.floor(Math.min.apply(null, zs) / s) - 1, zb = Math.ceil(Math.max.apply(null, zs) / s) + 1;
    const lo = k * 45 - 22.5, hi = k * 45 + 22.5;
    hf(vb, xa, xb, za, zb, (x, z) => {
      const wx = (x + 0.5) * s, wz = (z + 0.5) * s;
      const r = Math.hypot(wx, wz);
      let az = Math.atan2(wx, wz) / D2R; if (az < 0) az += 360;
      let inside = az >= lo && az < hi;
      if (lo < 0) inside = az >= lo + 360 || az < hi;
      const n = k2.noise2(wx * 0.03, wz * 0.03, 5);
      const front = r0 + n * 6;
      if (!inside || r < front || r > r1) return -99;
      // mesas and saddles so the sky shows above the wall in the panorama
      const ridge = (k2.noise2(az * 0.22, 1, 9) - 0.5) * 80 + (k2.noise2(az * 0.9, 2, 9) - 0.5) * 22 + (k2.noise2(az * 2.6, 3, 9) > 0.62 ? 10 : 0);
      return Math.floor((58 + ridge - (r - front) * 0.6) / s);
    }, (x, y, z, top) => {
      if (y >= top) return k2.hash3(x, y, z) < 0.5 ? 'grass-dark' : 'foliage-dark';
      if (y === top - 1) return 'grass-dark';
      const yy = y + Math.floor(k2.noise2(x * 0.11, z * 0.11, 3) * 3);
      const band = ((yy % 9) + 9) % 9;
      if (band < 3) return 'terracotta';
      if (band < 5) return k2.hash3(x, y, z) < 0.3 ? 'red-dark' : 'soil-dark';
      if (band < 7) return 'soil';
      return k2.hash3(x, y, z) < 0.5 ? 'sand' : 'terracotta';
    }, -1);
    addFoam(vb, s, xa, xb, za, zb, k * 31);
    // cloud belt hugging the wall at ~70 m
    const r = k2.rng(300 + k, 'belt');
    for (let q = 0; q < 7; q++) {
      const a = (lo + 3 + r.next() * 39) * D2R;
      const rr = r0 - 8 - r.next() * 8;
      const cx = Math.sin(a) * rr / s, cz = Math.cos(a) * rr / s;
      ell(vb, cx, 34 + r.next() * 8, cz, 9 + r.next() * 6, 2.5 + r.next() * 1.5, 5, (x, y, z, ny) => (ny < -0.2 ? 'cloud-shadow' : 'cloud'));
    }
  }

  function rockArch(acc) {
    const vb = K().vb(1);
    const k2 = K();
    const c = sp(0, 128, 6);
    const cx = Math.round(c.x), cz = Math.round(c.z);
    hf(vb, cx - 16, cx + 16, cz - 12, cz + 12, (x, z) => {
      const d = Math.hypot((x - cx) / 15, (z - cz) / 10);
      if (d > 1) return -99;
      return Math.floor(3 + (1 - d) * 4 + k2.noise2(x * 0.3, z * 0.3, 2) * 2);
    }, (x, y, z, top) => (y === top ? (k2.hash3(x, y, z) < 0.3 ? 'sand-light' : 'grass') : y < 2 ? 'rock-dark' : 'rock'), -1);
    addFoam(vb, 1, cx - 17, cx + 17, cz - 13, cz + 13, 3);
    // arch: two legs and a lintel arc (yaw follows the sector so it frames the open sea)
    for (let t = 0; t <= 60; t++) {
      const a = Math.PI * t / 60;
      const px = cx + Math.cos(a) * 11, py = 6 + Math.sin(a) * 18;
      const th = 2.4 + (1 - Math.sin(a)) * 1.8;
      for (let dx = -th; dx <= th; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
        const x = Math.round(px + dx * Math.sin(a) * 0.7), y = Math.round(py + dy + dx * Math.cos(a) * 0.4), z = cz + dz;
        vb.set(x, y, z, k2.hash3(x, y, z) < 0.15 ? 'moss' : y > 20 ? 'rock-light' : (y + x) % 5 === 0 ? 'rock-dark' : 'rock');
      }
    }
    for (let q = 0; q < 14; q++) { const x = cx - 3 + q % 7, z = cz - 2 + Math.floor(q / 7) * 4; vb.set(x, 25, z, 'grass'); vb.set(x, 24, z, 'grass-dark'); }
    K().addVox(acc, vb, null, { ao: 0.5 });
  }

  function seaKing(seed, scheme) {
    // serpent built once in local coords: body humps along +X, head at +X end; waterline at local y = 0
    const vb = K().vb(1);
    const k2 = K();
    const R = 2.4;
    for (let t = 0; t <= 1.0001; t += 0.004) {
      const x = -26 + t * 52;
      const hump = Math.sin(t * Math.PI * 2.5) * 6 + 1;
      const y = Math.max(-3, hump);
      const z = Math.sin(t * 5) * 3;
      const rr = R * (0.7 + 0.3 * Math.sin(t * Math.PI));
      for (let a = 0; a < 16; a++) {
        const ang = a / 16 * Math.PI * 2;
        const px = Math.round(x), py = Math.round(y + Math.sin(ang) * rr), pz = Math.round(z + Math.cos(ang) * rr);
        vb.set(px, py, pz, Math.sin(ang) < -0.4 ? scheme.belly : (Math.floor(x / 3) % 2 === 0 ? scheme.body : scheme.stripe));
      }
      if (Math.floor(t * 250) % 9 === 0) for (let f = 1; f <= 3; f++) vb.set(Math.round(x), Math.round(y + rr + f), Math.round(z), scheme.fin);
    }
    // head rising out of the water at the +X end
    const hx = 28, hy = 12;
    for (let y = 0; y < hy; y++) ell(vb, 26 + y * 0.2, y, 0, 2.6, 1.2, 2.6, (x, yy) => (yy < 4 ? scheme.belly : scheme.body));
    ell(vb, hx, hy, 0, 5.5, 3.2, 3.6, (x, y, z, ny) => (ny < -0.3 ? scheme.belly : scheme.body));
    ell(vb, hx + 4, hy - 1.4, 0, 3.4, 1.4, 2.6, scheme.belly);
    for (let s = -1; s <= 1; s += 2) {
      vb.set(hx + 2, hy + 2, s * 3, 'yellow'); vb.set(hx + 3, hy + 2, s * 3, 'black');
      for (let f = 0; f < 4; f++) vb.set(hx - 2 - f, hy + 2 + f, s * (3 + f), scheme.fin);
    }
    for (let q = 0; q < 4; q++) vb.set(hx + 5 + (q % 2), hy - 2, -1 + q, 'white');
    for (let f = 0; f < 6; f++) vb.set(hx - 3 - f, hy + 3 + (f >> 1), 0, scheme.fin);
    void seed; void k2;
    return vb;
  }

  function laboon() {
    const vb = K().vb(1);
    const k2 = K();
    const body = (x, y, z, ny) => (ny < -0.35 ? 'slate-light' : k2.hash3(x, y, z) < 0.06 ? 'slate-dark' : 'slate');
    ell(vb, 0, 3, 0, 24, 11, 11, body);
    ell(vb, 14, 5, 0, 14, 12, 11.5, body);
    ell(vb, -20, 2, 0, 10, 6, 7, body);
    // tail flukes
    for (let x = -36; x <= -26; x++) for (let z = -12; z <= 12; z++) {
      const w = (x + 36) * 1.2;
      if (Math.abs(z) <= w && Math.abs(z) > (x + 36) * 0.3 - 2) vb.set(x, 6 + Math.round((x + 36) * 0.3), z, 'slate');
    }
    // scars on the forehead, eyes, mouth line
    for (let q = 0; q < 9; q++) { vb.set(22 - q, 15 + (q % 3), -3 + q, 'rock-light'); vb.set(22 - q, 15 + (q % 3), 3 - q + 6, 'rock-light'); }
    [-1, 1].forEach((s) => { ell(vb, 22, 7, s * 10.5, 1.4, 1.4, 0.8, 'white'); vb.set(23, 7, s * 11, 'black'); });
    for (let x = 8; x <= 27; x++) vb.set(x, 0, -11 + Math.round((x - 8) * 0.05), 'slate-dark'), vb.set(x, 0, 11 - Math.round((x - 8) * 0.05), 'slate-dark');
    return vb;
  }

  function warship() {
    const vb = K().vb(0.5);
    // 0.5 m voxels, bow toward local +X, waterline at y = 0
    const L = 60, B = 8, X0 = -30;
    for (let x = 0; x < L; x++) {
      const t = x / (L - 1);
      const w = Math.max(1, Math.round(B * (t < 0.12 ? 0.82 + t * 1.5 : t > 0.7 ? Math.cos((t - 0.7) / 0.3 * Math.PI * 0.46) : 1)));
      const top = 7 + (t < 0.15 ? 2 : 0) + (t > 0.9 ? 1 : 0);
      for (let z = -w; z <= w; z++) for (let y = -3; y <= top; y++) {
        const wz = y < 0 ? w - 1 + Math.floor((y + 3) / 3) : w;
        if (Math.abs(z) > wz) continue;
        let c = y < 0 ? 'iron' : y === 3 ? 'marine-blue' : 'marine-white';
        if (y === 5 && x % 5 === 2 && Math.abs(z) === wz && t > 0.15 && t < 0.85) c = 'black';
        if (y === top) c = Math.abs(z) === wz ? 'wood-dark' : 'wood';
        vb.set(X0 + x, y, z, c);
      }
    }
    for (let q = 0; q < 10; q++) vb.set(X0 + L + q, 8 + (q >> 1), 0, q > 7 ? 'gold' : 'marine-white');
    const masts = [[X0 + 15, 46], [X0 + 30, 52], [X0 + 44, 44]];
    masts.forEach((m, i) => {
      for (let y = 8; y < m[1]; y++) vb.set(m[0], y, 0, 'wood-dark');
      [[13, 10], [24, 9], [34, 7]].forEach((sl) => {
        if (sl[0] + 9 > m[1]) return;
        for (let y = sl[0]; y < sl[0] + 9; y++) for (let z = -sl[1]; z <= sl[1]; z++) {
          const bul = Math.round(1.6 * (1 - (z / sl[1]) * (z / sl[1])));
          const c = y === sl[0] + 4 ? 'marine-blue' : (y === sl[0] + 8 ? 'sail-shadow' : 'sail');
          vb.set(m[0] + 1 + bul, y, z, c); vb.set(m[0] + 2 + bul, y, z, c);
        }
        for (let z = -sl[1] - 1; z <= sl[1] + 1; z++) vb.set(m[0], sl[0] + 9, z, 'wood-dark');
      });
      for (let q = 0; q < 6; q++) for (let y = 0; y < 3; y++) vb.set(m[0] - q, m[1] + y, 0, y === 1 ? 'white' : 'marine-blue');
      if (i === 0) {
        // jib: fore-and-aft triangle in the keel plane (reads from the side)
        for (let x = m[0] + 3; x < X0 + L + 8; x++) for (let y = 10; y < 10 + (X0 + L + 8 - x) * 1.1 && y < 40; y++) vb.set(x, y, 0, (y % 7 === 0) ? 'sail-shadow' : 'sail');
      }
      if (i === 2) for (let x = m[0] + 3; x < m[0] + 12; x++) for (let y = 12; y < 28; y++) vb.set(x - 14, y, 0, y === 20 ? 'marine-blue' : 'sail');
    });
    return vb;
  }

  function marineford(acc) {
    const vb = K().vb(1);
    const k2 = K();
    const c = sp(3, 196, 0);
    const cx = Math.round(c.x), cz = Math.round(c.z);
    const yaw = 3 * 45 * D2R;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    // local (u = toward the arena, v = lateral) -> world voxel
    const toLocal = (x, z) => { const dx = x - cx, dz = z - cz; return { u: -(dx * Math.sin(yaw) + dz * Math.cos(yaw)), v: dx * ca - dz * sa }; };
    // ground in 2 m voxels (top j = 3 -> y 8 m; heaved half j = 4 -> y 10 m)
    const vb2 = K().vb(2);
    hf(vb2, Math.round(cx / 2) - 23, Math.round(cx / 2) + 23, Math.round(cz / 2) - 23, Math.round(cz / 2) + 23, (x2, z2) => {
      const l = toLocal(x2 * 2 + 1, z2 * 2 + 1);
      const d = Math.hypot(l.u / 34, l.v / 42);
      if (d > 1) return -99;
      if (l.u > 10) return Math.floor(0.5 + k2.noise2(x2 * 0.4, z2 * 0.4, 6) * 1.2);        // crescent bay shore
      const crack = Math.abs(l.v - Math.sin(l.u * 0.25) * 3) < 2 && l.u > -20;
      if (crack) return -1;
      return l.v > 0 ? 4 : 3;                                                       // split plaza, one half heaved up
    }, (x2, y, z2, top) => {
      const l = toLocal(x2 * 2 + 1, z2 * 2 + 1);
      if (top < 0) return 'slate-dark';
      if (l.u > 10) return y === top ? 'sand' : 'rock';
      if (y === top) return ((Math.floor(l.u / 6) + Math.floor(l.v / 6)) & 1) ? 'sand-light' : 'rock-light';
      return y < 2 ? 'rock-dark' : 'rock';
    }, -1);
    addFoam(vb2, 2, Math.round(cx / 2) - 24, Math.round(cx / 2) + 24, Math.round(cz / 2) - 24, Math.round(cz / 2) + 24, 5);
    K().addVox(acc, vb2, null, { ao: 0.45 });
    // HQ: white tiered tower with teal roofs at the back of the plaza
    const hx = cx + Math.round(Math.sin(yaw) * 18), hz = cz + Math.round(Math.cos(yaw) * 18);
    const tiers = [[12, 0, 12], [9, 12, 22], [6, 22, 30], [3, 30, 37]];
    tiers.forEach((t) => {
      for (let x = -t[0]; x <= t[0]; x++) for (let z = -t[0]; z <= t[0]; z++) for (let y = 8 + t[1]; y <= 8 + t[2]; y++) {
        const edge = Math.abs(x) === t[0] || Math.abs(z) === t[0];
        if (!edge && y !== 8 + t[2]) continue;
        const win = edge && (y % 4 === 2) && ((x + z) % 3 === 0);
        vb.set(hx + x, y, hz + z, y >= 8 + t[2] - 1 ? 'teal' : win ? 'slate-dark' : 'marine-white', win && y > 20 ? undefined : undefined);
      }
      for (let x = -t[0] - 1; x <= t[0] + 1; x++) for (let z = -t[0] - 1; z <= t[0] + 1; z++) if (Math.abs(x) === t[0] + 1 || Math.abs(z) === t[0] + 1) vb.set(hx + x, 8 + t[2], hz + z, 'teal-deep');
    });
    for (let y = 46; y < 52; y++) vb.set(hx, y, hz, 'iron');
    for (let q = 0; q < 5; q++) vb.set(hx + 1 + q, 50, hz, 'marine-blue'), vb.set(hx + 1 + q, 51, hz, 'white');
    // execution scaffold + seawall
    const ex = cx - Math.round(Math.sin(yaw) * 2), ez = cz - Math.round(Math.cos(yaw) * 2);
    vb.box(ex - 3, 9, ez - 3, ex + 3, 14, ez + 3, 'wood-dark');
    vb.box(ex - 4, 15, ez - 4, ex + 4, 15, ez + 4, 'wood');
    K().addVox(acc, vb, null, { ao: 0.5 });
  }

  function sabaody(acc, bubbles) {
    const vb = K().vb(1), vb2 = K().vb(2);
    const k2 = K();
    const r = k2.rng(55, 'sabaody');
    const trees = [[150, -14, 58], [176, 12, 70], [134, 16, 46], [196, -18, 62]];
    trees.forEach((tr, ti) => {
      const p = sp(5, tr[0], tr[1]);
      const cx = Math.round(p.x), cz = Math.round(p.z), H = tr[2];
      // arching prop roots out of the water
      for (let q = 0; q < 9; q++) {
        const a = q / 9 * Math.PI * 2 + ti;
        const R0 = 13 + r.next() * 4;
        for (let t = 0; t <= 1; t += 0.02) {
          const rad = R0 * (1 - t) + 3 * t;
          const y = Math.sin(t * Math.PI * 0.85) * 12 * (1 - t * 0.2) + t * 10;
          const x = Math.round(cx + Math.cos(a) * rad), z = Math.round(cz + Math.sin(a) * rad);
          for (let w = 0; w <= 1; w++) vb.set(x + w, Math.round(y), z, k2.hash3(x, Math.round(y), z) < 0.2 ? 'wood-light' : 'wood');
        }
      }
      cyl(vb, cx, cz, 4.2, 6, H, (x, y, z) => (k2.hash3(x, y, z) < 0.15 ? 'wood-dark' : (y % 7 === 0 ? 'wood-light' : 'wood')));
      // number plate on the trunk (grove marker) - a light board, no text
      vb.box(cx - 2, Math.round(H * 0.4), cz + 4, cx + 2, Math.round(H * 0.4) + 3, cz + 4, 'sand-light');
      // canopy (2 m voxels)
      for (let q = 0; q < 6; q++) {
        const a = q / 6 * Math.PI * 2 + ti * 0.7;
        ell(vb2, (cx + Math.cos(a) * 9) / 2, (H + 4 + r.next() * 4) / 2, (cz + Math.sin(a) * 9) / 2, (9 + r.next() * 3) / 2, 2.6, (9 + r.next() * 3) / 2,
          (x, y, z, ny) => (ny > 0.4 ? 'foliage-light' : ny > -0.3 ? 'leaf' : 'foliage-dark'));
      }
      ell(vb2, cx / 2, (H + 9) / 2, cz / 2, 5, 3, 5, (x, y, z, ny) => (ny > 0.3 ? 'foliage-light' : 'leaf'));
      for (let q = 0; q < 16; q++) bubbles.push({ x: cx + (r.next() - 0.5) * 22, z: cz + (r.next() - 0.5) * 22, y0: 2 + r.next() * 6, sp: 2 + r.next() * 3, ph: r.next() * 30, s: 1.6 + r.next() * 2.4, top: H + 36 });
    });
    // shallow sandbar with resin pools
    const c = sp(5, 165, 0);
    const c2 = { x: c.x / 2, z: c.z / 2 };
    hf(vb2, Math.round(c2.x) - 20, Math.round(c2.x) + 20, Math.round(c2.z) - 20, Math.round(c2.z) + 20, (x, z) => {
      const d = Math.hypot(x - c2.x, z - c2.z) / 19 + (k2.noise2(x * 0.16, z * 0.16, 4) - 0.5) * 0.35;
      return d > 1 ? -99 : 0;
    }, (x, y, z) => (k2.hash3(x, 1, z) < 0.15 ? 'grass' : 'sand'), -1);
    addFoam(vb2, 2, Math.round(c2.x) - 21, Math.round(c2.x) + 21, Math.round(c2.z) - 21, Math.round(c2.z) + 21, 7);
    K().addVox(acc, vb, null, { ao: 0.45 });
    K().addVox(acc, vb2, null, { ao: 0.45 });
  }

  function reverseMountain(acc, flowB) {
    const s = 2;                                     // 2 m voxels: only ever seen from far away
    const vb = K().vb(s);
    const k2 = K();
    const c = sp(4, 226, 0);
    const cx = Math.round(c.x / s), cz = Math.round(c.z / s);
    const H = 25, R = 25;
    const height = (x, z) => {
      const d = Math.hypot(x - cx, z - cz) / R + (k2.noise2(x * 0.18, z * 0.18, 8) - 0.5) * 0.16;
      if (d > 1) return -99;
      // canal groove straight up the face toward the arena (+Z side of the mountain)
      const lat = Math.abs(x - cx), front = z > cz;
      let h = H * Math.pow(1 - d, 1.25) + k2.noise2(x * 0.4, z * 0.4, 2) * 1.5;
      if (front && lat <= 1) h -= 1;
      return Math.floor(h);
    };
    hf(vb, cx - R - 2, cx + R + 2, cz - R - 2, cz + R + 2, height, (x, y, z, top) => {
      const lat = Math.abs(x - cx);
      if (z > cz && lat <= 2 && y === top) return lat <= 1 ? 'slate-dark' : 'rock-light';
      if (y === top) return y > 21 ? 'white' : y > 16 ? 'rock-light' : (k2.hash3(x >> 1, y, z >> 1) < 0.5 ? 'grass' : 'grass-dark');
      return y % 4 < 1 ? 'slate' : y % 4 < 3 ? 'rock' : 'rock-dark';
    }, -1);
    addFoam(vb, s, cx - R - 3, cx + R + 3, cz - R - 3, cz + R + 3, 9);
    // canal water climbing the stepped groove (flow quads; v grows upward so the streaks climb)
    let v = 0;
    let prevY = 0.2;
    const x0 = (cx - 1) * s - 0.1, x1 = (cx + 2) * s + 0.1;
    for (let z = cz + R; z >= cz; z--) {
      const h = height(cx, z);
      if (h < -50) continue;
      const y = (h + 1) * s + 0.1;
      const zf = (z + 1) * s, zb = z * s;
      if (y > prevY + 0.05) {                       // riser
        const v1 = v + (y - prevY) / 3;
        flowB.quad([x0, prevY, zf + 0.1], [x1, prevY, zf + 0.1], [x1, y, zf + 0.1], [x0, y, zf + 0.1], '#e8f8ff', [0, v, 2, v, 2, v1, 0, v1]);
        v = v1;
      }
      const v2 = v + s / 3;                         // tread
      flowB.quad([x0, y, zf], [x1, y, zf], [x1, y, zb], [x0, y, zb], '#c8eaf6', [0, v, 2, v, 2, v2, 0, v2]);
      v = v2;
      prevY = Math.max(prevY, y);
    }
    // Knock-up stream from the summit to the cloud island
    const top = prevY, ix = (cx + 0.5) * s, iz = (cz + 0.5) * s;
    const y1 = 74;
    const w = 2.2;
    const sides = [[[ix - w, iz + w], [ix + w, iz + w]], [[ix + w, iz + w], [ix + w, iz - w]], [[ix + w, iz - w], [ix - w, iz - w]], [[ix - w, iz - w], [ix - w, iz + w]]];
    sides.forEach((sd) => {
      flowB.quad([sd[0][0], top, sd[0][1]], [sd[1][0], top, sd[1][1]], [sd[1][0], y1, sd[1][1]], [sd[0][0], y1, sd[0][1]], '#e8f8ff', [0, v, 1.5, v, 1.5, v + (y1 - top) / 3, 0, v + (y1 - top) / 3]);
    });
    K().addVox(acc, vb, null, { ao: 0.5 });
    return { x: Math.round(ix), z: Math.round(iz), y: y1 };
  }

  function skypiea(acc, at) {
    const vb = K().vb(1);
    const k2 = K();
    const cx = at.x, cz = at.z, y0 = at.y;
    const r = k2.rng(88, 'sky');
    // cloud sea disc with puffy rim
    ell(vb, cx, y0, cz, 34, 3.5, 26, (x, y, z, ny) => (ny < -0.2 ? 'cloud-shadow' : 'cloud'));
    for (let q = 0; q < 16; q++) {
      const a = q / 16 * Math.PI * 2;
      ell(vb, cx + Math.cos(a) * 31, y0 + r.next() * 2, cz + Math.sin(a) * 23, 6 + r.next() * 4, 3 + r.next() * 2, 5 + r.next() * 3, (x, y, z, ny) => (ny < -0.3 ? 'cloud-shadow' : 'cloud'));
    }
    ell(vb, cx, y0 - 5, cz, 22, 5, 16, (x, y, z, ny) => (ny < 0 ? 'cloud-dark' : 'cloud-shadow'));
    // island patch with jungle and ruins
    hf(vb, cx - 22, cx + 22, cz - 16, cz + 16, (x, z) => {
      const d = Math.hypot((x - cx) / 20, (z - cz - 2) / 13);
      return d > 1 ? -99 : Math.floor(y0 + 3 + (1 - d) * 5);
    }, (x, y, z, top) => (y === top ? (k2.hash3(x, y, z) < 0.3 ? 'grass-dark' : 'grass') : 'soil'), Math.floor(y0 + 1));
    for (let q = 0; q < 7; q++) {
      const px = cx - 16 + r.next() * 32, pz = cz - 8 + r.next() * 18;
      const h = 6 + r.int(6);
      for (let y = 0; y < h; y++) vb.set(Math.round(px), Math.round(y0 + 6 + y), Math.round(pz), 'wood');
      ell(vb, px, y0 + 6 + h, pz, 3.5, 1.4, 3.5, 'foliage-light');
    }
    // belfry ruins (golden bell hangs from them; the bell itself is a separate animated mesh)
    const bx = cx + 6, bz = cz - 4, by = Math.round(y0 + 10);
    [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach((p) => { for (let y = by; y < by + 14; y++) vb.set(bx + p[0], y, bz + p[1], y % 4 === 0 ? 'rock-light' : 'sand-light'); });
    vb.box(bx - 5, by + 14, bz - 5, bx + 5, by + 15, bz + 5, 'sand-light');
    vb.box(bx - 3, by + 16, bz - 3, bx + 3, by + 16, bz + 3, 'gold-dark');
    K().addVox(acc, vb, null, { ao: 0.4 });
    // the golden bell (0.5 m voxels), pivot at the beam
    const bell = K().vb(0.5);
    for (let y = 0; y < 14; y++) {
      const rr = 2 + Math.pow(y / 13, 1.6) * 6;
      cyl(bell, 0, 0, rr, -y, -y, y > 11 ? 'gold-dark' : y % 5 === 0 ? 'yellow' : 'gold');
    }
    bell.box(-1, 0, -1, 0, 2, 0, 'gold-dark');
    bell.box(-1, -15, -1, 0, -13, 0, 'brass');
    const g = K().build(bell, { castShadow: false, receiveShadow: true });
    g.position.set(bx, by + 13.5, bz);
    return g;
  }

  function floatingChunk(seed) {
    const vb = K().vb(1);
    const k2 = K();
    const r = k2.rng(seed, 'chunk');
    const R = 8 + r.int(6);
    hf(vb, -R - 1, R + 1, -R - 1, R + 1, (x, z) => (Math.hypot(x, z) + k2.noise2(x * 0.4 + seed, z * 0.4, 3) * 2 > R ? -99 : 0),
      (x, y, z) => (k2.hash3(x, seed, z) < 0.25 ? 'grass-dark' : 'grass'), 0);
    for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
      const d = Math.hypot(x, z) + k2.noise2(x * 0.4 + seed, z * 0.4, 3) * 2;
      if (d > R) continue;
      const depth = Math.floor((R - d) * 1.6 + k2.noise2(x * 0.5, z * 0.5, seed) * 3);
      for (let y = -1; y >= -depth; y--) {
        const edge = Math.hypot(x, z) + k2.noise2(x * 0.4 + seed, z * 0.4, 3) * 2 > R - 1.5 || y === -depth;
        if (!edge) continue;
        vb.set(x, y, z, y > -3 ? 'soil' : (y % 3 === 0 ? 'slate' : 'rock'));
      }
      if (d > R - 1.5 && k2.hash3(x, 7, z) < 0.18) for (let y = -1; y > -4 - r.int(4); y--) vb.set(x + Math.sign(x), y, z + Math.sign(z), 'vine');
    }
    // a little tree and a trickle
    for (let y = 1; y < 5; y++) vb.set(1, y, 0, 'wood');
    ell(vb, 1, 6, 0, 2.5, 1.6, 2.5, 'leaf');
    for (let y = 0; y > -R * 2; y--) vb.set(R, y, 0, y % 2 ? 'sea-foam' : 'sea-light');
    return vb;
  }

  function rockStack(acc) {
    const vb = K().vb(1);
    const k2 = K();
    const c = sp(6, 132, -4);
    const cx = Math.round(c.x), cz = Math.round(c.z);
    hf(vb, cx - 18, cx + 18, cz - 18, cz + 18, (x, z) => {
      const d = Math.hypot(x - cx, z - cz) / 16 + (k2.noise2(x * 0.2, z * 0.2, 12) - 0.5) * 0.4;
      if (d > 1) return -99;
      return d < 0.55 ? Math.floor(34 + k2.noise2(x * 0.3, z * 0.3, 2) * 6) : Math.floor(3 + (1 - d) * 6);
    }, (x, y, z, top) => (y === top ? (top > 20 ? 'grass' : 'rock-light') : (y % 5 === 0 ? 'slate' : y % 5 < 3 ? 'rock' : 'rock-dark')), -1);
    addFoam(vb, 1, cx - 19, cx + 19, cz - 19, cz + 19, 11);
    K().addVox(acc, vb, null, { ao: 0.5 });
    return { x: cx, z: cz, top: 36 };
  }

  // ------------------------------------------------------------------ build
  function buildSector(k) {
    const g = new THREE.Group();
    g.name = 'sector-' + k;
    const acc = K().acc();
    const anim = [];
    FOAMS = [];
    const flowB = K().batch();
    const big = K().vb(2);
    if (k >= 3 && k <= 5) redLine(k, big);
    if (k === 0) rockArch(acc);
    if (k === 1 || k === 6) {
      const schemes = k === 1
        ? [{ body: 'purple', stripe: 'purple-dark', belly: 'pink', fin: 'lavender' }, { body: 'teal', stripe: 'teal-deep', belly: 'sand-light', fin: 'orange' }]
        : [{ body: 'red', stripe: 'red-dark', belly: 'sand', fin: 'yellow' }, { body: 'green', stripe: 'grass-dark', belly: 'yellow', fin: 'red-light' }];
      schemes.forEach((sc, i) => {
        const p = sp(k, 120 + i * 34, (i ? 10 : -12));
        const vb = seaKing(k * 10 + i, sc);
        const sg = K().build(vb, { castShadow: false, receiveShadow: true, ao: 0.4 });
        sg.position.set(p.x, 0, p.z);
        sg.rotation.y = p.yaw + (i ? 2.2 : -0.9);
        g.add(sg);
        anim.push({ kind: 'seaKing', obj: sg, ph: k * 3.1 + i * 4.7, per: 11 + i * 3 });
      });
    }
    if (k === 2) {
      const p = sp(2, 168, 4);
      const lg = K().build(laboon(), { castShadow: false, receiveShadow: true, ao: 0.45 });
      lg.position.set(p.x, -2, p.z);
      lg.rotation.y = p.yaw + Math.PI * 0.62;
      g.add(lg);
      anim.push({ kind: 'laboon', obj: lg, base: -2 });
      // spout (instanced foam blobs)
      const b = K().batch();
      b.box(-0.6, -0.6, -0.6, 0.6, 0.6, 0.6, '#e0f6f0', { top: '#fffdf7', bottom: '#a6e2df' });
      const N = 26;
      const sp2 = K().inst(b.geometry(), K().mat('water'), N, { name: 'laboon-spout' });
      sp2.count = N;
      K().cullSphere(sp2, [{ x: p.x, z: p.z }], 46, 0, 40);
      g.add(sp2);
      anim.push({ kind: 'spout', obj: sp2, whale: lg, n: N });
      // a little reef islet in front
      const vb = K().vb(1);
      const q = sp(2, 128, -18);
      hf(vb, Math.round(q.x) - 8, Math.round(q.x) + 8, Math.round(q.z) - 8, Math.round(q.z) + 8,
        (x, z) => { const d = Math.hypot(x - q.x, z - q.z) / 7; return d > 1 ? -99 : Math.floor(1 + (1 - d) * 3); },
        (x, y, z, top) => (y === top ? 'sand' : 'rock'), -1);
      addFoam(vb, 1, Math.round(q.x) - 9, Math.round(q.x) + 9, Math.round(q.z) - 9, Math.round(q.z) + 9, 13);
      K().addVox(acc, vb);
    }
    if (k === 3) {
      marineford(acc);
      const ship = warship();
      const geo = K().voxGeometry(ship, { ao: 0.4 });
      const N = 5;
      const ws = K().inst(geo, GLT.voxel.material('solid'), N, { name: 'marine-warships', receive: true });
      ws.count = N;
      const pts = [];
      const yaw = 3 * 45 * D2R + Math.PI / 2;    // local +X (bow) -> toward the arena
      for (let i = 0; i < N; i++) {
        const row = Math.floor((i + 1) / 2), side = i === 0 ? 0 : (i % 2 ? -1 : 1);
        const p = sp(3, 110 + row * 26, side * row * 21);
        pts.push({ x: p.x, z: p.z, yaw, ph: i * 1.3 });
      }
      K().cullSphere(ws, pts, 32, -4, 30);
      g.add(ws);
      anim.push({ kind: 'fleet', obj: ws, pts });
    }
    if (k === 4) {
      const at = reverseMountain(acc, flowB);
      const skyAcc = K().acc();
      const bell = skypiea(skyAcc, at);
      g.add(K().flush(skyAcc, { name: 'sector-4-skypiea', cast: false }));
      g.add(bell);
      anim.push({ kind: 'bell', obj: bell });
    }
    if (k === 5) {
      const bubbles = [];
      sabaody(acc, bubbles);
      const vb = K().vb(0.5);
      ell(vb, 0, 0, 0, 2, 2, 2, (x, y, z, ny) => (ny > 0.3 ? 'white' : (x + y) & 1 ? 'sea-foam' : 'lavender'), 'glass');
      const geo = K().voxGeometry(vb, { ao: 0 });
      const bm = K().inst(geo, GLT.voxel.material('glass'), bubbles.length, { name: 'sabaody-bubbles' });
      bm.count = bubbles.length;
      bm.renderOrder = 5;
      K().cullSphere(bm, bubbles, 8, 0, Math.max.apply(null, bubbles.map((b) => b.top)));
      g.add(bm);
      anim.push({ kind: 'bubbles', obj: bm, pts: bubbles });
    }
    if (k === 6) {
      const st = rockStack(acc);
      const b = K().batch();
      b.box(-0.7, -0.7, -0.7, 0.7, 0.7, 0.7, 'rock', { top: 'rock-light' });
      const N = 14;
      const rk = K().inst(b.geometry(), K().mat('solid'), N, { name: 'rockfall' });
      rk.count = N;
      const r = K().rng(66, 'rockfall');
      const pts = [];
      for (let i = 0; i < N; i++) {
        const a = r.next() * Math.PI * 2;
        pts.push({ x: st.x + Math.cos(a) * 8.5, z: st.z + Math.sin(a) * 8.5, ox: Math.cos(a), oz: Math.sin(a), per: 3 + r.next() * 4, ph: r.next() * 7, s: 0.6 + r.next() * 0.9, y0: 30 + r.next() * 6 });
      }
      K().cullSphere(rk, pts, 6, -1, 42);
      g.add(rk);
      anim.push({ kind: 'rockfall', obj: rk, pts });
    }
    if (k === 7) {
      const r = K().rng(77, 'chunks');
      [[118, -8, 26], [150, 12, 40], [176, -14, 52], [140, 26, 18], [196, 6, 66]].forEach((c, i) => {
        const p = sp(7, c[0], c[1]);
        const cg = K().build(floatingChunk(700 + i), { castShadow: false, receiveShadow: true, ao: 0.45 });
        cg.position.set(p.x, c[2], p.z);
        cg.rotation.y = r.next() * 6;
        g.add(cg);
        anim.push({ kind: 'chunk', obj: cg, base: c[2], ph: i * 1.7 });
      });
    }
    // the Red Line piece is its own mesh so the camera frustum can cull it apart from the nearer features
    if (big.count()) { const rl = K().acc(); K().addVox(rl, big, null, { ao: 0.35 }); g.add(K().flush(rl, { name: 'sector-' + k + '-redline', cast: false })); }
    const stat = K().flush(acc, { name: 'sector-' + k + '-static', cast: false });
    g.add(stat);
    if (flowB.count()) {
      const fm = new THREE.Mesh(flowB.geometry(), K().flowMaterial());
      fm.name = 'sector-' + k + '-flow';
      g.add(fm);
    }
    const foam = K().foamMesh(FOAMS, { name: 'sector-' + k + '-foam' });
    if (foam) g.add(foam);
    FOAMS = null;
    g.userData.anim = anim;
    return g;
  }

  // ------------------------------------------------------------------ ambient life (blimp + News Coo flock)
  function buildAmbient() {
    const g = new THREE.Group();
    g.name = 'ambient-life';
    const vb = K().vb(0.5);
    ell(vb, 0, 0, 0, 14, 5, 5, (x, y, z, ny) => (Math.abs(x) % 8 < 1 ? 'red' : ny > 0.4 ? 'hull-white' : 'sail-shadow'));
    for (let s = -1; s <= 1; s += 2) for (let q = 0; q < 4; q++) vb.box(-13 - q, -1 + s * (2 + q), -1, -12 - q, -1 + s * (2 + q), 0, 'red');
    vb.box(-13, -1, -6, -12, 0, 5, 'red');
    vb.box(-3, -8, -2, 4, -6, 1, 'wood');
    vb.box(-2, -7, -2, 3, -7, 1, 'lantern', 'emissive');
    for (let x = -10; x <= 6; x++) vb.set(x, -3, 5, x % 2 ? 'yellow' : 'red');
    const blimp = K().build(vb, { castShadow: false, receiveShadow: false, ao: 0.3 });
    g.add(blimp);
    // News Coo gulls (instanced)
    const gb = K().vb(0.25);
    gb.box(-2, 0, -1, 2, 1, 0, 'white');
    gb.box(-1, 0, -5, 0, 0, -2, 'white'); gb.box(-1, 0, 1, 0, 0, 4, 'white');
    gb.set(-1, 0, -5, 'iron'); gb.set(-1, 0, 4, 'iron');
    gb.box(3, 1, -1, 3, 1, 0, 'orange');
    gb.box(-2, 2, -1, -1, 2, 0, 'blue');
    const geo = K().voxGeometry(gb, { ao: 0 });
    const N = 9;
    const birds = K().inst(geo, GLT.voxel.material('solid'), N, { name: 'news-coo' });
    birds.count = N;
    g.add(birds);
    return { group: g, blimp, birds, n: N };
  }

  function updateAmbient(t) {
    const A = S.ambient;
    if (!A) return;
    const cam = GLT.camera && GLT.camera.get ? GLT.camera.get() : { azimuth: 30 };
    const back = (cam.azimuth + 180) * D2R;
    const a = back + Math.sin(t * 0.045) * 0.75;
    const R = 150;
    A.blimp.position.set(Math.sin(a) * R, 64 + Math.sin(t * 0.3) * 2, Math.cos(a) * R);
    A.blimp.rotation.y = a + Math.PI / 2 + (Math.cos(t * 0.045) > 0 ? 0 : Math.PI);
    const arr = A.birds.instanceMatrix.array;
    for (let i = 0; i < A.n; i++) {
      const ph = t * 0.22 + i * 0.7;
      const ba = back + Math.sin(ph) * 0.6 + (i - 4) * 0.05;
      const rr = 95 + (i % 3) * 8 + Math.cos(ph * 1.3) * 6;
      const flap = Math.abs(Math.sin(t * 6 + i)) * 0.5 + 0.6;
      K().setInst(arr, i, Math.sin(ba) * rr, 34 + (i % 4) * 3 + Math.sin(t + i) * 1.5, Math.cos(ba) * rr, ba + Math.PI / 2 * (Math.cos(ph) > 0 ? 1 : -1), 1, 1, flap);
    }
    A.birds.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ animation
  function animate(t) {
    for (let k = 0; k < 8; k++) {
      const g = S.groups[k];
      if (!g || !g.visible) continue;
      const list = g.userData.anim;
      for (let q = 0; q < list.length; q++) {
        const a = list[q];
        if (a.kind === 'seaKing') {
          const ph = ((t + a.ph) % a.per) / a.per;
          const up = ph < 0.15 ? K().easeInOutCubic(ph / 0.15) : ph < 0.7 ? 1 : ph < 0.85 ? 1 - K().easeInOutCubic((ph - 0.7) / 0.15) : 0;
          a.obj.position.y = -16 + up * 16 + Math.sin(t * 1.3 + a.ph) * 0.6;
          a.obj.visible = up > 0.01;
        } else if (a.kind === 'laboon') {
          a.obj.position.y = a.base + Math.sin(t * 0.4) * 0.8;
          a.obj.rotation.z = Math.sin(t * 0.3) * 0.02;
        } else if (a.kind === 'spout') {
          const arr = a.obj.instanceMatrix.array;
          const w = a.whale;
          const cyc = (t % 9) / 9;
          const on = cyc < 0.35;
          const hx = w.position.x + Math.cos(-w.rotation.y) * 12, hz = w.position.z + Math.sin(-w.rotation.y) * 12;
          for (let i = 0; i < a.n; i++) {
            const f = ((i / a.n) + t * 0.9) % 1;
            const s = on ? (1.4 - f) * 1.6 : 0.0001;
            const ang = i * 2.4;
            K().setInst(arr, i, hx + Math.cos(ang) * f * 4, 18 + f * 16 - f * f * 6, hz + Math.sin(ang) * f * 4, ang, s, s, s);
          }
          a.obj.instanceMatrix.needsUpdate = true;
        } else if (a.kind === 'fleet') {
          const arr = a.obj.instanceMatrix.array;
          for (let i = 0; i < a.pts.length; i++) {
            const p = a.pts[i];
            K().setInst(arr, i, p.x, Math.sin(t * 0.8 + p.ph) * 0.3, p.z, p.yaw, 1, 1, 1);
          }
          a.obj.instanceMatrix.needsUpdate = true;
        } else if (a.kind === 'bell') {
          a.obj.rotation.z = Math.sin(t * 1.4) * 0.22;
        } else if (a.kind === 'bubbles') {
          const arr = a.obj.instanceMatrix.array;
          for (let i = 0; i < a.pts.length; i++) {
            const p = a.pts[i];
            const span = p.top - p.y0;
            const y = p.y0 + ((t * p.sp + p.ph * 3) % span);
            const f = (y - p.y0) / span;
            const s = p.s * (f < 0.1 ? f * 10 : f > 0.9 ? (1 - f) * 10 : 1);
            K().setInst(arr, i, p.x + Math.sin(t * 0.7 + p.ph) * 2, y, p.z + Math.cos(t * 0.6 + p.ph) * 2, 0, s, s, s);
          }
          a.obj.instanceMatrix.needsUpdate = true;
        } else if (a.kind === 'rockfall') {
          const arr = a.obj.instanceMatrix.array;
          for (let i = 0; i < a.pts.length; i++) {
            const p = a.pts[i];
            const ph = (t + p.ph) % p.per;
            const f = Math.min(ph, 2.6);
            const y = p.y0 - 4.9 * f * f;
            const s = y > -1 && ph < 2.6 ? p.s : 0.0001;
            K().setInst(arr, i, p.x + p.ox * f * 1.5, y, p.z + p.oz * f * 1.5, ph * 3, s, s, s);
          }
          a.obj.instanceMatrix.needsUpdate = true;
        } else if (a.kind === 'chunk') {
          a.obj.position.y = a.base + Math.sin(t * 0.5 + a.ph) * 1.6;
          a.obj.rotation.y += 0;
        }
      }
    }
  }

  // ------------------------------------------------------------------ lift
  function liftAllowed() {
    if (!S.enabled || S.forceLow) return false;
    const m = GLT.camera && GLT.camera.mode ? GLT.camera.mode() : 'both';
    return m !== 'ceremony' && m !== 'panorama';
  }

  function setShadows(g, on) {
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.gltCast == null) o.userData.gltCast = !!o.castShadow;
      o.castShadow = on ? o.userData.gltCast : false;
    });
  }

  function stepLift(dt, instant) {
    const C = GLT.C;
    const allowed = liftAllowed();
    const az = GLT.camera && GLT.camera.get ? GLT.camera.get().azimuth : 30;
    const near = allowed ? GLT.layout.nearSectors(az) : [false, false, false, false, false, false, false, false];
    const dur = C.T.liftS || 0.85;
    let anyActive = false;
    for (let k = 0; k < 8; k++) {
      const want = near[k] ? 1 : 0;
      if (want) anyActive = true;
      const g = S.groups[k];
      if (!g) continue;
      let v = S.lift[k];
      if (instant) v = want;
      else if (v < want) v = Math.min(1, v + dt / dur);
      else if (v > want) v = Math.max(0, v - dt / dur);
      const moving = v !== S.lift[k];
      if (moving && want === 0 && !g.visible) { g.visible = true; }       // lowering: show first
      S.lift[k] = v;
      g.position.y = C.LIFT_H * K().easeInOutCubic(v);
      if (v >= 1 && want === 1) { if (g.visible) { setShadows(g, false); g.visible = false; } }
      else if (v <= 0 && want === 0) { if (!S.landed[k] || !g.visible) { g.visible = true; setShadows(g, true); } }
      else if (!g.visible) g.visible = true;
      S.landed[k] = v <= 0;
    }
    if (anyActive !== S.active) {
      S.active = anyActive;
      if (GLT.events) GLT.events.emit('lift:changed', { enabled: S.enabled, active: S.active });
    }
  }

  function onFrame(dt, t, realDt) {
    if (!S.ok) return;
    const C = GLT.clock;
    const instant = S.first || K().reduced();
    // real time drives the lift (pause must not freeze it); a frozen clock holds it so ?t= shots are deterministic
    let step = realDt || 0;
    if (C.frozen() && !C.simulating()) step = 0;
    stepLift(step, instant);
    S.first = false;
    animate(t);
    updateAmbient(t);
  }

  // ------------------------------------------------------------------ public
  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root() || !GLT._world_kit || !GLT.voxel) return false;
    S.root = new THREE.Group();
    S.root.name = 'world-backdrop';
    S.groups = [];
    for (let k = 0; k < 8; k++) { const g = buildSector(k); S.groups.push(g); S.root.add(g); }
    S.ambient = buildAmbient();
    S.root.add(S.ambient.group);
    GLT.scene.add(S.root, 'backdrop');
    S.ok = true;
    S.enabled = GLT.prefs && GLT.prefs.get ? GLT.prefs.get('lift') !== false : true;
    S.first = true;
    S.offs.push(GLT.clock.onFrame(onFrame, 140));
    S.offs.push(GLT.events.on('settings:changed', (e) => {
      if (!e) return;
      if (e.key === 'lift') setLift(!!e.value);
      if (e.key === '*' && e.all) setLift(e.all.lift !== false);
    }));
    S.offs.push(GLT.events.on('ceremony:start', () => { S.forceLow = true; }));
    S.offs.push(GLT.events.on('ceremony:end', () => { S.forceLow = false; }));
    stepLift(0, true);
    animate(GLT.clock.now());
    return true;
  }

  function setLift(enabled) {
    const was = S.enabled;
    S.enabled = !!enabled;
    if (was !== S.enabled && GLT.events) GLT.events.emit('lift:changed', { enabled: S.enabled, active: S.active && S.enabled });
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    if (S.root) K().disposeObj(S.root);
    S.root = null; S.groups = []; S.ok = false; S.ambient = null;
  }

  // QA: sweep camera azimuth x elevation, settle the lift instantly, and ray-cast from the camera to sample points on
  // both plates (water + rim) against every VISIBLE backdrop/props mesh. Screen-space bounding rectangles prefilter the
  // candidates; hits closer than the plate point are occlusions. Restores camera and lift afterwards.
  function occlusionReport(o) {
    o = Object.assign({ azStep: 15, els: [15, 38, 70], lift: true, grid: 4 }, o || {});
    const cam = GLT.camera.three();
    if (!cam || !S.ok) return null;
    const C = GLT.C;
    const prevCam = GLT.camera.get(), prevLift = S.enabled;
    setLift(o.lift);
    const rc = new THREE.Raycaster();
    const samples = [];
    ['own', 'enemy'].forEach((p) => {
      const b = GLT.layout.rimBounds(p), g = GLT.layout.gridBounds(p);
      for (let i = 0; i <= o.grid; i++) for (let j = 0; j <= o.grid; j++) {
        const x = b.minX + (b.maxX - b.minX) * i / o.grid, z = b.minZ + (b.maxZ - b.minZ) * j / o.grid;
        const inGrid = x > g.minX && x < g.maxX && z > g.minZ && z < g.maxZ;
        samples.push(new THREE.Vector3(x, inGrid ? C.PLATE_Y : C.PLATE_Y + C.RIM_TOP, z));
      }
    });
    const roots = [S.root];
    if (GLT.props && GLT.scene.group('props')) roots.push(GLT.scene.group('props'));
    if (o.crowd !== false && GLT.scene.group('crowd')) roots.push(GLT.scene.group('crowd'));
    const out = { views: 0, rays: 0, occludedViews: 0, hits: [] };
    const v = new THREE.Vector3(), box = new THREE.Box3(), sph = new THREE.Sphere();
    const ndc = new THREE.Vector2();
    const rectOf = (mesh) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const pts = [];
      if (mesh.isInstancedMesh || !mesh.geometry.boundingBox) {
        sph.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
        box.setFromCenterAndSize(sph.center, new THREE.Vector3(sph.radius * 2, sph.radius * 2, sph.radius * 2));
      } else box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      for (let q = 0; q < 8; q++) pts.push(new THREE.Vector3(q & 1 ? box.max.x : box.min.x, q & 2 ? box.max.y : box.min.y, q & 4 ? box.max.z : box.min.z));
      pts.forEach((p) => { p.project(cam); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
      return { x0, x1, y0, y1 };
    };
    for (let az = 0; az < 360; az += o.azStep) for (let ei = 0; ei < o.els.length; ei++) {
      const el = o.els[ei];
      GLT.camera.set({ azimuth: az, elevation: el }, { instant: true });
      GLT.camera.update();
      stepLift(0, true);
      updateAmbient(GLT.clock.now());
      if (GLT.crowd && GLT.crowd.snapLift) GLT.crowd.snapLift();
      GLT.scene.root().updateMatrixWorld(true);
      out.views++;
      const meshes = [];
      roots.forEach((r) => r.traverseVisible((m) => { if (m.isMesh && m.geometry && m.geometry.boundingSphere !== undefined) meshes.push(m); }));
      let pr = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      const sn = samples.map((s) => { v.copy(s).project(cam); pr.x0 = Math.min(pr.x0, v.x); pr.x1 = Math.max(pr.x1, v.x); pr.y0 = Math.min(pr.y0, v.y); pr.y1 = Math.max(pr.y1, v.y); return { x: v.x, y: v.y }; });
      const cand = [];
      meshes.forEach((m) => {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        if (!m.geometry.boundingBox && !m.isInstancedMesh) m.geometry.computeBoundingBox();
        const r = rectOf(m);
        if (r.x1 < pr.x0 || r.x0 > pr.x1 || r.y1 < pr.y0 || r.y0 > pr.y1) return;
        cand.push({ m, r });
      });
      let occluded = false;
      for (let si = 0; si < samples.length && cand.length; si++) {
        const s = sn[si];
        ndc.set(s.x, s.y);
        rc.setFromCamera(ndc, cam);
        const d = rc.ray.origin.distanceTo(samples[si]);
        for (let ci = 0; ci < cand.length; ci++) {
          const c = cand[ci];
          if (s.x < c.r.x0 || s.x > c.r.x1 || s.y < c.r.y0 || s.y > c.r.y1) continue;
          out.rays++;
          const hit = rc.intersectObject(c.m, false);
          if (hit.length && hit[0].distance < d - 0.4) {
            occluded = true;
            let sec = -1, p = c.m;
            while (p) { const k = S.groups.indexOf(p); if (k >= 0) { sec = k; break; } p = p.parent; }
            const chain = [];
            for (let q = c.m; q && chain.length < 4; q = q.parent) chain.push(q.name || '?');
            if (out.hits.length < 40) out.hits.push({ az, el, mesh: chain.join('<'), sector: sec, at: [+hit[0].point.x.toFixed(1), +hit[0].point.y.toFixed(1), +hit[0].point.z.toFixed(1)], lift: S.lift.map((x) => +x.toFixed(2)) });
            break;
          }
        }
      }
      if (occluded) out.occludedViews++;
    }
    GLT.camera.set({ azimuth: prevCam.azimuth, elevation: prevCam.elevation, zoom: prevCam.zoom, target: prevCam.target }, { instant: true });
    setLift(prevLift);
    stepLift(0, true);
    return out;
  }

  GLT.backdrop = {
    init, setLift, dispose, occlusionReport,
    liftState() { return S.lift.slice(); },
    sectorGroup(k) { return S.groups[((k % 8) + 8) % 8] || null; },
    // additions (world area)
    enabled() { return S.enabled; },
    allowed: liftAllowed,
    active() { return S.active; },
    snap() { stepLift(0, true); },
    sectorPoint: sp
  };

  // ------------------------------------------------------------------ demos
  GLT.demos = GLT.demos || {};
  function composeAll(ctx) {
    GLT.layout.setSize(10);
    ['ocean', 'plates', 'backdrop', 'props', 'crowd'].forEach((ns) => { if (GLT[ns] && GLT[ns].init) GLT[ns].init(); });
    if (GLT.plates.build) GLT.plates.build(10);
    GLT.plates.setColors({ own: GLT.data.crews.strawHat.colors.primary, enemy: GLT.data.crews.marine.colors.primary });
    if (GLT.crowd.build) GLT.crowd.build(['strawHat', 'marine'], [GLT.data.crews.strawHat.colors.primary, GLT.data.crews.marine.colors.primary]);
    // ships are another piece's art; they are opt-in here (?ships=1) so a world check never depends on fleet3d
    const withShips = typeof location !== 'undefined' && /[?&]ships=1/.test(location.search || '');
    if (withShips && GLT.fleet3d && GLT.fleet3d.init && GLT.fleet3d.init()) {
      GLT.fleet3d.setFleet('own', ctx.sampleFleet('classica'), { crew: 'strawHat', colors: GLT.data.crews.strawHat.colors, visible: true });
    }
    GLT.plates.setFoam('own', ctx.sampleFleet('classica').ships);
    if (GLT.props && GLT.props.setBoard) {
      GLT.props.setBoard('big', { lastCall: GLT.T('call.shot', { cell: 'B7', result: { key: 'result.agua' } }), hits: [7, 4], sunk: [2, 1], timer: 23, turnName: GLT.T('crew.strawHat.name') });
      GLT.props.setBoard('small', { lastCall: GLT.T('call.shot', { cell: 'E5', result: { key: 'result.acerto' } }), hits: [7, 4], sunk: [2, 1], timer: 23, turnName: GLT.T('crew.strawHat.name') });
    }
  }
  GLT.demos['world.backdrop'] = function (ctx) { composeAll(ctx); GLT.camera.setMode('panorama', { instant: true }); };
  GLT.demos['world.panorama'] = GLT.demos['world.backdrop'];
  GLT.demos['panorama'] = GLT.demos['world.backdrop'];
  // Lift demo: scene composed with the lift OFF (everything down), then the lift is switched on at t = 0.3 s of game
  // time; ?t= samples the eased motion (t 0.3 = start, 1.15 = arrival, then hidden).
  function liftDemo(ctx) {
    composeAll(ctx);
    setLift(false);
    stepLift(0, true);
    GLT.camera.set({ zoom: 0.55, elevation: 30 }, { instant: true });
    GLT.clock.after(0.3, () => setLift(true));
  }
  GLT.demos['world.lift'] = liftDemo;
  GLT.demos['lift'] = liftDemo;
})();
