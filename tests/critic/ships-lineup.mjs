// Critic probe (stage 2 ships): pack each crew's grand_line fleet into adjacent rows (horizontal) and adjacent
// columns (vertical), measure each ship's hull+rig box (ship-fit group) against its cell footprint and against its
// neighbours, count ship meshes/triangles and renderer draw calls per frame, and shoot the lineup.
// usage: node tests/critic/ships-lineup.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.resolve(ROOT, process.argv[2] || 'shots/critic/lineup');
fs.mkdirSync(outDir, { recursive: true });
const vendorThree = path.join(ROOT, 'tools', 'vendor', 'three.min.js');
const crews = ['straw_hats', 'marines', 'whitebeard', 'red_haired', 'heart', 'blackbeard'];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--allow-file-access-from-files'] });
const errs = [];
const results = {};
for (const crew of crews) {
  for (const orient of ['h', 'v']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(vendorThree) }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errs.push(crew + ': ' + m.text()); });
    page.on('pageerror', (e) => errs.push(crew + ' pageerror: ' + e.message));
    await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
    await page.waitForFunction(() => window.GLT && GLT.ui && GLT.ui.dom && GLT.ui.dom.canvas, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const info = await page.evaluate(async ({ crew, orient }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ui = GLT.ui;
      ui.matchConfig.crewId = crew; ui.matchConfig.enemyCrewId = crew; ui.matchConfig.boardId = 'grand_line';
      if (ui.platesSystem) ui.platesSystem.setBoardSize(12);
      const ships = GLT.rules.getShipsForBoard('grand_line', crew);
      const h = orient === 'h';
      ui.placedPlayerFleet = ships.map((s, i) => {
        const r = h ? i : 0, c = h ? 0 : i;
        const cells = []; for (let k = 0; k < s.length; k++) cells.push({ r: h ? r : r + k, c: h ? c + k : c });
        return Object.assign({}, s, { r, c, horizontal: h, cells });
      });
      ui.syncPlayerFleetTo3d();
      ui.setCameraPreset('minhas_aguas');
      await sleep(1600);
      const sp = ui.platesSystem.seaPlates;
      const ms = ui.playerShipMeshes;
      const cs = ms[0].userData.cellSize;
      // freeze swell for measuring: measure the fit group with bob reset
      const out = [];
      const boxes = [];
      ms.forEach((g, i) => {
        const fit = g.getObjectByName('ship-fit');
        const bob = g.getObjectByName('ship-bob');
        const saved = bob ? [bob.position.clone(), bob.rotation.clone()] : null;
        if (bob) { bob.position.set(0, bob.position.y, 0); bob.rotation.set(0, 0, 0); }
        g.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(fit);
        if (bob) { bob.position.copy(saved[0]); bob.rotation.copy(saved[1]); g.updateMatrixWorld(true); }
        const s = ui.placedPlayerFleet[i];
        const a = sp.cellToWorld(0, s.cells[0].r, s.cells[0].c), z = sp.cellToWorld(0, s.cells[s.cells.length - 1].r, s.cells[s.cells.length - 1].c);
        const fx0 = Math.min(a.x, z.x) - cs / 2, fx1 = Math.max(a.x, z.x) + cs / 2, fz0 = Math.min(a.z, z.z) - cs / 2, fz1 = Math.max(a.z, z.z) + cs / 2;
        const ov = { x0: +((fx0 - b.min.x) / cs).toFixed(3), x1: +((b.max.x - fx1) / cs).toFixed(3), z0: +((fz0 - b.min.z) / cs).toFixed(3), z1: +((b.max.z - fz1) / cs).toFixed(3) };
        boxes.push(b);
        out.push({ id: g.userData.shipId, model: g.userData.model, len: s.length, sizeCells: [+((b.max.x - b.min.x) / cs).toFixed(2), +((b.max.z - b.min.z) / cs).toFixed(2)], heightCells: +((b.max.y - b.min.y) / cs).toFixed(2), overflowCells: ov });
      });
      const clips = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        const ix = Math.min(A.max.x, B.max.x) - Math.max(A.min.x, B.min.x), iz = Math.min(A.max.z, B.max.z) - Math.max(A.min.z, B.min.z);
        if (ix > 0 && iz > 0) clips.push([out[i].id, out[j].id, +(ix / cs).toFixed(2), +(iz / cs).toFixed(2)]);
      }
      let meshes = 0, tris = 0;
      ms.forEach((g) => g.traverseVisible((o) => { if (o.isMesh) { meshes++; const ix = o.geometry.index; tris += (ix ? ix.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }));
      const R = ui.renderer; R.info.autoReset = false; R.info.reset();
      await new Promise((r) => requestAnimationFrame(() => r()));
      R.info.reset();
      await new Promise((r) => requestAnimationFrame(() => r()));
      const calls = R.info.render.calls, frameTris = R.info.render.triangles;
      R.info.autoReset = true;
      // ships hidden -> calls without ships
      ms.forEach((g) => { g.visible = false; });
      R.info.autoReset = false; R.info.reset();
      await new Promise((r) => requestAnimationFrame(() => r()));
      const callsNoShips = R.info.render.calls; R.info.autoReset = true;
      ms.forEach((g) => { g.visible = true; });
      // close-up camera on the lineup
      const cc = ui.platesSystem.cameraController;
      cc.transitioning = false; cc.zoom = 2.2; cc.minWorldWidth = 10; cc.elevation = 0.62;
      const tg = sp.cellToWorld(0, h ? 3 : 2.5, h ? 2.5 : 3); cc.target.set(tg.x, 0, tg.z);
      cc.updateCameraTransform && cc.updateCameraTransform();
      await sleep(900);
      return { cellSize: cs, ships: out, clips, meshes, tris: Math.round(tris), frameCalls: calls, frameCallsNoShips: callsNoShips, frameTris };
    }, { crew, orient });
    results[crew + ':' + orient] = info;
    await page.screenshot({ path: path.join(outDir, `${crew}-${orient}.png`), clip: { x: 0, y: 50, width: 860, height: 620 } });
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(outDir, '_lineup.json'), JSON.stringify({ results, errs }, null, 2));
for (const [k, v] of Object.entries(results)) {
  const worst = v.ships.reduce((m, s) => Math.max(m, ...Object.values(s.overflowCells)), -9);
  console.log(k, 'ships', v.ships.length, 'meshes', v.meshes, 'tris', v.tris, 'calls', v.frameCalls, 'callsNoShips', v.frameCallsNoShips, 'worstOverflowCells', worst.toFixed(3), 'clips', JSON.stringify(v.clips));
}
console.log('errors', JSON.stringify(errs));
