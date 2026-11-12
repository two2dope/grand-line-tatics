/* GLT.audio: Web Audio context, master gain, synthesised SFX (cannon, splash, hit, sink, UI). Area: audio. Contract: ARCHITECTURE.md §11.4.
 * STUB (architect). Owner: audio builder. init() is idempotent, subscribes to GLT.events, returns boolean.
 * No THREE/DOM/GLT access at load time (call time only). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  GLT.audio = {
    init() { return false; },
    unlock() {},
    play(name, o) {},
    setVolume(v) {},
    setMuted(b) {},
    muted() { return true; },
    dispose() {}
  };
})();
