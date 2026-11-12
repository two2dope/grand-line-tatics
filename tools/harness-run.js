/* Grand Line Tactics - demo runner. Injected LAST by tools/build.js (after every module).
   If ?demo=name is present and GLT.demos[name] exists, it runs it with a ctx and then sets window.GLT_READY.
   The app must NOT self-start when GLT.params.demo is set. */
(function () {
  'use strict';
  var GLT = globalThis.GLT;
  function fail(msg) { console.error('[GLT harness] ' + msg); globalThis.GLT_ERROR = msg; }
  function go() {
    var name = GLT.params.demo;
    if (!name) return;               // normal app boot is the app's own business
    var fn = GLT.demos[name];
    if (typeof fn !== 'function') { fail('demo "' + name + '" not found. Available: ' + (Object.keys(GLT.demos).join(', ') || '(none)')); return; }
    var root = document.getElementById('app') || document.body;
    var ctx = { params: GLT.params, root: root, THREE: globalThis.THREE, GLT: GLT, clock: GLT.clock,
                ready: function () { globalThis.GLT_READY = true; } };
    var res;
    try { res = fn(ctx); } catch (e) { fail('demo "' + name + '" threw: ' + (e && e.stack || e)); return; }
    Promise.resolve(res).then(function () { globalThis.GLT_READY = true; },
                              function (e) { fail('demo "' + name + '" rejected: ' + (e && e.stack || e)); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
