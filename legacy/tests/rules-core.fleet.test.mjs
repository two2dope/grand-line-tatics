// rules-core: board/fleet definitions, placement validation, random/edge-aware/spread placement.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const F = () => GLT._logic_fleet;
  const N = ctx.quick ? 60 : 300;

  test('the three boards have the exact series ships, lengths and sizes', () => {
    const want = {
      escaramuca: { size: 8, ships: [['thousandSunny', 4], ['redForce', 3], ['polarTang', 3], ['goingMerry', 2]] },
      classica: { size: 10, ships: [['mobyDick', 5], ['thousandSunny', 4], ['redForce', 3], ['polarTang', 3], ['goingMerry', 2]] },
      grandline: { size: 12, ships: [['mobyDick', 5], ['thousandSunny', 4], ['oroJackson', 4], ['redForce', 3], ['polarTang', 3], ['baratie', 3], ['goingMerry', 2]] }
    };
    for (const [fmt, w] of Object.entries(want)) {
      assert.equal(GLT.rules.size({ format: fmt }), w.size);
      assert.deepEqual(F().defs(fmt).map((d) => [d.id, d.len]), w.ships);
      F().defs(fmt).forEach((d) => { assert.equal(d.nameKey, 'ship.' + d.id + '.name'); assert.ok(GLT.i18n.has(d.nameKey), d.nameKey); });
    }
    assert.equal(F().totalCells('escaramuca'), 12);
    assert.equal(F().totalCells('classica'), 17);
    assert.equal(F().totalCells('grandline'), 24);
  });

  test('validateFleet reports bounds / overlap / touch / missing / extra / dup / len / format', () => {
    const R = GLT.rules.normalize({ format: 'classica' });
    const base = () => JSON.parse(JSON.stringify(GLT.data.sampleFleets.classica));
    const codes = (f, r) => GLT.board.validateFleet(f, r || R).errors.map((e) => e.code).sort();
    assert.deepEqual(codes(base()), []);
    let f = base(); f.ships[0].c = 8;                    // Moby Dick (5) from column 9 → off the board
    assert.ok(codes(f).includes('bounds'));
    f = base(); f.ships[1] = Object.assign({}, f.ships[1], { r: 1, c: 2, dir: 'h' });   // onto Moby Dick
    assert.ok(codes(f).includes('overlap'));
    f = base(); f.ships.pop();
    assert.ok(codes(f).includes('missing'));
    f = base(); f.ships.push({ id: 'oroJackson', r: 9, c: 0, dir: 'h', len: 4 });
    assert.ok(codes(f).includes('extra'));
    f = base(); f.ships.push(Object.assign({}, f.ships[0]));
    assert.ok(codes(f).includes('dup'));
    f = base(); f.ships[0].len = 4;
    assert.ok(codes(f).includes('len'));
    f = base(); f.format = 'grandline';
    assert.ok(codes(f).includes('format'));
    // touching: allowed by default, rejected with touch:false
    f = base(); f.ships[4] = { id: 'goingMerry', r: 2, c: 1, dir: 'h', len: 2 };          // right under Moby Dick
    assert.deepEqual(codes(f), []);
    assert.ok(codes(f, GLT.rules.normalize({ format: 'classica', touch: false })).includes('touch'));
    f = base(); f.ships[4] = { id: 'goingMerry', r: 2, c: 6, dir: 'h', len: 2 };          // diagonal touch at (2,6)/(1,5)
    assert.ok(codes(f, GLT.rules.normalize({ format: 'classica', touch: false })).includes('touch'));
  });

  test('candidates() matches board.canPlace exactly (touch on and off)', () => {
    for (const touch of [true, false]) {
      const R = GLT.rules.normalize({ format: 'classica', touch });
      const fleet = { format: 'classica', ships: GLT.data.sampleFleets.classica.ships.slice(0, 3) };
      const def = { id: 'goingMerry', len: 2 };
      const got = F().candidates(fleet.ships, def, R).map((s) => s.dir + s.r + ',' + s.c).sort();
      const want = [];
      for (const dir of ['h', 'v']) for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        if (GLT.board.canPlace(fleet, { id: 'goingMerry', r, c, dir, len: 2 }, R)) want.push(dir + r + ',' + c);
      }
      assert.deepEqual(got, want.sort());
    }
  });

  test('placement is always valid for every board × touch × style, and seeded', () => {
    for (const format of GLT.data.formatOrder) {
      for (const touch of [true, false]) {
        const R = GLT.rules.normalize({ format, touch });
        for (const style of F().STYLES) {
          for (let i = 0; i < N; i++) {
            const fl = F().place(R, style, GLT.rng.create(GLT.rng.mix(i, format, style, touch ? 1 : 0)));
            const v = GLT.board.validateFleet(fl, R);
            assert.ok(v.ok, format + '/' + style + '/' + touch + ' seed ' + i + ': ' + JSON.stringify(v.errors));
          }
          const a = F().place(R, style, GLT.rng.create(7)), b = F().place(R, style, GLT.rng.create(7));
          assert.deepEqual(a, b, 'same seed → same fleet');
          assert.notDeepEqual(F().place(R, style, GLT.rng.create(8)), a);
        }
      }
    }
  });

  test('edge-aware placement hugs the rim more than random; spread keeps ships further apart', () => {
    const R = GLT.rules.normalize({ format: 'classica' });
    const n = 10;
    const measure = (style) => {
      let edge = 0, gap = 0, ships = 0;
      for (let i = 0; i < N; i++) {
        const fl = F().place(R, style, GLT.rng.create(1000 + i));
        fl.ships.forEach((s, k) => {
          ships++;
          if (F().onEdge(s, n)) edge++;
          gap += F().clearance(s, fl.ships.filter((_, j) => j !== k));
        });
      }
      return { edge: edge / ships, gap: gap / ships };
    };
    const rnd = measure('random'), edg = measure('edge'), spr = measure('spread');
    assert.ok(edg.edge > rnd.edge + 0.1, 'edge ' + edg.edge + ' vs random ' + rnd.edge);
    assert.ok(spr.gap > rnd.gap + 0.5, 'spread gap ' + spr.gap + ' vs random ' + rnd.gap);
    ctx.report('placement', { random: rnd, edge: edg, spread: spr });
  });

  test('rotate / normalize / sample helpers', () => {
    assert.deepEqual(F().rotate({ id: 'redForce', r: 1, c: 2, dir: 'h', len: 3 }), { id: 'redForce', r: 1, c: 2, dir: 'v', len: 3 });
    const shuffled = { format: 'classica', ships: GLT.data.sampleFleets.classica.ships.slice().reverse() };
    assert.deepEqual(F().normalize(shuffled), F().sample('classica'));
    for (const fmt of GLT.data.formatOrder) assert.ok(F().isValid(F().sample(fmt), { format: fmt }));
  });
}
