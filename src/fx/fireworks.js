/* GLT.fireworks: victory fireworks + the ceremony set piece (Jolly Roger hoist, confetti) + the WANTED poster entry
 * point. Area: fx. Contract: ARCHITECTURE.md §11.3.
 *
 * Shells are a small preallocated pool. A shell rises with a glitter trail, then bursts into tinted 'star' particles
 * (white-hot first frames, then the crew colour, then they shrink away) in one of four seeded patterns: peony (sphere),
 * ring (tilted circle), willow (gold, heavy droop, long life) and crossette (four comets that split once). Launch times,
 * positions and patterns come from a seeded GLT.rng, so a frozen ?t= frame is reproducible.
 * ceremony:start -> start(crew colours) above the winner plate + GLT._fx_ceremony.raise(); ceremony:end -> stop().
 * Additions: poster(canvas, o) draws the WANTED poster (same options as GLT.wanted.draw, §11.5), raise(), lower(). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const MAX_SHELLS = 12, MAX_COMETS = 24;
  const S = {
    ok: false, offs: [], on: false, rng: null, colors: ['#ffd23a', '#ff5a3a', '#5ad8ff'], next: 0, t: 0,
    shells: [], comets: [], origin: { x: 0, y: 8, z: 0 }, spanX: 14, depth: 10, rate: 1, count: 0
  };
  const O_TRAIL = { size: 0.26, life: 0.35 };
  const O_STAR = { color: 0xffffff, life: 1.4, size: 0.5 };
  const O_CTRAIL = { size: 0.22, life: 0.3 };
  // scratch emit arguments (no allocation per launch / burst)
  const V = { x: 0, y: 0, z: 0 };
  const O_LSPARK = { count: 6, dir: { x: 0, y: 1, z: 0 }, cone: 0.35, spread: 0.6 };
  const O_LSMOKE = { count: 2, size: 0.5 };
  const O_BFLASH = { count: 3, size: 0.6, spread: 1.6 };
  const O_GLIT = { count: 30, radius: 5, life: 1.8 };

  function P() { return GLT.particles; }

  function init() {
    if (S.ok) return true;
    if (!GLT.particles || !GLT.particles.init()) return false;
    S.rng = GLT.rng.create(0x5eed ^ ((GLT.params && GLT.params.seed) | 0));
    for (let i = 0; i < MAX_SHELLS; i++) S.shells.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, age: 0, color: 0, color2: 0, type: 0, acc: 0 });
    for (let i = 0; i < MAX_COMETS; i++) S.comets.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, T: 0, color: 0, acc: 0 });
    S.offs.push(GLT.clock.onFrame(update, 450));
    const E = GLT.events;
    if (E) {
      S.offs.push(E.on('ceremony:start', (e) => {
        if (!e) return;
        const crew = GLT.data.crews[e.crew] ? e.crew : 'strawHat';
        const cc = GLT.data.crews[crew].colors;
        const plate = e.plate || 'own';
        aimAt(plate);
        if (e.fireworks !== false) start([cc.primary, cc.secondary, cc.trim, '#ffe070']);
        if (GLT._fx_ceremony) GLT._fx_ceremony.raise(plate, crew);
      }));
      S.offs.push(E.on('ceremony:end', () => { stop(); if (GLT._fx_ceremony) GLT._fx_ceremony.lower(); }));
      S.offs.push(E.on('game:setup', () => { stop(); if (GLT._fx_ceremony) GLT._fx_ceremony.lower(true); }));
    }
    if (GLT._fx_ceremony) GLT._fx_ceremony.init();
    S.ok = true;
    return true;
  }

  function hexNum(c) {
    if (typeof c === 'number') return c >>> 0;
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return parseInt(c.slice(1), 16);
    return 0xffd23a;
  }
  // brighten very dark crew colours so stars still read against a night sky
  function starColor(c) {
    let n = hexNum(c);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    if (l < 90) {
      const k = 90 / Math.max(1, l);
      n = (Math.min(255, Math.round(r * k + 40)) << 16) | (Math.min(255, Math.round(g * k + 40)) << 8) | Math.min(255, Math.round(b * k + 40));
    }
    return n;
  }

  function aimAt(plate) {
    const c = GLT.layout.plateCenter(plate);
    const n = GLT.layout.size();
    // mortars along the far rim: the shells burst above and behind the stands, so the plate, the winner's ships and the
    // hoisted flag stay readable in the low ceremony camera
    S.origin.x = c.x; S.origin.y = c.y + 2; S.origin.z = c.z - (n / 2) * GLT.C.CELL * 0.95;
    S.spanX = (n / 2) * GLT.C.CELL;
  }

  function start(colors, o) {
    if (!S.ok && !init()) return;
    o = o || {};
    S.colors = (colors && colors.length ? colors : S.colors).map(starColor);
    if (o.origin) { S.origin.x = o.origin.x; S.origin.y = o.origin.y; S.origin.z = o.origin.z; }
    if (o.span) S.spanX = o.span;
    if (o.seed != null) S.rng = GLT.rng.create(o.seed >>> 0);
    S.rate = o.rate || 1;
    S.on = true;
    S.next = 0;
    S.count = 0;
  }

  function stop() { S.on = false; }

  function launchShell() {
    let s = null;
    for (let i = 0; i < S.shells.length; i++) if (!S.shells[i].on) { s = S.shells[i]; break; }
    if (!s) return;
    const R = S.rng;
    s.on = true;
    s.x = S.origin.x + (R.next() - 0.5) * 2 * S.spanX;
    s.y = S.origin.y + 1.5;
    s.z = S.origin.z + (R.next() - 0.5) * 6 - 4;
    s.vx = (R.next() - 0.5) * 2.4; s.vz = (R.next() - 0.5) * 1.4;
    s.vy = 15 + R.next() * 4;
    s.fuse = 0.8 + R.next() * 0.25;
    s.age = 0; s.acc = 0;
    const cs = S.colors;
    s.color = cs[(S.count + (R.next() * 2 | 0)) % cs.length];
    s.color2 = cs[(S.count + 1 + (R.next() * (cs.length - 1) | 0)) % cs.length];
    const roll = R.next();
    s.type = S.count === 0 ? 0 : roll < 0.4 ? 0 : roll < 0.62 ? 1 : roll < 0.82 ? 2 : 3;
    S.count++;
    // launch thump: sparks + smoke at the mortar
    V.x = s.x; V.y = s.y; V.z = s.z;
    P().emit('spark', V, O_LSPARK);
    P().emit('smoke', V, O_LSMOKE);
  }

  function burst(s) {
    const R = S.rng;
    const Pp = P();
    const x = s.x, y = s.y, z = s.z;
    V.x = x; V.y = y; V.z = z;
    const red = Pp.reduced() ? 0.5 : 1;
    // reduced motion: no white burst flash (stars still bloom, at half count)
    if (red === 1) Pp.emit('flash', V, O_BFLASH);
    if (s.type === 0) {            // peony: two-tone sphere
      const n = Math.round(96 * red);
      for (let i = 0; i < n; i++) {
        const u = R.next() * 2 - 1, th = R.next() * 6.2832, r = Math.sqrt(1 - u * u), sp = 10 + R.next() * 2.5;
        O_STAR.color = i & 1 ? s.color : s.color2; O_STAR.life = 1.2 + R.next() * 0.5; O_STAR.size = 0.42 + R.next() * 0.14;
        Pp.spawn('star', x, y, z, r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, O_STAR);
      }
    } else if (s.type === 1) {     // ring: tilted circle + inner pistil
      const n = Math.round(44 * red), tilt = 0.5 + R.next() * 0.6, yaw = R.next() * 6.28;
      const ct = Math.cos(tilt), st = Math.sin(tilt), cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.2832, sp = 11;
        let vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * st, vz = Math.sin(a) * sp * ct;
        const rx = vx * cy - vz * sy, rz = vx * sy + vz * cy; vx = rx; vz = rz;
        O_STAR.color = s.color; O_STAR.life = 1.3; O_STAR.size = 0.55;
        Pp.spawn('star', x, y, z, vx, vy, vz, O_STAR);
      }
      for (let i = 0; i < Math.round(16 * red); i++) {
        const u = R.next() * 2 - 1, th = R.next() * 6.2832, r = Math.sqrt(1 - u * u), sp = 4;
        O_STAR.color = 0xffffff; O_STAR.life = 0.8; O_STAR.size = 0.4;
        Pp.spawn('star', x, y, z, r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, O_STAR);
      }
    } else if (s.type === 2) {     // willow: gold, drooping, glittering
      const n = Math.round(56 * red);
      for (let i = 0; i < n; i++) {
        const u = R.next() * 1.6 - 0.6, th = R.next() * 6.2832, r = Math.sqrt(Math.max(0, 1 - u * u)), sp = 8 + R.next() * 2;
        O_STAR.color = 0xffc850; O_STAR.life = 2.2 + R.next() * 0.6; O_STAR.size = 0.42;
        Pp.spawn('star', x, y, z, r * Math.cos(th) * sp, u * sp + 2, r * Math.sin(th) * sp, O_STAR);
      }
      V.x = x; V.y = y; V.z = z; O_GLIT.count = Math.round(30 * red);
      Pp.emit('glitter', V, O_GLIT);
    } else {                       // crossette: four comets that split
      for (let k = 0; k < 4; k++) {
        const a = k * 1.5708 + R.next() * 0.4;
        addComet(x, y, z, Math.cos(a) * 9, 4 + R.next() * 3, Math.sin(a) * 9, s.color, 0.55);
        addComet(x, y, z, Math.cos(a + 0.78) * 6, 9, Math.sin(a + 0.78) * 6, s.color2, 0.5);
      }
    }
  }

  function addComet(x, y, z, vx, vy, vz, color, T) {
    let c = null;
    for (let i = 0; i < S.comets.length; i++) if (!S.comets[i].on) { c = S.comets[i]; break; }
    if (!c) return;
    c.on = true; c.x = x; c.y = y; c.z = z; c.vx = vx; c.vy = vy; c.vz = vz; c.age = 0; c.T = T; c.color = color; c.acc = 0;
  }

  function update(dt, t) {
    if (!S.ok) return;
    S.t = t;
    if (dt <= 0) return;
    const Pp = P();
    if (S.on) {
      S.next -= dt;
      if (S.next <= 0) {
        launchShell();
        // first volley comes quick, then a steady rhythm with occasional doubles;
        // reduced motion keeps one shell per second at most (no quick volley)
        S.next = P().reduced() ? 1 + S.rng.next() * 0.6
          : (S.count < 3 ? 0.28 : 0.45 + S.rng.next() * 0.55) / S.rate;
      }
    }
    for (let i = 0; i < S.shells.length; i++) {
      const s = S.shells[i];
      if (!s.on) continue;
      s.age += dt;
      s.vy -= 9 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.acc += dt * 40;
      while (s.acc >= 1) { s.acc -= 1; Pp.spawn('rocket', s.x, s.y - 0.3, s.z, 0, -1, 0, O_TRAIL); }
      if (s.age >= s.fuse) { s.on = false; burst(s); }
    }
    for (let i = 0; i < S.comets.length; i++) {
      const c = S.comets[i];
      if (!c.on) continue;
      c.age += dt;
      c.vy -= 6 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      c.acc += dt * 50;
      while (c.acc >= 1) { c.acc -= 1; O_STAR.color = c.color; O_STAR.life = 0.35; O_STAR.size = 0.4; Pp.spawn('star', c.x, c.y, c.z, 0, 0, 0, O_STAR); }
      if (c.age >= c.T) {
        c.on = false;
        for (let k = 0; k < 10; k++) {
          const a = k * 0.628;
          O_STAR.color = k & 1 ? 0xffffff : c.color; O_STAR.life = 0.8; O_STAR.size = 0.42;
          Pp.spawn('star', c.x, c.y, c.z, Math.cos(a) * 6, Math.sin(a * 2) * 3 + 1, Math.sin(a) * 6, O_STAR);
        }
      }
    }
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    S.on = false;
    S.shells = []; S.comets = [];
    if (GLT._fx_ceremony) GLT._fx_ceremony.dispose();
    S.ok = false;
  }

  GLT.fireworks = {
    init, start, stop, dispose,
    // additions (fx area)
    aimAt,
    active() { return S.on; },
    burstNow(type, pos, colors) {
      if (!S.ok && !init()) return;
      const s = { x: pos.x, y: pos.y, z: pos.z, type: type || 0, color: starColor((colors && colors[0]) || S.colors[0]), color2: starColor((colors && colors[1]) || S.colors[1] || S.colors[0]) };
      burst(s);
    },
    raise(plate, crew, o) { if (!S.ok) init(); if (GLT._fx_ceremony) GLT._fx_ceremony.raise(plate, crew, o); },
    lower(instant) { if (GLT._fx_ceremony) GLT._fx_ceremony.lower(instant); },
    // WANTED poster (same contract as GLT.wanted.draw, ARCHITECTURE.md §11.5); ui may delegate to it.
    poster(canvas, o) { return GLT._fx_wanted ? GLT._fx_wanted.draw(canvas, o) : null; }
  };
})();
