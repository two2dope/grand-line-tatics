/* Ships kit: the few tables our voxel ship modules (render/voxel.js, ships/flags.js, ships/models.js) read from the
 * old architecture (GLT.C, GLT.data.ships/crews/shipOrder, GLT.layout.shipEnvelope) plus a private seeded RNG
 * (GLT.shipRng). The pilot owns GLT.rng (rules), so the ship models never touch it. Visual-only; no rules here.
 * Defines each table only when absent, so the legacy demo build (which ships the full tables) is unaffected. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  if (!GLT.C) {
    GLT.C = Object.freeze({ CELL: 4, SHIP_VOXEL: 0.25, SHIP_END_MARGIN: 0.25, SHIP_MAX_BEAM: 3.4, SHIP_MAX_H: 9, PLATE_Y: 0 });
  }

  if (!GLT.data) {
    const ship = (id, len, flag) => ({ id, len, flag });
    const crew = (id, primary, trim) => ({ id, flag: id, colors: { primary, secondary: '#fffbf0', trim } });
    GLT.data = {
      ships: {
        mobyDick: ship('mobyDick', 5, 'whitebeard'), thousandSunny: ship('thousandSunny', 4, 'strawHat'),
        oroJackson: ship('oroJackson', 4, 'roger'), redForce: ship('redForce', 3, 'redHair'),
        polarTang: ship('polarTang', 3, 'heart'), baratie: ship('baratie', 3, 'baratie'), goingMerry: ship('goingMerry', 2, 'strawHat')
      },
      shipOrder: ['mobyDick', 'thousandSunny', 'oroJackson', 'redForce', 'polarTang', 'baratie', 'goingMerry'],
      crews: {
        strawHat: crew('strawHat', '#e23b2e', '#e23b2e'), whitebeard: crew('whitebeard', '#eadfc4', '#eadfc4'),
        redHair: crew('redHair', '#9c1a3a', '#9c1a3a'), heart: crew('heart', '#f2c230', '#f2c230'),
        blackbeard: crew('blackbeard', '#3a2a4a', '#3a2a4a'), marine: crew('marine', '#2f6fd6', '#2f6fd6')
      },
      flags: ['strawHat', 'whitebeard', 'redHair', 'heart', 'blackbeard', 'marine', 'roger', 'baratie']
    };
  }

  if (!GLT.layout) GLT.layout = {};
  if (!GLT.layout.shipEnvelope) {
    GLT.layout.shipEnvelope = (len) => ({ length: len * GLT.C.CELL - 2 * GLT.C.SHIP_END_MARGIN, beam: GLT.C.SHIP_MAX_BEAM, height: GLT.C.SHIP_MAX_H });
  }

  // mulberry32 + FNV-1a/fmix (same algorithms as legacy GLT.rng), private to the ship visuals.
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function hashString(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return fmix(h >>> 0);
  }
  function create(seed) {
    let a = (seed >>> 0) || 0x6d2b79f5;
    const rng = {
      next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(n) { return Math.floor(rng.next() * n); },
      range(lo, hi) { return lo + rng.next() * (hi - lo); },
      chance(p) { return rng.next() < p; }
    };
    return rng;
  }
  GLT.shipRng = { create, hashString };
})();
