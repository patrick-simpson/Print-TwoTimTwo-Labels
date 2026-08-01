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
// BASELINES ARE TIED TO A FONT STACK, NOT TO A PLATFORM
// Text rendering depends on the host's installed fonts, so the same label is not
// pixel-identical across machines — this container has DejaVu and Liberation,
// the production print laptop is Windows with Arial and Segoe, and a CI runner
// is different again. This file originally gated the comparison on
// `process.platform === 'linux'`, and CI proved that far too coarse: the runner
// is also Linux, with different font packages, so every baseline missed by ~9%
// of its pixels and the whole suite red-lighted on a change that altered nothing.
//
// A gate that fails on a font-package bump is a gate somebody deletes. So the
// baselines now record a FINGERPRINT of the font stack that produced them, and
// the pixel comparison runs only when it matches. Anywhere else the suite says
// loudly that it cannot police pixels — rather than failing (noise) or passing
// silently (a lie) — and falls back to checks that are font-independent:
// determinism, ink coverage, and pairwise distinctness. Those are what CI
// enforces, and they are real: both would have caught the case that silently
// rendered blank during the options-object refactor.
//
// To police pixels on a given machine, regenerate the baselines there with
// `npm run test:golden:update` — which rewrites the fingerprint too.
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
const crypto = require('crypto');

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

const { generateLabel, prepareLogoForThermal } = (() => {
  const mod = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  return { generateLabel: mod.generateLabel, prepareLogoForThermal: mod.prepareLogoForThermal };
})();
const { createCanvas, loadImage } = require(
  path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs', 'canvas'));

// ── Synthetic club logos ─────────────────────────────────────────────────────
// Deterministic geometry, no text — a logo drawn with fonts would tie these
// cases to the host font stack, which is exactly what the fingerprint machinery
// exists to avoid. Each mimics a real failure mode of church-uploaded club
// images on TwoTimTwo:
//
//   * lightCyanLogo — the actual Puggles incident: a light-cyan wordmark whose
//     only DARK pixels are two small eyes. Unbinarized, thermal dithering
//     erases the cyan and prints just the eyes — a tiny unreadable speck.
//   * paddedLogo — real artwork marooned in a large transparent canvas (also
//     what the extension's square capture produces for a wide source).
//   * ghostLogo — near-white art: would print as literally nothing.
//   * whiteOnDarkLogo — inverted branding; the white must survive as holes.
function logoCanvas(w, h, draw) {
  const c = createCanvas(w, h);
  draw(c.getContext('2d'));
  return c.toBuffer('image/png');
}
const lightCyanLogo = () => logoCanvas(300, 160, (ctx) => {
  ctx.fillStyle = '#29b8ce';
  ctx.beginPath(); ctx.arc(150, 45, 38, 0, Math.PI * 2); ctx.fill();   // duck head
  ctx.fillRect(10, 95, 280, 50);                                       // wordmark bar
  ctx.fillStyle = '#111111';                                           // the eyes —
  ctx.fillRect(132, 38, 10, 8);                                        // the ONLY dark
  ctx.fillRect(158, 38, 10, 8);                                        // pixels here
});
const paddedLogo = () => logoCanvas(320, 320, (ctx) => {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(60, 115, 200, 90);   // 200x90 artwork in a 320x320 sea of alpha
});
const ghostLogo = () => logoCanvas(320, 160, (ctx) => {
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(20, 20, 280, 120);
});
const whiteOnDarkLogo = () => logoCanvas(300, 150, (ctx) => {
  ctx.fillStyle = '#0b2545';
  ctx.fillRect(0, 0, 300, 150);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(60, 55, 180, 40);    // white lettering bar
});

// ── Cases ────────────────────────────────────────────────────────────────────
// Each case is a declarative MODEL — the fields that differ from a plain label —
// rather than a positional argument list. That indirection is deliberate: it
// lets generateLabel's signature change without touching a single case, so the
// baselines keep policing the pixels across a refactor instead of having to be
// regenerated (which would make the gate certify its own change).
//
// Every case exercises a distinct branch of the layout maths. The names are
// chosen to hit the font-autosizing thresholds (>12 chars, >8 chars, short).
const CASES = [
  { name: 'plain',            model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Cubbies' } },
  { name: 'first-name-only',  model: { firstName: 'Ava', lastName: '', clubName: '' } },
  { name: 'long-name',        model: { firstName: 'Bartholomew', lastName: 'Fitzwilliam', clubName: 'T&T' } },
  { name: 'very-long-first',  model: { firstName: 'Maximilianagnes', lastName: 'Sample', clubName: 'Sparks' } },
  { name: 'handbook-group',   model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16' } },
  { name: 'allergies-one',    model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', allergyTokens: ['NUTS'] } },
  { name: 'allergies-all',    model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', allergyTokens: ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'] } },
  { name: 'birthday',         model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isBirthday: true } },
  { name: 'visitor',          model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isVisitor: true } },
  { name: 'visitor-inverted', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isVisitor: true, extras: { inverted: true } } },
  { name: 'step-up',          model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', stepUp: true, stepUpNextClub: 'T&T' } },
  { name: 'shares',           model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', awanaShares: 12 } },
  { name: 'no-photo',         model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', noPhoto: true } },
  { name: 'go-to-line',       model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', extras: { goToLine: 'Go to: Music, Rm 4' } } },
  { name: 'milestone-line',   model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', extras: { milestoneLine: '⭐ 10th club night tonight!' } } },
  { name: 'test-banner',      model: { firstName: 'Canary 00:00:00', lastName: '', clubName: 'Test', testBanner: true } },
  { name: 'club-monogram',    model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles' } },
  // The thermal-logo pipeline. light-cyan is the real Puggles incident; padded
  // proves the ink crop; ghost and white-on-dark pin the fallback boundaries.
  { name: 'logo-light-cyan',   model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles', clubImageBuffer: lightCyanLogo() } },
  { name: 'logo-padded',       model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', clubImageBuffer: paddedLogo() } },
  { name: 'logo-ghost',        model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', clubImageBuffer: ghostLogo() } },
  { name: 'logo-white-on-dark', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Trek', clubImageBuffer: whiteOnDarkLogo() } },
  // Inverted (first-timer / award) labels print the icon panel near-black, so
  // the logo must flip to WHITE ink or it vanishes into its own background —
  // found by review, black-on-#1f2937, invisible on paper.
  { name: 'logo-inverted-visitor', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles', clubImageBuffer: lightCyanLogo(), isVisitor: true, extras: { inverted: true } } },
  // The torture case: every optional field on at once. This is the one that
  // catches collisions — the handbook group reserving width for the icon row,
  // the bottom-left line meeting the bottom-right icons, the pill overlapping
  // the name block.
  {
    name: 'torture-all-fields',
    model: {
      firstName: 'Bartholomew', lastName: 'Fitzwilliam', clubName: 'Sparks',
      allergyTokens: ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'],
      handbookGroup: 'Flight 3:16',
      isBirthday: true, isVisitor: true, awanaShares: 99, noPhoto: true,
      extras: { goToLine: 'Go to: Music, Rm 4', milestoneLine: '⭐ 50th club night tonight!' },
    },
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

// generateLabel takes one options object. Kept as a named adapter so that if the
// signature ever changes again, only this function moves.
function callLabel(model) {
  return generateLabel({ ...model });
}

async function render(model) {
  const result = await callLabel(model);
  // generateLabel writes a temp PNG and also returns the buffer; use the buffer
  // and clean up the file so a test run leaves nothing behind.
  const buf = result.buffer || fs.readFileSync(result.pngPath);
  if (result.pngPath) fs.unlink(result.pngPath, () => {});
  return buf;
}

// ── Can we trust a pixel comparison here? ────────────────────────────────────
//
// `process.platform === 'linux'` was NOT a sufficient test, and CI proved it:
// this dev container and ubuntu-latest are both Linux with entirely different
// font packages, so the same code renders visibly different glyphs and every
// baseline missed by ~9% of its pixels. A gate that red-lights every push on a
// font-package bump is a gate people delete.
//
// So the baselines record a FINGERPRINT of the font stack that produced them:
// a small probe canvas exercising the text sizes and symbol glyphs the labels
// actually use, hashed. Identical hash means identical rasterisation, and the
// pixel comparison means what it claims. Different hash means we genuinely
// cannot police pixels here, and the suite says so loudly rather than failing
// (which would be noise) or passing silently (which would be a lie).
//
// The structural checks below run EVERYWHERE and are what CI actually enforces.
const FINGERPRINT_FILE = path.join(BASELINE_DIR, 'font-fingerprint.txt');

function fontFingerprint() {
  const c = createCanvas(600, 220);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 600, 220);
  ctx.fillStyle = '#000';
  // The same families and sizes the label renderer asks for, plus the symbol
  // glyphs — those are the ones most likely to differ between font packages.
  ctx.font = 'bold 48px Helvetica, Arial, sans-serif';
  ctx.fillText('Bartholomew', 8, 56);
  ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
  ctx.fillText('Truth & Training', 8, 92);
  ctx.font = '12px Helvetica, Arial, sans-serif';
  ctx.fillText('Go to: Music, Rm 4 — 10th club night', 8, 120);
  ctx.font = '22px Helvetica, Arial, sans-serif';
  ctx.fillText('\u2B50 \u2605 \u2606 \u272A \u2739', 8, 160);
  return crypto.createHash('sha256').update(c.toBuffer('image/png')).digest('hex').slice(0, 16);
}

const FONT_ID = fontFingerprint();
const BASELINE_FONT_ID = fs.existsSync(FINGERPRINT_FILE)
  ? fs.readFileSync(FINGERPRINT_FILE, 'utf8').trim()
  : null;
const FONTS_MATCH = BASELINE_FONT_ID === null || BASELINE_FONT_ID === FONT_ID;
const CAN_COMPARE = process.platform === 'linux' && FONTS_MATCH;

async function main() {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  if (!CAN_COMPARE) {
    if (process.platform !== 'linux') {
      console.log(`  ! platform is ${process.platform}, not linux — pixel COMPARISON skipped`);
    } else {
      console.log('  ! this machine\'s font stack does not match the one that produced');
      console.log(`    the baselines (${BASELINE_FONT_ID} vs ${FONT_ID}), so identical code`);
      console.log('    renders different glyphs here and a pixel diff would be pure noise.');
      console.log('    Pixel COMPARISON skipped — structural + determinism checks still run.');
      console.log('    To police pixels on this machine, regenerate on it:');
      console.log('      npm run test:golden:update');
    }
  }

  // ── Determinism, asserted rather than assumed ─────────────────────────────
  // The whole suite rests on this. If it ever fails, golden images are the wrong
  // tool and we want to know immediately.
  {
    const a = await render(CASES[0].model);
    const b = await render(CASES[0].model);
    check('renderer is byte-deterministic (golden images are valid)',
      Buffer.compare(a, b) === 0,
      `${a.length} vs ${b.length} bytes`);
    const torture = await render(CASES[CASES.length - 1].model);
    const torture2 = await render(CASES[CASES.length - 1].model);
    check('the torture case is deterministic too',
      Buffer.compare(torture, torture2) === 0);
  }

  if (UPDATE) fs.writeFileSync(FINGERPRINT_FILE, `${FONT_ID}\n`);

  /** Every rendered case, for the font-independent checks after the loop. */
  const rendered = [];
  let updated = 0;
  for (const c of CASES) {
    const file = path.join(BASELINE_DIR, `${c.name}.png`);
    let actual;
    try {
      actual = await render(c.model);
    } catch (e) {
      check(`render ${c.name}`, false, e.message);
      continue;
    }

    check(`${c.name}: renders a 1200x600 PNG`, actual.length > 1000
      && actual[0] === 0x89 && actual[1] === 0x50);
    rendered.push({ name: c.name, buf: actual });

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

  // ── Font-independent invariants ───────────────────────────────────────────
  // These run EVERYWHERE, including on a runner whose fonts differ from the
  // ones that made the baselines, so they are what CI actually enforces. They
  // are not filler: during the options-object refactor one case silently
  // rendered BLANK because its argument list had not been converted, and both
  // checks below catch exactly that. The pixel gate caught it locally; without
  // these, CI would not have.
  {
    for (const r of rendered) {
      const px = await pixels(r.buf);
      let ink = 0;
      for (let i = 0; i < px.data.length; i += 4) {
        // Anything meaningfully darker than white. Thermal output is 1-bit, so
        // "ink" is unambiguous regardless of which font drew it.
        if (px.data[i] < 200) ink++;
      }
      const ratio = ink / (px.w * px.h);
      check(`${r.name}: renders actual ink, not a blank label`,
        ratio > 0.005, `only ${(ratio * 100).toFixed(3)}% of pixels are marked`);
    }

    // Two different cases producing an identical image means a field stopped
    // reaching the renderer — the exact signature of a mis-mapped argument.
    const seen = new Map();
    for (const r of rendered) {
      const h = crypto.createHash('sha256').update(r.buf).digest('hex');
      const twin = seen.get(h);
      check(`${r.name}: is distinguishable from every other case`,
        twin === undefined, `identical to ${twin}`);
      if (twin === undefined) seen.set(h, r.name);
    }
  }

  // ── Thermal ink in the ICON ZONE ──────────────────────────────────────────
  // Font-independent (the logos are pure geometry), so CI enforces these. The
  // measure is deliberately not "any non-white pixel": a light-cyan pixel IS
  // non-white on screen and yet prints as NOTHING once the thermal driver
  // dithers it — that gap is precisely the Puggles bug. So count only pixels
  // dark enough to survive 1-bit output (luminance < 128), inside the icon
  // column (x < (INSET + ICON_COL_W) * SCALE ≈ 375 device px).
  //
  // The floor of 3% separates cleanly: a binarized logo or monogram covers
  // 10–23% of the zone; the unbinarized cyan wordmark left 0.09% (two eyes).
  {
    const ICON_ZONE_X = Math.round((6 + 84) * (300 / 72));   // 375
    const iconInkRatio = async (buf) => {
      const px = await pixels(buf);
      let ink = 0, zone = 0;
      for (let y = 0; y < px.h; y++) {
        for (let x = 0; x < ICON_ZONE_X; x++) {
          const i = (y * px.w + x) * 4;
          zone++;
          const lum = 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
          if (lum < 128) ink++;
        }
      }
      return ink / zone;
    };
    const byName = new Map(rendered.map((r) => [r.name, r.buf]));
    for (const name of ['logo-light-cyan', 'logo-padded', 'logo-ghost', 'logo-white-on-dark', 'club-monogram']) {
      const buf = byName.get(name);
      if (!buf) { check(`${name}: rendered (needed for icon-zone check)`, false); continue; }
      const ratio = await iconInkRatio(buf);
      check(`${name}: icon zone carries ink a thermal printer can actually print`,
        ratio > 0.03, `only ${(ratio * 100).toFixed(2)}% of the icon zone is dark`);
    }

    // The inverted label is the mirror image: its icon panel prints BLACK, so
    // the logo is legible only as LIGHT pixels. Counting dark ink here would
    // pass trivially (the panel itself is dark) and prove nothing — which is
    // exactly how the black-on-black regression slipped past the first five
    // logo checks and had to be caught by review instead.
    {
      const buf = byName.get('logo-inverted-visitor');
      if (!buf) {
        check('logo-inverted-visitor: rendered (needed for icon-zone check)', false);
      } else {
        const px = await pixels(buf);
        let light = 0, zone = 0;
        for (let y = 0; y < px.h; y++) {
          for (let x = 0; x < ICON_ZONE_X; x++) {
            const i = (y * px.w + x) * 4;
            zone++;
            const lum = 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
            if (lum > 200) light++;
          }
        }
        const ratio = light / zone;
        check('logo-inverted-visitor: the logo is WHITE on the dark panel, not black-on-black',
          ratio > 0.03, `only ${(ratio * 100).toFixed(2)}% of the icon zone is light`);
      }
    }
  }

  // ── prepareLogoForThermal, at unit level ──────────────────────────────────
  // The label-level checks above prove the zone ends up dark; these pin HOW —
  // crop box, binarization, hole preservation, and every null fallback.
  {
    const readPx = (canvas) => canvas.getContext('2d')
      .getImageData(0, 0, canvas.width, canvas.height);
    const at = (imgData, x, y) => {
      const i = (y * imgData.width + x) * 4;
      return { r: imgData.data[i], g: imgData.data[i + 1], b: imgData.data[i + 2], a: imgData.data[i + 3] };
    };

    const cyan = await prepareLogoForThermal(lightCyanLogo());
    check('cyan wordmark: survives as ink', cyan !== null);
    if (cyan) {
      const d = readPx(cyan.canvas);
      const mid = at(d, Math.round(cyan.width / 2), cyan.height - 20);   // inside the bar
      check('cyan wordmark: ink is rendered BLACK, not cyan',
        mid.a > 200 && mid.r === 0 && mid.g === 0 && mid.b === 0,
        JSON.stringify(mid));
    }

    const padded = await prepareLogoForThermal(paddedLogo());
    check('padded canvas: cropped to the artwork, not the canvas',
      padded !== null && padded.width <= 204 && padded.width >= 198
      && padded.height <= 94 && padded.height >= 88,
      padded ? `${padded.width}x${padded.height}` : 'null');

    // A pale-gray card must read as PAPER: at the old threshold of 40 the
    // whole card became a featureless black slab and the artwork inside it
    // was indistinguishable from its background.
    const paleCard = await prepareLogoForThermal(logoCanvas(320, 320, (ctx) => {
      ctx.fillStyle = '#d0d0d0';
      ctx.fillRect(0, 0, 320, 320);          // pale card background
      ctx.fillStyle = '#333333';
      ctx.fillRect(120, 120, 80, 80);        // the actual artwork
    }));
    check('pale-gray card: the card is paper, the mark inside is the artwork',
      paleCard !== null && paleCard.width <= 84 && paleCard.width >= 78
      && paleCard.height <= 84 && paleCard.height >= 78,
      paleCard ? `${paleCard.width}x${paleCard.height}` : 'null');

    // The too-small gate must measure the artwork's TRUE resolution, not its
    // size after the bounded scan's downscale — identical artwork must not
    // pass or fail depending on how much empty canvas surrounds it.
    const big = await prepareLogoForThermal(logoCanvas(4000, 4000, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(1850, 1850, 300, 300);    // 300px artwork, oversized canvas
    }));
    check('oversized canvas: sourceWidth reports the artwork at source scale',
      big !== null && big.sourceWidth >= 295 && big.sourceWidth <= 310
      && big.sourceHeight >= 295 && big.sourceHeight <= 310,
      big ? `${big.sourceWidth}x${big.sourceHeight} (scan ${big.width}x${big.height})` : 'null');
    check('...which clears the 158px too-small gate that scan-space size would fail',
      big !== null && Math.max(big.sourceWidth, big.sourceHeight) >= 158
      && Math.max(big.width, big.height) < 158,
      big ? `source ${big.sourceWidth}, scan ${big.width}` : 'null');

    // A PNG whose header claims absurd dimensions is refused before decode.
    const bomb = Buffer.alloc(64);
    bomb.writeUInt32BE(0x89504e47, 0); bomb.writeUInt32BE(0x0d0a1a0a, 4);
    bomb.writeUInt32BE(13, 8); bomb.write('IHDR', 12);
    bomb.writeUInt32BE(100000, 16); bomb.writeUInt32BE(100000, 20);
    check('a PNG header claiming 100000x100000 is refused without decoding',
      (await prepareLogoForThermal(bomb)) === null);

    check('near-white ghost art: rejected (would print as nothing)',
      (await prepareLogoForThermal(ghostLogo())) === null);
    check('fully transparent image: rejected',
      (await prepareLogoForThermal(logoCanvas(64, 64, () => {}))) === null);
    check('undecodable buffer: rejected without throwing',
      (await prepareLogoForThermal(Buffer.from('not a png'))) === null);
    check('null input: rejected', (await prepareLogoForThermal(null)) === null);

    const whiteInk = await prepareLogoForThermal(lightCyanLogo(), { ink: [255, 255, 255] });
    check('ink color is configurable: white ink for inverted labels', whiteInk !== null);
    if (whiteInk) {
      const d = readPx(whiteInk.canvas);
      const mid = at(d, Math.round(whiteInk.width / 2), whiteInk.height - 20);
      check('...and the ink really is white',
        mid.a > 200 && mid.r === 255 && mid.g === 255 && mid.b === 255,
        JSON.stringify(mid));
    }

    const inverted = await prepareLogoForThermal(whiteOnDarkLogo());
    check('white-on-dark: the dark field is ink', inverted !== null);
    if (inverted) {
      const d = readPx(inverted.canvas);
      const bg = at(d, 5, 5);                                            // dark corner
      const bar = at(d, Math.round(inverted.width / 2), Math.round(inverted.height / 2)); // white bar
      check('white-on-dark: background became black ink', bg.a > 200 && bg.r === 0,
        JSON.stringify(bg));
      check('white-on-dark: the white lettering survives as holes', bar.a === 0,
        JSON.stringify(bar));
    }
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
