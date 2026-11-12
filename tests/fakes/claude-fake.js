/**
 * Test double for the published-Artifact runtime: `window.claude.use("db" | "room" | "user")`.
 *
 * Mirrors the surface documented in artifact-capabilities 0.2.96 (claude.d.ts, db.d.ts,
 * room.d.ts, user.d.ts) closely enough to exercise src/net/transport.js:
 *   db:   doc/collection, get/set/update/delete/acquire, where/orderBy/limit, onSnapshot, add
 *   room: join(name) -> emit/on/presence/peers/onPeers/connected/onConnection/leave (+ lobby)
 *   user: id/me/isOwner/canEdit/can/profiles/search/name/avatarUrl/email
 * `use()` never resolves synchronously; a capability switched off resolves null.
 *
 * Access rules: the db `rules` of the publish (opts.rules or hub.rules) and the viewer's level
 * (opts.level) are enforced as db.d.ts describes them; a denied write rejects 'invalid_argument'.
 *
 * Faults (all seeded): write latency, dropped writes (reject 'unavailable', not applied),
 * lost acks (applied, then reject 'unavailable'), duplicated snapshot deliveries, dropped
 * room emits, and kill() to simulate a page refresh (pending calls never settle).
 *
 * Backing store ("hub"): createMemoryHub() for Node, createCrossTabHub() for browser tabs of
 * one origin (localStorage + BroadcastChannel). Test-only: never shipped in the game build.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GLTClaudeFake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- helpers
  function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cryptoRng() {
    const u = new Uint32Array(1);
    globalThis.crypto.getRandomValues(u);
    return u[0] / 4294967296;
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(k => deepFreeze(o[k]));
    }
    return o;
  }
  function depth(v) {
    if (!v || typeof v !== 'object') return 0;
    let d = 0;
    for (const k of Object.keys(v)) d = Math.max(d, depth(v[k]));
    return d + 1;
  }
  function dbError(code, message) { return { code, message }; }
  function randomId(rng, n) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < (n || 20); i++) s += abc[Math.floor(rng() * abc.length)];
    return s;
  }
  function deepMerge(target, patch) {
    const out = clone(target) || {};
    Object.keys(patch).forEach(k => {
      if (isPlainObject(patch[k]) && isPlainObject(out[k])) out[k] = deepMerge(out[k], patch[k]);
      else out[k] = clone(patch[k]);
    });
    return out;
  }
  function jsonBytes(v) {
    const s = JSON.stringify(v);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
  }

  const SEG_RE = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  function checkPath(path, wantDoc) {
    if (typeof path !== 'string' || !path) throw new TypeError('db path must be a non-empty string');
    const segs = path.split('/');
    if (segs.length > 16 || path.length > 1000) throw new TypeError('db path exceeds 16 segments / 1000 bytes');
    for (const s of segs) {
      if (!SEG_RE.test(s) || s === '.' || s === '..') throw new TypeError('db path segment breaks the grammar: "' + s + '"');
    }
    const isDoc = segs.length % 2 === 0;
    if (isDoc !== wantDoc) {
      throw new TypeError('db path "' + path + '" has ' + segs.length + ' segments; a ' +
        (wantDoc ? 'document path needs an even' : 'collection path needs an odd') + ' count');
    }
    return segs;
  }
  function parentOf(path) { return path.slice(0, path.lastIndexOf('/')); }

  // ---------------------------------------------------------------- access rules
  // db.d.ts ACCESS RULES: each rule sets the minimum level per action at its path and below; a
  // deeper rule overrides, a missing field inherits; the root defaults to read view / write
  // interact; `{self}` (last segment) matches only the viewer's own id, so on someone else's
  // subtree only the prefix rule applies; the level `self` is held by nobody.
  const LEVELS = { view: 1, interact: 2, admin: 3, owner: 4, self: 99 };
  function requiredLevel(rules, path, action, userId) {
    const segs = path.split('/');
    const matched = [];
    (rules || []).forEach(r => {
      const rs = r.path ? r.path.split('/') : [];
      if (rs.length > segs.length) return;
      for (let i = 0; i < rs.length; i++) {
        if (rs[i] === '{self}') { if (!userId || segs[i] !== userId) return; } else if (rs[i] !== segs[i]) return;
      }
      matched.push({ depth: rs.length, rule: r });
    });
    matched.sort((a, b) => a.depth - b.depth);
    let level = action === 'read' ? 'view' : 'interact';
    matched.forEach(m => { if (m.rule[action]) level = m.rule[action]; });
    return LEVELS[level] || 99;
  }

  // ---------------------------------------------------------------- hubs
  function createMemoryHub(hubOpts) {
    const docs = new Map();
    const changeFns = new Set();
    const msgFns = new Set();
    const writeLog = [];
    const msgLog = [];
    return {
      kind: 'memory',
      rules: (hubOpts && hubOpts.rules) || null,
      read(path) { const s = docs.get(path); return s === undefined ? undefined : JSON.parse(s); },
      write(path, body) {
        if (body === null) docs.delete(path); else docs.set(path, JSON.stringify(body));
        writeLog.push({ path, body: body === null ? null : clone(body), at: Date.now() });
        changeFns.forEach(fn => fn(path));
      },
      list(collPath) {
        const prefix = collPath + '/';
        const out = [];
        docs.forEach((s, p) => {
          if (p.startsWith(prefix) && p.indexOf('/', prefix.length) === -1) {
            out.push({ id: p.slice(prefix.length), path: p, body: JSON.parse(s) });
          }
        });
        return out;
      },
      onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
      post(msg) { const m = clone(msg); msgLog.push(m); msgFns.forEach(fn => fn(clone(m))); },
      onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
      dump() { return Array.from(docs.entries()).map(([path, s]) => ({ path, body: JSON.parse(s) })); },
      writeLog,
      msgLog
    };
  }

  /**
   * Browser only: every tab of one origin sees the same store. Each tab keeps an in-memory
   * mirror fed by the change messages themselves (they carry the body). Every entry is
   * versioned {v, t, w}; a tab applies only a newer version, and a (re)loaded tab asks the
   * other tabs for their mirrors before its first call settles, because Chrome propagates
   * localStorage between renderer processes asynchronously and a reload can read it stale.
   * Deletions are kept as tombstones so an old copy can never resurrect a document.
   */
  function createCrossTabHub(prefix, hubOpts) {
    const P = (prefix || 'gltfake') + ':doc:';
    const ch = new BroadcastChannel((prefix || 'gltfake') + ':bus');
    const tab = Math.floor(cryptoRng() * 1e9).toString(36);
    const mirror = new Map(); // path -> {v, t, w, s: string|null}
    const newer = (a, b) => !b || a.v > b.v || (a.v === b.v && (a.t > b.t || (a.t === b.t && a.w > b.w)));
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(P) !== 0) continue;
      try { const e = JSON.parse(localStorage.getItem(k)); if (e && typeof e.v === 'number') mirror.set(k.slice(P.length), e); } catch (_) {}
    }
    const changeFns = new Set();
    const msgFns = new Set();
    function accept(path, e) {
      if (!e || !newer(e, mirror.get(path))) return false;
      mirror.set(path, e);
      return true;
    }
    let resolveReady;
    const ready = new Promise(r => { resolveReady = r; });
    setTimeout(() => resolveReady(), 1000);
    ch.onmessage = (ev) => {
      const m = ev && ev.data;
      if (!m) return;
      if (m.k === 'change') {
        if (accept(m.path, m.e)) changeFns.forEach(fn => fn(m.path));
      } else if (m.k === 'sync?') {
        ch.postMessage({ k: 'sync', to: m.from, entries: Array.from(mirror.entries()) });
      } else if (m.k === 'sync' && m.to === tab) {
        const changed = (m.entries || []).filter(([p, e]) => accept(p, e)).map(([p]) => p);
        changed.forEach(p => changeFns.forEach(fn => fn(p)));
        resolveReady();
      } else if (m.k === 'msg') {
        msgFns.forEach(fn => fn(clone(m.msg)));
      }
    };
    ch.postMessage({ k: 'sync?', from: tab });
    function rows() {
      const out = [];
      mirror.forEach((e, p) => { if (e.s !== null) out.push([p, e.s]); });
      return out;
    }
    return {
      kind: 'crosstab',
      rules: (hubOpts && hubOpts.rules) || null,
      ready,
      read(path) { const e = mirror.get(path); return (!e || e.s === null) ? undefined : JSON.parse(e.s); },
      write(path, body) {
        const cur = mirror.get(path);
        // One clock for every tab of the machine: a later write always carries a larger version,
        // even from a reloaded tab whose mirror was stale.
        const now = Date.now();
        const e = { v: Math.max(now, (cur ? cur.v : 0) + 1), t: now, w: tab, s: body === null ? null : JSON.stringify(body) };
        mirror.set(path, e);
        localStorage.setItem(P + path, JSON.stringify(e));
        changeFns.forEach(fn => fn(path));
        ch.postMessage({ k: 'change', path, e });
      },
      list(collPath) {
        const prefix = collPath + '/';
        return rows().filter(([p]) => p.indexOf(prefix) === 0 && p.indexOf('/', prefix.length) === -1)
          .map(([p, s]) => ({ id: p.slice(prefix.length), path: p, body: JSON.parse(s) }));
      },
      onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
      post(msg) { msgFns.forEach(fn => fn(clone(msg))); ch.postMessage({ k: 'msg', msg: clone(msg) }); },
      onMessage(fn) { msgFns.add(fn); return () => msgFns.delete(fn); },
      dump() { return rows().map(([path, s]) => ({ path, body: JSON.parse(s) })); }
    };
  }

  // ---------------------------------------------------------------- db
  function createFakeDb(hub, env) {
    const { rng, faults, stats, life } = env;
    const inFlight = new Map(); // path -> count (detects overlapping writes to one doc)
    const subs = new Set();
    const myLevel = LEVELS[env.level || 'interact'] || 0;
    function canRead(path) { return myLevel >= requiredLevel(env.rules, path, 'read', env.userId); }
    function canWrite(path) { return myLevel >= requiredLevel(env.rules, path, 'write', env.userId); }
    function visible(path) { return canRead(path) ? hub.read(path) : undefined; }
    function denied(path) {
      stats.deniedWrites++;
      return Promise.reject(dbError('invalid_argument', 'fake: ' + path + ' is below the write level the rules set for this viewer'));
    }

    function wait(range) {
      const lo = range[0] || 0, hi = Math.max(lo, range[1] || lo);
      return lo + Math.floor(rng() * (hi - lo + 1));
    }
    function later(fn, ms) {
      const t = setTimeout(() => { if (!life.killed) fn(); }, ms);
      if (t && typeof t.unref === 'function' && env.unref) t.unref();
    }
    function bodyError(data) {
      if (!isPlainObject(data)) return dbError('invalid_argument', 'document body must be a plain object');
      if (jsonBytes(data) > 256 * 1024) return dbError('invalid_argument', 'document over 256 KiB');
      if (depth(data) > 32) return dbError('invalid_argument', 'document deeper than 32 levels');
      return null;
    }
    function writeOp(path, apply) {
      if (life.killed) return new Promise(() => {});
      const n = (inFlight.get(path) || 0) + 1;
      inFlight.set(path, n);
      if (n > 1) stats.overlappingWrites++;
      return new Promise((resolve, reject) => {
        later(() => {
          inFlight.set(path, (inFlight.get(path) || 1) - 1);
          if (rng() < faults.dropWrite) { stats.droppedWrites++; reject(dbError('unavailable', 'fake: write dropped before reaching the store')); return; }
          try { apply(); } catch (e) { reject(e && e.code ? e : dbError('invalid_argument', String(e))); return; }
          stats.writes++;
          if (rng() < faults.lostAck) { stats.lostAcks++; reject(dbError('unavailable', 'fake: write applied but acknowledgement lost')); return; }
          resolve();
        }, wait(faults.latency));
      });
    }
    function readOp(fn) {
      if (life.killed) return new Promise(() => {});
      return new Promise(resolve => later(() => resolve(fn()), wait(faults.latency)));
    }
    const META = Object.freeze({ fromCache: false, hasPendingWrites: false });
    function docSnap(id, body) {
      const frozen = body === undefined ? undefined : deepFreeze(clone(body));
      return Object.freeze({ id, exists: body !== undefined, data: () => frozen, metadata: META });
    }
    function querySnap(rows, changes) {
      const docs = rows.map(r => docSnap(r.id, r.body));
      return Object.freeze({ docs, size: docs.length, empty: docs.length === 0, docChanges: () => changes.slice(), metadata: META });
    }

    function subscribe(target, next, error) {
      if (typeof next !== 'function') throw new TypeError('onSnapshot needs a callback');
      if (subs.size >= 64) {
        Promise.resolve().then(() => error && error(dbError('resource_exhausted', 'fake: 64 subscriptions per view')));
        return () => {};
      }
      const sub = { active: true, pending: false, last: null, error };
      function deliver() {
        if (!sub.active || life.killed) return;
        let snap;
        if (target.kind === 'doc') {
          const body = visible(target.path);
          const key = JSON.stringify(body === undefined ? null : body);
          if (sub.last !== null && sub.last === key) return;
          sub.last = key;
          snap = docSnap(target.id, body);
        } else {
          const rows = target.evaluate();
          const prev = sub.last || new Map();
          const now = new Map(rows.map(r => [r.id, JSON.stringify(r.body)]));
          const changes = [];
          rows.forEach((r, i) => {
            if (!prev.has(r.id)) changes.push({ type: 'added', doc: docSnap(r.id, r.body), oldIndex: -1, newIndex: i });
            else if (prev.get(r.id) !== now.get(r.id)) changes.push({ type: 'modified', doc: docSnap(r.id, r.body), oldIndex: i, newIndex: i });
          });
          prev.forEach((s, id) => {
            if (!now.has(id)) changes.push({ type: 'removed', doc: docSnap(id, JSON.parse(s)), oldIndex: 0, newIndex: -1 });
          });
          if (sub.last && changes.length === 0) return;
          sub.last = now;
          snap = querySnap(rows, changes);
        }
        stats.snapshots++;
        next(snap);
        if (rng() < faults.dupSnapshot) {
          stats.dupSnapshots++;
          later(() => { if (sub.active) next(snap); }, wait(faults.latency));
        }
      }
      function schedule() {
        if (sub.pending) return;
        sub.pending = true;
        later(() => { sub.pending = false; deliver(); }, wait(faults.snapshotLatency || faults.latency));
      }
      const relevant = target.kind === 'doc'
        ? (p) => p === target.path
        : (p) => parentOf(p) === target.collPath;
      const off = hub.onChange(p => { if (relevant(p)) schedule(); });
      sub.stop = () => { sub.active = false; off(); subs.delete(sub); };
      subs.add(sub);
      schedule();
      return () => sub.stop();
    }

    function matches(v, op, x) {
      switch (op) {
        case '==': return v === x;
        case '!=': return v !== x;
        case '<': return v < x;
        case '<=': return v <= x;
        case '>': return v > x;
        case '>=': return v >= x;
        case 'in': return Array.isArray(x) && x.includes(v);
        case 'not-in': return Array.isArray(x) && !x.includes(v);
        case 'array-contains': return Array.isArray(v) && v.includes(x);
        default: throw new TypeError('unsupported operator ' + op);
      }
    }

    function makeQuery(collPath, filters, order, lim) {
      function evaluate() {
        let rows = hub.list(collPath).filter(r => canRead(r.path)).filter(r => filters.every(f => matches(r.body[f.field], f.op, f.value)));
        if (order) {
          const dir = order.dir === 'desc' ? -1 : 1;
          rows.sort((a, b) => {
            const av = a.body[order.field], bv = b.body[order.field];
            if (av === undefined && bv === undefined) return a.id < b.id ? -1 : 1;
            if (av === undefined) return 1;
            if (bv === undefined) return -1;
            return av < bv ? -dir : av > bv ? dir : (a.id < b.id ? -1 : 1);
          });
        } else {
          rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        }
        if (lim) rows = rows.slice(0, lim);
        return rows;
      }
      return {
        where(field, op, value) {
          if (filters.length >= 10) throw new TypeError('at most 10 filters');
          return makeQuery(collPath, filters.concat([{ field, op, value }]), order, lim);
        },
        orderBy(field, dir) {
          if (order) throw new TypeError('at most one orderBy');
          return makeQuery(collPath, filters, { field, dir: dir || 'asc' }, lim);
        },
        limit(n) {
          if (!(n >= 1 && n <= 1000)) throw new TypeError('limit must be 1-1000');
          return makeQuery(collPath, filters, order, n);
        },
        get() { return readOp(() => querySnap(evaluate(), evaluate().map((r, i) => ({ type: 'added', doc: docSnap(r.id, r.body), oldIndex: -1, newIndex: i })))); },
        onSnapshot(next, error) { return subscribe({ kind: 'query', collPath, evaluate }, next, error); }
      };
    }

    function collection(path) {
      checkPath(path, false);
      const q = makeQuery(path, [], null, null);
      return Object.freeze(Object.assign({}, q, {
        path,
        doc(id) { return doc(path + '/' + (id === undefined ? randomId(rng) : id)); },
        add(data) { const ref = doc(path + '/' + randomId(rng)); return ref.set(data).then(() => ref); }
      }));
    }

    function doc(path) {
      const segs = checkPath(path, true);
      const id = segs[segs.length - 1];
      return Object.freeze({
        id,
        path,
        get() { return readOp(() => docSnap(id, visible(path))); },
        set(data) {
          if (!canWrite(path)) return denied(path);
          const e = bodyError(data);
          if (e) return Promise.reject(e);
          const body = clone(data);
          return writeOp(path, () => hub.write(path, body));
        },
        update(data) {
          if (!canWrite(path)) return denied(path);
          const e = bodyError(data);
          if (e) return Promise.reject(e);
          const patch = clone(data);
          return writeOp(path, () => {
            const cur = hub.read(path);
            if (cur === undefined) throw dbError('invalid_argument', 'update() requires an existing document');
            hub.write(path, deepMerge(cur, patch));
          });
        },
        delete() { return canWrite(path) ? writeOp(path, () => hub.write(path, null)) : denied(path); },
        acquire(opts) {
          return readOp(() => ({ acquired: true, version: 1, expiresAt: new Date(Date.now() + 30000).toISOString(), holder: opts && opts.holder }));
        },
        onSnapshot(next, error) { return subscribe({ kind: 'doc', path, id }, next, error); },
        collection(sub) { return collection(path + '/' + sub); }
      });
    }

    const ns = Object.freeze({ doc, collection });
    return {
      ns,
      /** Terminate every live listener with `code` (e.g. 'unavailable' when the host stops answering). */
      breakListeners(code) {
        Array.from(subs).forEach(sub => {
          sub.stop();
          if (typeof sub.error === 'function') sub.error(dbError(code || 'unavailable', 'fake: listener terminated'));
        });
      },
      kill() { Array.from(subs).forEach(sub => sub.stop()); }
    };
  }

  // ---------------------------------------------------------------- room
  const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
  const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

  function createFakeRoom(hub, env) {
    const { rng, faults, life, peerId, userId } = env;
    const rooms = new Map();
    function wait(range) {
      const lo = range[0] || 0, hi = Math.max(lo, range[1] || lo);
      return lo + Math.floor(rng() * (hi - lo + 1));
    }
    function later(fn, ms) { setTimeout(() => { if (!life.killed) fn(); }, ms); }
    function roomError(code, message) { return { code, message }; }

    function makeNamed(name) {
      const st = {
        left: false,
        presence: {},
        peers: new Map(),
        topicFns: new Map(),
        peerFns: new Set(),
        connFns: new Set(),
        snapshot: Object.freeze([])
      };
      function self() {
        return Object.freeze({ peer: peerId, by: userId, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: deepFreeze(clone(st.presence)), updatedAt: Date.now() });
      }
      function rebuild() { st.snapshot = Object.freeze([self()].concat(Array.from(st.peers.values()))); }
      function notify(change) {
        rebuild();
        const full = Object.freeze({ peers: st.snapshot, joined: change.joined || [], left: change.left || [], updated: change.updated || [] });
        st.peerFns.forEach(fn => { try { fn(full); } catch (_) {} });
      }
      function announce(hello) {
        hub.post({ t: 'presence', room: name, peer: peerId, by: userId, presence: st.presence, hello: !!hello });
      }
      function handle(msg) {
        if (st.left || life.killed) return;
        if (msg.t === 'presence') {
          if (msg.peer === peerId) return;
          const p = Object.freeze({
            peer: msg.peer, by: msg.by || null, isMe: !!(userId && msg.by === userId), sameTab: false,
            kind: 'viewer', guest: false, presence: deepFreeze(clone(msg.presence || {})), updatedAt: Date.now()
          });
          const existed = st.peers.has(msg.peer);
          st.peers.set(msg.peer, p);
          notify(existed ? { updated: [p] } : { joined: [p] });
          if (msg.hello) announce(false);
        } else if (msg.t === 'leave') {
          const p = st.peers.get(msg.peer);
          if (p) { st.peers.delete(msg.peer); notify({ left: [p] }); }
        } else if (msg.t === 'emit') {
          const sameTab = msg.peer === peerId;
          if (!sameTab && rng() < faults.emitDrop) { env.stats.droppedEmits++; return; }
          const fns = st.topicFns.get(msg.topic);
          if (!fns) return;
          const m = Object.freeze({
            topic: msg.topic, data: deepFreeze(clone(msg.data)), peer: msg.peer, by: msg.by || null,
            isMe: sameTab || !!(userId && msg.by === userId), sameTab, kind: 'viewer', guest: false
          });
          fns.forEach(fn => { try { fn(m); } catch (_) {} });
        }
      }
      const off = hub.onMessage(msg => {
        if (!msg || msg.room !== name) return;
        later(() => handle(msg), wait(faults.roomLatency || faults.latency));
      });
      function guard() {
        if (life.killed) return Promise.reject(roomError('revoked', 'fake: page gone'));
        if (st.left) return Promise.reject(roomError('invalid_argument', 'fake: room was left'));
        return null;
      }
      const named = Object.freeze({
        name,
        emit(topic, data) {
          const g = guard(); if (g) return g;
          if (!TOPIC_RE.test(String(topic))) return Promise.reject(roomError('invalid_argument', 'topic grammar'));
          if (data !== undefined && jsonBytes(data) > 4096) return Promise.reject(roomError('invalid_argument', 'data over 4 KiB'));
          if (env.deniedTopics && env.deniedTopics.includes(topic)) return Promise.reject(roomError('not_permitted', 'topic not open to this level'));
          hub.post({ t: 'emit', room: name, peer: peerId, by: userId, topic, data: clone(data) });
          return Promise.resolve();
        },
        on(topic, handler, onError) {
          if (typeof handler !== 'function') throw new TypeError('handler must be a function');
          if (!TOPIC_RE.test(String(topic))) {
            Promise.resolve().then(() => onError && onError(roomError('invalid_argument', 'topic grammar')));
            return () => {};
          }
          if (!st.topicFns.has(topic)) st.topicFns.set(topic, new Set());
          const wrapped = (m) => handler(m);
          st.topicFns.get(topic).add(wrapped);
          return () => { const s = st.topicFns.get(topic); if (s) s.delete(wrapped); };
        },
        presence(patch) {
          const g = guard(); if (g) return g;
          if (!isPlainObject(patch)) return Promise.reject(roomError('invalid_argument', 'patch must be an object'));
          const merged = Object.assign({}, st.presence);
          Object.keys(patch).forEach(k => { if (patch[k] === null) delete merged[k]; else merged[k] = clone(patch[k]); });
          if (jsonBytes(merged) > 4096) return Promise.reject(roomError('invalid_argument', 'presence over 4 KiB'));
          st.presence = merged;
          rebuild();
          announce(false);
          return Promise.resolve();
        },
        peers() { return st.snapshot; },
        onPeers(handler, onError) {
          if (typeof handler !== 'function') throw new TypeError('handler must be a function');
          st.peerFns.add(handler);
          Promise.resolve().then(() => {
            if (!st.peerFns.has(handler)) return;
            rebuild();
            handler(Object.freeze({ peers: st.snapshot, joined: st.snapshot, left: [], updated: [] }));
          });
          return () => st.peerFns.delete(handler);
        },
        connected() { return !life.killed && !st.left; },
        onConnection(handler) {
          st.connFns.add(handler);
          Promise.resolve().then(() => st.connFns.has(handler) && handler(!life.killed));
          return () => st.connFns.delete(handler);
        },
        leave() {
          if (st.left) return Promise.resolve();
          st.left = true;
          off();
          rooms.delete(name);
          hub.post({ t: 'leave', room: name, peer: peerId });
          return Promise.resolve();
        }
      });
      rebuild();
      announce(true);
      return named;
    }

    const lobby = makeNamed('__lobby__');
    const ns = Object.freeze({
      join(name) {
        if (life.killed) return Promise.reject(roomError('revoked', 'fake: page gone'));
        if (!NAME_RE.test(String(name))) return Promise.reject(roomError('invalid_argument', 'room name grammar'));
        if (rooms.has(name)) return Promise.resolve(rooms.get(name));
        if (rooms.size >= 16) return Promise.reject(roomError('limit_reached', 'fake: 16 rooms per page'));
        const r = makeNamed(name);
        rooms.set(name, r);
        return new Promise(resolve => later(() => resolve(r), wait(faults.latency)));
      },
      emit: lobby.emit,
      on: lobby.on,
      presence: lobby.presence,
      peers: lobby.peers,
      onPeers: lobby.onPeers,
      connected: lobby.connected,
      onConnection: lobby.onConnection,
      sendToClaudeSession() { return Promise.reject(roomError('claude_unavailable', 'fake')); },
      canSendToClaudeSession() { return Promise.resolve('no_session'); }
    });
    return { ns, rooms };
  }

  // ---------------------------------------------------------------- user
  function createFakeUser(env) {
    const id = env.userId;
    return Object.freeze({
      id: () => Promise.resolve(id),
      me: () => Promise.resolve({ id, name: '', email: null, avatarUrl: null, isOwner: false, canEdit: false }),
      isOwner: () => Promise.resolve(false),
      canEdit: () => Promise.resolve(false),
      can: () => Promise.resolve(env.canWrite === false ? false : null),
      name: () => Promise.resolve(''),
      avatarUrl: () => Promise.resolve(null),
      email: () => Promise.resolve(null),
      profiles: (ids) => Promise.resolve(Object.fromEntries((ids || []).map(x => [x, { id: x, name: '', isMe: x === id }]))),
      search: () => Promise.resolve([])
    });
  }

  // ---------------------------------------------------------------- claude
  /**
   * @param {object} opts
   * @param {object} opts.hub - createMemoryHub() / createCrossTabHub()
   * @param {string|null} [opts.userId]
   * @param {number} [opts.seed] - seeds every fault decision (crypto rng when omitted)
   * @param {object} [opts.faults] - {latency:[min,max], snapshotLatency, roomLatency, dropWrite, lostAck, dupSnapshot, emitDrop}
   * @param {object} [opts.capabilities] - {db, room, user}: false makes use(name) resolve null
   * @param {Array} [opts.rules] - db access rules (default: hub.rules, else the platform defaults)
   * @param {string} [opts.level='interact'] - this viewer's level: view | interact | admin | owner
   * @param {number} [opts.resolveDelayMs=5]
   */
  function createFakeClaude(opts) {
    const o = opts || {};
    const rng = typeof o.seed === 'number' ? mulberry32(o.seed) : cryptoRng;
    const faults = Object.assign({ latency: [0, 0], snapshotLatency: null, roomLatency: null, dropWrite: 0, lostAck: 0, dupSnapshot: 0, emitDrop: 0 }, o.faults || {});
    const stats = { writes: 0, droppedWrites: 0, lostAcks: 0, dupSnapshots: 0, snapshots: 0, droppedEmits: 0, overlappingWrites: 0, deniedWrites: 0 };
    const life = { killed: false };
    const caps = Object.assign({ db: true, room: true, user: true }, o.capabilities || {});
    const env = {
      rng, faults, stats, life,
      userId: o.userId === undefined ? 'user_' + randomId(rng, 10) : o.userId,
      peerId: o.peerId || randomId(rng, 16),
      unref: !!o.unref,
      canWrite: o.canWrite,
      deniedTopics: o.deniedTopics || null,
      level: o.level || 'interact'
    };
    const hub = o.hub || createMemoryHub();
    env.rules = o.rules || hub.rules || null;
    const db = caps.db ? createFakeDb(hub, env) : null;
    const room = caps.room ? createFakeRoom(hub, env) : null;
    const user = caps.user ? createFakeUser(env) : null;
    const namespaces = { db: db && db.ns, room: room && room.ns, user };
    const memo = new Map();
    const claude = Object.freeze({
      use(name) {
        if (memo.has(name)) return memo.get(name);
        const p = Promise.resolve(hub.ready).then(() => new Promise(resolve => {
          setTimeout(() => resolve(Object.prototype.hasOwnProperty.call(namespaces, name) ? (namespaces[name] || null) : null), o.resolveDelayMs === undefined ? 5 : o.resolveDelayMs);
        }));
        if (Object.prototype.hasOwnProperty.call(namespaces, name)) memo.set(name, p);
        return p;
      }
    });
    return {
      claude,
      hub,
      stats,
      faults,
      userId: env.userId,
      peerId: env.peerId,
      setFaults(patch) { Object.assign(faults, patch || {}); },
      breakListeners(code) { if (db) db.breakListeners(code); },
      /** Simulates closing / refreshing the page: listeners stop, pending calls never settle. */
      kill() {
        if (room) Array.from(room.rooms.values()).forEach(r => { try { r.leave(); } catch (_) {} });
        life.killed = true;
        if (db) db.kill();
      }
    };
  }

  return { createFakeClaude, createMemoryHub, createCrossTabHub, mulberry32 };
});
