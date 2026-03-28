#!/usr/bin/env node
/**
 * Validates the bookmarklet IIFE in bookmarklet.js (project root).
 * Runs `node --check` on it. Exit 0 = valid, exit 1 = syntax error.
 * Run automatically as `prebuild` so bad code never reaches GitHub Pages.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const bookmarkletPath = path.join(__dirname, '../bookmarklet.js');
const code = fs.readFileSync(bookmarkletPath, 'utf8');

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
