// rules-core: rule toggles (touch, chain, salvo, timer, fog), series length, mode, sea effects, summary keys.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const R = () => GLT.rules;

  test('defaults match the contract', () => {
    assert.deepEqual(R().defaults(), { format: 'classica', series: 1, mode: 'classico', touch: true, chain: false, salvo: false, timer: 0, fog: false, sea: 'calmo' });
    assert.deepEqual(R().normalize(), R().defaults());
  });

  test('normalize keeps valid toggles and coerces invalid values to defaults', () => {
    const ok = { format: 'grandline', series: 5, mode: 'tatico', touch: false, chain: true, salvo: true, timer: 60, fog: true, sea: 'novomundo' };
    assert.deepEqual(R().normalize(ok), ok);
    for (const t of [0, 20, 30, 60]) assert.equal(R().normalize({ timer: t }).timer, t);
    for (const s of [1, 3, 5]) assert.equal(R().normalize({ series: s }).series, s);
    const bad = R().normalize({ format: 'huge', series: 2, mode: 'x', touch: 'yes', chain: 1, salvo: null, timer: 45, fog: 'on', sea: 'lago' });
    assert.deepEqual(bad, R().defaults());
  });

  test('salvo shots, technique permission and sea effects (Tático only)', () => {
    assert.equal(R().shotsPerTurn({ salvo: false }, 5), 1);
    assert.equal(R().shotsPerTurn({ salvo: true }, 5), 5);
    assert.equal(R().shotsPerTurn({ salvo: true }, 0), 1);
    assert.equal(R().techAllowed(R().normalize({ mode: 'tatico' })), true);
    assert.equal(R().techAllowed(R().normalize({})), false);
    const eff = { calmo: null, grandline: 'jitter', novomundo: 'fog', tempestade: 'gust' };
    for (const [sea, e] of Object.entries(eff)) {
      assert.equal(R().seaEffect(R().normalize({ mode: 'tatico', sea })), e);
      assert.equal(R().seaEffect(R().normalize({ mode: 'classico', sea })), null, 'Clássico: seas are visual only');
    }
  });

  test('summary() lines are i18n keys that exist and render PT-BR', () => {
    const all = R().normalize({ format: 'grandline', series: 3, mode: 'tatico', touch: false, chain: true, salvo: true, timer: 30, fog: true, sea: 'tempestade' });
    const lines = R().summary(all);
    assert.ok(lines.length >= 8);
    for (const l of lines) {
      assert.ok(GLT.i18n.has(l.key), l.key);
      assert.notEqual(GLT.T(l.key, l.vars), l.key);
    }
    assert.deepEqual(GLT.i18n.missing, []);
  });
}
