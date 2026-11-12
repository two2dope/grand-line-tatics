/**
 * Grand Line Tactics â€” published-Artifact transport suite.
 *
 * Part A checks that the test double (tests/fakes/claude-fake.js) honours the documented
 * db/room/user contract, so passing tests over it mean something.
 * Part B checks ArtifactDbTransport over the fake, with the publish's db rules enforced:
 * per-author chunked log, idempotent retries, duplicate deliveries, listener recovery, seat
 * binding, lobby, presence/reactions bound to the sender id, pruning, and automatic backend
 * selection (db or user id null -> PvP unavailable).
 */
'use strict';

const assert = require('assert');
const { createFakeClaude, createMemoryHub } = require('./fakes/claude-fake.js');
const T = require('../src/net/transport.js');
const RULES = T.ARTIFACT_CAPABILITIES.db.rules;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(cond, timeoutMs = 3000, label = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('Timed out waiting for ' + label);
    await sleep(5);
  }
}

let passed = 0;
let total = 0;
async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log('  [PASS] ' + name);
  } catch (err) {
    process.exitCode = 1;
    console.error('  [FAIL] ' + name);
    console.error(err);
  }
}

async function makeClient(hub, opts = {}) {
  const fake = createFakeClaude(Object.assign({ hub }, opts));
  const backend = await T.detectTransportBackend({ claude: fake.claude });
  const transport = T.createTransportFor(backend, { retryBaseMs: 5, maxRetryMs: 40, loadTimeoutMs: 2000 });
  return { fake, backend, transport };
}

(async function main() {
  console.log('\n=== ARTIFACT DB/ROOM FAKE + ArtifactDbTransport SUITE ===\n');

  // ------------------------------------------------------------------ Part A
  await test('A1. use() resolves later (never synchronously), is memoized, null when not granted', async () => {
    const fake = createFakeClaude({ hub: createMemoryHub(), capabilities: { room: false } });
    let settled = false;
    const p = fake.claude.use('db');
    p.then(() => { settled = true; });
    await Promise.resolve();
    assert.strictEqual(settled, false, 'use() must not resolve within the first synchronous run');
    assert.strictEqual(fake.claude.use('db'), p, 'use("db") is memoized');
    assert.ok(await p, 'db namespace resolves');
    assert.strictEqual(await fake.claude.use('room'), null, 'disabled capability resolves null');
    assert.strictEqual(await fake.claude.use('nope'), null, 'unknown name resolves null');
    assert.deepStrictEqual(Object.keys(fake.claude), ['use'], 'window.claude carries only use');
    assert.ok(Object.isFrozen(await p), 'namespace is frozen');
  });

  await test('A2. Path grammar: builders throw TypeError synchronously', async () => {
    const db = await createFakeClaude({ hub: createMemoryHub() }).claude.use('db');
    assert.throws(() => db.doc('rooms'), TypeError);
    assert.throws(() => db.collection('rooms/ABCDE'), TypeError);
    assert.throws(() => db.doc('rooms/a b'), TypeError);
    assert.throws(() => db.doc('rooms/..'), TypeError);
    assert.strictEqual(db.doc('rooms/ABCDE').collection('log').path, 'rooms/ABCDE/log');
  });

  await test('A3. set/update/delete semantics (update needs an existing doc, merges nested objects)', async () => {
    const db = await createFakeClaude({ hub: createMemoryHub() }).claude.use('db');
    const ref = db.doc('rooms/ABCDE');
    await assert.rejects(ref.update({ status: 'closed' }), e => e.code === 'invalid_argument');
    await assert.rejects(ref.set([1, 2]), e => e.code === 'invalid_argument');
    await ref.set({ a: { x: 1, y: 2 }, list: [1, 2] });
    await ref.update({ a: { y: 3 }, list: [9] });
    const snap = await ref.get();
    assert.deepStrictEqual(snap.data(), { a: { x: 1, y: 3 }, list: [9] });
    assert.ok(Object.isFrozen(snap.data()), 'snapshot bodies are frozen');
    await ref.delete();
    await ref.delete();
    assert.strictEqual((await ref.get()).exists, false);
  });

  await test('A4. Query onSnapshot: first delivery all-added, then live changes; where/orderBy/limit', async () => {
    const hub = createMemoryHub();
    const a = await createFakeClaude({ hub, faults: { latency: [1, 5] } }).claude.use('db');
    const b = await createFakeClaude({ hub, faults: { latency: [1, 5] } }).claude.use('db');
    await a.doc('bounties/p1').set({ bounty: 10 });
    const seen = [];
    const off = b.collection('bounties').orderBy('bounty', 'desc').limit(2).onSnapshot(s => seen.push(s));
    await until(() => seen.length >= 1, 1000, 'first snapshot');
    assert.deepStrictEqual(seen[0].docChanges().map(c => c.type), ['added']);
    await a.doc('bounties/p2').set({ bounty: 30 });
    await a.doc('bounties/p3').set({ bounty: 20 });
    await until(() => seen.length && seen[seen.length - 1].docs.map(d => d.id).join() === 'p2,p3', 1000, 'ordered window');
    off();
    const open = await b.collection('bounties').where('bounty', '>=', 20).get();
    assert.strictEqual(open.size, 2);
  });

  await test('A5. Room: join(name) is shared, presence reaches others, emit echoes sameTab', async () => {
    const hub = createMemoryHub();
    const ra = await createFakeClaude({ hub, userId: 'ua' }).claude.use('room');
    const rb = await createFakeClaude({ hub, userId: 'ub' }).claude.use('room');
    const na = await ra.join('glt-abcde');
    assert.strictEqual(await ra.join('glt-abcde'), na, 'same name -> same object');
    await assert.rejects(ra.join('Bad Name'), e => e.code === 'invalid_argument');
    const nb = await rb.join('glt-abcde');
    const peersSeen = [];
    nb.onPeers(c => peersSeen.push(c));
    const msgsA = [];
    const msgsB = [];
    na.on('reaction', m => msgsA.push(m));
    nb.on('reaction', m => msgsB.push(m));
    await na.presence({ pi: 0, hb: 1 });
    await until(() => peersSeen.some(c => c.updated.concat(c.joined).some(p => !p.sameTab && p.presence.pi === 0)), 1000, 'presence');
    await na.emit('reaction', { r: 'gg' });
    await until(() => msgsA.length === 1 && msgsB.length === 1, 1000, 'emit delivery');
    assert.strictEqual(msgsA[0].sameTab, true);
    assert.strictEqual(msgsB[0].sameTab, false);
    assert.strictEqual(msgsB[0].by, 'ua');
    await assert.rejects(na.emit('Bad:topic', {}), e => e.code === 'invalid_argument');
  });

  await test('A6. Faults: dropped write is not applied; lost ack is applied; kill() freezes the page', async () => {
    const hub = createMemoryHub();
    const f = createFakeClaude({ hub, seed: 7, faults: { dropWrite: 1 } });
    const db = await f.claude.use('db');
    await assert.rejects(db.doc('x/1').set({ v: 1 }), e => e.code === 'unavailable');
    assert.strictEqual(hub.read('x/1'), undefined);
    f.setFaults({ dropWrite: 0, lostAck: 1 });
    await assert.rejects(db.doc('x/1').set({ v: 2 }), e => e.code === 'unavailable');
    assert.deepStrictEqual(hub.read('x/1'), { v: 2 });
    f.kill();
    let settled = false;
    db.doc('x/1').set({ v: 3 }).then(() => { settled = true; }, () => { settled = true; });
    await sleep(30);
    assert.strictEqual(settled, false, 'calls from a killed page never settle');
    assert.deepStrictEqual(hub.read('x/1'), { v: 2 });
  });

  await test('A7. Access rules: the publish rules are enforced (moves/{self} per author, rooms open, root admin, view never writes)', async () => {
    const hub = createMemoryHub({ rules: RULES });
    const a = await createFakeClaude({ hub, userId: 'ua' }).claude.use('db');
    const b = await createFakeClaude({ hub, userId: 'ub' }).claude.use('db');
    const viewer = await createFakeClaude({ hub, userId: 'uv', level: 'view' }).claude.use('db');
    const owner = await createFakeClaude({ hub, userId: 'uo', level: 'owner' }).claude.use('db');
    await a.doc('moves/ua/ROOM1/c0000').set({ events: [] });
    await a.doc('moves/ua').set({ rooms: [] });
    await assert.rejects(b.doc('moves/ua/ROOM1/c0000').set({ events: [{ forged: true }] }), e => e.code === 'invalid_argument');
    await assert.rejects(b.doc('moves/ua/ROOM1/c0001').set({ events: [] }), e => e.code === 'invalid_argument');
    await assert.rejects(b.doc('moves/ua/ROOM1/c0000').delete(), e => e.code === 'invalid_argument');
    assert.strictEqual((await b.doc('moves/ua/ROOM1/c0000').get()).exists, true, 'everyone reads every author');
    await b.doc('rooms/ROOM1').set({ status: 'open' });
    await assert.rejects(b.doc('other/x').set({ v: 1 }), e => e.code === 'invalid_argument');
    await assert.rejects(viewer.doc('rooms/ROOM1').update({ guest: 'uv' }), e => e.code === 'invalid_argument');
    await assert.rejects(viewer.doc('moves/uv/ROOM1/c0000').set({ events: [] }), e => e.code === 'invalid_argument');
    assert.strictEqual((await viewer.collection('moves/ua/ROOM1').get()).size, 1, 'view-level spectators read the log');
    await owner.doc('moves/ua/ROOM1/c0000').delete(); // the owner can moderate
    assert.strictEqual(hub.read('moves/ua/ROOM1/c0000'), undefined);
  });

  // ------------------------------------------------------------------ Part B
  const RULES_HUB = () => createMemoryHub({ rules: RULES });
  /** Host `ua` creates CODE, guest `ub` joins; resolves once both see the seat binding. */
  async function seatedPair(hub, code, optsA = {}, optsB = {}) {
    const A = await makeClient(hub, Object.assign({ seed: 101, userId: 'ua' }, optsA));
    A.transport.publish(code, { eventId: 'created', type: 'ROOM_CREATED', roomId: code, hostId: 'ua', hostNickname: 'Luffy', crewId: 'straw_hats', matchConfig: { boardId: 'classica', boardSize: 10, mode: 'classico' } });
    await A.transport.whenIdle();
    const B = await makeClient(hub, Object.assign({ seed: 102, userId: 'ub' }, optsB));
    await B.transport.readAsync(code);
    B.transport.publish(code, { eventId: 'joined', type: 'ROOM_JOINED', roomId: code, guestId: 'ub', role: 'player' });
    await until(() => B.transport.feeds.get(code).guestUid === 'ub' && A.transport.feeds.get(code).guestUid === 'ub', 4000, 'seat binding');
    return { A, B };
  }

  await test('B1. Backend selection: db -> artifactDb; db null -> PvP indisponível; no user id -> indisponível; no host -> BroadcastChannel', async () => {
    const hub = createMemoryHub();
    const withDb = await T.detectTransportBackend({ claude: createFakeClaude({ hub }).claude });
    assert.strictEqual(withDb.kind, 'artifactDb');
    const noDb = await T.detectTransportBackend({ claude: createFakeClaude({ hub, capabilities: { db: false } }).claude });
    assert.strictEqual(noDb.kind, 'none');
    assert.strictEqual(noDb.reason, 'db_unavailable');
    assert.strictEqual(T.createTransportFor(noDb), null, 'no transport when db is null');
    const noUser = await T.detectTransportBackend({ claude: createFakeClaude({ hub, capabilities: { user: false } }).claude });
    assert.strictEqual(noUser.kind, 'none');
    assert.strictEqual(noUser.reason, 'identity_unavailable', 'moves are authored by user id: none, no online play');
    const local = await T.detectTransportBackend({ BroadcastChannel: function () {} });
    assert.strictEqual(local.kind, 'broadcastChannel');
    const lan = await T.detectTransportBackend({ __GLT_LAN_CONFIG__: { enabled: true } });
    assert.strictEqual(lan.kind, 'lanRelay');
  });

  await test('B2. Move log layout: moves/{uid}/{CODE}/cNNNN chunks, each event exactly once despite drops + lost acks', async () => {
    const hub = RULES_HUB();
    const A = await makeClient(hub, { seed: 11, userId: 'ua', faults: { latency: [1, 6], dropWrite: 0.3, lostAck: 0.3 } });
    A.transport.publish('ABCDE', { eventId: 'created', type: 'ROOM_CREATED', roomId: 'ABCDE', hostId: 'ua', matchConfig: { boardSize: 10, mode: 'classico' } });
    for (let i = 0; i < 70; i++) {
      A.transport.publish('ABCDE', { eventId: 'evt_' + i, type: 'SHOT_FIRE', seq: i + 1, shooterIndex: 0, r: i % 10, c: 0 });
    }
    A.transport.publish('ABCDE', { eventId: 'evt_3', type: 'SHOT_FIRE', seq: 4, shooterIndex: 0, r: 3, c: 0 }); // re-publish: ignored
    await A.transport.whenIdle();
    const chunks = hub.list('moves/ua/ABCDE').sort((x, y) => x.body.k - y.body.k);
    assert.deepStrictEqual(chunks.map(c => c.id), ['c0000', 'c0001']);
    const ids = chunks.flatMap(c => c.body.events.map(e => e.eventId));
    assert.strictEqual(ids.length, 71, 'every event once');
    assert.strictEqual(new Set(ids).size, 71);
    assert.strictEqual(hub.read('rooms/ABCDE').by, 'ua', 'listing names its host');
    assert.ok(hub.read('moves/ua').rooms.some(e => e.c === 'ABCDE' && e.h === true), 'room indexed for pruning');
    assert.ok(A.fake.stats.droppedWrites + A.fake.stats.lostAcks > 0, 'faults were injected');
    assert.strictEqual(A.fake.stats.overlappingWrites, 0, 'one write at a time per doc');
    assert.strictEqual(A.fake.stats.deniedWrites, 0);
    A.transport.destroy();
  });

  await test('B3. Guest and spectator receive each event once despite duplicate snapshots, stamped with the author seat', async () => {
    const hub = RULES_HUB();
    const { A, B } = await seatedPair(hub, 'QWERT', { faults: { latency: [1, 8] } }, { faults: { latency: [1, 8], dupSnapshot: 0.8 } });
    const got = [];
    B.transport.subscribe('QWERT', ev => got.push(ev));
    for (let i = 0; i < 10; i++) A.transport.publish('QWERT', { eventId: 'e' + i, type: 'CREW_SELECTED', playerIndex: 0, crewId: 'x' });
    await A.transport.whenIdle();
    await until(() => got.filter(e => /^e\d$/.test(e.eventId)).length >= 10, 2000, 'all events');
    await sleep(60);
    const mine = got.filter(e => /^e\d$/.test(e.eventId));
    assert.strictEqual(mine.length, 10, 'no duplicates');
    assert.ok(mine.every(e => e._seat === 0), 'author seat comes from the path');
    assert.ok(B.fake.stats.dupSnapshots > 0, 'duplicate deliveries were injected');
    const spec = await makeClient(hub, { seed: 23, userId: 'us', level: 'view' });
    const log = await spec.transport.readAsync('QWERT');
    assert.ok(log.some(e => e.type === 'ROOM_JOINED' && e._seat === 1), 'spectator sees the guest log');
    assert.strictEqual(log.filter(e => /^e\d$/.test(e.eventId)).length, 10, 'late joiner replays the whole log');
    assert.ok(!log.some(e => e.type === 'SEAT_BIND'), 'binding is transport-internal');
    [A, B, spec].forEach(c => c.transport.destroy());
  });

  await test('B4. Listener terminated with "unavailable" -> fresh onSnapshot recovers, nothing lost', async () => {
    const hub = RULES_HUB();
    const { A, B } = await seatedPair(hub, 'ZXCVB');
    const got = [];
    B.transport.subscribe('ZXCVB', ev => got.push(ev.eventId));
    A.transport.publish('ZXCVB', { eventId: 'one', type: 'CREW_SELECTED', playerIndex: 0 });
    await until(() => got.includes('one'), 2000, 'first');
    B.fake.breakListeners('unavailable');
    A.transport.publish('ZXCVB', { eventId: 'two', type: 'CREW_SELECTED', playerIndex: 0 });
    await until(() => got.includes('two'), 4000, 'recovered listener');
    assert.deepStrictEqual(got.filter(x => x === 'one' || x === 'two'), ['one', 'two']);
    A.transport.destroy();
    B.transport.destroy();
  });

  await test('B5. Lobby: newest first; a room leaves "Partida rápida" when the guest is seated (not a close); clear closes only mine', async () => {
    const hub = RULES_HUB();
    const now = Date.now();
    const seedDb = await createFakeClaude({ hub, userId: 'old' }).claude.use('db');
    for (let i = 0; i < 55; i++) {
      await seedDb.doc('rooms/OLD' + String(i).padStart(2, '0')).set({ id: 'OLD', status: 'open', timestamp: now - 60000 - i, by: 'old', host: 'x' });
    }
    // Flood dated in the future: would otherwise sit at the top of the newest-first window forever
    for (let i = 0; i < 55; i++) {
      await seedDb.doc('rooms/FUT' + String(i).padStart(2, '0')).set({ id: 'FUT', status: 'open', timestamp: now + 86400000 + i, by: 'old', host: 'x' });
    }
    const L = await makeClient(hub, { seed: 41, userId: 'uL' });
    const evL = [];
    L.transport.subscribe('glt_open_rooms', ev => evL.push(ev));
    const { A, B } = await seatedPair(hub, 'AAAAA');
    await until(() => evL.some(e => e.id === 'AAAAA' && !e.type), 3000, 'fresh room listed despite 55 older and 55 future-dated ones');
    assert.ok(!evL.some(e => /^FUT/.test(e.id || '')), 'future-dated rooms never listed');
    await until(() => evL.some(e => e.type === 'ROOM_DELETED' && e.id === 'AAAAA'), 3000, 'room left the lobby');
    assert.strictEqual(evL.find(e => e.type === 'ROOM_DELETED' && e.id === 'AAAAA').reason, 'started');
    assert.strictEqual(hub.read('rooms/AAAAA').status, 'playing');
    const C = await makeClient(hub, { seed: 43, userId: 'uc' });
    C.transport.publish('BBBBB', { eventId: 'cb', type: 'ROOM_CREATED', roomId: 'BBBBB', hostId: 'uc', matchConfig: {} });
    C.transport.publish('glt_open_rooms', { id: 'BBBBB', host: 'Zoro', crewId: 'x', format: '10x10', mode: 'classico', timestamp: Date.now() });
    await C.transport.whenIdle();
    await until(() => L.transport.read('glt_open_rooms').some(r => r.id === 'BBBBB'), 2000, 'listed');
    L.transport.clearOpenRooms();
    C.transport.clearOpenRooms();
    await L.transport.whenIdle();
    await C.transport.whenIdle();
    assert.strictEqual(hub.read('rooms/BBBBB').status, 'closed', 'my room closed');
    assert.strictEqual(hub.read('rooms/OLD00').status, 'open', "someone else's room untouched");
    C.transport.deleteRoom('ZZZZZ'); // absent doc: update rejects invalid_argument, silently ignored
    await C.transport.whenIdle();
    assert.strictEqual(C.transport.lastError, null);
    [L, A, B, C].forEach(c => c.transport.destroy());
  });

  await test('B6. Room capability: heartbeat via presence, reactions via emit, both bound to the seated sender id; never written to db', async () => {
    const hub = RULES_HUB();
    const { A, B } = await seatedPair(hub, 'HBHBH');
    const evB = [];
    B.transport.subscribe('HBHBH', ev => evB.push(ev));
    A.transport.subscribe('HBHBH', () => {});
    A.transport.heartbeat('HBHBH', { playerId: 'pA', playerIndex: 0, status: 'online' });
    await until(() => evB.some(e => e.type === 'HEARTBEAT' && e.playerIndex === 0 && e.playerId === 'pA'), 2000, 'presence heartbeat');
    A.transport.publish('HBHBH', { eventId: 'reaction_1', type: 'REACTION', playerIndex: 0, reactionId: 'gg' });
    await until(() => evB.some(e => e.type === 'REACTION' && e.reactionId === 'gg' && e._seat === 0), 2000, 'reaction');
    await A.transport.whenIdle();
    assert.ok(!hub.list('moves/ua/HBHBH').some(d => d.body.events.some(e => e.type === 'REACTION' || e.type === 'HEARTBEAT')), 'presence/reactions never hit the db');
    // A third party in the same room claiming seat 0 (or 7) is ignored: `by` is not the host's id
    const R = await createFakeClaude({ hub, userId: 'evil' }).claude.use('room');
    const n = await R.join('glt-hbhbh');
    await n.presence({ pi: 0, pid: 'evil' });
    await n.presence({ pi: 7, pid: 'evil7' });
    await n.emit('reaction', { pi: 0, r: 'gg', e: 'evil_reaction' });
    await sleep(60);
    assert.ok(!evB.some(e => e.playerId === 'evil' || e.playerId === 'evil7' || e.eventId === 'evil_reaction'));
    A.transport.destroy();
    B.transport.destroy();
  });

  await test('B7. Reaction falls back to my durable log when the topic is not open to this viewer', async () => {
    const hub = RULES_HUB();
    const A = await makeClient(hub, { seed: 61, userId: 'ua', deniedTopics: ['reaction'] });
    A.transport.publish('NOPER', { eventId: 'c', type: 'ROOM_CREATED', roomId: 'NOPER', hostId: 'ua', matchConfig: {} });
    A.transport.subscribe('NOPER', () => {});
    A.transport.publish('NOPER', { eventId: 'reaction_x', type: 'REACTION', playerIndex: 0, reactionId: 'gg' });
    await until(() => hub.list('moves/ua/NOPER').some(d => d.body.events.some(e => e.eventId === 'reaction_x')), 2000, 'fallback write');
    A.transport.destroy();
  });

  await test('B8. Terminal store errors surface to the page instead of retrying forever', async () => {
    const hub = createMemoryHub();
    const statuses = [];
    const fake = createFakeClaude({ hub });
    const db = await fake.claude.use('db');
    const quotaDb = Object.freeze({
      collection: db.collection,
      doc: (p) => Object.assign({}, db.doc(p), { set: () => Promise.reject({ code: 'quota_exceeded', message: 'full' }) })
    });
    const t = new T.ArtifactDbTransport({ db: quotaDb, userId: 'uq', onStatus: (k, d) => statuses.push([k, d && d.code]) });
    t.publish('QUOTA', { eventId: 'q1', type: 'ROOM_CREATED', roomId: 'QUOTA', matchConfig: {} });
    await t.whenIdle();
    assert.deepStrictEqual(statuses[statuses.length - 1], ['error', 'quota_exceeded']);
    t.destroy();
  });

  await test('B9. Pruning: my matches older than the window are deleted (chunks + my listing) when I start a new one', async () => {
    const hub = RULES_HUB();
    const A = await makeClient(hub, { seed: 71, userId: 'ua' });
    A.transport.publish('OLDRM', { eventId: 'c1', type: 'ROOM_CREATED', roomId: 'OLDRM', matchConfig: {} });
    A.transport.publish('OLDRM', { eventId: 'x1', type: 'CREW_SELECTED', playerIndex: 0, crewId: 'x' });
    await A.transport.whenIdle();
    assert.ok(hub.read('moves/ua/OLDRM/c0000') && hub.read('rooms/OLDRM'));
    A.transport.destroy();
    const A2 = await makeClient(hub, { seed: 72, userId: 'ua' });
    A2.transport.pruneAfterMs = 0; // everything already finished counts as old
    await sleep(5);
    A2.transport.publish('NEWRM', { eventId: 'c2', type: 'ROOM_CREATED', roomId: 'NEWRM', matchConfig: {} });
    await A2.transport.whenIdle();
    assert.strictEqual(hub.read('moves/ua/OLDRM/c0000'), undefined, 'old chunks deleted');
    assert.strictEqual(hub.read('rooms/OLDRM'), undefined, 'old listing deleted');
    assert.ok(hub.read('moves/ua/NEWRM/c0000'), 'current match kept');
    assert.deepStrictEqual(hub.read('moves/ua').rooms.map(e => e.c), ['NEWRM']);
    A2.transport.destroy();
  });

  await test('B10. Seat binding: the host binds the first guest; a second claimant is told the seat is taken; a refreshed host keeps its binding', async () => {
    const hub = RULES_HUB();
    const { A, B } = await seatedPair(hub, 'SEATS');
    const statuses = [];
    const fakeC = createFakeClaude({ hub, userId: 'uc', seed: 81 });
    const backend = await T.detectTransportBackend({ claude: fakeC.claude });
    const C = T.createTransportFor(backend, { retryBaseMs: 5, onStatus: (k, d) => statuses.push([k, d && d.key]) });
    await C.readAsync('SEATS');
    C.publish('SEATS', { eventId: 'joinedC', type: 'ROOM_JOINED', roomId: 'SEATS', guestId: 'uc', role: 'player' });
    assert.deepStrictEqual(statuses.find(s => s[0] === 'seat_taken'), ['seat_taken', 'SEATS']);
    await C.whenIdle();
    // the listing is rewritten by anyone; a refreshed host still trusts only its own SEAT_BIND
    await (await fakeC.claude.use('db')).doc('rooms/SEATS').update({ guest: 'uc' });
    A.fake.kill();
    A.transport.destroy();
    const A2 = await makeClient(hub, { seed: 82, userId: 'ua' });
    A2.transport.pinRoomHost('SEATS', 'ua');
    await A2.transport.readAsync('SEATS');
    await sleep(40);
    assert.strictEqual(A2.transport.feeds.get('SEATS').guestUid, 'ub');
    [A2, B].forEach(c => c.transport.destroy());
    C.destroy();
  });

  console.log('\nSUMMARY: ' + passed + '/' + total + ' tests passed.');
  if (passed !== total) process.exitCode = 1;
  setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
