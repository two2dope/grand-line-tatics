/* GLT.camera: orthographic isometric camera (azimuth, elevation, zoom), pixel snap, view modes, drag/pinch/wheel input.
 * Area: render. Contract: ARCHITECTURE.md §10.5.
 *
 * Pixel snap: every frame the camera position is moved along its right/up axes so the view lands on whole low-res
 * texels. Pans then shift the image by whole texels (static geometry re-rasterises identically, no shimmer), and the
 * integer texel offset is exported (snapOffset) so the renderer can anchor its Bayer pattern to the world.
 * Azimuth/elevation are quantised to 1/16 degree and zoom to a 1/512 log step, so values that settle after a tween or
 * a drag always reproduce the exact same projection. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let cam = null;
  let mode = 'both';
  let modeOpts = null;
  const cur = { azimuth: 30, elevation: 38, zoom: 1, target: { x: 0, y: 8, z: -4 } };
  let from = null, goal = null, easeT = 1, easeDur = 0.6;
  let inputEnabled = true;
  const snap = { x: 0, y: 0 };
  let wppNow = 0.2;

  const DIST = 600;
  const EL_MIN = 15, EL_MAX = 80, Z_MIN = 0.25, Z_MAX = 4;

  function presets(m, o) {
    const C = GLT.C, L = GLT.layout;
    const own = L.plateCenter('own'), enemy = L.plateCenter('enemy');
    switch (m) {
      case 'own': return { azimuth: 30, elevation: 50, zoom: 1.9, target: own };
      case 'aim': return { azimuth: 0, elevation: 72, zoom: 1.9, target: enemy };
      case 'panorama': return { azimuth: 30, elevation: 26, zoom: 0.32, target: { x: 0, y: 30, z: -80 } };
      case 'ceremony': {
        const p = L.plateCenter((o && o.plate) || 'own');
        return { azimuth: 20, elevation: 22, zoom: 2.6, target: { x: p.x, y: p.y + 6, z: p.z } };
      }
      default: return { azimuth: 30, elevation: 38, zoom: 1, target: { x: 0, y: C.PLATE_Y, z: -4 } };
    }
  }

  const clampEl = (e) => Math.max(EL_MIN, Math.min(EL_MAX, e));
  const clampZoom = (z) => Math.max(Z_MIN, Math.min(Z_MAX, z));
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpAngle = (a, b, k) => { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * k; };
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const qAngle = (a) => Math.round(a * 16) / 16;
  const qZoom = (z) => Math.exp(Math.round(Math.log(z) * 512) / 512);

  function reduced() { return !!(GLT.prefs && GLT.prefs.reducedMotion && GLT.prefs.reducedMotion()); }

  function startTween(g, instant) {
    const target = {
      azimuth: g.azimuth != null ? g.azimuth : cur.azimuth,
      elevation: clampEl(g.elevation != null ? g.elevation : cur.elevation),
      zoom: clampZoom(g.zoom != null ? g.zoom : cur.zoom),
      target: g.target ? { x: g.target.x, y: g.target.y, z: g.target.z } : { x: cur.target.x, y: cur.target.y, z: cur.target.z }
    };
    if (instant || reduced() || GLT.clock.frozen() || !GLT.clock.running || !GLT.clock.running()) {
      cur.azimuth = target.azimuth; cur.elevation = target.elevation; cur.zoom = target.zoom;
      cur.target.x = target.target.x; cur.target.y = target.target.y; cur.target.z = target.target.z;
      goal = null; easeT = 1;
      fitSnap = true;
      if (cam) apply();
    } else {
      from = { azimuth: cur.azimuth, elevation: cur.elevation, zoom: cur.zoom, target: Object.assign({}, cur.target) };
      goal = target; easeT = 0; easeDur = GLT.C.T.cameraEase || 0.6;
    }
    emitChange();
  }

  function emitChange() {
    const g = goal || cur;
    if (GLT.events) GLT.events.emit('camera:changed', { mode, azimuth: g.azimuth, elevation: g.elevation, zoom: g.zoom });
  }

  function update(dt, t, realDt) {
    if (!cam) return;
    if (goal) {
      easeT = Math.min(1, easeT + (realDt || 0) / easeDur);
      const k = ease(easeT);
      cur.azimuth = lerpAngle(from.azimuth, goal.azimuth, k);
      cur.elevation = lerp(from.elevation, goal.elevation, k);
      cur.zoom = Math.exp(lerp(Math.log(from.zoom), Math.log(goal.zoom), k));
      cur.target.x = lerp(from.target.x, goal.target.x, k);
      cur.target.y = lerp(from.target.y, goal.target.y, k);
      cur.target.z = lerp(from.target.z, goal.target.z, k);
      if (easeT >= 1) {
        cur.azimuth = goal.azimuth; cur.elevation = goal.elevation; cur.zoom = goal.zoom;
        goal = null;
      }
    }
    apply(realDt);
  }

  // Half-height needed (at zoom 1) so the given plates fit the view at this azimuth/elevation/aspect around T: the rim
  // plus the terraces below it (5 m past the rim, down to the ocean), with a small margin.
  function fitPlates(az, el, aspect, plates, T) {
    const L = GLT.layout, C = GLT.C;
    const n = L.size ? L.size() : 10;
    const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
    let maxR = 0, maxU = 0;
    plates.forEach((p) => {
      const b = L.rimBounds(p, n);
      const xs = [b.minX - 5, b.maxX + 5], zs = [b.minZ - 6, b.maxZ + 5], ys = [C.PLATE_Y + C.RIM_TOP, C.OCEAN_Y];
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
        const dx = xs[i] - T.x, dz = zs[j] - T.z, dy = ys[k] - T.y;
        const rr = dx * ca - dz * sa;                       // right = (cos az, 0, -sin az)
        const uu = -(dx * sa + dz * ca) * se + dy * ce;     // up projection
        maxR = Math.max(maxR, Math.abs(rr)); maxU = Math.max(maxU, Math.abs(uu));
      }
    });
    return Math.max(maxR * 1.04 / aspect, maxU * 1.06);
  }
  function fitBoth(az, el, aspect) { return fitPlates(az, el, aspect, ['own', 'enemy'], presets('both').target); }

  // Framing: 'both', 'own' and 'aim' widen the view (never narrow it) so the whole rim of their plate(s) stays on
  // screen at any aspect ratio (phones in portrait included). The factor eases, so a mode switch never pops.
  const FIT_ZOOM = { both: 1, own: 1.9, aim: 1.9 };
  let fitK = 1, fitSnap = true;
  let frameShift = 0;     // hosted: content sits this fraction of the half-height lower (room for the HUD on top)
  function fitWanted(az, el, aspect) {
    const pz = FIT_ZOOM[mode];
    if (!pz) return 1;
    const plates = mode === 'both' ? ['own', 'enemy'] : [mode === 'own' ? ((modeOpts && modeOpts.plate) || 'own') : ((modeOpts && modeOpts.plate) || 'enemy')];
    const T = goal ? goal.target : cur.target;
    const need = fitPlates(az, el, aspect, plates, T) * (1 + Math.abs(frameShift));
    return Math.max(1, (need * pz) / GLT.C.VIEW_HALF_H);
  }

  const _m4 = { m: null, eye: null, at: null, up: null };
  function apply(realDt) {
    const sz = GLT.renderer.size();
    const aspect = sz.w / Math.max(1, sz.h);
    const azD = qAngle(cur.azimuth), elD = qAngle(clampEl(cur.elevation)), z = qZoom(clampZoom(cur.zoom));
    const az = (azD * Math.PI) / 180, el = (elD * Math.PI) / 180;
    const gAz = goal ? (qAngle(goal.azimuth) * Math.PI) / 180 : az, gEl = goal ? (qAngle(clampEl(goal.elevation)) * Math.PI) / 180 : el;
    const want = fitWanted(gAz, gEl, aspect);
    if (fitSnap || !(realDt > 0)) { if (fitSnap || !goal) fitK = want; }
    else fitK += (want - fitK) * Math.min(1, realDt * 6);
    fitSnap = false;
    const base = GLT.C.VIEW_HALF_H * Math.round(fitK * 512) / 512;
    const halfH = base / z;
    const halfW = halfH * aspect;
    const sh = Math.round(frameShift * sz.h / 2) * (2 * halfH) / Math.max(1, sz.h);   // whole texels
    cam.left = -halfW; cam.right = halfW; cam.top = halfH + sh; cam.bottom = -halfH + sh;
    cam.near = 1; cam.far = DIST * 2 + 600;
    cam.updateProjectionMatrix();
    const dx = Math.sin(az) * Math.cos(el), dy = Math.sin(el), dz = Math.cos(az) * Math.cos(el);
    const T = cur.target;
    cam.position.set(T.x + dx * DIST, T.y + dy * DIST, T.z + dz * DIST);
    cam.up.set(0, 1, 0);
    // orientation from local (parent-space) vectors, so the camera also works as a child of a scaled group (hosted)
    if (!_m4.m) { _m4.m = new THREE.Matrix4(); _m4.eye = new THREE.Vector3(); _m4.at = new THREE.Vector3(); _m4.up = new THREE.Vector3(0, 1, 0); }
    _m4.m.lookAt(_m4.eye.copy(cam.position), _m4.at.set(T.x, T.y, T.z), _m4.up);
    cam.quaternion.setFromRotationMatrix(_m4.m);
    cam.updateMatrix();
    // pixel snap along camera right/up so the view lands on whole low-res texels
    const wpp = (2 * halfH) / Math.max(1, sz.h);
    wppNow = wpp;
    const e = cam.matrix.elements;
    const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
    const pr = cam.position.x * rx + cam.position.y * ry + cam.position.z * rz;
    const pu = cam.position.x * ux + cam.position.y * uy + cam.position.z * uz;
    const ir = Math.round(pr / wpp), iu = Math.round(pu / wpp);
    const sr = ir * wpp - pr, su = iu * wpp - pu;
    cam.position.x += rx * sr + ux * su;
    cam.position.y += ry * sr + uy * su;
    cam.position.z += rz * sr + uz * su;
    cam.updateMatrixWorld();
    snap.x = ir; snap.y = iu;
  }

  // ---- input: drag to turn (1 pointer), pinch or wheel to zoom ----
  const pointers = new Map();
  let dragStart = null, pinchStart = null, moved = false, clickBlock = false;

  function onDown(ev) {
    const cv = GLT.renderer.canvas();
    if (!cv || ev.target !== cv) return;
    clickBlock = false;
    if (!inputEnabled || ev.gltConsumed) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    if (pointers.size === 1) {
      dragStart = { x: ev.clientX, y: ev.clientY, az: cur.azimuth, el: cur.elevation };
      moved = false;
    } else if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      pinchStart = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, zoom: cur.zoom };
      dragStart = null;
    }
  }

  function onMove(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!inputEnabled) return;
    if (pointers.size >= 2 && pinchStart) {
      const p = Array.from(pointers.values());
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      goal = null;
      cur.zoom = clampZoom(pinchStart.zoom * (d / pinchStart.d));
      moved = true; clickBlock = true;
      emitChange();
    } else if (dragStart) {
      const dx = ev.clientX - dragStart.x, dy = ev.clientY - dragStart.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      moved = true; clickBlock = true;
      goal = null;
      cur.azimuth = (((dragStart.az - dx * 0.35) % 360) + 360) % 360;
      cur.elevation = clampEl(dragStart.el + dy * 0.25);
      emitChange();
    }
  }

  function onUp(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 1) {
      const p = Array.from(pointers.values())[0];
      dragStart = { x: p.x, y: p.y, az: cur.azimuth, el: cur.elevation };
    } else if (pointers.size === 0) dragStart = null;
  }

  function onWheel(ev) {
    if (!inputEnabled) return;
    ev.preventDefault();
    goal = null;
    cur.zoom = clampZoom(cur.zoom * Math.exp(-Math.max(-120, Math.min(120, ev.deltaY)) * 0.0015));
    emitChange();
  }

  function attachInput() {
    const cv = GLT.renderer.canvas();
    if (!cv) return;
    const host = cv.parentNode || cv;
    host.addEventListener('pointerdown', onDown);   // bubbling: GLT.picking (on the canvas) decides first
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
  }

  function init(o) {
    if (cam) return true;
    if (typeof THREE === 'undefined' || !GLT.renderer.three()) return false;
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    if (o && o.parent) o.parent.add(cam);      // hosted: child of the sea root, so it sees the world in metres
    if (o && typeof o.shift === 'number') frameShift = Math.max(-0.3, Math.min(0.3, o.shift));
    const p = presets('both');
    cur.azimuth = p.azimuth; cur.elevation = p.elevation; cur.zoom = p.zoom;
    cur.target = { x: p.target.x, y: p.target.y, z: p.target.z };
    GLT.clock.onFrame(update, 900);
    if (!o || o.input !== false) attachInput();  // hosted: the game handles pointer input and calls set()
    apply();
    return true;
  }

  function setMode(m, o) {
    if (GLT.data.viewModes.indexOf(m) < 0) m = 'both';
    mode = m;
    modeOpts = o || null;
    startTween(presets(m, o), o && o.instant);
  }

  function set(o, o2) { startTween(o || {}, o2 && o2.instant); }

  function get() {
    return { mode, azimuth: cur.azimuth, elevation: cur.elevation, zoom: cur.zoom, target: Object.assign({}, cur.target) };
  }

  function worldPerPixel() {
    if (!cam) return (2 * GLT.C.VIEW_HALF_H) / Math.max(1, GLT.renderer.size().h);
    return wppNow;
  }

  GLT.camera = {
    init,
    three() { return cam; },
    setMode,
    mode() { return mode; },
    modeOptions() { return modeOpts; },
    set,
    get,
    setInputEnabled(b) { inputEnabled = !!b; if (!inputEnabled) { pointers.clear(); dragStart = null; pinchStart = null; } },
    inputEnabled() { return inputEnabled; },
    worldPerPixel,
    presets,
    // additions (render area)
    snapOffset() { return snap; },             // integer texel offset of the snapped camera (right, up); reused object
    elevation() { return cur.elevation; },
    azimuth() { return cur.azimuth; },
    zoom() { return cur.zoom; },
    distance() { return DIST; },
    moving() { return !!goal || moved && pointers.size > 0; },
    dragged() { return clickBlock; },          // true from a drag/pinch until the next pointerdown; picking skips clicks
    update() { if (cam) apply(); }
  };

  // Bootstrap demo: plate grids, cell centres and ship envelopes from GLT.layout (validates the mapping).
  GLT.demos = GLT.demos || {};
  GLT.demos['render.camera'] = function (ctx) {
    const L = GLT.layout, C = GLT.C;
    const n = L.size();
    const v = GLT.voxel;
    ['own', 'enemy'].forEach((plate) => {
      const b = L.rimBounds(plate, n);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX, 2, b.maxZ - b.minZ), new THREE.MeshLambertMaterial({ color: GLT.palette.get('rock') }));
      slab.position.set((b.minX + b.maxX) / 2, C.PLATE_Y - 1.05, 0);
      slab.receiveShadow = true; slab.castShadow = true;
      GLT.scene.add(slab, 'plates');
      const water = GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: GLT.palette.get('sea') }), 'water');
      const water2 = GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: GLT.palette.get('sea-light') }), 'water');
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const p = L.cellToWorld(plate, r, c, n);
        const tile = new THREE.Mesh(new THREE.BoxGeometry(C.CELL - 0.3, 0.2, C.CELL - 0.3), (r + c) % 2 ? water : water2);
        tile.position.set(p.x, p.y - 0.1, p.z);
        tile.receiveShadow = true;
        GLT.scene.add(tile, 'plates');
      }
      const fleet = ctx.sampleFleet('classica');
      fleet.ships.forEach((s) => {
        const tr = L.shipTransform(plate, s, n);
        const env = L.shipEnvelope(s.len);
        const box = new THREE.Mesh(new THREE.BoxGeometry(env.length, 2, env.beam), new THREE.MeshLambertMaterial({ color: GLT.palette.get(plate === 'own' ? 'red' : 'blue') }));
        box.position.set(tr.x, tr.y + 1, tr.z);
        box.rotation.y = tr.yaw;
        box.castShadow = true; box.receiveShadow = true;
        GLT.scene.add(box, 'ships');
        const bow = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 0.8), new THREE.MeshLambertMaterial({ color: GLT.palette.get('gold') }));
        bow.position.set(env.length / 2 - 0.4, 1.5, 0);
        bow.castShadow = true;
        box.add(bow);
      });
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), GLT.renderer.markMaterial(new THREE.MeshLambertMaterial({ color: GLT.palette.get('sea-deep') }), 'water'));
    sea.rotation.x = -Math.PI / 2;
    sea.receiveShadow = true;
    GLT.scene.add(sea, 'world');
  };
})();
