/* GLT.music: Chiptune sea-shanty loop (synthesised). Area: audio. Contract: ARCHITECTURE.md §11.4.
 * STUB (architect). Owner: audio builder. init() is idempotent, subscribes to GLT.events, returns boolean.
 * No THREE/DOM/GLT access at load time (call time only). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.music = {
    init() { return false; },
    start() {},
    stop() {},
    setIntensity(x) {},
    dispose() {}
  };
})();
