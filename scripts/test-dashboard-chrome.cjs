#!/usr/bin/env node
// The operator surfaces in the brand kit: the dashboard, the phone page, the
// bookmarklet page, and the Windows status window and setup wizard.
//
// Source-level, like the club-list checks in test-leaders.cjs: these pages are
// plain DOM (and a React bundle) with no headless harness here, so the claims
// that quietly stop being true are pinned against the shipped files instead.
//
// WHAT THIS GUARDS
//
// * Every colour fallback is the kit's own value. Each page reads the
//   --brand-* tokens from the mirror (print-server/public/brand/tokens.css)
//   and writes the kit's hex after each var() so a missing mirror still
//   leaves a legible page. A fallback that drifts from the kit is exactly the
//   "retyped old value" the kit exists to prevent, so every one is compared.
// * The rebrand was chrome only. Every element the scripts look up still
//   exists, the warnings still render `w.message` (a bare string painted an
//   empty box once), and the section tabs are real buttons.
// * One hot button per surface. The kit's hot red-orange marks the one thing
//   that is special on a screen; two of them and neither is.
// * The pages load only what they can reach: the phone page is on the Wi-Fi
//   with no PIN yet, so everything it loads must live under /brand/ (served
//   before the gate; test-server-security.cjs checks the LAN side).
// * The stepped chip geometry (print-server/public/step-chip.js, the one copy
//   shared by the dashboard and the status window) keeps its silhouette.
//
// Run: npm run test:dashboard

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const tokensCss = read('print-server', 'public', 'brand', 'tokens.css');
const TOKENS = {};
for (const m of tokensCss.matchAll(/(--brand-[a-z0-9-]+):\s*([^;]+);/g)) TOKENS[m[1]] = m[2].trim();

const SURFACES = {
  dashboard: read('print-server', 'public', 'index.html'),
  phone: read('print-server', 'public', 'phone.html'),
  bookmarklet: read('print-server', 'public', 'bookmarklet.html'),
  'status window': read('electron-app', 'renderer', 'brand.css'),
};

console.log('dashboard chrome: every colour fallback is the kit’s own value');
{
  check('the mirror’s tokens.css parses', Object.keys(TOKENS).length > 30, `${Object.keys(TOKENS).length} tokens`);
  for (const [name, src] of Object.entries(SURFACES)) {
    const fallbacks = [...src.matchAll(/var\((--brand-[a-z0-9-]+),\s*(#[0-9A-Fa-f]{3,8})\)/g)];
    check(`the ${name} reads the kit through fallbacks`, fallbacks.length >= 10, `${fallbacks.length} found`);
    const wrong = fallbacks.filter(([, token, hex]) => !TOKENS[token] || TOKENS[token].toLowerCase() !== hex.toLowerCase())
      .map(([, token, hex]) => `${token} ${hex} (kit: ${TOKENS[token] || 'no such token'})`);
    check(`every ${name} fallback matches tokens.css`, wrong.length === 0, wrong.join('; '));
    check(`the ${name} loads the kit’s fonts`, /brand\/fonts\.css/.test(src));
    check(`the ${name} loads the kit’s tokens`, /brand\/tokens\.css/.test(src));
  }
}

console.log('\ndashboard chrome: nothing the scripts use went missing');
for (const name of ['dashboard', 'phone', 'bookmarklet']) {
  const src = SURFACES[name];
  const ids = new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...new Set([...src.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) => !ids.has(id));
  check(`every element the ${name} looks up exists (${used.length} ids)`, used.length > 0 && missing.length === 0,
    `missing: ${missing.join(', ')}`);
}
{
  const dash = SURFACES.dashboard;
  // The /health warning rule: {type, message} objects render their message,
  // and a bare string still renders rather than painting an empty box.
  check('the dashboard renders w.message for an unknown warning', /known \|\| esc\(w && w\.message\)/.test(dash));
  check('the dashboard still renders a bare-string warning', /typeof w === 'string'/.test(dash));
  const status = read('electron-app', 'renderer', 'components', 'StatusPanel.jsx');
  check('the status window renders w.message', /\{w\.message \|\| w\.type\}/.test(status));

  const tabs = [...dash.matchAll(/<(\w+)[^>]*class="tab(?: active)?"[^>]*data-tab="([a-z]+)"/g)];
  check('the dashboard has its five section tabs', tabs.length === 5, `${tabs.length} found`);
  check('every section tab is a real button (keyboard reachable)', tabs.every((t) => t[1] === 'button'),
    tabs.map((t) => t[1]).join(', '));
  check('switching tabs keeps aria-selected in step', /setAttribute\('aria-selected', 'true'\)/.test(dash));
  check('the season setting is labelled "Screen season"', />Screen season</.test(dash) && !/>Season theme</.test(dash));
  check('the header carries the Awana Clubs mark and the product name',
    /brand\/logos\/awana-clubs-white\.svg/.test(dash) && /<h1>Club Label Printer<\/h1>/.test(dash));
  check('the stepped chip is drawn by the shared step-chip.js', /<script src="\/step-chip\.js"><\/script>/.test(dash));
  check('the page still works without step-chip.js', /if \(window\.StepChip\)/.test(dash));
}

console.log('\ndashboard chrome: one hot button per surface');
{
  const count = (src, re) => (src.match(re) || []).length;
  check('the dashboard has exactly one hot button (Print leader tag)',
    count(SURFACES.dashboard, /class="btn btn-hot"/g) === 1
    && /class="btn btn-hot" onclick="printLeaderTag\(\)"/.test(SURFACES.dashboard));
  check('the phone page has exactly one hot button (Print leader tag)',
    count(SURFACES.phone, /class="btn hot"/g) === 1 && /class="btn hot" id="leader-print"/.test(SURFACES.phone));
  const wizard = read('electron-app', 'renderer', 'components', 'SetupWizard.jsx');
  const status = read('electron-app', 'renderer', 'components', 'StatusPanel.jsx');
  check('the setup wizard has exactly one hot button (Save & Start)', count(wizard, /btn-hot/g) === 1);
  check('the status window has exactly one hot button (Open Check-in Page)', count(status, /btn-hot/g) === 1
    && /btn-hot btn-block" onClick=\{\(\) => window\.awana\.openCheckinPage/.test(status));
}

console.log('\ndashboard chrome: the phone page loads only what the Wi-Fi can reach');
{
  const refs = [...SURFACES.phone.matchAll(/(?:src|href)="([^"#][^"]*)"|url\('([^']+)'\)/g)].map((m) => m[1] || m[2]);
  const local = refs.filter((r) => !/^(https?:|data:|javascript:)/.test(r));
  check('the phone page loads the kit', local.length >= 4, JSON.stringify(local));
  check('every same-origin asset the phone page loads is under /brand/', local.every((r) => r.startsWith('/brand/')),
    JSON.stringify(local.filter((r) => !r.startsWith('/brand/'))));
  const exists = local.map((r) => r.split('#')[0]).filter((r) => !fs.existsSync(path.join(root, 'print-server', 'public', r)));
  check('every one of them is in the mirror', exists.length === 0, exists.join(', '));
  const server = read('print-server', 'server.js');
  const mount = server.indexOf("app.use('/brand'");
  const gate = server.indexOf('if (LAN_PUBLIC_PATHS.has(req.path)) return next();');
  check('the brand mount sits before the PIN gate', mount > 0 && gate > mount);
  check('the brand mount serves only css, fonts and svg with plain paths',
    /BRAND_PUBLIC_PATH = \/\^\\\/\[A-Za-z0-9_\\-\/\]\+\\\.\(css\|woff2\|ttf\|svg\)\$\//.test(server));
}

console.log('\ndashboard chrome: the Windows windows ship their own copy of the kit');
{
  const css = SURFACES['status window'];
  const urls = [...css.matchAll(/@import '([^']+)'|url\('([^']+)'\)/g)].map((m) => (m[1] || m[2]).split('#')[0]);
  const base = path.join(root, 'electron-app', 'renderer');
  const missing = urls.filter((u) => !fs.existsSync(path.resolve(base, u)));
  check('the renderer imports the kit from the print server’s mirror',
    urls.length > 0 && urls.every((u) => u.startsWith('../../print-server/public/brand/')), JSON.stringify(urls));
  check('every file it names exists', missing.length === 0, missing.join(', '));
  const vite = read('electron-app', 'renderer', 'vite.config.js');
  check('Vite emits the fonts as files, never data: URIs the CSP would refuse', /assetsInlineLimit: 0/.test(vite));
  const html = read('electron-app', 'renderer', 'index.html');
  check('the window may reach its own print server (the status poll and the test print)',
    /connect-src 'self' http:\/\/localhost:3456/.test(html));
  const pkg = JSON.parse(read('electron-app', 'package.json'));
  check('electron-builder ships the renderer bundle', (pkg.build.files || []).includes('dist/**'));
  const res = (pkg.build.extraResources || []).find((r) => r.to === 'print-server');
  check('electron-builder ships the print server’s public folder (the mirror and step-chip.js)',
    !!res && (res.filter || []).includes('public/**'));
  const tab = read('electron-app', 'renderer', 'components', 'CornerTab.jsx');
  check('the window’s corner tab is drawn inline from the kit’s shape (a file:// mask would not load)',
    /brand\/shapes\/tab-b-sparks\.svg\?raw/.test(tab) && /preserveAspectRatio="none"/.test(tab));
}

console.log('\ndashboard chrome: the stepped chip');
{
  const { StepChip } = require(path.join(root, 'print-server', 'public', 'step-chip.js'));
  check('step-chip.js exposes geometry, measureEm and svg', !!StepChip && typeof StepChip.geometry === 'function'
    && typeof StepChip.measureEm === 'function' && typeof StepChip.svg === 'function');
  const short = StepChip.geometry(1, 1);
  const long = StepChip.geometry(1, 6);
  check('the value block always steps out past the label pill', short.width > 2.2 + 0.5 - 0.001, String(short.width));
  check('a longer value widens the chip instead of spilling', long.width > short.width + 4.9, `${short.width} -> ${long.width}`);
  check('the path is one closed outline', /^M[\d.]+,0 /.test(long.d) && /Z$/.test(long.d) && !/NaN/.test(long.d));
  const svg = StepChip.svg('PRINTER', 'ONLINE', { plate: 'var(--c-plate)' });
  check('the chip pins both texts with textLength', (svg.match(/textLength="/g) || []).length === 2);
  check('a custom plate is a style, so a CSS var() works', /style="fill:var\(--c-plate\)"/.test(svg));
  check('the default plate is the kit’s chip charcoal at 50%', /fill="#030404" fill-opacity="0.5"/.test(StepChip.svg('A', 'B')));
  check('chip text is escaped', !/<b>/.test(StepChip.svg('<b>', '"x"')) && /&lt;b&gt;/.test(StepChip.svg('<b>', 'x')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
