/**
 * Grand Line Tactics — Seeded PRNG Module (`GLT.rng`)
 * Pure-JS, deterministic pseudo-random number generator (Mulberry32).
 * Works in both headless Node.js and browser environments.
 * NEVER uses Math.random().
 */

(function(root) {
  'use strict';

  /**
   * Deterministic 32-bit unsigned integer hash (FNV-1a).
   * @param {string} str
   * @returns {number} 32-bit unsigned integer
   */
  function hashString(str) {
    if (typeof str !== 'string') {
      str = String(str);
    }
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  /**
   * Raw mulberry32 generator factory.
   * @param {number} seedInt 32-bit unsigned integer
   * @returns {function(): number} function returning float in [0, 1)
   */
  function mulberry32(seedInt) {
    let s = (seedInt >>> 0);
    return function() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Creates a rich deterministic RNG instance with state persistence and branching.
   * @param {number|string} seed Seed value (integer or string)
   * @returns {Object} RNG interface
   */
  function createRng(seed) {
    let state = 0;
    if (typeof seed === 'string') {
      state = hashString(seed);
    } else if (typeof seed === 'number' && !Number.isNaN(seed)) {
      state = seed >>> 0;
    } else {
      state = 0x12345678;
    }

    function next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function nextInt(min, maxInclusive) {
      if (maxInclusive === undefined) {
        maxInclusive = min;
        min = 0;
      }
      min = Math.floor(min);
      maxInclusive = Math.floor(maxInclusive);
      if (maxInclusive < min) {
        const tmp = min;
        min = maxInclusive;
        maxInclusive = tmp;
      }
      return Math.floor(next() * (maxInclusive - min + 1)) + min;
    }

    function nextFloat(min, max) {
      if (max === undefined) {
        max = min;
        min = 0;
      }
      return min + next() * (max - min);
    }

    function pick(arr) {
      if (!arr || arr.length === 0) return undefined;
      return arr[nextInt(0, arr.length - 1)];
    }

    function shuffle(arr) {
      if (!arr || arr.length <= 1) return arr;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = nextInt(0, i);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    }

    function fork(label) {
      const labelHash = label !== undefined ? hashString(String(label)) : 0x5a17b007;
      // Advance state once to perturb parent and mix with label
      const step = (next() * 4294967296) >>> 0;
      const childSeed = (state ^ labelHash ^ step ^ 0x9e3779b9) >>> 0;
      return createRng(childSeed);
    }

    function getState() {
      return state >>> 0;
    }

    function setState(s) {
      state = (s >>> 0);
    }

    return {
      next,
      nextInt,
      nextFloat,
      pick,
      shuffle,
      fork,
      getState,
      setState
    };
  }

  /**
   * Deterministic coin toss from a match seed.
   * Returns 0 (host / player 0) or 1 (guest / CPU / player 1).
   * @param {number|string} matchSeed
   * @returns {number} 0 or 1
   */
  function coinToss(matchSeed) {
    const r = createRng(matchSeed);
    return r.nextInt(0, 1);
  }

  const rngModule = {
    hashString,
    mulberry32,
    createRng,
    coinToss
  };

  // Global export (zero browser-specific identifiers)
  root.GLT = root.GLT || {};
  root.GLT.rng = rngModule;

  // Node.js CommonJS export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = rngModule;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
