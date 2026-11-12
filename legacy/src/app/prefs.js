/* GLT.prefs: settings state + persistence; emits settings:changed. Area: app. Contract: ARCHITECTURE.md §8.3.
 * Implemented by the architect (owner: app builder; add keys freely, keep these names and defaults). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const DEFAULTS = {
    pixelSize: 2, outlines: true, dither: true, raw3d: false, lift: true, tod: 'auto',
    speed: 1, paused: false, volume: 0.7, muted: false, music: true, theme: 'auto', autoNext: true,
    camera: 'both', reducedMotion: 'auto', grid2d: 'auto', nick: null, pid: null, lastConfig: null
  };
  const VOLATILE = { paused: true };

  let state = null;

  function init() {
    if (state) return true;
    const saved = (GLT.persist && GLT.persist.get('prefs', null)) || {};
    state = Object.assign({}, DEFAULTS);
    for (const k in saved) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k) && !VOLATILE[k]) state[k] = saved[k];
    let dirty = false;
    if (!state.nick && GLT.lobby) { state.nick = GLT.lobby.nickname(); dirty = true; }
    if (!state.pid && GLT.lobby) { state.pid = GLT.lobby.pid(); dirty = true; }
    if (dirty) save();
    return true;
  }

  function save() {
    if (!GLT.persist) return;
    const out = {};
    for (const k in state) if (!VOLATILE[k]) out[k] = state[k];
    GLT.persist.set('prefs', out);
  }

  function get(key) {
    if (!state) init();
    return state[key];
  }

  function set(key, value) {
    if (!state) init();
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) throw new Error('GLT.prefs.set: unknown key ' + key);
    if (state[key] === value) return;
    state[key] = value;
    if (!VOLATILE[key]) save();
    if (GLT.events) GLT.events.emit('settings:changed', { key, value, all: all() });
  }

  function all() { if (!state) init(); return Object.assign({}, state); }

  function reset() {
    const keep = { nick: state && state.nick, pid: state && state.pid };
    state = Object.assign({}, DEFAULTS, keep);
    save();
    if (GLT.events) GLT.events.emit('settings:changed', { key: '*', value: null, all: all() });
  }

  function reducedMotion() {
    const v = get('reducedMotion');
    if (v === 'on') return true;
    if (v === 'off') return false;
    try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  GLT.prefs = { DEFAULTS, init, get, set, all, reset, reducedMotion };
})();
