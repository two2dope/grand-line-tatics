/* GLT._fx_demos (private, fx area): demos for the fx piece (ARCHITECTURE.md §13).
 *   fx.volley   (aliases fx.shots, volley)       : a salvo exchange between the plates: arcs, trails, muzzle flashes,
 *                                                  reticles, splash rings, hits with fire
 *   fx.hit-sink (aliases fx.hit, fx.sink, hit-sink): close-up: three hits walk along the Red Force, the third sinks it
 *   fx.fireworks (aliases fx.ceremony, fireworks) : the ceremony on the winner plate: Jolly Roger hoist, confetti, fireworks
 *   fx.wanted   (alias wanted)                    : the WANTED poster counting up over the ceremony scene (?seed= picks crew)
 *   fx.wanted-all                                 : all six posters (settled), for review
 *   fx.techniques                                 : the six technique FX on the enemy plate
 *   fx.weather                                    : rain + lightning (use --tod storm)
 * Every demo is scripted on game time (GLT.clock.after), so ?t= freezes a reproducible frame. Results go through the bus
 * (shot:resolved / ship:sunk) so plates mark the cells exactly like in a match. When GLT.fleet3d is still inert, ships
 * are stood in with GLT.shipModels at their GLT.layout transforms (and sunk by the demo) so the FX have real hulls. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  function call(ns, fn) {
    const m = GLT[ns];
    if (!m || typeof m[fn] !== 'function') return undefined;
    return m[fn].apply(m, Array.prototype.slice.call(arguments, 2));
  }

  // ---------------------------------------------------------------- stand-in fleet (only when fleet3d is inert)
  const stand = { on: false, ships: [], off: null };
  function standInFleet(plate, fleet, crew) {
    if (!GLT.shipModels || !GLT.shipModels.build) return;
    const cc = GLT.data.crews[crew].colors;
    fleet.ships.forEach((sh) => {
      let m;
      try { m = GLT.shipModels.build(sh.id, { trim: cc.trim, pennant: cc.primary, crew }); } catch (e) { return; }
      const tf = GLT.layout.shipTransform(plate, sh);
      m.group.position.set(tf.x, tf.y, tf.z);
      m.group.rotation.y = tf.yaw;
      GLT.scene.add(m.group, 'ships');
      stand.ships.push({ plate, ship: sh, model: m, tf, sink: -1, ph: stand.ships.length * 1.7 });
    });
    if (!stand.off) {
      stand.off = GLT.clock.onFrame((dt, t) => {
        if (GLT.shipModels.tick) GLT.shipModels.tick(t, GLT.lighting && GLT.lighting.nightFactor ? GLT.lighting.nightFactor() : 0);
        for (let i = 0; i < stand.ships.length; i++) {
          const s = stand.ships[i], g = s.model.group;
          const bob = Math.sin(t * 1.3 + s.ph);
          if (s.sink < 0) {
            g.position.y = s.tf.y + bob * 0.08;
            g.rotation.x = Math.sin(t * 1.1 + s.ph) * 0.03;
            g.rotation.z = Math.sin(t * 0.9 + s.ph) * 0.02;
          } else {
            s.sink += dt;
            const u = Math.min(1, s.sink / 2.4);
            const e = u * u * (3 - 2 * u);
            g.rotation.z = -e * 0.42;                 // bow rises, stern goes first
            g.rotation.x = e * 0.22;
            g.position.y = s.tf.y - e * 7.5;
            if (u >= 1) g.visible = false;
          }
        }
      }, 300);
    }
    stand.on = true;
  }
  function standSink(plate, shipId) {
    stand.ships.forEach((s) => { if (s.plate === plate && s.ship.id === shipId && s.sink < 0) s.sink = 0; });
  }
  function standMuzzle(plate, shipId) {
    const s = stand.ships.find((x) => x.plate === plate && x.ship.id === shipId);
    if (!s) return null;
    const mz = (s.model.anchors.muzzles && s.model.anchors.muzzles[0]) || { x: s.model.length * 0.3, y: 1.2, z: 0 };
    const c = Math.cos(s.tf.yaw), sn = Math.sin(s.tf.yaw);
    return { x: s.tf.x + mz.x * c + mz.z * sn, y: s.tf.y + mz.y, z: s.tf.z - mz.x * sn + mz.z * c };
  }

  const FX_CROWD = false;

  // ---------------------------------------------------------------- common scene
  function setup(ctx, o) {
    o = o || {};
    const n = o.n || 10;
    GLT.layout.setSize(n);
    ['ocean', 'plates', 'backdrop', 'props', 'crowd', 'particles', 'shotFx', 'fireworks', 'weather'].forEach((ns) => call(ns, 'init'));
    call('plates', 'build', n);
    const crews = o.crews || ['strawHat', 'marine'];
    const colors = crews.map((id) => GLT.data.crews[id].colors.primary);
    call('plates', 'setColors', { own: colors[0], enemy: colors[1] });
    // The crowd stays out of fx demos for now: world/crowd.js (instanceColor) and ships/fleet3d.js crew (no instanceColor)
    // share GLT.voxel.material('solid') across InstancedMeshes, which three r128 cannot do (pageerror in renderBufferDirect).
    if (!o.noCrowd && FX_CROWD) call('crowd', 'build', crews, colors);
    call('backdrop', 'setLift', true);
    if (GLT.particles.reseed) GLT.particles.reseed(ctx.seed || 1);
    const fleetOwn = o.fleetOwn || ctx.sampleFleet('classica');
    const fleetEnemy = o.fleetEnemy || ctx.sampleFleet('classica');
    const live = !!(GLT.fleet3d && GLT.fleet3d.init && GLT.fleet3d.init());
    if (live) {
      GLT.fleet3d.setFleet('own', fleetOwn, { crew: crews[0], colors: GLT.data.crews[crews[0]].colors, visible: true });
      if (o.enemyVisible) GLT.fleet3d.setFleet('enemy', fleetEnemy, { crew: crews[1], colors: GLT.data.crews[crews[1]].colors, visible: true });
    } else {
      standInFleet('own', fleetOwn, crews[0]);
      if (o.enemyVisible) standInFleet('enemy', fleetEnemy, crews[1]);
    }
    if (o.foam !== false) { call('plates', 'setFoam', 'own', fleetOwn.ships); if (o.enemyVisible) call('plates', 'setFoam', 'enemy', fleetEnemy.ships); }
    call('weather', 'set', { tod: ctx.tod, sea: o.sea || 'calmo' });
    return { live, crews, fleetOwn, fleetEnemy };
  }

  function muzzleFor(env, plate, shipId, target) {
    let p = null;
    if (env.live && GLT.fleet3d.muzzle) p = GLT.fleet3d.muzzle(plate, shipId);
    if (!p && !env.live) p = standMuzzle(plate, shipId);
    return p || GLT.layout.launcher(plate, target);
  }

  function shipAt(fleet, r, c) {
    for (const s of fleet.ships) {
      for (let i = 0; i < s.len; i++) {
        const rr = s.dir === 'v' ? s.r + i : s.r, cc = s.dir === 'h' ? s.c + i : s.c;
        if (rr === r && cc === c) return s;
      }
    }
    return null;
  }

  let shotN = 0;
  // one scripted shot through the real pipeline: launch at `at`, resolve on landing via the bus
  function scriptShot(env, o) {
    const E = GLT.events;
    GLT.clock.after(o.at, () => {
      const id = 'demo' + (++shotN);
      const fromPlate = o.plate === 'enemy' ? 'own' : 'enemy';
      const from = muzzleFor(env, fromPlate, o.shipId || null, o.plate);
      const to = GLT.shotFx.cellPos(o.plate, o.r, o.c, 0);
      const flight = o.flight || GLT.C.T.flight;
      GLT.shotFx.launch(from, to, flight, { id, plate: o.plate, r: o.r, c: o.c, fromPlate, shipId: o.shipId });
      if (env.live && o.shipId) call('fleet3d', 'recoil', fromPlate, o.shipId);
      GLT.clock.after(flight, () => {
        const by = o.plate === 'enemy' ? 0 : 1;
        E.emit('shot:resolved', { id, by, mine: by === 0, plate: o.plate, r: o.r, c: o.c, label: GLT.board.label(o.r, o.c), result: o.result, ship: o.ship, tech: null });
        if (o.result === 'afundou' && o.ship) {
          E.emit('ship:sunk', { by, mine: by === 0, plate: o.plate, ship: o.ship, shipId: o.ship.id, owner: 1 - by });
          if (!env.live) standSink(o.plate, o.ship.id);
        }
      });
    });
  }

  // ---------------------------------------------------------------- fx.volley
  function volley(ctx) {
    const env = setup(ctx, { enemyVisible: false });
    const ownShips = env.fleetOwn.ships.map((s) => s.id);
    const targets = [[1, 2], [4, 6], [6, 1], [2, 8], [7, 4], [5, 5], [8, 8], [0, 5]];
    targets.forEach((tg, i) => {
      const s = shipAt(env.fleetEnemy, tg[0], tg[1]);
      scriptShot(env, { at: 0.05 + i * 0.32, plate: 'enemy', r: tg[0], c: tg[1], result: s ? 'acerto' : 'agua', shipId: ownShips[i % ownShips.length], flight: 1.1 });
    });
    // return fire onto our waters
    [[3, 3], [6, 7], [1, 7]].forEach((tg, i) => {
      const s = shipAt(env.fleetOwn, tg[0], tg[1]);
      scriptShot(env, { at: 0.4 + i * 0.45, plate: 'own', r: tg[0], c: tg[1], result: s ? 'acerto' : 'agua', flight: 1.1 });
    });
    if (GLT.camera && GLT.camera.set) GLT.camera.set({ azimuth: 24, elevation: 34, zoom: 1.45, target: { x: 4, y: GLT.C.PLATE_Y + 2, z: -2 } }, { instant: true });
  }

  // ---------------------------------------------------------------- fx.hit-sink
  function hitSink(ctx) {
    const fleet = { format: 'classica', ships: [
      { id: 'redForce', r: 4, c: 3, dir: 'h', len: 3 }, { id: 'thousandSunny', r: 7, c: 2, dir: 'h', len: 4 },
      { id: 'goingMerry', r: 1, c: 6, dir: 'v', len: 2 }, { id: 'polarTang', r: 1, c: 1, dir: 'h', len: 3 },
      { id: 'mobyDick', r: 3, c: 8, dir: 'v', len: 5 }
    ] };
    const env = setup(ctx, { fleetOwn: fleet, crews: ['redHair', 'blackbeard'], noCrowd: /nc$/.test(ctx.name || '') });
    const rf = fleet.ships[0];
    scriptShot(env, { at: 0.0, plate: 'own', r: 4, c: 3, result: 'acerto' });
    scriptShot(env, { at: 1.3, plate: 'own', r: 3, c: 5, result: 'agua' });
    scriptShot(env, { at: 1.9, plate: 'own', r: 4, c: 4, result: 'acerto' });
    scriptShot(env, { at: 3.3, plate: 'own', r: 4, c: 5, result: 'afundou', ship: rf });
    const tf = GLT.layout.shipTransform('own', rf);
    if (GLT.camera && GLT.camera.set) GLT.camera.set({ azimuth: 28, elevation: 30, zoom: 2.7, target: { x: tf.x + 1, y: GLT.C.PLATE_Y + 2.5, z: tf.z } }, { instant: true });
  }

  // ---------------------------------------------------------------- fx.fireworks / ceremony
  function fireworks(ctx) {
    const crew = 'strawHat';
    setup(ctx, { crews: [crew, 'marine'] });
    if (GLT.camera && GLT.camera.setMode) GLT.camera.setMode('ceremony', { instant: true, plate: 'own' });
    GLT.clock.after(0.05, () => {
      GLT.events.emit('ceremony:start', { winner: 0, mine: true, crew, captainKey: GLT.data.crews[crew].captainKey, bounty: 1500000000, plate: 'own' });
    });
  }

  // ---------------------------------------------------------------- fx.wanted
  const CREWS = ['strawHat', 'whitebeard', 'redHair', 'heart', 'blackbeard', 'marine'];
  function overlay(ctx) {
    const host = document.createElement('div');
    host.className = 'glt-fx-poster-host';
    host.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;gap:28px;flex-wrap:wrap;' +
      'background:radial-gradient(ellipse at center, rgba(10,8,24,0.25) 0%, rgba(10,8,24,0.72) 75%);pointer-events:none;';
    (ctx.root || document.body).appendChild(host);
    return host;
  }
  function posterCanvas(host, scale) {
    const cv = document.createElement('canvas');
    cv.width = GLT._fx_wanted.W; cv.height = GLT._fx_wanted.H;
    cv.style.cssText = 'image-rendering:pixelated;image-rendering:crisp-edges;width:' + (GLT._fx_wanted.W * scale) + 'px;height:' + (GLT._fx_wanted.H * scale) +
      'px;filter:drop-shadow(0 ' + (3 * scale) + 'px 0 rgba(12,6,20,0.55));';
    cv.setAttribute('role', 'img');
    host.appendChild(cv);
    return cv;
  }
  async function wanted(ctx) {
    const crew = CREWS[((ctx.seed || 1) - 1) % CREWS.length];
    setup(ctx, { crews: [crew, crew === 'marine' ? 'strawHat' : 'marine'] });
    if (GLT.camera && GLT.camera.setMode) GLT.camera.setMode('ceremony', { instant: true, plate: 'own' });
    GLT.clock.after(0.05, () => GLT.events.emit('ceremony:start', { winner: 0, mine: true, crew, captainKey: GLT.data.crews[crew].captainKey, bounty: 0, plate: 'own' }));
    await GLT._fx_wanted.ready();
    const host = overlay(ctx);
    const vh = window.innerHeight || 720, vw = window.innerWidth || 1280;
    const scale = Math.max(1, Math.floor(Math.min((vh * 0.92) / GLT._fx_wanted.H, (vw * 0.9) / GLT._fx_wanted.W)));
    const cv = posterCanvas(host, scale);
    const bounty = [1500000000, 5046000000, 4048900000, 3000000000, 3996000000, 3000000000][CREWS.indexOf(crew)];
    const hero = crew === 'marine';
    cv.setAttribute('aria-label', GLT.T('ceremony.wanted'));
    const COUNT = 2.6;
    const redraw = (t) => GLT.fireworks.poster(cv, { crew, bounty, progress: Math.min(1, t / COUNT), seed: ctx.seed || 1, hero });
    redraw(0);
    GLT.clock.onFrame((dt, t) => { if (t <= COUNT + 0.1 || dt === 0) redraw(t); }, 700);
  }
  async function wantedAll(ctx) {
    setup(ctx, {});
    if (GLT.camera && GLT.camera.setMode) GLT.camera.setMode('ceremony', { instant: true, plate: 'own' });
    await GLT._fx_wanted.ready();
    const host = overlay(ctx);
    const vw = window.innerWidth || 1280, vh = window.innerHeight || 720;
    const scale = Math.max(1, Math.floor(Math.min((vw - 120) / (3 * GLT._fx_wanted.W), (vh - 80) / (2 * GLT._fx_wanted.H))));
    const bounties = [1500000000, 5046000000, 4048900000, 3000000000, 3996000000, 3000000000];
    CREWS.forEach((crew, i) => {
      const cv = posterCanvas(host, scale);
      GLT.fireworks.poster(cv, { crew, bounty: bounties[i], progress: 1, seed: i + 1, hero: crew === 'marine' });
    });
  }

  // ---------------------------------------------------------------- fx.techniques
  function techniques(ctx) {
    setup(ctx, {});
    const E = GLT.events;
    const plan = [
      { at: 0.0, tech: 'bazooka', cells: [{ r: 1, c: 1 }, { r: 1, c: 2 }, { r: 2, c: 1 }, { r: 2, c: 2 }] },
      { at: 0.3, tech: 'tremor', cells: [{ r: 6, c: 6 }, { r: 5, c: 6 }, { r: 7, c: 6 }, { r: 6, c: 5 }, { r: 6, c: 7 }] },
      { at: 0.6, tech: 'haki', cells: [{ r: 2, c: 6 }, { r: 2, c: 7 }, { r: 2, c: 8 }, { r: 3, c: 6 }, { r: 3, c: 7 }, { r: 3, c: 8 }, { r: 1, c: 6 }, { r: 1, c: 7 }, { r: 1, c: 8 }] },
      { at: 0.9, tech: 'room', cells: [], target: { axis: 'row', index: 8 } },
      { at: 1.1, tech: 'observation', cells: [{ r: 5, c: 2 }] }
    ];
    plan.forEach((p) => GLT.clock.after(p.at, () => {
      E.emit('technique:used', { by: 0, mine: true, plate: 'enemy', tech: p.tech, target: p.target || p.cells[0], cells: p.cells, flightS: GLT.C.T.tech });
      if (p.tech === 'bazooka' || p.tech === 'tremor') {
        GLT.clock.after(GLT.C.T.tech, () => p.cells.forEach((cl, i) => E.emit('shot:resolved', { id: 'tech' + p.tech + i, by: 0, mine: true, plate: 'enemy', r: cl.r, c: cl.c, label: GLT.board.label(cl.r, cl.c), result: i === 1 ? 'acerto' : 'agua', tech: p.tech })));
      }
      if (p.tech === 'haki') GLT.clock.after(GLT.C.T.tech, () => E.emit('technique:resolved', { by: 0, mine: true, plate: 'enemy', tech: 'haki', result: { tech: 'haki', r: 2, c: 7, found: true } }));
      if (p.tech === 'observation') GLT.clock.after(GLT.C.T.tech, () => E.emit('technique:resolved', { by: 0, mine: true, plate: 'enemy', tech: 'observation', result: { tech: 'observation', cell: { r: 5, c: 2 } } }));
    }));
    // vortex armed on our own waters, then an incoming shot absorbed
    GLT.clock.after(0.2, () => E.emit('technique:used', { by: 0, mine: true, plate: 'enemy', tech: 'vortex', target: {}, cells: [], flightS: 0 }));
    GLT.clock.after(1.2, () => E.emit('vortex:absorbed', { by: 1, mine: false, plate: 'own', cells: [{ r: 4, c: 4 }] }));
    const pc = GLT.layout.plateCenter('enemy');
    if (GLT.camera && GLT.camera.set) GLT.camera.set({ azimuth: 22, elevation: 40, zoom: 1.6, target: { x: pc.x - 12, y: GLT.C.PLATE_Y + 1, z: pc.z } }, { instant: true });
  }

  // ---------------------------------------------------------------- fx.weather
  function weather(ctx) {
    setup(ctx, { sea: ctx.tod === 'storm' ? 'tempestade' : 'calmo' });
    call('weather', 'set', { tod: ctx.tod === 'day' ? 'storm' : ctx.tod, sea: 'tempestade' });
  }

  // every particle kind in a row on the own plate (palette/size check)
  function probe(ctx) {
    setup(ctx, { fleetOwn: { format: 'classica', ships: [] } });
    const kinds = GLT.particles.kinds();
    const pc = GLT.layout.plateCenter('own');
    GLT.clock.after(0.01, () => kinds.forEach((k, i) => {
      const x = pc.x - 18 + (i % 7) * 6, z = pc.z - 12 + Math.floor(i / 7) * 7;
      GLT.particles.emit(k, { x, y: GLT.C.PLATE_Y + 2, z }, { count: 12, color: /star|confetti|tglow|tint/.test(k) ? '#e04a6a' : undefined, floor: GLT.C.PLATE_Y });
    }));
    if (GLT.camera && GLT.camera.set) GLT.camera.set({ azimuth: 30, elevation: 40, zoom: 1.9, target: { x: pc.x, y: GLT.C.PLATE_Y, z: pc.z } }, { instant: true });
  }

  GLT.demos = GLT.demos || {};
  GLT.demos['fx.probe'] = probe;
  const reg = (names, fn) => names.forEach((n) => { GLT.demos[n] = fn; });
  reg(['fx.volley', 'fx.shots', 'volley'], volley);
  reg(['fx.hit-sink', 'fx.hit', 'fx.sink', 'hit-sink', 'fx.hit-sink-nc'], hitSink);
  reg(['fx.fireworks', 'fx.ceremony', 'fireworks'], fireworks);
  reg(['fx.wanted', 'wanted'], wanted);
  reg(['fx.wanted-all'], wantedAll);
  reg(['fx.techniques'], techniques);
  reg(['fx.weather'], weather);

  GLT._fx_demos = { setup, scriptShot };
})();
