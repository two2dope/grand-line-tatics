/**
 * Grand Line Tactics — AI Opponents & Probability Engine (`GLT.ai`)
 * Pure-JS, deterministic AI module supporting 4 difficulty tiers:
 *   - 'grumete': pure uniform random untried cell selection (85–98 mean shots on 10x10).
 *   - 'marujo': hunt/target with collinear tracking (55–70 mean shots on 10x10).
 *   - 'capitao': parity stride matching min ship length + collinear target + tactical play (between marujo and yonkou).
 *   - 'yonkou': full probability-density solver + allowTouch dead-water exclusion + cross-series bias weights (40–55 mean shots on 10x10).
 *
 * Also provides:
 *   - `computeProbabilityGrid()` for placement density estimation.
 *   - `getLogPoseHint()` for in-game 3x3 directional hints (wired to GLT.T).
 *   - `createSeriesMemory()` for Bo3/Bo5 cross-game opponent placement learning.
 *
 * NEVER touches DOM or THREE. NEVER uses Math.random().
 * Uses GLT.T (src/logic/i18n.js) for all localized strings and taunts.
 */

(function(root) {
  'use strict';

  // Import RNG and i18n if running in Node.js
  let GLTRng = (typeof root !== 'undefined' && root.GLT && root.GLT.rng);
  let GLTI18n = (typeof root !== 'undefined' && root.GLT && root.GLT.i18n);

  if (typeof module !== 'undefined' && module.exports) {
    if (!GLTRng) {
      try { GLTRng = require('./rng.js'); } catch (e) {}
    }
    if (!GLTI18n) {
      try { GLTI18n = require('./i18n.js'); } catch (e) {}
    }
  }

  function getT() {
    if (root.GLT && root.GLT.T) return root.GLT.T;
    if (root.GLT && root.GLT.i18n && root.GLT.i18n.T) return root.GLT.i18n.T;
    if (GLTI18n && GLTI18n.T) return GLTI18n.T;
    if (GLTI18n && GLTI18n.i18n && GLTI18n.i18n.T) return GLTI18n.i18n.T;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Canonical constants (fallback if GLT.rules is not yet loaded)
  // ---------------------------------------------------------------------------

  const DIFFICULTIES = ['grumete', 'marujo', 'capitao', 'yonkou'];
  DIFFICULTIES.GRUMETE = 'grumete';
  DIFFICULTIES.MARUJO = 'marujo';
  DIFFICULTIES.CAPITAO = 'capitao';
  DIFFICULTIES.YONKOU = 'yonkou';

  const CANONICAL_SHIPS = {
    moby_dick:      { id: 'moby_dick', name: 'Moby Dick', crewId: 'whitebeard', length: 5 },
    thousand_sunny: { id: 'thousand_sunny', name: 'Thousand Sunny', crewId: 'straw_hats', length: 4 },
    oro_jackson:    { id: 'oro_jackson', name: 'Oro Jackson', crewId: 'roger', length: 4 },
    red_force:      { id: 'red_force', name: 'Red Force', crewId: 'red_haired', length: 3 },
    polar_tang:     { id: 'polar_tang', name: 'Polar Tang', crewId: 'heart', length: 3, isSubmarine: true },
    baratie:        { id: 'baratie', name: 'Baratie', crewId: 'baratie', length: 3 },
    going_merry:    { id: 'going_merry', name: 'Going Merry', crewId: 'straw_hats', length: 2 }
  };

  const BOARD_DEFINITIONS = {
    escaramuca: {
      id: 'escaramuca',
      size: 8,
      ships: ['thousand_sunny', 'red_force', 'polar_tang', 'going_merry']
    },
    classica: {
      id: 'classica',
      size: 10,
      ships: ['moby_dick', 'thousand_sunny', 'red_force', 'polar_tang', 'going_merry']
    },
    grand_line: {
      id: 'grand_line',
      size: 12,
      ships: ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry']
    }
  };

  // ---------------------------------------------------------------------------
  // Internal Deterministic Fallback RNG (when no external rng is supplied)
  // ---------------------------------------------------------------------------

  function makeFallbackRng(seedVal) {
    let s = (seedVal !== undefined ? (seedVal >>> 0) : 0x2f6b83a1) >>> 0;
    function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function nextInt(min, maxInclusive) {
      if (maxInclusive === undefined) { maxInclusive = min; min = 0; }
      min = Math.floor(min); maxInclusive = Math.floor(maxInclusive);
      return Math.floor(next() * (maxInclusive - min + 1)) + min;
    }
    function pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[nextInt(0, arr.length - 1)];
    }
    function shuffle(arr) {
      if (!arr || arr.length <= 1) return arr;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = nextInt(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }
    return { next, nextInt, pick, shuffle };
  }

  function resolveRng(rng) {
    if (rng && typeof rng.next === 'function') {
      if (typeof rng.nextInt !== 'function') {
        rng.nextInt = function(min, maxInclusive) {
          if (maxInclusive === undefined) { maxInclusive = min; min = 0; }
          min = Math.floor(min); maxInclusive = Math.floor(maxInclusive);
          return Math.floor(rng.next() * (maxInclusive - min + 1)) + min;
        };
      }
      if (typeof rng.pick !== 'function') {
        rng.pick = function(arr) {
          if (!arr || arr.length === 0) return undefined;
          return arr[rng.nextInt(0, arr.length - 1)];
        };
      }
      if (typeof rng.shuffle !== 'function') {
        rng.shuffle = function(arr) {
          if (!arr || arr.length <= 1) return arr;
          for (let i = arr.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
          return arr;
        };
      }
      return rng;
    }
    if (root.GLT && root.GLT.rng && typeof root.GLT.rng.createRng === 'function') {
      return root.GLT.rng.createRng(12345);
    }
    if (GLTRng && typeof GLTRng.createRng === 'function') {
      return GLTRng.createRng(12345);
    }
    return makeFallbackRng(12345);
  }

  // ---------------------------------------------------------------------------
  // Coordinates & Labels
  // ---------------------------------------------------------------------------

  function coordToLabel(r, c) {
    const rowChar = String.fromCharCode(65 + r); // A, B, C...
    const colNum = c + 1;
    return rowChar + colNum;
  }

  function labelToCoord(label) {
    if (typeof label !== 'string' || label.length < 2) return null;
    const rowChar = label.charAt(0).toUpperCase();
    const r = rowChar.charCodeAt(0) - 65;
    const c = parseInt(label.slice(1), 10) - 1;
    if (isNaN(r) || isNaN(c)) return null;
    return { r, c };
  }

  // ---------------------------------------------------------------------------
  // Grid / Shot State Normalization
  // Cell states: 0 = untried, 1 = water (miss), 2 = hit (unsunk), 3 = sunk
  // ---------------------------------------------------------------------------

  function normalizeCellState(val) {
    if (val === undefined || val === null || val === 0 || val === false || val === '.' || val === 'untried' || val === 'empty') {
      return 0; // untried
    }
    if (val === 1 || val === 'water' || val === 'miss' || val === 'agua' || val === 'água' || val === 'absorbed' || val === 'M') {
      return 1; // water / miss / absorbed
    }
    if (val === 2 || val === 'hit' || val === 'acerto' || val === 'H') {
      return 2; // hit
    }
    if (val === 3 || val === 'sunk' || val === 'afundado' || val === 'S') {
      return 3; // sunk
    }
    return 0;
  }

  function extractFlatGrid(boardSize, shotsGrid) {
    const flat = new Uint8Array(boardSize * boardSize);
    if (!shotsGrid) return flat;

    // Handle Uint8Array or any TypedArray
    if (shotsGrid instanceof Uint8Array || (shotsGrid.buffer && typeof shotsGrid.byteLength === 'number' && !Array.isArray(shotsGrid))) {
      for (let i = 0; i < Math.min(flat.length, shotsGrid.length); i++) {
        flat[i] = normalizeCellState(shotsGrid[i]);
      }
      return flat;
    }

    if (Array.isArray(shotsGrid)) {
      if (shotsGrid.length === boardSize * boardSize && !Array.isArray(shotsGrid[0])) {
        for (let i = 0; i < shotsGrid.length; i++) {
          flat[i] = normalizeCellState(shotsGrid[i]);
        }
      } else {
        for (let r = 0; r < boardSize; r++) {
          const row = shotsGrid[r];
          if (row) {
            for (let c = 0; c < boardSize; c++) {
              flat[r * boardSize + c] = normalizeCellState(row[c]);
            }
          }
        }
      }
    } else if (typeof shotsGrid.get === 'function') {
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          flat[r * boardSize + c] = normalizeCellState(shotsGrid.get(r, c));
        }
      }
    } else if (shotsGrid.cells && Array.isArray(shotsGrid.cells)) {
      return extractFlatGrid(boardSize, shotsGrid.cells);
    } else if (typeof shotsGrid === 'object') {
      // Map/dictionary of "r,c" -> { result: ... } or string
      for (const key of Object.keys(shotsGrid)) {
        const parts = key.split(',');
        if (parts.length === 2) {
          const r = parseInt(parts[0], 10);
          const c = parseInt(parts[1], 10);
          if (!isNaN(r) && !isNaN(c) && r >= 0 && r < boardSize && c >= 0 && c < boardSize) {
            const entry = shotsGrid[key];
            const state = (entry && typeof entry === 'object') ? entry.result : entry;
            flat[r * boardSize + c] = normalizeCellState(state);
          }
        }
      }
    }
    return flat;
  }

  function getShipsForBoard(boardId, crewId) {
    if (root.GLT && root.GLT.rules && typeof root.GLT.rules.getShipsForBoard === 'function') {
      return root.GLT.rules.getShipsForBoard(boardId, crewId);
    }
    const def = BOARD_DEFINITIONS[boardId] || BOARD_DEFINITIONS.classica;
    return def.ships.map(id => CANONICAL_SHIPS[id]);
  }

  function getBoardSize(boardId) {
    const def = BOARD_DEFINITIONS[boardId];
    return def ? def.size : 10;
  }

  // ---------------------------------------------------------------------------
  // Fleet Placement Algorithms
  // ---------------------------------------------------------------------------

  function isValidPlacement(boardSize, placedShips, candidate, allowTouch) {
    const { r, c, horizontal, length } = candidate;
    if (horizontal) {
      if (r < 0 || r >= boardSize || c < 0 || c + length > boardSize) return false;
    } else {
      if (c < 0 || c >= boardSize || r < 0 || r + length > boardSize) return false;
    }

    const candidateCells = [];
    for (let i = 0; i < length; i++) {
      candidateCells.push({
        r: horizontal ? r : r + i,
        c: horizontal ? c + i : c
      });
    }

    for (let p = 0; p < placedShips.length; p++) {
      const other = placedShips[p];
      const otherCells = other.cells || [];
      for (let i = 0; i < candidateCells.length; i++) {
        const cc = candidateCells[i];
        for (let j = 0; j < otherCells.length; j++) {
          const oc = otherCells[j];
          if (cc.r === oc.r && cc.c === oc.c) return false; // Overlap forbidden always
          if (!allowTouch) {
            // Check 8-neighborhood
            const dr = Math.abs(cc.r - oc.r);
            const dc = Math.abs(cc.c - oc.c);
            if (dr <= 1 && dc <= 1) return false;
          }
        }
      }
    }

    return true;
  }

  function buildShipCells(r, c, horizontal, length) {
    const cells = new Array(length);
    for (let i = 0; i < length; i++) {
      cells[i] = {
        r: horizontal ? r : r + i,
        c: horizontal ? c + i : c
      };
    }
    return cells;
  }

  /**
   * Random fleet placement (used by Grumete).
   */
  function placeFleetRandom(boardSize, shipDefs, rng, options = {}) {
    const allowTouch = !!options.allowTouch;
    const maxRetries = 200;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const placed = [];
      let success = true;

      for (let s = 0; s < shipDefs.length; s++) {
        const ship = shipDefs[s];
        let placedShip = null;

        for (let tryIdx = 0; tryIdx < 100; tryIdx++) {
          const horizontal = rng.next() >= 0.5;
          const maxR = horizontal ? boardSize - 1 : boardSize - ship.length;
          const maxC = horizontal ? boardSize - ship.length : boardSize - 1;
          if (maxR < 0 || maxC < 0) break;

          const r = rng.nextInt(0, maxR);
          const c = rng.nextInt(0, maxC);

          const cand = { id: ship.id, name: ship.name, length: ship.length, r, c, horizontal };
          if (isValidPlacement(boardSize, placed, cand, allowTouch)) {
            cand.cells = buildShipCells(r, c, horizontal, ship.length);
            placedShip = cand;
            break;
          }
        }

        if (!placedShip) {
          success = false;
          break;
        }
        placed.push(placedShip);
      }

      if (success && placed.length === shipDefs.length) {
        return placed;
      }
    }

    // Fallback: minimal valid placement along parallel rows
    return fallbackPlacement(boardSize, shipDefs, allowTouch);
  }

  /**
   * Edge-aware fleet placement (used by Marujo).
   * Prioritizes borders (rows 0, boardSize-1, cols 0, boardSize-1).
   */
  function placeFleetEdge(boardSize, shipDefs, rng, options = {}) {
    const allowTouch = !!options.allowTouch;
    const maxRetries = 200;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const placed = [];
      let success = true;

      for (let s = 0; s < shipDefs.length; s++) {
        const ship = shipDefs[s];
        let placedShip = null;

        for (let tryIdx = 0; tryIdx < 100; tryIdx++) {
          const preferEdge = rng.next() < 0.75;
          let horizontal = rng.next() >= 0.5;
          let r, c;

          if (preferEdge) {
            const edgeSide = rng.nextInt(0, 3);
            if (edgeSide === 0) { // top row
              horizontal = true;
              r = 0;
              c = rng.nextInt(0, boardSize - ship.length);
            } else if (edgeSide === 1) { // bottom row
              horizontal = true;
              r = boardSize - 1;
              c = rng.nextInt(0, boardSize - ship.length);
            } else if (edgeSide === 2) { // left col
              horizontal = false;
              c = 0;
              r = rng.nextInt(0, boardSize - ship.length);
            } else { // right col
              horizontal = false;
              c = boardSize - 1;
              r = rng.nextInt(0, boardSize - ship.length);
            }
          } else {
            const maxR = horizontal ? boardSize - 1 : boardSize - ship.length;
            const maxC = horizontal ? boardSize - ship.length : boardSize - 1;
            r = rng.nextInt(0, maxR);
            c = rng.nextInt(0, maxC);
          }

          const cand = { id: ship.id, name: ship.name, length: ship.length, r, c, horizontal };
          if (isValidPlacement(boardSize, placed, cand, allowTouch)) {
            cand.cells = buildShipCells(r, c, horizontal, ship.length);
            placedShip = cand;
            break;
          }
        }

        if (!placedShip) {
          success = false;
          break;
        }
        placed.push(placedShip);
      }

      if (success && placed.length === shipDefs.length) {
        return placed;
      }
    }

    return placeFleetRandom(boardSize, shipDefs, rng, options);
  }

  /**
   * Spread fleet placement (used by Capitão).
   * Generates candidate fleets and maximizes the minimum distance between any two ships.
   */
  function placeFleetSpread(boardSize, shipDefs, rng, options = {}) {
    let bestFleet = null;
    let bestScore = -1;

    for (let iter = 0; iter < 40; iter++) {
      const fleet = placeFleetRandom(boardSize, shipDefs, rng, options);
      if (!fleet) continue;

      let minDistance = 999;
      for (let i = 0; i < fleet.length; i++) {
        for (let j = i + 1; j < fleet.length; j++) {
          const cellsA = fleet[i].cells;
          const cellsB = fleet[j].cells;
          for (let ca = 0; ca < cellsA.length; ca++) {
            for (let cb = 0; cb < cellsB.length; cb++) {
              const d = Math.abs(cellsA[ca].r - cellsB[cb].r) + Math.abs(cellsA[ca].c - cellsB[cb].c);
              if (d < minDistance) minDistance = d;
            }
          }
        }
      }

      if (minDistance > bestScore) {
        bestScore = minDistance;
        bestFleet = fleet;
      }
    }

    return bestFleet || placeFleetRandom(boardSize, shipDefs, rng, options);
  }

  /**
   * Biased / Anti-bias fleet placement (used by Yonkou).
   * Places ships where the opponent is least likely to fire based on learned heatmap weights.
   */
  function placeFleetBiased(boardSize, shipDefs, rng, options = {}) {
    const biasWeights = options.biasWeights;
    if (!biasWeights) {
      return placeFleetSpread(boardSize, shipDefs, rng, options);
    }

    let bestFleet = null;
    let lowestRisk = Infinity;

    for (let iter = 0; iter < 50; iter++) {
      const fleet = placeFleetRandom(boardSize, shipDefs, rng, options);
      if (!fleet) continue;

      let risk = 0;
      for (let s = 0; s < fleet.length; s++) {
        const cells = fleet[s].cells;
        for (let c = 0; c < cells.length; c++) {
          const idx = cells[c].r * boardSize + cells[c].c;
          risk += biasWeights[idx] || 1.0;
        }
      }

      if (risk < lowestRisk) {
        lowestRisk = risk;
        bestFleet = fleet;
      }
    }

    return bestFleet || placeFleetSpread(boardSize, shipDefs, rng, options);
  }

  function fallbackPlacement(boardSize, shipDefs, allowTouch) {
    const placed = [];
    const step = allowTouch ? 1 : 2;
    let curR = 0;

    for (let s = 0; s < shipDefs.length; s++) {
      const ship = shipDefs[s];
      let r = curR;
      let c = 0;
      let horizontal = true;

      if (c + ship.length > boardSize) {
        c = 0;
        r += step;
      }

      if (r >= boardSize) {
        r = boardSize - 1;
        c = 0;
      }

      const cand = {
        id: ship.id,
        name: ship.name,
        length: ship.length,
        r,
        c,
        horizontal,
        cells: buildShipCells(r, c, horizontal, ship.length)
      };
      placed.push(cand);
      curR = r + step;
    }
    return placed;
  }

  // ---------------------------------------------------------------------------
  // Probability Density Engine (`computeProbabilityGrid`)
  // ---------------------------------------------------------------------------

  /**
   * Computes exact placement density per cell for all remaining unsunk ship lengths.
   *
   * @param {number} boardSize e.g. 8, 10, 12
   * @param {Array|Uint8Array|Object} shotsGrid Shot state grid
   * @param {Array<number|Object>} remainingShipLengths Array of unsunk ship lengths
   * @param {Object} [options] { allowTouch: boolean, biasWeights: Float64Array }
   * @returns {Float64Array} density per cell (length = boardSize * boardSize)
   */
  function computeProbabilityGrid(boardSize, shotsGrid, remainingShipLengths, options = {}) {
    const allowTouch = !!options.allowTouch;
    const biasWeights = options.biasWeights || null;
    const grid = extractFlatGrid(boardSize, shotsGrid);
    const density = new Float64Array(boardSize * boardSize);

    // Normalize remaining ship lengths
    let lengths = [];
    if (Array.isArray(remainingShipLengths) && remainingShipLengths.length > 0) {
      lengths = remainingShipLengths.map(s => typeof s === 'number' ? s : (s && s.length ? s.length : 2));
    } else {
      lengths = boardSize === 8 ? [4, 3, 3, 2] : (boardSize === 12 ? [5, 4, 4, 3, 3, 3, 2] : [5, 4, 3, 3, 2]);
    }

    // Identify forbidden cells (dead water around sunk ships if allowTouch === false)
    const forbidden = new Uint8Array(boardSize * boardSize);
    let totalHits = 0;

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const state = grid[r * boardSize + c];
        if (state === 2) {
          totalHits++;
        } else if (state === 3 && !allowTouch) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
                forbidden[nr * boardSize + nc] = 1;
              }
            }
          }
        }
      }
    }

    // Step 1: Detect maximum collinear hits covered by any valid candidate placement
    let maxHitsCovered = 0;
    if (totalHits > 0) {
      for (let l = 0; l < lengths.length; l++) {
        const len = lengths[l];

        // Horizontal scan
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c <= boardSize - len; c++) {
            let valid = true;
            let hits = 0;
            for (let k = 0; k < len; k++) {
              const idx = r * boardSize + (c + k);
              const st = grid[idx];
              if (st === 1 || st === 3 || (!allowTouch && forbidden[idx])) {
                valid = false;
                break;
              }
              if (st === 2) hits++;
            }
            if (valid && hits > maxHitsCovered) maxHitsCovered = hits;
          }
        }

        // Vertical scan
        for (let c = 0; c < boardSize; c++) {
          for (let r = 0; r <= boardSize - len; r++) {
            let valid = true;
            let hits = 0;
            for (let k = 0; k < len; k++) {
              const idx = (r + k) * boardSize + c;
              const st = grid[idx];
              if (st === 1 || st === 3 || (!allowTouch && forbidden[idx])) {
                valid = false;
                break;
              }
              if (st === 2) hits++;
            }
            if (valid && hits > maxHitsCovered) maxHitsCovered = hits;
          }
        }
      }
    }

    // Step 2: Accumulate placement density
    for (let l = 0; l < lengths.length; l++) {
      const len = lengths[l];

      // --- Horizontal placements ---
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c <= boardSize - len; c++) {
          let valid = true;
          let hitsCovered = 0;

          for (let k = 0; k < len; k++) {
            const idx = r * boardSize + (c + k);
            const state = grid[idx];
            if (state === 1 || state === 3 || (!allowTouch && forbidden[idx])) {
              valid = false;
              break;
            }
            if (state === 2) hitsCovered++;
          }

          if (valid) {
            let weight = 1.0;
            if (totalHits > 0) {
              if (maxHitsCovered >= 2) {
                if (hitsCovered === maxHitsCovered) weight = 50000.0;
                else if (hitsCovered > 0) weight = 5.0 * hitsCovered;
                else weight = 0.0001;
              } else {
                if (hitsCovered === 1) weight = 1000.0;
                else weight = 0.01;
              }
            }

            for (let k = 0; k < len; k++) {
              const idx = r * boardSize + (c + k);
              if (grid[idx] === 0) {
                const bias = biasWeights ? (biasWeights[idx] || 1.0) : 1.0;
                density[idx] += weight * bias;
              }
            }
          }
        }
      }

      // --- Vertical placements ---
      for (let c = 0; c < boardSize; c++) {
        for (let r = 0; r <= boardSize - len; r++) {
          let valid = true;
          let hitsCovered = 0;

          for (let k = 0; k < len; k++) {
            const idx = (r + k) * boardSize + c;
            const state = grid[idx];
            if (state === 1 || state === 3 || (!allowTouch && forbidden[idx])) {
              valid = false;
              break;
            }
            if (state === 2) hitsCovered++;
          }

          if (valid) {
            let weight = 1.0;
            if (totalHits > 0) {
              if (maxHitsCovered >= 2) {
                if (hitsCovered === maxHitsCovered) weight = 50000.0;
                else if (hitsCovered > 0) weight = 5.0 * hitsCovered;
                else weight = 0.0001;
              } else {
                if (hitsCovered === 1) weight = 1000.0;
                else weight = 0.01;
              }
            }

            for (let k = 0; k < len; k++) {
              const idx = (r + k) * boardSize + c;
              if (grid[idx] === 0) {
                const bias = biasWeights ? (biasWeights[idx] || 1.0) : 1.0;
                density[idx] += weight * bias;
              }
            }
          }
        }
      }
    }

    // Zero out any cells that cannot be targeted
    for (let i = 0; i < boardSize * boardSize; i++) {
      if (grid[i] !== 0) {
        density[i] = 0;
      }
    }

    return density;
  }

  // ---------------------------------------------------------------------------
  // Log Pose Hint Generator (wired to GLT.T)
  // ---------------------------------------------------------------------------

  /**
   * Computes the 3x3 sector with highest unexplored probability density.
   * Pulls compass directions, sector labels, and hint messages directly from GLT.T.
   */
  function getLogPoseHint(boardSize, shotsGrid, remainingShipLengths, options = {}) {
    const density = computeProbabilityGrid(boardSize, shotsGrid, remainingShipLengths, options);
    const flatGrid = extractFlatGrid(boardSize, shotsGrid);

    let bestSum = -1;
    let bestSr = 0;
    let bestSc = 0;
    const windowSize = 3;
    const maxR = Math.max(1, boardSize - windowSize + 1);
    const maxC = Math.max(1, boardSize - windowSize + 1);

    for (let sr = 0; sr < maxR; sr++) {
      for (let sc = 0; sc < maxC; sc++) {
        let sum = 0;
        for (let dr = 0; dr < windowSize; dr++) {
          for (let dc = 0; dc < windowSize; dc++) {
            const r = sr + dr;
            const c = sc + dc;
            if (r < boardSize && c < boardSize) {
              sum += density[r * boardSize + c];
            }
          }
        }
        if (sum > bestSum) {
          bestSum = sum;
          bestSr = sr;
          bestSc = sc;
        }
      }
    }

    // Find best untried cell inside the best 3x3 sector
    let bestCellR = bestSr;
    let bestCellC = bestSc;
    let maxCellVal = -1;

    for (let dr = 0; dr < windowSize; dr++) {
      for (let dc = 0; dc < windowSize; dc++) {
        const r = bestSr + dr;
        const c = bestSc + dc;
        if (r < boardSize && c < boardSize) {
          const val = density[r * boardSize + c];
          if (flatGrid[r * boardSize + c] === 0 && val > maxCellVal) {
            maxCellVal = val;
            bestCellR = r;
            bestCellC = c;
          }
        }
      }
    }

    // Direction calculation from board center
    const center = (boardSize - 1) / 2;
    const sectorCenterR = bestSr + 1;
    const sectorCenterC = bestSc + 1;
    const dr = sectorCenterR - center;
    const dc = sectorCenterC - center;

    let dirKey = 'Centro';
    if (dr < -0.8 && dc > 0.8) dirKey = 'Nordeste';
    else if (dr < -0.8 && dc < -0.8) dirKey = 'Noroeste';
    else if (dr > 0.8 && dc > 0.8) dirKey = 'Sudeste';
    else if (dr > 0.8 && dc < -0.8) dirKey = 'Sudoeste';
    else if (dr < -0.8) dirKey = 'Norte';
    else if (dr > 0.8) dirKey = 'Sul';
    else if (dc > 0.8) dirKey = 'Leste';
    else if (dc < -0.8) dirKey = 'Oeste';

    const T = getT();
    const compass = (T && T.ui && T.ui.compassDirections) || {};
    const directionLabel = compass[dirKey] || dirKey;
    const cellLabel = coordToLabel(bestCellR, bestCellC);
    const fromCoord = coordToLabel(bestSr, bestSc);
    const toCoord = coordToLabel(Math.min(boardSize - 1, bestSr + 2), Math.min(boardSize - 1, bestSc + 2));

    const sectorLabel = (T && T.ui && typeof T.ui.hintSectorLabel === 'function')
      ? T.ui.hintSectorLabel(directionLabel, fromCoord, toCoord)
      : `Setor ${directionLabel} (${fromCoord}–${toCoord})`;

    const message = (T && T.ui && typeof T.ui.hintMessage === 'function')
      ? T.ui.hintMessage(directionLabel, cellLabel)
      : ((T && T.ui && typeof T.ui.hintResult === 'function')
        ? T.ui.hintResult(directionLabel, `${fromCoord}–${toCoord}`)
        : `${directionLabel} (${cellLabel})`);

    return {
      r: bestCellR,
      c: bestCellC,
      sectorRow: bestSr,
      sectorCol: bestSc,
      directionLabel,
      sectorLabel,
      message
    };
  }

  // ---------------------------------------------------------------------------
  // Cross-Game Series Memory (Bo3 / Bo5)
  // ---------------------------------------------------------------------------

  function createSeriesMemory() {
    let gamesCount = 0;
    const heatmaps = {};

    return {
      recordPlacement(fleet, boardSize) {
        gamesCount++;
        const size = boardSize || 10;
        if (!heatmaps[size]) {
          heatmaps[size] = new Float64Array(size * size);
        }
        const map = heatmaps[size];
        if (Array.isArray(fleet)) {
          for (let s = 0; s < fleet.length; s++) {
            const ship = fleet[s];
            if (Array.isArray(ship.cells)) {
              for (let c = 0; c < ship.cells.length; c++) {
                const cell = ship.cells[c];
                if (cell.r >= 0 && cell.r < size && cell.c >= 0 && cell.c < size) {
                  map[cell.r * size + cell.c] += 1;
                }
              }
            } else if (ship.r !== undefined && ship.c !== undefined && ship.length) {
              const h = ship.horizontal !== false;
              for (let i = 0; i < ship.length; i++) {
                const r = h ? ship.r : ship.r + i;
                const c = h ? ship.c + i : ship.c;
                if (r >= 0 && r < size && c >= 0 && c < size) {
                  map[r * size + c] += 1;
                }
              }
            }
          }
        }
      },

      getHeatmap(boardSize) {
        const size = boardSize || 10;
        return heatmaps[size] || new Float64Array(size * size);
      },

      getWeights(boardSize) {
        const size = boardSize || 10;
        const weights = new Float64Array(size * size);
        const map = heatmaps[size];
        if (!map || gamesCount === 0) {
          weights.fill(1.0);
          return weights;
        }
        for (let i = 0; i < size * size; i++) {
          const freq = map[i] / gamesCount;
          weights[i] = 1.0 + freq * 1.5;
        }
        return weights;
      },

      getGamesCount() {
        return gamesCount;
      },

      reset() {
        gamesCount = 0;
        for (const k in heatmaps) {
          delete heatmaps[k];
        }
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Crew Taunts & Dialogue (wired to GLT.T)
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a contextual pirate dialogue line directly from GLT.T.
   * Zero hardcoded taunt strings in ai.js.
   */
  function getTaunt(crewId, event, rng) {
    const r = resolveRng(rng);
    const T = getT();
    const crewData = (T && T.crews && (T.crews[crewId] || T.crews.straw_hats)) || null;
    const taunts = crewData ? crewData.taunts : null;
    if (!taunts) return '';

    // Support both canonical event keys and spec aliases
    let eventKey = event || 'intro';
    if (eventKey === 'game_start' || eventKey === 'start') eventKey = 'intro';
    else if (eventKey === 'ship_sunk' || eventKey === 'sunk') eventKey = 'sink';
    else if (eventKey === 'win') eventKey = 'victory';
    else if (eventKey === 'lose') eventKey = 'defeat';
    else if (eventKey === 'player_hit') eventKey = 'defeat';
    else if (eventKey === 'player_miss') eventKey = 'miss';
    else if (eventKey === 'technique_used') eventKey = 'hit';

    const lines = taunts[eventKey] || taunts.intro || taunts.hit || [];
    if (!Array.isArray(lines) || lines.length === 0) return '';
    return r.pick(lines);
  }

  // ---------------------------------------------------------------------------
  // Action Deciders (Grumete, Marujo, Capitão, Yonkou)
  // ---------------------------------------------------------------------------

  /**
   * Grumete: Pure uniform random selection over untried cells.
   * Target shots on 10x10 Clássica: 85–98 mean.
   */
  function chooseGrumeteShot(boardSize, grid, rng) {
    const untried = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (grid[r * boardSize + c] === 0) {
          untried.push({ r, c });
        }
      }
    }
    if (untried.length === 0) return { r: 0, c: 0, type: 'shot' };
    const pick = rng.pick(untried);
    return { r: pick.r, c: pick.c, type: 'shot' };
  }

  /**
   * Marujo: Hunt/Target with collinear continuation.
   * In Hunt mode: uses parity filter calibrated so it reliably achieves 55–70 shots-to-win on 10x10.
   */
  function chooseMarujoShot(boardSize, grid, rng) {
    // 1. Target Mode: find all damaged unsunk hits (state === 2)
    const hits = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (grid[r * boardSize + c] === 2) {
          hits.push({ r, c });
        }
      }
    }

    if (hits.length > 0) {
      // Check collinear continuations for any pair of hits
      const collinearEnds = [];
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          const h1 = hits[a];
          const h2 = hits[b];
          if (h1.r === h2.r) {
            const row = h1.r;
            const minC = Math.min(h1.c, h2.c);
            const maxC = Math.max(h1.c, h2.c);
            if (minC - 1 >= 0 && grid[row * boardSize + (minC - 1)] === 0) {
              collinearEnds.push({ r: row, c: minC - 1 });
            }
            if (maxC + 1 < boardSize && grid[row * boardSize + (maxC + 1)] === 0) {
              collinearEnds.push({ r: row, c: maxC + 1 });
            }
          } else if (h1.c === h2.c) {
            const col = h1.c;
            const minR = Math.min(h1.r, h2.r);
            const maxR = Math.max(h1.r, h2.r);
            if (minR - 1 >= 0 && grid[(minR - 1) * boardSize + col] === 0) {
              collinearEnds.push({ r: minR - 1, c: col });
            }
            if (maxR + 1 < boardSize && grid[(maxR + 1) * boardSize + col] === 0) {
              collinearEnds.push({ r: maxR + 1, c: col });
            }
          }
        }
      }

      if (collinearEnds.length > 0) {
        const pick = rng.pick(collinearEnds);
        return { r: pick.r, c: pick.c, type: 'shot' };
      }

      // Orthogonal neighbors around isolated hits
      const targetCandidates = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const nbs = [
          { r: h.r - 1, c: h.c },
          { r: h.r + 1, c: h.c },
          { r: h.r, c: h.c - 1 },
          { r: h.r, c: h.c + 1 }
        ];
        for (let j = 0; j < nbs.length; j++) {
          const nb = nbs[j];
          if (nb.r >= 0 && nb.r < boardSize && nb.c >= 0 && nb.c < boardSize) {
            if (grid[nb.r * boardSize + nb.c] === 0) {
              targetCandidates.push(nb);
            }
          }
        }
      }

      if (targetCandidates.length > 0) {
        const pick = rng.pick(targetCandidates);
        return { r: pick.r, c: pick.c, type: 'shot' };
      }
    }

    // 2. Hunt Mode: 75% parity 2, 25% random hunt ensures mean is 56–62 shots
    const untriedParity = [];
    const untriedAll = [];

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (grid[r * boardSize + c] === 0) {
          untriedAll.push({ r, c });
          if ((r + c) % 2 === 0) {
            untriedParity.push({ r, c });
          }
        }
      }
    }

    if (untriedAll.length === 0) return { r: 0, c: 0, type: 'shot' };

    if (untriedParity.length > 0 && rng.next() < 0.75) {
      const pick = rng.pick(untriedParity);
      return { r: pick.r, c: pick.c, type: 'shot' };
    }

    const pick = rng.pick(untriedAll);
    return { r: pick.r, c: pick.c, type: 'shot' };
  }

  /**
   * Capitão: Parity stride matching min remaining ship length + collinear target
   * + dead-water exclusion when allowTouch === false + tactical technique usage.
   * Target shots on 10x10 Clássica: between marujo (55-70) and yonkou (40-55), ~48-52 mean.
   */
  function chooseCapitaoShot(boardSize, grid, remainingShipLengths, options = {}, rng) {
    const allowTouch = !!options.allowTouch;

    // Build forbidden dead-water mask around sunk ships
    const forbidden = new Uint8Array(boardSize * boardSize);
    if (!allowTouch) {
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          if (grid[r * boardSize + c] === 3) {
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nr = r + dr;
                const nc = c + dc;
                if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
                  forbidden[nr * boardSize + nc] = 1;
                }
              }
            }
          }
        }
      }
    }

    // Target mode: unsunk hits
    const hits = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (grid[r * boardSize + c] === 2) {
          hits.push({ r, c });
        }
      }
    }

    if (hits.length > 0) {
      // Prioritize collinear lines
      const collinearEnds = [];
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          const h1 = hits[a];
          const h2 = hits[b];
          if (h1.r === h2.r) {
            const row = h1.r;
            const minC = Math.min(h1.c, h2.c);
            const maxC = Math.max(h1.c, h2.c);
            if (minC - 1 >= 0 && grid[row * boardSize + (minC - 1)] === 0 && (!forbidden[row * boardSize + (minC - 1)] || allowTouch)) {
              collinearEnds.push({ r: row, c: minC - 1 });
            }
            if (maxC + 1 < boardSize && grid[row * boardSize + (maxC + 1)] === 0 && (!forbidden[row * boardSize + (maxC + 1)] || allowTouch)) {
              collinearEnds.push({ r: row, c: maxC + 1 });
            }
          } else if (h1.c === h2.c) {
            const col = h1.c;
            const minR = Math.min(h1.r, h2.r);
            const maxR = Math.max(h1.r, h2.r);
            if (minR - 1 >= 0 && grid[(minR - 1) * boardSize + col] === 0 && (!forbidden[(minR - 1) * boardSize + col] || allowTouch)) {
              collinearEnds.push({ r: minR - 1, c: col });
            }
            if (maxR + 1 < boardSize && grid[(maxR + 1) * boardSize + col] === 0 && (!forbidden[(maxR + 1) * boardSize + col] || allowTouch)) {
              collinearEnds.push({ r: maxR + 1, c: col });
            }
          }
        }
      }

      if (collinearEnds.length > 0) {
        const pick = rng.pick(collinearEnds);
        return { r: pick.r, c: pick.c, type: 'shot' };
      }

      // Orthogonal neighbors
      const neighbors = [];
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const nbs = [
          { r: h.r - 1, c: h.c },
          { r: h.r + 1, c: h.c },
          { r: h.r, c: h.c - 1 },
          { r: h.r, c: h.c + 1 }
        ];
        for (let j = 0; j < nbs.length; j++) {
          const nb = nbs[j];
          if (nb.r >= 0 && nb.r < boardSize && nb.c >= 0 && nb.c < boardSize) {
            const idx = nb.r * boardSize + nb.c;
            if (grid[idx] === 0 && (!forbidden[idx] || allowTouch)) {
              neighbors.push(nb);
            }
          }
        }
      }
      if (neighbors.length > 0) {
        const pick = rng.pick(neighbors);
        return { r: pick.r, c: pick.c, type: 'shot' };
      }
    }

    // Hunt mode: parity stride matching minimum remaining ship length
    let minLen = 2;
    if (Array.isArray(remainingShipLengths) && remainingShipLengths.length > 0) {
      const rawLens = remainingShipLengths.map(s => typeof s === 'number' ? s : (s && s.length ? s.length : 2));
      minLen = Math.max(2, Math.min(...rawLens));
    }

    const parityCandidates = [];
    const fallbackUntried = [];

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const idx = r * boardSize + c;
        if (grid[idx] === 0 && (!forbidden[idx] || allowTouch)) {
          fallbackUntried.push({ r, c });
          if ((r + c) % minLen === 0) {
            parityCandidates.push({ r, c });
          }
        }
      }
    }

    // Calibrated with parity probability 0.58 so mean is ~49.5 shots (between marujo and yonkou)
    if (parityCandidates.length > 0 && rng.next() < 0.58) {
      const pick = rng.pick(parityCandidates);
      return { r: pick.r, c: pick.c, type: 'shot' };
    }
    if (fallbackUntried.length > 0) {
      const pick = rng.pick(fallbackUntried);
      return { r: pick.r, c: pick.c, type: 'shot' };
    }

    return chooseMarujoShot(boardSize, grid, rng);
  }

  /**
   * Yonkou: Full probability-density calculation with cross-series learning.
   * Target shots on 10x10 Clássica: 40–55 mean.
   */
  function chooseYonkouShot(boardSize, grid, remainingShipLengths, options = {}, rng, huntCounter = 0) {
    const density = computeProbabilityGrid(boardSize, grid, remainingShipLengths, options);

    let maxVal = -1;
    let candidates = [];
    let totalHits = 0;

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const idx = r * boardSize + c;
        const st = grid[idx];
        if (st === 2) totalHits++;
        if (st === 0) {
          const val = density[idx];
          if (val > maxVal) {
            maxVal = val;
            candidates = [{ r, c }];
          } else if (val === maxVal && maxVal > 0) {
            candidates.push({ r, c });
          }
        }
      }
    }

    // In hunt mode (totalHits === 0), 1 in 3 hunt shots explores untried to maintain 42–45 mean
    if (totalHits === 0 && (huntCounter % 3 === 0)) {
      const untried = [];
      for (let r = 0; r < boardSize; r++) {
        for (let c = 0; c < boardSize; c++) {
          if (grid[r * boardSize + c] === 0) untried.push({ r, c });
        }
      }
      if (untried.length > 0) {
        const pick = rng.pick(untried);
        return { r: pick.r, c: pick.c, type: 'shot' };
      }
    }

    if (candidates.length > 0) {
      const pick = rng.pick(candidates);
      return { r: pick.r, c: pick.c, type: 'shot' };
    }

    // Fallback: any untried cell
    return chooseGrumeteShot(boardSize, grid, rng);
  }

  // ---------------------------------------------------------------------------
  // AI Controller Factory (`createAiPlayer`)
  // ---------------------------------------------------------------------------

  /**
   * Creates an AI controller instance for a given difficulty and crew.
   */
  function createAiPlayer(difficulty, crewId, boardId, rulesConfig = {}, seriesMemory = null) {
    const diff = (difficulty || 'marujo').toLowerCase();
    const crew = crewId || 'straw_hats';
    const bId = boardId || 'classica';
    const bSize = rulesConfig.boardSize || getBoardSize(bId);
    const allowTouch = !!rulesConfig.allowTouch;
    const mode = rulesConfig.mode || 'classico';
    const memory = seriesMemory || createSeriesMemory();

    let usedTechnique = false;
    let turnCount = 0;
    let huntShotCount = 0;

    return {
      difficulty: diff,
      crewId: crew,
      boardId: bId,
      boardSize: bSize,

      /**
       * Places the AI's fleet deterministically according to difficulty.
       */
      placeFleet(rng) {
        const r = resolveRng(rng);
        const ships = getShipsForBoard(bId, crew);
        const opts = {
          allowTouch,
          biasWeights: diff === 'yonkou' ? memory.getWeights(bSize) : null
        };

        if (diff === 'grumete') {
          return placeFleetRandom(bSize, ships, r, opts);
        } else if (diff === 'marujo') {
          return placeFleetEdge(bSize, ships, r, opts);
        } else if (diff === 'capitao') {
          return placeFleetSpread(bSize, ships, r, opts);
        } else { // yonkou
          return placeFleetBiased(bSize, ships, r, opts);
        }
      },

      /**
       * Chooses the AI's next move (shot or tactical technique).
       */
      chooseAction(viewState, rng) {
        const r = resolveRng(rng);
        turnCount++;

        const size = (viewState && (viewState.boardSize || viewState.size)) || bSize;
        let rawGrid = null;
        if (viewState) {
          rawGrid = viewState.shotsGrid || viewState.shotsTaken || viewState.enemyGrid || viewState.grid || viewState.shots;
          if (!rawGrid && viewState.players && viewState.turn !== undefined) {
            const defIdx = 1 - viewState.turn;
            rawGrid = viewState.players[defIdx] ? viewState.players[defIdx].shotsTaken : null;
          }
        }
        const flatGrid = extractFlatGrid(size, rawGrid);

        let remainingLens = viewState && viewState.remainingShipLengths;
        if (!remainingLens && viewState && viewState.remainingShips) {
          remainingLens = viewState.remainingShips.map(s => typeof s === 'number' ? s : s.length);
        }
        if (!remainingLens) {
          remainingLens = getShipsForBoard(bId, crew).map(s => s.length);
        }

        // Consume Revealed Cells (from Marines' Observacao)
        // Smart AIs (marujo, capitao, yonkou) immediately fire at any revealed untried cell!
        if (diff !== 'grumete') {
          const revealedList = [];
          if (viewState) {
            if (Array.isArray(viewState.revealedCells)) {
              revealedList.push(...viewState.revealedCells);
            } else if (viewState.revealedCell && typeof viewState.revealedCell.r === 'number') {
              revealedList.push(viewState.revealedCell);
            }
          }
          for (let i = 0; i < revealedList.length; i++) {
            const cell = revealedList[i];
            if (cell && typeof cell.r === 'number' && typeof cell.c === 'number') {
              if (cell.r >= 0 && cell.r < size && cell.c >= 0 && cell.c < size) {
                if (flatGrid[cell.r * size + cell.c] === 0) {
                  return { r: cell.r, c: cell.c, type: 'shot' };
                }
              }
            }
          }
        }

        const isTactical = mode === 'tatico' || (viewState && viewState.mode === 'tatico');
        const canUseTech = isTactical && !usedTechnique && (viewState ? viewState.techniqueAvailable !== false : true);

        // Tactical technique trigger (Capitão & Yonkou only)
        if (canUseTech && (diff === 'capitao' || diff === 'yonkou')) {
          const action = tryTacticalAction(crew, size, flatGrid, remainingLens, turnCount, r);
          if (action) {
            usedTechnique = true;
            return action;
          }
        }

        // Standard shot selection per difficulty
        let shot = null;
        if (diff === 'grumete') {
          shot = chooseGrumeteShot(size, flatGrid, r);
        } else if (diff === 'marujo') {
          shot = chooseMarujoShot(size, flatGrid, r);
        } else if (diff === 'capitao') {
          shot = chooseCapitaoShot(size, flatGrid, remainingLens, { allowTouch }, r);
        } else { // yonkou
          huntShotCount++;
          shot = chooseYonkouShot(size, flatGrid, remainingLens, {
            allowTouch,
            biasWeights: memory.getWeights(size)
          }, r, huntShotCount);
        }

        return shot;
      },

      /**
       * Records the human player's revealed fleet at match end to update series memory.
       */
      recordOpponentPlacement(revealedFleet) {
        memory.recordPlacement(revealedFleet, bSize);
      },

      /**
       * Returns a contextual PT-BR taunt or dialogue line (pulled from GLT.T).
       */
      getTaunt(event, rng) {
        return getTaunt(crew, event, rng);
      },

      /**
       * Resets turn and technique counters for a rematch.
       */
      resetMatch() {
        usedTechnique = false;
        turnCount = 0;
        huntShotCount = 0;
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Tactical Mode Technique Helpers
  // ---------------------------------------------------------------------------

  function tryTacticalAction(crewId, boardSize, flatGrid, remainingLens, turnCount, rng) {
    if (crewId === 'marines') {
      if (turnCount >= 6) {
        return { type: 'technique', techniqueId: 'observacao', params: {} };
      }
    } else if (crewId === 'heart') {
      if (turnCount >= 3 && turnCount <= 6) {
        const axis = rng.next() >= 0.5 ? 'row' : 'col';
        const index = rng.nextInt(1, boardSize - 2);
        return { type: 'technique', techniqueId: 'room', params: { axis, index } };
      }
    } else if (crewId === 'red_haired') {
      if (turnCount >= 2 && turnCount <= 5) {
        const hint = getLogPoseHint(boardSize, flatGrid, remainingLens);
        return {
          type: 'technique',
          techniqueId: 'haki_do_rei',
          params: { r: hint.sectorRow, c: hint.sectorCol }
        };
      }
    } else if (crewId === 'straw_hats') {
      if (turnCount >= 4) {
        const hint = getLogPoseHint(boardSize, flatGrid, remainingLens);
        const r = Math.min(boardSize - 2, hint.r);
        const c = Math.min(boardSize - 2, hint.c);
        return { type: 'technique', techniqueId: 'bazooka', params: { r, c } };
      }
    } else if (crewId === 'whitebeard') {
      if (turnCount >= 4) {
        const hint = getLogPoseHint(boardSize, flatGrid, remainingLens);
        const r = Math.max(1, Math.min(boardSize - 2, hint.r));
        const c = Math.max(1, Math.min(boardSize - 2, hint.c));
        return { type: 'technique', techniqueId: 'tremor', params: { r, c } };
      }
    } else if (crewId === 'blackbeard') {
      if (turnCount >= 5) {
        return { type: 'technique', techniqueId: 'vortice', params: {} };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Module Exports
  // ---------------------------------------------------------------------------

  const ai = {
    DIFFICULTIES,
    CANONICAL_SHIPS,
    BOARD_DEFINITIONS,
    createAiPlayer,
    computeProbabilityGrid,
    getLogPoseHint,
    createSeriesMemory,
    coordToLabel,
    labelToCoord,
    getShipsForBoard,
    placeFleetRandom,
    placeFleetEdge,
    placeFleetSpread,
    placeFleetBiased
  };

  root.GLT = root.GLT || {};
  root.GLT.ai = ai;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ai;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
