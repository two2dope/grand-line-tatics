/* GLT.transportMem: in-memory Transport hub with deterministic fault injection (tests).
 * Area: net. Contract: ARCHITECTURE.md §6.4. STUB (architect). Owner: net builder. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.transportMem.' + name + ': not implemented'); };

  GLT.transportMem = {
    hub: ni('hub')   // ({seed?, latency?, drop?, dup?, reorder?, dropWrite?}) -> Hub
  };
})();
