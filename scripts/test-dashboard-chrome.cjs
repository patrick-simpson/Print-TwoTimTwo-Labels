#!/usr/bin/env node
// The operator surfaces in the brand kit: the dashboard, the phone page, the
// bookmarklet page, and the Windows status window and setup wizard.
//
// Source-level, like the club-list checks in test-leaders.cjs: these pages are
// plain DOM (and a React bundle) with no headless browser here, so the claims
// that quietly stop being true are pinned against the shipped files instead.
// Where a claim is about the DOM, the page's markup is parsed with jsdom (its
// own scripts NOT run) and the page's shipped functions are run against it.
// The header chip is the exception: it is drawn from /health, so the page's
// own scripts DO run (fetch stubbed), and the status window's real component
// is bundled and rendered.
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
//   that is special on a screen; two of them and neither is. Counted by the
//   selector that paints it, in any class spelling, markup or script.
// * The section tabs: after every switch exactly one tab is aria-selected,
//   and it is the one showing (dashboard and phone page).
// * A focus ring you can see: 3:1 against every surface a control sits on.
// * The #display-key deep link is still marked under reduced motion, and a
//   card header wraps rather than clipping its button off a narrow card.
// * The pages load only what they can reach: the phone page is on the Wi-Fi
//   with no PIN yet, so everything it loads (markup, CSS and the URLs its
//   scripts set) must live under /brand/ (served before the gate;
//   test-server-security.cjs checks the LAN side).
// * The stepped chip geometry (print-server/public/step-chip.js, the one copy
//   shared by the dashboard and the status window) keeps its silhouette.
// * The chip says what /health says: PRINTER / ONLINE while the server
//   answers, PROBLEM when a warning means nothing is coming out of the printer
//   (printerNotFound, spoolerBacklog: the rule that turns the traffic light
//   red), OFFLINE when it does not answer, and back again when things
//   recover. The dashboard draws it in loadHealth() (with and without
//   step-chip.js) and the status window in StatusPanel.jsx, by the same rule,
//   so both are run through the same scenes.
//
// Run: npm run test:dashboard

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

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

// Every URL a page loads by itself: markup src/href, CSS url() (single- or
// double-quoted, or bare), and a script's `x.src = '…'` / `x.href = '…'` /
// setAttribute('src' | 'href', '…'). `script` marks the ones a script sets.
const ASSET_REF = new RegExp([
  /(?:src|href)="(?<attr>[^"#][^"]*)"/.source,
  /url\('(?<q1>[^']+)'\)/.source,
  /url\("(?<q2>[^"]+)"\)/.source,
  /url\((?<bare>[^'")\s]+)\)/.source,
  /\.(?:src|href)\s*=\s*(?<sq>['"])(?<prop>[^'"]+)\k<sq>/.source,
  /setAttribute\(\s*['"](?:src|href)['"]\s*,\s*(?<aq>['"])(?<set>[^'"]+)\k<aq>/.source,
].join('|'), 'g');
function pageAssetRefs(src) {
  return [...src.matchAll(ASSET_REF)].map(({ groups: g }) => ({
    url: g.attr || g.q1 || g.q2 || g.bare || g.prop || g.set,
    script: !!(g.prop || g.set),
  }));
}

// The page's markup as a DOM with none of its own scripts run; `win.eval`
// runs code the test hands it (the page's shipped functions, below).
function domOf(html) {
  return new JSDOM(html, { runScripts: 'outside-only' }).window;
}

// The source of one `function name(...) { ... }` in a page, found by matching
// braces while skipping strings and comments, so a test runs the function the
// page actually ships against the page's own markup.
function functionSource(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

// The text of a page's inline <script>s, and the string literals in it that
// read as a class list (lower-case tokens only), the way a script names a class.
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const classLiterals = (js) => [...js.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)]
  .map((m) => m[1] ?? m[2]).filter((t) => /^\s*[a-z][a-z0-9-]*(\s+[a-z][a-z0-9-]*)*\s*$/.test(t));

// One CSS rule's body by its exact selector, and every block of one @media.
function cssRule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[\\s};])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}
function mediaBlocks(css, query) {
  const out = [];
  let at = 0;
  for (;;) {
    const i = css.indexOf(`@media (${query})`, at);
    if (i < 0) return out;
    let depth = 0;
    let j = css.indexOf('{', i);
    const from = j + 1;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      if (css[j] === '}' && --depth === 0) break;
    }
    out.push(css.slice(from, j));
    at = j;
  }
}

// WCAG relative luminance and contrast ratio, and a page colour resolved the
// way the page writes it: a hex, or var(--x[, fallback]) through the page's
// own custom properties and then the kit's tokens.
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(full.slice(k, k + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
function cssVars(css) {
  const vars = {};
  const root = css.match(/:root\s*\{([^}]*)\}/);
  for (const m of (root ? root[1] : '').matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}
function resolveColour(value, vars, depth = 0) {
  const v = String(value || '').trim();
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(v)) return v;
  if (v === 'white') return '#ffffff';
  const m = v.match(/^var\((--[a-z0-9-]+)\s*(?:,\s*(.+))?\)$/i);
  if (!m || depth > 8) return null;
  if (vars[m[1]]) return resolveColour(vars[m[1]], vars, depth + 1);
  if (TOKENS[m[1]]) return resolveColour(TOKENS[m[1]], vars, depth + 1);
  return m[2] ? resolveColour(m[2], vars, depth + 1) : null;
}

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
  // The font fallbacks are the kit's too, and they are what a page draws in
  // when the kit's stylesheet has not arrived (or the WOFF2 is refused): each
  // surface's shout stack must start with the family tokens.css names, and no
  // surface (nor the shared chip script the dashboard and the window draw
  // with) may still name the face the kit dropped.
  const kitShout = (TOKENS['--brand-font-display'] || '').match(/^'([^']+)'/);
  check('the kit’s shout family is readable from tokens.css', !!kitShout && kitShout[1] === 'Paytone One',
    TOKENS['--brand-font-display']);
  const chipScript = read('print-server', 'public', 'step-chip.js');
  const chipView = read('electron-app', 'renderer', 'components', 'StepChip.jsx');
  for (const [name, src] of Object.entries(SURFACES)) {
    const shout = src.match(/--f-shout:\s*var\(--brand-font-display,\s*'([^']+)'/);
    check(`the ${name}’s shout fallback is the kit’s (${kitShout && kitShout[1]})`,
      !!shout && !!kitShout && shout[1] === kitShout[1], shout && shout[1]);
    check(`the ${name} does not name the shout the kit dropped`, !/galindo/i.test(src));
  }
  check('the chip script measures and falls back in the kit’s shout, not the one it dropped',
    chipScript.includes(`(family || '${kitShout && kitShout[1]}')`) && !/galindo/i.test(chipScript));
  check('the window’s chip waits for the kit’s shout before it measures',
    chipView.includes(`load?.('400 24px "${kitShout && kitShout[1]}"')`) && !/galindo/i.test(chipView));
  check('the dashboard’s chip waits for the kit’s shout too',
    SURFACES.dashboard.includes(`document.fonts.load('400 24px "${kitShout && kitShout[1]}"')`));
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
  check('the season setting is labelled "Screen season"', />Screen season</.test(dash) && !/>Season theme</.test(dash));
  check('the header carries the Awana Clubs mark and the product name',
    /brand\/logos\/awana-clubs-white\.svg/.test(dash) && /<h1>Club Label Printer<\/h1>/.test(dash));
  check('the stepped chip is drawn by the shared step-chip.js', /<script src="\/step-chip\.js"><\/script>/.test(dash));
  check('the page still works without step-chip.js', /if \(window\.StepChip\)/.test(dash));
}

console.log('\ndashboard chrome: one hot button per surface');
{
  // Counted as the stylesheet sees them: every element the hot selector
  // matches, whatever else its class list says and in whatever order
  // (`btn btn-hot btn-sm` is the page's own house spelling for a small
  // button), plus any class list a script could hand out at run time.
  const count = (src, re) => (src.match(re) || []).length;
  const dash = domOf(SURFACES.dashboard).document;
  const dashHot = [...dash.querySelectorAll('.btn-hot')];
  check('the dashboard has exactly one hot button (Print leader tag)',
    dashHot.length === 1 && dashHot[0].getAttribute('onclick') === 'printLeaderTag()',
    dashHot.map((b) => b.outerHTML.slice(0, 80)).join(' | '));
  const dashScripted = classLiterals(inlineScripts(SURFACES.dashboard)).filter((t) => t.split(/\s+/).includes('btn-hot'));
  check('no dashboard script builds a second hot button', dashScripted.length === 0, JSON.stringify(dashScripted));
  const phone = domOf(SURFACES.phone).document;
  const phoneHot = [...phone.querySelectorAll('.btn.hot')];
  check('the phone page has exactly one hot button (Print leader tag)',
    phoneHot.length === 1 && phoneHot[0].id === 'leader-print', phoneHot.map((b) => b.outerHTML.slice(0, 80)).join(' | '));
  const phoneScripted = classLiterals(inlineScripts(SURFACES.phone)).filter((t) => t.split(/\s+/).includes('hot'));
  check('no phone-page script builds a second hot button', phoneScripted.length === 0, JSON.stringify(phoneScripted));
  const wizard = read('electron-app', 'renderer', 'components', 'SetupWizard.jsx');
  const status = read('electron-app', 'renderer', 'components', 'StatusPanel.jsx');
  check('the setup wizard has exactly one hot button (Save & Start)', count(wizard, /btn-hot/g) === 1);
  check('the status window has exactly one hot button (Open Check-in Page)', count(status, /btn-hot/g) === 1
    && /btn-hot btn-block" onClick=\{\(\) => window\.awana\.openCheckinPage/.test(status));
}

console.log('\ndashboard chrome: the section tabs keep aria-selected in step');
{
  // The shipped showTab() / setTab(), run against the page's own markup:
  // after every switch exactly ONE tab says it is selected, and it is the
  // one that is showing. The visible state rides a class, so nothing on
  // screen would give a stale aria-selected away.
  const selected = (doc) => [...doc.querySelectorAll('[role="tab"][aria-selected="true"]')];
  {
    const win = domOf(SURFACES.dashboard);
    const doc = win.document;
    const src = functionSource(SURFACES.dashboard, 'showTab');
    check('the dashboard ships showTab()', !!src);
    win.eval(src || '');
    const names = [...doc.querySelectorAll('.tab[data-tab]')].map((t) => t.getAttribute('data-tab'));
    const first = selected(doc);
    check('the dashboard starts with one selected tab, the active one',
      first.length === 1 && first[0].classList.contains('active'), first.map((t) => t.getAttribute('data-tab')).join(', '));
    for (const n of [...names.slice().reverse(), ...names]) {
      if (typeof win.showTab === 'function') win.showTab(n);
      const sel = selected(doc);
      const shown = doc.querySelector('.tab-content.active');
      check(`dashboard showTab('${n}') leaves exactly that tab selected`,
        sel.length === 1 && sel[0].getAttribute('data-tab') === n && sel[0].classList.contains('active')
        && !!shown && shown.id === `tab-${n}`, sel.map((t) => t.getAttribute('data-tab')).join(', ') || 'none');
    }
    // The deep link (#display-key, the extension's link) lands on Settings
    // with the one tab selected and the block marked for the highlight.
    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.eval(functionSource(SURFACES.dashboard, 'jumpToDisplayKey') || '');
    win.eval(functionSource(SURFACES.dashboard, 'jumpToDisplayLogin') || '');
    for (const [fn, id] of [['jumpToDisplayKey', 'display-key-section'], ['jumpToDisplayLogin', 'display-login-section']]) {
      if (typeof win.showTab === 'function') win.showTab('history');
      if (typeof win[fn] === 'function') win[fn]();
      const sel = selected(doc);
      check(`${fn}() opens Settings, selected, and marks #${id} for the highlight`,
        sel.length === 1 && sel[0].getAttribute('data-tab') === 'settings'
        && !!doc.getElementById(id) && doc.getElementById(id).classList.contains('flash'));
    }
  }
  {
    const win = domOf(SURFACES.phone);
    const doc = win.document;
    const src = functionSource(SURFACES.phone, 'setTab');
    check('the phone page ships setTab()', !!src);
    // setTab() catches the Tonight and Not-here views up; those are the
    // page's network half, not the tabs', so they are stubbed here.
    win.eval('var activeTab; function refreshTonight() {} function renderWaiting() {}');
    win.eval(src || '');
    check('the phone tabs sit in a tablist', !!doc.querySelector('[role="tablist"] [role="tab"]'));
    const names = [...doc.querySelectorAll('.tab[data-tab]')].map((t) => t.getAttribute('data-tab'));
    const first = selected(doc);
    check('the phone page starts with one selected tab, the lit one',
      first.length === 1 && first[0].classList.contains('on'), first.map((t) => t.getAttribute('data-tab')).join(', '));
    for (const n of [...names.slice().reverse(), ...names]) {
      if (typeof win.setTab === 'function') win.setTab(n);
      const sel = selected(doc);
      const view = doc.getElementById(`${n}-view`);
      check(`phone setTab('${n}') leaves exactly that tab selected`,
        sel.length === 1 && sel[0].getAttribute('data-tab') === n && sel[0].classList.contains('on')
        && !!view && view.style.display === 'block', sel.map((t) => t.getAttribute('data-tab')).join(', ') || 'none');
    }
  }
}

console.log('\ndashboard chrome: a focus ring you can see (3:1 against what it sits on)');
{
  // Every surface a keyboard control sits on, found by tabbing through each
  // page in Chromium: the ring is drawn 2px OUTSIDE the control, so what it
  // is read against is the field behind it, not the control's own fill.
  const ON = {
    dashboard: { card: '#ffffff', page: 'var(--page)', 'leader chip': 'var(--c-cream)',
      'failed history row': 'var(--bad-tint)', 'update banner': 'var(--c-sun)' },
    phone: { card: '#ffffff', page: 'var(--page)', header: 'var(--c-blue)', 'leader chip': 'var(--c-cream)' },
    bookmarklet: { card: '#ffffff', page: 'var(--page)' },
    'status window': { card: '#ffffff', page: 'var(--page)', 'failure notice': 'var(--c-sparks-tint)' },
  };
  for (const [name, css] of Object.entries(SURFACES)) {
    const vars = cssVars(css);
    const rule = cssRule(css, ':focus-visible');
    const m = rule && rule.match(/outline:\s*(\d+)px\s+solid\s+([^;]+);/);
    const ring = m && resolveColour(m[2], vars);
    check(`the ${name} draws its own focus ring (a solid outline of 2px or more)`, !!ring && Number(m[1]) >= 2, rule);
    if (!ring) continue;
    for (const [where, value] of Object.entries(ON[name])) {
      const bg = resolveColour(value, vars);
      const r = bg ? contrast(ring, bg) : 0;
      check(`the ${name} focus ring is 3:1 or better on the ${where}`, r >= 3, `${ring} on ${bg}: ${r.toFixed(2)}:1`);
    }
  }
  // The phone's toast is the one dark field with a control on it (Undo).
  const vars = cssVars(SURFACES.phone);
  const toastBg = resolveColour((cssRule(SURFACES.phone, '.toast') || '').match(/background:\s*([^;]+);/)?.[1], vars);
  const toastRing = resolveColour((cssRule(SURFACES.phone, '.toast :focus-visible') || '').match(/outline-color:\s*([^;]+);/)?.[1], vars)
    || resolveColour((cssRule(SURFACES.phone, ':focus-visible') || '').match(/outline:\s*\d+px\s+solid\s+([^;]+);/)?.[1], vars);
  check('the phone toast’s Undo ring is 3:1 or better on the ink toast', !!toastBg && !!toastRing && contrast(toastRing, toastBg) >= 3,
    `${toastRing} on ${toastBg}`);
}

console.log('\ndashboard chrome: the deep-link highlight under reduced motion');
{
  // #display-key / #display-login land on a block marked .flash, drawn as a
  // ::after wash whose ONLY visible frames are its fade. The reduced-motion
  // blanket rule cancels every animation, so without a still of its own a
  // reduced-motion operator lands on an unmarked block.
  const dash = SURFACES.dashboard;
  const base = cssRule(dash, '.flash::after') || '';
  const baseAnim = base.match(/animation:\s*([a-z-]+)\s+([\d.]+m?s)/);
  const reduced = mediaBlocks(dash, 'prefers-reduced-motion: reduce').join('\n');
  check('reduced motion still cancels every animation', /\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none !important/.test(reduced));
  const still = cssRule(reduced, '.flash::after') || '';
  const anim = still.match(/animation:\s*([a-z-]+)\s+([\d.]+m?s)([^;]*);/);
  check('reduced motion gives the highlight a still of its own, winning over the blanket rule',
    !!anim && /!important/.test(anim[3]) && !/infinite/.test(anim[3]), still.trim());
  const frames = anim && (dash.match(new RegExp(`@keyframes ${anim[1]}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`)) || [])[1];
  const opacities = [...String(frames || '').matchAll(/opacity:\s*([\d.]+)/g)].map((x) => Number(x[1]));
  check('that still is visible for its whole run and never changes (no in-between frames)',
    opacities.length > 0 && opacities.every((o) => o > 0 && o === opacities[0]), JSON.stringify(opacities));
  check('it lasts as long as the fade everyone else sees', !!anim && !!baseAnim && anim[2] === baseAnim[2],
    `${anim && anim[2]} vs ${baseAnim && baseAnim[2]}`);
}

console.log('\ndashboard chrome: card headers reflow instead of clipping');
{
  // A card clips (overflow: hidden, for the corner tab), so a header control
  // that cannot sit beside its tab must wrap under it: at 320 CSS px (400%
  // zoom) "Set up the display key" was cut off the privacy card.
  const dash = SURFACES.dashboard;
  check('cards clip their overflow (why the header must wrap)', /overflow:\s*hidden/.test(cssRule(dash, '.card') || ''));
  check('a card header wraps', /flex-wrap:\s*wrap/.test(cssRule(dash, '.card-header') || ''), cssRule(dash, '.card-header'));
  check('a wrapped header control stays right-aligned, inside the card',
    /margin-left:\s*auto/.test(cssRule(dash, '.card-header > :not(.corner-tab)') || ''));
  check('a header button keeps its label on one line', /white-space:\s*nowrap/.test(cssRule(dash, '.card-header .btn') || ''));
}

console.log('\ndashboard chrome: the phone page loads only what the Wi-Fi can reach');
{
  // Markup attributes, CSS url()s, and every URL a script assigns to .src /
  // .href or through setAttribute: the tab-shape probe is one of those, and a
  // script-set path outside /brand/ 403s on the Wi-Fi exactly like a tag's.
  const refs = pageAssetRefs(SURFACES.phone).filter((r) => !/^(https?:|data:|javascript:)/.test(r.url));
  const local = refs.map((r) => r.url);
  check('the phone page’s script-set assets are collected too (the tab-shape probe)',
    refs.some((r) => r.script && r.url === '/brand/shapes/tab-b-sparks.svg'), JSON.stringify(refs.filter((r) => r.script)));
  check('the phone page’s stylesheet url()s are collected (the tab mask)',
    refs.some((r) => !r.script && r.url.startsWith('/brand/shapes/tab-b-sparks.svg#svgView(')), JSON.stringify(local));
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

// ── The chip says what /health says ─────────────────────────────────────────
// The header chip is the one status line at the top of both windows, and on
// the dashboard nothing else draws it while the server answers (the old badge
// was written at the top of loadHealth's .then; this call replaced it). A
// chip that stays blank, or stays OFFLINE after the server comes back, would
// pass every static check above, so both surfaces are RUN here.
//
// In order, on one dashboard: each scene follows the last, so a chip that
// never leaves a state (PROBLEM after the printer is back, OFFLINE after the
// server is) fails too. Only printerNotFound and spoolerBacklog mean nothing
// is printing; any other warning is "attention", and the chip stays ONLINE.
const HEALTHY = { status: 'ok', version: '6.16.0', printer: 'Zebra ZD421', uptime: 3600, warnings: [] };
const answers = (body) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const warns = (...warnings) => answers({ ...HEALTHY, warnings });
const noAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
const CHIP_SCENES = [
  ['a healthy server', answers(HEALTHY), 'online'],
  ['a missing printer', warns({ type: 'printerNotFound', message: 'Printer "Zebra ZD421" not found' }), 'problem'],
  ['a printer check that failed (still printing)',
    warns({ type: 'printerCheckFailed', message: 'Could not check printer status' }), 'online'],
  ['a jammed print queue beside a stale roster',
    warns({ type: 'csvStale', message: 'Roster is 3 days old' }, { type: 'spoolerBacklog', message: '4 jobs waiting' }), 'problem'],
  ['a bare-string warning from an older server', warns('Roster is stale'), 'online'],
  ['no answer at all', noAnswer, 'offline'],
  ['the server back again', answers(HEALTHY), 'online'],
];
const CHIP = {
  online: { word: 'ONLINE', say: 'Printer online', plate: 'var(--c-plate)' },
  problem: { word: 'PROBLEM', say: 'Printer problem, see the warnings', plate: 'var(--c-hot-deep)' },
  offline: { word: 'OFFLINE', say: 'Print server offline', plate: 'var(--bad)' },
};

// A jsdom console that keeps the page's own errors (an uncaught throw in its
// scripts) and drops "Not implemented" (jsdom has no canvas, so step-chip.js
// measures by its rough table, which is what it is for).
function pageConsole() {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (!/^Not implemented:/.test(e.message)) errors.push(e.message); });
  return { errors, virtualConsole };
}

// The dashboard with its own scripts running. fetch is stubbed: /health
// answers the way the current scene says, and every other loader waits
// forever so nothing else touches the page. With `stepChip`, step-chip.js is
// run exactly where its <script> tag sits (jsdom loads no files by itself).
function runDashboard(stepChip) {
  let health = () => new Promise(() => {});
  const { errors, virtualConsole } = pageConsole();
  const tag = '<script src="/step-chip.js"></script>';
  const html = stepChip
    ? SURFACES.dashboard.replace(tag, () => `<script>${read('print-server', 'public', 'step-chip.js')}</script>`)
    : SURFACES.dashboard;
  const { window: win } = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:3456/',
    virtualConsole,
    beforeParse(w) { w.fetch = (url) => (/\/health$/.test(String(url)) ? health() : new Promise(() => {})); },
  });
  return { win, errors, answer(fn) { health = fn; } };
}

// The status window's own StatusPanel.jsx, bundled the way Vite builds it
// (React, the kit's SVGs, `?raw` for the corner tab), as one script to run
// inside a jsdom window. esbuild is Vite's own, found through Vite.
async function statusWindowBundle() {
  const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite/package.json'))] }));
  const raw = {
    name: 'raw',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }));
    },
  };
  const out = await esbuild.build({
    stdin: {
      contents: "import React from 'react'; import { createRoot } from 'react-dom/client';"
        + " import StatusPanel from './components/StatusPanel.jsx'; export { React, createRoot, StatusPanel };",
      resolveDir: path.join(root, 'electron-app', 'renderer'),
      loader: 'jsx',
    },
    bundle: true,
    format: 'iife',
    globalName: 'StatusHarness',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.svg': 'dataurl' },
    plugins: [raw],
    write: false,
    logLevel: 'silent',
  });
  return out.outputFiles[0].text;
}

// One status window, rendered fresh (it polls every 5 s, so one scene per
// window), read once its first /health poll has landed. The poll asks the
// main process for its view straight after setting the health state, and
// React renders on this window's own timers, so one timer after that call
// reads the committed chip.
async function statusWindowChip(bundle, health, serverState) {
  const { errors, virtualConsole } = pageConsole();
  const { window: win } = new JSDOM('<!doctype html><div id="root"></div>',
    { runScripts: 'outside-only', url: 'file:///C:/app/dist/index.html', virtualConsole });
  let polled;
  const donePolling = new Promise((r) => { polled = r; });
  win.fetch = () => health();
  win.awana = {
    getServerState: () => { polled(); return Promise.resolve(serverState); },
    getLanAddress: () => Promise.resolve(null),
  };
  try {
    win.eval(bundle);
    const { React, createRoot, StatusPanel } = win.StatusHarness;
    createRoot(win.document.getElementById('root')).render(React.createElement(StatusPanel,
      { config: { printerName: 'Zebra ZD421', checkinUrl: 'https://example.twotimtwo.com/clubber/checkin' }, onReset() {} }));
    let giveUp;
    await Promise.race([donePolling, new Promise((r) => { giveUp = setTimeout(r, 5000); })]);
    clearTimeout(giveUp);
    await new Promise((r) => win.setTimeout(r, 20));
    const chip = win.document.querySelector('.app-header .step-chip, .app-header .chip-fallback');
    const plate = chip && chip.querySelector('path');
    return { label: chip && chip.getAttribute('aria-label'), plate: plate && plate.getAttribute('style'), errors };
  } catch (e) {
    errors.push(e && e.message);
    return { label: null, plate: null, errors };
  } finally {
    win.close();
  }
}

async function chipSections() {
  console.log('\ndashboard chrome: the header chip says what /health says (the dashboard)');
  for (const stepChip of [true, false]) {
    const page = runDashboard(stepChip);
    const doc = page.win.document;
    const how = stepChip ? 'as the stepped chip' : 'in plain words (no step-chip.js)';
    check(`the dashboard’s own scripts run ${stepChip ? 'with' : 'without'} step-chip.js`,
      typeof page.win.loadHealth === 'function' && page.errors.length === 0, page.errors.join('; '));
    for (const [scene, health, state] of CHIP_SCENES) {
      page.answer(health);
      if (typeof page.win.loadHealth === 'function') page.win.loadHealth();
      await new Promise((r) => setTimeout(r, 0));
      const el = doc.getElementById('status-badge');
      const want = CHIP[state];
      const say = el.getAttribute('aria-label');
      const drawn = stepChip
        ? !!el.querySelector('svg') && el.innerHTML.includes(`>${want.word}</text>`) && el.innerHTML.includes(`style="fill:${want.plate}"`)
        : el.textContent === `Printer \u00B7 ${want.word[0]}${want.word.slice(1).toLowerCase()}`;
      check(`dashboard, ${scene}: the header chip reads PRINTER / ${want.word} ${how}`,
        say === want.say && el.title === want.say && drawn,
        `aria-label ${JSON.stringify(say)}: ${el.innerHTML.slice(0, 200) || '(blank)'}`);
    }
    check(`the dashboard’s scripts raised no error through the scenes (${stepChip ? 'with' : 'without'} step-chip.js)`,
      page.errors.length === 0, page.errors.join('; '));
    page.win.close();
  }

  console.log('\ndashboard chrome: the header chip says what /health says (the status window)');
  let bundle = null;
  try {
    bundle = await statusWindowBundle();
  } catch (e) {
    check('StatusPanel.jsx bundles for the check', false, e && e.message);
    return;
  }
  const scenes = [
    ...CHIP_SCENES.map(([scene, health, state]) => [scene, health, state, { status: 'running', error: null }]),
    ['the main process says the server failed to start', answers(HEALTHY), 'offline',
      { status: 'failed', error: 'Error: listen EADDRINUSE: address already in use :::3456' }],
  ];
  for (const [scene, health, state, serverState] of scenes) {
    const want = CHIP[state];
    const got = await statusWindowChip(bundle, health, serverState);
    check(`status window, ${scene}: the header chip reads PRINTER / ${want.word}`,
      got.label === `PRINTER ${want.word}` && new RegExp(`fill:\\s*${want.plate.replace(/[()]/g, '\\$&')}`).test(got.plate || '')
      && got.errors.length === 0,
      `${JSON.stringify(got.label)} on ${JSON.stringify(got.plate)}${got.errors.length ? `; ${got.errors.join('; ')}` : ''}`);
  }
}

chipSections()
  .catch((e) => check('the header chip checks ran to the end', false, e && e.stack))
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
