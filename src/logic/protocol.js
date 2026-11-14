/**
 * Grand Line Tactics — Online PvP Protocol & WebCrypto Commitments
 * 
 * Implements:
 * 1. WebCrypto SHA-256 Commitments (commitment = SHA-256(canonicalFleetJson + ':' + salt))
 * 2. Lobby & Matchmaking (5-char room codes, presets, Den Den Mushi reaction whitelist, bounty board)
 * 3. Append-Only Sequence-Numbered Move Log & State Folder (foldMatchLog)
 * 4. Hidden Information Protocol (fleet never leaves client until reveal)
 * 5. Liveness & Timers (heartbeat, 10s reconnecting, 60s forfeit, deterministic timeout auto-fire)
 * 6. Cryptographic Anti-Cheat Verification (verifyMatchIntegrity)
 * 7. PvpMatchClient controller for seamless UI & headless test execution
 * 
 * Pure-logic module: MUST NOT touch DOM or THREE.
 * Works identically in headless Node.js and browser environments.
 */

(function(root) {
  'use strict';

  // Load PT-BR localization dictionary T
  let T = (typeof globalThis !== 'undefined' && globalThis.GLT && globalThis.GLT.T) ? globalThis.GLT.T : null;
  if (!T && typeof require !== 'undefined') {
    try {
      T = require('./i18n.js').T;
    } catch (_) {}
  }

  // Load Seeded PRNG module if available
  let rngModule = (typeof globalThis !== 'undefined' && globalThis.GLT && globalThis.GLT.rng) ? globalThis.GLT.rng : null;
  if (!rngModule && typeof require !== 'undefined') {
    try {
      rngModule = require('./rng.js');
    } catch (_) {}
  }

  // =========================================================================
  // Cryptographic Randomness (Zero unseeded randomness)
  // =========================================================================

  /**
   * Cryptographically secure random bytes without unseeded pseudo-randomness.
   */
  function getRandomBytes(length) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(length);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    }
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.randomBytes(length);
    } catch (_) {}
    const rng = rngModule ? rngModule.createRng(Date.now() + '') : null;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = rng ? rng.nextInt(0, 255) : ((Date.now() + i * 37) & 0xff);
    }
    return bytes;
  }

  function getRandomUint32() {
    const bytes = getRandomBytes(4);
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  }

  function getRandomInt(min, maxInclusive) {
    const range = maxInclusive - min + 1;
    return min + (getRandomUint32() % range);
  }

  // =========================================================================
  // Canonical Game Definitions & Whitelists
  // =========================================================================

  const CANONICAL_SHIPS = {
    moby_dick: { id: 'moby_dick', name: 'Moby Dick', crewId: 'whitebeard', length: 5 },
    thousand_sunny: { id: 'thousand_sunny', name: 'Thousand Sunny', crewId: 'straw_hats', length: 4 },
    oro_jackson: { id: 'oro_jackson', name: 'Oro Jackson', crewId: 'roger', length: 4 },
    red_force: { id: 'red_force', name: 'Red Force', crewId: 'red_haired', length: 3 },
    polar_tang: { id: 'polar_tang', name: 'Polar Tang', crewId: 'heart', length: 3, isSubmarine: true },
    baratie: { id: 'baratie', name: 'Baratie', crewId: 'baratie', length: 3 },
    going_merry: { id: 'going_merry', name: 'Going Merry', crewId: 'straw_hats', length: 2 }
  };

  const CANONICAL_BOARDS = {
    escaramuca: { id: 'escaramuca', name: 'Escaramuça', size: 8, ships: ['thousand_sunny', 'red_force', 'polar_tang', 'going_merry'] },
    classica: { id: 'classica', name: 'Clássica', size: 10, ships: ['moby_dick', 'thousand_sunny', 'red_force', 'polar_tang', 'going_merry'] },
    grand_line: { id: 'grand_line', name: 'Grand Line', size: 12, ships: ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry'] }
  };

  /** Preset Den Den Mushi reactions whitelist (No free-text input allowed) */
  const DEN_DEN_REACTIONS = [
    { id: 'boa_mira', label: (T && T.reactions && T.reactions.opt_boa_mira) || 'Boa mira!', icon: '🎯' },
    { id: 'prepare_se', label: (T && T.reactions && T.reactions.opt_prepare_se) || 'Prepare-se!', icon: '⚔️' },
    { id: 'aguarde', label: (T && T.reactions && T.reactions.opt_aguarde) || 'Aguarde seu fim!', icon: '💀' },
    { id: 'sorte', label: (T && T.reactions && T.reactions.opt_que_sorte) || 'Pura sorte!', icon: '🍀' },
    { id: 'gg', label: (T && T.reactions && T.reactions.opt_gg_capitao) || 'GG, capitão!', icon: '🏴‍☠️' },
    { id: 'mar_bravo', label: (T && T.reactions && T.reactions.opt_mar_bravo) || 'O mar está bravo hoje!', icon: '🌊' },
    { id: 'den_den_ringing', label: (T && T.reactions && T.reactions.opt_den_den_ringing) || 'Puru puru puru...', icon: '🐌' },
    { id: 'ouch', label: (T && T.reactions && T.reactions.opt_ouch) || (T && T.reactions && T.reactions.opt_argh) || 'Essa doeu!', icon: '💥' }
  ].map(r => ({
    id: r.id,
    label: r.label,
    icon: r.icon,
    text: `${r.icon} ${r.label}`
  }));

  function isValidReaction(reactionId) {
    return DEN_DEN_REACTIONS.some(r => r.id === reactionId);
  }

  // =========================================================================
  // Cryptographic Helpers & WebCrypto SHA-256 Commitments
  // =========================================================================

  /**
   * Deterministic FNV-1a 32-bit unsigned integer hash for strings.
   */
  function hashString(str) {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  /**
   * Pure-JS FIPS 180-4 SHA-256 fallback for non-HTTPS file:// browser contexts.
   */
  function sha256PureJs(asciiBytes) {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const bitLen = asciiBytes.length * 8;
    const padLen = ((asciiBytes.length + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(asciiBytes);
    buf[asciiBytes.length] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
    view.setUint32(padLen - 4, bitLen >>> 0, false);

    const w = new Uint32Array(64);
    const rotr = (v, n) => (v >>> n) | (v << (32 - n));

    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map(v => v.toString(16).padStart(8, '0'))
      .join('');
  }

  /**
   * Compute SHA-256 hex string using WebCrypto (with Node & pure-JS file:// fallbacks).
   */
  async function computeSha256(text) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Node.js fallback
    try {
      const nodeCrypto = require('crypto');
      return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
    } catch (_) {}

    // Pure-JS UTF-8 SHA-256 fallback (for file:// non-secure contexts)
    const bytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(text)
      : Uint8Array.from(unescape(encodeURIComponent(text)), ch => ch.charCodeAt(0));
    return sha256PureJs(bytes);
  }

  /**
   * Generate cryptographically secure random hex salt.
   */
  function generateSalt(byteLength = 16) {
    const bytes = getRandomBytes(byteLength);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Canonicalize fleet representation for deterministic JSON serialization.
   * Ships sorted alphabetically by id; cells sorted by r ascending then c ascending.
   */
  function canonicalizeFleet(fleet) {
    if (!Array.isArray(fleet)) return [];
    const sortedShips = fleet.slice().sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    return sortedShips.map(ship => {
      const cells = (ship.cells || []).slice().sort((a, b) => {
        if (a.r !== b.r) return a.r - b.r;
        return a.c - b.c;
      }).map(cell => ({ r: cell.r, c: cell.c }));

      return {
        id: ship.id,
        name: ship.name || ship.id,
        length: ship.length || cells.length,
        r: ship.r !== undefined ? ship.r : cells[0]?.r ?? 0,
        c: ship.c !== undefined ? ship.c : cells[0]?.c ?? 0,
        horizontal: !!ship.horizontal,
        cells
      };
    });
  }

  /**
   * Compute WebCrypto SHA-256 commitment for a fleet and salt.
   * commitment = SHA-256(canonicalFleetJson + ':' + salt)
   * @param {Array<object>} fleet - Placed fleet array
   * @param {string} salt - Random salt string
   * @returns {Promise<string>} Lowercase 64-character hex string
   */
  async function computeCommitment(fleet, salt) {
    if (!salt) throw new Error('computeCommitment requires a non-empty salt');
    const canonical = canonicalizeFleet(fleet);
    const json = JSON.stringify(canonical);
    const input = json + ':' + salt;
    return await computeSha256(input);
  }

  // =========================================================================
  // Matchmaking & Lobby Helpers
  // =========================================================================

  const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // excludes ambiguous 0, O, 1, I

  function generateRoomCode(length = 5) {
    let code = '';
    for (let i = 0; i < length; i++) {
      const idx = getRandomInt(0, ROOM_CODE_ALPHABET.length - 1);
      code += ROOM_CODE_ALPHABET[idx];
    }
    return code;
  }

  function getRoomUrl(roomCode, baseUrl = '') {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}room=${roomCode}`;
  }

  function generatePlayerId() {
    const hex = Array.from(getRandomBytes(6)).map(b => b.toString(16).padStart(2, '0')).join('');
    return 'pirate_' + hex;
  }

  function generateDefaultNickname() {
    const prefixes = ['Capitão', 'Navegante', 'Atirador', 'Corsário', 'Espadachim', 'Lobo do Mar'];
    const epithets = ['Valente', 'Veloz', 'Astuto', 'do Leste', 'Destemido', 'das Sombras'];
    const p = prefixes[getRandomInt(0, prefixes.length - 1)];
    const e = epithets[getRandomInt(0, epithets.length - 1)];
    const num = getRandomInt(10, 99);
    return `${p} ${e} #${num}`;
  }

  // =========================================================================
  // Event Helpers & Types
  // =========================================================================

  let eventCounter = 1;

  function createEventId(prefix = 'evt') {
    const hex = Array.from(getRandomBytes(4)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}_${Date.now()}_${eventCounter++}_${hex}`;
  }

  function createEvent(type, payload = {}) {
    return {
      eventId: createEventId(type.toLowerCase()),
      type,
      timestamp: Date.now(),
      ...payload
    };
  }

  // =========================================================================
  // Deterministic Turn-Timeout Auto-Fire
  // =========================================================================

  /**
   * Deterministically select an untried cell on defender's board when turn timer expires.
   * Derived from matchSeed + turnNumber.
   * Both clients compute the EXACT same cell!
   */
  function getDeterministicAutoShot(matchSeed, turnNumber, boardSize, triedCells) {
    const untried = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const key = `${r},${c}`;
        const isTried = triedCells instanceof Set 
          ? triedCells.has(key) 
          : Boolean(triedCells && triedCells[key]);
        if (!isTried) {
          untried.push({ r, c });
        }
      }
    }

    if (untried.length === 0) return null;

    // Sort untried cells in canonical grid order
    untried.sort((a, b) => (a.r !== b.r ? a.r - b.r : a.c - b.c));

    // Deterministic hash selection
    const hash = hashString(`${matchSeed}:turn_${turnNumber}`);
    const index = hash % untried.length;
    return untried[index];
  }

  // =========================================================================
  // Shot & Technique Evaluation (Defender Client Side)
  // =========================================================================

  /**
   * Evaluates an incoming shot against defender's secret fleet.
   */
  function evaluateShotAnswer(fleet, r, c, hitsTaken = new Set(), shieldActive = false) {
    // 1. Blackbeard Vórtice shield
    if (shieldActive) {
      return {
        outcome: 'absorbed',
        r,
        c,
        shieldConsumed: true
      };
    }

    // 2. Search for ship at (r, c)
    let hitShip = null;
    for (const ship of fleet) {
      if (ship.cells.some(cell => cell.r === r && cell.c === c)) {
        hitShip = ship;
        break;
      }
    }

    if (!hitShip) {
      return { outcome: 'water', r, c };
    }

    // Check if this hit sinks the ship
    const updatedHits = new Set(hitsTaken);
    updatedHits.add(`${r},${c}`);

    const allCellsHit = hitShip.cells.every(cell => updatedHits.has(`${cell.r},${cell.c}`));

    if (allCellsHit) {
      return {
        outcome: 'sunk',
        r,
        c,
        shipId: hitShip.id,
        shipName: hitShip.name,
        sunkCells: hitShip.cells.map(cell => ({ r: cell.r, c: cell.c }))
      };
    }

    return {
      outcome: 'hit',
      r,
      c,
      shipId: hitShip.id
    };
  }

  /**
   * Evaluates an incoming technique query against defender's secret fleet.
   */
  function evaluateTechAnswer(fleet, techId, params = {}, hitsTaken = new Set(), boardSize = 10, shieldActive = false) {
    if (techId === 'bazooka' || techId === 'tremor') {
      const baseR = params.r !== undefined ? params.r : 0;
      const baseC = params.c !== undefined ? params.c : 0;
      const offsets = techId === 'bazooka'
        ? [[0, 0], [0, 1], [1, 0], [1, 1]]
        : [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
      const workingHits = new Set(hitsTaken);
      let currentShield = shieldActive;
      const cellOutcomes = [];

      for (const [dr, dc] of offsets) {
        const cr = baseR + dr;
        const cc = baseC + dc;
        if (cr < 0 || cr >= boardSize || cc < 0 || cc >= boardSize) continue;
        const ans = evaluateShotAnswer(fleet, cr, cc, workingHits, currentShield);
        if (ans.shieldConsumed) currentShield = false;
        if (ans.outcome === 'hit' || ans.outcome === 'sunk') {
          workingHits.add(`${cr},${cc}`);
        }
        cellOutcomes.push({
          r: cr,
          c: cc,
          outcome: ans.outcome,
          shipId: ans.shipId,
          shipName: ans.shipName,
          sunkCells: ans.sunkCells
        });
      }

      return {
        techId,
        result: { cellOutcomes }
      };
    }

    if (techId === 'haki_do_rei') {
      // 3x3 Sonar around params { r, c }
      const centerR = params.r;
      const centerC = params.c;
      let detected = false;

      for (const ship of fleet) {
        // Only active/surviving ships or cells
        const isSunk = ship.cells.every(c => hitsTaken.has(`${c.r},${c.c}`));
        if (isSunk) continue;

        for (const cell of ship.cells) {
          if (Math.abs(cell.r - centerR) <= 1 && Math.abs(cell.c - centerC) <= 1) {
            detected = true;
            break;
          }
        }
        if (detected) break;
      }

      return {
        techId,
        result: { sonarDetected: detected }
      };
    }

    if (techId === 'room') {
      // Count ship cells in chosen row or column
      const axis = params.axis || 'row';
      const index = params.index;
      let count = 0;

      for (const ship of fleet) {
        for (const cell of ship.cells) {
          if (axis === 'row' && cell.r === index) count++;
          if (axis === 'col' && cell.c === index) count++;
        }
      }

      return {
        techId,
        result: { rowColCount: count }
      };
    }

    if (techId === 'observacao') {
      // Reveals one unhit cell of a surviving enemy ship
      const candidateCells = [];
      for (const ship of fleet) {
        const isSunk = ship.cells.every(c => hitsTaken.has(`${c.r},${c.c}`));
        if (isSunk) continue;

        for (const cell of ship.cells) {
          if (!hitsTaken.has(`${cell.r},${cell.c}`)) {
            candidateCells.push({ r: cell.r, c: cell.c });
          }
        }
      }

      let revealed = null;
      if (candidateCells.length > 0) {
        // Deterministic pick based on params.seed or first candidate
        const idx = params.seed ? (hashString(params.seed) % candidateCells.length) : 0;
        revealed = candidateCells[idx];
      }

      return {
        techId,
        result: { revealedCell: revealed }
      };
    }

    return { techId, result: {} };
  }

  // =========================================================================
  // State Folder (foldMatchLog)
  // =========================================================================

  function createInitialMatchState(config = {}) {
    const boardId = config.boardId || 'classica';
    const boardDef = CANONICAL_BOARDS[boardId] || CANONICAL_BOARDS.classica;
    const boardSize = config.boardSize || boardDef.size;
    const totalShips = boardDef.ships.length;

    return {
      roomId: config.roomId || null,
      phase: 'lobby', // 'lobby' | 'ready' | 'playing' | 'game_over'
      matchConfig: {
        boardId,
        boardSize,
        mode: config.mode || 'classico', // 'classico' | 'tatico'
        turnTimer: config.turnTimer !== undefined ? config.turnTimer : 30, // seconds, 0 = off
        allowTouch: !!config.allowTouch,
        continueOnHit: !!config.continueOnHit,
        salvo: !!config.salvo,
        seed: config.seed || 'glt_match_' + Date.now(),
        firstTurn: config.firstTurn !== undefined ? config.firstTurn : 0
      },
      players: [
        {
          id: null,
          nickname: 'Jogador 1',
          crewId: 'straw_hats',
          ready: false,
          commitment: null,
          connected: true,
          lastHeartbeat: 0,
          techniqueUsed: false,
          shieldActive: false
        },
        {
          id: null,
          nickname: 'Jogador 2',
          crewId: 'red_haired',
          ready: false,
          commitment: null,
          connected: true,
          lastHeartbeat: 0,
          techniqueUsed: false,
          shieldActive: false
        }
      ],
      spectators: [],
      currentTurn: 0,
      turnNumber: 1,
      turnStartTime: 0,
      shotsRemainingInTurn: config.salvo ? totalShips : 1,
      pendingShot: null, // { seq, turn, shooterIndex, r, c, timestamp }
      pendingTech: null, // { seq, turn, shooterIndex, techId, params }
      boards: [
        // Board 0: shots fired by player 0 at player 1
        {
          shots: {}, // 'r,c' -> { r, c, outcome, shipId, sunkCells, turn }
          sunkShips: [], // [{ id, name, sunkCells }]
          totalShips,
          remainingShips: totalShips
        },
        // Board 1: shots fired by player 1 at player 0
        {
          shots: {},
          sunkShips: [],
          totalShips,
          remainingShips: totalShips
        }
      ],
      log: [],
      shotHistory: [],
      feed: [],
      reveals: [null, null],
      winner: null,
      gameOverReason: null,
      forfeitedBy: null,
      integrity: null,
      lastActionTimestamp: 0,
      rematchRequested: [false, false]
    };
  }

  /**
   * Pure, deterministic log-folder.
   * Takes an array of raw events (potentially with duplicates or out-of-order deliveries)
   * and builds the canonical match state.
   */
  /**
   * The seat (0 | 1) an event speaks for, read from its own fields. `null` = no seat
   * (spectator join, unknown type). Used to check authorship when a transport stamps
   * `_seat` from an unforgeable source (the published-Artifact db author path).
   */
  function actingSeat(ev) {
    if (!ev || typeof ev.type !== 'string') return null;
    const seat = (v) => (v === 0 || v === 1) ? v : null;
    switch (ev.type) {
      case 'ROOM_CREATED': return 0;
      case 'ROOM_JOINED': return ev.role === 'spectator' ? null : 1;
      case 'SHOT_FIRE':
      case 'TECH_FIRE': return seat(ev.shooterIndex);
      case 'SHOT_ANSWER':
      case 'TECH_ANSWER': return seat(ev.defenderIndex);
      case 'GAME_OVER':
        // A forfeit speaks for the one giving up; an absence claim for the one claiming the win.
        return typeof ev.forfeitedBy === 'number' ? seat(ev.forfeitedBy) : seat(ev.winnerIndex);
      case 'CREW_SELECTED':
      case 'READY_COMMIT':
      case 'PLAYER_READY':
      case 'FLEET_REVEAL':
      case 'REACTION':
      case 'REMATCH_REQUEST':
      case 'HEARTBEAT':
      case 'PRESENCE': return seat(ev.playerIndex);
      default: return null;
    }
  }

  /**
   * Authorship gate. Events without `_seat` come from transports that cannot authenticate
   * (LAN relay, BroadcastChannel, in-memory) and keep the old behaviour. An event stamped
   * with `_seat` must speak only for that seat; a TURN_TIMEOUT (one player acting on the
   * other's behalf) is never accepted from an authenticated author.
   */
  function isAuthorConsistent(ev) {
    if (!ev || ev._seat === undefined || ev._seat === null) return true;
    if (ev.type === 'TURN_TIMEOUT') return false;
    if (ev.type === 'GAME_OVER') {
      if (typeof ev.forfeitedBy === 'number') {
        if (ev.winnerIndex !== 1 - ev.forfeitedBy) return false;
      } else if (ev.reason !== 'forfeit') {
        return false; // only a forfeit or an absence claim may be written; wins by sinking are derived
      }
    }
    return actingSeat(ev) === ev._seat;
  }

  function eventKey(ev) {
    if (!ev || !ev.eventId) return null;
    return (ev._seat === 0 || ev._seat === 1 ? ev._seat : '-') + '|' + ev.eventId;
  }

  /**
   * An absence claim ("rival sumiu", GAME_OVER reason 'forfeit' without forfeitedBy) is void
   * when the accused wrote anything at or after the claim's seq: the accused was alive.
   */
  function isAbsenceClaim(ev) {
    return !!ev && ev.type === 'GAME_OVER' && ev.reason === 'forfeit' && typeof ev.forfeitedBy !== 'number';
  }
  /**
   * An absence claim is admissible only when it can be refuted: an integer seq no further
   * than the next seq of the log (so the accused's next event or PRESENCE proof at that seq
   * voids it). A claim without seq, with a non-integer seq, or pointing past the log is
   * dropped; one applied outside the playing phase is ignored by applySingleEvent.
   */
  function isAdmissibleAbsenceClaim(claim, events) {
    if (!Number.isSafeInteger(claim.seq) || claim.seq < 0) return false;
    if (claim.winnerIndex !== 0 && claim.winnerIndex !== 1) return false;
    let maxSeq = 0;
    for (const e of events) {
      if (e !== claim && !isAbsenceClaim(e) && Number.isSafeInteger(e.seq) && e.seq > maxSeq) maxSeq = e.seq;
    }
    return claim.seq <= maxSeq + 1;
  }
  function isRefutedAbsenceClaim(claim, events) {
    if (!Number.isSafeInteger(claim.seq)) return true;
    const accused = 1 - claim.winnerIndex;
    return events.some(e => e !== claim && typeof e.seq === 'number' && e.seq >= claim.seq &&
      actingSeat(e) === accused && !isAbsenceClaim(e));
  }

  /**
   * Seq window: a seq may sit at most SEQ_WINDOW above the highest seq accepted so far
   * (walking the log in seq order). Anything further is dropped, so one event with a huge
   * seq can neither reorder the log nor push a client's counter out of the safe-integer range.
   * Absence claims are judged separately (isAdmissibleAbsenceClaim) and never widen the window.
   * Returns { dropped:Set<event>, maxSeq:number }.
   */
  const SEQ_WINDOW = 8;
  function seqWindow(events) {
    const seqd = [];
    for (const e of events) {
      if (e && Number.isSafeInteger(e.seq) && e.seq >= 0 && !isAbsenceClaim(e) && isAuthorConsistent(e)) seqd.push(e);
    }
    seqd.sort((a, b) => a.seq - b.seq);
    const dropped = new Set();
    let maxSeq = 0;
    for (const e of seqd) {
      if (e.seq > maxSeq + SEQ_WINDOW) dropped.add(e);
      else if (e.seq > maxSeq) maxSeq = e.seq;
    }
    return { dropped, maxSeq };
  }

  function foldMatchLog(events, matchConfig = {}) {
    const state = createInitialMatchState(matchConfig);
    if (!Array.isArray(events) || events.length === 0) {
      return state;
    }

    // Deduplicate by (author, eventId) while preserving appearance order, and drop any event
    // whose authenticated author does not match the seat it speaks for.
    const seenEventIds = new Set();
    const uniqueEvents = [];
    for (const ev of events) {
      if (!ev) continue;
      if (!isAuthorConsistent(ev)) continue;
      // A seq, when present, must be a non-negative integer (a string or float would break the order)
      if (ev.seq !== undefined && ev.seq !== null && !(Number.isSafeInteger(ev.seq) && ev.seq >= 0)) continue;
      const key = eventKey(ev);
      if (key) {
        if (seenEventIds.has(key)) continue;
        seenEventIds.add(key);
      }
      uniqueEvents.push(ev);
    }
    const win = seqWindow(uniqueEvents);
    if (win.dropped.size) {
      for (let i = uniqueEvents.length - 1; i >= 0; i--) {
        if (win.dropped.has(uniqueEvents[i])) uniqueEvents.splice(i, 1);
      }
    }
    for (let i = uniqueEvents.length - 1; i >= 0; i--) {
      const ev = uniqueEvents[i];
      if (isAbsenceClaim(ev) && (!isAdmissibleAbsenceClaim(ev, uniqueEvents) || isRefutedAbsenceClaim(ev, uniqueEvents))) {
        uniqueEvents.splice(i, 1);
      }
    }

    // Partition events into setup events, action events (with seq), and terminal/presence events
    // Actions are strictly ordered by seq to guarantee canonical order despite network reordering
    const setupEvents = [];
    const actionEvents = [];
    const metaEvents = [];

    for (const ev of uniqueEvents) {
      if (ev.seq !== undefined && ev.seq !== null) {
        actionEvents.push(ev);
      } else if (['ROOM_CREATED', 'ROOM_JOINED', 'READY_COMMIT', 'PLAYER_READY'].includes(ev.type)) {
        setupEvents.push(ev);
      } else {
        metaEvents.push(ev);
      }
    }

    // Sort actions by sequence number
    actionEvents.sort((a, b) => a.seq - b.seq);

    // Apply setup events first
    for (const ev of setupEvents) {
      applySingleEvent(state, ev);
    }

    // Apply sequenced gameplay actions
    for (const ev of actionEvents) {
      applySingleEvent(state, ev);
    }

    // Apply meta events (heartbeats, reactions, terminal game over / reveals)
    for (const ev of metaEvents) {
      applySingleEvent(state, ev);
    }

    return state;
  }

  function applySingleEvent(state, ev) {
    if (!ev || !ev.type) return;
    state.lastActionTimestamp = Math.max(state.lastActionTimestamp, ev.timestamp || 0);

    switch (ev.type) {
      case 'ROOM_CREATED': {
        state.roomId = ev.roomId || state.roomId;
        if (ev.matchConfig) {
          Object.assign(state.matchConfig, ev.matchConfig);
          const boardDef = CANONICAL_BOARDS[state.matchConfig.boardId] || CANONICAL_BOARDS.classica;
          state.matchConfig.boardSize = state.matchConfig.boardSize || boardDef.size;
          const total = boardDef.ships.length;
          state.boards[0].totalShips = total;
          state.boards[0].remainingShips = total;
          state.boards[1].totalShips = total;
          state.boards[1].remainingShips = total;
        }
        if (ev.hostId) {
          state.players[0].id = ev.hostId;
          state.players[0].nickname = ev.hostNickname || state.players[0].nickname;
          if (ev.crewId) state.players[0].crewId = ev.crewId;
        }
        break;
      }

      case 'ROOM_JOINED': {
        if (ev.role === 'spectator') {
          if (!state.spectators.some(s => s.id === ev.guestId)) {
            state.spectators.push({ id: ev.guestId, nickname: ev.guestNickname });
          }
        } else {
          if (!state.players[1].id || state.players[1].id === ev.guestId) {
            state.players[1].id = ev.guestId;
            state.players[1].nickname = ev.guestNickname || state.players[1].nickname;
            if (ev.crewId) state.players[1].crewId = ev.crewId;
          }
        }
        break;
      }

      case 'CREW_SELECTED': {
        const pIdx = ev.playerIndex;
        if (pIdx === 0 || pIdx === 1) {
          if (ev.crewId) state.players[pIdx].crewId = ev.crewId;
        }
        break;
      }

      case 'READY_COMMIT':
      case 'PLAYER_READY': {
        const pIdx = ev.playerIndex;
        if (pIdx === 0 || pIdx === 1) {
          // One commitment per seat: a later READY_COMMIT can never replace it.
          if (state.players[pIdx].ready && state.players[pIdx].commitment) break;
          state.players[pIdx].ready = true;
          state.players[pIdx].commitment = ev.commitment || state.players[pIdx].commitment;
          if (ev.crewId) state.players[pIdx].crewId = ev.crewId;
          if (ev.playerId) state.players[pIdx].id = ev.playerId;
        }

        // If both players ready, transition to playing
        if (state.players[0].ready && state.players[1].ready && state.phase === 'lobby') {
          state.phase = 'playing';
          // Determine first turn: coin toss from matchSeed
          const toss = hashString(state.matchConfig.seed) % 2;
          state.currentTurn = state.matchConfig.firstTurn !== undefined ? state.matchConfig.firstTurn : toss;
          state.turnStartTime = ev.timestamp || Date.now();
          if (state.matchConfig.salvo) {
            const firstSurviving = state.boards[state.currentTurn].totalShips - state.boards[1 - state.currentTurn].sunkShips.length;
            state.shotsRemainingInTurn = Math.max(1, firstSurviving);
          } else {
            state.shotsRemainingInTurn = 1;
          }
        }
        break;
      }

      case 'SHOT_FIRE': {
        if (state.phase !== 'playing') return;

        // Strict turn ownership check
        if (ev.shooterIndex !== state.currentTurn) {
          // Reject out-of-turn fire
          return;
        }

        // Double-click / concurrent shot guard: cannot fire while waiting for an answer
        if (state.pendingShot !== null || state.pendingTech !== null) {
          return;
        }

        // Coordinate bounds check
        const bSize = state.matchConfig.boardSize;
        if (ev.r < 0 || ev.r >= bSize || ev.c < 0 || ev.c >= bSize) {
          return;
        }

        // Cannot shoot an already tried cell
        const cellKey = `${ev.r},${ev.c}`;
        if (state.boards[ev.shooterIndex].shots[cellKey]) {
          return;
        }

        // Record valid pending shot
        state.pendingShot = {
          seq: ev.seq,
          turn: state.turnNumber,
          shooterIndex: ev.shooterIndex,
          r: ev.r,
          c: ev.c,
          timestamp: ev.timestamp
        };
        state.log.push(ev);
        break;
      }

      case 'SHOT_ANSWER': {
        if (state.phase !== 'playing') return;
        if (!state.pendingShot) return;

        // Answer must correspond to pending shot
        const shooterIdx = state.pendingShot.shooterIndex;
        const expectedDefender = 1 - shooterIdx;

        // Strict ownership: player cannot answer their own shot
        if (ev.defenderIndex !== expectedDefender) {
          return;
        }

        if (ev.r !== state.pendingShot.r || ev.c !== state.pendingShot.c) {
          return;
        }

        const cellKey = `${ev.r},${ev.c}`;
        const outcome = ev.outcome || 'water';

        if (outcome === 'absorbed') {
          state.players[expectedDefender].shieldActive = false;
        }

        // Apply shot result to shooter's view of defender's board
        state.boards[shooterIdx].shots[cellKey] = {
          r: ev.r,
          c: ev.c,
          outcome,
          shipId: ev.shipId,
          shipName: ev.shipName,
          sunkCells: ev.sunkCells,
          turn: state.turnNumber
        };

        if (outcome === 'sunk') {
          state.boards[shooterIdx].remainingShips = Math.max(0, state.boards[shooterIdx].remainingShips - 1);
          state.boards[shooterIdx].sunkShips.push({
            id: ev.shipId,
            name: ev.shipName,
            sunkCells: ev.sunkCells
          });

          // Win check
          if (state.boards[shooterIdx].remainingShips === 0) {
            state.phase = 'game_over';
            state.winner = shooterIdx;
            state.gameOverReason = 'fleet_destroyed';
          }
        }

        // Feed line
        state.feed.push({
          turn: state.turnNumber,
          shooterIndex: shooterIdx,
          r: ev.r,
          c: ev.c,
          outcome,
          shipName: ev.shipName
        });

        state.shotHistory.push({
          turn: state.turnNumber,
          shooterIndex: shooterIdx,
          r: ev.r,
          c: ev.c,
          outcome,
          shipId: ev.shipId,
          shipName: ev.shipName
        });

        state.log.push(ev);
        state.pendingShot = null;

        // Turn advancement if game not ended
        if (state.phase === 'playing') {
          if (state.matchConfig.salvo) {
            // Salvo mode: if continueOnHit, hits don't consume salvo shot
            if (state.matchConfig.continueOnHit && (outcome === 'hit' || outcome === 'sunk')) {
              // bonus shot, remaining salvo intact
            } else {
              state.shotsRemainingInTurn--;
            }

            if (state.shotsRemainingInTurn <= 0) {
              // Salvo exhausted: switch turn to opponent
              state.currentTurn = 1 - shooterIdx;
              state.turnNumber++;
              const nextSurviving = state.boards[state.currentTurn].totalShips - state.boards[1 - state.currentTurn].sunkShips.length;
              state.shotsRemainingInTurn = Math.max(1, nextSurviving);
            }
          } else {
            // Standard mode
            if ((outcome === 'hit' || outcome === 'sunk') && state.matchConfig.continueOnHit) {
              // Shooter keeps the turn
            } else {
              state.currentTurn = 1 - shooterIdx;
              state.turnNumber++;
              state.shotsRemainingInTurn = 1;
            }
          }
          state.turnStartTime = ev.timestamp || Date.now();
        }
        break;
      }

      case 'TECH_FIRE': {
        if (state.phase !== 'playing') return;
        if (state.matchConfig.mode !== 'tatico') return;
        if (ev.shooterIndex !== state.currentTurn) return;
        if (state.players[ev.shooterIndex].techniqueUsed) return;
        if (state.pendingShot !== null || state.pendingTech !== null) return;

        state.players[ev.shooterIndex].techniqueUsed = true;

        if (ev.techId === 'vortice') {
          // Blackbeard Vórtice self-buff: absorbs next incoming shot
          state.players[ev.shooterIndex].shieldActive = true;
          state.log.push(ev);
          state.feed.push({
            turn: state.turnNumber,
            shooterIndex: ev.shooterIndex,
            techId: 'vortice',
            message: 'Vórtice ativado! O próximo tiro inimigo será absorvido.'
          });
          // Costs the turn
          state.currentTurn = 1 - ev.shooterIndex;
          state.turnNumber++;
          if (state.matchConfig.salvo) {
            const nextSurviving = state.boards[state.currentTurn].totalShips - state.boards[1 - state.currentTurn].sunkShips.length;
            state.shotsRemainingInTurn = Math.max(1, nextSurviving);
          } else {
            state.shotsRemainingInTurn = 1;
          }
          state.turnStartTime = ev.timestamp || Date.now();
        } else {
          // Interactive technique requiring defender answer
          state.pendingTech = {
            seq: ev.seq,
            turn: state.turnNumber,
            shooterIndex: ev.shooterIndex,
            techId: ev.techId,
            params: ev.params,
            timestamp: ev.timestamp
          };
          state.log.push(ev);
        }
        break;
      }

      case 'TECH_ANSWER': {
        if (state.phase !== 'playing') return;
        if (!state.pendingTech) return;

        const shooterIdx = state.pendingTech.shooterIndex;
        const defenderIdx = 1 - shooterIdx;
        if (ev.defenderIndex !== defenderIdx) return;

        if (ev.result && Array.isArray(ev.result.cellOutcomes)) {
          for (const co of ev.result.cellOutcomes) {
            const cellKey = `${co.r},${co.c}`;
            if (state.boards[shooterIdx].shots[cellKey]) continue;
            if (co.outcome === 'absorbed') {
              state.players[defenderIdx].shieldActive = false;
            }
            state.boards[shooterIdx].shots[cellKey] = {
              r: co.r,
              c: co.c,
              outcome: co.outcome || 'water',
              shipId: co.shipId,
              shipName: co.shipName,
              sunkCells: co.sunkCells,
              turn: state.turnNumber
            };
            if (co.outcome === 'sunk') {
              state.boards[shooterIdx].remainingShips = Math.max(0, state.boards[shooterIdx].remainingShips - 1);
              state.boards[shooterIdx].sunkShips.push({
                id: co.shipId,
                name: co.shipName,
                sunkCells: co.sunkCells
              });
              if (state.boards[shooterIdx].remainingShips === 0) {
                state.phase = 'game_over';
                state.winner = shooterIdx;
                state.gameOverReason = 'fleet_destroyed';
              }
            }
          }
        }

        state.feed.push({
          turn: state.turnNumber,
          shooterIndex: shooterIdx,
          techId: state.pendingTech.techId,
          result: ev.result
        });

        state.log.push(ev);
        state.pendingTech = null;

        if (state.phase === 'playing') {
          state.currentTurn = 1 - shooterIdx;
          state.turnNumber++;
          if (state.matchConfig.salvo) {
            const nextSurviving = state.boards[state.currentTurn].totalShips - state.boards[1 - state.currentTurn].sunkShips.length;
            state.shotsRemainingInTurn = Math.max(1, nextSurviving);
          } else {
            state.shotsRemainingInTurn = 1;
          }
          state.turnStartTime = ev.timestamp || Date.now();
        }
        break;
      }

      case 'TURN_TIMEOUT': {
        if (state.phase !== 'playing') return;
        if (ev.playerIndex !== state.currentTurn) return;

        // Auto-fire cell
        const autoShot = ev.autoShot || getDeterministicAutoShot(
          state.matchConfig.seed,
          state.turnNumber,
          state.matchConfig.boardSize,
          state.boards[ev.playerIndex].shots
        );

        if (autoShot) {
          state.pendingShot = {
            seq: ev.seq,
            turn: state.turnNumber,
            shooterIndex: ev.playerIndex,
            r: autoShot.r,
            c: autoShot.c,
            isTimeoutAutoShot: true,
            timestamp: ev.timestamp
          };
          state.log.push(ev);
        }
        break;
      }

      case 'FLEET_REVEAL': {
        const pIdx = ev.playerIndex;
        if ((pIdx === 0 || pIdx === 1) && state.reveals[pIdx]) break; // first reveal per seat is final
        if (pIdx === 0 || pIdx === 1) {
          state.reveals[pIdx] = {
            fleet: canonicalizeFleet(ev.fleet),
            salt: ev.salt,
            timestamp: ev.timestamp
          };
        }
        state.log.push(ev);
        break;
      }

      case 'GAME_OVER': {
        if (state.phase === 'game_over') {
          break;
        }
        if (ev.winnerIndex !== 0 && ev.winnerIndex !== 1) break;
        if (typeof ev.forfeitedBy === 'number' && ev.winnerIndex !== 1 - ev.forfeitedBy) break;
        // An absence claim only counts against a match in progress (never in lobby/setup).
        if (isAbsenceClaim(ev) && state.phase !== 'playing') break;
        state.absenceClaimSeq = isAbsenceClaim(ev) ? ev.seq : null;
        state.phase = 'game_over';
        state.winner = ev.winnerIndex;
        state.gameOverReason = ev.reason || 'manual_forfeit';
        state.forfeitedBy = typeof ev.forfeitedBy === 'number' ? ev.forfeitedBy : null;
        state.log.push(ev);
        break;
      }

      case 'REACTION': {
        if (isValidReaction(ev.reactionId)) {
          state.feed.push({
            type: 'reaction',
            playerIndex: ev.playerIndex,
            reactionId: ev.reactionId,
            timestamp: ev.timestamp
          });
        }
        break;
      }

      case 'REMATCH_REQUEST': {
        const pIdx = ev.playerIndex;
        if (pIdx === 0 || pIdx === 1) {
          state.rematchRequested[pIdx] = true;
          // If BOTH players have requested rematch, reset match back to lobby phase
          if (state.rematchRequested[0] && state.rematchRequested[1]) {
            state.phase = 'lobby';
            state.rematchRequested = [false, false];
            state.pendingShot = null;
            state.pendingTech = null;
            state.currentTurn = 0;
            state.turnTimerRemaining = state.matchConfig.turnTimer || 0;
            state.winner = null;
            state.gameOverReason = null;
            state.forfeitedBy = null;
            state.integrity = null;
            state.reveals = [null, null];

            for (let i = 0; i < state.players.length; i++) {
              const p = state.players[i];
              p.ready = false;
              p.techniqueUsed = false;
              p.shieldActive = false;
              p.forfeit = false;
              p.fleetRevealed = false;
            }

            for (let b = 0; b < state.boards.length; b++) {
              const board = state.boards[b];
              board.shots = {};
              board.sunkShips = [];
              board.remainingShips = board.totalShips;
              board.fleet = null;
              board.salt = null;
            }
          }
        }
        break;
      }

      case 'PRESENCE': // refutation of an absence claim: proof of life, nothing else
      case 'HEARTBEAT': {
        const pIdx = ev.playerIndex;
        if (pIdx === 0 || pIdx === 1) {
          state.players[pIdx].lastHeartbeat = ev.timestamp || Date.now();
          state.players[pIdx].connected = true;
        }
        break;
      }
    }
  }

  // =========================================================================
  // Cryptographic Anti-Cheat Verification (verifyMatchIntegrity)
  // =========================================================================

  /**
   * Validates fleet placement according to board rules.
   */
  function validateFleetGeometry(fleet, boardSize, boardId, allowTouch = false) {
    const boardDef = CANONICAL_BOARDS[boardId] || CANONICAL_BOARDS.classica;
    const requiredShipIds = [...boardDef.ships].sort();
    const providedShipIds = fleet.map(s => s.id).sort();

    // Check ship list matches board requirements: same count, unique ids, and the board's
    // exact multiset of lengths. Crew-themed fleets (rules.THEMATIC_FLEETS) rename the ships
    // but keep the canonical slots, so ids are checked for shape, lengths for the rules.
    if (requiredShipIds.length !== providedShipIds.length) {
      return { valid: false, reason: 'Quantidade incorreta de navios para o tabuleiro' };
    }
    for (let i = 0; i < providedShipIds.length; i++) {
      const id = providedShipIds[i];
      if (typeof id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(id) || (i > 0 && providedShipIds[i - 1] === id)) {
        return { valid: false, reason: `Navio ausente ou desconhecido: ${id}` };
      }
    }
    const requiredLengths = requiredShipIds.map(id => CANONICAL_SHIPS[id].length).sort((a, b) => a - b);
    const providedLengths = fleet.map(s => (Array.isArray(s.cells) ? s.cells.length : 0)).sort((a, b) => a - b);
    if (requiredLengths.join(',') !== providedLengths.join(',')) {
      return { valid: false, reason: `Comprimentos dos navios não correspondem ao tabuleiro (${providedLengths.join(',')})` };
    }

    const occupied = new Map(); // 'r,c' -> shipId

    for (const ship of fleet) {
      const def = CANONICAL_SHIPS[ship.id];
      if (def && ship.cells.length !== def.length) {
        return { valid: false, reason: `Comprimento incorreto para o navio ${ship.id}` };
      }

      // Check collinearity & contiguity
      if (ship.cells.length > 1) {
        const sorted = ship.cells.slice().sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c);
        const sameRow = sorted.every(c => c.r === sorted[0].r);
        const sameCol = sorted.every(c => c.c === sorted[0].c);

        if (!sameRow && !sameCol) {
          return { valid: false, reason: `Células do navio ${ship.id} não são colineares (devem estar na mesma linha ou coluna)` };
        }

        if (sameRow) {
          for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].c !== sorted[0].c + i) {
              return { valid: false, reason: `Células do navio ${ship.id} não são contíguas horizontalmente` };
            }
          }
        } else if (sameCol) {
          for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].r !== sorted[0].r + i) {
              return { valid: false, reason: `Células do navio ${ship.id} não são contíguas verticalmente` };
            }
          }
        }
      }

      // Check bounds & overlaps
      for (const cell of ship.cells) {
        if (cell.r < 0 || cell.r >= boardSize || cell.c < 0 || cell.c >= boardSize) {
          return { valid: false, reason: `Navio ${ship.id} fora dos limites do tabuleiro (${cell.r}, ${cell.c})` };
        }
        const key = `${cell.r},${cell.c}`;
        if (occupied.has(key)) {
          return { valid: false, reason: `Sobreposição detectada em (${cell.r}, ${cell.c}) entre ${occupied.get(key)} e ${ship.id}` };
        }
        occupied.set(key, ship.id);
      }
    }

    // Touch rule enforcement if allowTouch is false
    if (!allowTouch) {
      for (const ship of fleet) {
        for (const cell of ship.cells) {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = cell.r + dr;
              const nc = cell.c + dc;
              const neighborKey = `${nr},${nc}`;
              if (occupied.has(neighborKey) && occupied.get(neighborKey) !== ship.id) {
                return { valid: false, reason: `Navios ${ship.id} e ${occupied.get(neighborKey)} estão se tocando em (${nr}, ${nc})` };
              }
            }
          }
        }
      }
    }

    return { valid: true };
  }

  /**
   * Verify match integrity at game conclusion.
   * Flexibly accepts either:
   *   verifyMatchIntegrity(foldedState, reveals, boardConfig)
   * or
   *   verifyMatchIntegrity(moveLog, commitments, reveals, boardConfig)
   */
  async function verifyMatchIntegrity(arg1, arg2, arg3, arg4) {
    let foldedState;
    let reveals;
    let boardConfig;

    if (arg1 && arg1.players && arg1.boards) {
      // Called with (foldedState, reveals, boardConfig)
      foldedState = arg1;
      reveals = arg2 || foldedState.reveals;
      boardConfig = arg3 || foldedState.matchConfig;
    } else {
      // Called with (moveLog, commitments, reveals, boardConfig)
      const moveLog = arg1 || [];
      const commitments = arg2 || [];
      reveals = arg3 || [null, null];
      boardConfig = arg4 || {};
      foldedState = foldMatchLog(moveLog, boardConfig);
      if (commitments[0]) foldedState.players[0].commitment = commitments[0];
      if (commitments[1]) foldedState.players[1].commitment = commitments[1];
    }

    if (!reveals || !reveals[0] || !reveals[1]) {
      const has0 = Boolean(reveals && reveals[0]);
      const has1 = Boolean(reveals && reveals[1]);
      let cheaterIndex = null;
      if (has0 && !has1) cheaterIndex = 1;
      else if (!has0 && has1) cheaterIndex = 0;

      return {
        valid: false,
        cheaterIndex,
        reason: 'missing_reveals',
        message: cheaterIndex !== null
          ? `Trapaça detectada: jogador ${cheaterIndex} recusou-se a revelar a frota!`
          : 'Trapaça detectada: revelação de frota incompleta!'
      };
    }

    const boardSize = boardConfig.boardSize || foldedState.matchConfig.boardSize || 10;
    const boardId = boardConfig.boardId || foldedState.matchConfig.boardId || 'classica';
    const allowTouch = boardConfig.allowTouch ?? foldedState.matchConfig.allowTouch ?? false;

    // Step 1: Verify SHA-256 Commitments for both players
    for (let p = 0; p <= 1; p++) {
      const storedCommitment = foldedState.players[p].commitment;
      if (!storedCommitment) {
        return {
          valid: false,
          cheaterIndex: p,
          reason: 'missing_commitment',
          message: `Trapaça detectada: jogador ${p} não enviou compromisso SHA-256 inicial!`
        };
      }

      const computed = await computeCommitment(reveals[p].fleet, reveals[p].salt);
      if (computed.toLowerCase() !== storedCommitment.toLowerCase()) {
        return {
          valid: false,
          cheaterIndex: p,
          reason: 'commitment_mismatch',
          message: `Trapaça detectada: comprometimento SHA-256 do jogador ${p} não confere com a frota revelada!`
        };
      }
    }

    // Step 2: Validate fleet placement geometry according to rules
    for (let p = 0; p <= 1; p++) {
      const geomCheck = validateFleetGeometry(reveals[p].fleet, boardSize, boardId, allowTouch);
      if (!geomCheck.valid) {
        return {
          valid: false,
          cheaterIndex: p,
          reason: 'invalid_fleet_placement',
          message: `Trapaça detectada: frota do jogador ${p} possui posicionamento ilegal (${geomCheck.reason})!`
        };
      }
    }

    // Step 3: Replay all shot and technique answers against revealed fleets
    const hitsTaken = [new Set(), new Set()];
    let shieldActive = [false, false];
    let lastTechParams = {};

    for (const ev of foldedState.log) {
      if (ev.type === 'TECH_FIRE') {
        lastTechParams = ev.params || {};
        if (ev.techId === 'vortice') {
          shieldActive[ev.shooterIndex] = true;
        }
      }

      if (ev.type === 'SHOT_ANSWER') {
        const defender = ev.defenderIndex;
        const secretFleet = reveals[defender].fleet;
        const currentShield = shieldActive[defender];

        // Compute true expected outcome
        const expected = evaluateShotAnswer(secretFleet, ev.r, ev.c, hitsTaken[defender], currentShield);

        if (expected.shieldConsumed) {
          shieldActive[defender] = false;
        }

        // Compare reported outcome with expected outcome
        if (ev.outcome !== expected.outcome) {
          return {
            valid: false,
            cheaterIndex: defender,
            reason: 'falsified_shot_answer',
            message: `Trapaça detectada: jogador ${defender} mentiu no tiro (${ev.r}, ${ev.c})! Declarou "${ev.outcome}", mas o correto era "${expected.outcome}".`
          };
        }

        // If outcome is hit or sunk, verify shipId and sunkCells
        if (expected.outcome === 'sunk') {
          if (ev.shipId !== expected.shipId) {
            return {
              valid: false,
              cheaterIndex: defender,
              reason: 'falsified_ship_id',
              message: `Trapaça detectada: jogador ${defender} declarou afundamento do navio errado!`
            };
          }

          // Strict sunkCells verification
          const sortCells = (arr) => (arr || []).slice().sort((a, b) => a.r !== b.r ? a.r - b.r : a.c - b.c);
          const reportedSunk = sortCells(ev.sunkCells);
          const expectedSunk = sortCells(expected.sunkCells);

          if (reportedSunk.length !== expectedSunk.length) {
            return {
              valid: false,
              cheaterIndex: defender,
              reason: 'sunk_cells_mismatch',
              message: `Trapaça detectada: jogador ${defender} informou quantidade errada de células afundadas!`
            };
          }

          for (let i = 0; i < reportedSunk.length; i++) {
            if (reportedSunk[i].r !== expectedSunk[i].r || reportedSunk[i].c !== expectedSunk[i].c) {
              return {
                valid: false,
                cheaterIndex: defender,
                reason: 'sunk_cells_mismatch',
                message: `Trapaça detectada: jogador ${defender} falsificou coordenadas do navio afundado!`
              };
            }
          }
        }

        hitsTaken[defender].add(`${ev.r},${ev.c}`);
      }

      if (ev.type === 'TECH_ANSWER') {
        const defender = ev.defenderIndex;
        const secretFleet = reveals[defender].fleet;
        const techId = ev.techId;
        const techParams = ev.params || lastTechParams || {};

        if (techId === 'bazooka' || techId === 'tremor') {
          const expectedAnswer = evaluateTechAnswer(secretFleet, techId, techParams, hitsTaken[defender], boardSize, shieldActive[defender]);
          const reportedList = (ev.result && ev.result.cellOutcomes) || [];
          const expectedList = expectedAnswer.result.cellOutcomes || [];
          if (reportedList.length !== expectedList.length) {
            return {
              valid: false,
              cheaterIndex: defender,
              reason: 'falsified_tech_volley',
              message: `Trapaça detectada: jogador ${defender} adulterou células da técnica ${techId}!`
            };
          }
          for (let i = 0; i < expectedList.length; i++) {
            if (reportedList[i].outcome !== expectedList[i].outcome) {
              return {
                valid: false,
                cheaterIndex: defender,
                reason: 'falsified_tech_volley',
                message: `Trapaça detectada: jogador ${defender} mentiu na resposta da técnica ${techId}!`
              };
            }
            if (expectedList[i].outcome === 'absorbed') {
              shieldActive[defender] = false;
            }
            if (expectedList[i].outcome === 'hit' || expectedList[i].outcome === 'sunk') {
              hitsTaken[defender].add(`${expectedList[i].r},${expectedList[i].c}`);
            }
          }
        }

        if (techId === 'haki_do_rei') {
          const expectedAnswer = evaluateTechAnswer(secretFleet, techId, techParams, hitsTaken[defender], boardSize);
          if (ev.result?.sonarDetected !== expectedAnswer.result.sonarDetected) {
            return {
              valid: false,
              cheaterIndex: defender,
              reason: 'falsified_tech_sonar',
              message: `Trapaça detectada: jogador ${defender} mentiu na resposta do Haki do Rei (sonar)!`
            };
          }
        }

        if (techId === 'room') {
          const expectedAnswer = evaluateTechAnswer(secretFleet, techId, techParams, hitsTaken[defender], boardSize);
          if (ev.result?.rowColCount !== expectedAnswer.result.rowColCount) {
            return {
              valid: false,
              cheaterIndex: defender,
              reason: 'falsified_tech_room',
              message: `Trapaça detectada: jogador ${defender} mentiu na contagem de navios no Room!`
            };
          }
        }
      }
    }

    return {
      valid: true,
      cheaterIndex: null,
      message: 'Partida verificada com sucesso! Nenhuma trapaça detectada.'
    };
  }

  // =========================================================================
  // High-Level PvP Match Client Controller (PvpMatchClient)
  // =========================================================================

  class PvpMatchClient {
    /**
     * @param {object} options
     * @param {object} options.transport - Transport instance (Artifact or InMemory)
     * @param {string} options.roomId - 5-char room code
     * @param {string} options.playerId - Unique player id
     * @param {number} [options.playerIndex=0] - 0 (host) or 1 (guest)
     * @param {string} [options.nickname] - Display name
     * @param {string} [options.crewId] - Canonical crew id
     * @param {Array<object>} [options.fleet] - Placed fleet
     * @param {string} [options.salt] - Cryptographic salt
     * @param {string} [options.role='player'] - 'player' | 'spectator'
     * @param {object} [options.matchConfig] - Rules & configuration
     * @param {Function} [options.onStateChange] - Callback invoked when match state updates
     */
    constructor(options) {
      if (!options.transport || !options.roomId || !options.playerId) {
        throw new Error('PvpMatchClient requires transport, roomId, and playerId.');
      }

      this.transport = options.transport;
      this.roomId = options.roomId;
      this.playerId = options.playerId;
      this.playerIndex = options.playerIndex !== undefined ? options.playerIndex : 0;
      this.nickname = options.nickname || generateDefaultNickname();
      this.crewId = options.crewId || 'straw_hats';
      this.fleet = options.fleet || [];
      this.salt = options.salt || generateSalt();
      this.role = options.role || 'player';
      this.matchConfig = options.matchConfig || {};
      this.onStateChange = options.onStateChange || null;

      this.rawEvents = [];
      this.state = createInitialMatchState(this.matchConfig);
      this.state.roomId = this.roomId;

      this.hitsTaken = new Set();
      // Live presence (HEARTBEAT) is kept apart from the match log: it never enters rawEvents,
      // never triggers a fold and only notifies the UI when a seat goes from absent to present.
      this._presence = [0, 0];
      this.seqCounter = 1;
      this.heartbeatTimer = null;
      this.livenessTimer = null;
      this.unsubscribe = null;
      this.isDestroyed = false;

      this._init();
    }

    _init() {
      // Read initial room state from transport
      const initialLog = this.transport.read(this.roomId) || [];
      this.rawEvents = initialLog.slice();
      // Advance the counter only from seqs the fold accepts (inside the seq window)
      this.seqCounter = Math.max(this.seqCounter, seqWindow(this.rawEvents).maxSeq + 1);
      this.state = foldMatchLog(this.rawEvents, this.matchConfig);
      this._applyPresence();
      this._applyAbsenceIntegrity();

      // Subscribe to transport updates
      this.unsubscribe = this.transport.subscribe(this.roomId, (event) => {
        this._handleIncomingEvent(event);
      });

      // Start periodic heartbeat (every 3000ms)
      this.startHeartbeatTimer();

      // Rejoin after a refresh: rebuild private bookkeeping from the public log and finish
      // any duty this client owed before it went away (answer a pending shot, reveal).
      this._rebuildHitsTaken();
      this._resumePendingDuties();
    }

    _rebuildHitsTaken() {
      if (this.role !== 'player' || (this.playerIndex !== 0 && this.playerIndex !== 1)) return;
      const shooterBoard = this.state.boards && this.state.boards[1 - this.playerIndex];
      const shots = (shooterBoard && shooterBoard.shots) || {};
      for (const key of Object.keys(shots)) {
        const s = shots[key];
        if (s && (s.outcome === 'hit' || s.outcome === 'sunk')) this.hitsTaken.add(key);
      }
    }

    _resumePendingDuties() {
      if (this.role !== 'player' || !Array.isArray(this.fleet) || this.fleet.length === 0) return;
      if (this.rawEvents.length === 0) return;
      const st = this.state;
      if (st.phase === 'playing') {
        const shot = st.pendingShot;
        if (shot && shot.shooterIndex !== this.playerIndex && (1 - st.currentTurn) === this.playerIndex) {
          this._autoAnswerShot(shot);
        }
        const tech = this.state.pendingTech;
        if (tech && tech.shooterIndex !== this.playerIndex) {
          this._autoAnswerTech(tech);
        }
      } else if (st.phase === 'game_over' && this._absenceEnd()) {
        this._refuteAbsence();
      } else if (st.phase === 'game_over' && st.reveals && !st.reveals[this.playerIndex] && this.salt) {
        this.revealFleet();
      }
    }

    /** True when the match ended on an absence claim (no reveal, no audit possible). */
    _absenceEnd() {
      return this.state.phase === 'game_over' && this.state.gameOverReason === 'forfeit' && this.state.forfeitedBy === null;
    }

    _applyAbsenceIntegrity() {
      if (this._absenceEnd() && !this.state.integrity) {
        this.state.integrity = {
          valid: null,
          cheaterIndex: null,
          reason: 'absence_unverified',
          message: 'Vitória por ausência do rival: as frotas não foram reveladas, então não há auditoria.'
        };
      }
    }

    /**
     * An absence claim against this (live) client is answered with a PRESENCE proof at the
     * claim's seq, which voids the claim in every fold. Returns true when it refuted one.
     */
    _refuteAbsence() {
      if (this.role !== 'player' || (this.playerIndex !== 0 && this.playerIndex !== 1)) return false;
      if (!this._absenceEnd() || this.state.winner !== 1 - this.playerIndex) return false;
      // The claim the fold accepted (admissible, integer seq): answer exactly that seq.
      const claim = { seq: this.state.absenceClaimSeq };
      if (!Number.isSafeInteger(claim.seq)) return false;
      const proof = createEvent('PRESENCE', { seq: claim.seq, playerIndex: this.playerIndex });
      proof.eventId = `presence_s${claim.seq}_p${this.playerIndex}`;
      this.transport.publish(this.roomId, proof);
      if (!this.rawEvents.some(e => e.eventId === proof.eventId && actingSeat(e) === this.playerIndex)) {
        this.rawEvents.push(proof);
      }
      this.seqCounter = Math.max(this.seqCounter, claim.seq + 1);
      this.state = foldMatchLog(this.rawEvents, this.matchConfig);
      this._applyPresence();
      if (typeof this.onStateChange === 'function') this.onStateChange(this.state);
      return true;
    }

    /** Re-apply live presence on top of a freshly folded state. */
    _applyPresence() {
      if (!this._presence || !this.state || !this.state.players) return;
      for (let i = 0; i < 2; i++) {
        const p = this.state.players[i];
        if (p && this._presence[i] && this._presence[i] > (p.lastHeartbeat || 0)) {
          p.lastHeartbeat = this._presence[i];
          p.connected = true;
        }
      }
    }

    _handleIncomingEvent(event) {
      if (this.isDestroyed || !event) return;
      if (!isAuthorConsistent(event)) return;

      if (event.type === 'HEARTBEAT') {
        const pIdx = event.playerIndex;
        if (pIdx !== 0 && pIdx !== 1) return;
        const before = this.state.players[pIdx];
        const wasPresent = !!(before && before.lastHeartbeat);
        this._presence[pIdx] = Math.max(this._presence[pIdx] || 0, event.timestamp || Date.now());
        this._applyPresence();
        if (!wasPresent && typeof this.onStateChange === 'function') this.onStateChange(this.state);
        return;
      }

      // Deduplicate by (author, eventId): another author can never shadow an id
      const key = eventKey(event);
      if (key && this.rawEvents.some(e => eventKey(e) === key)) {
        return;
      }
      this.rawEvents.push(event);
      this.seqCounter = Math.max(this.seqCounter, seqWindow(this.rawEvents).maxSeq + 1);

      // Fold updated log
      const oldPhase = this.state.phase;
      this.state = foldMatchLog(this.rawEvents, this.matchConfig);
      this._applyPresence();
      if (this._refuteAbsence()) return;
      this._applyAbsenceIntegrity();

      // Auto-answer shots if this client is the defender
      if (this.role === 'player' && this.state.phase === 'playing') {
        const defenderIdx = 1 - this.state.currentTurn;
        if (defenderIdx === this.playerIndex && this.state.pendingShot) {
          const shot = this.state.pendingShot;
          if (shot.shooterIndex !== this.playerIndex) {
            this._autoAnswerShot(shot);
          }
        }

        // Auto-answer techniques if applicable
        if (this.state.pendingTech && this.state.pendingTech.shooterIndex !== this.playerIndex) {
          this._autoAnswerTech(this.state.pendingTech);
        }
      }

      // If game transitioned to game_over, reveal fleet and run verification
      if (this.state.phase === 'game_over' && oldPhase !== 'game_over') {
        this.gameOverTimestamp = Date.now();
        // Never reveal on an absence claim: if the rival was alive the claim is voided and the
        // match resumes, so the fleet must still be secret.
        if (this.role === 'player' && !this._absenceEnd()) {
          this.revealFleet();
        }
      }

      // If rematch transitioned back to lobby, reset client state for the next battle
      if (this.state.phase === 'lobby' && (oldPhase === 'game_over' || oldPhase === 'reveal')) {
        this.hitsTaken.clear();
        this.fleet = null;
        this.salt = null;
      }

      // Check if both reveals are present to trigger verification
      if (this.state.reveals[0] && this.state.reveals[1] && !this.state.integrity) {
        this._runIntegrityCheck();
      }

      if (typeof this.onStateChange === 'function') {
        this.onStateChange(this.state);
      }
    }

    _autoAnswerShot(shot) {
      const shield = this.state.players[this.playerIndex].shieldActive;
      const answer = evaluateShotAnswer(this.fleet, shot.r, shot.c, this.hitsTaken, shield);

      if (answer.outcome === 'hit' || answer.outcome === 'sunk') {
        this.hitsTaken.add(`${shot.r},${shot.c}`);
      }

      const answerEvent = createEvent('SHOT_ANSWER', {
        seq: shot.seq + 1,
        turn: shot.turn,
        defenderIndex: this.playerIndex,
        r: shot.r,
        c: shot.c,
        outcome: answer.outcome,
        shipId: answer.shipId,
        shipName: answer.shipName,
        sunkCells: answer.sunkCells
      });
      // Idempotent by seq: a re-answer after a refresh collapses onto the same event.
      answerEvent.eventId = `shot_answer_s${shot.seq}_${shot.r}_${shot.c}`;

      this.seqCounter = Math.max(this.seqCounter, answerEvent.seq + 1);
      this.transport.publish(this.roomId, answerEvent);
    }

    _autoAnswerTech(pendingTech) {
      const techId = pendingTech.techId;
      if (['bazooka', 'tremor', 'haki_do_rei', 'room', 'observacao'].includes(techId)) {
        const shield = this.state.players[this.playerIndex].shieldActive;
        const answer = evaluateTechAnswer(
          this.fleet,
          techId,
          pendingTech.params,
          this.hitsTaken,
          this.state.matchConfig.boardSize,
          shield
        );

        if (answer.result && Array.isArray(answer.result.cellOutcomes)) {
          for (const co of answer.result.cellOutcomes) {
            if (co.outcome === 'hit' || co.outcome === 'sunk') {
              this.hitsTaken.add(`${co.r},${co.c}`);
            }
          }
        }

        const techAnswerEvent = createEvent('TECH_ANSWER', {
          seq: pendingTech.seq + 1,
          turn: pendingTech.turn,
          defenderIndex: this.playerIndex,
          techId,
          params: pendingTech.params,
          result: answer.result
        });
        techAnswerEvent.eventId = `tech_answer_s${pendingTech.seq}_${String(techId).replace(/[^a-z_]/g, '')}`;

        this.seqCounter = Math.max(this.seqCounter, techAnswerEvent.seq + 1);
        this.transport.publish(this.roomId, techAnswerEvent);
      }
    }

    async waitForIntegrity(timeoutMs = 2000) {
      if (this.state.integrity) return this.state.integrity;
      const start = Date.now();
      while (!this.state.integrity && (Date.now() - start) < timeoutMs) {
        await new Promise(r => setTimeout(r, 20));
      }
      return this.state.integrity;
    }

    async _runIntegrityCheck() {
      const verification = await verifyMatchIntegrity(this.state, this.state.reveals, this.state.matchConfig);
      this.state.integrity = verification;

      if (!verification.valid && verification.cheaterIndex !== null) {
        // Disqualify cheater and award victory to honest player
        this.state.winner = 1 - verification.cheaterIndex;
        this.state.gameOverReason = 'cheat_detected';
      }

      if (typeof this.onStateChange === 'function') {
        this.onStateChange(this.state);
      }
    }

    async readyUp() {
      if (this.role !== 'player') return;
      const commitment = await computeCommitment(this.fleet, this.salt);
      const readyEvent = createEvent('READY_COMMIT', {
        playerId: this.playerId,
        playerIndex: this.playerIndex,
        crewId: this.crewId,
        commitment
      });
      this.transport.publish(this.roomId, readyEvent);
    }

    fireShot(r, c) {
      if (this.role !== 'player') throw new Error('Espectadores não podem disparar canhões.');
      if (this.state.phase !== 'playing') throw new Error('A partida não está em andamento.');
      if (this.state.currentTurn !== this.playerIndex) {
        throw new Error((T && T.errors && T.errors.notYourTurn) || 'Não é o seu turno de disparar os canhões!');
      }
      if (this.state.pendingShot !== null) throw new Error('Aguardando resposta do tiro anterior.');

      const fireEvent = createEvent('SHOT_FIRE', {
        seq: this.seqCounter++,
        turn: this.state.turnNumber,
        shooterIndex: this.playerIndex,
        r,
        c
      });

      this.transport.publish(this.roomId, fireEvent);
      return fireEvent;
    }

    useTechnique(techId, params = {}) {
      if (this.role !== 'player') throw new Error('Espectadores não podem usar técnicas.');
      if (this.state.phase !== 'playing') throw new Error('A partida não está em andamento.');
      if (this.state.currentTurn !== this.playerIndex) {
        throw new Error((T && T.errors && T.errors.notYourTurn) || 'Não é o seu turno de disparar os canhões!');
      }

      const techEvent = createEvent('TECH_FIRE', {
        seq: this.seqCounter++,
        turn: this.state.turnNumber,
        shooterIndex: this.playerIndex,
        techId,
        params
      });

      this.transport.publish(this.roomId, techEvent);
      return techEvent;
    }

    sendReaction(reactionId) {
      if (!isValidReaction(reactionId)) {
        throw new Error(`Invalid reactionId: ${reactionId}`);
      }
      const reactionEvent = createEvent('REACTION', {
        playerIndex: this.playerIndex,
        reactionId
      });
      this.transport.publish(this.roomId, reactionEvent);
    }

    selectCrew(crewId) {
      if (this.role !== 'player') return;
      this.crewId = crewId;
      if (this.state && this.state.players && this.state.players[this.playerIndex]) {
        this.state.players[this.playerIndex].crewId = crewId;
      }
      const crewEvent = createEvent('CREW_SELECTED', {
        playerIndex: this.playerIndex,
        crewId: crewId
      });
      this.transport.publish(this.roomId, crewEvent);
      return crewEvent;
    }

    revealFleet() {
      if (this.role !== 'player') return;
      const revealEvent = createEvent('FLEET_REVEAL', {
        playerIndex: this.playerIndex,
        fleet: canonicalizeFleet(this.fleet),
        salt: this.salt
      });
      this.transport.publish(this.roomId, revealEvent);
    }

    forfeit() {
      if (this.role !== 'player') {
        throw new Error('Espectadores não podem abandonar a partida.');
      }
      if (this.state.phase !== 'playing') {
        throw new Error(`Não é possível abandonar a partida no estado atual: ${this.state.phase}`);
      }

      const gameOverEvent = createEvent('GAME_OVER', {
        seq: this.seqCounter++,
        turn: this.state.turnNumber,
        winnerIndex: 1 - this.playerIndex,
        forfeitedBy: this.playerIndex,
        reason: 'manual_forfeit'
      });

      this.transport.publish(this.roomId, gameOverEvent);
      return gameOverEvent;
    }

    requestRematch() {
      const rematchEvent = createEvent('REMATCH_REQUEST', {
        playerIndex: this.playerIndex
      });
      this.transport.publish(this.roomId, rematchEvent);
    }

    checkLiveness(now = Date.now()) {
      if (this.state.phase === 'game_over') {
        // Reveal timeout check: if I revealed and opponent did not reveal within 15,000ms
        const myReveal = this.state.reveals[this.playerIndex];
        const oppReveal = this.state.reveals[1 - this.playerIndex];
        if (myReveal && !oppReveal) {
          const gameOverTime = this.gameOverTimestamp || this.state.lastActionTimestamp || now;
          if (now - gameOverTime > 15000) {
            if (!this.state.integrity) {
              this.state.integrity = {
                valid: false,
                cheaterIndex: 1 - this.playerIndex,
                reason: 'reveal_timeout',
                message: `Trapaça detectada: tempo limite de revelação esgotado para o jogador ${1 - this.playerIndex}!`
              };
              this.state.winner = this.playerIndex;
              this.state.gameOverReason = 'cheat_detected';
              if (typeof this.onStateChange === 'function') {
                this.onStateChange(this.state);
              }
            }
            return 'forfeit';
          }
        }
        return 'online';
      }

      if (this.state.phase !== 'playing') return 'online';
      const opponentIdx = 1 - this.playerIndex;
      const opp = this.state.players[opponentIdx];

      if (!opp || !opp.lastHeartbeat) return 'waiting';
      const elapsed = now - opp.lastHeartbeat;

      if (elapsed > 60000) {
        // Forfeit after 60 seconds
        if (this.state.phase === 'playing') {
          // Absence claim at the next seq: voided by any later event of the accused.
          const gameOverEvent = createEvent('GAME_OVER', {
            seq: this.seqCounter,
            winnerIndex: this.playerIndex,
            reason: 'forfeit'
          });
          this.transport.publish(this.roomId, gameOverEvent);
        }
        return 'forfeit';
      }

      if (elapsed > 10000) {
        return 'reconnecting'; // "Adversário reconectando…"
      }

      return 'online';
    }

    startHeartbeatTimer() {
      this.stopHeartbeatTimer();
      // Send initial heartbeat
      this.transport.heartbeat(this.roomId, {
        playerId: this.playerId,
        playerIndex: this.playerIndex,
        status: 'online'
      });

      if (typeof setInterval !== 'undefined') {
        this.heartbeatTimer = setInterval(() => {
          if (!this.isDestroyed) {
            this.transport.heartbeat(this.roomId, {
              playerId: this.playerId,
              playerIndex: this.playerIndex,
              status: 'online'
            });
            this.checkLiveness();
          }
        }, 3000);
        if (this.heartbeatTimer && typeof this.heartbeatTimer.unref === 'function') {
          this.heartbeatTimer.unref();
        }
      }
    }

    stopHeartbeatTimer() {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    }

    destroy() {
      this.isDestroyed = true;
      this.stopHeartbeatTimer();
      if (typeof this.unsubscribe === 'function') {
        this.unsubscribe();
      }
    }
  }

  // =========================================================================
  // Casual Bounty Board ("Mais procurados")
  // =========================================================================

  const BOUNTY_BOARD_KEY = 'glt_bounty_board';

  function fetchBounties(transport) {
    if (!transport) return [];
    const entries = transport.read(BOUNTY_BOARD_KEY);
    if (!Array.isArray(entries)) return [];
    return entries.slice().sort((a, b) => (b.bounty || 0) - (a.bounty || 0));
  }

  function submitBounty(transport, entry = {}) {
    if (!transport || !entry.playerId) return false;
    const bountyItem = {
      playerId: entry.playerId,
      nickname: entry.nickname || 'Pirata Desconhecido',
      crewId: entry.crewId || 'straw_hats',
      bounty: Math.max(10000000, Math.round(entry.bounty || 10000000)),
      wonMatches: entry.wonMatches || 1,
      totalMatches: entry.totalMatches || 1,
      timestamp: Date.now(),
      verified: false,
      tag: '[Casual / Não verificado]'
    };

    return transport.publish(BOUNTY_BOARD_KEY, bountyItem);
  }

  // =========================================================================
  // Module Exports
  // =========================================================================

  const protocolExports = {
    // Canonical Definitions
    CANONICAL_SHIPS,
    CANONICAL_BOARDS,
    DEN_DEN_REACTIONS,
    isValidReaction,

    // WebCrypto & Commitments
    computeSha256,
    generateSalt,
    canonicalizeFleet,
    computeCommitment,

    // Matchmaking & Lobby
    generateRoomCode,
    getRoomUrl,
    generatePlayerId,
    generateDefaultNickname,

    // Event & Liveness Helpers
    createEventId,
    createEvent,
    getDeterministicAutoShot,
    evaluateShotAnswer,
    evaluateTechAnswer,

    // Core Protocol Functions
    createInitialMatchState,
    foldMatchLog,
    actingSeat,
    isAuthorConsistent,
    validateFleetGeometry,
    verifyMatchIntegrity,

    // High-Level Client Controller
    PvpMatchClient,

    // Bounty Board
    fetchBounties,
    submitBounty
  };

  root.GLT = root.GLT || {};
  root.GLT.protocol = protocolExports;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = protocolExports;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
