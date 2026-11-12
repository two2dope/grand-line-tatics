/* GLT.sim: headless CPU-vs-CPU runner (tests + quality-bar report). Area: logic. Contract: ARCHITECTURE.md §5.12.
 * STUB (architect). Owner: logic builder. Must use only GLT.engine/GLT.ai/GLT.stats; no timers. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.sim.' + name + ': not implemented'); };

  GLT.sim = {
    game: ni('game'),       // ({rules, seed, ai:[d,d], crews?, memory?, maxTurns?}) -> SimResult
    series: ni('series'),   // ({rules, seed, ai, crews?}) -> {winner, games}
    batch: ni('batch')      // ({rules, ai, games, seed}) -> aggregate report
  };
})();
