/* GLT.shotFx: cannonball arcs with smoke trail and muzzle flash, target reticles, splash rings, explosions with fire,
 * smoke and flying planks, persistent burns on hit cells, sink FX and technique FX. Area: fx. Contract: ARCHITECTURE.md §11.3.
 *
 * Flow (driven by the bus, game time only):
 *   shot:fired     -> muzzle flash + recoil at the shooter (fleet3d.muzzle ?? layout.launcher), a ball flies a parabola
 *                     for flightS, a corner reticle tightens on the target cell.
 *   shot:resolved  -> the result is attached to its ball (by id, else by plate/cell). The ball plays it on landing; if it
 *                     already landed (PvP answer late) it plays at once; with no ball (technique cells) it plays at once.
 *   ship:sunk      -> staggered explosions along the hull, bubbles, a big swallow splash, floating planks (oil for the
 *                     Polar Tang); burns on that hull turn into a smoulder.
 * Pools: balls (InstancedMesh, 24) and reticles (InstancedMesh, 12); every particle goes through GLT.particles.
 * No allocation in the frame loop: ball/reticle/burn records are preallocated and reused. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const MAX_BALLS = 24, MAX_RET = 12, MAX_BURNS = 80, MAX_LIGHTS = 6;
  const S = {
    ok: false, offs: [], balls: [], rets: [], burns: [], lights: [], ballMesh: null, retMesh: null, t: 0,
    timers: [], reduced: false, ballScale: 1, impactBig: 1
  };
  const V = { x: 0, y: 0, z: 0 };   // scratch
  const LARG = { intensity: 0 };
  // reusable option objects for emissions inside the frame loop (no per-frame allocation)
  const O_TSMOKE = { size: 0.62, end: 1.9, life: 0.6 }, O_TRAIL = { size: 0.5 }, O_HEAD = { size: 0.95, life: 0.09, end: 0.6 };
  const O_SMOULDER = { count: 1, radius: 0.9, size: 0.6 }, O_FIRE1 = { count: 1, radius: 0.75, size: 1 };
  const O_SMOKE1 = { count: 1, radius: 0.5, size: 0.5 }, O_EMBER1 = { count: 1, radius: 0.6 };

  function C() { return GLT.C; }
  function PS() { return GLT.particles; }

  // ---------------------------------------------------------------- meshes
  function buildBallGeometry() {
    const b = GLT.voxel.builder({ size: 0.1 });
    const R = 3.4;
    for (let x = -4; x <= 3; x++) for (let y = -4; y <= 3; y++) for (let z = -4; z <= 3; z++) {
      const d = Math.sqrt((x + 0.5) * (x + 0.5) + (y + 0.5) * (y + 0.5) + (z + 0.5) * (z + 0.5));
      if (d > R) continue;
      const hi = (x + 0.5) * -0.5 + (y + 0.5) * 0.8 + (z + 0.5) * 0.3;
      b.set(x, y, z, hi > 2.4 ? 0x8a8aa0 : hi > 1.0 ? 0x4c4a5e : 0x2a2838);
    }
    const g = b.build({ castShadow: true, receiveShadow: false, ao: 0 });
    const mesh = g.children[0];
    // own material: three r128 does not recompile when one material is shared by InstancedMeshes with and without
    // instanceColor, so the balls never share voxel.material('solid') with instanced crowds/crew.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(mat, 'full');
    return { geo: mesh.geometry, mat };
  }

  function buildReticleGeometry() {
    // corner brackets around a 4 m cell, 0.25 m voxels: 18 x 18 frame, arms 5 long
    const b = GLT.voxel.builder({ size: 0.25 });
    const N = 18, A = 5;
    for (let i = 0; i < A; i++) {
      [[i, 0], [0, i], [N - 1 - i, 0], [N - 1, i], [i, N - 1], [0, N - 1 - i], [N - 1 - i, N - 1], [N - 1, N - 1 - i]].forEach((p) => {
        b.set(p[0], 0, p[1], 0xffffff, 'emissive');
      });
    }
    // centre pip
    b.set(8, 0, 8, 0xffffff, 'emissive'); b.set(9, 0, 9, 0xffffff, 'emissive'); b.set(8, 0, 9, 0xffffff, 'emissive'); b.set(9, 0, 8, 0xffffff, 'emissive');
    const g = b.build({ center: true, castShadow: false, receiveShadow: false });
    const mesh = g.children[0];
    return { geo: mesh.geometry };
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root || !GLT.scene.root()) return false;
    if (!PS() || !PS().init()) return false;
    S.reduced = !!(GLT.prefs && GLT.prefs.reducedMotion && GLT.prefs.reducedMotion());
    const ball = buildBallGeometry();
    S.ballMesh = new THREE.InstancedMesh(ball.geo, ball.mat, MAX_BALLS);
    S.ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.ballMesh.count = 0; S.ballMesh.frustumCulled = false; S.ballMesh.castShadow = true; S.ballMesh.name = 'fx-balls';
    GLT.scene.add(S.ballMesh, 'fx');
    const ret = buildReticleGeometry();
    const rm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(rm, 'glow');
    S.retMesh = new THREE.InstancedMesh(ret.geo, rm, MAX_RET);
    S.retMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.retMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RET * 3), 3);
    S.retMesh.count = 0; S.retMesh.frustumCulled = false; S.retMesh.name = 'fx-reticles';
    GLT.scene.add(S.retMesh, 'fx');
    for (let i = 0; i < MAX_BALLS; i++) S.balls.push({ on: false, id: null, plate: null, r: 0, c: 0, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, h: 0, T: 1, age: 0, landed: false, wait: 0, result: null, ship: null, trail: 0, lx: 0, ly: 0, lz: 0, big: 1, onDone: null, tech: null });
    for (let i = 0; i < MAX_RET; i++) S.rets.push({ on: false, x: 0, y: 0, z: 0, age: 0, T: 1, hold: 0, r: 1, g: 0.3, b: 0.2 });
    for (let i = 0; i < MAX_BURNS; i++) S.burns.push({ on: false, plate: null, r: 0, c: 0, x: 0, y: 0, z: 0, age: 0, accF: 0, accS: 0, accE: 0, mode: 0, until: 0, k: 1 });
    S.offs.push(GLT.clock.onFrame(update, 400));
    subscribe();
    S.ok = true;
    return true;
  }

  function subscribe() {
    const E = GLT.events;
    if (!E) return;
    const on = (t, f) => S.offs.push(E.on(t, (e) => { if (e) f(e); }));
    on('shot:fired', (e) => {
      if (e.tech) return;   // technique volleys are drawn by techFx (technique:used)
      const from = muzzleOf(e.from, e.plate);
      const to = cellPos(e.plate, e.r, e.c, 0);
      launch(from, to, e.flightS || (C().T && C().T.flight) || 0.9, { id: e.id, plate: e.plate, r: e.r, c: e.c, fromPlate: e.from && e.from.plate, shipId: e.from && e.from.shipId, salvo: e.salvo });
    });
    on('shot:resolved', (e) => resolve(e.id, e.plate, e.r, e.c, e.result, e.ship || null));
    on('ship:sunk', (e) => { if (e.ship) sinkFx(e.plate, e.ship); });
    on('technique:used', (e) => techFx(e.tech, e.plate, e.cells || [], { flightS: e.flightS, by: e.by, target: e.target, phase: 'used' }));
    on('technique:resolved', (e) => techResolved(e.tech, e.plate, e.result));
    on('vortex:absorbed', (e) => { (e.cells || []).forEach((cl) => absorbed(cellPos(e.plate, cl.r, cl.c, 0.4))); });
    on('view:sync', (e) => { if (e.view) syncBurns(e.view); });
    on('game:setup', () => reset());
    on('match:created', () => reset());
    on('settings:changed', (e) => { if (e.key === 'reducedMotion') S.reduced = !!GLT.prefs.reducedMotion(); });
  }

  // ---------------------------------------------------------------- positions
  function waterY(plate, r, c) {
    let h = 0;
    if (GLT.plates && GLT.plates.heightAt && r != null) { const v = GLT.plates.heightAt(plate, r, c); if (Number.isFinite(v)) h = v; }
    return C().PLATE_Y + h;
  }
  function cellPos(plate, r, c, dy) {
    const p = GLT.layout.cellToWorld(plate, r, c);
    return { x: p.x, y: waterY(plate, r, c) + (dy || 0), z: p.z };
  }
  function muzzleOf(from, targetPlate) {
    let p = null;
    if (from && GLT.fleet3d && GLT.fleet3d.muzzle) { try { p = GLT.fleet3d.muzzle(from.plate, from.shipId || null); } catch (err) { p = null; } }
    if (!p || !Number.isFinite(p.x)) {
      const fp = (from && from.plate) || (targetPlate === 'enemy' ? 'own' : 'enemy');
      p = GLT.layout.launcher(fp, targetPlate);
    }
    return { x: p.x, y: p.y, z: p.z };
  }

  // ---------------------------------------------------------------- lights (transient impact light)
  function pulseLight(pos, color, intensity, dur) {
    if (!GLT.lighting || !GLT.lighting.addLight) return;
    let slot = null;
    for (let i = 0; i < S.lights.length; i++) if (!S.lights[i].on) { slot = S.lights[i]; break; }
    if (!slot) { if (S.lights.length >= MAX_LIGHTS) return; slot = { on: false, h: null, age: 0, T: 0, I: 0 }; S.lights.push(slot); }
    const h = GLT.lighting.addLight({ type: 'point', color, intensity: 0, distance: 22, decay: 1.6, night: false, position: { x: pos.x, y: pos.y + 1.5, z: pos.z } });
    if (!h) return;
    slot.on = true; slot.h = h; slot.age = 0; slot.T = dur; slot.I = intensity;
  }

  // ---------------------------------------------------------------- reticles
  function addReticle(pos, T, color) {
    let r = null;
    for (let i = 0; i < S.rets.length; i++) if (!S.rets[i].on) { r = S.rets[i]; break; }
    if (!r) return null;
    r.on = true; r.x = pos.x; r.y = pos.y + 0.12; r.z = pos.z; r.age = 0; r.T = Math.max(0.2, T); r.hold = 0.25;
    const c = color == null ? 0xff5a3a : color;
    r.r = ((c >> 16) & 255) / 255; r.g = ((c >> 8) & 255) / 255; r.b = (c & 255) / 255;
    return r;
  }

  // ---------------------------------------------------------------- launch / land
  function launch(from, to, flightS, o) {
    if (!S.ok && !init()) return null;
    o = o || {};
    let b = null;
    for (let i = 0; i < S.balls.length; i++) if (!S.balls[i].on) { b = S.balls[i]; break; }
    if (!b) {
      // pool exhausted: steal the oldest slot, but never drop its pending callback (it may carry game visuals)
      b = S.balls[0];
      const cb = b.onDone; b.onDone = null;
      if (cb) { try { cb(b.result); } catch (err) { setTimeout(() => { throw err; }, 0); } }
    }
    const dx = to.x - from.x, dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    b.on = true; b.id = o.id != null ? o.id : null; b.plate = o.plate || null; b.r = o.r; b.c = o.c;
    b.fx = from.x; b.fy = from.y; b.fz = from.z; b.tx = to.x; b.ty = to.y; b.tz = to.z;
    b.h = Math.max(6, Math.min(26, dist * 0.32)) + (o.loft || 0);
    b.T = Math.max(0.25, flightS); b.age = 0; b.landed = false; b.wait = 0;
    b.result = o.result || null; b.ship = o.ship || null; b.trail = 0;
    b.lx = from.x; b.ly = from.y; b.lz = from.z; b.big = o.big || 1; b.onDone = o.onDone || null; b.tech = o.tech || null;
    if (!o.noMuzzle) {
      muzzle(from, dx / (dist || 1), dz / (dist || 1), o.tech ? (o.big || 1) : 1);
      if (o.fromPlate && GLT.fleet3d && GLT.fleet3d.recoil && o.shipId) { try { GLT.fleet3d.recoil(o.fromPlate, o.shipId); } catch (err) { /* stub */ } }
    }
    if (o.plate) addReticle(to, b.T, o.reticle);
    return b;
  }

  function muzzle(pos, nx, nz, k) {
    const P = PS();
    k = k || 1;
    const dir = { x: nx, y: 0.35, z: nz };
    P.emit('flash', { x: pos.x + nx * 0.6, y: pos.y + 0.2, z: pos.z + nz * 0.6 }, { count: 6 * k, dir, cone: 0.6, spread: 1.4, size: 1.0 * k });
    P.emit('spark', pos, { count: 12 * k, dir, cone: 0.5, spread: 1.1 });
    P.emit('puff', { x: pos.x + nx * 1.2, y: pos.y, z: pos.z + nz * 1.2 }, { count: 9 * k, dir, cone: 0.9, spread: 1.0, size: 0.8 * k });
    P.emit('smoke', { x: pos.x + nx * 0.8, y: pos.y, z: pos.z + nz * 0.8 }, { count: 4 * k, size: 0.9 });
    pulseLight(pos, 0xffc060, 5 * k, 0.16);
  }

  function landBall(b) {
    b.landed = true;
    const pos = V; pos.x = b.tx; pos.y = b.ty; pos.z = b.tz;
    if (b.result) { playResult(b, b.result, b.ship); return true; }
    return false;
  }

  function playResult(b, result, ship) {
    const pos = { x: b.tx, y: b.ty, z: b.tz };
    impact(b.plate, b.r, b.c, pos, result, b.big);
    const cb = b.onDone; b.onDone = null;
    b.on = false;
    if (cb) { try { cb(result); } catch (err) { setTimeout(() => { throw err; }, 0); } }
  }

  function impact(plate, r, c, pos, result, big) {
    if (result === 'none') return;          // silent landing: the caller draws the outcome itself (onDone)
    if (result === 'agua') splash(pos, big);
    else if (result === 'acerto' || result === 'afundou') {
      hit({ x: pos.x, y: pos.y + 1.8, z: pos.z }, result === 'afundou' ? 1.5 * (big || 1) : (big || 1), pos.y);
      if (plate != null && r != null) burn(plate, r, c);
    } else if (result === 'absorvido') absorbed({ x: pos.x, y: pos.y + 0.4, z: pos.z });
    else splash(pos, big);
  }

  // onDone (optional) runs when the result is drawn: at the ball's landing, or at once if no ball is in flight.
  function resolve(id, plate, r, c, result, ship, onDone) {
    if (!S.ok && !init()) return;
    let b = null;
    for (let i = 0; i < S.balls.length; i++) {
      const x = S.balls[i];
      if (x.on && !x.result && id != null && x.id === id && x.r === r && x.c === c) { b = x; break; }
    }
    if (!b) for (let i = 0; i < S.balls.length; i++) {
      const x = S.balls[i];
      if (x.on && !x.result && x.plate === plate && x.r === r && x.c === c) { b = x; break; }
    }
    if (b) {
      b.result = result; b.ship = ship;
      if (onDone) {
        const prev = b.onDone;
        b.onDone = prev ? (res) => { prev(res); onDone(res); } : onDone;
      }
      if (b.landed) playResult(b, result, ship);
      return;
    }
    impact(plate, r, c, cellPos(plate, r, c, 0), result, S.impactBig);
    if (onDone) onDone(result);
  }

  // Seconds until the ball aimed at plate/r/c lands (0 when none is in flight).
  function eta(plate, r, c) {
    let t = 0;
    for (let i = 0; i < S.balls.length; i++) {
      const b = S.balls[i];
      if (b.on && !b.landed && b.plate === plate && b.r === r && b.c === c) t = Math.max(t, b.T - b.age);
    }
    return t;
  }

  // ---------------------------------------------------------------- impacts
  function splash(pos, k) {
    if (!S.ok && !init()) return;
    const P = PS();
    k = k || 1;
    const fl = pos.y;
    P.emit('splash', pos, { count: 34 * k, floor: fl - 0.05, radius: 0.45 * k, up: Math.sqrt(k) });
    P.emit('spray', pos, { count: 16 * k, floor: fl - 0.05, spread: k });
    P.emit('foam', { x: pos.x, y: fl + 0.08, z: pos.z }, { count: 22, radius: 0.5, spread: 1.0 * k });
    after(0.14, () => P.emit('foam', { x: pos.x, y: fl + 0.06, z: pos.z }, { count: 16, radius: 0.3, spread: 0.6 * k, life: 1.2 }));
    after(0.32, () => P.emit('foam', { x: pos.x, y: fl + 0.05, z: pos.z }, { count: 12, radius: 0.2, spread: 0.32 * k, life: 1.4 }));
    P.emit('mist', { x: pos.x, y: fl + 0.4, z: pos.z }, { count: 2 * k, radius: 0.5, size: 0.7 });
    // late "crown" drop-back
    after(0.42, () => P.emit('spray', { x: pos.x, y: fl + 0.1, z: pos.z }, { count: 10 * k, floor: fl - 0.05, spread: 0.6, up: 0.7 }));
  }

  function hit(pos, k, floorY, light) {
    if (!S.ok && !init()) return;
    const P = PS();
    k = k || 1;
    const fl = floorY != null ? floorY : pos.y - 1.8;
    P.emit('flash', pos, { count: Math.round(6 * k), size: k, spread: 1.2 });
    P.emit('fireball', pos, { count: Math.round(28 * k), spread: Math.sqrt(k) });
    P.emit('spark', pos, { count: Math.round(18 * k), floor: fl, spread: Math.sqrt(k) });
    P.emit('plank', pos, { count: Math.round(7 * k), floor: fl, spread: Math.sqrt(k) });
    P.emit('debris', pos, { count: Math.round(10 * k), floor: fl });
    P.emit('ironbit', pos, { count: Math.round(4 * k), floor: fl });
    P.emit('splash', { x: pos.x, y: fl, z: pos.z }, { count: Math.round(10 * k), floor: fl - 0.05, radius: 1.0, up: 0.7 });
    P.emit('foam', { x: pos.x, y: fl + 0.08, z: pos.z }, { count: 18, radius: 0.9, spread: 1.0 * k });
    after(0.08, () => {
      if (light) P.emit('smoke', { x: pos.x, y: pos.y + 1.2, z: pos.z }, { count: Math.round(3 * k), radius: 0.7, size: 0.6 });
      else P.emit('smokeDark', { x: pos.x, y: pos.y + 1.2, z: pos.z }, { count: Math.round(5 * k), radius: 0.7, size: 0.7 * Math.sqrt(k) });
      P.emit('fire', pos, { count: Math.round(14 * k), radius: 0.8, size: 1.3 });
    });
    after(0.2, () => P.emit('ember', pos, { count: Math.round(12 * k), radius: 0.8 }));
    pulseLight(pos, 0xff9a40, 7 * k, 0.45);
    if (GLT.lighting && GLT.lighting.flash && !S.reduced) GLT.lighting.flash(0.14 * k, 90);
  }

  function absorbed(pos) {
    if (!S.ok && !init()) return;
    const P = PS();
    // swirl: purple/black cubes spiralling inward, then a dark pop
    for (let i = 0; i < 26; i++) {
      const th = (i / 26) * Math.PI * 4, rad = 2.6 - (i / 26) * 1.6;
      P.spawn('tglow', pos.x + Math.cos(th) * rad, pos.y + 0.2 + i * 0.05, pos.z + Math.sin(th) * rad,
        -Math.cos(th) * 3 - Math.sin(th) * 4, 1.2, -Math.sin(th) * 3 + Math.cos(th) * 4, { color: i & 1 ? 0x6a2aa8 : 0x24143c, life: 0.6, size: 0.5 });
    }
    after(0.45, () => {
      P.emit('tglow', pos, { count: 14, color: 0x3a1a5a, spread: 2, size: 1.3 });
      P.emit('smokeDark', pos, { count: 6, size: 0.8 });
    });
  }

  // ---------------------------------------------------------------- burns
  function cellKeyFind(plate, r, c) {
    for (let i = 0; i < S.burns.length; i++) { const b = S.burns[i]; if (b.on && b.plate === plate && b.r === r && b.c === c) return b; }
    return null;
  }
  function burn(plate, r, c, k) {
    if (!S.ok && !init()) return;
    let b = cellKeyFind(plate, r, c);
    if (!b) for (let i = 0; i < S.burns.length; i++) if (!S.burns[i].on) { b = S.burns[i]; break; }
    if (!b) return;
    const p = cellPos(plate, r, c, 0);
    b.on = true; b.plate = plate; b.r = r; b.c = c; b.x = p.x; b.y = p.y + 1.5; b.z = p.z;
    b.age = 0; b.accF = 0; b.accS = 0; b.accE = 0; b.mode = 0; b.until = 0; b.k = k || 1;
  }
  function smoulder(plate, r, c, dur) {
    const b = cellKeyFind(plate, r, c);
    if (b) { b.mode = 1; b.until = dur; b.age = 0; }
  }
  function clearBurns(plate) {
    for (let i = 0; i < S.burns.length; i++) { const b = S.burns[i]; if (b.on && (plate == null || b.plate === plate)) b.on = false; }
  }
  function syncBurns(view) {
    clearBurns();
    if (!view || !view.players || view.me == null) return;
    const n = view.size;
    [['own', view.me], ['enemy', view.opp]].forEach((pp) => {
      const pv = view.players[pp[1]];
      if (!pv || !pv.marks) return;
      for (let i = 0; i < pv.marks.length; i++) if (pv.marks[i] === 2) burn(pp[0], (i / n) | 0, i % n);
    });
  }

  function updateBurns(dt) {
    if (dt <= 0) return;
    const P = PS();
    const red = S.reduced ? 0.5 : 1;
    for (let i = 0; i < S.burns.length; i++) {
      const b = S.burns[i];
      if (!b.on) continue;
      b.age += dt;
      if (b.mode === 1) {
        if (b.age > b.until) { b.on = false; continue; }
        b.accS += dt * 1.6 * red;
        while (b.accS >= 1) { b.accS -= 1; V.x = b.x; V.y = b.y; V.z = b.z; P.emit('smoke', V, O_SMOULDER); }
        continue;
      }
      // a fresh hit blazes for ~2.5 s, then settles to a steady fire with a smoke column
      const boost = (b.age < 2.5 ? 2.2 - b.age * 0.48 : 1) * b.k;
      b.accF += dt * 14 * boost * red;
      b.accS += dt * 4 * red;
      b.accE += dt * 2.0 * boost * red;
      V.x = b.x; V.y = b.y; V.z = b.z;
      while (b.accF >= 1) { b.accF -= 1; O_FIRE1.size = boost > 1.6 ? 1.7 : boost > 1.2 ? 1.45 : 1.2; P.emit('fire', V, O_FIRE1); }
      while (b.accS >= 1) { b.accS -= 1; V.y = b.y + 2.2; P.emit('smokeFire', V, O_SMOKE1); V.y = b.y; }
      while (b.accE >= 1) { b.accE -= 1; P.emit('ember', V, O_EMBER1); }
    }
  }

  // ---------------------------------------------------------------- sinking
  function shipCells(ship) {
    const out = [];
    for (let i = 0; i < ship.len; i++) out.push(ship.dir === 'h' ? { r: ship.r, c: ship.c + i } : { r: ship.r + i, c: ship.c });
    return out;
  }
  // o.under: seconds until the hull is under (the ship model's own sink ease; default 1.7 s)
  function sinkFx(plate, ship, o) {
    if (!S.ok && !init()) return;
    const P = PS();
    const under = (o && o.under) || 1.7;
    const cells = shipCells(ship);
    const tf = GLT.layout.shipTransform(plate, ship);
    const wy = waterY(plate, ship.r, ship.c);
    const centre = { x: tf.x, y: wy, z: tf.z };
    const along = ship.dir === 'h' ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const sub = ship.id === 'polarTang';
    // chain of secondary blasts along the hull
    cells.forEach((cl, i) => {
      after(0.12 + i * 0.16, () => {
        const p = cellPos(plate, cl.r, cl.c, 0.8);
        if (!sub) hit(p, 0.75, wy, true); else { P.emit('flash', p, { count: 4, size: 0.8 }); P.emit('spark', p, { count: 10, floor: wy }); }
      });
      if (!sub) burn(plate, cl.r, cl.c, 1.6);
      after(under * 0.8, () => smoulder(plate, cl.r, cl.c, 5));
      if (!sub) after(under * 0.42 + i * 0.18, () => hit(cellPos(plate, cl.r, cl.c, 0.5), 0.6, wy, true));
    });
    // the hull goes under (eased over `under` s): boiling bubbles along it, then a swallow splash
    const nb = Math.max(10, Math.round(under * 5));
    for (let k = 0; k < nb; k++) {
      after(0.5 + k * (under / nb), () => {
        const f = (P.rand() - 0.5) * tf.length;
        P.emit('bubble', { x: centre.x + along.x * f, y: wy + 0.1, z: centre.z + along.z * f }, { count: 6, radius: 1.2 });
      });
    }
    after(under, () => {
      const L = tf.length * 0.5;
      for (let s = -1; s <= 1; s += 2) {
        P.emit('splash', { x: centre.x + along.x * L * 0.5 * s, y: wy, z: centre.z + along.z * L * 0.5 * s }, { count: 26, floor: wy - 0.05, radius: 1.2, up: 0.9 });
      }
      P.emit('foam', { x: centre.x, y: wy + 0.08, z: centre.z }, { count: 34, radius: L * 0.6, spread: 1.2, life: 1.4 });
      P.emit('mist', { x: centre.x, y: wy + 0.5, z: centre.z }, { count: 8, radius: L * 0.6 });
      if (sub) P.emit('oil', { x: centre.x, y: wy + 0.06, z: centre.z }, { count: 16, radius: L * 0.7 });
      else P.emit('plank', { x: centre.x, y: wy + 0.6, z: centre.z }, { count: 10, floor: wy, spread: 0.5, up: 0.45, radius: L * 0.6 });
    });
    after(under + 0.7, () => P.emit('bubble', { x: centre.x, y: wy + 0.1, z: centre.z }, { count: 14, radius: tf.length * 0.4, life: 1.6 }));
  }

  // ---------------------------------------------------------------- techniques
  const TECH_COLOR = { bazooka: 0xffd23a, tremor: 0xdff4ff, haki: 0xb02a3a, room: 0x5ad8ff, vortex: 0x6a2aa8, observation: 0xffe070 };

  function techFx(tech, plate, cells, o) {
    if (!S.ok && !init()) return;
    o = o || {};
    const P = PS();
    const flight = o.flightS || (C().T && C().T.tech) || 1.4;
    cells = cells || [];
    if (!cells.length && tech !== 'vortex' && tech !== 'room') return;
    const tgtPlate = plate || 'enemy';
    const fromPlate = tgtPlate === 'enemy' ? 'own' : 'enemy';
    if (tech === 'bazooka') {
      const from = muzzleOf({ plate: fromPlate, shipId: null }, tgtPlate);
      cells.forEach((cl, i) => {
        after(i * 0.07, () => launch(from, cellPos(tgtPlate, cl.r, cl.c, 0), flight - i * 0.07, { plate: tgtPlate, r: cl.r, c: cl.c, big: 1.1, noMuzzle: i > 0, reticle: TECH_COLOR.bazooka, tech }));
      });
      return;
    }
    if (tech === 'tremor') {
      // a white quake: the air cracks over the centre, shock rings run across the cross, the cells jump
      const cc = cells[0];
      const cp = cellPos(tgtPlate, cc.r, cc.c, 0);
      P.emit('glitter', { x: cp.x, y: cp.y + 6, z: cp.z }, { count: 26, radius: 2.4 });
      for (let k = 0; k < 6; k++) after(k * 0.08, () => P.emit('tglow', { x: cp.x, y: cp.y + 6 - k * 0.9, z: cp.z }, { count: 6, color: 0xeaf6ff, spread: 1.5, size: 0.9 }));
      after(flight * 0.55, () => {
        P.emit('flash', { x: cp.x, y: cp.y + 1, z: cp.z }, { count: 10, size: 1.6, spread: 1.5 });
        for (let k = 0; k < 3; k++) after(k * 0.12, () => P.emit('foam', { x: cp.x, y: cp.y + 0.1, z: cp.z }, { count: 40, radius: 0.8, spread: 2.4 - k * 0.5, life: 1.1 }));
        cells.forEach((cl) => {
          const p = cellPos(tgtPlate, cl.r, cl.c, 0);
          P.emit('splash', p, { count: 10, floor: p.y - 0.05, radius: 1.2, up: 0.8 });
          P.emit('tglow', { x: p.x, y: p.y + 0.4, z: p.z }, { count: 6, color: 0xdff4ff, spread: 2 });
        });
        if (GLT.lighting && GLT.lighting.flash && !S.reduced) GLT.lighting.flash(0.3, 140);
      });
      return;
    }
    if (tech === 'haki') {
      // conqueror's haki: black-red crackle over the 3x3, from the sky down
      cells.forEach((cl, i) => {
        const p = cellPos(tgtPlate, cl.r, cl.c, 0.3);
        after(0.05 * i, () => {
          P.emit('tglow', p, { count: 5, color: i & 1 ? 0x2a0e1e : 0xb02a3a, spread: 2.2, size: 0.8 });
          P.emit('spark', { x: p.x, y: p.y + 3, z: p.z }, { count: 4, ramp: 'tint', color: 0xff3a4a, spread: 0.8 });
        });
      });
      const c0 = cells[(cells.length / 2) | 0];
      const cp = cellPos(tgtPlate, c0.r, c0.c, 0.2);
      for (let k = 0; k < 3; k++) after(0.15 + k * 0.25, () => P.emit('foam', cp, { count: 30, radius: 1.5, spread: 1.7, color: 0x000000, ramp: 'tint', life: 1 }));
      return;
    }
    if (tech === 'room') {
      // a pale-blue dome sweeps the chosen line
      const n = GLT.layout.size();
      const t = o.target || {};
      const line = [];
      if (cells.length) cells.forEach((cl) => line.push(cl));
      else for (let i = 0; i < n; i++) line.push(t.axis === 'row' ? { r: t.index, c: i } : { r: i, c: t.index });
      line.forEach((cl, i) => after(i * 0.06, () => {
        const p = cellPos(tgtPlate, cl.r, cl.c, 0.2);
        P.emit('tglow', p, { count: 5, color: TECH_COLOR.room, spread: 1.2, size: 0.8, up: 1.4 });
        P.emit('foam', p, { count: 12, radius: 0.4, spread: 0.6, color: TECH_COLOR.room, ramp: 'tint' });
      }));
      return;
    }
    if (tech === 'vortex') {
      // shield armed on the caster's own waters: a dark spiral rising from the plate centre
      const pc = GLT.layout.plateCenter(fromPlate);
      for (let i = 0; i < 40; i++) {
        const th = i * 0.55, rad = 1 + i * 0.12;
        after(i * 0.02, () => P.spawn('tglow', pc.x + Math.cos(th) * rad, pc.y + 0.5 + i * 0.12, pc.z + Math.sin(th) * rad,
          -Math.sin(th) * 4, 1.6, Math.cos(th) * 4, { color: i % 3 ? 0x6a2aa8 : 0x1a0e2a, life: 0.9, size: 0.6 }));
      }
      return;
    }
    if (tech === 'observation') {
      // a golden "eye" search pulse over the enemy waters (the pick is resolved later)
      const pc = GLT.layout.plateCenter(tgtPlate);
      P.emit('glitter', { x: pc.x, y: pc.y + 3, z: pc.z }, { count: 30, radius: 8 });
      return;
    }
  }

  function techResolved(tech, plate, res) {
    if (!S.ok || !res) return;
    const P = PS();
    if (tech === 'haki' && res.r != null) {
      const p = cellPos(plate, res.r, res.c, 0.4);
      if (res.found) { P.emit('tglow', p, { count: 18, color: 0xff2a3a, spread: 2.4, size: 1.1 }); P.emit('spark', p, { count: 14 }); }
      else P.emit('smoke', p, { count: 6 });
    } else if (tech === 'observation' && res.cell) {
      const p = cellPos(plate, res.cell.r, res.cell.c, 0.2);
      for (let k = 0; k < 8; k++) after(k * 0.06, () => P.emit('glitter', { x: p.x, y: p.y + k * 0.8, z: p.z }, { count: 5, radius: 0.5 }));
      P.emit('tglow', p, { count: 10, color: TECH_COLOR.observation, spread: 1.5 });
    }
  }

  // ---------------------------------------------------------------- timers (game time)
  function after(sec, fn) {
    if (GLT.clock && GLT.clock.after) return GLT.clock.after(sec, fn);
    fn();
    return null;
  }

  // ---------------------------------------------------------------- frame
  function update(dt, t) {
    if (!S.ok) return;
    S.t = t;
    const P = PS();
    // balls
    const bm = S.ballMesh.instanceMatrix.array;
    let nb = 0;
    for (let i = 0; i < S.balls.length; i++) {
      const b = S.balls[i];
      if (!b.on) continue;
      if (b.landed) {
        b.wait += dt;
        if (b.wait > 12) b.on = false;   // answer never came: drop silently
        continue;
      }
      b.age += dt;
      let u = b.age / b.T;
      if (u >= 1) { u = 1; if (landBall(b)) continue; else continue; }
      const x = b.fx + (b.tx - b.fx) * u, z = b.fz + (b.tz - b.fz) * u;
      const y = b.fy + (b.ty - b.fy) * u + 4 * b.h * u * (1 - u);
      // trail: one puff every 0.55 m travelled, embers every 0.3 m
      if (dt > 0) {
        const ddx = x - b.lx, ddy = y - b.ly, ddz = z - b.lz;
        b.trail += Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        while (b.trail >= 0.7) {
          b.trail -= 0.7;
          V.x = x; V.y = y; V.z = z;
          O_TSMOKE.size = 0.46 * b.big;
          P.spawn('smoke', x - ddx * 0.5, y - ddy * 0.5, z - ddz * 0.5, 0, 0.4, 0, O_TSMOKE);
          P.spawn('trail', x, y, z, 0, 0, 0, O_TRAIL);
        }
        // a hot glowing head, so the dark ball reads against dark water and scenery
        P.spawn('trail', x, y, z, 0, 0, 0, O_HEAD);
      }
      b.lx = x; b.ly = y; b.lz = z;
      const o = nb * 16, s = b.big * S.ballScale;
      bm[o] = s; bm[o + 1] = 0; bm[o + 2] = 0; bm[o + 3] = 0;
      bm[o + 4] = 0; bm[o + 5] = s; bm[o + 6] = 0; bm[o + 7] = 0;
      bm[o + 8] = 0; bm[o + 9] = 0; bm[o + 10] = s; bm[o + 11] = 0;
      bm[o + 12] = x; bm[o + 13] = y; bm[o + 14] = z; bm[o + 15] = 1;
      nb++;
    }
    S.ballMesh.count = nb;
    S.ballMesh.instanceMatrix.needsUpdate = true;
    // reticles: start wide and spinning, snap onto the cell as the ball arrives, blink, then vanish
    const rm = S.retMesh.instanceMatrix.array, rc = S.retMesh.instanceColor.array;
    let nr = 0;
    for (let i = 0; i < S.rets.length; i++) {
      const r = S.rets[i];
      if (!r.on) continue;
      r.age += dt;
      if (r.age > r.T + r.hold) { r.on = false; continue; }
      const u = Math.min(1, r.age / r.T);
      const e = 1 - (1 - u) * (1 - u) * (1 - u);
      let sc = 1.55 - 0.55 * e;
      const rot = (1 - e) * 1.2;
      if (u >= 1) sc = 1 + Math.sin((r.age - r.T) * 40) * 0.04;
      const blink = u > 0.75 && ((r.age * 14) | 0) % 2 === 0 ? 1.6 : 1;
      const cs = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
      const o = nr * 16;
      rm[o] = cs; rm[o + 1] = 0; rm[o + 2] = -sn; rm[o + 3] = 0;
      rm[o + 4] = 0; rm[o + 5] = 1; rm[o + 6] = 0; rm[o + 7] = 0;
      rm[o + 8] = sn; rm[o + 9] = 0; rm[o + 10] = cs; rm[o + 11] = 0;
      rm[o + 12] = r.x; rm[o + 13] = r.y; rm[o + 14] = r.z; rm[o + 15] = 1;
      rc[nr * 3] = Math.min(1, r.r * blink); rc[nr * 3 + 1] = Math.min(1, r.g * blink); rc[nr * 3 + 2] = Math.min(1, r.b * blink);
      nr++;
    }
    S.retMesh.count = nr;
    S.retMesh.instanceMatrix.needsUpdate = true;
    S.retMesh.instanceColor.needsUpdate = true;
    updateBurns(dt);
    // transient lights
    for (let i = 0; i < S.lights.length; i++) {
      const l = S.lights[i];
      if (!l.on) continue;
      l.age += dt;
      if (l.age >= l.T) { l.on = false; l.h.remove(); l.h = null; continue; }
      const k = 1 - l.age / l.T;
      LARG.intensity = l.I * k * k;
      l.h.set(LARG);
    }
  }

  function reset() {
    for (let i = 0; i < S.balls.length; i++) S.balls[i].on = false;
    for (let i = 0; i < S.rets.length; i++) S.rets[i].on = false;
    clearBurns();
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    reset();
    S.lights.forEach((l) => { if (l.on && l.h) l.h.remove(); });
    S.lights = [];
    [S.ballMesh, S.retMesh].forEach((m) => { if (m && m.parent) m.parent.remove(m); });
    if (S.retMesh) { S.retMesh.geometry.dispose(); S.retMesh.material.dispose(); }
    if (S.ballMesh) { S.ballMesh.geometry.dispose(); S.ballMesh.material.dispose(); }
    S.ballMesh = S.retMesh = null;
    S.balls = []; S.rets = []; S.burns = [];
    S.ok = false;
  }

  // fire(from, to, flightS, o): contract. Lands with a neutral splash unless a result arrives (shot:resolved) first.
  function fire(from, to, flightS, o) {
    o = o || {};
    return launch(from, to, flightS, { tech: o.tech || null, plate: o.plate || null, r: o.r, c: o.c, id: o.id, result: o.result || (o.plate ? null : 'agua'), onDone: o.onDone, big: o.tech === 'bazooka' ? 1.1 : 1 }) ? true : false;
  }

  // shot(from, to, result, onDone, o?): convenience for demos/cutscenes: one ball with a known result.
  function shot(from, to, result, onDone, o) {
    o = o || {};
    return fire(from, to, o.flightS || (C().T && C().T.flight) || 0.9, Object.assign({}, o, { result: result || 'agua', onDone }));
  }

  GLT.shotFx = {
    init, fire, splash, hit, burn, clearBurns, techFx, dispose,
    // additions (fx area)
    setBallScale(k) { S.ballScale = k > 0 ? k : 1; },
    setImpactScale(k) { S.impactBig = k > 0 ? k : 1; },   // size of results drawn without a ball (techniques, PvP)
    shot, launch, resolve, eta, sinkFx, absorbed, techResolved, reset, muzzle: (pos, dir, k) => muzzle(pos, dir ? dir.x : 1, dir ? dir.z : 0, k), smoulder, cellPos, muzzleOf,
    stats() { return { balls: S.balls.filter((b) => b.on).length, reticles: S.rets.filter((r) => r.on).length, burns: S.burns.filter((b) => b.on).length }; }
  };
})();
