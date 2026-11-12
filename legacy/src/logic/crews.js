/* GLT._logic_crews: crew helpers over GLT.data.crews (captain, three officers, colours, technique, taunt keys).
 * Area: logic (private file). Piece: rules-core. Every name is an i18n key: resolve with GLT.T. Pure. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  function list() { return GLT.data.crewOrder.map((id) => GLT.data.crews[id]); }
  function get(id) { return GLT.data.crews[id] || null; }
  function isCrew(id) { return !!GLT.data.crews[id]; }

  // { nameKey, captainKey, officerKeys[3], tech, techNameKey, flag }
  function roster(id) {
    const c = get(id);
    if (!c) return null;
    return {
      id: c.id, nameKey: c.nameKey, captainKey: c.captainKey, officerKeys: c.officerKeys.slice(),
      tech: c.tech, techNameKey: GLT.data.techniques[c.tech].nameKey, flag: c.flag
    };
  }

  // Owner colours of a seat: in a mirror match (same crew both sides) player 1 uses colors.alt (§3).
  function colorsFor(player, crews) {
    const c = get(crews[player]);
    if (!c) return null;
    const mirror = crews[0] === crews[1];
    const src = mirror && player === 1 ? c.colors.alt : c.colors;
    return { primary: src.primary, secondary: src.secondary, trim: src.trim };
  }

  function tauntKey(crew, situation) { return 'taunt.' + crew + '.' + situation; }
  function tauntKeys(crew) { return GLT.taunts.situations.map((s) => tauntKey(crew, s)); }

  // CPU rival for PvC: a different crew, seeded.
  function rival(crew, rng) {
    const others = GLT.data.crewOrder.filter((id) => id !== crew);
    return rng ? rng.pick(others) : others[0];
  }

  GLT._logic_crews = { list, get, isCrew, roster, colorsFor, tauntKey, tauntKeys, rival };
})();
