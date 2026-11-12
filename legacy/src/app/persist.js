/* GLT.persist: localStorage wrapper; every access is wrapped in try/catch. Area: app. Contract: ARCHITECTURE.md §8.3.
 * Implemented by the architect (owner: app builder). Falls back to an in-memory map when storage is unavailable. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const PREFIX = 'glt.v1.';
  const mem = new Map();
  let failed = false;

  function store() {
    try {
      const s = globalThis.localStorage;
      if (!s) return null;
      return s;
    } catch (e) { return null; }
  }

  function get(key, fallback) {
    const k = PREFIX + key;
    try {
      const s = store();
      const raw = s ? s.getItem(k) : (mem.has(k) ? mem.get(k) : null);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    const k = PREFIX + key;
    let raw;
    try { raw = JSON.stringify(value); } catch (e) { return false; }
    try {
      const s = store();
      if (s) { s.setItem(k, raw); return true; }
    } catch (e) {
      failed = true;
    }
    mem.set(k, raw);
    return false;
  }

  function remove(key) {
    const k = PREFIX + key;
    mem.delete(k);
    try { const s = store(); if (s) s.removeItem(k); } catch (e) { /* ignore */ }
  }

  function keys(prefix) {
    const p = PREFIX + (prefix || '');
    const out = new Set();
    try {
      const s = store();
      if (s) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.indexOf(p) === 0) out.add(k.slice(PREFIX.length)); }
    } catch (e) { /* ignore */ }
    mem.forEach((v, k) => { if (k.indexOf(p) === 0) out.add(k.slice(PREFIX.length)); });
    return Array.from(out);
  }

  GLT.persist = { PREFIX, get, set, remove, keys, failed() { return failed; } };
})();
