#!/usr/bin/env node
/**
 * Validates the bookmarklet IIFE in public/bookmarklet.html.
 *
 * Extracts the <script type="text/plain" id="bookmarklet-source"> block,
 * writes it to a temp file, and runs `node --check` on it.
 *
 * Exit code 0 = valid. Exit code 1 = syntax error or block not found.
 * Run automatically as `prebuild` so bad code never reaches GitHub Pages.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const htmlPath = path.join(__dirname, '../public/bookmarklet.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const match = html.match(
  /<script type="text\/plain" id="bookmarklet-source">([\s\S]+?)<\/script>/
);

if (!match) {
  console.error('ERROR: <script type="text/plain" id="bookmarklet-source"> block not found in bookmarklet.html');
  process.exit(1);
}

const code = match[1].trim();
const tmp = path.join(os.tmpdir(), 'bm-validate.js');
fs.writeFileSync(tmp, code);

try {
  execSync('node --check ' + tmp, { stdio: 'inherit' });
  console.log('✓ Bookmarklet JavaScript syntax is valid');
} catch (e) {
  console.error('✗ Bookmarklet has a syntax error — fix it before deploying');
  process.exit(1);
} finally {
  fs.unlinkSync(tmp);
}
