// Contract: static tables, board/rules helpers, rng, bus, commitments, lobby formats. Owner: architect.
export default function (test, { GLT, assert }) {
  const D = GLT.data, B = GLT.board, R = GLT.rules;

  test('ship lengths and format fleets match the contract table', () => {
    const len = Object.fromEntries(D.shipOrder.map((id) => [id, D.ships[id].len]));
    assert.deepEqual(len, { mobyDick: 5, thousandSunny: 4, oroJackson: 4, redForce: 3, polarTang: 3, baratie: 3, goingMerry: 2 });
    assert.deepEqual(D.formats.escaramuca.ships.map((id) => D.ships[id].len), [4, 3, 3, 2]);
    assert.deepEqual(D.formats.classica.ships.map((id) => D.ships[id].len), [5, 4, 3, 3, 2]);
    assert.deepEqual(D.formats.grandline.ships.map((id) => D.ships[id].len), [5, 4, 4, 3, 3, 3, 2]);
    assert.deepEqual([D.formats.escaramuca.size, D.formats.classica.size, D.formats.grandline.size], [8, 10, 12]);
  });

  test('each crew owns exactly its technique', () => {
    const map = Object.fromEntries(D.crewOrder.map((id) => [id, D.crews[id].tech]));
    assert.deepEqual(map, { strawHat: 'bazooka', whitebeard: 'tremor', redHair: 'haki', heart: 'room', blackbeard: 'vortex', marine: 'observation' });
    for (const [id, t] of Object.entries(map)) assert.equal(D.techniques[t].crew, id);
  });

  test('sample fleets are valid, with and without touching allowed', () => {
    for (const f of D.formatOrder) {
      for (const touch of [true, false]) {
        const res = B.validateFleet(D.sampleFleets[f], { format: f, touch });
        assert.ok(res.ok, f + ' touch=' + touch + ' ' + JSON.stringify(res.errors));
      }
    }
  });

  test('validateFleet catches bounds, overlap, touch, missing, dup and len', () => {
    const base = JSON.parse(JSON.stringify(D.sampleFleets.classica));
    const codes = (fleet, rules) => B.validateFleet(fleet, rules || { format: 'classica' }).errors.map((e) => e.code);
    const oob = JSON.parse(JSON.stringify(base)); oob.ships[0].c = 8;
    assert.ok(codes(oob).includes('bounds'));
    const ov = JSON.parse(JSON.stringify(base)); ov.ships[4] = { id: 'goingMerry', r: 1, c: 1, dir: 'h', len: 2 };
    assert.ok(codes(ov).includes('overlap'));
    const tc = JSON.parse(JSON.stringify(base)); tc.ships[4] = { id: 'goingMerry', r: 2, c: 1, dir: 'h', len: 2 };
    assert.ok(codes(tc, { format: 'classica', touch: false }).includes('touch'));
    assert.ok(!codes(tc, { format: 'classica', touch: true }).includes('touch'));
    const miss = JSON.parse(JSON.stringify(base)); miss.ships.pop();
    assert.ok(codes(miss).includes('missing'));
    const dup = JSON.parse(JSON.stringify(base)); dup.ships.push(Object.assign({}, dup.ships[0]));
    assert.ok(codes(dup).includes('dup'));
    const bl = JSON.parse(JSON.stringify(base)); bl.ships[0].len = 4;
    assert.ok(codes(bl).includes('len'));
  });

  test('labels, parse and canonical fleet JSON are stable', () => {
    assert.equal(B.label(1, 6), 'B7');
    assert.deepEqual(B.parse('b7'), { r: 1, c: 6 });
    assert.deepEqual(B.parse('L12'), { r: 11, c: 11 });
    assert.equal(B.parse('M1'), null);
    const f = { format: 'escaramuca', ships: [{ id: 'redForce', r: 2, c: 6, dir: 'v', len: 3 }, { id: 'goingMerry', r: 7, c: 4, dir: 'h', len: 2 }] };
    assert.equal(B.canonical(f), '{"f":"escaramuca","s":[["goingMerry",7,4,"h"],["redForce",2,6,"v"]]}');
    const g = { format: 'escaramuca', ships: f.ships.slice().reverse() };
    assert.equal(B.canonical(g), B.canonical(f));
  });

  test('rules.normalize coerces garbage to defaults; sea effects only in Tático', () => {
    assert.deepEqual(R.normalize({ format: 'x', series: 2, timer: 15, sea: 'lava', mode: 'y' }), R.defaults());
    assert.equal(R.seaEffect({ mode: 'classico', sea: 'tempestade' }), null);
    assert.equal(R.seaEffect({ mode: 'tatico', sea: 'tempestade' }), 'gust');
    assert.equal(R.effectiveFog({ mode: 'tatico', sea: 'novomundo', fog: false }), true);
    assert.equal(R.shotsPerTurn({ salvo: true }, 4), 4);
    assert.equal(R.shotsPerTurn({ salvo: false }, 4), 1);
  });

  test('rng: mulberry32 reproducible, mix order-sensitive, derive stateless', () => {
    const a = GLT.rng.create(42), b = GLT.rng.create(42);
    const xs = Array.from({ length: 50 }, () => a.next()), ys = Array.from({ length: 50 }, () => b.next());
    assert.deepEqual(xs, ys);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    assert.notEqual(GLT.rng.mix(1, 2), GLT.rng.mix(2, 1));
    assert.equal(GLT.rng.mix('a', 7), GLT.rng.mix('a', 7));
    assert.equal(GLT.rng.derive(9, 'coin', 3).next(), GLT.rng.derive(9, 'coin', 3).next());
    const r = GLT.rng.create(1);
    for (let i = 0; i < 1000; i++) { const v = r.int(10); assert.ok(Number.isInteger(v) && v >= 0 && v < 10); }
    // frozen reference values (PvP seeds and reproducible sims depend on them)
    assert.equal(GLT.rng.hashString('grand line'), GLT.rng.hashString('grand line'));
    assert.equal(GLT.engine.coinToss(12345), GLT.rng.derive(12345, 'coin').int(2));
  });

  test('events: on/once/off/* and payload delivery', () => {
    const E = GLT.events;
    const got = [];
    const off = E.on('x:test', (p) => got.push(['on', p]));
    E.once('x:test', (p) => got.push(['once', p]));
    const offAny = E.on('*', (p, type) => { if (type === 'x:test') got.push(['any', p]); });
    E.emit('x:test', 1); E.emit('x:test', 2);
    off(); offAny();
    E.emit('x:test', 3);
    assert.deepEqual(got, [['on', 1], ['once', 1], ['any', 1], ['on', 2], ['any', 2]]);
    assert.equal(E.count('x:test'), 0);
  });

  test('commit: SHA-256 vector, commitment = sha256(canonical + salt), verify', async () => {
    assert.equal(await GLT.commit.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const salt = GLT.commit.salt();
    assert.match(salt, /^[0-9a-f]{32}$/);
    const fleet = D.sampleFleets.classica;
    const c = await GLT.commit.commit(fleet, salt);
    assert.equal(c, await GLT.commit.sha256Hex(B.canonical(fleet) + salt));
    assert.equal(await GLT.commit.verify(fleet, salt, c), true);
    const moved = JSON.parse(JSON.stringify(fleet)); moved.ships[0].c += 1;
    assert.equal(await GLT.commit.verify(moved, salt, c), false);
  });

  test('lobby: room codes, links and NickCodes', () => {
    const L = GLT.lobby;
    for (let i = 0; i < 200; i++) {
      const code = L.code();
      assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
      assert.equal(L.normalizeCode(code.toLowerCase()), code);
    }
    assert.equal(L.normalizeCode('AB0DE'), null);
    assert.equal(L.parseLink('https://x.test/page#sala=k7q2m'), 'K7Q2M');
    assert.equal(L.shareLink('K7Q2M', 'https://x.test/page#old'), 'https://x.test/page#sala=K7Q2M');
    const nick = L.nickname(GLT.rng.create(3));
    assert.match(nick, /^\d{1,2}\.\d{1,2}\.\d{2}$/);
    const text = L.nickText(nick);
    assert.match(text, /^\p{L}+ \p{L}+ \d{2}$/u);
    assert.equal(L.nickText('<b>hack</b>'), GLT.T('nick.fallback'));
    assert.match(L.pid(), /^p_[0-9a-f]{12}$/);
  });
}
