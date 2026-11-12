/* GLT.ai: CPU placement, shot choice, Log Pose hint, think time. Area: logic. Contract: ARCHITECTURE.md §5.9.
 * STUB (architect). Owner: logic builder. Seeded randomness only (GLT.rng.derive(seed,'ai',player,...)). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.ai.' + name + ': not implemented'); };

  GLT.ai = {
    styles: { grumete: 'random', marujo: 'random', capitao: 'edge', yonkou: 'spread' },
    create: ni('create'),             // ({difficulty, rules, seed, player, memory?}) -> Bot
    placeFleet: ni('placeFleet'),     // (rules, style, rng) -> Fleet
    hint: ni('hint'),                 // (view, rng?) -> Cell|null
    thinkMs(difficulty, rng) {        // 400..1200 (inert default until implemented)
      const C = GLT.C.T;
      return Math.round((C.cpuMin + (rng ? rng.next() : 0.5) * (C.cpuMax - C.cpuMin)) * 1000);
    },
    createMemory() { return { v: 1, heat: null, games: 0 }; }
  };
})();
