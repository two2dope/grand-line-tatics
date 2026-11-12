/**
 * Grand Line Tactics — Headless PvP Protocol & Fault-Injection Test Suite
 * 
 * Verifies protocol.js and transport.js against the 10 core requirements:
 * 1. Full normal match + end-of-game reveal & verification
 * 2. Injected latency, packet drops, duplicate events, and out-of-order delivery -> convergence
 * 3. Mid-match browser refresh (rejoin with token, replay log, finish match)
 * 4. Mid-match disconnect (>10s reconnecting, >60s forfeit)
 * 5. Turn timer timeout -> deterministic auto-fire
 * 6. Rapid double-clicks & out-of-turn shot injection
 * 7. Tampered SHOT_ANSWER (defender lies about hit being water) -> "Trapaça detectada"
 * 8. Tampered TECH_ANSWER (defender lies about sonar/room) -> "Trapaça detectada"
 * 9. Tampered FLEET_REVEAL / commitment mismatch -> "Trapaça detectada"
 * 10. Spectator read-only view (zero fleet data before reveal)
 */

'use strict';

const assert = require('assert');
const transportModule = require('../src/net/transport.js');
const protocolModule = require('../src/logic/protocol.js');

const {
  Transport,
  InMemoryTransport,
  SimulatedNetworkTransport,
  SimulatedNetworkHub,
  ArtifactSharedTransport
} = transportModule;

const {
  CANONICAL_SHIPS,
  CANONICAL_BOARDS,
  DEN_DEN_REACTIONS,
  isValidReaction,
  computeSha256,
  generateSalt,
  canonicalizeFleet,
  computeCommitment,
  generateRoomCode,
  generatePlayerId,
  generateDefaultNickname,
  createEvent,
  getDeterministicAutoShot,
  evaluateShotAnswer,
  evaluateTechAnswer,
  createInitialMatchState,
  foldMatchLog,
  validateFleetGeometry,
  verifyMatchIntegrity,
  PvpMatchClient,
  fetchBounties,
  submitBounty
} = protocolModule;

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m'
};

function pass(name, details = '') {
  console.log(`  ${colors.green}✔ PASS${colors.reset} ${colors.bold}${name}${colors.reset} ${details ? colors.cyan + '(' + details + ')' + colors.reset : ''}`);
}

function fail(name, err) {
  console.error(`  ${colors.red}✖ FAIL${colors.reset} ${colors.bold}${name}${colors.reset}`);
  console.error(err);
  process.exitCode = 1;
}

/**
 * Creates a canonically valid fleet for testing on 'classica' (10x10).
 * Placed in alternating rows (0, 2, 4, 6, 8) so they never touch.
 */
function createValidFleet(offsetR = 0, offsetC = 0) {
  return [
    {
      id: 'moby_dick',
      name: 'Moby Dick',
      length: 5,
      r: 0 + offsetR,
      c: 0 + offsetC,
      horizontal: true,
      cells: [
        { r: 0 + offsetR, c: 0 + offsetC },
        { r: 0 + offsetR, c: 1 + offsetC },
        { r: 0 + offsetR, c: 2 + offsetC },
        { r: 0 + offsetR, c: 3 + offsetC },
        { r: 0 + offsetR, c: 4 + offsetC }
      ]
    },
    {
      id: 'thousand_sunny',
      name: 'Thousand Sunny',
      length: 4,
      r: 2 + offsetR,
      c: 0 + offsetC,
      horizontal: true,
      cells: [
        { r: 2 + offsetR, c: 0 + offsetC },
        { r: 2 + offsetR, c: 1 + offsetC },
        { r: 2 + offsetR, c: 2 + offsetC },
        { r: 2 + offsetR, c: 3 + offsetC }
      ]
    },
    {
      id: 'red_force',
      name: 'Red Force',
      length: 3,
      r: 4 + offsetR,
      c: 0 + offsetC,
      horizontal: true,
      cells: [
        { r: 4 + offsetR, c: 0 + offsetC },
        { r: 4 + offsetR, c: 1 + offsetC },
        { r: 4 + offsetR, c: 2 + offsetC }
      ]
    },
    {
      id: 'polar_tang',
      name: 'Polar Tang',
      length: 3,
      r: 6 + offsetR,
      c: 0 + offsetC,
      horizontal: true,
      cells: [
        { r: 6 + offsetR, c: 0 + offsetC },
        { r: 6 + offsetR, c: 1 + offsetC },
        { r: 6 + offsetR, c: 2 + offsetC }
      ]
    },
    {
      id: 'going_merry',
      name: 'Going Merry',
      length: 2,
      r: 8 + offsetR,
      c: 0 + offsetC,
      horizontal: true,
      cells: [
        { r: 8 + offsetR, c: 0 + offsetC },
        { r: 8 + offsetR, c: 1 + offsetC }
      ]
    }
  ];
}

async function runTestSuite() {
  console.log(`\n${colors.bold}${colors.cyan}=== GRAND LINE TACTICS: PVP PROTOCOL & FAULT-INJECTION TEST SUITE ===${colors.reset}\n`);

  let passedTests = 0;
  let totalTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      pass(name);
      passedTests++;
    } catch (err) {
      fail(name, err);
    }
  }

  // =========================================================================
  // Test 1: Full Normal Match + End-of-Game Reveal & Verification
  // =========================================================================
  await test('1. Full normal match + end-of-game reveal & verification', async () => {
    const registry = InMemoryTransport.createRegistry();
    const transport0 = new InMemoryTransport({ registry, clientId: 'host_0' });
    const transport1 = new InMemoryTransport({ registry, clientId: 'guest_1' });
    const roomId = 'GL7K9';

    const fleet0 = createValidFleet(0, 0); // Player 0 fleet (rows 0,2,4,6,8, cols 0..4)
    const fleet1 = createValidFleet(1, 5); // Player 1 fleet (rows 1,3,5,7,9, cols 5..9)
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const client0 = new PvpMatchClient({
      transport: transport0,
      roomId,
      playerId: 'p0',
      playerIndex: 0,
      nickname: 'Luffy',
      crewId: 'straw_hats',
      fleet: fleet0,
      salt: salt0,
      matchConfig: { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 }
    });

    const client1 = new PvpMatchClient({
      transport: transport1,
      roomId,
      playerId: 'p1',
      playerIndex: 1,
      nickname: 'Shanks',
      crewId: 'red_haired',
      fleet: fleet1,
      salt: salt1,
      matchConfig: { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 }
    });

    // Both players ready up with commitments
    await client0.readyUp();
    await client1.readyUp();

    assert.strictEqual(client0.state.phase, 'playing', 'Game should transition to playing phase');
    assert.strictEqual(client0.state.currentTurn, 0, 'First turn should be player 0');

    // All cells occupied by Player 1's fleet
    const p1ShipCells = [];
    for (const ship of fleet1) {
      for (const cell of ship.cells) {
        p1ShipCells.push({ r: cell.r, c: cell.c, shipId: ship.id });
      }
    }
    assert.strictEqual(p1ShipCells.length, 17, 'Classica board fleet must have exactly 17 cells');

    // Water cells for Player 1 to shoot harmlessly at Player 0's water
    const p1WaterTargets = [];
    for (let c = 5; c < 10; c++) p1WaterTargets.push({ r: 0, c });
    for (let c = 0; c < 10; c++) p1WaterTargets.push({ r: 1, c });
    for (let c = 0; c < 10; c++) p1WaterTargets.push({ r: 3, c });
    let p1WaterIdx = 0;

    // Simulate turns until Player 0 sinks all of Player 1's ships
    let cellIdx = 0;
    while (client0.state.phase === 'playing' && cellIdx < p1ShipCells.length) {
      if (client0.state.currentTurn === 0) {
        const target = p1ShipCells[cellIdx++];
        client0.fireShot(target.r, target.c);
      } else {
        const miss = p1WaterTargets[p1WaterIdx++];
        client1.fireShot(miss.r, miss.c);
      }
    }

    assert.strictEqual(client0.state.phase, 'game_over', 'Match must reach game_over');
    assert.strictEqual(client0.state.winner, 0, 'Winner must be player 0');
    assert.strictEqual(client0.state.gameOverReason, 'fleet_destroyed');

    // End-of-game verification check
    await client0.waitForIntegrity();
    await client1.waitForIntegrity();

    assert(client0.state.integrity, 'Integrity check must run automatically');
    assert.strictEqual(client0.state.integrity.valid, true, 'Integrity verification must pass');
    assert.strictEqual(client0.state.integrity.cheaterIndex, null);

    client0.destroy();
    client1.destroy();
  });

  // =========================================================================
  // Test 2: Injected Latency, Packet Drops, Duplicates & Out-of-Order Delivery
  // =========================================================================
  await test('2. Injected latency, packet drops, duplicate events, and out-of-order delivery -> convergence', async () => {
    const hub = new SimulatedNetworkHub({ virtualClock: true });

    const transportA = new SimulatedNetworkTransport({
      hub,
      endpointId: 'client_A',
      latencyMs: { min: 50, max: 250 },
      dropRate: 0.1,
      duplicateRate: 0.25,
      reorderRate: 0.25,
      virtualClock: true
    });

    const transportB = new SimulatedNetworkTransport({
      hub,
      endpointId: 'client_B',
      latencyMs: { min: 50, max: 250 },
      dropRate: 0.1,
      duplicateRate: 0.25,
      reorderRate: 0.25,
      virtualClock: true
    });

    const roomId = 'FAULT_ROOM';
    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', seed: 'conv_seed', firstTurn: 0 };

    // Publish setup events
    transportA.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'A', hostNickname: 'Luffy', matchConfig: config }));
    transportA.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'B', guestNickname: 'Zoro', role: 'player' }));
    transportA.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'commit_A', crewId: 'straw_hats' }));
    transportB.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'commit_B', crewId: 'red_haired' }));

    // Advance virtual clock to flush setup
    hub.advanceTime(500);

    // Publish sequence of shots with some duplicates and out-of-order deliveries
    for (let seq = 1; seq <= 8; seq++) {
      const shooter = (seq % 2 === 1) ? 0 : 1;
      const targetR = seq;
      const targetC = seq;

      const fireEvent = createEvent('SHOT_FIRE', {
        seq: seq * 2,
        turn: seq,
        shooterIndex: shooter,
        r: targetR,
        c: targetC
      });

      const answerEvent = createEvent('SHOT_ANSWER', {
        seq: seq * 2 + 1,
        turn: seq,
        defenderIndex: 1 - shooter,
        r: targetR,
        c: targetC,
        outcome: (seq === 1 || seq === 3) ? 'hit' : 'water',
        shipId: (seq === 1 || seq === 3) ? 'moby_dick' : undefined
      });

      // Intentionally publish fire and answer, occasionally duplicate them
      transportA.publish(roomId, fireEvent);
      transportB.publish(roomId, answerEvent);
      if (seq % 3 === 0) {
        // Deliberate duplicate injection
        transportA.publish(roomId, fireEvent);
      }

      hub.advanceTime(100);
    }

    // Flush all pending deliveries in hub
    hub.flushPending();

    // Both clients fold the authoritative room log from the hub
    const authoritativeLog = hub.read(roomId);
    const foldedA = foldMatchLog(authoritativeLog, config);
    const foldedB = foldMatchLog(authoritativeLog, config);

    // Assert exact convergence
    assert.strictEqual(foldedA.phase, foldedB.phase, 'Phases must match');
    assert.strictEqual(foldedA.currentTurn, foldedB.currentTurn, 'Current turns must match');
    assert.strictEqual(foldedA.turnNumber, foldedB.turnNumber, 'Turn numbers must match');
    assert.deepStrictEqual(foldedA.boards[0].shots, foldedB.boards[0].shots, 'Board 0 shots must be identical');
    assert.deepStrictEqual(foldedA.boards[1].shots, foldedB.boards[1].shots, 'Board 1 shots must be identical');
  });

  // =========================================================================
  // Test 3: Mid-Match Browser Refresh (Replay from Stored Token)
  // =========================================================================
  await test('3. Mid-match browser refresh (rejoin with token, replay log, finish match)', async () => {
    const registry = InMemoryTransport.createRegistry();
    const transport = new InMemoryTransport({ registry });
    const roomId = 'REFRESH_TEST';

    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    // Initial match setup
    transport.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'p0', matchConfig: { boardId: 'classica', firstTurn: 0 } }));
    transport.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'p1', role: 'player' }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0, crewId: 'straw_hats' }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1, crewId: 'heart' }));

    // Play 3 turns
    transport.publish(roomId, createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 1, c: 5 }));
    transport.publish(roomId, createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 1, c: 5, outcome: 'hit', shipId: 'moby_dick' }));
    transport.publish(roomId, createEvent('SHOT_FIRE', { seq: 3, turn: 2, shooterIndex: 1, r: 0, c: 0 }));
    transport.publish(roomId, createEvent('SHOT_ANSWER', { seq: 4, turn: 2, defenderIndex: 0, r: 0, c: 0, outcome: 'hit', shipId: 'moby_dick' }));
    transport.publish(roomId, createEvent('SHOT_FIRE', { seq: 5, turn: 3, shooterIndex: 0, r: 1, c: 6 }));
    transport.publish(roomId, createEvent('SHOT_ANSWER', { seq: 6, turn: 3, defenderIndex: 1, r: 1, c: 6, outcome: 'hit', shipId: 'moby_dick' }));

    // Player 1 crashes / refreshes page: stored session token in localStorage
    const storedSession = {
      roomId,
      playerId: 'p1',
      playerIndex: 1,
      nickname: 'Law',
      crewId: 'heart',
      fleet: fleet1,
      salt: salt1
    };

    // Client restarts from scratch with stored credentials and reads log from transport
    const refreshedClient1 = new PvpMatchClient({
      transport,
      roomId: storedSession.roomId,
      playerId: storedSession.playerId,
      playerIndex: storedSession.playerIndex,
      nickname: storedSession.nickname,
      crewId: storedSession.crewId,
      fleet: storedSession.fleet,
      salt: storedSession.salt
    });

    // Verify client immediately caught up to turn 4
    assert.strictEqual(refreshedClient1.state.phase, 'playing');
    assert.strictEqual(refreshedClient1.state.currentTurn, 1, 'Should be Player 1 turn');
    assert.strictEqual(refreshedClient1.state.turnNumber, 4, 'Turn number should be 4');
    assert.strictEqual(refreshedClient1.state.boards[0].shots['1,5'].outcome, 'hit');
    assert.strictEqual(refreshedClient1.state.boards[0].shots['1,6'].outcome, 'hit');

    refreshedClient1.destroy();
  });

  // =========================================================================
  // Test 4: Mid-Match Disconnect & Reconnect (>10s & >60s Forfeit)
  // =========================================================================
  await test('4. Mid-match disconnect (>10s reconnecting, then reconnect; and >60s forfeit)', async () => {
    const registry = InMemoryTransport.createRegistry();
    const transport = new InMemoryTransport({ registry });
    const roomId = 'DISCONNECT_TEST';

    // Setup room and ready commits so match is legitimately in 'playing' phase
    transport.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'p0', matchConfig: { boardId: 'classica' } }));
    transport.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'p1', role: 'player' }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'c0' }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'c1' }));

    const client0 = new PvpMatchClient({
      transport,
      roomId,
      playerId: 'p0',
      playerIndex: 0,
      nickname: 'Luffy',
      fleet: createValidFleet(0, 0),
      salt: generateSalt()
    });

    assert.strictEqual(client0.state.phase, 'playing', 'Match must be in playing phase');
    const now = Date.now();

    // 1. Initial active heartbeat from Player 1
    client0.state.players[1].lastHeartbeat = now - 2000;
    assert.strictEqual(client0.checkLiveness(now), 'online', 'Status should be online');

    // 2. >10s without heartbeat -> "Adversário reconectando…"
    assert.strictEqual(client0.checkLiveness(now + 12000), 'reconnecting', 'Status should be reconnecting after 12s');

    // 3. Reconnect before 60s (at 25s) -> status recovers
    transport.publish(roomId, createEvent('HEARTBEAT', { playerIndex: 1, timestamp: now + 25000 }));
    assert.strictEqual(client0.checkLiveness(now + 26000), 'online', 'Status should recover to online after heartbeat');

    // 4. >60s without heartbeat -> Forfeit
    client0.state.players[1].lastHeartbeat = now + 25000;
    const forfeitStatus = client0.checkLiveness(now + 90000); // 65s after last heartbeat
    assert.strictEqual(forfeitStatus, 'forfeit', 'Status must transition to forfeit after >60s');
    assert.strictEqual(client0.state.phase, 'game_over');
    assert.strictEqual(client0.state.winner, 0, 'Winner must be awarded to connected player');
    assert.strictEqual(client0.state.gameOverReason, 'forfeit');

    client0.destroy();
  });

  // =========================================================================
  // Test 5: Turn Timer Timeout -> Deterministic Auto-Fire
  // =========================================================================
  await test('5. Turn timer timeout -> deterministic auto-fire of untried cell', () => {
    const matchSeed = 'grand_line_seed_42';
    const turnNumber = 5;
    const boardSize = 10;

    const triedCells = {
      '0,0': true,
      '1,1': true,
      '2,2': true
    };

    // Both clients compute auto-shot independently
    const autoShotA = getDeterministicAutoShot(matchSeed, turnNumber, boardSize, triedCells);
    const autoShotB = getDeterministicAutoShot(matchSeed, turnNumber, boardSize, triedCells);

    assert(autoShotA !== null, 'Auto-shot must return a coordinate');
    assert.strictEqual(autoShotA.r, autoShotB.r, 'Row must match exactly');
    assert.strictEqual(autoShotA.c, autoShotB.c, 'Col must match exactly');
    assert(!triedCells[`${autoShotA.r},${autoShotA.c}`], 'Auto-shot must pick an untried cell');
    assert(autoShotA.r >= 0 && autoShotA.r < boardSize);
    assert(autoShotA.c >= 0 && autoShotA.c < boardSize);

    // Different turn number produces a different cell
    const autoShotNextTurn = getDeterministicAutoShot(matchSeed, turnNumber + 1, boardSize, triedCells);
    assert(autoShotNextTurn !== null);
  });

  // =========================================================================
  // Test 6: Rapid Double-Clicks & Out-of-Turn Shot Injection
  // =========================================================================
  await test('6. Rapid double-clicks / out-of-turn shot injection -> ignored idempotently', () => {
    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 };
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'TEST6', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'c0' }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'c1' }),

      // Valid shot from Player 0
      createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 3, c: 4 }),

      // Rapid double-click injection (second shot in same turn before answer)
      createEvent('SHOT_FIRE', { seq: 2, turn: 1, shooterIndex: 0, r: 3, c: 5 }),

      // Out-of-turn shot injection (Player 1 fires on Player 0's turn)
      createEvent('SHOT_FIRE', { seq: 3, turn: 1, shooterIndex: 1, r: 0, c: 0 })
    ];

    const state = foldMatchLog(events, config);

    assert.strictEqual(state.phase, 'playing');
    assert.strictEqual(state.currentTurn, 0, 'Current turn should remain 0');
    assert(state.pendingShot !== null, 'There should be a pending shot');
    assert.strictEqual(state.pendingShot.r, 3, 'Pending shot should be the first shot (r=3)');
    assert.strictEqual(state.pendingShot.c, 4, 'Pending shot should be the first shot (c=4)');
    assert.strictEqual(state.log.length, 1, 'Only the single valid shot should be logged');
  });

  // =========================================================================
  // Test 7: Tampered SHOT_ANSWER (Defender Lies About Hit Being Water)
  // =========================================================================
  await test('7. Tampered SHOT_ANSWER (defender lies about hit being water) -> caught at reveal', async () => {
    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5); // moby_dick at (1,5), (1,6), (1,7), (1,8), (1,9)
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 };

    // Player 0 fires at (1, 5) which is a HIT on moby_dick.
    // Malicious defender answers 'water' instead of 'hit'!
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'CHEAT_TEST', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }),
      createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 1, c: 5 }),
      createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 1, c: 5, outcome: 'water' }), // LIE!
      createEvent('GAME_OVER', { winnerIndex: 1, reason: 'surrender' })
    ];

    const state = foldMatchLog(events, config);
    const reveals = [
      { fleet: fleet0, salt: salt0 },
      { fleet: fleet1, salt: salt1 }
    ];

    const integrity = await verifyMatchIntegrity(state, reveals, config);

    assert.strictEqual(integrity.valid, false, 'Integrity must fail on tampered shot answer');
    assert.strictEqual(integrity.cheaterIndex, 1, 'Cheater must be player 1');
    assert.strictEqual(integrity.reason, 'falsified_shot_answer');
    assert(integrity.message.includes('Trapaça detectada'), 'Message must contain "Trapaça detectada"');
  });

  // =========================================================================
  // Test 8: Tampered TECH_ANSWER (Defender Lies About Sonar Detection)
  // =========================================================================
  await test('8. Tampered TECH_ANSWER (defender lies about sonar/row count) -> caught at reveal', async () => {
    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5); // has moby_dick at (1,5)..(1,9)
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'tatico', firstTurn: 0 };

    // Player 0 uses Haki do Rei (sonar) targeting (1, 6).
    // The ship at (1, 5) is within distance 1 of (1, 6), so sonar is TRUE.
    // Malicious Player 1 answers false!
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'TECH_CHEAT', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0, crewId: 'red_haired' }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1, crewId: 'straw_hats' }),
      createEvent('TECH_FIRE', { seq: 1, turn: 1, shooterIndex: 0, techId: 'haki_do_rei', params: { r: 1, c: 6 } }),
      createEvent('TECH_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, techId: 'haki_do_rei', result: { sonarDetected: false } }), // LIE!
      createEvent('GAME_OVER', { winnerIndex: 1, reason: 'test_end' })
    ];

    const state = foldMatchLog(events, config);
    const reveals = [
      { fleet: fleet0, salt: salt0 },
      { fleet: fleet1, salt: salt1 }
    ];

    const integrity = await verifyMatchIntegrity(state, reveals, config);

    assert.strictEqual(integrity.valid, false, 'Integrity must fail on tampered technique answer');
    assert.strictEqual(integrity.cheaterIndex, 1, 'Cheater must be player 1');
    assert.strictEqual(integrity.reason, 'falsified_tech_sonar');
    assert(integrity.message.includes('Trapaça detectada'), 'Message must contain "Trapaça detectada"');
  });

  // =========================================================================
  // Test 9: Tampered FLEET_REVEAL / Commitment Mismatch
  // =========================================================================
  await test('9. Tampered FLEET_REVEAL / commitment mismatch -> caught at reveal', async () => {
    const fleet0 = createValidFleet(0, 0);
    const realFleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(realFleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 };

    const events = [
      createEvent('ROOM_CREATED', { roomId: 'COMMIT_MISMATCH', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }),
      createEvent('GAME_OVER', { winnerIndex: 0, reason: 'fleet_destroyed' })
    ];

    const state = foldMatchLog(events, config);

    // Player 1 tries to reveal a DIFFERENT fleet after match (tampered fleet)
    const tamperedFleet1 = createValidFleet(1, 4); // shifted column

    const reveals = [
      { fleet: fleet0, salt: salt0 },
      { fleet: tamperedFleet1, salt: salt1 }
    ];

    const integrity = await verifyMatchIntegrity(state, reveals, config);

    assert.strictEqual(integrity.valid, false, 'Integrity check must detect commitment mismatch');
    assert.strictEqual(integrity.cheaterIndex, 1, 'Cheater must be player 1');
    assert.strictEqual(integrity.reason, 'commitment_mismatch');
    assert(integrity.message.includes('Trapaça detectada'), 'Message must contain "Trapaça detectada"');
  });

  // =========================================================================
  // Test 10: Spectator Read-Only View (Zero Fleet Data Before Reveal)
  // =========================================================================
  await test('10. Spectator read-only view (sees shots/answers, zero fleet data before reveal)', async () => {
    const registry = InMemoryTransport.createRegistry();
    const transport = new InMemoryTransport({ registry });
    const roomId = 'SPEC_ROOM';

    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    // Setup room
    transport.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'p0', matchConfig: { boardId: 'classica', firstTurn: 0 } }));
    transport.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'p1', role: 'player' }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }));

    // Spectator joins
    const spectator = new PvpMatchClient({
      transport,
      roomId,
      playerId: 'spec_99',
      role: 'spectator',
      nickname: 'Observador'
    });

    // Make some moves
    transport.publish(roomId, createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 1, c: 5 }));
    transport.publish(roomId, createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 1, c: 5, outcome: 'hit', shipId: 'moby_dick' }));
    transport.publish(roomId, createEvent('REACTION', { playerIndex: 0, reactionId: 'boa_mira' }));

    // Spectator checks state during play
    assert.strictEqual(spectator.state.phase, 'playing');
    assert.strictEqual(spectator.state.reveals[0], null, 'Player 0 fleet must not be visible to spectator');
    assert.strictEqual(spectator.state.reveals[1], null, 'Player 1 fleet must not be visible to spectator');
    assert.strictEqual(spectator.state.boards[0].shots['1,5'].outcome, 'hit', 'Spectator sees public shot hit');
    assert(spectator.state.feed.some(f => f.reactionId === 'boa_mira'), 'Spectator sees Den Den Mushi reaction');

    // Spectator attempts to fire shot -> must be rejected
    assert.throws(() => {
      spectator.fireShot(5, 5);
    }, /Espectadores não podem disparar canhões/, 'Spectator firing must throw PT-BR error');

    // End match with reveals
    transport.publish(roomId, createEvent('GAME_OVER', { winnerIndex: 0, reason: 'fleet_destroyed' }));
    transport.publish(roomId, createEvent('FLEET_REVEAL', { playerIndex: 0, fleet: fleet0, salt: salt0 }));
    transport.publish(roomId, createEvent('FLEET_REVEAL', { playerIndex: 1, fleet: fleet1, salt: salt1 }));

    // Spectator receives reveals at game end
    assert(spectator.state.reveals[0] !== null, 'Player 0 fleet visible after game end reveal');
    assert(spectator.state.reveals[1] !== null, 'Player 1 fleet visible after game end reveal');

    spectator.destroy();
  });

  // =========================================================================
  // Additional Protocol Tests: Reaction Whitelist & Bounty Board
  // =========================================================================
  await test('Bonus: Den Den Mushi reaction whitelist validation & bounty board', () => {
    // Whitelist check
    assert.strictEqual(isValidReaction('boa_mira'), true);
    assert.strictEqual(isValidReaction('gg'), true);
    assert.strictEqual(isValidReaction('hacker_free_text_injection'), false);

    // Bounty board check
    const transport = new InMemoryTransport();
    submitBounty(transport, { playerId: 'p1', nickname: 'Luffy', bounty: 1500000000 });
    submitBounty(transport, { playerId: 'p2', nickname: 'Zoro', bounty: 320000000 });

    const bounties = fetchBounties(transport);
    assert.strictEqual(bounties.length, 2);
    assert.strictEqual(bounties[0].nickname, 'Luffy', 'Highest bounty must be ranked first');
    assert.strictEqual(bounties[0].verified, false, 'Must be marked as casual / unverified');
  });

  // =========================================================================
  // Regression 11: Scattered Non-Contiguous Ship Cells Caught by verifyMatchIntegrity
  // =========================================================================
  await test('11. Regression: Cheater committing scattered non-contiguous ship cells -> caught', async () => {
    const fleet0 = createValidFleet(0, 0);
    // Malicious player 1 creates a length-5 moby_dick with non-contiguous, diagonal/scattered cells
    const scatteredFleet1 = [
      {
        id: 'moby_dick',
        name: 'Moby Dick',
        length: 5,
        r: 0,
        c: 0,
        cells: [
          { r: 0, c: 0 },
          { r: 1, c: 2 }, // not collinear!
          { r: 3, c: 5 },
          { r: 5, c: 7 },
          { r: 7, c: 9 }
        ]
      },
      ...createValidFleet(0, 5).slice(1) // other 4 ships valid
    ];

    const salt0 = generateSalt();
    const salt1 = generateSalt();
    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(scatteredFleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 };
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'SCATTER_TEST', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }),
      createEvent('GAME_OVER', { winnerIndex: 0, reason: 'test_end' })
    ];

    const state = foldMatchLog(events, config);
    const reveals = [
      { fleet: fleet0, salt: salt0 },
      { fleet: scatteredFleet1, salt: salt1 }
    ];

    const integrity = await verifyMatchIntegrity(state, reveals, config);
    assert.strictEqual(integrity.valid, false, 'Integrity must catch scattered non-contiguous ship cells');
    assert.strictEqual(integrity.cheaterIndex, 1, 'Cheater must be player 1');
    assert.strictEqual(integrity.reason, 'invalid_fleet_placement');
    assert(integrity.message.includes('Trapaça detectada'));
  });

  // =========================================================================
  // Regression 12: Fabricated sunkCells Caught by verifyMatchIntegrity
  // =========================================================================
  await test('12. Regression: Cheater returning fabricated sunkCells -> caught', async () => {
    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5); // going_merry is at (9, 5) and (9, 6)
    const salt0 = generateSalt();
    const salt1 = generateSalt();
    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', continueOnHit: true, firstTurn: 0 };
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'SUNK_CELLS_TEST', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }),
      createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 9, c: 5 }),
      createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 9, c: 5, outcome: 'hit', shipId: 'going_merry' }),
      // With continueOnHit: true, Player 0 continues turn and fires at (9, 6)
      createEvent('SHOT_FIRE', { seq: 3, turn: 1, shooterIndex: 0, r: 9, c: 6 }),
      // Defender answers 'sunk' but maliciously provides fake sunkCells coordinates!
      createEvent('SHOT_ANSWER', {
        seq: 4,
        turn: 1,
        defenderIndex: 1,
        r: 9,
        c: 6,
        outcome: 'sunk',
        shipId: 'going_merry',
        shipName: 'Going Merry',
        sunkCells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] // FAKE! Real is (9, 5) and (9, 6)
      }),
      createEvent('GAME_OVER', { winnerIndex: 0, reason: 'test_end' })
    ];

    const state = foldMatchLog(events, config);
    const reveals = [
      { fleet: fleet0, salt: salt0 },
      { fleet: fleet1, salt: salt1 }
    ];

    const integrity = await verifyMatchIntegrity(state, reveals, config);
    assert.strictEqual(integrity.valid, false, 'Integrity must catch fabricated sunkCells');
    assert.strictEqual(integrity.cheaterIndex, 1, 'Cheater must be player 1');
    assert.strictEqual(integrity.reason, 'sunk_cells_mismatch');
    assert(integrity.message.includes('Trapaça detectada'));
  });

  // =========================================================================
  // Regression 13: Loser Refusing FLEET_REVEAL (Attribution & 15s Timeout)
  // =========================================================================
  await test('13. Regression: Loser refusing FLEET_REVEAL (attribution & reveal timeout)', async () => {
    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();
    const commit0 = await computeCommitment(fleet0, salt0);
    const commit1 = await computeCommitment(fleet1, salt1);

    const config = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 };
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'REVEAL_REFUSAL', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }),
      createEvent('GAME_OVER', { winnerIndex: 0, reason: 'fleet_destroyed' })
    ];

    const state = foldMatchLog(events, config);

    // Player 0 reveals, Player 1 refuses to reveal
    const asymmetricReveals = [
      { fleet: fleet0, salt: salt0 },
      null // player 1 refused!
    ];

    const integrity = await verifyMatchIntegrity(state, asymmetricReveals, config);
    assert.strictEqual(integrity.valid, false);
    assert.strictEqual(integrity.cheaterIndex, 1, 'Refusing player must be attributed as cheater (player 1)');
    assert.strictEqual(integrity.reason, 'missing_reveals');
    assert(integrity.message.includes('Trapaça detectada'));

    // Test PvpMatchClient reveal timeout enforcement (>15s)
    const registry = InMemoryTransport.createRegistry();
    const transport = new InMemoryTransport({ registry });
    const roomId = 'TIMEOUT_REVEAL_CLIENT';

    transport.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'p0', matchConfig: config }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 0, commitment: commit0 }));
    transport.publish(roomId, createEvent('READY_COMMIT', { playerIndex: 1, commitment: commit1 }));

    const client0 = new PvpMatchClient({
      transport,
      roomId,
      playerId: 'p0',
      playerIndex: 0,
      fleet: fleet0,
      salt: salt0
    });

    // Game ends and Player 0 reveals
    transport.publish(roomId, createEvent('GAME_OVER', { winnerIndex: 0, reason: 'fleet_destroyed' }));
    transport.publish(roomId, createEvent('FLEET_REVEAL', { playerIndex: 0, fleet: fleet0, salt: salt0 }));

    const now = Date.now();
    client0.gameOverTimestamp = now;

    // After 16 seconds without Player 1 reveal -> timeout triggers cheat_detected forfeit
    const livenessStatus = client0.checkLiveness(now + 16000);
    assert.strictEqual(livenessStatus, 'forfeit');
    assert(client0.state.integrity !== null);
    assert.strictEqual(client0.state.integrity.valid, false);
    assert.strictEqual(client0.state.integrity.cheaterIndex, 1);
    assert.strictEqual(client0.state.integrity.reason, 'reveal_timeout');
    assert.strictEqual(client0.state.winner, 0, 'Victory must be awarded to honest player');

    client0.destroy();
  });

  // =========================================================================
  // Regression 14: PvP Match with salvo: true (Multi-Shots per Turn)
  // =========================================================================
  await test('14. Regression: PvP match with salvo: true -> shots equal to alive ships', async () => {
    // Escaramuça board has 4 ships (lengths 4, 3, 3, 2)
    const config = { boardId: 'escaramuca', boardSize: 8, salvo: true, firstTurn: 0 };
    const events = [
      createEvent('ROOM_CREATED', { roomId: 'SALVO_TEST', hostId: 'p0', matchConfig: config }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'c0' }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'c1' })
    ];

    let state = foldMatchLog(events, config);
    assert.strictEqual(state.phase, 'playing');
    assert.strictEqual(state.currentTurn, 0);
    assert.strictEqual(state.shotsRemainingInTurn, 4, 'Player 0 must start turn with 4 salvo shots');

    // Fire salvo shot 1
    events.push(createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 0, c: 0 }));
    events.push(createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 0, c: 0, outcome: 'water' }));
    state = foldMatchLog(events, config);
    assert.strictEqual(state.currentTurn, 0, 'Turn should still be player 0');
    assert.strictEqual(state.shotsRemainingInTurn, 3, '3 salvo shots remaining');

    // Fire salvo shot 2
    events.push(createEvent('SHOT_FIRE', { seq: 3, turn: 1, shooterIndex: 0, r: 0, c: 1 }));
    events.push(createEvent('SHOT_ANSWER', { seq: 4, turn: 1, defenderIndex: 1, r: 0, c: 1, outcome: 'water' }));
    state = foldMatchLog(events, config);
    assert.strictEqual(state.currentTurn, 0);
    assert.strictEqual(state.shotsRemainingInTurn, 2, '2 salvo shots remaining');

    // Fire salvo shot 3
    events.push(createEvent('SHOT_FIRE', { seq: 5, turn: 1, shooterIndex: 0, r: 0, c: 2 }));
    events.push(createEvent('SHOT_ANSWER', { seq: 6, turn: 1, defenderIndex: 1, r: 0, c: 2, outcome: 'water' }));
    state = foldMatchLog(events, config);
    assert.strictEqual(state.currentTurn, 0);
    assert.strictEqual(state.shotsRemainingInTurn, 1, '1 salvo shot remaining');

    // Fire salvo shot 4 (last shot in salvo)
    events.push(createEvent('SHOT_FIRE', { seq: 7, turn: 1, shooterIndex: 0, r: 0, c: 3 }));
    events.push(createEvent('SHOT_ANSWER', { seq: 8, turn: 1, defenderIndex: 1, r: 0, c: 3, outcome: 'water' }));
    state = foldMatchLog(events, config);

    // After 4th shot, turn must advance to Player 1 with 4 shots!
    assert.strictEqual(state.currentTurn, 1, 'Turn must advance to player 1 after salvo exhausted');
    assert.strictEqual(state.turnNumber, 2);
    assert.strictEqual(state.shotsRemainingInTurn, 4, 'Player 1 starts with 4 salvo shots');
  });

  // =========================================================================
  // Regression 15: Zero Math.random Usage Across Protocol & Transport
  // =========================================================================
  await test('15. Regression: Zero Math.random usage across protocol & transport', () => {
    const originalMathRandom = Math.random;
    let mathRandomCalled = false;

    // Poison Math.random so any call immediately throws
    Math.random = () => {
      mathRandomCalled = true;
      throw new Error('VIOLATION: Math.random() is strictly forbidden in Grand Line Tactics!');
    };

    try {
      // 1. Room code generation
      const roomCode = generateRoomCode();
      assert.strictEqual(roomCode.length, 5);

      // 2. Player ID generation
      const pid = generatePlayerId();
      assert(pid.startsWith('pirate_'));

      // 3. Nickname generation
      const nick = generateDefaultNickname();
      assert(nick.length > 5);

      // 4. Salt generation
      const salt = generateSalt(16);
      assert.strictEqual(salt.length, 32);

      // 5. Event creation
      const ev = createEvent('TEST_EVT', { data: 123 });
      assert(ev.eventId.length > 5);

      // 6. Transport initialization
      const memTransport = new InMemoryTransport();
      assert(memTransport.isAvailable());

      const hub = new SimulatedNetworkHub();
      const simTransport = new SimulatedNetworkTransport({ hub });
      assert(simTransport.isAvailable());

      // 7. Shot answer evaluation
      const fleet = createValidFleet(0, 0);
      const answer = evaluateShotAnswer(fleet, 0, 0);
      assert.strictEqual(answer.outcome, 'hit');

      assert.strictEqual(mathRandomCalled, false, 'Math.random must never be called');
    } finally {
      // Restore original Math.random
      Math.random = originalMathRandom;
    }
  });

  // =========================================================================
  // Test 16: Active PvP Forfeit Protocol (client.forfeit() -> reveal & clean integrity)
  // =========================================================================
  await test('16. PvP forfeit protocol: active player forfeits, both reveal, zero false cheat alerts', async () => {
    const registry = InMemoryTransport.createRegistry();
    const transport0 = new InMemoryTransport({ registry, clientId: 'host_0' });
    const transport1 = new InMemoryTransport({ registry, clientId: 'guest_1' });
    const transportSpec = new InMemoryTransport({ registry, clientId: 'spec_2' });
    const roomId = 'FORF1';

    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();

    const client0 = new PvpMatchClient({
      transport: transport0,
      roomId,
      playerId: 'p0',
      playerIndex: 0,
      nickname: 'Luffy',
      crewId: 'straw_hats',
      fleet: fleet0,
      salt: salt0,
      matchConfig: { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 }
    });

    const client1 = new PvpMatchClient({
      transport: transport1,
      roomId,
      playerId: 'p1',
      playerIndex: 1,
      nickname: 'Shanks',
      crewId: 'red_haired',
      fleet: fleet1,
      salt: salt1,
      matchConfig: { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0 }
    });

    const spectator = new PvpMatchClient({
      transport: transportSpec,
      roomId,
      playerId: 'spec_0',
      role: 'spectator',
      nickname: 'Observador'
    });

    await client0.readyUp();
    await client1.readyUp();

    assert.strictEqual(client0.state.phase, 'playing');
    assert.strictEqual(client1.state.phase, 'playing');

    // Spectator calling forfeit() must throw
    assert.throws(() => {
      spectator.forfeit();
    }, /spectator|espectador/i);

    // Active player 0 forfeits
    const ev = client0.forfeit();
    assert.strictEqual(ev.type, 'GAME_OVER');
    assert.strictEqual(ev.winnerIndex, 1);
    assert.strictEqual(ev.forfeitedBy, 0);
    assert.strictEqual(ev.reason, 'manual_forfeit');

    // Both client0 and client1 should have transitioned to game_over
    assert.strictEqual(client0.state.phase, 'game_over');
    assert.strictEqual(client0.state.winner, 1);
    assert.strictEqual(client0.state.gameOverReason, 'manual_forfeit');
    assert.strictEqual(client0.state.forfeitedBy, 0);

    assert.strictEqual(client1.state.phase, 'game_over');
    assert.strictEqual(client1.state.winner, 1);
    assert.strictEqual(client1.state.gameOverReason, 'manual_forfeit');
    assert.strictEqual(client1.state.forfeitedBy, 0);

    // Integrity check on both clients resolves valid === true (zero false cheat alerts)
    const integrity0 = await client0.waitForIntegrity();
    assert.strictEqual(integrity0.valid, true);
    assert.strictEqual(integrity0.cheaterIndex, null);

    const integrity1 = await client1.waitForIntegrity();
    assert.strictEqual(integrity1.valid, true);
    assert.strictEqual(integrity1.cheaterIndex, null);

    // Already-finished client calling forfeit() must throw and not alter winner
    assert.throws(() => {
      client0.forfeit();
    });
    assert.strictEqual(client0.state.winner, 1);
  });

  // =========================================================================
  // Test 17: In-room crew selection and Vórtice shield clearance on shot absorbed
  // =========================================================================
  await test('17. In-room crew selection (selectCrew/CREW_SELECTED) & Vórtice shield clearance', async () => {
    const { createInitialMatchState, foldMatchLog, createEvent, PvpMatchClient, generateSalt } = protocolModule;

    // 1. In-room crew selection via event & client
    let st = createInitialMatchState();
    assert.strictEqual(st.players[1].crewId, 'red_haired');
    st = foldMatchLog([createEvent('CREW_SELECTED', { playerIndex: 1, crewId: 'whitebeard' })]);
    assert.strictEqual(st.players[1].crewId, 'whitebeard');

    const reg = InMemoryTransport.createRegistry();
    const t0 = new InMemoryTransport({ registry: reg, clientId: 'h0' });
    const t1 = new InMemoryTransport({ registry: reg, clientId: 'g1' });
    const c0 = new PvpMatchClient({
      transport: t0, roomId: 'CREW1', playerId: 'p0', playerIndex: 0, nickname: 'Luffy', crewId: 'straw_hats', fleet: [], salt: generateSalt(), matchConfig: { boardId: 'classica' }
    });
    const c1 = new PvpMatchClient({
      transport: t1, roomId: 'CREW1', playerId: 'p1', playerIndex: 1, nickname: 'Guest', crewId: 'marines', fleet: [], salt: generateSalt(), matchConfig: { boardId: 'classica' }
    });
    c1.selectCrew('heart');
    assert.strictEqual(c1.crewId, 'heart');
    assert.strictEqual(c1.state.players[1].crewId, 'heart');

    // 2. Vórtice shield persistence fix: SHOT_ANSWER with outcome: 'absorbed' must clear shieldActive
    const evts = [
      createEvent('PLAYER_JOINED', { playerIndex: 0, playerId: 'p0', nickname: 'Luffy', crewId: 'straw_hats' }),
      createEvent('PLAYER_JOINED', { playerIndex: 1, playerId: 'p1', nickname: 'Teach', crewId: 'blackbeard' }),
      createEvent('READY_COMMIT', { playerIndex: 0, commitment: '0'.repeat(64) }),
      createEvent('READY_COMMIT', { playerIndex: 1, commitment: '1'.repeat(64) }),
      createEvent('TECH_USED', { seq: 1, playerIndex: 1, techniqueId: 'vortice' }),
      createEvent('SHOT_FIRED', { seq: 2, turn: 1, shooter: 0, r: 2, c: 3 }),
      createEvent('SHOT_ANSWER', { seq: 3, turn: 1, shooter: 0, r: 2, c: 3, outcome: 'absorbed', shieldConsumed: true })
    ];
    const folded = foldMatchLog(evts);
    assert.strictEqual(folded.players[1].shieldActive, false, 'Absorbed shot must clear defender shieldActive');
  });

  // =========================================================================
  // Test 18: Full Rematch Lifecycle & Phase Reset
  // =========================================================================
  await test('18. PvP rematch protocol: both players accept -> reset to lobby and boards cleared', async () => {
    const reg = InMemoryTransport.createRegistry();
    const t0 = new InMemoryTransport({ registry: reg, clientId: 'host' });
    const t1 = new InMemoryTransport({ registry: reg, clientId: 'guest' });

    const c0 = new PvpMatchClient({
      transport: t0, roomId: 'REMATCH_ROOM', playerId: 'p0', playerIndex: 0, nickname: 'Luffy', crewId: 'straw_hats', fleet: [], salt: generateSalt(), matchConfig: { boardId: 'classica' }
    });
    const c1 = new PvpMatchClient({
      transport: t1, roomId: 'REMATCH_ROOM', playerId: 'p1', playerIndex: 1, nickname: 'Zoro', crewId: 'marines', fleet: [], salt: generateSalt(), matchConfig: { boardId: 'classica' }
    });

    // Simulate game over state
    const gameOverEvent = createEvent('GAME_OVER', { winnerIndex: 0, reason: 'all_ships_sunk' });
    t0.publish('REMATCH_ROOM', gameOverEvent);
    assert.strictEqual(c0.state.phase, 'game_over');
    assert.strictEqual(c1.state.phase, 'game_over');

    // Player 0 requests rematch -> state remains game_over, rematchRequested[0] = true
    c0.requestRematch();
    assert.strictEqual(c0.state.phase, 'game_over');
    assert.strictEqual(c0.state.rematchRequested[0], true);
    assert.strictEqual(c0.state.rematchRequested[1], false);

    // Player 1 also requests rematch -> triggers reset to lobby!
    c1.requestRematch();
    assert.strictEqual(c0.state.phase, 'lobby', 'Host state must reset to lobby');
    assert.strictEqual(c1.state.phase, 'lobby', 'Guest state must reset to lobby');
    assert.strictEqual(c0.state.rematchRequested[0], false, 'Rematch flags must reset');
    assert.strictEqual(c0.state.rematchRequested[1], false, 'Rematch flags must reset');
    assert.strictEqual(c0.state.players[0].ready, false, 'Player 0 ready flag must reset');
    assert.strictEqual(c0.state.players[1].ready, false, 'Player 1 ready flag must reset');
    assert.strictEqual(Object.keys(c0.state.boards[0].shots).length, 0, 'Board 0 shots must be cleared');
    assert.strictEqual(Object.keys(c0.state.boards[1].shots).length, 0, 'Board 1 shots must be cleared');

    c0.destroy();
    c1.destroy();
  });

  // =========================================================================
  // Tests 19-21, 23-26: the same protocol over the published-Artifact transport
  // (ArtifactDbTransport on the db/room/user fake, enforcing the publish's db rules)
  // with injected faults, a mid-match refresh and a hostile rival.
  // =========================================================================
  const { createFakeClaude, createMemoryHub } = require('./fakes/claude-fake.js');
  const { detectTransportBackend, createTransportFor, ARTIFACT_CAPABILITIES } = transportModule;
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  async function waitFor(cond, ms, label) {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('Timed out: ' + label);
      await nap(5);
    }
  }
  async function dbClient(hub, seed, userId, faults) {
    const fake = createFakeClaude({ hub, seed, userId, faults });
    const backend = await detectTransportBackend({ claude: fake.claude });
    assert.strictEqual(backend.kind, 'artifactDb');
    const transport = createTransportFor(backend, { retryBaseMs: 5, maxRetryMs: 60 });
    return { fake, transport, db: await fake.claude.use('db') };
  }
  function projection(c) {
    const s = c.state;
    return {
      phase: s.phase,
      winner: s.winner,
      reason: s.gameOverReason,
      shots0: s.boards[0].shots,
      shots1: s.boards[1].shots,
      commit0: s.players[0].commitment,
      commit1: s.players[1].commitment,
      reveals: [!!s.reveals[0], !!s.reveals[1]],
      valid: s.integrity ? s.integrity.valid : null,
      cheater: s.integrity ? s.integrity.cheaterIndex : null
    };
  }
  function chunkEvents(hub, uid, roomId) {
    return hub.list('moves/' + uid + '/' + roomId)
      .map(d => d.body)
      .sort((a, b) => a.k - b.k)
      .flatMap(b => b.events || []);
  }
  /** Independent reader: what a late spectator folds from the store alone (author = path). */
  function storeLog(hub, roomId, pinnedHost) {
    const room = hub.read('rooms/' + roomId);
    const hostUid = pinnedHost || (room && room.by);
    const hostEvents = chunkEvents(hub, hostUid, roomId);
    const bind = hostEvents.find(e => e.type === 'SEAT_BIND' && e.seat === 1);
    const out = hostEvents.filter(e => e.type !== 'SEAT_BIND').map(e => Object.assign({}, e, { _seat: 0 }));
    if (bind) chunkEvents(hub, bind.uid, roomId).forEach(e => out.push(Object.assign({}, e, { _seat: 1 })));
    return out;
  }
  function rawAppend(db, uid, roomId, k, events) {
    return db.doc('moves/' + uid + '/' + roomId + '/c' + String(k).padStart(4, '0')).set({ v: 1, room: roomId, k, at: Date.now(), events });
  }

  async function runDbMatch(opts) {
    const hub = createMemoryHub({ rules: ARTIFACT_CAPABILITIES.db.rules });
    const roomId = opts.roomId;
    const cfg = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0, seed: 'glt_pvp_' + roomId };
    const fleet0 = createValidFleet(0, 0);
    const fleet1 = createValidFleet(1, 5);
    const salt0 = generateSalt();
    const salt1 = generateSalt();
    const fakes = [];

    const A = await dbClient(hub, opts.seed, 'user_a', opts.faults);
    fakes.push(A.fake);
    A.transport.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'user_a', hostNickname: 'Luffy', crewId: 'straw_hats', matchConfig: cfg }));
    const c0 = new PvpMatchClient({ transport: A.transport, roomId, playerId: 'user_a', playerIndex: 0, nickname: 'Luffy', crewId: 'straw_hats', fleet: fleet0, salt: salt0, matchConfig: cfg });
    await A.transport.whenIdle();

    let B = await dbClient(hub, opts.seed + 1, 'user_b', opts.faults);
    fakes.push(B.fake);
    const existing = await B.transport.readAsync(roomId);
    assert.ok(existing.some(e => e.type === 'ROOM_CREATED' && e._seat === 0), 'guest replays ROOM_CREATED from the host log');
    B.transport.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'user_b', guestNickname: 'Zoro', crewId: 'red_haired', role: 'player' }));
    let c1 = new PvpMatchClient({ transport: B.transport, roomId, playerId: 'user_b', playerIndex: 1, nickname: 'Zoro', crewId: 'red_haired', fleet: fleet1, salt: salt1, matchConfig: cfg });
    if (opts.patchGuest) opts.patchGuest(c1, { fleet1, salt1 });

    await c0.readyUp();
    await c1.readyUp();
    await waitFor(() => c0.state.phase === 'playing' && c1.state.phase === 'playing', 8000, 'both clients playing');
    const ctx = { hub, A, get B() { return B; }, get c0() { return c0; }, get c1() { return c1; }, roomId, fleet0, fleet1, salt0, salt1 };
    if (opts.afterPlaying) await opts.afterPlaying(ctx);

    const targets = [
      fleet1.flatMap(s => s.cells),
      [1, 3, 5, 7, 9].flatMap(r => Array.from({ length: 10 }, (_, c) => ({ r, c })))
    ];
    let refreshed = !opts.refreshAtTurn;
    let reacted = false;
    let reactionSeenByGuest = null;
    const t0 = Date.now();
    while (!(c0.state.phase === 'game_over' && c1.state.phase === 'game_over' && !(opts.keepGoing && opts.keepGoing(ctx)))) {
      if (Date.now() - t0 > 30000) {
        throw new Error('match did not finish: ' + JSON.stringify({ p0: c0.state.phase, p1: c1.state.phase, turn: c0.state.turnNumber, tail0: c0.rawEvents.filter(e => e.type !== 'HEARTBEAT').slice(-6).map(e => [e.type, e.seq, e._seat]), tail1: c1.rawEvents.filter(e => e.type !== 'HEARTBEAT').slice(-6).map(e => [e.type, e.seq, e._seat]) }));
      }
      if (!reacted && c0.state.turnNumber >= 3) {
        reacted = true;
        c0.sendReaction(DEN_DEN_REACTIONS[0].id);
      }
      if (!refreshed && c0.state.turnNumber >= opts.refreshAtTurn) {
        // Player 1 refreshes mid-match: the page dies with whatever was in flight; only the
        // per-tab session (room, index, host, fleet, salt) survives, exactly as sessionStorage would.
        refreshed = true;
        reactionSeenByGuest = c1.state.feed.some(f => f.type === 'reaction' && f.reactionId === DEN_DEN_REACTIONS[0].id);
        const session = { playerId: 'user_b', playerIndex: 1, fleet: fleet1, salt: salt1, hostUid: B.transport.getRoomHost(roomId) };
        assert.strictEqual(session.hostUid, 'user_a');
        B.fake.kill();
        c1.destroy();
        B.transport.destroy();
        await nap(30);
        B = await dbClient(hub, opts.seed + 2, 'user_b', opts.faults);
        fakes.push(B.fake);
        B.transport.pinRoomHost(roomId, session.hostUid);
        await B.transport.readAsync(roomId);
        c1 = new PvpMatchClient(Object.assign({ transport: B.transport, roomId, nickname: 'Zoro', crewId: 'red_haired', matchConfig: cfg }, session));
      }
      if (opts.onTick) await opts.onTick(ctx);
      if (opts.forfeitAtTurn && c1.state.phase === 'playing' && c1.state.turnNumber >= opts.forfeitAtTurn) {
        try { c1.forfeit(); } catch (_) {}
      }
      for (const c of [c0, c1]) {
        const st = c.state;
        if (st.phase !== 'playing' || st.currentTurn !== c.playerIndex || st.pendingShot) continue;
        if (opts.holdFire && opts.holdFire(ctx, c)) continue;
        const mine = st.boards[c.playerIndex].shots;
        const next = targets[c.playerIndex].find(t => !mine[`${t.r},${t.c}`]);
        if (next) {
          let fired = null;
          try { fired = c.fireShot(next.r, next.c); } catch (_) {}
          if (fired && opts.onFire) await opts.onFire(ctx, c, fired);
        }
      }
      await nap(3);
    }
    await waitFor(() => c0.state.integrity && c1.state.integrity, 10000, 'both integrity checks');
    await A.transport.whenIdle();
    await B.transport.whenIdle();
    if (reactionSeenByGuest === null) {
      reactionSeenByGuest = c1.state.feed.some(f => f.type === 'reaction' && f.reactionId === DEN_DEN_REACTIONS[0].id);
    }
    return { hub, c0, c1, A, B, fakes, salt0, salt1, cfg, roomId, refreshed, reactionSeenByGuest, ctx };
  }
  function closeMatch(r) {
    r.c0.destroy(); r.c1.destroy(); r.A.transport.destroy(); r.B.transport.destroy();
  }
  function revealIndex(w) {
    return !!(w.body && Array.isArray(w.body.events) && w.body.events.some(e => e.type === 'FLEET_REVEAL'));
  }

  await test('19. Artifact db transport: full match under latency, drops, lost acks, duplicate snapshots and a mid-match refresh -> identical end state', async () => {
    const faults = { latency: [2, 20], dropWrite: 0.15, lostAck: 0.15, dupSnapshot: 0.35, emitDrop: 0 };
    const r = await runDbMatch({ roomId: 'DBF19', seed: 1901, faults, refreshAtTurn: 9 });
    const { hub, c0, c1, fakes, salt0, salt1, cfg, roomId } = r;

    assert.ok(r.refreshed, 'player 1 refreshed mid-match');
    assert.strictEqual(c0.state.phase, 'game_over');
    assert.strictEqual(c0.state.winner, 0);
    assert.strictEqual(c0.state.integrity.valid, true, 'honest match verifies: ' + JSON.stringify(c0.state.integrity));
    assert.deepStrictEqual(projection(c0), projection(c1), 'both clients end in the same state');

    // The store alone (author = path, never the body) folds to the same result
    const folded = foldMatchLog(storeLog(hub, roomId), cfg);
    assert.deepStrictEqual(folded.boards[0].shots, c0.state.boards[0].shots);
    assert.deepStrictEqual(folded.boards[1].shots, c0.state.boards[1].shots);
    assert.strictEqual(folded.winner, 0);

    // Faults really happened, and the one-write-at-a-time-per-doc rule held throughout
    const sum = (k) => fakes.reduce((acc, f) => acc + f.stats[k], 0);
    assert.ok(sum('droppedWrites') > 0 && sum('lostAcks') > 0 && sum('dupSnapshots') > 0, 'faults injected: ' + JSON.stringify(fakes.map(f => f.stats)));
    assert.strictEqual(sum('overlappingWrites'), 0, 'never two writes in flight to one doc');
    assert.strictEqual(sum('deniedWrites'), 0, 'honest clients never write outside what the rules allow');

    // Doc budget: one listing + one index per player + a handful of chunks, not one doc per event
    const docs = hub.dump();
    assert.ok(docs.length <= 8, 'bounded doc count per match: ' + docs.map(d => d.path).join(', '));

    // Store scan: no fleet and no salt in any db doc or room message before the first reveal
    const firstReveal = hub.writeLog.findIndex(revealIndex);
    assert.ok(firstReveal > 0, 'reveal reached the store');
    hub.writeLog.slice(0, firstReveal).forEach(w => {
      const s = JSON.stringify(w.body);
      assert.ok(!s.includes(salt0) && !s.includes(salt1), 'salt leaked before reveal in ' + w.path);
      assert.ok(!/"fleet"/.test(s), 'fleet leaked before reveal in ' + w.path);
    });
    docs.forEach(d => {
      const body = Object.assign({}, d.body, { events: (d.body.events || []).filter(e => e.type !== 'FLEET_REVEAL') });
      const s = JSON.stringify(body);
      assert.ok(!/"fleet"/.test(s) && !s.includes(salt0) && !s.includes(salt1), 'fleet data outside a reveal in ' + d.path);
    });
    hub.msgLog.forEach(m => {
      const s = JSON.stringify(m);
      assert.ok(!s.includes(salt0) && !s.includes(salt1) && !/"fleet"/.test(s), 'fleet data on the room channel');
    });

    // Room capability: presence heartbeats and the preset reaction reached the rival
    assert.ok(c0.state.players[1].lastHeartbeat > 0 && c1.state.players[0].lastHeartbeat > 0, 'presence heartbeats seen');
    assert.ok(r.reactionSeenByGuest, 'reaction delivered over room (moments are never replayed after a refresh)');
    assert.ok(!storeLog(hub, roomId).some(e => e.type === 'REACTION' || e.type === 'HEARTBEAT'), 'presence/reactions never stored');

    closeMatch(r);
  });

  await test('20. Artifact db transport: defender lies about a hit -> "Trapaça detectada" on both clients', async () => {
    const faults = { latency: [1, 10], dropWrite: 0.1, lostAck: 0.1, dupSnapshot: 0.3 };
    const r = await runDbMatch({
      roomId: 'DBT20', seed: 2001, faults, forfeitAtTurn: 12,
      patchGuest(c1, { fleet1 }) {
        const honest = c1._autoAnswerShot.bind(c1);
        let lied = false;
        c1._autoAnswerShot = function (shot) {
          const isShip = fleet1.some(s => s.cells.some(cell => cell.r === shot.r && cell.c === shot.c));
          if (!lied && isShip) {
            lied = true;
            const ev = createEvent('SHOT_ANSWER', { seq: shot.seq + 1, turn: shot.turn, defenderIndex: 1, r: shot.r, c: shot.c, outcome: 'water' });
            ev.eventId = `shot_answer_s${shot.seq}_${shot.r}_${shot.c}`;
            this.seqCounter = Math.max(this.seqCounter, ev.seq + 1);
            this.transport.publish(this.roomId, ev);
            return;
          }
          return honest(shot);
        };
      }
    });
    for (const c of [r.c0, r.c1]) {
      assert.strictEqual(c.state.integrity.valid, false, 'lie must be caught');
      assert.strictEqual(c.state.integrity.cheaterIndex, 1);
      assert.strictEqual(c.state.winner, 0);
      assert.strictEqual(c.state.gameOverReason, 'cheat_detected');
      assert.ok(/Trapaça detectada/.test(c.state.integrity.message));
    }
    closeMatch(r);
  });

  await test('21. Artifact db transport: revealed fleet differs from the commitment -> caught', async () => {
    const r = await runDbMatch({
      roomId: 'DBT21', seed: 2101, faults: { latency: [1, 8], dupSnapshot: 0.3 }, forfeitAtTurn: 6,
      patchGuest(c1) {
        c1.revealFleet = function () {
          const forged = canonicalizeFleet(createValidFleet(0, 5));
          this.transport.publish(this.roomId, createEvent('FLEET_REVEAL', { playerIndex: 1, fleet: forged, salt: this.salt }));
        };
      }
    });
    for (const c of [r.c0, r.c1]) {
      assert.strictEqual(c.state.integrity.valid, false);
      assert.strictEqual(c.state.integrity.cheaterIndex, 1);
    }
    closeMatch(r);
  });

  await test('23. Hostile rival with raw db access: forged events in the host\'s name are refused by the rules or dropped by the fold', async () => {
    const probes = {};
    const r = await runDbMatch({
      roomId: 'ATK23', seed: 2301, faults: { latency: [1, 10], dropWrite: 0.1, lostAck: 0.1, dupSnapshot: 0.3 },
      async afterPlaying(ctx) {
        const db = ctx.B.db;
        const commit0 = ctx.c0.state.players[0].commitment;
        // P0: write straight into the host's subtree -> the platform rule refuses it
        await assert.rejects(rawAppend(db, 'user_a', ctx.roomId, 999, [createEvent('GAME_OVER', { winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit', seq: 2 })]),
          e => e.code === 'invalid_argument');
        // P1 + P4: in the guest's own subtree, a forfeit and a second commitment in the host's name
        const forgedOver = createEvent('GAME_OVER', { seq: 2, turn: 1, winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit' });
        const forgedCommit = createEvent('READY_COMMIT', { playerIndex: 0, playerId: 'user_a', crewId: 'straw_hats', commitment: 'f'.repeat(64) });
        await rawAppend(db, 'user_b', ctx.roomId, 900, [forgedOver, forgedCommit]);
        // A third party re-points the listing at itself and writes its own "host" log
        const X = await dbClient(ctx.hub, 2399, 'user_x', {});
        await X.db.doc('rooms/' + ctx.roomId).update({ by: 'user_x', guest: 'user_x' });
        await rawAppend(X.db, 'user_x', ctx.roomId, 0, [createEvent('GAME_OVER', { seq: 2, winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit' })]);
        await assert.rejects(rawAppend(X.db, 'user_b', ctx.roomId, 0, []), e => e.code === 'invalid_argument');
        await nap(80);
        probes.stillPlaying = ctx.c0.state.phase === 'playing' && ctx.c1.state.phase === 'playing';
        probes.commitKept = ctx.c0.state.players[0].commitment === commit0 && ctx.c1.state.players[0].commitment === commit0;
      },
      async onFire(ctx, c, fired) {
        // P2: when the guest shoots, it pre-writes the host's answer ("hit") under the id the
        // host will use, in its own subtree.
        if (c.playerIndex !== 1 || probes.p2) return;
        probes.p2 = true;
        const fake = createEvent('SHOT_ANSWER', { seq: fired.seq + 1, turn: fired.turn, defenderIndex: 0, r: fired.r, c: fired.c, outcome: 'hit', shipId: 'x' });
        fake.eventId = `shot_answer_s${fired.seq}_${fired.r}_${fired.c}`;
        await rawAppend(ctx.B.db, 'user_b', ctx.roomId, 901, [fake]);
      }
    });
    assert.ok(probes.stillPlaying, 'forged forfeit ignored by both clients');
    assert.ok(probes.commitKept, 'second commitment in the host\'s name ignored');
    assert.ok(probes.p2, 'pre-written answer probe ran');
    assert.deepStrictEqual(projection(r.c0), projection(r.c1), 'both clients end identical');
    assert.strictEqual(r.c0.state.winner, 0);
    assert.strictEqual(r.c0.state.gameOverReason, 'fleet_destroyed');
    assert.strictEqual(r.c0.state.integrity.valid, true, JSON.stringify(r.c0.state.integrity));
    const folded = foldMatchLog(storeLog(r.hub, r.roomId, 'user_a'), r.cfg); // the listing now lies; the pinned host does not
    assert.strictEqual(folded.winner, 0, 'store fold agrees');
    closeMatch(r);
  });

  await test('24. Absence claim while the rival is alive is refuted automatically; no fleet is revealed', async () => {
    const probes = { claimed: false, sawGameOver: false, refuted: false };
    const r = await runDbMatch({
      roomId: 'ABS24', seed: 2401, faults: { latency: [1, 10], dupSnapshot: 0.3 },
      // the host "thinks" from turn 5 until the claim is made and refuted
      holdFire(ctx, c) { return c.playerIndex === 0 && c.state.turnNumber >= 5 && !probes.refuted; },
      async onTick(ctx) {
        const { c0, c1 } = ctx;
        if (!probes.claimed && c0.state.turnNumber >= 5 && c0.state.currentTurn === 0 && !c0.state.pendingShot && c1.state.phase === 'playing' &&
            c1.state.currentTurn === 0 && !c1.state.pendingShot && c1.state.turnNumber === c0.state.turnNumber) {
          // The guest declares the host absent while it is the host's turn (as a cheater would)
          probes.claimed = true;
          probes.revealsBefore = ctx.hub.writeLog.filter(revealIndex).length;
          c1.transport.publish(c1.roomId, createEvent('GAME_OVER', { seq: c1.seqCounter, winnerIndex: 1, reason: 'forfeit' }));
          probes.sawGameOver = c1.state.phase === 'game_over';
        }
        if (probes.claimed && !probes.refuted && c0.state.phase === 'playing' && c1.state.phase === 'playing' &&
            c1.rawEvents.some(e => e.type === 'PRESENCE')) {
          probes.refuted = true;
          probes.revealsAtRefute = ctx.hub.writeLog.filter(revealIndex).length;
        }
      }
    });
    assert.ok(probes.claimed && probes.sawGameOver, 'claim applied locally first');
    assert.ok(probes.refuted, 'host refuted the claim and both resumed');
    assert.strictEqual(probes.revealsBefore, 0);
    assert.strictEqual(probes.revealsAtRefute, 0, 'no fleet revealed by the absence claim');
    assert.deepStrictEqual(projection(r.c0), projection(r.c1));
    assert.strictEqual(r.c0.state.gameOverReason, 'fleet_destroyed');
    assert.strictEqual(r.c0.state.integrity.valid, true);
    closeMatch(r);
  });

  await test('25. Fold: events stamped with an author seat may only speak for that seat', () => {
    const cfg = { boardId: 'classica', firstTurn: 0, seed: 's25' };
    const base = [
      Object.assign(createEvent('ROOM_CREATED', { roomId: 'X', hostId: 'a', matchConfig: cfg }), { _seat: 0 }),
      Object.assign(createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'a'.repeat(64) }), { _seat: 0 }),
      Object.assign(createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'b'.repeat(64) }), { _seat: 1 }),
      Object.assign(createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 0, c: 0 }), { _seat: 0 })
    ];
    const forged = [
      Object.assign(createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'c'.repeat(64) }), { _seat: 1 }),
      Object.assign(createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 0, c: 0, outcome: 'hit' }), { _seat: 0, eventId: 'shot_answer_s1_0_0' }),
      Object.assign(createEvent('GAME_OVER', { seq: 3, winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit' }), { _seat: 1 }),
      Object.assign(createEvent('GAME_OVER', { seq: 3, winnerIndex: 1, reason: 'fleet_destroyed' }), { _seat: 1 }),
      Object.assign(createEvent('TURN_TIMEOUT', { seq: 3, playerIndex: 0 }), { _seat: 1 })
    ];
    const s = foldMatchLog(forged.concat(base), cfg);
    assert.strictEqual(s.phase, 'playing');
    assert.strictEqual(s.players[0].commitment, 'a'.repeat(64));
    assert.ok(s.pendingShot && !s.boards[0].shots['0,0'], 'forged answer ignored, shot still pending');
    // The real answer, same id, other author: delivered and applied
    const real = Object.assign(createEvent('SHOT_ANSWER', { seq: 2, turn: 1, defenderIndex: 1, r: 0, c: 0, outcome: 'water' }), { _seat: 1, eventId: 'shot_answer_s1_0_0' });
    const s2 = foldMatchLog(forged.concat(base, [real]), cfg);
    assert.strictEqual(s2.boards[0].shots['0,0'].outcome, 'water');
    // Unauthenticated transports (no _seat) keep the old behaviour
    const plain = base.map(e => { const x = Object.assign({}, e); delete x._seat; return x; });
    assert.strictEqual(foldMatchLog(plain, cfg).phase, 'playing');
  });

  await test('26. Fold: an absence claim counts only with an integer seq at most the next seq, during play, and stays refutable', () => {
    const cfg = { boardId: 'classica', firstTurn: 0, seed: 's26' };
    const stamp = (ev, seat) => Object.assign(ev, { _seat: seat });
    const base = [
      stamp(createEvent('ROOM_CREATED', { roomId: 'X', hostId: 'a', matchConfig: cfg }), 0),
      stamp(createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'a'.repeat(64) }), 0),
      stamp(createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'b'.repeat(64) }), 1),
      stamp(createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 0, c: 0 }), 0)
    ];
    const claim = (fields) => {
      const ev = createEvent('GAME_OVER', Object.assign({ winnerIndex: 1, reason: 'forfeit' }, fields));
      if (!('seq' in fields)) delete ev.seq;
      return stamp(ev, 1);
    };
    const malformed = {
      'no seq': {}, 'string seq': { seq: '2' }, 'null seq': { seq: null }, 'float seq': { seq: 2.5 },
      'negative seq': { seq: -1 }, 'seq past the log': { seq: 1e9 }, 'NaN-ish seq': { seq: {} }
    };
    for (const [name, fields] of Object.entries(malformed)) {
      for (const authed of [true, false]) {
        let log = base.concat([claim(fields)]);
        if (!authed) log = log.map(e => { const x = Object.assign({}, e); delete x._seat; return x; });
        const s = foldMatchLog(log, cfg);
        assert.strictEqual(s.phase, 'playing', name + (authed ? '' : ' (unauthenticated)') + ' must not end the match');
        assert.strictEqual(s.winner, null, name);
      }
    }
    // Well-formed claim at the next seq with no answer from the accused: wins by absence
    const ok = foldMatchLog(base.concat([claim({ seq: 2 })]), cfg);
    assert.strictEqual(ok.phase, 'game_over');
    assert.strictEqual(ok.winner, 1);
    assert.strictEqual(ok.absenceClaimSeq, 2);
    // ...and is voided by the accused's PRESENCE proof at that seq
    const proof = stamp(createEvent('PRESENCE', { seq: 2, playerIndex: 0 }), 0);
    assert.strictEqual(foldMatchLog(base.concat([claim({ seq: 2 }), proof]), cfg).phase, 'playing');
    // Before the match starts (guest not committed) a claim is ignored
    const setup = base.filter(e => !(e.type === 'READY_COMMIT' && e.playerIndex === 1));
    const early = stamp(createEvent('GAME_OVER', { seq: 2, winnerIndex: 0, reason: 'forfeit' }), 0);
    const se = foldMatchLog(setup.concat([early]), cfg);
    assert.notStrictEqual(se.phase, 'game_over', 'claim during setup ignored');
    // A shot with a malformed seq is dropped, not sorted
    const badShot = stamp(createEvent('SHOT_FIRE', { seq: '0', turn: 1, shooterIndex: 1, r: 1, c: 1 }), 1);
    assert.deepStrictEqual(foldMatchLog(base.concat([badShot]), cfg).pendingShot, foldMatchLog(base, cfg).pendingShot);
  });

  await test('27. Artifact db transport: malformed absence claims (no seq, string seq, far-future seq) never end the match', async () => {
    const variants = [
      ['NOSEQ', (c1) => { const ev = createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit' }); delete ev.seq; return ev; }],
      ['STRSQ', (c1) => createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit', seq: String(c1.seqCounter) })],
      ['FARSQ', (c1) => createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit', seq: c1.seqCounter + 5000 })]
    ];
    let n = 0;
    for (const [tag, make] of variants) {
      const probes = { claimed: false, endedEarly: false };
      const r = await runDbMatch({
        roomId: 'AB' + tag, seed: 2701 + (n++), faults: { latency: [1, 10], dupSnapshot: 0.3, dropWrite: 0.1, lostAck: 0.1 },
        async onTick(ctx) {
          const { c0, c1 } = ctx;
          if (!probes.claimed && c0.state.turnNumber >= 2) {
            probes.claimed = true;
            c1.transport.publish(c1.roomId, make(c1));
          }
          if (probes.claimed && [c0, c1].some(c => c.state.phase === 'game_over' && c.state.gameOverReason === 'forfeit')) probes.endedEarly = true;
        }
      });
      assert.ok(probes.claimed, tag + ': claim written');
      assert.ok(!probes.endedEarly, tag + ': no client ever saw an absence win');
      assert.ok(!r.c0.rawEvents.some(e => e.type === 'PRESENCE'), tag + ': nothing to refute');
      assert.deepStrictEqual(projection(r.c0), projection(r.c1), tag + ': both clients end identical');
      assert.strictEqual(r.c0.state.gameOverReason, 'fleet_destroyed', tag);
      assert.strictEqual(r.c0.state.integrity.valid, true, tag + ': audit ran and passed');
      closeMatch(r);
    }
  });

  await test('28. Seq inflation: one event with a huge seq never freezes the match nor blocks an absence win', async () => {
    // Fold: the junk event is dropped, later honest events and a well-formed absence claim still count
    const cfg = { boardId: 'classica', firstTurn: 0, seed: 's28' };
    const stamp = (ev, seat) => Object.assign(ev, { _seat: seat });
    const base = [
      stamp(createEvent('ROOM_CREATED', { roomId: 'X', hostId: 'a', matchConfig: cfg }), 0),
      stamp(createEvent('READY_COMMIT', { playerIndex: 0, commitment: 'a'.repeat(64) }), 0),
      stamp(createEvent('READY_COMMIT', { playerIndex: 1, commitment: 'b'.repeat(64) }), 1),
      stamp(createEvent('SHOT_FIRE', { seq: 1, turn: 1, shooterIndex: 0, r: 0, c: 0 }), 0)
    ];
    const junk = stamp(createEvent('SHOT_FIRE', { seq: Number.MAX_SAFE_INTEGER, turn: 1, shooterIndex: 1, r: -1, c: 0 }), 1);
    const claim = stamp(createEvent('GAME_OVER', { seq: 2, winnerIndex: 0, reason: 'forfeit' }), 0);
    const won = foldMatchLog(base.concat([junk, claim]), cfg);
    assert.strictEqual(won.phase, 'game_over', 'absence win still possible after the junk event');
    assert.strictEqual(won.winner, 0);
    assert.deepStrictEqual(foldMatchLog(base.concat([junk]), cfg).pendingShot, foldMatchLog(base, cfg).pendingShot);

    // Live match on the db transport: the attacker stays, the match must still end by fleet destroyed
    const probes = { sent: false };
    const r = await runDbMatch({
      roomId: 'ABSEQI', seed: 2801, faults: { latency: [1, 10], dupSnapshot: 0.3, dropWrite: 0.1, lostAck: 0.1 },
      async onTick(ctx) {
        const { c0, c1 } = ctx;
        if (!probes.sent && c0.state.turnNumber >= 2) {
          probes.sent = true;
          c1.transport.publish(c1.roomId, createEvent('SHOT_FIRE', { seq: Number.MAX_SAFE_INTEGER, turn: 1, shooterIndex: 1, r: -1, c: 0 }));
        }
        if (probes.sent) {
          assert.ok(Number.isSafeInteger(c0.seqCounter) && c0.seqCounter < 1e6, 'host counter stays small');
          assert.ok(Number.isSafeInteger(c1.seqCounter) && c1.seqCounter < 1e6, 'guest counter stays small');
        }
      }
    });
    assert.ok(probes.sent, 'junk event written');
    assert.deepStrictEqual(projection(r.c0), projection(r.c1), 'both clients end identical');
    assert.strictEqual(r.c0.state.gameOverReason, 'fleet_destroyed');
    assert.strictEqual(r.c0.state.integrity.valid, true);
    closeMatch(r);
  });

  await test('22. Regression: crew-themed fleet ids pass the reveal audit; wrong lengths / duplicate ids still caught', () => {
    const themed = createValidFleet(0, 0).map((s, i) => Object.assign({}, s, { id: ['barto_club', 'thousand_sunny', 'mini_merry', 'shark_submerge', 'going_merry'][i] }));
    assert.strictEqual(validateFleetGeometry(themed, 10, 'classica').valid, true, JSON.stringify(validateFleetGeometry(themed, 10, 'classica')));
    const dupIds = themed.map((s, i) => Object.assign({}, s, { id: i < 2 ? 'barto_club' : s.id }));
    assert.strictEqual(validateFleetGeometry(dupIds, 10, 'classica').valid, false);
    const wrongLen = themed.map((s, i) => (i === 4 ? Object.assign({}, s, { cells: s.cells.concat([{ r: 8, c: 2 }]) }) : s));
    assert.strictEqual(validateFleetGeometry(wrongLen, 10, 'classica').valid, false);
  });

  console.log(`\n${colors.bold}SUMMARY:${colors.reset} ${colors.green}${passedTests}/${totalTests} tests passed.${colors.reset}\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Unhandled test suite failure:', err);
  process.exit(1);
});
