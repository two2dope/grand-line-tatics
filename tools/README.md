# Toolchain

Node 18+, dev dependency `playwright` only (`npm install && npx playwright install chromium`).
Verified end to end with `npm run smoke` (`node tools/smoke.mjs`), which uses the fixture in `tools/smoke/`.

## build.js

```
node tools/build.js --out dist/<tag>.html [--only logic,render] [--no-deps] [--vendor] [--title "..."] [--fonts <css url>] [--list] [--root <dir>]
```

- Concatenates `src/<area>/*.js` in fixed area order `logic, net, ui, render, world, ships, fx, audio, app`.
  One `<script>` per module, each with `//# sourceURL=glt/<area>/<file>` so stack traces name the file.
- Order inside an area: files starting with `_` first, then alphabetical. A file can declare
  `// @after other.js, third.js` in its first 10 lines to be placed after those files.
- `ui/i18n.js` is ALWAYS included (first in `ui`), even with `--only logic`.
- `--only a,b` expands area dependencies (`tools/lib/modules.js`, overridable via `tools/deps.json`):
  net/ui/render/audio need logic; world/ships/fx need logic+render; app needs everything. `--no-deps` turns expansion off.
- Every module is syntax-checked with `new Function` before anything is written; on failure it prints
  `build: ERROR syntax error in src/x/y.js (line N): ...` and exits 1 with no output file.
- Inlines all `src/ui/*.css`. If `src/ui/body.html` exists it replaces the default body `<div id="app"></div>`.
- three.js r128: `<script src=cdnjs ...>` by default (only when render/world/ships/fx/app is in the build).
  `--vendor` inlines `tools/vendor/three.min.js` instead (offline/test builds; do not ship that file).
- Adds the Google Fonts link (Pirata One, Pixelify Sans, Press Start 2P; override with `--fonts`).
- `--root <dir>` reads `<dir>/src` instead of the project's `src` (used by the smoke fixture).

### Harness (injected by build.js, not a module)

- Prelude: `GLT.params = {demo, angle, elev, zoom, tod, seed, t}` (numbers parsed, `undefined` if absent),
  `GLT.demos = {}`, `GLT.clock()` = seconds, frozen at `?t=` when given, else wall time since load.
  Use `GLT.clock()` (not `performance.now`) for anything that animates so shots are deterministic.
- Runner (after all modules): if `?demo=name` is set it calls `GLT.demos[name](ctx)` with
  `ctx = {params, root (#app), THREE, GLT, clock, ready()}`; sync or async, then sets `window.GLT_READY = true`.
  Unknown demo or a throw sets `window.GLT_ERROR` and logs `console.error` (shot.mjs then exits 1).
- The real app must not self-start when `GLT.params.demo` is set, and must set `window.GLT_READY = true` itself
  once its first frame is drawn when running without `?demo=`.

## shot.mjs

```
node tools/shot.mjs --html dist/x.html --demo name --angle 45 --elev 35 --zoom 1 --tod day --seed 7 --t 0.5 --out shots/p/x.png
     [--viewport 1280x720] [--frames 5] [--eval "js"] [--sequence "0,0.2,0.4"] [--timeout 30000] [--no-ready] [--full-page]
```

- Chromium headless with SwiftShader WebGL flags. three.js r128 is served from `tools/vendor/` through request routing
  (works offline even for CDN builds); Google Fonts use the network and silently fall back to nothing when offline.
- Waits for `window.GLT_READY`, then `--frames` animation frames, then screenshots. `--no-ready` skips the wait (static pages).
- `--eval "<js>"` runs after the shot; the JSON of the result is the ONLY thing written to stdout
  (an expression like `GLT.x.y()` or a statement block with `return`; async is awaited). Logs go to stderr.
- `--sequence "0,0.2,0.4"` reloads with `?t=` for each value and writes `x_00.png, x_01.png, ...`.
- Writes `<out>.console.json` (`ok`, `errors`, `warnings`, `pageErrors`, `failedRequests`, all `messages`).
  Exit 1 on any console error, pageerror, GLT_ERROR or missing GLT_READY. WebGL "GPU stall" warnings are warnings, not errors.

## blind.mjs

```
node tools/blind.mjs <ours.png> <ref.png> <outdir> <swap 0|1> [--size WxH]
```

Re-encodes both images to the same size (default: ours; the reference is cover-cropped) which strips metadata and names, and writes
`A.png`, `B.png`, `mapping.json`. `swap=0`: A=ours, B=ref. `swap=1`: A=ref, B=ours. Read A and B and decide BEFORE opening `mapping.json`.

## tests/run.mjs

```
node tests/run.mjs [piece] [--list] [--root <dir>]
```

Loads `src/logic` then `src/net` with `vm.runInThisContext` (classic scripts, same realm so `assert.deepStrictEqual` works on their
objects; no `window`, `document` or `THREE` exist, so DOM use throws). It fails if a module leaks a global other than `GLT`.
Runs `tests/<piece>.*.test.mjs` (all `*.test.mjs` without an argument). A test file can use `GLT` and `node:assert/strict` at top level
and/or register cases with the injected global `test(name, async fn)`. Exit 1 on any failure.

## progress/index.html

Open `progress/index.html` in a browser; it reloads every 4 s (meta refresh) and renders `window.PROGRESS` from `progress/data.js`:

```js
window.PROGRESS = {
  started: "2026-11-06 10:00", updated: "2026-11-06 10:42", phase: "Rodada de peças",
  pieces: { "world/plates": { status: "building", round: 1, maxRounds: 4, model: "sonnet", gap: "last gap text", score: "7/10", notes: ["..."] } },
  notes: ["global note, newest last"]
};
```

Statuses with colours: queued, building, critiquing (judging/review/fixing/retry), passed (done/ok/accepted), failed/blocked/error.
`pieces` may also be an array of `{name, ...}`.

## After the pilot port (SCOPE-V2 stage 1)

- The game now builds with `npm run build` (`scripts/build.js`, pilot concatenation; render modules from `src/pilot-render/`).
- This toolchain (`tools/build.js`, `tests/run.mjs` -> `legacy/tests/run.mjs`) still builds our render/world/ships/fx demos. Their old
  logic/net/ui/audio/app dependencies live in `legacy/src`; pass `--legacy` to `tools/build.js` (or `GLT_LEGACY=1`) to use them:
  `npm run build:demo`, `npm run test:legacy`.
- `node tools/baseline.mjs` writes the pilot-look baseline screenshots to `shots/baseline/` (+ `_report.json` with console errors).
