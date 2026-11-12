/* GLT.pvp: Player-vs-Player Driver over GLT.session (+ host transport probe). Area: app.
 * Contract: ARCHITECTURE.md §6.5, §8.2, §14. STUB (architect). Owner: app builder. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.pvp = {
    probe() { return GLT.transportHost.probe(); },                                  // -> Promise<probe result>
    create(o) { throw new Error('GLT.pvp.create: not implemented'); }              // ({session, config}) -> Driver
  };
})();
