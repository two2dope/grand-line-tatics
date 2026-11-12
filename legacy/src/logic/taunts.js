/* GLT.taunts: CPU taunt key picker. Area: logic. Contract: ARCHITECTURE.md §5.11.
 * Minimal implementation (architect); owner: logic builder may refine (e.g. avoid repeats). Cosmetic RNG only. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const situations = ['start', 'cpuHit', 'cpuMiss', 'cpuSunk', 'playerHit', 'playerMiss', 'playerSunk', 'cpuWin', 'cpuLose'];

  function pick(crew, situation, rng) {
    return { key: 'taunt.' + crew + '.' + situation, v: rng ? rng.int(16) : 0 };
  }

  GLT.taunts = { situations, pick };
})();
