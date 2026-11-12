/**
 * Grand Line Tactics — Core Game Rules Module (`GLT.rules`)
 * Pure-JS module implementing ships, crews, boards, placement validation,
 * automated fleet placement strategies, match state progression, techniques,
 * turn transitions, rule toggles (salvo, continueOnHit, allowTouch, fog),
 * and pirate bounty calculation.
 *
 * NEVER touches DOM, window, or THREE.
 * Fully deterministic: zero non-deterministic random calls.
 * Zero hard-coded text: all visible strings and messages are wired to GLT.i18n (T).
 */

(function(root) {
  'use strict';

  // Import RNG and i18n
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

  function getRng() {
    if (GLTRng) return GLTRng;
    if (typeof root !== 'undefined' && root.GLT && root.GLT.rng) return root.GLT.rng;
    if (typeof globalThis !== 'undefined' && globalThis.GLT && globalThis.GLT.rng) return globalThis.GLT.rng;
    if (typeof module !== 'undefined' && typeof require !== 'undefined') {
      try { return require('./rng.js'); } catch (e) {}
    }
    return null;
  }

  function getI18n() {
    if (GLTI18n && GLTI18n.T) return GLTI18n;
    if (typeof root !== 'undefined' && root.GLT && root.GLT.i18n) return root.GLT.i18n;
    if (typeof globalThis !== 'undefined' && globalThis.GLT && globalThis.GLT.i18n) return globalThis.GLT.i18n;
    if (typeof module !== 'undefined' && typeof require !== 'undefined') {
      try { return require('./i18n.js'); } catch (e) {}
    }
    return null;
  }

  function getT() {
    const i = getI18n();
    return i ? i.T : null;
  }

  /**
   * 7 Canonical Ships of the Grand Line
   */
  const SHIP_SPECS = [
    { id: 'moby_dick', crewId: 'whitebeard', length: 5, isSubmarine: false },
    { id: 'thousand_sunny', crewId: 'straw_hats', length: 4, isSubmarine: false },
    { id: 'oro_jackson', crewId: 'roger', length: 4, isSubmarine: false },
    { id: 'red_force', crewId: 'red_haired', length: 3, isSubmarine: false },
    { id: 'polar_tang', crewId: 'heart', length: 3, isSubmarine: true },
    { id: 'baratie', crewId: 'baratie', length: 3, isSubmarine: false },
    { id: 'going_merry', crewId: 'straw_hats', length: 2, isSubmarine: false }
  ];

  const SHIPS = SHIP_SPECS.map(s => {
    const t = getT();
    const shipI18n = (t && t.ships && t.ships[s.id]) || {};
    return {
      id: s.id,
      name: shipI18n.name || s.id,
      crewId: s.crewId,
      length: s.length,
      isSubmarine: s.isSubmarine,
      desc: shipI18n.desc || ''
    };
  });

  const THEMATIC_FLEETS = {
    straw_hats: [
      { id: 'barto_club', name: 'Galeão Barto Club', length: 5, isSubmarine: false, baseModel: 'moby_dick', crewId: 'straw_hats' },
      { id: 'thousand_sunny', name: 'Thousand Sunny', length: 4, isSubmarine: false, baseModel: 'thousand_sunny', crewId: 'straw_hats' },
      { id: 'mini_merry', name: 'Mini Merry II', length: 3, isSubmarine: false, baseModel: 'red_force', crewId: 'straw_hats' },
      { id: 'shark_submerge', name: 'Shark Submerge III', length: 3, isSubmarine: true, baseModel: 'polar_tang', crewId: 'straw_hats' },
      { id: 'going_merry', name: 'Going Merry', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'straw_hats' }
    ],
    marines: [
      { id: 'marine_warship', name: 'Encouraçado Almirante G-1', length: 5, isSubmarine: false, baseModel: 'marine_warship', crewId: 'marines' },
      { id: 'marine_battleship', name: 'Navio de Linha da Justiça', length: 4, isSubmarine: false, baseModel: 'thousand_sunny', crewId: 'marines' },
      { id: 'marine_cruiser', name: 'Cruzador Buster Call', length: 3, isSubmarine: false, baseModel: 'red_force', crewId: 'marines' },
      { id: 'marine_cutter', name: 'Cutter de Patrulha Costeira', length: 3, isSubmarine: false, baseModel: 'baratie', crewId: 'marines' },
      { id: 'marine_scout', name: 'Lancha de Reconhecimento', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'marines' }
    ],
    whitebeard: [
      { id: 'moby_dick', name: 'Moby Dick', length: 5, isSubmarine: false, baseModel: 'moby_dick', crewId: 'whitebeard' },
      { id: 'whitebeard_whale_flag', name: 'Navio da 1ª Divisão Fênix', length: 4, isSubmarine: false, baseModel: 'thousand_sunny', crewId: 'whitebeard' },
      { id: 'whitebeard_vanguard', name: 'Baleia de Batalha Aliada', length: 3, isSubmarine: false, baseModel: 'red_force', crewId: 'whitebeard' },
      { id: 'whitebeard_corvette', name: 'Corveta Moby', length: 3, isSubmarine: false, baseModel: 'baratie', crewId: 'whitebeard' },
      { id: 'whitebeard_skiff', name: 'Chalupa de Vanguarda', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'whitebeard' }
    ],
    red_haired: [
      { id: 'red_galleon', name: 'Grande Galeão Escarlate', length: 5, isSubmarine: false, baseModel: 'moby_dick', crewId: 'red_haired' },
      { id: 'red_force', name: 'Red Force', length: 4, isSubmarine: false, baseModel: 'red_force', crewId: 'red_haired' },
      { id: 'red_corvette', name: 'Veleiro de Assalto Ruivo', length: 3, isSubmarine: false, baseModel: 'thousand_sunny', crewId: 'red_haired' },
      { id: 'red_cutter', name: 'Cutter do Novo Mundo', length: 3, isSubmarine: false, baseModel: 'baratie', crewId: 'red_haired' },
      { id: 'red_skiff', name: 'Chalupa Dardo Veloz', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'red_haired' }
    ],
    heart: [
      { id: 'heart_nodachi', name: 'Submarino Nodachi', length: 5, isSubmarine: true, baseModel: 'moby_dick', crewId: 'heart' },
      { id: 'heart_hospital', name: 'Navio Hospital Tático', length: 4, isSubmarine: false, baseModel: 'thousand_sunny', crewId: 'heart' },
      { id: 'polar_tang', name: 'Polar Tang', length: 3, isSubmarine: true, baseModel: 'polar_tang', crewId: 'heart' },
      { id: 'heart_capsule', name: 'Cápsula Cirúrgica Submersa', length: 3, isSubmarine: true, baseModel: 'baratie', crewId: 'heart' },
      { id: 'heart_bepo_boat', name: 'Bote Marcial do Bepo', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'heart' }
    ],
    blackbeard: [
      { id: 'blackbeard_colossal', name: 'Jangada Colossal da Morte', length: 5, isSubmarine: false, baseModel: 'moby_dick', crewId: 'blackbeard' },
      { id: 'saber_of_xebec', name: 'Saber of Xebec', length: 4, isSubmarine: false, baseModel: 'saber_of_xebec', crewId: 'blackbeard' },
      { id: 'blackbeard_galley', name: 'Galé das Trevas', length: 3, isSubmarine: false, baseModel: 'red_force', crewId: 'blackbeard' },
      { id: 'blackbeard_corvette', name: 'Corveta do Vórtice', length: 3, isSubmarine: false, baseModel: 'baratie', crewId: 'blackbeard' },
      { id: 'blackbeard_skiff', name: 'Chalupa do Caos', length: 2, isSubmarine: false, baseModel: 'going_merry', crewId: 'blackbeard' }
    ]
  };

  const allShipsRecord = {};
  SHIPS.forEach(ship => { allShipsRecord[ship.id] = { ...ship }; });
  Object.keys(THEMATIC_FLEETS).forEach(cId => {
    THEMATIC_FLEETS[cId].forEach(ts => {
      if (!allShipsRecord[ts.id]) {
        allShipsRecord[ts.id] = { ...ts, desc: '' };
      }
    });
  });

  const SHIPS_MAP = Object.freeze(allShipsRecord);

  /**
   * 6 Canonical Crews
   */
  const CREW_SPECS = [
    {
      id: 'straw_hats',
      technique: 'bazooka',
      colors: { primary: '#d32f2f', secondary: '#fbc02d', sail: '#fff9c4' }
    },
    {
      id: 'whitebeard',
      technique: 'tremor',
      colors: { primary: '#1565c0', secondary: '#ffffff', sail: '#eceff1' }
    },
    {
      id: 'red_haired',
      technique: 'haki_do_rei',
      colors: { primary: '#b71c1c', secondary: '#4e342e', sail: '#d7ccc8' }
    },
    {
      id: 'heart',
      technique: 'room',
      colors: { primary: '#fbc02d', secondary: '#212121', sail: '#fff59d' }
    },
    {
      id: 'blackbeard',
      technique: 'vortice',
      colors: { primary: '#212121', secondary: '#4a148c', sail: '#37474f' }
    },
    {
      id: 'marines',
      technique: 'observacao',
      colors: { primary: '#ffffff', secondary: '#0d47a1', sail: '#e3f2fd' }
    }
  ];

  const CREWS = CREW_SPECS.map(c => {
    const t = getT();
    const crewI18n = (t && t.crews && t.crews[c.id]) || {};
    return {
      id: c.id,
      name: crewI18n.name || c.id,
      captain: crewI18n.captain || '',
      officers: crewI18n.officers ? [...crewI18n.officers] : [],
      technique: c.technique,
      colors: c.colors
    };
  });

  const CREWS_MAP = Object.freeze(
    CREWS.reduce((acc, crew) => {
      acc[crew.id] = Object.freeze({ ...crew });
      return acc;
    }, {})
  );

  /**
   * 3 Canonical Boards
   */
  const BOARD_SPECS = [
    {
      id: 'escaramuca',
      size: 8,
      ships: ['thousand_sunny', 'red_force', 'polar_tang', 'going_merry']
    },
    {
      id: 'classica',
      size: 10,
      ships: ['moby_dick', 'thousand_sunny', 'red_force', 'polar_tang', 'going_merry']
    },
    {
      id: 'grand_line',
      size: 12,
      ships: ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry']
    }
  ];

  const BOARDS = BOARD_SPECS.map(b => {
    const t = getT();
    const boardI18n = (t && t.boards && t.boards[b.id]) || {};
    return {
      id: b.id,
      name: boardI18n.name || b.id,
      size: b.size,
      ships: [...b.ships]
    };
  });

  const BOARDS_MAP = Object.freeze(
    BOARDS.reduce((acc, board) => {
      acc[board.id] = Object.freeze({ ...board });
      return acc;
    }, {})
  );

  /**
   * 4 Canonical Sea Types with Tactical Sea Effects
   */
  const SEA_SPECS = [
    { id: 'mar_calmo', fog: false, fogDuration: 0, bountyMultiplier: 1.0 },
    { id: 'grand_line', fog: false, fogDuration: 0, bountyMultiplier: 1.10 },
    { id: 'novo_mundo', fog: true, fogDuration: 3, bountyMultiplier: 1.15 },
    { id: 'tempestade', fog: true, fogDuration: 2, bountyMultiplier: 1.25 },
    { id: 'marineford', fog: false, fogDuration: 0, bountyMultiplier: 1.20 }
  ];

  const SEAS = SEA_SPECS.map(s => {
    const t = getT();
    const seaI18n = (t && t.seas && t.seas[s.id]) || {};
    return {
      id: s.id,
      name: seaI18n.name || s.id,
      fog: s.fog,
      fogDuration: s.fogDuration,
      bountyMultiplier: s.bountyMultiplier
    };
  });

  const SEAS_MAP = Object.freeze(
    SEAS.reduce((acc, sea) => {
      acc[sea.id] = Object.freeze({ ...sea });
      return acc;
    }, {})
  );

  /**
   * Translates 0-indexed row/col to Battleship coordinate label (e.g. r=1, c=6 -> "B7").
   * Rows are A-L (0 to 11), columns are 1 to 12.
   * @param {number} r
   * @param {number} c
   * @returns {string}
   */
  function coordToLabel(r, c) {
    if (typeof r !== 'number' || typeof c !== 'number' || r < 0 || c < 0) {
      return '??';
    }
    const rowChar = String.fromCharCode(65 + r); // 65 = 'A'
    const colNum = c + 1;
    return `${rowChar}${colNum}`;
  }

  /**
   * Translates Battleship coordinate label (e.g. "B7" or "b7" or "L12") to { r, c }.
   * @param {string} label
   * @returns {{ r: number, c: number }|null}
   */
  function labelToCoord(label) {
    if (typeof label !== 'string') return null;
    const clean = label.trim().toUpperCase();
    const match = clean.match(/^([A-Z])(\d{1,2})$/);
    if (!match) return null;
    const rowChar = match[1];
    const colNum = parseInt(match[2], 10);
    const r = rowChar.charCodeAt(0) - 65;
    const c = colNum - 1;
    if (r < 0 || r > 25 || c < 0) return null;
    return { r, c };
  }

  /**
   * Returns list of canonical ship templates for a given board ID.
   * @param {string} boardId
   * @returns {Array<Object>}
   */
  function getFleetForCrew(crewId, boardId = 'classica') {
    const list = THEMATIC_FLEETS[crewId] || THEMATIC_FLEETS.straw_hats;
    const board = BOARDS_MAP[boardId] || BOARDS_MAP.classica;
    const count = board.ships.length;
    if (count === 4) {
      return [list[1], list[2], list[3], list[4]];
    } else if (count === 7) {
      return [
        list[0],
        list[1],
        { ...list[1], id: list[1].id + '_alt', name: list[1].name + ' (Auxiliar)' },
        list[2],
        list[3],
        { ...list[3], id: list[3].id + '_alt', name: list[3].name + ' (Reserva)' },
        list[4]
      ];
    }
    return [...list];
  }

  function getShipsForBoard(boardId, crewId) {
    if (crewId && THEMATIC_FLEETS[crewId]) {
      return getFleetForCrew(crewId, boardId);
    }
    const board = BOARDS_MAP[boardId] || BOARDS_MAP.classica;
    const t = getT();
    return board.ships.map(id => {
      const template = SHIPS_MAP[id] || {};
      const shipI18n = (t && t.ships && t.ships[id]) || {};
      return {
        ...template,
        name: shipI18n.name || template.name || id,
        desc: shipI18n.desc || template.desc || ''
      };
    });
  }

  /**
   * Validates if candidate ship placement is legally allowable on the given board.
   *
   * @param {number} boardSize e.g. 8, 10, 12
   * @param {Array<Object>} placedShips already placed ships
   * @param {Object} candidateShip { id, r, c, horizontal, length }
   * @param {Object} options { allowTouch: boolean }
   * @returns {{ valid: boolean, reason?: string, message?: string, cells: Array<{ r: number, c: number }> }}
   */
  function validatePlacement(boardSize, placedShips, candidateShip, options = {}) {
    const allowTouch = !!options.allowTouch;
    const length = candidateShip.length || (SHIPS_MAP[candidateShip.id] ? SHIPS_MAP[candidateShip.id].length : 0);
    const r = candidateShip.r;
    const c = candidateShip.c;
    const horizontal = !!candidateShip.horizontal;
    const t = getT();

    if (!length || length <= 0) {
      return {
        valid: false,
        reason: 'COMPRIMENTO_INVALIDO',
        message: t ? t.errors.placementOutOfBounds : 'Comprimento de navio inválido.',
        cells: []
      };
    }

    if (typeof r !== 'number' || typeof c !== 'number' || Number.isNaN(r) || Number.isNaN(c)) {
      return {
        valid: false,
        reason: 'COORDENADA_INVALIDA',
        message: t ? t.errors.placementOutOfBounds : 'Coordenada de posicionamento inválida.',
        cells: []
      };
    }

    // Check bounds
    if (horizontal) {
      if (r < 0 || r >= boardSize || c < 0 || (c + length) > boardSize) {
        return {
          valid: false,
          reason: 'FORA_DOS_LIMITES',
          message: t ? t.errors.placementOutOfBounds : 'Navio extrapola os limites da placa marítima!',
          cells: []
        };
      }
    } else {
      if (c < 0 || c >= boardSize || r < 0 || (r + length) > boardSize) {
        return {
          valid: false,
          reason: 'FORA_DOS_LIMITES',
          message: t ? t.errors.placementOutOfBounds : 'Navio extrapola os limites da placa marítima!',
          cells: []
        };
      }
    }

    // Generate cells for candidate ship
    const candidateCells = [];
    for (let i = 0; i < length; i++) {
      candidateCells.push({
        r: horizontal ? r : r + i,
        c: horizontal ? c + i : c
      });
    }

    // Filter out the ship itself if already in placedShips (e.g. moving an existing ship)
    const otherShips = (placedShips || []).filter(s => s.id !== candidateShip.id);

    // Build lookup of occupied cells from other ships
    const occupied = new Map();
    for (const ship of otherShips) {
      const cells = ship.cells || [];
      for (const cell of cells) {
        occupied.set(`${cell.r},${cell.c}`, ship.id);
      }
    }

    // Check overlap
    for (const cell of candidateCells) {
      const key = `${cell.r},${cell.c}`;
      if (occupied.has(key)) {
        return {
          valid: false,
          reason: 'SOBREPOSICAO',
          message: t ? t.errors.placementOverlap : 'Navios não podem ocupar a mesma célula oceânica!',
          cells: []
        };
      }
    }

    // Check adjacency/touching if allowTouch is false (8 neighbors)
    if (!allowTouch) {
      for (const cell of candidateCells) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = cell.r + dr;
            const nc = cell.c + dc;
            if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
              const key = `${nr},${nc}`;
              if (occupied.has(key)) {
                return {
                  valid: false,
                  reason: 'TOCANDO',
                  message: t ? t.errors.placementTouching : 'Embarcações não podem se tocar quando a regra de adjacência está desativada!',
                  cells: []
                };
              }
            }
          }
        }
      }
    }

    return { valid: true, cells: candidateCells };
  }

  /**
   * Automatically places a full fleet onto the board according to a specified strategy.
   * Supports 'random', 'edge', 'spread', and 'biased' (using biasWeights).
   * Pure deterministic implementation with seeded PRNG.
   *
   * @param {string} boardId 'escaramuca' | 'classica' | 'grand_line'
   * @param {Object} rng PRNG instance ({ nextInt, next, pick })
   * @param {Object} options { allowTouch: boolean, strategy: string, biasWeights: Float64Array|null }
   * @returns {Array<Object>} placed fleet [{ id, name, length, r, c, horizontal, cells }]
   */
  function autoPlaceFleet(boardId, rng, options = {}) {
    const board = BOARDS_MAP[boardId] || BOARDS_MAP.classica;
    const boardSize = board.size;
    const allowTouch = !!options.allowTouch;
    const strategy = options.strategy || 'random';
    const biasWeights = options.biasWeights || null;

    const prngModule = getRng();
    const prng = rng || (prngModule ? prngModule.createRng(123456) : null);
    if (!prng) {
      throw new Error('Módulo PRNG (GLT.rng) indispensável para autoPlaceFleet.');
    }

    // Ship templates sorted descending by length for optimal packing
    const shipTemplates = (options.crewId ? getShipsForBoard(board.id, options.crewId) : getShipsForBoard(board.id)).sort((a, b) => b.length - a.length);

    let maxRestarts = 200;
    while (maxRestarts-- > 0) {
      const placed = [];
      let success = true;

      for (const ship of shipTemplates) {
        let placedShip = null;
        let attempts = 0;
        const maxAttemptsPerShip = 300;

        while (attempts++ < maxAttemptsPerShip) {
          let r = 0;
          let c = 0;
          let horizontal = prng.nextInt(0, 1) === 1;

          if (strategy === 'edge' && prng.next() < 0.75) {
            // Favor border rows or columns
            const edgeSide = prng.nextInt(0, 3);
            if (edgeSide === 0) { // top edge
              r = 0;
              c = prng.nextInt(0, boardSize - (horizontal ? ship.length : 1));
            } else if (edgeSide === 1) { // bottom edge
              r = horizontal ? boardSize - 1 : boardSize - ship.length;
              c = prng.nextInt(0, boardSize - 1);
            } else if (edgeSide === 2) { // left edge
              c = 0;
              r = prng.nextInt(0, boardSize - (horizontal ? 1 : ship.length));
            } else { // right edge
              c = horizontal ? boardSize - ship.length : boardSize - 1;
              r = prng.nextInt(0, boardSize - 1);
            }
          } else if (strategy === 'biased' && biasWeights && biasWeights.length === boardSize * boardSize) {
            // Sample position biased by weights
            const maxR = horizontal ? boardSize - 1 : boardSize - ship.length;
            const maxC = horizontal ? boardSize - ship.length : boardSize - 1;
            let bestR = prng.nextInt(0, maxR);
            let bestC = prng.nextInt(0, maxC);
            let bestWeight = -Infinity;
            for (let sample = 0; sample < 5; sample++) {
              const sr = prng.nextInt(0, maxR);
              const sc = prng.nextInt(0, maxC);
              const w = biasWeights[sr * boardSize + sc] || 0;
              if (w > bestWeight) {
                bestWeight = w;
                bestR = sr;
                bestC = sc;
              }
            }
            r = bestR;
            c = bestC;
          } else if (strategy === 'spread') {
            const maxR = horizontal ? boardSize - 1 : boardSize - ship.length;
            const maxC = horizontal ? boardSize - ship.length : boardSize - 1;
            r = prng.nextInt(0, maxR);
            c = prng.nextInt(0, maxC);
          } else {
            // Pure random
            const maxR = horizontal ? boardSize - 1 : boardSize - ship.length;
            const maxC = horizontal ? boardSize - ship.length : boardSize - 1;
            r = prng.nextInt(0, maxR);
            c = prng.nextInt(0, maxC);
          }

          const candidate = {
            id: ship.id,
            name: ship.name,
            length: ship.length,
            isSubmarine: !!ship.isSubmarine,
            r,
            c,
            horizontal
          };

          const val = validatePlacement(boardSize, placed, candidate, { allowTouch });
          if (val.valid) {
            placedShip = {
              ...candidate,
              cells: val.cells
            };
            break;
          }
        }

        if (!placedShip) {
          success = false;
          break; // restart outer loop
        }
        placed.push(placedShip);
      }

      if (success && placed.length === shipTemplates.length) {
        return placed;
      }
    }

    const t = getT();
    throw new Error(t ? t.errors.placementIncomplete : `Falha ao posicionar frota para o tabuleiro ${boardId} após múltiplas tentativas.`);
  }

  /**
   * Initializes a full match state for Grand Line Tactics.
   *
   * @param {Object} config Match configuration
   * @returns {Object} Canonical match state
   */
  function createMatchState(config = {}) {
    const seed = config.seed !== undefined ? config.seed : 123456;
    const boardId = config.boardId || 'classica';
    const board = BOARDS_MAP[boardId] || BOARDS_MAP.classica;
    const mode = config.mode === 'tatico' ? 'tatico' : 'classico';
    const sea = config.sea || 'mar_calmo';
    const allowTouch = !!config.allowTouch;
    const continueOnHit = !!config.continueOnHit;
    const salvo = !!config.salvo;
    const turnTimer = typeof config.turnTimer === 'number' ? config.turnTimer : 0;
    const seriesLength = [1, 3, 5].includes(config.seriesLength) ? config.seriesLength : 1;

    // Tactical sea effect metadata (identical and deterministic on both clients)
    const seaSpec = SEAS_MAP[sea] || SEAS_MAP.mar_calmo;
    const seaEffect = mode === 'tatico'
      ? { fog: seaSpec.fog, fogDuration: seaSpec.fogDuration, bountyMultiplier: seaSpec.bountyMultiplier }
      : { fog: !!config.fog, fogDuration: config.fog ? 2 : 0, bountyMultiplier: 1.0 };

    const fog = !!config.fog || seaEffect.fog;
    const fogDuration = seaEffect.fogDuration || (fog ? 2 : 0);

    const explicitCrews = Array.isArray(config.crews) && config.crews.length === 2;
    const crewIds = explicitCrews ? config.crews : ['straw_hats', 'marines'];

    const prngModule = getRng();
    const rngInstance = prngModule ? prngModule.createRng(seed) : null;
    const startingPlayer = prngModule ? prngModule.coinToss(seed) : 0;

    // Helper to format a placed fleet
    function buildFleetState(fleetList) {
      const t = getT();
      return (fleetList || []).map(ship => {
        const template = SHIPS_MAP[ship.id] || {};
        const shipI18n = (t && t.ships && t.ships[ship.id]) || {};
        const length = ship.length || template.length || (ship.cells ? ship.cells.length : 0);
        const cells = ship.cells || [];
        return {
          id: ship.id,
          name: shipI18n.name || ship.name || template.name || ship.id,
          length,
          isSubmarine: !!(ship.isSubmarine || template.isSubmarine),
          r: ship.r,
          c: ship.c,
          horizontal: !!ship.horizontal,
          cells: cells.map(c => ({ r: c.r, c: c.c })),
          hits: 0,
          isSunk: false
        };
      });
    }

    const fleetsConfig = Array.isArray(config.fleets) && config.fleets.length === 2 ? config.fleets : null;

    let fleet0 = fleetsConfig && fleetsConfig[0].length > 0
      ? buildFleetState(fleetsConfig[0])
      : buildFleetState(autoPlaceFleet(board.id, rngInstance ? rngInstance.fork('fleet0') : null, { allowTouch, crewId: explicitCrews ? crewIds[0] : null }));

    let fleet1 = fleetsConfig && fleetsConfig[1].length > 0
      ? buildFleetState(fleetsConfig[1])
      : buildFleetState(autoPlaceFleet(board.id, rngInstance ? rngInstance.fork('fleet1') : null, { allowTouch, crewId: explicitCrews ? crewIds[1] : null }));

    function createPlayerState(playerIdx, crewId, fleet) {
      const crew = CREWS_MAP[crewId] || CREWS_MAP.straw_hats;
      const t = getT();
      const crewI18n = (t && t.crews && t.crews[crew.id]) || {};
      const totalShipCells = fleet.reduce((sum, s) => sum + s.length, 0);

      return {
        index: playerIdx,
        crewId: crew.id,
        crewName: crewI18n.name || crew.name,
        captain: crewI18n.captain || crew.captain,
        officers: crewI18n.officers ? [...crewI18n.officers] : [...crew.officers],
        technique: crew.technique,
        techniqueUsed: false,
        shieldActive: false, // For Blackbeard's vortice
        fleet,
        shipsTotal: fleet.length,
        shipsRemaining: fleet.length,
        totalShipCells,
        remainingShipCells: totalShipCells,
        shotsTaken: {},
        stats: {
          shots: 0,
          hits: 0,
          misses: 0,
          sinks: 0,
          currentStreak: 0,
          longestStreak: 0
        }
      };
    }

    const players = [
      createPlayerState(0, crewIds[0], fleet0),
      createPlayerState(1, crewIds[1], fleet1)
    ];

    const initialShots = salvo ? players[startingPlayer].shipsRemaining : 1;

    return {
      seed,
      boardId: board.id,
      boardSize: board.size,
      mode,
      sea,
      seaEffect,
      allowTouch,
      continueOnHit,
      salvo,
      turnTimer,
      fog,
      fogDuration,
      seriesLength,
      seriesWins: [0, 0],
      round: 1,
      turn: startingPlayer,
      turnNumber: 1,
      shotsRemainingInTurn: initialShots,
      gameOver: false,
      winner: null,
      history: [],
      players
    };
  }

  /**
   * Resolves a single cannon shot directed at the defender's board.
   *
   * @param {Object} matchState Current match state (will be updated in-place)
   * @param {number} shooterIdx Index of shooting player (0 or 1)
   * @param {{ r: number, c: number }} targetCell Target coordinate
   * @returns {Object} Shot resolution result
   */
  function resolveShot(matchState, shooterIdx, targetCell) {
    const t = getT();

    if (!matchState) {
      return { valid: false, outcome: 'error', message: 'Estado de partida inexistente.' };
    }

    if (matchState.gameOver) {
      const winnerName = matchState.players[matchState.winner] ? matchState.players[matchState.winner].captain : '';
      return {
        valid: false,
        outcome: 'game_over',
        message: t ? t.stats.congratulationsWinner(winnerName) : 'A batalha naval já está encerrada.'
      };
    }

    if (shooterIdx !== matchState.turn) {
      return {
        valid: false,
        outcome: 'wrong_turn',
        message: t ? t.errors.notYourTurn : 'Não é o seu turno de disparar os canhões.'
      };
    }

    const r = targetCell ? targetCell.r : -1;
    const c = targetCell ? targetCell.c : -1;
    const boardSize = matchState.boardSize;

    if (typeof r !== 'number' || typeof c !== 'number' || r < 0 || r >= boardSize || c < 0 || c >= boardSize) {
      return {
        valid: false,
        outcome: 'out_of_bounds',
        message: t ? t.outcomes.outOfBounds : 'Coordenada fora do mapa de navegação.'
      };
    }

    const defenderIdx = 1 - shooterIdx;
    const shooter = matchState.players[shooterIdx];
    const defender = matchState.players[defenderIdx];
    const cellKey = `${r},${c}`;

    // Verify if already shot
    if (defender.shotsTaken[cellKey]) {
      return {
        valid: false,
        outcome: 'already_shot',
        message: t ? t.outcomes.alreadyShot : 'Coordenada já bombardeada anteriormente.'
      };
    }

    shooter.stats.shots++;
    let outcome = 'water';
    let hitShip = null;
    let sunkCells = null;
    let shipId = null;
    let shipName = null;

    // Check if defender's shield (Vórtice da Escuridão) is active
    if (defender.shieldActive) {
      defender.shieldActive = false; // absorbs exactly one shot
      outcome = 'absorbed';
      shooter.stats.misses++;
      shooter.stats.currentStreak = 0;

      defender.shotsTaken[cellKey] = {
        r,
        c,
        result: 'absorbed',
        turn: matchState.turnNumber,
        shipId: null
      };
    } else {
      // Check if any defender ship occupies target cell
      for (const ship of defender.fleet) {
        if (ship.isSunk) continue;
        const hitCell = ship.cells.find(sc => sc.r === r && sc.c === c);
        if (hitCell) {
          hitShip = ship;
          break;
        }
      }

      if (!hitShip) {
        outcome = 'water';
        shooter.stats.misses++;
        shooter.stats.currentStreak = 0;

        defender.shotsTaken[cellKey] = {
          r,
          c,
          result: 'water',
          turn: matchState.turnNumber,
          shipId: null
        };
      } else {
        // Direct hit
        hitShip.hits++;
        defender.remainingShipCells--;
        shooter.stats.hits++;
        shooter.stats.currentStreak++;
        if (shooter.stats.currentStreak > shooter.stats.longestStreak) {
          shooter.stats.longestStreak = shooter.stats.currentStreak;
        }

        shipId = hitShip.id;
        shipName = hitShip.name;

        if (hitShip.hits >= hitShip.length) {
          // Ship sunk!
          hitShip.isSunk = true;
          defender.shipsRemaining--;
          shooter.stats.sinks++;
          outcome = 'sunk';
          sunkCells = hitShip.cells.map(cell => ({ ...cell }));

          defender.shotsTaken[cellKey] = {
            r,
            c,
            result: 'sunk',
            turn: matchState.turnNumber,
            shipId: hitShip.id
          };

          for (const cell of hitShip.cells) {
            const k = `${cell.r},${cell.c}`;
            if (defender.shotsTaken[k]) {
              defender.shotsTaken[k].result = 'sunk';
            }
          }

          // Check win condition
          if (defender.shipsRemaining <= 0) {
            matchState.gameOver = true;
            matchState.winner = shooterIdx;
            matchState.seriesWins[shooterIdx]++;
          }
        } else {
          outcome = 'hit';
          defender.shotsTaken[cellKey] = {
            r,
            c,
            result: 'hit',
            turn: matchState.turnNumber,
            shipId: hitShip.id
          };
        }
      }
    }

    // Determine turn transition
    if (matchState.gameOver) {
      matchState.shotsRemainingInTurn = 0;
    } else if (matchState.salvo) {
      if (matchState.continueOnHit && (outcome === 'hit' || outcome === 'sunk')) {
        // Under salvo + continueOnHit: scoring a hit grants continuation without consuming the shot
      } else {
        matchState.shotsRemainingInTurn--;
      }

      if (matchState.shotsRemainingInTurn <= 0) {
        // Salvo completed, pass to defender
        matchState.turn = defenderIdx;
        matchState.turnNumber++;
        matchState.shotsRemainingInTurn = matchState.players[defenderIdx].shipsRemaining;
      }
    } else {
      // Standard or continueOnHit mode
      if (matchState.continueOnHit && (outcome === 'hit' || outcome === 'sunk')) {
        matchState.shotsRemainingInTurn = 1;
      } else {
        matchState.turn = defenderIdx;
        matchState.turnNumber++;
        matchState.shotsRemainingInTurn = 1;
      }
    }

    const coordLabel = coordToLabel(r, c);
    let message = '';
    if (outcome === 'water') {
      message = t ? t.outcomes.water : 'Água!';
    } else if (outcome === 'hit') {
      message = t ? t.outcomes.hit : 'Acertou em cheio!';
    } else if (outcome === 'sunk') {
      message = t ? t.outcomes.sunk(shipName) : `Afundou o ${shipName}!`;
    } else if (outcome === 'absorbed') {
      message = t ? t.outcomes.absorbed : 'Tiro Absorvido!';
    }

    const eventRecord = {
      type: 'shot',
      shooterIdx,
      targetCell: { r, c },
      coordLabel,
      outcome,
      shipId,
      shipName,
      sunkCells,
      turnNumber: matchState.turnNumber,
      nextTurn: matchState.turn,
      gameOver: matchState.gameOver,
      winner: matchState.winner
    };

    matchState.history.push(eventRecord);

    return {
      valid: true,
      outcome,
      targetCell: { r, c },
      coordLabel,
      shipId,
      shipName,
      sunkCells,
      gameOver: matchState.gameOver,
      winner: matchState.winner,
      nextTurn: matchState.turn,
      shotsRemainingInTurn: matchState.shotsRemainingInTurn,
      message
    };
  }

  /**
   * Resolves a crew's signature technique in 'tatico' mode.
   * Costs the turn and can only be used once per match.
   *
   * @param {Object} matchState Current match state
   * @param {number} shooterIdx Index of player activating technique (0 or 1)
   * @param {Object} params Parameters specific to technique (e.g. { r, c } or { axis, index })
   * @returns {Object} Technique execution outcome
   */
  function resolveTechnique(matchState, shooterIdx, params = {}) {
    const t = getT();

    if (!matchState) {
      return { valid: false, message: 'Estado de partida inexistente.' };
    }

    if (matchState.mode !== 'tatico') {
      return {
        valid: false,
        message: t ? t.errors.techniqueInClassicMode : 'Técnicas especiais são exclusivas do Modo Tático.'
      };
    }

    if (matchState.gameOver) {
      return { valid: false, message: 'A partida já foi finalizada.' };
    }

    if (shooterIdx !== matchState.turn) {
      return {
        valid: false,
        message: t ? t.errors.notYourTurn : 'Não é o seu turno.'
      };
    }

    const shooter = matchState.players[shooterIdx];
    const defenderIdx = 1 - shooterIdx;
    const defender = matchState.players[defenderIdx];
    const boardSize = matchState.boardSize;

    if (shooter.techniqueUsed) {
      return {
        valid: false,
        message: t ? t.errors.techniqueAlreadyUsed : 'Esta tripulação já utilizou sua técnica especial nesta partida.'
      };
    }

    const techType = shooter.technique;
    let techniqueResult = {
      valid: true,
      type: techType,
      shooterIdx,
      cellsAffected: [],
      message: ''
    };

    if (techType === 'bazooka') {
      // Straw Hats: 2x2 volley
      const anchorR = params.r !== undefined ? params.r : 0;
      const anchorC = params.c !== undefined ? params.c : 0;
      const targetCells = [
        { r: anchorR, c: anchorC },
        { r: anchorR, c: anchorC + 1 },
        { r: anchorR + 1, c: anchorC },
        { r: anchorR + 1, c: anchorC + 1 }
      ].filter(cell => cell.r >= 0 && cell.r < boardSize && cell.c >= 0 && cell.c < boardSize);

      techniqueResult.cellsAffected = targetCells;
      techniqueResult.results = [];

      // If defender has shieldActive (Blackbeard's vortice), absorb the ENTIRE multi-cell technique volley!
      const absorbedByVortice = !!defender.shieldActive;
      if (absorbedByVortice) {
        defender.shieldActive = false;
      }

      for (const cell of targetCells) {
        const cellKey = `${cell.r},${cell.c}`;
        if (defender.shotsTaken[cellKey]) {
          techniqueResult.results.push({ cell, outcome: 'already_shot' });
          continue;
        }

        shooter.stats.shots++;

        if (absorbedByVortice) {
          shooter.stats.misses++;
          defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'absorbed', turn: matchState.turnNumber };
          techniqueResult.results.push({ cell, outcome: 'absorbed' });
        } else {
          let hitShip = null;
          for (const s of defender.fleet) {
            if (s.isSunk) continue;
            if (s.cells.some(sc => sc.r === cell.r && sc.c === cell.c)) {
              hitShip = s;
              break;
            }
          }

          if (!hitShip) {
            shooter.stats.misses++;
            defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'water', turn: matchState.turnNumber };
            techniqueResult.results.push({ cell, outcome: 'water' });
          } else {
            hitShip.hits++;
            defender.remainingShipCells--;
            shooter.stats.hits++;
            if (hitShip.hits >= hitShip.length) {
              hitShip.isSunk = true;
              defender.shipsRemaining--;
              shooter.stats.sinks++;
              defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'sunk', turn: matchState.turnNumber, shipId: hitShip.id };
              for (const sc of hitShip.cells) {
                const k = `${sc.r},${sc.c}`;
                if (defender.shotsTaken[k]) defender.shotsTaken[k].result = 'sunk';
              }
              techniqueResult.results.push({ cell, outcome: 'sunk', shipId: hitShip.id, shipName: hitShip.name, sunkCells: hitShip.cells });
              if (defender.shipsRemaining <= 0) {
                matchState.gameOver = true;
                matchState.winner = shooterIdx;
                matchState.seriesWins[shooterIdx]++;
              }
            } else {
              defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'hit', turn: matchState.turnNumber, shipId: hitShip.id };
              techniqueResult.results.push({ cell, outcome: 'hit', shipId: hitShip.id, shipName: hitShip.name });
            }
          }
        }
      }

      if (absorbedByVortice) {
        techniqueResult.message = t ? t.techniques.vortice.absorbedMsg : 'O Vórtice da Escuridão engoliu completamente o Bazooka! Tiros absorvidos!';
      } else {
        techniqueResult.message = t ? t.techniques.bazooka.usedMsg : 'Monkey D. Luffy disparou o Gomu Gomu no Bazooka em 4 quadrantes!';
      }

    } else if (techType === 'tremor') {
      // Whitebeard: 5-cell cross (center + N, S, E, W)
      const centerR = params.r !== undefined ? params.r : Math.floor(boardSize / 2);
      const centerC = params.c !== undefined ? params.c : Math.floor(boardSize / 2);
      const targetCells = [
        { r: centerR, c: centerC },
        { r: centerR - 1, c: centerC },
        { r: centerR + 1, c: centerC },
        { r: centerR, c: centerC - 1 },
        { r: centerR, c: centerC + 1 }
      ].filter(cell => cell.r >= 0 && cell.r < boardSize && cell.c >= 0 && cell.c < boardSize);

      techniqueResult.cellsAffected = targetCells;
      techniqueResult.results = [];

      // If defender has shieldActive (Blackbeard's vortice), absorb the ENTIRE 5-cell tremor!
      const absorbedByVortice = !!defender.shieldActive;
      if (absorbedByVortice) {
        defender.shieldActive = false;
      }

      for (const cell of targetCells) {
        const cellKey = `${cell.r},${cell.c}`;
        if (defender.shotsTaken[cellKey]) {
          techniqueResult.results.push({ cell, outcome: 'already_shot' });
          continue;
        }

        shooter.stats.shots++;

        if (absorbedByVortice) {
          shooter.stats.misses++;
          defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'absorbed', turn: matchState.turnNumber };
          techniqueResult.results.push({ cell, outcome: 'absorbed' });
        } else {
          let hitShip = null;
          for (const s of defender.fleet) {
            if (s.isSunk) continue;
            if (s.cells.some(sc => sc.r === cell.r && sc.c === cell.c)) {
              hitShip = s;
              break;
            }
          }

          if (!hitShip) {
            shooter.stats.misses++;
            defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'water', turn: matchState.turnNumber };
            techniqueResult.results.push({ cell, outcome: 'water' });
          } else {
            hitShip.hits++;
            defender.remainingShipCells--;
            shooter.stats.hits++;
            if (hitShip.hits >= hitShip.length) {
              hitShip.isSunk = true;
              defender.shipsRemaining--;
              shooter.stats.sinks++;
              defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'sunk', turn: matchState.turnNumber, shipId: hitShip.id };
              for (const sc of hitShip.cells) {
                const k = `${sc.r},${sc.c}`;
                if (defender.shotsTaken[k]) defender.shotsTaken[k].result = 'sunk';
              }
              techniqueResult.results.push({ cell, outcome: 'sunk', shipId: hitShip.id, shipName: hitShip.name, sunkCells: hitShip.cells });
              if (defender.shipsRemaining <= 0) {
                matchState.gameOver = true;
                matchState.winner = shooterIdx;
                matchState.seriesWins[shooterIdx]++;
              }
            } else {
              defender.shotsTaken[cellKey] = { r: cell.r, c: cell.c, result: 'hit', turn: matchState.turnNumber, shipId: hitShip.id };
              techniqueResult.results.push({ cell, outcome: 'hit', shipId: hitShip.id, shipName: hitShip.name });
            }
          }
        }
      }

      if (absorbedByVortice) {
        techniqueResult.message = t ? t.techniques.vortice.absorbedMsg : 'O Vórtice da Escuridão engoliu completamente o Tremor! Impacto anulado!';
      } else {
        techniqueResult.message = t ? t.techniques.tremor.usedMsg : 'Edward Newgate rachou o próprio oceano com um Tremor em cruz!';
      }

    } else if (techType === 'haki_do_rei') {
      // Red-Haired: 3x3 yes/no sonar
      const centerR = params.r !== undefined ? params.r : 1;
      const centerC = params.c !== undefined ? params.c : 1;
      const areaCells = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = centerR + dr;
          const nc = centerC + dc;
          if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize) {
            areaCells.push({ r: nr, c: nc });
          }
        }
      }
      techniqueResult.cellsAffected = areaCells;

      let detected = false;
      for (const ship of defender.fleet) {
        if (ship.isSunk) continue;
        for (const sc of ship.cells) {
          if (areaCells.some(ac => ac.r === sc.r && ac.c === sc.c)) {
            detected = true;
            break;
          }
        }
        if (detected) break;
      }

      techniqueResult.sonarDetected = detected;
      techniqueResult.message = detected
        ? (t ? t.techniques.haki_do_rei.sonarPositive : 'Haki do Rei revelou: PRESENÇA DETECTADA no setor!')
        : (t ? t.techniques.haki_do_rei.sonarNegative : 'Haki do Rei revelou: Nenhuma embarcação no setor!');

    } else if (techType === 'room') {
      // Heart: Count ship cells in row or col
      const axis = params.axis === 'col' ? 'col' : 'row';
      const index = typeof params.index === 'number' ? params.index : 0;
      techniqueResult.axis = axis;
      techniqueResult.index = index;

      let count = 0;
      for (const ship of defender.fleet) {
        if (ship.isSunk) continue;
        for (const sc of ship.cells) {
          if (axis === 'row' && sc.r === index) {
            count++;
          } else if (axis === 'col' && sc.c === index) {
            count++;
          }
        }
      }

      techniqueResult.rowColCount = count;
      const rowLabel = String.fromCharCode(65 + index);
      const colLabel = String(index + 1);
      techniqueResult.message = axis === 'row'
        ? (t ? t.techniques.room.rowCountMsg(rowLabel, count) : `Room detectou ${count} células de navios na Linha ${rowLabel}.`)
        : (t ? t.techniques.room.colCountMsg(colLabel, count) : `Room detectou ${count} células de navios na Coluna ${colLabel}.`);

    } else if (techType === 'vortice') {
      // Blackbeard: Absorbs next incoming enemy shot or technique volley
      shooter.shieldActive = true;
      techniqueResult.shieldActive = true;
      techniqueResult.message = t ? t.techniques.vortice.usedMsg : 'Marshall D. Teach invocou o Vórtice da Escuridão! Próximo tiro será absorvido!';

    } else if (techType === 'observacao') {
      // Marines: Reveals one unhit cell of a surviving enemy ship
      const unhitCells = [];
      for (const ship of defender.fleet) {
        if (ship.isSunk) continue;
        for (const cell of ship.cells) {
          const k = `${cell.r},${cell.c}`;
          if (!defender.shotsTaken[k]) {
            unhitCells.push({ ...cell, shipId: ship.id });
          }
        }
      }

      if (unhitCells.length > 0) {
        // Deterministic pick using Mulberry32 PRNG (handles string & number seeds without NaN!)
        const prngMod = getRng();
        const obsRng = prngMod
          ? prngMod.createRng(matchState.seed).fork('observacao-' + matchState.turnNumber + '-' + shooterIdx)
          : null;
        const pickIdx = obsRng ? obsRng.nextInt(0, unhitCells.length - 1) : 0;
        const chosen = unhitCells[pickIdx];
        techniqueResult.revealedCell = { r: chosen.r, c: chosen.c };
        techniqueResult.shipId = chosen.shipId;
        const revealedLabel = coordToLabel(chosen.r, chosen.c);
        techniqueResult.message = t
          ? t.techniques.observacao.revealedMsg(revealedLabel)
          : `Haki de Observação revelou a coordenada ${revealedLabel}!`;
      } else {
        techniqueResult.message = 'Haki de Observação: nenhuma célula oculta restante.';
      }
    }

    // Mark technique as used
    shooter.techniqueUsed = true;

    // A technique costs the turn (unless the game was won by bazooka/tremor)
    if (matchState.gameOver) {
      matchState.shotsRemainingInTurn = 0;
    } else {
      matchState.turn = defenderIdx;
      matchState.turnNumber++;
      matchState.shotsRemainingInTurn = matchState.salvo ? matchState.players[defenderIdx].shipsRemaining : 1;
    }

    techniqueResult.gameOver = matchState.gameOver;
    techniqueResult.winner = matchState.winner;
    techniqueResult.nextTurn = matchState.turn;

    matchState.history.push({
      type: 'technique',
      ...techniqueResult
    });

    return techniqueResult;
  }

  /**
   * Computes pirate Berry bounty based on match statistics and difficulty/rules.
   * Bounty = f(accuracy, shots, speed, streaks, difficulty, rules) >= 10_000_000.
   *
   * @param {Object} stats { won: boolean, shots: number, hits: number, sinks: number, longestStreak: number, turns?: number, timeSeconds?: number }
   * @param {Object} config { difficulty: string, boardId: string, mode: string, sea: string }
   * @returns {number} Integer Berry bounty >= 10_000_000
   */
  function calculateBounty(stats = {}, config = {}) {
    const won = !!stats.won;
    const shots = stats.shots || 0;
    const hits = stats.hits || 0;
    const sinks = stats.sinks || 0;
    const longestStreak = stats.longestStreak || 0;
    const accuracy = shots > 0 ? (hits / shots) : 0;

    const difficultyMultipliers = {
      grumete: 1.0,
      marujo: 1.5,
      capitao: 2.2,
      yonkou: 3.5
    };

    const boardMultipliers = {
      escaramuca: 1.0,
      classica: 1.3,
      grand_line: 1.8
    };

    const seaMultipliers = {
      mar_calmo: 1.0,
      grand_line: 1.10,
      novo_mundo: 1.15,
      tempestade: 1.25
    };

    const diffMult = difficultyMultipliers[config.difficulty] || 1.2;
    const boardMult = boardMultipliers[config.boardId] || 1.3;
    const modeMult = config.mode === 'tatico' ? 1.2 : 1.0;
    const seaMult = config.mode === 'tatico' ? (seaMultipliers[config.sea] || 1.0) : 1.0;

    let bounty = 10000000; // Minimum 10,000,000 Berries

    if (won) {
      const baseWin = 50000000;
      const accuracyBonus = accuracy * 250000000;
      const streakBonus = longestStreak * 20000000;
      const sinkBonus = sinks * 15000000;
      const efficiencyBonus = Math.max(0, (hits * 2 - shots)) * 5000000;

      const subtotal = (baseWin + accuracyBonus + streakBonus + sinkBonus + efficiencyBonus);
      bounty = subtotal * diffMult * boardMult * modeMult * seaMult;
    } else {
      const hitBonus = hits * 3000000;
      const sinkBonus = sinks * 10000000;
      bounty = (10000000 + hitBonus + sinkBonus) * diffMult;
    }

    const rounded = Math.max(10000000, Math.round(bounty / 10000) * 10000);
    return rounded;
  }

  /**
   * Checks whether a shot marker on the board has faded under the Fog of War rule.
   *
   * @param {Object} matchState
   * @param {number} shotTurnNumber
   * @returns {boolean}
   */
  function isShotFaded(matchState, shotTurnNumber) {
    if (!matchState || !matchState.fog) return false;
    const duration = matchState.fogDuration || 2;
    return (matchState.turnNumber - shotTurnNumber) > duration;
  }

  /**
   * Concedes the current match cleanly for the forfeiting player (PvC or local match).
   *
   * @param {Object} matchState - Canonical match state
   * @param {number} forfeitingPlayerIdx - 0 or 1
   * @returns {{ valid: boolean, outcome?: string, winner?: number, gameOverReason?: string, message: string }}
   */
  function forfeitMatch(matchState, forfeitingPlayerIdx) {
    if (!matchState || matchState.gameOver) {
      return {
        valid: false,
        message: 'A partida já está encerrada ou o estado é inválido.'
      };
    }
    if (forfeitingPlayerIdx !== 0 && forfeitingPlayerIdx !== 1) {
      return {
        valid: false,
        message: 'Índice de jogador inválido para rendição.'
      };
    }

    const t = getT();
    const winnerIdx = 1 - forfeitingPlayerIdx;
    matchState.gameOver = true;
    matchState.winner = winnerIdx;
    matchState.gameOverReason = 'manual_forfeit';
    matchState.forfeitedBy = forfeitingPlayerIdx;

    if (Array.isArray(matchState.seriesWins)) {
      matchState.seriesWins[winnerIdx] = (matchState.seriesWins[winnerIdx] || 0) + 1;
    }

    const forfeitingPlayer = matchState.players && matchState.players[forfeitingPlayerIdx];
    const forfeitingName = forfeitingPlayer
      ? (forfeitingPlayer.crewName || forfeitingPlayer.captain || `Jogador ${forfeitingPlayerIdx + 1}`)
      : `Jogador ${forfeitingPlayerIdx + 1}`;

    const msg = t && t.forfeit
      ? (forfeitingPlayerIdx === 0
          ? t.forfeit.logPlayerForfeit
          : (typeof t.forfeit.logEnemyForfeit === 'function' ? t.forfeit.logEnemyForfeit(forfeitingName) : t.forfeit.logPlayerForfeit))
      : `Partida encerrada: ${forfeitingName} abandonou o navio.`;

    if (Array.isArray(matchState.history)) {
      matchState.history.push({
        type: 'forfeit',
        player: forfeitingPlayerIdx,
        winner: winnerIdx,
        turn: matchState.turnNumber
      });
    }

    return {
      valid: true,
      outcome: 'forfeit',
      winner: winnerIdx,
      gameOverReason: 'manual_forfeit',
      message: msg
    };
  }

  const rulesModule = {
    SHIPS,
    SHIPS_MAP,
    CREWS,
    CREWS_MAP,
    BOARDS,
    BOARDS_MAP,
    SEAS,
    SEAS_MAP,
    THEMATIC_FLEETS,
    getFleetForCrew,
    coordToLabel,
    labelToCoord,
    getShipsForBoard,
    forfeitMatch,
    validatePlacement,
    autoPlaceFleet,
    createMatchState,
    resolveShot,
    resolveTechnique,
    calculateBounty,
    isShotFaded
  };

  // Global export (zero browser-specific identifiers)
  root.GLT = root.GLT || {};
  root.GLT.rules = rulesModule;

  // Node.js CommonJS export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = rulesModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
