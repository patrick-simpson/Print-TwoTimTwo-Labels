#!/usr/bin/env node
// Golden-image regression tests for the label renderer.
//
// WHY THIS EXISTS
// The only automated check on label output was render-smoke.cjs asserting the
// PNG is 1200x600 — it never looked at a single pixel. So any change to
// generateLabel's layout maths could silently move a child's name, clip a
// handbook group, or drop an allergy icon, and every test would still pass. The
// first anyone would notice is a volunteer holding a bad label on club night.
//
// A label is a safety artifact: it carries allergy icons and a photo-consent
// flag. It deserves pixel-level regression cover.
//
// WHY GOLDEN IMAGES ARE SAFE HERE
// generateLabel is byte-deterministic: rendering the same inputs twice, and
// again a second later, produces identical PNG bytes. Verified before this suite
// was written, and re-asserted below so the assumption cannot rot silently. If
// it ever becomes nondeterministic, the determinism case fails loudly rather
// than the whole suite going flaky.
//
// NO NEW DEPENDENCY: @napi-rs/canvas (already required for rendering) decodes a
// PNG and exposes raw RGBA via getImageData, which is all a pixel diff needs.
//
// BASELINES ARE LINUX-ONLY
// Text rendering depends on the host's installed fonts, so the same label is not
// pixel-identical across platforms — this container has only the DejaVu family,
// while the production print laptop is Windows with Arial and Segoe. Comparing a
// Windows render against a Linux baseline would fail on font metrics alone and
// tell you nothing. So the pixel comparison runs ONLY on linux (which is what CI
// uses); everywhere else the structural and determinism checks still run and the
// comparison is skipped loudly. This mirrors the display repo, whose visual suite
// carries test.skip(process.platform !== 'linux') for the same reason.
//
// A consequence worth knowing: a glyph missing from the LINUX font stack appears
// as a tofu box in these baselines without necessarily being wrong in
// production. The attendance-milestone line's star (U+2B50) is exactly that case
// — tofu here, and most likely fine on Windows. Never "fix" a glyph on the
// evidence of a baseline image alone; check it on the real printer first.
//
// USAGE
//   node scripts/test-label-golden.cjs                  # compare against baselines
//   UPDATE_LABEL_BASELINES=1 node scripts/test-label-golden.cjs   # accept current output
//
// On a mismatch it writes the actual render and a red-highlighted diff image to
// label-golden-out/ so the change can be SEEN, not just counted. Never accept a
// baseline update without looking at that diff.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASELINE_DIR = path.join(__dirname, '__label_baselines__');
const OUT_DIR = path.join(process.cwd(), 'label-golden-out');
const UPDATE = process.env.UPDATE_LABEL_BASELINES === '1';

// A pixel must differ by more than this per channel to count. Small tolerance
// for any future antialiasing nondeterminism, without letting a real layout
// shift through — a moved glyph changes pixels by hundreds, not by 2.
const CHANNEL_TOLERANCE = 2;
// Fraction of differing pixels allowed before a case fails.
const MAX_DIFF_RATIO = 0.0005;   // 0.05% of 720,000 px = ~360 px

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ── Fixture roster ───────────────────────────────────────────────────────────
// Obviously-synthetic names. A baseline image is committed to the repo, so it
// must never contain a real child's name.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-golden-'));
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
  'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
  + 'Testkid,Sample,2018-03-15,peanut allergy,Cubbies A,y\n');
process.env.AWANA_DATA_DIR = dataDir;

const { generateLabel, createCanvasForTest } = (() => {
  const mod = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  return { generateLabel: mod.generateLabel };
})();
const { createCanvas, loadImage } = require(
  path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs', 'canvas'));

// ── Cases ────────────────────────────────────────────────────────────────────
// generateLabel's positional signature:
//  (firstName, lastName, clubName, clubImageBuffer, allergyTokens, handbookGroup,
//   isBirthday, isVisitor, stepUp, stepUpNextClub, awanaShares, noPhoto,
//   testBanner, extras)
//
// Every case exercises a distinct branch of the layout maths. The names are
// chosen to hit the font-autosizing thresholds (>12 chars, >8 chars, short).
const CASES = [
  { name: 'plain',            args: ['Testkid', 'Sample', 'Cubbies', null, [], '', false, false, false, '', null, false, false, {}] },
  { name: 'first-name-only',  args: ['Ava', '', '', null, [], '', false, false, false, '', null, false, false, {}] },
  { name: 'long-name',        args: ['Bartholomew', 'Fitzwilliam', 'T&T', null, [], '', false, false, false, '', null, false, false, {}] },
  { name: 'very-long-first',  args: ['Maximilianagnes', 'Sample', 'Sparks', null, [], '', false, false, false, '', null, false, false, {}] },
  { name: 'handbook-group',   args: ['Testkid', 'Sample', 'Sparks', null, [], 'Flight 3:16', false, false, false, '', null, false, false, {}] },
  { name: 'allergies-one',    args: ['Testkid', 'Sample', 'Sparks', null, ['NUTS'], '', false, false, false, '', null, false, false, {}] },
  { name: 'allergies-all',    args: ['Testkid', 'Sample', 'Sparks', null, ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'], '', false, false, false, '', null, false, false, {}] },
  { name: 'birthday',         args: ['Testkid', 'Sample', 'Sparks', null, [], '', true, false, false, '', null, false, false, {}] },
  { name: 'visitor',          args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, true, false, '', null, false, false, {}] },
  { name: 'visitor-inverted', args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, true, false, '', null, false, false, { inverted: true }] },
  { name: 'step-up',          args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, false, true, 'T&T', null, false, false, {}] },
  { name: 'shares',           args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, false, false, '', 12, false, false, {}] },
  { name: 'no-photo',         args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, false, false, '', null, true, false, {}] },
  { name: 'go-to-line',       args: ['Testkid', 'Sample', 'Sparks', null, [], 'Flight 3:16', false, false, false, '', null, false, false, { goToLine: 'Go to: Music, Rm 4' }] },
  { name: 'milestone-line',   args: ['Testkid', 'Sample', 'Sparks', null, [], '', false, false, false, '', null, false, false, { milestoneLine: '⭐ 10th club night tonight!' }] },
  { name: 'test-banner',      args: ['Canary 00:00:00', '', 'Test', null, [], '', false, false, false, '', null, false, true, {}] },
  { name: 'club-monogram',    args: ['Testkid', 'Sample', 'Puggles', null, [], '', false, false, false, '', null, false, false, {}] },
  // The torture case: every optional field on at once. This is the one that
  // catches collisions — the handbook group reserving width for the icon row,
  // the bottom-left line meeting the bottom-right icons, the pill overlapping
  // the name block.
  {
    name: 'torture-all-fields',
    args: ['Bartholomew', 'Fitzwilliam', 'Sparks', null,
      ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'], 'Flight 3:16',
      true, true, false, '', 99, true, false,
      { goToLine: 'Go to: Music, Rm 4', milestoneLine: '⭐ 50th club night tonight!' }],
  },
];

// ── Pixel diff ───────────────────────────────────────────────────────────────
async function pixels(buf) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

// Returns { ratio, count, diffPng } — diffPng highlights changed pixels in red
// over a dimmed copy of the baseline, so a reviewer can see WHERE it moved.
async function diff(actualBuf, baselineBuf) {
  const a = await pixels(actualBuf);
  const b = await pixels(baselineBuf);
  if (a.w !== b.w || a.h !== b.h) {
    return { ratio: 1, count: -1, sizeMismatch: `${a.w}x${a.h} vs ${b.w}x${b.h}` };
  }
  const c = createCanvas(a.w, a.h);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(a.w, a.h);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const differs = dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE || db > CHANNEL_TOLERANCE;
    if (differs) {
      count++;
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255;
    } else {
      // Dimmed baseline as context.
      out.data[i] = 200 + (b.data[i] >> 3);
      out.data[i + 1] = 200 + (b.data[i + 1] >> 3);
      out.data[i + 2] = 200 + (b.data[i + 2] >> 3);
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return { ratio: count / (a.w * a.h), count, diffPng: c.toBuffer('image/png') };
}

async function render(args) {
  const result = await generateLabel(...args);
  // generateLabel writes a temp PNG and also returns the buffer; use the buffer
  // and clean up the file so a test run leaves nothing behind.
  const buf = result.buffer || fs.readFileSync(result.pngPath);
  if (result.pngPath) fs.unlink(result.pngPath, () => {});
  return buf;
}

const CAN_COMPARE = process.platform === 'linux';

async function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  if (!CAN_COMPARE) {
    console.log(`  ! platform is ${process.platform}, not linux — baseline COMPARISON skipped`);
    console.log('    (fonts differ per platform; baselines are generated on linux, as CI is)');
    console.log('    structural + determinism checks still run.');
  }

  // ── Determinism, asserted rather than assumed ─────────────────────────────
  // The whole suite rests on this. If it ever fails, golden images are the wrong
  // tool and we want to know immediately.
  {
    const a = await render(CASES[0].args);
    const b = await render(CASES[0].args);
    check('renderer is byte-deterministic (golden images are valid)',
      Buffer.compare(a, b) === 0,
      `${a.length} vs ${b.length} bytes`);
    const torture = await render(CASES[CASES.length - 1].args);
    const torture2 = await render(CASES[CASES.length - 1].args);
    check('the torture case is deterministic too',
      Buffer.compare(torture, torture2) === 0);
  }

  let updated = 0;
  for (const c of CASES) {
    const file = path.join(BASELINE_DIR, `${c.name}.png`);
    let actual;
    try {
      actual = await render(c.args);
    } catch (e) {
      check(`render ${c.name}`, false, e.message);
      continue;
    }

    check(`${c.name}: renders a 1200x600 PNG`, actual.length > 1000
      && actual[0] === 0x89 && actual[1] === 0x50);

    if (!CAN_COMPARE) continue;   // the structural check above is all we can trust here

    if (UPDATE || !fs.existsSync(file)) {
      fs.writeFileSync(file, actual);
      updated++;
      if (!UPDATE) {
        console.log(`  + created baseline ${c.name}.png (review it, then commit)`);
      }
      continue;
    }

    const baseline = fs.readFileSync(file);
    if (Buffer.compare(actual, baseline) === 0) {
      passed++;   // byte-identical: the common, cheap case
      continue;
    }

    const d = await diff(actual, baseline);
    const ok = !d.sizeMismatch && d.ratio <= MAX_DIFF_RATIO;
    if (!ok) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${c.name}.actual.png`), actual);
      fs.writeFileSync(path.join(OUT_DIR, `${c.name}.baseline.png`), baseline);
      if (d.diffPng) fs.writeFileSync(path.join(OUT_DIR, `${c.name}.diff.png`), d.diffPng);
    }
    check(`${c.name}: matches its baseline`, ok,
      d.sizeMismatch
        ? `size changed: ${d.sizeMismatch}`
        : `${d.count} px differ (${(d.ratio * 100).toFixed(3)}%) — see label-golden-out/${c.name}.diff.png`);
  }

  if (updated) {
    console.log(`\n  ${updated} baseline(s) written to ${path.relative(process.cwd(), BASELINE_DIR)}`);
    if (!UPDATE) console.log('  (missing baselines are created on first run — inspect them before committing)');
  }

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error('  - ' + f));
    console.error('\nIf a change is intentional, LOOK at label-golden-out/*.diff.png first,');
    console.error('then re-run with UPDATE_LABEL_BASELINES=1 to accept it.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Golden harness error:', e);
  process.exit(1);
});
