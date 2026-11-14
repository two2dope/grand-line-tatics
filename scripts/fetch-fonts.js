#!/usr/bin/env node
/**
 * Grand Line Tactics: baixa as fontes do jogo para assets/fonts/.
 *
 * O servidor Wi-Fi (scripts/lan-server.js) serve essas cópias no lugar do Google Fonts, para
 * que o segundo aparelho carregue o jogo mesmo em um Wi-Fi sem internet. Só é preciso rodar
 * de novo se a lista de fontes do jogo mudar.
 *
 * Uso: node scripts/fetch-fonts.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.resolve(__dirname, '..', 'assets', 'fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;600;700&family=Pirata+One&family=Press+Start+2P&display=swap';
// Google Fonts only answers with woff2 + unicode-range subsets to a modern browser.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// The game is in Portuguese: Latin and Latin Extended cover every string it shows.
const KEEP_SUBSETS = ['latin', 'latin-ext'];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const css = (await get(CSS_URL)).toString('utf8');
  const blockRe = /\/\* ([a-z-]+) \*\/\s*(@font-face \{[^}]*\})/g;
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const out = [
    '/* Cópias locais das fontes do jogo (SIL Open Font License 1.1). Gerado por scripts/fetch-fonts.js. */'
  ];
  let match;
  let count = 0;
  while ((match = blockRe.exec(css)) !== null) {
    const subset = match[1];
    let block = match[2];
    if (!KEEP_SUBSETS.includes(subset)) continue;

    const family = (/font-family: '([^']+)'/.exec(block) || [])[1];
    const weight = (/font-weight: (\d+)/.exec(block) || [])[1];
    const remote = (/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/.exec(block) || [])[1];
    if (!family || !weight || !remote) throw new Error('Unexpected @font-face block for subset ' + subset);

    const fileName = family.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + weight + '-' + subset + '.woff2';
    fs.writeFileSync(path.join(OUT_DIR, fileName), await get(remote));
    block = block.replace(remote, fileName);
    out.push('/* ' + subset + ' */', block);
    count++;
    console.log('  ' + fileName);
  }
  if (count === 0) throw new Error('No font faces found: the Google Fonts response changed.');

  fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), out.join('\n') + '\n');
  console.log('✓ ' + count + ' fontes + fonts.css em ' + OUT_DIR);
}

main().catch(err => {
  console.error('Falha ao baixar fontes:', err.message);
  process.exit(1);
});
