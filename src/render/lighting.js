/* GLT.lighting: time of day (day/dusk/night/storm), sun + shadow map, hemisphere fill, sky colours, fog, colour grade,
 * lightning flashes, a fixed pool of 4 dynamic lights (lanterns, torches, fire) and the lighthouse beam.
 * Area: render. Contract: ARCHITECTURE.md §10.6.
 *
 * Look: warm key light, cool hemisphere fill, so shadows go blue/violet instead of grey (hand-painted pixel-art
 * convention). Each preset also carries a post grade (renderer.setGrade): multiply/lift/saturation/vignette, outline
 * tint and foam colour. Tod changes blend every number over C.T.todS (default 1.2 s, real time; instant when frozen,
 * reduced motion or before the clock runs).
 *
 * Light pool: 3 point lights + 1 spot light are created once at init and never added/removed afterwards, so the
 * number of lights (part of every shader program key) is constant: no recompiles or hitches when lights turn on.
 * addLight() hands out a slot or returns null when the pool is full. Lights flagged night:true scale with
 * nightFactor(). Only the sun casts shadows. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let hemi = null, sun = null, scene = null, fog = null;
  let tod = 'day';
  let flashI = 0, flashDecay = 0;
  let cur = null, fromP = null, toP = null, blendK = 1;
  const TOD_S = 1.2;

  // crestMix is 0: the calm plate swell reads by its two flat tones (a foam line on every 1/8 m lip was dither noise).
  // Raw presets. Colours are hex; angles in degrees (azimuth measured like the camera: 0 = +Z).
  // Calibration: on an up-facing sunlit surface hemi(sky) + sun * sin(sunEl) ~= 1, so palette albedos come back as
  // themselves (flat areas snap without dither) and cast shadows land ~60 % of lit, tinted by the hemisphere colour,
  // which pulls them onto the hue-shifted (violet/blue) dark end of each ramp.
  const RAW = {
    day: {
      top: 0x3f74c4, horizon: 0x93bdea, fogNear: 70, fogFar: 760,
      hemiSky: 0xd2dcff, hemiGround: 0x6a6286, hemiI: 0.72, sun: 0xfff0d2, sunI: 0.46, sunAz: 322, sunEl: 50,
      night: 0, storm: 0, lamp: 0xffb45a, water: 0x93bdea, reflect: 0.06, glint: 0x64acb6,
      grade: { mul: [1.02, 1.0, 0.97], add: [0.004, 0.0, 0.0], sat: 1.08, vignette: 0.12, vigColor: [0.03, 0.06, 0.16],
        outlineTint: [0.04, 0.05, 0.16], outlineMix: 0.32, outlineDark: 0.42, highlight: 0.45, concave: 0.14,
        foam: [0.88, 0.97, 0.94], foamMix: 0.85, crestMix: 0 }
    },
    dusk: {
      top: 0x2e2050, horizon: 0xec8a5e, fogNear: 40, fogFar: 620,
      hemiSky: 0xb08ac4, hemiGround: 0x48284c, hemiI: 0.72, sun: 0xffa055, sunI: 1.15, sunAz: 345, sunEl: 20,
      night: 0.45, storm: 0, lamp: 0xffa040, water: 0x5a2f68, reflect: 0.42, glint: 0xf8b878,
      grade: { mul: [1.08, 0.94, 0.92], add: [0.022, 0.004, 0.03], sat: 1.12, vignette: 0.3, vigColor: [0.2, 0.06, 0.18],
        outlineTint: [0.18, 0.05, 0.16], outlineMix: 0.38, outlineDark: 0.42, highlight: 0.55, concave: 0.15,
        foam: [1.0, 0.82, 0.66], foamMix: 0.8, crestMix: 0 }
    },
    night: {
      top: 0x03101f, horizon: 0x142048, fogNear: 60, fogFar: 640,
      hemiSky: 0x5a74c0, hemiGround: 0x181c40, hemiI: 0.6, sun: 0x9ab4f0, sunI: 0.4, sunAz: 300, sunEl: 48,
      night: 1, storm: 0, lamp: 0xffa040, water: 0x22336a, reflect: 0.14, glint: 0x428ea4,
      grade: { mul: [0.84, 0.92, 1.12], add: [0.0, 0.008, 0.03], sat: 0.95, vignette: 0.5, vigColor: [0.01, 0.015, 0.06],
        outlineTint: [0.015, 0.02, 0.08], outlineMix: 0.42, outlineDark: 0.4, highlight: 0.5, concave: 0.18,
        foam: [0.5, 0.68, 0.86], foamMix: 0.7, crestMix: 0 }
    },
    storm: {
      top: 0x1b2529, horizon: 0x4f6266, fogNear: 10, fogFar: 420,
      hemiSky: 0xa2b6ba, hemiGround: 0x1e282c, hemiI: 0.66, sun: 0xc4d2d6, sunI: 0.22, sunAz: 330, sunEl: 66,
      night: 0.55, storm: 1, lamp: 0xffb050, water: 0x4f6266, reflect: 0.36, glint: 0x7d949a,
      grade: { mul: [0.9, 0.98, 0.98], add: [0.004, 0.014, 0.014], sat: 0.72, vignette: 0.36, vigColor: [0.03, 0.06, 0.07],
        outlineTint: [0.03, 0.06, 0.07], outlineMix: 0.42, outlineDark: 0.42, highlight: 0.42, concave: 0.15,
        foam: [0.8, 0.9, 0.88], foamMix: 0.85, crestMix: 0 }
    }
  };

  const rgb = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
  const toHex = (c) => ((Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255)) >>> 0;
  const COLOR_KEYS = ['top', 'horizon', 'hemiSky', 'hemiGround', 'sun', 'lamp', 'water', 'glint'];

  function compile(p) {
    const o = JSON.parse(JSON.stringify(p));
    COLOR_KEYS.forEach((k) => { o[k] = rgb(p[k]); });
    return o;
  }
  const PRESETS = {};
  Object.keys(RAW).forEach((k) => { PRESETS[k] = compile(RAW[k]); });

  function mixVal(a, b, k) {
    if (typeof a === 'number') return a + (b - a) * k;
    if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * k);
    if (a && typeof a === 'object') { const o = {}; for (const key in a) o[key] = mixVal(a[key], b[key], k); return o; }
    return k < 0.5 ? a : b;
  }
  const lerpAngle = (a, b, k) => { const d = ((((b - a) % 360) + 540) % 360) - 180; return a + d * k; };
  function mixPreset(a, b, k) {
    const o = mixVal(a, b, k);
    o.sunAz = lerpAngle(a.sunAz, b.sunAz, k);
    return o;
  }

  // ---- light pool ----
  const pool = [];   // { light, kind, used, o, base }
  function makePool() {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb45a, 0, 16, 2);
      l.castShadow = false;
      scene.add(l);
      pool.push({ light: l, kind: 'point', used: false, o: null });
    }
    const s = new THREE.SpotLight(0xfff0c0, 0, 110, 0.2, 0.55, 1);
    s.castShadow = false;
    scene.add(s, s.target);
    pool.push({ light: s, kind: 'spot', used: false, o: null });
  }

  function addLight(o) {
    if (!sun) return null;
    o = Object.assign({ type: 'point', color: null, intensity: 1.4, distance: 16, decay: 2, night: true, flicker: 0, seed: 1 }, o || {});
    const slot = pool.find((s) => !s.used && s.kind === o.type);
    if (!slot) return null;
    slot.used = true;
    slot.o = o;
    const l = slot.light;
    if (o.color != null) l.color.set(o.color); else l.color.setRGB(cur.lamp[0], cur.lamp[1], cur.lamp[2]);
    l.distance = o.distance; l.decay = o.decay;
    if (o.position) l.position.set(o.position.x, o.position.y, o.position.z);
    if (o.angle != null && l.isSpotLight) l.angle = o.angle;
    if (o.target && l.isSpotLight) l.target.position.set(o.target.x, o.target.y, o.target.z);
    l.intensity = 0;
    const handle = {
      light: l,
      set(p) {
        if (!slot.used || !p) return handle;
        if (p.position) l.position.set(p.position.x, p.position.y, p.position.z);
        if (p.target && l.isSpotLight) l.target.position.set(p.target.x, p.target.y, p.target.z);
        if (p.color != null) { l.color.set(p.color); o.color = p.color; }
        if (p.intensity != null) o.intensity = p.intensity;
        if (p.distance != null) l.distance = p.distance;
        return handle;
      },
      remove() { if (!slot.used) return; slot.used = false; slot.o = null; l.intensity = 0; }
    };
    return handle;
  }

  // ---- lighthouse beam (uses the spot slot) ----
  let beam = null;
  function lighthouse(pos, o) {
    if (!sun || beam) return null;
    o = Object.assign({ length: 70, radius: 7.5, speed: 0.55, phase: 0, tilt: 0.1, color: 0xfff0b8, opacity: 0.34 }, o || {});
    const spot = addLight({ type: 'spot', color: o.color, intensity: 3.2, distance: o.length * 1.6, decay: 1, angle: 0.2, night: true, position: pos });
    const geo = new THREE.ConeGeometry(o.radius, o.length, 14, 1, true);
    geo.translate(0, -o.length / 2, 0);
    geo.rotateZ(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: o.color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor
    });
    const cone = new THREE.Mesh(geo, mat);
    cone.rotation.z = -o.tilt;
    cone.renderOrder = 10;
    cone.frustumCulled = false;
    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    group.add(cone);
    group.name = 'lighthouse-beam';
    scene.add(group);
    beam = { group, cone, mat, spot, o, pos: { x: pos.x, y: pos.y, z: pos.z } };
    updateBeam(GLT.clock.now());
    return {
      group,
      remove() {
        if (!beam) return;
        scene.remove(beam.group); geo.dispose(); mat.dispose();
        if (beam.spot) beam.spot.remove();
        beam = null;
      }
    };
  }

  function updateBeam(t) {
    if (!beam) return;
    const nf = cur.night;
    const on = Math.max(0, Math.min(1, (nf - 0.3) / 0.5));
    const a = beam.o.phase + t * beam.o.speed;
    beam.group.rotation.y = a;
    beam.mat.opacity = beam.o.opacity * on * (1 + cur.storm * 0.3);
    beam.group.visible = on > 0.01;
    if (beam.spot) {
      const L = beam.o.length * 0.8;
      const dx = Math.cos(a), dz = -Math.sin(a);
      beam.spot.set({ target: { x: beam.pos.x + dx * L, y: 0, z: beam.pos.z + dz * L } });
    }
  }

  // ---- presets -> scene ----
  function applyPreset() {
    const p = cur;
    hemi.color.setRGB(p.hemiSky[0], p.hemiSky[1], p.hemiSky[2]);
    hemi.groundColor.setRGB(p.hemiGround[0], p.hemiGround[1], p.hemiGround[2]);
    hemi.intensity = p.hemiI + flashI * 1.1;
    sun.color.setRGB(p.sun[0], p.sun[1], p.sun[2]);
    sun.intensity = p.sunI;
    const az = (p.sunAz * Math.PI) / 180, el = (p.sunEl * Math.PI) / 180;
    const R = 320;
    sun.position.set(Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, Math.cos(az) * Math.cos(el) * R);
    sun.target.position.set(0, 0, 0);
    sun.target.updateMatrixWorld();
    if (!(scene.background && scene.background.isColor)) scene.background = new THREE.Color();
    scene.background.setRGB(p.horizon[0], p.horizon[1], p.horizon[2]);
    const D = GLT.camera && GLT.camera.distance ? GLT.camera.distance() : 600;
    fog.color.setRGB(p.horizon[0], p.horizon[1], p.horizon[2]);
    fog.near = D + p.fogNear; fog.far = D + p.fogFar;
    if (GLT.renderer && GLT.renderer.setGrade) {
      const g = p.grade;
      if (flashI > 0) {
        const f = flashI * 0.08;
        GLT.renderer.setGrade(Object.assign({}, g, { add: [g.add[0] + f, g.add[1] + f, g.add[2] + f * 1.2] }));
      } else GLT.renderer.setGrade(g);
    }
  }

  function updateLights(t) {
    const nf = cur.night;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (!s.used || !s.o) continue;
      if (beam && beam.spot && s.light === beam.spot.light) {
        s.light.intensity = s.o.intensity * Math.max(0, Math.min(1, (nf - 0.3) / 0.5));
        continue;
      }
      let k = s.o.night ? Math.max(0, Math.min(1, nf * 1.25)) : 1;
      if (s.o.flicker > 0) {
        const ph = s.o.seed * 7.31;
        const w = Math.sin(t * 13.1 + ph) * 0.5 + Math.sin(t * 7.7 + ph * 1.7) * 0.3 + Math.sin(t * 23.3 + ph * 0.3) * 0.2;
        k *= 1 + w * 0.35 * s.o.flicker;
      }
      if (s.o.color == null) s.light.color.setRGB(cur.lamp[0], cur.lamp[1], cur.lamp[2]);
      s.light.intensity = Math.max(0, s.o.intensity * k);
    }
  }

  function init() {
    if (hemi) return true;
    if (typeof THREE === 'undefined' || !GLT.scene.root()) return false;
    scene = GLT.scene.root();
    hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.6);
    sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 760;
    sc.updateProjectionMatrix();
    const cssW = GLT.renderer && GLT.renderer.size ? GLT.renderer.size().cssW : (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const ms = cssW < 720 ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(hemi, sun, sun.target);
    fog = new THREE.Fog(0x8cbff0, 650, 1400);
    scene.fog = fog;
    cur = JSON.parse(JSON.stringify(PRESETS[tod]));
    makePool();
    applyPreset();
    GLT.clock.onFrame(update, 50);
    return true;
  }

  function setTod(next, o) {
    const prev = tod;
    tod = PRESETS[next] ? next : 'day';
    if (!hemi) return;
    const instant = (o && o.instant) || !GLT.clock.running || !GLT.clock.running() || GLT.clock.frozen() ||
      (GLT.prefs && GLT.prefs.reducedMotion && GLT.prefs.reducedMotion());
    if (instant) { cur = JSON.parse(JSON.stringify(PRESETS[tod])); toP = null; blendK = 1; applyPreset(); }
    else { fromP = JSON.parse(JSON.stringify(cur)); toP = PRESETS[tod]; blendK = 0; }
    if (GLT.events && prev !== tod) GLT.events.emit('tod:changed', { tod });
    else if (GLT.events && instant) GLT.events.emit('tod:changed', { tod });
  }

  function update(dt, t, realDt) {
    if (!hemi) return;
    let dirty = false;
    if (toP) {
      blendK = Math.min(1, blendK + (realDt || 0) / TOD_S);
      const k = blendK * blendK * (3 - 2 * blendK);
      cur = mixPreset(fromP, toP, k);
      if (blendK >= 1) { cur = JSON.parse(JSON.stringify(toP)); toP = null; }
      dirty = true;
    }
    if (flashI > 0) {
      flashI = Math.max(0, flashI - (realDt || 0) * flashDecay);
      dirty = true;
    }
    if (dirty) applyPreset();
    updateLights(t);
    updateBeam(t);
  }

  function flash(intensity, ms) {
    flashI = intensity == null ? 1 : intensity;
    flashDecay = flashI / Math.max(0.05, (ms == null ? 180 : ms) / 1000);
    if (hemi) applyPreset();
  }

  // Irradiance (per channel) on an unshadowed, up-facing Lambert surface under the current preset: hemisphere sky
  // + sun * sin(elevation). three r128 Lambert cancels its PI factors, so lit colour = albedo * this.
  function sunlit(out) {
    const p = cur || PRESETS[tod];
    const s = Math.max(0, Math.sin((p.sunEl * Math.PI) / 180)) * p.sunI;
    const h = p.hemiI + flashI * 1.1;
    out = out || [0, 0, 0];
    for (let i = 0; i < 3; i++) out[i] = p.hemiSky[i] * h + p.sun[i] * s;
    return out;
  }

  // Albedo that renders as exactly `color` (hex/role) on a sunlit up-facing Lambert surface AFTER the post grade, so
  // large flat areas (water) land on a palette entry and snap flat instead of dithering. Shadows and point lights
  // still modulate it. Returns [r, g, b] (may exceed 1 at night; Lambert does not clamp until output).
  const tmpE = [0, 0, 0];
  function albedoFor(color, out) {
    const n = typeof color === 'number' ? color : (String(color).charAt(0) === '#' ? parseInt(String(color).slice(1), 16) : GLT.palette.get(color));
    const P = rgb(n);
    const p = cur || PRESETS[tod];
    const g = p.grade;
    const fl = flashI * 0.08;
    const l = 0.299 * P[0] + 0.587 * P[1] + 0.114 * P[2];
    sunlit(tmpE);
    out = out || [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const pre = l + (P[i] - l) / (g.sat || 1);
      const add = g.add[i] + (i === 2 ? fl * 1.2 : fl);
      out[i] = Math.max(0, (pre - add) / (g.mul[i] || 1)) / Math.max(0.04, tmpE[i]);
    }
    return out;
  }

  GLT.lighting = {
    init,
    setTod,
    tod() { return tod; },
    sun() { return sun; },
    nightFactor() { return cur ? cur.night : PRESETS[tod].night; },
    stormFactor() { return cur ? cur.storm : PRESETS[tod].storm; },
    flash,
    skyColors() { const p = cur || PRESETS[tod]; return { top: toHex(p.top), horizon: toHex(p.horizon) }; },
    // additions (render area)
    hemi() { return hemi; },
    addLight,
    lighthouse,
    lampColor() { const p = cur || PRESETS[tod]; return toHex(p.lamp); },
    // Sky reflection for water materials: mix the water albedo toward `color` by `k` (blends with tod changes).
    // The world's ocean/plates can use it so every water surface carries the same sunset/moonlight/storm tint.
    reflection() {
      const p = cur || PRESETS[tod];
      return { color: toHex(p.water), r: p.water[0], g: p.water[1], b: p.water[2], k: p.reflect, glint: toHex(p.glint) };
    },
    sunlit,
    albedoFor,
    sunDir() { const p = cur || PRESETS[tod]; const az = (p.sunAz * Math.PI) / 180, el = (p.sunEl * Math.PI) / 180; return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) }; },
    presets() { return RAW; },
    blending() { return !!toP; },
    freeSlots() { return pool.filter((s) => !s.used).map((s) => s.kind); }
  };
})();
