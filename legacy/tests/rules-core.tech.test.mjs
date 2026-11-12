// rules-core: the six Modo Tático techniques, exactly as SPEC.md / ARCHITECTURE.md §5.8, deterministic.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const E = () => GLT.engine;
  const sample = (f) => JSON.parse(JSON.stringify(GLT.data.sampleFleets[f || 'classica']));
  const TAT = (x) => GLT.rules.normalize(Object.assign({ mode: 'tatico' }, x || {}));
  function ok(res) { assert.equal(res.error, null, 'unexpected error ' + res.error); return res; }
  function seedFirst(p) { for (let s = 1; ; s++) if (E().coinToss(s) === p) return s; }
  function start(crews, rules, first) {
    const R = TAT(rules);
    let s = E().createGame({ rules: R, seed: seedFirst(first || 0), crews });
    for (const p of [0, 1]) { s = ok(E().reduce(s, { type: 'place', p, fleet: sample(R.format) })).state; s = ok(E().reduce(s, { type: 'ready', p })).state; }
    return s;
  }
  function shoot(s, p, r, c) {
    const a = ok(E().reduce(s, { type: 'fire', p, r, c }));
    if (!a.state.pending) return a;
    const b = ok(E().reduce(a.state, { type: 'answer', p: 1 - p, answer: E().answer(a.state) }));
    return { state: b.state, events: a.events.concat(b.events) };
  }
  function tech(s, p, t, target) {
    const a = ok(E().reduce(s, { type: 'tech', p, tech: t, target }));
    if (!a.state.pending) return a;
    const ans = E().answer(a.state);
    const b = ok(E().reduce(a.state, { type: 'answer', p: 1 - p, answer: ans }));
    return { state: b.state, events: a.events.concat(b.events), answer: ans };
  }
  // Sample classica fleet: Moby Dick (1,1)h5 · Sunny (3,8)v4 · Red Force (4,2)v3 · Polar Tang (8,4)h3 · Merry (6,5)h2

  test('Bazooka (Chapéus de Palha): 2×2 volley in fixed order, r,c ≤ n-2, skips tried cells', () => {
    let s = start(['strawHat', 'marine']);
    assert.deepEqual(E().techCells(s, 0, 'bazooka', { r: 0, c: 1 }), [{ r: 0, c: 1 }, { r: 0, c: 2 }, { r: 1, c: 1 }, { r: 1, c: 2 }]);
    assert.equal(E().legalTech(s, 0, 'bazooka', { r: 9, c: 0 }), 'bounds');
    assert.equal(E().legalTech(s, 0, 'bazooka', { r: 0, c: 9 }), 'bounds');
    assert.equal(E().legalTech(s, 0, 'bazooka', { r: 8, c: 8 }), null);
    const r = tech(s, 0, 'bazooka', { r: 0, c: 1 });
    assert.deepEqual(r.answer, { kind: 'tech', result: { tech: 'bazooka', r: 0, c: 1, shots: [
      { r: 0, c: 1, result: 'agua' }, { r: 0, c: 2, result: 'agua' }, { r: 1, c: 1, result: 'acerto' }, { r: 1, c: 2, result: 'acerto' }] } });
    assert.deepEqual(r.events.map((e) => e.type), ['fired', 'resolved', 'tech', 'turn']);
    assert.equal(r.state.turn, 1, 'a technique costs the turn');
    assert.equal(r.state.players[0].techUsed, true);
    assert.equal(r.state.players[0].stats.shots, 4);
    assert.equal(r.state.players[0].stats.techs, 1);
    // skipped tried cells; Merry sunk mid-volley reports afundou on the completing cell
    s = start(['strawHat', 'marine']);
    s = shoot(s, 0, 6, 5).state; s = shoot(s, 1, 0, 0).state;
    s = shoot(s, 0, 5, 5).state; s = shoot(s, 1, 0, 1).state;
    const t2 = tech(s, 0, 'bazooka', { r: 5, c: 5 });
    assert.deepEqual(t2.answer.result.shots.map((x) => [x.r, x.c, x.result]), [[5, 6, 'agua'], [6, 6, 'afundou']]);
    assert.equal(t2.answer.result.shots[1].ship.id, 'goingMerry');
  });

  test('Tremor (Barba Branca): centre then N, S, W, E; out-of-bounds and tried cells skipped; none left → illegal', () => {
    let s = start(['whitebeard', 'marine']);
    assert.deepEqual(E().techCells(s, 0, 'tremor', { r: 1, c: 3 }), [{ r: 1, c: 3 }, { r: 0, c: 3 }, { r: 2, c: 3 }, { r: 1, c: 2 }, { r: 1, c: 4 }]);
    assert.deepEqual(E().techCells(s, 0, 'tremor', { r: 0, c: 0 }), [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 0, c: 1 }]);
    assert.equal(E().legalTech(s, 0, 'tremor', { r: 10, c: 0 }), 'bounds');
    const r = tech(s, 0, 'tremor', { r: 1, c: 3 });
    assert.deepEqual(r.answer.result.shots.map((x) => x.result), ['acerto', 'agua', 'agua', 'acerto', 'acerto']);
    // a cross with every cell already tried is illegal
    s = start(['whitebeard', 'marine']);
    const cross = [[0, 0], [1, 0], [0, 1]];
    cross.forEach(([rr, cc], i) => { s = shoot(s, 0, rr, cc).state; s = shoot(s, 1, 9, i).state; });
    assert.equal(E().legalTech(s, 0, 'tremor', { r: 0, c: 0 }), 'tried');
  });

  test('Haki do Rei (Cabelo Vermelho): yes/no over the clipped 3×3, ignores sunk ships, marks nothing', () => {
    let s = start(['redHair', 'marine']);
    let r = tech(s, 0, 'haki', { r: 9, c: 9 });
    assert.deepEqual(r.answer.result, { tech: 'haki', r: 9, c: 9, found: false });
    assert.deepEqual(r.state.players[1].marks, s.players[1].marks, 'no cell becomes tried');
    assert.deepEqual(r.state.players[1].annotations, [{ tech: 'haki', r: 9, c: 9, found: false, turnNo: 1 }]);
    s = start(['redHair', 'marine']);
    assert.equal(tech(s, 0, 'haki', { r: 7, c: 4 }).answer.result.found, true);   // Polar Tang row 8
    assert.equal(E().techCells(s, 0, 'haki', { r: 0, c: 0 }).length, 4);
    // after Merry sinks, a 3×3 that only covers Merry → false
    s = start(['redHair', 'marine'], { chain: true });
    s = shoot(s, 0, 6, 5).state; s = shoot(s, 0, 6, 6).state; s = shoot(s, 0, 0, 0).state;
    s = shoot(s, 1, 9, 9).state;
    assert.equal(tech(s, 0, 'haki', { r: 7, c: 6 }).answer.result.found, true, 'Polar Tang (8,6) is in range');
    assert.equal(tech(s, 0, 'haki', { r: 5, c: 6 }).answer.result.found, false, 'only the sunk Merry in range');
  });

  test('Room (Piratas do Coração): count of ALL ship cells on one row or column, hit or not', () => {
    let s = start(['heart', 'marine']);
    assert.deepEqual(tech(s, 0, 'room', { axis: 'row', index: 1 }).answer.result, { tech: 'room', axis: 'row', index: 1, count: 5 });
    assert.equal(tech(s, 0, 'room', { axis: 'col', index: 8 }).answer.result.count, 4);
    assert.equal(tech(s, 0, 'room', { axis: 'row', index: 6 }).answer.result.count, 4);   // Red Force, Merry ×2, Sunny
    assert.equal(tech(s, 0, 'room', { axis: 'row', index: 0 }).answer.result.count, 0);
    assert.equal(E().legalTech(s, 0, 'room', { axis: 'row', index: 10 }), 'bounds');
    assert.equal(E().legalTech(s, 0, 'room', { axis: 'diag', index: 1 }), 'bounds');
    s = shoot(s, 0, 1, 1).state; s = shoot(s, 1, 0, 0).state;
    const r = tech(s, 0, 'room', { axis: 'row', index: 1 });
    assert.equal(r.answer.result.count, 5, 'hit cells still count');
    assert.deepEqual(r.state.players[1].annotations.slice(-1), [{ tech: 'room', axis: 'row', index: 1, count: 5, turnNo: 3 }]);
  });

  test('Vórtice (Barba Negra): arms a shield; the next incoming shot is absorbed at once (no answer)', () => {
    let s = start(['blackbeard', 'strawHat'], { chain: true });
    const a = ok(E().reduce(s, { type: 'tech', p: 0, tech: 'vortex', target: {} }));
    assert.equal(a.state.pending, null);
    assert.equal(a.state.players[0].vortex, true);
    assert.deepEqual(a.events.map((e) => e.type), ['tech', 'turn']);
    assert.deepEqual(a.events[0].result, { tech: 'vortex' });
    // p1 fires on a ship cell of p0: absorbed, even with chain the turn passes, the cell stays untried
    const b = ok(E().reduce(a.state, { type: 'fire', p: 1, r: 1, c: 1 }));
    assert.equal(b.state.pending, null);
    assert.deepEqual(b.events.map((e) => e.type), ['fired', 'absorbed', 'resolved', 'turn']);
    assert.deepEqual(b.events[2].results, [{ r: 1, c: 1, result: 'absorvido' }]);
    assert.equal(b.state.players[0].vortex, false);
    assert.equal(b.state.players[0].marks[11], 0);
    assert.equal(b.state.turn, 0);
    assert.equal(b.state.players[1].stats.misses, 1);
    // the shield is consumed: the next shot lands
    let c = shoot(b.state, 0, 9, 9).state;
    c = shoot(c, 1, 1, 1);
    assert.equal(c.events.find((e) => e.type === 'resolved').results[0].result, 'acerto');
    // an attack technique is absorbed whole; an info technique passes through and keeps the shield
    s = start(['blackbeard', 'strawHat']);
    s = ok(E().reduce(s, { type: 'tech', p: 0, tech: 'vortex', target: {} })).state;
    const z = ok(E().reduce(s, { type: 'tech', p: 1, tech: 'bazooka', target: { r: 0, c: 0 } }));
    assert.deepEqual(z.events.map((e) => e.type), ['fired', 'absorbed', 'resolved', 'tech', 'turn']);
    assert.equal(z.events[3].result.absorbed, true);
    assert.equal(z.state.players[0].marks.filter(Boolean).length, 0);
    const s2 = start(['blackbeard', 'heart']);
    const armed = ok(E().reduce(s2, { type: 'tech', p: 0, tech: 'vortex', target: {} })).state;
    const room = tech(armed, 1, 'room', { axis: 'row', index: 1 });
    assert.equal(room.answer.result.count, 5);
    assert.equal(room.state.players[0].vortex, true);
  });

  test('Observação (Marinha): deterministic reveal of one unhit cell of a surviving ship (mark 4, still fireable)', () => {
    let s = start(['marine', 'strawHat']);
    const r = tech(s, 0, 'observation', {});
    const cand = [];
    for (const sh of sample().ships) for (const p of GLT.board.shipCells(sh)) cand.push(p);
    cand.sort((a, b) => a.r - b.r || a.c - b.c);
    const want = cand[GLT.rng.derive(s.seed, 'observation', 1).int(cand.length)];
    assert.deepEqual(r.answer.result, { tech: 'observation', cell: want });
    const k = want.r * 10 + want.c;
    assert.equal(r.state.players[1].marks[k], 4);
    assert.deepEqual(r.state.players[1].annotations, [{ tech: 'observation', r: want.r, c: want.c, turnNo: 1 }]);
    assert.ok(E().untried(r.state, 0).some((x) => x.r === want.r && x.c === want.c), 'revealed cell can still be fired at');
    // excludes hit cells and sunk ships
    s = start(['marine', 'strawHat'], { chain: true });
    s = shoot(s, 0, 6, 5).state; s = shoot(s, 0, 6, 6).state; s = shoot(s, 0, 1, 1).state; s = shoot(s, 0, 0, 0).state;
    s = shoot(s, 1, 9, 9).state;
    for (let i = 0; i < 20; i++) {
      const o = tech({ ...s, seed: GLT.rng.mix(s.seed, i) }, 0, 'observation', {}).answer.result.cell;
      assert.ok(!(o.r === 6 && (o.c === 5 || o.c === 6)) && !(o.r === 1 && o.c === 1), JSON.stringify(o));
    }
    // same state → same answer
    assert.deepEqual(tech(s, 0, 'observation', {}).answer, tech(s, 0, 'observation', {}).answer);
  });

  test('technique rules: Tático only, own crew technique, once per game, first action of the turn, costs a salvo', () => {
    const cls = start(['strawHat', 'marine'], { mode: 'classico' });
    assert.equal(E().legalTech(cls, 0, 'bazooka', { r: 0, c: 0 }), 'tech', 'Modo Clássico has no techniques');
    let s = start(['strawHat', 'marine']);
    assert.equal(E().legalTech(s, 0, 'tremor', { r: 0, c: 0 }), 'tech', "not this crew's technique");
    assert.equal(E().legalTech(s, 1, 'observation', {}), 'turn');
    s = tech(s, 0, 'bazooka', { r: 0, c: 0 }).state;
    s = shoot(s, 1, 9, 9).state;
    assert.equal(E().legalTech(s, 0, 'bazooka', { r: 4, c: 4 }), 'used', 'once per game');
    // chain: after a hit, a technique is no longer the first action
    let c = start(['strawHat', 'marine'], { chain: true });
    c = shoot(c, 0, 1, 1).state;
    assert.equal(c.turn, 0);
    assert.equal(E().legalTech(c, 0, 'bazooka', { r: 4, c: 4 }), 'tech');
    // salvo: a technique costs the whole salvo
    let sv = start(['heart', 'marine'], { salvo: true });
    assert.equal(sv.shotsLeft, 5);
    sv = tech(sv, 0, 'room', { axis: 'row', index: 3 }).state;
    assert.equal(sv.turn, 1);
    // pending blocks techniques
    const f = ok(E().reduce(start(['strawHat', 'marine']), { type: 'fire', p: 0, r: 0, c: 0 })).state;
    assert.equal(E().legalTech(f, 0, 'bazooka', { r: 4, c: 4 }), 'pending');
  });

  test('technique answers are validated (wrong shape / wrong target / lies vs known fleet)', () => {
    const s = start(['redHair', 'marine']);
    const a = ok(E().reduce(s, { type: 'tech', p: 0, tech: 'haki', target: { r: 9, c: 9 } })).state;
    assert.equal(E().reduce(a, { type: 'answer', p: 1, answer: { kind: 'tech', result: { tech: 'haki', r: 9, c: 9, found: true } } }).error, 'answer');
    assert.equal(E().reduce(a, { type: 'answer', p: 1, answer: { kind: 'tech', result: { tech: 'haki', r: 8, c: 9, found: false } } }).error, 'answer');
    assert.equal(E().reduce(a, { type: 'answer', p: 1, answer: { kind: 'shots', results: [] } }).error, 'answer');
    assert.equal(E().reduce(a, { type: 'answer', p: 1, answer: { kind: 'tech', result: { tech: 'room', axis: 'row', index: 0, count: 0 } } }).error, 'answer');
  });
}
