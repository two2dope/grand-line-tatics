#!/usr/bin/env node
/*
 * Leak guard. Blocks a commit (or fails CI) when a tracked file would publish something it should not:
 * secrets and private keys, personal paths or e-mail addresses, files from folders that must stay local,
 * or files too large for the repository.
 *
 *   node scripts/check-leaks.js            scan every tracked file
 *   node scripts/check-leaks.js --staged   scan only what is staged (used by .githooks/pre-commit)
 *
 * A line can opt out of the content rules with the marker `leak-check: allow` (keep it rare and explained).
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGED = process.argv.includes('--staged');
const MAX_BYTES = 3 * 1024 * 1024;   // largest tracked asset today is ~1.6 MB

// Folders and files that must never be tracked (third-party references, build output, local config).
const FORBIDDEN_PATHS = [
  [/^ref\//, 'third-party reference material (copyrighted)'],
  [/^shots\//, 'working screenshots (use docs/media/ for curated images)'],
  [/^dist\//, 'build output'],
  [/^node_modules\//, 'dependencies'],
  [/^progress\//, 'internal process dashboard'],
  [/(^|\/)\.env(\..*)?$/, 'environment file'],
  [/\.(pem|key|p12|pfx)$/i, 'key or certificate'],
  [/(^|\/)id_rsa/, 'SSH key'],
  [/\.code-workspace$/, 'local workspace file'],
  [/\.(stl|zip|7z|rar)$/i, 'archive or 3D print model (licence unknown, too large)'],
];

// Content rules: [regex, label]. Applied to text files only.
const CONTENT_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key block'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub fine-grained token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/\bsk-[A-Za-z0-9]{32,}\b/, 'API secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b)[^\\/\s'"`]+/i, 'personal Windows path'],
  [/\/(?:home|Users)\/(?!runner\b|user\b|you\b)[a-z][\w.-]+\//, 'personal Unix path'],
  [/\b[A-Za-z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo|icloud|live|proton(?:mail)?)\.[a-z.]+\b/i, 'personal e-mail address'],
];

const TEXT_EXT = /\.(js|mjs|cjs|json|md|html|css|txt|cmd|bat|sh|yml|yaml|svg|editorconfig|gitignore|gitattributes)$/i;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles() {
  const out = STAGED
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function readStaged(file) {
  // The staged blob, not the working copy: that is what the commit will contain.
  return execFileSync('git', ['show', ':' + file], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

const problems = [];
for (const file of listFiles()) {
  for (const [re, why] of FORBIDDEN_PATHS) {
    if (re.test(file)) problems.push(`${file}: path not allowed (${why})`);
  }
  let buf;
  try {
    buf = STAGED ? readStaged(file) : fs.readFileSync(path.join(ROOT, file));
  } catch (e) {
    continue;
  }
  if (buf.length > MAX_BYTES) {
    problems.push(`${file}: ${(buf.length / 1048576).toFixed(1)} MB is over the ${MAX_BYTES / 1048576} MB limit (publish large media as a release asset)`);
  }
  const base = path.basename(file);
  if (!TEXT_EXT.test(file) && !TEXT_EXT.test('.' + base)) continue;
  if (file.startsWith('tools/vendor/')) continue;            // minified third-party code
  if (file === 'scripts/check-leaks.js') continue;          // this file spells the patterns out
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('leak-check: allow')) return;
    for (const [re, why] of CONTENT_RULES) {
      const m = line.match(re);
      if (m) problems.push(`${file}:${i + 1}: ${why} ("${m[0].slice(0, 12)}…")`);
    }
  });
}

if (problems.length) {
  console.error('\nLeak check FAILED. Nothing was committed.\n');
  problems.forEach((p) => console.error('  - ' + p));
  console.error('\nFix the file, unstage it, or add it to .gitignore. Run `npm run check:leaks` to scan the whole repo.\n');
  process.exit(1);
}
console.log(`Leak check passed (${STAGED ? 'staged files' : 'all tracked files'}).`);
