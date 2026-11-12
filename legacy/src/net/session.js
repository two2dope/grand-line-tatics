/* GLT.session: one PvP client (lobby, publishing, auto-answers, liveness, timers, rejoin).
 * Area: net. Contract: ARCHITECTURE.md §6.5. STUB (architect). Owner: net builder.
 * Timers come from opts.timers (default: global setTimeout/Date.now) so tests can use the hub's fake clock. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.session = {
    create() { throw new Error('GLT.session.create: not implemented'); }  // ({transport, storage?, timers?}) -> Session
  };
})();
