/* GLT.engine: pure game reducer, series, answers, views. Area: logic. Contract: ARCHITECTURE.md §4.1, §5.8.
 * STUB (architect). Owner: logic builder. Must never mutate inputs; no DOM, no THREE. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.engine.' + name + ': not implemented'); };

  GLT.engine = {
    // Fixed by contract (implemented, keep):
    gameSeed(seriesSeed, index) { return GLT.rng.mix(seriesSeed >>> 0, 'game', index | 0); },
    coinToss(gameSeed) { return GLT.rng.derive(gameSeed >>> 0, 'coin').int(2); },
    // To implement:
    createSeries: ni('createSeries'),       // ({rules, seed, crews}) -> SeriesState
    createGame: ni('createGame'),           // ({rules, seed, index, crews, hidden?}) -> GameState
    reduce: ni('reduce'),                   // (state, action) -> {state, events, error}
    answer: ni('answer'),                   // (state, fleet?) -> Answer
    recordGame: ni('recordGame'),           // (series, game, timeMs?) -> SeriesState
    view: ni('view'),                       // (state, viewer) -> GameView
    untried: ni('untried'),                 // (state, shooter) -> Cell[]
    randomUntried: ni('randomUntried'),     // (state, shooter, k?) -> Cell
    markVisible: ni('markVisible'),         // (view, player, idx) -> boolean
    techCells: ni('techCells'),             // (state, p, tech, target) -> Cell[]
    legalTech: ni('legalTech')              // (state, p, tech, target) -> string|null
  };
})();
