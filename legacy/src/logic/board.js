/* GLT.board: coordinates, labels, placement validation, canonical fleet JSON.
 * Area: logic. Contract: ARCHITECTURE.md §4, §5.6. Implemented by the architect;
 * canonical() is used for PvP commitments, so its output format is frozen. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const LETTERS = 'ABCDEFGHIJKL';

  function rowLetter(r) { return LETTERS.charAt(r) || '?'; }
  function label(r, c) { return rowLetter(r) + String(c + 1); }

  function parse(text) {
    const m = /^\s*([A-La-l])\s*(1[0-2]|[1-9])\s*$/.exec(String(text || ''));
    if (!m) return null;
    return { r: LETTERS.indexOf(m[1].toUpperCase()), c: parseInt(m[2], 10) - 1 };
  }

  function idx(r, c, n) { return r * n + c; }
  function inBounds(r, c, n) { return r >= 0 && c >= 0 && r < n && c < n; }

  function shipCells(ship) {
    const out = [];
    for (let i = 0; i < ship.len; i++) {
      out.push(ship.dir === 'v' ? { r: ship.r + i, c: ship.c } : { r: ship.r, c: ship.c + i });
    }
    return out;
  }

  function fits(ship, n) {
    if (!ship || !Number.isInteger(ship.r) || !Number.isInteger(ship.c) || !(ship.len > 0)) return false;
    if (ship.dir !== 'h' && ship.dir !== 'v') return false;
    return shipCells(ship).every((p) => inBounds(p.r, p.c, n));
  }

  function occupancy(fleet, n) {
    const occ = new Array(n * n).fill(null);
    for (const s of (fleet && fleet.ships) || []) {
      for (const p of shipCells(s)) if (inBounds(p.r, p.c, n)) occ[idx(p.r, p.c, n)] = s.id;
    }
    return occ;
  }

  function neighbors4(r, c, n) {
    return [{ r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }].filter((p) => inBounds(p.r, p.c, n));
  }

  function emptyFleet(format) { return { format, ships: [] }; }

  // Validates a full fleet against rules: correct ship set, lengths, bounds, overlap, touching.
  function validateFleet(fleet, rules) {
    const R = GLT.rules.normalize(rules);
    const F = GLT.rules.format(R);
    const n = F.size;
    const errors = [];
    if (!fleet || !Array.isArray(fleet.ships)) return { ok: false, errors: [{ shipId: null, code: 'format' }] };
    if (fleet.format !== F.id) errors.push({ shipId: null, code: 'format' });
    const seen = new Set();
    for (const s of fleet.ships) {
      if (!s || !GLT.data.ships[s.id]) { errors.push({ shipId: s && s.id || null, code: 'extra' }); continue; }
      if (seen.has(s.id)) { errors.push({ shipId: s.id, code: 'dup' }); continue; }
      seen.add(s.id);
      if (F.ships.indexOf(s.id) < 0) errors.push({ shipId: s.id, code: 'extra' });
      if (s.len !== GLT.data.ships[s.id].len) errors.push({ shipId: s.id, code: 'len' });
      else if (!fits(s, n)) errors.push({ shipId: s.id, code: 'bounds' });
    }
    for (const id of F.ships) if (!seen.has(id)) errors.push({ shipId: id, code: 'missing' });
    // overlap / touch (only between ships that are themselves in bounds)
    const placed = fleet.ships.filter((s) => s && GLT.data.ships[s.id] && fits(s, n));
    const owner = new Array(n * n).fill(-1);
    placed.forEach((s, i) => {
      for (const p of shipCells(s)) {
        const k = idx(p.r, p.c, n);
        if (owner[k] >= 0) errors.push({ shipId: s.id, code: 'overlap' });
        else owner[k] = i;
      }
    });
    if (!R.touch) {
      placed.forEach((s, i) => {
        let touched = false;
        for (const p of shipCells(s)) {
          for (let dr = -1; dr <= 1 && !touched; dr++) {
            for (let dc = -1; dc <= 1 && !touched; dc++) {
              const rr = p.r + dr, cc = p.c + dc;
              if (!inBounds(rr, cc, n)) continue;
              const o = owner[idx(rr, cc, n)];
              if (o >= 0 && o !== i) touched = true;
            }
          }
        }
        if (touched) errors.push({ shipId: s.id, code: 'touch' });
      });
    }
    return { ok: errors.length === 0, errors };
  }

  // Can `ship` be placed (replacing any ship with the same id) without bounds/overlap/touch errors?
  function canPlace(fleet, ship, rules) {
    const R = GLT.rules.normalize(rules);
    const n = GLT.rules.size(R);
    if (!fits(ship, n)) return false;
    const others = ((fleet && fleet.ships) || []).filter((s) => s.id !== ship.id);
    const occ = occupancy({ ships: others }, n);
    for (const p of shipCells(ship)) {
      if (occ[idx(p.r, p.c, n)] !== null) return false;
      if (!R.touch) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = p.r + dr, cc = p.c + dc;
            if (inBounds(rr, cc, n) && occ[idx(rr, cc, n)] !== null) return false;
          }
        }
      }
    }
    return true;
  }

  // Frozen format: JSON of {f: format, s: [[id,r,c,dir], ...sorted by id]}.
  function canonical(fleet) {
    const s = ((fleet && fleet.ships) || [])
      .map((x) => [String(x.id), x.r | 0, x.c | 0, x.dir === 'v' ? 'v' : 'h'])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return JSON.stringify({ f: String(fleet && fleet.format), s });
  }

  GLT.board = {
    rowLetter, label, parse, idx, inBounds, shipCells, fits, occupancy,
    validateFleet, canPlace, emptyFleet, canonical, neighbors4
  };
})();
