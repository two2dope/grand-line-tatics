/* Fx bridge: GLT.backdropFx.createFxSystem on top of our src/fx (stage 4 of SCOPE-V2).
 *
 *   createFxSystem(scene) -> { group, fireCannonball, spawnWaterSplash, spawnHitExplosion, spawnAbsorbed, playSinkFx,
 *       playTechnique, playBazookaFx, playTremorFx, playHakiFx, playRoomFx, playVorticeFx, playObservacaoFx,
 *       spawnFireworkBurst, update }
 *
 * Everything is drawn by the sea modules (GLT.sea.shotFx, .particles, .fireworks, .weather; loaded inside the sea
 * sandbox, see src/sea/_enter.js): pooled InstancedMesh balls/reticles and three instanced particle banks. They tick
 * on the sea clock, which the game drives with its speed-scaled dt (GLT.platesLighting update), so the speed setting
 * and pause apply, and GLT.sea.prefs.reducedMotion() halves particle counts and drops flashes. update() is a no-op.
 *
 * Timing contract with ui.js. A shot ball flies FLIGHT game seconds, the same 560 ms / speed the UI waits before it
 * applies the outcome, and it lands silently: the outcome is drawn when ui.js calls spawnWaterSplash/HitExplosion
 * for that cell, which attaches it to the ball still in flight (PvP answers can arrive early) or plays it at once.
 * playTechnique() runs before the technique's cell impacts: Bazooka balls catch them on landing; Tremor holds them
 * until its quake. Technique shapes (shock rings, Room dome, Observação beams, Vórtice core) are a fixed pool of
 * meshes built once; cosmetic randomness is seeded (GLT.sea.rng), never Math.random. Game units in, metres inside. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const FLIGHT = 0.56;          // game seconds, matches ui.js shot flight (560 ms / animSpeed)
  const TECH_FLIGHT = 0.6;
  const SHOT_BIG = 1.45;        // splash / blast size of a game shot (our demos used 1 at a closer camera)

  let FX = null;

  function S() { return GLT.sea; }
  function B() { return GLT.seaBridge; }
  function now() { return S().clock.now(); }
  function after(sec, fn) { return S().clock.after(Math.max(0, sec), fn); }
  function reduced() { return !!S().prefs.reducedMotion(); }

  // game-unit position -> { plate, r, c, x, y, z } in metres (plate null off the grids)
  function locate(p) {
    const s = B().toSea(p);
    const L = S().layout;
    const plate = L.plateAt(s.x, s.z);
    const cell = plate ? L.worldToCell(plate, s.x, s.z) : null;
    return { plate: cell ? plate : null, r: cell ? cell.r : null, c: cell ? cell.c : null, x: s.x, y: s.y, z: s.z };
  }
  function cellPos(plate, r, c, dy) { return S().shotFx.cellPos(plate, r, c, dy || 0); }
  function centroid(plate, cells, dy) {
    let x = 0, z = 0, y = 0;
    cells.forEach((cl) => { const p = cellPos(plate, cl.r, cl.c, dy); x += p.x; y += p.y; z += p.z; });
    const n = Math.max(1, cells.length);
    return { x: x / n, y: y / n, z: z / n };
  }

  // Muzzle: the shooter's ship that ui.js just recoiled (cannonAnim restarted this frame), else its live ship nearest
  // the target plate, else the rim edge facing the target (the CPU's hidden fleet, a PvP rival).
  function muzzleFor(fromPlate, toPlate) {
    const ui = GLT.ui;
    const list = (ui && ui.playerShipMeshes) || [];
    const tx = S().layout.plateCenter(toPlate || 'enemy').x;
    let best = null, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.userData || m.userData.sinking || typeof m.fireCannon !== 'function') continue;
      const p = B().toSea(m.position);
      if (S().layout.plateAt(p.x, p.z) !== fromPlate) continue;
      const ca = m.userData.cannonAnim;
      const d = ca && ca.active && !(ca.t > 0) ? -1 : Math.abs(p.x - tx);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return S().layout.launcher(fromPlate, toPlate);
    const dir = toPlate === 'enemy' ? 1 : toPlate === 'own' ? -1 : 0;
    return { x: best.x + dir * 2.4, y: S().C.PLATE_Y + 3.2, z: best.z };
  }

  // ------------------------------------------------------------------ technique shapes (fixed pool)
  // A shape = one mesh + one animation record: scale s0 -> s1 (eased), height h0 -> h1 (or follows s), opacity o0 held
  // then faded over the last (1 - hold) of its life, optional spin, pulse and sweep. delay holds it hidden.
  const SH = { ok: false, recs: [], byKind: {}, off: null };

  function flatRing(inner, segs, dashes, fill) {
    // a flat ring in XZ (y up), radius 1, optionally broken into `dashes` arcs (so a spin reads)
    const pos = [], idx = [];
    const arcs = dashes || 1, span = (Math.PI * 2) / arcs, used = dashes ? span * (fill || 0.6) : span;
    const per = Math.max(2, Math.round(segs / arcs));
    for (let a = 0; a < arcs; a++) {
      const base = pos.length / 3;
      for (let k = 0; k <= per; k++) {
        const th = a * span + (used * k) / per;
        const cx = Math.cos(th), cz = Math.sin(th);
        pos.push(cx * inner, 0, cz * inner, cx, 0, cz);
      }
      for (let k = 0; k < per; k++) {
        const i0 = base + k * 2;
        idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function addShape(kind, geo, transparent) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: !!transparent, depthWrite: !transparent, fog: false });
    S().renderer.markMaterial(mat, 'glow');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.name = 'fx-tech-' + kind;
    S().scene.add(mesh, 'fx');
    const rec = { kind, mesh, mat, on: false, age: 0, T: 1, delay: 0, x: 0, y: 0, z: 0, s0: 1, s1: 1, h0: 1, h1: 1, hs: false,
      ax: 1, az: 1, o0: 1, hold: 0.6, spin: 0, rot: 0, pulse: 0, ease: 1, sw: 0, swx: 0, swz: 0 };
    SH.recs.push(rec);
    (SH.byKind[kind] = SH.byKind[kind] || []).push(rec);
  }

  function shapesInit() {
    if (SH.ok) return;
    const ring = flatRing(0.8, 48, 0), dash = flatRing(0.72, 48, 6, 0.62), thin = flatRing(0.9, 48, 0);
    for (let i = 0; i < 8; i++) addShape('ring', ring, true);
    for (let i = 0; i < 4; i++) addShape('dash', dash, true);
    for (let i = 0; i < 10; i++) addShape('thin', thin, true);
    const dome = new THREE.SphereBufferGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    addShape('dome', dome, true);
    const beam = new THREE.CylinderBufferGeometry(0.4, 1, 1, 14, 1, true);
    beam.translate(0, 0.5, 0);
    addShape('beam', beam, true); addShape('beam', beam, true);
    addShape('orb', new THREE.SphereBufferGeometry(1, 12, 8), false);
    const box = new THREE.BoxBufferGeometry(1, 1, 1);
    for (let i = 0; i < 3; i++) addShape('bar', box, true);
    SH.off = S().clock.onFrame(shapesUpdate, 470);
    SH.ok = true;
  }

  // shape(kind, o): claims a free record of that kind (or the oldest) and starts it
  function shape(kind, o) {
    const list = SH.byKind[kind];
    if (!list) return null;
    let r = null;
    for (let i = 0; i < list.length; i++) if (!list[i].on) { r = list[i]; break; }
    if (!r) { r = list[0]; for (let i = 1; i < list.length; i++) if (list[i].age > r.age) r = list[i]; }
    r.on = true; r.age = 0; r.T = o.T || 1; r.delay = o.delay || 0;
    r.x = o.x; r.y = o.y; r.z = o.z;
    r.s0 = o.s0 != null ? o.s0 : 1; r.s1 = o.s1 != null ? o.s1 : r.s0;
    r.hs = o.h0 == null; r.h0 = o.h0 != null ? o.h0 : 1; r.h1 = o.h1 != null ? o.h1 : r.h0;
    r.ax = o.ax || 1; r.az = o.az || 1;
    r.o0 = o.opacity != null ? o.opacity : 0.9; r.hold = o.hold != null ? o.hold : 0.35;
    r.spin = o.spin || 0; r.rot = o.rot || 0; r.pulse = o.pulse || 0; r.ease = o.ease != null ? o.ease : 1;
    r.sw = o.sweep || 0; r.swx = o.swx || 0; r.swz = o.swz || 0;
    r.mat.color.setHex(o.color != null ? o.color : 0xffffff);
    if (r.mat.transparent) r.mat.opacity = r.o0;   // an opaque material's alpha is its outline class (renderer.markMaterial)
    r.mesh.visible = false;
    return r;
  }

  function shapesUpdate(dt) {
    for (let i = 0; i < SH.recs.length; i++) {
      const r = SH.recs[i];
      if (!r.on) continue;
      if (r.delay > 0) { r.delay -= dt; r.mesh.visible = false; continue; }
      r.age += dt;
      const u = r.age / r.T;
      if (u >= 1) { r.on = false; r.mesh.visible = false; continue; }
      const e = r.ease === 0 ? u : r.ease === 2 ? 1 - Math.pow(1 - Math.min(1, u * 3), 3) : 1 - Math.pow(1 - u, 3);
      let s = r.s0 + (r.s1 - r.s0) * e;
      if (r.pulse) s *= 1 + Math.sin(r.age * r.pulse) * 0.12;
      const h = r.hs ? s : r.h0 + (r.h1 - r.h0) * e;
      r.rot += r.spin * dt;
      const m = r.mesh;
      m.visible = true;
      m.scale.set(s * r.ax, h, s * r.az);
      m.rotation.set(0, r.rot, 0);
      const sw = r.sw ? Math.sin(r.age * r.sw) : 0;
      m.position.set(r.x + r.swx * sw, r.y, r.z + r.swz * sw);
      if (r.mat.transparent) r.mat.opacity = u <= r.hold ? r.o0 : r.o0 * (1 - (u - r.hold) / (1 - r.hold));
      else if (u > r.hold) { const k = 1 - (u - r.hold) / (1 - r.hold); m.scale.multiplyScalar(Math.max(0.01, k)); }
    }
  }

  // jagged bolt/crack of glow particles from (x,y,z) along angle `a` (XZ), dropping `dy` per step; `col` null = white
  const O_BOLT = { color: 0xffffff, life: 0.22, size: 0.55, end: 1, drag: 0 };
  function bolt(x, y, z, a, steps, stepLen, dy, col, rng) {
    const P = S().particles;
    for (let i = 0; i < steps; i++) {
      const th = a + (rng.next() - 0.5) * 0.9;
      const nx = x + Math.cos(th) * stepLen, nz = z + Math.sin(th) * stepLen, ny = y + dy + (rng.next() - 0.5) * 0.6;
      for (let k = 0; k < 3; k++) {
        const u = k / 3;
        if (col == null) P.spawn('flash', x + (nx - x) * u, y + (ny - y) * u, z + (nz - z) * u, 0, 0, 0, O_BOLT);
        else { O_BOLT.color = col; P.spawn('tglow', x + (nx - x) * u, y + (ny - y) * u, z + (nz - z) * u, 0, 0, 0, O_BOLT); }
      }
      x = nx; y = ny; z = nz; stepLen *= 0.88;
    }
  }

  function flashSky(k, ms) { if (!reduced() && S().lighting.flash) S().lighting.flash(k, ms); }

  // ------------------------------------------------------------------ techniques
  // o: { shooterIdx, defenderIdx, cells: [{r,c}], axis, index, sonarDetected, revealedCell }
  function playTechnique(type, o) {
    if (!FX) return;
    o = o || {};
    const sea = S(), P = sea.particles, shot = sea.shotFx, C = sea.C;
    const def = B().plateOf(o.defenderIdx === 0 ? 0 : 1);
    const own = B().plateOf(o.shooterIdx === 1 ? 1 : 0);
    const cells = (o.cells || []).filter((cl) => cl && cl.r != null && cl.c != null);
    const rng = sea.rng.create((FX.casts++ * 2654435761) >>> 0);

    if (type === 'bazooka') {
      // Gomu Gomu volley: one big muzzle blast, a ball per cell landing in a quick ripple, a red/gold shock ring
      if (!cells.length) return;
      const from = muzzleFor(own, def);
      const ctr = centroid(def, cells, 0);
      cells.forEach((cl, i) => {
        shot.launch(from, cellPos(def, cl.r, cl.c, 0), TECH_FLIGHT + i * 0.09, { plate: def, r: cl.r, c: cl.c, big: 1.25, noMuzzle: i > 0, reticle: 0xffd23a, tech: 'bazooka', fromPlate: own });
      });
      shape('ring', { x: ctr.x, y: ctr.y + 0.3, z: ctr.z, s0: 2, s1: 15, T: 0.75, delay: TECH_FLIGHT, color: 0xef4444, opacity: 0.9, hold: 0.2 });
      shape('thin', { x: ctr.x, y: ctr.y + 0.4, z: ctr.z, s0: 1, s1: 10, T: 0.6, delay: TECH_FLIGHT + 0.12, color: 0xfacc15, opacity: 0.95, hold: 0.3 });
      after(TECH_FLIGHT, () => {
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          P.emit('tglow', { x: ctr.x, y: ctr.y + 1, z: ctr.z }, { count: 4, color: 0xfacc15, dir: { x: Math.cos(a), y: 0.15, z: Math.sin(a) }, cone: 0.12, spread: 6, size: 0.9 });
        }
      });
      return;
    }

    if (type === 'tremor') {
      // Gura Gura: the air cracks over the centre, then the quake lands on the cross (cell impacts held until then)
      if (!cells.length) return;
      const QUAKE = 0.5;
      const ctr = centroid(def, cells, 0);
      for (let f = 0; f < 3; f++) {
        after(f * 0.13, () => {
          for (let b = 0; b < 8; b++) bolt(ctr.x, ctr.y + 6, ctr.z, (b / 8) * Math.PI * 2 + f * 0.2, 5, 1.6, -0.25, b & 1 ? 0x7dd3fc : null, rng);
        });
      }
      P.emit('glitter', { x: ctr.x, y: ctr.y + 6, z: ctr.z }, { count: 26, radius: 2.4 });
      shape('ring', { x: ctr.x, y: ctr.y + 0.3, z: ctr.z, s0: 2, s1: 26, T: 0.9, delay: QUAKE, color: 0xbae6fd, opacity: 0.95, hold: 0.15 });
      shape('thin', { x: ctr.x, y: ctr.y + 0.4, z: ctr.z, s0: 1, s1: 18, T: 0.8, delay: QUAKE + 0.12, color: 0xffffff, opacity: 0.9, hold: 0.2 });
      after(QUAKE, () => {
        P.emit('flash', { x: ctr.x, y: ctr.y + 1, z: ctr.z }, { count: 10, size: 1.6, spread: 1.5 });
        for (let k = 0; k < 3; k++) after(k * 0.12, () => P.emit('foam', { x: ctr.x, y: ctr.y + 0.1, z: ctr.z }, { count: 40, radius: 0.8, spread: 2.4 - k * 0.5, life: 1.1 }));
        flashSky(0.3, 140);
      });
      FX.hold = { plate: def, until: now() + QUAKE, n: 0 };
      return;
    }

    if (type === 'haki_do_rei') {
      // Conqueror's Haki: crimson shock rings, black/red lightning over the 3x3, then a yes/no pulse
      if (!cells.length) return;
      const ctr = centroid(def, cells, 0);
      shape('ring', { x: ctr.x, y: ctr.y + 0.3, z: ctr.z, s0: 2, s1: 18, T: 1.0, color: 0x991b1b, opacity: 0.9, hold: 0.2 });
      shape('dash', { x: ctr.x, y: ctr.y + 0.5, z: ctr.z, s0: 3, s1: 9, T: 1.3, delay: 0.15, color: 0xef4444, opacity: 0.85, spin: 5, hold: 0.5 });
      for (let f = 0; f < 4; f++) {
        after(f * 0.12, () => {
          for (let b = 0; b < 10; b++) bolt(ctr.x, ctr.y + 1.5 + rng.next() * 2, ctr.z, (b / 10) * Math.PI * 2, 4, 1.7, -0.15, b & 1 ? 0x1a0a12 : 0xef4444, rng);
        });
      }
      shot.techFx('haki', def, cells, {});
      flashSky(0.18, 120);
      after(0.9, () => shot.techResolved('haki', def, { r: cells[(cells.length / 2) | 0].r, c: cells[(cells.length / 2) | 0].c, found: !!o.sonarDetected }));
      return;
    }

    if (type === 'room') {
      // Ope Ope: a pale-blue dome over the enemy waters, a scan bar on the chosen line, a spinning scalpel cross
      const n = sea.layout.size();
      const pc = sea.layout.plateCenter(def);
      const R = n * C.CELL * 0.62;
      shape('dome', { x: pc.x, y: C.PLATE_Y + 0.05, z: pc.z, s0: 0.2 * R, s1: R, T: 2.2, color: 0x06b6d4, opacity: 0.3, ease: 2, spin: 0.4, hold: 0.7 });
      shape('thin', { x: pc.x, y: C.PLATE_Y + 0.2, z: pc.z, s0: 0.2 * R, s1: R, T: 2.2, color: 0x67e8f9, opacity: 0.8, ease: 2, hold: 0.7 });
      const idx = typeof o.index === 'number' ? o.index : 0;
      const row = o.axis !== 'col';
      const mid = cellPos(def, row ? idx : (n - 1) / 2, row ? (n - 1) / 2 : idx, 0.35);
      const L = n * C.CELL;
      shape('bar', { x: mid.x, y: mid.y, z: mid.z, s0: 1, h0: 0.5, ax: row ? L : C.CELL * 0.9, az: row ? C.CELL * 0.9 : L, T: 2.0, delay: 0.3, color: 0xa5f3fc, opacity: 0.55, pulse: 9, hold: 0.7, ease: 0 });
      shape('bar', { x: pc.x, y: C.PLATE_Y + 0.6, z: pc.z, s0: 1, h0: 0.3, ax: 0.8, az: 9, T: 2.0, color: 0x22d3ee, opacity: 0.9, spin: 3, hold: 0.7 });
      shape('bar', { x: pc.x, y: C.PLATE_Y + 0.6, z: pc.z, s0: 1, h0: 0.3, ax: 9, az: 0.8, T: 2.0, color: 0x22d3ee, opacity: 0.9, spin: 3, hold: 0.7 });
      shot.techFx('room', def, [], { target: { axis: row ? 'row' : 'col', index: idx } });
      return;
    }

    if (type === 'vortice') {
      // Yami Yami: a dark whirlpool on the caster's own waters, counter-rotating rings around a black core
      const pc = sea.layout.plateCenter(own);
      const y = C.PLATE_Y;
      shape('dash', { x: pc.x, y: y + 0.2, z: pc.z, s0: 4, s1: 18, T: 2.4, color: 0x1e1b4b, opacity: 0.9, spin: 2.2, ease: 2, hold: 0.65 });
      shape('dash', { x: pc.x, y: y + 0.3, z: pc.z, s0: 3, s1: 12, T: 2.4, color: 0x581c87, opacity: 0.85, spin: -3.4, ease: 2, hold: 0.65 });
      shape('dash', { x: pc.x, y: y + 0.4, z: pc.z, s0: 1, s1: 6, T: 2.4, color: 0x09090b, opacity: 0.95, spin: 5, ease: 2, hold: 0.65 });
      shape('orb', { x: pc.x, y: y + 1.6, z: pc.z, s0: 0.3, s1: 2.4, T: 2.4, color: 0x0b0716, opacity: 1, pulse: 14, ease: 2, hold: 0.75 });
      shot.techFx('vortex', def, [], {});
      return;
    }

    if (type === 'observacao') {
      // Kenbunshoku: a golden pillar of light on the revealed cell, sonar rings, glitter
      const rc = o.revealedCell;
      shot.techFx('observation', def, rc ? [rc] : [], {});
      if (!rc) return;
      const p = cellPos(def, rc.r, rc.c, 0);
      shape('beam', { x: p.x, y: p.y, z: p.z, s0: 4.2, h0: 0, h1: 70, T: 2.0, color: 0xfacc15, opacity: 0.55, ease: 2, hold: 0.6 });
      shape('beam', { x: p.x, y: p.y, z: p.z, s0: 1.6, h0: 0, h1: 70, T: 2.0, color: 0xffffff, opacity: 0.85, ease: 2, hold: 0.6, delay: 0.05 });
      for (let k = 0; k < 3; k++) shape('thin', { x: p.x, y: p.y + 0.3, z: p.z, s0: 0.8, s1: 8, T: 0.8, delay: 0.25 + k * 0.32, color: 0xfde047, opacity: 0.95, hold: 0.25 });
      after(0.45, () => shot.techResolved('observation', def, { cell: rc }));
    }
  }

  // ------------------------------------------------------------------ impacts
  // A flat shape accent read from any camera distance: white splash rings on a miss, an orange blast ring on a hit,
  // a big red one on a sinking, a collapsing purple swirl when the Vórtice swallows the shot.
  function accent(plate, r, c, result) {
    const p = cellPos(plate, r, c, 0.25);
    if (result === 'agua') {
      shape('thin', { x: p.x, y: p.y, z: p.z, s0: 1, s1: 9.5, T: 0.8, color: 0xf0fbff, opacity: 0.95, hold: 0.25 });
      shape('thin', { x: p.x, y: p.y, z: p.z, s0: 0.6, s1: 6, T: 0.75, delay: 0.16, color: 0xbfeaf8, opacity: 0.9, hold: 0.3 });
    } else if (result === 'acerto') {
      shape('ring', { x: p.x, y: p.y + 0.4, z: p.z, s0: 1.5, s1: 11, T: 0.5, color: 0xff9a40, opacity: 0.95, hold: 0.1 });
    } else if (result === 'afundou') {
      shape('ring', { x: p.x, y: p.y + 0.4, z: p.z, s0: 2, s1: 18, T: 0.8, color: 0xff4a3a, opacity: 0.95, hold: 0.15 });
      shape('thin', { x: p.x, y: p.y + 0.5, z: p.z, s0: 1, s1: 12, T: 0.65, delay: 0.12, color: 0xffe35a, opacity: 0.95, hold: 0.2 });
      flashSky(0.22, 160);
    } else if (result === 'absorvido') {
      shape('dash', { x: p.x, y: p.y, z: p.z, s0: 7, s1: 0.6, T: 0.8, color: 0x6a2aa8, opacity: 0.9, spin: -7, hold: 0.6 });
    }
  }

  function impactAt(pos, result, onDone) {
    if (!FX) return;
    const sea = S();
    const L = locate(pos);
    if (!L.plate) {
      // off the grids (never from ui.js): draw at the point
      const p = { x: L.x, y: L.y, z: L.z };
      if (result === 'agua') sea.shotFx.splash(p, SHOT_BIG); else if (result === 'absorvido') sea.shotFx.absorbed(p); else sea.shotFx.hit(p, SHOT_BIG);
      if (onDone) onDone();
      return;
    }
    const done = () => { accent(L.plate, L.r, L.c, result); if (onDone) onDone(); };
    const h = FX.hold;
    if (h && h.plate === L.plate && now() < h.until) {
      const wait = h.until - now() + (h.n++) * 0.06;
      after(wait, () => sea.shotFx.resolve(null, L.plate, L.r, L.c, result, null, done));
      return;
    }
    sea.shotFx.resolve(null, L.plate, L.r, L.c, result, null, done);
  }

  // A sunk ship: blasts along the hull, boiling bubbles, the swallow splash as the model goes under, planks or oil.
  // Starts when the ball (or the Tremor quake) on its cells lands. opts.sub = Polar Tang style dive (oil, no planks).
  function playSinkFx(plateIdx, cells, shipId, opts) {
    if (!FX || !cells || !cells.length) return;
    const sea = S();
    const plate = B().plateOf(plateIdx === 1 ? 1 : 0);
    const sorted = cells.slice().sort((a, b) => (a.r - b.r) || (a.c - b.c));
    const h = sorted[0].r === sorted[sorted.length - 1].r;
    const sub = !!(opts && opts.sub);
    const ship = { r: sorted[0].r, c: sorted[0].c, len: sorted.length, dir: h ? 'h' : 'v', id: sub ? 'polarTang' : String(shipId || '') };
    let wait = 0;
    sorted.forEach((cl) => { wait = Math.max(wait, sea.shotFx.eta(plate, cl.r, cl.c)); });
    const hold = FX.hold;
    if (hold && hold.plate === plate && now() < hold.until) wait = Math.max(wait, hold.until - now());
    const go = () => sea.shotFx.sinkFx(plate, ship, { under: sub ? 2.6 : 3.0 });
    if (wait > 0) after(wait, go); else go();
  }

  // ------------------------------------------------------------------ the system
  function mock() {
    const noop = () => {};
    return { isMock: true, group: null, fireCannonball: noop, spawnWaterSplash: noop, spawnHitExplosion: noop, spawnAbsorbed: noop,
      playSinkFx: noop, playTechnique: noop, playBazookaFx: noop, playTremorFx: noop, playHakiFx: noop, playRoomFx: noop,
      playVorticeFx: noop, playObservacaoFx: noop, spawnFireworkBurst: noop, update: noop };
  }

  function createFxSystem() {
    if (FX) return FX.api;
    const sea = S();
    if (typeof THREE === 'undefined' || !sea || !B() || !B().world() || !sea.shotFx) return mock();
    sea.flags = sea.flags || GLT.flags;            // the ceremony hoists the crew's pixel Jolly Roger (src/ships/flags.js)
    if (!sea.particles.init() || !sea.shotFx.init()) return mock();
    sea.particles.setScale(1.6);
    sea.shotFx.setBallScale(2.6);
    sea.shotFx.setImpactScale(SHOT_BIG);
    sea.fireworks.init();
    sea.weather.init();
    shapesInit();
    FX = { casts: 1, hold: null, api: null };

    const toCells = (positions) => (positions || []).map((p) => locate(p)).filter((L) => L.plate);
    const api = {
      group: new THREE.Group(),                    // compatibility: the pilot exposed its fx group; ours live in GLT.sea
      // A ball from the shooter's ship to the target cell. With onImpact (PvP inbound), it lands silently and calls
      // onImpact, which draws the outcome; otherwise the outcome comes from spawnWaterSplash/HitExplosion (see header).
      fireCannonball(startPos, targetPos, outcome, onImpact) {
        const to = locate(targetPos), from = locate(startPos);
        if (!to.plate) { if (typeof onImpact === 'function') onImpact(); return; }
        const fromPlate = from.plate || (to.plate === 'enemy' ? 'own' : 'enemy');
        const o = { plate: to.plate, r: to.r, c: to.c, fromPlate, big: SHOT_BIG };
        if (typeof onImpact === 'function') { o.result = 'none'; o.onDone = () => onImpact(); }
        sea.shotFx.launch(muzzleFor(fromPlate, to.plate), cellPos(to.plate, to.r, to.c, 0), FLIGHT, o);
      },
      spawnWaterSplash(pos) { impactAt(pos, 'agua'); },
      spawnHitExplosion(pos, outcome) { impactAt(pos, outcome === 'sunk' ? 'afundou' : 'acerto'); },
      spawnAbsorbed(pos) { impactAt(pos, 'absorvido'); },
      playSinkFx,
      playTechnique,
      // the pilot's per-technique entry points, kept for callers that pass world positions
      playBazookaFx(center, cellPositions) {
        const L = toCells(cellPositions);
        if (L.length) playTechnique('bazooka', { shooterIdx: L[0].plate === 'enemy' ? 0 : 1, defenderIdx: B().indexOf(L[0].plate), cells: L });
      },
      playTremorFx(center, cellPositions) {
        const L = toCells(cellPositions);
        if (L.length) playTechnique('tremor', { shooterIdx: L[0].plate === 'enemy' ? 0 : 1, defenderIdx: B().indexOf(L[0].plate), cells: L });
      },
      playHakiFx(center, cellPositions) {
        const L = toCells(cellPositions);
        if (L.length) playTechnique('haki_do_rei', { shooterIdx: L[0].plate === 'enemy' ? 0 : 1, defenderIdx: B().indexOf(L[0].plate), cells: L });
      },
      playRoomFx(center, w, l, axis) {
        const L = locate(center);
        const d = L.plate ? B().indexOf(L.plate) : 1;
        playTechnique('room', { shooterIdx: 1 - d, defenderIdx: d, axis, index: L.plate ? (axis === 'col' ? L.c : L.r) : 0 });
      },
      playVorticeFx(platePos) {
        const L = locate(platePos);
        const s = L.plate ? B().indexOf(L.plate) : 0;
        playTechnique('vortice', { shooterIdx: s, defenderIdx: 1 - s });
      },
      playObservacaoFx(targetPos) {
        const L = locate(targetPos);
        if (L.plate) playTechnique('observacao', { shooterIdx: 1 - B().indexOf(L.plate), defenderIdx: B().indexOf(L.plate), revealedCell: { r: L.r, c: L.c } });
      },
      // one burst at a game-unit point (the ceremony show itself starts with backdrop.setCeremonyActive)
      spawnFireworkBurst(x, y, z) {
        const p = B().toSea({ x: x || 0, y: y || 0, z: z || 0 });
        sea.fireworks.burstNow((FX.casts++) % 4, p);
      },
      update() { /* the sea clock ticks every fx module inside platesSystem.update */ }
    };
    FX.api = api;
    return api;
  }

  GLT.backdropFx = GLT.backdropFx || {};
  GLT.backdropFx.createFxSystem = createFxSystem;
  GLT.backdropFx.SHOT_FLIGHT_S = FLIGHT;
})();
