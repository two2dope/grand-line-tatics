# Grand Line Tactics — Shared Module Contract (`globalThis.GLT`)

All source modules must work in TWO environments without modification:
1. **Headless Node.js** (`require(...)` for pure-logic modules in `src/logic/` and `src/net/`).
2. **Single-file HTML concatenation** (`<script>` in browser, sharing `globalThis.GLT = globalThis.GLT || {}`).

Pure-logic modules (`src/logic/rng.js`, `src/logic/i18n.js`, `src/logic/rules.js`, `src/logic/ai.js`, `src/logic/protocol.js`, `src/net/transport.js`) MUST NOT touch `document`, `window` DOM APIs, or `THREE`. For WebCrypto in `protocol.js`, use `globalThis.crypto?.subtle` with a pure-JS or Node `crypto` fallback if needed, so both browser WebCrypto and Node v24 `globalThis.crypto.subtle` work identically.

## 1. `src/logic/rng.js` (`GLT.rng`)
- `createRng(seed)`: returns a deterministic `mulberry32` generator object `{ next(), nextInt(min, maxInclusive), nextFloat(min, max), pick(arr), shuffle(arr), fork(label), getState(), setState(s) }`, where `seed` can be a 32-bit integer or string (hashed via `hashString(str)` using FNV-1a 32-bit).
- `hashString(str)`: deterministic 32-bit unsigned integer hash.
- `coinToss(matchSeed)`: returns `0` (player 0 / host) or `1` (player 1 / guest / CPU) deterministically from `matchSeed`.

## 2. `src/logic/i18n.js` (`GLT.i18n` and `GLT.T`)
- `T`: complete PT-BR dictionary containing all visible strings, aria-labels, tooltips, log lines, crew names, officers, ship names, rule toggles, weather names, errors, reactions, and footer disclaimer. Zero hard-coded strings elsewhere.
- `formatNumber(n)`: uses `new Intl.NumberFormat('pt-BR').format(n)`.
- `formatBounty(n)`: returns `'฿ ' + formatNumber(Math.round(n))` (e.g. `'฿ 1.500.000.000'`).
- `plural(count, singular, pluralForm)`: returns formatted count + singular/plural in PT-BR.

## 3. `src/logic/rules.js` (`GLT.rules`)
- Canonical Ships (`SHIPS` array & map by id):
  1. `moby_dick`: `{ id: 'moby_dick', name: 'Moby Dick', crewId: 'whitebeard', length: 5 }`
  2. `thousand_sunny`: `{ id: 'thousand_sunny', name: 'Thousand Sunny', crewId: 'straw_hats', length: 4 }`
  3. `oro_jackson`: `{ id: 'oro_jackson', name: 'Oro Jackson', crewId: 'roger', length: 4 }`
  4. `red_force`: `{ id: 'red_force', name: 'Red Force', crewId: 'red_haired', length: 3 }`
  5. `polar_tang`: `{ id: 'polar_tang', name: 'Polar Tang', crewId: 'heart', length: 3, isSubmarine: true }`
  6. `baratie`: `{ id: 'baratie', name: 'Baratie', crewId: 'baratie', length: 3 }`
  7. `going_merry`: `{ id: 'going_merry', name: 'Going Merry', crewId: 'straw_hats', length: 2 }`
- Canonical Crews (`CREWS` map/array):
  1. `straw_hats`: Chapéus de Palha — Captain: Monkey D. Luffy, Officers: ['Roronoa Zoro', 'Nami', 'Sanji'], Technique: `bazooka` (2x2 volley)
  2. `whitebeard`: Barba Branca — Captain: Edward Newgate, Officers: ['Marco', 'Portgas D. Ace', 'Jozu'], Technique: `tremor` (5-cell cross: center + N/S/E/W)
  3. `red_haired`: Cabelo Vermelho — Captain: Shanks, Officers: ['Benn Beckman', 'Lucky Roux', 'Yasopp'], Technique: `haki_do_rei` (yes/no sonar over 3x3 area)
  4. `heart`: Piratas do Coração — Captain: Trafalgar Law, Officers: ['Bepo', 'Shachi', 'Penguin'], Technique: `room` (count of ship cells in one chosen row or column)
  5. `blackbeard`: Barba Negra — Captain: Marshall D. Teach, Officers: ['Shiryu', 'Van Augur', 'Jesus Burgess'], Technique: `vortice` (next incoming shot is absorbed)
  6. `marines`: Marinha — Captain: Sakazuki (Akainu), Officers: ['Borsalino (Kizaru)', 'Monkey D. Garp', 'Smoker'], Technique: `observacao` (reveals one unhit cell of a surviving enemy ship)
- Boards (`BOARDS`):
  - `escaramuca`: `{ id: 'escaramuca', name: 'Escaramuça', size: 8, ships: ['thousand_sunny', 'red_force', 'polar_tang', 'going_merry'] }` (lengths 4,3,3,2)
  - `classica`: `{ id: 'classica', name: 'Clássica', size: 10, ships: ['moby_dick', 'thousand_sunny', 'red_force', 'polar_tang', 'going_merry'] }` (lengths 5,4,3,3,2)
  - `grand_line`: `{ id: 'grand_line', name: 'Grand Line', size: 12, ships: ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry'] }` (lengths 5,4,4,3,3,3,2)
- Seas (`SEAS`): `mar_calmo`, `grand_line`, `novo_mundo`, `tempestade`.
- Functions:
  - `getShipsForBoard(boardId)` -> array of ship objects.
  - `validatePlacement(boardSize, placedShips, candidateShip, options = { allowTouch: false })` -> `{ valid: boolean, reason?: string, cells: Array<{r, c}> }`.
    - `candidateShip`: `{ id, r, c, horizontal: boolean, length }`.
  - `autoPlaceFleet(boardId, rng, options = { allowTouch: false, strategy: 'random' | 'edge' | 'spread' | 'biased', biasWeights?: Float64Array })` -> array of placed ships `[{ id, name, length, r, c, horizontal, cells: [{r,c}] }]`.
  - `createMatchState(config)`: initializes a full match state (`seed`, `boardId`, `mode`: `'classico'|'tatico'`, `sea`: `'mar_calmo'|...`, `allowTouch`, `continueOnHit`, `salvo`, `turnTimer`, `fog`, `seriesLength`: `1|3|5`, `crews`: `[crew0, crew1]`, `fleets`: `[fleet0, fleet1]`).
  - `resolveShot(matchState, shooterIdx, targetCell)`: resolves a shot at `{ r, c }`, returning `{ outcome: 'water'|'hit'|'sunk'|'absorbed'|'already_shot', shipId?, shipName?, sunkCells?, gameOver: boolean, winner?: number, nextTurn: number, shotsRemainingInTurn: number, message: string }`.
  - `resolveTechnique(matchState, shooterIdx, params)`: resolves the crew's signature technique in `'tatico'` mode (1 use per match, costs the turn), returning `{ type, cellsAffected, results, sonarDetected?, rowColCount?, revealedCell?, shieldActive?, gameOver, winner, nextTurn, message }`.
  - `calculateBounty(stats, config)`: computes Berry bounty `f(accuracy, shots, speed, streaks, difficulty, rules)` returning integer `>= 10_000_000`.
  - `coordToLabel(r, c)`: e.g. `r=1, c=6` -> `'B7'` (rows A–L, cols 1–12). `labelToCoord('B7')` -> `{ r: 1, c: 6 }`.

## 4. `src/logic/ai.js` (`GLT.ai`)
- `DIFFICULTIES`: `'grumete'` (random), `'marujo'` (hunt/target), `'capitao'` (parity + target), `'yonkou'` (probability-density over remaining ship lengths + placement-bias learning across a series).
- `createAiPlayer(difficulty, crewId, boardId, rulesConfig, seriesMemory)`: returns an AI controller `{ placeFleet(rng), chooseAction(viewState, rng), recordOpponentPlacement(revealedFleet), getTaunt(event, rng) }`.
- `computeProbabilityGrid(boardSize, shotsGrid, remainingShipLengths, options = { allowTouch: false, biasWeights: null })`: returns `Float64Array` of length `boardSize * boardSize` with exact placement density per cell.
- `getLogPoseHint(boardSize, shotsGrid, remainingShipLengths, options)`: finds the 3x3 sector with highest unexplored ship probability and returns `{ r, c, directionLabel, sectorLabel }`.

## 5. `src/logic/protocol.js` (`GLT.protocol`) & `src/net/transport.js` (`GLT.transport`)
- `computeCommitment(fleet, salt)`: async WebCrypto `SHA-256(canonicalFleetJson + ':' + salt)` -> hex string.
- `verifyMatchIntegrity(moveLog, commitments, reveals, boardConfig)`: checks both players' SHA-256 commitments AND replays every shot and technique response against the revealed fleets. Returns `{ valid: boolean, cheaterIndex: null | 0 | 1, reason?: string, message?: string }` (includes `"Trapaça detectada"` on any mismatch).
- `foldMatchLog(events, config)`: deterministically folds an array of arbitrary (possibly duplicated or out-of-order) events into a canonical match state, ignoring duplicates (`seq` / `eventId` idempotency) and rejecting out-of-turn or unauthorized moves.
- `InMemoryTransport` & `ArtifactSharedTransport` implementing `{ publish(roomId, event), subscribe(roomId, callback), read(roomId), heartbeat(roomId, playerId), getLatency() }`.

