#!/usr/bin/env node
// End-to-end self test of the toolchain against the fixture in tools/smoke. node tools/smoke.mjs  (or: npm run smoke)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, expect = 0) => {
  const r = spawnSync(process.execPath, args, { cwd: R, encoding: 'utf8' });
  const ok = r.status === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  node ${args.join(' ')}  (exit ${r.status}, expected ${expect})`);
  if (!ok) { console.log(r.stdout, r.stderr); process.exitCode = 1; }
  return r;
};
run(['tools/build.js', '--root', 'tools/smoke', '--out', 'dist/smoke.html']);
run(['tools/build.js', '--root', 'tools/smoke', '--out', 'dist/smoke_vendor.html', '--vendor']);
run(['legacy/tests/run.mjs', '--root', 'tools/smoke', 'rng']);
run(['legacy/tests/run.mjs', '--root', 'tools/smoke', 'bad'], 1);
const s = run(['tools/shot.mjs', '--html', 'dist/smoke.html', '--demo', 'cube', '--angle', '45', '--elev', '35', '--tod', 'day', '--t', '0.5', '--out', 'shots/smoke/cube.png', '--eval', 'GLT.smoke.pixels()']);
const px = JSON.parse(s.stdout.trim()); if (!(px[3] === 255 && px[0] > 150)) { console.log('FAIL  unexpected WebGL pixel', px); process.exitCode = 1; } else console.log('PASS  WebGL pixel', px);
run(['tools/shot.mjs', '--html', 'dist/smoke_vendor.html', '--demo', 'cube', '--sequence', '0,0.4', '--out', 'shots/smoke/seq.png', '--viewport', '640x360']);
run(['tools/shot.mjs', '--html', 'dist/smoke.html', '--demo', 'does-not-exist', '--out', 'shots/smoke/nope.png'], 1);
run(['tools/blind.mjs', 'shots/smoke/cube.png', 'ref/sea-of-stars/sos_02.jpg', 'shots/smoke/blind', '1']);
const m = JSON.parse(fs.readFileSync(path.join(R, 'shots/smoke/blind/mapping.json'), 'utf8'));
console.log(m.A === 'ref' && m.B === 'ours' ? 'PASS  blind mapping swap=1 -> A=ref,B=ours' : 'FAIL  blind mapping');
if (!(m.A === 'ref')) process.exitCode = 1;
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK');
