/* Sea sandbox, part 3 of 3: give the game its namespace back (see _enter.js). The ships (src/ships) share the sea's
 * voxel builder and material classes, so GLT.voxel / GLT.renderer.markMaterial are aliased into the game namespace. */
(function () {
  'use strict';
  const g = globalThis;
  const host = g.__gltSeaHost || (g.GLT && g.GLT.host) || {};
  const sea = host.sea || g.GLT;
  g.GLT = host;
  try { delete g.__gltSeaHost; } catch (e) { g.__gltSeaHost = undefined; }
  host.voxel = sea.voxel;
  host.renderer = sea.renderer;
})();
