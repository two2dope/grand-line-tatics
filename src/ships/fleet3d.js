/* GLT.fleet3d: ships on the plates: bob, sails, wakes, recoil, deck crew, damage, sinking, ghost, flag raise.
 * Area: ships. Contract: ARCHITECTURE.md §9, §11.2.
 *
 * One instance per placed ship: outer Group at GLT.layout.shipTransform (yaw), inner `bob` Group (heave/roll/pitch on
 * the plate swell, within the §9 limits), and the model (GLT.shipModels; undamaged models are shared templates cloned
 * per instance, a damaged ship gets its own rebuilt geometry). Shared, instanced across ALL ships: deck crew (one
 * InstancedMesh per crew kind), waterline foam/wake chips, sinking bubbles. Draw calls: 3 per visible ship + 5 crew +
 * 2 (foam, bubbles) + one per wreck flag / oil slick.
 * Owner colours: plate colours come from match:created / GLT.app.colorsOf; only trim + pennant change.
 * Enemy ships stay invisible until sunk (spawned at their placement, then sink) or revealed at game end.
 * Every animation is a function of game time (GLT.clock onFrame t/dt), so ?t= demos are deterministic.
 * No THREE/DOM/GLT access at load time (call time only). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const PLATES = ['own', 'enemy'];
  const DEG = Math.PI / 180;
  const BRACE = { h: -0.85, v: 0.5 };    // sail bracing (rad) so the canvas faces the default camera azimuth
  const SINK_S = 3.6, DIVE_S = 3.2;
  const CREW_CAP = 200, FOAM_CAP = 900, BUBBLE_CAP = 240;

  const S = {
    ok: false, root: null, offs: [], t: 0, rng: null,
    plates: null, cache: new Map(), ghost: null, ghostKey: '', ghostMats: null,
    crew: {}, foam: null, bubbles: null, pool: [], extras: [], dbg: '',
    local: 0, colors: [null, null], crews: ['strawHat', 'marine']
  };

  function mkPlate() { return { insts: [], hits: new Set(), colors: null, crew: 'strawHat', visible: true }; }

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeIn = (x) => Math.pow(clamp(x, 0, 1), 3);
  const easeInOut = (x) => { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const now = () => (GLT.clock && GLT.clock.now ? GLT.clock.now() : S.t);

  function normColors(c, crewId) {
    if (!c && crewId && GLT.data.crews[crewId]) c = GLT.data.crews[crewId].colors;
    if (typeof c === 'string') return { trim: c, primary: c, secondary: '#fffbf0' };
    c = c || {};
    const trim = c.trim || c.primary || '#e23b2e';
    return { trim, primary: c.primary || trim, secondary: c.secondary || '#fffbf0' };
  }

  function plateColors(plate) {
    const P = S.plates[plate];
    if (P.colors) return P.colors;
    const player = plate === 'own' ? (S.local == null ? 0 : S.local) : 1 - (S.local == null ? 0 : S.local);
    if (S.colors[player]) return normColors(S.colors[player], S.crews[player]);
    return normColors(null, S.crews[player] || (plate === 'own' ? 'strawHat' : 'marine'));
  }

  function shipCells(ship) {
    const out = [];
    for (let i = 0; i < ship.len; i++) out.push(ship.dir === 'v' ? { r: ship.r + i, c: ship.c } : { r: ship.r, c: ship.c + i });
    return out;
  }
  const sameShip = (a, b) => a && b && a.id === b.id && a.r === b.r && a.c === b.c && a.dir === b.dir;

  // Smooth copy of the plates' swell (world/plates.js quantises it to 1/8 m; ships ride the unquantised wave).
  function swell(pi, r, c, t, amp) {
    const a = Math.sin(c * 0.85 + r * 0.45 - t * 1.5 + pi * 1.3);
    const b = Math.sin(r * 1.1 - c * 0.35 + t * 1.05 + pi * 0.7);
    return (0.11 * a + 0.07 * b) * amp;
  }
  function seaAmp() {
    if (GLT.ocean && GLT.ocean.sea && GLT.ocean.sea() === 'tempestade') return 1.7;
    const st = GLT.lighting && GLT.lighting.stormFactor ? GLT.lighting.stormFactor() : 0;
    return 1 + st * 0.6;
  }

  // ------------------------------------------------------------------ models / instances
  function template(ship, colors, crewId) {
    const key = ship.id + '|' + ship.dir + '|' + colors.trim + '|' + colors.primary + '|' + colors.secondary;
    let tpl = S.cache.get(key);
    if (!tpl) {
      tpl = GLT.shipModels.build(ship.id, { trim: colors.trim, pennant: colors.primary, pennant2: colors.secondary, crew: crewId, brace: BRACE[ship.dir] || 0 });
      S.cache.set(key, tpl);
    }
    return tpl;
  }

  function makeInst(plate, ship, colors, crewId, visible) {
    const tpl = template(ship, colors, crewId);
    const outer = new THREE.Group();
    outer.name = 'fleet-' + plate + '-' + ship.id;
    const bob = new THREE.Group();
    outer.add(bob);
    const body = tpl.group.clone();
    bob.add(body);
    const inst = {
      ship: Object.assign({}, ship), plate, colors, crewId, tpl, model: tpl, own: false, outer, bob, body,
      segs: [], state: 'afloat', kind: null, t0: 0, recoilT: -99, cheerT: -99, panicT: -99,
      phase: S.rng.next() * 6.28, side: S.rng.chance(0.5) ? 1 : -1, cells: shipCells(ship), visible: visible !== false,
      faces: tpl.anchors.crew.map(() => S.rng.next() * 6.28), spawned: false, flagDone: false, slick: null
    };
    outer.visible = inst.visible;
    place(inst);
    S.root.add(outer);
    return inst;
  }

  function place(inst) {
    const tr = GLT.layout.shipTransform(inst.plate, inst.ship);
    inst.outer.position.set(tr.x, tr.y, tr.z);
    inst.outer.rotation.y = tr.yaw;
    inst.cells = shipCells(inst.ship);
  }

  function disposeInst(inst) {
    if (inst.outer.parent) inst.outer.parent.remove(inst.outer);
    if (inst.own) GLT.voxel.dispose(inst.body);
  }

  // Rebuild a damaged ship's own geometry (segments are cell indices from the stern).
  function rebuildDamaged(inst) {
    const m = GLT.shipModels.build(inst.ship.id, {
      trim: inst.colors.trim, pennant: inst.colors.primary, pennant2: inst.colors.secondary, crew: inst.crewId,
      brace: BRACE[inst.ship.dir] || 0, damage: inst.segs.slice().sort((a, b) => a - b)
    });
    if (inst.own) GLT.voxel.dispose(inst.body); else inst.bob.remove(inst.body);
    inst.body = m.group;
    inst.model = m;
    inst.own = true;
    inst.bob.add(m.group);
  }

  function segOf(inst, r, c) {
    const s = inst.ship;
    if (s.dir === 'v') return c === s.c && r >= s.r && r < s.r + s.len ? r - s.r : -1;
    return r === s.r && c >= s.c && c < s.c + s.len ? c - s.c : -1;
  }

  function instAt(plate, r, c) {
    const P = S.plates[plate];
    for (const inst of P.insts) if (segOf(inst, r, c) >= 0) return inst;
    return null;
  }
  function instById(plate, id) {
    const P = S.plates[plate];
    for (const inst of P.insts) if (inst.ship.id === id) return inst;
    return null;
  }

  // ------------------------------------------------------------------ public: fleets
  function setFleet(plate, fleet, o) {
    if (!S.ok && !init()) return;
    o = o || {};
    const P = S.plates[plate];
    if (o.colors || o.crew) P.colors = normColors(o.colors, o.crew);
    if (o.crew) P.crew = o.crew;
    const colors = plateColors(plate);
    const visible = o.visible != null ? !!o.visible : plate === 'own';
    P.visible = visible;
    const ships = fleet && fleet.ships ? fleet.ships : [];
    const keep = [];
    P.insts.forEach((inst) => {
      const match = ships.some((s) => sameShip(s, inst.ship)) && inst.colors.trim === colors.trim && inst.colors.primary === colors.primary && inst.state === 'afloat';
      if (match) { inst.visible = visible; inst.outer.visible = visible; keep.push(inst); } else disposeInst(inst);
    });
    P.insts = keep;
    ships.forEach((s) => {
      if (keep.some((k) => sameShip(k.ship, s))) return;
      const inst = makeInst(plate, s, colors, P.crew, visible);
      P.insts.push(inst);
      const segs = [];
      inst.cells.forEach((cl, i) => { if (P.hits.has(cl.r * 64 + cl.c)) segs.push(i); });
      if (segs.length) { inst.segs = segs; rebuildDamaged(inst); }
    });
  }

  function clearExtras(plate) {
    S.extras = S.extras.filter((e) => {
      if (plate && e.plate !== plate) return true;
      if (e.obj.parent) e.obj.parent.remove(e.obj);
      e.obj.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
      return false;
    });
  }

  function clear(plate) {
    if (!S.ok) return;
    PLATES.forEach((p) => {
      if (plate && p !== plate) return;
      S.plates[p].insts.forEach(disposeInst);
      S.plates[p].insts = [];
      S.plates[p].hits = new Set();
    });
    clearExtras(plate);
  }

  function ghost(ship, valid, o) {
    if (!S.ok && !init()) return;
    if (!ship) { if (S.ghost) S.ghost.visible = false; return; }
    const colors = o && (o.colors || o.crew) ? normColors(o.colors, o.crew) : plateColors('own');
    const tpl = template(ship, colors, (o && o.crew) || S.plates.own.crew);
    const key = ship.id + '|' + ship.dir + '|' + colors.trim;
    if (!S.ghostMats) {
      S.ghostMats = {
        ok: GLT.voxel.material('glass', { vertexColors: false, color: 0x7fe08a, opacity: 0.5 }),
        bad: GLT.voxel.material('glass', { vertexColors: false, color: 0xff5a4a, opacity: 0.5 })
      };
    }
    if (S.ghostKey !== key) {
      if (S.ghost && S.ghost.parent) S.ghost.parent.remove(S.ghost);
      S.ghost = tpl.group.clone();
      S.ghost.name = 'fleet-ghost';
      S.ghost.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; m.renderOrder = 5; } });
      S.root.add(S.ghost);
      S.ghostKey = key;
    }
    const mat = valid ? S.ghostMats.ok : S.ghostMats.bad;
    S.ghost.traverse((m) => { if (m.isMesh) m.material = mat; });
    const tr = GLT.layout.shipTransform('own', ship);
    S.ghost.position.set(tr.x, tr.y + 0.05, tr.z);
    S.ghost.rotation.y = tr.yaw;
    S.ghost.visible = true;
  }

  function damage(plate, r, c) {
    if (!S.ok) return;
    const P = S.plates[plate];
    P.hits.add(r * 64 + c);
    const inst = instAt(plate, r, c);
    if (!inst || inst.state !== 'afloat') return;
    const seg = segOf(inst, r, c);
    if (inst.segs.indexOf(seg) >= 0) return;
    inst.segs.push(seg);
    rebuildDamaged(inst);
    inst.panicT = now();
  }

  // Sink: the ship lists, settles stern-first with an eased descent and bubbles; its flag stays afloat on a bit of
  // wreckage. The Polar Tang dives bow-first instead and leaves an oil slick.
  function sink(plate, ship, o) {
    if (!S.ok && !init()) return;
    const P = S.plates[plate];
    let inst = instById(plate, ship.id);
    if (inst && !sameShip(inst.ship, ship)) { disposeInst(inst); P.insts = P.insts.filter((i) => i !== inst); inst = null; }
    if (!inst) {
      const colors = o && (o.colors || o.crew) ? normColors(o.colors, o.crew) : plateColors(plate);
      inst = makeInst(plate, ship, colors, (o && o.crew) || P.crew, true);
      P.insts.push(inst);
      const segs = [];
      inst.cells.forEach((cl, i) => { if (P.hits.has(cl.r * 64 + cl.c)) segs.push(i); });
      if (segs.length) { inst.segs = segs; rebuildDamaged(inst); }
    }
    if (inst.state !== 'afloat') return;
    inst.visible = true;
    inst.outer.visible = true;
    inst.state = 'sinking';
    inst.kind = ship.id === 'polarTang' ? 'dive' : 'sink';
    inst.t0 = now();
    if (o && o.instant) finishSink(inst, true);
  }

  function finishSink(inst, instant) {
    inst.state = 'sunk';
    inst.outer.visible = false;
    if (!inst.flagDone) spawnFlotsam(inst, instant);
    if (inst.kind === 'dive' && !inst.slick) spawnSlick(inst, instant);
  }

  function spawnFlotsam(inst, instant) {
    inst.flagDone = true;
    const obj = GLT.shipModels.flotsam(GLT.data.ships[inst.ship.id].flag);
    const tr = GLT.layout.shipTransform(inst.plate, inst.ship);
    const off = (inst.ship.len * GLT.C.CELL) * 0.18 * inst.side;
    const along = inst.ship.dir === 'v' ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const ex = { plate: inst.plate, kind: 'flotsam', obj, t0: instant ? -99 : now(),
      x: tr.x + along.x * off, z: tr.z + along.z * off, yaw: tr.yaw + inst.side * 0.5, ph: inst.phase, cell: inst.cells[Math.floor(inst.cells.length / 2)] };
    obj.position.set(ex.x, GLT.C.PLATE_Y, ex.z);
    obj.rotation.y = ex.yaw;
    S.root.add(obj);
    S.extras.push(ex);
  }

  function spawnSlick(inst, instant) {
    const obj = GLT.shipModels.oilSlick(inst.ship.len * GLT.C.CELL * 0.42, GLT.rng.hashString(inst.plate + inst.ship.id));
    const tr = GLT.layout.shipTransform(inst.plate, inst.ship);
    obj.position.set(tr.x, GLT.C.PLATE_Y + 0.27, tr.z);
    obj.rotation.y = tr.yaw;
    S.root.add(obj);
    const ex = { plate: inst.plate, kind: 'slick', obj, t0: instant ? -99 : now() };
    inst.slick = ex;
    S.extras.push(ex);
  }

  function recoil(plate, shipId) {
    if (!S.ok) return;
    const inst = shipId ? instById(plate, shipId) : null;
    if (inst) inst.recoilT = now();
  }

  // World position of a cannon muzzle on that ship, on the side facing the other plate; null when hidden/unknown.
  const _v = { x: 0, y: 0, z: 0 };
  function muzzle(plate, shipId) {
    if (!S.ok || !shipId) return null;
    const inst = instById(plate, shipId);
    if (!inst || !inst.outer.visible || inst.state !== 'afloat') return null;
    inst.outer.updateMatrixWorld(true);
    const ms = inst.model.anchors.muzzles;
    if (!ms.length) return null;
    const v = new THREE.Vector3();
    let best = null, bestX = -Infinity;
    const dirX = plate === 'own' ? 1 : -1;
    ms.forEach((m) => {
      v.set(m.x, m.y, m.z);
      inst.body.localToWorld(v);
      if (v.x * dirX > bestX) { bestX = v.x * dirX; best = { x: v.x, y: v.y, z: v.z }; }
    });
    return best;
  }

  // Ceremony: the winner hoists its Jolly Roger on a tall pole planted on the back rim of its plate.
  function raiseFlag(plate, crew) {
    if (!S.ok && !init()) return;
    S.extras.filter((e) => e.kind === 'victory').forEach((e) => { if (e.obj.parent) e.obj.parent.remove(e.obj); });
    S.extras = S.extras.filter((e) => e.kind !== 'victory');
    const flagId = GLT.data.crews[crew] ? GLT.data.crews[crew].flag : (GLT.data.flags.indexOf(crew) >= 0 ? crew : 'strawHat');
    const obj = GLT.shipModels.victoryFlag(flagId, 13);
    const b = GLT.layout.gridBounds(plate);
    const cx = (b.minX + b.maxX) / 2;
    obj.position.set(cx + 1.9, GLT.C.PLATE_Y + GLT.C.RIM_TOP, b.minZ - GLT.C.RIM / 2);
    S.root.add(obj);
    S.extras.push({ plate, kind: 'victory', obj, t0: now() });
    S.plates[plate].insts.forEach((i) => { i.cheerT = now(); });
  }

  function reveal(plate, fleet, o) {
    if (!S.ok && !init()) return;
    if (!fleet) return;
    const P = S.plates[plate];
    if (o && (o.colors || o.crew)) P.colors = normColors(o.colors, o.crew);
    const colors = plateColors(plate);
    fleet.ships.forEach((s) => {
      let inst = P.insts.find((i) => sameShip(i.ship, s));
      if (inst && inst.state !== 'afloat') return;
      if (!inst) {
        inst = makeInst(plate, s, colors, (o && o.crew) || P.crew, true);
        P.insts.push(inst);
        const segs = [];
        inst.cells.forEach((cl, i) => { if (P.hits.has(cl.r * 64 + cl.c)) segs.push(i); });
        if (segs.length) { inst.segs = segs; rebuildDamaged(inst); }
      }
      inst.visible = true;
      inst.outer.visible = true;
    });
  }

  // Rebuild from a GameView without animation.
  function sync(view) {
    if (!S.ok && !init()) return;
    if (!view || !view.players) return;
    const me = view.me != null ? view.me : 0, opp = view.opp != null ? view.opp : 1;
    const pmap = { own: view.players[me], enemy: view.players[opp] };
    PLATES.forEach((plate) => {
      const pv = pmap[plate];
      if (!pv) return;
      clear(plate);
      const P = S.plates[plate];
      const n = view.size || GLT.layout.size();
      if (pv.marks) for (let i = 0; i < pv.marks.length; i++) if (pv.marks[i] === 2 || pv.marks[i] === 3) P.hits.add(Math.floor(i / n) * 64 + (i % n));
      if (pv.crew) P.crew = pv.crew;
      const sunk = pv.sunk || [];
      const fleet = pv.fleet ? { format: pv.fleet.format, ships: pv.fleet.ships.filter((s) => !sunk.some((k) => k.id === s.id)) } : null;
      if (fleet) setFleet(plate, fleet, { visible: plate === 'own' || view.phase === 'over' });
      sunk.forEach((s) => sink(plate, s, { instant: true }));
    });
  }

  // ------------------------------------------------------------------ shared instanced layers
  function buildShared() {
    const solid = GLT.voxel.material('solid');
    GLT.shipModels.CREW_KINDS.forEach((k) => {
      const m = GLT.voxel.instanced(GLT.shipModels.crewGeometry(k), solid, CREW_CAP);
      m.name = 'fleet-crew-' + k;
      m.count = 0;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      S.root.add(m);
      S.crew[k] = m;
    });
    const foamMat = GLT.renderer && GLT.renderer.markMaterial
      ? GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: 0xdcf2ea }), 'none') : new THREE.MeshLambertMaterial({ color: 0xdcf2ea });
    S.foam = GLT.voxel.instanced(new THREE.BoxGeometry(0.5, 0.07, 0.5), foamMat, FOAM_CAP);
    S.foam.name = 'fleet-foam';
    S.foam.count = 0; S.foam.frustumCulled = false;
    S.root.add(S.foam);
    const bubMat = GLT.renderer && GLT.renderer.markMaterial
      ? GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: 0x9cd2cc }), 'full') : new THREE.MeshLambertMaterial({ color: 0x9cd2cc });
    S.bubbles = GLT.voxel.instanced(new THREE.BoxGeometry(0.25, 0.25, 0.25), bubMat, BUBBLE_CAP);
    S.bubbles.name = 'fleet-bubbles';
    S.bubbles.count = 0; S.bubbles.frustumCulled = false;
    S.root.add(S.bubbles);
    for (let i = 0; i < BUBBLE_CAP; i++) S.pool.push({ on: false, x: 0, y: 0, z: 0, vy: 0, age: 0, life: 1, s: 1 });
  }

  function emitBubble(x, z, big) {
    for (const b of S.pool) {
      if (b.on) continue;
      b.on = true; b.x = x; b.z = z; b.y = GLT.C.PLATE_Y - 0.35;
      b.vy = 0.5 + S.rng.next() * 0.6; b.age = 0; b.life = 0.7 + S.rng.next() * 0.7; b.s = (big ? 1.6 : 0.8) + S.rng.next() * 0.7;
      return;
    }
  }

  // ------------------------------------------------------------------ per-frame
  const M4 = () => new THREE.Matrix4();
  let _m = null, _d = null, _p = null, _q = null;

  function update(dt, t) {
    if (!S.ok || S.dbg.indexOf('u') >= 0) return;
    S.t = t;
    const night = GLT.lighting && GLT.lighting.nightFactor ? GLT.lighting.nightFactor() : 0;
    GLT.shipModels.tick(t, night);
    const amp = seaAmp();
    const reduced = GLT.prefs && GLT.prefs.reducedMotion ? GLT.prefs.reducedMotion() : false;
    const crewN = {};
    GLT.shipModels.CREW_KINDS.forEach((k) => { crewN[k] = 0; });
    let foamN = 0;
    for (let pi = 0; pi < 2; pi++) {
      const P = S.plates[PLATES[pi]];
      for (const inst of P.insts) {
        if (!inst.outer.visible) continue;
        const L = inst.ship.len * GLT.C.CELL;
        // swell
        let hs = 0;
        for (const cl of inst.cells) hs += swell(pi, cl.r, cl.c, t, amp);
        hs /= inst.cells.length;
        const c0 = inst.cells[0], c1 = inst.cells[inst.cells.length - 1];
        const slope = (swell(pi, c1.r, c1.c, t, amp) - swell(pi, c0.r, c0.c, t, amp)) / Math.max(4, L - 4);
        const m = reduced ? 0.4 : 1;
        let heave = clamp(hs, -0.25, 0.25) * m;
        let roll = clamp((0.022 * Math.sin(t * 0.95 + inst.phase) + 0.012 * Math.sin(t * 1.7 + inst.phase * 2)) * amp, -3 * DEG, 3 * DEG) * m;
        let pitch = clamp(Math.atan(slope) * 0.9, -2 * DEG, 2 * DEG) * m;
        const rk = t - inst.recoilT;
        if (rk >= 0 && rk < 0.6) roll += -0.02 * Math.sin(rk * 10) * Math.exp(-rk * 5);
        let dx = 0;
        if (inst.state === 'sinking') {
          const tau = t - inst.t0;
          if (inst.kind === 'dive') {
            pitch = -10 * DEG * easeInOut(tau / 0.9);
            roll *= 1 - clamp(tau, 0, 1);
            heave = heave - 4.6 * easeInOut((tau - 0.15) / 2.7);
            dx = 1.1 * easeInOut(tau / 2.9);
            if (tau > 0.35 && !inst.slick) spawnSlick(inst, false);
            if (tau > 1.5 && !inst.flagDone) spawnFlotsam(inst, false);
            if (dt > 0 && tau < 2.9 && S.rng.chance(Math.min(1, dt * 14))) bubbleAt(inst, true);
            if (tau >= DIVE_S) { finishSink(inst, false); continue; }
          } else {
            roll = inst.side * 17 * DEG * easeOut(tau / 1.0) + 0.3 * roll;
            pitch = 11 * DEG * easeOut(tau / 1.4);
            heave = heave - (inst.model.height + 1.2) * easeIn((tau - 0.3) / 3.0);
            if (tau > 0.85 && !inst.flagDone) spawnFlotsam(inst, false);
            if (dt > 0 && tau < 3.3 && S.rng.chance(Math.min(1, dt * 30))) bubbleAt(inst, false);
            if (dt > 0 && tau < 3.3 && S.rng.chance(Math.min(1, dt * 18))) bubbleAt(inst, false);
            if (tau >= SINK_S) { finishSink(inst, false); continue; }
          }
        }
        inst.bob.position.set(dx, heave, 0);
        inst.bob.rotation.set(roll, 0, pitch);
        const gun = inst.model.parts.cannons[0] ? inst.body.getObjectByName('ship-guns') : null;
        if (gun) gun.scale.z = rk >= 0 && rk < 0.5 ? 1 - 0.13 * Math.sin(Math.min(1, rk / 0.5) * Math.PI) * (rk < 0.08 ? rk / 0.08 : 1) : 1;
        inst.outer.updateMatrixWorld(true);
        if (inst.state !== 'afloat') continue;
        // deck crew
        const cheer = t - inst.cheerT < 2.2, panic = t - inst.panicT < 1.6;
        const crew = inst.model.anchors.crew;
        for (let i = 0; i < crew.length; i++) {
          const a = crew[i];
          const mesh = S.crew[a.kind] || S.crew.pirateA;
          const k = crewN[a.kind] || 0;
          if (k >= CREW_CAP) continue;
          let jy = 0, face = inst.faces[i] + 0.35 * Math.sin(t * 0.5 + i * 1.9);
          if (cheer) jy = Math.abs(Math.sin((t - inst.cheerT) * 9 + i * 1.3)) * 0.32;
          else if (panic) { jy = Math.abs(Math.sin((t - inst.panicT) * 14 + i)) * 0.12; face += Math.sin(t * 13 + i) * 0.8; }
          else jy = Math.max(0, Math.sin(t * 1.3 + i * 2.1 + inst.phase)) * 0.03;
          _d.position.set(a.x, a.y + jy, a.z);
          _d.rotation.set(0, face, 0);
          _d.scale.set(1, 1, 1);
          _d.updateMatrix();
          _m.multiplyMatrices(inst.body.matrixWorld, _d.matrix);
          mesh.setMatrixAt(k, _m);
          crewN[a.kind] = k + 1;
        }
        // waterline foam / wake chips (follow heave, not roll)
        const wk = inst.model.wake;
        for (let i = 0; i < wk.length && foamN < FOAM_CAP; i++) {
          const w = wk[i];
          const ph = t * 2.2 + i * 1.7 + inst.phase;
          let x = w.x, z = w.z, s = 0.55 + 0.3 * Math.sin(ph);
          if (w.k === 1) { x += 0.15 + 0.2 * Math.sin(ph * 0.7); s = 0.9 + 0.25 * Math.sin(ph); }
          else if (w.k === 2) { const f = ((t * 0.45 + i * 0.37) % 1); x -= f * 1.6; z *= 1 + f * 1.5; s = 0.9 * (1 - f); }
          else z += Math.sign(z) * (0.08 + 0.08 * Math.sin(ph));
          if (s <= 0.05) continue;
          _p.set(x, 0, z);
          _p.applyMatrix4(inst.outer.matrixWorld);
          _d.position.set(_p.x, GLT.C.PLATE_Y + heave + 0.06, _p.z);
          _d.rotation.set(0, inst.outer.rotation.y, 0);
          _d.scale.set(s, 1, s);
          _d.updateMatrix();
          S.foam.setMatrixAt(foamN++, _d.matrix);
        }
      }
    }
    GLT.shipModels.CREW_KINDS.forEach((k) => {
      const m = S.crew[k];
      m.count = crewN[k];
      m.visible = crewN[k] > 0;
      m.instanceMatrix.needsUpdate = true;
    });
    S.foam.count = foamN;
    S.foam.visible = foamN > 0;
    S.foam.instanceMatrix.needsUpdate = true;
    updateBubbles(dt);
    updateExtras(t, amp);
  }

  function bubbleAt(inst, big) {
    const wk = inst.model.wake;
    const w = wk[S.rng.int(wk.length)];
    _p.set(w.x * 0.8 + (S.rng.next() - 0.5), 0, w.z * (0.4 + S.rng.next() * 0.9));
    _p.applyMatrix4(inst.outer.matrixWorld);
    emitBubble(_p.x, _p.z, big);
  }

  function updateBubbles(dt) {
    let n = 0;
    for (const b of S.pool) {
      if (!b.on) continue;
      b.age += dt;
      if (b.age >= b.life) { b.on = false; continue; }
      b.y += b.vy * dt;
      const k = b.age / b.life;
      const s = b.s * (k < 0.75 ? 0.5 + k : Math.max(0.05, (1 - k) * 5));
      _d.position.set(b.x + Math.sin(b.age * 7 + b.s * 9) * 0.06, b.y, b.z);
      _d.rotation.set(0, 0, 0);
      _d.scale.set(s, s, s);
      _d.updateMatrix();
      S.bubbles.setMatrixAt(n++, _d.matrix);
    }
    S.bubbles.count = n;
    S.bubbles.visible = n > 0;
    S.bubbles.instanceMatrix.needsUpdate = true;
  }

  function updateExtras(t, amp) {
    for (const e of S.extras) {
      const age = t - e.t0;
      if (e.kind === 'flotsam') {
        const pi = e.plate === 'enemy' ? 1 : 0;
        const h = e.cell ? swell(pi, e.cell.r, e.cell.c, t, amp) : 0;
        const pop = e.t0 < 0 ? 1 : easeOut(age / 0.8);
        e.obj.position.set(e.x + 0.3 * Math.sin(t * 0.3 + e.ph), GLT.C.PLATE_Y + h - 0.6 * (1 - pop), e.z + 0.3 * Math.cos(t * 0.27 + e.ph));
        e.obj.rotation.set(0.07 * Math.sin(t * 1.2 + e.ph), e.yaw + 0.15 * Math.sin(t * 0.2 + e.ph), 0.06 * Math.sin(t * 0.9 + e.ph * 2));
      } else if (e.kind === 'slick') {
        const g = e.t0 < 0 ? 1 : 0.15 + 0.85 * easeOut(age / 2.6);
        e.obj.scale.set(g, 1, g);
      } else if (e.kind === 'victory') {
        const cloth = e.obj.gltCloth, top = e.obj.userData.top;
        const k = easeInOut((age - 0.4) / 2.4);
        cloth.position.y = 2.75 + (top - 2.75) * k;
      }
    }
  }

  // ------------------------------------------------------------------ events
  function playerPlate(p) {
    if (GLT.app && GLT.app.plateOf && GLT.app.driver && GLT.app.driver()) return GLT.app.plateOf(p);
    return p === (S.local == null ? 0 : S.local) ? 'own' : 'enemy';
  }

  function subscribe() {
    const E = GLT.events;
    if (!E) return;
    const on = (type, fn) => S.offs.push(E.on(type, fn));
    on('match:created', (e) => {
      S.local = e && e.local != null ? e.local : 0;
      S.colors = (e && e.colors) || [null, null];
      S.crews = (e && e.crews) || S.crews;
      PLATES.forEach((p) => { S.plates[p].colors = null; S.plates[p].crew = S.crews[p === 'own' ? S.local : 1 - S.local] || S.plates[p].crew; });
      clear();
      ghost(null);
    });
    on('game:setup', (e) => {
      clear();
      ghost(null);
      const v = e && e.view;
      const f = (v && v.me != null && v.players[v.me] && v.players[v.me].fleet) || (e && e.defaultFleet) || null;
      if (f) setFleet('own', f, { visible: true });
    });
    on('setup:changed', (e) => { if (e && e.fleet) setFleet('own', e.fleet, { visible: true }); });
    on('setup:ghost', (e) => ghost(e && e.ship, e && e.valid));
    on('game:started', (e) => { ghost(null); if (e && e.view) sync(e.view); });
    on('view:sync', (e) => { if (e && e.view) sync(e.view); });
    on('layout:changed', () => {
      PLATES.forEach((p) => S.plates[p].insts.forEach(place));
      if (S.ghost) S.ghost.visible = false;
    });
    on('shot:fired', (e) => { if (e && e.from && e.from.shipId) recoil(e.from.plate, e.from.shipId); });
    on('shot:resolved', (e) => {
      if (!e) return;
      if (e.result === 'acerto' || e.result === 'afundou') {
        damage(e.plate, e.r, e.c);
        const shooterPlate = e.plate === 'own' ? 'enemy' : 'own';
        S.plates[shooterPlate].insts.forEach((i) => { i.cheerT = now(); });
      }
    });
    on('ship:sunk', (e) => {
      if (!e || !e.ship) return;
      const owner = e.owner != null ? e.owner : (e.plate === 'own' ? S.local : 1 - S.local);
      const c = S.colors[owner];
      sink(e.plate, e.ship, c ? { colors: c, crew: S.crews[owner] } : null);
    });
    on('game:ended', (e) => {
      if (!e || !e.fleets) return;
      const me = S.local == null ? 0 : S.local;
      const opp = 1 - me;
      const f = e.fleets[opp];
      if (f) reveal(playerPlate(opp), f, S.colors[opp] ? { colors: S.colors[opp], crew: S.crews[opp] } : null);
    });
    on('ceremony:start', (e) => { if (e) raiseFlag(e.plate || playerPlate(e.winner), e.crew); });
  }

  // ------------------------------------------------------------------ lifecycle
  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root || !GLT.scene.root()) return false;
    if (!GLT.voxel || !GLT.shipModels || !GLT.layout) return false;
    _m = M4(); _d = new THREE.Object3D(); _p = new THREE.Vector3(); _q = new THREE.Quaternion();
    S.rng = GLT.rng.create(0x51e9);
    S.plates = { own: mkPlate(), enemy: mkPlate() };
    S.root = new THREE.Group();
    S.root.name = 'fleet3d';
    GLT.scene.add(S.root, 'ships');
    buildShared();
    S.ok = true;
    subscribe();
    if (GLT.clock && GLT.clock.onFrame) S.offs.push(GLT.clock.onFrame(update, 140));
    return true;
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    if (!S.ok) return;
    clear();
    if (S.ghost && S.ghost.parent) S.ghost.parent.remove(S.ghost);
    S.ghost = null; S.ghostKey = '';
    S.cache.forEach((tpl) => GLT.voxel.dispose(tpl.group));
    S.cache.clear();
    if (S.root) GLT.voxel.dispose(S.root);
    S.root = null; S.crew = {}; S.foam = null; S.bubbles = null; S.pool = [];
    S.ok = false;
  }

  function stats() {
    const out = { ships: 0, visible: 0, triangles: 0, drawCalls: 0, crew: 0 };
    if (!S.ok) return out;
    PLATES.forEach((p) => S.plates[p].insts.forEach((i) => {
      out.ships++;
      if (!i.outer.visible) return;
      out.visible++;
      out.triangles += i.model.triangles;
      out.drawCalls += i.body.children.length;
      out.crew += i.state === 'afloat' ? i.model.anchors.crew.length : 0;
    }));
    S.extras.forEach((e) => { out.drawCalls += e.kind === 'victory' ? 2 : 1; });
    out.drawCalls += Object.keys(S.crew).filter((k) => S.crew[k].visible).length + (S.foam && S.foam.visible ? 1 : 0) + (S.bubbles && S.bubbles.visible ? 1 : 0);
    return out;
  }

  GLT.fleet3d = {
    init, setFleet, clear, ghost, damage, sink, recoil, muzzle, raiseFlag, reveal, sync, dispose,
    // additions (ships area)
    stats,
    instances(plate) { return S.ok ? S.plates[plate].insts.map((i) => ({ id: i.ship.id, state: i.state, visible: i.outer.visible, segs: i.segs.slice() })) : []; },
    BRACE
  };

  // ------------------------------------------------------------------ demos
  GLT.demos = GLT.demos || {};

  function param(ctx, k) { return ctx && ctx.params && typeof ctx.params.get === 'function' ? ctx.params.get(k) : null; }

  function stage(ctx, n, o) {
    o = o || {};
    GLT.layout.setSize(n);
    S.dbg = param(ctx, 'dbg') || '';
    ['ocean', 'plates'].forEach((ns) => { if (S.dbg.indexOf(ns.charAt(0)) < 0 && GLT[ns] && GLT[ns].init) GLT[ns].init(); });
    if (o.backdrop && GLT.backdrop && GLT.backdrop.init) { GLT.backdrop.init(); if (GLT.backdrop.setLift) GLT.backdrop.setLift(true); }
    if (GLT.plates && GLT.plates.build) GLT.plates.build(n);
    const own = param(ctx, 'crew') && GLT.data.crews[param(ctx, 'crew')] ? param(ctx, 'crew') : 'strawHat';
    const opp = own === 'marine' ? 'strawHat' : 'marine';
    if (GLT.plates && GLT.plates.setColors) GLT.plates.setColors({ own: GLT.data.crews[own].colors.primary, enemy: GLT.data.crews[opp].colors.primary });
    init();
    clear();
    S.local = 0;
    S.crews = [own, opp];
    S.colors = [GLT.data.crews[own].colors, GLT.data.crews[opp].colors];
    S.plates.own.colors = null; S.plates.enemy.colors = null;
    S.plates.own.crew = own; S.plates.enemy.crew = opp;
    return { own, opp };
  }

  function look(target, o) {
    if (!GLT.camera || !GLT.camera.set) return;
    GLT.camera.set(Object.assign({ azimuth: 30, elevation: 34, zoom: 1, target }, o || {}), { instant: true });
  }

  function lineup(ctx, vertical) {
    const st = stage(ctx, 12);
    const S1 = (id, r, c, dir) => ({ id, r, c, dir, len: GLT.data.ships[id].len });
    const ships = vertical
      ? [S1('mobyDick', 2, 0, 'v'), S1('thousandSunny', 3, 2, 'v'), S1('oroJackson', 3, 4, 'v'), S1('redForce', 4, 6, 'v'),
        S1('polarTang', 4, 8, 'v'), S1('baratie', 1, 10, 'v'), S1('goingMerry', 7, 10, 'v')]
      : [S1('mobyDick', 0, 0, 'h'), S1('thousandSunny', 0, 6, 'h'), S1('oroJackson', 3, 0, 'h'), S1('redForce', 3, 6, 'h'),
        S1('polarTang', 6, 0, 'h'), S1('baratie', 6, 6, 'h'), S1('goingMerry', 9, 5, 'h')];
    setFleet('own', { format: 'grandline', ships }, { visible: true, crew: st.own });
    if (GLT.plates && GLT.plates.setFoam) GLT.plates.setFoam('own', ships);
    const c = GLT.layout.plateCenter('own');
    look({ x: c.x + (vertical ? 0 : -2), y: c.y + 2, z: c.z + (vertical ? 1 : -2) }, { zoom: 1.55, elevation: 34 });
  }
  GLT.demos['ships.all'] = function (ctx) { lineup(ctx, false); };
  GLT.demos['fleet'] = GLT.demos['ships.all'];
  GLT.demos['ships.allv'] = function (ctx) { lineup(ctx, true); };

  function closeUp(id) {
    return function (ctx) {
      const st = stage(ctx, 10);
      const len = GLT.data.ships[id].len;
      const dir = param(ctx, 'dir') === 'v' ? 'v' : 'h';
      const ship = dir === 'v' ? { id, r: Math.floor((10 - len) / 2), c: 4, dir, len } : { id, r: 4, c: Math.floor((10 - len) / 2), dir, len };
      setFleet('own', { format: 'grandline', ships: [ship] }, { visible: true, crew: st.own });
      if (GLT.plates && GLT.plates.setFoam) GLT.plates.setFoam('own', [ship]);
      const segs = (param(ctx, 'hits') || '').split(',').filter((x) => x !== '').map(Number);
      segs.forEach((s) => { const cl = shipCells(ship)[s]; if (cl) damage('own', cl.r, cl.c); });
      const tr = GLT.layout.shipTransform('own', ship);
      look({ x: tr.x, y: tr.y + 3, z: tr.z }, { zoom: Math.min(4, 5.2 - len * 0.45), elevation: 26 });
    };
  }
  ['mobyDick', 'thousandSunny', 'oroJackson', 'redForce', 'polarTang', 'baratie', 'goingMerry'].forEach((id) => {
    GLT.demos['ships.' + id] = closeUp(id);
    GLT.demos['ship-' + id] = GLT.demos['ships.' + id];
  });

  // Same ship in every crew's colours: identity never changes, only trim + pennant.
  GLT.demos['ships.owners'] = function (ctx) {
    stage(ctx, 12);
    const id = param(ctx, 'ship') && GLT.data.ships[param(ctx, 'ship')] ? param(ctx, 'ship') : 'thousandSunny';
    const len = GLT.data.ships[id].len;
    GLT.data.crewOrder.forEach((crew, i) => {
      const ship = { id, r: i * 2, c: 1 + (i % 2) * 6, dir: 'h', len };
      const inst = makeInst('own', ship, normColors(null, crew), crew, true);
      S.plates.own.insts.push(inst);
    });
    const c = GLT.layout.plateCenter('own');
    look({ x: c.x, y: c.y + 2, z: c.z - 2 }, { zoom: 1.5 });
  };

  GLT.demos['ships.damage'] = function (ctx) {
    const st = stage(ctx, 10);
    const fleet = ctx.sampleFleet('classica');
    setFleet('own', fleet, { visible: true, crew: st.own });
    if (GLT.plates && GLT.plates.setFoam) GLT.plates.setFoam('own', fleet.ships);
    [[1, 2], [1, 4], [4, 8], [5, 2], [8, 5], [6, 6]].forEach((h) => damage('own', h[0], h[1]));
    if (GLT.plates && GLT.plates.setMark) [[1, 2], [1, 4], [4, 8], [5, 2], [8, 5], [6, 6]].forEach((h) => GLT.plates.setMark('own', h[0], h[1], 2));
    const c = GLT.layout.plateCenter('own');
    look({ x: c.x, y: c.y + 2, z: c.z }, { zoom: 1.9 });
  };

  // Sinking: Moby Dick and Going Merry go under, the Polar Tang dives (sample with ?t= 0.3 .. 5).
  GLT.demos['ships.sink'] = function (ctx) {
    const st = stage(ctx, 10);
    const S1 = (id, r, c, dir) => ({ id, r, c, dir, len: GLT.data.ships[id].len });
    const ships = [S1('mobyDick', 2, 1, 'h'), S1('polarTang', 5, 5, 'h'), S1('goingMerry', 7, 1, 'h'), S1('thousandSunny', 8, 5, 'h')];
    setFleet('own', { format: 'classica', ships }, { visible: true, crew: st.own });
    [[2, 3], [2, 5], [7, 1]].forEach((h) => damage('own', h[0], h[1]));
    GLT.clock.after(0.1, () => sink('own', ships[0]));
    GLT.clock.after(0.25, () => sink('own', ships[1]));
    GLT.clock.after(0.4, () => sink('own', ships[2]));
    const c = GLT.layout.plateCenter('own');
    look({ x: c.x, y: c.y + 2, z: c.z }, { zoom: 1.9 });
  };
  GLT.demos['sinking'] = GLT.demos['ships.sink'];

  GLT.demos['ships.ghost'] = function (ctx) {
    const st = stage(ctx, 10);
    const fleet = ctx.sampleFleet('classica');
    const ships = fleet.ships.filter((s) => s.id !== 'thousandSunny');
    setFleet('own', { format: 'classica', ships }, { visible: true, crew: st.own });
    const bad = param(ctx, 'valid') === '0';
    ghost(bad ? { id: 'thousandSunny', r: 3, c: 3, dir: 'v', len: 4 } : { id: 'thousandSunny', r: 3, c: 8, dir: 'v', len: 4 }, !bad);
    if (GLT.plates && GLT.plates.setGhostCells) GLT.plates.setGhostCells(shipCells(bad ? { r: 3, c: 3, dir: 'v', len: 4 } : { r: 3, c: 8, dir: 'v', len: 4 }), !bad);
    const c = GLT.layout.plateCenter('own');
    look({ x: c.x, y: c.y + 2, z: c.z }, { zoom: 1.9 });
  };

  // Ceremony flag raise (?t= 0..3.5).
  GLT.demos['ships.flag'] = function (ctx) {
    const st = stage(ctx, 10);
    setFleet('own', ctx.sampleFleet('classica'), { visible: true, crew: st.own });
    GLT.clock.after(0.05, () => raiseFlag('own', st.own));
    if (GLT.camera && GLT.camera.setMode) GLT.camera.setMode('ceremony', { instant: true, plate: 'own' });
  };

  // Integration: drives fleet3d purely through bus events (setup, hits, an enemy sinking, game end + reveal).
  GLT.demos['ships.events'] = function (ctx) {
    stage(ctx, 10, { backdrop: false });
    const E = GLT.events;
    const crews = ['strawHat', 'redHair'];
    E.emit('match:created', { mode: 'pvc', local: 0, crews, colors: crews.map((c) => GLT.data.crews[c].colors), rules: {}, difficulty: 'marujo', seriesLen: 1 });
    const own = ctx.sampleFleet('classica');
    const enemy = ctx.sampleFleet('classica');
    E.emit('setup:changed', { fleet: own, valid: true, errors: [] });
    E.emit('shot:resolved', { id: 'x1', by: 1, mine: false, plate: 'own', r: 1, c: 2, label: 'B3', result: 'acerto' });
    const merry = enemy.ships.find((s) => s.id === 'goingMerry');
    GLT.clock.after(0.1, () => {
      E.emit('shot:resolved', { id: 'x2', by: 0, mine: true, plate: 'enemy', r: merry.r, c: merry.c, label: 'G6', result: 'acerto' });
      E.emit('shot:resolved', { id: 'x3', by: 0, mine: true, plate: 'enemy', r: merry.r, c: merry.c + 1, label: 'G7', result: 'afundou', ship: merry });
      E.emit('ship:sunk', { by: 0, mine: true, plate: 'enemy', ship: merry, shipId: 'goingMerry', owner: 1 });
    });
    GLT.clock.after(0.2, () => E.emit('shot:fired', { id: 'x4', by: 0, mine: true, plate: 'enemy', r: 0, c: 0, from: { plate: 'own', shipId: 'mobyDick' }, flightS: 0.9 }));
    if (param(ctx, 'end') === '1') {
      GLT.clock.after(0.3, () => E.emit('game:ended', { gameIndex: 0, winner: 0, mine: true, reason: 'fleet', stats: [null, null], fleets: [own, enemy], series: null }));
    }
  };
})();
