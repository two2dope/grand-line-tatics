// Picking + framing probe (stage 3). For every camera preset and viewport: every cell centre of both plates is
// projected to the canvas, a real mousemove is dispatched there (the game's own handler: NDC -> raycaster ->
// seaPlates.raycastCell) and the hovered cell must be the same cell; the selection cursor (keyboard aim) must project
// onto the cell it names; and the plates the preset is about must fit inside the canvas.
// usage: node tests/critic/picking.mjs        exit 1 on any mismatch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const fails = [];
const VIEWS = [['desktop', { width: 1280, height: 720 }], ['tablet', { width: 1024, height: 768 }], ['phone', { width: 390, height: 844 }]];
const MODES = { duas_aguas: [0, 1], minhas_aguas: [0], mira_inimiga: [1], panorama: [0, 1] };
for (const boardId of ['grand_line', 'escaramuca']) for (const [vname0, viewport] of VIEWS) {
  const vname = vname0 + '-' + boardId;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(vname + ' pageerror: ' + e.message));
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
  await page.evaluate(async (boardId) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ui = GLT.ui;
    Object.assign(ui.matchConfig, { boardId, mode: 'classico', difficulty: 'capitao', seriesLength: 1 });
    ui.animSpeed = 4; ui.autoPlacePlayerFleet(); ui.startMatchWithCoinToss();
    for (let i = 0; i < 60 && ui.gamePhase !== 'BATTLE'; i++) await sleep(100);
  }, boardId);
  for (const [mode, plates] of Object.entries(MODES)) {
    await page.evaluate((p) => GLT.ui.setCameraPreset(p), mode);
    await page.waitForFunction(() => { const c = GLT.ui.platesSystem.cameraController; return !c || !c.transitioning; }, null, { timeout: 60000, polling: 100 });
    await page.waitForTimeout(700);
    const res = await page.evaluate((plates) => {
      const ui = GLT.ui, ps = ui.platesSystem, sp = ps.seaPlates, cam = ps.camera, cv = ui.dom.canvas;
      const rect = cv.getBoundingClientRect();
      const n = sp.boardSize, opp = ui.getMyPlatesIndices().oppPlate;
      const toClient = (v) => { const p = v.clone().project(cam); return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height, ndc: p }; };
      const out = { n, bad: [], outside: [], checked: 0, cursorErr: 0 };
      const rc = new THREE.Raycaster();
      for (const pi of [0, 1]) for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        const q = toClient(sp.cellToWorld(pi, r, c));
        rc.setFromCamera(new THREE.Vector2(q.ndc.x, q.ndc.y), cam);
        const hit = sp.raycastCell(rc);
        if (!hit || hit.plateIndex !== pi || hit.r !== r || hit.c !== c) out.bad.push(`ray p${pi} ${r},${c} -> ${hit ? hit.plateIndex + ' ' + hit.r + ',' + hit.c : 'none'}`);
        if (pi === opp && Math.abs(q.ndc.x) < 1 && Math.abs(q.ndc.y) < 1) {
          ui.hoveredAimCell = null;
          cv.dispatchEvent(new MouseEvent('mousemove', { clientX: q.x, clientY: q.y, bubbles: true }));
          const h = ui.hoveredAimCell;
          if (!h || h.r !== r || h.c !== c) out.bad.push(`mouse p${pi} ${r},${c} -> ${h ? h.r + ',' + h.c : 'none'}`);
          out.checked++;
        }
      }
      // keyboard aim: the selection cursor must sit on the cell it names
      ui.selectAimCoordinate(3, 5);
      ps.update(0.016, 1);
      const cur = ps.seaPlates.cellToWorld(opp, 3, 5);
      const root = GLT.ui.scene.getObjectByName('cursor-main');
      if (root && root.visible) { root.updateMatrixWorld(true); const w = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld); out.cursorErr = Math.hypot(w.x - cur.x, w.z - cur.z); }
      else out.cursorErr = 99;
      // framing: grid corners of the preset's plates inside the canvas
      const h = sp.cellSize / 2;
      for (const pi of plates) for (const [r, c, sr, sc] of [[0, 0, -1, -1], [0, n - 1, -1, 1], [n - 1, 0, 1, -1], [n - 1, n - 1, 1, 1]]) {
        const w = sp.cellToWorld(pi, r, c); w.x += sc * h; w.z += sr * h;
        const p = w.clone().project(cam);
        if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) out.outside.push(`p${pi} corner ${r},${c} ndc ${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      }
      return out;
    }, plates);
    const tag = `${vname}/${mode}`;
    console.log(tag.padEnd(24), 'n', res.n, 'mouse-checked', res.checked, 'bad', res.bad.length, 'outside', res.outside.length, 'cursorErr', res.cursorErr.toFixed(3));
    res.bad.slice(0, 5).forEach((b) => fails.push(tag + ' ' + b));
    res.outside.forEach((b) => fails.push(tag + ' framing ' + b));
    if (res.cursorErr > 0.05) fails.push(tag + ' cursor off by ' + res.cursorErr);
  }
  await ctx.close();
}
await browser.close();
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PICKING OK');
