// Critic probe (stage "online"): hostile attacks the builder's suites do not cover.
// Reuses the harness from tests/pvp-protocol.js by slicing its source (header + runDbMatch).
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'pvp-protocol.js'), 'utf8');
const header = src.slice(0, src.indexOf('async function runTestSuite'));
const hStart = src.indexOf("  const { createFakeClaude, createMemoryHub }");
const hEnd = src.indexOf("  await test('19.");
const harness = src.slice(hStart, hEnd);

const body = `
async function main() {
  let failures = 0;
  async function probe(name, fn) {
    try { const out = await fn(); console.log('[PROBE] ' + name + ' -> ' + out); }
    catch (e) { failures++; console.log('[PROBE-ERR] ' + name + ' -> ' + (e && e.stack || e)); }
  }
${harness}

  // H1: absence claim WITHOUT seq, written by the guest in its own log during its rival's turn.
  await probe('H1 unrefutable absence claim (no seq)', async () => {
    const probes = { claimed: false };
    let r;
    try {
      r = await runDbMatch({
        roomId: 'H1NOSEQ', seed: 7101, faults: { latency: [1, 10], dupSnapshot: 0.3 },
        async onTick(ctx) {
          const { c0, c1 } = ctx;
          if (!probes.claimed && c0.state.turnNumber >= 2) {
            probes.claimed = true;
            const ev = createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit' });
            delete ev.seq;
            c1.transport.publish(c1.roomId, ev);
          }
        }
      });
    } catch (e) { return 'match did not finish normally: ' + String(e.message).slice(0, 300); }
    const res = { c0: [r.c0.state.phase, r.c0.state.winner, r.c0.state.gameOverReason, r.c0.state.turnNumber, r.c0.state.integrity && r.c0.state.integrity.reason],
                  c1: [r.c1.state.phase, r.c1.state.winner, r.c1.state.gameOverReason],
                  hostPresence: r.c0.rawEvents.filter(e => e.type === 'PRESENCE' && e._seat === 0).length };
    closeMatch(r);
    return JSON.stringify(res);
  });

  // H2: absence claim with a non-numeric seq (string)
  await probe('H2 absence claim with seq as string', async () => {
    const probes = { claimed: false };
    let r;
    try {
      r = await runDbMatch({
        roomId: 'H2STRSEQ', seed: 7201, faults: { latency: [1, 10] },
        async onTick(ctx) {
          const { c0, c1 } = ctx;
          if (!probes.claimed && c0.state.turnNumber >= 2) {
            probes.claimed = true;
            c1.transport.publish(c1.roomId, createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit', seq: String(c1.seqCounter) }));
          }
        }
      });
    } catch (e) { return 'match did not finish normally: ' + String(e.message).slice(0, 300); }
    const res = { c0: [r.c0.state.phase, r.c0.state.winner, r.c0.state.gameOverReason, r.c0.state.turnNumber], c1: [r.c1.state.phase, r.c1.state.winner] };
    closeMatch(r);
    return JSON.stringify(res);
  });

  // H3: store scan of an honest match: any doc mentioning fleet/salt/cells before the first reveal
  await probe('H3 store scan honest match', async () => {
    const r = await runDbMatch({ roomId: 'H3SCAN', seed: 7301, faults: { latency: [1, 6] } });
    const firstReveal = r.hub.writeLog.findIndex(revealIndex);
    const leaks = r.hub.writeLog.slice(0, firstReveal).filter(w => {
      const s = JSON.stringify(w.body);
      return s.includes(r.salt0) || s.includes(r.salt1) || /"fleet"|"cells"/.test(s);
    }).map(w => w.path);
    const res = { firstReveal, writes: r.hub.writeLog.length, leaks, docs: r.hub.dump().map(d => d.path) };
    closeMatch(r);
    return JSON.stringify(res);
  });

  console.log('probe failures: ' + failures);
  process.exit(0);
}
main();
`;
const code = (header + body).split("require('../src/").join("require('../../src/").split("require('./fakes/").join("require('../fakes/");
const tmp = path.join(__dirname, '_online-hostile-r2.gen.js');
fs.writeFileSync(tmp, code);
require(tmp);
