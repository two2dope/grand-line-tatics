// rules-core: match state machine (setup, ready, coin toss, turns, chain, salvo, timer, fog, gust, forfeit, victory,
// series best of 1/3/5), shot resolution water/hit/sunk, hidden-fleet answers, views, immutability.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const E = () => GLT.engine;
  const sample = (f) => JSON.parse(JSON.stringify(GLT.data.sampleFleets[f || 'classica']));

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
    return o;
  }
  function ok(res) { assert.equal(res.error, null, 'unexpected error ' + res.error); return res; }
  function seedFirst(p) { for (let s = 1; ; s++) if (E().coinToss(s) === p) return s; }

  // A battle-ready game with both sample fleets; `first` = who fires first.
  function start(rules, o) {
    o = o || {};
    const R = GLT.rules.normalize(rules);
    const fl = o.fleets || [sample(R.format), sample(R.format)];
    let s = E().createGame({ rules: R, seed: o.seed != null ? o.seed : seedFirst(o.first || 0), index: 0, crews: o.crews || ['strawHat', 'marine'], hidden: o.hidden });
    for (const p of [0, 1]) {
      if (!(o.hidden && o.hidden[p])) s = ok(E().reduce(s, { type: 'place', p, fleet: fl[p] })).state;
      s = ok(E().reduce(s, { type: 'ready', p })).state;
    }
    return s;
  }
  // fire + truthful answer; returns { state, events }
  function shoot(s, p, r, c) {
    const a = ok(E().reduce(s, { type: 'fire', p, r, c }));
    if (!a.state.pending) return a;
    const b = ok(E().reduce(a.state, { type: 'answer', p: 1 - p, answer: E().answer(a.state) }));
    return { state: b.state, events: a.events.concat(b.events) };
  }
  const MOBY = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]];

  test('createGame: setup phase, coin toss from the seed, empty marks, stats zeroed', () => {
    const s = E().createGame({ rules: { format: 'grandline' }, seed: 1234, index: 2, crews: ['heart', 'blackbeard'] });
    assert.equal(s.phase, 'setup');
    assert.equal(s.size, 12);
    assert.equal(s.gameIndex, 2);
    assert.equal(s.first, E().coinToss(1234));
    assert.equal(s.first, GLT.rng.derive(1234, 'coin').int(2));
    assert.equal(s.players[0].marks.length, 144);
    assert.deepEqual(s.players[1].stats, GLT.stats.empty());
    assert.deepEqual([s.players[0].crew, s.players[1].crew], ['heart', 'blackbeard']);
  });

  test('coin toss is a fair seeded Berry flip; the same seed always agrees', () => {
    let zeros = 0;
    for (let i = 0; i < 4000; i++) { const t = E().coinToss(GLT.rng.mix(i, 'x')); assert.ok(t === 0 || t === 1); if (!t) zeros++; }
    assert.ok(zeros > 1850 && zeros < 2150, 'zeros ' + zeros);
    assert.equal(E().coinToss(777), E().coinToss(777));
    assert.equal(E().gameSeed(5, 1), GLT.rng.mix(5, 'game', 1));
  });

  test('setup: place/ready validation and the move to battle', () => {
    let s = E().createGame({ rules: {}, seed: seedFirst(1), crews: ['strawHat', 'marine'] });
    const bad = sample(); bad.ships[0].c = 9;
    assert.equal(E().reduce(s, { type: 'place', p: 0, fleet: bad }).error, 'fleet');
    assert.equal(E().reduce(s, { type: 'ready', p: 0 }).error, 'fleet');
    assert.equal(E().reduce(s, { type: 'fire', p: 0, r: 0, c: 0 }).error, 'phase');
    assert.equal(E().reduce(s, { type: 'place', p: 2, fleet: sample() }).error, 'turn');
    s = ok(E().reduce(s, { type: 'place', p: 0, fleet: sample() })).state;
    const r0 = ok(E().reduce(s, { type: 'ready', p: 0 }));
    assert.deepEqual(r0.events, [{ type: 'ready', p: 0 }]);
    s = r0.state;
    assert.equal(E().reduce(s, { type: 'ready', p: 0 }).error, 'phase');
    assert.equal(E().reduce(s, { type: 'place', p: 0, fleet: sample() }).error, 'phase');
    s = ok(E().reduce(s, { type: 'place', p: 1, fleet: sample() })).state;
    const r1 = ok(E().reduce(s, { type: 'ready', p: 1 }));
    assert.equal(r1.state.phase, 'battle');
    assert.equal(r1.state.turn, 1);
    assert.equal(r1.state.turnNo, 1);
    assert.equal(r1.state.shotsLeft, 1);
    assert.deepEqual(r1.events.map((e) => e.type), ['ready', 'phase', 'turn']);
    assert.deepEqual(r1.events[2], { type: 'turn', turn: 1, turnNo: 1, shotsLeft: 1, gust: null });
  });

  test('shot resolution: Água → mark 1, Acertou → mark 2, Afundou → ship cells (mark 3) with the ship', () => {
    let s = start({});
    let r = shoot(s, 0, 0, 0);
    assert.equal(r.state.players[1].marks[0], 1);
    const resolved = r.events.find((e) => e.type === 'resolved');
    assert.deepEqual(resolved.results, [{ r: 0, c: 0, result: 'agua' }]);
    assert.equal(r.state.turn, 1);
    s = r.state;
    s = shoot(s, 1, 9, 9).state;     // p1 misses back
    // Going Merry (6,5)h len 2
    r = shoot(s, 0, 6, 5);
    assert.equal(r.events.find((e) => e.type === 'resolved').results[0].result, 'acerto');
    assert.equal(r.state.players[1].marks[65], 2);
    s = shoot(r.state, 1, 9, 8).state;
    r = shoot(s, 0, 6, 6);
    const res = r.events.find((e) => e.type === 'resolved').results[0];
    assert.equal(res.result, 'afundou');
    assert.deepEqual(res.ship, { id: 'goingMerry', r: 6, c: 5, dir: 'h', len: 2 });
    const sunk = r.events.find((e) => e.type === 'sunk');
    assert.deepEqual(sunk, { type: 'sunk', p: 0, owner: 1, ship: res.ship });
    assert.equal(r.state.players[1].marks[65], 3);
    assert.equal(r.state.players[1].marks[66], 3);
    assert.deepEqual(r.state.players[1].sunk, [res.ship]);
    const v = E().view(r.state, 0);
    assert.equal(v.players[1].shipsAfloat, 4);
    assert.deepEqual(v.players[1].lastShot, { r: 6, c: 6, turnNo: 5 });
  });

  test('illegal actions return the same state object, no events and an error code', () => {
    const s = start({});
    const cases = [
      [{ type: 'fire', p: 1, r: 0, c: 0 }, 'turn'],
      [{ type: 'fire', p: 0, r: 10, c: 0 }, 'bounds'],
      [{ type: 'fire', p: 0, r: -1, c: 0 }, 'bounds'],
      [{ type: 'answer', p: 1, answer: { kind: 'shots', results: [] } }, 'pending'],
      [{ type: 'tech', p: 0, tech: 'bazooka', target: { r: 0, c: 0 } }, 'tech'],   // Clássico: no techniques
      [{ type: 'ready', p: 0 }, 'phase'],
      [{ type: 'bogus', p: 0 }, 'phase']
    ];
    for (const [a, code] of cases) {
      const r = E().reduce(s, a);
      assert.equal(r.error, code, JSON.stringify(a));
      assert.equal(r.state, s);
      assert.deepEqual(r.events, []);
    }
    const f = ok(E().reduce(s, { type: 'fire', p: 0, r: 0, c: 0 }));
    assert.equal(E().reduce(f.state, { type: 'fire', p: 0, r: 0, c: 1 }).error, 'pending');   // double click
    assert.equal(E().reduce(f.state, { type: 'answer', p: 0, answer: E().answer(f.state) }).error, 'turn');
    assert.equal(E().reduce(f.state, { type: 'answer', p: 1, answer: { kind: 'shots', results: [{ r: 0, c: 0, result: 'acerto' }] } }).error, 'answer');   // lie vs known fleet
    assert.equal(E().reduce(f.state, { type: 'answer', p: 1, answer: { kind: 'tech', result: {} } }).error, 'answer');
    const done = ok(E().reduce(f.state, { type: 'answer', p: 1, answer: E().answer(f.state) })).state;
    const back = shoot(done, 1, 5, 5).state;
    assert.equal(E().reduce(back, { type: 'fire', p: 0, r: 0, c: 0 }).error, 'tried');
  });

  test('chain rule: a hit keeps the turn, a miss passes it; default passes after any shot', () => {
    let s = start({ chain: true });
    let r = shoot(s, 0, 1, 1);
    assert.equal(r.state.turn, 0);
    assert.equal(r.state.turnNo, 1);
    r = shoot(r.state, 0, 1, 2);
    assert.equal(r.state.turn, 0);
    r = shoot(r.state, 0, 0, 0);
    assert.equal(r.state.turn, 1);
    assert.equal(r.state.turnNo, 2);
    assert.equal(r.state.players[0].stats.turns, 1);
    s = start({});
    assert.equal(shoot(s, 0, 1, 1).state.turn, 1);
  });

  test('salvo: shots per turn = ships afloat at turn start; chain is ignored; sinking reduces the next salvo', () => {
    let s = start({ salvo: true, chain: true });
    assert.equal(s.shotsLeft, 5);
    let r = shoot(s, 0, 1, 1);           // hit, but salvo ignores chain: still counts down
    assert.equal(r.state.shotsLeft, 4);
    assert.equal(r.state.turn, 0);
    for (const c of [2, 3, 4]) r = shoot(r.state, 0, 1, c);
    assert.equal(r.state.shotsLeft, 1);
    r = shoot(r.state, 0, 1, 5);         // Moby Dick sinks with the 5th shot → turn passes
    assert.equal(r.state.turn, 1);
    assert.equal(r.state.shotsLeft, 4);  // the shooter's OWN ships afloat: p1 just lost Moby Dick
    assert.ok(r.events.some((e) => e.type === 'sunk' && e.ship.id === 'mobyDick'));
    for (const c of [0, 1, 2, 3]) r = shoot(r.state, 1, 9, c);
    assert.equal(r.state.turn, 0);
    assert.equal(r.state.shotsLeft, 5);  // p0 lost nothing (row 9 is empty)
    for (let i = 0; i < 5; i++) r = shoot(r.state, 0, 0, i);
    assert.equal(r.state.turn, 1);
    assert.equal(r.state.shotsLeft, 4);
  });

  test('victory: sinking the last ship ends the game; nothing else is accepted', () => {
    let s = start({ format: 'escaramuca', chain: true });
    const cells = [];
    for (const sh of sample('escaramuca').ships) for (const p of GLT.board.shipCells(sh)) cells.push(p);
    let r;
    for (const p of cells) r = shoot(r ? r.state : s, 0, p.r, p.c);
    assert.equal(r.state.phase, 'over');
    assert.equal(r.state.winner, 0);
    assert.equal(r.state.endReason, 'fleet');
    assert.deepEqual(r.events.slice(-2), [{ type: 'phase', phase: 'over' }, { type: 'over', winner: 0, reason: 'fleet' }]);
    const st = r.state.players[0].stats;
    assert.equal(st.shots, 12); assert.equal(st.hits, 12); assert.equal(st.bestStreak, 12); assert.equal(st.sunk, 4); assert.equal(st.accuracy, 1);
    assert.equal(E().reduce(r.state, { type: 'fire', p: 0, r: 0, c: 0 }).error, 'phase');
    assert.equal(E().reduce(r.state, { type: 'forfeit', p: 1, reason: 'quit' }).error, 'phase');
    const v = E().view(r.state, 0);
    assert.ok(v.players[1].fleet, 'opponent fleet visible once the game is over');
  });

  test('timer expiry: timeout auto-fires the seeded random untried cell', () => {
    const s = start({ timer: 20 });
    const want = E().randomUntried(s, 0, 0);
    assert.deepEqual(want, GLT.rng.derive(s.seed, 'timeout', 1, 0).pick(E().untried(s, 0)));
    assert.equal(E().reduce(s, { type: 'timeout', p: 1 }).error, 'turn');
    const r = ok(E().reduce(s, { type: 'timeout', p: 0 }));
    assert.deepEqual(r.events[0], { type: 'fired', p: 0, cells: [want], tech: null, auto: true, drift: null });
    assert.deepEqual(r.state.pending.cells, [want]);
    const done = ok(E().reduce(r.state, { type: 'answer', p: 1, answer: E().answer(r.state) })).state;
    assert.equal(done.history[0].auto, true);
    assert.equal(E().reduce(r.state, { type: 'timeout', p: 0 }).error, 'pending');
    assert.deepEqual(E().reduce(s, { type: 'timeout', p: 0 }).state, r.state, 'deterministic');
  });

  test('forfeit (quit / absent / cheat) ends the game for the other side, in setup or battle', () => {
    for (const [reason, end] of [['quit', 'forfeit'], ['absent', 'absent'], ['cheat', 'cheat']]) {
      const r = ok(E().reduce(start({}), { type: 'forfeit', p: 0, reason }));
      assert.equal(r.state.phase, 'over'); assert.equal(r.state.winner, 1); assert.equal(r.state.endReason, end);
    }
    const setup = E().createGame({ rules: {}, seed: 1, crews: ['strawHat', 'marine'] });
    assert.equal(ok(E().reduce(setup, { type: 'forfeit', p: 1, reason: 'quit' })).state.winner, 0);
    const f = ok(E().reduce(start({}), { type: 'fire', p: 0, r: 0, c: 0 })).state;
    const g = ok(E().reduce(f, { type: 'forfeit', p: 1, reason: 'quit' })).state;
    assert.equal(g.pending, null);
  });

  test('fog: enemy markers fade after 2 turns (sunk cells stay), own waters always visible', () => {
    let s = start({ fog: true });
    s = shoot(s, 0, 0, 0).state;             // turn 1: miss at A1 on p1's waters
    s = shoot(s, 1, 0, 0).state;             // turn 2
    let v = E().view(s, 0);
    assert.equal(E().markVisible(v, 1, 0), true);
    s = shoot(s, 0, 9, 9).state;             // turn 3
    v = E().view(s, 0);
    assert.equal(v.turnNo, 4);
    assert.equal(E().markVisible(v, 1, 0), false, 'faded after 2 turns');
    assert.equal(E().markVisible(v, 1, 99), true, 'placed on turn 3, still fresh');
    assert.equal(E().markVisible(E().view(s, 1), 1, 0), true, 'own waters never fade');
    assert.equal(E().markVisible(v, 1, 1), false, 'unknown cell');
    const noFog = start({});
    const w = E().view(shoot(shoot(shoot(noFog, 0, 0, 0).state, 1, 0, 0).state, 0, 9, 9).state, 0);
    assert.equal(E().markVisible(w, 1, 0), true);
    // Novo Mundo (Tático) forces fog on
    assert.equal(GLT.rules.effectiveFog(GLT.rules.normalize({ mode: 'tatico', sea: 'novomundo' })), true);
    assert.equal(GLT.rules.effectiveFog(GLT.rules.normalize({ mode: 'classico', sea: 'novomundo' })), false);
  });

  test('Tempestade gust (Tático only): seeded, public at turn start, drifts the first fire one cell', () => {
    const R = GLT.rules.normalize({ mode: 'tatico', sea: 'tempestade' });
    let found = null;
    for (let seed = 1; seed < 500 && !found; seed++) {
      if (E().coinToss(seed) !== 0) continue;
      const s = start(R, { seed });
      if (s.gust) found = s;
    }
    assert.ok(found, 'a gust within 500 seeds');
    const g = GLT.rng.derive(found.seed, 'gust', 1);
    assert.ok(g.next() < GLT.C.GUST_P);
    assert.equal(found.gust.dir, ['N', 'S', 'E', 'W'][g.int(4)]);
    const d = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] }[found.gust.dir];
    const r = ok(E().reduce(found, { type: 'fire', p: 0, r: 5, c: 5 }));
    assert.deepEqual(r.events[0].drift, { from: { r: 5, c: 5 }, dir: found.gust.dir });
    assert.deepEqual(r.state.pending.cells, [{ r: 5 + d[0], c: 5 + d[1] }]);
    assert.equal(r.state.gust, null);
    // off the board → no drift
    const edge = { N: [0, 5], S: [9, 5], E: [5, 9], W: [5, 0] }[found.gust.dir];
    const r2 = ok(E().reduce(found, { type: 'fire', p: 0, r: edge[0], c: edge[1] }));
    assert.equal(r2.events[0].drift, null);
    // gust rate ≈ 1/5, and never in Clássico or other seas
    let gusts = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const s = E().createGame({ rules: R, seed, crews: ['strawHat', 'marine'] });
      const t = { ...s, turnNo: 1 };
      if (GLT.rng.derive(seed, 'gust', 1).next() < GLT.C.GUST_P) gusts++;
      void t;
    }
    assert.ok(gusts > 330 && gusts < 470, 'gust rate ' + gusts / 2000);
    for (const rules of [{ sea: 'tempestade' }, { mode: 'tatico', sea: 'calmo' }]) {
      for (let seed = 1; seed < 100; seed++) assert.equal(start(rules, { seed }).gust, null);
    }
  });

  test('hidden defender (PvP): answers are shape- and consistency-checked against public marks', () => {
    let s = start({}, { hidden: [false, true] });
    assert.equal(s.players[1].fleet, null);
    s = ok(E().reduce(s, { type: 'fire', p: 0, r: 1, c: 1 })).state;
    assert.equal(E().answer(s), null, 'no fleet → cannot answer locally');
    const lie = { kind: 'shots', results: [{ r: 1, c: 1, result: 'afundou', ship: { id: 'goingMerry', r: 1, c: 1, dir: 'h', len: 2 } }] };
    assert.equal(E().reduce(s, { type: 'answer', p: 1, answer: lie }).error, 'answer', 'cannot sink a ship with an unhit cell');
    assert.equal(E().reduce(s, { type: 'answer', p: 1, answer: { kind: 'shots', results: [{ r: 1, c: 2, result: 'agua' }] } }).error, 'answer');
    const truth = E().answer(s, sample());
    s = ok(E().reduce(s, { type: 'answer', p: 1, answer: truth })).state;
    assert.equal(s.players[1].marks[11], 2);
    // the engine can't see a lie about water vs hit — the protocol verifies against the revealed fleet
    const v1 = E().view(s, 1);
    assert.equal(v1.players[0].fleet, null, 'p1 never sees p0 fleet before the end');
    assert.equal(E().view(s, null).players[0].fleet, null, 'spectators neither');
    const over = ok(E().reduce(s, { type: 'forfeit', p: 1, reason: 'quit' })).state;
    assert.equal(E().view(over, 0).players[1].fleet, null, 'hidden fleet unknown until revealed');
    const rev = ok(E().reduce(over, { type: 'reveal', p: 1, fleet: sample() })).state;
    assert.ok(E().view(rev, 0).players[1].fleet);
  });

  test('reduce never mutates its input (deep-frozen states work)', () => {
    let s = deepFreeze(start({ salvo: true }));
    const snap = JSON.stringify(s);
    for (let i = 0; i < 5; i++) {
      const a = E().reduce(s, { type: 'fire', p: 0, r: 1, c: i });
      deepFreeze(a.state);
      const b = E().reduce(a.state, { type: 'answer', p: 1, answer: E().answer(a.state) });
      deepFreeze(b.state);
      s = b.state;
    }
    assert.equal(s.phase, 'battle');
    assert.ok(snap.length > 0);
  });

  test('view(): own fleet only, myTurn/pending flags, spectator perspective', () => {
    const s = start({}, { first: 1 });
    const v0 = E().view(s, 0), v1 = E().view(s, 1), sp = E().view(s, null);
    assert.ok(v0.players[0].fleet); assert.equal(v0.players[1].fleet, null);
    assert.equal(v0.myTurn, false); assert.equal(v1.myTurn, true);
    assert.deepEqual([sp.viewer, sp.me, sp.opp, sp.myTurn], [null, 0, 1, false]);
    assert.equal(sp.players[0].fleet, null);
    const f = ok(E().reduce(s, { type: 'fire', p: 1, r: 2, c: 2 })).state;
    assert.equal(E().view(f, 1).pending, true);
    assert.equal(E().view(f, 1).myTurn, false);
    assert.deepEqual(E().untried(s, 0).length, 100);
  });

  test('series best of 1 / 3 / 5: target wins, game seeds, idempotent recordGame', () => {
    for (const len of [1, 3, 5]) {
      let series = E().createSeries({ rules: { series: len }, seed: 99, crews: ['redHair', 'heart'] });
      assert.equal(series.target, Math.ceil(len / 2));
      let i = 0;
      while (!series.over) {
        const g = E().nextGame(series);
        assert.equal(g.seed, E().gameSeed(99, series.index));
        assert.equal(g.gameIndex, series.index);
        const loser = i % 3 === 2 ? 0 : 1;    // p0 wins twice, then loses once…
        let s = start(series.rules, { seed: g.seed, crews: series.crews });
        s = { ...s, gameIndex: g.gameIndex };
        s = ok(E().reduce(s, { type: 'forfeit', p: loser, reason: 'absent' })).state;
        s = { ...s, endReason: 'fleet' };     // treat as a normal game end for counting
        const next = E().recordGame(series, s, 60000);
        assert.deepEqual(E().recordGame(next, s, 60000), next, 'recording twice changes nothing');
        series = next;
        i++;
        assert.ok(i <= len);
      }
      assert.ok(series.wins[series.winner] === series.target);
      assert.equal(series.games.length, series.wins[0] + series.wins[1]);
      assert.equal(E().nextGame(series), null);
    }
    // a forfeit/cheat ends the whole series at once
    let series = E().createSeries({ rules: { series: 5 }, seed: 3, crews: ['strawHat', 'marine'] });
    const g = ok(E().reduce(start({ series: 5 }, { seed: E().gameSeed(3, 0) }), { type: 'forfeit', p: 1, reason: 'cheat' })).state;
    series = E().recordGame(series, g);
    assert.equal(series.over, true); assert.equal(series.winner, 0);
  });
}
