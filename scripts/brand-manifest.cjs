// Shared by gen-brand-manifest.cjs (writes the pin) and test-brand-kit.cjs
// (checks it). The manifest is `sha256sum` format — "<hex>  <path>" per line,
// paths relative to the mirror, sorted — so `sha256sum -c` can read it too
// (from inside print-server/public/brand/).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const MIRROR_DIR = path.join(REPO, 'print-server', 'public', 'brand');
const MANIFEST_FILE = path.join(__dirname, 'brand-kit.sha256');

// Every regular file under `dir`, as [{ file, sha256 }] with forward-slash
// relative paths, sorted. Symlinks are listed (and so fail the check) rather
// than followed: the installer copies files, and a link would ship as nothing.
function hashTree(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) walk(a, r);
      else if (st.isFile()) out.push({ file: r, sha256: crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex') });
      else out.push({ file: r, sha256: 'not-a-regular-file' });
    }
  };
  walk(dir, '');
  return out.sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
}

function formatManifest(entries) {
  return entries.map((e) => `${e.sha256}  ${e.file}`).join('\n') + '\n';
}

function parseManifest(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

module.exports = { REPO, MIRROR_DIR, MANIFEST_FILE, hashTree, formatManifest, parseManifest };
