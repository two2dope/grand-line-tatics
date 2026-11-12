/* GLT.crowd: dock grandstands behind each plate with an instanced crowd of pirates and marines in both crews' colours.
 * Area: world. Contract: ARCHITECTURE.md §9 (docks at GLT.layout.dockPos, facing +Z), §11.1.
 *  - Stands: ONE merged voxel mesh for both docks (pier on piles, walkway with rail, three tiers, a back wall with
 *    crew-coloured banners and bunting, flag towers at the ends). Rebuilt on build() / layout:changed.
 *  - Fans: five InstancedMeshes shared by both docks (bodies, heads, hats, arms, flags), coloured per instance:
 *    pirates wear their crew's primary/secondary/trim (+ straw hats for Chapéus de Palha, bandanas otherwise),
 *    marines wear white and blue caps. Marine guards stand on each walkway.
 *  - react(kind, side, intensity): 'cheer' (arms up, hops), 'jump' (big jumps), 'wave' (flags + arms sway),
 *    'groan' (hands on heads, slump). Per-fan phase and a participation chance keep it lively; reduced motion halves
 *    the amplitudes. Hooked to shot:resolved, ship:sunk, coin:toss, game:ended, ceremony:start. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const S = {
    ok: false, root: null, stands: null, meshes: null, fans: [], crews: ['strawHat', 'marine'], colors: null, n: 0,
    side: [{ kind: 'idle', t0: -99, dur: 0, amp: 0 }, { kind: 'idle', t0: -99, dur: 0, amp: 0 }], offs: [], lift: 0, liftFirst: true
  };
  function K() { return GLT._world_kit; }
  const VS = 0.25;

  function plateOfPlayer(p) {
    if (GLT.app && GLT.app.plateOf) { try { return GLT.app.plateOf(p); } catch (e) { /* ignore */ } }
    return p === 0 ? 'own' : 'enemy';
  }

  // ------------------------------------------------------------------ figure parts (0.25 m voxels, facing +Z)
  function partGeo(fill) {
    const vb = K().vb(VS);
    fill(vb);
    return K().voxGeometry(vb, { ao: 0.25 });
  }
  function bodyGeo() {
    return partGeo((vb) => {
      vb.box(-1, 0, -1, -1, 2, 0, '#3a3a44'); vb.box(1, 0, -1, 1, 2, 0, '#3a3a44');
      vb.box(0, 1, -1, 0, 2, 0, '#3a3a44');
      vb.box(-1, 3, -1, 1, 3, 0, '#c8c8c8');
      vb.box(-1, 4, -1, 1, 5, 0, '#ffffff');
    });
  }
  function headGeo() {
    return partGeo((vb) => {
      vb.box(-1, 6, -1, 1, 7, 0, '#f2c8a0');
      vb.set(-1, 7, 0, '#f2c8a0'); vb.set(1, 7, 0, '#f2c8a0');
      vb.set(0, 6, 0, '#c88a64');
      vb.box(-1, 8, -1, 1, 8, -1, '#48281a');
    });
  }
  function hatGeo() {
    return partGeo((vb) => {
      vb.box(-2, 8, -2, 2, 8, 1, '#ffffff');
      vb.box(-1, 9, -1, 1, 9, 0, '#ffffff');
    });
  }
  function armsGeo() {
    // pivot at the shoulder line (origin); arms hang along -Y
    return partGeo((vb) => {
      vb.box(-2, -3, -1, -2, -1, -1, '#ffffff'); vb.box(2, -3, -1, 2, -1, -1, '#ffffff');
      vb.set(-2, -4, -1, '#f2c8a0'); vb.set(2, -4, -1, '#f2c8a0');
    });
  }
  function flagGeo() {
    return partGeo((vb) => {
      for (let y = 0; y < 8; y++) vb.set(0, y, 0, '#8e562e');
      vb.box(1, 5, 0, 4, 7, 0, '#ffffff');
      vb.set(2, 6, 0, '#e6d6b0');
    });
  }

  // ------------------------------------------------------------------ stands
  function buildStands(n) {
    const a = K().acc();
    const C = GLT.C;
    ['own', 'enemy'].forEach((plate, pi) => {
      const d = GLT.layout.dockPos(plate, n);
      const vb = K().vb(0.5);
      const W = Math.round(n * C.CELL / 0.5 / 2);            // half width in voxels
      const crew = S.crews[pi === 0 ? 0 : 1];
      const cols = S.colorsBy[plate];
      const k2 = K();
      // walkway (z voxels -2..1), deck top y=4.0 -> j=7
      for (let x = -W; x < W; x++) for (let z = -2; z <= 1; z++) vb.set(x, 7, z, (x & 3) === 0 ? 'wood-dark' : ((x + z) & 1 ? 'wood' : 'wood-light'));
      // rail
      for (let x = -W; x < W; x++) { vb.set(x, 9, 2, 'wood-dark'); if ((x & 7) === 0) vb.set(x, 8, 2, 'wood-dark'); }
      // tiers
      for (let t = 0; t < 3; t++) {
        const top = Math.round((5 + 1.5 * t) / 0.5) - 1;
        const z1 = -3 - t * 4, z0 = z1 - 3;
        for (let x = -W; x < W; x++) for (let z = z0; z <= z1; z++) {
          vb.set(x, top, z, z === z1 ? 'wood-light' : ((x >> 2) & 1 ? 'wood' : cols.seat));
          if (z === z1) for (let y = 7; y < top; y++) vb.set(x, y, z, (y & 1) ? 'wood-dark' : 'wood');
        }
      }
      // back wall with banners
      const zb = -15;
      for (let x = -W - 1; x <= W; x++) for (let y = 7; y <= 24; y++) {
        let c = (y + x) % 9 === 0 ? 'wood-dark' : 'wood';
        if (y >= 13 && y <= 21 && ((x + W) % 12) >= 2 && ((x + W) % 12) <= 9) c = ((y - 13) % 4 < 2) ? cols.primary : cols.secondary;
        if (y === 24) c = 'wood-dark';
        vb.set(x, y, zb, c);
      }
      // bunting along the wall top
      for (let x = -W; x < W; x++) { const yy = 25 - (Math.abs(((x % 6) + 6) % 6 - 3) >> 1); if (((x % 6) + 6) % 6 !== 0) vb.set(x, yy, zb + 1, ((x / 6) | 0) & 1 ? cols.primary : 'white'); }
      // piles into the sea
      for (let x = -W; x <= W; x += 8) for (let z = -14; z <= 0; z += 7) for (let y = -2; y < 7; y++) vb.set(x, y, z, 'wood-dark');
      // flag towers at both ends with pennants
      [-W - 2, W + 1].forEach((x) => {
        for (let y = 7; y <= 34; y++) vb.set(x, y, -6, y > 30 ? 'iron' : 'wood-dark');
        for (let q = 0; q < 6; q++) for (let y = 0; y < 4 - (q >> 1); y++) vb.set(x + (x < 0 ? -1 - q : 1 + q), 32 - y, -6, cols.primary);
        vb.box(x, 35, -6, x, 35, -6, 'lantern');          // solid class: the crowd stays within its 6 draw calls
      });
      void crew; void k2;
      K().addVox(a, vb, K().mtx(d.x, 0, d.z), { ao: 0.45 });
    });
    return K().flush(a, { name: 'crowd-stands', cast: true });
  }

  // ------------------------------------------------------------------ fans
  function sideColors(crew, primary) {
    const c = (GLT.data && GLT.data.crews && GLT.data.crews[crew]) ? GLT.data.crews[crew].colors : { primary: primary, secondary: '#fffdf7', trim: '#0b0a12' };
    return { primary: primary || c.primary, secondary: c.secondary, trim: c.trim, seat: crew === 'marine' ? 'marine-blue' : 'red-dark' };
  }

  function makeFans(n) {
    const C = GLT.C;
    const fans = [];
    const r = K().rng(4242 + n, 'crowd');
    ['own', 'enemy'].forEach((plate, pi) => {
      const player = pi;                       // fans of crews[p] stand behind plateOf(p); resolved in build()
      const d = GLT.layout.dockPos(plate, n);
      const crew = S.plateCrew[plate];
      const cols = S.colorsBy[plate];
      const W = n * C.CELL / 2 - 0.6;
      const rows = [{ y: 4.0, z: -0.2, guards: true }];
      for (let t = 0; t < 3; t++) rows.push({ y: 5 + 1.5 * t, z: -(2.3 + t * 2) });
      rows.forEach((row) => {
        const step = row.guards ? 5.5 : 1.05;
        for (let x = -W; x <= W; x += step) {
          if (!row.guards && r.chance(0.08)) continue;
          const marine = row.guards || crew === 'marine';
          let shirt, hat, hatOn;
          if (marine) {
            shirt = r.chance(row.guards ? 0.2 : 0.3) ? '#1a3f8c' : '#fffdf7';
            hat = '#fffdf7'; hatOn = true;
          } else {
            const v = r.next();
            shirt = v < 0.4 ? cols.primary : v < 0.65 ? cols.secondary : v < 0.8 ? cols.trim : (r.chance(0.5) ? '#2d63c8' : '#fffdf7');
            hatOn = r.chance(crew === 'strawHat' ? 0.75 : 0.55);
            hat = crew === 'strawHat' ? (r.chance(0.8) ? '#ffd86a' : cols.primary) : (r.chance(0.5) ? cols.primary : '#0b0a12');
          }
          const skin = [0xffffff, 0xf0dcd0, 0xd8b8a0, 0xb08a70][r.int(4)];
          fans.push({
            plate, player, x: d.x + x + (row.guards ? 0 : (r.next() - 0.5) * 0.3), y: row.y, z: d.z + row.z, yaw: (r.next() - 0.5) * 0.35,
            shirt: K().hex(shirt), hat: K().hex(hat), hatOn, skin, ph: r.next() * 6.28, rate: 0.8 + r.next() * 0.5,
            join: r.next(), flag: !row.guards && r.chance(0.22), guard: !!row.guards, clap: r.chance(0.3)
          });
        }
      });
    });
    return fans;
  }

  function buildMeshes(count) {
    const mat = GLT.voxel.material('solid');
    const mk = (geo, name, cast) => K().inst(geo, mat, count, { colors: true, name, cast: !!cast, receive: true });
    const m = {
      body: mk(bodyGeo(), 'crowd-body', true), head: mk(headGeo(), 'crowd-head'), hat: mk(hatGeo(), 'crowd-hat'),
      arms: mk(armsGeo(), 'crowd-arms'), flag: mk(flagGeo(), 'crowd-flag')
    };
    const g = new THREE.Group();
    g.name = 'crowd-fans';
    Object.keys(m).forEach((k) => g.add(m[k]));
    m.group = g;
    return m;
  }

  // RotY(yaw) * RotX(a) * scale -> instance slot
  function setPose(arr, i, x, y, z, yaw, a, s) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ca = Math.cos(a), sa = Math.sin(a), o = i * 16;
    arr[o] = cy * s; arr[o + 1] = 0; arr[o + 2] = -sy * s; arr[o + 3] = 0;
    arr[o + 4] = sy * sa * s; arr[o + 5] = ca * s; arr[o + 6] = cy * sa * s; arr[o + 7] = 0;
    arr[o + 8] = sy * ca * s; arr[o + 9] = -sa * s; arr[o + 10] = cy * ca * s; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  // Dock lift: the grandstands stand north of the plates, so when the camera looks from the north half they would sit
  // in front of the plates. They then rise and hide exactly like the doll's-house sectors (same height, easing, rules).
  function stepLift(step, instant) {
    if (!S.root) return;
    const C = GLT.C;
    const allowed = GLT.backdrop && GLT.backdrop.allowed ? GLT.backdrop.allowed() : false;
    const az = GLT.camera && GLT.camera.get ? GLT.camera.get().azimuth : 30;
    const want = allowed && GLT.layout.angDist(az, 180) <= 100 ? 1 : 0;
    let v = S.lift;
    if (instant) v = want;
    else if (v < want) v = Math.min(1, v + step / C.T.liftS);
    else if (v > want) v = Math.max(0, v - step / C.T.liftS);
    S.lift = v;
    S.root.position.y = C.LIFT_H * K().easeInOutCubic(v);
    const hide = v >= 1 && want === 1;
    if (hide === S.root.visible) {
      S.root.visible = !hide;
      S.root.traverse((m) => { if (m.isMesh) { if (m.userData.gltCast == null) m.userData.gltCast = !!m.castShadow; m.castShadow = hide ? false : m.userData.gltCast; } });
    }
  }

  function update(dt, t, realDt) {
    if (S.root) {
      const Ck = GLT.clock;
      let step = realDt || 0;
      if (Ck.frozen() && !Ck.simulating()) step = 0;
      stepLift(step, S.liftFirst || K().reduced());
      S.liftFirst = false;
    }
    if (!S.ok || !S.meshes) return;
    const M = S.meshes, k2 = K();
    const gentle = k2.reduced() ? 0.45 : 1;
    const ab = M.body.instanceMatrix.array, ah = M.head.instanceMatrix.array, at = M.hat.instanceMatrix.array;
    const aa = M.arms.instanceMatrix.array, af = M.flag.instanceMatrix.array;
    let nh = 0, nf = 0;
    for (let i = 0; i < S.fans.length; i++) {
      const f = S.fans[i];
      const st = S.side[f.plate === 'own' ? 0 : 1];
      const age = t - st.t0;
      let kind = age >= 0 && age < st.dur ? st.kind : 'idle';
      if (kind !== 'idle' && f.join > 0.35 + 0.6 * (1 - st.amp)) kind = 'idle';
      if (f.guard && kind !== 'idle') kind = kind === 'groan' ? 'idle' : 'wave';
      const fade = kind === 'idle' ? 0 : Math.min(1, age * 4, (st.dur - age) * 2);
      const w = t * f.rate;
      let hop = 0, arm = -0.08 + Math.sin(w * 0.7 + f.ph) * 0.05, sway = Math.sin(w * 0.9 + f.ph) * 0.04, slump = 0, flagW = Math.sin(t * 2 + f.ph) * 0.3;
      if (kind === 'cheer') { hop = Math.abs(Math.sin(w * 7 + f.ph)) * 0.28; arm = -2.85 + Math.sin(w * 9 + f.ph) * 0.25; flagW = Math.sin(t * 9 + f.ph) * 0.8; }
      else if (kind === 'jump') { hop = Math.abs(Math.sin(w * 6 + f.ph)) * 0.75; arm = -3.0 + Math.sin(w * 6 + f.ph) * 0.3; flagW = Math.sin(t * 11 + f.ph) * 0.9; }
      else if (kind === 'wave') { arm = -2.2 + Math.sin(w * 4 + f.ph) * 0.5; sway = Math.sin(w * 3 + f.ph) * 0.18; flagW = Math.sin(t * 7 + f.ph) * 1.0; }
      else if (kind === 'groan') { arm = -2.45; slump = -0.12; sway = Math.sin(w * 1.5 + f.ph) * 0.06; }
      else if (f.clap) arm = -0.9 + Math.abs(Math.sin(w * 5 + f.ph)) * 0.25 * (Math.sin(t * 0.3 + f.ph) > 0.6 ? 1 : 0);
      hop *= fade * gentle; slump *= fade;
      if (kind === 'idle') arm = -0.08 + Math.sin(w * 0.7 + f.ph) * 0.05 + (f.clap ? (Math.sin(t * 0.3 + f.ph) > 0.6 ? -0.8 + Math.abs(Math.sin(w * 5 + f.ph)) * 0.25 : 0) : 0);
      else arm = arm * (0.35 + 0.65 * fade) - 0.08 * (1 - fade);
      const y = f.y + hop + slump;
      const yaw = f.yaw + sway;
      k2.setInst(ab, i, f.x, y, f.z, yaw, 1, 1, 1);
      k2.setInst(ah, i, f.x, y + slump * 0.5, f.z, yaw, 1, 1, 1);
      setPose(aa, i, f.x, y + 1.5, f.z, yaw, arm, 1);
      if (f.hatOn) { k2.setInst(at, nh, f.x, y + slump * 0.5, f.z, yaw, 1, 1, 1); k2.setCol(M.hat.instanceColor.array, nh, f.hat); nh++; }
      if (f.flag) {
        const lift = kind === 'idle' ? 0.6 : 1.4 * (0.4 + 0.6 * fade);
        k2.setInst(af, nf, f.x + 0.45, y + lift, f.z + 0.1, yaw + flagW, 1, 1, 1);
        k2.setCol(M.flag.instanceColor.array, nf, S.colorsHex[f.plate]);
        nf++;
      }
    }
    M.hat.count = nh; M.flag.count = nf;
    ['body', 'head', 'hat', 'arms', 'flag'].forEach((k) => { M[k].instanceMatrix.needsUpdate = true; });
    M.hat.instanceColor.needsUpdate = true; M.flag.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ public
  function build(crews, colors) {
    if (!S.ok) return;
    if (crews) S.crews = crews.slice();
    S.colors = colors ? colors.slice() : null;
    const n = GLT.layout.size();
    S.n = n;
    // fans of crews[p] stand behind plateOf(p)
    S.plateCrew = {}; S.colorsBy = {}; S.colorsHex = {};
    [0, 1].forEach((p) => {
      const plate = plateOfPlayer(p);
      const crew = S.crews[p];
      S.plateCrew[plate] = crew;
      S.colorsBy[plate] = sideColors(crew, S.colors ? S.colors[p] : null);
      S.colorsHex[plate] = K().hex(S.colorsBy[plate].primary);
    });
    if (!S.plateCrew.own) { S.plateCrew.own = S.crews[0]; S.colorsBy.own = sideColors(S.crews[0]); S.colorsHex.own = K().hex(S.colorsBy.own.primary); }
    if (!S.plateCrew.enemy) { S.plateCrew.enemy = S.crews[1]; S.colorsBy.enemy = sideColors(S.crews[1]); S.colorsHex.enemy = K().hex(S.colorsBy.enemy.primary); }
    if (S.stands) K().disposeObj(S.stands);
    if (S.meshes) K().disposeObj(S.meshes.group);
    S.stands = buildStands(n);
    S.root.add(S.stands);
    S.fans = makeFans(n);
    S.meshes = buildMeshes(S.fans.length);
    const M = S.meshes;
    ['body', 'head', 'arms'].forEach((k) => { M[k].count = S.fans.length; });
    S.fans.forEach((f, i) => {
      K().setCol(M.body.instanceColor.array, i, f.shirt);
      K().setCol(M.arms.instanceColor.array, i, f.shirt);
      K().setCol(M.head.instanceColor.array, i, f.skin);
    });
    ['body', 'arms', 'head'].forEach((k) => { M[k].instanceColor.needsUpdate = true; });
    S.root.add(M.group);
    update(0, K().t());
  }

  function react(kind, side, intensity) {
    if (!S.ok) return;
    const amp = intensity == null ? 1 : Math.max(0, Math.min(1, intensity));
    const dur = kind === 'jump' ? 3.2 : kind === 'groan' ? 2.4 : 2.2;
    const t0 = K().t();
    const apply = (plate) => { S.side[plate === 'own' ? 0 : 1] = { kind, t0, dur, amp }; };
    if (side === 'both') { apply('own'); apply('enemy'); }
    else if (side === 'own' || side === 'enemy') apply(side);
    else apply(plateOfPlayer(side));
  }

  function subscribe() {
    const E = GLT.events;
    const on = (type, fn) => S.offs.push(E.on(type, fn));
    on('match:created', (e) => { if (e && e.crews) build(e.crews, e.colors); });
    on('layout:changed', () => { if (S.fans.length || S.stands) build(S.crews, S.colors); });
    on('coin:toss', () => react('wave', 'both', 0.8));
    on('shot:resolved', (e) => {
      if (!e) return;
      const shooter = e.by, target = 1 - e.by;
      if (e.result === 'acerto') { react('cheer', shooter, 0.9); react('groan', target, 0.7); }
      else if (e.result === 'agua') { react('wave', target, 0.45); }
      else if (e.result === 'absorvido') { react('cheer', target, 0.8); }
    });
    on('ship:sunk', (e) => { if (!e) return; react('jump', e.by, 1); react('groan', e.owner != null ? e.owner : 1 - e.by, 1); });
    on('game:ended', (e) => { if (!e || e.winner == null) return; react('jump', e.winner, 1); react('groan', 1 - e.winner, 1); });
    on('ceremony:start', (e) => { if (e && e.winner != null) react('jump', e.winner, 1); });
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root() || !GLT._world_kit || !GLT.voxel) return false;
    S.root = new THREE.Group();
    S.root.name = 'world-crowd';
    GLT.scene.add(S.root, 'crowd');
    S.ok = true;
    subscribe();
    S.offs.push(GLT.clock.onFrame(update, 160));
    return true;
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    if (S.root) K().disposeObj(S.root);
    S.root = null; S.stands = null; S.meshes = null; S.fans = []; S.ok = false;
  }

  GLT.crowd = {
    init, build, react, dispose,
    // additions (world area)
    count() { return S.fans.length; },
    snapLift() { stepLift(0, true); },
    liftState() { return S.lift; },
    state() { return S.side.map((s) => Object.assign({}, s)); }
  };

  GLT.demos = GLT.demos || {};
  GLT.demos['world.crowd'] = function (ctx) {
    GLT.layout.setSize(10);
    ['ocean', 'plates', 'crowd'].forEach((ns) => GLT[ns].init());
    build(['strawHat', 'marine'], [GLT.data.crews.strawHat.colors.primary, GLT.data.crews.marine.colors.primary]);
    GLT.clock.after(0, () => { react('jump', 'own', 1); react('groan', 'enemy', 1); });
    GLT.camera.set({ azimuth: 18, elevation: 26, zoom: 2.3, target: { x: -6, y: 7, z: -30 } }, { instant: true });
  };
})();
