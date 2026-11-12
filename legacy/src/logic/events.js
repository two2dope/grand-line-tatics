/* GLT.events: synchronous event bus. Area: logic. Contract: ARCHITECTURE.md §7.
 * Implemented by the architect. A throwing listener never stops the others; its error is
 * rethrown asynchronously so it still surfaces (console error / test failure). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const map = new Map(); // type -> Array<fn>

  function on(type, fn) {
    if (typeof fn !== 'function') throw new TypeError('GLT.events.on: listener must be a function');
    let list = map.get(type);
    if (!list) { list = []; map.set(type, list); }
    list.push(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const list = map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) map.delete(type);
  }

  function once(type, fn) {
    const wrap = (payload, t) => { off(type, wrap); fn(payload, t); };
    return on(type, wrap);
  }

  function rethrow(err) {
    setTimeout(() => { throw err; }, 0);
  }

  function emit(type, payload) {
    const list = map.get(type);
    if (list) {
      for (const fn of list.slice()) {
        try { fn(payload, type); } catch (err) { rethrow(err); }
      }
    }
    if (type !== '*') {
      const any = map.get('*');
      if (any) {
        for (const fn of any.slice()) {
          try { fn(payload, type); } catch (err) { rethrow(err); }
        }
      }
    }
  }

  function clear() { map.clear(); }
  function count(type) { const l = map.get(type); return l ? l.length : 0; }

  GLT.events = { on, off, once, emit, clear, count };
})();
