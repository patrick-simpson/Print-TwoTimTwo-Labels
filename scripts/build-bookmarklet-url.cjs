#!/usr/bin/env node
/**
 * Builds bookmarklet.min.js from bookmarklet.js.
 *
 * Strips full-line comments, collapses whitespace, and prepends "javascript:"
 * so the file contents can be pasted directly into a browser bookmark URL field.
 *
 * No dependencies — uses only Node built-ins.
 * Run automatically as part of prebuild, or standalone via:
 *   node scripts/build-bookmarklet-url.cjs
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../bookmarklet.js'), 'utf8');

const minified = src
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0 && !line.startsWith('//'))
  .join(' ');

const url = 'javascript:' + minified;
fs.writeFileSync(path.join(__dirname, '../bookmarklet.min.js'), url);
console.log('✓ bookmarklet.min.js generated (' + url.length + ' chars)');
