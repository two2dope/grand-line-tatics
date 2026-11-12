// @after engine.js
/* GLT.engine: pure game reducer, series, answers, views, match log fold, (de)serialisation.
 * Area: logic. Piece: rules-core. Contract: ARCHITECTURE.md §4.1, §5.8.
 * This file is the real engine. It loads after the architect's stub `engine.js` (see the @after line)
 * and replaces GLT.engine with the full implementation; gameSeed/coinToss keep the exact stub formulas.
 * Pure: no DOM, no THREE, no Math.random, no clocks. Never mutates its inputs.
 * Every random draw is GLT.rng.derive(state.seed, label, turnNo, k) with labels 'coin','gust','timeout','observation'. */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const VERSION = 1;
  const ERRORS = ['phase', 'turn', 'pending', 'tried', 'bounds', 'fleet', 'tech', 'used', 'answer'];
  const GUST_DIRS = ['N', 'S', 'E', 'W'];
  const DIR_D = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };
  const ATTACK = { bazooka: true, tremor: true };

  // ---------------------------------------------------------------- helpers
  const B = () => GLT.board;
  const RU = () => GLT.rules;
  const D = () => GLT.data;

  function inB(r, c, n) { return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < n && c < n; }
  function isTried(mark) { return mark === 1 || mark === 2 || mark === 3; }   // 0 unknown and 4 revealed may be fired at
  function isHit(res) { return res === 'acerto' || res === 'afundou'; }

  function emptyStats() {
    return { shots: 0, hits: 0, misses: 0, accuracy: 0, streak: 0, bestStreak: 0, turns: 0, techs: 0, sunk: 0, timeMs: 0 };
  }

  function copyShip(s) {
    const len = D().ships[s.id] ? D().ships[s.id].len : (s.len | 0);
    return { id: String(s.id), r: s.r | 0, c: s.c | 0, dir: s.dir === 'v' ? 'v' : 'h', len };
  }

  // A fleet copy in canonical ship order (GLT.data.shipOrder), so equal fleets serialise equally.
  function normFleet(fleet) {
    const order = D().shipOrder;
    const ships = ((fleet && fleet.ships) || []).map(copyShip)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { format: String(fleet && fleet.format), ships };
  }

  function totalShips(state) { return RU().format(state.rules).ships.length; }
  function afloat(state, p) { return totalShips(state) - state.players[p].sunk.length; }

  function mkPlayer(crew, hidden, n) {
    return {
      crew, hidden: !!hidden, fleet: null, ready: false,
      marks: new Array(n * n).fill(0), markTurn: new Array(n * n).fill(0),
      sunk: [], annotations: [], techUsed: false, vortex: false, stats: emptyStats()
    };
  }

  function clonePlayer(ps) {
    return {
      crew: ps.crew, hidden: ps.hidden, fleet: ps.fleet, ready: ps.ready,
      marks: ps.marks.slice(), markTurn: ps.markTurn.slice(),
      sunk: ps.sunk.slice(), annotations: ps.annotations.slice(),
      techUsed: ps.techUsed, vortex: ps.vortex, stats: Object.assign({}, ps.stats)
    };
  }

  // Same key order as createGame: serialisations of equal states are byte-identical.
  function cloneState(s) {
    return {
      v: s.v, seed: s.seed, rules: s.rules, size: s.size, gameIndex: s.gameIndex,
      phase: s.phase, first: s.first, turn: s.turn, turnNo: s.turnNo, shotsLeft: s.shotsLeft, acted: s.acted,
      gust: s.gust, pending: s.pending,
      players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
      history: s.history.slice(),
      winner: s.winner, endReason: s.endReason
    };
  }

  function rollGust(s) {
    if (RU().seaEffect(s.rules) !== 'gust') return null;
    const rng = GLT.rng.derive(s.seed, 'gust', s.turnNo);
    if (rng.next() >= GLT.C.GUST_P) return null;
    return { dir: GUST_DIRS[rng.int(4)] };
  }

  // ---------------------------------------------------------------- series / game creation
  function gameSeed(seriesSeed, index) { return GLT.rng.mix(seriesSeed >>> 0, 'game', index | 0); }
  function coinToss(seed) { return GLT.rng.derive(seed >>> 0, 'coin').int(2); }

  function normCrews(crews) {
    const order = D().crewOrder;
    const a = crews && D().crews[crews[0]] ? crews[0] : order[0];
    const b = crews && D().crews[crews[1]] ? crews[1] : order[1];
    return [a, b];
  }

  function createSeries(o) {
    o = o || {};
    const rules = RU().normalize(o.rules);
    return {
      seed: (o.seed >>> 0), rules, crews: normCrews(o.crews), target: Math.ceil(rules.series / 2),
      wins: [0, 0], index: 0, games: [], over: false, winner: null
    };
  }

  function createGame(o) {
    o = o || {};
    const rules = RU().normalize(o.rules);
    const n = RU().size(rules);
    const seed = o.seed >>> 0;
    const crews = normCrews(o.crews);
    const hidden = o.hidden || [false, false];
    const first = coinToss(seed);
    return {
      v: VERSION, seed, rules, size: n, gameIndex: o.index | 0,
      phase: 'setup', first, turn: first, turnNo: 0, shotsLeft: 0, acted: 0,
      gust: null, pending: null,
      players: [mkPlayer(crews[0], hidden[0], n), mkPlayer(crews[1], hidden[1], n)],
      history: [],
      winner: null, endReason: null
    };
  }

  // Next game of a series (after recordGame). Returns null when the series is over.
  function nextGame(series, o) {
    if (!series || series.over) return null;
    o = o || {};
    return createGame({ rules: series.rules, seed: gameSeed(series.seed, series.index), index: series.index, crews: series.crews, hidden: o.hidden });
  }

  // ---------------------------------------------------------------- targets / techniques
  function untried(state, shooter) {
    const n = state.size;
    const marks = state.players[1 - shooter].marks;
    const out = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!isTried(marks[r * n + c])) out.push({ r, c });
    return out;
  }

  function randomUntried(state, shooter, k) {
    const cells = untried(state, shooter);
    if (!cells.length) return null;
    return GLT.rng.derive(state.seed, 'timeout', state.turnNo, k | 0).pick(cells);
  }

  // Raw geometry of a technique (no tried filtering), in result order.
  function techGeometry(tech, target, n) {
    const t = target || {};
    if (tech === 'bazooka') return [{ r: t.r, c: t.c }, { r: t.r, c: t.c + 1 }, { r: t.r + 1, c: t.c }, { r: t.r + 1, c: t.c + 1 }];
    if (tech === 'tremor') return [{ r: t.r, c: t.c }, { r: t.r - 1, c: t.c }, { r: t.r + 1, c: t.c }, { r: t.r, c: t.c - 1 }, { r: t.r, c: t.c + 1 }];
    if (tech === 'haki') {
      const out = [];
      for (let r = t.r - 1; r <= t.r + 1; r++) for (let c = t.c - 1; c <= t.c + 1; c++) out.push({ r, c });
      return out;
    }
    if (tech === 'room') {
      const out = [];
      for (let i = 0; i < n; i++) out.push(t.axis === 'row' ? { r: t.index, c: i } : { r: i, c: t.index });
      return out;
    }
    return [];
  }

  function techCells(state, p, tech, target) {
    const n = state.size;
    const marks = state.players[1 - p].marks;
    const cells = techGeometry(tech, target, n).filter((x) => inB(x.r, x.c, n));
    if (ATTACK[tech]) return cells.filter((x) => !isTried(marks[x.r * n + x.c]));
    return cells;
  }

  function targetError(state, p, tech, target) {
    const n = state.size;
    const t = target || {};
    if (tech === 'bazooka') {
      if (!inB(t.r, t.c, n) || t.r > n - 2 || t.c > n - 2) return 'bounds';
      return techCells(state, p, tech, t).length ? null : 'tried';
    }
    if (tech === 'tremor') {
      if (!inB(t.r, t.c, n)) return 'bounds';
      return techCells(state, p, tech, t).length ? null : 'tried';
    }
    if (tech === 'haki') return inB(t.r, t.c, n) ? null : 'bounds';
    if (tech === 'room') {
      if (t.axis !== 'row' && t.axis !== 'col') return 'bounds';
      return Number.isInteger(t.index) && t.index >= 0 && t.index < n ? null : 'bounds';
    }
    return null;   // vortex, observation: no target
  }

  function legalTech(state, p, tech, target) {
    if (!state || state.phase !== 'battle') return 'phase';
    if (p !== state.turn) return 'turn';
    if (state.pending) return 'pending';
    if (!RU().techAllowed(state.rules)) return 'tech';
    if (!D().techniques[tech] || RU().techFor(state.players[p].crew) !== tech) return 'tech';
    if (state.players[p].techUsed) return 'used';
    if (state.acted > 0) return 'tech';   // only as the first action of a turn
    return targetError(state, p, tech, target);
  }

  function normTarget(tech, target) {
    const t = target || {};
    if (tech === 'room') return { axis: t.axis, index: t.index };
    if (tech === 'bazooka' || tech === 'tremor' || tech === 'haki') return { r: t.r, c: t.c };
    return {};
  }

  // ---------------------------------------------------------------- answering
  function shotResults(state, def, fleet, cells) {
    const n = state.size;
    const marks = state.players[def].marks.slice();
    const sunk = new Set(state.players[def].sunk.map((s) => s.id));
    const occ = B().occupancy(fleet, n);
    const byId = {};
    for (const s of fleet.ships) byId[s.id] = s;
    return cells.map(({ r, c }) => {
      const k = r * n + c;
      const id = occ[k];
      if (!id) { marks[k] = 1; return { r, c, result: 'agua' }; }
      marks[k] = 2;
      const ship = byId[id];
      if (!sunk.has(id) && B().shipCells(ship).every((p) => { const m = marks[p.r * n + p.c]; return m === 2 || m === 3; })) {
        sunk.add(id);
        B().shipCells(ship).forEach((p) => { marks[p.r * n + p.c] = 3; });
        return { r, c, result: 'afundou', ship: copyShip(ship) };
      }
      return { r, c, result: 'acerto' };
    });
  }

  function observationPick(state, def, fleet) {
    const n = state.size;
    const ps = state.players[def];
    const sunk = new Set(ps.sunk.map((s) => s.id));
    const cand = [];
    for (const s of fleet.ships) {
      if (sunk.has(s.id)) continue;
      for (const x of B().shipCells(s)) {
        const m = ps.marks[x.r * n + x.c];
        if (m !== 2 && m !== 3) cand.push({ r: x.r, c: x.c });
      }
    }
    if (!cand.length) return null;
    cand.sort((a, b) => a.r - b.r || a.c - b.c);
    return cand[GLT.rng.derive(state.seed, 'observation', state.turnNo).int(cand.length)];
  }

  // Answers state.pending with the DEFENDER's fleet (default: the engine's copy).
  function answer(state, fleet) {
    const pd = state && state.pending;
    if (!pd) return null;
    const def = 1 - pd.p;
    const f = fleet ? normFleet(fleet) : state.players[def].fleet;
    if (!f) return null;
    const n = state.size;
    if (pd.kind === 'fire') return { kind: 'shots', results: shotResults(state, def, f, pd.cells) };
    const t = pd.target || {};
    if (ATTACK[pd.tech]) return { kind: 'tech', result: { tech: pd.tech, r: t.r, c: t.c, shots: shotResults(state, def, f, pd.cells) } };
    if (pd.tech === 'haki') {
      const sunk = new Set(state.players[def].sunk.map((s) => s.id));
      const occ = B().occupancy(f, n);
      const found = pd.cells.some((x) => { const id = occ[x.r * n + x.c]; return !!id && !sunk.has(id); });
      return { kind: 'tech', result: { tech: 'haki', r: t.r, c: t.c, found } };
    }
    if (pd.tech === 'room') {
      const occ = B().occupancy(f, n);
      const count = pd.cells.reduce((a, x) => a + (occ[x.r * n + x.c] ? 1 : 0), 0);
      return { kind: 'tech', result: { tech: 'room', axis: t.axis, index: t.index, count } };
    }
    if (pd.tech === 'observation') return { kind: 'tech', result: { tech: 'observation', cell: observationPick(state, def, f) } };
    return null;
  }

  // Validate a shot list from the defender (shape + consistency with public marks). Returns normalised results or null.
  function checkShots(state, def, cells, results) {
    if (!Array.isArray(results) || results.length !== cells.length) return null;
    const n = state.size;
    const F = RU().format(state.rules);
    const marks = state.players[def].marks.slice();
    const sunk = new Set(state.players[def].sunk.map((s) => s.id));
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      const x = results[i] || {};
      if (x.r !== cells[i].r || x.c !== cells[i].c) return null;
      const k = x.r * n + x.c;
      if (x.result === 'agua') { marks[k] = 1; out.push({ r: x.r, c: x.c, result: 'agua' }); continue; }
      if (x.result === 'acerto') { marks[k] = 2; out.push({ r: x.r, c: x.c, result: 'acerto' }); continue; }
      if (x.result !== 'afundou' || !x.ship) return null;
      const ship = copyShip(x.ship);
      if (F.ships.indexOf(ship.id) < 0 || sunk.has(ship.id) || x.ship.len !== ship.len || !B().fits(ship, n)) return null;
      const sc = B().shipCells(ship);
      if (!sc.some((p) => p.r === x.r && p.c === x.c)) return null;
      marks[k] = 2;
      if (!sc.every((p) => marks[p.r * n + p.c] === 2)) return null;   // every cell hit, none water / another wreck
      sc.forEach((p) => { marks[p.r * n + p.c] = 3; });
      sunk.add(ship.id);
      out.push({ r: x.r, c: x.c, result: 'afundou', ship });
    }
    return out;
  }

  // Returns the normalised Answer, or null when its shape doesn't match the pending action.
  function checkAnswer(state, ans) {
    const pd = state.pending;
    const def = 1 - pd.p;
    const n = state.size;
    if (!ans || typeof ans !== 'object') return null;
    if (pd.kind === 'fire') {
      if (ans.kind !== 'shots') return null;
      const results = checkShots(state, def, pd.cells, ans.results);
      return results ? { kind: 'shots', results } : null;
    }
    if (ans.kind !== 'tech' || !ans.result || ans.result.tech !== pd.tech) return null;
    const x = ans.result;
    const t = pd.target || {};
    if (ATTACK[pd.tech]) {
      if (x.r !== t.r || x.c !== t.c || x.absorbed) return null;
      const shots = checkShots(state, def, pd.cells, x.shots);
      return shots ? { kind: 'tech', result: { tech: pd.tech, r: t.r, c: t.c, shots } } : null;
    }
    if (pd.tech === 'haki') {
      if (x.r !== t.r || x.c !== t.c || typeof x.found !== 'boolean') return null;
      return { kind: 'tech', result: { tech: 'haki', r: t.r, c: t.c, found: x.found } };
    }
    if (pd.tech === 'room') {
      if (x.axis !== t.axis || x.index !== t.index || !Number.isInteger(x.count) || x.count < 0 || x.count > n) return null;
      return { kind: 'tech', result: { tech: 'room', axis: t.axis, index: t.index, count: x.count } };
    }
    if (pd.tech === 'observation') {
      if (x.cell === null) return { kind: 'tech', result: { tech: 'observation', cell: null } };
      if (!x.cell || !inB(x.cell.r, x.cell.c, n)) return null;
      const m = state.players[def].marks[x.cell.r * n + x.cell.c];
      if (m === 1 || m === 2 || m === 3) return null;
      return { kind: 'tech', result: { tech: 'observation', cell: { r: x.cell.r, c: x.cell.c } } };
    }
    return null;
  }

  // ---------------------------------------------------------------- mutation of a draft (never the input)
  function applyShotStats(st, results) {
    for (const x of results) {
      st.shots++;
      if (isHit(x.result)) {
        st.hits++; st.streak++;
        if (st.streak > st.bestStreak) st.bestStreak = st.streak;
        if (x.result === 'afundou') st.sunk++;
      } else { st.misses++; st.streak = 0; }
    }
    st.accuracy = st.shots ? st.hits / st.shots : 0;
  }

  function applyMarks(s, def, results, events, shooter) {
    const n = s.size;
    const ps = s.players[def];
    for (const x of results) {
      if (x.result === 'absorvido') continue;
      const k = x.r * n + x.c;
      ps.marks[k] = x.result === 'agua' ? 1 : 2;
      ps.markTurn[k] = s.turnNo;
      if (x.result === 'afundou') {
        for (const p of B().shipCells(x.ship)) { ps.marks[p.r * n + p.c] = 3; ps.markTurn[p.r * n + p.c] = s.turnNo; }
        ps.sunk.push(x.ship);
        events.push({ type: 'sunk', p: shooter, owner: def, ship: x.ship });
      }
    }
  }

  function pushHistory(s, p, kind, tech, cells, ans, auto) {
    const last = s.history[s.history.length - 1];
    if (!last || last.turnNo !== s.turnNo) s.players[p].stats.turns++;
    s.history.push({ turnNo: s.turnNo, p, kind, tech: tech || null, cells, answer: ans, auto: !!auto });
  }

  function passTurn(s, events) {
    s.turnNo++;
    s.turn = 1 - s.turn;
    s.acted = 0;
    s.shotsLeft = RU().shotsPerTurn(s.rules, afloat(s, s.turn));
    s.gust = rollGust(s);
    events.push({ type: 'turn', turn: s.turn, turnNo: s.turnNo, shotsLeft: s.shotsLeft, gust: s.gust });
  }

  function endGame(s, winner, reason, events) {
    s.phase = 'over';
    s.winner = winner;
    s.endReason = reason;
    s.pending = null;
    s.gust = null;
    events.push({ type: 'phase', phase: 'over' });
    events.push({ type: 'over', winner, reason });
  }

  // After a resolved (or absorbed) action of the shooter p.
  function afterAction(s, p, isTech, results, events) {
    if (s.players[1 - p].sunk.length >= totalShips(s)) { endGame(s, p, 'fleet', events); return; }
    let pass;
    if (isTech) pass = true;
    else if (s.rules.salvo) { s.shotsLeft--; pass = s.shotsLeft <= 0; }
    else if (s.rules.chain && results.some((x) => isHit(x.result))) pass = false;
    else pass = true;
    if (pass) passTurn(s, events);
  }

  // ---------------------------------------------------------------- reducer
  function fail(state, code) { return { state, events: [], error: code }; }

  function doFire(state, a, auto) {
    const n = state.size;
    let r = a.r, c = a.c;
    const marks = state.players[1 - a.p].marks;
    const s = cloneState(state);
    const events = [];
    let drift = null;
    if (s.gust) {
      const d = DIR_D[s.gust.dir];
      const rr = r + d[0], cc = c + d[1];
      if (inB(rr, cc, n) && !isTried(marks[rr * n + cc])) { drift = { from: { r, c }, dir: s.gust.dir }; r = rr; c = cc; }
      s.gust = null;   // only the turn's first fire drifts
    }
    s.acted++;
    const cells = [{ r, c }];
    events.push({ type: 'fired', p: a.p, cells, tech: null, auto: !!auto, drift });
    const def = s.players[1 - a.p];
    if (def.vortex) {
      def.vortex = false;
      const results = [{ r, c, result: 'absorvido' }];
      events.push({ type: 'absorbed', p: a.p, cells });
      applyShotStats(s.players[a.p].stats, results);
      pushHistory(s, a.p, 'fire', null, cells, { kind: 'shots', results }, auto);
      events.push({ type: 'resolved', p: a.p, results, tech: null });
      afterAction(s, a.p, false, results, events);
      return { state: s, events, error: null };
    }
    s.pending = { kind: 'fire', p: a.p, cells, tech: null, target: null, ref: a.ref == null ? null : String(a.ref), auto: !!auto };
    return { state: s, events, error: null };
  }

  function reduceFire(state, a, auto) {
    if (state.phase !== 'battle') return fail(state, 'phase');
    if (a.p !== state.turn) return fail(state, 'turn');
    if (state.pending) return fail(state, 'pending');
    if (!inB(a.r, a.c, state.size)) return fail(state, 'bounds');
    if (isTried(state.players[1 - a.p].marks[a.r * state.size + a.c])) return fail(state, 'tried');
    return doFire(state, a, auto);
  }

  function reduceTech(state, a) {
    const err = legalTech(state, a.p, a.tech, a.target);
    if (err) return fail(state, err);
    const s = cloneState(state);
    const events = [];
    const p = a.p;
    const target = normTarget(a.tech, a.target);
    const cells = techCells(state, p, a.tech, target);
    s.acted++;
    s.gust = null;
    s.players[p].techUsed = true;
    s.players[p].stats.techs++;
    if (a.tech === 'vortex') {
      s.players[p].vortex = true;
      const result = { tech: 'vortex' };
      pushHistory(s, p, 'tech', 'vortex', [], { kind: 'tech', result }, false);
      events.push({ type: 'tech', p, tech: 'vortex', target, result });
      afterAction(s, p, true, [], events);
      return { state: s, events, error: null };
    }
    events.push({ type: 'fired', p, cells, tech: a.tech, auto: false, drift: null });
    const def = s.players[1 - p];
    if (ATTACK[a.tech] && def.vortex) {
      def.vortex = false;
      const shots = cells.map((x) => ({ r: x.r, c: x.c, result: 'absorvido' }));
      const result = { tech: a.tech, r: target.r, c: target.c, shots, absorbed: true };
      events.push({ type: 'absorbed', p, cells });
      applyShotStats(s.players[p].stats, shots);
      pushHistory(s, p, 'tech', a.tech, cells, { kind: 'tech', result }, false);
      events.push({ type: 'resolved', p, results: shots, tech: a.tech });
      events.push({ type: 'tech', p, tech: a.tech, target, result });
      afterAction(s, p, true, shots, events);
      return { state: s, events, error: null };
    }
    s.pending = { kind: 'tech', p, cells, tech: a.tech, target, ref: a.ref == null ? null : String(a.ref), auto: false };
    return { state: s, events, error: null };
  }

  function reduceAnswer(state, a) {
    if (state.phase !== 'battle') return fail(state, 'phase');
    const pd = state.pending;
    if (!pd) return fail(state, 'pending');
    if (a.p !== 1 - pd.p) return fail(state, 'turn');
    const ans = checkAnswer(state, a.answer);
    if (!ans) return fail(state, 'answer');
    const defFleet = state.players[1 - pd.p].fleet;
    if (defFleet && JSON.stringify(ans) !== JSON.stringify(answer(state))) return fail(state, 'answer');   // known fleet: must be the truth
    const s = cloneState(state);
    const events = [];
    const p = pd.p, def = 1 - p;
    s.pending = null;
    if (pd.kind === 'fire') {
      const results = ans.results;
      applyShotStats(s.players[p].stats, results);
      pushHistory(s, p, 'fire', null, pd.cells, ans, pd.auto);
      events.push({ type: 'resolved', p, results, tech: null });
      applyMarks(s, def, results, events, p);
      afterAction(s, p, false, results, events);
      return { state: s, events, error: null };
    }
    const result = ans.result;
    const ps = s.players[def];
    let results = [];
    if (ATTACK[pd.tech]) {
      results = result.shots;
      applyShotStats(s.players[p].stats, results);
      events.push({ type: 'resolved', p, results, tech: pd.tech });
      applyMarks(s, def, results, events, p);
    } else if (pd.tech === 'haki') {
      ps.annotations.push({ tech: 'haki', r: result.r, c: result.c, found: result.found, turnNo: s.turnNo });
    } else if (pd.tech === 'room') {
      ps.annotations.push({ tech: 'room', axis: result.axis, index: result.index, count: result.count, turnNo: s.turnNo });
    } else if (pd.tech === 'observation' && result.cell) {
      const k = result.cell.r * s.size + result.cell.c;
      ps.marks[k] = 4;
      ps.markTurn[k] = s.turnNo;
      ps.annotations.push({ tech: 'observation', r: result.cell.r, c: result.cell.c, turnNo: s.turnNo });
    }
    pushHistory(s, p, 'tech', pd.tech, pd.cells, ans, false);
    events.push({ type: 'tech', p, tech: pd.tech, target: pd.target, result });
    afterAction(s, p, true, results, events);
    return { state: s, events, error: null };
  }

  function reduce(state, action) {
    const a = action || {};
    const p = a.p;
    if (p !== 0 && p !== 1) return fail(state, 'turn');
    switch (a.type) {
      case 'place': {
        if (state.phase !== 'setup' || state.players[p].ready) return fail(state, 'phase');
        if (state.players[p].hidden) return fail(state, 'fleet');
        if (!B().validateFleet(a.fleet, state.rules).ok) return fail(state, 'fleet');
        const s = cloneState(state);
        s.players[p].fleet = normFleet(a.fleet);
        return { state: s, events: [], error: null };
      }
      case 'ready': {
        if (state.phase !== 'setup' || state.players[p].ready) return fail(state, 'phase');
        if (!state.players[p].hidden && !state.players[p].fleet) return fail(state, 'fleet');
        const s = cloneState(state);
        const events = [];
        s.players[p].ready = true;
        events.push({ type: 'ready', p });
        if (s.players[0].ready && s.players[1].ready) {
          s.phase = 'battle';
          s.turn = s.first;
          s.turnNo = 1;
          s.acted = 0;
          s.shotsLeft = RU().shotsPerTurn(s.rules, afloat(s, s.turn));
          s.gust = rollGust(s);
          events.push({ type: 'phase', phase: 'battle' });
          events.push({ type: 'turn', turn: s.turn, turnNo: s.turnNo, shotsLeft: s.shotsLeft, gust: s.gust });
        }
        return { state: s, events, error: null };
      }
      case 'fire': return reduceFire(state, a, !!a.auto);
      case 'tech': return reduceTech(state, a);
      case 'answer': return reduceAnswer(state, a);
      case 'timeout': {
        if (state.phase !== 'battle') return fail(state, 'phase');
        if (p !== state.turn) return fail(state, 'turn');
        if (state.pending) return fail(state, 'pending');
        const cell = randomUntried(state, p, state.acted);
        if (!cell) return fail(state, 'tried');
        return doFire(state, { type: 'fire', p, r: cell.r, c: cell.c, ref: a.ref }, true);
      }
      case 'forfeit': {
        if (state.phase === 'over') return fail(state, 'phase');
        const s = cloneState(state);
        const events = [];
        const reason = a.reason === 'absent' ? 'absent' : a.reason === 'cheat' ? 'cheat' : 'forfeit';
        endGame(s, 1 - p, reason, events);
        return { state: s, events, error: null };
      }
      case 'reveal': {   // extension: a hidden fleet becomes known after the game (PvP reveal); validity only
        if (state.phase !== 'over') return fail(state, 'phase');
        if (state.players[p].fleet) return fail(state, 'fleet');
        if (!B().validateFleet(a.fleet, state.rules).ok) return fail(state, 'fleet');
        const s = cloneState(state);
        s.players[p].fleet = normFleet(a.fleet);
        return { state: s, events: [], error: null };
      }
      default: return fail(state, 'phase');
    }
  }

  // ---------------------------------------------------------------- series
  const SERIES_ENDING = { forfeit: true, cheat: true, absent: true };

  function recordGame(series, game, timeMs) {
    if (!series || !game || game.phase !== 'over' || series.over) return series;
    if (game.gameIndex !== series.games.length) return series;   // idempotent: already recorded / out of order
    const w = game.winner;
    const stats = [GLT.stats.compute(game, 0, timeMs), GLT.stats.compute(game, 1, timeMs)];
    const wins = series.wins.slice();
    wins[w]++;
    const games = series.games.concat([{ winner: w, reason: game.endReason, stats }]);
    const over = wins[w] >= series.target || !!SERIES_ENDING[game.endReason];
    return {
      seed: series.seed, rules: series.rules, crews: series.crews, target: series.target,
      wins, index: series.index + 1, games, over, winner: over ? w : null
    };
  }

  // ---------------------------------------------------------------- views
  function lastShotOn(state, q) {
    for (let i = state.history.length - 1; i >= 0; i--) {
      const h = state.history[i];
      if (h.p !== 1 - q) continue;
      const list = h.answer.kind === 'shots' ? h.answer.results : (h.answer.result && h.answer.result.shots) || null;
      if (!list) continue;
      for (let j = list.length - 1; j >= 0; j--) {
        if (list[j].result !== 'absorvido') return { r: list[j].r, c: list[j].c, turnNo: h.turnNo };
      }
    }
    return null;
  }

  function view(state, viewer) {
    const v = viewer === 0 || viewer === 1 ? viewer : null;
    const me = v === null ? 0 : v;
    const pd = state.pending;
    const players = state.players.map((ps, i) => ({
      crew: ps.crew, ready: ps.ready, techUsed: ps.techUsed, vortex: ps.vortex,
      marks: ps.marks.slice(), markTurn: ps.markTurn.slice(), sunk: ps.sunk.slice(),
      annotations: ps.annotations.slice(), stats: Object.assign({}, ps.stats),
      fleet: ps.fleet && ((v !== null && i === v) || state.phase === 'over') ? ps.fleet : null,
      shipsAfloat: afloat(state, i), lastShot: lastShotOn(state, i)
    }));
    return {
      phase: state.phase, rules: state.rules, size: state.size, gameIndex: state.gameIndex,
      turn: state.turn, turnNo: state.turnNo, shotsLeft: state.shotsLeft, gust: state.gust,
      winner: state.winner, endReason: state.endReason,
      viewer: v, me, opp: 1 - me,
      myTurn: v !== null && state.phase === 'battle' && state.turn === v && !pd,
      pending: !!pd,
      pendingAction: pd ? { kind: pd.kind, p: pd.p, cells: pd.cells.slice(), tech: pd.tech } : null,
      first: state.first, acted: state.acted,
      players
    };
  }

  function markVisible(view, player, idx) {
    const pv = view.players[player];
    const m = pv.marks[idx];
    if (!m) return false;
    if (view.viewer !== null && player === view.me) return true;      // own waters: always visible
    if (!RU().effectiveFog(view.rules) || m === 3) return true;
    return view.turnNo - pv.markTurn[idx] <= GLT.C.FOG_TURNS;
  }

  // ---------------------------------------------------------------- match log: the whole match as a pure fold
  // MatchLog = { v:1, header:{rules, seed, crews, hidden}, moves: Move[] }, Move = Action | {type:'next'}, each with optional
  // `t` (ms since match start, used only for stats/bounty speed). Rejected moves stay in the log and have no effect.
  function createMatch(o) {
    o = o || {};
    const rules = RU().normalize(o.rules);
    const seed = o.seed >>> 0;
    const crews = normCrews(o.crews);
    const hidden = [!!(o.hidden && o.hidden[0]), !!(o.hidden && o.hidden[1])];
    const series = createSeries({ rules, seed, crews });
    return {
      v: VERSION, header: { rules, seed, crews, hidden },
      log: [], series, game: nextGame(series, { hidden }), t0: null, rejected: []
    };
  }

  function cleanMove(move) { return JSON.parse(JSON.stringify(move || {})); }

  function applyMove(match, move) {
    const mv = cleanMove(move);
    const i = match.log.length;
    const log = match.log.concat([mv]);
    const base = { v: match.v, header: match.header, log, series: match.series, game: match.game, t0: match.t0, rejected: match.rejected };
    const reject = (error) => {
      base.rejected = match.rejected.concat([{ i, type: String(mv.type), error }]);
      return { match: base, events: [], error };
    };
    if (mv.type === 'next') {
      if (match.game.phase !== 'over' || match.series.over || match.series.index !== match.game.gameIndex + 1) return reject('phase');
      base.game = nextGame(match.series, { hidden: match.header.hidden });
      base.t0 = null;
      return { match: base, events: [{ type: 'phase', phase: 'setup' }], error: null };
    }
    const res = reduce(match.game, mv);
    if (res.error) return reject(res.error);
    base.game = res.state;
    const t = typeof mv.t === 'number' ? mv.t : null;
    if (match.game.phase === 'setup' && res.state.phase === 'battle') base.t0 = t;
    if (res.state.phase === 'over' && match.game.phase !== 'over') {
      const ms = t !== null && base.t0 !== null ? Math.max(0, t - base.t0) : 0;
      base.series = recordGame(match.series, res.state, ms);
    }
    return { match: base, events: res.events, error: null };
  }

  function logOf(match) { return { v: VERSION, header: match.header, moves: match.log.slice() }; }

  function foldMatch(log) {
    let m = createMatch(log && log.header);
    for (const mv of (log && log.moves) || []) m = applyMove(m, mv).match;
    return m;
  }

  // GameState-only replay (one game, raw actions; illegal actions are skipped).
  function replayGame(o, actions) {
    let s = createGame(o);
    for (const a of actions || []) s = reduce(s, a).state;
    return s;
  }

  // ---------------------------------------------------------------- (de)serialisation
  function serialize(obj) { return JSON.stringify(obj); }

  function deserialize(text) {
    const o = typeof text === 'string' ? JSON.parse(text) : JSON.parse(JSON.stringify(text));
    if (!o || typeof o !== 'object') throw new Error('GLT.engine.deserialize: bad input');
    if ('v' in o && o.v !== VERSION) throw new Error('GLT.engine.deserialize: unsupported version ' + o.v);
    return o;
  }

  // A serialised MatchLog (or a serialised MatchState) → the folded MatchState. The fold is the authority:
  // a stored MatchState is re-derived from its own log, so a tampered snapshot can't survive a reload.
  function loadMatch(text) {
    const o = deserialize(text);
    if (o.header && Array.isArray(o.moves)) return foldMatch(o);
    if (o.header && Array.isArray(o.log)) return foldMatch({ v: VERSION, header: o.header, moves: o.log });
    throw new Error('GLT.engine.loadMatch: not a match');
  }

  function digest(obj) { return ('00000000' + GLT.rng.hashString(serialize(obj)).toString(16)).slice(-8); }

  GLT.engine = {
    VERSION, ERRORS,
    // contract (§5.8)
    createSeries, gameSeed, coinToss, createGame, reduce, answer, recordGame, view,
    untried, randomUntried, markVisible, techCells, legalTech,
    // additions (rules-core)
    nextGame, afloat, totalShips, normFleet, emptyStats,
    createMatch, applyMove, foldMatch, logOf, replayGame,
    serialize, deserialize, loadMatch, digest
  };
})();
