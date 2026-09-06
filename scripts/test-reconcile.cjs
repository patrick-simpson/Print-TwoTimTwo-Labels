#!/usr/bin/env node
// Tests for "is the number of clubbers checked in accurate?" — the comparison
// between what this print server printed and what TwoTimTwo itself recorded.
//
// WHAT THIS GUARDS
//
// * The two directions mean opposite things and must never be conflated.
//   Short (ours < theirs) is the one a volunteer has to act on: a child was
//   checked in and is wearing no label. Over (ours > theirs) is usually a
//   walk-in guest printed without "Also register in TwoTimTwo", which is a
//   supported way to work — so those are subtracted before anything is
//   called wrong, and a SHORTFALL is never softened by them.
// * "I could not read the report" must never arrive as a zero. A zero is a
//   real count (nobody checked in yet). The parser returns null instead, and
//   the endpoint refuses a body it cannot read.
// * The parser reads the report TwoTimTwo actually serves. The fixture below
//   is the real page's shape — per-club tables whose totals row is
//   <tfoot><tr class='totals'>Count: N</tr>, single-quoted, with the club
//   name only in the heading crest's alt text. The previous fallback hunted
//   for `undoCheckin` controls, of which that page has exactly zero, so a
//   change to the totals row would have silently reported an empty club night.
// * Club names from two sources ("T&T" vs "T&amp;T ", "Cubbies ") fold
//   through the SAME clubKey() the labels use, so a club can never be
//   double-counted under two spellings.
// * A stale second opinion is reported as unknown, never as agreement.
//
// Run: npm run test:reconcile

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');

const PORT = Number(process.env.AWANA_TEST_PORT || 34593);
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

const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher { trigger() { return Promise.resolve(); } };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

// ── The real report's shape ───────────────────────────────────────────────────
// Copied from the live kvbchurch.twotimtwo.com/clubber/checkin_report markup
// (structure only — no child's name was kept). The details that bite:
//   * the club is named ONLY by its crest's alt text, and that crest sits in
//     its own <thead><tr> AHEAD of the column headers — so anything reading
//     "the first thead row" reads the crest, not the headers;
//   * the totals row is single-quoted `<tr class='totals'>`;
//   * every row opens a fresh unclosed <tbody>;
//   * each row carries BOTH a /meeting/clubberCheckin/{id} edit link and an
//     onclick='undoCheckin({id})' control — two controls, one child.
function clubTable(club, n, opts = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = opts.idBase + i;
    rows.push(
      `<tbody><tr><td>` +
      `<a class='noprint' href='/meeting/clubberCheckin/${id}?CAL=368'><i class='fa fa-pencil'></i></a>` +
      `<a href='#' class='noprint pull-right' onclick='undoCheckin(${id})'></a></td>` +
      `<td>Kid ${i}</td>${opts.friend ? `<td>${i === 0 ? 'Yes' : 'No'}</td>` : ''}</tr>`
    );
  }
  const totals = opts.noTotals
    ? ''
    : `<tfoot><tr class='totals'><td><i>Count: ${n}</i></td><td><div>Total Shares: ${n}</div></td></tr></tfoot>`;
  return (
    `<table class="table"><thead>` +
    `<tr><th colspan=4 class="title"><div style='float:right'></div>` +
    `<img height="30" class=" club-icon-30" src="/images/clubs/x.png" alt="${club}" /></th></tr>` +
    `<tr><th>2026-09-02</th><th>Clubber</th>${opts.friend ? '<th>Brought a friend</th>' : ''}</tr>` +
    `</thead>${rows.join('')}${totals}</table>`
  );
}
const REAL_REPORT =
  '<html><body><table class="table"><tbody><tr><td>Title</td></tr></tbody></table>' +
  clubTable('Cubbies ', 14, { idBase: 1000 }) +
  clubTable('Sparks ', 29, { idBase: 2000, friend: true }) +
  clubTable('T&amp;T ', 26, { idBase: 3000, friend: true }) +
  clubTable('Puggles', 6, { idBase: 4000 }) +
  clubTable('Trek', 21, { idBase: 5000, friend: true }) +
  clubTable('Journey', 5, { idBase: 6000 }) +
  '</body></html>';

// feeds.js is a browser IIFE, so the parser under test is lifted out of the
// shipped file and given exactly what it needs — the same idiom as
// test-checkout-parser.cjs, so the code exercised here is the code that runs
// in the volunteer's browser rather than a copy that can drift from it.
function loadParser() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'feeds.js'), 'utf8');
  const start = src.indexOf('  function parseCheckinReport(html) {');
  const end = src.indexOf('  var AWARD_RE = /award/i;');
  if (start < 0 || end < 0) throw new Error('parseCheckinReport not found in feeds.js');
  const factory = new Function('DOMParser', 'isLoginPage', `
    ${src.slice(start, end)}
    return parseCheckinReport;
  `);
  return factory(
    new JSDOM('').window.DOMParser,
    (text) => {
      if (typeof text !== 'string' || !text) return true;
      if (text.indexOf('Login Required') !== -1) return true;
      return /<html/i.test(text) && /login/i.test(text) && /password/i.test(text);
    },
  );
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-reconcile-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', checkinUrl: 'https://example.com/checkin',
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const { compareCounts, SOURCE_COUNT_STALE_MS } = server;
  const listener = server.startListening();
  await new Promise((r) => (listener.listening ? r() : listener.once('listening', r)));

  const NOW = Date.UTC(2026, 8, 2, 23, 0, 0);
  const ours = (checkedIn, byClub, extra = {}) => ({
    date: '2026-09-02', checkedIn, byClub, unregistered: 0, unregisteredByClub: {}, ...extra,
  });
  const theirs = (checkedIn, byClub, at = NOW) => ({ date: '2026-09-02', checkedIn, byClub, at });

  // ── 1. The parser reads the real page shape ────────────────────────────────
  console.log('\nreconcile: reading TwoTimTwo\'s report');
  {
    const parse = loadParser();
    const got = parse(REAL_REPORT);
    check('reads the real report', got !== null);
    check('total matches the attendance summary (101)', got && got.checkedIn === 101, got && String(got.checkedIn));
    check('per-club counts are right', got && JSON.stringify(got.byClub) === JSON.stringify({
      'Cubbies': 14, 'Sparks': 29, 'T&T': 26, 'Puggles': 6, 'Trek': 21, 'Journey': 5,
    }), got && JSON.stringify(got.byClub));
    check('the decorative title table is not counted as a club',
      got && Object.keys(got.byClub).length === 6, got && String(Object.keys(got.byClub).length));
    check('counts "brought a friend" only where the column exists',
      got && got.friendsBrought === 3, got && String(got.friendsBrought));

    // The failure that mattered: no totals row at all. The OLD fallback hunted
    // for undoCheckin controls this page has never had, and would report 0.
    const noTotals =
      '<html><body>' + clubTable('Cubbies', 14, { idBase: 1000, noTotals: true }) +
      clubTable('Sparks', 29, { idBase: 2000, noTotals: true }) + '</body></html>';
    const fell = parse(noTotals);
    check('falls back to the per-child links when the totals row is gone',
      fell && fell.checkedIn === 43, fell && String(fell.checkedIn));
    check('the fallback keeps per-club counts',
      fell && fell.byClub.Cubbies === 14 && fell.byClub.Sparks === 29);

    check('a login bounce reads as unknown, not an empty club night', parse('<html><body>login password</body></html>') === null);
    check('"Login Required" reads as unknown', parse('Login Required') === null);
    check('a page with no club tables reads as unknown', parse('<html><body><table><tr><td>x</td></tr></table></body></html>') === null);
    check('empty input reads as unknown', parse('') === null);
    // A real, genuine zero must still be reportable.
    const empty = parse('<html><body>' + clubTable('Cubbies', 0, { idBase: 1 }) + '</body></html>');
    check('a club night nobody attended is 0, not null', empty && empty.checkedIn === 0);
  }

  // ── 2. Agreement ───────────────────────────────────────────────────────────
  console.log('\nreconcile: agreement');
  {
    const v = compareCounts(ours(101, { Cubbies: 14, Sparks: 29, 'T&T': 26, Puggles: 6, Trek: 21, Journey: 5 }),
      theirs(101, { Cubbies: 14, Sparks: 29, 'T&T': 26, Puggles: 6, Trek: 21, Journey: 5 }), NOW);
    check('a matching night matches', v.known && v.matches === true);
    check('direction reads as match', v.direction === 'match');
    check('no club is flagged', v.byClub.every((c) => c.unexplained === 0));
    check('every club is still listed', v.byClub.length === 6);
  }

  // ── 3. Short: a child checked in with no label ──────────────────────────────
  console.log('\nreconcile: short (the one to act on)');
  {
    const v = compareCounts(ours(99, { Cubbies: 14, Sparks: 27, 'T&T': 26, Puggles: 6, Trek: 21, Journey: 5 }),
      theirs(101, { Cubbies: 14, Sparks: 29, 'T&T': 26, Puggles: 6, Trek: 21, Journey: 5 }), NOW);
    check('a shortfall does not match', v.known && v.matches === false);
    check('direction names missing labels', v.direction === 'missing-labels', v.direction);
    check('the gap is reported', v.diff === -2 && v.unexplained === -2);
    check('the short club is named first', v.byClub[0].club === 'Sparks', v.byClub[0].club);
    check('the short club shows its own gap', v.byClub[0].unexplained === -2);

    // A shortfall must NEVER be explained away by unregistered walk-ins.
    const withWalkIns = compareCounts(
      ours(99, { Sparks: 99 }, { unregistered: 40, unregisteredByClub: { Sparks: 40 } }),
      theirs(101, { Sparks: 101 }), NOW);
    check('walk-ins never soften a shortfall', withWalkIns.unexplained === -2, String(withWalkIns.unexplained));
    check('...and it still reads as missing labels', withWalkIns.direction === 'missing-labels');
  }

  // ── 4. Over: usually walk-ins, and provably so ─────────────────────────────
  console.log('\nreconcile: over');
  {
    const explained = compareCounts(
      ours(104, { Sparks: 104 }, { unregistered: 3, unregisteredByClub: { Sparks: 3 } }),
      theirs(101, { Sparks: 101 }), NOW);
    check('an excess fully covered by walk-ins is not a problem', explained.matches === true);
    check('...and says so', explained.direction === 'match');
    check('...while still reporting the raw gap', explained.diff === 3 && explained.explained === 3);

    const partly = compareCounts(
      ours(104, { Sparks: 104 }, { unregistered: 1, unregisteredByClub: { Sparks: 1 } }),
      theirs(101, { Sparks: 101 }), NOW);
    check('an excess beyond the walk-ins is flagged', partly.matches === false);
    check('...only for the part walk-ins cannot explain', partly.unexplained === 2, String(partly.unexplained));
    check('...and reads as extra labels', partly.direction === 'extra-labels');
  }

  // ── 5. Club names from two sources fold together ───────────────────────────
  console.log('\nreconcile: club-name folding');
  {
    const v = compareCounts(ours(26, { 'T&T': 26 }), theirs(26, { 'T&amp;T ': 26 }), NOW);
    check('"T&amp;T " and "T&T" are one club', v.byClub.length === 1, JSON.stringify(v.byClub));
    check('...and it matches', v.matches === true);
    const cased = compareCounts(ours(14, { 'cubbies': 14 }), theirs(14, { 'Cubbies ': 14 }), NOW);
    check('case and padding fold too', cased.byClub.length === 1 && cased.matches === true);
    // An unknown club must not silently merge into a known one.
    const unknown = compareCounts(ours(2, { 'No club': 2 }), theirs(2, { Trek: 2 }), NOW);
    check('an unknown club stays its own row', unknown.byClub.length === 2, JSON.stringify(unknown.byClub));
  }

  // ── 6. Unknown is not agreement ────────────────────────────────────────────
  console.log('\nreconcile: unknown');
  {
    const none = compareCounts(ours(101, { Sparks: 101 }), null, NOW);
    check('no second opinion reads as unknown', none.known === false && none.reason === 'no-source');
    check('...and never claims a match', none.matches === undefined);

    const stale = compareCounts(ours(101, { Sparks: 101 }),
      theirs(101, { Sparks: 101 }, NOW - SOURCE_COUNT_STALE_MS - 1), NOW);
    check('a stale second opinion reads as unknown', stale.known === false && stale.reason === 'stale');
    check('...even when the numbers happen to agree', stale.matches === undefined);

    const otherDay = compareCounts(ours(101, { Sparks: 101 }),
      { date: '2026-08-26', checkedIn: 101, byClub: { Sparks: 101 }, at: NOW }, NOW);
    check('last week\'s report is not tonight\'s second opinion', otherDay.known === false);
  }

  // ── 7. The endpoints ───────────────────────────────────────────────────────
  console.log('\nreconcile: endpoints');
  {
    const today = new Date().toISOString().slice(0, 10);
    check('unknown before anything is posted', (await j('/reconcile')).body.known === false);

    const bad = [
      { checkedIn: 5 },                                  // no date
      { date: 'today', checkedIn: 5 },                   // unparseable date
      { date: today, checkedIn: -1 },                    // negative
      { date: today, checkedIn: 1.5 },                   // non-integer
      { date: today, checkedIn: '5' },                   // string
      { date: today },                                   // missing count
    ];
    let refused = 0;
    for (const b of bad) if ((await post('/feed/source-count', b)).status === 400) refused++;
    check('every unreadable body is refused', refused === bad.length, `${refused}/${bad.length}`);
    check('...and none of them became a stored zero', (await j('/reconcile')).body.known === false);

    const ok = await post('/feed/source-count', { date: today, checkedIn: 0, byClub: { Sparks: 0 } });
    check('a genuine zero IS accepted', ok.status === 200);
    const now = (await j('/reconcile')).body;
    check('a zero night is known and matching', now.known === true && now.matches === true);
    check('POST /reconcile answers too (the phone page is POST-only)',
      (await post('/reconcile')).body.known === true);

    await post('/feed/source-count', { date: today, checkedIn: 3, byClub: { Sparks: 3 }, junk: 'x' });
    const short = (await j('/reconcile')).body;
    check('with no labels printed, three checked in reads as short',
      short.direction === 'missing-labels' && short.unexplained === -3, JSON.stringify(short.unexplained));
    check('a non-numeric club is dropped rather than stored',
      (await post('/feed/source-count', { date: today, checkedIn: 1, byClub: { Sparks: 'x' } })).status === 200 &&
      (await j('/reconcile')).body.byClub.every((c) => Number.isFinite(c.theirs)));
  }

  listener.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  __suiteFinished = true;
  process.exit(1);
});
