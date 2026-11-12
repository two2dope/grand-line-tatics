/* GLT.setupUi: Fleet placement (2D grid + 3D picking), rotate/auto/random/clear/Pronto; emits ui:fleet, setup:ghost, ui:ready. Area: ui. Contract: ARCHITECTURE.md §11.5.
 * STUB (architect). Owner: ui builder. All visible text via GLT.T; subscribe to GLT.events in init(). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.setupUi = {
    init(refs) { return false; },
    open(view, fleet) {},
    close() {},
    fleet() { return null; },
    dispose() {}
  };
})();
