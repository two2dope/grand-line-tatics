// Contract: i18n core behaviour and the cross-area keys every builder relies on (ARCHITECTURE.md §12). Owner: architect.
export default function (test, { GLT, assert }) {
  const T = GLT.T, I = GLT.i18n, D = GLT.data;

  test('every i18n key referenced by GLT.data exists', () => {
    const keys = [];
    for (const s of Object.values(D.ships)) keys.push(s.nameKey);
    for (const c of Object.values(D.crews)) keys.push(c.nameKey, c.captainKey, ...c.officerKeys);
    for (const f of Object.values(D.formats)) keys.push(f.nameKey, f.descKey);
    for (const s of Object.values(D.seas)) keys.push(s.nameKey, s.descKey);
    for (const d of Object.values(D.difficulties)) keys.push(d.nameKey, d.descKey);
    for (const t of Object.values(D.techniques)) keys.push(t.nameKey, t.descKey);
    for (const r of D.reactions) keys.push('react.' + r);
    for (const tod of D.tods) keys.push('tod.' + tod);
    for (const m of D.viewModes) keys.push('camera.' + m);
    const missing = keys.filter((k) => !I.has(k));
    assert.deepEqual(missing, []);
  });

  test('taunts exist for every crew × situation, with variants', () => {
    const missing = [];
    for (const crew of D.crewOrder) for (const s of GLT.taunts.situations) {
      const { key } = GLT.taunts.pick(crew, s, GLT.rng.create(1));
      if (!I.has(key) || I.variants(key) < 2) missing.push(key);
    }
    assert.deepEqual(missing, []);
  });

  test('result calls, pvp reasons, a11y states and error keys exist', () => {
    const keys = ['result.agua', 'result.acerto', 'result.acerto.big', 'result.afundou', 'result.absorvido', 'call.shot', 'turn.mine',
      'plate.own', 'plate.enemy', 'app.title', 'app.subtitle', 'app.disclaimer', 'settings.lift', 'hud.fire', 'log.title', 'pvp.cheat',
      'pvp.opponent.away', 'error.webgl', 'nick.fallback', 'nick.format', 'nick.noun', 'nick.adj', 'ceremony.wanted', 'a11y.canvas',
      ...['no_runtime', 'no_db', 'no_identity', 'read_only'].map((r) => 'pvp.unavailable.' + r),
      ...['not_found', 'full', 'own_room', 'network', 'quota', 'denied', 'exists', 'unavailable', 'bad_code'].map((r) => 'pvp.err.' + r),
      ...[0, 1, 2, 3, 4].map((m) => 'a11y.state.' + m),
      ...['fleet', 'forfeit', 'timeout', 'cheat', 'absent'].map((r) => 'stats.reason.' + r)];
    assert.deepEqual(keys.filter((k) => !I.has(k)), []);
  });

  test('spec phrases render exactly', () => {
    assert.equal(T('result.agua'), 'Água!');
    assert.equal(T('result.acerto.big'), 'Acertou em cheio!');
    assert.equal(T('result.afundou', { ship: T('ship.goingMerry.name') }), 'Afundou o Going Merry!');
    assert.equal(T('turn.mine'), 'Sua vez, capitão!');
    assert.equal(T('call.shot', { cell: 'B7', result: { key: 'result.agua' } }), 'B7 — Água!');
    assert.equal(T('settings.lift'), 'Erguer cenário próximo');
    assert.equal(T('app.subtitle'), 'Batalha na Grand Line');
  });

  test('plurals, variants, nested keys and pt-BR formatting', () => {
    assert.equal(T('setup.remaining', { n: 1 }), 'Falta 1 navio');
    assert.equal(T('setup.remaining', { n: 3 }), 'Faltam 3 navios');
    assert.equal(T('taunt.strawHat.start', { v: 1 }), T('taunt.strawHat.start', { v: 3 }));
    assert.notEqual(T('taunt.strawHat.start', { v: 0 }), T('taunt.strawHat.start', { v: 1 }));
    assert.equal(I.berry(1500000000), '฿ 1.500.000.000');
    assert.equal(I.num(1234.5), '1.234,5');
    assert.equal(I.time(65000), '1:05');
    assert.equal(I.list(['Zoro', 'Nami', 'Sanji']), 'Zoro, Nami e Sanji');
    assert.match(I.pct(0.456), /^46\s?%$/);
    const line = GLT.rules.summary(GLT.rules.defaults()).map((l) => T(l.key, l.vars));
    assert.equal(line[0], 'Clássica 10×10 · 5 navios');
  });

  test('missing keys return the key and are recorded, never thrown', () => {
    const before = I.missing.length;
    assert.equal(T('nope.not.a.key'), 'nope.not.a.key');
    assert.equal(I.missing.length, before + 1);
    assert.ok(I.missing.includes('nope.not.a.key'));
  });

  test('dictionary has no mojibake or replacement characters', () => {
    const bad = [];
    const check = (k, v) => { if (/Ã.|Â|�/.test(v)) bad.push(k); };
    for (const [k, v] of Object.entries(I.dict)) {
      if (typeof v === 'string') check(k, v);
      else if (Array.isArray(v)) v.forEach((s) => check(k, s));
      else Object.values(v).forEach((s) => check(k, s));
    }
    assert.deepEqual(bad, []);
  });
}
