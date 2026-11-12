// Critic probe (stage 5 "online"): hostile writes against ArtifactDbTransport over the db/room fake.
'use strict';
const path = require('path');
const R = (p) => require(path.join(__dirname, '..', '..', p));
const T = R('src/net/transport.js');
const P = R('src/logic/protocol.js');
const { createFakeClaude, createMemoryHub } = R('tests/fakes/claude-fake.js');
const { createEvent, generateSalt, PvpMatchClient, foldMatchLog } = P;

const nap = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await nap(5); } return true; }

function fleet(oc) {
  const mk = (id, len, r) => ({ id, name: id, length: len, r, c: oc, horizontal: true, cells: Array.from({ length: len }, (_, i) => ({ r, c: oc + i })) });
  return [mk('moby_dick', 5, 0), mk('thousand_sunny', 4, 2), mk('red_force', 3, 4), mk('polar_tang', 3, 6), mk('going_merry', 2, 8)];
}

async function client(hub, seed, uid) {
  const fake = createFakeClaude({ hub, seed, userId: uid, faults: { latency: [1, 4] } });
  const backend = await T.detectTransportBackend({ claude: fake.claude });
  const tr = T.createTransportFor(backend, { retryBaseMs: 5, maxRetryMs: 30 });
  const db = await fake.claude.use('db');
  return { fake, tr, db };
}

async function setup(roomId) {
  const hub = createMemoryHub();
  const cfg = { boardId: 'classica', boardSize: 10, mode: 'classico', firstTurn: 0, seed: 'glt_pvp_' + roomId };
  const f0 = fleet(0), f1 = fleet(5);
  const A = await client(hub, 11, 'user_a');
  A.tr.publish(roomId, createEvent('ROOM_CREATED', { roomId, hostId: 'user_a', hostNickname: 'Luffy', crewId: 'straw_hats', matchConfig: cfg }));
  const c0 = new PvpMatchClient({ transport: A.tr, roomId, playerId: 'user_a', playerIndex: 0, fleet: f0, salt: generateSalt(), matchConfig: cfg });
  await A.tr.whenIdle();
  const B = await client(hub, 12, 'user_b');
  await B.tr.readAsync(roomId);
  B.tr.publish(roomId, createEvent('ROOM_JOINED', { roomId, guestId: 'user_b', guestNickname: 'Zoro', crewId: 'red_haired', role: 'player' }));
  const c1 = new PvpMatchClient({ transport: B.tr, roomId, playerId: 'user_b', playerIndex: 1, fleet: f1, salt: generateSalt(), matchConfig: cfg });
  await c0.readyUp(); await c1.readyUp();
  await waitFor(() => c0.state.phase === 'playing' && c1.state.phase === 'playing', 5000);
  return { hub, cfg, A, B, c0, c1, f0, f1, roomId };
}
// raw write by the guest's own db namespace, bypassing PvpMatchClient (what any Contributor can do from devtools)
async function rawWrite(X, roomId, id, ev) {
  await X.db.doc('rooms/' + roomId + '/log/' + id).set({ w: 'forger', n: 1, at: Date.now(), u: 'user_b', t: ev.type, ev });
}
function summary(c) { return { phase: c.state.phase, winner: c.state.winner, reason: c.state.gameOverReason, integrity: c.state.integrity && { valid: c.state.integrity.valid, cheater: c.state.integrity.cheaterIndex, msg: c.state.integrity.message } }; }
function done(s) { s.c0.destroy(); s.c1.destroy(); s.A.tr.destroy(); s.B.tr.destroy(); }

(async () => {
  const out = {};
  // P1: guest forges a GAME_OVER saying the host forfeited
  {
    const s = await setup('CRA01');
    const ev = createEvent('GAME_OVER', { seq: 2, turn: 1, winnerIndex: 1, forfeitedBy: 0, reason: 'manual_forfeit' });
    await rawWrite(s.B, s.roomId, 'forged_go', ev);
    await waitFor(() => s.c0.state.phase === 'game_over', 3000);
    await waitFor(() => s.c0.state.integrity && s.c1.state.integrity, 4000);
    out.P1_forgedForfeit = { host: summary(s.c0), guest: summary(s.c1) };
    done(s);
  }
  // P2: shooter (guest) forges the defender's SHOT_ANSWER ("sunk" on water) in the same snapshot as its SHOT_FIRE
  {
    const s = await setup('CRA02');
    // host fires once at water so it is the guest's turn
    s.c0.fireShot(9, 0); // (9,0) is water on guest fleet at c>=5
    await waitFor(() => s.c0.state.currentTurn === 1 && s.c1.state.currentTurn === 1, 3000);
    const seq = s.c1.seqCounter;
    const fire = createEvent('SHOT_FIRE', { seq, turn: s.c1.state.turnNumber, shooterIndex: 1, r: 9, c: 9 });
    fire.eventId = 'forged_fire';
    const ans = createEvent('SHOT_ANSWER', { seq: seq + 1, turn: s.c1.state.turnNumber, defenderIndex: 0, r: 9, c: 9, outcome: 'hit', shipId: 'moby_dick', shipName: 'Moby Dick' });
    ans.eventId = `shot_answer_s${seq}_9_9`;
    await Promise.all([rawWrite(s.B, s.roomId, 'forged_fire_' + seq, fire), rawWrite(s.B, s.roomId, ans.eventId, ans)]);
    await nap(300);
    const host9 = s.c0.state.boards[1].shots['9,9'];
    const store = s.hub.list('rooms/' + s.roomId + '/log').map(d => d.body).filter(b => b.ev && b.ev.type === 'SHOT_ANSWER' && b.ev.r === 9 && b.ev.c === 9);
    s.c1.forfeit();
    await waitFor(() => s.c0.state.integrity && s.c1.state.integrity, 4000);
    out.P2_forgedDefenderAnswer = { hostViewOfCell99: host9 && host9.outcome, answersInStore: store.map(b => ({ w: b.w, outcome: b.ev.outcome })), host: summary(s.c0), guest: summary(s.c1) };
    done(s);
  }
  // P3: guest forges a FLEET_REVEAL in the host's name (garbage fleet) right after a legit game end
  {
    const s = await setup('CRA03');
    const bogus = createEvent('FLEET_REVEAL', { playerIndex: 0, fleet: fleet(0).map(x => Object.assign({}, x, { r: x.r + 1, cells: x.cells.map(c => ({ r: c.r + 1, c: c.c })) })), salt: 'x' });
    bogus.timestamp = Date.now() + 60000;
    await rawWrite(s.B, s.roomId, 'zz_forged_reveal', bogus);
    await nap(100);
    s.c1.forfeit();
    await waitFor(() => s.c0.state.integrity && s.c1.state.integrity, 4000);
    await nap(300);
    out.P3_forgedRevealFramesHost = { host: summary(s.c0), guest: summary(s.c1) };
    done(s);
  }
  // P4: second READY_COMMIT in the host's name with a different commitment (mid-game)
  {
    const s = await setup('CRA04');
    const rc = createEvent('READY_COMMIT', { playerId: 'user_a', playerIndex: 0, crewId: 'straw_hats', commitment: 'deadbeef'.repeat(8) });
    await rawWrite(s.B, s.roomId, 'zz_forged_commit', rc);
    await nap(100);
    s.c1.forfeit();
    await waitFor(() => s.c0.state.integrity && s.c1.state.integrity, 4000);
    out.P4_forgedCommitFramesHost = { host: summary(s.c0), guest: summary(s.c1) };
    done(s);
  }
  // P5: replay an old SHOT_FIRE under a new doc/event id
  {
    const s = await setup('CRA05');
    const f = s.c0.fireShot(0, 5); // hit on guest
    await waitFor(() => s.c0.state.boards[0].shots['0,5'], 3000);
    const rep = Object.assign({}, f, { eventId: 'replay1' });
    await rawWrite(s.B, s.roomId, 'replay1', rep);
    await nap(200);
    out.P5_replay = { hostPending: s.c0.state.pendingShot, guestPending: s.c1.state.pendingShot, turn: [s.c0.state.currentTurn, s.c1.state.currentTurn] };
    done(s);
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
