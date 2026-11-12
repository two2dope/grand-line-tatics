/* Sea bridge: the game's render entry points on top of our render + world (stage 3 of SCOPE-V2).
 *
 *   GLT.platesLighting.createPlatesLightingSystem(renderer, scene, opts) -> { camera, cameraController, seaPlates,
 *       update, setEnvironment, setCameraPreset, setBoardSize, resize, triggerScreenShake }
 *   GLT.paletteShader.createPostPipeline(renderer, scene, camera, opts) -> { renderTarget, render, setSize,
 *       setPixelSize, setOutlines, setDither, setPaletteSnap }
 *   GLT.backdropFx.createBackdropRing(scene, opts) -> { update, updateDenDenBoard, triggerCrowdCheer, setLogPoseTarget,
 *       setDollsHouseLiftEnabled, setCameraMode, setCeremonyActive }
 *
 * Units. The game works in its own units (cell = 2, water surface y = 0, plates at x = -/+ offset); our world is in
 * metres (cell = 4 m, water surface y = 8, plates at x = -/+34, src/sea/layout.js). The whole sea (GLT.sea modules)
 * lives in one group, `seaRoot`, scaled by 0.5 and lowered by 4, inside the game's THREE.Scene. The ortho camera is a
 * child of seaRoot, so every sea module keeps working in metres (view space, fog, depth outlines, pixel snap), while
 * the game's own objects (ships, FX) and its raycaster stay in game units through matrixWorld. cellToWorld /
 * raycastCell convert between the two, so picking is exact (plane y = PLATE_Y, GLT.sea.layout.worldToCell).
 * Plates are positional: index 0 = the -X plate ('own' in our layout), 1 = the +X plate ('enemy').
 * One sea per page (our modules are singletons): a second create returns the same system. No Math.random. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const SCALE = 0.5;                 // metres -> game units (game cell 2 / our cell 4)
  const PLATES = ['own', 'enemy'];
  const plateOf = (i) => (i === 1 ? 'enemy' : 'own');
  const indexOf = (p) => (p === 'enemy' ? 1 : 0);
  const CREW = { straw_hats: 'strawHat', whitebeard: 'whitebeard', red_haired: 'redHair', heart: 'heart', blackbeard: 'blackbeard', marines: 'marine' };
  const SEA_OF = { mar_calmo: 'calmo', grand_line: 'grandline', novo_mundo: 'novomundo', tempestade: 'tempestade', marineford: 'calmo' };
  const SEA_OF_TOD = { day: 'calmo', dusk: 'grandline', night: 'novomundo', storm: 'tempestade' };
  const BIOME_OF = { mar_calmo: 'loguetown', grand_line: 'alabasta', novo_mundo: 'skypiea', tempestade: 'water7' };
  const BIOME_OF_TOD = { day: 'loguetown', dusk: 'alabasta', night: 'skypiea', storm: 'water7' };
  const MODE_OF = { duas_aguas: 'both', minhas_aguas: 'own', mira_inimiga: 'aim', panorama: 'panorama', ceremony: 'ceremony', cerimonia: 'ceremony' };
  const MARK_OF = { water: 1, hit: 2, sunk: 3, revealed: 4, fog: 5 };

  let W = null;                      // the one sea world

  function S() { return GLT.sea; }

  function toGame(p, out) {
    out = out || new THREE.Vector3();
    return out.set(p.x * SCALE, (p.y - S().C.PLATE_Y) * SCALE, p.z * SCALE);
  }
  function toSea(v) {
    return { x: v.x / SCALE, y: v.y / SCALE + S().C.PLATE_Y, z: v.z / SCALE };
  }

  function canvasSize(renderer) {
    const v = new THREE.Vector2();
    if (renderer && renderer.getSize) renderer.getSize(v);
    return { w: Math.max(1, v.x || 1), h: Math.max(1, v.y || 1) };
  }

  function isFile() {
    return typeof location !== 'undefined' && location.protocol === 'file:';
  }

  // ------------------------------------------------------------------ crews / colours from the game state
  function matchCrews() {
    const ui = GLT.ui;
    const mc = ui && ui.matchConfig;
    let a = (mc && CREW[mc.crewId]) || 'strawHat', b = (mc && CREW[mc.enemyCrewId]) || 'marine';
    let guest = false;
    try { guest = !!(ui && ui.getMyPlatesIndices && ui.getMyPlatesIndices().isGuest); } catch (e) { guest = false; }
    if (guest) { const t = a; a = b; b = t; }
    return [a, b];
  }

  function rebuildCrowd() {
    const s = S();
    if (!W || !s.crowd) return;
    const crews = matchCrews();
    const cols = [W.colors[0] || s.data.crews[crews[0]].colors.primary, W.colors[1] || s.data.crews[crews[1]].colors.primary];
    const key = crews.join(',') + '|' + cols.join(',') + '|' + s.layout.size();
    if (key === W.crowdKey) return;
    W.crowdKey = key;
    s.crowd.build(crews, cols);
    if (s.props) s.events.emit('match:created', { crews, colors: cols, local: 0 });
  }

  // ------------------------------------------------------------------ sky biome (pilot sky art, http only)
  function buildBiomeSky() {
    const geo = new THREE.CylinderGeometry(660, 660, 420, 48, 1, true);
    geo.translate(0, 190, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, depthWrite: false, fog: false });
    S().renderer.markMaterial(mat, 'none');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sky-biome';
    mesh.renderOrder = -9;
    mesh.frustumCulled = false;
    mesh.visible = false;
    return mesh;
  }

  function setBiome(key) {
    if (!W || !key || key === W.biome) return;
    W.biome = key;
    if (isFile()) return;              // file:// images taint WebGL textures (the procedural sky stays)
    if (W.biomeCache[key]) { applyBiome(key); return; }
    try {
      new THREE.TextureLoader().load('assets/backgrounds/sky-biome-' + key + '.jpg', (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(2, 1);
        tex.magFilter = THREE.NearestFilter;
        W.biomeCache[key] = tex;
        if (W.biome === key) applyBiome(key);
      }, undefined, () => { /* offline: keep the procedural sky */ });
    } catch (e) { /* ignore */ }
  }
  function applyBiome(key) {
    const m = W.biomeSky;
    m.material.map = W.biomeCache[key];
    m.material.needsUpdate = true;
    m.visible = true;
    tintBiome();
  }
  // the art is tinted toward the time of day so night/storm/dusk stay cohesive with the lighting
  function tintBiome() {
    if (!W || !W.biomeSky.visible) return;
    const tod = S().lighting.tod();
    W.biomeSky.material.color.setHex(tod === 'night' ? 0x4a5a9a : tod === 'storm' ? 0x8a969a : tod === 'dusk' ? 0xf0b0a0 : 0xffffff);
  }

  // ------------------------------------------------------------------ world
  function createWorld(renderer, scene, opts) {
    const s = S();
    const C = s.C;
    const sz = canvasSize(renderer);
    const seaRoot = new THREE.Group();
    seaRoot.name = 'glt-sea';
    seaRoot.scale.setScalar(SCALE);
    seaRoot.position.set(0, -C.PLATE_Y * SCALE, 0);
    scene.add(seaRoot);
    seaRoot.updateMatrixWorld(true);

    s.clock.drive();
    s.scene.adopt(seaRoot);
    s.renderer.attach(renderer, { pixelSize: opts.pixelSize || 2, width: sz.w, height: sz.h });
    const n = [8, 10, 12].indexOf(opts.boardSize) >= 0 ? opts.boardSize : 10;
    s.layout.setSize(n);
    s.camera.init({ parent: seaRoot, input: false, shift: 0.07 });   // the game's HUD covers the top of the canvas
    s.lighting.init();
    // a HemisphereLight's direction is its world position: seaRoot's offset (y - 4) would turn it upside down
    const hemi = s.lighting.hemi();
    if (hemi) hemi.position.set(0, 1000, 0);
    const sun = s.lighting.sun();
    if (sun) {                          // the shadow frustum lives in game units: keep its metre coverage
      const sc = sun.shadow.camera;
      sc.left *= SCALE; sc.right *= SCALE; sc.top *= SCALE; sc.bottom *= SCALE;
      sc.updateProjectionMatrix();
    }
    s.ocean.init();
    s.plates.init();
    s.backdrop.init();
    s.props.init();
    s.crowd.init();

    W = {
      renderer, scene, seaRoot, colors: [null, null], crowdKey: null, biome: null, biomeCache: {},
      biomeSky: buildBiomeSky(), shake: { t: 0, dur: 0, i: 0 }, board: { tot: [0, 0] }
    };
    seaRoot.add(W.biomeSky);
    s.camera.setMode('both', { instant: true });
    rebuildCrowd();
    return W;
  }

  // ------------------------------------------------------------------ seaPlates (the game's plate API)
  function makeSeaPlates() {
    const sp = {
      cellSize: 2,
      shotMarkers: {},
      get boardSize() { return S().layout.size(); },

      cellToWorld(i, r, c) { return toGame(S().layout.cellToWorld(plateOf(i), r, c)); },

      worldToCell(i, wp) {
        const p = toSea(wp);
        const cell = S().layout.worldToCell(plateOf(i), p.x, p.z);
        return cell ? { r: cell.r, c: cell.c, plateIndex: i } : null;
      },

      raycastCell(raycaster) {
        const ray = raycaster && raycaster.ray;
        if (!ray) return null;
        const o = toSea(ray.origin);
        const d = ray.direction;
        const hit = S().plates.pickRay(o, { x: d.x, y: d.y, z: d.z });
        if (!hit || !hit.plate) return null;
        return { plateIndex: indexOf(hit.plate), r: hit.r, c: hit.c, point: toGame(hit.point) };
      },

      setHover(i, r, c) {
        const n = S().layout.size();
        const ok = r != null && c != null && r >= 0 && c >= 0 && r < n && c < n;
        S().events.emit('cell:hover', ok ? { plate: plateOf(i), r, c } : null);
      },

      setSelection(i, r, c) {
        const n = S().layout.size();
        if (r == null || c == null || r < 0 || c < 0 || r >= n || c >= n) S().plates.setCursor(null);
        else S().plates.setCursor(plateOf(i), r, c, 'selected');
      },

      showValidityGhost(i, r, c, length, horizontal, isValid) {
        const cells = [];
        for (let q = 0; q < length; q++) cells.push({ plate: plateOf(i), r: horizontal ? r : r + q, c: horizontal ? c + q : c });
        S().plates.setGhostCells(cells, !!isValid);
      },
      hideValidityGhost() { S().plates.setGhostCells(null); },
      hideGhost() { S().plates.setGhostCells(null); },

      addShotMarker(i, r, c, type, options) {
        const mark = MARK_OF[type];
        if (!mark) return;
        const key = i + '_' + r + '_' + c;
        S().plates.setMark(plateOf(i), r, c, mark, { animate: true });
        sp.shotMarkers[key] = {
          plateIndex: i, r, c, type,
          turnsLeft: options && typeof options.turnsLeft === 'number' ? options.turnsLeft : 2
        };
      },

      updateFogMarkers() {
        Object.keys(sp.shotMarkers).forEach((key) => {
          const m = sp.shotMarkers[key];
          if (m.type !== 'fog') return;
          m.turnsLeft--;
          if (m.turnsLeft <= 0) { S().plates.setMark(plateOf(m.plateIndex), m.r, m.c, 0); delete sp.shotMarkers[key]; }
        });
      },

      clearShotMarkers() {
        S().plates.clearMarks();
        sp.shotMarkers = {};
        if (S().shotFx) S().shotFx.reset();       // a new match: no burning cells, no balls left over
      },

      setShipFoamCells(i, cells) {
        S().plates.setFoam(plateOf(i), (cells || []).map((cl) => ({ r: cl.r, c: cl.c, dir: 'h', len: 1 })));
      },

      setPlateOwnerColors(c0, c1) {
        if (!W) return;
        W.colors = [c0 || W.colors[0], c1 || W.colors[1]];
        S().plates.setColors({ own: W.colors[0], enemy: W.colors[1] });
        rebuildCrowd();
      }
    };
    return sp;
  }

  // ------------------------------------------------------------------ camera controller (game input -> GLT.sea.camera)
  function makeCameraController() {
    const cc = {
      get camera() { return S().camera.three(); },
      get transitioning() { return S().camera.moving(); },
      get azimuth() { return S().camera.get().azimuth * Math.PI / 180; },
      get elevation() { return S().camera.get().elevation * Math.PI / 180; },
      get zoom() { return S().camera.get().zoom; },
      get currentPresetName() { return W ? W.preset : 'duas_aguas'; },
      setPreset(name, durationMs) {
        const mode = MODE_OF[name];
        if (!mode) return;
        if (W) W.preset = name;
        const o = { instant: durationMs === 0 };
        // Only the ceremony names a plate; 'own' and 'aim' frame their default plate (aim = enemy).
        if (mode === 'ceremony') o.plate = (W && W.ceremonyPlate) || 'own';
        S().camera.setMode(mode, o);
      },
      orbit(dAz, dEl) {
        const g = S().camera.get();
        S().camera.set({ azimuth: g.azimuth + (dAz || 0) * 180 / Math.PI, elevation: g.elevation + (dEl || 0) * 180 / Math.PI }, { instant: true });
      },
      zoomBy(dz) {
        const g = S().camera.get();
        S().camera.set({ zoom: g.zoom * Math.exp(dz || 0) }, { instant: true });
      },
      triggerShake(intensity, durationSec) {
        if (!W) return;
        const sh = W.shake;
        sh.i = Math.min(2.5, (sh.t > 0 ? sh.i : 0) + (typeof intensity === 'number' ? intensity : 0.5));
        sh.dur = Math.max(0.1, typeof durationSec === 'number' ? durationSec : 0.35);
        sh.t = sh.dur;
        sh.still = !!S().prefs.reducedMotion();
      },
      update() {},
      resize(w, h) { S().renderer.setViewport(w, h); }
    };
    return cc;
  }

  // Shake: offset along the camera's right/up axes in whole low-res texels (the image jumps, it never smears).
  function applyShake(dt) {
    const sh = W.shake;
    if (!(sh.t > 0)) return;
    sh.t = Math.max(0, sh.t - dt);
    if (sh.still) return;                    // prefers-reduced-motion: no camera shake (read once per trigger)
    const k = sh.dur > 0 ? sh.t / sh.dur : 0;
    const a = sh.i * k / SCALE;          // game units -> metres
    const cam = S().camera.three();
    const wpp = S().camera.worldPerPixel() || 0.2;
    const ox = Math.round((Math.sin(sh.t * 36) * a) / wpp) * wpp;
    const oy = Math.round((Math.cos(sh.t * 46.8) * a * 0.7) / wpp) * wpp;
    const e = cam.matrix.elements;
    cam.position.x += e[0] * ox + e[4] * oy;
    cam.position.y += e[1] * ox + e[5] * oy;
    cam.position.z += e[2] * ox + e[6] * oy;
    cam.updateMatrixWorld();
  }

  function syncSceneEnv() {
    const root = W.seaRoot;
    if (root.fog && W.scene.fog !== root.fog) W.scene.fog = root.fog;
    if (root.background && W.scene.background !== root.background) W.scene.background = root.background;
  }

  // ------------------------------------------------------------------ GLT.platesLighting
  function createPlatesLightingSystem(renderer, scene, options) {
    let r = renderer, s = scene, opts = options || {};
    if (renderer && !scene && (renderer.scene || renderer.renderer)) { opts = renderer; r = renderer.renderer; s = renderer.scene; }
    if (typeof THREE === 'undefined' || !GLT.sea || !r || !s) throw new Error('GLT.platesLighting: THREE/renderer/scene ausentes');
    if (W && W.system) return W.system;
    createWorld(r, s, opts);
    const seaPlates = makeSeaPlates();
    const cameraController = makeCameraController();
    W.preset = 'duas_aguas';
    const system = {
      cameraController,
      get camera() { return S().camera.three(); },
      seaPlates,
      envLighting: { setEnvironment(envId, ms, biome) { system.setEnvironment(envId, ms, biome); } },
      update(deltaSec, timeSec) {
        const dt = Math.max(0, Math.min(0.1, deltaSec || 0));
        S().clock.tick(dt, dt);
        applyShake(dt);
        tintBiome();
      },
      setEnvironment(envId, durationMs, biomeKey) {
        const tod = ['day', 'dusk', 'night', 'storm'].indexOf(envId) >= 0 ? envId : 'day';
        S().lighting.setTod(tod, { instant: !durationMs });
        S().ocean.setSea(SEA_OF[biomeKey] || SEA_OF_TOD[tod]);
        if (S().weather) S().weather.set({ tod, sea: SEA_OF[biomeKey] || SEA_OF_TOD[tod] });   // rain, spray, lightning
        setBiome(BIOME_OF[biomeKey] || (biomeKey && !SEA_OF[biomeKey] ? biomeKey : BIOME_OF_TOD[tod]));
      },
      setCameraPreset(name, durationMs) { cameraController.setPreset(name, durationMs); },
      setBoardSize(size) {
        if (size !== 8 && size !== 10 && size !== 12) return;
        S().layout.setSize(size);
        W.crowdKey = null;
        rebuildCrowd();
      },
      resize(width, height) { S().renderer.setViewport(width, height); },
      // the pilot's signature says ms, but every caller in ui.js passes seconds (0.32, 0.55, 0.65): accept both
      triggerScreenShake(intensity, duration) {
        const d = typeof duration === 'number' ? (duration > 5 ? duration / 1000 : duration) : 0.35;
        cameraController.triggerShake(intensity, d);
      },
      toGame, toSea
    };
    W.system = system;
    return system;
  }

  // ------------------------------------------------------------------ GLT.paletteShader
  function createPostPipeline(renderer, scene, camera, options) {
    let r = renderer, s = scene, opts = options || {};
    if (renderer && !scene && (renderer.renderer || renderer.scene)) { opts = renderer; r = renderer.renderer; s = renderer.scene; }
    if (typeof THREE === 'undefined' || !GLT.sea || !r) throw new Error('GLT.paletteShader: THREE/renderer ausentes');
    const R = S().renderer;
    if (!R.hosted()) {
      const sz = canvasSize(r);
      R.attach(r, { pixelSize: opts.pixelSize || 2, width: sz.w, height: sz.h });
    }
    R.setPixelSize(opts.pixelSize || 2);
    R.setPost({ outlines: opts.outlines !== false, dither: opts.dither !== false, raw: opts.paletteSnap === false });
    const pipe = {
      pixelSize: Math.round(opts.pixelSize || 2),
      get renderTarget() { return R.target(); },
      setSize(w, h) { R.setViewport(w, h); },
      resize(w, h) { R.setViewport(w, h); },
      setPixelSize(v) { pipe.pixelSize = Math.max(1, Math.min(4, Math.round(v) || 2)); R.setPixelSize(pipe.pixelSize); },
      setOutlines(b) { R.setPost({ outlines: !!b }); },
      setDither(b) { R.setPost({ dither: !!b }); },
      setPaletteSnap(b) { R.setPost({ raw: !b }); },
      render() {
        const cam = S().camera.three() || camera;
        if (W) syncSceneEnv();
        R.renderHosted(s || (W && W.scene), cam);
      },
      dispose() {}
    };
    return pipe;
  }

  // ------------------------------------------------------------------ GLT.backdropFx.createBackdropRing
  function createBackdropRing(scene, options) {
    const o = options || {};
    const noop = () => {};
    if (!W) {
      return { isMock: true, update: noop, updateDenDenBoard: noop, triggerCrowdCheer: noop, setLogPoseTarget: noop,
        setDollsHouseLiftEnabled: noop, isDollsHouseLiftEnabled: () => false, setCameraMode: noop, setCeremonyActive: noop };
    }
    const s = S();
    let lift = o.dollsHouseLift !== false;
    s.prefs.set('lift', lift);
    s.backdrop.setLift(lift);
    let ceremony = false;
    return {
      update: noop,                       // the sea ticks inside platesSystem.update
      updateDenDenBoard(stats) {
        if (!stats) return;
        const b = W.board;
        const rem = [stats.p1ShipsRemaining, stats.p2ShipsRemaining].map((v) => (typeof v === 'number' ? v : 0));
        if (!(stats.p1Shots || stats.p2Shots)) b.tot = [0, 0];
        b.tot = [Math.max(b.tot[0], rem[0]), Math.max(b.tot[1], rem[1])];
        const d = {
          hits: [stats.p1Hits || 0, stats.p2Hits || 0],
          sunk: [Math.max(0, b.tot[1] - rem[1]), Math.max(0, b.tot[0] - rem[0])],
          timer: typeof stats.turnTimeRemaining === 'number' && stats.turnTimeRemaining > 0 ? stats.turnTimeRemaining : null
        };
        if (stats.lastShotCall) d.lastCall = String(stats.lastShotCall);
        s.props.setBoard('big', d);
        s.props.setBoard('small', d);
      },
      triggerCrowdCheer(intensity) {
        s.crowd.react('cheer', 'both', Math.min(1, typeof intensity === 'number' ? intensity : 1));
      },
      setLogPoseTarget(pos) {
        if (!pos) return;
        const p = toSea(pos);
        const plate = s.layout.plateAt(p.x, p.z);
        const cell = plate ? s.layout.worldToCell(plate, p.x, p.z) : null;
        if (cell && plate === 'enemy') s.events.emit('hint:used', { r: cell.r, c: cell.c });
      },
      setDollsHouseLiftEnabled(enabled) { lift = !!enabled; s.prefs.set('lift', lift); s.backdrop.setLift(lift); },
      isDollsHouseLiftEnabled() { return lift; },
      setCameraMode: noop,                // the camera mode follows platesSystem.setCameraPreset
      // info (optional): { winnerPlate: 0|1, crewId (game crew id), fireworks: false to skip them (local defeat) }.
      // ceremony:start makes GLT.sea.fireworks hoist the winner's Jolly Roger on its plate and start the show.
      setCeremonyActive(active, info) {
        active = !!active;
        if (active === ceremony) return;
        ceremony = active;
        if (active) {
          const i = info && (info.winnerPlate === 0 || info.winnerPlate === 1) ? info.winnerPlate : 0;
          const plate = plateOf(i);
          W.ceremonyPlate = plate;
          const crew = (info && CREW[info.crewId]) || matchCrews()[i];
          s.events.emit('ceremony:start', { winner: plate, plate, crew, fireworks: !(info && info.fireworks === false) });
          s.crowd.react('jump', 'both', 1);
        } else {
          W.ceremonyPlate = null;
          s.events.emit('ceremony:end', {});
        }
      }
    };
  }

  // shared with src/sea/fx-bridge.js (GLT.backdropFx.createFxSystem)
  GLT.seaBridge = { toGame, toSea, plateOf, indexOf, CREW, matchCrews, world: () => W };

  GLT.platesLighting = { createPlatesLightingSystem };
  GLT.paletteShader = { createPostPipeline };
  GLT.backdropFx = GLT.backdropFx || {};
  GLT.backdropFx.createBackdropRing = createBackdropRing;
})();
