/* GLT.clock: RAF loop, game time, speed/pause/freeze/simulate, game-time timers.
 * Area: render. Contract: ARCHITECTURE.md §10.1. Implemented by the architect (owner: render builder may refine,
 * keeping semantics: dt = 0 when paused/frozen; simulate() is synchronous and deterministic). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  let subs = [];          // {fn, pri, seq}
  let seqN = 0;
  let timers = [];        // {at, fn, id}
  let timerId = 0;
  let t = 0;
  let spd = 1;
  let isPaused = false;
  let isFrozen = false;
  let running = false;
  let last = null;

  function rethrow(err) { setTimeout(() => { throw err; }, 0); }

  function onFrame(fn, priority) {
    const s = { fn, pri: priority || 0, seq: seqN++ };
    subs.push(s);
    subs.sort((a, b) => (a.pri - b.pri) || (a.seq - b.seq));
    return () => { subs = subs.filter((x) => x !== s); };
  }

  function after(sec, fn) {
    const id = ++timerId;
    timers.push({ at: t + Math.max(0, sec), fn, id });
    timers.sort((a, b) => (a.at - b.at) || (a.id - b.id));
    return () => { timers = timers.filter((x) => x.id !== id); };
  }

  function step(dt, realDt) {
    if (dt > 0) t += dt;
    while (timers.length && timers[0].at <= t + 1e-9) {
      const tm = timers.shift();
      try { tm.fn(); } catch (err) { rethrow(err); }
    }
    const list = subs.slice();
    for (const s of list) {
      try { s.fn(dt, t, realDt); } catch (err) { rethrow(err); }
    }
  }

  function frame(now) {
    if (!running) return;
    const realDt = last == null ? 0 : Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const dt = isPaused || isFrozen ? 0 : realDt * spd;
    step(dt, realDt);
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || typeof requestAnimationFrame === 'undefined') return;
    running = true;
    last = null;
    requestAnimationFrame(frame);
  }

  function stop() { running = false; }

  // External driver (the game's own RAF loop, via src/sea/bridge.js): running() is true but no RAF is requested here;
  // the host calls tick(dt, realDt) once per frame instead. dt is already scaled and 0 while the host is paused.
  function drive() { running = true; last = null; }
  function tick(dt, realDt) {
    if (isSimulating) return;
    const d = isFrozen ? 0 : Math.max(0, dt || 0);
    step(d, realDt == null ? d : realDt);
  }

  function setSpeed(x) {
    const v = [0.5, 1, 2, 4].indexOf(x) >= 0 ? x : 1;
    if (v === spd) return;
    spd = v;
    if (GLT.events) GLT.events.emit('speed:changed', { speed: spd });
  }

  function setPaused(b) {
    b = !!b;
    if (b === isPaused) return;
    isPaused = b;
    if (GLT.events) GLT.events.emit('pause:changed', { paused: isPaused });
  }

  function freeze(tt) { isFrozen = true; if (Number.isFinite(tt)) t = tt; }
  function unfreeze() { isFrozen = false; }

  let isSimulating = false;
  function simulate(sec, stepS) {
    const h = stepS > 0 ? stepS : 1 / 60;
    const n = Math.max(0, Math.round(sec / h));
    isSimulating = true;
    try { for (let i = 0; i < n; i++) step(h, h); } finally { isSimulating = false; }
  }

  function realNow() { return typeof performance !== 'undefined' && performance.now ? performance.now() : 0; }

  // Callable for compatibility with the build harness (tools/harness.js defines GLT.clock() = seconds):
  // GLT.clock() === GLT.clock.now() === game time in seconds (frozen at ?t= in demos).
  const clock = function () { return t; };
  GLT.clock = Object.assign(clock, {
    start, stop, drive, tick, onFrame, after, simulate, freeze, unfreeze,
    now() { return t; },
    realNow,
    setSpeed, speed() { return spd; },
    setPaused, paused() { return isPaused; },
    frozen() { return isFrozen; },
    simulating() { return isSimulating; },   // renderer skips drawing while true
    running() { return running; }
  });
})();
