# Minishoot' Cel-Diorama, Chibi Faction Fleets, Surrender & Game Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `v2.0.0` of *Grand Line Tactics* with a native-resolution *Minishoot' Adventures* cel-shaded diorama & neon projectile pipeline, curved 3D chibi fleets customized across all 6 crews, a 2-step "Abandonar o navio" surrender flow (PvC, MD3/MD5, and Online PvP), and an accessible 5-tab "Manual do Jogo" modal.

**Architecture:** Preserve all pure deterministic contracts and canonical ship IDs (`moby_dick`..`going_merry`) in `src/logic/*.js` so SHA-256 commitments and AI heuristics stay 100% intact, while layering faction ship metadata (`getCrewShipMeta`), pure forfeit transitions (`forfeitMatch` & `PvpMatchClient.prototype.forfeit`), an upgraded `cel_minishoot` GLSL post-processing & arcade FX pipeline, a procedural curved `ChibiMeshBuilder` for `6 × 7` faction vessels, and accessible UI modals compiled into byte-identical `index.html` and `grand-line-tactics.html`.

**Tech Stack:** Vanilla JavaScript (ES6+), Three.js r128, WebGL 1.0/2.0 GLSL shaders, Canvas 2D procedural vector textures, Web Audio API, Node.js 18+ zero-dependency build & CDP Headless Chrome E2E runner.

**Spec:** `docs/superpowers/specs/2026-11-07_minishoot-chibi-overhaul-design_v1.0.md`

## Global Constraints

- `src/logic/*.js` purity: zero references to `window`, `document`, `THREE`, or `Math.random()`.
- Canonical ship ID invariant: `moby_dick` (5), `thousand_sunny` (4), `oro_jackson` (4), `red_force` (3), `polar_tang` (3), `baratie` (3), and `going_merry` (2) remain immutable in state objects and `canonicalizeFleet()` SHA-256 hashes.
- Zero hardcoded visible strings in UI or render modules: every visible string in Brazilian Portuguese (`pt-BR`) lives exclusively in `src/logic/i18n.js` (`GLT.T`).
- Single-file twin build: `node scripts/build.js` must produce byte-identical `index.html` and `grand-line-tactics.html` depending externally only on `three.min.js` (r128) and Google Fonts.
- Performance budget: merge static hull, figurehead, and deck primitives per ship into a single `THREE.BufferGeometry` (`vertexColors: true`), keeping separate child nodes only for animated sails, cannons, lanterns, wake, and instanced crew.
- Mandatory web guidance: before editing HTML/CSS/DOM in Task 4, run `npx.cmd -y modern-web-guidance@latest search` & `retrieve` for dialogs/tabs/forms/accessibility.

## Review Focus

1. **Spectator or post-game `forfeit()` calls in Online PvP:** Calling `pvpClient.forfeit()` when `role === 'spectator'` or `state.phase !== 'playing'` must throw a descriptive error without publishing `GAME_OVER` or altering `state.winner`, and `#btn-abandon-ship` must not render for spectators (pinned in Task 1 & Task 4).
2. **Surrendering while CPU turn or shot-flight timers are pending:** Confirming surrender during `BATTLE` while `cpuTurnTimeout` or `shotFlightTimeout` is scheduled must immediately cancel all active timers via `clearTurnTimers()` so no delayed shot mutates the surrendered match or corrupts `seriesWins` (pinned in Task 4).
3. **Typing `?` in text inputs or opening Manual during Ceremony:** Pressing `?` or `F1` while focused on `<input>`, `<select>`, or `<textarea>` must not open the Manual, and opening/closing the Manual must never overwrite an active `CEREMONY` modal or clear placed ships in `SETUP` (pinned in Task 4).
4. **Missing or unknown `crewId` in `getCrewShipMeta` and `createShipMesh`:** Calling `getCrewShipMeta(undefined, 'thousand_sunny')` or `createShipMesh('moby_dick', { cellSize: 2.0 })` with no `crewId` (or an unknown string like `'pirates_unknown'`) must fall back cleanly to the ship's canonical crew or `'straw_hats'` without throwing or producing empty geometry (pinned in Task 1 & Task 3).
5. **Runtime switching between `cel_minishoot`, `pixel_retro`, and `raw_3d` across resizes:** Calling `postPipeline.setVisualStyle(...)` followed by `postPipeline.setSize(w, h)` must update texture filtering (`LinearFilter` vs `NearestFilter`), internal render target resolution, and uniforms (`uCelMode`, `uOutlines`, `uDither`, `uPaletteSnap`, `uGlowStrength`) cleanly without NaN dimensions or WebGL errors (pinned in Task 2 & Task 4).

---

### Task 1: Pure Logic, PT-BR Copy, Crew Fleet Metadata & PvP Forfeit Protocol

**Files:**
- Modify: `src/logic/i18n.js:760-865`
- Modify: `src/logic/rules.js:1265-1309`
- Modify: `src/logic/protocol.js:1014-1025`, `src/logic/protocol.js:1635-1655`
- Test: `tests/rules-test.js`, `tests/pvp-protocol.js`

**Interfaces:**
- Consumes: `SHIPS_MAP`, `CREWS_MAP` in `src/logic/rules.js`; `createEvent`, `foldMatchLog`, `PvpMatchClient` in `src/logic/protocol.js`.
- Produces:
  - `T.visualStyles`: `{ label, cel_minishoot: { name, desc }, pixel_retro: { name, desc }, raw_3d: { name, desc }, glowToggle }`
  - `T.crewFleets[crewId][shipId]`: `{ name: string, role: string }` for all 6 crews × 7 canonical ships (exact matrix from Spec §5.2.3).
  - `T.forfeit`: `{ abandonButton, abandonButtonAria, modalTitle, modalDescSingle, modalDescPvp, modalDescSeries(gameNum, seriesLen), cancelKeepFighting, confirmForfeit, abortWholeSeries, ceremonyPlayerForfeit, ceremonyEnemyForfeit(name), logPlayerForfeit, logEnemyForfeit(name) }`
  - `T.manual`: `{ triggerButton, triggerButtonAria, modalTitle, closeButton, tabs: { howToPlay, modesCrews, matchRules, onlineWifi, controlsSettings }, sections: { ... } }`
  - `GLT.rules.getCrewShipMeta(crewId, shipId) -> { id: string, crewId: string, name: string, role: string, length: number, isSubmarine: boolean }`
  - `GLT.rules.forfeitMatch(matchState, forfeitingPlayerIdx) -> { valid: boolean, outcome?: 'forfeit', winner?: 0|1, gameOverReason?: 'manual_forfeit', message: string }`
  - `PvpMatchClient.prototype.forfeit() -> Object` (publishes `GAME_OVER` with `{ seq, turn, winnerIndex, forfeitedBy, reason: 'manual_forfeit' }`).

- [ ] **Step 1: Write the failing unit tests in `tests/rules-test.js` and `tests/pvp-protocol.js`**

Append assertions in `tests/rules-test.js` verifying:
```javascript
test('getCrewShipMeta maps all 6 crews x 7 ships and falls back safely on unknown crewId', () => {
  const crews = ['straw_hats', 'whitebeard', 'red_haired', 'heart', 'blackbeard', 'marines'];
  const ships = ['moby_dick', 'thousand_sunny', 'oro_jackson', 'red_force', 'polar_tang', 'baratie', 'going_merry'];
  for (const cId of crews) {
    for (const sId of ships) {
      const meta = rules.getCrewShipMeta(cId, sId);
      assert.strictEqual(meta.id, sId);
      assert.strictEqual(meta.length, rules.SHIPS_MAP[sId].length);
      assert(meta.name && meta.name.length >= 3);
    }
  }
  assert.notStrictEqual(
    rules.getCrewShipMeta('marines', 'thousand_sunny').name,
    rules.getCrewShipMeta('straw_hats', 'thousand_sunny').name
  );
  const fallback = rules.getCrewShipMeta(undefined, 'thousand_sunny');
  assert.strictEqual(fallback.id, 'thousand_sunny');
  assert(fallback.name.includes('Thousand Sunny'));
});

test('forfeitMatch awards victory to opponent, increments seriesWins, and rejects duplicate forfeit', () => {
  const r = rng.createRng('forfeit-seed');
  const f0 = rules.autoPlaceFleet('escaramuca', r.fork('p0'));
  const f1 = rules.autoPlaceFleet('escaramuca', r.fork('p1'));
  const st = rules.createMatchState({ seed: 'forfeit-seed', boardId: 'escaramuca', seriesLength: 3, crews: ['straw_hats', 'marines'], fleets: [f0, f1] });
  const res = rules.forfeitMatch(st, 0);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(st.gameOver, true);
  assert.strictEqual(st.winner, 1);
  assert.strictEqual(st.gameOverReason, 'manual_forfeit');
  assert.strictEqual(st.seriesWins[1], 1);
  const dup = rules.forfeitMatch(st, 0);
  assert.strictEqual(dup.valid, false);
});
```

Append an async scenario in `tests/pvp-protocol.js` verifying:
- Active player calling `clientA.forfeit()` transitions both `clientA` and `clientB` to `phase === 'game_over'`, `winner === 1`, `gameOverReason === 'manual_forfeit'`, `forfeitedBy === 0`, auto-publishes `FLEET_REVEAL` from both players, and resolves `waitForIntegrity()` with `valid === true` (zero false cheat alerts).
- Spectator (`role: 'spectator'`) or already-finished client calling `forfeit()` throws an Error and does not alter `winner`.

- [ ] **Step 2: Run both test suites to verify they fail**

Run: `node tests/rules-test.js; node tests/pvp-protocol.js`
Expected: FAIL (`rules.getCrewShipMeta is not a function` / `clientA.forfeit is not a function`).

- [ ] **Step 3: Implement `T.visualStyles`, `T.crewFleets`, `T.forfeit`, and `T.manual` in `src/logic/i18n.js`**

Populate complete, idiomatic `pt-BR` strings in `src/logic/i18n.js` matching Spec §5.2.3, §5.3, and §5.4 (all 6×7 faction ship names, surrender confirmation dialogs, and 5 rich manual sections).

- [ ] **Step 4: Implement `getCrewShipMeta` and `forfeitMatch` in `src/logic/rules.js` and `forfeit()` in `src/logic/protocol.js`**

- In `src/logic/rules.js`: export `getCrewShipMeta(crewId, shipId)` and `forfeitMatch(matchState, forfeitingPlayerIdx)`. Note: for `heart` crew, mark submarine-styled slots (`moby_dick`, `thousand_sunny`, `polar_tang`, `going_merry`) with `isSubmarine: true` in returned visual metadata while keeping `SHIPS_MAP[shipId]` untouched.
- In `src/logic/protocol.js`: in `foldMatchLog` (`case 'GAME_OVER'`), ignore duplicate `GAME_OVER` events once `state.phase === 'game_over'`, record `state.forfeitedBy = typeof ev.forfeitedBy === 'number' ? ev.forfeitedBy : null`, and implement `PvpMatchClient.prototype.forfeit()` throwing if `this.role !== 'player'` or `this.state.phase !== 'playing'`.

- [ ] **Step 5: Run tests and verify purity & pass status**

Run: `node tests/rules-test.js; node tests/pvp-protocol.js`
Expected: PASS (`47/47`+ in `rules-test.js`, `17/17`+ in `pvp-protocol.js`, exit code `0`).

- [ ] **Step 6: Commit Task 1**

```powershell
git add src/logic/i18n.js src/logic/rules.js src/logic/protocol.js tests/rules-test.js tests/pvp-protocol.js
git commit -m "feat(logic): add crew fleet metadata, PvC/PvP forfeit rules, and PT-BR manual copy"
```

---

### Task 2: *Minishoot' Adventures* Cel-Diorama Shader, Rounded Sea Markers & Neon Arcade FX

**Files:**
- Modify: `src/render/palette-shader.js:240-755`
- Modify: `src/render/plates-lighting.js:1650-2040`
- Modify: `src/render/backdrop-fx.js:1150-1650`
- Create: `tests/render-chibi-test.js`

**Interfaces:**
- Consumes: `THREE` (r128 compatible), `GLT.paletteShader`, `GLT.platesLighting`, `GLT.backdropFx`.
- Produces:
  - `createPostPipeline(renderer, scene, camera, opts)` supporting `opts.visualStyle` (`'cel_minishoot'` default, `'pixel_retro'`, `'raw_3d'`) and `opts.glow` (`true` default), plus methods:
    - `pipeline.setVisualStyle(style: 'cel_minishoot' | 'pixel_retro' | 'raw_3d')`
    - `pipeline.setGlow(enabled: boolean)`
    - `pipeline.getVisualStyle() -> string`
  - Upgraded smooth circular/toroidal foam, twin-ring glowing target reticle, rounded shot markers in `plates-lighting.js`, and glowing energy-orb cannonballs + dual shockwave impact rings in `backdrop-fx.js`.

- [ ] **Step 1: Create `tests/render-chibi-test.js` with failing shader & FX assertions**

Create `tests/render-chibi-test.js` loading `three` (or a lightweight mock WebGL/THREE harness matching existing headless checks) to assert:
- `POST_FRAGMENT_SHADER` declares `uCelMode` and `uGlowStrength`.
- `createPostPipeline` defaults to `visualStyle === 'cel_minishoot'`, `pixelSize === 1`, `uCelMode.value === 1.0`, `uDither.value === 0.0`, `uOutlines.value === 1.0`, `uGlowStrength.value > 0`, and `renderTarget.texture.magFilter === THREE.LinearFilter`.
- Switching `pipeline.setVisualStyle('pixel_retro')` sets `pixelSize === 2`, `uCelMode.value === 0.0`, `uPaletteSnap.value === 1.0`, `uDither.value === 1.0`, `magFilter === THREE.NearestFilter`, and `pipeline.setSize(1280, 720)` updates `uResolution` to `(640, 360)` without error; switching back to `'cel_minishoot'` restores `(1280, 720)` and `LinearFilter`.

- [ ] **Step 2: Run `node tests/render-chibi-test.js` to verify it fails**

Run: `node tests/render-chibi-test.js`
Expected: FAIL (`pipeline.setVisualStyle is not a function` / missing `uCelMode`).

- [ ] **Step 3: Implement `cel_minishoot` GLSL cel-ramp, Sobel ink outlines & selective glow bloom in `src/render/palette-shader.js`**

- Add uniforms `uCelMode` (`1.0` default) and `uGlowStrength` (`0.55` default).
- In `POST_FRAGMENT_SHADER`:
  - Upgrade edge detection to an 8-neighbor Sobel/cross depth + luminance ink outline (`#081121`) so `1x` native silhouettes have smooth, continuous *Minishoot'* dark ink borders.
  - When `uCelMode > 0.5`: bypass the 90-color Nearest-Neighbor loop and Bayer dither; instead convert color to OKLab, apply soft 4-band cel luminance stepping (`smoothstep`-blended plateaus so curves look silky rather than jagged), boost chroma slightly (`1.12x`) for vibrant toy colors, and add an 8-tap radial glow halo sampling neighbors whose luminance exceeds `0.76` scaled by `uGlowStrength`.
  - Implement `setVisualStyle(style)` and `setGlow(enabled)` updating `renderTarget.texture.minFilter`/`magFilter` (`needsUpdate = true`), `pixelSize`, and uniforms.

- [ ] **Step 4: Upgrade sea-plate water palette, smooth foam/markers & arcade projectiles in `src/render/plates-lighting.js` and `src/render/backdrop-fx.js`**

- In `plates-lighting.js`:
  - Tune `_colAbyss`..`_colPeak` to vibrant sunlit *Minishoot'* ocean tones (`#0a274d` -> `#11467a` -> `#166ea8` -> `#1ca3c9` -> `#4be0dc`).
  - Replace square `BoxGeometry` foam cells, shot markers (`water`, `hit`, `sunk`), and `selectionReticle`/`hoverCursor` with smooth cylindrical/toroidal/spherical geometries and bright emissive rims (`#38f8ff`, `#ff6b35`, `#ffd166`) that trigger the shader's selective glow halo.
- In `backdrop-fx.js`:
  - Upgrade `fireCannonball`, `spawnWaterSplash`, and `spawnHitExplosion` to render a white-hot inner core + saturated coral/cyan outer glow orb, smooth tapered trail, and crisp expanding dual `TorusGeometry` shockwave rings on impact.

- [ ] **Step 5: Run `node tests/render-chibi-test.js` to verify it passes**

Run: `node tests/render-chibi-test.js`
Expected: PASS (exit code `0`).

- [ ] **Step 6: Commit Task 2**

```powershell
git add src/render/palette-shader.js src/render/plates-lighting.js src/render/backdrop-fx.js tests/render-chibi-test.js
git commit -m "feat(render): implement Minishoot cel-diorama shader, ink outlines, and glowing arcade FX"
```

---

### Task 3: Curved 3D Chibi Toy Fleet & 6-Faction Sculpting Engine (`ships-voxel.js`)

**Files:**
- Modify: `src/render/ships-voxel.js:1-1405`
- Test: `tests/render-chibi-test.js`

**Interfaces:**
- Consumes: `THREE` (r128), `GLT.rules.getCrewShipMeta` (optional runtime lookup with standalone fallback).
- Produces (preserving existing public names on `GLT.shipsVoxel` so callers don't break, while adding `crewId` support):
  - `GLT.shipsVoxel.CREW_FLEET_STYLES`: `Record<CrewId, Record<ShipId, ChibiShipStyle>>`
  - `GLT.shipsVoxel.createShipMesh(shipId, options = { cellSize, ownerColor, crewId, isGhost }) -> THREE.Group`
  - `GLT.shipsVoxel.createGhostShipMesh(shipId, options = { cellSize, ownerColor, crewId }) -> THREE.Group`
  - `GLT.shipsVoxel.getCrewJollyRogerTexture(crewId, shipId, sailVariant) -> THREE.CanvasTexture | null`
  - Preserved hooks: `setShipDamage`, `startShipSinking`, `updateShip`, `SHIPS_VOXEL_CONFIG`, `getJollyRogerTexture`.

- [ ] **Step 1: Expand `tests/render-chibi-test.js` with failing 6×7 Chibi Fleet geometry & distinctness tests**

Add tests in `tests/render-chibi-test.js` using a minimal geometry-capable `THREE` stub or loaded Three.js context asserting:
- `CREW_FLEET_STYLES` defines distinct visual configs (`hullPrimary`, `hullSecondary`, `figurehead`, `sailEmblem`, `deckStyle`) for all `6` crews × `7` canonical ships (`42` combinations).
- For any canonical `shipId` (e.g., `'thousand_sunny'`, `'moby_dick'`, `'going_merry'`), `createShipMesh(shipId, { cellSize: 2.0, crewId: 'marines' })` and `createShipMesh(shipId, { cellSize: 2.0, crewId: 'straw_hats' })` produce valid `hullMesh` `BufferGeometry` instances with non-empty `position`, `normal`, and `color` attributes, zero `NaN` floats, and **different** vertex color signatures and figurehead metadata (`mesh.userData.figurehead` / `mesh.userData.crewId`).
- Calling `createShipMesh('thousand_sunny', { cellSize: 2.0 })` (no `crewId`) or `createShipMesh('thousand_sunny', { crewId: 'invalid_crew' })` succeeds without error and defaults to `'straw_hats'`.
- `setShipDamage`, `startShipSinking`, and `updateShip` execute cleanly on chibi meshes across both surface ships and `isSubmarine: true` Heart/Polar Tang ships.

- [ ] **Step 2: Run `node tests/render-chibi-test.js` to verify new tests fail**

Run: `node tests/render-chibi-test.js`
Expected: FAIL (`CREW_FLEET_STYLES` undefined / identical geometry across `crewId`).

- [ ] **Step 3: Implement `ChibiMeshBuilder`, 10 expressive figureheads, curved billowing sails & `6×7` `CREW_FLEET_STYLES` in `src/render/ships-voxel.js`**

- Build `ChibiMeshBuilder` capable of baking transformed Three.js smooth primitives (ellipsoids/spheres, tapered cylinders, toruses, capsules, lathe/ribbed curved chibi hulls) with per-part vertex colors into a single merged `BufferGeometry` for the hull + cabin + portholes + bow figurehead.
- Sculpt the 10 chibi figureheads/prows from Spec §5.2.2 (`sunny_lion`, `merry_sheep`, `baratie_fish`, `garp_dog`, `marine_ironclad`, `moby_whale`, `ace_flame`, `shanks_dragon`, `law_submarine`, `teach_lograft`) with oversized toy proportions matching `references/2026-11-07_chibi-ships-reference_v1.0.webp`.
- Build curved parabolic `PlaneGeometry(w, h, 12, 8)` sails + striped aft sails and `128×128` crisp vector Canvas2D faction emblems (`straw_hats` skull with straw hat, `marines` blue gull + `"MARINE"`/`"海軍"` banner, `whitebeard` crescent mustache cross, `red_haired` twin-scar skull & crossed sabers, `heart` smiling barred circle, `blackbeard` 3-skull crossbones).
- Replace stepped square waterline blocks with smooth oval chibi foam wake rings and round chibi crew figures dressed in each faction's colors (e.g., white Marine coats & caps, orange Heart jumpsuits, dark pirate coats, Straw Hat vests).
- Wire `crewId` into `shipGroup.userData.crewId`, `shipGroup.userData.figurehead`, `shipGroup.userData.isSubmarine`, and sunk buoy flags (`getCrewJollyRogerTexture(u.crewId, u.shipId)`).

- [ ] **Step 4: Run `node tests/render-chibi-test.js` to verify all 42 faction ships pass**

Run: `node tests/render-chibi-test.js`
Expected: PASS (exit code `0`, zero `NaN` vertices, all 42 configs verified).

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/render/ships-voxel.js tests/render-chibi-test.js
git commit -m "feat(ships): sculpt curved 3D chibi vessels and figureheads for all 6 crews"
```

---

### Task 4: UI Integration, "Abandonar o Navio", 5-Tab "Manual do Jogo", Build & Full E2E Verification

**Files:**
- Modify: `src/ui/ui.js:95-155`, `src/ui/ui.js:320-375`, `src/ui/ui.js:625-720`, `src/ui/ui.js:1215-1265`, `src/ui/ui.js:1770-1810`, `src/ui/ui.js:2205-2420`, `src/ui/ui.js:3285-3475`, `src/ui/ui.js:4020-4255`
- Modify: `scripts/build.js` (CSS styles for cel-diorama UI polish, `#btn-abandon-ship`, `#btn-open-manual`, `.glt-manual-modal`)
- Modify: `tests/e2e-gameplay-verify.js`
- Modify: `package.json`, `CHANGELOG.md`, `README.md`
- Regenerate: `index.html`, `grand-line-tactics.html`, `references/captures/*.png`

**Interfaces:**
- Consumes: `T.visualStyles`, `T.crewFleets`, `T.forfeit`, `T.manual` (`i18n.js`); `GLT.rules.getCrewShipMeta`, `GLT.rules.forfeitMatch` (`rules.js`); `PvpMatchClient.prototype.forfeit` (`protocol.js`); `postPipeline.setVisualStyle`, `postPipeline.setGlow` (`palette-shader.js`); `createShipMesh(..., { crewId })` (`ships-voxel.js`).
- Produces:
  - `UIController.visualStyle` (`'cel_minishoot'` default), `UIController.glow` (`true` default), `UIController.openManualModal(initialTabId?)`, `UIController.showAbandonShipModal()`, `UIController.confirmAbandonShip(abortWholeSeries?)`.
  - Rebuilt single-file artifacts `index.html` & `grand-line-tactics.html` (`v2.0.0`).

- [ ] **Step 1: Consult `modern-web-guidance` for accessible modal dialogs, tablists, and button ergonomics**

Run:
```powershell
npx.cmd -y modern-web-guidance@latest search "accessible modal dialog tabs focus management keyboard"
```
Retrieve the top relevant topic(s) via `npx.cmd -y modern-web-guidance@latest retrieve <id>` and apply their patterns to the Manual & Surrender dialogs.

- [ ] **Step 2: Add failing E2E tests in `tests/e2e-gameplay-verify.js`**

Extend `tests/e2e-gameplay-verify.js` with checks covering:
1. **Default *Minishoot'* Visual Style & Settings Switching:** `GLT.ui.visualStyle === 'cel_minishoot'`, `GLT.ui.pixelSize === 1`, `#sel-visual-style` exists with `<label for="sel-visual-style">`, and switching `'pixel_retro'` -> `'raw_3d'` -> `'cel_minishoot'` updates `postPipeline` cleanly without console/WebGL errors.
2. **Dynamic Crew Fleet Transformation (Setup & 3D):** Switching crew from `straw_hats` to `marines` updates `.glt-ship-dock-item` labels to Marine vessel names (`getCrewShipMeta('marines', ...)`) AND rebuilds `GLT.ui.playerShipMeshes` with `userData.crewId === 'marines'`.
3. **5-Tab Game Manual Modal & Input Guards:** Clicking `#btn-open-manual` opens `.glt-manual-modal` with 5 accessible `[role="tab"]` buttons, `ArrowRight` switches tabs and updates `[role="tabpanel"]`, typing `?` inside `#inp-pvp-nick` does NOT open the manual, and opening/closing the manual during `SETUP` or `BATTLE` preserves placed ships and pauses/resumes offline turn countdown cleanly.
4. **"Abandonar o Navio" Surrender Flow (PvC MD3 + Pending Timer Guard + Online PvP + Spectator Guard):**
   - In PvC `BATTLE` (`seriesLength = 3`), clicking `#btn-abandon-ship` opens confirmation dialog (does NOT end battle on 1st click); confirming while CPU turn timer is active cancels timers cleanly, sets `gameOverReason === 'manual_forfeit'`, awards `+1` series win to CPU (`seriesWins[1] === 1`), and transitions to `CEREMONY` without delayed CPU shots firing afterward.
   - In 2-tab Online PvP `BATTLE`, clicking `#btn-abandon-ship` -> `#btn-confirm-abandon` in Tab 1 transitions both Tab 1 and Tab 2 to `CEREMONY` with `winner === 1`, `gameOverReason === 'manual_forfeit'`, and verified SHA-256 integrity (`valid === true`).
   - Spectator client (`pvpRole === 'spectator'`) does not see `#btn-abandon-ship`.

- [ ] **Step 3: Build & run `node tests/e2e-gameplay-verify.js` to confirm new E2E checks fail**

Run: `node scripts/build.js; node tests/e2e-gameplay-verify.js`
Expected: FAIL on the new `v2.0` checks (`#btn-open-manual` / `#btn-abandon-ship` / `cel_minishoot` not yet wired in `ui.js`).

- [ ] **Step 4: Implement UI wiring, Manual modal, Surrender modal & CSS polish in `src/ui/ui.js` and `scripts/build.js`**

- **Visual Style & Pipeline (`ui.js`):** Default `visualStyle: 'cel_minishoot'`, `pixelSize: 1`, `outlines: true`, `dither: false`, `glow: true`. Pass `visualStyle` and `glow` to `createPostPipeline`. Add `<select id="sel-visual-style">` and `<input type="checkbox" id="chk-glow">` with explicit `<label for>` in `renderSettingsTab()`.
- **Crew Fleet Wiring (`ui.js`):** Pass `crewId: this.matchConfig.crewId` in `syncPlayerFleetTo3d()` and `crewId: this.matchConfig.enemyCrewId` in `createEnemyGhostShip()`. Use `GLT.rules.getCrewShipMeta(crewId, ship.id).name` in Ship Dock (`renderGameplayTab`), `renderFleetTab`, and sunk announcements. When `#sel-enemy-crew` changes, keep `enemyCrewId` updated.
- **Abandon Ship (`ui.js`):** Render `#btn-abandon-ship` inside a `.glt-battle-secondary-bar` at the bottom of `.glt-battle-panel` whenever `gamePhase === 'BATTLE'` and `(!this.isPvpMode || this.pvpRole === 'player')`. Implement `showAbandonShipModal()` (initial focus on `Continuar lutando`) and `confirmAbandonShip(abortSeries)`:
  - Calls `this.clearTurnTimers()` immediately.
  - If `abortSeries` in PvC: calls `this.returnToSetupPhase()`.
  - Else if `this.isPvpMode && this.pvpClient`: calls `this.pvpClient.forfeit()`.
  - Else in PvC: calls `GLT.rules.forfeitMatch(this.matchState, 0)`, logs to Logbook, and calls `this.launchCeremonyPhase()`.
  - In `launchCeremonyPhase()`, display `T.forfeit.ceremonyPlayerForfeit` / `T.forfeit.ceremonyEnemyForfeit` subtitle when `gameOverReason === 'manual_forfeit'`.
- **Manual Modal (`ui.js`):** Add `#btn-open-manual` (`📖 Manual`) to `quickTools` in `buildDomStructure`. Bind `?` and `F1` in `initInputControls` (skipping when `ev.target` matches `INPUT`, `SELECT`, `TEXTAREA`, or `isContentEditable`, and ignoring if `gamePhase === 'CEREMONY'` modal is open unless triggered via its own non-destructive layer — better yet: mount a dedicated `#glt-manual-overlay` element separate from `#glt-modal-overlay` so opening/closing the Manual NEVER clobbers Ceremony or Room Selector modals!). Pause offline turn countdown while `#glt-manual-overlay` is open and resume on close. Implement roving `ArrowLeft`/`ArrowRight` across the 5 manual tabs.
- **CSS Polish (`scripts/build.js`):** Style `.glt-manual-overlay`, `.glt-manual-tabs`, `.glt-manual-card-grid`, `.glt-battle-secondary-bar`, `.btn-danger-outline`, and crisp *Minishoot'* ink-framed cards/buttons across both `glt-theme-dark` and `glt-theme-light`.

- [ ] **Step 5: Update `package.json`, `CHANGELOG.md`, `README.md`, rebuild artifacts, refresh captures & run full verification**

- Update `package.json` version to `"2.0.0"`, document `[2.0.0] - 2026-11-07` in `CHANGELOG.md`, and update `README.md` highlights/shortcuts.
- Run:
```powershell
node scripts/build.js
node tests/rules-test.js
node tests/pvp-protocol.js
node tests/render-chibi-test.js
node tests/e2e-gameplay-verify.js
node tests/lan-e2e-verify.js
node scripts/capture-scene.js
node scripts/verify-index.js
```
Expected: `index.html` and `grand-line-tactics.html` byte-identical, **0 failures** across all 5 test suites, and all 10 reference captures regenerated in the new *Minishoot'* + Chibi Fleet visual style.

- [ ] **Step 6: Commit `v2.0.0` release and tag**

```powershell
git add -A
git commit -m "feat(v2.0): deliver Minishoot cel-diorama, 6-crew chibi fleets, surrender flow, and game manual"
git tag -a v2.0.0 -m "Grand Line Tactics v2.0.0 — Minishoot Cel-Diorama, Frotas Chibi por Tripulacao, Rendicao e Manual"
```
