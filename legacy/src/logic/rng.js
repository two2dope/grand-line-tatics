/* GLT.rng: seeded randomness (mulberry32). Area: logic. Contract: ARCHITECTURE.md §5.3.
 * Implemented by the architect. hashString/mix outputs are part of the contract (PvP seeds,
 * reproducible sims): never change their algorithms. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  // FNV-1a 32-bit over UTF-16 code units, then a murmur3 fmix for avalanche.
  function hashString(s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return fmix(h >>> 0);
  }

  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // Order-sensitive combination of numbers and strings into one uint32.
  function mix() {
    let h = 0x9e3779b9;
    for (let i = 0; i < arguments.length; i++) {
      const p = arguments[i];
      const v = typeof p === 'number' && Number.isFinite(p) ? (p >>> 0) ^ Math.floor(p / 4294967296) : hashString(String(p));
      h = fmix((h ^ v) + 0x9e3779b9 + (h << 6) + (h >>> 2));
    }
    return h >>> 0;
  }

  function create(seed) {
    let a = (seed >>> 0) || 0x6d2b79f5;
    const rng = {
      next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(n) { return Math.floor(rng.next() * n); },
      range(lo, hi) { return lo + rng.next() * (hi - lo); },
      chance(p) { return rng.next() < p; },
      pick(arr) { return arr[rng.int(arr.length)]; },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = rng.int(i + 1);
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
      state() { return a >>> 0; },
      fork(label) { return create(mix(a, String(label))); }
    };
    return rng;
  }

  function derive(seed) {
    const parts = [seed >>> 0];
    for (let i = 1; i < arguments.length; i++) parts.push(arguments[i]);
    return create(mix.apply(null, parts));
  }

  function randomSeed() {
    try {
      const c = globalThis.crypto;
      if (c && typeof c.getRandomValues === 'function') {
        const u = new Uint32Array(1);
        c.getRandomValues(u);
        return u[0] >>> 0;
      }
    } catch (e) { /* fall through */ }
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    return mix(Date.now(), now) >>> 0;
  }

  GLT.rng = { create, hashString, mix, derive, randomSeed };
})();
