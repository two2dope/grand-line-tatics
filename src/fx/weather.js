/* GLT.weather: rain, wind spray and lightning visuals per time of day and sea. Area: fx. Contract: ARCHITECTURE.md §11.3.
 * Rain is a stream of 'rain' streak particles (GLT.particles soft bank) spawned in a box around the camera target,
 * killed on the water/plate level. Storm lightning: seeded intervals, GLT.lighting.flash plus a jagged voxel bolt
 * (glow particles) on the horizon. Spray: wind-blown foam off the plate rims in rough seas. Game time only. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const S = { ok: false, offs: [], tod: 'day', sea: 'calmo', rain: 0, spray: 0, bolt: false, acc: 0, accS: 0, nextBolt: 2.5, rng: null };
  const O_RAIN = { floor: 0 };
  const O_SPRAY = { count: 1, floor: 0, spread: 0.6 };
  const POS = { x: 0, y: 0, z: 0 };

  function init() {
    if (S.ok) return true;
    if (!GLT.particles || !GLT.particles.init()) return false;
    S.rng = GLT.rng.create(0xb017 ^ ((GLT.params && GLT.params.seed) | 0));
    S.offs.push(GLT.clock.onFrame(update, 420));
    if (GLT.events) {
      S.offs.push(GLT.events.on('tod:changed', (e) => { if (e && e.tod) set({ tod: e.tod, sea: S.sea }); }));
      S.offs.push(GLT.events.on('match:created', (e) => { if (e && e.rules && e.rules.sea) set({ tod: S.tod, sea: e.rules.sea }); }));
    }
    S.ok = true;
    return true;
  }

  function set(o) {
    if (!S.ok && !init()) return;
    o = o || {};
    if (o.tod) S.tod = o.tod;
    if (o.sea) S.sea = o.sea;
    const storm = S.tod === 'storm' || S.sea === 'tempestade';
    S.rain = storm ? 340 : 0;                    // streaks per second
    S.bolt = storm;
    S.spray = storm ? 14 : S.sea === 'novomundo' ? 6 : S.sea === 'grandline' ? 2 : 0;
    if (GLT.particles.setWind) GLT.particles.setWind(storm ? 2.6 : 0.9, storm ? 0.9 : 0.35);
  }

  function centre() {
    if (GLT.camera && GLT.camera.get) { const c = GLT.camera.get(); if (c && c.target) return c.target; }
    return { x: 0, y: 8, z: 0 };
  }

  function bolt() {
    const P = GLT.particles, R = S.rng;
    if (GLT.lighting && GLT.lighting.flash && !P.reduced()) GLT.lighting.flash(0.9, 220);
    // a jagged bolt far behind the plates (north, toward the Red Line)
    let x = (R.next() - 0.5) * 140, y = 70, z = -110 - R.next() * 40;
    for (let i = 0; i < 26 && y > 2; i++) {
      const nx = x + (R.next() - 0.5) * 7, ny = y - 2.6 - R.next() * 1.4;
      for (let k = 0; k < 3; k++) {
        const u = k / 3;
        P.spawn('flash', x + (nx - x) * u, y + (ny - y) * u, z, 0, 0, 0, { size: 1.5, end: 1, life: 0.16, drag: 0 });
      }
      if (R.next() < 0.12) { const bx = nx + (R.next() - 0.5) * 9; P.spawn('flash', bx, ny - 2, z, 0, 0, 0, { size: 1.1, end: 1, life: 0.12 }); }
      x = nx; y = ny;
    }
  }

  function update(dt) {
    if (!S.ok || dt <= 0) return;
    const P = GLT.particles;
    const red = P.reduced() ? 0.4 : 1;
    if (S.rain > 0) {
      const c = centre();
      S.acc += dt * S.rain * red;
      const R = S.rng;
      while (S.acc >= 1) {
        S.acc -= 1;
        const x = c.x + (R.next() - 0.5) * 130, z = c.z + (R.next() - 0.5) * 90;
        const pl = GLT.layout.plateAt(x, z);
        O_RAIN.floor = pl ? GLT.C.PLATE_Y : GLT.C.OCEAN_Y;
        P.spawn('rain', x, O_RAIN.floor + 18 + R.next() * 14, z, -2.2, -24 - R.next() * 5, -0.8, O_RAIN);
      }
    }
    if (S.spray > 0) {
      S.accS += dt * S.spray * red;
      const R = S.rng;
      while (S.accS >= 1) {
        S.accS -= 1;
        const plate = R.next() < 0.5 ? 'own' : 'enemy';
        const b = GLT.layout.rimBounds(plate);
        POS.x = b.minX + R.next() * (b.maxX - b.minX); POS.z = R.next() < 0.5 ? b.minZ : b.maxZ; POS.y = GLT.C.PLATE_Y - 2;
        O_SPRAY.floor = GLT.C.OCEAN_Y;
        P.emit('spray', POS, O_SPRAY);
      }
    }
    if (S.bolt) {
      S.nextBolt -= dt;
      if (S.nextBolt <= 0) { bolt(); S.nextBolt = 3.5 + S.rng.next() * 4.5; }
    }
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    S.rain = 0; S.spray = 0; S.bolt = false;
    S.ok = false;
  }

  GLT.weather = {
    init, set, dispose,
    // additions (fx area)
    strike() { if (S.ok || init()) bolt(); },
    state() { return { tod: S.tod, sea: S.sea, rain: S.rain, spray: S.spray, lightning: S.bolt }; }
  };
})();
