/* GLT.rules: rules defaults, normalisation, format lookup, sea effects.
 * Area: logic. Contract: ARCHITECTURE.md §4, §5.7. Implemented by the architect. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  function defaults() {
    return { format: 'classica', series: 1, mode: 'classico', touch: true, chain: false, salvo: false, timer: 0, fog: false, sea: 'calmo' };
  }

  function normalize(partial) {
    const d = defaults();
    const p = partial || {};
    const D = GLT.data;
    return {
      format: D.formats[p.format] ? p.format : d.format,
      series: D.seriesLengths.indexOf(p.series) >= 0 ? p.series : d.series,
      mode: p.mode === 'tatico' ? 'tatico' : 'classico',
      touch: typeof p.touch === 'boolean' ? p.touch : d.touch,
      chain: typeof p.chain === 'boolean' ? p.chain : d.chain,
      salvo: typeof p.salvo === 'boolean' ? p.salvo : d.salvo,
      timer: D.timers.indexOf(p.timer) >= 0 ? p.timer : d.timer,
      fog: typeof p.fog === 'boolean' ? p.fog : d.fog,
      sea: D.seas[p.sea] ? p.sea : d.sea
    };
  }

  function format(rulesOrId) {
    const id = typeof rulesOrId === 'string' ? rulesOrId : (rulesOrId && rulesOrId.format);
    return GLT.data.formats[id] || GLT.data.formats.classica;
  }

  function size(rules) { return format(rules).size; }

  function shipsFor(rules) {
    const F = format(rules);
    return GLT.data.shipOrder.filter((id) => F.ships.indexOf(id) >= 0).map((id) => ({ id, len: GLT.data.ships[id].len }));
  }

  function techAllowed(rules) { return !!rules && rules.mode === 'tatico'; }
  function techFor(crew) { const c = GLT.data.crews[crew]; return c ? c.tech : null; }

  function seaEffect(rules) {
    if (!techAllowed(rules)) return null;
    const s = GLT.data.seas[rules.sea];
    return s ? s.effect : null;
  }

  function effectiveFog(rules) { return !!(rules && (rules.fog || seaEffect(rules) === 'fog')); }
  function shotsPerTurn(rules, afloat) { return rules && rules.salvo ? Math.max(1, afloat | 0) : 1; }

  function summary(rules) {
    const R = normalize(rules);
    const F = format(R);
    const lines = [
      { key: 'rules.summary.format', vars: { format: { key: F.nameKey }, size: F.size, ships: F.ships.length } },
      { key: 'rules.summary.series', vars: { n: R.series } },
      { key: R.mode === 'tatico' ? 'mode.tatico.name' : 'mode.classico.name' },
      { key: GLT.data.seas[R.sea].nameKey }
    ];
    if (!R.touch) lines.push({ key: 'rules.summary.noTouch' });
    if (R.chain) lines.push({ key: 'rules.chain' });
    if (R.salvo) lines.push({ key: 'rules.salvo' });
    if (R.timer) lines.push({ key: 'rules.summary.timer', vars: { n: R.timer } });
    if (effectiveFog(R)) lines.push({ key: 'rules.fog' });
    return lines;
  }

  GLT.rules = { defaults, normalize, format, size, shipsFor, techAllowed, techFor, seaEffect, effectiveFog, shotsPerTurn, summary };
})();
