/**
 * Grand Line Tactics: WebRTC transport rules (no browser, no network).
 *
 * PeerJS is replaced by an in-memory broker with the same surface the transport uses
 * (Peer: open / connection / error / disconnected, connect, destroy; DataConnection:
 * open / data / close, send). Covers:
 *  - the device that opens a room is its hub: it keeps the log and relays to everyone;
 *  - a guest gets the whole log on arrival and an empty one when the room is not there;
 *  - presence is relayed but never stored;
 *  - the host can refresh and take the room back with its log; the guest reconnects,
 *    also when the old channel never reports that it died;
 *  - only the host closes the room, and the guests are told;
 *  - which pages pick this transport.
 */

'use strict';

const { PeerTransport, PeerHub, PEER_ID_PREFIX, detectTransportBackend } = require('../src/net/transport.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

const tick = (ms = 60) => new Promise(r => setTimeout(r, ms));

// ---- in-memory stand-in for the PeerJS broker ----

function emitter(target) {
  const handlers = {};
  target.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); return target; };
  target.emit = (name, arg) => (handlers[name] || []).slice().forEach(fn => fn(arg));
  return target;
}

function createBroker() {
  const peers = new Map();
  let seq = 0;

  class FakeConn {
    constructor() {
      emitter(this);
      this.open = false;
      this.other = null;
    }
    send(msg) {
      if (!this.open) throw new Error('connection is not open');
      const copy = JSON.parse(JSON.stringify(msg));
      const other = this.other;
      setTimeout(() => { if (other.open) other.emit('data', copy); }, 0);
    }
    close() {
      if (!this.open) return;
      this.open = false;
      const other = this.other;
      setTimeout(() => {
        this.emit('close');
        if (other.open) { other.open = false; other.emit('close'); }
      }, 0);
    }
  }

  class FakePeer {
    constructor(id) {
      emitter(this);
      this.destroyed = false;
      this.conns = [];
      setTimeout(() => {
        if (this.destroyed) return;
        const wanted = id || ('anon-' + (++seq));
        if (peers.has(wanted)) {
          this.emit('error', { type: 'unavailable-id' });
          return;
        }
        this.id = wanted;
        peers.set(wanted, this);
        this.emit('open', wanted);
      }, 0);
    }
    connect(targetId) {
      const mine = new FakeConn();
      setTimeout(() => {
        const target = peers.get(targetId);
        if (!target || target.destroyed) {
          this.emit('error', { type: 'peer-unavailable' });
          return;
        }
        const theirs = new FakeConn();
        mine.other = theirs;
        theirs.other = mine;
        this.conns.push(mine);
        target.conns.push(theirs);
        target.emit('connection', theirs);
        setTimeout(() => {
          mine.open = true;
          theirs.open = true;
          theirs.emit('open');
          mine.emit('open');
        }, 0);
      }, 0);
      return mine;
    }
    reconnect() {}
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.id && peers.get(this.id) === this) peers.delete(this.id);
      this.conns.forEach(c => c.close());
    }
  }

  /** The device disappears without any channel noticing (refresh, lost signal). */
  function vanish(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.destroyed = true;
    peer.conns.forEach(c => { c.send = () => {}; if (c.other) c.other.send = () => {}; });
  }

  return { FakePeer, peers, vanish };
}

function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    size: () => data.size
  };
}

/** One "page": its own hub (broker registration, storage) like one browser tab. */
function page(broker, storage) {
  const hub = new PeerHub({
    loadPeer: () => Promise.resolve(broker.FakePeer),
    storage: storage || memoryStorage(),
    retryMs: 20,
    joinTimeoutMs: 400,
    releaseDelayMs: 10,
    pingMs: 40,
    silenceMs: 200
  });
  return { hub, transport: () => new PeerTransport({ hub }) };
}

let evSeq = 0;
const ev = (type, extra) => Object.assign({ type, eventId: 'e' + (++evSeq), timestamp: Date.now() }, extra || {});
const types = list => list.map(e => e.type).join(',');

async function main() {
  console.log('=== GRAND LINE TACTICS: WEBRTC TRANSPORT RULES ===');

  // ---- 1. room opened by the host, joined by a guest ----
  const broker = createBroker();
  const hostStorage = memoryStorage();
  const hostPage = page(broker, hostStorage);
  const host = hostPage.transport();
  const ROOM = 'AB12C';

  host.publish(ROOM, ev('ROOM_CREATED', { roomId: ROOM }));
  const hostGot = [];
  host.subscribe(ROOM, e => hostGot.push(e));
  await tick();
  check('Host registers on the broker under the room code', broker.peers.has(PEER_ID_PREFIX + ROOM));
  check('Device that opened the room owns it', host.ownsRoom(ROOM) === true);

  const guestPage = page(broker);
  const guest = guestPage.transport();
  const firstLog = await guest.readAsync(ROOM);
  check('Guest receives the room log on arrival', types(firstLog) === 'ROOM_CREATED', types(firstLog));
  check('Guest does not own the room', guest.ownsRoom(ROOM) === false);

  const guestGot = [];
  guest.subscribe(ROOM, e => guestGot.push(e));
  guest.publish(ROOM, ev('ROOM_JOINED', { role: 'player' }));
  await tick();
  check('Guest event reaches the host', hostGot.some(e => e.type === 'ROOM_JOINED'));
  check('Host log keeps the guest event', types(host.read(ROOM)) === 'ROOM_CREATED,ROOM_JOINED', types(host.read(ROOM)));

  host.publish(ROOM, ev('READY_COMMIT', { playerIndex: 0 }));
  await tick();
  check('Host event reaches the guest', guestGot.some(e => e.type === 'READY_COMMIT'));
  check('Publisher hears its own event once', hostGot.filter(e => e.type === 'READY_COMMIT').length === 1);

  // ---- 2. presence ----
  guest.heartbeat(ROOM, { playerId: 'g1' });
  await tick();
  check('Presence is relayed to the host', hostGot.some(e => e.type === 'HEARTBEAT'));
  check('Presence is never stored', !host.read(ROOM).some(e => e.type === 'HEARTBEAT') && !guest.read(ROOM).some(e => e.type === 'HEARTBEAT'));

  // ---- 3. the same event twice ----
  const dup = ev('REACTION', { playerIndex: 1 });
  guest.publish(ROOM, dup);
  guest.publish(ROOM, dup);
  await tick();
  check('A repeated event is delivered once', hostGot.filter(e => e.eventId === dup.eventId).length === 1);

  // ---- 4. third device: the host relays between guests ----
  const watcherPage = page(broker);
  const watcher = watcherPage.transport();
  const watcherLog = await watcher.readAsync(ROOM);
  const watcherGot = [];
  watcher.subscribe(ROOM, e => watcherGot.push(e));
  check('A later device gets everything stored so far', watcherLog.length === host.read(ROOM).length, watcherLog.length + ' vs ' + host.read(ROOM).length);
  guest.publish(ROOM, ev('SHOT_FIRE', { shooterIndex: 1 }));
  await tick();
  check('Host relays one guest to the other', watcherGot.some(e => e.type === 'SHOT_FIRE'));

  // ---- 5. a room that is not there ----
  const strayPage = page(broker);
  const stray = strayPage.transport();
  const none = await stray.readAsync('ZZZZZ');
  check('Unknown room code answers with an empty log', Array.isArray(none) && none.length === 0);
  check('Nothing is left open for the unknown room', !strayPage.hub.rooms.has('ZZZZZ'));

  // ---- 6. host refresh: same storage, new page ----
  const logBefore = host.read(ROOM).length;
  host.destroy();
  hostPage.hub.close(ROOM, false); // the tab goes away without closing the room
  await tick();
  check('Room code is free while the host is away', !broker.peers.has(PEER_ID_PREFIX + ROOM));

  const awayEvent = ev('REACTION', { playerIndex: 1 });
  guest.publish(ROOM, awayEvent); // published with nobody listening

  const hostPage2 = page(broker, hostStorage);
  const host2 = hostPage2.transport();
  const resumed = await host2.readAsync(ROOM);
  check('Returning host recovers its log', resumed.length === logBefore, resumed.length + ' vs ' + logBefore);
  check('Returning host still owns the room', host2.ownsRoom(ROOM) === true);
  const host2Got = [];
  host2.subscribe(ROOM, e => host2Got.push(e));
  await tick(300);
  check('Host takes the room code back', broker.peers.has(PEER_ID_PREFIX + ROOM));
  check('Guest reconnects and delivers what it published meanwhile', host2Got.some(e => e.eventId === awayEvent.eventId));

  host2.publish(ROOM, ev('SHOT_ANSWER', { defenderIndex: 0 }));
  await tick();
  check('Guest hears the host again after the reconnect', guestGot.some(e => e.type === 'SHOT_ANSWER'));

  // ---- 6b. host vanishes and the old channel stays "open" ----
  broker.vanish(PEER_ID_PREFIX + ROOM);
  host2.destroy();
  hostPage2.hub.rooms.forEach(r => { if (r.liveTimer) clearInterval(r.liveTimer); });
  const hostPage3 = page(broker, hostStorage);
  const host3 = hostPage3.transport();
  await host3.readAsync(ROOM);
  const host3Got = [];
  host3.subscribe(ROOM, e => host3Got.push(e));
  await tick(900);
  host3.publish(ROOM, ev('SHOT_FIRE', { shooterIndex: 0 }));
  const silentEvent = ev('SHOT_ANSWER', { defenderIndex: 1 });
  guest.publish(ROOM, silentEvent);
  await tick(200);
  check('Guest notices a silent host and finds it again', guestGot.filter(e => e.type === 'SHOT_FIRE' && e.shooterIndex === 0).length === 1);
  check('Host hears the guest on the new channel', host3Got.some(e => e.eventId === silentEvent.eventId));

  // ---- 7. closing the room ----
  check('Guest cannot close the room', guest.deleteRoom(ROOM) === false);
  await tick();
  check('Room survives a guest trying to close it', broker.peers.has(PEER_ID_PREFIX + ROOM));

  const guestLobby = [];
  guest.subscribe('glt_open_rooms', e => guestLobby.push(e));
  check('Host closes the room', host3.deleteRoom(ROOM) === true);
  await tick(600);
  check('Guests are told the room was closed', guestLobby.some(e => e.type === 'ROOM_DELETED' && e.id === ROOM));
  check('Closed room frees its code', !broker.peers.has(PEER_ID_PREFIX + ROOM));
  check('Closed room is forgotten by the host', host3.ownsRoom(ROOM) === false && host3.read(ROOM).length === 0);

  // ---- 8. room code already held by someone else ----
  const squatter = new broker.FakePeer(PEER_ID_PREFIX + 'TAKEN');
  await tick();
  const lateStatus = [];
  const latePage = page(broker);
  const late = new PeerTransport({ hub: latePage.hub, onStatus: (kind, detail) => lateStatus.push(kind + ':' + (detail && detail.reason)) });
  late.publish('TAKEN', ev('ROOM_CREATED', { roomId: 'TAKEN' }));
  await tick(900);
  check('A taken room code is reported instead of hanging', lateStatus.includes('error:room_code_taken'), lateStatus.join(' '));
  squatter.destroy();

  // ---- 9. no directory ----
  check('Lobby list is empty on this path', late.read('glt_open_rooms').length === 0 && late.clearOpenRooms() === false);

  // ---- 10. which pages pick WebRTC ----
  const rtc = function() {};
  const kindOf = async w => (await detectTransportBackend(w)).kind;
  check('https page without a game server picks WebRTC',
    await kindOf({ RTCPeerConnection: rtc, BroadcastChannel: rtc, location: { protocol: 'https:' } }) === 'peer');
  check('http page keeps the same-browser channel',
    await kindOf({ RTCPeerConnection: rtc, BroadcastChannel: rtc, location: { protocol: 'http:' } }) === 'broadcastChannel');
  check('Wi-Fi server page keeps the Wi-Fi relay',
    await kindOf({ RTCPeerConnection: rtc, __GLT_LAN_CONFIG__: { enabled: true }, location: { protocol: 'https:' } }) === 'lanRelay');
  check('Browser without WebRTC falls back',
    await kindOf({ BroadcastChannel: rtc, location: { protocol: 'https:' } }) === 'broadcastChannel');
  check('Explicit override forces WebRTC',
    await kindOf({ RTCPeerConnection: rtc, BroadcastChannel: rtc, __GLT_NET__: 'peer', location: { protocol: 'http:' } }) === 'peer');

  console.log(`\nRESULTS: ${passed}/${passed + failed} tests passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
