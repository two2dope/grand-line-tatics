/* GLT.app: boot, wiring, screen flow, demo runner. Area: app. Contract: ARCHITECTURE.md §1, §8.1, §13.
 * BOOTSTRAP (architect): working boot order + demo wrapper + 'app.scene' demo. The game flow (drivers, screens,
 * ui:* intent routing, ceremony, PvP UI) is the app builder's job; keep the public API.
 *
 * Demo mode cooperates with the build harness (tools/harness*.js): the harness prelude sets GLT.params and GLT.demos,
 * and its runner calls GLT.demos[GLT.params.demo](harnessCtx) on DOMContentLoaded, then sets window.GLT_READY when the
 * demo resolves. Our DOMContentLoaded listener is registered earlier (this script runs before harness-run.js), so it
 * wraps the requested demo first: the wrapper prepares the 3D core and the DemoCtx (§13), runs the demo, applies
 * URL camera params, simulates/freezes ?t= and waits 3 frames before resolving. Without the harness we run it ourselves. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let booted = false;
  let driver = null;
  let net = { available: false, reason: 'no_runtime', canWrite: null };
  let webgl = false;

  function rethrow(err) { setTimeout(() => { throw err; }, 0); }

  // Calls an optional module function; a throwing init must not abort boot, but must still surface.
  function call(ns, fn) {
    const args = Array.prototype.slice.call(arguments, 2);
    const mod = GLT[ns];
    if (!mod || typeof mod[fn] !== 'function') return undefined;
    try { return mod[fn].apply(mod, args); } catch (err) { rethrow(err); return undefined; }
  }

  function rootEl() {
    let root = document.getElementById('app') || document.getElementById('glt');
    if (!root) { root = document.createElement('div'); root.id = 'app'; document.body.appendChild(root); }
    return root;
  }

  function init3d(host) {
    if (!GLT.renderer.init(host)) return false;
    GLT.scene.init();
    GLT.camera.init();
    GLT.lighting.init();
    GLT.picking.init();
    return true;
  }

  function initVisuals() {
    ['ocean', 'plates', 'backdrop', 'props', 'crowd', 'fleet3d', 'particles', 'shotFx', 'fireworks', 'weather'].forEach((ns) => call(ns, 'init'));
  }

  function nextFrames(n) {
    return new Promise((resolve) => {
      const tick = () => (n-- <= 0 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }

  function numParam(params, k) {
    if (!params.has(k) || params.get(k) === '') return null;
    const v = Number(params.get(k));
    return Number.isFinite(v) ? v : null;
  }

  // Prepares everything §13 promises, runs `fn`, then finishes camera/clock setup. Resolves when frames are drawn.
  async function runDemo(name, fn, params, hctx) {
    call('theme', 'init');
    const root = rootEl();
    let host;
    if (/^ui\./.test(name) || name === 'app.game') {
      host = GLT.ui.mount(root).stage;
    } else {
      root.textContent = '';
      host = document.createElement('div');
      host.className = 'glt-demo';
      root.appendChild(host);
    }
    const tod = GLT.data.tods.indexOf(params.get('tod')) >= 0 ? params.get('tod') : 'day';
    const seedP = numParam(params, 'seed');
    const seed = seedP == null ? 1 : seedP >>> 0;
    const t = numParam(params, 't');
    webgl = init3d(host);
    if (webgl) {
      GLT.lighting.setTod(tod);
      GLT.camera.setMode('both', { instant: true });
    }
    GLT.layout.setSize(10);
    if (typeof fn !== 'function') throw new Error('GLT demo not found: ' + name);
    const ctx = Object.assign({}, hctx || {}, {
      name, params, seed, rng: GLT.rng.create(seed), tod, t,
      angle: numParam(params, 'angle'), elev: numParam(params, 'elev'), zoom: numParam(params, 'zoom'),
      stage: host, webgl,
      sampleFleet(format) { return JSON.parse(JSON.stringify(GLT.data.sampleFleets[format || 'classica'])); }
    });
    if (t != null) GLT.clock.freeze(0);   // demos set up on a frozen clock (camera moves are instant)
    await fn(ctx);
    if (webgl && (ctx.angle != null || ctx.elev != null || ctx.zoom != null)) {
      const o = {};
      if (ctx.angle != null) o.azimuth = ctx.angle;
      if (ctx.elev != null) o.elevation = ctx.elev;
      if (ctx.zoom != null) o.zoom = ctx.zoom;
      GLT.camera.set(o, { instant: true });
    }
    if (t != null) { GLT.clock.unfreeze(); GLT.clock.simulate(t); GLT.clock.freeze(t); }
    GLT.clock.start();
    await nextFrames(3);
  }

  function demoMode(params) {
    const name = params.get('demo');
    const original = GLT.demos && GLT.demos[name];
    const harness = !!(GLT.params && Object.prototype.hasOwnProperty.call(GLT.params, 'demo'));
    if (harness) {
      if (typeof original !== 'function') return;           // the harness reports "not found" itself
      const wrapped = function (hctx) { return runDemo(name, original, params, hctx); };
      wrapped.original = original;
      GLT.demos[name] = wrapped;
      return;
    }
    window.GLT_READY = false;
    runDemo(name, original, params, null).then(
      () => { window.GLT_READY = true; },
      (err) => { window.GLT_ERROR = String((err && err.stack) || err); rethrow(err); }
    );
  }

  async function probeNet() {
    try {
      const res = await GLT.pvp.probe();
      net = { available: !!(res && res.ok), reason: res ? res.reason : 'no_runtime', canWrite: res ? res.canWrite : null, probe: res };
    } catch (err) {
      net = { available: false, reason: 'no_runtime', canWrite: null };
    }
    GLT.events.emit('net:status', {
      conn: net.available ? 'online' : 'unavailable', opponent: 'none', rtt: null, online: null, otherTab: false, reason: net.reason
    });
  }

  async function boot() {
    if (booted) return;
    booted = true;
    document.documentElement.lang = 'pt-BR';
    GLT.prefs.init();
    const params = new URLSearchParams(location.search);
    if (params.get('demo')) { demoMode(params); return; }

    call('theme', 'init');
    const refs = GLT.ui.mount(rootEl());
    webgl = init3d(refs.stage);
    if (webgl) {
      GLT.renderer.setPixelSize(GLT.prefs.get('pixelSize'));
      GLT.camera.setMode(GLT.prefs.get('camera') || 'both', { instant: true });
      initVisuals();
    } else {
      GLT.ui.toast('error.webgl', null, 'warn');
    }
    call('audio', 'init');
    call('music', 'init');
    ['menuUi', 'setupUi', 'hud', 'logbook', 'statsUi', 'lobbyUi', 'settingsUi', 'ceremonyUi'].forEach((ns) => call(ns, 'init', refs));
    GLT.events.on('ui:start', (e) => startMatch(e && e.config));
    GLT.events.on('ui:menu', () => toMenu());
    GLT.clock.start();
    probeNet();   // async; never blocks first paint
    GLT.events.emit('app:ready', { webgl });
    GLT.ui.show('menu');
    GLT.i18n.fontsReady().then(() => nextFrames(2)).then(() => { window.GLT_READY = true; });
  }

  function startMatch(config) {
    if (driver) { try { driver.dispose(); } catch (err) { rethrow(err); } }
    driver = GLT.pvc.create(config);
  }

  function toMenu() {
    if (driver) { try { driver.dispose(); } catch (err) { rethrow(err); } driver = null; }
    GLT.ui.show('menu');
  }

  function local() { return driver ? driver.local : null; }

  function plateOf(player) {
    const me = local();
    return player === (me == null ? 0 : me) ? 'own' : 'enemy';
  }

  function crews() {
    const v = driver ? driver.view() : null;
    return v ? [v.players[0].crew, v.players[1].crew] : null;
  }

  function colorsOf(player) {
    const cs = crews();
    const id = cs ? cs[player] : 'strawHat';
    const c = GLT.data.crews[id].colors;
    const mirror = cs && cs[0] === cs[1] && player === 1;
    const src = mirror ? c.alt : c;
    return { primary: src.primary, secondary: src.secondary, trim: src.trim };
  }

  GLT.app = {
    boot,
    driver() { return driver; },
    view() { return driver ? driver.view() : null; },
    local,
    plateOf,
    colorsOf,
    crews,
    screen() { return GLT.ui.screen ? GLT.ui.screen() : 'menu'; },
    net() { return Object.assign({}, net); },
    webgl() { return webgl; },
    startMatch,
    toMenu
  };

  // Composed scene with sample fleets on both plates (lights up as world/ships/fx builders deliver).
  GLT.demos = GLT.demos || {};
  GLT.demos['app.scene'] = function (ctx) {
    const crewsPair = ['strawHat', 'marine'];
    const colors = crewsPair.map((id) => GLT.data.crews[id].colors.primary);
    GLT.layout.setSize(10);
    initVisuals();
    call('plates', 'build', 10);
    call('plates', 'setColors', { own: colors[0], enemy: colors[1] });
    call('crowd', 'build', crewsPair, colors);
    call('fleet3d', 'setFleet', 'own', ctx.sampleFleet('classica'), { crew: crewsPair[0], colors: GLT.data.crews[crewsPair[0]].colors, visible: true });
    call('fleet3d', 'setFleet', 'enemy', ctx.sampleFleet('classica'), { crew: crewsPair[1], colors: GLT.data.crews[crewsPair[1]].colors, visible: true });
    call('weather', 'set', { tod: ctx.tod, sea: 'calmo' });
    call('backdrop', 'setLift', true);
  };

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const go = () => { boot().catch(rethrow); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})();
