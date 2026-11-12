// Critic probe r3 (stage "online"): seq-inflation and inflated absence claims over the db fake.
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
  function summary(r) {
    return { c0: [r.c0.state.phase, r.c0.state.winner, r.c0.state.gameOverReason, r.c0.state.turnNumber, r.c0.state.integrity && r.c0.state.integrity.reason],
             c1: [r.c1.state.phase, r.c1.state.winner, r.c1.state.gameOverReason], c0seq: r.c0.seqCounter };
  }
  function junk(seq) {
    const ev = createEvent('SHOT_FIRE', { shooterIndex: 1, r: -1, c: -1, turn: 0 });
    ev.seq = seq;
    return ev;
  }

  // H4: guest writes ONE well-formed own-seat REACTION carrying seq = MAX_SAFE_INTEGER.
  for (const [tag, s] of [['MAX_SAFE', Number.MAX_SAFE_INTEGER], ['1e15', 1e15]]) {
    await probe('H4 seq inflation ' + tag, async () => {
      const probes = { done: false };
      let r;
      try {
        r = await runDbMatch({
          roomId: 'H4' + tag.replace(/[^A-Z0-9]/gi, ''), seed: 7401, faults: { latency: [1, 8] },
          async onTick(ctx) {
            if (!probes.done && ctx.c0.state.turnNumber >= 2) { probes.done = true; ctx.c1.transport.publish(ctx.c1.roomId, junk(s)); }
          }
        });
      } catch (e) { return 'match did not finish normally: ' + String(e.message).slice(0, 400); }
      const res = summary(r); closeMatch(r); return JSON.stringify(res);
    });
  }

  // H5: guest inflates the log with an own junk event at seq 5000, then claims absence at 5001
  // while the host is alive. Expect: refuted by the host's PRESENCE, match ends by fleet destroyed.
  await probe('H5 inflated absence claim', async () => {
    const probes = { step: 0 };
    let r;
    try {
      r = await runDbMatch({
        roomId: 'H5INFL', seed: 7501, faults: { latency: [1, 8], dupSnapshot: 0.3 },
        async onTick(ctx) {
          const { c0, c1 } = ctx;
          if (probes.step === 0 && c0.state.turnNumber >= 2) { probes.step = 1; c1.transport.publish(c1.roomId, junk(5000)); }
          else if (probes.step === 1 && c0.rawEvents.some(e => e.seq === 5000)) {
            probes.step = 2;
            c1.transport.publish(c1.roomId, createEvent('GAME_OVER', { winnerIndex: 1, reason: 'forfeit', seq: 5001 }));
          }
        }
      });
    } catch (e) { return 'match did not finish normally: ' + String(e.message).slice(0, 400); }
    const res = summary(r);
    res.hostPresence = r.c0.rawEvents.filter(e => e.type === 'PRESENCE' && e._seat === 0).map(e => e.seq);
    closeMatch(r); return JSON.stringify(res);
  });

  // H6: guest (losing) writes junk at MAX_SAFE_INTEGER and then really leaves. The host's honest
  // absence claim (seq = its counter) should still win the match.
  await probe('H6 junk MAX_SAFE then vanish: honest absence claim', async () => {
    const probes = { step: 0, c0: null, claim: null };
    try {
      await runDbMatch({
        roomId: 'H6GONE', seed: 7601, faults: { latency: [1, 8] },
        holdFire(ctx, c) { return probes.step >= 2; },
        async onTick(ctx) {
          const { c0, c1, B } = ctx; probes.c0 = c0;
          if (probes.step === 0 && c0.state.turnNumber >= 2) { probes.step = 1; c1.transport.publish(c1.roomId, junk(Number.MAX_SAFE_INTEGER)); }
          else if (probes.step === 1 && c0.rawEvents.some(e => e.seq === Number.MAX_SAFE_INTEGER)) {
            probes.step = 2;
            await B.transport.whenIdle(); B.fake.kill(); c1.destroy(); B.transport.destroy();
            const st = c0.checkLiveness(Date.now() + 10 * 60 * 1000);
            probes.claim = { liveness: st, counter: c0.seqCounter };
          }
          if (probes.step === 2) { await nap(1500); throw new Error('stop'); }
        }
      });
    } catch (e) { /* expected stop */ }
    const c0 = probes.c0;
    const claims = c0.rawEvents.filter(e => e.type === 'GAME_OVER').map(e => ({ seq: e.seq, safe: Number.isSafeInteger(e.seq), seat: e._seat }));
    const res = { claim: probes.claim, claims, host: [c0.state.phase, c0.state.winner, c0.state.gameOverReason] };
    try { c0.destroy(); } catch (_) {}
    return JSON.stringify(res);
  });

  console.log('probe failures: ' + failures);
  process.exit(0);
}
main();
`;
const code = (header + body).split("require('../src/").join("require('../../src/").split("require('./fakes/").join("require('../fakes/");
const tmp = path.join(__dirname, '_online-hostile-r3.gen.js');
fs.writeFileSync(tmp, code);
try { require(tmp); } finally { setTimeout(() => { try { fs.unlinkSync(tmp); } catch (_) {} }, 0); }
