/* Grand Line Tactics - build harness. Injected FIRST (prelude) and LAST (runner) by tools/build.js.
   Not a game module: it only provides URL params, a freezable clock and demo dispatch. */
(function () {
  'use strict';
  var g = globalThis;
  g.GLT = g.GLT || {};
  var GLT = g.GLT;
  GLT.demos = GLT.demos || {};

  // ?demo=name&angle=&elev=&zoom=&tod=day|dusk|night|storm&seed=&t=
  var P = {};
  try {
    var q = new URLSearchParams((g.location && g.location.search) || '');
    var num = function (k) { if (!q.has(k) || q.get(k) === '') return undefined; var v = parseFloat(q.get(k)); return isFinite(v) ? v : undefined; };
    P.demo = q.get('demo') || null;
    P.angle = num('angle'); P.elev = num('elev'); P.zoom = num('zoom'); P.t = num('t');
    P.tod = q.get('tod') || null;
    P.seed = q.has('seed') ? (isFinite(+q.get('seed')) && q.get('seed') !== '' ? +q.get('seed') : q.get('seed')) : undefined;
  } catch (e) { /* non-browser (tests) */ }
  GLT.params = P;

  // Deterministic clock in seconds. With ?t=0.4 it is frozen at 0.4; otherwise wall time since load.
  var t0 = (g.performance && g.performance.now) ? g.performance.now() : Date.now();
  GLT.clock = function () {
    if (typeof P.t === 'number') return P.t;
    return (((g.performance && g.performance.now) ? g.performance.now() : Date.now()) - t0) / 1000;
  };
})();
