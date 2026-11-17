/**
 * Grand Line Tactics: draws the app icons (home screen, install prompt, splash) into
 * assets/icons/. A gold ship's wheel on the game's night-sea blue, drawn in code.
 *
 * Usage: node scripts/make-icons.js
 *
 * Runs in Chrome through Playwright (devDependency), like scripts/optimize-assets.js.
 * The PNGs are committed; run this again only to change the design.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'assets', 'icons');

// name, size, scale of the wheel (maskable icons keep everything inside the central 80% circle)
const ICONS = [
  ['icon-192.png', 192, 0.9],
  ['icon-512.png', 512, 0.9],
  ['icon-maskable-512.png', 512, 0.72],
  ['apple-touch-icon.png', 180, 0.9]
];

async function main() {
  const { chromium } = require('playwright');
  const channel = process.env.GLT_BROWSER_CHANNEL !== undefined ? process.env.GLT_BROWSER_CHANNEL : 'chrome';
  const browser = await chromium.launch(channel ? { channel } : {});
  const page = await browser.newPage();
  fs.mkdirSync(OUT, { recursive: true });

  for (const [name, size, scale] of ICONS) {
    const data = await page.evaluate(({ size, scale }) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const g = cv.getContext('2d');
      const c = size / 2;
      const u = size / 512; // drawn on a 512 grid

      // night sea
      const bg = g.createRadialGradient(c, c * 0.8, size * 0.05, c, c, size * 0.75);
      bg.addColorStop(0, '#12325c');
      bg.addColorStop(1, '#061121');
      g.fillStyle = bg;
      g.fillRect(0, 0, size, size);

      g.save();
      g.translate(c, c);
      g.scale(scale, scale);

      const gold = g.createLinearGradient(0, -200 * u, 0, 200 * u);
      gold.addColorStop(0, '#ffe08a');
      gold.addColorStop(0.5, '#f5a623');
      gold.addColorStop(1, '#b8700f');
      g.strokeStyle = gold;
      g.fillStyle = gold;
      g.lineCap = 'round';

      // spokes with handles
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i * Math.PI) / 4);
        g.lineWidth = 22 * u;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -196 * u);
        g.stroke();
        g.beginPath();
        g.ellipse(0, -205 * u, 20 * u, 30 * u, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      // rim
      g.lineWidth = 30 * u;
      g.beginPath();
      g.arc(0, 0, 140 * u, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(6, 17, 33, 0.55)';
      g.lineWidth = 5 * u;
      g.beginPath();
      g.arc(0, 0, 140 * u, 0, Math.PI * 2);
      g.stroke();
      // hub
      g.fillStyle = gold;
      g.beginPath();
      g.arc(0, 0, 50 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#061121';
      g.beginPath();
      g.arc(0, 0, 20 * u, 0, Math.PI * 2);
      g.fill();
      g.restore();

      const url = cv.toDataURL('image/png');
      return url.slice(url.indexOf(',') + 1);
    }, { size, scale });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log('assets/icons/' + name);
  }
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
