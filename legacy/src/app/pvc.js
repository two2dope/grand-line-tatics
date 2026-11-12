/* GLT.pvc: Player-vs-CPU Driver (engine + ai + game-time sequencing + bus events). Area: app.
 * Contract: ARCHITECTURE.md §7, §8.2. STUB (architect). Owner: app builder. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.pvc = {
    create(config) { throw new Error('GLT.pvc.create: not implemented'); }   // (MatchConfig) -> Driver
  };
})();
