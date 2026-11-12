// rules-core: seeded RNG (mulberry32), hashing, derive, and "no Math.random in rules".
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Reference mulberry32 (bryc), written independently of src/logic/rng.js.
function refMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function (test, ctx) {
  const { GLT } = ctx;

  test('create(seed) is exactly mulberry32', () => {
    for (const seed of [1, 7, 42, 123456789, 0xdeadbeef, 4294967295]) {
      const a = GLT.rng.create(seed), b = refMulberry32(seed);
      for (let i = 0; i < 1000; i++) assert.equal(a.next(), b());
    }
  });

  test('same seed → identical sequences; different seeds diverge', () => {
    const a = GLT.rng.create(99), b = GLT.rng.create(99), c = GLT.rng.create(100);
    const sa = [], sb = [], sc = [];
    for (let i = 0; i < 200; i++) { sa.push(a.next()); sb.push(b.next()); sc.push(c.next()); }
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, sc);
  });

  test('next/int/range/chance/pick/shuffle stay in range and are deterministic', () => {
    const r = GLT.rng.create(5);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) {
      const x = r.next(); assert.ok(x >= 0 && x < 1);
      const k = r.int(6); assert.ok(Number.isInteger(k) && k >= 0 && k < 6); counts[k]++;
      const y = r.range(-3, 2); assert.ok(y >= -3 && y < 2);
    }
    counts.forEach((n) => assert.ok(Math.abs(n - 10000) < 600, 'int(6) roughly uniform: ' + counts));
    let yes = 0;
    for (let i = 0; i < 10000; i++) if (r.chance(0.2)) yes++;
    assert.ok(yes > 1800 && yes < 2200);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) assert.ok(arr.includes(r.pick(arr)));
    const sh = GLT.rng.create(3).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(sh.slice().sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(GLT.rng.create(3).shuffle([1, 2, 3, 4, 5, 6, 7, 8]), sh);
  });

  test('state() and fork(label) are reproducible', () => {
    const a = GLT.rng.create(11), b = GLT.rng.create(11);
    a.next(); b.next();
    assert.equal(a.state(), b.state());
    const fa = a.fork('ai'), fb = b.fork('ai'), fc = b.fork('other');
    assert.equal(fa.next(), fb.next());
    assert.notEqual(GLT.rng.create(11).fork('ai').next(), fc.next());
  });

  test('derive(seed, ...labels) = create(mix(seed, ...labels)); mix is order-sensitive', () => {
    const d = GLT.rng.derive(77, 'gust', 3);
    const c = GLT.rng.create(GLT.rng.mix(77, 'gust', 3));
    for (let i = 0; i < 50; i++) assert.equal(d.next(), c.next());
    assert.notEqual(GLT.rng.mix(1, 'a', 2), GLT.rng.mix(1, 2, 'a'));
    assert.equal(GLT.rng.mix(1, 'a', 2), GLT.rng.mix(1, 'a', 2));
  });

  test('hashString / mix are frozen (PvP seeds and replays depend on them)', () => {
    // Regression lock: these values must never change.
    assert.equal(GLT.rng.hashString(''), GLT.rng.hashString(''));
    const snap = [GLT.rng.hashString('Grand Line'), GLT.rng.mix(1, '|', 2), GLT.rng.mix(123, 'game', 0), GLT.engine.coinToss(1)];
    assert.deepEqual(snap, [HASH_GRAND_LINE, MIX_1_2, MIX_123_GAME_0, COIN_1]);
    for (let i = 0; i < 100; i++) {
      const h = GLT.rng.hashString('x' + i);
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
    }
  });

  test('randomSeed() returns a uint32 (entropy for new matches only)', () => {
    const s = GLT.rng.randomSeed();
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
  });

  test('no Math.random anywhere in the rules-core files', () => {
    for (const f of ['rng.js', 'fleet.js', 'crews.js', 'rules.js', 'match.js', 'bounty.js']) {
      const src = fs.readFileSync(path.join(ctx.ROOT, 'legacy', 'src', 'logic', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
      assert.ok(!/Math\.random/.test(src), f + ' uses Math.random');
      assert.ok(!/Date\.now|performance\.now/.test(src) || f === 'rng.js', f + ' reads a clock');
    }
  });
}

const HASH_GRAND_LINE = 3916038552;
const MIX_1_2 = 1167841495;
const MIX_123_GAME_0 = 1247631053;
const COIN_1 = 0;
