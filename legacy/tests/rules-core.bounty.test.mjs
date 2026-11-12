// rules-core: stats and the exact bounty formula f(accuracy, shots, speed, streaks, difficulty, rules).
import assert from 'node:assert/strict';

// Independent re-implementation of ARCHITECTURE.md §5.10 for cross-checking.
function refBounty(st, { rules, difficulty, won, size, shipCells }) {
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const acc = st.shots ? st.hits / st.shots : 0;
  const accF = 0.5 + 1.5 * acc;
  const eff = clamp((size * size - st.shots) / (size * size - shipCells), 0, 1);
  const effF = 0.5 + 1.5 * eff;
  const spt = st.timeMs / 1000 / Math.max(1, st.turns);
  const speedF = clamp(1.6 - spt / 20, 0.7, 1.6);
  const streakF = 1 + 0.1 * st.bestStreak;
  const diffF = { grumete: 0.5, marujo: 1, capitao: 2, yonkou: 4, pvp: 3 }[difficulty];
  const rulesF = { escaramuca: 0.7, classica: 1, grandline: 1.4 }[rules.format] * (rules.mode === 'classico' ? 1.1 : 0.9) *
    (rules.salvo ? 0.9 : 1) * (rules.chain ? 0.8 : 1) * (rules.timer > 0 ? 1.1 : 1);
  const winF = won ? 1 : 0.25;
  return Math.max(1e6, Math.round(30e6 * accF * effF * speedF * streakF * diffF * rulesF * winF / 1e6) * 1e6);
}

export default function (test, ctx) {
  const { GLT } = ctx;
  const S = () => GLT.stats;
  const st = (o) => Object.assign(GLT.stats.empty(), o);

  test('hand-computed example: 40 shots, 17 hits, streak 4, 10 s/turn, Capitão, Clássica Clássico, won → ฿ 183.000.000', () => {
    const stats = st({ shots: 40, hits: 17, misses: 23, bestStreak: 4, turns: 30, timeMs: 300000 });
    const ctx2 = { rules: GLT.rules.normalize({}), difficulty: 'capitao', won: true, size: 10, shipCells: 17 };
    assert.equal(S().bounty(stats, ctx2), 183000000);
    assert.equal(GLT.i18n.berry(S().bounty(stats, ctx2)), '฿ 183.000.000');
    const f = S().factors(stats, ctx2);
    assert.equal(f.speedF, 1.1);
    assert.ok(Math.abs(f.rulesF - 1.1) < 1e-12);
  });

  test('every factor moves the bounty the right way (accuracy, shots, speed, streak, difficulty, rules, win)', () => {
    const base = st({ shots: 50, hits: 17, bestStreak: 3, turns: 40, timeMs: 400000 });
    const c = { rules: GLT.rules.normalize({}), difficulty: 'marujo', won: true, size: 10, shipCells: 17 };
    const b = S().bounty(base, c);
    assert.ok(S().bounty({ ...base, hits: 25 }, c) > b, 'accuracy');
    assert.ok(S().bounty({ ...base, shots: 35 }, c) > b, 'fewer shots');
    assert.ok(S().bounty({ ...base, timeMs: 100000 }, c) > b, 'speed');
    assert.ok(S().bounty({ ...base, bestStreak: 6 }, c) > b, 'streak');
    assert.ok(S().bounty(base, { ...c, difficulty: 'yonkou' }) > S().bounty(base, { ...c, difficulty: 'capitao' }));
    assert.ok(S().bounty(base, { ...c, difficulty: 'grumete' }) < b);
    assert.ok(S().bounty(base, { ...c, won: false }) < b);
    assert.ok(S().bounty(base, { ...c, rules: GLT.rules.normalize({ mode: 'tatico' }) }) < b);
    assert.ok(S().bounty(base, { ...c, rules: GLT.rules.normalize({ timer: 20 }) }) > b);
    assert.ok(S().bounty(base, { ...c, rules: GLT.rules.normalize({ chain: true }) }) < b);
    assert.ok(S().bounty(base, { ...c, rules: GLT.rules.normalize({ salvo: true }) }) < b);
  });

  test('clamps, rounding to the nearest ฿ 1.000.000 and the ฿ 1.000.000 minimum', () => {
    const c = { rules: GLT.rules.normalize({ format: 'escaramuca', mode: 'tatico', salvo: true, chain: true }), difficulty: 'grumete', won: false, size: 8, shipCells: 12 };
    assert.equal(S().bounty(st({ shots: 64, hits: 0, turns: 64, timeMs: 64 * 60000 }), c), 1e6);
    assert.equal(S().bounty(st({}), c) % 1e6, 0);
    const f = S().factors(st({ shots: 64, turns: 1, timeMs: 1e9 }), c);
    assert.equal(f.eff, 0); assert.equal(f.speedF, 0.7);
    assert.equal(S().factors(st({ shots: 0, turns: 0, timeMs: 0 }), c).speedF, 1.6);
  });

  test('bounty agrees with an independent implementation over random inputs', () => {
    const rng = GLT.rng.create(2024);
    for (let i = 0; i < 5000; i++) {
      const format = rng.pick(GLT.data.formatOrder);
      const rules = GLT.rules.normalize({ format, mode: rng.pick(['classico', 'tatico']), salvo: rng.chance(0.5), chain: rng.chance(0.5), timer: rng.pick([0, 20, 30, 60]) });
      const size = GLT.rules.size(rules);
      const shipCells = GLT._logic_fleet.totalCells(rules);
      const shots = shipCells + rng.int(size * size - shipCells + 1);
      const hits = rng.int(shipCells + 1);
      const stats = st({ shots, hits, misses: shots - hits, bestStreak: rng.int(hits + 1), turns: 1 + rng.int(shots), timeMs: rng.int(3600000) });
      const c = { rules, difficulty: rng.pick(['grumete', 'marujo', 'capitao', 'yonkou', 'pvp']), won: rng.chance(0.5), size, shipCells };
      assert.equal(S().bounty(stats, c), refBounty(stats, c));
    }
  });

  test('compute() from history equals the engine incremental stats; seriesStats sums them', () => {
    const E = GLT.engine;
    const sample = JSON.parse(JSON.stringify(GLT.data.sampleFleets.classica));
    let s = E.createGame({ rules: { chain: true }, seed: 1, crews: ['strawHat', 'marine'] });
    for (const p of [0, 1]) { s = E.reduce(s, { type: 'place', p, fleet: sample }).state; s = E.reduce(s, { type: 'ready', p }).state; }
    const rng = GLT.rng.create(5);
    while (s.phase === 'battle') {
      const cells = E.untried(s, s.turn);
      const x = rng.pick(cells);
      s = E.reduce(s, { type: 'fire', p: s.turn, r: x.r, c: x.c }).state;
      s = E.reduce(s, { type: 'answer', p: 1 - s.pending.p, answer: E.answer(s) }).state;
    }
    for (const p of [0, 1]) {
      const c = S().compute(s, p, 90000);
      assert.deepEqual(c, { ...s.players[p].stats, timeMs: 90000 });
      assert.equal(c.misses, c.shots - c.hits);
    }
    assert.equal(S().compute(s, 1, [1, 2]).timeMs, 2);
    let series = E.createSeries({ rules: { series: 3 }, seed: 1, crews: ['strawHat', 'marine'] });
    series = E.recordGame(series, s, 90000);
    const sum = S().seriesStats(series);
    assert.deepEqual(sum[s.winner].shots, s.players[s.winner].stats.shots);
    const b = S().bountyFor(s, s.winner, { difficulty: 'capitao', timeMs: 90000 });
    assert.equal(b, S().bounty(S().compute(s, s.winner, 90000), { rules: s.rules, difficulty: 'capitao', won: true, size: 10, shipCells: 17 }));
    assert.ok(S().seriesBounty(series, s.winner, 'capitao') >= 1e6);
  });
}
