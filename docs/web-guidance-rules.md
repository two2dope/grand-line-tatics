# Web guidance rules (frozen)

Frozen on 2026-11-17 from `npx -y modern-web-guidance@latest retrieve form-factor-adaptation,motion,efficient-background-processing`, plus the game-over baseline (`references/03-modern-web-baseline.md`). Volatile features and origin trials stay **off** (no opt-in given). Changes to this file need the operator's approval.

## R1 — Target size (WCAG 2.5.8 / 2.5.5)

- Every control is at least 24×24 CSS px; at least **44×44 under `@media (pointer: coarse)`**.
- Drive it from one token: `:root { --target-size: 24px }` and `@media (pointer: coarse) { :root { --target-size: 44px } }`, applied with `min-block-size` / `min-inline-size` on buttons and `[role="button"]`.
- Small HUD icons keep their visual size and grow the hit area with `position: relative` plus `::after { content: ""; position: absolute; inset: -10px }`. Extended areas must not overlap each other or run past the screen edge.
- Board cells are exempt from the 44 px floor when the board cannot fit (a 12×12 grid on a 360 px phone). They keep the 24 px floor and the existing tap-to-aim plus confirm flow.

## R2 — Safe area and viewport

- Keep `viewport-fit=cover`. Pad edge-anchored UI with `max(<pad>, env(safe-area-inset-*, 0px))`.
- Heights use `100vh` followed by `100dvh` (fallback first); never `100vh` alone.
- No `overflow-x: hidden` on `html`/`body` to hide overflow. Fix the wide element instead.

## R3 — Reduced motion

- CSS: when reduced motion means *no animation*, opt in with `@media (prefers-reduced-motion: no-preference)`. When it means *gentler*, override parameters inside `@media (prefers-reduced-motion: reduce)`. No global `animation-duration: 0.01ms`.
- JS: read `matchMedia('(prefers-reduced-motion: reduce)')` once and listen for `change`. Under reduce:
  - camera shake goes to zero;
  - screen flashes and fireworks bursts are damped;
  - particle counts are cut.

  Colour and opacity feedback stays.
- Engine wiring: `GLT.prefs.reducedMotion()` (`src/sea/env.js`, reads the media query unless the player overrides it) feeds camera shake (`sea/bridge.js`), shot flashes and particle counts (`fx/shots.js`, `fx/particles.js`), lighting, ships and fireworks (no burst flash, at most one shell per second).
- Known deviation, kept on purpose: the existing global `animation-duration/transition-duration: 0.01ms` rule under `reduce` in `getStyles()`. Replacing it means touching all 12 keyframe users one by one; that is scheduled with the `<dialog>` work (Onda 3), not Onda 1.
- Nothing flashes more than 3 times per second, whatever the preference (WCAG 2.3.1).
- When an animation is skipped, the element still ends in its final state. Code that waits for `animationend`/`transitionend` continues immediately when `getAnimations()` is empty.

## R4 — Background work

- Rendering: `requestAnimationFrame` already stops in hidden tabs. The loop clamps `dt` to 0.1 s so a returning tab never jumps.
- Network: the LAN relay is push (SSE `EventSource`), and PeerJS sends a keepalive `ping`. **Do not pause either on `visibilitychange`**: that would drop a live match. Reconnect and resync on return is the contract instead (already in `transport.js`).
- Audio suspends on `visibilitychange` (`sfx.js`). The wake lock is re-acquired on visible (`app-shell.js`).

## R5 — Dialogs and focus

- Keep the current div-based modals working: the focus moves in on open and returns to the trigger on close, and `Esc` closes them.
- New modals use native `<dialog>` with `showModal()`. Migrating the old ones is Onda 3.
- `:focus-visible` outline on every interactive element.
