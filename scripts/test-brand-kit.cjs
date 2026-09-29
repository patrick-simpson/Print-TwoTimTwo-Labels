#!/usr/bin/env node
// The brand kit on the label printer: the mirror, the packaging, and the
// fail-open promise.
//
//   1. DRIFT. print-server/public/brand/ must be byte-identical to the
//      canonical kit (Awana-Check-in-Display/shared/brand/). The canonical repo
//      is not here in CI, so the mirror is pinned by scripts/brand-kit.sha256
//      and every file is checked against it: no missing file, no extra file, no
//      changed byte. To take a new kit: `node scripts/gen-brand-manifest.cjs
//      --from <canonical>` (see that script). Set BRAND_KIT_CANONICAL to a
//      canonical checkout to compare against it directly as well.
//   2. PACKAGING. The installer ships the kit because electron-builder's
//      extraResources copies print-server/public/** and print-server/*.js
//      (brand.js). If that filter ever narrows, the kit silently stops
//      shipping and every label falls back; this fails first.
//   3. FAIL-OPEN. A missing folder, a corrupt font, a broken mark: the kit
//      reports what failed (as data and as {type, message} warnings on
//      /health) and a label still renders, every time. A child at the door
//      always gets a label.
//
// Run: npm run test:brand

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { MIRROR_DIR, MANIFEST_FILE, REPO, hashTree, parseManifest, filesWithCarriageReturns } = require('./brand-manifest.cjs');

const PORT = Number(process.env.AWANA_TEST_PORT || 34603);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  // ── 1. The mirror matches its pin ──────────────────────────────────────────
  console.log('brand kit: the mirror is byte-identical to its pinned manifest');
  {
    check('the mirror exists', fs.existsSync(MIRROR_DIR), MIRROR_DIR);
    check('the manifest exists', fs.existsSync(MANIFEST_FILE), MANIFEST_FILE);
    const pinned = parseManifest(fs.existsSync(MANIFEST_FILE) ? fs.readFileSync(MANIFEST_FILE, 'utf8') : '');
    const actual = fs.existsSync(MIRROR_DIR) ? hashTree(MIRROR_DIR) : [];
    const HOW = 're-copy the kit from Awana-Check-in-Display/shared/brand with scripts/gen-brand-manifest.cjs --from <it>; never edit the mirror here';
    check('the manifest pins a real kit (fonts, marks, tokens)', pinned.size >= 60
      && pinned.has('tokens.json') && pinned.has('fonts/PaytoneOne-Regular.ttf') && pinned.has('logos/sparks-black.svg'),
      `${pinned.size} entries`);
    const seen = new Set();
    for (const { file, sha256 } of actual) {
      seen.add(file);
      if (!pinned.has(file)) check(`mirror file ${file} is in the manifest`, false, `an extra file — ${HOW}`);
      else check(`mirror file ${file} matches its pinned hash`, pinned.get(file) === sha256, `changed — ${HOW}`);
    }
    for (const file of pinned.keys()) {
      if (!seen.has(file)) check(`pinned file ${file} is in the mirror`, false, `missing — ${HOW}`);
    }
    // The hashes above only prove the mirror matches its own pin. A CRLF copy
    // of the kit (a Windows checkout of the canonical repo, copied in and
    // re-pinned) would match a CRLF pin just as well, so line endings are
    // checked on their own: the kit's text files are LF, everywhere.
    const crlf = fs.existsSync(MIRROR_DIR) ? filesWithCarriageReturns(MIRROR_DIR) : [];
    check('no text file in the mirror has a CR line ending (the kit is LF only)', crlf.length === 0,
      `${crlf.slice(0, 5).join(', ')} — ${HOW}, from a checkout made with core.autocrlf=false`);

    const canonical = process.env.BRAND_KIT_CANONICAL;
    if (canonical) {
      console.log(`  (also comparing against BRAND_KIT_CANONICAL=${canonical})`);
      const canon = fs.existsSync(canonical) ? hashTree(path.resolve(canonical)) : [];
      check('the canonical folder exists', canon.length > 0, canonical);
      const mine = new Map(actual.map((e) => [e.file, e.sha256]));
      for (const { file, sha256 } of canon) {
        check(`canonical ${file} is mirrored byte for byte`, mine.get(file) === sha256,
          mine.has(file) ? 'differs' : 'missing from the mirror');
      }
      check('the mirror has no file the canonical kit does not', actual.every((e) => canon.some((c) => c.file === e.file)));
      // Or a CRLF canonical checkout and a CRLF mirror would agree here too.
      const canonCr = canon.length ? filesWithCarriageReturns(path.resolve(canonical)) : [];
      check('the canonical checkout is LF too (not a CRLF Windows checkout)', canonCr.length === 0,
        `${canonCr.slice(0, 5).join(', ')} — re-check it out with git -c core.autocrlf=false checkout -- shared/brand`);
    }
  }

  // ── 1b. Line endings: the check, the regenerate script and git ─────────────
  console.log('brand kit: a CRLF copy of the kit can be neither pinned nor committed');
  {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-brand-eol-'));
    try {
      // The detector: text files with a CR are listed, fonts (binary, full of
      // 0x0D bytes) never are.
      const probe = path.join(scratch, 'probe');
      fs.mkdirSync(path.join(probe, 'logos'), { recursive: true });
      fs.mkdirSync(path.join(probe, 'fonts'));
      fs.writeFileSync(path.join(probe, 'tokens.css'), ':root {\n  --a: 1;\n}\n');
      fs.writeFileSync(path.join(probe, 'logos', 'x.svg'), '<svg>\r\n</svg>\r\n');
      fs.writeFileSync(path.join(probe, 'fonts', 'x.ttf'), Buffer.from([0x00, 0x01, 0x0D, 0x0A, 0x0D]));
      const listed = filesWithCarriageReturns(probe);
      check('a CRLF SVG is caught, an LF stylesheet and a binary font are not',
        listed.length === 1 && listed[0] === 'logos/x.svg', JSON.stringify(listed));

      // The regenerate script, pointed at scratch folders (--mirror/--manifest)
      // so the real mirror is never at risk here.
      const GEN = path.join(__dirname, 'gen-brand-manifest.cjs');
      const gen = (...args) => spawnSync(process.execPath, [GEN, ...args], { encoding: 'utf8' });
      const lfKit = path.join(scratch, 'lf-kit');
      fs.cpSync(MIRROR_DIR, lfKit, { recursive: true });
      const out1 = path.join(scratch, 'mirror-1');
      const pin1 = path.join(scratch, 'pin-1.sha256');
      const ok = gen('--from', lfKit, '--mirror', out1, '--manifest', pin1);
      check('the regenerate script takes an LF kit', ok.status === 0, ok.stderr);
      check('...and writes exactly the committed pin for it',
        fs.existsSync(pin1) && fs.readFileSync(pin1, 'utf8') === fs.readFileSync(MANIFEST_FILE, 'utf8'));

      // A Windows checkout of the canonical kit: every multi-line text file CRLF.
      const crKit = path.join(scratch, 'crlf-kit');
      fs.cpSync(MIRROR_DIR, crKit, { recursive: true });
      let converted = 0;
      for (const rel of ['tokens.css', 'tokens.json', 'README.md']) {
        const f = path.join(crKit, rel);
        if (!fs.existsSync(f)) continue;
        fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n'));
        converted++;
      }
      check('the CRLF fixture really has CRLF files', converted > 0 && filesWithCarriageReturns(crKit).length === converted);
      const out2 = path.join(scratch, 'mirror-2');
      fs.mkdirSync(out2);
      fs.writeFileSync(path.join(out2, 'sentinel'), 'untouched');
      const pin2 = path.join(scratch, 'pin-2.sha256');
      const refused = gen('--from', crKit, '--mirror', out2, '--manifest', pin2);
      check('the regenerate script refuses a CRLF kit', refused.status !== 0 && /CR/.test(refused.stderr), refused.stderr);
      check('...before touching the mirror', fs.existsSync(path.join(out2, 'sentinel')) && fs.readdirSync(out2).length === 1);
      check('...and pins nothing', !fs.existsSync(pin2));
      // A CRLF copy made by hand, then pinned without --from.
      const pin3 = path.join(scratch, 'pin-3.sha256');
      const handCopy = gen('--mirror', crKit, '--manifest', pin3);
      check('the regenerate script refuses to pin a CRLF mirror made by hand', handCopy.status !== 0 && !fs.existsSync(pin3),
        handCopy.stderr);

      // And git: the mirror's text types are LF in every checkout and
      // normalised on commit; the fonts are binary. Checked only where this
      // is a git work tree (it is in CI and in every clone).
      const attr = spawnSync('git', ['check-attr', 'text', 'eol', '--',
        'print-server/public/brand/tokens.css', 'print-server/public/brand/logos/sparks-black.svg',
        'print-server/public/brand/fonts/PaytoneOne-Regular.ttf', 'scripts/brand-kit.sha256'], { cwd: REPO, encoding: 'utf8' });
      if (attr.status === 0 && attr.stdout) {
        const a = (file, name) => {
          const m = attr.stdout.match(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: ${name}: (\\S+)$`, 'm'));
          return m ? m[1] : null;
        };
        for (const file of ['print-server/public/brand/tokens.css', 'print-server/public/brand/logos/sparks-black.svg', 'scripts/brand-kit.sha256']) {
          check(`git keeps ${file} LF (text, eol=lf)`, a(file, 'text') === 'set' && a(file, 'eol') === 'lf', attr.stdout);
        }
        check('git never converts a kit font (binary)', a('print-server/public/brand/fonts/PaytoneOne-Regular.ttf', 'text') === 'unset', attr.stdout);
      } else {
        console.log('  (not a git work tree here: .gitattributes check skipped)');
      }
    } finally {
      try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  // ── 2. The installer ships it ──────────────────────────────────────────────
  console.log('brand kit: the installer packages the kit and its loader');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'electron-app', 'package.json'), 'utf8'));
    const extra = ((pkg.build || {}).extraResources || []).find((r) => r && r.from === '../print-server');
    check('extraResources copies ../print-server', !!extra, JSON.stringify((pkg.build || {}).extraResources));
    const filter = (extra && extra.filter) || [];
    check('...into resources/print-server, where server.js looks for public/brand',
      extra && extra.to === 'print-server', extra && extra.to);
    check('...including public/** (the fonts and club marks)',
      filter.includes('public/**') || filter.includes('public/brand/**'), JSON.stringify(filter));
    check('...and *.js at its root (brand.js, the loader)', filter.includes('*.js'), JSON.stringify(filter));
    check('brand.js sits at the print-server root, where *.js matches it',
      fs.existsSync(path.join(REPO, 'print-server', 'brand.js')));
    check('no filter excludes the kit', !filter.some((f) => /^!/.test(f) && /public|brand|\.ttf|\.svg/.test(f)),
      JSON.stringify(filter));
  }

  // ── 3. The loader ──────────────────────────────────────────────────────────
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-brand-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-brand-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), 'FirstName,LastName\nTestkid,Sample\n');
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';
  const server = require(path.join(REPO, 'print-server', 'server.js'));
  const brand = require(path.join(REPO, 'print-server', 'brand.js'));
  const SHIPPED = brand.DEFAULT_BRAND_DIR;

  console.log('brand kit: the shipped kit loads whole');
  {
    const st = brand.status();
    check('all four label fonts loaded', st.fonts.loaded.length === 4 && st.fonts.failed.length === 0, JSON.stringify(st.fonts));
    check('...by family: Paytone One, Londrina Solid (+ Black), Figtree',
      ['Paytone One', 'Londrina Solid', 'Londrina Solid Black', 'Figtree'].every((f) => st.fonts.loaded.includes(f)));
    // The shout is named in three places that must agree: the canvas
    // registration here, the kit's tokens (what the dashboard, the phone and
    // the status window ask for) and the @font-face the pages load. A family
    // renamed in one and not the others prints the right label and draws the
    // screens in a fallback face.
    const shoutTokens = fs.readFileSync(path.join(MIRROR_DIR, 'tokens.css'), 'utf8').match(/--brand-font-display:\s*'([^']+)'/);
    const shoutJson = JSON.parse(fs.readFileSync(path.join(MIRROR_DIR, 'tokens.json'), 'utf8'));
    const shoutFaces = [...fs.readFileSync(path.join(MIRROR_DIR, 'fonts.css'), 'utf8').matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]);
    check('the shout the renderer registers is the shout the kit’s tokens name',
      !!shoutTokens && shoutTokens[1] === 'Paytone One' && brand.FONT_FILES[0].family === shoutTokens[1],
      `${shoutTokens && shoutTokens[1]} vs ${brand.FONT_FILES[0].family}`);
    check('...and the tokens.json family, and an @font-face the pages can load it from',
      JSON.stringify(shoutJson).includes('"Paytone One') && shoutFaces.includes(brand.FONT_FILES[0].family), shoutFaces.join(', '));
    check('...and the shout file is the kit’s TTF, the one fonts.css falls back to',
      brand.FONT_FILES[0].file === 'PaytoneOne-Regular.ttf'
      && fs.readFileSync(path.join(MIRROR_DIR, 'fonts.css'), 'utf8').includes('fonts/PaytoneOne-Regular.ttf'));
    check('nothing in the mirror still names the shout it replaced',
      !/galindo/i.test(fs.readdirSync(path.join(MIRROR_DIR, 'fonts')).join(' '))
      && !/galindo/i.test(['tokens.css', 'tokens.json', 'fonts.css'].map((f) => fs.readFileSync(path.join(MIRROR_DIR, f), 'utf8')).join('\n')));
    check('all six club marks loaded', st.marks.loaded.length === 6 && st.marks.failed.length === 0, JSON.stringify(st.marks));
    check('no brand warnings when the kit is whole', brand.warnings().length === 0, JSON.stringify(brand.warnings()));
    check('the shipped kit is the mirror', path.resolve(SHIPPED) === path.resolve(MIRROR_DIR));
  }

  console.log('brand kit: character coverage (the canvas leaves holes, it does not fall back)');
  {
    check('Paytone One draws a plain name', brand.fontCovers('Paytone One', 'Testkid'));
    check('Paytone One draws Latin-1 accents', brand.fontCovers('Paytone One', 'Zoë José Ñandú Çelik'));
    // What the swap from Galindo bought: these names used to fall back to the
    // old Windows face, and now print in the kit. The renderer (and the
    // wrapped custom-label cases in the golden suite) depend on it.
    check('Paytone One draws Vietnamese', brand.fontCovers('Paytone One', 'Thảo Nguyễn Thị Ấn Ễ Ọ'));
    check('Paytone One draws Ș and Ț (Romanian)', brand.fontCovers('Paytone One', 'Ștefan Țara șt țu'));
    check('Paytone One draws the Latin Extended-A names (Polish, Czech, Turkish, ...)',
      brand.fontCovers('Paytone One', 'Łukasz Žofie Şener Ğ İ Dvořák Ĳ'));
    // What it still lacks, and so still hands to the old face: every other
    // script. These are the strings the fail-open cases use, so they are
    // pinned to stay outside the character map.
    check('Paytone One has no Cyrillic', !brand.fontCovers('Paytone One', 'Дима') && !brand.fontCovers('Paytone One', 'Д'));
    check('Paytone One has no Greek (bar the few symbols Ω µ π)',
      !brand.fontCovers('Paytone One', 'Γιώργος') && brand.fontCovers('Paytone One', 'Ω µ π'));
    check('Paytone One has no CJK', !brand.fontCovers('Paytone One', '李明'));
    check('Paytone One has no Thai, Arabic or Devanagari',
      !brand.fontCovers('Paytone One', 'สวัสดี') && !brand.fontCovers('Paytone One', 'مرحبا') && !brand.fontCovers('Paytone One', 'नमस्ते'));
    check('one letter it lacks makes the whole string uncovered', !brand.fontCovers('Paytone One', 'Ana Дима'));
    check('a Latin letter it lacks (Ewe ɔ) is uncovered too', !brand.fontCovers('Paytone One', 'Kɔfi'));
    // The kit's Figtree has the combining accents but not the precomposed
    // Vietnamese letters, so a precomposed "Nguyễn" is NOT covered: the
    // shaper can often build the letter from parts, but a name never depends
    // on "often".
    check('a precomposed letter missing from the character map is not covered', !brand.fontCovers('Figtree', 'Nguy\u1EC5n'));
    check('a decomposed one whose parts are all there is', brand.fontCovers('Figtree', 'Nguye\u0302\u0303n'));
    // Paytone One has the combining circumflex and tilde (\u0302 \u0303) but
    // not the combining ring below (\u0325), so a base letter it draws can be
    // followed by an accent it does not: the split must take the two together.
    const nfd = brand.splitRuns('Paytone One', 'Ana\u0325 Nguye\u0302\u0303n');
    check('a run never separates a letter from its accent',
      nfd.every((r) => !/^[\u0300-\u036f]/.test(r.text)) && nfd.some((r) => !r.brand && r.text.includes('a\u0325')),
      JSON.stringify(nfd));
    check('...and a decomposed name whose accents it does have stays in the kit',
      brand.splitRuns('Paytone One', 'Nguye\u0302\u0303n').length === 1 && brand.fontCovers('Paytone One', 'Nguye\u0302\u0303n'));
    const keycap = brand.splitRuns('Figtree', 'Room 1\uFE0F\u20E3');
    check('...or a keycap digit from its selector',
      keycap.length === 2 && keycap[1].text === '1\uFE0F\u20E3' && keycap[1].brand === false, JSON.stringify(keycap));
    check('no font has an emoji', !brand.fontCovers('Figtree', '⭐'));
    check('every voice has the ellipsis truncation appends',
      ['Paytone One', 'Londrina Solid', 'Londrina Solid Black', 'Figtree'].every((f) => brand.fontCovers(f, '…')));
    const runs = brand.splitRuns('Figtree', '⭐ 10th club night tonight!');
    check('a mixed line splits into a fallback run and a brand run',
      runs.length === 2 && runs[0].brand === false && runs[0].text === '⭐' && runs[1].brand === true,
      JSON.stringify(runs));
    check('an unknown family covers nothing', !brand.fontCovers('Comic Sans MS', 'a'));
    check('readCmapRanges refuses garbage', brand.readCmapRanges(Buffer.from('not a font at all')) === null);
    check('readCmapRanges refuses a non-buffer', brand.readCmapRanges('x') === null);

    // Runs change face only BETWEEN words. Split letter by letter, a word the
    // kit face lacks one letter of prints as kit letters with an Arial letter
    // inside ("Nguy[ễ]n"), which reads as a misprint.
    const shape = (family, text) => brand.splitRuns(family, text).map((r) => (r.brand ? '' : '!') + r.text);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const viet = shape('Paytone One', 'Chào mừng Nguyễn Thị Thảo');
    check('Vietnamese is now one run in the kit (Galindo had to hand every accented word over)',
      same(viet, ['Chào mừng Nguyễn Thị Thảo']), JSON.stringify(viet));
    const ro = shape('Paytone One', 'Bun venit, Ștefan!');
    check('...so is a Romanian name', same(ro, ['Bun venit, Ștefan!']), JSON.stringify(ro));
    const ewe = shape('Paytone One', 'Akwaaba Kɔfi Mensah');
    check('a word with a Latin letter the kit face lacks (ɔ) goes to the old face whole, its neighbours stay',
      same(ewe, ['Akwaaba ', '!Kɔfi', ' Mensah']), JSON.stringify(ewe));
    const mixed = shape('Paytone One', 'Welcome Дмитрий and Γιώργος, Anna');
    check('...and so does a word in a script the kit does not have at all',
      same(mixed, ['Welcome ', '!Дмитрий', ' and ', '!Γιώργος', ', Anna']), JSON.stringify(mixed));
    const cyr = shape('Paytone One', 'Добро пожаловать');
    check('...a line with nothing in the kit is all old face, word by word', same(cyr, ['!Добро', ' ', '!пожаловать']), JSON.stringify(cyr));
    const small = shape('Figtree', 'Gặp cô Nguyễn ở phòng 4');
    check('a small Figtree line splits at words as well',
      same(small, ['!Gặp', ' cô ', '!Nguyễn', ' ', '!ở', ' phòng 4']), JSON.stringify(small));
    const apos = shape('Figtree', 'O’Brien’s ⭐ table');
    check('an apostrophe inside a name stays in its word; an emoji is a unit of its own',
      same(apos, ['O’Brien’s ', '!⭐', ' table']), JSON.stringify(apos));
    const glued = shape('Figtree', 'Hi👋there');
    check('...even with no space around it', same(glued, ['Hi', '!👋', 'there']), JSON.stringify(glued));
  }

  // A font file that is cut short or corrupted is refused BEFORE the canvas
  // sees it. The canvas registers such a file, reports the family as present
  // and then draws every glyph empty (measured with the kit's previous shout
  // font, Galindo, cut to anywhere
  // from ~10% to ~60% of its length: the child's name printed blank while
  // /health said the fonts were fine), so a damaged face can never be let
  // through to be "used".
  console.log('brand kit: a damaged font file is refused before it is registered');
  {
    const FONT_DIR = path.join(SHIPPED, 'fonts');
    for (const { family, file } of brand.FONT_FILES) {
      const real = fs.readFileSync(path.join(FONT_DIR, file));
      check(`${family}: the shipped file is whole`, brand.fontFileProblem(real) === null, brand.fontFileProblem(real));
      const cutsLetThrough = [];
      for (let pct = 2; pct < 100; pct += 2) {
        const cut = Math.floor(real.length * pct / 100);
        if (brand.fontFileProblem(real.subarray(0, cut)) === null) cutsLetThrough.push(`${pct}%`);
      }
      if (brand.fontFileProblem(real.subarray(0, real.length - 4)) === null) cutsLetThrough.push('all but 4 bytes');
      check(`${family}: cut short anywhere, it is refused`, cutsLetThrough.length === 0, cutsLetThrough.join(', '));
      const zeroTail = Buffer.from(real);
      zeroTail.fill(0, Math.floor(real.length / 3));
      check(`${family}: full length with a zeroed tail, it is refused`, brand.fontFileProblem(zeroTail) !== null);
      // One changed byte in the middle of every table, and in the table
      // directory itself (a renamed table), is caught.
      const tables = [];
      for (let i = 0; i < real.readUInt16BE(4); i++) {
        const rec = 12 + i * 16;
        tables.push({ tag: real.toString('latin1', rec, rec + 4), rec, offset: real.readUInt32BE(rec + 8), length: real.readUInt32BE(rec + 12) });
      }
      const flipsLetThrough = [];
      for (const t of tables) {
        const bad = Buffer.from(real);
        bad[t.offset + Math.floor(t.length / 2)] ^= 0x5A;
        if (brand.fontFileProblem(bad) === null) flipsLetThrough.push(t.tag);
        const renamed = Buffer.from(real);
        renamed[t.rec] ^= 0x20;
        if (brand.fontFileProblem(renamed) === null) flipsLetThrough.push(`${t.tag} renamed`);
      }
      check(`${family}: one changed byte in any table, or a renamed table, is refused`,
        tables.length >= 10 && flipsLetThrough.length === 0, flipsLetThrough.join(', '));
    }
    check('a captive portal page is not a font file',
      brand.fontFileProblem(Buffer.from('<html>captive portal</html>')) === 'not a font file');
    check('nothing at all is not a font file', brand.fontFileProblem(Buffer.alloc(0)) === 'not a font file'
      && brand.fontFileProblem(null) === 'not a font file');
  }

  console.log('brand kit: SVG sizing for the canvas');
  {
    const sized = brand.svgAtSize('<svg xmlns="http://www.w3.org/2000/svg" width="76.375" height="24.5" viewBox="0 0 76.375 24.5"><path d="M0 0H1V1Z"/></svg>', 768);
    check('the root is re-sized to the long side, the viewBox kept',
      /<svg width="768\.000" height="246\.363"/.test(sized) && /viewBox="0 0 76\.375 24\.5"/.test(sized), sized && sized.slice(0, 120));
    const vbOnly = brand.svgAtSize('<svg viewBox="0 0 10 20"><g/></svg>', 100);
    check('a viewBox-only SVG takes its size from the viewBox', /width="50\.000" height="100\.000"/.test(vbOnly), vbOnly);
    const noVb = brand.svgAtSize('<svg width="10" height="5"></svg>', 100);
    check('an SVG without a viewBox gets one, so it scales', /viewBox="0 0 10 5"/.test(noVb) && /width="100\.000"/.test(noVb), noVb);
    check('not an SVG: null', brand.svgAtSize('<html></html>', 100) === null);
    check('an SVG with no size: null', brand.svgAtSize('<svg><g/></svg>', 100) === null);
    check('a non-string: null', brand.svgAtSize(null, 100) === null);
  }

  // Broken kits, the way installs actually break.
  const kit = (name, build) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), `awana-brand-${name}-`));
    build(d);
    return d;
  };
  const cp = (d, sub) => fs.cpSync(path.join(SHIPPED, sub), path.join(d, sub), { recursive: true });
  const KITS = {
    missing: path.join(os.tmpdir(), `awana-brand-nowhere-${process.pid}`),
    empty: kit('empty', () => {}),
    corruptFonts: kit('corrupt-fonts', (d) => {
      cp(d, 'logos');
      fs.mkdirSync(path.join(d, 'fonts'));
      const real = fs.readFileSync(path.join(SHIPPED, 'fonts', 'PaytoneOne-Regular.ttf'));
      fs.writeFileSync(path.join(d, 'fonts', 'PaytoneOne-Regular.ttf'), real.subarray(0, 300));     // truncated download
      fs.writeFileSync(path.join(d, 'fonts', 'LondrinaSolid-Regular.ttf'), Buffer.from('<html>captive portal</html>'));
      fs.writeFileSync(path.join(d, 'fonts', 'LondrinaSolid-Black.ttf'), Buffer.alloc(0));           // empty
      fs.copyFileSync(path.join(SHIPPED, 'fonts', 'Figtree-Variable.ttf'), path.join(d, 'fonts', 'Figtree-Variable.ttf'));
    }),
    // Damaged, not missing: the files are there, their character maps read,
    // and the canvas would register them. Paytone One is cut in the middle of
    // its glyph table (32000 of its 114648 bytes; the table runs from 10200 to
    // 70102, and the cmap at 3228 is still whole, so it looks loaded), Figtree
    // cut at 40%, Londrina Solid Black corrupted inside its glyph table at
    // full length. Londrina Solid is whole.
    damagedFonts: kit('damaged-fonts', (d) => {
      cp(d, 'logos');
      fs.mkdirSync(path.join(d, 'fonts'));
      const read = (f) => fs.readFileSync(path.join(SHIPPED, 'fonts', f));
      fs.writeFileSync(path.join(d, 'fonts', 'PaytoneOne-Regular.ttf'), read('PaytoneOne-Regular.ttf').subarray(0, 32000));
      const fig = read('Figtree-Variable.ttf');
      fs.writeFileSync(path.join(d, 'fonts', 'Figtree-Variable.ttf'), fig.subarray(0, Math.floor(fig.length * 0.4)));
      const black = Buffer.from(read('LondrinaSolid-Black.ttf'));
      for (let i = 0; i < black.readUInt16BE(4); i++) {
        const rec = 12 + i * 16;
        if (black.toString('latin1', rec, rec + 4) !== 'glyf') continue;
        const at = black.readUInt32BE(rec + 8);
        const len = black.readUInt32BE(rec + 12);
        for (let k = at + Math.floor(len / 4); k < at + Math.floor(len / 2); k += 7) black[k] ^= 0x55;
      }
      fs.writeFileSync(path.join(d, 'fonts', 'LondrinaSolid-Black.ttf'), black);
      fs.copyFileSync(path.join(SHIPPED, 'fonts', 'LondrinaSolid-Regular.ttf'), path.join(d, 'fonts', 'LondrinaSolid-Regular.ttf'));
    }),
    // What every missing font prints: the marks, and no fonts at all.
    marksOnly: kit('marks-only', (d) => cp(d, 'logos')),
    brokenMarks: kit('broken-marks', (d) => {
      cp(d, 'fonts');
      fs.mkdirSync(path.join(d, 'logos'));
      fs.writeFileSync(path.join(d, 'logos', 'sparks-black.svg'), 'this is not an svg');
      // Parses as an SVG with a size, but draws nothing: only the renderer can
      // find that out, and it must fall back AND report it.
      fs.writeFileSync(path.join(d, 'logos', 'trek-black.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
      fs.copyFileSync(path.join(SHIPPED, 'logos', 'journey-black.svg'), path.join(d, 'logos', 'journey-black.svg'));
    }),
  };

  const render = async (model) => {
    const r = await server.generateLabel(model);
    if (r.pngPath) fs.unlink(r.pngPath, () => {});
    return r.buffer;
  };
  const isLabelPng = (buf) => Buffer.isBuffer(buf) && buf.length > 1000 && buf[0] === 0x89 && buf[1] === 0x50
    && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 600;
  const LABELS = [
    { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', allergyTokens: ['NUTS'], isBirthday: true, birthdayAge: 7, noPhoto: true },
    { firstName: 'Testkid', lastName: 'Sample', clubName: 'Trek', isVisitor: true, extras: { inverted: true, milestoneLine: '⭐ 10th club night tonight!' } },
    { firstName: 'Pat', lastName: 'Sample', clubName: 'Journey', isLeader: true, greeting: 'Journey Leader', template: { showClubLine: false } },
    { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', stepUp: true, stepUpNextClub: 'T&T', testBanner: true },
    { customText: 'VOLUNTEER' },
  ];

  console.log('brand kit: every broken kit still prints every kind of label');
  for (const [name, dir] of Object.entries(KITS)) {
    let st;
    try { st = brand.loadBrandKit(dir); } catch (e) { st = null; check(`${name}: loading never throws`, false, e.message); }
    if (!st) continue;
    for (const [i, model] of LABELS.entries()) {
      let buf = null;
      try { buf = await render(model); } catch (e) { check(`${name}: label ${i} renders`, false, e.message); continue; }
      check(`${name}: label ${i} is a real 1200x600 PNG`, isLabelPng(buf));
    }
    if (name === 'missing' || name === 'empty') {
      check(`${name}: every font reported failed, as "file missing"`,
        st.fonts.failed.length === 4 && Object.values(st.fonts.reasons).every((r) => r === 'file missing'), JSON.stringify(st.fonts));
      check(`${name}: every mark reported failed`, st.marks.failed.length === 6, JSON.stringify(st.marks));
    }
    if (name === 'corruptFonts') {
      check('corrupt fonts: the three bad files fail, each with a reason',
        ['Paytone One', 'Londrina Solid', 'Londrina Solid Black'].every((f) => st.fonts.failed.includes(f) && st.fonts.reasons[f]),
        JSON.stringify(st.fonts));
      check('corrupt fonts: the good one still loads', st.fonts.loaded.includes('Figtree'), JSON.stringify(st.fonts));
      check('corrupt fonts: a font that failed is never asked for', !brand.fontCovers('Paytone One', 'Testkid'));
      check('corrupt fonts: the marks are unaffected', st.marks.loaded.length === 6, JSON.stringify(st.marks));
    }
    if (name === 'damagedFonts') {
      const damaged = ['Paytone One', 'Figtree', 'Londrina Solid Black'];
      check('damaged fonts: each damaged file is reported failed, as a damaged font file',
        damaged.every((f) => st.fonts.failed.includes(f) && st.fonts.reasons[f] === 'damaged font file'), JSON.stringify(st.fonts));
      check('damaged fonts: the whole one still loads', st.fonts.loaded.includes('Londrina Solid'), JSON.stringify(st.fonts));
      check('damaged fonts: the renderer is never told a damaged face can draw a name',
        !brand.fontReady('Paytone One') && !brand.fontCovers('Paytone One', 'Testkid') && !brand.fontCovers('Figtree', 'Sample'));
      const w = brand.warnings().find((x) => x.type === 'brandFonts');
      check('damaged fonts: /health gets the fonts warning, naming them',
        !!w && damaged.every((f) => w.message.includes(`${f} (damaged font file)`)), JSON.stringify(brand.warnings()));
    }
    if (name === 'brokenMarks') {
      check('broken marks: a non-SVG fails at load', st.marks.failed.includes('spark') && /not an SVG/.test(st.marks.reasons.spark), JSON.stringify(st.marks));
      check('broken marks: a missing one fails at load', st.marks.failed.includes('puggle') && st.marks.reasons.puggle === 'file missing');
      check('broken marks: the good one loads', st.marks.loaded.includes('journey'));
      check('broken marks: the empty drawing loads (only drawing it can tell)', st.marks.loaded.includes('trek'));
      const after = brand.status();
      check('broken marks: drawing the empty mark fell back AND reported it',
        after.marks.failed.includes('trek') && /no printable ink/.test(after.marks.reasons.trek), JSON.stringify(after.marks));
    }
  }

  // A damaged font prints exactly what a missing one does: the old Windows
  // face, with real ink, never a blank name. Byte-identical to the same label
  // on a kit with no fonts at all (these labels draw nothing in Londrina
  // Solid, the one font the damaged kit still has: a drawn mark suppresses the
  // club line), so this holds on any machine's fonts.
  {
    const same = [
      ['a Sparks child', { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16' }],
      ['a demo label (the TEST band)', { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', testBanner: true }],
      ['a custom label', { customText: 'VOLUNTEER' }],
    ];
    for (const [what, model] of same) {
      brand.loadBrandKit(KITS.damagedFonts);
      const damaged = await render(model);
      brand.loadBrandKit(KITS.marksOnly);
      const missing = await render(model);
      check(`damaged fonts: ${what} prints exactly as with the fonts missing`,
        Buffer.isBuffer(damaged) && Buffer.compare(damaged, missing) === 0);
    }
    brand.loadBrandKit(SHIPPED);
  }

  // The monogram really is what a label without its mark gets: the Sparks
  // label on the broken kit must differ from the same label on the shipped one.
  {
    const model = { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks' };
    brand.loadBrandKit(KITS.brokenMarks);
    const fallback = await render(model);
    brand.loadBrandKit(SHIPPED);
    const withMark = await render(model);
    check('a label whose mark failed is not the label with its mark', Buffer.compare(fallback, withMark) !== 0);
    check('back on the shipped kit, everything loads again',
      brand.status().fonts.failed.length === 0 && brand.status().marks.failed.length === 0, JSON.stringify(brand.status()));
  }

  // ── 4. /health says so ─────────────────────────────────────────────────────
  console.log('brand kit: /health reports it, as data and as {type, message} warnings');
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) resolve(); else listener.once('listening', resolve); });
  const health = async () => {
    const res = await fetch(`${BASE}/health`);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  try {
    const ok = await health();
    check('/health answers', ok.status === 200 && ok.body && ok.body.status === 'ok', JSON.stringify(ok.body).slice(0, 200));
    const b = ok.body || {};
    check('fonts: {loaded, failed} on a whole kit',
      b.fonts && Array.isArray(b.fonts.loaded) && b.fonts.loaded.length === 4 && Array.isArray(b.fonts.failed) && b.fonts.failed.length === 0,
      JSON.stringify(b.fonts));
    check('clubMarks: all six loaded', b.clubMarks && b.clubMarks.loaded.length === 6 && b.clubMarks.failed.length === 0,
      JSON.stringify(b.clubMarks));
    check('no brand warning on a whole kit',
      !(b.warnings || []).some((w) => w && /^brand/.test(w.type)), JSON.stringify(b.warnings));

    brand.loadBrandKit(KITS.empty);
    const bad = await health();
    const bb = bad.body || {};
    check('fonts.failed names every font when the kit is gone',
      bb.fonts && bb.fonts.failed.length === 4 && bb.fonts.loaded.length === 0, JSON.stringify(bb.fonts));
    const brandWarnings = (bb.warnings || []).filter((w) => w && /^brand/.test(w.type));
    check('two brand warnings: fonts and marks',
      brandWarnings.map((w) => w.type).sort().join(',') === 'brandFonts,brandMarks', JSON.stringify(brandWarnings));
    check('every brand warning is a {type, message} object with real text',
      brandWarnings.every((w) => typeof w.type === 'string' && typeof w.message === 'string' && w.message.length > 40),
      JSON.stringify(brandWarnings));
    check('the font warning says labels still print', brandWarnings.some((w) => w.type === 'brandFonts' && /still print/.test(w.message)));
    const text = JSON.stringify({ f: bb.fonts, m: bb.clubMarks, w: brandWarnings });
    check('no file path reaches /health (it is CORS-readable; the kit sits under the Windows profile)',
      !text.includes(KITS.empty) && !text.includes(os.tmpdir()) && !text.includes(SHIPPED) && !/[\\/][a-z0-9_-]+[\\/]/i.test(text), text);

    brand.loadBrandKit(KITS.damagedFonts);
    const dmg = (await health()).body || {};
    check('/health reports damaged fonts as failed, with the reason',
      dmg.fonts && dmg.fonts.failed.includes('Paytone One') && dmg.fonts.reasons && dmg.fonts.reasons['Paytone One'] === 'damaged font file'
      && dmg.fonts.loaded.includes('Londrina Solid'), JSON.stringify(dmg.fonts));
    check('...and warns about them as a {type, message} object',
      (dmg.warnings || []).some((w) => w && w.type === 'brandFonts' && typeof w.message === 'string' && /Paytone One \(damaged font file\)/.test(w.message)),
      JSON.stringify(dmg.warnings));
    brand.loadBrandKit(KITS.empty);

    const prev = await fetch(`${BASE}/preview?firstName=Smoke&lastName=Test&clubName=Sparks`);
    const png = Buffer.from(await prev.arrayBuffer());
    check('/preview still renders with the kit gone', prev.status === 200 && isLabelPng(png), `status ${prev.status}`);
  } finally {
    brand.loadBrandKit(SHIPPED);
    listener.close();
  }

  for (const d of [KITS.empty, KITS.corruptFonts, KITS.damagedFonts, KITS.marksOnly, KITS.brokenMarks, dataDir, binDir]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

main().then(() => {
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('\nharness error:', err);
  process.exit(1);
});
