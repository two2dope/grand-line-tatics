import assert from 'node:assert/strict';
test('mulberry32 reproducible', () => {
  const a = GLT.rng.mulberry32(42), b = GLT.rng.mulberry32(42);
  const xs = Array.from({ length: 5 }, a), ys = Array.from({ length: 5 }, b);
  assert.deepStrictEqual(xs, ys);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
test('net sees logic', async () => { assert.equal(GLT.net.seqOf([1, 2, 3]), 3); });
assert.equal(typeof GLT.rng.mulberry32, 'function');
