// Ships area: headless checks of the shared Jolly Roger glyphs (src/ships/flags.js has no THREE/DOM at load or in glyph()).
import assert from 'node:assert/strict';
import path from 'node:path';

export default function (test, ctx) {
  function loadShips() {
    const pure = (ctx.files && ctx.files.pure) || [];
    const flags = [path.join(ctx.ROOT, 'src', 'ships', 'flags.js')];
    return ctx.loadFiles(pure.concat(flags));
  }

  test('every FlagId and every ship flag has a 13x11 glyph', () => {
    const G = loadShips();
    assert.deepEqual(G.__leaked, []);
    const ids = G.flags.ids();
    for (const f of G.data.flags) assert.ok(ids.includes(f), 'missing glyph ' + f);
    for (const id of G.data.shipOrder) assert.ok(ids.includes(G.data.ships[id].flag), 'ship flag ' + id);
    for (const f of ids) {
      const g = G.flags.glyph(f);
      assert.equal(g.rows.length, 11, f);
      for (const r of g.rows) assert.equal(r.length, 13, f + ' row "' + r + '"');
      assert.match(g.field, /^#[0-9a-f]{6}$/);
    }
  });

  test('glyphs are distinct and use only legend letters', () => {
    const G = loadShips();
    const seen = new Set();
    for (const f of G.flags.ids()) {
      const g = G.flags.glyph(f);
      const key = g.rows.join('/');
      assert.ok(!seen.has(key), 'duplicate glyph ' + f);
      seen.add(key);
      for (const r of g.rows) assert.match(r, /^[.wkyrsgbu]+$/, f);
    }
  });

  test('flag vs sail colouring: bone on a flag, ink outline + cream interior on a sail', () => {
    const G = loadShips();
    const flag = G.flags.glyph('strawHat', false), sail = G.flags.glyph('strawHat', true);
    // (6,7) is the nose hole 'k': field on a flag, ink on a sail
    assert.equal(flag.at(6, 7), null);
    assert.equal(sail.at(6, 7), '#1a1628');
    // (5,7) is skull bone inside the face: white on a flag, cloth (null) on a sail
    assert.equal(flag.at(5, 7), '#fffbf0');
    assert.equal(sail.at(5, 7), null);        // inside the face: the cream sail shows through
    assert.equal(sail.at(3, 7), '#1a1628');   // left edge of the skull: ink outline
    // the straw hat keeps its colours on both
    assert.equal(flag.at(6, 0), sail.at(6, 0));
    assert.equal(flag.at(6, 2), '#bc302e');
  });
}
