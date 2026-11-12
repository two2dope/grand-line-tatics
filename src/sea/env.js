/* Sea sandbox shims: the few pieces of our old app/ui core that the world modules read (GLT.T + GLT.i18n with only the
 * world's strings, GLT.board.label, GLT.prefs, GLT.app). Loaded inside the sandbox (see _enter.js). The bridge sets
 * prefs (lift, reduced motion) at call time. All player-visible text is PT-BR. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const dict = {
    'plate.own': 'Suas águas',
    'plate.enemy': 'Águas inimigas',
    'call.shot': '{cell} — {result}',
    'result.agua': 'Água!',
    'result.acerto': 'Acertou!',
    'result.afundou': 'Afundou!',
    'result.absorvido': 'Absorvido!',
    'denden.live': 'AO VIVO',
    'denden.lastShot': 'Último tiro',
    'denden.hits': 'Acertos',
    'denden.sunk': 'Afundados',
    'denden.timer': 'Tempo',
    'denden.turn': 'Vez de',
    'denden.waiting': 'Aguardando…',
    'denden.victory': 'VITÓRIA!',
    'crew.strawHat.name': 'Chapéus de Palha',
    'crew.whitebeard.name': 'Barba Branca',
    'crew.redHair.name': 'Cabelo Vermelho',
    'crew.heart.name': 'Piratas do Coração',
    'crew.blackbeard.name': 'Barba Negra',
    'crew.marine.name': 'Marinha',
    'react.boaMira': 'Boa mira!',
    'react.prepareSe': 'Prepare-se!',
    'react.gg': 'GG, capitão!',
    'react.uau': 'Uau!',
    'react.porPouco': 'Foi por pouco!',
    'react.obrigado': 'Valeu pela partida!',
    'a11y.canvas': 'Cena 3D da batalha naval'
  };

  let numFmt = null;
  function num(n) {
    try { if (!numFmt) numFmt = new Intl.NumberFormat('pt-BR'); return numFmt.format(n); } catch (e) { return String(n); }
  }
  function time(ms) {
    const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function fmtVar(v) {
    if (typeof v === 'number') return num(v);
    if (v && typeof v === 'object' && typeof v.key === 'string') return t(v.key, v.vars);
    return v == null ? '' : String(v);
  }
  function t(key, vars) {
    const val = dict[key];
    if (val === undefined) return '';
    if (!vars) return val;
    return val.replace(/\{(\w+)\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? fmtVar(vars[name]) : m));
  }
  function fontsReady() {
    try { if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) return document.fonts.ready.then(() => undefined); } catch (e) { /* ignore */ }
    return Promise.resolve();
  }

  GLT.i18n = { lang: 'pt-BR', dict, t, num, time, fontsReady };
  GLT.T = t;

  GLT.board = {
    rowLetter(r) { return String.fromCharCode(65 + r); },
    label(r, c) { return String.fromCharCode(65 + r) + String(c + 1); }
  };

  const prefs = { lift: true, reducedMotion: null };
  GLT.prefs = {
    get(k) { return prefs[k]; },
    set(k, v) { prefs[k] = v; },
    all() { return Object.assign({}, prefs); },
    reducedMotion() {
      if (prefs.reducedMotion != null) return !!prefs.reducedMotion;
      try { return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
    }
  };

  // Plates are positional in the game: player 0 (host) sails the -X plate ('own'), player 1 the +X plate ('enemy').
  GLT.app = {
    local() { return 0; },
    plateOf(p) { return p === 1 ? 'enemy' : 'own'; }
  };
})();
