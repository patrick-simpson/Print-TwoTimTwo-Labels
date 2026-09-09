#!/usr/bin/env node
// Tests for the attendance audit (#311) — the season ledger (attendance.json)
// against TwoTimTwo's own attendance grid.
//
// WHAT THIS GUARDS
//
// * UNKNOWN IS NOT ZERO. A grid that was never read, is stale, or whose cell
//   encoding could not be confirmed reports `known: false` with a reason. It
//   must never come back as `matches: true`, and never as "these children
//   attended nothing".
// * The cell encoding is NOT documented — only the header is — so the parser
//   cross-checks its own count of present cells against TwoTimTwo's own "#"
//   column for EVERY row. One disagreement discards the whole club.
// * The grid's date columns carry no year ("Sep02"), so the year comes from
//   the Aug-1 Awana season boundary, not from a parameter the site echoed.
// * APPLY IS ADDITIVE ONLY. The ledger legitimately holds walk-in guests
//   TwoTimTwo never saw, so a ledger-only date is information, never an error
//   to delete. Nothing is ever removed, no ledger entry is ever created, and
//   ambiguous / never-printed children gain nothing.
// * The audit is operator-local: nothing it touches reaches events.js, the
//   display contract or the print path.
//
// Run: npm run test:audit

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34597);
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

// The grid parser lives inside feeds.js's browser IIFE, so it is lifted out of
// the SHIPPED file (same idiom as test-reconcile.cjs / test-checkout-parser.cjs)
// — the code exercised here is the code that runs in the volunteer's browser.
function loadGridParser() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'feeds.js'), 'utf8');
  const start = src.indexOf('  var GRID_MAX_ROWS = 600;');
  const end = src.indexOf('  // NOTE: unlike runWorksheets/runCompletedBooks');
  if (start < 0 || end < 0) throw new Error('the attendance-grid parser was not found in feeds.js');
  const parseCsvSrc = (() => {
    const s = src.indexOf('  function parseCsvText(text) {');
    const e = src.indexOf('  // TwoTimTwo CSV exports end with footer/blank lines');
    if (s < 0 || e < 0) throw new Error('parseCsvText not found in feeds.js');
    return src.slice(s, e);
  })();
  const footerSrc = (() => {
    const s = src.indexOf('  function isFooterOrBlankRow(row) {');
    const e = src.indexOf('  function getCalendarIdFromPage() {');
    if (s < 0 || e < 0) throw new Error('isFooterOrBlankRow not found in feeds.js');
    return src.slice(s, e);
  })();
  const factory = new Function(`
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function isLoginPage(text) {
      if (typeof text !== 'string' || !text) return true;
      if (text.indexOf('Login Required') !== -1) return true;
      return /<html/i.test(text) && /login/i.test(text) && /password/i.test(text);
    }
    function looksLikeCsv(text) {
      if (!text) return false;
      var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      var firstLine = (t.split(/\\r?\\n/)[0] || '').replace(/^\\s+/, '');
      if (firstLine.charAt(0) === '<') return false;
      return firstLine.indexOf(',') !== -1;
    }
    ${parseCsvSrc}
    ${footerSrc}
    ${src.slice(start, end)}
    return { parseAttendanceGridCsv: parseAttendanceGridCsv, gridDateToIso: gridDateToIso, seasonStartYear: seasonStartYear };
  `);
  return factory();
}

// A grid in the documented shape: "Club","Clubber","Sep02","Sep09","#","%"
function grid(rows, dates = ['Sep02', 'Sep09'], opts = {}) {
  const header = `"Club","Clubber",${dates.map(d => `"${d}"`).join(',')},"#","%"`;
  const lines = [header];
  for (const r of rows) {
    lines.push([`"${r.club || 'Sparks'}"`, `"${r.name}"`,
      ...r.cells.map(c => `"${c}"`), `"${r.count}"`, '"50"'].join(','));
  }
  if (!opts.noFooter) {
    lines.push('"Clubber Count=' + rows.length + '"');
    lines.push('');
    lines.push('"FILTER","VALUE"');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-audit-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', checkinUrl: 'https://example.com/checkin',
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const { auditAttendance, ATTENDANCE_GRID_STALE_MS } = server;
  const listener = server.startListening();
  await new Promise((r) => (listener.listening ? r() : listener.once('listening', r)));

  const NOW = Date.UTC(2026, 8, 16, 23, 0, 0);
  const TODAY = '2026-09-16';
  const ledgerFile = path.join(dataDir, 'attendance.json');
  const readLedger = () => JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));

  // ── 1. The parser reads the documented grid, and refuses what it cannot ────
  console.log('\naudit: reading TwoTimTwo\'s attendance grid');
  {
    const { parseAttendanceGridCsv, gridDateToIso, seasonStartYear } = loadGridParser();

    check('the Awana season starts Aug 1 (Sept is the new season, Jan is not)',
      seasonStartYear(new Date(Date.UTC(2026, 8, 16))) === 2026
      && seasonStartYear(new Date(Date.UTC(2027, 0, 7))) === 2026);
    check('"Sep02" and "Jan07" resolve on opposite sides of the boundary',
      gridDateToIso('Sep02', 2026) === '2026-09-02' && gridDateToIso('Jan07', 2026) === '2027-01-07',
      `${gridDateToIso('Sep02', 2026)} / ${gridDateToIso('Jan07', 2026)}`);
    check('an unreadable column label is null, never a guessed date',
      gridDateToIso('Total', 2026) === null && gridDateToIso('', 2026) === null
      && gridDateToIso('Xyz02', 2026) === null && gridDateToIso('Sep99', 2026) === null);

    // Three plausible encodings, all consistent with the "#" column.
    const ones = parseAttendanceGridCsv(grid([{ name: 'Amy Tester', cells: ['1', ''], count: 1 }]), 2026, TODAY);
    const xs = parseAttendanceGridCsv(grid([{ name: 'Amy Tester', cells: ['X', ''], count: 1 }]), 2026, TODAY);
    const pa = parseAttendanceGridCsv(grid([{ name: 'Amy Tester', cells: ['P', 'A'], count: 1 }]), 2026, TODAY);
    check('1/blank, X/blank and P/A all read the same way',
      [ones, xs, pa].every(r => r && r.rows.length === 1 && JSON.stringify(r.rows[0].dates) === '["2026-09-02"]'),
      JSON.stringify([ones, xs, pa].map(r => r && r.rows[0] && r.rows[0].dates)));
    check('the meeting dates come back in ISO',
      JSON.stringify(ones.meetingDates) === '["2026-09-02","2026-09-09"]', JSON.stringify(ones.meetingDates));
    check('TwoTimTwo\'s footer rows are not read as children',
      ones.rows.length === 1, JSON.stringify(ones.rows));

    // THE safety mechanism.
    const lying = parseAttendanceGridCsv(
      grid([{ name: 'Amy Tester', cells: ['1', '1'], count: 1 }]), 2026, TODAY);
    check('a cell reading that disagrees with the "#" column discards the whole club',
      lying === null, JSON.stringify(lying));
    check('a grid with no "#" column is unknown, not assumed',
      parseAttendanceGridCsv('"Club","Clubber","Sep02"\n"Sparks","Amy Tester","1"\n', 2026, TODAY) === null);
    check('a grid with no recognisable date column is unknown',
      parseAttendanceGridCsv('"Club","Clubber","Total","#","%"\n"Sparks","Amy","3","3","50"\n', 2026, TODAY) === null);
    check('a login page, an HTML body and a non-CSV body are all unknown',
      parseAttendanceGridCsv('<html><body>login password</body></html>', 2026, TODAY) === null
      && parseAttendanceGridCsv('Login Required', 2026, TODAY) === null
      && parseAttendanceGridCsv('not a csv at all', 2026, TODAY) === null
      && parseAttendanceGridCsv('', 2026, TODAY) === null);

    // A future column is dropped from meetingDates but still counted in the
    // cross-check, so a mid-season grid with scheduled meetings still parses.
    const future = parseAttendanceGridCsv(
      grid([{ name: 'Amy Tester', cells: ['1', '1'], count: 2 }], ['Sep02', 'Oct07']), 2026, TODAY);
    check('a future meeting is not a date anyone can be missing',
      future && JSON.stringify(future.meetingDates) === '["2026-09-02"]'
      && JSON.stringify(future.rows[0].dates) === '["2026-09-02"]', JSON.stringify(future));
  }

  // ── 2. The pure diff ──────────────────────────────────────────────────────
  console.log('audit: the diff (unknown is never zero)');
  {
    const mkGrid = (rows, opts = {}) => ({
      season: '2026-2027',
      meetingDates: opts.dates || ['2026-09-02', '2026-09-09'],
      clubsRead: opts.clubsRead || ['Sparks'],
      clubsFailed: opts.clubsFailed || [],
      rows,
      at: opts.at != null ? opts.at : NOW,
    });

    const noGrid = auditAttendance({}, null, NOW, TODAY);
    check('no grid at all is "not checked", never agreement',
      noGrid.known === false && noGrid.reason === 'no-grid' && noGrid.matches === undefined,
      JSON.stringify(noGrid));
    const stale = auditAttendance({}, mkGrid([], { at: NOW - ATTENDANCE_GRID_STALE_MS - 1000 }), NOW, TODAY);
    check('a stale grid is "not checked", never agreement',
      stale.known === false && stale.reason === 'stale' && stale.matches === undefined, JSON.stringify(stale));
    const noMeet = auditAttendance({}, mkGrid([], { dates: ['2026-10-07'] }), NOW, TODAY);
    check('a grid with no PAST meeting is "not checked"',
      noMeet.known === false && noMeet.reason === 'no-meetings', JSON.stringify(noMeet));

    const cleanLedger = { 'amy tester': { name: 'Amy Tester', dates: ['2026-09-02', '2026-09-09'] } };
    const clean = auditAttendance(cleanLedger,
      mkGrid([{ name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('a clean match agrees, with zero discrepancies',
      clean.known === true && clean.matches === true && clean.totals.missing === 0
      && clean.totals.ledgerOnly === 0 && clean.rows.length === 0, JSON.stringify(clean));
    check('and it says how many meetings it actually compared', clean.scopeDates === 2, JSON.stringify(clean));

    const walkIn = auditAttendance(
      { 'amy tester': { name: 'Amy Tester', dates: ['2026-09-02', '2026-09-09'] } },
      mkGrid([{ name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02'] }]), NOW, TODAY);
    check('a ledger-only night is reported as ours, never as missing',
      walkIn.matches === false && walkIn.totals.missing === 0 && walkIn.totals.ledgerOnly === 1
      && walkIn.rows[0].ledgerOnly[0] === '2026-09-09', JSON.stringify(walkIn.rows));

    const siteOnly = auditAttendance(
      { 'amy tester': { name: 'Amy Tester', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('a site-only night is the hole the audit exists to find',
      siteOnly.totals.missing === 1 && siteOnly.rows[0].missingHere[0] === '2026-09-09',
      JSON.stringify(siteOnly.rows));

    const priorSeason = auditAttendance(
      { 'amy tester': { name: 'Amy Tester', dates: ['2025-11-05', '2026-09-02', '2026-09-09'] } },
      mkGrid([{ name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('a prior season in the never-pruned ledger is out of scope, not a discrepancy',
      priorSeason.matches === true, JSON.stringify(priorSeason));

    const unread = auditAttendance(
      { 'cub kid': { name: 'Cub Kid', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Cub Kid', club: 'Cubbies', dates: ['2026-09-02', '2026-09-09'] }],
        { clubsRead: ['Sparks'], clubsFailed: ['Cubbies'] }), NOW, TODAY);
    check('a child in a club that could not be read is excluded from the diff entirely',
      unread.rows.length === 0 && unread.clubsUnread[0] === 'Cubbies', JSON.stringify(unread));

    const twins = auditAttendance(
      { 'id:1': { name: 'Sam Twin', dates: ['2026-09-02'] }, 'id:2': { name: 'Sam Twin', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Sam Twin', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('two children sharing a name are named as ambiguous, never guessed at',
      twins.rows.length === 0 && twins.ambiguous.length === 1 && twins.totals.missing === 0,
      JSON.stringify(twins));

    const idKeyed = auditAttendance(
      { 'id:778899': { name: 'Veteran Kid', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Veteran Kid', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('an id-keyed ledger entry still matches by its stored name',
      idKeyed.totals.missing === 1 && idKeyed.rows[0].key === 'id:778899', JSON.stringify(idKeyed.rows));

    const reversed = auditAttendance(
      { 'amy tester': { name: 'Amy Tester', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Tester, Amy', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }]), NOW, TODAY);
    check('a "Last, First" grid cell keys the same child as "First Last"',
      reversed.totals.missing === 1, JSON.stringify(reversed));

    const buckets = auditAttendance(
      { 'guest kid': { name: 'Guest Kid', dates: ['2026-09-02'] } },
      mkGrid([{ name: 'Other Station', club: 'Sparks', dates: ['2026-09-02'] }]), NOW, TODAY);
    check('a walk-in the site never saw is "not on the roster", not a discrepancy',
      buckets.notOnRoster.length === 1 && buckets.rows.length === 0, JSON.stringify(buckets));
    check('a child on the site this machine never printed for is reported, never invented',
      buckets.neverPrinted.length === 1 && buckets.matches === true, JSON.stringify(buckets));
  }

  // ── 3. The feed route: refuse what it cannot read ─────────────────────────
  console.log('audit: POST /feed/attendance-grid');
  {
    const before = await j('/attendance-audit');
    check('with no grid the endpoint says "not checked"',
      before.body.known === false && before.body.reason === 'no-grid', JSON.stringify(before.body));

    const good = {
      season: '2026-2027',
      meetingDates: ['2026-09-02', '2026-09-09'],
      clubsRead: ['Sparks'],
      clubsFailed: [],
      rows: [{ name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] }],
    };
    const ok = await post('/feed/attendance-grid', good);
    check('a well-formed grid is accepted', ok.status === 200 && ok.body.rows === 1, JSON.stringify(ok.body));
    check('and the audit now knows something', (await j('/attendance-audit')).body.known === true);

    const bad = [
      ['a non-object body', 'not an object'],
      ['missing meetingDates', { ...good, meetingDates: [] }],
      ['a non-ISO meeting date', { ...good, meetingDates: ['Sep02'] }],
      ['no club actually read', { ...good, clubsRead: [] }],
      ['rows that are not an array', { ...good, rows: 'lots' }],
      ['a row date outside meetingDates', { ...good, rows: [{ name: 'Amy Tester', dates: ['2026-12-25'] }] }],
      ['a nameless row', { ...good, rows: [{ name: '', dates: [] }] }],
    ];
    for (const [label, body] of bad) {
      const res = await post('/feed/attendance-grid', body);
      check(`${label} is a 400`, res.status === 400, `status ${res.status}`);
    }
    const still = await j('/attendance-audit');
    check('and none of the refused bodies replaced the good grid',
      still.body.known === true && still.body.scopeDates === 2, JSON.stringify(still.body));
  }

  // ── 4. Apply: additive only, confirm-gated, recomputed server-side ────────
  console.log('audit: POST /attendance-audit/apply (never deletes)');
  {
    // A realistic ledger: one child missing a night the site has, one walk-in
    // guest the site never saw, one child whose ledger has an extra night.
    fs.writeFileSync(ledgerFile, JSON.stringify({
      'amy tester': { name: 'Amy Tester', dates: ['2026-09-02'] },
      'walkin guest': { name: 'Walkin Guest', dates: ['2026-09-09'] },
      'extra kid': { name: 'Extra Kid', dates: ['2026-09-02', '2026-09-09'] },
    }));
    await post('/feed/attendance-grid', {
      season: '2026-2027',
      meetingDates: ['2026-09-02', '2026-09-09'],
      clubsRead: ['Sparks'],
      rows: [
        { name: 'Amy Tester', club: 'Sparks', dates: ['2026-09-02', '2026-09-09'] },
        { name: 'Extra Kid', club: 'Sparks', dates: ['2026-09-02'] },
        { name: 'Never Printed', club: 'Sparks', dates: ['2026-09-02'] },
      ],
    });

    const beforeRaw = fs.readFileSync(ledgerFile, 'utf8');
    const refused = await post('/attendance-audit/apply', {});
    check('apply without confirm:true is a 400', refused.status === 400, JSON.stringify(refused.body));
    check('...and the ledger is byte-identical', fs.readFileSync(ledgerFile, 'utf8') === beforeRaw);

    const audit = (await j('/attendance-audit')).body;
    check('the audit found exactly the one hole and the one walk-in',
      audit.totals.missing === 1 && audit.totals.ledgerOnly === 1, JSON.stringify(audit.totals));

    const applied = await post('/attendance-audit/apply', { confirm: true });
    check('apply succeeds and reports what it did',
      applied.status === 200 && applied.body.added === 1 && applied.body.deleted === 0,
      JSON.stringify(applied.body));

    const after = readLedger();
    check('the missing night was added', after['amy tester'].dates.includes('2026-09-09'));
    check('the dates stay sorted', JSON.stringify(after['amy tester'].dates) === '["2026-09-02","2026-09-09"]',
      JSON.stringify(after['amy tester'].dates));
    check('the walk-in guest\'s night the site never saw is untouched',
      JSON.stringify(after['walkin guest'].dates) === '["2026-09-09"]', JSON.stringify(after['walkin guest']));
    check('the ledger-only night is NOT deleted — a walk-in is not an error',
      JSON.stringify(after['extra kid'].dates) === '["2026-09-02","2026-09-09"]', JSON.stringify(after['extra kid']));
    check('no ledger entry was created for a child this machine never printed for',
      !Object.values(after).some(e => e.name === 'Never Printed'), JSON.stringify(Object.keys(after)));
    check('every pre-existing date survived',
      Object.entries(JSON.parse(beforeRaw)).every(([k, v]) => v.dates.every(d => after[k].dates.includes(d))));

    const again = await post('/attendance-audit/apply', { confirm: true });
    check('applying twice is idempotent', again.status === 200 && again.body.added === 0, JSON.stringify(again.body));
    check('the audit now agrees only about the missing side',
      (await j('/attendance-audit')).body.totals.missing === 0);
  }

  // ── 5. Nothing here touches the wire or the print path ───────────────────
  console.log('audit: it stays operator-local');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'print-server', 'server.js'), 'utf8');
    const feedsSrc = fs.readFileSync(path.join(__dirname, '..', 'print-server', 'feeds.js'), 'utf8');
    check('the grid feed is not a publishing feed',
      !/FEED_NAMES = \[[^\]]*attendance/.test(feedsSrc)
      && !/app\.post\('\/feed\/attendance-grid',\s*makeFeedRoute/.test(src));
    const auditBlock = src.slice(src.indexOf('// ── Attendance audit (#311)'), src.indexOf("app.get('/preview'"));
    check('the audit block publishes nothing', !/events\.publish\(/.test(auditBlock));
    check('the audit block prints nothing', !/printImage\(|generateLabel\(/.test(auditBlock));
    check('apply is the only writer, and it writes only through saveAttendance',
      (auditBlock.match(/saveAttendance\(/g) || []).length === 1
      && !/delete ledger\[/.test(auditBlock), 'a delete here would eat a walk-in guest');
    const ext = fs.readFileSync(path.join(__dirname, '..', 'chrome-extension', 'feeds.js'), 'utf8');
    check('the scrape is OFF during the club window (never competes with printing)',
      /case 'attendanceGrid':[\s\S]{0,400}isInClubWindow\(\) \? Infinity : 6 \* 60 \* 60 \* 1000/.test(ext));
    check('every club is audited, not the sharesClubIds subset',
      /Object\.keys\(CLUB_ID_NAMES\)/.test(ext.slice(ext.indexOf('function runAttendanceGrid'))));
    check('the scheduler knows the task in all three tables',
      /attendanceGrid: 0/.test(ext) && /attendanceGrid: runAttendanceGrid/.test(ext));
    check('the extension header no longer claims no full name leaves the script',
      /\/feed\/attendance-grid/.test(ext.slice(0, 2200)));
    const dash = fs.readFileSync(path.join(__dirname, '..', 'print-server', 'public', 'index.html'), 'utf8');
    check('the dashboard never paints agreement for an unknown grid',
      /Not checked/.test(dash) && !/known[\s\S]{0,80}Agrees/.test(dash));
    check('every child name the card renders goes through esc()',
      /esc\(r\.name\)/.test(dash));
  }

  listener.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
