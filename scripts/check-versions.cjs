#!/usr/bin/env node
// Verify that every file that hardcodes a version string agrees with the
// canonical VERSION file. Run in CI (ci.yml / release.yml) so a drifted
// version bump fails the build loudly.

'use strict';

const fs   = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const expected = fs.readFileSync(path.join(rootDir, 'VERSION'), 'utf8').trim();

if (!/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`VERSION file contains invalid version: "${expected}"`);
  process.exit(1);
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));
}

function extract(relPath, regex) {
  const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
  const match = content.match(regex);
  return match ? match[1] : null;
}

const checks = [
  { label: 'package.json',             actual: readJson('package.json').version },
  { label: 'server/package.json',      actual: readJson('server/package.json').version },
  { label: 'extension/manifest.json',  actual: readJson('extension/manifest.json').version },
  { label: 'extension/content.js',     actual: extract('extension/content.js', /EXTENSION_VERSION\s*=\s*'([^']+)'/) },
  { label: 'extension/popup.html',     actual: extract('extension/popup.html', /Extension v([\d.]+)/) },
];

const drift = [];
checks.forEach(c => {
  if (c.actual !== expected) {
    drift.push(`  ${c.label}: expected ${expected}, got ${c.actual || '(missing)'}`);
  }
});

if (drift.length > 0) {
  console.error(`Version drift detected — VERSION file says ${expected} but:`);
  drift.forEach(line => console.error(line));
  console.error('\nRun: node scripts/bump-version.cjs ' + expected);
  process.exit(1);
}

console.log(`OK — all ${checks.length} files agree on version ${expected}`);
