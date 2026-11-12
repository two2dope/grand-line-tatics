/* Sea sandbox, part 1 of 3 (_enter.js, modules, _exit.js). Area: render/world bridge (stage 3 of SCOPE-V2).
 *
 * Our render + world modules (src/render, src/world) were written against our own core (GLT.C, GLT.layout,
 * GLT.events, GLT.rng, GLT.T...). The game (pilot base) owns GLT.rng and GLT.T with other shapes. Every one of our
 * modules captures `const GLT = globalThis.GLT` once, at load. So the build swaps globalThis.GLT to a separate
 * namespace (GLT.sea) here, loads our modules (src/sea/{consts,events,rng,layout,data,env}.js are copies of our core
 * from legacy/src/logic plus small shims), and src/sea/_exit.js swaps the game's namespace back. Afterwards the game
 * reaches the sea only through src/sea/bridge.js (GLT.platesLighting, GLT.paletteShader,
 * GLT.backdropFx.createBackdropRing). Nothing here touches THREE or the DOM. */
(function () {
  'use strict';
  const g = globalThis;
  const host = (g.GLT = g.GLT || {});
  const sea = (host.sea = host.sea || {});
  sea.host = host;
  g.__gltSeaHost = host;
  g.GLT = sea;
})();
