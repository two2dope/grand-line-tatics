/* GLT._fx_ceremony (private, fx area): the ceremony set piece on the winner's plate. A voxel flag mast rises out of the
 * far rim, the winner's Jolly Roger is hoisted to the top with an overshoot, unfurls and flutters (vertex wave on a
 * pixel-art canvas texture from GLT.flags.jollyRoger), and confetti cannons fire from the rim corners as it locks in.
 * Driven by GLT.fireworks (ceremony:start / ceremony:end). Game time only; no allocation in the frame loop. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const POLE_H = 16;            // metres above the rim top
  const FLAG_W = 7.2, FLAG_H = 5.4, SEG_X = 18, SEG_Y = 8;
  const S = {
    ok: false, off: null, root: null, pole: null, flag: null, flagGeo: null, base: null, mat: null, tex: null,
    state: 0 /* 0 hidden, 1 raising, 2 up, 3 lowering */, mast: true, age: 0, crew: null, plate: null, popped: false, colors: null
  };

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root || !GLT.scene.root()) return false;
    S.root = new THREE.Group();
    S.root.name = 'fx-ceremony';
    S.root.visible = false;
    // mast: dark wood with brass rings, a gold finial; 0.25 m voxels
    const b = GLT.voxel.builder({ size: 0.25 });
    const H = Math.round(POLE_H / 0.25);
    for (let y = 0; y < H; y++) {
      const ring = y % 16 === 0 && y > 0;
      const col = ring ? 'brass' : (y % 2 ? 'wood-dark' : 0x5a3424);
      b.box(-1, y, -1, 0, y, 0, col);
      if (ring) { b.set(-2, y, -1, 'brass'); b.set(1, y, 0, 'brass'); b.set(-1, y, -2, 'brass'); b.set(0, y, 1, 'brass'); }
    }
    b.box(-2, H, -2, 1, H + 1, 1, 'gold');
    b.box(-1, H + 2, -1, 0, H + 3, 0, 'yellow');
    // stepped plinth
    b.box(-4, -2, -4, 3, -1, 3, 'slate'); b.box(-3, 0, -3, 2, 0, 2, 'rock');
    // yard arm the flag hangs from
    b.box(0, H - 3, 0, 3, H - 3, 0, 'wood-dark');
    S.pole = b.build({ castShadow: true, receiveShadow: true });
    S.root.add(S.pole);
    // flag cloth
    S.flagGeo = new THREE.PlaneBufferGeometry(FLAG_W, FLAG_H, SEG_X, SEG_Y);
    S.flagGeo.translate(FLAG_W / 2, -FLAG_H / 2, 0);       // hoist edge on the mast, top edge at the hoist point
    S.base = Float32Array.from(S.flagGeo.attributes.position.array);
    S.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    if (GLT.renderer && GLT.renderer.markMaterial) GLT.renderer.markMaterial(S.mat, 'full');
    S.flag = new THREE.Mesh(S.flagGeo, S.mat);
    S.flag.castShadow = true;
    S.flag.position.set(0.25, 0, 0);
    S.root.add(S.flag);
    GLT.scene.add(S.root, 'fx');
    S.off = GLT.clock.onFrame(update, 460);
    S.ok = true;
    return true;
  }

  function flagCanvas(crew) {
    const id = GLT.data.crews[crew] ? GLT.data.crews[crew].flag : crew;
    if (GLT.flags && GLT.flags.jollyRoger) {
      try { const cv = GLT.flags.jollyRoger(id, 52); if (cv && cv.width) return cv; } catch (err) { /* fall through */ }
    }
    // fallback: a plain skull and crossbones
    const cv = document.createElement('canvas');
    cv.width = 26; cv.height = 20;
    const g = cv.getContext('2d');
    g.fillStyle = '#1a1628'; g.fillRect(0, 0, 26, 20);
    g.fillStyle = '#fffbf0';
    g.fillRect(9, 4, 8, 7); g.fillRect(10, 11, 6, 2);
    g.fillRect(4, 14, 3, 2); g.fillRect(19, 14, 3, 2); g.fillRect(7, 15, 12, 1);
    g.fillStyle = '#1a1628'; g.fillRect(10, 6, 2, 2); g.fillRect(14, 6, 2, 2);
    return cv;
  }

  function setTexture(crew) {
    const cv = flagCanvas(crew);
    if (S.tex) S.tex.dispose();
    S.tex = new THREE.CanvasTexture(cv);
    S.tex.magFilter = THREE.NearestFilter; S.tex.minFilter = THREE.NearestFilter; S.tex.generateMipmaps = false;
    S.mat.map = S.tex;
    S.mat.needsUpdate = true;
  }

  function raise(plate, crew, o) {
    if (!S.ok && !init()) return;
    o = o || {};
    plate = plate || 'own';
    S.crew = GLT.data.crews[crew] ? crew : 'strawHat';
    S.plate = plate;
    S.colors = GLT.data.crews[S.crew].colors;
    setTexture(S.crew);
    const rb = GLT.layout.rimBounds(plate);
    const c = GLT.layout.plateCenter(plate);
    // far rim (north edge, -Z), slightly off-centre toward the channel, on the rim top
    const x = o.x != null ? o.x : c.x;
    const z = o.z != null ? o.z : rb.minZ + GLT.C.RIM * 0.5;
    S.root.position.set(x, GLT.C.PLATE_Y + GLT.C.RIM_TOP, z);
    S.root.rotation.y = o.yaw != null ? o.yaw : 0;
    // GLT.fleet3d owns the flag raise when it is live (ARCHITECTURE §7: ceremony:start -> fleet3d flag raise); the fx mast
    // is then skipped and only the confetti/glitter beat plays, timed to the same hoist.
    const shipsLive = !o.force && !!(GLT.fleet3d && GLT.fleet3d.init && GLT.fleet3d.init());
    S.mast = !shipsLive;
    S.root.visible = S.mast;
    S.state = 1; S.age = o.at || 0; S.popped = false;
    pose(0);
  }

  function lower(instant) {
    if (!S.ok) return;
    if (instant || S.state === 0) { S.state = 0; S.root.visible = false; return; }
    S.state = 3; S.age = 0;
  }

  function easeOutBack(u) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); }
  function easeInOut(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }

  const RISE = 0.9, HOIST = 1.9;
  // pole rises out of the rim (0..RISE), then the flag is hoisted (RISE..RISE+HOIST) with an overshoot
  function pose(t) {
    const ur = Math.min(1, t / RISE);
    S.pole.position.y = -POLE_H * (1 - easeInOut(ur));
    S.pole.scale.y = 1;
    const uh = Math.max(0, Math.min(1, (t - RISE) / HOIST));
    const top = POLE_H - 0.75 - 0.5;
    const bottom = 2.2 + FLAG_H;
    S.flag.position.y = S.pole.position.y + bottom + (top - bottom) * easeOutBack(uh);
    // furled while low: the cloth is squeezed toward the mast and unfurls as it climbs
    S.flag.scale.x = 0.25 + 0.75 * Math.min(1, uh * 1.6);
    S.flag.visible = ur >= 1;
  }

  function wave(t, k) {
    const p = S.flagGeo.attributes.position.array, b = S.base;
    for (let i = 0; i < p.length; i += 3) {
      const x = b[i], y = b[i + 1];
      const f = x / FLAG_W;                                  // 0 at the mast, 1 at the fly
      const w = Math.sin(x * 1.25 - t * 6.2) * 0.42 + Math.sin(x * 2.3 - t * 9.1 + y * 0.6) * 0.16;
      p[i + 2] = w * f * k;
      p[i + 1] = y - f * f * 0.35 * (1 - k * 0.6) + Math.sin(x * 1.1 - t * 6.2) * 0.08 * f;
      p[i] = x - Math.abs(w) * 0.12 * f;
    }
    S.flagGeo.attributes.position.needsUpdate = true;
    gridNormals(p, S.flagGeo.attributes.normal.array);
    S.flagGeo.attributes.normal.needsUpdate = true;
  }

  // Normals of the (SEG_X+1) x (SEG_Y+1) row-major grid by central differences (allocation-free).
  function gridNormals(p, n) {
    const W = SEG_X + 1, Hh = SEG_Y + 1;
    for (let iy = 0; iy < Hh; iy++) for (let ix = 0; ix < W; ix++) {
      const i0 = ix > 0 ? ix - 1 : ix, i1 = ix < W - 1 ? ix + 1 : ix;
      const j0 = iy > 0 ? iy - 1 : iy, j1 = iy < Hh - 1 ? iy + 1 : iy;
      const a = (iy * W + i0) * 3, b = (iy * W + i1) * 3, c = (j0 * W + ix) * 3, d = (j1 * W + ix) * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[d], vy = p[c + 1] - p[d + 1], vz = p[c + 2] - p[d + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const o = (iy * W + ix) * 3;
      n[o] = nx / l; n[o + 1] = ny / l; n[o + 2] = nz / l;
    }
  }

  function confettiPop() {
    const P = GLT.particles;
    if (!P || !S.plate) return;
    const rb = GLT.layout.rimBounds(S.plate);
    const y = GLT.C.PLATE_Y + GLT.C.RIM_TOP + 0.5;
    const cs = [S.colors.primary, S.colors.secondary, S.colors.trim, '#ffe070', '#ffffff'];
    const corners = [[rb.minX + 1, rb.minZ + 1], [rb.maxX - 1, rb.minZ + 1], [rb.minX + 1, rb.maxZ - 1], [rb.maxX - 1, rb.maxZ - 1]];
    const cx = (rb.minX + rb.maxX) / 2, cz = (rb.minZ + rb.maxZ) / 2;
    corners.forEach((c) => {
      const dx = cx - c[0], dz = cz - c[1], l = Math.sqrt(dx * dx + dz * dz);
      cs.forEach((col) => P.emit('confetti', { x: c[0], y, z: c[1] }, { count: 9, color: col, dir: { x: dx / l * 0.5, y: 1, z: dz / l * 0.5 }, cone: 0.5, spread: 1.2, floor: GLT.C.PLATE_Y }));
      P.emit('flash', { x: c[0], y, z: c[1] }, { count: 3, size: 0.8 });
      P.emit('puff', { x: c[0], y, z: c[1] }, { count: 4, dir: { x: 0, y: 1, z: 0 } });
    });
    // gold glitter shower from the flag
    const fp = S.root.position;
    P.emit('glitter', { x: fp.x + (S.mast ? 3 : 0), y: fp.y + (S.mast ? POLE_H - 2 : 8), z: fp.z }, { count: 30, radius: 3.5 });
  }

  function update(dt, t) {
    if (!S.ok || S.state === 0) return;
    S.age += dt;
    if (S.state === 1) {
      if (S.mast) pose(S.age);
      if (!S.popped && S.age >= RISE + HOIST * 0.72) { S.popped = true; confettiPop(); }
      if (S.age >= RISE + HOIST) S.state = 2;
    } else if (S.state === 3) {
      const u = Math.min(1, S.age / 0.6);
      S.pole.position.y = -POLE_H * easeInOut(u);
      S.flag.position.y = S.pole.position.y + POLE_H - 1.25;
      if (u >= 1) { S.state = 0; S.root.visible = false; return; }
    }
    if (!S.mast) { if (S.state === 2 || S.state === 3) S.state = 0; return; }
    const k = S.state === 1 ? Math.min(1, Math.max(0, (S.age - RISE) / HOIST) * 1.4) : 1;
    wave(t, 0.35 + 0.65 * k);
  }

  function dispose() {
    if (S.off) S.off();
    S.off = null;
    if (S.root) { if (S.root.parent) S.root.parent.remove(S.root); GLT.voxel.dispose(S.pole); }
    if (S.flagGeo) S.flagGeo.dispose();
    if (S.tex) S.tex.dispose();
    if (S.mat) S.mat.dispose();
    S.root = S.pole = S.flag = S.flagGeo = S.tex = S.mat = null;
    S.state = 0; S.ok = false;
  }

  GLT._fx_ceremony = {
    init, raise, lower, dispose,
    state() { return S.state; },
    root() { return S.root; }
  };
})();
