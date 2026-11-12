/* GLT._logic_fleet: fleet definitions per board and fleet placement (random / edge-aware / spread).
 * Area: logic (private file). Piece: rules-core. Uses GLT.data/GLT.rules/GLT.board at call time only.
 * GLT.ai.placeFleet(rules, style, rng) can delegate to GLT._logic_fleet.place(rules, style, rng).
 * Pure and seeded: all randomness comes from the Rng passed in. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const STYLES = ['random', 'edge', 'spread'];

  // Ship definitions of a board in GLT.data.shipOrder: [{id, len, nameKey, flag}].
  function defs(rulesOrFormat) {
    return GLT.rules.shipsFor(typeof rulesOrFormat === 'string' ? { format: rulesOrFormat } : rulesOrFormat)
      .map((s) => ({ id: s.id, len: s.len, nameKey: GLT.data.ships[s.id].nameKey, flag: GLT.data.ships[s.id].flag }));
  }

  function totalCells(rulesOrFormat) { return defs(rulesOrFormat).reduce((a, s) => a + s.len, 0); }

  function normalize(fleet) {
    const order = GLT.data.shipOrder;
    return {
      format: String(fleet && fleet.format),
      ships: ((fleet && fleet.ships) || []).map((s) => ({ id: s.id, r: s.r | 0, c: s.c | 0, dir: s.dir === 'v' ? 'v' : 'h', len: GLT.data.ships[s.id] ? GLT.data.ships[s.id].len : s.len | 0 }))
        .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    };
  }

  function rotate(ship) { return { id: ship.id, r: ship.r, c: ship.c, dir: ship.dir === 'h' ? 'v' : 'h', len: ship.len }; }

  // Cells a new ship may not use: occupied ones, plus their 8 neighbours when ships may not touch.
  function blocked(ships, n, touch) {
    const out = new Uint8Array(n * n);
    for (const s of ships) {
      for (const p of GLT.board.shipCells(s)) {
        if (touch) { if (GLT.board.inBounds(p.r, p.c, n)) out[p.r * n + p.c] = 1; continue; }
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const r = p.r + dr, c = p.c + dc;
          if (GLT.board.inBounds(r, c, n)) out[r * n + c] = 1;
        }
      }
    }
    return out;
  }

  // Every legal placement of ship `def` next to `ships` (equivalent to GLT.board.canPlace, but batched).
  function candidates(ships, def, rules) {
    const R = GLT.rules.normalize(rules);
    const n = GLT.rules.size(R);
    const others = ships.filter((s) => s.id !== def.id);
    const blk = blocked(others, n, R.touch);
    const out = [];
    for (const dir of ['h', 'v']) {
      const maxR = dir === 'v' ? n - def.len : n - 1;
      const maxC = dir === 'h' ? n - def.len : n - 1;
      for (let r = 0; r <= maxR; r++) {
        for (let c = 0; c <= maxC; c++) {
          let ok = true;
          for (let i = 0; i < def.len && ok; i++) {
            const rr = dir === 'v' ? r + i : r, cc = dir === 'h' ? c + i : c;
            if (blk[rr * n + cc]) ok = false;
          }
          if (ok) out.push({ id: def.id, r, c, dir, len: def.len });
        }
      }
    }
    return out;
  }

  function onEdge(ship, n) {
    return GLT.board.shipCells(ship).some((p) => p.r === 0 || p.c === 0 || p.r === n - 1 || p.c === n - 1);
  }

  function weighted(cands, weights, rng) {
    let total = 0;
    for (const w of weights) total += w;
    let x = rng.next() * total;
    for (let i = 0; i < cands.length; i++) { x -= weights[i]; if (x < 0) return cands[i]; }
    return cands[cands.length - 1];
  }

  // Minimum Chebyshev distance from the ship's cells to any placed ship cell (Infinity when none).
  function clearance(ship, placed) {
    let best = Infinity;
    for (const a of GLT.board.shipCells(ship)) {
      for (const s of placed) for (const b of GLT.board.shipCells(s)) {
        const d = Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
        if (d < best) best = d;
      }
    }
    return best;
  }

  function choose(style, cands, placed, n, rng) {
    if (style === 'edge') {
      // Edge-aware: hug the rim about 2/3 of the time (hunters sweep the middle first), never only the rim.
      return weighted(cands, cands.map((s) => (onEdge(s, n) ? 4 : 1)), rng);
    }
    if (style === 'spread') {
      if (!placed.length) return rng.pick(cands);
      const scores = cands.map((s) => Math.min(clearance(s, placed), n));
      const top = Math.max.apply(null, scores);
      const band = cands.filter((s, i) => scores[i] >= top - 1);
      return rng.pick(band);
    }
    return rng.pick(cands);
  }

  // Exhaustive deterministic fallback (only reached if the greedy pass keeps failing; never in practice).
  function backtrack(list, rules, rng) {
    const placed = [];
    const go = (i) => {
      if (i === list.length) return true;
      const cands = rng.shuffle(candidates(placed, list[i], rules));
      for (const s of cands) {
        placed.push(s);
        if (go(i + 1)) return true;
        placed.pop();
      }
      return false;
    };
    return go(0) ? placed : null;
  }

  // A valid fleet for the rules (always), placed in the given style with the given seeded Rng.
  function place(rules, style, rng) {
    const R = GLT.rules.normalize(rules);
    const n = GLT.rules.size(R);
    const st = STYLES.indexOf(style) >= 0 ? style : 'random';
    const list = defs(R).sort((a, b) => b.len - a.len || GLT.data.ships[a.id].order - GLT.data.ships[b.id].order);
    for (let attempt = 0; attempt < 64; attempt++) {
      const placed = [];
      let ok = true;
      for (const d of list) {
        const cands = candidates(placed, d, R);
        if (!cands.length) { ok = false; break; }
        placed.push(choose(st, cands, placed, n, rng));
      }
      if (ok) return normalize({ format: R.format, ships: placed });
    }
    const placed = backtrack(list, R, rng);
    if (!placed) throw new Error('GLT._logic_fleet.place: no valid placement exists');
    return normalize({ format: R.format, ships: placed });
  }

  function sample(format) { return normalize(GLT.data.sampleFleets[format] || GLT.data.sampleFleets.classica); }

  function isValid(fleet, rules) { return GLT.board.validateFleet(fleet, rules).ok; }

  GLT._logic_fleet = { STYLES, defs, totalCells, normalize, rotate, blocked, candidates, onEdge, clearance, place, sample, isValid };
})();
