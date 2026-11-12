// rules-core: the whole match is a pure fold over an append-only move log. Replaying a recorded log reproduces the
// identical final state; the same seed gives identical games; serialise/deserialise round-trips; games terminate.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const E = () => GLT.engine;
  const Q = ctx.quick;

  // A seeded random captain driving a whole series through applyMove only (no GLT.ai needed).
  // Also injects noise: duplicate fires (double click), out-of-turn moves, occasional timeouts/techniques.
  function playMatch(G, o) {
    const En = G.engine;
    const rng = G.rng.create(o.botSeed >>> 0);
    let m = En.createMatch({ rules: o.rules, seed: o.seed, crews: o.crews });
    let t = 0, guard = 0;
    const push = (mv) => { t += 500 + rng.int(4000); mv.t = t; const r = En.applyMove(m, mv); m = r.match; return r; };
    while (!m.series.over) {
      if (++guard > 20000) throw new Error('match did not terminate');
      const g = m.game;
      if (g.phase === 'over') { push({ type: 'next' }); continue; }
      if (g.phase === 'setup') {
        for (const p of [0, 1]) {
          const style = G._logic_fleet.STYLES[rng.int(3)];
          push({ type: 'place', p, fleet: G._logic_fleet.place(g.rules, style, rng.fork('place' + p)) });
          push({ type: 'ready', p });
        }
        continue;
      }
      if (g.pending) { push({ type: 'answer', p: 1 - g.pending.p, answer: En.answer(g) }); continue; }
      const p = g.turn;
      const roll = rng.next();
      if (roll < 0.02) { push({ type: 'fire', p: 1 - p, r: 0, c: 0 }); continue; }               // out of turn → rejected
      if (o.forfeit && roll < 0.0025) { push({ type: 'forfeit', p, reason: 'quit' }); continue; }
      const tech = G.rules.techFor(g.players[p].crew);
      if (G.rules.techAllowed(g.rules) && !g.players[p].techUsed && g.acted === 0 && roll < 0.2) {
        const n = g.size;
        const target = tech === 'room' ? { axis: rng.pick(['row', 'col']), index: rng.int(n) } : { r: rng.int(n - 1), c: rng.int(n - 1) };
        if (!En.legalTech(g, p, tech, target)) { push({ type: 'tech', p, tech, target }); continue; }
      }
      if (g.rules.timer && roll > 0.97) { push({ type: 'timeout', p }); continue; }
      const cells = En.untried(g, p);
      const x = rng.pick(cells);
      push({ type: 'fire', p, r: x.r, c: x.c });
      if (roll > 0.95) push({ type: 'fire', p, r: x.r, c: x.c });                               // double click → rejected
    }
    return m;
  }

  const COMBOS = [];
  for (const format of ['escaramuca', 'classica', 'grandline']) {
    for (const mode of ['classico', 'tatico']) {
      for (const sea of ['calmo', 'grandline', 'novomundo', 'tempestade']) COMBOS.push({ format, mode, sea });
    }
  }
  const crewPairs = [['strawHat', 'whitebeard'], ['redHair', 'heart'], ['blackbeard', 'marine'], ['marine', 'strawHat'], ['heart', 'heart'], ['whitebeard', 'blackbeard']];

  test('replaying the recorded log reproduces the identical final state (all boards × modes × seas × toggles)', () => {
    let k = 0;
    const per = Q ? 1 : 4;
    for (const combo of COMBOS) {
      for (let i = 0; i < per; i++, k++) {
        const rules = GLT.rules.normalize(Object.assign({}, combo, {
          series: [1, 3, 5][k % 3], touch: k % 2 === 0, chain: k % 4 === 1, salvo: k % 5 === 2, timer: [0, 20, 30, 60][k % 4], fog: k % 3 === 1
        }));
        const m = playMatch(GLT, { rules, seed: GLT.rng.mix(k, 'match'), botSeed: k, crews: crewPairs[k % crewPairs.length], forfeit: k % 7 === 3 });
        const folded = E().foldMatch(E().logOf(m));
        assert.deepStrictEqual(folded, m);
        assert.equal(E().serialize(folded), E().serialize(m));
        // round-trip through text, as a client reconnecting would
        const again = E().loadMatch(E().serialize(E().logOf(m)));
        assert.deepStrictEqual(again, m);
        assert.deepStrictEqual(E().loadMatch(E().serialize(m)), m);
        assert.ok(m.series.over && (m.series.winner === 0 || m.series.winner === 1));
        assert.ok(m.rejected.length > 0, 'the noise moves were rejected deterministically');
      }
    }
  });

  test('same seed → identical games; different seeds → different games', () => {
    const rules = GLT.rules.normalize({ format: 'classica', mode: 'tatico', sea: 'tempestade', series: 3, timer: 30 });
    const a = playMatch(GLT, { rules, seed: 42, botSeed: 7, crews: ['strawHat', 'blackbeard'] });
    const b = playMatch(GLT, { rules, seed: 42, botSeed: 7, crews: ['strawHat', 'blackbeard'] });
    assert.equal(E().digest(a), E().digest(b));
    assert.deepStrictEqual(a, b);
    const c = playMatch(GLT, { rules, seed: 43, botSeed: 7, crews: ['strawHat', 'blackbeard'] });
    assert.notEqual(E().digest(a), E().digest(c));
    // and across isolated realms (two clients)
    const G2 = ctx.load();
    const d = playMatch(G2, { rules: G2.rules.normalize({ format: 'classica', mode: 'tatico', sea: 'tempestade', series: 3, timer: 30 }), seed: 42, botSeed: 7, crews: ['strawHat', 'blackbeard'] });
    assert.equal(JSON.stringify(d), JSON.stringify(a));
  });

  test('a fresh client folding the same log in another realm reaches the same state', () => {
    const rules = GLT.rules.normalize({ format: 'grandline', mode: 'tatico', sea: 'novomundo', series: 5, salvo: true });
    const m = playMatch(GLT, { rules, seed: 9001, botSeed: 3, crews: ['marine', 'heart'] });
    const G2 = ctx.load();
    const other = G2.engine.loadMatch(JSON.stringify(E().logOf(m)));
    assert.equal(JSON.stringify(other), JSON.stringify(m));
  });

  test('a replay prefix is the state at that point (append-only; reconnecting = replaying)', () => {
    const rules = GLT.rules.normalize({ format: 'escaramuca', series: 3 });
    const m = playMatch(GLT, { rules, seed: 5, botSeed: 5, crews: ['strawHat', 'marine'] });
    const log = E().logOf(m);
    let live = E().createMatch(log.header);
    for (let i = 0; i < log.moves.length; i++) {
      live = E().applyMove(live, log.moves[i]).match;
      if (i % 37 === 0) assert.deepStrictEqual(E().foldMatch({ v: 1, header: log.header, moves: log.moves.slice(0, i + 1) }), live);
    }
    assert.deepStrictEqual(live, m);
  });

  test('games always terminate with valid fleets and consistent stats/bounty', () => {
    const report = {};
    const per = Q ? 4 : 25;
    let k = 0;
    for (const combo of COMBOS) {
      let shots = 0, games = 0;
      for (let i = 0; i < per; i++, k++) {
        const rules = GLT.rules.normalize(Object.assign({}, combo, { touch: i % 2 === 0, chain: i % 3 === 1, salvo: i % 4 === 2 }));
        const m = playMatch(GLT, { rules, seed: GLT.rng.mix(k, 'term'), botSeed: k + 100000, crews: crewPairs[k % crewPairs.length] });
        const g = m.game;
        assert.equal(g.phase, 'over');
        assert.equal(g.endReason, 'fleet');
        for (const p of [0, 1]) {
          assert.ok(GLT.board.validateFleet(g.players[p].fleet, rules).ok);
          const c = GLT.stats.compute(g, p);
          assert.deepEqual(c, { ...g.players[p].stats, timeMs: 0 });
          assert.ok(GLT.stats.bounty(c, { rules, difficulty: 'pvp', won: g.winner === p, size: g.size, shipCells: GLT._logic_fleet.totalCells(rules) }) >= 1e6);
        }
        assert.equal(g.players[1 - g.winner].sunk.length, GLT.rules.format(rules).ships.length);
        const absorbed = g.history.filter((h) => h.p === g.winner).reduce((a, h) => a +
          (h.answer.kind === 'shots' ? h.answer.results : h.answer.result.shots || []).filter((x) => x.result === 'absorvido').length, 0);
        assert.ok(g.players[g.winner].stats.shots <= g.size * g.size + absorbed);
        assert.ok(absorbed <= 5, 'one Vórtice absorbs at most one shot or one volley');
        shots += g.players[g.winner].stats.shots; games++;
      }
      report[combo.format + '/' + combo.mode + '/' + combo.sea] = { games, avgWinnerShots: +(shots / games).toFixed(1) };
    }
    ctx.report('termination', report);
  });

  test('GameState-level replay: replayGame(config, actions) equals the reduced state', () => {
    const cfg = { rules: { format: 'classica', mode: 'tatico' }, seed: 77, index: 0, crews: ['whitebeard', 'redHair'] };
    let s = E().createGame(cfg);
    const actions = [];
    const rng = GLT.rng.create(1);
    const act = (a) => { actions.push(a); s = E().reduce(s, a).state; };
    for (const p of [0, 1]) { act({ type: 'place', p, fleet: GLT._logic_fleet.place(s.rules, 'spread', rng) }); act({ type: 'ready', p }); }
    while (s.phase === 'battle') {
      if (s.pending) { act({ type: 'answer', p: 1 - s.pending.p, answer: E().answer(s) }); continue; }
      const x = rng.pick(E().untried(s, s.turn));
      act({ type: 'fire', p: s.turn, r: x.r, c: x.c });
    }
    assert.deepStrictEqual(E().replayGame(cfg, actions), s);
    assert.deepStrictEqual(E().deserialize(E().serialize(s)), s);
    assert.throws(() => E().deserialize(JSON.stringify({ v: 2 })));
  });
}
