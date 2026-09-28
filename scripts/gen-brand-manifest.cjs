#!/usr/bin/env node
// Regenerate the brand-kit mirror's pinned manifest (scripts/brand-kit.sha256).
//
// print-server/public/brand/ is a BYTE-IDENTICAL copy of the canonical kit in
// the Awana-Check-in-Display repo (shared/brand/). It is never edited here:
// the kit changes there first and is then copied into this repo (and into
// journey-display's public/brand/). scripts/test-brand-kit.cjs, part of
// `npm test`, fails when the mirror and this manifest disagree, so a local
// edit, a half-finished copy or a stray file cannot ship in the installer.
//
// To take a new version of the kit:
//
//   node scripts/gen-brand-manifest.cjs --from ../Awana-Check-in-Display/shared/brand
//
// which replaces the mirror wholesale with the canonical folder (files the kit
// dropped are removed too) and rewrites the manifest. Without --from it only
// rewrites the manifest from the mirror as it stands — for when the copy was
// made by hand with
//
//   mkdir -p print-server/public/brand && cp -r <canonical>/. print-server/public/brand/
//
// Then run `npm test` (the golden label images pin what the fonts and marks
// draw, so a changed font or mark shows up there as a diff to review and
// accept with `npm run test:golden:update`), and commit the mirror, the
// manifest and any regenerated baselines together.
//
// To check the mirror against a canonical checkout without changing anything:
//
//   BRAND_KIT_CANONICAL=../Awana-Check-in-Display/shared/brand npm run test:brand
//
// Line endings: the kit's text files are LF, and a CR in one is refused (from
// --from before anything is copied, and in the mirror before anything is
// pinned). On Windows, Git's default core.autocrlf=true checks the canonical
// kit out as CRLF; take the kit from a clone made with
// `git clone -c core.autocrlf=false`, or run
// `git -c core.autocrlf=false checkout -- shared/brand` there first.
//
// --mirror <dir> and --manifest <file> point the script somewhere other than
// print-server/public/brand and scripts/brand-kit.sha256 (the test suite uses
// them to run it against a scratch folder).

'use strict';

const fs = require('fs');
const path = require('path');
const brandManifest = require('./brand-manifest.cjs');
const { hashTree, formatManifest, filesWithCarriageReturns } = brandManifest;

function main() {
  const args = process.argv.slice(2);
  const option = (flag, fallback) => {
    const at = args.indexOf(flag);
    if (at < 0) return fallback;
    if (!args[at + 1]) {
      console.error(`${flag} needs a value`);
      process.exit(2);
    }
    return path.resolve(args[at + 1]);
  };
  const MIRROR_DIR = option('--mirror', brandManifest.MIRROR_DIR);
  const MANIFEST_FILE = option('--manifest', brandManifest.MANIFEST_FILE);
  const refuseCarriageReturns = (dir, what) => {
    const bad = filesWithCarriageReturns(dir);
    if (!bad.length) return;
    console.error(`${what} has CR (Windows) line endings in ${bad.length} text file(s), e.g. ${bad.slice(0, 3).join(', ')}.`);
    console.error('The kit is LF only, and pinning these would end "byte-identical". On Windows, re-check it out');
    console.error('with `git -c core.autocrlf=false checkout -- shared/brand` (or clone with -c core.autocrlf=false).');
    process.exit(2);
  };
  const fromAt = args.indexOf('--from');
  if (fromAt >= 0) {
    const from = args[fromAt + 1];
    if (!from) {
      console.error('--from needs the canonical kit folder (…/Awana-Check-in-Display/shared/brand)');
      process.exit(2);
    }
    const src = path.resolve(from);
    if (!fs.existsSync(path.join(src, 'tokens.json')) || !fs.existsSync(path.join(src, 'fonts'))) {
      console.error(`${src} does not look like the brand kit (no tokens.json / fonts/)`);
      process.exit(2);
    }
    // Before the mirror is touched: a refused import leaves it as it was.
    refuseCarriageReturns(src, src);
    fs.rmSync(MIRROR_DIR, { recursive: true, force: true });
    fs.mkdirSync(MIRROR_DIR, { recursive: true });
    fs.cpSync(src, MIRROR_DIR, { recursive: true });
    console.log(`Mirrored ${src} -> ${path.relative(process.cwd(), MIRROR_DIR)}`);
  }
  if (!fs.existsSync(MIRROR_DIR)) {
    console.error(`No mirror at ${MIRROR_DIR}`);
    process.exit(2);
  }
  refuseCarriageReturns(MIRROR_DIR, path.relative(process.cwd(), MIRROR_DIR) || MIRROR_DIR);
  const entries = hashTree(MIRROR_DIR);
  fs.writeFileSync(MANIFEST_FILE, formatManifest(entries));
  console.log(`Wrote ${path.relative(process.cwd(), MANIFEST_FILE)} (${entries.length} files)`);
}

main();
