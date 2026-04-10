#!/usr/bin/env node
// Bump the version across every file that hardcodes one.
// Usage: node scripts/bump-version.cjs <X.Y.Z>
//
// Running `npm run lint:versions` (scripts/check-versions.cjs) afterwards
// will verify every file agrees with VERSION, so drift is caught in CI.

'use strict';

const fs   = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/bump-version.cjs <X.Y.Z>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

const files = [
  {
    path: path.join(rootDir, 'VERSION'),
    patterns: [{ from: /\d+\.\d+\.\d+/g, to: version }],
  },
  {
    path: path.join(rootDir, 'package.json'),
    patterns: [{ from: /"version":\s*"\d+\.\d+\.\d+"/, to: `"version": "${version}"` }],
  },
  {
    path: path.join(rootDir, 'server', 'package.json'),
    patterns: [{ from: /"version":\s*"\d+\.\d+\.\d+"/, to: `"version": "${version}"` }],
  },
  {
    path: path.join(rootDir, 'extension', 'manifest.json'),
    patterns: [{ from: /"version":\s*"\d+\.\d+\.\d+"/, to: `"version": "${version}"` }],
  },
  {
    path: path.join(rootDir, 'extension', 'content.js'),
    patterns: [{ from: /EXTENSION_VERSION\s*=\s*'[^']+'/, to: `EXTENSION_VERSION = '${version}'` }],
  },
  {
    path: path.join(rootDir, 'extension', 'popup.html'),
    patterns: [{ from: /Extension v[\d.]+/g, to: `Extension v${version}` }],
  },
];

let touched = 0;
files.forEach(file => {
  if (!fs.existsSync(file.path)) {
    console.warn('Warning: file not found:', file.path);
    return;
  }
  let content = fs.readFileSync(file.path, 'utf8');
  const before = content;
  file.patterns.forEach(p => { content = content.replace(p.from, p.to); });
  if (content !== before) {
    fs.writeFileSync(file.path, content);
    console.log('updated:', path.relative(rootDir, file.path));
    touched++;
  } else {
    console.log('no change:', path.relative(rootDir, file.path));
  }
});

console.log(`\nSuccessfully bumped ${touched} file(s) to ${version}.`);
console.log('Next: node scripts/check-versions.cjs  (verifies no drift)');
