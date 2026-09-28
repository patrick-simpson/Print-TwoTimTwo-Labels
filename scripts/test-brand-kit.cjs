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
const { MIRROR_DIR, MANIFEST_FILE, REPO, hashTree, parseManifest } = require('./brand-manifest.cjs');

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
      && pinned.has('tokens.json') && pinned.has('fonts/Galindo-Regular.ttf') && pinned.has('logos/sparks-black.svg'),
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
    check('...by family: Galindo, Londrina Solid (+ Black), Figtree',
      ['Galindo', 'Londrina Solid', 'Londrina Solid Black', 'Figtree'].every((f) => st.fonts.loaded.includes(f)));
    check('all six club marks loaded', st.marks.loaded.length === 6 && st.marks.failed.length === 0, JSON.stringify(st.marks));
    check('no brand warnings when the kit is whole', brand.warnings().length === 0, JSON.stringify(brand.warnings()));
    check('the shipped kit is the mirror', path.resolve(SHIPPED) === path.resolve(MIRROR_DIR));
  }

  console.log('brand kit: character coverage (the canvas leaves holes, it does not fall back)');
  {
    check('Galindo draws a plain name', brand.fontCovers('Galindo', 'Testkid'));
    check('Galindo draws Latin-1 accents', brand.fontCovers('Galindo', 'Zoë José Ñandú Çelik'));
    check('Galindo has no Vietnamese', !brand.fontCovers('Galindo', 'Thảo'));
    check('Galindo has no Ș (Romanian)', !brand.fontCovers('Galindo', 'Ștefan'));
    check('Galindo has no CJK', !brand.fontCovers('Galindo', '李明'));
    // The kit's Figtree has the combining accents but not the precomposed
    // Vietnamese letters, so a precomposed "Nguyễn" is NOT covered: the
    // shaper can often build the letter from parts, but a name never depends
    // on "often".
    check('a precomposed letter missing from the character map is not covered', !brand.fontCovers('Figtree', 'Nguy\u1EC5n'));
    check('a decomposed one whose parts are all there is', brand.fontCovers('Figtree', 'Nguye\u0302\u0303n'));
    const nfd = brand.splitRuns('Galindo', 'Nguye\u0302\u0303n');
    check('a run never separates a letter from its accent',
      nfd.every((r) => !/^[\u0300-\u036f]/.test(r.text)), JSON.stringify(nfd));
    const keycap = brand.splitRuns('Figtree', 'Room 1\uFE0F\u20E3');
    check('...or a keycap digit from its selector',
      keycap.length === 2 && keycap[1].text === '1\uFE0F\u20E3' && keycap[1].brand === false, JSON.stringify(keycap));
    check('no font has an emoji', !brand.fontCovers('Figtree', '⭐'));
    check('every voice has the ellipsis truncation appends',
      ['Galindo', 'Londrina Solid', 'Londrina Solid Black', 'Figtree'].every((f) => brand.fontCovers(f, '…')));
    const runs = brand.splitRuns('Figtree', '⭐ 10th club night tonight!');
    check('a mixed line splits into a fallback run and a brand run',
      runs.length === 2 && runs[0].brand === false && runs[0].text === '⭐' && runs[1].brand === true,
      JSON.stringify(runs));
    check('an unknown family covers nothing', !brand.fontCovers('Comic Sans MS', 'a'));
    check('readCmapRanges refuses garbage', brand.readCmapRanges(Buffer.from('not a font at all')) === null);
    check('readCmapRanges refuses a non-buffer', brand.readCmapRanges('x') === null);
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
      const real = fs.readFileSync(path.join(SHIPPED, 'fonts', 'Galindo-Regular.ttf'));
      fs.writeFileSync(path.join(d, 'fonts', 'Galindo-Regular.ttf'), real.subarray(0, 300));        // truncated download
      fs.writeFileSync(path.join(d, 'fonts', 'LondrinaSolid-Regular.ttf'), Buffer.from('<html>captive portal</html>'));
      fs.writeFileSync(path.join(d, 'fonts', 'LondrinaSolid-Black.ttf'), Buffer.alloc(0));           // empty
      fs.copyFileSync(path.join(SHIPPED, 'fonts', 'Figtree-Variable.ttf'), path.join(d, 'fonts', 'Figtree-Variable.ttf'));
    }),
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
        ['Galindo', 'Londrina Solid', 'Londrina Solid Black'].every((f) => st.fonts.failed.includes(f) && st.fonts.reasons[f]),
        JSON.stringify(st.fonts));
      check('corrupt fonts: the good one still loads', st.fonts.loaded.includes('Figtree'), JSON.stringify(st.fonts));
      check('corrupt fonts: a font that failed is never asked for', !brand.fontCovers('Galindo', 'Testkid'));
      check('corrupt fonts: the marks are unaffected', st.marks.loaded.length === 6, JSON.stringify(st.marks));
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

    const prev = await fetch(`${BASE}/preview?firstName=Smoke&lastName=Test&clubName=Sparks`);
    const png = Buffer.from(await prev.arrayBuffer());
    check('/preview still renders with the kit gone', prev.status === 200 && isLabelPng(png), `status ${prev.status}`);
  } finally {
    brand.loadBrandKit(SHIPPED);
    listener.close();
  }

  for (const d of [KITS.empty, KITS.corruptFonts, KITS.brokenMarks, dataDir, binDir]) {
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
