# Grand Line Tactics — ARCHITECTURE (binding contract)

This file is the contract between nine parallel builders (areas `logic`, `net`, `ui`, `render`, `world`, `ships`, `fx`, `audio`, `app`).
It wins over any builder's own preference. SPEC.md wins over this file on *product* questions. If something here contradicts SPEC.md, say so in your summary; don't silently diverge.

Notation: TypeScript-like signatures. `?` marks an optional argument or field. `→` means "returns". Every type named in `CapitalCase` is defined in §4.

---

## Current contract (2026-11, evolve mode) — read before §0

This block wins over §0–§16 wherever they disagree. §0–§16 describe the original nine-builder plan and the `tools/` build. They stay as the API reference for `GLT.*` namespaces and for the capture harness.

- **Track / engine:** `game-3d`, installable PWA. three.js **r128** global from cdnjs (pinned; no upgrade without an operator decision).
- **Frozen web rules:** [`docs/web-guidance-rules.md`](docs/web-guidance-rules.md).
- **Shipping build:** `node scripts/build.js` → single-file `index.html` (+ `grand-line-tactics.html`), `sw.js` from `src/sw/sw.js`. All CSS lives in `getStyles()` inside `scripts/build.js`. The controller is `GLT.ui` in `src/ui/ui.js`.
- **`tools/` and `legacy/`:** capture harness (`?demo=&t=`), shots, smoke, trailer and the old multi-script build. They are kept and still used by `npm run smoke|baseline|trailer|build:demo|test:legacy`, but nothing in them ships.

### Ownership (disjoint)

| Area | Files | Rule |
|---|---|---|
| `logic` | `src/logic/**`, `tests/rules-test.js`, `tests/pvp-protocol.js`, `tests/sim-headless.js` | Zero DOM/THREE, no `Math.random` (seeded `GLT.rng`). Runs in Node. |
| `net` | `src/net/**`, `scripts/lan-server.js`, `tests/peer-transport-test.js`, `tests/lan-server-test.js`, `tests/artifact-db-test.js` | Protocol core stays headless. Browser globals (`window.__GLT_LAN_CONFIG__`, `BroadcastChannel`, `localStorage`, `EventSource`, `fetch`) are guarded with `typeof` today. Moving them behind an injected adapter is Onda 2. |
| `render` | `src/render/**`, `src/world/**`, `src/sea/**`, `src/ships/**`, `src/fx/**`, `src/pilot-render/**`, `src/audio/**` | Reads state and events; never mutates rules. Honours R3 (reduced motion). |
| `ui` | `src/ui/**`, the CSS in `getStyles()` (`scripts/build.js`) | Accessible HUD, lobby, QR, fleet tab. Honours R1, R2, R5. Splitting `ui.js` is Onda 2. |
| `pwa` | `manifest.webmanifest`, `src/sw/sw.js`, `assets/icons/**`, `src/ui/app-shell.js` | Page network-first, assets and CDN cache-first per deploy version. Never cache the relay API or PeerJS signalling. |
| `app` | `scripts/build.js` (except `getStyles()`), `package.json`, `index.html` output | Wiring and build. Edited only by the integrator step. |
| `mobile` | — | Inactive (`target_mobile_wrapper: none`). TWA is Onda 3. |

Cross-area changes go to the integrator as `requests_for_other_areas`; no area edits another's files.

### Preserved (do not rewrite)

`src/logic/**` and its suites, the commit-reveal PvP protocol, the LAN relay, the single-file build and Pages deploy, the PWA shell, and every Playwright suite (`e2e`, `lan`, `lan:real`). Every change keeps `npm test` green.

---

## 0. Ground rules (read first)

1. **Ownership.** You own `src/<your-area>/**`, `tests/<your-area>.*.test.mjs`, `dist/<your-tag>.html`, `shots/<your-area>/**`. You never edit anything else. The architect owns `ARCHITECTURE.md` and `tests/contract.*.test.mjs`. The tools agent owns `tools/**`, `package.json` and `progress/**`. `tests/run.mjs` is shared infrastructure whose interface is fixed by `tools/README.md` and §15; nobody else edits it. If you need a change in someone else's file (a missing i18n key, an API addition, a bug), **write it in your summary** under a heading "Requests for other areas", naming the file and the exact change.
2. **Module shape.** Each file is a classic script wrapped in an IIFE that attaches **one** namespace:
   ```js
   (function () {
     'use strict';
     const GLT = (globalThis.GLT = globalThis.GLT || {});
     // private helpers ...
     GLT.board = { /* public API */ };
   })();
   ```
   The only exception is `ui/i18n.js`, which defines `GLT.i18n` and the alias `GLT.T`. Demo registration (`GLT.demos[...] = fn`, §13) is allowed in any visual module, in addition to its namespace.
3. **No load-time side effects.** At the top level of the IIFE you may only define functions and constants, assign your namespace, and register demos. Do **not** touch `THREE`, `window`, `document`, `navigator`, `localStorage`, `requestAnimationFrame`, `AudioContext`, `crypto` or **any other `GLT.*` namespace** at load time. Resolve everything at call time (inside `init()` or lazily). The only load-time exception is `app/main.js` registering its `DOMContentLoaded` boot listener, guarded by `typeof document`. The test `tests/contract.load.test.mjs` loads **every** `src/**/*.js` file into a bare VM (no DOM, no THREE) and fails if any file throws. That keeps file order inside an area irrelevant, though the build has one (`_` files first, then alphabetical, plus `// @after`; §1).
4. **Pure areas.** `logic/` and `net/` never reference the DOM or THREE, not even at call time. Two exceptions: `net/transport-host.js` reads `globalThis.claude` inside `probe()` only, and `GLT.lobby.shareLink()` reads `location`/`document.referrer` when they exist (guarded with `typeof`, so tests pass `base`). They must run in Node through `tests/run.mjs`.
5. **Private files.** You may add files to your own area. A private file attaches a namespace named `GLT._<area>_<name>` (for example `GLT._world_rocks`), and no other area may use it.
6. **Strings.** Every player-visible string, aria-label, title/tooltip, log line, error and canvas-drawn word comes from `GLT.T(key, vars)` (§12). No literal PT-BR (or English) UI text anywhere else. Coordinates (`A`–`L`, `1`–`12`) come from `GLT.board.label()` and are not translated.
7. **Randomness.** Anything that can change an outcome uses `GLT.rng` seeded from the match seed. `Math.random` is forbidden in `logic/` and `net/`. Visual modules must also use `GLT.rng.create(seed)` for cosmetic randomness, so a frozen `?t=` demo is reproducible. Entropy for *new* seeds, salts, nonces and ids comes from `GLT.rng.randomSeed()` / `GLT.commit.*` (`crypto.getRandomValues`).
8. **No console noise.** No `console.error` and no uncaught exceptions. `tools/shot.mjs` fails on either. Don't `console.log` in shipped code paths. `console.warn` is tolerated in dev only.
9. **Runtime deps.** three.js **r128** from cdnjs (`https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`, global `THREE`) and Google Fonts. Nothing else. No `examples/jsm` helpers: write your own (there is no `BufferGeometryUtils` in r128 core).
10. **API stability.** Signatures in this file are frozen. You may **add** functions or fields to your own namespace. You may not rename, remove or change the meaning of a listed one. Everything listed must exist, even as an inert stub, from the start: the stubs already do that.

---

## 1. Build, HTML shell, run modes (the toolchain is the tools agent's; see `tools/README.md`)

* Build: `node tools/build.js --out dist/<tag>.html [--only area,area] [--vendor]`. The area order is fixed: `logic, net, ui, render, world, ships, fx, audio, app`. **Order inside an area:** files starting with `_` first, then alphabetical; a file may declare `// @after a.js, b.js` in its first 10 lines. `ui/i18n.js` is always included and comes first in `ui`. All `src/ui/*.css` files are inlined. Each module becomes its own `<script>` with `//# sourceURL=glt/<area>/<file>`, and a syntax error fails the build loudly.
* `--only a,b` expands dependencies (world/ships/fx pull logic+render; app pulls everything). three.js r128 is linked from cdnjs only when render/world/ships/fx/app are in the build. `--vendor` inlines `tools/vendor/three.min.js` for offline/test builds; **never ship a vendored build**.
* For screenshots, **build everything** (no `--only`), because the demo wrapper lives in `app/main.js` and needs `render/`.
* The emitted page is `<!doctype html><html lang="pt-BR">` with charset/viewport, the title, the Google Fonts link (**Pirata One, Pixelify Sans 400–700, Press Start 2P**), the inlined CSS, `<body><div id="app"></div>` (if `src/ui/body.html` exists, ui may replace the body but **must keep `#app`**), three.js, the harness prelude, every module, then the harness runner.
* **Harness (`tools/harness.js`, `tools/harness-run.js`, not modules).** The prelude defines `GLT.params = {demo, angle, elev, zoom, tod, seed, t}` (numbers parsed, `undefined` if absent), `GLT.demos = {}` and a provisional `GLT.clock()`. `render/clock.js` replaces it with the callable `GLT.clock` of §10.1 (`GLT.clock()` still returns seconds, frozen at `?t=`). On `DOMContentLoaded` the runner calls `GLT.demos[GLT.params.demo](harnessCtx)` and sets `window.GLT_READY = true` when the demo resolves. A throw, rejection or unknown name sets `GLT_ERROR` and logs a `console.error`, so `shot.mjs` exits 1.
* Boot: `app/main.js` registers its `DOMContentLoaded` handler before the harness runner's, guarded by `typeof document !== 'undefined'`. With `?demo=` it does **not** start the game. It only wraps the requested demo (§13), and the harness then runs it. Without `?demo=` it boots the game and sets `window.GLT_READY = true` itself once fonts are ready and two frames have been drawn.
* If `THREE` is missing or WebGL fails (`GLT.renderer.init()` returns `false`), the game still runs on the 2D grids (§11, `grid2d`), and `GLT.ui.toast('error.webgl')` explains why.
* Screenshots: `node tools/shot.mjs --html dist/<tag>.html --demo <name> --angle 45 --elev 35 --zoom 1 --tod day --t 2 --out shots/<area>/x.png` (`--viewport 390x844` for phone width, `--sequence "0,0.5,1"` for several `t`, `--eval "js"` to read state). It writes a sibling `.console.json` and exits 1 on any console error or pageerror. Without `--demo` it shoots the real app.

---

## 2. Ownership map: files and namespaces

| Area | File | Namespace | One-line purpose |
|---|---|---|---|
| logic | `logic/consts.js` | `GLT.C` | All numeric constants: world sizes, timings, net timings (§9) |
| logic | `logic/events.js` | `GLT.events` | Synchronous event bus (§7) |
| logic | `logic/rng.js` | `GLT.rng` | mulberry32 RNG, seed hashing/mixing |
| logic | `logic/data.js` | `GLT.data` | Static tables: ships, crews, formats, seas, difficulties, techniques, reactions, sample fleets |
| logic | `logic/layout.js` | `GLT.layout` | Cell↔world mapping, plate geometry, ship transforms, sectors (§9) |
| logic | `logic/board.js` | `GLT.board` | Coordinates, labels, placement validation, canonical fleet JSON |
| logic | `logic/rules.js` | `GLT.rules` | Rules defaults/normalisation, format lookup, sea effects |
| logic | `logic/engine.js` | `GLT.engine` | Pure game reducer + series + answers + views (§5) |
| logic | `logic/ai.js` | `GLT.ai` | CPU placement, shot choice, hints, think time |
| logic | `logic/stats.js` | `GLT.stats` | Per-game stats, bounty formula |
| logic | `logic/taunts.js` | `GLT.taunts` | Picks CPU taunt i18n keys |
| logic | `logic/sim.js` | `GLT.sim` | Headless CPU-vs-CPU runner for tests/report |
| net | `net/commit.js` | `GLT.commit` | WebCrypto SHA-256 commitments, salts, nonces |
| net | `net/protocol.js` | `GLT.protocol` | Move-log events, ordering, fold, duties, verification (§6) |
| net | `net/lobby.js` | `GLT.lobby` | Room codes, share links, pseudonymous nicknames, player id |
| net | `net/transport-mem.js` | `GLT.transportMem` | In-memory Transport hub with fault injection (tests) |
| net | `net/transport-host.js` | `GLT.transportHost` | Transport over the host's `db` + `room` + `user` (§14) |
| net | `net/session.js` | `GLT.session` | One PvP client: lobby, publishing, auto-answers, liveness, rejoin |
| ui | `ui/i18n.js` | `GLT.i18n`, `GLT.T` | Dictionary, plurals, pt-BR number/Berry/time formatting (§12) |
| ui | `ui/theme.js` | `GLT.theme` | Light/dark/auto theme |
| ui | `ui/shell.js` | `GLT.ui` | DOM skeleton, screens, aria-live announcer, toasts |
| ui | `ui/menu.js` | `GLT.menuUi` | Mode/crew/rival/difficulty/format/series/rules/sea selectors |
| ui | `ui/setup.js` | `GLT.setupUi` | Fleet placement (2D grid + 3D picking), rotate/auto/random/clear/Pronto |
| ui | `ui/grid2d.js` | `GLT.grid2d` | Accessible 2D grid component (keyboard, screen reader, fallback) |
| ui | `ui/hud.js` | `GLT.hud` | Scoreboard bug, turn timer, FOGO!, technique, Log Pose hint, camera/speed bar |
| ui | `ui/logbook.js` | `GLT.logbook` | "Diário de bordo" play-by-play feed |
| ui | `ui/stats.js` | `GLT.statsUi` | Stats screen + box score |
| ui | `ui/lobby.js` | `GLT.lobbyUi` | PvP lobby, reactions bar, net status, "Mais procurados" |
| ui | `ui/settings.js` | `GLT.settingsUi` | Settings drawer (pixel size, toggles, audio, theme, lift…) |
| ui | `ui/ceremony.js` | `GLT.ceremonyUi` | Ceremony overlay (WANTED poster, skip) |
| ui | `ui/wanted.js` | `GLT.wanted` | Procedural pixel WANTED poster on a 2D canvas |
| ui | `ui/*.css` | n/a | Tokens (`base.css`), layout, components |
| render | `render/clock.js` | `GLT.clock` | RAF loop, game time, speed/pause/freeze/simulate, timers |
| render | `render/palette.js` | `GLT.palette` | 90-colour OKLab palette + named roles |
| render | `render/voxel.js` | `GLT.voxel` | Voxel builder → merged meshes, instancing, shared materials |
| render | `render/renderer.js` | `GLT.renderer` | WebGL, low-res target, post (outlines, palette snap, Bayer dither) |
| render | `render/camera.js` | `GLT.camera` | Ortho iso camera, pixel snap, view modes, drag/pinch input |
| render | `render/lighting.js` | `GLT.lighting` | Time of day (day/dusk/night/storm), sun/shadows, fog, flashes |
| render | `render/scene.js` | `GLT.scene` | THREE.Scene, layers, frame hook |
| render | `render/picking.js` | `GLT.picking` | Pointer → plate cell, emits `cell:*` events |
| world | `world/ocean.js` | `GLT.ocean` | Open sea around the plates, sky dome/horizon |
| world | `world/plates.js` | `GLT.plates` | Two sea-plates: voxel water cells, swell, foam, rims, strata, waterfalls, markers |
| world | `world/backdrop.js` | `GLT.backdrop` | 8-sector scenery ring + doll's-house lift |
| world | `world/props.js` | `GLT.props` | Log Pose buoy, torch buoys, lighthouse, Den Den Mushi boards |
| world | `world/crowd.js` | `GLT.crowd` | Instanced dock crowd (pirates + marines) |
| ships | `ships/flags.js` | `GLT.flags` | Procedural Jolly Rogers and ship flags (canvas + textures) |
| ships | `ships/models.js` | `GLT.shipModels` | Voxel models of the 7 ships, merged per material |
| ships | `ships/fleet3d.js` | `GLT.fleet3d` | Ships on plates: bob, sails, wakes, recoil, crew, damage, sinking, ghost |
| fx | `fx/particles.js` | `GLT.particles` | Pooled instanced particles |
| fx | `fx/shots.js` | `GLT.shotFx` | Cannonball arcs, muzzle flash, splash, fire/smoke/planks, technique FX |
| fx | `fx/fireworks.js` | `GLT.fireworks` | Victory fireworks |
| fx | `fx/weather.js` | `GLT.weather` | Rain, spray, fog banks, lightning visuals |
| audio | `audio/audio.js` | `GLT.audio` | Web Audio context, master gain, synthesized SFX |
| audio | `audio/music.js` | `GLT.music` | Chiptune sea-shanty loop |
| app | `app/persist.js` | `GLT.persist` | localStorage wrapper (try/catch) |
| app | `app/prefs.js` | `GLT.prefs` | Settings state + persistence |
| app | `app/pvc.js` | `GLT.pvc` | Player-vs-CPU Driver (§8) |
| app | `app/pvp.js` | `GLT.pvp` | Player-vs-Player Driver over `GLT.session` (§8) |
| app | `app/main.js` | `GLT.app` | Boot, wiring, screen flow, demo runner (§13) |

The architect implemented these files fully and they are part of the contract: `logic/consts.js`, `logic/events.js`, `logic/rng.js`, `logic/data.js`, `logic/layout.js`, `logic/board.js`, `logic/rules.js`, and the core of `ui/i18n.js`. Owners may improve their internals but must keep the behaviour described here. `net/commit.js`, `net/lobby.js`, `logic/taunts.js`, `app/persist.js` and `app/prefs.js` are implemented too, because their formats are contract. `render/clock.js` is implemented. `render/{palette,voxel,scene,renderer,camera,lighting,picking}.js`, `ui/shell.js`, `ui/theme.js`, `ui/base.css` and `app/main.js` contain a small **bootstrap** implementation so demos render on day one (verified: `render.camera`, `app.scene` and the plain boot all shoot with zero console errors). Their owners replace it, keeping the API. Everything else is a stub: logic/net stubs throw `not implemented`, and visual/ui stubs are inert (`init()` returns `false`).

---

## 3. Identifiers

```ts
type ShipId   = 'mobyDick'|'thousandSunny'|'oroJackson'|'redForce'|'polarTang'|'baratie'|'goingMerry';
type CrewId   = 'strawHat'|'whitebeard'|'redHair'|'heart'|'blackbeard'|'marine';
type FlagId   = CrewId | 'roger' | 'baratie';           // canonical ship flags
type TechId   = 'bazooka'|'tremor'|'haki'|'room'|'vortex'|'observation';
type FormatId = 'escaramuca'|'classica'|'grandline';
type SeaId    = 'calmo'|'grandline'|'novomundo'|'tempestade';
type Difficulty = 'grumete'|'marujo'|'capitao'|'yonkou';
type Tod      = 'day'|'dusk'|'night'|'storm';
type ViewMode = 'both'|'own'|'aim'|'panorama'|'ceremony';  // PT-BR: Duas águas, Minhas águas, Mira inimiga, Panorama da Grand Line
type PlateId  = 'own'|'enemy';                             // always from the LOCAL viewer's perspective
type Player   = 0|1;                                       // engine seat; PvC: 0 = human, 1 = CPU; PvP: 0 = slot 'A' (host), 1 = slot 'B'
type Slot     = 'A'|'B';
type ScreenId = 'menu'|'lobby'|'setup'|'battle'|'ceremony'|'stats';
type ReactionId = 'boaMira'|'prepareSe'|'gg'|'uau'|'porPouco'|'obrigado';
type NickCode = string;   // "a.n.dd": adjective index, noun index, 2-digit number. Rendered locally by GLT.lobby.nickText(); no free text ever travels.
type PvpEventType = 'join'|'seed'|'ready'|'fire'|'tech'|'answer'|'timeout'|'reveal'|'forfeit'|'rematch';   // = GLT.protocol.TYPES (§6.2)
```

Fixed tables (in `GLT.data`, already filled):

| Ship | len | flag | Escaramuça 8×8 | Clássica 10×10 | Grand Line 12×12 |
|---|---|---|---|---|---|
| mobyDick | 5 | whitebeard | | ✔ | ✔ |
| thousandSunny | 4 | strawHat | ✔ | ✔ | ✔ |
| oroJackson | 4 | roger | | | ✔ |
| redForce | 3 | redHair | ✔ | ✔ | ✔ |
| polarTang | 3 | heart | ✔ | ✔ | ✔ |
| baratie | 3 | baratie | | | ✔ |
| goingMerry | 2 | strawHat | ✔ | ✔ | ✔ |

| Crew | technique | captain / officers (i18n keys `crew.<id>.*`) |
|---|---|---|
| strawHat (Chapéus de Palha) | bazooka | Monkey D. Luffy / Zoro, Nami, Sanji |
| whitebeard (Barba Branca) | tremor | Edward Newgate / Marco, Ace, Jozu |
| redHair (Cabelo Vermelho) | haki | Shanks / Benn Beckman, Lucky Roux, Yasopp |
| heart (Piratas do Coração) | room | Trafalgar D. Water Law / Bepo, Penguin, Shachi |
| blackbeard (Barba Negra) | vortex | Marshall D. Teach / Burgess, Van Augur, Laffitte |
| marine (Marinha) | observation | Monkey D. Garp / Koby, Helmeppo, Bogard |

Every player sails the same canon ships. Ownership shows only through hull **trim** colour, **pennant** and **plate border** (`GLT.data.crews[id].colors`). In a mirror match (same crew on both sides), player 1 uses `colors.alt`. `GLT.app.colorsOf(player)` resolves that rule; use it, don't re-implement it.

---

## 4. Shared data shapes

```ts
interface Cell { r: number; c: number }            // 0-based; r = row (letter A..), c = column (number 1..). Label "B7" = {r:1,c:6}
type Dir = 'h' | 'v';                               // 'h': cells (r,c)…(r,c+len-1) along +X; 'v': (r,c)…(r+len-1,c) along +Z
interface Ship { id: ShipId; r: number; c: number; dir: Dir; len: number }   // (r,c) = anchor = lowest-index cell
interface Fleet { format: FormatId; ships: Ship[] }  // ships in any order; canonical form via GLT.board.canonical()

interface Rules {
  format: FormatId;        // default 'classica'
  series: 1|3|5;           // best-of; default 1
  mode: 'classico'|'tatico'; // default 'classico'. Tático = 1 crew technique per game + sea effects
  touch: boolean;          // ships may touch (orthogonally/diagonally adjacent); default true
  chain: boolean;          // continue firing after a hit; default false; ignored when salvo
  salvo: boolean;          // shots per turn = shooter's ships afloat at turn start; default false
  timer: 0|20|30|60;       // seconds per turn; 0 = off; default 0
  fog: boolean;            // shot markers fade 2 turns after placement (display only); default false
  sea: SeaId;              // default 'calmo'; visual always, gameplay effect only in Tático
}

type Mark = 0|1|2|3|4;    // 0 unknown, 1 água (miss), 2 acerto (hit), 3 afundado (cell of a sunk ship), 4 revelado (Observação: ship cell known, not hit)

type ShotOutcome = 'agua'|'acerto'|'afundou'|'absorvido';
interface Shot { by: Player; r: number; c: number }                 // target plate = opponent of `by`
interface ShotResult { r: number; c: number; result: ShotOutcome; ship?: Ship }  // `ship` present iff 'afundou' (placement ⇒ its cells)

type TechTarget = Cell | { axis: 'row'|'col'; index: number } | {};
type TechniqueResult =
  | { tech: 'bazooka'|'tremor'; r: number; c: number; shots: ShotResult[]; absorbed?: true }
  | { tech: 'haki'; r: number; c: number; found: boolean }               // any cell of a not-yet-sunk ship in the clipped 3×3
  | { tech: 'room'; axis: 'row'|'col'; index: number; count: number }   // all ship cells on that line (hit, sunk or intact)
  | { tech: 'vortex' }                                                  // activation, resolves at once, no answer
  | { tech: 'observation'; cell: Cell | null };                         // deterministic pick (§5.8); null if none left

type Answer = { kind: 'shots'; results: ShotResult[] } | { kind: 'tech'; result: TechniqueResult };

interface Stats { shots: number; hits: number; misses: number; accuracy: number /*0..1*/; streak: number; bestStreak: number;
                  turns: number; techs: number; sunk: number; timeMs: number }

interface Crew {  // GLT.data.crews[id]
  id: CrewId; nameKey: string; captainKey: string; officerKeys: [string,string,string]; tech: TechId; flag: FlagId;
  colors: { primary: string; secondary: string; trim: string; alt: { primary: string; secondary: string; trim: string } }; // '#rrggbb'
}

interface MatchConfig {
  mode: 'pvc'|'pvp'; crew: CrewId; oppCrew: CrewId /* pvc: CPU crew ≠ crew unless user picks same; pvp: filled from room */;
  difficulty: Difficulty /* pvc */; rules: Rules; seed?: number /* uint32; pvc random if absent */;
}

interface MoveLogEvent {          // PvP append-only log entry (§6)
  v: 1;
  id: string;                     // `${player}${n}` e.g. "A12": idempotency key, unique per room log
  n: number;                      // author's own counter, 1,2,3… (no gaps)
  seq: number;                    // ordering hint = 1 + highest seq the author had seen (its own included) when writing
  type: PvpEventType;
  player: Slot;                   // author slot
  payload: object;                // per type, §6.2
  ts: number;                     // author's Date.now() (ms) at creation
}

interface RoomInfo { v: 1; code: string; status: 'open'|'full'|'playing'|'done';
  host: { uid: string; nick: NickCode; crew: CrewId }; guest: { uid: string; nick: NickCode; crew: CrewId } | null;
  rules: Rules; createdAt: number; updatedAt: number }

interface WantedEntry { uid: string; nick: NickCode; crew: CrewId; bounty: number; format: FormatId;
  mode: 'pvc'|'pvp'; difficulty: Difficulty | null; ts: number }
```

### 4.1 Engine state (owned by `logic/engine.js`; treat it as read-only everywhere else)

```ts
interface GameState {
  v: 1; seed: number /* game seed */; rules: Rules; size: number; gameIndex: number;
  phase: 'setup'|'battle'|'over';
  first: Player;                 // coin toss = GLT.engine.coinToss(seed)
  turn: Player; turnNo: number;  // turnNo starts at 1 when battle begins, +1 every time the turn passes
  shotsLeft: number;             // in this turn (salvo: ships afloat at turn start; else 1)
  gust: null | { dir: 'N'|'S'|'E'|'W' };   // Tempestade (Tático): active for this turn's first 'fire'
  pending: null | { kind: 'fire'|'tech'; p: Player; cells: Cell[]; tech: TechId|null; target: TechTarget|null; ref: string|null };
  players: [PlayerState, PlayerState];
  history: Array<{ turnNo: number; p: Player; kind: 'fire'|'tech'; tech: TechId|null; cells: Cell[]; answer: Answer; auto: boolean }>;
  winner: Player|null; endReason: null|'fleet'|'forfeit'|'timeout'|'cheat'|'absent';
}
interface PlayerState {
  crew: CrewId; hidden: boolean;           // hidden = fleet unknown to this engine instance (remote PvP player)
  fleet: Fleet|null; ready: boolean;
  marks: Mark[]; markTurn: number[];        // marks ON this player's waters (shots received), length size*size, index r*size+c
  sunk: Ship[];                             // this player's sunk ships (public)
  annotations: Annotation[];                // intel the OPPONENT gathered on this player's waters
  techUsed: boolean; vortex: boolean;       // vortex = shield armed on this player's waters
  stats: Stats;                             // this player's shooting stats
}
type Annotation = { tech: 'haki'; r: number; c: number; found: boolean; turnNo: number }
                | { tech: 'room'; axis: 'row'|'col'; index: number; count: number; turnNo: number }
                | { tech: 'observation'; r: number; c: number; turnNo: number };

interface GameView {        // GLT.engine.view(state, viewer): what a given viewer may know. UI/world/ships read only this.
  phase; rules; size; gameIndex; turn; turnNo; shotsLeft; gust; winner; endReason;
  viewer: Player|null;      // null = spectator
  me: Player|null; opp: Player|null;   // spectator: me = 0, opp = 1 (rendered as A on 'own' side, B on 'enemy' side)
  myTurn: boolean; pending: boolean;
  players: [PlayerView, PlayerView];
}
interface PlayerView { crew; ready; techUsed; vortex; marks; markTurn; sunk; annotations; stats;
  fleet: Fleet|null;        // viewer's own fleet; opponent's only after the game is over and the fleet is known/revealed
  shipsAfloat: number; lastShot: (Cell & { turnNo: number }) | null }   // last shot received on these waters

interface SeriesState { seed: number; rules: Rules; crews: [CrewId, CrewId]; target: number /* ceil(series/2) */;
  wins: [number, number]; index: number /* current game */; games: Array<{ winner: Player; reason: string; stats: [Stats, Stats] }>;
  over: boolean; winner: Player|null }
```

**Plate mapping.** For the local viewer, `players[view.me]` is drawn on the `'own'` plate ("Suas águas") and `players[view.opp]` on the `'enemy'` plate ("Águas inimigas"). A shot **by** `p` lands on `GLT.app.plateOf(1-p)`.

---

## 5. Logic APIs (pure; Node-safe)

### 5.1 `GLT.C` (constants; frozen object). See §9 for the world values.
`GLT.C.T` holds game-time durations in **seconds**, scaled by `GLT.clock` speed: `flight 0.9, afterMiss 0.5, afterHit 0.9, afterSink 2.2, tech 1.4, coin 2.0, cpuMin 0.4, cpuMax 1.2, gameOverBanner 2.0, autoNext 6.0, ceremony 9.0, liftS 0.85`.
`GLT.C.NET` holds wall-clock **ms**: `heartbeat 3000, away 10000, forfeit 60000, timeoutGrace 5000, chunk 100, roomTtl 900000`.
Other constants: `HINTS 3` (Log Pose uses per game), `PIXEL_DEFAULT 2`, `PIXEL_MIN 1`, `PIXEL_MAX 6`.

### 5.2 `GLT.events`: see §7.

### 5.3 `GLT.rng`
```ts
create(seed: number): Rng                 // mulberry32
interface Rng { next(): number /*[0,1)*/; int(n): number /*[0,n)*/; range(a,b): number /*float [a,b)*/; chance(p): boolean;
                pick<T>(arr: T[]): T; shuffle<T>(arr: T[]): T[] /*in place, returns arr*/; state(): number; fork(label: string): Rng }
hashString(s: string): number             // uint32 (xmur3/FNV-1a, stable forever)
mix(...parts: Array<number|string>): number   // uint32; strings hashed first; order-sensitive
derive(seed: number, ...labels): Rng      // = create(mix(seed, ...labels)), the stateless way the engine draws randomness
randomSeed(): number                      // fresh uint32 from crypto.getRandomValues (fallback: time-based); NEVER for rules mid-match
```
The engine keeps **no RNG state** in `GameState`. Each random draw is `GLT.rng.derive(state.seed, label, turnNo, k)`, with labels `'coin'`, `'gust'`, `'timeout'`, `'observation'`, `'jitter'`.

### 5.4 `GLT.data`: tables (§3) plus
`ships[ShipId] {id,len,nameKey,flag,order}`, `shipOrder`, `crews[CrewId]: Crew`, `crewOrder`, `formats[FormatId] {id,size,ships:ShipId[],nameKey,descKey}`, `seas[SeaId] {id,nameKey,descKey,effect: null|'jitter'|'fog'|'gust',tod: Tod}`, `difficulties[Difficulty] {id,nameKey,descKey,style:'random'|'edge'|'spread',bountyF}`, `techniques[TechId] {id,nameKey,descKey,crew,target:'cell'|'cell2x2'|'line'|'none',attack:boolean}`, `reactions: ReactionId[]`, `timers [0,20,30,60]`, `seriesLengths [1,3,5]`, `sampleFleets[FormatId]: Fleet` (valid fixed fleets for demos/tests).

### 5.5 `GLT.layout`: see §9.

### 5.6 `GLT.board`
```ts
rowLetter(r): string; label(r, c): string /*"B7"*/; parse(label): Cell|null; idx(r,c,n): number; inBounds(r,c,n): boolean
shipCells(ship: Ship): Cell[]                       // anchor first
fits(ship, n): boolean                              // fully inside n×n
occupancy(fleet, n): Array<ShipId|null>             // length n*n
validateFleet(fleet, rules): { ok: boolean; errors: Array<{ shipId: ShipId|null; code: 'bounds'|'overlap'|'touch'|'missing'|'extra'|'dup'|'len'|'format' }> }
canPlace(fleet, ship, rules): boolean               // `ship` replaces any ship with the same id
emptyFleet(format): Fleet
canonical(fleet): string                            // JSON of {f: format, s: [[id,r,c,dir], …sorted by id]}, used for commitments
neighbors4(r,c,n): Cell[]
```

### 5.7 `GLT.rules`
```ts
defaults(): Rules; normalize(partial?: Partial<Rules>): Rules        // fills defaults, coerces invalid values to defaults
format(rulesOrId): { id, size, ships: ShipId[], nameKey, descKey }; size(rules): number
shipsFor(rules): Array<{ id: ShipId; len: number }>                  // in GLT.data.shipOrder
techAllowed(rules): boolean                                          // mode === 'tatico'
techFor(crew: CrewId): TechId
seaEffect(rules): null|'jitter'|'fog'|'gust'                         // null unless tatico
effectiveFog(rules): boolean                                         // fog || seaEffect === 'fog'
shotsPerTurn(rules, afloat: number): number                          // salvo ? max(1, afloat) : 1
summary(rules): Array<{ key: string; vars?: object }>                // i18n lines for UI/room lists
```
**Sea effects (Tático only):**
* `calmo`: none.
* `grandline` = `'jitter'`: the local Log Pose hint is offset by up to ±1 cell (`derive(seed,'jitter',turnNo)`).
* `novomundo` = `'fog'`: fog forced on.
* `tempestade` = `'gust'`: at each turn start, with probability 1/5 (`derive(seed,'gust',turnNo)`), a gust picks a direction N/S/E/W. That turn's **first `fire`** drifts one cell that way if the neighbour is in bounds and untried; otherwise it doesn't drift. The gust is public as soon as the turn starts (`GameState.gust`), so the shooter can compensate. Techniques never drift.

**Fog (display rule):** a marker of kind 1/2/4 on the **enemy** plate is visible iff `!effectiveFog(rules) || mark === 3 || view.turnNo - markTurn <= 2`. Use `GLT.engine.markVisible(view, player, idx)`. The engine still forbids firing at tried cells.

### 5.8 `GLT.engine` (pure reducer; never mutates its input)
```ts
createSeries({ rules, seed, crews: [CrewId,CrewId] }): SeriesState
gameSeed(seriesSeed: number, index: number): number            // = rng.mix(seriesSeed, 'game', index)
coinToss(gameSeed: number): Player                             // = rng.derive(gameSeed,'coin').int(2)
createGame({ rules, seed, index, crews, hidden?: [boolean,boolean] }): GameState   // phase 'setup', first = coinToss(seed)
reduce(state: GameState, action: Action): { state: GameState; events: EngineEvent[]; error: string|null }
   // an illegal action → same state object, events [], error code ('phase','turn','pending','tried','bounds','fleet','tech','used','answer')
answer(state: GameState, fleet?: Fleet): Answer                // answers state.pending using the DEFENDER's fleet (default: state.players[def].fleet)
recordGame(series: SeriesState, game: GameState, timeMs?: number): SeriesState   // appends the result, sets over/winner
view(state: GameState, viewer: Player|null): GameView
untried(state, shooter: Player): Cell[]                        // legal single-shot targets on the opponent's waters
randomUntried(state, shooter: Player, k?: number): Cell        // = rng.derive(seed,'timeout',turnNo,k) pick, used by timeouts
markVisible(view: GameView, player: Player, idx: number): boolean
techCells(state, p, tech, target): Cell[]                      // cells a technique affects/fires (for UI previews & FX)
legalTech(state, p, tech, target): string|null                 // null = legal, else error code
```
**Actions**
```ts
type Action =
 | { type: 'place';  p: Player; fleet: Fleet }                 // setup, own fleet only; validated with board.validateFleet
 | { type: 'ready';  p: Player }                               // setup; non-hidden players need a valid fleet; both ready → battle, turn = first
 | { type: 'fire';   p: Player; r: number; c: number; auto?: boolean; ref?: string }   // battle; p's turn; no pending; untried
 | { type: 'tech';   p: Player; tech: TechId; target: TechTarget; ref?: string }        // tatico; first action of p's turn; unused
 | { type: 'answer'; p: Player /*defender*/; answer: Answer }  // resolves pending; must match pending cells/tech exactly in shape
 | { type: 'timeout'; p: Player }                              // p's time ran out: engine fires randomUntried(state,p) as auto
 | { type: 'forfeit'; p: Player /*loser*/; reason: 'quit'|'absent'|'cheat' };
```
**Resolution rules (exact):**
* A shot (or attack-technique volley) at a defender whose `vortex` is armed is absorbed **at once**: no pending, no answer. Every cell gets `result:'absorvido'`, the cells stay untried, `vortex` turns off, and the event `absorbed` fires. That counts as a miss for turn passing.
* Bazooka cells: `(r,c),(r,c+1),(r+1,c),(r+1,c+1)`, which requires `r ≤ n-2, c ≤ n-2`. Tremor cells: centre, then `(r-1,c),(r+1,c),(r,c-1),(r,c+1)`. Out-of-bounds and already-tried cells are skipped. If none remain the technique is illegal. Results come in that order, and a ship sunk mid-volley reports `'afundou'` on the cell that completed it.
* Haki: clipped 3×3 around (r,c); `found` = any cell of a not-yet-sunk ship. Room: count of all ship cells on that row or column. Observation: the defender's unhit cells of afloat ships, sorted by `(r,c)`, then `derive(seed,'observation',turnNo).int(count)`, sets mark 4. Vortex: arms the shooter's own shield. Haki, Room and Observation never mark cells as tried, except mark 4 for Observation.
* A technique costs the whole turn (salvo included). It can only be the first action of a turn, once per game per player.
* Turn passing after a resolved action: technique → pass. Salvo → `shotsLeft--`, pass at 0 (chain is ignored). Else if chain and any `acerto`/`afundou` → keep the turn. Else → pass. Passing sets `turnNo++`, `turn = 1-turn`, `shotsLeft = shotsPerTurn(rules, afloat of new shooter)`, and rolls `gust`.
* Victory: when the defender's last ship sinks → `phase 'over'`, `winner = shooter`, `endReason 'fleet'`.

**Engine events** (returned by `reduce`; `app` turns them into bus events):
`{type:'phase',phase}`, `{type:'ready',p}`, `{type:'turn',turn,turnNo,shotsLeft,gust}`, `{type:'fired',p,cells,tech,auto,drift:null|{from:Cell,dir}}`, `{type:'resolved',p,results,tech}`, `{type:'sunk',p,owner,ship}`, `{type:'tech',p,tech,target,result}`, `{type:'absorbed',p,cells}`, `{type:'over',winner,reason}`.

### 5.9 `GLT.ai`
```ts
create({ difficulty, rules, seed, player: Player, memory?: AiMemory }): Bot
interface Bot { place(): Fleet; act(view: GameView): { type:'fire'; r; c } | { type:'tech'; tech; target }; learn(view: GameView): void; memory: AiMemory }
placeFleet(rules, style: 'random'|'edge'|'spread', rng: Rng): Fleet      // always valid for rules
hint(view: GameView, rng?: Rng): Cell|null     // densest unexplored area (probability density over remaining lengths), jitter applied by caller
thinkMs(difficulty, rng: Rng): number          // 400..1200
createMemory(): AiMemory                       // opaque, JSON-serialisable; Yonkou placement-bias learning across a series
```
Shot policy: Grumete = random untried. Marujo = hunt/target. Capitão = parity + target. Yonkou = probability density over remaining ship lengths + memory bias. Bots draw randomness from `GLT.rng.derive(seed,'ai',player,…)`. In Tático, bots may use their technique.

### 5.10 `GLT.stats`
```ts
compute(state: GameState, p: Player, timeMs?: number): Stats
bounty(stats: Stats, ctx: { rules: Rules; difficulty: Difficulty|'pvp'; won: boolean; size: number; shipCells: number }): number
seriesStats(series: SeriesState): [Stats, Stats]           // summed; accuracy recomputed; bestStreak = max
```
**Bounty formula (exact, integer Berries, rounded to the nearest 1 000 000, minimum 1 000 000):**
```
acc     = shots ? hits/shots : 0                                  accF   = 0.5 + 1.5*acc
eff     = clamp((size*size - shots) / (size*size - shipCells), 0, 1)   effF = 0.5 + 1.5*eff
spt     = timeMs/1000 / max(1, turns)                             speedF = clamp(1.6 - spt/20, 0.7, 1.6)
streakF = 1 + 0.1*bestStreak
diffF   = {grumete:0.5, marujo:1, capitao:2, yonkou:4, pvp:3}[difficulty]
rulesF  = {escaramuca:0.7, classica:1, grandline:1.4}[format] * (mode=='classico'?1.1:0.9) * (salvo?0.9:1) * (chain?0.8:1) * (timer>0?1.1:1)
winF    = won ? 1 : 0.25
bounty  = max(1e6, round(30e6 * accF*effF*speedF*streakF*diffF*rulesF*winF / 1e6) * 1e6)
```

### 5.11 `GLT.taunts`
`situations = ['start','cpuHit','cpuMiss','cpuSunk','playerHit','playerMiss','playerSunk','cpuWin','cpuLose']`
`pick(crew: CrewId, situation, rng: Rng): { key: string /* 'taunt.<crew>.<situation>' */, v: number }`. `GLT.T(key,{v})` picks the variant modulo the variant count. Taunts are cosmetic: use a cosmetic RNG, not the match seed.

### 5.12 `GLT.sim`
```ts
game({ rules, seed, ai: [Difficulty, Difficulty], crews?, memory?: [AiMemory, AiMemory], maxTurns? }): SimResult
series({ rules, seed, ai, crews? }): { winner: Player; games: SimResult[] }
batch({ rules, ai, games: number, seed }): { games; wins: [n,n]; firstWins: number; avgShotsToWin: number; minShots; maxShots; nonTerminated: number; invalidPlacements: number }
interface SimResult { winner: Player|null; first: Player; shots: [number, number]; turns: number; terminated: boolean;
  valid: boolean /* both fleets valid */; consistent: boolean /* stats/bounty recomputation agrees */; digest: string /* hash of history */ }
```

---

## 6. Net: protocol, session, transports (pure; Node-safe)

### 6.1 Principles
* The shared match record is an **append-only, sequence-numbered move log**. Each author writes **only its own stream**. Both clients (and spectators) build the whole state with `GLT.protocol.fold(events)`, so reconnecting is just a replay.
* **Ordering:** dedupe by `id`. When two events share an `id` but differ, keep the one whose `JSON.stringify` sorts first; for honest clients that never happens. Then sort by `(seq, player 'A'<'B', n)`. The fold is pure and refolds from scratch whenever a new event arrives, which keeps it deterministic regardless of arrival order. An event that is illegal in the folded state is **rejected** deterministically (listed in `state.rejected`) and has no effect. That covers duplicates, out-of-order writes, double clicks and turn-ownership violations.
* **Hidden info:** a fleet never leaves its owner until `reveal`. On "Pronto" the client publishes `commit = sha256Hex(GLT.board.canonical(fleet) + salt)` with a 16-byte random hex salt. The defender's client auto-answers every `fire`/`tech` aimed at it. At game end both reveal `{fleet, salt}`. Every client verifies (a) the commitment, (b) the fleet's validity under the rules, (c) **every** logged answer against `GLT.engine.answer` replayed on the revealed fleet. Any mismatch → `cheat = {slot, reason}`, which awards the **series** to the other slot and shows "Trapaça detectada". If both sides cheat, the culprit is the author of the earliest offending event in fold order.
* **Async hashing:** SHA-256 runs through WebCrypto, so it's async and `fold` takes precomputed digests (`opts.digests[eventId] = hex`). The session computes them for every `seed` and `reveal` event before folding. A reveal or seed whose digest is missing is *pending verification*, not a cheat.
* **Seeds (commit-reveal, nobody can grind):** A's `join` carries `seedCommit = sha256Hex(nonceA)`, B's `join` carries `nonceB`, then A posts `seed {nonce: nonceA}`. `matchSeed = GLT.rng.mix(nonceA, '|', nonceB)`, `seriesSeed = mix(matchSeed, 'series', seriesNo)`, `gameSeed = GLT.engine.gameSeed(seriesSeed, game)`. The coin toss, gusts, timeouts and observations all derive from it.
* **Timer:** `deadline = ts(turn-start event) + timer*1000`. The turn-start event is the event whose application started the current turn: the later `ready`, or the `answer`/`fire`/`tech` that passed the turn. The shooter's own client auto-fires `engine.randomUntried` at its deadline as a normal `fire {auto:true}`. If that doesn't happen, the waiting client may publish `timeout` once `now ≥ deadline + NET.timeoutGrace`. The fold accepts a `timeout` only if `ev.ts - turnStartTs ≥ timer*1000 + timeoutGrace`, and applies it as engine `{type:'timeout'}`. The claimant then answers that auto-shot like any other.
* **Absence:** a heartbeat every 3 s. After 10 s of silence, "Adversário reconectando…". After 60 s, if the absent slot also has an outstanding obligation (its turn, an answer, seed, ready or reveal) that is ≥ 60 s old by log timestamps, the present client publishes `forfeit {who, reason:'absent'}`. The fold accepts it only if that obligation is ≥ `NET.forfeit` old at `ev.ts`.

### 6.2 Event types (`MoveLogEvent.type`) and payloads
Every payload in a series carries `series` (rematch counter, from 0) and every in-game payload carries `game` (index in the series).

| type | author | payload | accepted when |
|---|---|---|---|
| `join` | A, then B | A: `{pid, nick, crew, uid, rules, seedCommit}` · B: `{pid, nick, crew, uid, nonce}` | first event of the slot; B only after A's join |
| `seed` | A | `{nonce}` | after B's join; `digests[id] === A.join.seedCommit` |
| `ready` | A/B | `{series, game, commit}` | that game's setup; once per slot per game |
| `fire` | shooter | `{series, game, r, c, auto?}` | engine `fire` legal (its turn, no pending, untried) |
| `tech` | shooter | `{series, game, tech, target}` | engine `tech` legal |
| `answer` | defender | `{series, game, to: eventId, answer: Answer}` | a pending action exists and `to` is its event id; the answer's shape matches |
| `timeout` | waiting slot | `{series, game, turnNo}` | §6.1 timer rule |
| `reveal` | A/B | `{series, game, fleet, salt}` | that game is over (any reason); once per slot per game |
| `forfeit` | any | `{series, game, who: Slot, reason: 'quit'|'absent'}` | quit: `who === player`; absent: §6.1 absence rule |
| `rematch` | A/B | `{series: next}` | the series is over; when both have posted → new series `next`, fresh setup |

The next game in a series starts (setup) once both reveals of the previous game are **verified**. `react` (reactions) are ephemeral signals, never logged.

### 6.3 `GLT.protocol`
```ts
VERSION: 1; TYPES: PvpEventType[]
make(author: { slot: Slot; n: number }, type, payload, { seq, ts }): MoveLogEvent
valid(ev): boolean                                   // shape check only
order(events: MoveLogEvent[]): MoveLogEvent[]        // dedupe + sort (§6.1)
fold(events, opts: { local: Slot|null; fleets?: Record<string /*`${series}.${game}`*/, Fleet>; digests?: Record<string,string> }): PvpState
duties(state: PvpState, slot: Slot): Array<{ type: 'seed'|'answer'|'reveal'|'ready'|'timeout'|'forfeit'; game?: number; to?: string }>  // what this slot must/may write now
nextSeq(state): number; nextN(state, slot): number
publicDigest(state): string                          // deterministic, no private data; convergence tests compare it
interface PvpState {
  code: string|null; slots: { A: SlotInfo|null; B: SlotInfo|null }; rules: Rules|null; seed: number|null;
  phase: 'waiting'|'seeding'|'setup'|'battle'|'reveal'|'gameOver'|'seriesOver';
  seriesNo: number; series: SeriesState|null; game: GameState|null /* engine; own fleet injected from opts.fleets */;
  commits: { A: string|null; B: string|null }; reveals: { A: {fleet,salt}|null; B: {fleet,salt}|null };
  verified: { A: boolean|null; B: boolean|null };     // null = pending digest
  awaiting: { slot: Slot; duty: string; since: number } | null; deadline: number|null;
  cheat: { slot: Slot; reason: string } | null; forfeit: { slot: Slot; reason: string } | null;
  lastSeq: number; applied: string[]; rejected: Array<{ id: string; reason: string }>;
}
interface SlotInfo { pid: string; nick: NickCode; crew: CrewId; uid: string }
```

### 6.4 Transport interface (the only place network code lives)
Two implementations share this exact interface: `GLT.transportMem` (tests) and `GLT.transportHost` (the artifact runtime).
```ts
interface Transport {
  kind: 'mem'|'host';
  author(): string;                 // this client's author id (host: the platform user id)
  now(): number;                    // ms wall clock (mem: fake clock)
  // durable, append-only, per room, per author
  publish(code: string, ev: MoveLogEvent): Promise<void>;          // append to OWN stream; idempotent by ev.id; rejects {code}
  subscribe(code: string, authors: string[], onEvents: (evs: MoveLogEvent[]) => void, onError?: (e: NetError) => void): () => void;
        // at-least-once, any order, duplicates allowed; a delivery may be a full snapshot or a delta
  read(code: string, authors: string[]): Promise<MoveLogEvent[]>;
  // ephemeral liveness and signals
  heartbeat(code: string, beat: { pid: string; slot: Slot|null; n: number }): void;
  peers(code: string, fn: (beats: Array<{ author: string; pid: string; slot: Slot|null; n: number; seenAt: number; self: boolean; otherTab: boolean }>) => void): () => void;
  signal(code: string, topic: 'ping'|'pong'|'react', data: object): void;
  onSignal(code: string, topic: 'ping'|'pong'|'react', fn: (data: object, from: { author: string|null; self: boolean }) => void): () => void;
  // lobby
  createRoom(info: RoomInfo): Promise<void>;                        // rejects {code:'exists'}
  claimRoom(code: string, guest: { uid; nick; crew }): Promise<RoomInfo>;   // rejects {code:'not_found'|'full'}
  updateRoom(code: string, patch: Partial<RoomInfo>): Promise<void>;
  getRoom(code: string): Promise<RoomInfo|null>;
  watchRoom(code: string, fn: (info: RoomInfo|null) => void): () => void;
  openRooms(fn: (rooms: RoomInfo[]) => void): () => void;           // status 'open', updatedAt within NET.roomTtl, newest first, ≤ 20
  lobbyPresence(p: { nick: NickCode; crew: CrewId; hosting: string|null }): void;
  onlineCount(fn: (n: number|null) => void): () => void;            // null = unknown
  // "Mais procurados" (casual, unverified)
  putWanted(entry: WantedEntry): Promise<void>;
  topWanted(fn: (entries: WantedEntry[]) => void): () => void;      // top 20 by bounty
  close(): void;
}
type NetError = { code: 'unavailable'|'not_found'|'full'|'exists'|'denied'|'quota'|'network'|'bad_code'|'own_room'; message?: string };
```

`GLT.transportMem.hub(opts?: { seed?: number; latency?: [number, number] /*ms*/; drop?: number; dup?: number; reorder?: boolean; dropWrite?: number }): Hub`
```ts
interface Hub {
  connect(author: string): Transport;   disconnect(author: string): void;  // closed tab: no deliveries/heartbeats; the store keeps its data
  reconnect(author: string): Transport; // a fresh Transport for the same author (a refresh)
  tick(ms: number): void; flush(): void; now(): number;     // fake clock; delivers due messages deterministically
  timers: { now(); setTimeout(fn, ms); clearTimeout(id); setInterval(fn, ms); clearInterval(id) };   // pass to GLT.session
  store: { streams: Record<string, Record<string, MoveLogEvent[]>>; rooms: Record<string, RoomInfo>; wanted: Record<string, WantedEntry> };
  tamper(code: string, author: string, fn: (evs: MoveLogEvent[]) => MoveLogEvent[]): void;   // simulate a cheater
}
```
Fault model: `drop` loses a delivery, never stored data. Later deliveries carry the full stream, so drops heal. `dup` re-delivers. `reorder` shuffles a delivery. `dropWrite` makes `publish` reject `{code:'network'}`; the session retries with backoff, and the same id keeps it idempotent.

### 6.5 `GLT.session`
```ts
create({ transport: Transport; storage?: { get(k), set(k,v), remove(k) }; timers?: Hub['timers'] }): Session
interface Session {
  status(): NetStatus; slot(): Slot|null; code(): string|null; state(): PvpState; view(): GameView|null;
  host(o: { nick: NickCode; crew: CrewId; rules: Rules }): Promise<{ code: string; link: string }>;
  join(code: string, o: { nick: NickCode; crew: CrewId }): Promise<void>;     // rejects NetError
  spectate(code: string): Promise<void>;
  rejoin(code?: string): Promise<boolean>;            // stored token {code, slot, pid}; also restores own fleets+salts from storage
  setFleet(fleet: Fleet): { ok: boolean; errors: any[] };   // local only, never published
  ready(): Promise<void>; fire(r, c): Promise<void>; technique(tech, target): Promise<void>;
  react(preset: ReactionId): void; rematch(): Promise<void>; quit(): Promise<void>; leave(): void;
  rooms(fn: (rooms: RoomInfo[]) => void): () => void;
  onChange(fn: (state: PvpState, delta: { applied: MoveLogEvent[]; reset: boolean }) => void): () => void;
        // reset = a late event changed already-applied history → consumer must resync visuals (view:sync)
  onSignal(fn: (s: { type: 'react'; preset: ReactionId; slot: Slot|null } | { type: 'status'; status: NetStatus }) => void): () => void;
  dispose(): void;
}
interface NetStatus { conn: 'offline'|'connecting'|'online'|'unavailable'; opponent: 'none'|'present'|'away'|'gone';
  rtt: number|null; online: number|null; otherTab: boolean; reason: string|null }
```
The session writes its own fleet and salt per game to `storage` (`glt.v1.pvp.fleet.<code>.<series>.<game>`) so a refresh can still answer shots. The fleet stays on that device (localStorage), never in the shared store. If storage fails, a refresh mid-game cannot answer, and the 60 s absence rule forfeits it.

### 6.6 `GLT.lobby`, `GLT.commit`
```ts
GLT.lobby: ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' (no I, L, O, 0, 1); code(rng?): string /*5 chars*/; normalizeCode(s): string|null;
           shareLink(code, base?): string /* base + '#sala=' + code */; parseLink(href): string|null /* '#sala=' or '?sala=' */;
           nickname(rng?): NickCode; nickText(nick: NickCode): string /* via GLT.T, invalid → T('nick.fallback') */; pid(): string /* 'p_' + 12 hex */
GLT.commit: salt(): string /*32 hex*/; nonce(): string /*32 hex*/; sha256Hex(s: string): Promise<string>;
            commit(fleet, salt): Promise<string>; verify(fleet, salt, commitHex): Promise<boolean>
```

---

## 7. Event bus (`GLT.events`, `logic/events.js`, implemented)

```ts
on(type: string, fn: (payload, type) => void): () => void   // '*' receives every event
once(type, fn): () => void;  off(type, fn): void;  emit(type, payload?): void /*synchronous*/;  clear(): void;  count(type): number
```
A listener that throws doesn't stop the others. The error is rethrown asynchronously, so it still surfaces as a console error. **Every module subscribes itself inside its own `init()`**. `app` only emits (and listens to `ui:*`). Unsubscribe in `dispose()`.

Fields used throughout: `by` = the shooter's `Player`. `mine` = `by === GLT.app.local()`. `plate` = the **target** `PlateId`. `label` = `GLT.board.label(r,c)`.

| Event | Payload | Emitted by | Typical listeners |
|---|---|---|---|
| `app:ready` | `{ webgl: boolean }` | app | all |
| `screen:changed` | `{ screen: ScreenId, prev }` | app | ui, camera, audio |
| `settings:changed` | `{ key, value, all }` | prefs | renderer, camera, backdrop, audio, theme, ui |
| `layout:changed` | `{ size }` | layout.setSize | plates, fleet3d, props, picking |
| `match:created` | `{ mode, local: Player|null, crews: [CrewId,CrewId], colors: [c0,c1], rules, difficulty|null, seriesLen }` | app | all visuals, ui, crowd |
| `game:setup` | `{ gameIndex, view: GameView, defaultFleet: Fleet|null }` | app | setupUi, plates, fleet3d |
| `setup:changed` | `{ fleet: Fleet, valid: boolean, errors }` | app (driver) | fleet3d, plates, setupUi |
| `setup:ghost` | `{ ship: Ship|null, valid: boolean }` | setupUi | plates (cell tint), fleet3d (ghost ship) |
| `coin:toss` | `{ first: Player, mine: boolean, durationS }` | app | ui, fx, audio, props |
| `game:started` | `{ gameIndex, first, view }` | app | all |
| `view:sync` | `{ view: GameView, reason: 'setup'|'start'|'rejoin'|'refold' }` | app | plates, fleet3d, shotFx (burns), ui. Rebuild without animation |
| `turn:changed` | `{ turn: Player, mine, turnNo, shotsLeft, gust, timer: number, deadline: number|null /*ms epoch*/ }` | app | hud, props, camera, audio, logbook |
| `timer:tick` | `{ remaining: number /*s*/, mine }` | app (1 Hz while timer > 0) | hud, props, audio |
| `cell:hover` / `cell:down` / `cell:move` / `cell:up` / `cell:click` / `cell:dblclick` / `cell:context` | `{ plate: PlateId|null, r: number|null, c: number|null, button, pointerType, x, y }` | picking | setupUi, app, plates |
| `cell:selected` | `{ plate: 'enemy', r, c, label, legal: boolean } \| { plate: null }` | app | hud, plates, grid2d |
| `shot:fired` | `{ id, by, mine, plate, r, c, label, tech: TechId|null, auto, salvo: { index, of }, from: { plate: PlateId, shipId: ShipId|null }, drift: null|{ from: Cell, dir }, flightS }` | app | shotFx, fleet3d (recoil), audio, crowd, props, logbook |
| `shot:resolved` | `{ id, by, mine, plate, r, c, label, result: ShotOutcome, ship?: Ship, tech: TechId|null }` | app | plates, shotFx, fleet3d (damage), audio, crowd, props, logbook, hud, ui.announce |
| `ship:sunk` | `{ by, mine, plate, ship: Ship, shipId, owner: Player }` | app (right after its `shot:resolved`) | fleet3d (sink), plates (outline/foam), shotFx, audio, crowd, props, logbook |
| `technique:used` | `{ by, mine, plate, tech, target, cells: Cell[], flightS }` | app | shotFx, audio, logbook, props |
| `technique:resolved` | `{ by, mine, plate, tech, result: TechniqueResult }` | app (after the per-cell `shot:resolved` of a volley) | plates (annotations), hud, logbook, ui.announce |
| `vortex:absorbed` | `{ by, mine, plate, cells }` | app | shotFx, audio, logbook |
| `hint:used` | `{ r, c, usesLeft }` | app | plates (pointer), hud, audio |
| `cpu:thinking` | `{ player, ms }` | pvc | hud, props |
| `cpu:taunt` | `{ player, crew, key, v }` | pvc | ui (speech bubble), logbook, props |
| `game:ended` | `{ gameIndex, winner, mine, reason, stats: [Stats,Stats], fleets: [Fleet|null, Fleet|null], series: SeriesState }` | app | all |
| `match:ended` | `{ winner, mine, wins, reason, stats: [Stats,Stats], bounty: [number,number] }` | app | ui, audio, persist |
| `ceremony:start` | `{ winner, mine, crew, captainKey, bounty, plate }` | app | ceremonyUi, fleet3d (flag raise), fireworks, camera, backdrop, audio, crowd |
| `ceremony:end` | `{ skipped: boolean }` | app | same |
| `reaction:received` | `{ preset: ReactionId, from: Player|null, mine }` | pvp | ui, props, audio |
| `net:status` | `NetStatus` | pvp | lobbyUi, hud |
| `net:cheat` | `{ culprit: Player, reason }` | pvp | ui, logbook |
| `pvp:room` | `{ code, link, slot, room: RoomInfo|null }` | pvp | lobbyUi |
| `camera:changed` | `{ mode, azimuth, elevation, zoom }` | camera | backdrop, props, hud |
| `tod:changed` | `{ tod }` | lighting | world, ships, fx, ui |
| `theme:changed` | `{ mode: 'auto'|'light'|'dark', theme: 'light'|'dark' }` | theme | ui, canvases that use theme tokens |
| `speed:changed` / `pause:changed` | `{ speed }` / `{ paused }` | clock | ui, audio |
| `lift:changed` | `{ enabled, active: boolean }` | backdrop | settingsUi |

**UI intents** (emitted by `ui/*`, handled only by `app`):
`ui:start {config: MatchConfig}`, `ui:fleet {fleet}`, `ui:autoPlace {style?}`, `ui:clearFleet`, `ui:ready`, `ui:select {r,c}`, `ui:fire`, `ui:technique {tech, target}`, `ui:hint`, `ui:camera {mode}`, `ui:setting {key, value}`, `ui:speed {speed}`, `ui:pause {paused}`, `ui:next`, `ui:rematch`, `ui:menu`, `ui:skipCeremony`, `ui:pvp:host {nick, crew, rules}`, `ui:pvp:join {code, nick, crew}`, `ui:pvp:spectate {code}`, `ui:pvp:leave`, `ui:pvp:quit`, `ui:react {preset}`.

---

## 8. App wiring and drivers

### 8.1 `GLT.app` (`app/main.js`)
```ts
boot(): Promise<void>; driver(): Driver|null; view(): GameView|null; local(): Player|null /*null = spectator or none*/;
plateOf(player: Player): PlateId;     // local (or 0 when spectating) → 'own'
colorsOf(player: Player): { primary, secondary, trim }   // applies the mirror-match alt rule
crews(): [CrewId, CrewId] | null; screen(): ScreenId; net(): { available: boolean; reason: string|null; canWrite: boolean|null }
startMatch(config: MatchConfig): void; toMenu(): void
```
Boot order: set `document.documentElement.lang='pt-BR'` → `GLT.prefs.init()` → (`?demo=` → wrap the demo and stop, §13) → `GLT.theme.init()` → `GLT.ui.mount(#app)` → `GLT.renderer.init(refs.stage)` (false → 2D mode) → `GLT.scene.init()`, `GLT.camera.init()`, `GLT.lighting.init()`, `GLT.picking.init()` → world `init()`s (`ocean, plates, backdrop, props, crowd`) → `GLT.fleet3d.init()` → fx `init()`s → `GLT.audio.init()`, `GLT.music.init()` → ui `init()`s → `GLT.clock.start()` → PvP probe (async, never blocks first paint) → `app:ready` → screen `menu` → after `fontsReady()` + 2 frames, `window.GLT_READY = true`. Every `init()` is **idempotent** and returns `boolean` (false = disabled but harmless).

### 8.2 Driver (implemented by both `GLT.pvc.create(config)` and `GLT.pvp.create({session, config})`)
```ts
interface Driver {
  kind: 'pvc'|'pvp'; local: Player|null;
  view(): GameView; series(): SeriesState;
  setFleet(fleet: Fleet): { ok: boolean; errors }; autoPlace(style?): Fleet; clearFleet(): void; ready(): void;
  select(r, c): void; fire(): void /* fires the selected cell */; technique(tech: TechId, target: TechTarget): void;
  hint(): Cell|null /* uses one Log Pose charge; local only, never logged, not in bounty */;
  next(): void; rematch(): void; quit(): void;
  setSpeed(x: 0.5|1|2|4): void; setPaused(p: boolean): void;   // no-ops in pvp
  dispose(): void;
}
```
**Sequencing (both drivers, game time via `GLT.clock.after`, so speed and pause apply offline):**
1. `fire`: `reduce(fire)` → emit `shot:fired` (`flightS = C.T.flight`) → wait `flightS` **and** for the answer (pvc: immediate `engine.answer`; pvp: the defender's logged answer) → `reduce(answer)` → emit `shot:resolved` (then `ship:sunk`) → wait `afterMiss|afterHit|afterSink` → `turn:changed` (or `game:ended`).
2. Attack techniques: `technique:used` → after `C.T.tech`, one `shot:resolved` per cell (+ `ship:sunk`) → `technique:resolved`. Info techniques: `technique:used` → after `C.T.tech` → `technique:resolved`. Vortex activation: `technique:used` + `technique:resolved` immediately.
3. CPU turn: on `turn:changed` to the CPU → `cpu:thinking {ms: ai.thinkMs}` → after `ms/1000` game seconds → `bot.act(view)` → step 1/2. Taunts (`cpu:taunt`) on start, after each resolved CPU or player shot (at most one every 3 s), and at game end.
4. Timer (`rules.timer>0`): offline the driver's 1 Hz `timer:tick` uses game time. At 0 → `reduce({type:'timeout'})` for the human. PvP uses wall-clock deadlines (§6.1).
5. End of game: `game:ended` → `C.T.gameOverBanner` → screen `stats`. If the series isn't over: `ui:next` or `prefs.autoNext` after `C.T.autoNext` → next game `game:setup`, defaulting to the player's previous fleet. If it is over: `match:ended` → `ceremony:start` → `C.T.ceremony` or `ui:skipCeremony` → `ceremony:end` → `stats`.
6. Refold/rejoin (pvp): when `delta.reset` → emit `view:sync {reason:'refold'}` and skip animations for the events concerned.

### 8.3 `GLT.prefs` (`app/prefs.js`) and `GLT.persist` (`app/persist.js`)
```ts
GLT.persist: get(key, fallback), set(key, value): boolean, remove(key), keys(prefix): string[]   // prefix 'glt.v1.'; JSON; every access try/catch
GLT.prefs: init(), get(key), set(key, value) /* persists + emits settings:changed */, all(), reset(), reducedMotion(): boolean
```
Pref keys and defaults: `pixelSize 2`, `outlines true`, `dither true`, `raw3d false` (true = skip post entirely), `lift true`, `tod 'auto'` (auto = `GLT.data.seas[rules.sea].tod`; else a fixed Tod), `speed 1`, `paused false` (never persisted), `volume 0.7`, `muted false`, `music true`, `theme 'auto'`, `autoNext true`, `camera 'both'`, `reducedMotion 'auto'` (auto = `prefers-reduced-motion`), `grid2d 'auto'` (auto = on when no WebGL or width < 520 px), `nick` (NickCode, generated once), `pid` (generated once), `lastConfig` (MatchConfig).
Other persisted keys: `stats` `{played, won, lost, bestBounty, totalShots, totalHits, byDifficulty: {[d]: {played, won}}}`, `pvp.rejoin.<CODE>`, `pvp.fleet.<CODE>.<series>.<game>`.

---

## 9. World coordinates (`GLT.C` values + `GLT.layout`, implemented)

* 1 world unit = **1 metre**, Y up, right-handed (three.js default).
* The ocean surface is `y = C.OCEAN_Y = 0`. Each sea-plate is a floating slab whose **water surface** (ship waterline) sits at `y = C.PLATE_Y = 8`. Waterfalls pour off the plate edges down to the ocean.
* `C.CELL = 4` m. The grid is `n×n` with `n ∈ {8,10,12}` (`GLT.layout.size()`, set by app through `setSize(n)` at match/game setup, default 10).
* Plate centres are fixed for every n: `'own'` at `(-C.PLATE_CX, PLATE_Y, 0)` and `'enemy'` at `(+C.PLATE_CX, PLATE_Y, 0)` with `C.PLATE_CX = 34`. A 12×12 grid spans x ∈ [10, 58] on the enemy side, leaving a 20 m channel between grids where the Log Pose buoy floats at the origin on the ocean.
* The rim is `C.RIM = 4` m wide around the grid. Rim top = `PLATE_Y + C.RIM_TOP` (1 m), terraced downward. Strata hang below to about `y = -C.PLATE_DEPTH` (6 m below the ocean).
* **Cell → world (cell centre at the waterline):** `x = cx + (c - (n-1)/2) * CELL`, `z = (r - (n-1)/2) * CELL`, `y = PLATE_Y`. Rows grow toward **+Z** (A is the far/north edge), columns toward **+X** (1 is the west edge). Rim labels: letters along the plate's **−X** rim edge, numbers along its **−Z** rim edge.
* **Ship convention:** models are authored with the **bow toward local +X**, the waterline at local `y = 0`, centred on the origin, length along X and beam along Z. Placement through `GLT.layout.shipTransform(plate, ship, n?) → {x, y, z, yaw, length}`: position = centre of the occupied cells at the waterline. `'h'` → `yaw = 0` (bow toward higher columns, +X). `'v'` → `yaw = -Math.PI/2` (bow toward higher rows, +Z). Apply as `object.rotation.y = yaw`.
* **No-clip envelope (hard limits; `GLT.layout.shipEnvelope(len)`):** a hull (bowsprit, figurehead and cannons included) fits in `len*CELL - 2*C.SHIP_END_MARGIN` long (margin 0.25 m) and `C.SHIP_MAX_BEAM = 3.4` m wide. Masts and sails ≤ `C.SHIP_MAX_H = 9` m above the waterline. Bob ≤ ±3° roll, ±2° pitch, ±0.25 m heave. Touching ships and the rim then never intersect. Ship voxel edge `C.SHIP_VOXEL = 0.25` m.
* **Scenery ring:** inner radius `C.RING_IN = 90`, outer radius `C.RING_OUT = 320`. `C.SECTORS = 8`. Sector `k` covers azimuths `[k*45-22.5, k*45+22.5)`. Azimuth is measured like the camera's: direction `(sin az, 0, cos az)`, so `az = 0` points to **+Z (south)**. Content (world builder; everything beyond radius 70 m belongs to exactly one sector group):
  `0` S: small Den Den Mushi board, rock arch, torch buoys · `1` SE: Sea Kings (group A) · `2` E: Laboon + lighthouse · `3` NE: Marineford split plaza + Marine warships in formation · `4` N: Red Line wall, Reverse Mountain canal flowing up to the sky island (Skypiea + golden bell above), **big Den Den Mushi board** · `5` NW: Sabaody mangroves + rising bubbles · `6` W: Sea Kings (group B), rock falls · `7` SW: floating chunks, torch buoys. The Red Line wall runs as the horizon across sectors 3–5.
  The inner zone (< 70 m, never lifted) holds the plates, the Log Pose buoy at the origin, and **docks with the crowd** behind each plate at `z ≈ -(n/2*CELL + RIM + 6)`, facing +Z. Own-crew fans stand behind the own plate, rival fans behind the enemy plate.
* **Doll's-house lift (`GLT.backdrop`):** sector `k` is "near" when `angDist(k*45, camera.azimuth) ≤ 67.5°`, i.e. `GLT.layout.nearSectors(az)`: three sectors, or four exactly on a sector boundary. Near sectors rise `C.LIFT_H = 90` m with easeInOutCubic over `C.T.liftS = 0.85` s. On arrival they set `castShadow=false` and `visible=false`. Lowering sets `visible=true` first and restores shadows on landing. The lift runs only when `prefs.lift` is on and the view mode is not `'ceremony'` or `'panorama'`. Reduced motion → instant.

`GLT.layout` API:
```ts
size(): number; setSize(n): void /* emits layout:changed */
plateCenter(plate): {x,y,z}; cellToWorld(plate, r, c, n?): {x,y,z}; worldToCell(plate, x, z, n?): Cell|null; plateAt(x, z, n?): PlateId|null
gridBounds(plate, n?): {minX,maxX,minZ,maxZ}; rimBounds(plate, n?): {minX,maxX,minZ,maxZ}
shipTransform(plate, ship, n?): {x,y,z,yaw,length}; shipEnvelope(len): {length, beam, height}
rowLabelPos(plate, r, n?): {x,y,z}; colLabelPos(plate, c, n?): {x,y,z}
launcher(fromPlate, toPlate, n?): {x,y,z}      // fallback muzzle on the shooter's rim facing the target (hidden enemy ships)
dockPos(plate, n?): {x,y,z}
sectorOf(azDeg): number; sectorCenter(k): number; angDist(a, b): number; azDir(azDeg): {x, z}; nearSectors(cameraAzDeg): boolean[8]
```

---

## 10. Render APIs (`render/`)

### 10.1 `GLT.clock` (callable: `GLT.clock()` === `GLT.clock.now()`, game seconds, for harness compatibility)
```ts
(): number                                       // same as now()
start(): void                                    // RAF loop (browser); safe to call twice
onFrame(fn: (dt: number, t: number, realDt: number) => void, priority = 0): () => void
        // dt = game seconds (scaled by speed; 0 when paused or frozen); t = game time (s); lower priority runs first.
        // Reserved: camera 900, renderer 1000 (renders last). Visual modules use 0–800.
after(sec: number, fn): () => void               // game-time timer (respects speed/pause); returns cancel
now(): number; realNow(): number /*ms*/; setSpeed(x); speed(); setPaused(b); paused()   // emit speed:changed / pause:changed
freeze(t: number): void; unfreeze(): void; frozen(): boolean   // dt = 0 while frozen, t fixed
simulate(sec: number, step = 1/60): void         // runs timers + onFrame subscribers synchronously with a fixed dt: deterministic pre-warm
simulating(): boolean                            // true inside simulate(); the renderer skips drawing then
```
While the clock is frozen, `camera.setMode/set` are instant. Visual randomness is seeded (`ctx.seed`), so `simulate(t)` from a fresh page always produces the same frame.
**Every animation must be a function of `t` or accumulate `dt` from `onFrame`.** No `Date.now()` or `performance.now()` in visuals. That's what makes `?t=` deterministic.

### 10.2 `GLT.renderer`
```ts
init(host: HTMLElement): boolean      // false if no THREE/WebGL
three(): THREE.WebGLRenderer|null; canvas(): HTMLCanvasElement|null
setPixelSize(px: number): void        // low-res target = floor(cssW/px) × floor(cssH/px); nearest-filter upscale
size(): { w, h, cssW, cssH, px }      // w,h = low-res target size
setPost(o: { outlines?: boolean; dither?: boolean; raw?: boolean }): void
render(): void                        // called by its own clock subscriber (priority 1000)
onResize(fn: (size) => void): () => void
```
Post (renderer owner): render the scene into a low-res target with a depth texture → depth/normal-edge outlines → snap every pixel to the 90-colour `GLT.palette` in OKLab with 4×4 Bayer dithering → nearest upscale to the canvas. `raw` = plain render at the low resolution. Shadows: a `PCFShadowMap` updated every frame, map 2048 (1024 when `cssW < 720`).

### 10.3 `GLT.palette`
`colors: string[90]` (hex), `roles: Record<role, hex>`, `get(role): number` (0xRRGGBB; throws on an unknown role), `has(role)`, `nearest(r,g,b): number` (index into `colors`), `oklab(hex): [L,a,b]`.
Guaranteed roles: `sea-deep sea sea-light sea-foam foam sky-day sky-day-top sky-dusk sky-dusk-top sky-night sky-night-top sky-storm cloud cloud-shadow sand soil soil-dark rock rock-dark slate slate-dark grass grass-dark vine kelp wood-dark wood wood-light hull-white sail sail-shadow rope gold brass iron fire fire-hot ember smoke smoke-dark lantern skin red orange yellow green blue purple black white marine-blue marine-white`. Any other colour may be a raw hex; post snaps it anyway.

### 10.4 `GLT.voxel` (shared by world, ships, fx)
```ts
builder(o?: { size?: number /*voxel edge, m; default 0.25*/ }): VoxelBuilder
interface VoxelBuilder {
  set(x,y,z, color: number|string /*hex or palette role*/, cls?: 'solid'|'emissive'|'glass'): this;
  box(x0,y0,z0, x1,y1,z1, color, cls?): this /*inclusive integer voxel coords*/; get(x,y,z): number|null; remove(x,y,z): this;
  build(o?: { castShadow?: boolean; receiveShadow?: boolean; center?: boolean }): THREE.Group   // ONE merged mesh per class, hidden faces culled, vertex colours
  count(): number;
}
// Voxel (x,y,z) occupies [x*s,(x+1)*s] on each axis. center:true centres the X/Z bounding box on the origin; Y is untouched
// (so a ship built with its waterline at voxel y = 0 keeps the waterline at local y = 0).
material(cls: 'solid'|'emissive'|'glass', o?): THREE.Material   // shared cached materials (Lambert vertexColors / Basic / transparent)
mergeGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry
instanced(geometry, material, count): THREE.InstancedMesh
dispose(obj: THREE.Object3D): void
```
Budgets at pixel size 2: draw calls ≤ 250 total (world ≤ 90, ships ≤ 60, fx ≤ 25, crowd ≤ 6). No per-frame allocations in `onFrame` code. Dispose on rebuild.

### 10.5 `GLT.camera`: view-mode API
```ts
init(): boolean; three(): THREE.OrthographicCamera|null
setMode(mode: ViewMode, o?: { instant?: boolean; plate?: PlateId }): void     // eased 0.6 s (instant when reduced motion)
mode(): ViewMode
set(o: { azimuth?: number; elevation?: number; zoom?: number; target?: {x,y,z} }, o2?: { instant?: boolean }): void   // degrees
get(): { mode, azimuth, elevation, zoom, target: {x,y,z} }
setInputEnabled(b: boolean): void    // drag-to-turn, wheel/pinch zoom on the canvas
worldPerPixel(): number
```
Presets (zoom 1 ⇒ half-height `C.VIEW_HALF_H = 40` m, auto-fit widened for narrow aspect ratios):
`both {az 30, el 38, zoom 1, target (0, PLATE_Y, -4)}` · `own {az 30, el 50, zoom 1.9, target own centre}` · `aim {az 0, el 72, zoom 1.9, target enemy centre}` · `panorama {az 30, el 26, zoom 0.32, target (0, 30, -80)}` · `ceremony {az 20, el 22, zoom 2.6, target winner plate centre + (0,6,0)}`.
Limits: elevation ∈ [15°, 80°], zoom ∈ [0.25, 4]. Pixel snap: the target is snapped to whole low-res texels along the camera's right/up axes every frame. URL `angle/elev/zoom` → `set()` after a demo's own setup. Pointer arbitration: `GLT.picking` runs first, and if it consumes `pointerdown` (setup drag on a ship) the camera doesn't drag.

### 10.6 `GLT.lighting`
`init(): boolean; setTod(tod: Tod, o?: {instant}): void /* emits tod:changed */; tod(): Tod; sun(): THREE.DirectionalLight|null; nightFactor(): number /*0 day … 1 night*/; stormFactor(): number; flash(intensity = 1, ms = 180): void; skyColors(): { top: number; horizon: number }`.
Night: ship lanterns, torch buoys and the lighthouse beam turn on through `nightFactor()`. At most 4 dynamic point/spot lights in total. Lanterns are emissive voxels.

### 10.7 `GLT.scene`
`init(): boolean; root(): THREE.Scene|null; add(obj, layer: 'world'|'plates'|'ships'|'fx'|'backdrop'|'props'|'crowd'|'ui3d' = 'world'): void; remove(obj): void; group(layer): THREE.Group|null; onBeforeRender(fn): () => void`.

### 10.8 `GLT.picking`
`init(): boolean; setEnabled(b): void; pick(clientX, clientY): { plate: PlateId|null; r: number|null; c: number|null; point: {x,y,z}|null }; consumes(fn: (ev, hit) => boolean): void /* setupUi registers its drag handler */`. Emits the `cell:*` events (§7), with plates resolved through `GLT.layout.worldToCell` on the plane `y = PLATE_Y`.

---

## 11. World, ships, fx, audio, UI APIs

Every module below has `init(): boolean` (idempotent; subscribes to the bus) and `dispose()`. Builders may add functions.

### 11.1 world
```ts
GLT.ocean:    init(); setSea(sea: SeaId): void
GLT.plates:   init(); build(n: number): void /* both plates; called on layout:changed */;
              setColors(colors: { own: string; enemy: string }): void /* border colours */;
              setMark(plate, r, c, mark: Mark, o?: { animate?: boolean }): void; clearMarks(): void; sync(view: GameView): void;
              setCursor(plate|null, r?, c?, state?: 'hover'|'selected'|'invalid'|'hint'): void;
              setGhostCells(cells: Cell[]|null, valid: boolean): void; revealOutline(plate, ship: Ship): void;
              setFoam(plate, ships: Ship[]): void; annotate(plate, a: Annotation): void
GLT.backdrop: init(); setLift(enabled: boolean): void; liftState(): number[] /*8 values 0..1*/; sectorGroup(k): THREE.Group|null
GLT.props:    init(); setBoard(which: 'big'|'small', data: { lastCall?: string; hits?: [n,n]; sunk?: [n,n]; timer?: number|null; turnName?: string }): void
GLT.crowd:    init(); build(crews: [CrewId, CrewId], colors: [c0, c1]): void; react(kind: 'cheer'|'wave'|'jump'|'groan', side: Player|'both', intensity = 1): void
```
`plates` reacts to `shot:resolved`, `ship:sunk`, `technique:resolved`, `view:sync`, `cell:selected`, `setup:ghost`, `hint:used`, `layout:changed`, `match:created`. The Den Den Mushi boards draw text with `GLT.T` and pt-BR numbers, e.g. the last call `T('call.shot',{cell:'B7', result:T('result.agua')})` → "B7 — Água!".

### 11.2 ships
```ts
GLT.flags:      jollyRoger(flag: FlagId, size = 32): HTMLCanvasElement; texture(flag: FlagId): THREE.Texture; pennant(color: string): THREE.Texture
GLT.shipModels: build(id: ShipId, o: { trim: string; pennant: string; crew: CrewId }): ShipModel
interface ShipModel { group: THREE.Group; id: ShipId; length; beam; height;
  anchors: { muzzles: Array<{x,y,z}>; flag: {x,y,z}; crew: Array<{x,y,z}>; bow: {x,y,z}; stern: {x,y,z}; lanterns: Array<{x,y,z}> };  // local coords
  parts: { hull: THREE.Object3D; sails: THREE.Object3D[]; flag: THREE.Object3D|null; cannons: THREE.Object3D[]; figurehead: THREE.Object3D|null } }
GLT.fleet3d:    init(); setFleet(plate, fleet: Fleet|null, o: { crew: CrewId; colors; visible?: boolean }): void; clear(plate?): void;
                ghost(ship: Ship|null, valid: boolean, o?: { crew; colors }): void; damage(plate, r, c): void; sink(plate, ship: Ship, o?: { crew; colors }): void;
                recoil(plate, shipId: ShipId): void; muzzle(plate, shipId: ShipId|null): {x,y,z}|null; raiseFlag(plate, crew: CrewId): void;
                reveal(plate, fleet: Fleet, o): void; sync(view: GameView): void
```
Enemy ships stay invisible until sunk. `ship:sunk` on `'enemy'` spawns the model at its placement and plays the sink: tilt, eased descent, bubbles, and the flag left floating. The Polar Tang dives and leaves an oil slick. At `game:ended` the surviving enemy ships are revealed. Ships never change canon identity; only trim and pennant follow the owner colours.

### 11.3 fx
```ts
GLT.particles: init(); emit(kind: 'smoke'|'fire'|'spark'|'splash'|'bubble'|'plank'|'debris'|'oil'|'foam'|'confetti'|'rain', pos: {x,y,z}, o?: { count?; vel?; spread?; color?; life? }): void; clear(): void
GLT.shotFx:    init(); fire(from: {x,y,z}, to: {x,y,z}, flightS: number, o?: { tech?: TechId }): void; splash(pos): void; hit(pos): void;
               burn(plate, r, c): void; clearBurns(plate?): void; techFx(tech: TechId, plate, cells: Cell[], o?): void
GLT.fireworks: init(); start(colors: string[]): void; stop(): void
GLT.weather:   init(); set(o: { tod: Tod; sea: SeaId }): void
```
`shotFx` resolves the muzzle point with `GLT.fleet3d.muzzle(from.plate, from.shipId) ?? GLT.layout.launcher(from.plate, plate)` and calls `fleet3d.recoil`.

### 11.4 audio
```ts
GLT.audio: init(); unlock(): void /* call from the first user gesture */; play(name: SfxName, o?: { vol?; pan?; rate? }): void;
           setVolume(v: number): void; setMuted(b: boolean): void; muted(): boolean
type SfxName = 'cannon'|'splash'|'hit'|'sink'|'coin'|'click'|'select'|'invalid'|'tick'|'fanfare'|'defeat'|'sonar'|'tremor'|'vortex'|'room'|'bazooka'|'reaction'|'thunder'|'wave'
GLT.music: init(); start(): void; stop(): void; setIntensity(x: number /*0..1*/): void
```
Everything is synthesised with Web Audio (no samples). Audio follows `settings:changed` for volume/muted/music and stays silent until `unlock()`.

### 11.5 UI (`ui/`)
DOM root `#app` (gets class `.glt`) contains: `.glt-stage` (3D canvas host + overlays) | `.glt-panel` (side panel; stacked below the stage under 720 px) | `.glt-footer` (fan disclaimer `T('app.disclaimer')`). A visually hidden `#glt-live` (`aria-live="polite"`) and `#glt-alert` (`aria-live="assertive"`).
```ts
GLT.ui:          mount(root: HTMLElement): UiRefs; refs(): UiRefs; show(screen: ScreenId): void; announce(text: string, mode?: 'polite'|'assertive'): void;
                 toast(key: string, vars?: object, kind?: 'info'|'warn'|'error'): void
interface UiRefs { root; stage; overlay; panel; footer; live; alert; grids /*2D grid host*/ }
GLT.theme:       init(); set(mode: 'auto'|'light'|'dark'): void; current(): 'light'|'dark'; token(name: string): string /*resolved CSS var*/
GLT.menuUi:      init(refs); config(): MatchConfig
GLT.setupUi:     init(refs); open(view: GameView, fleet: Fleet|null): void; close(): void; fleet(): Fleet
GLT.grid2d:      create(host: HTMLElement, o: { size: number; plate: PlateId; mode: 'setup'|'target'|'own'; labelKey: string }): Grid2D
interface Grid2D { update(view: GameView): void; setCursor(r: number|null, c?: number): void; setGhost(ship: Ship|null, valid: boolean): void; focus(): void; destroy(): void; el: HTMLElement }
GLT.hud:         init(refs)
GLT.logbook:     init(refs); add(entry: { key: string; vars?: object; kind?: 'shot'|'hit'|'sunk'|'tech'|'info'|'taunt'|'net' }): void; clear(): void
GLT.statsUi:     init(refs); showGame(e: game:ended payload): void; showSeries(e: match:ended payload): void
GLT.lobbyUi:     init(refs); show(): void
GLT.settingsUi:  init(refs); open(): void; close(): void
GLT.ceremonyUi:  init(refs); show(e: ceremony:start payload): void; hide(): void
GLT.wanted:      draw(canvas: HTMLCanvasElement, o: { crew: CrewId; bounty: number; progress: number /*0..1 count-up*/; seed?: number; hero?: boolean }): void
```
**Interaction rules:** select a cell (3D click, 2D click, or keyboard: arrows move, `A`–`L` jumps to a row, `1`–`0` to a column, Enter selects/confirms) → FOGO! confirms. A tap selects and never fires. In setup, R / right-click / double-tap rotates. The 2D grid is always in the DOM as the accessible control. With `grid2d` on, it also becomes the main visual. Every result is announced through `GLT.ui.announce`. All controls are reachable by keyboard and focus is always visible.

---

## 12. Language, strings, theme

* `GLT.T(key: string, vars?: object): string`. Dictionary values are:
  * a string with `{name}` placeholders. Numbers in `vars` are formatted with `GLT.i18n.num`, and a var given as `{key, vars}` is translated recursively, e.g. `T('call.shot', {cell:'B7', result:{key:'result.agua'}})` → "B7 — Água!";
  * a plural object `{one, other}` chosen by `vars.n` through `Intl.PluralRules('pt-BR')`;
  * an array of variants chosen by `vars.v` modulo the array length.
  A missing key returns the key itself and adds it to `GLT.i18n.missing` (no console output). Tests assert that `missing` stays empty.
* `GLT.i18n`: `lang 'pt-BR'; dict; has(key); variants(key): number; num(n, o?); berry(n) /* '฿ 1.500.000.000' */; pct(x /*0..1*/, digits = 0); time(ms) /* '1:05' */; cell(r, c); list(items: string[]) /* 'a, b e c' */; missing: string[]; fontsReady(): Promise<void>`.
* The dictionary lives in **one file**, `src/ui/i18n.js`, owned by ui and seeded by the architect with every cross-area key: ships, crews, techniques, results, calls, turns, formats, seas, difficulties, rules, cameras, settings, setup, HUD, log, stats, ceremony, PvP, reactions, taunts, nicknames, a11y, errors. Need a key that doesn't exist? Use it, and list it under "Requests for other areas" with the proposed PT-BR text.
* Tone: playful pirate talk ("Água!", "Acertou em cheio!", "Afundou o Going Merry!", "Sua vez, capitão!"). Correct accents and cedilla everywhere.
* Fonts (the build's Google Fonts link; CSS vars in `base.css`): `--font-display: 'Pirata One'` (titles), `--font-pixel: 'Pixelify Sans'` (UI/HUD/body), `--font-num: 'Press Start 2P'` (numbers, timers, coordinates; use small sizes). All three cover Latin-Extended. Verify ç ã õ é ê í ó ú in a screenshot. Canvas text waits for `GLT.i18n.fontsReady()` and redraws once fonts load.
* Theme: `<html data-theme="light|dark">` is set by `GLT.theme` (`auto` follows `prefers-color-scheme`). Colours are tokens on `:root` (`--bg --bg-2 --bg-3 --fg --fg-dim --line --accent --accent-2 --danger --ok --warn --focus --shadow --own --enemy`). Dark values live under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` **and** `:root[data-theme="dark"] {…}`. `body` has an explicit background. `--own`/`--enemy` are set at runtime from the crews' colours. The 3D scene follows `tod`, not the theme.
* Layout: works from a 320 px width with a 16 px gutter and no horizontal page scroll. Strings must fit their containers (no clipping and no lost accents). Reduced motion: no camera easing, no screen shake, fewer particles, an instant lift, a gentler crowd.

---

## 13. Demo registry

```ts
GLT.demos = GLT.demos || {};          // the harness prelude already created it
GLT.demos['<area>.<name>'] = function (ctx: DemoCtx): void | Promise<void> { … };
interface DemoCtx {
  // from the harness:
  params: { demo, angle, elev, zoom, tod, seed, t }; root: HTMLElement /* #app */; THREE; GLT; clock: () => number; ready(): void /* DON'T call; resolve instead */;
  // added by the app/main.js wrapper:
  name: string; seed: number /* ?seed= or 1 */; rng: Rng /* cosmetic, from seed */; tod: Tod; t: number|null;
  angle: number|null; elev: number|null; zoom: number|null; stage: HTMLElement /* the 3D host */; webgl: boolean;
  sampleFleet(format?: FormatId): Fleet;      // a deep copy of GLT.data.sampleFleets[format] (valid, fixed)
}
```
How a demo runs (`?demo=name&angle=&elev=&zoom=&tod=&seed=&t=`). The harness runner calls `GLT.demos[name]`, which `app/main.js` has already replaced with a wrapper that:
1. builds the stage (a full-viewport `.glt-demo`; `ui.*` demos and `app.game` get the full UI shell from `GLT.ui.mount`) → `renderer/scene/camera/lighting/picking.init()` → `lighting.setTod(tod)` → `camera.setMode('both',{instant:true})` → `layout.setSize(10)` (a demo may change it);
2. freezes the clock at 0 when `t` is given, so camera moves during setup are instant, then `await`s the original demo with the merged ctx;
3. applies URL `angle/elev/zoom` with `camera.set(…, {instant:true})`, so **URL params win over the demo's own camera**;
4. if `t` is given: `clock.simulate(t)` then `clock.freeze(t)`. It always calls `clock.start()`, and the RAF loop keeps rendering a frozen clock;
5. waits 3 frames and resolves, and the harness sets `window.GLT_READY = true`. A throw or rejection becomes `GLT_ERROR` plus a console error (shot fails).
Demos must not start the game, must not call `ctx.ready()`, must only use the network-free mem transport, and must build everything they show through the public APIs (they double as integration checks).

Demo names. Owners register at least these, and may add more:
`render.palette` (swatches + dither ramp), `render.camera` (exists: plate grids, cells and ship envelopes straight from `GLT.layout`; the visual check of §9) · `world.plates`, `world.backdrop`, `world.props`, `world.crowd`, `world.ocean` · `ships.all` (7 ships on a plate), `ships.<ShipId>` (close-up), `ships.sink`, `ships.ghost` · `fx.shots`, `fx.hit`, `fx.sink`, `fx.techniques`, `fx.fireworks`, `fx.weather` · `ui.menu`, `ui.setup`, `ui.battle`, `ui.stats`, `ui.lobby`, `ui.ceremony`, `ui.wanted` · `app.scene` (the full composed scene with sample fleets), `app.game` (CPU vs CPU playing live), `app.ceremony`.
UI demos may emit fake bus events to populate themselves. Demos never need the network.

---

## 14. PvP on the artifact runtime (exact capability for the final publish)

The final page is published as an Artifact with exactly:
```json
{
  "db": { "rules": [
    { "path": "lobby",         "read": "view", "write": "interact" },
    { "path": "pvp",           "read": "view", "write": "self" },
    { "path": "pvp/{self}",    "read": "view", "write": "interact" },
    { "path": "wanted",        "read": "view", "write": "self" },
    { "path": "wanted/{self}", "read": "view", "write": "interact" }
  ] },
  "room": { "topics": { "ping": "interact", "pong": "interact", "react": "interact" } },
  "user": {}
}
```
Why: `db` holds the durable move log (replay on reconnect, late joiners, spectators). Each player's stream sits under their **own** `pvp/<uid>/…` subtree, where `write:"self"` lets nobody else write, the owner included, so one player can't forge the other's moves. Everyone signed in can read it, so spectators work. `room` carries ephemeral liveness: named-room presence is the heartbeat, `ping`/`pong` measure round-trip latency, and `react` carries preset reactions. `user` supplies the opaque id `db` recognises for `{self}`. No names are requested.

**Store layout (`GLT.transportHost`):**
* `lobby/<CODE>`: `RoomInfo`. Create: `acquire` a lease on the doc → `get` → `set` if it's absent or stale (older than `NET.roomTtl`). Claim: `acquire` → `get` → `update({guest, status:'full', updatedAt})` only if `guest` is null.
* `pvp/<uid>/log/<CODE>.<k>`: `{ code, author: uid, slot, k, events: MoveLogEvent[] }`. Chunk `k` holds that author's events with `n ∈ [k*100+1, (k+1)*100]`. Writes to a chunk doc are serialised: one write in flight per doc, a queue, and retry once on `unavailable`. Read/subscribe with `db.collection('pvp/'+uid+'/log').where('code','==',CODE)` (one `onSnapshot` per author).
* `wanted/<uid>`: `WantedEntry` (best bounty only; written after a series if it improves).
* Named room `glt-<code lowercased>`: presence `{ pid, slot, n }` re-set every `NET.heartbeat` (the changing `n` bumps `updatedAt`). Signals `ping {t, to: peer}` / `pong {t, to: peer}` / `react {preset}`.
* Lobby room presence: `{ nick, crew, hosting: CODE|null }`. "online agora" = the lobby peer count. `openRooms` shows only rooms whose host is present when presence is available.
* Never write from a timer with unchanged data. Heartbeats use room presence, not `db`.

**Probe and degradation (`GLT.transportHost.probe(claude = globalThis.claude) → Promise<{ ok, reason, db, room, user, uid, canWrite }>`):**
`reason`: `'no_runtime'` (no `window.claude` or `use`) · `'no_db'` (`use('db')` → null) · `'no_identity'` (`user.id()` → null) · `'read_only'` (`can('data.write') === false`: spectating allowed, playing not). `room` null → PvP still works, but without RTT, "reconectando" or presence-based forfeit (absence is judged from log timestamps only). With PvP unavailable, the lobby shows `T('pvp.unavailable.<reason>')` and PvC stays fully functional. Never block first paint on the probe (`use()` resolves after the first script run and may take up to 10 s).
A second tab of the same player in the same room (`otherTab`) → that tab becomes read-only with `T('pvp.otherTab')`.
Players need the artifact shared with them at **Contributor** (interact) level or higher. Viewers can spectate.

---

## 15. Tests (`tests/`)

* `node tests/run.mjs [piece] [--list] [--root <dir>] [--grep text] [--quick]` (also documented in `tools/README.md`; `tools/smoke.mjs` exercises it). Before **each** test file it reloads `src/logic/*.js`, `src/net/*.js` and `src/ui/i18n.js` (build order, through `tools/lib/modules.js`) with `vm.runInThisContext`. That is the **same realm**, so `assert.deepStrictEqual` works on engine objects. Node has no `window`, `document` or `THREE`, and Node's own `crypto.subtle`, `TextEncoder`, `performance` and timers are available. A file fails if loading leaks any global other than `GLT`.
* A test file `tests/<piece>.<name>.test.mjs` uses the global `GLT` and the injected global `test(name, fn)` (sync or async; `test.todo(name)` marks a pending case), with `import assert from 'node:assert/strict'` at top level. Optionally it can
  `export default function (test, ctx) { … }`
  with `ctx = { GLT, assert, load() /* a fresh GLT in an ISOLATED realm, e.g. a second PvP client: compare across realms with JSON */, loadAll() /* every src/**/*.js in a bare realm */, loadFiles(files), report(key, data) /* written to tests/out/<file>.json */, quick: boolean /* --quick or GLT_QUICK=1: scale heavy sims down */, ROOT, files }`.
* `piece` filters by file prefix (`logic`, `net`, `ui`, `contract`). No argument runs everything. `--list` prints the load order and the matching files. Exit code 1 on any failure.
* Contract tests (architect): `contract.load` (every `src/**/*.js` loads in a bare VM, all namespaces from §2 exist), `contract.layout` (mapping invariants), `contract.data` (tables and sample fleets valid), `contract.i18n` (keys referenced by `GLT.data` exist).
* Quality bar (logic and net builders): see SPEC.md. Logic: ≥ 2000 games per combination (difficulties × boards × modes × seas), with termination, valid placement, consistent scoring, reproducibility, shots-to-win per difficulty and the first-player win rate reported through `ctx.report`. Net: the mem hub with latency/drop/dup/reorder, refresh, disconnect, timeout, double clicks and tampered answer/commit. Both clients must reach an equal `publicDigest`.

---

## 16. Quick reference: who calls whom

```
ui ──(ui:* intents on GLT.events)──▶ app ──▶ Driver (pvc: engine+ai │ pvp: session→protocol→transport)
app ──(game/shot/ship/turn/… events)──▶ GLT.events ──▶ plates · fleet3d · shotFx · particles · props · crowd · audio · music · hud · logbook · grid2d · statsUi · ceremonyUi
app ──(direct calls)──▶ layout.setSize · camera.setMode · lighting.setTod · backdrop.setLift · renderer.setPixelSize/setPost · prefs · persist · ui.show
render/picking ──(cell:* events)──▶ setupUi (setup) · app (battle selection)
everyone ──(call time only)──▶ GLT.C · GLT.layout · GLT.board · GLT.data · GLT.T · GLT.palette · GLT.voxel · GLT.clock
```
