// rules-core: six crews with captain, three officers, colours, signature technique and PT-BR taunt keys.
import assert from 'node:assert/strict';

export default function (test, ctx) {
  const { GLT } = ctx;
  const CR = () => GLT._logic_crews;

  test('six crews in order, each with its SPEC technique', () => {
    assert.deepEqual(CR().list().map((c) => [c.id, c.tech]), [
      ['strawHat', 'bazooka'], ['whitebeard', 'tremor'], ['redHair', 'haki'],
      ['heart', 'room'], ['blackbeard', 'vortex'], ['marine', 'observation']
    ]);
    for (const c of CR().list()) {
      assert.equal(GLT.rules.techFor(c.id), c.tech);
      assert.equal(GLT.data.techniques[c.tech].crew, c.id);
    }
  });

  test('captain + three officers + crew name resolve to PT-BR text', () => {
    const want = {
      strawHat: ['Chapéus de Palha', 'Monkey D. Luffy'], whitebeard: ['Barba Branca', 'Edward Newgate'],
      redHair: ['Cabelo Vermelho', 'Shanks'], heart: ['Piratas do Coração', 'Trafalgar D. Water Law'],
      blackbeard: ['Barba Negra', 'Marshall D. Teach'], marine: ['Marinha', 'Monkey D. Garp']
    };
    for (const id of GLT.data.crewOrder) {
      const r = CR().roster(id);
      assert.equal(GLT.T(r.nameKey), want[id][0]);
      assert.equal(GLT.T(r.captainKey), want[id][1]);
      assert.equal(r.officerKeys.length, 3);
      r.officerKeys.forEach((k) => assert.ok(GLT.i18n.has(k), k));
      assert.ok(GLT.i18n.has(r.techNameKey), r.techNameKey);
    }
    assert.deepEqual(GLT.i18n.missing, []);
  });

  test('colours are #rrggbb; mirror match gives player 1 the alt colours', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const c of CR().list()) {
      for (const k of ['primary', 'secondary', 'trim']) { assert.match(c.colors[k], hex); assert.match(c.colors.alt[k], hex); }
      assert.notEqual(c.colors.trim, c.colors.alt.trim);
    }
    assert.deepEqual(CR().colorsFor(1, ['strawHat', 'marine']), { primary: '#2f6fd6', secondary: '#f4f4f4', trim: '#2f6fd6' });
    const mirror = ['heart', 'heart'];
    assert.equal(CR().colorsFor(0, mirror).trim, GLT.data.crews.heart.colors.trim);
    assert.equal(CR().colorsFor(1, mirror).trim, GLT.data.crews.heart.colors.alt.trim);
  });

  test('every crew has PT-BR taunts for every situation (with variants)', () => {
    for (const id of GLT.data.crewOrder) {
      const keys = CR().tauntKeys(id);
      assert.equal(keys.length, GLT.taunts.situations.length);
      for (const k of keys) {
        assert.ok(GLT.i18n.has(k), k);
        assert.ok(GLT.i18n.variants(k) >= 1, k);
        assert.notEqual(GLT.T(k, { v: 0 }), k);
      }
    }
  });

  test('rival() never returns the player crew and is seeded', () => {
    for (const id of GLT.data.crewOrder) {
      for (let i = 0; i < 30; i++) assert.notEqual(CR().rival(id, GLT.rng.create(i)), id);
      assert.equal(CR().rival(id, GLT.rng.create(4)), CR().rival(id, GLT.rng.create(4)));
    }
  });
}
