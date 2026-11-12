/* GLT.props: Log Pose buoy, torch buoys, lighthouse (+ beam), big and small Den Den Mushi video boards.
 * Area: world. Contract: ARCHITECTURE.md §9, §11.1.
 *  - Log Pose buoy (inner zone, origin): bobbing float with a glass dome; its needle swings toward the plate under fire,
 *    toward a Log Pose hint, and drifts north to Reverse Mountain when idle.
 *  - Torch buoys (sectors 0 and 7): instanced per sector, flames flicker (glow class, bright at night).
 *  - Lighthouse (sector 2): voxel tower; the beam comes from GLT.lighting.lighthouse() and is re-parented into the
 *    sector group so the doll's-house lift raises and hides it with the rest of the sector.
 *  - Den Den Mushi boards: big (sector 4) and small (sector 0). A giant snail rides on a framed screen; the screen is a
 *    canvas texture showing AO VIVO, the turn and timer, hits and sunk ships for both sides, two mini "live shot" grids
 *    (read from GLT.plates) and the last call ("B7 — Água!"). All words come from GLT.T; numbers via pt-BR formatting.
 *    The snail's mouth opens while a call is fresh. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const S = {
    ok: false, root: null, logPose: null, needle: null, needleYaw: 0, needleGoal: Math.PI, torches: [], boards: {}, offs: [],
    hint: null, hintUntil: -1, targetPlate: null, lighthouse: null,
    info: { crews: ['strawHat', 'marine'], colors: ['#e0b030', '#1a3f8c'], local: 0 },
    data: { big: {}, small: {} }, callAt: -1e9, reaction: null, reactionUntil: -1, lastDraw: -1, hits: [0, 0], sunk: [0, 0]
  };
  function K() { return GLT._world_kit; }
  const D2R = Math.PI / 180;
  function sp(k, r, lat) {
    const a = k * 45 * D2R;
    return { x: Math.sin(a) * r + Math.cos(a) * (lat || 0), z: Math.cos(a) * r - Math.sin(a) * (lat || 0) };
  }
  function sectorGroup(k) { return GLT.backdrop && GLT.backdrop.sectorGroup ? GLT.backdrop.sectorGroup(k) : null; }

  // ------------------------------------------------------------------ Log Pose buoy
  function buildLogPose() {
    const g = new THREE.Group();
    g.name = 'log-pose-buoy';
    const vb = K().vb(0.25);
    for (let y = -2; y <= 5; y++) {
      const r = y < 0 ? 5 : y < 3 ? 6 : 4;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        const d = Math.hypot(x, z);
        if (d > r + 0.3) continue;
        if (d < r - 1.2 && y > -2 && y < 5) continue;
        vb.set(x, y, z, y === 1 || y === 2 ? (Math.floor(Math.atan2(z, x) * 2) & 1 ? 'red' : 'white') : y === 5 ? 'brass' : 'red-dark');
      }
    }
    vb.box(-2, 6, -2, 2, 6, 2, 'brass');
    // glass dome
    for (let x = -3; x <= 3; x++) for (let y = 7; y <= 12; y++) for (let z = -3; z <= 3; z++) {
      const d = Math.hypot(x, (y - 7) * 0.85, z);
      if (d <= 3.6 && d > 2.6) vb.set(x, y, z, 'blue-light', 'glass');
    }
    vb.box(-3, 7, -3, 3, 7, 3, 'wood-dark');
    vb.box(0, 7, 0, 0, 9, 0, 'brass');
    // lantern on a little mast
    for (let y = 6; y <= 15; y++) vb.set(5, y, 0, 'iron');
    vb.box(4, 16, -1, 6, 17, 1, 'lantern', 'emissive');
    vb.set(5, 18, 0, 'iron');
    g.add(K().build(vb, { castShadow: true, receiveShadow: true, ao: 0.4 }));
    const nb = K().vb(0.125);
    for (let x = -10; x <= 10; x++) nb.set(x, 0, 0, x > 0 ? 'red' : 'gold');
    nb.box(10, 0, -1, 11, 0, 1, 'red');
    const needle = K().build(nb, { castShadow: false, receiveShadow: false, ao: 0 });
    needle.position.set(0.125, 2.5, 0.125);
    g.add(needle);
    S.needle = needle;
    return g;
  }

  // ------------------------------------------------------------------ torch buoys
  function torchSet(k, pts) {
    const vb = K().vb(0.25);
    for (let y = -2; y <= 1; y++) vb.box(-2, y, -2, 1, y, 1, y === 0 ? 'white' : 'red');
    for (let y = 2; y <= 9; y++) vb.box(-1, y, -1, 0, y, 0, 'wood-dark');
    vb.box(-2, 10, -2, 1, 10, 1, 'iron');
    const body = K().voxGeometry(vb, { ao: 0.3 });
    const fb = K().vb(0.25);
    fb.box(-1, 0, -1, 0, 1, 0, 'fire', 'emissive');
    fb.box(-1, 2, -1, 0, 2, 0, 'fire-hot', 'emissive');
    fb.set(-1, 3, 0, 'yellow', 'emissive');
    fb.set(-2, 0, -1, 'fire', 'emissive'); fb.set(1, 0, 0, 'fire', 'emissive');
    let fgeo = null;
    K().build(fb, {}).traverse((m) => { if (!fgeo && m.isMesh) fgeo = m.geometry; });
    const bodyM = K().inst(body, GLT.voxel.material('solid'), pts.length, { name: 'torch-body-' + k, receive: true });
    const flameM = K().inst(fgeo, GLT.voxel.material('emissive'), pts.length, { name: 'torch-flame-' + k });
    bodyM.count = flameM.count = pts.length;
    return { k, pts, bodyM, flameM };
  }

  // ------------------------------------------------------------------ lighthouse
  function buildLighthouse() {
    const p = sp(2, 106, -22);
    const vb = K().vb(0.5);
    const k2 = K();
    const cx = Math.round(p.x / 0.5), cz = Math.round(p.z / 0.5);
    // islet
    for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) {
      const d = Math.hypot(x, z) + k2.noise2(x * 0.2, z * 0.2, 4) * 4;
      if (d > 20) continue;
      const top = Math.floor((20 - d) * 0.45) + 1;
      for (let y = -2; y <= top; y++) vb.set(cx + x, y, cz + z, y === top ? (d > 15 ? 'sand' : 'grass') : 'rock');
    }
    // stripes tower
    const H = 56;
    for (let y = 8; y < 8 + H; y++) {
      const r = 6 - (y - 8) * 0.04;
      for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
        const d = Math.hypot(x, z);
        if (d > r || d < r - 1.3) continue;
        const win = (y % 12 === 6) && x === 0 && z > 0;
        vb.set(cx + x, y, cz + z, win ? 'slate-dark' : Math.floor((y - 8) / 8) % 2 ? 'white' : 'red');
      }
    }
    const ty = 8 + H;
    vb.box(cx - 6, ty, cz - 6, cx + 6, ty, cz + 6, 'iron');
    for (let y = ty + 1; y <= ty + 5; y++) for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const edge = Math.abs(x) === 4 || Math.abs(z) === 4;
      if (!edge) continue;
      const post = Math.abs(x) === 4 && Math.abs(z) === 4;
      vb.set(cx + x, y, cz + z, post ? 'iron' : 'yellow', post ? undefined : 'emissive');
    }
    for (let y = ty + 6; y <= ty + 9; y++) { const r = 5 - (y - ty - 6); vb.box(cx - r, y, cz - r, cx + r, y, cz + r, 'red-dark'); }
    const g = K().build(vb, { castShadow: false, receiveShadow: true, ao: 0.45 });
    g.name = 'lighthouse';
    const foam = K().foamMesh((i, k) => vb.get(i, 0, k) != null || vb.get(i, -1, k) != null, cx - 24, cx + 24, cz - 24, cz + 24, 0.5, 0, 0, { y: 0.06, name: 'lighthouse-foam' });
    if (foam) g.add(foam);
    return { group: g, lamp: { x: p.x, y: (ty + 3) * 0.5, z: p.z } };
  }

  // ------------------------------------------------------------------ Den Den Mushi boards
  function buildSnail(scale) {
    const vb = K().vb(0.5 * scale);
    // body (slug foot) along +X, head at +X end with eye stalks; shell with spiral and a golden dial-phone receiver
    for (let x = -9; x <= 10; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 2; y++) {
      if (Math.abs(z) === 3 && (y === 2 || x < -7)) continue;
      vb.set(x, y, z, y === 0 ? 'skin-shadow' : 'yellow');
    }
    for (let x = 7; x <= 11; x++) for (let y = 3; y <= 7; y++) for (let z = -2; z <= 2; z++) {
      if ((x === 11 || x === 7) && (y === 7 || Math.abs(z) === 2)) continue;
      vb.set(x, y, z, 'yellow');
    }
    // mouth (separate part animates: we just paint lips here)
    for (let z = -1; z <= 1; z++) vb.set(12, 4, z, 'red-dark');
    vb.set(12, 5, -2, 'pink'); vb.set(12, 5, 2, 'pink');
    [-1, 1].forEach((s) => {
      for (let y = 8; y <= 11; y++) vb.set(10, y, s * 2, 'yellow');
      vb.box(9, 12, s * 2 - 1, 11, 13, s * 2 + 1, 'white');
      vb.set(11, 12, s * 2, 'black'); vb.set(11, 13, s * 2, 'black');
      vb.box(9, 14, s * 2 - 1, 11, 14, s * 2 + 1, 'yellow');
    });
    // shell: stacked discs with a spiral groove
    for (let x = -7; x <= 4; x++) for (let y = 2; y <= 14; y++) for (let z = -4; z <= 4; z++) {
      const cy = 8, cx = -1.5;
      const d = Math.hypot(x - cx, y - cy);
      if (d > 6.4 || Math.abs(z) > 3.5 - Math.max(0, d - 5) * 0.8) continue;
      const ang = Math.atan2(y - cy, x - cx);
      const spiral = (d + ang * 1.1 + 20) % 2.2 < 0.8;
      vb.set(x, y, z, Math.abs(z) > 2.5 ? (spiral ? 'gold-dark' : 'gold') : (spiral ? 'soil' : 'terracotta'));
    }
    // dial on the shell side
    [-1, 1].forEach((s) => { for (let a = 0; a < 10; a++) vb.set(Math.round(-1.5 + Math.cos(a / 10 * 6.28) * 2.5), Math.round(8 + Math.sin(a / 10 * 6.28) * 2.5), s * 4, 'white'); });
    // receiver on top
    vb.box(-5, 15, -1, 2, 15, 1, 'iron');
    vb.box(-6, 16, -2, -4, 17, 2, 'iron'); vb.box(1, 16, -2, 3, 17, 2, 'iron');
    return vb;
  }

  function buildBoard(which) {
    const big = which === 'big';
    const k = big ? 4 : 0;
    const p = big ? sp(4, 116, 0) : sp(0, 100, -16);
    const W = big ? 52 : 24, H = W * 9 / 16;
    const cy = big ? 40 : 17;
    const g = new THREE.Group();
    g.name = 'denden-' + which;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-p.x, -p.z);
    // frame + stilts + pontoon (local coords: screen faces +Z)
    const vb = K().vb(big ? 1 : 0.5);
    const s = big ? 1 : 0.5;
    const hw = Math.round(W / 2 / s) + 1, y0 = Math.round((cy - H / 2) / s) - 1, y1 = Math.round((cy + H / 2) / s) + 1;
    for (let x = -hw; x <= hw; x++) for (let y = y0; y <= y1; y++) {
      if (x > -hw && x < hw && y > y0 && y < y1) continue;
      vb.set(x, y, 0, (x + y) % 4 === 0 ? 'gold' : 'wood-dark');
      vb.set(x, y, -1, 'wood-dark');
    }
    for (let x = -hw + 1; x < hw; x++) for (let y = y0 + 1; y < y1; y++) vb.set(x, y, -1, 'black');
    [-hw + 2, hw - 2].forEach((x) => { for (let y = -1; y < y0; y++) { vb.set(x, y, -1, 'wood'); vb.set(x, y, -2, 'wood-dark'); } });
    const pw = Math.round(hw * 0.8), pd = Math.round(8 / s);
    for (let x = -pw; x <= pw; x++) for (let z = -pd; z <= Math.round(3 / s); z++) for (let y = -1; y <= 0; y++) vb.set(x, y, z, y === 0 ? ((x & 1) ? 'wood' : 'wood-light') : 'wood-dark');
    // banner lamps along the frame top
    for (let x = -hw; x <= hw; x += 3) vb.set(x, y1 + 1, 0, 'lantern', 'emissive');
    const fg = K().build(vb, { castShadow: false, receiveShadow: true, ao: 0.35 });
    g.add(fg);
    // screen
    const cv = document.createElement('canvas');
    cv.width = big ? 256 : 192; cv.height = big ? 144 : 108;
    const tex = K().canvasTexture(cv);
    const sm = new THREE.MeshBasicMaterial({ map: tex });
    K().outline(sm, 'glow');
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), sm);
    screen.position.set(0, cy, 0.55 * s + 0.05);
    g.add(screen);
    // stadium-style back screen (same texture): the board reads from the outer ring and in the panorama too
    const back = new THREE.Mesh(screen.geometry, sm);
    back.position.set(0, cy, -s - 0.05);
    back.rotation.y = Math.PI;
    g.add(back);
    // snail on top
    const sc = big ? 1.6 : 0.8;
    const snail = K().build(buildSnail(sc), { castShadow: false, receiveShadow: true, ao: 0.4 });
    snail.position.set(-2 * sc, (y1 + 1) * s, -0.5);
    snail.rotation.y = -Math.PI / 2 * 0.4;
    g.add(snail);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.5 * sc, 1.0 * sc, 1.5 * sc), GLT.voxel.material('solid'));
    mouth.visible = false;
    void mouth;
    const grp = sectorGroup(k);
    (grp || S.root).add(g);
    return { which, group: g, canvas: cv, tex, snail, sc, baseY: snail.position.y };
  }

  // ------------------------------------------------------------------ board drawing
  function fitText(g, txt, maxW, size, family) {
    let s = size;
    g.font = s + 'px ' + family;
    while (s > 5 && g.measureText(txt).width > maxW) { s -= 1; g.font = s + 'px ' + family; }
    return s;
  }
  const PIX = '"Pixelify Sans", "Press Start 2P", monospace';
  const NUM = '"Press Start 2P", "Pixelify Sans", monospace';

  function drawBoard(b, t) {
    const cv = b.canvas, g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const d = S.data[b.which] || {};
    const u = W / 256;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0b0a12'; g.fillRect(0, 0, W, H);
    // scanline backdrop
    g.fillStyle = '#12182c';
    for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1);
    // header
    g.fillStyle = '#1a3f8c'; g.fillRect(0, 0, W, Math.round(18 * u));
    const blink = Math.floor(t * 2) % 2 === 0;
    g.fillStyle = blink ? '#ee6a52' : '#6e1424';
    g.fillRect(Math.round(5 * u), Math.round(5 * u), Math.round(8 * u), Math.round(8 * u));
    g.fillStyle = '#fffdf7';
    g.textBaseline = 'middle'; g.textAlign = 'left';
    fitText(g, GLT.T('denden.live'), 60 * u, Math.round(11 * u), PIX);
    g.fillText(GLT.T('denden.live'), Math.round(17 * u), Math.round(9.5 * u));
    // turn + timer
    g.textAlign = 'right';
    const timer = d.timer != null ? GLT.T('denden.timer') + ' ' + GLT.i18n.time(Math.max(0, d.timer) * 1000) : '';
    fitText(g, timer, 70 * u, Math.round(9 * u), PIX);
    g.fillStyle = d.timer != null && d.timer <= 5 ? '#ffd86a' : '#a6e2df';
    if (timer) g.fillText(timer, W - Math.round(5 * u), Math.round(9.5 * u));
    g.textAlign = 'center';
    const turn = d.turnName ? GLT.T('denden.turn') + ' ' + d.turnName : GLT.T('denden.waiting');
    fitText(g, turn, 110 * u, Math.round(9 * u), PIX);
    g.fillStyle = '#ffd86a';
    g.fillText(turn, W / 2 + Math.round(8 * u), Math.round(9.5 * u));
    // two side panels: colour stripe, hits, sunk, live mini grid
    const hits = d.hits || [0, 0], sunk = d.sunk || [0, 0];
    const cols = [S.info.colors[S.info.local] || '#e0b030', S.info.colors[1 - S.info.local] || '#1a3f8c'];
    const plates = ['own', 'enemy'];
    const n = GLT.plates && GLT.plates.size ? GLT.plates.size() || 10 : 10;
    for (let side = 0; side < 2; side++) {
      const x0 = side ? W / 2 + Math.round(3 * u) : Math.round(4 * u);
      const pw = W / 2 - Math.round(7 * u);
      const y0 = Math.round(22 * u);
      g.fillStyle = cols[side]; g.fillRect(x0, y0, pw, Math.round(3 * u));
      // mini grid of the shots this side has fired (marks on the OTHER plate)
      const gs = Math.max(2, Math.floor((54 * u) / n));
      const gx = x0, gy = y0 + Math.round(6 * u);
      const plate = plates[1 - side];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const m = GLT.plates && GLT.plates.mark ? GLT.plates.mark(plate, r, c) : 0;
        g.fillStyle = m === 1 ? '#6c7a94' : m === 2 ? '#ee6a52' : m === 3 ? '#9a2216' : m === 4 ? '#f4c443' : ((r + c) & 1 ? '#18457a' : '#1e5a92');
        g.fillRect(gx + c * gs, gy + r * gs, gs - (gs > 3 ? 1 : 0), gs - (gs > 3 ? 1 : 0));
      }
      const tx = gx + n * gs + Math.round(5 * u);
      const tw = x0 + pw - tx;
      g.textAlign = 'left';
      g.fillStyle = '#a6e2df';
      fitText(g, GLT.T('denden.hits'), tw, Math.round(9 * u), PIX);
      g.fillText(GLT.T('denden.hits'), tx, gy + Math.round(6 * u));
      g.fillStyle = '#fffdf7';
      fitText(g, GLT.i18n.num(hits[side] || 0), tw, Math.round(13 * u), NUM);
      g.fillText(GLT.i18n.num(hits[side] || 0), tx, gy + Math.round(20 * u));
      g.fillStyle = '#a6e2df';
      fitText(g, GLT.T('denden.sunk'), tw, Math.round(9 * u), PIX);
      g.fillText(GLT.T('denden.sunk'), tx, gy + Math.round(35 * u));
      g.fillStyle = '#fffdf7';
      fitText(g, GLT.i18n.num(sunk[side] || 0), tw, Math.round(13 * u), NUM);
      g.fillText(GLT.i18n.num(sunk[side] || 0), tx, gy + Math.round(49 * u));
    }
    // last call bar
    const by = H - Math.round(36 * u);
    g.fillStyle = '#322b48'; g.fillRect(0, by, W, Math.round(36 * u));
    g.fillStyle = '#b090e0';
    g.textAlign = 'left';
    const head = d.victory ? GLT.T('denden.victory') : GLT.T('denden.lastShot');
    fitText(g, head, W - 10 * u, Math.round(9 * u), PIX);
    g.fillText(head, Math.round(5 * u), by + Math.round(8 * u));
    const fresh = t - S.callAt < 2.5;
    const call = S.reaction && t < S.reactionUntil && b.which === 'small' ? S.reaction : (d.lastCall || '—');
    g.textAlign = 'center';
    fitText(g, call, W - 10 * u, Math.round(16 * u), PIX);
    g.fillStyle = fresh && Math.floor(t * 6) % 2 ? '#ffd86a' : '#fffdf7';
    g.fillText(call, W / 2, by + Math.round(24 * u));
    b.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ frame
  function onFrame(dt, t) {
    if (!S.ok) return;
    // Log Pose buoy bob + needle
    if (S.logPose) {
      S.logPose.position.y = GLT.C.OCEAN_Y + Math.sin(t * 1.2) * 0.12 - 0.1;
      S.logPose.rotation.z = Math.sin(t * 0.9) * 0.05;
      S.logPose.rotation.x = Math.sin(t * 0.7 + 1) * 0.04;
      let goal = Math.PI / 2 + Math.sin(t * 0.3) * 0.25;   // idle: north (-Z) toward Reverse Mountain
      if (S.hint && t < S.hintUntil) {
        const w = GLT.layout.cellToWorld('enemy', S.hint.r, S.hint.c);
        goal = Math.atan2(-w.z, w.x);
      } else if (S.targetPlate) {
        const c = GLT.layout.plateCenter(S.targetPlate);
        goal = Math.atan2(-c.z, c.x) + Math.sin(t * 2.3) * 0.05;
      }
      let d = goal - S.needleYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      S.needleYaw += d * Math.min(1, dt * 3 + (GLT.clock.frozen() ? 1 : 0));
      if (S.needle) S.needle.rotation.y = S.needleYaw;
    }
    // torches flicker
    S.torches.forEach((ts) => {
      const a = ts.bodyM.instanceMatrix.array, f = ts.flameM.instanceMatrix.array;
      for (let i = 0; i < ts.pts.length; i++) {
        const p = ts.pts[i];
        const bob = Math.sin(t * 1.4 + i * 1.7) * 0.18;
        K().setInst(a, i, p.x, bob - 0.1, p.z, i, 1, 1, 1);
        const fl = 0.85 + 0.25 * Math.sin(t * 13 + i * 3) + 0.12 * Math.sin(t * 7.7 + i);
        K().setInst(f, i, p.x, bob - 0.1 + 2.85, p.z, t * 2 + i, fl, 0.8 + fl * 0.5, fl);
      }
      ts.bodyM.instanceMatrix.needsUpdate = true; ts.flameM.instanceMatrix.needsUpdate = true;
    });
    // snail mouths / bobs and board redraws (throttled to ~6 Hz; immediately on data change)
    const talk = t - S.callAt < 1.6;
    Object.keys(S.boards).forEach((w) => {
      const b = S.boards[w];
      b.snail.position.y = b.baseY + (talk ? Math.abs(Math.sin(t * 9)) * 0.4 * b.sc : Math.sin(t * 0.8) * 0.1);
      b.snail.rotation.z = talk ? Math.sin(t * 9) * 0.03 : 0;
    });
    if (S.dirty || t - S.lastDraw > 0.16 || t < S.lastDraw) {
      S.dirty = false;
      S.lastDraw = t;
      Object.keys(S.boards).forEach((w) => drawBoard(S.boards[w], t));
    }
  }

  // ------------------------------------------------------------------ events
  function crewName(p) { return GLT.T('crew.' + S.info.crews[p] + '.name'); }
  function local() { const l = GLT.app && GLT.app.local ? GLT.app.local() : null; return l == null ? 0 : l; }
  function sideOf(player) { return player === local() ? 0 : 1; }       // 0 = left (own), 1 = right (enemy)
  function pushAll(o) { setBoard('big', o); setBoard('small', o); }

  function subscribe() {
    const E = GLT.events;
    const on = (type, fn) => S.offs.push(E.on(type, fn));
    on('match:created', (e) => {
      if (!e) return;
      S.info.crews = e.crews || S.info.crews; S.info.colors = e.colors || S.info.colors; S.info.local = e.local == null ? 0 : e.local;
      S.hits = [0, 0]; S.sunk = [0, 0];
      pushAll({ hits: [0, 0], sunk: [0, 0], lastCall: '—', turnName: null, timer: null, victory: false });
    });
    on('game:setup', () => { S.hits = [0, 0]; S.sunk = [0, 0]; pushAll({ hits: [0, 0], sunk: [0, 0], lastCall: '—', timer: null, victory: false }); });
    on('turn:changed', (e) => {
      if (!e) return;
      S.targetPlate = GLT.app && GLT.app.plateOf ? GLT.app.plateOf(1 - e.turn) : (e.mine ? 'enemy' : 'own');
      pushAll({ turnName: crewName(e.turn), timer: e.timer > 0 ? e.timer : null });
    });
    on('timer:tick', (e) => { if (e) pushAll({ timer: e.remaining }); });
    on('shot:resolved', (e) => {
      if (!e) return;
      const side = sideOf(e.by);
      if (e.result === 'acerto' || e.result === 'afundou') S.hits[side]++;
      const res = e.result === 'afundou' && e.ship
        ? { key: 'result.afundou', vars: { ship: { key: 'ship.' + e.ship.id + '.name' } } }
        : { key: 'result.' + e.result };
      S.callAt = GLT.clock.now();
      pushAll({ lastCall: GLT.T('call.shot', { cell: e.label || GLT.board.label(e.r, e.c), result: res }), hits: S.hits.slice() });
    });
    on('ship:sunk', (e) => { if (!e) return; S.sunk[sideOf(e.by)]++; pushAll({ sunk: S.sunk.slice() }); });
    on('hint:used', (e) => { if (e && e.r != null) { S.hint = { r: e.r, c: e.c }; S.hintUntil = GLT.clock.now() + 5; } });
    on('game:ended', (e) => {
      if (!e) return;
      S.targetPlate = null;
      pushAll({ victory: true, lastCall: crewName(e.winner), timer: null });
      S.callAt = GLT.clock.now();
    });
    on('reaction:received', (e) => {
      if (!e || !e.preset) return;
      S.reaction = GLT.T('react.' + e.preset);
      S.reactionUntil = GLT.clock.now() + 3;
      S.callAt = GLT.clock.now();
      S.dirty = true;
    });
  }

  // ------------------------------------------------------------------ public
  function setBoard(which, data) {
    if (!data) return;
    const d = S.data[which] || (S.data[which] = {});
    Object.keys(data).forEach((k) => { d[k] = data[k]; });
    S.dirty = true;
  }

  function init() {
    if (S.ok) return true;
    if (typeof THREE === 'undefined' || !GLT.scene || !GLT.scene.root() || !GLT._world_kit || !GLT.voxel) return false;
    if (GLT.backdrop && GLT.backdrop.init) GLT.backdrop.init();     // sector groups host the far props
    S.root = new THREE.Group();
    S.root.name = 'world-props';
    GLT.scene.add(S.root, 'props');
    S.logPose = buildLogPose();
    S.root.add(S.logPose);
    // torch buoys: sector 0 and sector 7 (instanced per sector so the lift moves them with their sector)
    [0, 7].forEach((k) => {
      const pts = [];
      for (let i = 0; i < 5; i++) { const p = sp(k, 88 + i * 9, (i % 2 ? 1 : -1) * (6 + i * 2)); pts.push(p); }
      const ts = torchSet(k, pts);
      const grp = sectorGroup(k) || S.root;
      grp.add(ts.bodyM, ts.flameM);
      S.torches.push(ts);
    });
    // lighthouse in sector 2 (+ the lighting module's beam, re-parented so it lifts with the sector)
    const lh = buildLighthouse();
    (sectorGroup(2) || S.root).add(lh.group);
    if (GLT.lighting && GLT.lighting.lighthouse) {
      const beam = GLT.lighting.lighthouse(lh.lamp, { length: 80, radius: 8, speed: 0.5 });
      if (beam && beam.group && sectorGroup(2)) sectorGroup(2).attach(beam.group);
      S.lighthouse = beam;
    }
    S.boards.big = buildBoard('big');
    S.boards.small = buildBoard('small');
    S.ok = true;
    subscribe();
    S.offs.push(GLT.clock.onFrame(onFrame, 150));
    S.dirty = true;
    if (GLT.i18n && GLT.i18n.fontsReady) GLT.i18n.fontsReady().then(() => { S.dirty = true; }, () => {});
    return true;
  }

  function dispose() {
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.offs = [];
    Object.keys(S.boards).forEach((w) => { K().disposeObj(S.boards[w].group); S.boards[w].tex.dispose(); });
    S.torches.forEach((ts) => { K().disposeObj(ts.bodyM); K().disposeObj(ts.flameM); });
    if (S.lighthouse && S.lighthouse.remove) S.lighthouse.remove();
    if (S.root) K().disposeObj(S.root);
    S.boards = {}; S.torches = []; S.root = null; S.ok = false;
  }

  GLT.props = {
    init, setBoard, dispose,
    // additions (world area)
    board(which) { return Object.assign({}, S.data[which] || {}); },
    boardCanvas(which) { return S.boards[which] ? S.boards[which].canvas : null; },
    needleYaw() { return S.needleYaw; }
  };

  GLT.demos = GLT.demos || {};
  GLT.demos['world.props'] = function (ctx) {
    GLT.demos['world.backdrop'] && (GLT.demos['world.backdrop'].original || GLT.demos['world.backdrop'])(ctx);
    GLT.camera.set({ azimuth: 8, elevation: 22, zoom: 0.9, target: { x: 0, y: 34, z: -110 } }, { instant: true });
  };
})();
