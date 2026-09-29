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
// Since the 2026-27 rebrand the label's TEXT is set in fonts that ship with the
// app (print-server/public/brand/fonts: Paytone One, Londrina Solid, Figtree), so
// most of each label rasterises the same everywhere. What still comes from the
// host is the emoji row and the old Windows fonts the renderer falls back to
// (the fail-open cases below render them on purpose), which is why the
// fingerprint probe keeps drawing system fonts and not the bundled ones: a
// change to a bundled font must fail as a pixel diff, never skip the check.
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

// A crashed suite must FAIL, not pass: server.js's uncaughtException handler
// (a production never-crash feature) can swallow a test-time crash, letting
// the event loop drain and the process exit 0 without a summary ever printing.
// If we reach 'exit' with code 0 and the suite never declared itself finished,
// force red. (Found the hard way: a ReferenceError mid-suite passed CI.)
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('\u2717 Test suite terminated before completing (crash swallowed?) \u2014 failing.');
    process.exitCode = 1;
  }
});


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

const { generateLabel, prepareLogoForThermal, labelType, clubKey, CLUB_MONOGRAM } = (() => {
  const mod = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  return {
    generateLabel: mod.generateLabel, prepareLogoForThermal: mod.prepareLogoForThermal,
    labelType: mod.labelType, clubKey: mod.clubKey, CLUB_MONOGRAM: mod.CLUB_MONOGRAM,
  };
})();
const { createCanvas, loadImage } = require(
  path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs', 'canvas'));
// The SAME module instance server.js loaded (require cache keys on the path),
// so pointing it at another folder changes what the renderer sees.
const brand = require(path.join(__dirname, '..', 'print-server', 'brand.js'));

// ── Brand-kit variants for the fail-open cases ───────────────────────────────
// A case with `kit: '<name>'` renders with the kit reloaded from a copy that is
// missing a piece — exactly what a broken or partial install looks like — and
// the shipped kit is restored straight after. Every one of them must still be
// a complete, printable label: that is the fail-open promise, pinned in pixels.
const KIT_DIR = brand.DEFAULT_BRAND_DIR;
const kitCopy = (name, keep) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `awana-golden-kit-${name}-`));
  for (const sub of keep) fs.cpSync(path.join(KIT_DIR, sub), path.join(d, sub), { recursive: true });
  return d;
};
const KITS = {
  'no-marks': kitCopy('no-marks', ['fonts']),   // fonts load, every club mark is missing
  'no-fonts': kitCopy('no-fonts', ['logos']),   // marks load, every font is missing
  none:       kitCopy('none', []),              // nothing at all
};

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
  // Birthday age (#291): the words beside the cake. Inserted HERE and not at
  // the end of CASES — the determinism block renders CASES[CASES.length - 1]
  // and expects that to still be the torture case.
  { name: 'birthday-age',     model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isBirthday: true, birthdayAge: 7 } },
  { name: 'visitor',          model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isVisitor: true } },
  { name: 'visitor-inverted', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isVisitor: true, extras: { inverted: true } } },
  { name: 'step-up',          model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', stepUp: true, stepUpNextClub: 'T&T' } },
  { name: 'shares',           model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', awanaShares: 12 } },
  { name: 'streak-flame',     model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', streakCount: 7 } },
  { name: 'new-kid-sparkle',  model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isNewKid: true } },
  // Twin-safe (#13): the birth-month whisper under the name, and the
  // middle-initial variant riding the first-name line.
  { name: 'twin-hint',        model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', nameHint: 'b. Mar' } },
  { name: 'twin-initial',     model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', middleInitial: 'G' } },
  { name: 'no-photo',         model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', noPhoto: true } },
  { name: 'go-to-line',       model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', extras: { goToLine: 'Go to: Music, Rm 4' } } },
  { name: 'milestone-line',   model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', extras: { milestoneLine: '⭐ 10th club night tonight!' } } },
  { name: 'footer',           model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm' } },
  // The connect card's shape: first-class greeting (34 chars — pins that the
  // handbookGroup 30-char cap does NOT apply to it), visitor pill, schedule
  // line, footer.
  { name: 'connect-card',     model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isVisitor: true, greeting: "We're so glad you're here tonight!", footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm', extras: { goToLine: '6:15 · Main Hall · Rm 4' } } },
  // Footer stacked under a routing line — pins the bottom-left draw order
  // (footer at the very bottom, goTo above it).
  { name: 'footer-with-go-to', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm', extras: { goToLine: 'Go to: Music, Rm 4' } } },
  // Leader name tags: the LEADER pill in the visitor-pill slot plus the
  // "<Club> Leader" greeting, club line suppressed so the club is not printed
  // twice; and the club-less variant (no icon panel, plain "Leader").
  { name: 'leader',           model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isLeader: true, greeting: 'Sparks Leader', template: { showClubLine: false } } },
  { name: 'leader-no-club',   model: { firstName: 'Pat', lastName: 'Sample', clubName: '', isLeader: true, greeting: 'Leader' } },
  { name: 'test-banner',      model: { firstName: 'Canary 00:00:00', lastName: '', clubName: 'Test', testBanner: true } },
  // The official one-colour club mark (brand kit) in the icon column when no
  // TwoTimTwo logo was supplied: one case per club, a short name so the
  // Paytone One name is as big as it gets (the approved mockup's "Ivy"). The mark
  // replaces the club line, as a real logo always has. `plain` above is
  // Cubbies with a longer name.
  { name: 'club-puggles',     model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Puggles' } },
  { name: 'club-cubbies',     model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Cubbies' } },
  { name: 'club-sparks',      model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Sparks' } },
  { name: 'club-tnt',         model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'T&T' } },
  { name: 'club-trek',        model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Trek' } },
  { name: 'club-journey',     model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Journey' } },
  // The mark on an inverted (first-timer) label: re-inked WHITE by the thermal
  // converter, or it would vanish into the near-black panel.
  { name: 'mark-inverted',    model: { firstName: 'Ivy', lastName: 'Sample', clubName: 'Trek', isVisitor: true, extras: { inverted: true } } },
  // Fail-open, in pixels. The marks are missing: the letter monogram comes
  // back, and with it the club line. The fonts are missing: every line prints
  // in the old Windows fonts and the mark stays. Nothing loads: the label the
  // printer made before the kit existed, wave edge aside.
  { name: 'monogram-fallback', kit: 'no-marks', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles' } },
  { name: 'fonts-fallback',    kit: 'no-fonts', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', allergyTokens: ['NUTS'], isVisitor: true } },
  { name: 'kit-missing',       kit: 'none',     model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Puggles', handbookGroup: 'Flight 3:16', isVisitor: true, footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm' } },
  // A name the brand face cannot fully draw (Paytone One has no Cyrillic): the
  // whole first name prints in the old font rather than with a hole in it,
  // and the last name, whose letters Figtree does have, stays in the kit. One
  // voice falling back must never take the next one with it. (The last name
  // is plain Latin on purpose: the kit's Figtree lacks the precomposed
  // Vietnamese letters, so "Nguyễn" would fall back as well and the case
  // would pin nothing but "every line falls back". The font-face checks after
  // the loop pin the same split by name, in CI too.)
  { name: 'name-outside-paytone', model: { firstName: 'Дима', lastName: 'Sample', clubName: 'Sparks' } },
  // What the swap from Galindo bought: these names used to be in the case
  // above's position (the old Windows face, whole). Paytone One draws them, so
  // they print in the kit. Thảo carries a hook above the o; Ștefan the comma
  // below the S that hangs past the line; Ấn the tallest stack of marks the
  // face has, on a capital, which rises past the top of the line.
  { name: 'name-vietnamese', model: { firstName: 'Thảo', lastName: 'Sample', clubName: 'Sparks' } },
  { name: 'name-romanian', model: { firstName: 'Ștefan', lastName: 'Sample', clubName: 'Sparks' } },
  { name: 'name-tall-accent', model: { firstName: 'Ấn', lastName: 'Sample', clubName: 'Sparks' } },
  // Descenders (g j p q y) on the name, over the last name: the line box has
  // to clear them.
  { name: 'name-descenders', model: { firstName: 'Gypsy', lastName: 'Sample', clubName: 'Sparks' } },
  // The same tall accent on a crowded label, where the block is squeezed
  // against the top of the badge: the accent's room is part of the block, so
  // the name gives up size before it gives up its accent.
  { name: 'name-tall-accent-crowded', model: {
    firstName: 'Ấn', lastName: 'Fitzwilliam', clubName: 'Sparks',
    allergyTokens: ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'], handbookGroup: 'Flight 3:16',
    isBirthday: true, awanaShares: 99, noPhoto: true, streakCount: 12, isNewKid: true, nameHint: 'b. Mar',
    footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm',
    extras: { goToLine: 'Go to: Music, Rm 4', milestoneLine: '⭐ 50th club night tonight!' },
  } },
  // A line of mixed faces under a 'top' baseline (the handbook group): the
  // words in Figtree, the star from the old stack, both on one baseline, not
  // the star's line an ascent above the words (on top of the last name).
  { name: 'group-mixed-faces',  model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16 ⭐' } },
  // Per-club templates: switches OFF what the stock label shows. no-icon pins
  // the full-width text reflow; minimal pins that every templatable slot can
  // go dark (name + allergy safety icons survive — those are not templatable).
  { name: 'template-no-icon', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', template: { showIconPanel: false } } },
  { name: 'template-minimal', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', allergyTokens: ['NUTS'], footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm', template: { showIconPanel: false, showLastName: false, showClubLine: false, showGroupLine: false, showFooter: false, nameMaxPt: 30 } } },
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
  // Trophy band (#293): the inverse chip that names a finished handbook. The
  // second case is the one that earns its keep — it proves the footer yields
  // its slot so the bottom-left stack stays at three lines, and that the band
  // does not collide with the goTo/milestone lines above the icon row.
  { name: 'trophy-band',       model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', extras: { trophyBand: 'Finished Sparks Wingrunner' } } },
  { name: 'trophy-band-stack', model: { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', handbookGroup: 'Flight 3:16', footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm', extras: { trophyBand: 'Finished Sparks Wingrunner', goToLine: 'Go to: Music, Rm 4', milestoneLine: '⭐ 10th club night tonight!' } } },
  // Free-text label (POST /print-custom): one auto-sized line and NOTHING
  // else. This baseline is the guard on "nothing else" — every other case in
  // this file would show up as ink here the moment the early return above the
  // stock layout stopped returning early.
  { name: 'custom-label',     model: { customText: 'VOLUNTEER' } },
  // A custom label Paytone One cannot fully draw prints WHOLE in the old bold
  // sans, as every custom label did before the kit, never as kit words with
  // Arial letters inside them ("Дим[а]"). Vietnamese used to be this case
  // (Galindo lacked it); it is the next case now, in the kit.
  { name: 'custom-outside-paytone', model: { customText: 'Добро пожаловать' } },
  { name: 'custom-vietnamese', model: { customText: 'Chào mừng Nguyễn Thị Thảo' } },
  // The same face wrapped onto two lines. Paytone One stacks its Vietnamese
  // marks taller than the stock line pitch (Ố, Ấ, Ế, Ắ reach 1.19-1.22 em
  // above their baseline, the pitch was 1.15), so the acute of TỐI printed into
  // the line above until the pitch was set from the marks' own ink.
  { name: 'custom-vietnamese-wrapped', model: { customText: 'NGƯỜI GIÚP VIỆC BAN THIẾU NHI TỐI THỨ TƯ HẰNG TUẦN' } },
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
      isBirthday: true, isVisitor: true, awanaShares: 99, noPhoto: true, streakCount: 12, isNewKid: true,
      nameHint: 'b. Mar',
      footerText: 'KVBC Awana · Wednesdays 6:15–8:00pm',
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

async function render(model, kit) {
  if (kit) brand.loadBrandKit(KITS[kit]);
  let result;
  try {
    result = await callLabel(model);
  } finally {
    if (kit) brand.loadBrandKit(KIT_DIR);
  }
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
      actual = await render(c.model, c.kit);
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
  // The official club marks are outline wordmarks — mostly holes, and the wide
  // ones (Cubbies, Trek, Journey) only ~20 pt tall at full column width — so
  // they cover 2.5–5% (T&T's solid hexagon, 19%), and their floor is 1.5%:
  // still more than 15x the speck that failure mode leaves.
  {
    const MARK_CASES = new Set(['club-puggles', 'club-cubbies', 'club-sparks', 'club-tnt',
      'club-trek', 'club-journey', 'leader', 'logo-ghost', 'fonts-fallback',
      'visitor-inverted', 'mark-inverted']);
    const floorFor = (name) => (MARK_CASES.has(name) ? 0.015 : 0.03);
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
    // logo-ghost's logo is rejected, so it now carries the Sparks MARK; the
    // club-* cases and the leader tag carry marks; monogram-fallback and
    // kit-missing are the letter badge with the marks gone.
    for (const name of ['logo-light-cyan', 'logo-padded', 'logo-ghost', 'logo-white-on-dark',
      'club-puggles', 'club-cubbies', 'club-sparks', 'club-tnt', 'club-trek', 'club-journey',
      'leader', 'monogram-fallback', 'kit-missing', 'fonts-fallback']) {
      const buf = byName.get(name);
      if (!buf) { check(`${name}: rendered (needed for icon-zone check)`, false); continue; }
      const ratio = await iconInkRatio(buf);
      check(`${name}: icon zone carries ink a thermal printer can actually print`,
        ratio > floorFor(name), `only ${(ratio * 100).toFixed(2)}% of the icon zone is dark`);
    }

    // The inverted label is the mirror image: its icon panel prints BLACK, so
    // the logo is legible only as LIGHT pixels. Counting dark ink here would
    // pass trivially (the panel itself is dark) and prove nothing — which is
    // exactly how the black-on-black regression slipped past the first five
    // logo checks and had to be caught by review instead.
    for (const name of ['logo-inverted-visitor', 'visitor-inverted', 'mark-inverted']) {
      const buf = byName.get(name);
      if (!buf) {
        check(`${name}: rendered (needed for icon-zone check)`, false);
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
        check(`${name}: the logo/mark is WHITE on the dark panel, not black-on-black`,
          ratio > floorFor(name), `only ${(ratio * 100).toFixed(2)}% of the icon zone is light`);
      }
    }
  }

  // ── The official club marks, at unit level ────────────────────────────────
  // Font-independent (vector art through the thermal converter), so CI
  // enforces all of it.
  {
    const clubs = ['puggle', 'cubbie', 'spark', 't&t', 'trek', 'journey'];
    for (const key of clubs) {
      const svg = brand.clubMarkSvg(key);
      check(`mark ${key}: ships in the kit`, Buffer.isBuffer(svg));
      if (!svg) continue;
      const black = await prepareLogoForThermal(svg);
      check(`mark ${key}: survives the thermal converter as ink`, black !== null);
      check(`mark ${key}: rasterised well above the renderer's too-small gate`,
        black !== null && Math.max(black.sourceWidth, black.sourceHeight) >= 317,
        black ? `${black.sourceWidth}x${black.sourceHeight}` : 'null');
      const white = await prepareLogoForThermal(svg, { ink: [255, 255, 255] });
      check(`mark ${key}: re-inks white for an inverted label`, white !== null);
    }
    check('no mark for an unknown club', brand.clubMarkSvg('choir') === null);
    check('no mark for a null club', brand.clubMarkSvg(null) === null);

    // WHICH mark. brand.js's MARK_FILES is the only thing that says which file
    // is which club's, and every check above passes with two clubs' marks
    // swapped: only the pixel baselines would notice, and CI cannot compare
    // pixels. A Puggles child with the Cubbies mark would carry nothing else
    // naming the club either, because a drawn mark suppresses the club line.
    // So each key is pinned to its own file, named HERE rather than read from
    // brand.js, and the six must differ.
    const OWN_MARK_FILE = {
      puggle: 'puggles-black.svg', cubbie: 'cubbies-black.svg', spark: 'sparks-black.svg',
      't&t': 'tnt-black.svg', trek: 'trek-black.svg', journey: 'journey-black.svg',
    };
    const markHashes = new Set();
    for (const key of clubs) {
      const svg = brand.clubMarkSvg(key);
      const own = brand.svgAtSize(
        fs.readFileSync(path.join(KIT_DIR, 'logos', OWN_MARK_FILE[key]), 'utf8'), brand.MARK_RASTER_LONG_SIDE);
      check(`mark ${key}: is ${OWN_MARK_FILE[key]}, not another club's mark`,
        Buffer.isBuffer(svg) && typeof own === 'string' && svg.toString('utf8') === own);
      if (svg) markHashes.add(crypto.createHash('sha256').update(svg).digest('hex'));
    }
    check('the six clubs get six different marks', markHashes.size === clubs.length, `${markHashes.size} distinct`);
    // ...and each club NAME reaches its own key (the renderer asks by clubKey).
    for (const [name, key] of [['Puggles', 'puggle'], ['Cubbies', 'cubbie'], ['Sparks', 'spark'],
      ['T&T', 't&t'], ['Trek', 'trek'], ['Journey', 'journey']]) {
      check(`clubKey('${name}') is '${key}', the key its mark is filed under`, clubKey(name) === key, clubKey(name));
    }

    // Fail-open, cheaply: with the marks gone, a label still renders, and it
    // is the monogram label, not a blank icon zone (the ink check above).
    brand.loadBrandKit(KITS['no-marks']);
    check('with the marks missing, clubMarkSvg answers null rather than throwing',
      clubs.every((k) => brand.clubMarkSvg(k) === null));
    brand.loadBrandKit(KIT_DIR);
    check('...and the shipped kit comes back', clubs.every((k) => Buffer.isBuffer(brand.clubMarkSvg(k))));
  }

  // ── One line in two faces (labelType().fill) ──────────────────────────────
  // A line with a character the kit face lacks ('⭐' in a handbook group or a
  // greeting) is drawn as runs, and under a 'top' or 'middle' baseline every
  // run is moved onto ONE alphabetic baseline, because each face's own 'top'
  // sits at a different height. Get that wrong and the group line prints an
  // ascent too high, on top of the last name, and no baseline above has a
  // mixed run under a non-alphabetic baseline to show it. So: the words of a
  // mixed line must land on exactly the pixels the same words land on alone,
  // for each baseline and alignment the renderer uses. Font-independent: the
  // words are Figtree (bundled), and both renders are made here, on this
  // machine, so only the star's face varies, and it is outside the compared
  // region.
  {
    const type = labelType('Sparks');
    const S = 300 / 72;
    const W = 1200, H = 260;
    const words = 'Flight 3:16';
    const mixed = `${words} ⭐`;
    const runs = brand.splitRuns('Figtree', mixed);
    check('the probe line really is two faces (Figtree words, a fallback star)',
      runs.length === 2 && runs[0].brand === true && runs[1].brand === false, JSON.stringify(runs));
    const draw = (text, baseline, align, x) => {
      const c = createCanvas(W, H);
      const ctx = c.getContext('2d');
      ctx.scale(S, S);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W / S, H / S);
      ctx.fillStyle = '#000000';
      ctx.textBaseline = baseline;
      ctx.textAlign = align;
      type.fill(ctx, 'group', 12, text, x, 24);
      const restored = ctx.textBaseline === baseline && ctx.textAlign === align;
      return { ctx, restored, data: ctx.getImageData(0, 0, W, H).data };
    };
    for (const baseline of ['top', 'middle', 'alphabetic']) {
      for (const align of ['left', 'center', 'right']) {
        const X = 140;
        const m = draw(mixed, baseline, align, X);
        const total = type.measure(m.ctx, 'group', 12, mixed);
        const left = align === 'center' ? X - total / 2 : align === 'right' ? X - total : X;
        const alone = draw(words, baseline, 'left', left);
        const wordsW = type.measure(alone.ctx, 'group', 12, words);
        const x0 = Math.max(0, Math.floor(left * S) - 2);
        const x1 = Math.min(W, Math.ceil((left + wordsW) * S));
        let ink = 0, differ = 0;
        for (let y = 0; y < H; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * W + x) * 4;
            if (alone.data[i] < 128) ink++;
            if (Math.abs(alone.data[i] - m.data[i]) > CHANNEL_TOLERANCE) differ++;
          }
        }
        check(`mixed faces, ${baseline} baseline, ${align}: the words land where they land alone`,
          ink > 500 && differ === 0, `${differ} px differ, ${ink} px of ink in the words`);
        check(`mixed faces, ${baseline} baseline, ${align}: fill leaves the context's alignment as it found it`,
          m.restored);
      }
    }
  }

  // ── Which face each line ASKS for ─────────────────────────────────────────
  // Font-independent, so CI enforces it: the font string the renderer has set
  // at every fillText, recorded off the canvas's own prototype. Pixels cannot
  // pin this where the baselines are made: none of the old club faces (Comic
  // Sans, Trebuchet, Arial Black, Georgia, Palatino) is installed there, so
  // every club's fallback rasterises as the same generic sans, and a fallback
  // that forgot the club's font would still match every baseline. The
  // fail-open promise is "the label it printed before the kit": each club's own
  // old face, in each line's own old style.
  {
    const ctxProto = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
    const fontsDrawn = async (model, kit) => {
      const calls = [];
      const orig = ctxProto.fillText;
      ctxProto.fillText = function recordFont(text, ...rest) {
        calls.push({ text: String(text), font: this.font });
        return orig.call(this, text, ...rest);
      };
      try { await render(model, kit); } finally { ctxProto.fillText = orig; }
      return calls;
    };
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fontOf = (calls, text) => { const c = calls.find((k) => k.text === text); return c ? c.font : null; };
    // T&T's monogram and club line are the same text, so these two ask "is one
    // of the draws of this text in that face?".
    const fontsOf = (calls, text) => calls.filter((k) => k.text === text).map((k) => k.font);
    const anyAsks = (calls, text, style, family) => fontsOf(calls, text).some((f) => asks(f, style, family));
    const anyInKit = (calls, text, kitFamily, family) => fontsOf(calls, text).some((f) => inKit(f, kitFamily, family));
    // `<style> <size>px <family>`, the shape every pre-kit font string had.
    const asks = (font, style, family) => typeof font === 'string'
      && new RegExp(`^${style ? esc(style) + ' ' : ''}[0-9.]+px ${esc(family)}$`).test(font);
    const inKit = (font, kitFamily, family) => asks(font, '', `"${kitFamily}", ${family}`);

    // 6.16.0's getClubFontFamily, copied rather than imported: this table is
    // the promise, and the renderer's own copy is what is checked against it.
    const OLD_SANS = 'Helvetica, Arial, sans-serif';
    const PRE_KIT_FAMILY = [
      ['Puggles', "'Comic Sans MS', cursive, sans-serif"],
      ['Cubbies', "'Comic Sans MS', cursive, sans-serif"],
      ['Sparks',  "'Trebuchet MS', Arial, sans-serif"],
      ['T&T',     "'Arial Black', 'Arial Bold', Arial, sans-serif"],
      ['Trek',    "Georgia, 'Times New Roman', serif"],
      ['Journey', "'Palatino Linotype', Palatino, Georgia, serif"],
      ['',        OLD_SANS],
      ['Choir',   OLD_SANS],
    ];
    const everyLine = (clubName) => ({
      firstName: 'Testkid', lastName: 'Sample', clubName, handbookGroup: 'Flight 3:16', nameHint: 'b. Mar',
      isVisitor: true, footerText: 'Wednesdays', extras: { goToLine: 'Go to: Rm 4', milestoneLine: '10th club night tonight!' },
    });
    const stepUpLine = (clubName) => ({
      firstName: 'Testkid', lastName: 'Sample', clubName, stepUp: true, stepUpNextClub: 'T&T',
      testBanner: true, isBirthday: true, birthdayAge: 7,
    });
    // [text, the pre-kit style] for each line of those two labels.
    const PRE_KIT_STYLE = [
      ['Testkid', 'bold'], ['Sample', ''], ['b. Mar', 'italic'], ['Flight 3:16', 'italic'], ['VISITOR', 'bold'],
      ['Wednesdays', 'italic'], ['10th club night tonight!', ''], ['Go to: Rm 4', 'bold'],
    ];

    let spied = 0;
    for (const [clubName, family] of PRE_KIT_FAMILY) {
      const who = clubName || 'no club';
      // The kit is gone entirely: every line in its club's old face and style.
      const a = await fontsDrawn(everyLine(clubName), 'none');
      spied += a.length;
      for (const [text, style] of PRE_KIT_STYLE) {
        check(`no kit, ${who}: "${text}" asks for ${style || 'plain'} ${family}`,
          asks(fontOf(a, text), style, family), fontOf(a, text));
      }
      if (clubName) {
        check(`no kit, ${who}: the club line asks for italic bold ${family}`,
          anyAsks(a, clubName, 'italic bold', family), JSON.stringify(fontsOf(a, clubName)));
      }
      const letter = CLUB_MONOGRAM[clubKey(clubName)];
      if (letter) {
        check(`no kit, ${who}: the monogram asks for bold ${family}`,
          anyAsks(a, letter, 'bold', family), JSON.stringify(fontsOf(a, letter)));
      }
      const b = await fontsDrawn(stepUpLine(clubName), 'none');
      check(`no kit, ${who}: the step-up callout asks for bold ${family}`,
        asks(fontOf(b, 'Stepping up to T&T'), 'bold', family), fontOf(b, 'Stepping up to T&T'));
      check(`no kit, ${who}: the birthday age asks for plain ${family}`,
        asks(fontOf(b, 'Turning 7 this week!'), '', family), fontOf(b, 'Turning 7 this week!'));
      check(`no kit, ${who}: the TEST band asks for bold ${OLD_SANS}, as it always did`,
        asks(fontOf(b, 'TEST — NOT A CHECK-IN'), 'bold', OLD_SANS), fontOf(b, 'TEST — NOT A CHECK-IN'));

      // The kit whole: the voices, each with the club's old face behind it.
      const k = await fontsDrawn(everyLine(clubName));
      check(`kit, ${who}: the first name asks for Paytone One over ${family}`,
        inKit(fontOf(k, 'Testkid'), 'Paytone One', family), fontOf(k, 'Testkid'));
      for (const text of ['Sample', 'b. Mar', 'Flight 3:16', 'Wednesdays', '10th club night tonight!', 'Go to: Rm 4']) {
        check(`kit, ${who}: "${text}" asks for Figtree over ${family}`,
          inKit(fontOf(k, text), 'Figtree', family), fontOf(k, text));
      }
      check(`kit, ${who}: the pill asks for Londrina Solid Black over ${family}`,
        inKit(fontOf(k, 'VISITOR'), 'Londrina Solid Black', family), fontOf(k, 'VISITOR'));
      if (clubName && letter) {
        // Marks gone, fonts whole: the monogram and the club line come back,
        // in the kit's voices.
        const n = await fontsDrawn(everyLine(clubName), 'no-marks');
        check(`kit without marks, ${who}: the club line asks for Londrina Solid over ${family}`,
          anyInKit(n, clubName, 'Londrina Solid', family), JSON.stringify(fontsOf(n, clubName)));
        check(`kit without marks, ${who}: the monogram asks for Paytone One over ${family}`,
          anyInKit(n, letter, 'Paytone One', family), JSON.stringify(fontsOf(n, letter)));
      }
    }
    check('the font recorder saw the renderer draw (it hooks the right prototype)', spied > 50, `${spied} calls`);

    // One voice falling back never takes the next with it: a first name
    // Paytone One cannot draw prints in the old face, and the last name after
    // it is still Figtree.
    {
      const trebuchet = PRE_KIT_FAMILY[2][1];
      const c = await fontsDrawn({ firstName: 'Дима', lastName: 'Sample', clubName: 'Sparks' });
      check('a first name outside Paytone One asks for the old bold face, whole',
        asks(fontOf(c, 'Дима'), 'bold', trebuchet), fontOf(c, 'Дима'));
      check('...and the last name after it stays in Figtree',
        inKit(fontOf(c, 'Sample'), 'Figtree', trebuchet), fontOf(c, 'Sample'));
      // The names Galindo could not draw are the kit's now, every letter of
      // them, and each voice still decides for itself: "Nguyễn" is a last
      // name, Figtree has no precomposed Vietnamese, so it alone falls back.
      for (const first of ['Thảo', 'Ștefan', 'Ấn', 'Țara', 'Łukasz', 'Zoë']) {
        const v = await fontsDrawn({ firstName: first, lastName: 'Sample', clubName: 'Sparks' });
        check(`the first name "${first}" asks for Paytone One, not the old face`,
          inKit(fontOf(v, first), 'Paytone One', trebuchet), fontOf(v, first));
      }
      const vn = await fontsDrawn({ firstName: 'Thảo', lastName: 'Nguyễn', clubName: 'Sparks' });
      check('a Vietnamese first name is in the kit while its last name (Figtree lacks ễ) is in the old face',
        inKit(fontOf(vn, 'Thảo'), 'Paytone One', trebuchet) && asks(fontOf(vn, 'Nguyễn'), '', trebuchet),
        JSON.stringify([fontOf(vn, 'Thảo'), fontOf(vn, 'Nguyễn')]));
    }

    // A custom label is one face, whole: the kit's when Paytone One draws
    // every letter, else the old bold sans for the whole line, never both.
    {
      const plain = await fontsDrawn({ customText: 'VOLUNTEER' });
      check('custom label: plain text asks for Paytone One over the old sans',
        plain.length === 1 && inKit(plain[0].font, 'Paytone One', OLD_SANS), JSON.stringify(plain));
      // Vietnamese and Romanian used to be in the list below (Galindo lacked
      // them). They are the kit's now, whole.
      for (const text of ['Chào mừng Nguyễn Thị Thảo', 'Bun venit, Ștefan!', 'Łukasz i Żaneta zapraszają']) {
        const got = await fontsDrawn({ customText: text });
        check(`custom label "${text}": the whole line asks for Paytone One over the old sans`,
          got.length === 1 && inKit(got[0].font, 'Paytone One', OLD_SANS) && got[0].text === text, JSON.stringify(got));
      }
      for (const text of ['Добро пожаловать', 'Καλώς ήρθατε', 'Kitchen Crew ⭐', 'Akwaaba Kɔfi']) {
        const got = await fontsDrawn({ customText: text });
        check(`custom label "${text}": the whole line asks for bold ${OLD_SANS}, no letter in Paytone One`,
          got.length >= 1 && got.every((g) => asks(g.font, 'bold', OLD_SANS))
          && got.map((g) => g.text).join(' ') === text, JSON.stringify(got));
      }

      // ...and that is one decision for the WHOLE text, not one per wrapped
      // line. A custom text long enough to wrap used to ask each line on its
      // own whether the kit face draws it, so a letter it lacks in only one
      // half printed the other half in the kit face and this one in
      // Helvetica. Each case wraps (asserted: two lines) and puts the missing
      // letter in only one half (asserted: the halves really do differ in
      // coverage).
      // The letters that are missing are ones Paytone One really lacks
      // (Cyrillic, Greek), not the Ș and Vietnamese ones Galindo lacked and
      // Paytone One has: the last two cases are those, and they prove the
      // kit now draws both halves of them.
      // The old-sans cases are drawn in whatever the HOST resolves Helvetica /
      // Arial to, so each must wrap with room to spare on every stack a run
      // meets: Arial's metrics (Windows, Liberation Sans), DejaVu Sans (the
      // Ubuntu CI runner, about 17% wider) and narrower fallbacks. Each half
      // stays at or under 91% of the line in DejaVu, and the whole is at least
      // 116% of it in the narrowest face. A half at 104% in DejaVu is what
      // broke CI on 6.17.0 ("Sunday School Room 12 — please …"). Measured for
      // these (line = 252 pt at the 14 pt floor; Liberation Sans / DejaVu):
      //   Welcome … with our guest Дмитрий   whole 1.37 / 1.64, halves .72 .64 / .85 .77
      //   Дмитрий is our guest … Welcome!    whole 1.32 / 1.58, halves .64 .67 / .76 .79
      //   Sunday School … Mrs. Νικολάου      whole 1.30 / 1.55, halves .70 .58 / .81 .73
      // The two kit cases are drawn in the bundled face, so they are the same
      // on every host (whole 1.55 and 1.53, halves at most .80).
      const wrapped = [
        // [text, does the kit face draw all of it?]
        ["Welcome to Parents' Night, with our guest Дмитрий", false],           // Cyrillic in the second half
        ["Дмитрий is our guest at Parents' Night. Welcome!", false],             // Cyrillic in the first half
        ['Sunday School is in Room 12 with Mrs. Νικολάου', false],               // Greek in the second half
        ["Welcome to Parents' Night, with our special guest Stefan", true],     // every letter drawable
        ["Welcome to Parents' Night, with our special guest Ștefan", true],     // Ș: the kit draws it now
        ['Sunday School is in Room 12 with Mrs. Nguyễn Thị Thảo', true],         // ễ, ị, ả: so does it these
      ];
      for (const [text, kitDrawsAll] of wrapped) {
        const got = await fontsDrawn({ customText: text });
        const twoLines = got.length === 2 && got.map((g) => g.text).join(' ') === text;
        check(`custom label "${text}": wraps onto two lines`, twoLines, JSON.stringify(got));
        const halfDraws = got.map((g) => brand.fontCovers('Paytone One', g.text));
        check(`custom label "${text}": ${kitDrawsAll ? 'Paytone One draws both halves' : 'Paytone One lacks a letter in one half only'}`,
          kitDrawsAll ? halfDraws.every(Boolean) : halfDraws.filter(Boolean).length === 1, JSON.stringify(halfDraws));
        const face = kitDrawsAll
          ? (g) => inKit(g.font, 'Paytone One', OLD_SANS)
          : (g) => asks(g.font, 'bold', OLD_SANS);
        check(`custom label "${text}": every line asks for ${kitDrawsAll ? 'Paytone One' : `bold ${OLD_SANS}`}, none for the other`,
          got.length >= 2 && got.every(face), JSON.stringify(got));
        // Same size too: the lines are measured and drawn as one block.
        const sizes = new Set(got.map((g) => (g.font.match(/([0-9.]+)px/) || [])[1]));
        check(`custom label "${text}": both lines are one size`, sizes.size === 1, JSON.stringify([...sizes]));
      }
      // With no kit at all the same wrapped text is old-sans on both lines.
      {
        const got = await fontsDrawn({ customText: wrapped[3][0] }, 'none');
        check('custom label, no kit: a wrapped text asks for bold old sans on every line',
          got.length === 2 && got.every((g) => asks(g.font, 'bold', OLD_SANS)), JSON.stringify(got));
      }
      // The clip path (60 characters, no space) is one face as well.
      {
        const clipped = 'Д' + 'W'.repeat(59);
        const got = await fontsDrawn({ customText: clipped });
        check('custom label with no space, clipped: both pieces ask for bold old sans',
          got.length === 2 && got.every((g) => asks(g.font, 'bold', OLD_SANS)), JSON.stringify(got));
      }
    }

    // A small line that mixes faces changes face only BETWEEN words: a word
    // Figtree lacks a letter of ("Nguyễn", precomposed) is drawn whole in the
    // old face, never as Figtree with one Arial letter inside it.
    {
      const footer = 'Gặp cô Nguyễn ở phòng 4';
      const got = (await fontsDrawn({ firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', footerText: footer }))
        .filter((g) => footer.includes(g.text));
      const pieces = [];
      let at = 0;
      for (const g of got) {
        const i = footer.indexOf(g.text, at);
        if (i >= 0) { pieces.push({ ...g, from: i, to: i + g.text.length }); at = i + g.text.length; }
      }
      const letter = /[\p{L}\p{M}]/u;
      const cutsAWord = pieces.some((p) => (p.from > 0 && letter.test(footer[p.from - 1]) && letter.test(footer[p.from]))
        || (p.to < footer.length && letter.test(footer[p.to - 1]) && letter.test(footer[p.to])));
      check('a mixed small line is drawn in pieces that together are the whole line',
        pieces.map((p) => p.text).join('') === footer, JSON.stringify(pieces.map((p) => p.text)));
      check('...and no piece starts or ends inside a word', !cutsAWord, JSON.stringify(pieces.map((p) => p.text)));
      const word = pieces.find((p) => p.text === 'Nguyễn');
      check('...so "Nguyễn" is one piece, in the old italic face',
        !!word && asks(word.font, 'italic', PRE_KIT_FAMILY[2][1]), word && word.font);
      const kitWords = pieces.find((p) => p.text.includes('phòng'));
      check('...and the words Figtree can draw stay in Figtree',
        !!kitWords && inKit(kitWords.font, 'Figtree', PRE_KIT_FAMILY[2][1]), kitWords && kitWords.font);
    }
  }

  // ── The first name's ink stays clear of the badge and of the last name ────
  // Font-independent (the name is Paytone One and the last name Figtree, both
  // bundled, so these pixels are the same on every host) and measured on the
  // image itself, not on the layout numbers that produced it. Paytone One
  // draws marks and commas far outside its own line box: an accented capital
  // (É, Ấ) rises past the top of the em box, the comma of Ș and Ț and the
  // cedilla of Ç hang past the bottom, and g j p q y reach 0.20 em down. The
  // layout measures the name's own ink and makes room for it, so a tall accent
  // is never printed over the badge's top edge and a hanging comma is never
  // printed over the last name. If that measurement ever stops reaching the
  // layout, this fails by name.
  //
  // The text column of a plain Sparks label holds exactly two things, the
  // first name and the last name (the club's mark takes the icon column and
  // replaces the club line), so its inked rows are bands with the last name
  // in the LAST one. (The name itself can be several: a mark or a comma floats
  // clear of its letter, which is a band of its own. What must hold is the
  // gap before the last name's band, and the top of the first.)
  {
    const S = 300 / 72;
    const BADGE_TOP_PX = Math.round(6 * S);                       // INSET
    const X0 = Math.round((6 + 84 + 8) * S);                       // TEXT_X
    const X1 = Math.round((6 + 276) * S);                          // right edge of the badge
    const inkBands = async (buf) => {
      const px = await pixels(buf);
      const bands = [];
      let open = -1;
      for (let y = 0; y < px.h; y++) {
        let ink = false;
        for (let x = X0; x < X1 && !ink; x++) {
          const i = (y * px.w + x) * 4;
          if (0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2] < 128) ink = true;
        }
        if (ink && open < 0) open = y;
        if (!ink && open >= 0) { bands.push([open, y - 1]); open = -1; }
      }
      if (open >= 0) bands.push([open, px.h - 1]);
      return bands;
    };
    const NAMES = ['Testkid', 'Ivy', 'Gypsy', 'Jorge', 'Émile', 'Ángel', 'Ömer', 'Åsa', 'Ñandú', 'Çelik', 'Ąga',
      'Ștefan', 'Țara', 'Thảo', 'Ấn', 'Ễ', 'Ẳ', 'Nguyễn'];
    for (const name of NAMES) {
      const bands = await inkBands(await render({ firstName: name, lastName: 'Sample', clubName: 'Sparks' }));
      check(`"${name}": the last name is a band of its own, not run together with the first name's ink`,
        bands.length >= 2, JSON.stringify(bands));
      if (bands.length < 2) continue;
      check(`"${name}": the first name's ink starts below the badge's top edge`,
        bands[0][0] >= BADGE_TOP_PX, `starts at row ${bands[0][0]}, the badge at ${BADGE_TOP_PX}`);
      const gap = bands[bands.length - 1][0] - bands[bands.length - 2][1] - 1;
      check(`"${name}": at least 2 pt of clear paper between the first name and the last name`,
        gap >= Math.ceil(2 * S), `${gap} px (${(gap / S).toFixed(1)} pt)`);
    }
    // ...and the same on a label crowded to the top: the accent's room is part
    // of the block, so the block is squeezed by shrinking the name, and the
    // accent still keeps off the paper's edge. The paper above the block gives
    // the accent the room between the block and NAME_INK_TOP (4 pt from the
    // edge, as close as 6.17.0 ever printed a name); only what is beyond that
    // is charged to the block. The ink itself can sit a fraction of a point
    // nearer than the layout aims (the canvas reports integer-pixel bounds at
    // 100 px, and a 1-bit row is a quarter of a point), so this allows 0.5 pt.
    const PAPER_EDGE_PX = Math.round((4 - 0.5) * S);
    for (const name of ['Ấn', 'Ẳ', 'Émile', 'Ângelo', 'Ömer', 'Ñandú']) {
      const crowded = CASES.find((c) => c.name === 'name-tall-accent-crowded').model;
      const bands = await inkBands(await render({ ...crowded, firstName: name }));
      check(`"${name}" on a crowded label: the first name's ink stays 3.5 pt or more off the paper's top edge`,
        bands.length > 0 && bands[0][0] >= PAPER_EDGE_PX, `${JSON.stringify(bands[0])} vs ${PAPER_EDGE_PX}`);
    }
  }

  // ── Capitals sit on the centre: the custom label and the monogram badge ───
  // Both are drawn on a 'middle' baseline, which is the centre of the em box,
  // and a face's capitals are not centred in its em box: Galindo's stood high
  // of it and Paytone One's stand low, by about 6% of the size, which at a
  // custom label's 56 pt is 3.5 pt off the label's middle. The renderer
  // corrects for it (capCentre), and these measure the ink itself, so they
  // fail if it stops (Paytone One is bundled, so the pixels are the same on
  // every host). All-capital text on purpose: descenders would move the
  // centre of the ink without moving the line.
  {
    const S = 300 / 72;
    const rowsOfInk = async (buf, darkOn, region, inside = () => true) => {
      const px = await pixels(buf);
      let lo = Infinity, hi = -Infinity;
      for (let y = region.y0; y < region.y1; y++) {
        for (let x = region.x0; x < region.x1; x++) {
          if (!inside(x, y)) continue;
          const i = (y * px.w + x) * 4;
          const lum = 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
          if (darkOn ? lum < 128 : lum > 200) { if (y < lo) lo = y; if (y > hi) hi = y; break; }
        }
      }
      return lo === Infinity ? null : (lo + hi) / 2;
    };
    for (const text of ['VOLUNTEER', 'KITCHEN', 'ROOM 4']) {
      const mid = await rowsOfInk(await render({ customText: text }), true, { x0: 0, x1: 1200, y0: 0, y1: 600 });
      check(`custom label "${text}": its capitals are centred on the label (within 1.5 pt)`,
        mid !== null && Math.abs(mid - 300) <= 1.5 * S, `centre at row ${mid}, the label's at 300`);
    }
    // The disc is centred at (6 + 42, 6 + 66) pt with a 28 pt radius; the
    // letter is the light ink INSIDE it (outside is the pale icon panel, which
    // is light too, so the mask matters).
    const cx = Math.round(48 * S), cy = Math.round(72 * S), r = Math.round(20 * S);
    const inDisc = (x, y) => Math.hypot(x - cx, y - cy) < 26 * S;
    for (const [club, letters] of [['Puggles', 'P'], ['Cubbies', 'C'], ['Sparks', 'S'], ['Journey', 'J'], ['Trek', 'TR'], ['T&T', 'T&T']]) {
      const buf = await render({ firstName: 'Testkid', lastName: 'Sample', clubName: club }, 'no-marks');
      const mid = await rowsOfInk(buf, false, { x0: cx - r * 2, x1: cx + r * 2, y0: cy - r * 2, y1: cy + r * 2 }, inDisc);
      check(`monogram "${letters}" (${club}): the letter is centred in its disc (within 1 pt)`,
        mid !== null && Math.abs(mid - cy) <= 1 * S, `centre at row ${mid}, the disc's at ${cy}`);
    }
  }

  // ── Lines that must not run into each other, on the image itself ─────────
  // Paytone One draws marks far outside its line (Ấ, Ố, Ế, Ắ stand 1.19-1.22
  // em above their baseline, a dot below a vowel or the tail of a g hangs
  // 0.20-0.27 em under it, the comma of Ș hangs to 1.31 em), so a fixed
  // spacing that was right for the old bold sans lets one line's marks print
  // into its neighbour. Two places were caught doing it, both pinned here with
  // the ink of every fillText rasterised ALONE (a pixel counts when its alpha
  // is 128 or more, as it is on the 1-bit thermal print), then compared:
  //   * a custom label wrapped onto two lines, whose pitch is now set from the
  //     two lines' own ink (customLineH);
  //   * the step-up callout on a crowded label, which the first name used to
  //     push onto the trophy chip once its room went past the 18 pt floor.
  // Paytone One and Figtree are bundled, so these are the same on every host.
  {
    const W = 1200, H = 600;
    const ctxProto = Object.getPrototypeOf(createCanvas(1, 1).getContext('2d'));
    // Every fillText the renderer makes: what, where, in which font, and (when
    // `withInk`) the set of device pixels it inks and the rows it spans.
    const drawn = async (model, { withInk = true, kit } = {}) => {
      const out = [];
      const orig = ctxProto.fillText;
      let inside = false;
      ctxProto.fillText = function recordInk(text, x, y, ...rest) {
        if (!inside) {
          inside = true;   // the rasteriser below draws through this same prototype
          try {
            const d = { text: String(text), font: this.font, x, y, ink: null, rows: null };
            if (withInk) {
              const tr = this.getTransform();
              const alone = createCanvas(W, H);
              const o = alone.getContext('2d');
              o.setTransform(tr.a, tr.b, tr.c, tr.d, tr.e, tr.f);
              o.font = this.font;
              o.fontVariationSettings = this.fontVariationSettings;
              o.textAlign = this.textAlign;
              o.textBaseline = this.textBaseline;
              o.fillStyle = '#000000';
              orig.call(o, text, x, y, ...rest);
              const px = o.getImageData(0, 0, W, H).data;
              const ink = new Set();
              let lo = Infinity, hi = -Infinity;
              for (let i = 3, n = 0; i < px.length; i += 4, n++) {
                if (px[i] >= 128) {
                  ink.add(n);
                  const row = Math.floor(n / W);
                  if (row < lo) lo = row;
                  if (row > hi) hi = row;
                }
              }
              d.ink = ink;
              d.rows = ink.size ? [lo, hi] : null;
            }
            out.push(d);
          } finally { inside = false; }
        }
        return orig.call(this, text, x, y, ...rest);
      };
      try { await render(model, kit); } finally { ctxProto.fillText = orig; }
      return out;
    };
    const sizeOf = (d) => Number((/([0-9.]+)px/.exec(d.font) || [])[1]);
    const shared = (a, b) => {
      let n = 0;
      const [small, big] = a.size < b.size ? [a, b] : [b, a];
      for (const p of small) if (big.has(p)) n++;
      return n;
    };

    // A wrapped custom label: two lines, both in the kit, no pixel shared, and
    // clear paper (at least 2 px, half a point) between the lowest ink of the
    // first and the highest of the second. These four collided in the first
    // 6.18.0 cut (15, 5, 4 and 12 shared pixels): the acute of TỐI merged into
    // the line above, the stack on HẰ fused under the B of BAN, and É, Ấ and Ế
    // ran into the y and p descenders.
    const VIETNAMESE_TWO_LINES = [
      'NGƯỜI GIÚP VIỆC BAN THIẾU NHI TỐI THỨ TƯ HẰNG TUẦN',
      'Dạy học Kinh Thánh cùng thầy Nguyễn Quốc Hưng',
      "Kids' choir practice: gym, Ấu Nhi group, Ẩn Phòng",
      'Happy guy, joyful peppy puppy — Émile, Ấn and Ếch too',
    ];
    for (const text of VIETNAMESE_TWO_LINES) {
      const lines = await drawn({ customText: text });
      const twoInKit = lines.length === 2 && lines.every((l) => l.font.includes('"Paytone One"'))
        && lines.map((l) => l.text).join(' ') === text;
      check(`custom label "${text}": wraps onto two lines, both in Paytone One`, twoInKit, JSON.stringify(lines.map((l) => [l.text, l.font])));
      if (!twoInKit) continue;
      const [a, b] = lines;
      check(`custom label "${text}": the two lines share no ink`,
        shared(a.ink, b.ink) === 0, `${shared(a.ink, b.ink)} px shared`);
      const clear = b.rows[0] - a.rows[1] - 1;
      check(`custom label "${text}": at least 2 px of clear paper between the lines`,
        clear >= 2, `${clear} px (line 1 ends at row ${a.rows[1]}, line 2 starts at row ${b.rows[0]})`);
    }
    // The pitch only widens for marks that need it, and only in the kit face:
    // a wrapped label in the old bold sans keeps the stock 1.15, exactly as
    // 6.17.0 drew it (the fail-open promise), and so does a kit label whose
    // marks are compact.
    {
      const old = await drawn({ customText: "Дмитрий is our guest at Parents' Night. Welcome!" }, );
      check('custom label in the old face: wraps onto two lines at the stock 1.15 pitch',
        old.length === 2 && Math.abs((old[1].y - old[0].y) / sizeOf(old[0]) - 1.15) < 1e-6,
        JSON.stringify(old.map((l) => [l.text, l.y, l.font])));
      const plain = await drawn({ customText: "Welcome to Parents' Night, with our special guest Stefan" }, );
      check('custom label in the kit with compact marks: still the stock 1.15 pitch',
        plain.length === 2 && Math.abs((plain[1].y - plain[0].y) / sizeOf(plain[0]) - 1.15) < 1e-6,
        JSON.stringify(plain.map((l) => [l.text, l.y, l.font])));
      const tall = await drawn({ customText: VIETNAMESE_TWO_LINES[0] }, );
      check('custom label with stacked marks: the pitch is wider than the stock one',
        tall.length === 2 && (tall[1].y - tall[0].y) / sizeOf(tall[0]) > 1.3,
        JSON.stringify(tall.map((l) => [l.text, l.y, l.font])));
    }

    // The step-up callout on the most crowded label there is: a step-up night
    // with a trophy chip, a "Go to" line, a milestone and a twin hint. The name
    // is at its 18 pt floor and the block still overflows, so the leftover
    // lands on the bottom band. An ordinary name leaves the callout where it
    // leaves it (and clear of the chip's text); a name that asks for room above
    // or below must not push it any lower, and gives the difference back in
    // size (a few pt under the floor at most). It used to print the callout
    // over the chip for Ấn, Ẳ, NGUYỄN (99, 148 and 74 shared pixels).
    {
      // The long band is the worse case for the chip's text (it reaches further
      // under the callout): 59, 31 and 82 shared pixels for Ấn, NGUYỄN and Ẳ
      // even with the room above charged only past the paper's margin.
      const LONG_BAND = 'Finished T&T Ultimate Adventure Book 2';
      const crowdedStepUp = (first, band = 'Finished Sparks Wingrunner') => ({
        firstName: first, lastName: 'Sample', clubName: 'Sparks', stepUp: true, stepUpNextClub: 'T&T', nameHint: 'b. Mar',
        extras: { trophyBand: band, goToLine: 'Go to: Music, Rm 4', milestoneLine: '⭐ 10th club night tonight!' },
      });
      const pick = (calls, re) => calls.find((c) => re.test(c.text));
      const ordinary = await drawn(crowdedStepUp('Ivy'));
      const ordinaryCallout = pick(ordinary, /^Stepping up/);
      check('crowded step-up label, ordinary name: the name is at the 18 pt floor',
        Math.abs(sizeOf(pick(ordinary, /^Ivy$/)) - 18) < 1e-9, pick(ordinary, /^Ivy$/).font);
      check('crowded step-up label, ordinary name: the callout shares no ink with the trophy chip',
        !!ordinaryCallout && shared(ordinaryCallout.ink, pick(ordinary, /^Finished/).ink) === 0);
      {
        const longOrdinary = await drawn(crowdedStepUp('Ivy', LONG_BAND));
        check('crowded step-up label, ordinary name, long trophy band: the callout shares no ink with the chip',
          shared(pick(longOrdinary, /^Stepping up/).ink, pick(longOrdinary, /^Finished/).ink) === 0);
      }
      for (const name of ['Ấn', 'Ẳ', 'NGUYỄN', 'Ễ', 'JOSÉ', 'Ștefan', 'Ạn']) {
        const calls = await drawn(crowdedStepUp(name));
        const callout = pick(calls, /^Stepping up/);
        const chip = pick(calls, /^Finished/);
        const first = pick(calls, new RegExp(`^${name}$`));
        check(`crowded step-up label, "${name}": the callout stays where an ordinary name leaves it`,
          !!callout && Math.abs(callout.y - ordinaryCallout.y) < 0.01, callout && `${callout.y} vs ${ordinaryCallout.y}`);
        check(`crowded step-up label, "${name}": the callout shares no ink with the trophy chip`,
          !!callout && !!chip && shared(callout.ink, chip.ink) === 0);
        const longCalls = await drawn(crowdedStepUp(name, LONG_BAND));
        const longCallout = pick(longCalls, /^Stepping up/);
        const longChip = pick(longCalls, /^Finished/);
        check(`crowded step-up label, "${name}", long trophy band: the callout shares no ink with the chip`,
          !!longCallout && !!longChip && shared(longCallout.ink, longChip.ink) === 0,
          longCallout && longChip && `${shared(longCallout.ink, longChip.ink)} px shared`);
        check(`crowded step-up label, "${name}": the name gives up at most 4 pt under the 18 pt floor`,
          !!first && sizeOf(first) >= 14 - 1e-9 && sizeOf(first) <= 18 + 1e-9, first && first.font);
      }
    }

    // A crowded label that is NOT at the floor: paper above the block gives a
    // mark its room, so a diacritic that fits in that margin costs the name
    // (almost) nothing, and a tall stack costs it a fifth at most (a quarter
    // when the whole room was charged to the block).
    {
      const crowded = CASES.find((c) => c.name === 'name-tall-accent-crowded').model;
      const sizeFor = async (name) => {
        const calls = await drawn({ ...crowded, firstName: name }, { withInk: false });
        const c = calls.find((k) => k.text === name);
        return c ? sizeOf(c) : NaN;
      };
      const base = await sizeFor('Omer');
      for (const [name, min] of [['Ömer', 0.97], ['Ñandú', 0.97], ['Åsa', 0.93], ['Émile', 0.87], ['Ấn', 0.78], ['Ẳ', 0.78]]) {
        const got = await sizeFor(name);
        check(`crowded label, "${name}": prints at ${Math.round(min * 100)}% or more of the size an unaccented name gets`,
          got / base >= min && got <= base + 1e-9, `${got.toFixed(2)} pt vs ${base.toFixed(2)} pt (${(got / base).toFixed(3)})`);
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

  // ── Birthday age line (#291) ──────────────────────────────────────────────
  // Font-independent: every check below compares two LIVE renders byte for
  // byte, so it means the same thing on a runner whose fonts differ from the
  // ones that made the baselines. This is the half CI actually enforces.
  {
    const base = { firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks', isBirthday: true };
    const plainCake = await render(base);

    // A malformed birth year must never print "Turning NaN": every bad value
    // degrades to EXACTLY today's plain-cake label, not to a broken one.
    for (const bad of [null, undefined, 0, -3, 22, 99, 'seven', NaN, Infinity, {}, []]) {
      const got = await render({ ...base, birthdayAge: bad });
      check(`birthdayAge ${JSON.stringify(bad) === undefined ? 'undefined' : JSON.stringify(bad)}: renders the plain cake, no words`,
        Buffer.compare(got, plainCake) === 0);
    }
    check('birthdayAge 7: actually changes the label',
      Buffer.compare(await render({ ...base, birthdayAge: 7 }), plainCake) !== 0);

    // The age is an annotation ON the cake, never a standalone line.
    const noCake = await render({ ...base, isBirthday: false });
    check('an age without a cake prints nothing at all',
      Buffer.compare(await render({ ...base, isBirthday: false, birthdayAge: 7 }), noCake) === 0);

    // The width ladder: on a crowded row the WORDS yield, never the cake and
    // never a safety icon, so the icon row can't be pushed further left than
    // the allergy glyphs already put it.
    const crowded = {
      ...base,
      allergyTokens: ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'],
      noPhoto: true, awanaShares: 99, streakCount: 12, isNewKid: true,
    };
    const leftmostInk = async (buf) => {
      const px = await pixels(buf);
      const SCALE = 300 / 72;
      const y0 = Math.round((6 + 132 - 30) * SCALE);
      const y1 = Math.min(px.h, Math.round((6 + 132) * SCALE));
      let minX = px.w;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < minX; x++) {
          const i = (y * px.w + x) * 4;
          const lum = 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
          if (lum < 128) { minX = x; break; }
        }
      }
      return minX;
    };
    const without = await leftmostInk(await render(crowded));
    const withAge = await leftmostInk(await render({ ...crowded, birthdayAge: 7 }));
    check('a crowded icon row is never pushed left by the age words',
      withAge >= Math.min(without, Math.round(90 * (300 / 72))),
      `leftmost ink ${withAge} with the age vs ${without} without it`);

    // Two allergies + a camera leaves room for the short form but not the
    // long one, so the ladder's middle rung is exercised rather than assumed.
    const mid = { ...base, allergyTokens: ['NUTS', 'DAIRY'], noPhoto: true };
    const midPlain = await render(mid);
    const midAge = await render({ ...mid, birthdayAge: 7 });
    check('a moderately crowded row still says something about the age',
      Buffer.compare(midAge, midPlain) !== 0);
  }

  if (updated) {
    console.log(`\n  ${updated} baseline(s) written to ${path.relative(process.cwd(), BASELINE_DIR)}`);
    if (!UPDATE) console.log('  (missing baselines are created on first run — inspect them before committing)');
  }

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  for (const d of Object.values(KITS)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error('  - ' + f));
    console.error('\nIf a change is intentional, LOOK at label-golden-out/*.diff.png first,');
    console.error('then re-run with UPDATE_LABEL_BASELINES=1 to accept it.');
  }
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Golden harness error:', e);
  process.exit(1);
});
