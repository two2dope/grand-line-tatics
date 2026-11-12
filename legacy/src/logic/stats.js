/* GLT.stats: per-game stats and the bounty formula. Area: logic. Contract: ARCHITECTURE.md §5.10.
 * STUB (architect). Owner: logic builder. bounty() follows the exact formula in §5.10. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.stats.' + name + ': not implemented'); };

  GLT.stats = {
    empty() { return { shots: 0, hits: 0, misses: 0, accuracy: 0, streak: 0, bestStreak: 0, turns: 0, techs: 0, sunk: 0, timeMs: 0 }; },
    compute: ni('compute'),           // (state, p, timeMs?) -> Stats
    bounty: ni('bounty'),             // (stats, {rules, difficulty, won, size, shipCells}) -> number
    seriesStats: ni('seriesStats')    // (series) -> [Stats, Stats]
  };
})();
