// @after stats.js
/* GLT.stats: per-game stats and the bounty formula. Area: logic. Piece: rules-core. Contract: ARCHITECTURE.md §5.10.
 * This file is the real implementation; it loads after the architect's stub `stats.js` (see @after) and replaces GLT.stats.
 * Pure: no DOM, no THREE, no Math.random. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const DIFF_F = { grumete: 0.5, marujo: 1, capitao: 2, yonkou: 4, pvp: 3 };
  const FORMAT_F = { escaramuca: 0.7, classica: 1, grandline: 1.4 };

  function empty() { return { shots: 0, hits: 0, misses: 0, accuracy: 0, streak: 0, bestStreak: 0, turns: 0, techs: 0, sunk: 0, timeMs: 0 }; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function pickTime(timeMs, p) {
    if (Array.isArray(timeMs)) return Math.max(0, +timeMs[p] || 0);
    return Math.max(0, +timeMs || 0);
  }

  // Recomputes player p's shooting stats from the game history alone (the engine keeps an incremental copy;
  // the two always agree, which tests and GLT.sim check). timeMs: number, or [ms0, ms1] per player.
  function compute(state, p, timeMs) {
    const st = empty();
    const turns = new Set();
    for (const h of state.history) {
      if (h.p !== p) continue;
      turns.add(h.turnNo);
      if (h.kind === 'tech') st.techs++;
      const list = h.answer.kind === 'shots' ? h.answer.results : (h.answer.result && h.answer.result.shots) || [];
      for (const x of list) {
        st.shots++;
        if (x.result === 'acerto' || x.result === 'afundou') {
          st.hits++; st.streak++;
          if (st.streak > st.bestStreak) st.bestStreak = st.streak;
          if (x.result === 'afundou') st.sunk++;
        } else { st.misses++; st.streak = 0; }
      }
    }
    st.turns = turns.size;
    st.accuracy = st.shots ? st.hits / st.shots : 0;
    st.timeMs = pickTime(timeMs, p);
    return st;
  }

  function shipCellsOf(rules) { return GLT.rules.shipsFor(rules).reduce((a, s) => a + s.len, 0); }

  // Every factor of the exact §5.10 formula, for the stats screen / WANTED poster breakdown.
  function factors(stats, ctx) {
    const c = ctx || {};
    const rules = GLT.rules.normalize(c.rules);
    const size = c.size || GLT.rules.size(rules);
    const shipCells = c.shipCells || shipCellsOf(rules);
    const s = stats || empty();
    const acc = s.shots ? s.hits / s.shots : 0;
    const accF = 0.5 + 1.5 * acc;
    const eff = clamp((size * size - s.shots) / (size * size - shipCells), 0, 1);
    const effF = 0.5 + 1.5 * eff;
    const spt = (s.timeMs || 0) / 1000 / Math.max(1, s.turns || 0);
    const speedF = clamp(1.6 - spt / 20, 0.7, 1.6);
    const streakF = 1 + 0.1 * (s.bestStreak || 0);
    const diffF = DIFF_F[c.difficulty] != null ? DIFF_F[c.difficulty] : 1;
    const rulesF = (FORMAT_F[rules.format] || 1) * (rules.mode === 'classico' ? 1.1 : 0.9) *
      (rules.salvo ? 0.9 : 1) * (rules.chain ? 0.8 : 1) * (rules.timer > 0 ? 1.1 : 1);
    const winF = c.won ? 1 : 0.25;
    return { acc, accF, eff, effF, spt, speedF, streakF, diffF, rulesF, winF };
  }

  function bounty(stats, ctx) {
    const f = factors(stats, ctx);
    const raw = GLT.C.BOUNTY_BASE * f.accF * f.effF * f.speedF * f.streakF * f.diffF * f.rulesF * f.winF;
    return Math.max(1e6, Math.round(raw / 1e6) * 1e6);
  }

  // Convenience: bounty of player p for a finished game state.
  function bountyFor(state, p, o) {
    const c = o || {};
    return bounty(compute(state, p, c.timeMs), {
      rules: state.rules, difficulty: c.difficulty || 'pvp', won: state.winner === p, size: state.size, shipCells: shipCellsOf(state.rules)
    });
  }

  function seriesStats(series) {
    const out = [empty(), empty()];
    for (const g of (series && series.games) || []) {
      for (let p = 0; p < 2; p++) {
        const a = out[p], b = g.stats[p];
        a.shots += b.shots; a.hits += b.hits; a.misses += b.misses; a.turns += b.turns;
        a.techs += b.techs; a.sunk += b.sunk; a.timeMs += b.timeMs;
        a.bestStreak = Math.max(a.bestStreak, b.bestStreak);
        a.streak = b.streak;
      }
    }
    out.forEach((a) => { a.accuracy = a.shots ? a.hits / a.shots : 0; });
    return out;
  }

  // Bounty of player p for a whole series (summed stats, won = series winner).
  function seriesBounty(series, p, difficulty) {
    return bounty(seriesStats(series)[p], { rules: series.rules, difficulty: difficulty || 'pvp', won: series.winner === p });
  }

  GLT.stats = { empty, compute, bounty, factors, bountyFor, seriesStats, seriesBounty, DIFF_F, FORMAT_F };
})();
