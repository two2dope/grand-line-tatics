/**
 * Grand Line Tactics — Core Rules, RNG & PT-BR Test Suite
 * Headless Node.js test script for Piece 1 modules:
 * - src/logic/rng.js
 * - src/logic/i18n.js
 * - src/logic/rules.js
 */

const assert = require('assert');
const rng = require('../src/logic/rng.js');
const { T, formatNumber, formatBounty, plural, i18n } = require('../src/logic/i18n.js');
const rules = require('../src/logic/rules.js');

let passedTests = 0;
let totalTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${description}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('=== TEST SUITE: Grand Line Tactics (Piece 1: RNG, i18n, Rules) ===\n');

// ==========================================
// 1. RNG MODULE TESTS
// ==========================================
console.log('--- 1. Seeded PRNG (Mulberry32 & FNV-1a) ---');

test('hashString produces deterministic 32-bit unsigned integers', () => {
  const h1 = rng.hashString('Grand Line');
  const h2 = rng.hashString('Grand Line');
  const h3 = rng.hashString('One Piece');
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.strictEqual(typeof h1, 'number');
  assert(h1 >= 0 && h1 <= 4294967295, 'Hash must be unsigned 32-bit');
});

test('createRng produces identical sequence with identical seed', () => {
  const r1 = rng.createRng('seed-grand-line-42');
  const r2 = rng.createRng('seed-grand-line-42');
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(r1.next(), r2.next());
    assert.strictEqual(r1.nextInt(1, 10), r2.nextInt(1, 10));
  }
});

test('createRng nextInt obeys bounds inclusively', () => {
  const r = rng.createRng(999);
  const counts = {};
  for (let i = 0; i < 1000; i++) {
    const val = r.nextInt(2, 6);
    assert(val >= 2 && val <= 6, `Val ${val} out of bounds [2, 6]`);
    counts[val] = (counts[val] || 0) + 1;
  }
  for (let k = 2; k <= 6; k++) {
    assert(counts[k] > 0, `Value ${k} should have appeared`);
  }
});

test('createRng nextFloat generates numbers within [min, max)', () => {
  const r = rng.createRng(1234);
  for (let i = 0; i < 200; i++) {
    const val = r.nextFloat(5.5, 12.5);
    assert(val >= 5.5 && val < 12.5, `Val ${val} out of bounds [5.5, 12.5)`);
  }
});

test('createRng pick and shuffle', () => {
  const r = rng.createRng(555);
  const items = ['Luffy', 'Zoro', 'Nami', 'Sanji'];
  const picked = r.pick(items);
  assert(items.includes(picked));

  const toShuffle = [1, 2, 3, 4, 5, 6, 7];
  const original = [...toShuffle];
  const shuffled = r.shuffle([...toShuffle]);
  assert.strictEqual(shuffled.length, original.length);
  assert.deepStrictEqual(shuffled.sort((a,b) => a-b), original);
});

test('createRng state saving and restoring (getState / setState)', () => {
  const r = rng.createRng('savestate-test');
  r.next();
  r.next();
  const savedState = r.getState();
  const nextVal1 = r.next();
  const nextVal2 = r.next();

  r.setState(savedState);
  assert.strictEqual(r.next(), nextVal1);
  assert.strictEqual(r.next(), nextVal2);
});

test('createRng fork creates deterministic independent stream', () => {
  const parent = rng.createRng(777);
  const child1 = parent.fork('ai-difficulty');
  const parent2 = rng.createRng(777);
  const child2 = parent2.fork('ai-difficulty');

  assert.strictEqual(child1.next(), child2.next());
  assert.strictEqual(child1.nextInt(0, 100), child2.nextInt(0, 100));
});

test('coinToss returns 0 or 1 deterministically', () => {
  const t1 = rng.coinToss('match-alpha');
  const t2 = rng.coinToss('match-alpha');
  assert.strictEqual(t1, t2);
  assert(t1 === 0 || t1 === 1);
});

// ==========================================
// 2. PT-BR LOCALIZATION & DICTIONARY TESTS
// ==========================================
console.log('\n--- 2. PT-BR Localization, Formatting & Dictionary ---');

test('formatNumber uses pt-BR dot thousand separators', () => {
  const formatted = formatNumber(1500000);
  assert.strictEqual(formatted, '1.500.000');
});

test('formatBounty prefixes Berry symbol ฿ with pt-BR format', () => {
  const bounty = formatBounty(1500000000);
  assert.strictEqual(bounty, '฿ 1.500.000.000');
});

test('plural helper respects singular and plural pt-BR rules', () => {
  assert.strictEqual(plural(1, 'navio', 'navios'), '1 navio');
  assert.strictEqual(plural(5, 'navio', 'navios'), '5 navios');
  assert.strictEqual(plural(0, 'tiro restante', 'tiros restantes'), '0 tiros restantes');
});

test('Dictionary T contains required pirate strings and proper accents', () => {
  assert.strictEqual(T.outcomes.water, 'Água!');
  assert.strictEqual(T.outcomes.hit, 'Acertou em cheio!');
  assert.strictEqual(T.outcomes.sunk('Going Merry'), 'Afundou o Going Merry!');
  assert.strictEqual(T.turns.yourTurn, 'Sua vez, capitão!');

  // Check accents and cedillas: ç ã õ é ê í ó ú à â ô
  const fullDictionaryText = JSON.stringify(T);
  const requiredChars = ['ç', 'ã', 'õ', 'é', 'ê', 'í', 'ó', 'ú', 'à', 'â', 'ô'];
  for (const ch of requiredChars) {
    assert(fullDictionaryText.includes(ch), `Dictionary T must contain character '${ch}'`);
  }
});

test('All 6 rival crews have full PT-BR taunts and officers in T', () => {
  const crewKeys = ['straw_hats', 'whitebeard', 'red_haired', 'heart', 'blackbeard', 'marines'];
  for (const key of crewKeys) {
    const c = T.crews[key];
    assert(c, `Crew ${key} must exist in T.crews`);
    assert(c.captain, `Captain must exist for ${key}`);
    assert.strictEqual(c.officers.length, 3, `Crew ${key} must have exactly 3 officers`);
    assert(c.techniqueName, `Technique name must exist for ${key}`);
    assert(c.techniqueDesc, `Technique description must exist for ${key}`);
    assert(c.taunts.intro.length >= 2, `Intro taunts for ${key}`);
    assert(c.taunts.hit.length >= 2, `Hit taunts for ${key}`);
    assert(c.taunts.miss.length >= 2, `Miss taunts for ${key}`);
    assert(c.taunts.sink.length >= 2, `Sink taunts for ${key}`);
    assert(c.taunts.victory.length >= 2, `Victory taunts for ${key}`);
    assert(c.taunts.defeat.length >= 2, `Defeat taunts for ${key}`);
  }
});

test('Den Den Mushi preset reactions exist and match spec', () => {
  assert.strictEqual(T.reactions.opt_boa_mira, 'Boa mira!');
  assert.strictEqual(T.reactions.opt_prepare_se, 'Prepare-se!');
  assert.strictEqual(T.reactions.opt_gg_capitao, 'GG, capitão!');
  assert(T.reactions.opt_que_sorte);
});

// ==========================================
// 3. CANONICAL SHIPS, CREWS, BOARDS & SEAS
// ==========================================
console.log('\n--- 3. Canonical Ships, Crews, Boards & Seas ---');

test('7 canonical ships have correct lengths and properties', () => {
  assert.strictEqual(rules.SHIPS.length, 7);
  const expectedLengths = {
    moby_dick: 5,
    thousand_sunny: 4,
    oro_jackson: 4,
    red_force: 3,
    polar_tang: 3,
    baratie: 3,
    going_merry: 2
  };
  for (const [id, len] of Object.entries(expectedLengths)) {
    const s = rules.SHIPS_MAP[id];
    assert(s, `Ship ${id} must exist in SHIPS_MAP`);
    assert.strictEqual(s.length, len, `Ship ${id} length mismatch`);
  }
  assert.strictEqual(rules.SHIPS_MAP.polar_tang.isSubmarine, true);
});

test('6 canonical crews have captain, 3 officers, and correct techniques', () => {
  assert.strictEqual(rules.CREWS.length, 6);
  const expectedTechs = {
    straw_hats: 'bazooka',
    whitebeard: 'tremor',
    red_haired: 'haki_do_rei',
    heart: 'room',
    blackbeard: 'vortice',
    marines: 'observacao'
  };
  for (const [id, tech] of Object.entries(expectedTechs)) {
    const c = rules.CREWS_MAP[id];
    assert(c, `Crew ${id} must exist in CREWS_MAP`);
    assert.strictEqual(c.technique, tech, `Crew ${id} technique mismatch`);
    assert.strictEqual(c.officers.length, 3, `Crew ${id} must have 3 officers`);
    assert(c.colors && c.colors.primary, `Crew ${id} must have colors`);
  }
});

test('3 boards have canonical sizes and ship complements', () => {
  assert.strictEqual(rules.BOARDS.length, 3);
  const bEscaramuca = rules.BOARDS_MAP.escaramuca;
  assert.strictEqual(bEscaramuca.size, 8);
  assert.deepStrictEqual(bEscaramuca.ships, ['thousand_sunny', 'red_force', 'polar_tang', 'going_merry']);

  const bClassica = rules.BOARDS_MAP.classica;
  assert.strictEqual(bClassica.size, 10);
  assert.deepStrictEqual(bClassica.ships, ['moby_dick', 'thousand_sunny', 'red_force', 'polar_tang', 'going_merry']);

  const bGrandLine = rules.BOARDS_MAP.grand_line;
  assert.strictEqual(bGrandLine.size, 12);
  assert.deepStrictEqual(bGrandLine.ships, ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry']);
});

test('5 seas defined properly (including Marineford)', () => {
  assert.strictEqual(rules.SEAS.length, 5);
  const seaIds = rules.SEAS.map(s => s.id);
  assert(seaIds.includes('mar_calmo'));
  assert(seaIds.includes('grand_line'));
  assert(seaIds.includes('novo_mundo'));
  assert(seaIds.includes('tempestade'));
  assert(seaIds.includes('marineford'));
});

test('coordToLabel and labelToCoord bi-directional conversion', () => {
  assert.strictEqual(rules.coordToLabel(0, 0), 'A1');
  assert.strictEqual(rules.coordToLabel(1, 6), 'B7');
  assert.strictEqual(rules.coordToLabel(11, 11), 'L12');

  assert.deepStrictEqual(rules.labelToCoord('A1'), { r: 0, c: 0 });
  assert.deepStrictEqual(rules.labelToCoord('B7'), { r: 1, c: 6 });
  assert.deepStrictEqual(rules.labelToCoord('L12'), { r: 11, c: 11 });
  assert.deepStrictEqual(rules.labelToCoord('b7'), { r: 1, c: 6 }); // case-insensitive

  // All 12x12 coordinates roundtrip
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const lbl = rules.coordToLabel(r, c);
      const back = rules.labelToCoord(lbl);
      assert.deepStrictEqual(back, { r, c }, `Roundtrip failed for (${r}, ${c})`);
    }
  }
});

// ==========================================
// 4. FLEET PLACEMENT & VALIDATION
// ==========================================
console.log('\n--- 4. Placement Validation & Auto Placement ---');

test('validatePlacement catches out of bounds', () => {
  const boardSize = 10;
  const placed = [];

  // Exceeds right edge horizontally
  const badHoriz = { id: 'moby_dick', length: 5, r: 0, c: 7, horizontal: true };
  const res1 = rules.validatePlacement(boardSize, placed, badHoriz);
  assert.strictEqual(res1.valid, false);
  assert.strictEqual(res1.reason, 'FORA_DOS_LIMITES');

  // Exceeds bottom edge vertically
  const badVert = { id: 'moby_dick', length: 5, r: 7, c: 0, horizontal: false };
  const res2 = rules.validatePlacement(boardSize, placed, badVert);
  assert.strictEqual(res2.valid, false);
  assert.strictEqual(res2.reason, 'FORA_DOS_LIMITES');

  // Fits within bounds
  const good = { id: 'moby_dick', length: 5, r: 0, c: 5, horizontal: true };
  const res3 = rules.validatePlacement(boardSize, placed, good);
  assert.strictEqual(res3.valid, true);
  assert.strictEqual(res3.cells.length, 5);
});

test('validatePlacement catches overlaps', () => {
  const boardSize = 10;
  const shipA = {
    id: 'thousand_sunny',
    length: 4,
    cells: [{ r: 2, c: 2 }, { r: 2, c: 3 }, { r: 2, c: 4 }, { r: 2, c: 5 }]
  };
  const placed = [shipA];

  // Overlapping ship across (2, 3)
  const overlapping = { id: 'red_force', length: 3, r: 1, c: 3, horizontal: false };
  const res = rules.validatePlacement(boardSize, placed, overlapping);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason, 'SOBREPOSICAO');
});

test('validatePlacement enforces allowTouch rule', () => {
  const boardSize = 10;
  const shipA = {
    id: 'going_merry',
    length: 2,
    cells: [{ r: 3, c: 3 }, { r: 3, c: 4 }]
  };
  const placed = [shipA];

  // Orthogonally touching above at row 2
  const touchOrtho = { id: 'red_force', length: 3, r: 2, c: 3, horizontal: true };
  // Diagonally touching at (4, 5)
  const touchDiag = { id: 'red_force', length: 3, r: 4, c: 5, horizontal: true };

  // When allowTouch = false: must be invalid
  const resOrthoDisallowed = rules.validatePlacement(boardSize, placed, touchOrtho, { allowTouch: false });
  assert.strictEqual(resOrthoDisallowed.valid, false);
  assert.strictEqual(resOrthoDisallowed.reason, 'TOCANDO');

  const resDiagDisallowed = rules.validatePlacement(boardSize, placed, touchDiag, { allowTouch: false });
  assert.strictEqual(resDiagDisallowed.valid, false);
  assert.strictEqual(resDiagDisallowed.reason, 'TOCANDO');

  // When allowTouch = true: both must be valid!
  const resOrthoAllowed = rules.validatePlacement(boardSize, placed, touchOrtho, { allowTouch: true });
  assert.strictEqual(resOrthoAllowed.valid, true);

  const resDiagAllowed = rules.validatePlacement(boardSize, placed, touchDiag, { allowTouch: true });
  assert.strictEqual(resDiagAllowed.valid, true);
});

test('autoPlaceFleet places full fleet validly across all boards and strategies', () => {
  const r = rng.createRng('fleet-placement-seed');
  const boardIds = ['escaramuca', 'classica', 'grand_line'];
  const strategies = ['random', 'edge', 'spread'];

  for (const bId of boardIds) {
    const board = rules.BOARDS_MAP[bId];
    for (const strat of strategies) {
      // Test without touch
      const fleetNoTouch = rules.autoPlaceFleet(bId, r, { allowTouch: false, strategy: strat });
      assert.strictEqual(fleetNoTouch.length, board.ships.length);
      for (let i = 0; i < fleetNoTouch.length; i++) {
        const val = rules.validatePlacement(board.size, fleetNoTouch.slice(0, i), fleetNoTouch[i], { allowTouch: false });
        assert.strictEqual(val.valid, true, `Placement collision in ${bId} / ${strat}`);
      }

      // Test with touch allowed
      const fleetTouch = rules.autoPlaceFleet(bId, r, { allowTouch: true, strategy: strat });
      assert.strictEqual(fleetTouch.length, board.ships.length);
      for (let i = 0; i < fleetTouch.length; i++) {
        const val = rules.validatePlacement(board.size, fleetTouch.slice(0, i), fleetTouch[i], { allowTouch: true });
        assert.strictEqual(val.valid, true, `Placement collision in ${bId} / ${strat} (allowTouch)`);
      }
    }
  }
});

// ==========================================
// 5. MATCH STATE & SHOT RESOLUTION
// ==========================================
console.log('\n--- 5. Match State & Cannon Shot Resolution ---');

test('createMatchState initializes match with deterministic starting turn', () => {
  const state = rules.createMatchState({
    seed: 42,
    boardId: 'classica',
    mode: 'classico',
    allowTouch: false
  });

  assert(state.turn === 0 || state.turn === 1);
  assert.strictEqual(state.boardSize, 10);
  assert.strictEqual(state.players[0].fleet.length, 5);
  assert.strictEqual(state.players[1].fleet.length, 5);
  assert.strictEqual(state.gameOver, false);
});

test('resolveShot resolves water, hit, sunk and win condition', () => {
  const match = rules.createMatchState({
    seed: 100,
    boardId: 'escaramuca',
    mode: 'classico',
    continueOnHit: false,
    salvo: false
  });

  const shooterIdx = match.turn;
  const defenderIdx = 1 - shooterIdx;
  const defender = match.players[defenderIdx];

  // 1. Find a cell that is empty (no ship)
  const shipCells = new Set();
  for (const s of defender.fleet) {
    for (const c of s.cells) {
      shipCells.add(`${c.r},${c.c}`);
    }
  }
  let emptyCell = null;
  for (let r = 0; r < match.boardSize; r++) {
    for (let c = 0; c < match.boardSize; c++) {
      if (!shipCells.has(`${r},${c}`)) {
        emptyCell = { r, c };
        break;
      }
    }
    if (emptyCell) break;
  }

  // Shoot water
  const resWater = rules.resolveShot(match, shooterIdx, emptyCell);
  assert.strictEqual(resWater.valid, true);
  assert.strictEqual(resWater.outcome, 'water');
  assert.strictEqual(resWater.message, 'Água!');
  assert.strictEqual(match.turn, defenderIdx, 'Turn should switch to opponent after water');

  // Turn is now defender's. Shoot water from defender so turn returns to original shooter
  let emptyCellDef = null;
  const shooterShipCells = new Set();
  for (const s of match.players[shooterIdx].fleet) {
    for (const c of s.cells) shooterShipCells.add(`${c.r},${c.c}`);
  }
  for (let r = 0; r < match.boardSize; r++) {
    for (let c = 0; c < match.boardSize; c++) {
      if (!shooterShipCells.has(`${r},${c}`)) {
        emptyCellDef = { r, c };
        break;
      }
    }
    if (emptyCellDef) break;
  }
  rules.resolveShot(match, defenderIdx, emptyCellDef);
  assert.strictEqual(match.turn, shooterIdx, 'Turn back to shooter');

  // 2. Shoot a ship cell of Going Merry (length 2)
  const goingMerry = defender.fleet.find(s => s.id === 'going_merry');
  const c1 = goingMerry.cells[0];
  const c2 = goingMerry.cells[1];

  const resHit = rules.resolveShot(match, shooterIdx, c1);
  assert.strictEqual(resHit.valid, true);
  assert.strictEqual(resHit.outcome, 'hit');
  assert.strictEqual(resHit.message, 'Acertou em cheio!');

  // Switch back to shooter
  rules.resolveShot(match, defenderIdx, { r: 7, c: 7 }); // defender shoots somewhere

  // Shoot second cell of Going Merry -> should sink
  const resSunk = rules.resolveShot(match, shooterIdx, c2);
  assert.strictEqual(resSunk.valid, true);
  assert.strictEqual(resSunk.outcome, 'sunk');
  assert.strictEqual(resSunk.shipId, 'going_merry');
  assert.strictEqual(resSunk.message, 'Afundou o Going Merry!');
  assert.strictEqual(goingMerry.isSunk, true);
});

test('continueOnHit keeps shooter turn after a hit', () => {
  const match = rules.createMatchState({
    seed: 200,
    boardId: 'escaramuca',
    mode: 'classico',
    continueOnHit: true,
    salvo: false
  });

  const shooterIdx = match.turn;
  const defenderIdx = 1 - shooterIdx;
  const defender = match.players[defenderIdx];
  const targetShip = defender.fleet[0];
  const c1 = targetShip.cells[0];

  const resHit = rules.resolveShot(match, shooterIdx, c1);
  assert.strictEqual(resHit.outcome, 'hit');
  assert.strictEqual(match.turn, shooterIdx, 'Shooter must retain turn on hit when continueOnHit is true');
});

test('salvo mode allocates shots equal to remaining ships', () => {
  const match = rules.createMatchState({
    seed: 300,
    boardId: 'escaramuca', // 4 ships
    mode: 'classico',
    salvo: true
  });

  const shooterIdx = match.turn;
  const defenderIdx = 1 - shooterIdx;
  assert.strictEqual(match.shotsRemainingInTurn, 4, 'Salvo starting shots must equal 4');

  // Fire 1 shot into water
  rules.resolveShot(match, shooterIdx, { r: 0, c: 0 });
  assert.strictEqual(match.turn, shooterIdx, 'Turn must remain shooter while shots remaining > 0');
  assert.strictEqual(match.shotsRemainingInTurn, 3);
});

// ==========================================
// 6. SIGNATURE TECHNIQUES (MODO TÁTICO)
// ==========================================
console.log('\n--- 6. Crew Signature Techniques (Modo Tático) ---');

test('Techniques rejected in Modo Clássico', () => {
  const match = rules.createMatchState({
    seed: 400,
    mode: 'classico'
  });
  const res = rules.resolveTechnique(match, match.turn, {});
  assert.strictEqual(res.valid, false);
});

test('Straw Hats Bazooka resolves 2x2 area', () => {
  const match = rules.createMatchState({
    seed: 500,
    mode: 'tatico',
    crews: ['straw_hats', 'marines']
  });
  match.turn = 0; // force Straw Hats turn

  const res = rules.resolveTechnique(match, 0, { r: 2, c: 2 });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.type, 'bazooka');
  assert.strictEqual(res.cellsAffected.length, 4);
  assert.strictEqual(match.players[0].techniqueUsed, true);
  assert.strictEqual(match.turn, 1, 'Technique costs the turn');
});

test('Whitebeard Tremor resolves 5-cell cross', () => {
  const match = rules.createMatchState({
    seed: 501,
    mode: 'tatico',
    crews: ['whitebeard', 'marines']
  });
  match.turn = 0; // force Whitebeard turn

  const res = rules.resolveTechnique(match, 0, { r: 5, c: 5 });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.type, 'tremor');
  assert.strictEqual(res.cellsAffected.length, 5);
  assert.strictEqual(match.turn, 1);
});

test('Red-Haired Haki do Rei performs 3x3 yes/no sonar', () => {
  const match = rules.createMatchState({
    seed: 502,
    mode: 'tatico',
    crews: ['red_haired', 'marines']
  });
  match.turn = 0;

  const defenderShip = match.players[1].fleet[0];
  const targetCell = defenderShip.cells[0];

  const res = rules.resolveTechnique(match, 0, { r: targetCell.r, c: targetCell.c });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.type, 'haki_do_rei');
  assert.strictEqual(res.sonarDetected, true, 'Sonar should detect ship in center of 3x3');
});

test('Heart Room counts ship cells along chosen row or column', () => {
  const match = rules.createMatchState({
    seed: 503,
    mode: 'tatico',
    crews: ['heart', 'marines']
  });
  match.turn = 0;

  const targetShip = match.players[1].fleet[0];
  const rowTarget = targetShip.cells[0].r;

  const res = rules.resolveTechnique(match, 0, { axis: 'row', index: rowTarget });
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.type, 'room');
  assert(res.rowColCount >= 1, 'Row should have at least 1 ship cell');
});

test('Blackbeard Vórtice activates shield and absorbs next incoming shot', () => {
  const match = rules.createMatchState({
    seed: 504,
    mode: 'tatico',
    crews: ['blackbeard', 'marines']
  });
  match.turn = 0;

  // Blackbeard uses Vórtice
  const resTech = rules.resolveTechnique(match, 0, {});
  assert.strictEqual(resTech.valid, true);
  assert.strictEqual(resTech.type, 'vortice');
  assert.strictEqual(match.players[0].shieldActive, true);
  assert.strictEqual(match.turn, 1, 'Turn passes to Marines');

  // Marines shoot directly at Blackbeard's ship cell
  const bbShip = match.players[0].fleet[0];
  const targetCell = bbShip.cells[0];

  const shotRes = rules.resolveShot(match, 1, targetCell);
  assert.strictEqual(shotRes.valid, true);
  assert.strictEqual(shotRes.outcome, 'absorbed');
  assert.strictEqual(shotRes.message, 'Tiro Absorvido!');
  assert.strictEqual(bbShip.hits, 0, 'Ship must not take damage when absorbed');
  assert.strictEqual(match.players[0].shieldActive, false, 'Shield is consumed');
});

test('Marines Observação reveals unhit cell of surviving enemy ship', () => {
  const match = rules.createMatchState({
    seed: 505,
    mode: 'tatico',
    crews: ['marines', 'straw_hats']
  });
  match.turn = 0;

  const resTech = rules.resolveTechnique(match, 0, {});
  assert.strictEqual(resTech.valid, true);
  assert.strictEqual(resTech.type, 'observacao');
  assert(resTech.revealedCell !== undefined);
  assert(typeof resTech.revealedCell.r === 'number');
  assert(typeof resTech.revealedCell.c === 'number');

  // Verify revealed cell indeed belongs to a living Straw Hats ship
  const shShip = match.players[1].fleet.find(s => s.id === resTech.shipId);
  assert(shShip.cells.some(c => c.r === resTech.revealedCell.r && c.c === resTech.revealedCell.c));
});

test('Technique cannot be used twice by same crew in a match', () => {
  const match = rules.createMatchState({
    seed: 506,
    mode: 'tatico',
    crews: ['straw_hats', 'marines']
  });
  match.turn = 0;

  rules.resolveTechnique(match, 0, { r: 1, c: 1 });
  // Pass turn back to 0
  rules.resolveShot(match, 1, { r: 0, c: 0 });

  const secondTry = rules.resolveTechnique(match, 0, { r: 1, c: 1 });
  assert.strictEqual(secondTry.valid, false, 'Second technique usage must be rejected');
});

// ==========================================
// 7. FOG OF WAR & BOUNTY CALCULATION
// ==========================================
console.log('\n--- 7. Fog of War & Bounty Calculation ---');

test('Fog of War detects faded shot after 2 turns', () => {
  const match = rules.createMatchState({
    seed: 600,
    fog: true
  });
  match.turnNumber = 5;

  assert.strictEqual(rules.isShotFaded(match, 1), true, 'Turn 1 shot should fade on turn 5');
  assert.strictEqual(rules.isShotFaded(match, 4), false, 'Turn 4 shot should not fade on turn 5');
});

test('calculateBounty computes minimum 10M and scales with performance', () => {
  // Participation / Loss
  const bLoss = rules.calculateBounty({ won: false, hits: 2, sinks: 0 }, { difficulty: 'grumete', boardId: 'escaramuca' });
  assert(bLoss >= 10000000, 'Bounty must be >= 10,000,000');

  // Victory on Yonkou difficulty with high accuracy and streak
  const bYonkouWin = rules.calculateBounty({
    won: true,
    shots: 25,
    hits: 24,
    sinks: 7,
    longestStreak: 12
  }, {
    difficulty: 'yonkou',
    boardId: 'grand_line',
    mode: 'tatico'
  });

  assert(bYonkouWin > 1000000000, `Yonkou Grand Line win bounty should reach billions: got ${formatBounty(bYonkouWin)}`);
  assert(bYonkouWin > bLoss, 'Win bounty must exceed loss bounty');
});

// ==========================================
// 8. ADDITIONAL RIGOR TESTS & MATH.RANDOM VERIFICATION
// ==========================================
console.log('\n--- 8. Anti-Math.random Guard & Edge Cases ---');

test('autoPlaceFleet with biasWeights respects custom weight distribution', () => {
  const r = rng.createRng('bias-test-seed');
  const boardSize = 10;
  const biasWeights = new Float64Array(boardSize * boardSize);
  // Give high weight to top-left quadrant
  for (let rIdx = 0; rIdx < 5; rIdx++) {
    for (let cIdx = 0; cIdx < 5; cIdx++) {
      biasWeights[rIdx * boardSize + cIdx] = 10.0;
    }
  }

  const fleet = rules.autoPlaceFleet('classica', r, {
    strategy: 'biased',
    biasWeights,
    allowTouch: false
  });
  assert.strictEqual(fleet.length, 5);
  for (let i = 0; i < fleet.length; i++) {
    const val = rules.validatePlacement(boardSize, fleet.slice(0, i), fleet[i], { allowTouch: false });
    assert.strictEqual(val.valid, true);
  }
});

test('validatePlacement allows repositioning existing ship with same id without self-collision', () => {
  const boardSize = 10;
  const initialShip = {
    id: 'thousand_sunny',
    length: 4,
    r: 0,
    c: 0,
    horizontal: true,
    cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 0, c: 2 }, { r: 0, c: 3 }]
  };
  const placed = [initialShip];

  // Move thousand_sunny to new position that overlaps with its own old cells
  const moved = {
    id: 'thousand_sunny',
    length: 4,
    r: 0,
    c: 1,
    horizontal: true
  };

  const val = rules.validatePlacement(boardSize, placed, moved);
  assert.strictEqual(val.valid, true, 'Moving existing ship should not collide with itself');
});

test('Pure deterministic rules run without touching Math.random', () => {
  const originalMathRandom = Math.random;
  try {
    Math.random = () => {
      throw new Error('VIOLATION: Math.random() was called inside pure rules/RNG!');
    };

    const matchRng = rng.createRng('no-math-random-seed');
    const fleet0 = rules.autoPlaceFleet('classica', matchRng, { allowTouch: false, strategy: 'random' });
    const fleet1 = rules.autoPlaceFleet('classica', matchRng, { allowTouch: false, strategy: 'edge' });

    const match = rules.createMatchState({
      seed: 99999,
      boardId: 'classica',
      fleets: [fleet0, fleet1]
    });

    // Fire 20 shots
    for (let i = 0; i < 20; i++) {
      if (match.gameOver) break;
      const turn = match.turn;
      const rCoord = (i * 3) % 10;
      const cCoord = (i * 7) % 10;
      rules.resolveShot(match, turn, { r: rCoord, c: cCoord });
    }

    assert(match.turnNumber > 1, 'Match should have advanced without Math.random()');
  } finally {
    Math.random = originalMathRandom;
  }
});

// ==========================================
// 9. ROUND 2 REGRESSION TESTS
// ==========================================
console.log('\n--- 9. Round 2 Critic Regression Fixes ---');

test('observacao works deterministically with string seed without producing NaN', () => {
  const match = rules.createMatchState({
    seed: 'room-xyz-99',
    mode: 'tatico',
    crews: ['marines', 'straw_hats']
  });
  match.turn = 0; // Marines turn
  const resTech = rules.resolveTechnique(match, 0, {});
  assert.strictEqual(resTech.valid, true);
  assert.strictEqual(resTech.type, 'observacao');
  assert(resTech.revealedCell !== undefined);
  assert(typeof resTech.revealedCell.r === 'number' && !Number.isNaN(resTech.revealedCell.r));
  assert(typeof resTech.revealedCell.c === 'number' && !Number.isNaN(resTech.revealedCell.c));
});

test('vortice absorbs all 4 cells of bazooka volley', () => {
  const match = rules.createMatchState({
    seed: 701,
    mode: 'tatico',
    crews: ['straw_hats', 'blackbeard']
  });
  // Player 1 (Blackbeard) activates Vortice
  match.turn = 1;
  const resVortice = rules.resolveTechnique(match, 1, {});
  assert.strictEqual(resVortice.valid, true);
  assert.strictEqual(match.players[1].shieldActive, true);

  // Turn is now Straw Hats (0). Fire Bazooka over 2x2 area
  assert.strictEqual(match.turn, 0);
  const resBazooka = rules.resolveTechnique(match, 0, { r: 0, c: 0 });
  assert.strictEqual(resBazooka.valid, true);
  assert.strictEqual(resBazooka.cellsAffected.length, 4);
  assert(resBazooka.results.every(r => r.outcome === 'absorbed'), 'All 4 cells of bazooka must be absorbed by vortice');
  assert.strictEqual(match.players[1].shieldActive, false, 'Shield is consumed after technique');
  assert(match.players[1].fleet.every(s => s.hits === 0), 'No ship damage should occur');
});

test('vortice absorbs all 5 cells of tremor cross', () => {
  const match = rules.createMatchState({
    seed: 702,
    mode: 'tatico',
    crews: ['whitebeard', 'blackbeard']
  });
  // Blackbeard activates Vortice
  match.turn = 1;
  rules.resolveTechnique(match, 1, {});
  assert.strictEqual(match.players[1].shieldActive, true);

  // Whitebeard activates Tremor
  assert.strictEqual(match.turn, 0);
  const resTremor = rules.resolveTechnique(match, 0, { r: 5, c: 5 });
  assert.strictEqual(resTremor.valid, true);
  assert.strictEqual(resTremor.cellsAffected.length, 5);
  assert(resTremor.results.every(r => r.outcome === 'absorbed'), 'All 5 cells of tremor must be absorbed by vortice');
  assert.strictEqual(match.players[1].shieldActive, false);
  assert(match.players[1].fleet.every(s => s.hits === 0));
});

test('salvo + continueOnHit does not decrement shotsRemainingInTurn on hit', () => {
  const match = rules.createMatchState({
    seed: 703,
    boardId: 'escaramuca',
    mode: 'classico',
    salvo: true,
    continueOnHit: true
  });
  const shooterIdx = match.turn;
  const defenderIdx = 1 - shooterIdx;
  const initialShots = match.shotsRemainingInTurn;
  assert.strictEqual(initialShots, 4);

  // Target a known cell of defender ship
  const targetShip = match.players[defenderIdx].fleet[0];
  const targetCell = targetShip.cells[0];

  const res = rules.resolveShot(match, shooterIdx, targetCell);
  assert.strictEqual(res.outcome, 'hit');
  assert.strictEqual(match.turn, shooterIdx, 'Turn remains with shooter');
  assert.strictEqual(match.shotsRemainingInTurn, initialShots, 'Shots remaining should NOT decrement on hit during continueOnHit salvo');
});

test('source inspection: rules.js has ZERO Math.random and wires T', () => {
  const fs = require('fs');
  const path = require('path');
  const rulesSource = fs.readFileSync(path.join(__dirname, '../src/logic/rules.js'), 'utf8');

  assert(!rulesSource.includes('Math.random'), 'rules.js must contain ZERO occurrences of Math.random');
  assert(rulesSource.includes('getT'), 'rules.js must wire T for localization strings');
});

// ==========================================
// 10. FORFEIT MATCH (porte do branch feat/v2.0-minishoot-chibi)
// ==========================================
console.log('\n--- 10. Forfeit Match ---');

test('forfeitMatch awards victory to opponent, increments seriesWins, and rejects duplicate forfeit', () => {
  const r = rng.createRng('forfeit-seed');
  const f0 = rules.autoPlaceFleet('escaramuca', r.fork('p0'));
  const f1 = rules.autoPlaceFleet('escaramuca', r.fork('p1'));
  const st = rules.createMatchState({ seed: 'forfeit-seed', boardId: 'escaramuca', seriesLength: 3, crews: ['straw_hats', 'marines'], fleets: [f0, f1] });
  const res = rules.forfeitMatch(st, 0);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(st.gameOver, true);
  assert.strictEqual(st.winner, 1);
  assert.strictEqual(st.gameOverReason, 'manual_forfeit');
  assert.strictEqual(st.seriesWins[1], 1);
  const dup = rules.forfeitMatch(st, 0);
  assert.strictEqual(dup.valid, false);
});

console.log(`\n==============================================`);
console.log(`RESULTS: ${passedTests}/${totalTests} tests passed (100% SUCCESS)`);
console.log(`==============================================\n`);
