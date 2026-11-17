/**
 * Grand Line Tactics — Single-File HTML Concatenation & Build Script
 * File: scripts/build.js
 *
 * Concatenates:
 * 1. Semantic HTML5 skeleton (<html lang="pt-BR">, WCAG-compliant viewport, color-scheme).
 * 2. Google Fonts (Pirata One, Press Start 2P, Chakra Petch with latin & latin-ext subsets).
 * 3. Three.js r128 from CDN.
 * 4. Nautical Brass & Abyssal Command Console Stylesheet (OKLab gradients, layered shadows,
 *    Light Parchment theme, custom scrollbars, WCAG focus-visible, prefers-reduced-motion, 375px mobile).
 * 5. All source modules in strict dependency order.
 *
 * Outputs:
 * - index.html
 * - grand-line-tactics.html
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Loaded between _enter.js and _exit.js: every file here sees globalThis.GLT === GLT.sea at load time.
const SEA_FILES = [
  'src/sea/_enter.js',
  'src/sea/consts.js',
  'src/sea/events.js',
  'src/sea/rng.js',
  'src/sea/layout.js',
  'src/sea/data.js',
  'src/sea/env.js',
  'src/render/clock.js',
  'src/render/palette.js',
  'src/render/voxel.js',
  'src/render/scene.js',
  'src/render/renderer.js',
  'src/render/camera.js',
  'src/render/lighting.js',
  'src/world/_kit.js',
  'src/world/ocean.js',
  'src/world/plates.js',
  'src/world/backdrop.js',
  'src/world/props.js',
  'src/world/crowd.js',
  // fx (stage 4): pooled particles, shot balls/reticles/burns/sinking, fireworks + flag hoist, weather
  'src/fx/particles.js',
  'src/fx/shots.js',
  'src/fx/ceremony.js',
  'src/fx/fireworks.js',
  'src/fx/weather.js',
  'src/sea/_exit.js'
];

const SOURCE_FILES = [
  'src/logic/rng.js',
  'src/logic/i18n.js',
  'src/logic/rules.js',
  'src/logic/ai.js',
  'src/net/transport.js',
  'src/logic/protocol.js',
  // the sea: our render + world modules in their own namespace (GLT.sea), see src/sea/_enter.js
  ...SEA_FILES,
  'src/ships/kit.js',
  'src/ships/flags.js',
  'src/ships/models.js',
  'src/ships/pilot-api.js',
  'src/pilot-render/backdrop-fx.js',
  'src/sea/bridge.js',
  'src/sea/fx-bridge.js',
  'src/audio/sfx.js',
  'src/ui/qrcode.js',
  'src/ui/app-shell.js',
  'src/ui/ui.js'
];

function getStyles() {
  return `
/* =========================================================================
   GRAND LINE TACTICS — NAUTICAL COMMAND CONSOLE DESIGN SYSTEM
   Aesthetic: Sea of Stars Pixel Luminance + Ornate Pirate Brass & Parchment
   ========================================================================= */

:root {
  color-scheme: dark;
  --bg-primary: #061121;
  --bg-secondary: #0b1b33;
  --bg-tertiary: #112645;
  --bg-elevated: #173259;
  --panel-bg: rgba(10, 24, 45, 0.97);
  --border-color: #213f68;
  --border-highlight: #3a689e;
  --border-brass: rgba(245, 166, 35, 0.42);
  --text-primary: #f4f8fc;
  --text-muted: #9db4cf;
  --gold: #f5a623;
  --gold-bright: #ffd35c;
  --gold-glow: rgba(245, 166, 35, 0.42);
  --crimson: #e11d48;
  --crimson-glow: rgba(225, 29, 72, 0.45);
  --marine-blue: #38bdf8;
  --emerald: #10b981;
  --purple: #8b5cf6;
  --cyan-beacon: #62e3f7;
  --font-pirate: 'Pirata One', Georgia, serif;
  --font-pixel: 'Press Start 2P', monospace;
  --font-sans: 'Chakra Petch', system-ui, -apple-system, sans-serif;
  --shadow-card: 0 2px 4px rgba(0, 0, 0, 0.35), 0 10px 26px rgba(2, 8, 20, 0.55);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.glt-theme-light {
  color-scheme: light;
  --bg-primary: #f3e8cf;
  --bg-secondary: #e7d6b3;
  --bg-tertiary: #dcc69b;
  --bg-elevated: #f8f0dc;
  --panel-bg: rgba(242, 229, 201, 0.98);
  --border-color: #b79b6c;
  --border-highlight: #8f6f3e;
  --border-brass: rgba(154, 91, 19, 0.5);
  --text-primary: #1a2536;
  --text-muted: #4b5563;
  --gold: #9a5209;
  --gold-bright: #b45309;
  --gold-glow: rgba(154, 82, 9, 0.25);
  --crimson: #be123c;
  --crimson-glow: rgba(190, 18, 60, 0.28);
  --marine-blue: #0369a1;
  --emerald: #047857;
  --purple: #6d28d9;
  --cyan-beacon: #0284c7;
  --shadow-card: 0 2px 4px rgba(62, 39, 14, 0.12), 0 8px 20px rgba(62, 39, 14, 0.18);
  --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.55);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.4;
  /* A finger dragging past the end of the panel must not pull the page: no rubber band,
     no pull-to-refresh reloading the match. */
  overscroll-behavior: none;
}

/* Touch: taps act at once (no double-tap zoom wait), a long press on the board or the radar
   opens no copy/share callout. Pinch zoom of the page stays available for reading. */
button,
select,
input,
label,
[role="button"],
[role="tab"],
.glt-radar-table td {
  touch-action: manipulation;
}

.glt-viewport-container,
.glt-radar-table {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
}

.glt-app-note {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Custom Brass & Abyssal Scrollbars */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-highlight) var(--bg-secondary);
}
*::-webkit-scrollbar {
  width: 7px;
  height: 7px;
}
*::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}
*::-webkit-scrollbar-thumb {
  background: var(--border-highlight);
  border-radius: 4px;
}
*::-webkit-scrollbar-thumb:hover {
  background: var(--gold);
}

/* Limit user-select: none strictly to interactive game chrome (Modern Web Guidance) */
.glt-viewport-container,
.glt-tabs-nav,
.glt-radar-table,
button {
  user-select: none;
}

/* High-contrast accessible keyboard focus ring */
:focus-visible {
  outline: 2px solid var(--gold-bright);
  outline-offset: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Master App Container with Dynamic Viewport Units */
#glt-app {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  position: relative;
  background: var(--bg-primary);
  color: var(--text-primary);
  /* Installed app and full screen draw under the notch and the home bar (viewport-fit=cover):
     keep the controls out of them. Zero in a normal browser tab. */
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
}

/* 1. TOP SCOREBOARD BUG & HUD */
#glt-top-hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  background: linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-secondary) 100%);
  border-bottom: 2px solid var(--border-brass);
  box-shadow: 0 3px 14px rgba(0, 0, 0, 0.45), var(--shadow-inset);
  z-index: 20;
  gap: 10px;
  min-height: 50px;
  flex-shrink: 0;
}

@supports (background: linear-gradient(in oklab, #000, #fff)) {
  #glt-top-hud {
    background: linear-gradient(in oklab 180deg, var(--bg-elevated) 0%, var(--bg-secondary) 100%);
  }
}

.glt-brand-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-shrink: 0;
}

.glt-main-title {
  font-family: var(--font-pirate);
  font-size: 27px;
  color: var(--gold-bright);
  letter-spacing: 1.2px;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.75);
  white-space: nowrap;
}

.glt-subtitle {
  font-family: var(--font-pixel);
  font-size: 8.5px;
  color: var(--text-muted);
  white-space: nowrap;
  letter-spacing: 0.4px;
}

.glt-status-bug {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  flex: 1;
  justify-content: center;
  overflow: hidden;
}

.glt-badge {
  font-family: var(--font-pixel);
  font-size: 8.5px;
  padding: 5px 8px;
  border-radius: 5px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  white-space: nowrap;
  box-shadow: var(--shadow-inset);
}

.badge-mode {
  border-color: var(--border-brass);
  color: var(--gold-bright);
}

.badge-sea {
  border-color: rgba(56, 189, 248, 0.45);
  color: var(--marine-blue);
}

.badge-series {
  border-color: rgba(139, 92, 246, 0.55);
  color: #c4b5fd;
}

.glt-turn-pill {
  font-family: var(--font-pixel);
  font-size: 8.5px;
  padding: 5px 10px;
  border-radius: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 310px;
  text-align: center;
  line-height: 1.3;
  font-weight: 700;
  animation: pulse-border 2.2s infinite ease-in-out;
}

.glt-turn-pill.your-turn {
  background: rgba(16, 185, 129, 0.18);
  border: 1px solid var(--emerald);
  color: #34d399;
}

.glt-theme-light .glt-turn-pill.your-turn {
  color: #065f46;
}

.glt-turn-pill.enemy-turn {
  background: rgba(225, 29, 72, 0.18);
  border: 1px solid var(--crimson);
  color: #fda4af;
}

.glt-theme-light .glt-turn-pill.enemy-turn {
  color: #9f1239;
}

.glt-turn-pill.ready {
  background: rgba(245, 166, 35, 0.16);
  border: 1px solid var(--gold);
  color: var(--gold-bright);
}

.glt-timer-pill {
  font-family: var(--font-pixel);
  font-variant-numeric: tabular-nums;
  font-size: 9.5px;
  padding: 5px 8px;
  border-radius: 5px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  min-width: 44px;
  text-align: center;
  flex-shrink: 0;
}

.glt-timer-pill.expiring {
  background: rgba(225, 29, 72, 0.3);
  border-color: var(--crimson);
  color: #fecdd3;
  animation: pulse-crimson 0.6s infinite alternate;
}

.glt-bounty-pill {
  font-family: var(--font-sans);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  letter-spacing: 0.4px;
  padding: 4px 10px;
  border-radius: 5px;
  background: linear-gradient(135deg, rgba(245, 166, 35, 0.2), rgba(180, 83, 9, 0.12));
  border: 1px solid var(--border-brass);
  color: var(--gold-bright);
  white-space: nowrap;
  flex-shrink: 0;
}

.glt-berry-sym {
  font-family: var(--font-sans);
  font-weight: 800;
  margin-right: 2px;
}

.glt-quick-tools {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.glt-icon-btn {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-radius: 6px;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 15px;
  box-shadow: var(--shadow-inset);
  transition: transform 0.14s ease, border-color 0.14s ease, background-color 0.14s ease;
}

.glt-icon-btn:hover {
  border-color: var(--gold);
  transform: translateY(-1px);
}

.glt-icon-btn.active {
  background: rgba(245, 166, 35, 0.22);
  border-color: var(--gold);
}

/* 2. MAIN WORKSPACE */
#glt-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.glt-viewport-container {
  flex: 1;
  min-width: 0;
  position: relative;
  background-color: #071936;
  background-size: cover;
  background-position: center bottom;
  background-repeat: no-repeat;
  transition: background-image 0.8s ease-in-out;
  overflow: hidden;
}

#stage-canvas {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  cursor: crosshair;
}

/* Camera Bar Overlay */
.glt-camera-bar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  z-index: 10;
}

.glt-pill-btn {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  padding: 5px 11px;
  background: rgba(8, 20, 38, 0.84);
  border: 1px solid rgba(148, 163, 184, 0.35);
  color: #dbeafe;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  transition: all 0.15s ease;
}

.glt-theme-light .glt-pill-btn {
  background: rgba(248, 240, 220, 0.9);
  color: #1e293b;
  border-color: var(--border-color);
}

.glt-pill-btn:hover:not(:disabled) {
  border-color: var(--gold-bright);
  transform: translateY(-1px);
}

.glt-pill-btn.active {
  background: linear-gradient(135deg, rgba(245, 166, 35, 0.34), rgba(180, 83, 9, 0.28));
  border-color: var(--gold-bright);
  color: #fff3c4;
}

.glt-theme-light .glt-pill-btn.active {
  color: #78350f;
}

/* Rival Captain Portrait & Taunt Bubble */
.glt-rival-overlay {
  position: absolute;
  top: 48px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(420px, calc(100% - 24px));
  z-index: 10;
  pointer-events: none;
}

.glt-captain-avatar {
  width: 46px;
  height: 46px;
  border-radius: 8px;
  background: #091426;
  border: 2px solid var(--gold);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.65);
  flex-shrink: 0;
  overflow: visible;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.rival-avatar-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.rival-portrait-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 6px;
  display: block;
}

.rival-seal-badge {
  position: absolute;
  bottom: -5px;
  right: -6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.75);
  z-index: 2;
}

.glt-captain-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.glt-taunt-bubble {
  background: rgba(8, 20, 38, 0.88);
  border: 1px solid var(--border-brass);
  border-radius: 8px;
  padding: 7px 11px;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  line-height: 1.3;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: 360px;
}

.glt-theme-light .glt-taunt-bubble {
  background: rgba(248, 240, 220, 0.94);
  color: #1e293b;
}

.rival-bubble-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rival-badge {
  background: var(--crimson);
  color: #ffffff;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 800;
  font-size: 9px;
}

.rival-badge.player-badge {
  background: #0284c7;
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.rival-speaker {
  color: var(--gold);
  font-size: 11px;
}

.rival-bubble-text {
  font-style: italic;
  font-size: 12px;
  line-height: 1.35;
  color: #f1f5f9;
}

.glt-theme-light .rival-bubble-text {
  color: #1e293b;
}

.glt-player-captain-toast {
  position: absolute;
  top: 72px;
  left: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(10, 18, 32, 0.94);
  border: 2px solid var(--accent-cyan);
  border-radius: 10px;
  padding: 8px 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
  z-index: 95;
  pointer-events: none;
  animation: glt-player-toast-enter 2.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.player-toast-thumb {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--gold);
}

.player-toast-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.player-toast-header {
  font-size: 10px;
  font-weight: 800;
  color: var(--accent-cyan);
  text-transform: uppercase;
}

.player-toast-quote {
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  font-style: italic;
}

@keyframes glt-player-toast-enter {
  0% { opacity: 0; transform: translateY(-12px) scale(0.95); }
  12% { opacity: 1; transform: translateY(0) scale(1); }
  82% { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-8px) scale(0.97); }
}

/* Bottom Contextual Aim / Setup Hint Pill */
.glt-aim-badge {
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: rgba(8, 20, 38, 0.88);
  border: 1px solid var(--border-brass);
  border-radius: 7px;
  padding: 6px 12px;
  font-family: var(--font-sans);
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.3px;
  color: var(--gold-bright);
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.glt-theme-light .glt-aim-badge {
  background: rgba(248, 240, 220, 0.94);
  color: var(--gold);
}

/* 3. NAUTICAL COMMAND CONSOLE SIDE PANEL */
.glt-side-panel {
  width: 420px;
  max-width: 100%;
  flex-shrink: 0;
  background:
    radial-gradient(circle at 100% 0%, rgba(56, 189, 248, 0.06), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(245, 166, 35, 0.06), transparent 45%),
    var(--panel-bg);
  border-left: 2px solid var(--border-brass);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-x: hidden;
  z-index: 15;
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.45);
}

.glt-tabs-nav {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 2px;
  background: var(--bg-secondary);
  border-bottom: 2px solid var(--border-color);
  flex-shrink: 0;
}

.glt-tab-btn {
  padding: 9px 4px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  text-align: center;
}

.glt-tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.glt-tab-btn.active {
  color: var(--gold-bright);
  border-bottom-color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.11);
}

.glt-tab-content-wrapper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 9px 10px;
}

/* The pane keeps a 4px gutter of its own: focus rings and the glow of a selected card are
   drawn outside the control and were cut by the pane edge. */
.glt-tab-pane {
  display: none;
  flex-direction: column;
  gap: 11px;
  max-width: 100%;
  overflow-x: hidden;
  padding: 3px 4px;
}

.glt-tab-pane.active {
  display: flex;
}

.glt-setup-panel,
.glt-battle-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Sticky / Prominent Start Battle CTA Bar */
.glt-setup-cta-bar {
  position: sticky;
  top: -9px;
  z-index: 6;
  background: var(--panel-bg);
  padding: 4px 0 8px 0;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* Form Groups & Controls */
.glt-form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.glt-group-title {
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--gold-bright);
}

.glt-row-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.glt-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.glt-col label,
.glt-form-group > label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

select,
input[type="text"] {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  border-radius: 6px;
  padding: 6px 9px;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 600;
  width: 100%;
  box-shadow: var(--shadow-inset);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

/* A long option never runs under the arrow: it ends in an ellipsis */
select {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

select:disabled,
.glt-rule-chip:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.glt-rules-locked-note {
  font-size: 11px;
  font-weight: 600;
  color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.1);
  border: 1px solid var(--border-brass);
  border-radius: 6px;
  padding: 6px 9px;
  line-height: 1.4;
}

select:hover,
input[type="text"]:hover {
  border-color: var(--border-highlight);
}

select:focus,
input[type="text"]:focus {
  border-color: var(--gold-bright);
}

input[type="range"] {
  accent-color: var(--gold);
  width: 100%;
  cursor: pointer;
}

/* Crew Selector Grid with Pixel Captain Portraits */
.glt-crew-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.glt-crew-card {
  background: linear-gradient(145deg, var(--bg-elevated), var(--bg-tertiary));
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 6px 7px 6px 9px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  text-align: left;
  position: relative;
  overflow: hidden;
  min-width: 0;
  box-shadow: var(--shadow-card), var(--shadow-inset);
  transition: transform 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.glt-crew-card:hover {
  border-color: var(--border-highlight);
  transform: translateY(-1px);
}

.glt-crew-card.selected {
  border-color: var(--gold-bright);
  background: linear-gradient(145deg, rgba(245, 166, 35, 0.22), var(--bg-tertiary));
  box-shadow: 0 0 0 1px var(--gold-bright), 0 6px 18px rgba(245, 166, 35, 0.2);
}

.crew-color-bar {
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
}

.crew-portrait-thumb {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  object-fit: cover;
  flex-shrink: 0;
  background: #091426;
  display: block;
}

.crew-seal-stamp {
  position: absolute;
  right: 6px;
  bottom: 5px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  opacity: 0.38;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.glt-crew-card:hover .crew-seal-stamp,
.glt-crew-card.selected .crew-seal-stamp {
  opacity: 0.88;
  transform: scale(1.08);
}

.crew-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  gap: 1px;
}

.crew-name {
  font-size: 11.5px;
  color: var(--text-primary);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.2px;
}

.crew-captain {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crew-technique {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--gold-bright);
}

/* Rule Toggle Chips */
.glt-rules-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.glt-rule-chip {
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.14s ease;
}

.glt-rule-chip:hover {
  border-color: var(--border-highlight);
  color: var(--text-primary);
}

.glt-rule-chip[aria-pressed="true"] {
  background: rgba(16, 185, 129, 0.18);
  border-color: var(--emerald);
  color: #34d399;
}

.glt-theme-light .glt-rule-chip[aria-pressed="true"] {
  color: #065f46;
}

/* Interactive Ship Dock Cards */
.glt-dock-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.glt-ship-dock {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 5px;
}

.glt-ship-dock-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: all 0.12s ease;
}

.glt-ship-dock-item:hover {
  border-color: var(--border-highlight);
}

.glt-ship-dock-item.active-candidate {
  border-color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.16);
}

.glt-ship-dock-item.is-placed {
  border-left: 3px solid var(--emerald);
}

.ship-dock-label {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ship-pips {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}

.ship-pip {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: var(--marine-blue);
}

.glt-ship-dock-item.is-placed .ship-pip {
  background: var(--emerald);
}

/* Tactile Arcade & Brass Buttons */
.glt-btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.glt-btn {
  font-family: var(--font-sans);
  font-weight: 700;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg-tertiary));
  color: var(--text-primary);
  cursor: pointer;
  padding: 7px 12px;
  box-shadow: var(--shadow-inset), 0 2px 5px rgba(0, 0, 0, 0.3);
  transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
}

.glt-btn:hover:not(:disabled) {
  border-color: var(--gold-bright);
  transform: translateY(-1px);
}

.glt-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.glt-btn:disabled {
  opacity: 0.46;
  cursor: not-allowed;
  transform: none;
}

.btn-sm {
  font-size: 11px;
  padding: 5px 9px;
}

.btn-primary {
  background: linear-gradient(180deg, #f59e0b 0%, #c2610c 100%);
  border-color: #fde047;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 4px 14px var(--gold-glow);
}

.btn-primary:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 18px var(--gold-glow);
}

.glt-start-battle-btn {
  font-family: var(--font-pixel);
  font-size: 10.5px;
  padding: 10px 14px;
  width: 100%;
  letter-spacing: 0.5px;
}

/* Battle Command Triggers */
.glt-battle-triggers {
  display: grid;
  grid-template-columns: 1.25fr 1fr;
  gap: 7px;
}

.btn-fire {
  grid-column: 1 / -1;
  font-family: var(--font-pixel);
  font-size: 15px;
  padding: 13px;
  background: linear-gradient(180deg, #fb7185 0%, #e11d48 45%, #9f1239 100%);
  border: 2px solid #fda4af;
  color: #fff;
  letter-spacing: 1.5px;
  text-shadow: 0 2px 3px rgba(0, 0, 0, 0.65);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 4px 16px var(--crimson-glow);
}

.btn-fire:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 24px rgba(244, 63, 94, 0.75);
}

.btn-technique {
  font-family: var(--font-sans);
  font-size: 12px;
  padding: 8px 10px;
  background: linear-gradient(180deg, #8b5cf6 0%, #5b21b6 100%);
  border: 1px solid #c4b5fd;
  color: #fff;
}

.btn-technique.active-mode {
  border-color: #fde047;
  box-shadow: 0 0 14px rgba(250, 204, 21, 0.6);
}

.btn-hint {
  font-size: 12px;
  padding: 8px 10px;
  background: rgba(245, 166, 35, 0.16);
  border-color: var(--gold);
  color: var(--gold-bright);
}

/* Live Fleet Mini-Summary Strip in Combat Panel */
.glt-radar-view-row {
  display: flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
}

.glt-radar-view-btn {
  flex: 1;
  font-family: var(--font-sans);
  font-size: 11.5px;
  font-weight: 700;
  padding: 6px 8px;
  min-height: 32px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.glt-radar-view-btn.active {
  background: rgba(245, 166, 35, 0.16);
  border-color: var(--gold-bright);
  color: var(--gold-bright);
}

.glt-battle-panel .glt-radar-grid-wrapper {
  align-self: center;
  width: 100%;
}

.glt-fleet-summary-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  font-size: 11.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.glt-fleet-tally {
  justify-content: flex-start;
  margin-bottom: 6px;
  font-weight: 600;
  color: var(--text-muted);
}

/* 2D Tactical Radar Grid (Semantic Table) */
.glt-radar-grid-wrapper {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-shadow: var(--shadow-inset);
}

.glt-radar-title {
  font-size: 10px;
  font-family: var(--font-pixel);
  color: var(--gold-bright);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.glt-radar-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 2px;
  background: rgba(3, 10, 22, 0.45);
  padding: 3px;
  border-radius: 6px;
  table-layout: fixed;
}

.glt-theme-light .glt-radar-table {
  background: rgba(139, 109, 63, 0.22);
}

.glt-radar-table th {
  font-family: var(--font-pixel);
  font-size: 7.5px;
  color: var(--text-muted);
  text-align: center;
  padding: 2px 0;
  font-weight: 400;
}

.glt-radar-table td {
  padding: 0;
  aspect-ratio: 1;
}

.radar-cell {
  width: 100%;
  aspect-ratio: 1;
  min-height: 21px;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  color: var(--text-primary);
  transition: background-color 0.1s ease, border-color 0.1s ease;
}

.radar-cell:hover {
  background: rgba(245, 166, 35, 0.32);
  border-color: var(--gold-bright);
}

.radar-cell.ship {
  background: rgba(14, 165, 233, 0.45);
  border-color: #38bdf8;
}

.radar-cell.ghost-valid {
  background: rgba(16, 185, 129, 0.42);
  border-color: #34d399;
}

.radar-cell.ghost-invalid {
  background: rgba(225, 29, 72, 0.45);
  border-color: #fda4af;
}

.radar-cell.selected {
  outline: 2px solid var(--gold-bright);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.28);
  z-index: 2;
}

.radar-cell.water {
  background: rgba(56, 189, 248, 0.22);
  border-color: rgba(56, 189, 248, 0.4);
  color: var(--marine-blue);
}

.radar-cell.hit {
  background: rgba(225, 29, 72, 0.62);
  border-color: #fda4af;
  color: #fff;
}

.radar-cell.sunk {
  background: rgba(15, 23, 42, 0.92);
  border-color: var(--crimson);
  color: #fb7185;
}

.glt-radar-table td.is-revealed .radar-cell,
.radar-cell.is-revealed {
  background: rgba(98, 227, 247, 0.32);
  border: 2px solid var(--gold-bright);
  color: var(--gold-bright);
  box-shadow: 0 0 8px rgba(98, 227, 247, 0.55);
}

.radar-cell.is-fog {
  background: rgba(148, 163, 184, 0.14);
  border-style: dashed;
  color: var(--text-muted);
  opacity: 0.7;
}

.glt-mini-radar .radar-cell {
  min-height: 14px;
  font-size: 8px;
  cursor: default;
}

/* Fleet List, Logbook & PvP */
.glt-fleet-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fleet-ship-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 7px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 12px;
}

.fleet-ship-card.sunk {
  opacity: 0.55;
  text-decoration: line-through;
  border-color: var(--crimson);
}

.glt-flagship-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 20, 10, 0.95));
  border: 2px solid var(--gold);
  border-radius: 10px;
  margin-bottom: 14px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.7);
}

.flagship-art {
  width: 100px;
  height: 68px;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 8px;
  border: 1.5px solid var(--gold-bright);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7);
  flex-shrink: 0;
}

.flagship-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.flagship-badge {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--gold-bright);
  letter-spacing: 1px;
}

.flagship-name {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flagship-crew {
  font-size: 12px;
  color: var(--text-secondary);
}

.glt-officers-section {
  margin-bottom: 14px;
}

.glt-officers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.officer-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(245, 166, 35, 0.35);
  border-radius: 8px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.officer-card:hover {
  transform: translateY(-1px);
  border-color: var(--gold-bright);
}

.officer-thumb {
  width: 50px;
  height: 50px;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 6px;
  border: 1.5px solid var(--gold);
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}

.officer-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.officer-name {
  font-size: 12px;
  font-weight: 800;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.officer-role {
  font-size: 10px;
  color: var(--gold);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.glt-technique-banner {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  gap: 18px;
  background: linear-gradient(135deg, rgba(14, 23, 42, 0.96) 0%, rgba(30, 20, 10, 0.94) 50%, rgba(14, 23, 42, 0.96) 100%);
  border: 2px solid var(--gold);
  border-radius: 16px;
  padding: 14px 26px;
  box-shadow: 0 0 45px rgba(255, 215, 0, 0.45), 0 20px 50px rgba(0, 0, 0, 0.92);
  z-index: 100;
  pointer-events: none;
  animation: glt-tech-banner-enter 2.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  backdrop-filter: blur(8px);
}

.tech-banner-img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 12px;
  border: 2px solid var(--gold);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
}

.tech-banner-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tech-banner-tag {
  font-size: 11px;
  font-weight: 800;
  color: var(--gold);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.tech-banner-jp {
  font-family: 'Impact', 'Arial Black', sans-serif;
  font-size: 20px;
  font-weight: 900;
  color: #fde047;
  letter-spacing: 2px;
  line-height: 1.1;
  text-shadow: 0 0 10px rgba(253, 224, 71, 0.6), 0 2px 4px #000;
}

.tech-banner-title {
  font-family: var(--glt-font-display, 'Pirata One', sans-serif);
  font-size: 24px;
  font-weight: 900;
  color: #ffffff;
  letter-spacing: 1px;
  line-height: 1.1;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
}

@keyframes glt-tech-banner-enter {
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.65) rotate(-3deg); }
  14% { opacity: 1; transform: translate(-50%, -50%) scale(1.06) rotate(1deg); }
  24% { transform: translate(-50%, -50%) scale(1.0) rotate(0deg); }
  80% { opacity: 1; transform: translate(-50%, -50%) scale(1.0) rotate(0deg); }
  100% { opacity: 0; transform: translate(-50%, -50%) scale(1.15) rotate(2deg); }
}

/* Anime Manga Onomatopoeia Popups */
.glt-manga-impact {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: gltMangaPop 1.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
  user-select: none;
  filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.95));
}

.glt-manga-impact .manga-jp {
  font-family: 'Impact', 'Arial Black', sans-serif;
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 2px;
  line-height: 1;
  text-transform: uppercase;
  transform: rotate(-6deg);
}

.glt-manga-impact .manga-pt {
  font-family: var(--glt-font-display, 'Pirata One', sans-serif);
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1.5px;
  line-height: 1;
  margin-top: 4px;
  text-shadow: 0 2px 4px #000;
  transform: rotate(-3deg);
}

.glt-manga-impact.impact-water .manga-jp {
  color: #38bdf8;
  -webkit-text-stroke: 2px #075985;
  text-shadow: 0 0 16px rgba(56, 189, 248, 0.6);
}

.glt-manga-impact.impact-water .manga-pt {
  color: #bae6fd;
}

.glt-manga-impact.impact-hit .manga-jp {
  color: #f59e0b;
  -webkit-text-stroke: 2.5px #78350f;
  text-shadow: 0 0 20px rgba(245, 158, 11, 0.8);
}

.glt-manga-impact.impact-hit .manga-pt {
  color: #fef3c7;
}

.glt-manga-impact.impact-sunk .manga-jp {
  font-size: 42px;
  color: #ef4444;
  -webkit-text-stroke: 3px #450a0a;
  text-shadow: 0 0 28px rgba(239, 68, 68, 0.95);
}

.glt-manga-impact.impact-sunk .manga-pt {
  font-size: 22px;
  color: #fca5a5;
}

@keyframes gltMangaPop {
  0% {
    opacity: 0;
    transform: translate(-50%, -30%) scale(0.2) rotate(-12deg);
  }
  18% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.35) rotate(-3deg);
  }
  32% {
    transform: translate(-50%, -50%) scale(1.0) rotate(-6deg);
  }
  75% {
    opacity: 1;
    transform: translate(-50%, -75%) scale(1.0) rotate(-6deg);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -110%) scale(0.85) rotate(-6deg);
  }
}

.glt-logbook-feed {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 390px;
  overflow-y: auto;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
}

.log-entry {
  padding: 5px 8px;
  border-left: 3px solid var(--gold);
  background: rgba(0, 0, 0, 0.18);
  border-radius: 0 4px 4px 0;
  line-height: 1.35;
}

.log-time {
  font-family: var(--font-pixel);
  font-size: 8.5px;
  color: var(--text-muted);
}

.glt-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  cursor: pointer;
}

.glt-checkbox-row input {
  cursor: pointer;
  width: 16px;
  height: 16px;
  accent-color: var(--gold);
}

.glt-pvp-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.glt-pvp-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 6px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  font-size: 11.5px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #10b981;
}
.status-dot.connected { background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.7); }
.status-dot.reconnecting { background: #f59e0b; box-shadow: 0 0 6px rgba(245, 158, 11, 0.7); }
.status-dot.disconnected { background: #ef4444; }

.glt-room-info-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid var(--gold);
  border-radius: 7px;
}

.glt-reactions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.glt-reaction-btn {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 8px;
  text-align: left;
  font-size: 11.5px;
  line-height: 1.2;
}

.glt-reaction-btn .reaction-icon {
  flex: none;
  font-size: 13px;
  pointer-events: none;
}

.glt-reaction-btn .reaction-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.glt-reaction-btn.just-sent {
  border-color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.28);
  color: #fff3c4;
}

.glt-theme-light .glt-reaction-btn.just-sent {
  color: #78350f;
}

.glt-open-rooms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.glt-lan-share-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 11px;
  border-radius: 7px;
  background: rgba(14, 165, 233, 0.11);
  border: 1px solid rgba(56, 189, 248, 0.42);
  font-size: 11px;
}

.glt-lan-url-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: rgba(8, 20, 38, 0.55);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  padding: 5px 8px;
}

.glt-theme-light .glt-lan-url-row {
  background: rgba(255, 255, 255, 0.72);
}

.glt-lan-url-code {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--gold-bright);
  user-select: text;
  -webkit-user-select: text;
  word-break: break-all;
}

.glt-theme-light .glt-lan-url-code {
  color: #92400e;
}

.glt-lan-offline-hint {
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.35;
  padding: 2px 2px 0 2px;
}

.glt-empty-rooms {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px dashed var(--border-color);
  color: var(--text-muted);
  font-size: 11.5px;
  text-align: center;
}

.open-room-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.btn-danger-ghost {
  background: rgba(225, 29, 72, 0.14);
  border-color: rgba(244, 63, 94, 0.45);
  color: #fda4af;
}

.glt-theme-light .btn-danger-ghost {
  color: #be123c;
}

.btn-danger-ghost:hover:not(:disabled) {
  background: rgba(225, 29, 72, 0.28);
  border-color: #fb7185;
}

.glt-open-rooms-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.open-room-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11px;
}

.open-room-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.glt-bounty-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  font-variant-numeric: tabular-nums;
}

.glt-bounty-table th,
.glt-bounty-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.glt-bounty-table th {
  color: var(--text-muted);
  font-family: var(--font-pixel);
  font-size: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.bounty-amount {
  color: var(--gold-bright);
  font-weight: 700;
}

/* 4. FOOTER */
.glt-footer {
  padding: 4px 14px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--text-muted);
  gap: 4px 16px;
  flex-shrink: 0;
}

.glt-disclaimer {
  font-size: 9.5px;
  line-height: 1.25;
  flex: 1;
  min-width: 260px;
}

/* the seamless-loop copy only exists for the phone marquee below */
.glt-disclaimer-copy {
  display: none;
}

/* Phones (narrow or short landscape): the disclaimer is one line that scrolls right to left.
   Reduced motion: no scroll, the text wraps instead. Hover or a tap pauses it (WCAG 2.2.2). */
@media (max-width: 520px), (orientation: landscape) and (max-height: 520px) {
  .glt-disclaimer {
    min-width: 0;
    overflow: hidden;
    cursor: pointer;
  }

  .glt-disclaimer-track {
    display: block;
  }

  @media (prefers-reduced-motion: no-preference) {
    .glt-disclaimer {
      white-space: nowrap;
    }

    .glt-disclaimer-track {
      display: inline-flex;
      width: max-content;
      animation: glt-marquee 45s linear infinite;
    }

    .glt-disclaimer-item {
      padding-right: 4em;
    }

    .glt-disclaimer-copy {
      display: inline;
    }

    .glt-disclaimer:hover .glt-disclaimer-track,
    .glt-disclaimer.is-paused .glt-disclaimer-track {
      animation-play-state: paused;
    }
  }
}

@keyframes glt-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

.glt-keyboard-help {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  color: var(--gold-bright);
}

/* 5. MODALS & UNBLURRED CEREMONY SHOWCASE */
.glt-modal-overlay {
  position: fixed;
  inset: 0;
  background: radial-gradient(circle at 38% 50%, rgba(6, 17, 33, 0.35), rgba(6, 17, 33, 0.82));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 14px;
}

.glt-modal-box {
  background: var(--panel-bg);
  border: 2px solid var(--gold-bright);
  border-radius: 10px;
  padding: 14px 18px;
  max-width: 470px;
  width: 100%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.82), var(--shadow-inset);
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: center;
  max-height: 94dvh;
  overflow-y: auto;
}

.glt-modal-box.modal-ceremony {
  max-width: 680px;
  padding: 22px 26px;
}

.glt-modal-box.modal-nautical-chart {
  max-width: min(1220px, 96vw);
  width: 96%;
  padding: 16px 20px;
  max-height: 94dvh;
  overflow-y: hidden;
  overflow-x: hidden;
}

.glt-modal-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  position: relative;
  padding-bottom: 2px;
}

.glt-modal-close-btn {
  background: transparent;
  border: 1.5px solid rgba(245, 166, 35, 0.45);
  color: var(--gold-bright);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1;
}

.glt-modal-close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: #ef4444;
  color: #fca5a5;
  transform: scale(1.1);
}

.glt-modal-heading {
  font-family: var(--font-pirate);
  font-size: 25px;
  color: var(--gold-bright);
  letter-spacing: 1px;
}

.glt-coin-toss-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}

.glt-berry-coin {
  width: 78px;
  height: 78px;
  border-radius: 50%;
  background: radial-gradient(circle, #fde047 30%, #ca8a04 92%);
  border: 4px solid #fef08a;
  box-shadow: 0 0 26px rgba(245, 166, 35, 0.72);
  font-family: var(--font-sans);
  font-weight: 800;
  font-size: 40px;
  color: #713f12;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spin-animation {
  animation: flip-coin 1.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.glt-coin-result {
  font-family: var(--font-pixel);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--text-primary);
}

.glt-ceremony-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.glt-ceremony-title {
  font-family: var(--font-pirate);
  font-size: 24px;
  color: var(--gold-bright);
  text-align: center;
  text-wrap: balance;
}

.modal-ceremony .glt-modal-header-row {
  justify-content: center;
}

/* Badges inside the ceremony wrap inside the modal instead of running off both sides */
.glt-ceremony-box .glt-badge {
  white-space: normal;
  max-width: 100%;
  text-align: center;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.glt-wanted-poster-canvas,
.glt-wanted-poster-img {
  image-rendering: pixelated;
  width: 270px;
  height: auto;
  aspect-ratio: 185 / 260;
  max-width: 90%;
  border: 4px solid #2b1b11;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.92), 0 0 28px rgba(245, 166, 35, 0.45);
  border-radius: 4px;
  display: block;
  margin: 0 auto;
}

.glt-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  width: 100%;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.stat-item {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  padding: 5px 8px;
  border-radius: 5px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
}

.stat-label {
  color: var(--text-muted);
}

.stat-val {
  font-size: 13px;
  color: var(--gold-bright);
  font-weight: 700;
}

.glt-ceremony-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

@keyframes pulse-border {
  0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.35); }
  50% { box-shadow: 0 0 8px 1px rgba(16, 185, 129, 0.55); }
}

@keyframes pulse-crimson {
  from { box-shadow: 0 0 2px rgba(225, 29, 72, 0.25); }
  to { box-shadow: 0 0 10px rgba(225, 29, 72, 0.85); }
}

@keyframes flip-coin {
  0% { transform: scale(1) rotateY(0); }
  50% { transform: scale(1.32) rotateY(720deg); }
  100% { transform: scale(1) rotateY(1440deg); }
}

/* Ceremony beat: the 3D flag hoist + fireworks play unveiled, then the WANTED modal rises in (delay set by ui.js) */
.glt-modal-overlay.glt-ceremony-intro {
  animation: glt-ceremony-veil 0.5s ease-out var(--glt-ceremony-delay, 0s) both;
}
.glt-modal-overlay.glt-ceremony-intro > .glt-modal-box {
  animation: glt-ceremony-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) var(--glt-ceremony-delay, 0s) both;
}
@keyframes glt-ceremony-veil {
  from { background: transparent; }
}
@keyframes glt-ceremony-rise {
  from { opacity: 0; transform: translateY(28px) scale(0.96); }
  to { opacity: 1; transform: none; }
}

/* Motion sensitivity support */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  /* the shot onomatopoeias and the technique cut-in still read, as a still fade instead of a pop */
  .glt-manga-impact { animation: glt-still-fade 1.3s linear forwards !important; }
  .glt-technique-banner { animation: glt-still-fade 2.4s linear forwards !important; }
}
@keyframes glt-still-fade {
  0% { opacity: 0; }
  10% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

/* =========================================================================
   RESPONSIVE DESIGN (Tablets & Mobile Down to 375px — Zero Canvas Occlusion)
   ========================================================================= */
@media (max-width: 900px) {
  #glt-workspace {
    flex-direction: column;
  }

  .glt-viewport-container {
    height: 46%;
    flex: none;
  }

  .glt-side-panel {
    width: 100%;
    height: 54%;
    border-left: none;
    border-top: 2px solid var(--border-brass);
  }

  .glt-keyboard-help {
    display: none;
  }

  /* In battle the radar is the main control: the panel takes the larger share. */
  #glt-workspace:has(#content-tab-gameplay.active .glt-battle-panel) .glt-viewport-container:not(.panel-collapsed) {
    height: 38%;
  }

  #glt-workspace:has(#content-tab-gameplay.active .glt-battle-panel) .glt-side-panel:not(.collapsed) {
    height: 62%;
  }

  /* Firing row first and compact, the enemy radar right under it at full width; the rest
     (view switch, fleet count, own waters, reactions) follows below the fold. */
  .glt-battle-panel {
    gap: 7px;
  }

  .glt-battle-panel > * {
    order: 3;
  }

  .glt-battle-panel > .glt-battle-triggers {
    order: 1;
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 5px;
  }

  .glt-battle-panel > .glt-battle-triggers .btn-fire {
    grid-column: auto;
    font-size: 11px;
    padding: 9px 6px;
    letter-spacing: 0.5px;
  }

  .glt-battle-panel > .glt-battle-triggers .glt-btn {
    min-height: 40px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .glt-battle-panel > .glt-radar-grid-wrapper:not(.glt-mini-radar) {
    order: 2;
    padding: 4px 6px;
    gap: 2px;
  }
}

@media (max-width: 520px) {
  #glt-top-hud {
    padding: 4px 8px;
    gap: 4px;
    min-height: 42px;
    flex-wrap: wrap;
  }

  .glt-main-title {
    font-size: 19px;
  }

  .glt-subtitle,
  .badge-sea,
  .glt-bounty-pill {
    display: none;
  }

  .glt-status-bug {
    justify-content: flex-start;
    gap: 4px;
  }

  .glt-badge,
  .glt-turn-pill,
  .glt-timer-pill {
    font-size: 7.5px;
    padding: 3px 6px;
  }

  .glt-icon-btn {
    width: 29px;
    height: 29px;
    font-size: 13px;
  }

  .glt-camera-bar {
    top: 6px;
    left: 6px;
    gap: 4px;
  }

  .glt-pill-btn {
    font-size: 9.5px;
    padding: 3px 7px;
  }

  .glt-rival-overlay {
    top: auto;
    bottom: 6px;
    right: 6px;
    left: auto;
    max-width: 195px;
  }

  .glt-captain-avatar {
    width: 30px;
    height: 30px;
  }

  .glt-taunt-bubble {
    font-size: 9.5px;
    padding: 4px 7px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .glt-aim-badge {
    bottom: 6px;
    left: 6px;
    font-size: 10px;
    padding: 3px 8px;
    max-width: 165px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .glt-footer {
    padding: 2px 8px;
  }

  .glt-disclaimer {
    font-size: 8px;
  }

  .glt-crew-grid {
    grid-template-columns: 1fr 1fr;
  }
}

/* =========================================================================
   CANONICAL FLOW ASSETS: NAUTICAL CHART, BIOMES & BLESSINGS STYLES
   ========================================================================= */

/* Sea & Island Tactical Preview Box */
.glt-sea-preview-box {
  background: linear-gradient(135deg, rgba(11, 27, 51, 0.95), rgba(7, 18, 35, 0.98));
  border: 1px solid var(--border-brass);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 4px;
  box-shadow: var(--shadow-card);
}

.sea-preview-content {
  display: flex;
  gap: 12px;
  align-items: center;
}

.sea-preview-visuals {
  position: relative;
  width: 132px;
  height: 82px;
  aspect-ratio: 16 / 10;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1.5px solid var(--gold-bright);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.65);
}

.sea-sky-banner {
  width: 100%;
  height: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  display: block;
}

.sea-chart-thumb {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 58px;
  height: 36px;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 4px;
  border: 1.5px solid var(--gold-bright);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.9);
}

.sea-preview-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.sea-island-tag {
  font-size: 11.5px;
  color: var(--gold-bright);
  font-weight: 600;
}

.sea-island-tag strong {
  color: #fff;
  font-size: 12.5px;
}

.sea-island-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
  margin: 0;
}

.sea-island-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
  font-size: 10.5px;
  color: var(--text-muted);
}

.sea-island-stats strong {
  color: var(--gold);
}

.btn-inspect-island-chart {
  background: transparent;
  border: 1px solid var(--gold);
  color: var(--gold-bright);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-inspect-island-chart:hover {
  background: rgba(245, 166, 35, 0.2);
  color: #fff;
}

/* Nautical Chart Modal: Widescreen Dual-Panel Desk (Zero Scrollbar, Zero Cropping, Crisp Readability) */
.glt-nautical-chart-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.modal-nautical-chart .glt-modal-heading {
  font-size: 28px;
}

.glt-chart-desk-grid {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 16px;
  align-items: stretch;
  width: 100%;
}

@media (max-width: 860px) {
  .glt-chart-desk-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .glt-modal-box.modal-nautical-chart {
    overflow-y: auto !important;
  }
}

/* 1. Left Column: Panoramic Chart & Navigation */
.glt-chart-map-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  justify-content: space-between;
}

.glt-chart-banner-wrap {
  position: relative;
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
  border: 2px solid var(--gold-bright);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.85);
  background: #1c140c;
  line-height: 0;
}

.glt-chart-horizontal-img {
  width: 100%;
  height: auto;
  display: block;
  border: none;
}

/* Dynamic POI Pin Marker (Icon-only Log Pose Pulsing Beacon) */
.glt-map-poi-marker {
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: none;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: left 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.poi-pulse-ring {
  position: absolute;
  bottom: -6px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2.5px solid #fde047;
  background: rgba(245, 166, 35, 0.42);
  transform: scale(0.5);
  animation: poiPulseAnim 1.8s infinite ease-out;
  pointer-events: none;
}

.poi-pulse-ring-delay {
  animation-delay: 0.9s;
}

@keyframes poiPulseAnim {
  0% { transform: scale(0.45); opacity: 1; }
  100% { transform: scale(2.4); opacity: 0; }
}

.poi-pin-body {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: linear-gradient(135deg, #f5a623 0%, #b45309 100%);
  border-radius: 50%;
  border: 2px solid #fef08a;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.92), 0 0 14px rgba(253, 224, 71, 0.85);
  animation: poiFloatAnim 1.8s infinite ease-in-out;
}

@keyframes poiFloatAnim {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.poi-pin-svg {
  display: block;
}

.poi-pin-needle {
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid #fef08a;
  margin-top: -1px;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,0.9));
}

/* Clickable Map Hotspots */
.glt-map-hotspot {
  position: absolute;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(245, 166, 35, 0.35) 0%, rgba(245, 166, 35, 0.05) 70%, transparent 100%);
  border: 1.5px dashed rgba(245, 166, 35, 0.55);
  cursor: pointer;
  z-index: 5;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  padding: 0;
}

.glt-map-hotspot:hover {
  background: radial-gradient(circle, rgba(245, 166, 35, 0.72) 0%, rgba(245, 166, 35, 0.22) 80%, transparent 100%);
  border-color: var(--gold-bright);
  transform: translate(-50%, -50%) scale(1.3);
  box-shadow: 0 0 14px rgba(245, 166, 35, 0.85);
}

.glt-map-hotspot.active {
  border-style: solid;
  border-color: #fef08a;
  box-shadow: 0 0 14px rgba(245, 166, 35, 0.9);
}

/* 2. Island Tabs Row Below Map */
.glt-island-tabs-row {
  display: flex;
  gap: 6px;
  width: 100%;
}

.glt-island-tab-btn {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  background: linear-gradient(180deg, rgba(17, 34, 60, 0.9), rgba(10, 20, 38, 0.95));
  border: 1.5px solid rgba(245, 166, 35, 0.35);
  color: var(--text-muted);
  padding: 8px 5px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
}

.glt-island-tab-btn .tab-icon {
  font-size: 14px;
  line-height: 1;
}

.glt-island-tab-btn .tab-label {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* Phone: five island tabs must fit in ~300px without overlapping */
@media (max-width: 520px) {
  .glt-island-tab-btn { padding: 8px 2px; gap: 0; }
  .glt-island-tab-btn .tab-icon { display: none; }
  .glt-island-tab-btn .tab-label { font-size: 11px; }
}

.glt-island-tab-btn:hover {
  border-color: var(--gold-bright);
  color: var(--gold-bright);
  background: linear-gradient(180deg, rgba(28, 54, 96, 0.95), rgba(15, 30, 56, 0.98));
  transform: translateY(-1px);
}

.glt-island-tab-btn.active {
  background: linear-gradient(135deg, rgba(245, 166, 35, 0.3), rgba(28, 20, 14, 0.98));
  border-color: var(--gold-bright);
  color: var(--gold-bright);
  box-shadow: 0 0 12px rgba(245, 166, 35, 0.45);
  transform: translateY(-1px);
}

/* 3. Right Column: Tactical Dossier (Crisp Readable Typography, Zero Scrollbars) */
.glt-chart-dossier-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(135deg, rgba(11, 27, 51, 0.95), rgba(7, 16, 31, 0.98));
  border: 1.5px solid rgba(245, 166, 35, 0.45);
  border-radius: 10px;
  padding: 12px 15px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.7);
  min-width: 0;
  justify-content: space-between;
}

.island-dossier-header-compact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-bottom: 1px solid rgba(245, 166, 35, 0.35);
  padding-bottom: 6px;
}

.island-dossier-header-compact .island-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.island-dossier-header-compact .island-header-icon {
  font-size: 22px;
  line-height: 1;
}

.island-dossier-header-compact .island-main-title {
  font-family: var(--font-pirate);
  font-size: 24px;
  color: var(--gold-bright);
  letter-spacing: 0.9px;
  margin: 0;
  line-height: 1.1;
}

.island-dossier-header-compact .island-route-pill {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(245, 166, 35, 0.16);
  border: 1px solid var(--gold);
  color: var(--gold-bright);
  text-transform: uppercase;
  font-weight: 700;
}

.island-dossier-header-compact .island-subtitle-line {
  margin: 0;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.3;
}

.island-art-duo-compact {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.island-art-duo-compact .island-art-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.island-art-duo-compact .island-art-header {
  font-size: 11px;
  font-weight: 700;
  color: var(--gold-bright);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.island-art-duo-compact .island-art-img-wrap {
  border-radius: 7px;
  overflow: hidden;
  border: 1.5px solid var(--gold-bright);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.6);
  background: #07101f;
  height: 66px;
}

.island-art-duo-compact .island-tactical-chart,
.island-art-duo-compact .island-sky-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.island-modifiers-grid-compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.island-modifiers-grid-compact .island-mod-card {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(15, 34, 64, 0.72);
  border: 1px solid rgba(245, 166, 35, 0.28);
  border-radius: 7px;
  padding: 5px 9px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
}

.island-modifiers-grid-compact .mod-icon {
  font-size: 17px;
  line-height: 1;
  flex-shrink: 0;
}

.island-modifiers-grid-compact .mod-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.island-modifiers-grid-compact .mod-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.island-modifiers-grid-compact .mod-val {
  font-size: 12.5px;
  font-weight: 700;
  color: #fff;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.island-hazard-seal-compact {
  background: rgba(18, 12, 10, 0.85);
  border: 1px solid rgba(239, 68, 68, 0.42);
  border-radius: 7px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.island-hazard-seal-compact .hazard-seal-row,
.island-hazard-seal-compact .climate-seal-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.island-hazard-seal-compact .hazard-seal-icon,
.island-hazard-seal-compact .climate-seal-icon {
  font-size: 14px;
  line-height: 1.2;
  flex-shrink: 0;
}

.island-hazard-seal-compact .hazard-seal-text,
.island-hazard-seal-compact .climate-seal-text {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
  flex-wrap: wrap;
}

.island-hazard-seal-compact .hazard-seal-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #f87171;
}

.island-hazard-seal-compact .climate-seal-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #38bdf8;
}

.island-hazard-seal-compact .hazard-seal-val {
  font-size: 12px;
  font-weight: 700;
  color: #fecaca;
  line-height: 1.25;
}

.island-hazard-seal-compact .hazard-seal-val.danger-skypiea {
  color: #fde047;
}

.island-hazard-seal-compact .hazard-seal-val.danger-water7 {
  color: #fb923c;
}

.island-hazard-seal-compact .hazard-seal-val.danger-marineford {
  color: #f87171;
}

.island-hazard-seal-compact .climate-seal-val {
  font-size: 11.5px;
  color: #bae6fd;
  line-height: 1.25;
  margin: 0;
}

.island-dossier-card-compact {
  background: rgba(6, 15, 28, 0.78);
  border: 1px solid rgba(245, 166, 35, 0.28);
  border-left: 3px solid var(--gold);
  border-radius: 7px;
  padding: 7px 10px;
}

.island-dossier-card-compact .island-dossier-title {
  font-family: var(--font-pirate);
  font-size: 12px;
  color: var(--gold-bright);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  margin-bottom: 3px;
}

.island-dossier-card-compact .island-lore {
  font-size: 12px;
  line-height: 1.4;
  color: #e2e8f0;
  margin: 0;
}

.glt-btn-sail-here {
  width: 100%;
  padding: 10px 14px;
  font-size: 14.5px;
  font-family: var(--font-pirate);
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  border-radius: 7px;
  background: linear-gradient(135deg, #f5a623 0%, #d48806 100%);
  color: #1a0f00;
  border: 1px solid #ffe58f;
  box-shadow: 0 4px 12px rgba(245, 166, 35, 0.35);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.glt-btn-sail-here:hover {
  background: linear-gradient(135deg, #ffc53d 0%, #fa8c16 100%);
  box-shadow: 0 6px 18px rgba(245, 166, 35, 0.55);
  transform: translateY(-1px);
}

.glt-btn-sail-here:active {
  transform: translateY(1px);
  box-shadow: 0 2px 6px rgba(245, 166, 35, 0.4);
}

/* Blessings Reward & Collection */
.glt-blessing-reward-box {
  margin-top: 12px;
  padding: 14px 18px;
  background: linear-gradient(135deg, rgba(245, 166, 35, 0.16), rgba(11, 27, 51, 0.98));
  border: 2px solid var(--gold-bright);
  border-radius: 10px;
  box-shadow: 0 6px 22px rgba(245, 166, 35, 0.35);
  width: 100%;
}

.glt-blessing-reward-title {
  font-family: var(--font-pirate);
  font-size: 22px;
  color: var(--gold-bright);
  text-align: center;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.glt-blessing-card-preview {
  display: flex;
  gap: 16px;
  align-items: center;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(245, 166, 35, 0.35);
  border-radius: 8px;
  padding: 12px 14px;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.glt-blessing-card-preview:hover {
  transform: translateY(-2px);
  border-color: var(--gold-bright);
}

.blessing-card-art {
  width: 105px;
  height: 140px;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 8px;
  border: 2px solid var(--gold-bright);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.8), 0 0 14px rgba(245, 166, 35, 0.4);
  flex-shrink: 0;
}

.blessing-card-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.blessing-name {
  font-size: 18px;
  font-weight: 800;
  color: #ffffff;
}

.blessing-desc {
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-primary);
}
  flex-direction: column;
  gap: 4px;
}

.blessing-type-badge {
  align-self: flex-start;
  font-size: 9.5px;
  font-weight: 700;
  color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.2);
  border: 1px solid var(--border-brass);
  border-radius: 4px;
  padding: 1px 6px;
}

.blessing-name {
  font-size: 13.5px;
  color: #fff;
}

.blessing-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
  margin: 0;
}

/* Logbook Blessings Grid */
.glt-logbook-atlas-bar {
  margin-bottom: 12px;
}

.glt-open-chart-btn {
  width: 100%;
  font-weight: 700;
  padding: 8px 14px;
}

.glt-blessings-section {
  margin-bottom: 14px;
}

.glt-blessings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
  margin-top: 6px;
}

.glt-blessing-card-thumb {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  transition: all 0.15s ease;
}

.glt-blessing-card-thumb:hover {
  border-color: var(--gold);
  transform: translateY(-2px);
}

.glt-blessing-card-thumb.unlocked {
  border-color: var(--gold-bright);
  background: linear-gradient(135deg, rgba(245, 166, 35, 0.15), var(--bg-elevated));
  box-shadow: 0 2px 8px rgba(245, 166, 35, 0.15);
}

.glt-blessing-card-thumb.locked {
  opacity: 0.55;
  filter: grayscale(0.85);
}

.blessing-thumb-img {
  width: 100%;
  height: 130px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  margin-bottom: 6px;
}

.blessing-thumb-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.blessing-badge {
  font-size: 8.5px;
  font-weight: 700;
  color: var(--gold);
}

.blessing-thumb-name {
  font-size: 10.5px;
  color: var(--text-primary);
  line-height: 1.2;
}

/* Blessing Inspector Modal */
.glt-blessing-lightbox {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(3, 8, 18, 0.78);
}

.glt-blessing-lightbox .glt-blessing-inspector-modal {
  background: var(--panel-bg);
  border: 2px solid var(--gold-bright);
  border-radius: 10px;
  padding: 14px;
  width: min(440px, 100%);
  max-height: 92dvh;
  overflow-y: auto;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.82);
}

.glt-blessing-inspector-modal.is-locked .blessing-inspector-img {
  filter: grayscale(0.85) brightness(0.7);
}

.blessing-inspector-note {
  font-size: 11.5px;
  color: var(--text-muted);
  font-style: italic;
  margin: 2px 0 8px;
}

.glt-blessing-inspector-modal {
  max-width: 440px;
  width: 100%;
}

.blessing-inspector-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.blessing-inspector-img {
  width: 240px;
  height: 320px;
  object-fit: cover;
  border-radius: 8px;
  border: 2px solid var(--gold-bright);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
}

.blessing-inspector-title {
  font-family: var(--font-pirate);
  font-size: 26px;
  color: var(--gold-bright);
  margin: 0;
}

.blessing-inspector-desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary);
  margin: 4px 0 10px 0;
}
}



/* Rendicao / abandonar o navio (feat/v2.0-minishoot-chibi) */
/* Secondary Action Bar & Forfeit Button */
.glt-battle-secondary-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 6px 0 2px 0;
  border-top: 1px dashed var(--border-color);
  margin-top: 8px;
}

.btn-danger-outline {
  background: rgba(225, 29, 72, 0.08);
  border: 1px solid rgba(225, 29, 72, 0.55);
  color: #fda4af;
  font-weight: 700;
  transition: all 0.15s ease;
}

.btn-danger-outline:hover:not(:disabled) {
  background: rgba(225, 29, 72, 0.22);
  border-color: var(--crimson);
  color: #fff;
  transform: translateY(-1px);
}

.glt-theme-light .btn-danger-outline {
  background: rgba(190, 18, 60, 0.06);
  border-color: rgba(190, 18, 60, 0.6);
  color: #9f1239;
}

.glt-theme-light .btn-danger-outline:hover:not(:disabled) {
  background: rgba(190, 18, 60, 0.18);
  color: #881337;
}

.glt-ceremony-forfeit-subtitle {
  font-size: 13px;
  font-weight: 600;
  color: #fca5a5;
  margin-top: -2px;
  margin-bottom: 6px;
  text-align: center;
  text-wrap: balance;
}

.glt-theme-light .glt-ceremony-forfeit-subtitle {
  color: #be123c;
}

/* Victory modal on a phone (after the base rules it overrides) */
@media (max-width: 520px) {
  .glt-modal-box.modal-ceremony {
    padding: 14px 12px;
  }

  .glt-ceremony-title {
    font-size: 20px;
    line-height: 1.25;
  }

  /* One stat per line, label left and value right: no label wraps */
  .glt-stats-grid {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .stat-item {
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
}

/* ===== Portado do branch feat/v2.0-minishoot-chibi: tablet, QR, regras do PvP, revanche ===== */
.glt-theme-light .glt-dock-guidance {
  background: rgba(14, 165, 233, 0.12);
  border-color: rgba(2, 132, 199, 0.45);
  color: #0c4a6e;
}

.glt-theme-light .glt-dock-guidance.active {
  background: rgba(245, 166, 35, 0.18);
  border-color: #d97706;
  color: #78350f;
  font-weight: 700;
}

.glt-theme-light .glt-dock-guidance.ready {
  background: rgba(16, 185, 129, 0.22);
  border-color: #059669;
  color: #064e3b;
  font-weight: 700;
}

.glt-pvp-panel .glt-badge {
  white-space: normal;
  text-align: center;
  line-height: 1.45;
  word-break: break-word;
  max-width: 100%;
  box-sizing: border-box;
}

.glt-room-meta {
  min-width: 0;
  flex: 1 1 auto;
}

.glt-room-btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.glt-lan-file-notice {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  background: rgba(245, 166, 35, 0.12);
  border: 1px solid var(--gold);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.4;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.glt-lan-file-notice strong {
  color: var(--gold-bright);
}

.glt-theme-light .glt-lan-file-notice strong {
  color: #92400e;
}

.glt-file-notice-steps {
  background: rgba(6, 17, 33, 0.65);
  border: 1px solid rgba(245, 166, 35, 0.35);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 10.5px;
}

.glt-theme-light .glt-file-notice-steps {
  background: rgba(255, 255, 255, 0.75);
}

.glt-file-notice-steps ol {
  margin: 4px 0 0 16px;
  padding: 0;
}

.glt-file-notice-steps li {
  margin-bottom: 3px;
}

.glt-join-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.glt-join-row .glt-input {
  flex: 0 0 92px;
}

.glt-join-row .glt-btn {
  flex: 1 1 auto;
  min-width: 120px;
}

.glt-pvp-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(10, 24, 45, 0.88);
  border: 1px solid var(--border-brass);
  border-radius: 8px;
  margin-top: 8px;
  text-align: center;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.glt-qr-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
  min-width: 0;
  box-sizing: border-box;
}

.glt-qr-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.glt-qr-hint {
  max-width: 100%;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.glt-qr-warning-badge {
  font-size: 10px;
  line-height: 1.35;
  color: #ffd35c;
  background: rgba(225, 29, 72, 0.18);
  border: 1px solid rgba(225, 29, 72, 0.45);
  border-radius: 5px;
  padding: 5px 8px;
  margin-top: 4px;
  max-width: 100%;
  box-sizing: border-box;
  word-break: break-word;
}

.glt-theme-light .glt-pvp-qr-section {
  background: rgba(255, 255, 255, 0.92);
  border-color: var(--border-brass);
}

.glt-qr-code-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: #ffffff;
  border-radius: 6px;
  border: 2px solid var(--gold);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.glt-qr-code-wrapper:hover,
.glt-qr-code-wrapper:focus-visible {
  transform: scale(1.02);
  box-shadow: 0 6px 18px var(--gold-glow);
  outline: none;
}

.glt-qr-code-wrapper svg {
  display: block;
  width: 132px;
  height: 132px;
}

.glt-qr-label {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--gold-bright);
  display: flex;
  align-items: center;
  gap: 5px;
}

.glt-theme-light .glt-qr-label {
  color: #92400e;
}

.glt-qr-hint {
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.35;
  max-width: 280px;
  margin: 0;
}

.glt-bounty-table th:nth-child(1),
.glt-bounty-table td:nth-child(1) {
  width: 34px;
  text-align: center;
}

.glt-bounty-table th:nth-child(2),
.glt-bounty-table td:nth-child(2) {
  width: 33%;
}

.glt-bounty-table th:nth-child(3),
.glt-bounty-table td:nth-child(3) {
  width: 35%;
}

.glt-bounty-table th:nth-child(4),
.glt-bounty-table td:nth-child(4) {
  width: 76px;
  text-align: center;
}

.glt-theme-light .badge-series {
  color: #6d28d9;
  border-color: #7c3aed;
}

.glt-theme-light .glt-pvp-opp-badge {
  color: #78350f;
  background: rgba(245, 166, 35, 0.22);
  border-color: #d97706;
}

.glt-theme-light .glt-turn-pill.ready {
  color: #78350f;
  background: rgba(245, 166, 35, 0.25);
  border-color: #b45309;
}

.glt-side-panel.collapsed {
  width: 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0;
  pointer-events: none;
  border-left: none !important;
  box-shadow: none !important;
}

@media (max-width: 900px) {
  .glt-side-panel.collapsed {
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    display: none !important;
  }
  .glt-viewport-container.panel-collapsed {
    height: 100% !important;
    flex: 1 1 100% !important;
  }
}

/* Floating Action Bar */
.glt-floating-action-bar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(11, 27, 51, 0.92);
  border: 2px solid var(--border-brass);
  border-radius: 30px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(245, 166, 35, 0.2);
  backdrop-filter: blur(8px);
  z-index: 60;
  transition: all 0.22s ease;
  pointer-events: auto;
  max-width: calc(100vw - 32px);
  overflow-x: auto;
}

/* Den Den Mushi reactions over the board while the side panel is collapsed */
.glt-float-reactions {
  position: absolute;
  bottom: 74px;
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100% - 20px));
  padding: 8px;
  background: rgba(11, 27, 51, 0.96);
  border: 2px solid var(--border-brass);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.65);
  z-index: 61;
}

.glt-theme-light .glt-float-reactions {
  background: rgba(243, 232, 207, 0.98);
  border-color: var(--border-highlight);
}

.glt-theme-light .glt-floating-action-bar {
  background: rgba(243, 232, 207, 0.96);
  border-color: var(--border-highlight);
  box-shadow: 0 8px 30px rgba(62, 39, 14, 0.35);
}

.glt-float-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 20px;
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  user-select: none;
}

.glt-float-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  transform: translateY(-1px);
  border-color: var(--gold);
}

.glt-float-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.glt-float-btn.btn-fire {
  background: linear-gradient(135deg, #b45309, #d97706);
  color: #fff;
  border-color: #f59e0b;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.4);
}

.glt-float-btn.btn-fire.ready {
  background: linear-gradient(135deg, #047857, #10b981);
  border-color: #34d399;
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.6);
  animation: pulse-fire-btn 1.4s infinite alternate ease-in-out;
}

@keyframes pulse-fire-btn {
  0% { transform: scale(1); box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
  100% { transform: scale(1.05); box-shadow: 0 0 20px rgba(16, 185, 129, 0.8); }
}

.glt-float-btn.btn-tech {
  background: rgba(109, 40, 217, 0.25);
  border-color: #8b5cf6;
  color: #c4b5fd;
}

.glt-theme-light .glt-float-btn.btn-tech {
  background: rgba(109, 40, 217, 0.12);
  color: #5b21b6;
}

.glt-float-btn.btn-tech.active {
  background: linear-gradient(135deg, #7c3aed, #a855f7);
  color: #fff;
  box-shadow: 0 0 14px rgba(168, 85, 247, 0.5);
}

.glt-float-restore-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 55;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(11, 27, 51, 0.9);
  border: 1px solid var(--gold);
  color: var(--gold-bright);
  font-family: var(--font-pixel);
  font-size: 8px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(6px);
  transition: all 0.15s ease;
}

.glt-theme-light .glt-float-restore-btn {
  background: rgba(243, 232, 207, 0.95);
  border-color: var(--border-highlight);
  color: #78350f;
}

/* Tactical HUD Mini-Map Radar */
.glt-hud-minimap {
  position: absolute;
  top: 50px;
  right: 10px;
  width: 175px;
  background: rgba(11, 27, 51, 0.94);
  border: 2px solid var(--border-brass);
  border-radius: 10px;
  padding: 8px;
  z-index: 50;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65), 0 0 10px rgba(56, 189, 248, 0.15);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.2s ease;
  pointer-events: auto;
}

.glt-theme-light .glt-hud-minimap {
  background: rgba(243, 232, 207, 0.96);
  border-color: var(--border-highlight);
  box-shadow: 0 8px 20px rgba(62, 39, 14, 0.3);
}

.glt-minimap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.glt-minimap-title {
  font-family: var(--font-pixel);
  font-size: 8px;
  color: var(--gold-bright);
  display: flex;
  align-items: center;
  gap: 4px;
}

.glt-minimap-toggle-btn {
  font-size: 9.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}

.glt-minimap-grid {
  display: grid;
  width: 100%;
  aspect-ratio: 1 / 1;
  gap: 1px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 2px;
}

.glt-minimap-cell {
  background: rgba(14, 165, 233, 0.12);
  border-radius: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 7.5px;
  line-height: 1;
  transition: background 0.1s ease;
}

.glt-minimap-cell:hover {
  background: rgba(245, 166, 35, 0.45);
}

.glt-minimap-cell.cell-ship {
  background: rgba(56, 189, 248, 0.55);
}

.glt-minimap-cell.cell-hit {
  background: rgba(239, 68, 68, 0.85);
  color: #fff;
}

.glt-minimap-cell.cell-sunk {
  background: #7f1d1d;
  color: #fca5a5;
}

.glt-minimap-cell.cell-water-shot {
  background: rgba(2, 132, 199, 0.55);
  color: #bae6fd;
}

.glt-minimap-cell.cell-revealed {
  background: rgba(168, 85, 247, 0.7);
  color: #fff;
}

.glt-minimap-cell.cell-selected {
  outline: 2px solid var(--gold);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.4);
}

/* In-Room Crew Selection */
.glt-inroom-crew-select {
  margin-top: 10px;
  margin-bottom: 10px;
}

.glt-inroom-crew-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  margin-top: 4px;
}

.glt-inroom-crew-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
  user-select: none;
}

.glt-inroom-crew-btn:hover {
  border-color: var(--gold);
  background: var(--bg-tertiary);
}

.glt-inroom-crew-btn.selected {
  border-color: var(--gold-bright);
  background: rgba(245, 166, 35, 0.12);
  box-shadow: 0 0 8px rgba(245, 166, 35, 0.35);
}

.glt-inroom-crew-btn .inroom-thumb {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  flex-shrink: 0;
  object-fit: cover;
}

.glt-inroom-crew-btn .inroom-meta {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.glt-inroom-crew-btn .inroom-meta strong {
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.glt-inroom-crew-btn .inroom-meta small {
  font-size: 9px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Collapsed panel badge repositioning: sits centered above floating action bar */
.glt-viewport-container.panel-collapsed .glt-aim-badge {
  bottom: 68px;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(92vw, 480px);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  z-index: 59;
}

/* PvP Match Rules Preview & In-Room Card */
.glt-pvp-rules-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid var(--border-brass);
  border-radius: 8px;
  margin-top: 4px;
}

.glt-pvp-rules-preview.in-room {
  background: rgba(8, 20, 38, 0.85);
  border-color: rgba(245, 166, 35, 0.4);
  margin-top: 8px;
}

.glt-theme-light .glt-pvp-rules-preview {
  background: rgba(243, 232, 207, 0.85);
  border-color: var(--border-highlight);
}

.glt-pvp-rules-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  color: var(--gold-bright);
}

.glt-theme-light .glt-pvp-rules-header {
  color: #78350f;
}

.glt-pvp-badge-map {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.glt-theme-light .glt-pvp-badge-map {
  background: rgba(14, 165, 233, 0.15);
  color: #0369a1;
  border-color: #0284c7;
}

.glt-pvp-rules-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 12px;
}

.glt-pvp-rule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--text-muted);
}

.glt-pvp-rule-item strong {
  color: var(--text-primary);
  font-weight: 700;
}

.glt-theme-light .glt-pvp-rule-item strong {
  color: #1f2937;
}

.glt-pvp-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.glt-pvp-rule-tag {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.glt-theme-light .glt-pvp-rule-tag {
  background: rgba(16, 185, 129, 0.2);
  color: #065f46;
  border-color: #059669;
}

/* Rematch Status Card */
.glt-rematch-status-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(245, 166, 35, 0.12);
  border: 2px solid var(--gold);
  border-radius: 8px;
  margin-top: 10px;
  animation: pulse-fire-btn 2s infinite alternate ease-in-out;
}

.glt-theme-light .glt-rematch-status-card {
  background: rgba(245, 166, 35, 0.18);
  border-color: #b45309;
}

.glt-rematch-status-card .status-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.glt-rematch-status-card strong {
  font-size: 12px;
  color: var(--text-primary);
}

.glt-theme-light .glt-rematch-status-card strong {
  color: #78350f;
}

.glt-rematch-status-card small {
  font-size: 10px;
  color: var(--text-muted);
}

/* =========================================================================
   PHONE TURNED SIDEWAYS (short landscape screen)
   Stacking scene over panel left the 3D view about 120px tall and the radar off screen.
   Side by side instead: scene on the left, panel on the right; in battle the enemy radar
   takes the panel's height with FOGO, technique and Log Pose in a column beside it.
   ========================================================================= */
@media (orientation: landscape) and (max-height: 520px) {
  #glt-top-hud {
    min-height: 34px;
    padding: 2px 8px;
    gap: 6px;
    flex-wrap: nowrap;
  }

  .glt-main-title {
    font-size: 17px;
  }

  .glt-subtitle,
  .badge-sea,
  .glt-bounty-pill {
    display: none;
  }

  .glt-status-bug {
    min-width: 0;
    overflow: hidden;
    gap: 4px;
  }

  .glt-badge,
  .glt-turn-pill,
  .glt-timer-pill {
    font-size: 8px;
    padding: 3px 6px;
  }

  .glt-icon-btn {
    width: 30px;
    height: 30px;
    font-size: 13px;
  }

  #glt-workspace {
    flex-direction: row;
  }

  .glt-viewport-container,
  #glt-workspace:has(#content-tab-gameplay.active .glt-battle-panel) .glt-viewport-container:not(.panel-collapsed) {
    height: auto;
    flex: 1 1 auto;
  }

  .glt-side-panel,
  #glt-workspace:has(#content-tab-gameplay.active .glt-battle-panel) .glt-side-panel:not(.collapsed) {
    width: clamp(300px, 46vw, 440px);
    height: auto;
    border-top: none;
    border-left: 2px solid var(--border-brass);
  }

  .glt-tab-btn {
    padding: 6px 2px;
    font-size: 10.5px;
  }

  .glt-tab-content-wrapper {
    padding: 6px 8px;
  }

  .glt-setup-cta-bar {
    top: -6px;
  }

  .glt-footer {
    padding: 1px 8px;
  }

  .glt-disclaimer {
    font-size: 8px;
  }

  .glt-keyboard-help {
    display: none;
  }

  /* scene overlays sized for a short view */
  .glt-camera-bar {
    top: 6px;
    left: 6px;
    gap: 4px;
  }

  .glt-pill-btn {
    font-size: 9.5px;
    padding: 3px 7px;
  }

  .glt-rival-overlay {
    top: auto;
    bottom: 6px;
    right: 6px;
    left: auto;
    max-width: 195px;
  }

  .glt-captain-avatar {
    width: 30px;
    height: 30px;
  }

  .glt-taunt-bubble {
    font-size: 9.5px;
    padding: 4px 7px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .glt-aim-badge {
    bottom: 6px;
    left: 6px;
    font-size: 10px;
    padding: 3px 8px;
    max-width: 165px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* battle: radar | firing column; everything else full width below */
  .glt-battle-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 92px;
    align-items: start;
    gap: 6px;
  }

  .glt-battle-panel > * {
    grid-column: 1 / -1;
    order: 3;
  }

  .glt-battle-panel > .glt-radar-grid-wrapper:not(.glt-mini-radar) {
    grid-column: 1;
    grid-row: 1;
    justify-self: center;
    padding: 3px 5px;
    gap: 2px;
  }

  /* the grid height follows its width here (fitBattleRadar sizes it to the panel) */
  .glt-battle-panel .radar-cell {
    min-height: 17px;
  }

  .glt-battle-panel > .glt-battle-triggers {
    grid-column: 2;
    grid-row: 1;
    grid-template-columns: 1fr;
    grid-auto-flow: row;
    grid-auto-columns: auto;
    gap: 6px;
  }

  .glt-battle-panel > .glt-battle-triggers .btn-fire {
    grid-column: auto;
    font-size: 11px;
    padding: 12px 4px;
    letter-spacing: 0.5px;
  }

  .glt-battle-panel > .glt-battle-triggers .glt-btn {
    min-height: 44px;
    padding: 6px 4px;
    font-size: 10.5px;
    line-height: 1.2;
    white-space: normal;
  }
}

/* Touch screens: every control reaches 44x44 (docs/web-guidance-rules.md R1). Compact controls
   keep a smaller face and extend their hit area with ::after; gaps are set so extended areas
   meet without overlapping. Last in the sheet so it wins over the phone/landscape blocks. */
@media (pointer: coarse) {
  .glt-quick-tools {
    gap: 6px;
  }

  .glt-icon-btn {
    position: relative;
    width: 38px;
    height: 38px;
  }

  .glt-icon-btn::after {
    content: "";
    position: absolute;
    inset: -3px;
  }

  .glt-camera-bar {
    gap: 12px 6px;
  }

  .glt-pill-btn {
    position: relative;
    min-height: 32px;
  }

  .glt-pill-btn::after {
    content: "";
    position: absolute;
    inset: -6px 0;
  }

  .glt-tab-btn {
    position: relative;
    min-height: 44px;
  }

  .glt-btn,
  .glt-battle-panel > .glt-battle-triggers .glt-btn,
  .glt-tab-pane select {
    min-height: 44px;
  }
}

@media (pointer: coarse) and (orientation: landscape) and (max-height: 520px) {
  .glt-tab-btn {
    min-height: 36px;
  }

  .glt-tab-btn::after {
    content: "";
    position: absolute;
    inset: -4px 0;
  }
}
`;
}

// Folders the service worker stores on install, so the game opens and plays the AI offline.
// maps/ (2.3 MB of chart and island art) is cached the first time each image is shown instead.
const PRECACHE_FOLDERS = ['icons', 'portraits', 'emblems', 'officers', 'ships', 'props', 'hazards', 'techniques', 'blessings', 'backgrounds'];

/**
 * Writes sw.js from src/sw/sw.js: the file list to store and a version that changes whenever
 * the page or any stored file changes (a new version drops the old cache).
 */
function writeServiceWorker(html) {
  const crypto = require('crypto');
  const files = [];
  PRECACHE_FOLDERS.forEach(folder => {
    const dir = path.join(ROOT_DIR, 'assets', folder);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).sort().forEach(name => {
      if (/\.(png|jpe?g|webp|svg)$/i.test(name)) files.push({ url: 'assets/' + folder + '/' + name, size: fs.statSync(path.join(dir, name)).size });
    });
  });
  const hash = crypto.createHash('sha256');
  hash.update(html);
  files.forEach(f => hash.update(f.url + ':' + f.size));
  const manifestPath = path.join(ROOT_DIR, 'manifest.webmanifest');
  if (fs.existsSync(manifestPath)) hash.update(fs.readFileSync(manifestPath));
  const version = hash.digest('hex').slice(0, 12);

  // scripts the page loads from a CDN (Three.js): taken from the page, so the URL lives in one place
  const cdnScripts = Array.from(html.matchAll(/<script src="(https:\/\/[^"]+)"><\/script>/g), m => m[1]);
  const precache = ['./index.html', 'manifest.webmanifest'].concat(files.map(f => f.url), cdnScripts);
  const template = fs.readFileSync(path.join(ROOT_DIR, 'src', 'sw', 'sw.js'), 'utf8');
  const sw = template
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
  fs.writeFileSync(path.join(ROOT_DIR, 'sw.js'), sw, 'utf8');
  const kb = files.reduce((n, f) => n + f.size, 0) / 1024;
  console.log(`✓ Service worker: sw.js (versão ${version}, ${precache.length} arquivos, ${kb.toFixed(0)} KB de imagens)`);
}

function build() {
  console.log('=== GRAND LINE TACTICS: CONCATENATING ARTIFACT ===');

  SOURCE_FILES.forEach(file => {
    const p = path.join(ROOT_DIR, file);
    if (!fs.existsSync(p)) {
      throw new Error(`Arquivo fonte essencial ausente: ${file}`);
    }
  });

  const moduleCodes = SOURCE_FILES.map(file => {
    const p = path.join(ROOT_DIR, file);
    const content = fs.readFileSync(p, 'utf8');
    return `\n/* ==================== MODULE: ${file} ==================== */\n${content}\n`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="color-scheme" content="dark light">
  <title>Grand Line Tactics</title>

  <!-- PWA: installable app (manifest, icons, browser bar colour). sw.js is registered by src/ui/app-shell.js.
       scripts/build-artifact.js removes this block: the single-file artifact has no files beside it. -->
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#061121">
  <link rel="icon" type="image/png" sizes="192x192" href="assets/icons/icon-192.png">
  <link rel="apple-touch-icon" href="assets/icons/apple-touch-icon.png">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="GL Tactics">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <!-- /PWA -->

  <!-- Google Fonts (Latin & Latin-Extended coverage for Portuguese accents ç ã õ é ê í ó ú) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Pirata+One&family=Press+Start+2P&display=swap&subset=latin,latin-ext" rel="stylesheet">

  <!-- Three.js r128 (cdnjs). Navios: modelos voxel proprios (src/ships), sem loader glTF -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>

  <style>
${getStyles()}
  </style>
</head>
<body>
  <!-- All logic, rendering, shader pipelines, audio and UI modules concatenated -->
  <script>
${moduleCodes}

    // Bootstrap Game Application on DOM ready
    (function() {
      function startApp() {
        if (typeof GLT !== 'undefined' && GLT.ui && typeof GLT.ui.init === 'function') {
          GLT.ui.init();
        } else {
          console.error('Falha ao inicializar Grand Line Tactics: GLT.ui não encontrado.');
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
      } else {
        startApp();
      }
    })();
  </script>
</body>
</html>
`;

  const outIndex = path.join(ROOT_DIR, 'index.html');
  const outTactics = path.join(ROOT_DIR, 'grand-line-tactics.html');

  fs.writeFileSync(outIndex, html, 'utf8');
  fs.writeFileSync(outTactics, html, 'utf8');
  writeServiceWorker(html);
  // dist/grand-line-tactics.html (images embedded) is produced by scripts/build-artifact.js

  console.log(`✓ Gerado com sucesso: ${outIndex} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`✓ Cópia gerada: ${outTactics}`);
}

if (require.main === module) {
  build();
}

module.exports = { build };
