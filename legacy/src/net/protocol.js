/* GLT.protocol: move-log events, ordering, fold, duties, verification. Area: net. Contract: ARCHITECTURE.md §6.
 * STUB (architect). Owner: net builder. Pure and synchronous; SHA-256 digests arrive precomputed in opts.digests. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});
  const ni = (name) => function () { throw new Error('GLT.protocol.' + name + ': not implemented'); };

  const TYPES = ['join', 'seed', 'ready', 'fire', 'tech', 'answer', 'timeout', 'reveal', 'forfeit', 'rematch'];

  // Contract-fixed helpers (implemented, keep):
  function make(author, type, payload, o) {
    return { v: 1, id: author.slot + author.n, n: author.n, seq: o.seq, type, player: author.slot, payload, ts: o.ts };
  }

  function order(events) {
    const byId = new Map();
    for (const ev of events || []) {
      if (!ev || typeof ev.id !== 'string') continue;
      const prev = byId.get(ev.id);
      if (!prev) { byId.set(ev.id, ev); continue; }
      if (JSON.stringify(ev) < JSON.stringify(prev)) byId.set(ev.id, ev);
    }
    return Array.from(byId.values()).sort((a, b) =>
      (a.seq - b.seq) || (a.player < b.player ? -1 : a.player > b.player ? 1 : 0) || (a.n - b.n));
  }

  GLT.protocol = {
    VERSION: 1,
    TYPES,
    make,
    order,
    valid: ni('valid'),               // (ev) -> boolean
    fold: ni('fold'),                 // (events, {local, fleets?, digests?}) -> PvpState
    duties: ni('duties'),             // (state, slot) -> Duty[]
    nextSeq: ni('nextSeq'),           // (state) -> number
    nextN: ni('nextN'),               // (state, slot) -> number
    publicDigest: ni('publicDigest')  // (state) -> string
  };
})();
