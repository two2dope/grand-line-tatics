/* GLT.theme: light/dark/auto theme. Area: ui. Contract: ARCHITECTURE.md §11.5, §12.
 * BOOTSTRAP (architect): minimal working version. Owner: ui builder may extend (keep the API). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let mode = 'auto';
  let mql = null;

  function systemDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }

  function current() { return mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode; }

  function apply() {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', current());
  }

  function set(m) {
    mode = m === 'light' || m === 'dark' ? m : 'auto';
    apply();
    if (GLT.events) GLT.events.emit('theme:changed', { mode, theme: current() });
  }

  function init() {
    if (typeof document === 'undefined') return false;
    const pref = GLT.prefs && GLT.prefs.get ? GLT.prefs.get('theme') : 'auto';
    mode = pref === 'light' || pref === 'dark' ? pref : 'auto';
    apply();
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      if (mql && mql.addEventListener) mql.addEventListener('change', () => { if (mode === 'auto') set('auto'); });
    } catch (e) { /* ignore */ }
    if (GLT.events) GLT.events.on('settings:changed', (e) => { if (e && e.key === 'theme') set(e.value); });
    return true;
  }

  function token(name) {
    try { return getComputedStyle(document.documentElement).getPropertyValue(name.startsWith('--') ? name : '--' + name).trim(); } catch (e) { return ''; }
  }

  GLT.theme = { init, set, current, token };
})();
