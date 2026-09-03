#!/usr/bin/env node
// Tests for the print server's CSV / roster helpers — plain Node, zero deps.
// The fixture header is the VERBATIM header line of TwoTimTwo's real
// /clubber/csv export (captured 2026-07-26 from kvbchurch.twotimtwo.com,
// documented in docs/TWOTIMTWO.md). If TwoTimTwo renames a column, update the
// fixture here AND the HEADER_MAP in print-server/server.js together.
//
// Run: npm run test:server   (or: node scripts/test-server-helpers.cjs)

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


const path = require('path');

const {
  parseCSV, normalizeHeader, findClubberIn, parseNoPhoto, noPhotoFor,
  parseAllergies, isSafePrinterName,
  effectiveHandbookGroup, reconcileHistoryWithReport, reportEntryIdentityKey,
} = require(path.join(__dirname, '..', 'print-server', 'server.js'));

const feeds = require(path.join(__dirname, '..', 'print-server', 'feeds.js'));

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

function arrEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Fixture: the real export format ──────────────────────────────────────────
// Verbatim header (66 columns, trailing comma = empty last column, and one
// column name TwoTimTwo itself truncates to "Alt Primary Phone SMS (Te...").
const REAL_HEADER = '"Clubber ID","Inactive","First Name","Last Name","Gender","Grade","Club","Group","Color","Handbook Group","Birthdate","Shirt Size","New to Awana?","Has an Awana vest?","Invited by","Completed Handbooks","Notes","Clubber Created","Clubber Last Updated","# payments","Med Release?","Share Balance","Book","Doctor Name","Doctor Phone","Payments total","Rate","Parent/Guardian#1","Parent/Guardian#2","Address1","Address2","City","State","Zip","Alt Address1","Alt Address2","Alt City","Alt State","Alt Zip","Primary Phone","Primary Phone Type","Primary Phone SMS (Text)?","Alt Phone","Alt Phone Type","Alt Phone SMS (Text)?","3rd Phone","3rd Phone Type","3rd Phone SMS (Text)?","Alt Primary Phone","Alt Primary Phone Type","Alt Primary Phone SMS (Te...","Alt Phone#2","Alt Phone#2 Type","Alt Phone#2 SMS (Text)?","Alt Phone#3","Alt Phone#3 Type","Alt Phone#3 SMS (Text)?","Emergency Contact","Others Pickup","Church","Email","Alt Email","GrandPrix Type","Photo Release?","Leader Notes",';

const HEADER_COLS = REAL_HEADER.match(/"[^"]*"/g).map(s => s.slice(1, -1)).concat(['']);

function realRow(values) {
  return HEADER_COLS.map(col => {
    const v = values[col] !== undefined ? values[col] : '';
    return '"' + String(v).replace(/"/g, '""') + '"';
  }).join(',');
}

// Three fake kids exercising the family/consent edge cases:
//  - Amy Zephyr + Ben Orchard: same primary phone, different last names
//    (blended family) — MUST group together.
//  - Cal Zephyr: same last name as Amy but a different phone/household —
//    MUST NOT group with her.
//  - Amy: "Med Release?"=n, "Photo Release?"=y → no-photo flag. An explicit
//    "no" in EITHER column must flag: KVB's real export records the media
//    release under "Med Release?" and never fills "Photo Release?", so a
//    photo-column-wins rule dropped the flag for every no-photo child.
//  - Ben: "Photo Release?"=n → no-photo flag.
const FIXTURE = [
  REAL_HEADER,
  realRow({
    'Clubber ID': '101', 'First Name': 'Amy', 'Last Name': 'Zephyr',
    'Gender': 'F', 'Grade': 'Grade 2 (Sparks)', 'Club': 'Sparks ',
    'Handbook Group': 'Flight 3:16', 'Birthdate': '2018-05-15',
    'Notes': 'Peanut allergy\nline two of notes, with "quotes"',
    'Med Release?': 'n', 'Photo Release?': 'y', 'Share Balance': '12',
    'Parent/Guardian#1': 'Pat Zephyr', 'Address1': '1 Elm St',
    'Primary Phone': '(207) 555-0101',
  }),
  realRow({
    'Clubber ID': '102', 'First Name': 'Ben', 'Last Name': 'Orchard',
    'Gender': 'M', 'Grade': 'Grade 5 (T&T)', 'Club': 'T&T ',
    'Med Release?': 'y', 'Photo Release?': 'n',
    'Parent/Guardian#1': 'Pat Zephyr', 'Address1': '1 Elm St',
    'Primary Phone': '207-555-0101',
  }),
  realRow({
    'Clubber ID': '103', 'First Name': 'Cal', 'Last Name': 'Zephyr',
    'Gender': 'M', 'Grade': 'Grade 3 (T&T)', 'Club': 'T&T ',
    'Parent/Guardian#1': 'Robin Zephyr', 'Address1': '9 Oak Ave',
    'Primary Phone': '(207) 555-0999',
  }),
  'Clubber Count=3',
  '',
  'FILTER,VALUE',
  '',
].join('\n');

console.log('normalizeHeader — real TwoTimTwo column names');
{
  check('"Med Release?" → MedRelease', normalizeHeader('Med Release?') === 'MedRelease');
  check('"Photo Release?" → PhotoRelease', normalizeHeader('Photo Release?') === 'PhotoRelease');
  check('"Share Balance" → ShareBalance', normalizeHeader('Share Balance') === 'ShareBalance');
  check('"Clubber ID" → ClubberID', normalizeHeader('Clubber ID') === 'ClubberID');
  check('"Leader Notes" → LeaderNotes', normalizeHeader('Leader Notes') === 'LeaderNotes');
  check('"First Name" → FirstName', normalizeHeader('First Name') === 'FirstName');
  check('unknown headers pass through', normalizeHeader('GrandPrix Type') === 'GrandPrix Type');
}

console.log('parseCSV — real export shape');
{
  const rows = parseCSV(FIXTURE);
  check('parses exactly 3 clubbers (footer lines ignored)', rows.length === 3,
    `got ${rows.length}`);
  const amy = rows[0];
  check('FirstName parsed', amy.FirstName === 'Amy');
  check('multi-line quoted Notes preserved',
    /Peanut allergy\nline two of notes, with "quotes"/.test(amy.Notes || ''),
    JSON.stringify(amy.Notes));
  check('MedRelease captured from "Med Release?"', amy.MedRelease === 'n');
  check('PhotoRelease captured from "Photo Release?"', amy.PhotoRelease === 'y');
  check('ShareBalance captured', amy.ShareBalance === '12');

  const bom = parseCSV('﻿' + FIXTURE);
  check('UTF-8 BOM stripped', bom.length === 3 && bom[0].FirstName === 'Amy');
}

console.log('parseNoPhoto — an explicit "no" in either release column flags');
{
  const rows = parseCSV(FIXTURE);
  const amy = rows[0], ben = rows[1], cal = rows[2];
  // Tests the REAL noPhotoFor: OR of both columns, never a precedence
  // chain — a blank-but-present "Photo Release?" column must not eat an
  // explicit "no" recorded under "Med Release?" (KVB's real export shape).
  check('Amy (med=n, photo=y) → no-photo flag', noPhotoFor(amy) === true);
  check('Ben (med=y, photo=n) → no-photo flag', noPhotoFor(ben) === true);
  check('Cal (both blank) → photos allowed', noPhotoFor(cal) === false);
  check('legacy single-column fallback still works', parseNoPhoto('No') === true);
}

console.log('findClubberIn — id-first lookup');
{
  const rows = parseCSV(FIXTURE);
  check('exact ClubberID match wins over name',
    findClubberIn(rows, 'Wrong', 'Name', '102').FirstName === 'Ben');
  check('numeric clubberId accepted', findClubberIn(rows, '', '', 101).FirstName === 'Amy');
  check('unknown id falls back to name match',
    findClubberIn(rows, 'amy ', ' ZEPHYR', '999').ClubberID === '101');
  check('no id, name matches case-insensitively',
    findClubberIn(rows, 'cal', 'zephyr', null).ClubberID === '103');
  check('nothing matches → null', findClubberIn(rows, 'Zoe', 'Nobody', '') === null);
  check('empty everything → null', findClubberIn(rows, '', '', '') === null);
}

console.log('parseAllergies — negation-aware, biased toward flagging a real allergy');
{
  // Bias under test: only an EXPLICIT negation cue at a clause's own start
  // suppresses that clause. Anything hedged/ambiguous still flags — a missed
  // real allergy is far worse than an extra icon on the label.
  check('"no allergies" → none', arrEq(parseAllergies('no allergies'), []));
  check('"no known food allergies" → none', arrEq(parseAllergies('no known food allergies'), []));
  check('"loves coloring" → none (bare "color" no longer triggers DYE)',
    arrEq(parseAllergies('loves coloring'), []));
  check('"peanut allergy" → nuts', arrEq(parseAllergies('peanut allergy'), ['NUTS']));
  check('"allergic to milk, not eggs" → dairy only (negated clause dropped, other clause unaffected)',
    arrEq(parseAllergies('allergic to milk, not eggs'), ['DAIRY']));
  check('"red 40 sensitivity" → dye', arrEq(parseAllergies('red 40 sensitivity'), ['DYE']));

  // REGRESSION GUARD: a negation is very often followed by the real allergy as
  // an exception. Suppressing the whole clause silently DROPPED these, which is
  // the one direction this parser must never fail in.
  check('"no known allergies except peanuts" → nuts (exception after negation)',
    arrEq(parseAllergies('no known allergies except peanuts'), ['NUTS']));
  check('"no allergies but severe peanut reaction" → nuts',
    arrEq(parseAllergies('no allergies but severe peanut reaction'), ['NUTS']));
  check('"none other than dairy" → dairy',
    arrEq(parseAllergies('none other than dairy'), ['DAIRY']));
  check('"not allergic to nuts but is allergic to eggs" → egg only',
    arrEq(parseAllergies('not allergic to nuts but is allergic to eggs'), ['EGG']));
  // Documents the accepted trade-off: text after an exception marker is always
  // scanned, so this over-flags rather than risk missing a real allergy.
  check('"no nuts but dairy is fine" → dairy (over-flags by design)',
    arrEq(parseAllergies('no nuts but dairy is fine'), ['DAIRY']));
  check('"food colouring intolerance" → dye (food-dye sense, not bare "color")',
    arrEq(parseAllergies('food colouring intolerance'), ['DYE']));
  check('ambiguous/hedged still flags (never lose a real allergy)',
    arrEq(parseAllergies('possible peanut allergy, unconfirmed by parent'), ['NUTS']));
  check('"denies nut allergy" → none (explicit negation cue at clause start)',
    arrEq(parseAllergies('denies nut allergy'), []));
  check('"n/a" alone → none', arrEq(parseAllergies('n/a'), []));
  check('blank/null/whitespace → none', arrEq(parseAllergies(''), []) && arrEq(parseAllergies(null), []) && arrEq(parseAllergies('   '), []));
  check('multiple real allergies in one note all flagged, in stable order',
    arrEq(parseAllergies('Peanut allergy, dairy intolerance, gluten sensitivity, egg allergy too'),
      ['NUTS', 'DAIRY', 'GLUTEN', 'EGG']));
  check('"eggnog" alone does not falsely flag EGG (word-boundary discipline)',
    arrEq(parseAllergies('loves eggnog at Christmas'), []));
}

console.log('feeds.submitFeed — validation, 5s throttle, and /health freshness snapshot');
{
  feeds._resetForTests();
  let t = 1_700_000_000_000;

  const r1 = feeds.submitFeed('tonight', { checkedIn: 10, booksCompleted: 2, awardsEarned: 1, friendsBrought: 0 }, t);
  check('valid tonight body publishes on first submit (not throttled)',
    r1.valid && r1.throttled === false, JSON.stringify(r1));
  check('payload matches the buildTonight contract shape', r1.payload && r1.payload.checkedIn === 10 && typeof r1.payload.at === 'string');

  const r2 = feeds.submitFeed('tonight', { checkedIn: 11 }, t + 100);
  check('a second submit 100ms later is throttled', r2.valid && r2.throttled === true, JSON.stringify(r2));

  const r3 = feeds.submitFeed('tonight', { checkedIn: 12 }, t + feeds.THROTTLE_MS + 1);
  check('a submit after the throttle window publishes again', r3.valid && r3.throttled === false, JSON.stringify(r3));

  const badCount = feeds.submitFeed('tonight', { checkedIn: 'a lot' }, t + 10_000);
  check('a non-numeric counter is rejected with a 400, not coerced to 0',
    badCount.valid === false && badCount.status === 400, JSON.stringify(badCount));

  const badBody = feeds.submitFeed('tonight', 'nope', t + 20_000);
  check('a non-object body is rejected with a 400', badBody.valid === false && badBody.status === 400);

  feeds._resetForTests();
  const pointsOk = feeds.submitFeed('points', { groups: { Red: 5, Blue: 3 }, club: 'Sparks' }, t);
  check('valid points body accepted', pointsOk.valid && pointsOk.payload.groups.Red === 5);
  const pointsBadShape = feeds.submitFeed('points', { groups: ['Red', 'Blue'] }, t + 1);
  check('an array for groups is rejected (must be {team: points})', pointsBadShape.valid === false);
  const pointsBadValue = feeds.submitFeed('points', { groups: { Red: 'Alice Smith' } }, t + 2);
  check('a non-numeric group value is rejected rather than silently dropped', pointsBadValue.valid === false);

  feeds._resetForTests();
  const schedOk = feeds.submitFeed('schedule', { nextMeetingDate: '2026-08-05', title: 'Water Night' }, t);
  check('valid schedule body accepted', schedOk.valid && schedOk.payload.nextMeetingDate === '2026-08-05');
  const schedBad = feeds.submitFeed('schedule', { nextMeetingDate: 'next Wednesday-ish' }, t + 1);
  check('a malformed date is rejected with a 400 instead of being silently dropped',
    schedBad.valid === false && schedBad.status === 400);
  const schedNoDate = feeds.submitFeed('schedule', { noClubThisWeek: true }, t + 2);
  check('schedule body without a date is still valid (nextMeetingDate is optional)', schedNoDate.valid === true);

  feeds._resetForTests();
  const noticeOk = feeds.submitFeed('notice', { level: 'critical', message: 'CLUB CANCELLED TONIGHT' }, t);
  check('valid notice body accepted', noticeOk.valid && noticeOk.payload.message === 'CLUB CANCELLED TONIGHT');
  const noticeEmpty = feeds.submitFeed('notice', { level: 'info', message: '   ' }, t + 1);
  check('an empty message is a 400 (buildNotice returning null must never publish)',
    noticeEmpty.valid === false && noticeEmpty.status === 400);

  feeds._resetForTests();
  feeds.submitFeed('tonight', { checkedIn: 5 }, t);
  feeds.recordPublishOutcome('tonight', true);
  const health = feeds.getFeedsHealth();
  check('getFeedsHealth surfaces receipt + publish freshness for GET /health',
    !!health.tonight.lastReceivedAt && health.tonight.lastPublishedAt === health.tonight.lastReceivedAt && health.tonight.lastPublishOk === true,
    JSON.stringify(health.tonight));
  check('an unknown feed name is rejected rather than crashing',
    feeds.submitFeed('not-a-real-feed', {}, t).valid === false);

  feeds._resetForTests();
}

console.log('feeds.submitCheckinReport — undo-detection intake: validation + throttle');
{
  feeds._resetForTests();
  let t = 1_700_000_000_000;

  const noOk = feeds.submitCheckinReport({ entries: [] }, t);
  check('a report missing "ok: true" is rejected — never inferred from an empty list',
    noOk.valid === false && noOk.status === 400, JSON.stringify(noOk));

  const noEntries = feeds.submitCheckinReport({ ok: true }, t);
  check('a report missing the entries array is rejected — that is not the same as an empty report',
    noEntries.valid === false && noEntries.status === 400, JSON.stringify(noEntries));

  const tooBig = feeds.submitCheckinReport({ ok: true, entries: new Array(feeds.CHECKIN_REPORT_MAX + 1).fill({ name: 'X' }) }, t);
  check('an oversized entries array is rejected', tooBig.valid === false && tooBig.status === 400);

  const r1 = feeds.submitCheckinReport({
    ok: true,
    entries: [
      { clubberId: 201, name: '  Amy   Zephyr ', club: 'Sparks' },
      { name: 'No Id Kid', club: 'T&T' },
      { name: '   ' }, // unreadable — dropped, not a parse failure
    ],
  }, t);
  check('a well-formed report publishes on first submit (not throttled)', r1.valid && r1.throttled === false, JSON.stringify(r1));
  check('entries are sanitized (trimmed, clubberId stringified) and unreadable rows dropped',
    r1.payload.entries.length === 2 &&
    r1.payload.entries[0].clubberId === '201' &&
    r1.payload.entries[0].name === 'Amy   Zephyr',
    JSON.stringify(r1.payload.entries));

  const r2 = feeds.submitCheckinReport({ ok: true, entries: [] }, t + 100);
  check('a second submit inside the throttle window is throttled', r2.valid && r2.throttled === true, JSON.stringify(r2));

  const r3 = feeds.submitCheckinReport({ ok: true, entries: [] }, t + feeds.CHECKIN_REPORT_THROTTLE_MS + 1);
  check('a submit after the throttle window is accepted again', r3.valid && r3.throttled === false, JSON.stringify(r3));

  feeds._resetForTests();
}

console.log('feeds.submitUnverified — batch self-verify report (#2): validation + replace semantics + staleness');
{
  feeds._resetForTests();
  let t = 1_700_000_000_000;

  const notObj = feeds.submitUnverified('nope', t);
  check('a non-object body is rejected', notObj.valid === false && notObj.status === 400);

  const noEntries = feeds.submitUnverified({}, t);
  check('a body missing the entries array is rejected', noEntries.valid === false && noEntries.status === 400);

  const tooBig = feeds.submitUnverified({
    entries: new Array(feeds.UNVERIFIED_MAX + 5).fill(0).map((_, i) => ({ name: 'Kid ' + i })),
  }, t);
  check('an oversized list is truncated to the newest, never rejected — a mass failure is when this matters most',
    tooBig.valid === true && tooBig.payload.entries.length === feeds.UNVERIFIED_MAX
      && tooBig.payload.entries[feeds.UNVERIFIED_MAX - 1].name === 'Kid ' + (feeds.UNVERIFIED_MAX + 4),
    JSON.stringify(tooBig.payload && tooBig.payload.entries.length));

  const r1 = feeds.submitUnverified({
    entries: [
      { name: '  Amy Zephyr ', clubberId: 201, club: 'Sparks', at: '2026-08-22T18:00:00Z' },
      { name: 'No Id Kid', club: 'T&T' },
      { name: '   ' }, // unreadable — dropped
    ],
  }, t);
  check('a well-formed list is accepted and sanitized (trim, clubberId stringified, blank rows dropped)',
    r1.valid === true &&
    r1.payload.entries.length === 2 &&
    r1.payload.entries[0].name === 'Amy Zephyr' &&
    r1.payload.entries[0].clubberId === '201' &&
    r1.payload.entries[1].clubberId === null,
    JSON.stringify(r1));

  check('getUnverifiedCheckins returns the stored list while fresh',
    feeds.getUnverifiedCheckins(t + 60_000).length === 2);

  // REPLACE semantics — the whole point: an emptied list clears the warning.
  const r2 = feeds.submitUnverified({ entries: [] }, t + 120_000);
  check('an empty list replaces (clears) the previous one — no merge, no throttle',
    r2.valid === true && feeds.getUnverifiedCheckins(t + 120_001).length === 0);

  // Staleness: a list left over from last week must not warn forever.
  feeds.submitUnverified({ entries: [{ name: 'Stale Kid' }] }, t);
  check('a fresh list is visible', feeds.getUnverifiedCheckins(t + 1000).length === 1);
  check('a list older than 3h is treated as empty (extension gone — cannot clear itself)',
    feeds.getUnverifiedCheckins(t + 3 * 60 * 60 * 1000 + 1).length === 0);

  feeds._resetForTests();
}

console.log('extensionSkew (#7) — dashboard half of the restart-Chrome banner');
{
  const { extensionSkew: skew } = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const now = 1_700_000_000_000;
  const fresh = { version: '5.28.0', at: now - 60_000 };
  check('skew detected when the running version lags the synced folder',
    JSON.stringify(skew('5.29.0', fresh, now)) === JSON.stringify({ running: '5.28.0', synced: '5.29.0' }));
  check('no skew when versions match', skew('5.28.0', fresh, now) === null);
  check('a stale report never warns (Chrome may have restarted since)',
    skew('5.29.0', { version: '5.28.0', at: now - 31 * 60 * 1000 }, now) === null);
  check('no synced version → no warning (extension not app-managed)', skew(null, fresh, now) === null);
  check('no report yet → no warning', skew('5.29.0', null, now) === null);
}

console.log('parseLatestChangeEntry (#6) — the what\'s-new panel reads changes.md');
{
  const { parseLatestChangeEntry: parse } = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const md = '\uFEFF## [5.28.0] - 2026-08-22\nTop entry line one.\n\nMore detail.\n\n## [5.27.0] - 2026-08-22\nOlder entry.\n';
  const e = parse(md);
  check('parses the top entry version and date', e && e.version === '5.28.0' && e.date === '2026-08-22', JSON.stringify(e));
  check('body stops before the next entry', e && e.body === 'Top entry line one.\n\nMore detail.', JSON.stringify(e && e.body));
  check('BOM tolerated (changes.md ships with one)', parse('## [1.0.0] - 2020-01-01\nx\n') !== null && e !== null);
  check('no heading → null, never a throw', parse('just prose') === null && parse('') === null && parse(null) === null);
  const single = parse('## [2.0.0] - 2021-01-01\nOnly entry.');
  check('a single-entry file parses to the end', single && single.body === 'Only entry.');
}

console.log('shouldSendUpdateBeacon (#5) — fires once per version change, opt-in only');
{
  const { shouldSendUpdateBeacon: f } = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  check('fires when enabled and the version changed', f('5.26.0', '5.27.0', true) === true);
  check('silent when the operator has not opted in', f('5.26.0', '5.27.0', false) === false);
  check('silent when nothing changed (every later boot of the same build)', f('5.27.0', '5.27.0', true) === false);
  check('silent on the first-ever boot — an install is not an update', f(null, '5.27.0', true) === false);
  check('silent on junk previous-version state', f(undefined, '5.27.0', true) === false && f(42, '5.27.0', true) === false);
}

console.log('reportEntryIdentityKey — matches historyIdentityKey\'s own key format');
{
  check('an id-bearing entry keys on the id',
    reportEntryIdentityKey({ clubberId: '55', name: 'Whoever' }) === 'id:55');
  check('a report id and a numeric history id agree',
    reportEntryIdentityKey({ clubberId: 55, name: 'X' }) === 'id:55');
  check('a name-only entry keys on the lowercased, whitespace-collapsed name',
    reportEntryIdentityKey({ name: '  Amy   Zephyr ' }) === 'name:amy zephyr');
}

console.log('reconcileHistoryWithReport — R-1 undo detection: mark, decrement, clear, guard');
{
  const today = '2026-08-02';
  const iso = (h) => `${today}T${h}:00:00.000Z`;
  const row = (over) => Object.assign({
    firstName: 'Amy', lastName: 'Zephyr', clubName: 'Sparks',
    success: true, timestamp: iso('18'),
  }, over);
  // Three unrelated kids who stay checked in and stay in the report in every
  // scenario below — padding so a single undo/mark under test never itself
  // crosses the mass-undo guard's >50% threshold and gets confused for one.
  // The guard's own boundary is exercised on purpose, separately, further down.
  const others = () => [
    row({ clubberId: '90', firstName: 'Otis' }),
    row({ clubberId: '91', firstName: 'Ori' }),
    row({ clubberId: '92', firstName: 'Owen' }),
  ];
  const othersInReport = () => [
    { clubberId: '90', name: 'Otis', club: 'Sparks' },
    { clubberId: '91', name: 'Ori', club: 'Sparks' },
    { clubberId: '92', name: 'Owen', club: 'Sparks' },
  ];

  // ── Basic undo: checked in, then missing from the authoritative report ────
  {
    const history = [row({ clubberId: '1' }), ...others()];
    const out = reconcileHistoryWithReport(history, othersInReport(), Date.parse(iso('19')));
    check('a kid missing from the report is marked undone', out.changed === 1 && out.history[0].undone === true);
    check('undoneAt is stamped with an ISO timestamp', typeof out.history[0].undoneAt === 'string' && !Number.isNaN(Date.parse(out.history[0].undoneAt)));
    check('the ORIGINAL array is untouched (copy-on-write)', history[0].undone === undefined);
    check('kids who stayed in the report are untouched', out.history.slice(1).every(r => r.undone === undefined));
  }

  // ── Still in the report: no change ─────────────────────────────────────────
  {
    const history = [row({ clubberId: '1' })];
    const out = reconcileHistoryWithReport(history, [{ clubberId: '1', name: 'Amy Zephyr', club: 'Sparks' }], Date.parse(iso('19')));
    check('a kid still in the report is left alone', out.changed === 0 && out.history[0].undone === undefined);
  }

  // ── Reappearance clears an existing undone marker (undo-of-the-undo) ───────
  {
    const history = [row({ clubberId: '1', undone: true, undoneAt: iso('19') })];
    const out = reconcileHistoryWithReport(history, [{ clubberId: '1', name: 'Amy Zephyr', club: 'Sparks' }], Date.parse(iso('19')));
    check('reappearing in the report clears undone', out.changed === 1 && out.history[0].undone === undefined && out.history[0].undoneAt === undefined);
  }

  // ── Re-check-in: a fresh successful print supersedes an older undone row ───
  {
    const history = [
      row({ clubberId: '1', timestamp: iso('19') }),                                    // newest: fresh re-checkin
      row({ clubberId: '1', timestamp: iso('18'), undone: true, undoneAt: iso('18') }), // oldest: the undone original
    ];
    const out = reconcileHistoryWithReport(history, [{ clubberId: '1', name: 'Amy Zephyr', club: 'Sparks' }], Date.parse(iso('20')));
    check('the newest (already not-undone) row needs no change; the older undone row is left as history',
      out.changed === 0 && out.history[0].undone === undefined && out.history[1].undone === true);
  }

  // ── Deterministic "latest wins": newest row undone, older row still clean ──
  {
    const history = [
      row({ clubberId: '1', timestamp: iso('19') }),  // newest — about to be marked undone
      row({ clubberId: '1', timestamp: iso('18') }),  // an earlier reprint of the same checkin
      ...others(),
    ];
    const out = reconcileHistoryWithReport(history, othersInReport(), Date.parse(iso('20')));
    check('only the newest row is marked undone, never an older duplicate',
      out.changed === 1 && out.history[0].undone === true && out.history[1].undone === undefined);
  }

  // ── Visitors are exempt from being marked undone (report visitor coverage is unknown) ──
  {
    const history = [row({ clubberId: '9', visitor: true })];
    const out = reconcileHistoryWithReport(history, [], Date.parse(iso('19')));
    check('a visitor missing from the report is NOT marked undone', out.changed === 0 && out.history[0].undone === undefined);
  }
  {
    // Reappearance still clears a visitor's undone flag — that direction can only fix a false undo.
    const history = [row({ clubberId: '9', visitor: true, undone: true, undoneAt: iso('18') })];
    const out = reconcileHistoryWithReport(history, [{ clubberId: '9', name: 'Amy Zephyr', club: 'Sparks' }], Date.parse(iso('19')));
    check('a visitor reappearing in the report still clears an existing undone flag', out.changed === 1 && out.history[0].undone === undefined);
  }

  // ── Mass-undo guard: a bad/partial scrape must never wipe most of the night ─
  {
    const history = [
      row({ clubberId: '1', firstName: 'Amy' }),
      row({ clubberId: '2', firstName: 'Ben' }),
      row({ clubberId: '3', firstName: 'Cal' }),
    ];
    // Report claims only Amy is still checked in — 2 of 3 (>half) would flip.
    const out = reconcileHistoryWithReport(history, [{ clubberId: '1', name: 'Amy', club: 'Sparks' }], Date.parse(iso('19')));
    check('more than half undone in one pass is refused (suspect scrape)', out.skipped === true && out.changed === 0);
    check('history comes back byte-for-byte unchanged when skipped', out.history === history);
    check('the skip reason is a human-readable string', typeof out.reason === 'string' && out.reason.length > 0);
  }
  {
    // Exactly half (not MORE than half) is allowed through.
    const history = [
      row({ clubberId: '1', firstName: 'Amy' }),
      row({ clubberId: '2', firstName: 'Ben' }),
    ];
    const out = reconcileHistoryWithReport(history, [{ clubberId: '1', name: 'Amy', club: 'Sparks' }], Date.parse(iso('19')));
    check('exactly half undone in one pass is allowed (guard is a ">" threshold)', out.skipped === false && out.changed === 1);
  }

  // ── An empty/missing report on an otherwise-empty night is a no-op, not a crash ──
  {
    const out = reconcileHistoryWithReport([], [], Date.parse(iso('19')));
    check('empty history + empty report changes nothing', out.changed === 0 && out.skipped === false);
  }
}

console.log('isSafePrinterName — a printer name reaches PowerShell, so it is validated not escaped');
{
  // REGRESSION GUARD: printPdf() once escaped only single quotes and then
  // embedded the name inside a DOUBLE-quoted PowerShell filter string, so a
  // name containing a double quote could terminate the string and run commands.
  // Because this server intentionally accepts requests from any local page,
  // that was reachable from any site the volunteer had open. Values are now
  // passed via the environment AND validated; these cases pin the validator.
  check('rejects the double-quote breakout payload',
    isSafePrinterName('x" ; Start-Process calc.exe ; "y') === false);
  check('rejects a semicolon', isSafePrinterName('printer; calc') === false);
  check('rejects a backtick', isSafePrinterName('p`whoami`') === false);
  check('rejects a $() subexpression', isSafePrinterName('$(calc)') === false);
  check('rejects a pipe', isSafePrinterName('p | calc') === false);
  check('rejects a newline', isSafePrinterName('printer\ncalc') === false);
  check('rejects a NUL/control character', isSafePrinterName('printer\u0000x') === false);
  check('rejects a single quote as well', isSafePrinterName("Bob's printer") === false);
  check('rejects an absurdly long value', isSafePrinterName('x'.repeat(500)) === false);
  check('ACCEPTS a real printer name', isSafePrinterName('Brother QL-820NWB') === true);
  check('ACCEPTS a name with spaces and a dash', isSafePrinterName('HP LaserJet 400 - Office') === true);
  check('ACCEPTS empty, meaning use the default printer', isSafePrinterName('') === true);
  check('ACCEPTS null/undefined as empty', isSafePrinterName(null) === true && isSafePrinterName(undefined) === true);
}

console.log('packaging — every print-server module must ship inside the Windows app');
{
  // REGRESSION GUARD: electron-builder copies print-server via an
  // `extraResources` filter. That filter used to ENUMERATE files, so adding
  // print-server/feeds.js worked in dev and in every local test but was silently
  // omitted from the packaged app — the installed server then died on startup
  // with "Cannot find module './feeds'". The Windows install smoke test caught
  // it, but only 15 minutes into a release. This asserts it much earlier.
  const fs = require('fs');
  const root = path.join(__dirname, '..');
  const electronPkg = JSON.parse(fs.readFileSync(path.join(root, 'electron-app', 'package.json'), 'utf8'));
  const resources = ((electronPkg.build || {}).extraResources || [])
    .filter(r => r && r.from === '../print-server');
  check('electron-builder still copies ../print-server', resources.length === 1);
  const filter = (resources[0] || {}).filter || [];

  // Collect every local module required by any top-level print-server module.
  const serverDir = path.join(root, 'print-server');
  const jsFiles = fs.readdirSync(serverDir).filter(f => f.endsWith('.js'));
  const required = new Set();
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(serverDir, f), 'utf8');
    for (const m of src.matchAll(/require\('\.\/([^']+)'\)/g)) required.add(m[1]);
  }
  check('found the local requires to verify', required.size > 0);

  const coversAllTopLevelJs = filter.includes('*.js') || filter.includes('**/*.js');
  for (const mod of required) {
    // Resolve './feeds' -> feeds.js, './package.json' -> package.json
    const file = mod.endsWith('.json') || mod.endsWith('.js') ? mod : mod + '.js';
    const isTopLevelJs = file.endsWith('.js') && !file.includes('/');
    const shipped = filter.includes(file) || (isTopLevelJs && coversAllTopLevelJs);
    check(`packaged app includes '${file}' (required as './${mod}')`, shipped,
      shipped ? '' : `add it to electron-app package.json build.extraResources filter`);
    check(`'${file}' actually exists in print-server/`, fs.existsSync(path.join(serverDir, file)));
  }
}

// ── security.js — the trust-model primitives ──────────────────────────────────
// Unit-level rules only; the wiring (middleware order, bind host, which routes
// are gated) is covered end-to-end by scripts/test-server-security.cjs.
{
  const sec = require(path.join(__dirname, '..', 'print-server', 'security.js'));

  // Loopback detection. Anything wrong here either locks out the extension or
  // hands the LAN a free pass.
  for (const addr of ['127.0.0.1', '127.0.1.1', '::1', '::ffff:127.0.0.1', '::1%lo0']) {
    check(`isLoopbackAddress accepts ${addr}`, sec.isLoopbackAddress(addr) === true);
  }
  for (const addr of ['192.168.1.5', '10.0.0.9', '0.0.0.0', '', null, undefined,
    '1.2.3.4', '127.0.0.1.evil.com', '::ffff:192.168.1.5']) {
    check(`isLoopbackAddress rejects ${String(addr)}`, sec.isLoopbackAddress(addr) === false);
  }

  // Origin allowlist.
  const allow = (o) => sec.isAllowedOrigin(o, { port: 3456 });
  check('allows the extension options page', allow('chrome-extension://abcdefghijklmnop') === true);
  check('allows the check-in site', allow('https://kvbchurch.twotimtwo.com') === true);
  check('allows another church subdomain (fork-friendly)', allow('https://other.twotimtwo.com') === true);
  check('allows the dashboard over loopback', allow('http://localhost:3456') === true);
  check('allows the phone page over a private LAN IP', allow('http://192.168.1.20:3456') === true);
  check('rejects an unrelated site', allow('https://evil.example') === false);
  check('rejects the old port-suffix bypass', allow('http://evil.example:3456') === false);
  check('rejects a lookalike host', allow('https://twotimtwo.com.evil.example') === false);
  check('rejects plain http on the check-in domain', allow('http://kvbchurch.twotimtwo.com') === false);
  check('rejects a public IP on our port', allow('http://8.8.8.8:3456') === false);
  check('rejects the null origin', allow('null') === false);
  check('rejects a missing origin', allow('') === false && allow(undefined) === false);

  // allowedOrigins sanitisation — an operator must not be able to paste '*'.
  const sanitized = sec.sanitizeAllowedOrigins(['*', 'https://ok.example', 'nope', 'ftp://x.example',
    'http://also-ok.example:8080']);
  check('sanitizeAllowedOrigins drops the wildcard', !sanitized.includes('*'));
  check('sanitizeAllowedOrigins drops non-URLs', !sanitized.includes('nope'));
  check('sanitizeAllowedOrigins drops non-http schemes', !sanitized.some(o => o.startsWith('ftp')));
  check('sanitizeOrigins keeps valid entries', sanitized.length === 2, JSON.stringify(sanitized));
  check('sanitizeAllowedOrigins tolerates junk input',
    arrEq(sec.sanitizeAllowedOrigins(null), []) && arrEq(sec.sanitizeAllowedOrigins('x'), []));

  // PIN policy.
  check('isAcceptablePin rejects empty', sec.isAcceptablePin('') === false);
  check('isAcceptablePin rejects too short', sec.isAcceptablePin('123') === false);
  check('isAcceptablePin accepts a 4-digit PIN', sec.isAcceptablePin('1234') === true);
  check('isAcceptablePin accepts a passphrase', sec.isAcceptablePin('correct horse battery') === true);
  check('isAcceptablePin rejects a control character', sec.isAcceptablePin('12\u00003') === false);
  check('isAcceptablePin rejects over-long', sec.isAcceptablePin('x'.repeat(65)) === false);
  check('timingSafeStringEqual matches equal strings', sec.timingSafeStringEqual('abcd', 'abcd') === true);
  check('timingSafeStringEqual rejects different strings', sec.timingSafeStringEqual('abcd', 'abce') === false);
  check('timingSafeStringEqual rejects a prefix', sec.timingSafeStringEqual('abc', 'abcd') === false);
  check('timingSafeStringEqual handles null', sec.timingSafeStringEqual(null, '') === true);

  // Rate limiter.
  {
    const lim = sec.createPinLimiter({ maxFailures: 3, lockoutMs: 1000 });
    const t0 = 1_000_000;
    check('limiter starts unlocked', lim.retryAfterMs('1.2.3.4', t0) === 0);
    lim.recordFailure('1.2.3.4', t0);
    lim.recordFailure('1.2.3.4', t0);
    check('limiter still open below the threshold', lim.retryAfterMs('1.2.3.4', t0) === 0);
    lim.recordFailure('1.2.3.4', t0);
    check('limiter locks at the threshold', lim.retryAfterMs('1.2.3.4', t0) > 0);
    check('lockout is scoped per address', lim.retryAfterMs('5.6.7.8', t0) === 0);
    check('lockout expires', lim.retryAfterMs('1.2.3.4', t0 + 1500) === 0);
    lim.recordFailure('9.9.9.9', t0);
    lim.recordSuccess('9.9.9.9');
    check('a success clears the failure count', lim.retryAfterMs('9.9.9.9', t0) === 0);
  }

  // Rate limiter — identical-guess dedupe (a stale saved PIN retried by a
  // phone, or Enter-mashing, must not out-count real distinct mistakes).
  {
    const lim = sec.createPinLimiter({ maxFailures: 8, lockoutMs: 1000 });
    const t0 = 2_000_000;
    for (let i = 0; i < 10; i++) lim.recordFailure('10.0.0.1', t0 + i, 'wrong-same');
    check('identical wrong guess repeated N times counts once',
      lim.retryAfterMs('10.0.0.1', t0 + 10) === 0);

    const lim2 = sec.createPinLimiter({ maxFailures: 8, lockoutMs: 1000 });
    for (let i = 0; i < 8; i++) lim2.recordFailure('10.0.0.2', t0 + i, 'guess-' + i);
    check('distinct guesses still lock at the threshold', lim2.retryAfterMs('10.0.0.2', t0 + 8) > 0);

    const lim3 = sec.createPinLimiter({ maxFailures: 3, lockoutMs: 1000 });
    lim3.recordFailure('10.0.0.3', t0, 'aaaa');
    lim3.recordFailure('10.0.0.3', t0, 'aaaa'); // repeat — should not increment
    lim3.recordFailure('10.0.0.3', t0, 'bbbb'); // distinct — increments
    check('a repeat guess does not advance toward lockout',
      lim3.retryAfterMs('10.0.0.3', t0) === 0);
    lim3.recordFailure('10.0.0.3', t0, 'cccc'); // 3rd distinct guess -> locks
    check('distinct guesses after repeats still reach the threshold',
      lim3.retryAfterMs('10.0.0.3', t0) > 0);

    const lim4 = sec.createPinLimiter({ maxFailures: 3, lockoutMs: 1000 });
    lim4.recordFailure('10.0.0.4', t0, 'zzzz');
    lim4.recordFailure('10.0.0.4', t0, 'zzzz');
    lim4.recordFailure('10.0.0.4', t0, 'zzzz');
    lim4.recordSuccess('10.0.0.4');
    check('success still clears a deduped record', lim4.retryAfterMs('10.0.0.4', t0) === 0);

    const lim5 = sec.createPinLimiter({ maxFailures: 3, lockoutMs: 1000 });
    for (let i = 0; i < 5; i++) lim5.recordFailure('10.0.0.5', t0 + i, 'same-guess');
    check('per-address scoping intact alongside dedupe',
      lim5.retryAfterMs('10.0.0.6', t0 + 5) === 0);
  }

  // Bind host — the property that keeps a default install off the network.
  check('default bind is loopback', sec.resolveBindHost({}).host === '127.0.0.1');
  check('lanAccess without a PIN stays loopback',
    sec.resolveBindHost({ lanAccess: true, hasPin: false }).host === '127.0.0.1');
  check('lanAccess with a PIN binds all interfaces',
    sec.resolveBindHost({ lanAccess: true, hasPin: true }).host === '0.0.0.0');
  check('AWANA_BIND_HOST overrides',
    sec.resolveBindHost({ envHost: '10.0.0.5' }).host === '10.0.0.5');
  check('an explicit loopback override is not reported as LAN',
    sec.resolveBindHost({ envHost: '127.0.0.1' }).lan === false);

  // The shell.openExternal / Start-Process sink.
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)',
    'ms-msdt:/id PCWDiagnostic', 'data:text/html,<script>', '\\\\evil-host\\share',
    'https://user:pass@example.com/', '', null, 'not a url']) {
    check(`isSafeExternalUrl rejects ${String(bad).slice(0, 30)}`, sec.isSafeExternalUrl(bad) === false);
  }
  for (const good of ['https://kvbchurch.twotimtwo.com/clubber/checkin?#',
    'http://localhost:3456/', 'https://example.org/path?a=b']) {
    check(`isSafeExternalUrl accepts ${good.slice(0, 30)}`, sec.isSafeExternalUrl(good) === true);
  }

  // Stored-field hygiene.
  check('sanitizeStoredText strips control characters',
    sec.sanitizeStoredText('Ab\u0000c\u001bd') === 'Ab c d',
    JSON.stringify(sec.sanitizeStoredText('Ab\u0000c\u001bd')));
  check('sanitizeStoredText caps length',
    sec.sanitizeStoredText('x'.repeat(500)).length === sec.STORED_NAME_MAX);
  check('sanitizeStoredText leaves an ordinary name alone',
    sec.sanitizeStoredText('  Mary-Jane O\u2019Brien  ') === 'Mary-Jane O\u2019Brien');
  check('sanitizeStoredText does NOT mangle angle brackets (output escaping owns that)',
    sec.sanitizeStoredText('a<b>c') === 'a<b>c');
  check('sanitizeStoredText handles null', sec.sanitizeStoredText(null) === '');

  // History retention.
  {
    const now = Date.parse('2026-07-27T12:00:00Z');
    const mk = (iso) => ({ firstName: 'A', timestamp: iso });
    const hist = [
      mk('2026-07-27T11:00:00Z'),   // today
      mk('2026-06-01T11:00:00Z'),   // ~8 weeks ago
      mk('2025-01-01T11:00:00Z'),   // long past
      { firstName: 'B' },           // no timestamp at all
    ];
    const kept = sec.pruneHistoryByAge(hist, 60, now);
    check('pruneHistoryByAge keeps recent rows', kept.length === 2, `kept ${kept.length}`);
    check('pruneHistoryByAge drops undateable rows', !kept.some(e => !e.timestamp));
    check('pruneHistoryByAge honours a short retention',
      sec.pruneHistoryByAge(hist, 1, now).length === 1);
    check('pruneHistoryByAge tolerates junk', arrEq(sec.pruneHistoryByAge(null, 60, now), []));
    check('normalizeRetentionDays defaults sanely',
      sec.normalizeRetentionDays(undefined) === sec.DEFAULT_HISTORY_RETENTION_DAYS);
    check('normalizeRetentionDays clamps', sec.normalizeRetentionDays(0) === 1
      && sec.normalizeRetentionDays(99999) === 730);
  }

  // The server must actually be wired to this module, not a private copy.
  const serverExports = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  check('server.js exposes the same security module', serverExports.security === sec);
}


// ── Child identity on history rows ────────────────────────────────────────────
// Print history was keyed on a lowercased "first last" string, so two children
// who share a name merged into one row — under-reporting attendance in the CSV
// export that gets imported BACK INTO TwoTimTwo, and letting a reprint fetch the
// wrong child's label. Rows now carry TwoTimTwo's clubber id, with a name
// fallback so rows written before the field existed still resolve.
{
  const { historyRowMatches, historyIdentityKey } = require(
    path.join(__dirname, '..', 'print-server', 'server.js'));

  const withId = (id, first, last) => ({ clubberId: id, firstName: first, lastName: last });
  const noId = (first, last) => ({ firstName: first, lastName: last });

  // Id-first: same name, different ids = different children. The whole point.
  check('identity: same name + different ids do NOT match',
    historyRowMatches(withId('101', 'Amy', 'Zephyr'), 'Amy', 'Zephyr', '202') === false);
  check('identity: same id matches even if the name was edited',
    historyRowMatches(withId('101', 'Amy', 'Zephyr'), 'Amie', 'Zephyr', '101') === true);
  check('identity: same id and name matches',
    historyRowMatches(withId('101', 'Amy', 'Zephyr'), 'Amy', 'Zephyr', '101') === true);

  // Backward compatibility: a row from before the id existed must still resolve
  // by name, or a mid-season upgrade would orphan every earlier check-in.
  check('identity: legacy row (no id) falls back to the name',
    historyRowMatches(noId('Amy', 'Zephyr'), 'Amy', 'Zephyr', '101') === true);
  check('identity: caller without an id falls back to the name',
    historyRowMatches(withId('101', 'Amy', 'Zephyr'), 'Amy', 'Zephyr', null) === true);
  check('identity: legacy row with a different name does not match',
    historyRowMatches(noId('Cal', 'Zephyr'), 'Amy', 'Zephyr', null) === false);

  // Case and whitespace behave as before.
  check('identity: name match is case-insensitive',
    historyRowMatches(noId('AMY', 'zephyr'), 'amy', 'ZEPHYR', null) === true);
  check('identity: blank names never match',
    historyRowMatches(noId('', ''), '', '', null) === false);
  check('identity: null row never matches', historyRowMatches(null, 'Amy', 'Zephyr', '1') === false);

  // The dedup key drives "one row per child" in tonight's stats and the CSV
  // export. Two same-named children must produce two keys.
  check('dedup key: same name + different ids give DIFFERENT keys',
    historyIdentityKey(withId('101', 'Amy', 'Zephyr')) !== historyIdentityKey(withId('202', 'Amy', 'Zephyr')));
  check('dedup key: same id gives the same key',
    historyIdentityKey(withId('101', 'Amy', 'Zephyr')) === historyIdentityKey(withId('101', 'Amy', 'Zephyr')));
  check('dedup key: legacy rows still collapse by name',
    historyIdentityKey(noId('Amy', 'Zephyr')) === historyIdentityKey(noId('amy', 'ZEPHYR')));
  check('dedup key: an id key can never collide with a name key',
    historyIdentityKey(withId('101', 'Amy', 'Z')).startsWith('id:')
      && historyIdentityKey(noId('Amy', 'Z')).startsWith('name:'));
  check('dedup key: blank/None id is treated as absent',
    historyIdentityKey({ clubberId: '  ', firstName: 'Amy', lastName: 'Z' }).startsWith('name:'));
}

// ── effectiveHandbookGroup — the group line's routing test ───────────────────
// The line exists to send a child to the right handbook table. Values that
// route nowhere print as nothing. "Puggles group" is verbatim what TwoTimTwo
// assigns to Puggles kids (seen live on kvbchurch's check-in page 2026-08-01);
// it printed as a redundant italic line under every Puggles name.
console.log('effectiveHandbookGroup — no line unless it routes somewhere');
{
  // The rules, one by one
  check('Puggles never get a group line — the toddler program has no handbooks',
    effectiveHandbookGroup('Puggles group', 'Puggles') === '');
  check('...whatever the group value says',
    effectiveHandbookGroup('Red Team', 'Puggles') === '');
  check('...and however the club is spelled',
    effectiveHandbookGroup('Puggles group', ' puggles ') === '');
  check("TwoTimTwo's 'all' placeholder is dropped (pre-existing rule, now centralized)",
    effectiveHandbookGroup('all', 'Sparks') === ''
    && effectiveHandbookGroup(' ALL ', 'Sparks') === '');
  check('a group named after its own club routes nowhere — dropped',
    effectiveHandbookGroup('Sparks group', 'Sparks') === ''
    && effectiveHandbookGroup('sparks', 'Sparks') === '');
  check('...including class/room variants and punctuation drift',
    effectiveHandbookGroup('Cubbies class', 'Cubbies ') === ''
    && effectiveHandbookGroup('T&T group', 'T&T ') === '');
  check("...and ampersand spacing, which clubKey already treats as one club",
    effectiveHandbookGroup('T & T group', 'T&T') === ''
    && effectiveHandbookGroup('T&T group', 'T & T') === '');

  // What must SURVIVE — these carry real routing information
  check('a lettered group survives', effectiveHandbookGroup('Sparks A', 'Sparks') === 'Sparks A');
  check('a named group survives', effectiveHandbookGroup('Flight 3:16', 'Sparks') === 'Flight 3:16');
  check('a group survives even when the club is unknown to clubKey',
    effectiveHandbookGroup('Eagles', 'Youth Group') === 'Eagles');
  check('club-name matching never fires on an empty club',
    effectiveHandbookGroup('group', '') === 'group');

  // Shape
  check('empty and null inputs come back as the empty string',
    effectiveHandbookGroup('', 'Sparks') === ''
    && effectiveHandbookGroup(null, 'Sparks') === ''
    && effectiveHandbookGroup(undefined, 'Sparks') === '');
  check('surviving values are trimmed',
    effectiveHandbookGroup('  Flight 3:16  ', 'Sparks') === 'Flight 3:16');

  // Wiring: all four enrichment sites must go through the helper. The old
  // pattern was the same two lines pasted four times, and a fifth paste is
  // exactly how a future call site would miss the policy.
  const fs = require('fs');
  const serverSrc = fs.readFileSync(
    path.join(__dirname, '..', 'print-server', 'server.js'), 'utf8');
  const calls = (serverSrc.match(/handbookGroup = effectiveHandbookGroup\(/g) || []).length;
  check('all four enrichment sites route through the helper', calls === 4, `found ${calls}`);
  check("the old inline 'all' check is gone from every call site",
    !/rawGroup\.trim\(\)\.toLowerCase\(\) === 'all'/.test(serverSrc));
}

console.log('half-birthday cake (#8) — June–August birthdays, label only');
{
  const { parseBirthdate, isBirthdayWeek, isHalfBirthdayWeek, isCakeWeek } =
    require(path.join(__dirname, '..', 'print-server', 'server.js'));

  // Garbage in, false out — same contract as isBirthdayWeek.
  check('blank/N-A/garbage never half-cake',
    isHalfBirthdayWeek('') === false && isHalfBirthdayWeek('N/A') === false
    && isHalfBirthdayWeek('not a date') === false && isHalfBirthdayWeek(null) === false);

  // The June–August gate is absolute: a spring birthday never half-cakes, on
  // any day of any year this test runs.
  check('a March birthday never half-cakes', isHalfBirthdayWeek('2018-03-10') === false);
  check('a December birthday never half-cakes', isHalfBirthdayWeek('2017-12-25') === false);

  // Dynamic, valid whichever day the suite runs:
  // a kid born on today's month/day is always in their birthday week…
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const bornToday = `2018-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  check('born-today is a birthday week', isBirthdayWeek(bornToday) === true);
  check('born-today is a cake week', isCakeWeek(bornToday) === true);

  // …and a kid born six months from today half-cakes THIS week if and only if
  // that birth month is June–August (the gate), since their half-birthday
  // lands on today.
  const srcMonth = (today.getMonth() + 6) % 12;   // 0-indexed birth month
  const lastDay = new Date(2018, srcMonth + 1, 0).getDate();
  const bornOpposite = `2018-${pad(srcMonth + 1)}-${pad(Math.min(today.getDate(), lastDay))}`;
  const expected = srcMonth >= 5 && srcMonth <= 7;
  check(`born six months out (${bornOpposite}) half-cakes today iff summer-born (${expected})`,
    isHalfBirthdayWeek(bornOpposite) === expected,
    `got ${isHalfBirthdayWeek(bornOpposite)}`);

  // Day clamping: Aug 29–31 birthdays target the END of February, never
  // roll into March. parseBirthdate must read the slash form too.
  check('parseBirthdate reads MM/DD/YYYY', (() => {
    const d = parseBirthdate('8/31/2018');
    return d && d.getMonth() === 7 && d.getDate() === 31;
  })());
  check('an Aug-31 half-birthday never throws and stays boolean',
    typeof isHalfBirthdayWeek('2018-08-31') === 'boolean');

  // isCakeWeek is exactly the OR of the two parts.
  for (const bd of ['2018-06-15', '2018-01-05', bornToday, bornOpposite]) {
    check(`isCakeWeek(${bd}) is the OR of its parts`,
      isCakeWeek(bd) === (isBirthdayWeek(bd) || isHalfBirthdayWeek(bd)));
  }

  // Wiring: the display-facing sites must stay REAL birthdays. The checkin
  // event and publishBirthdays/birthday-roster sites keep isBirthdayWeek;
  // the five label-render sites use isCakeWeek.
  const fs2 = require('fs');
  const src = fs2.readFileSync(path.join(__dirname, '..', 'print-server', 'server.js'), 'utf8');
  const cakeCalls = (src.match(/= isCakeWeek\(record\.Birthdate\)/g) || []).length;
  const realCalls = (src.match(/isBirthdayWeek\(record\.Birthdate\)/g) || []).length;
  check('five label sites key the cake on isCakeWeek', cakeCalls === 5, `found ${cakeCalls}`);
  check('the /print event split and the stats roster key on real birthdays',
    realCalls === 2, `found ${realCalls}`);
  check('publishBirthdays (the weekly display list) keys on real birthdays',
    /isBirthdayWeek\(r\.Birthdate\)/.test(src));
}

console.log('twin-safe labels (#13) — disambiguate same-name kids');
{
  const { twinDisambiguation } = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const kid = (over) => Object.assign(
    { FirstName: 'Emma', LastName: 'Stone', Birthdate: '2018-03-10', Inactive: '' }, over);

  // Unique name: both fields empty, so the common label is byte-identical.
  check('a unique name gets no hint', (() => {
    const t = twinDisambiguation(kid({}), [kid({}), kid({ FirstName: 'Liam' })]);
    return t.middleInitial === '' && t.nameHint === '';
  })());

  // Two active same-name kids, no middle column: birth-month hint.
  check('a collision falls back to the birth month', (() => {
    const rows = [kid({}), kid({ Birthdate: '2019-07-04' })];
    const t = twinDisambiguation(rows[0], rows);
    return t.middleInitial === '' && t.nameHint === 'b. Mar';
  })());

  // A middle name (should TwoTimTwo ever export one) wins over the month.
  check('a middle initial is preferred when a middle column exists', (() => {
    const rows = [kid({ 'Middle Name': 'grace' }), kid({ Birthdate: '2019-07-04' })];
    const t = twinDisambiguation(rows[0], rows);
    return t.middleInitial === 'G' && t.nameHint === '';
  })());

  // An INACTIVE same-name kid must not force a hint onto an active one —
  // they aren't both in the building.
  check('inactive rows never count as twins', (() => {
    const rows = [kid({}), kid({ Inactive: 'y', Birthdate: '2019-07-04' })];
    const t = twinDisambiguation(rows[0], rows);
    return t.middleInitial === '' && t.nameHint === '';
  })());

  // Name matching is case/whitespace-normalized — the same rule findClubber
  // uses, so the twins the hint splits are the twins lookup confuses.
  check('collision matching normalizes case and whitespace', (() => {
    const rows = [kid({}), kid({ FirstName: '  emma ', LastName: 'STONE', Birthdate: '2019-07-04' })];
    return twinDisambiguation(rows[0], rows).nameHint === 'b. Mar';
  })());

  // No birthdate and no middle name: nothing to print, no crash.
  check('no birthdate and no middle → empty hint, no throw', (() => {
    const rows = [kid({ Birthdate: '' }), kid({ Birthdate: 'N/A' })];
    const t = twinDisambiguation(rows[0], rows);
    return t.middleInitial === '' && t.nameHint === '';
  })());
}

console.log('seasonal art (#16) — the calendar tiling and the computus');
{
  const { easterSunday, seasonForDate, SEASON_KEYS } =
    require(path.join(__dirname, '..', 'print-server', 'server.js'));

  // The movable feast, pinned against published Easter dates.
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  check('Easter 2024 is March 31', iso(easterSunday(2024)) === '2024-03-31');
  check('Easter 2025 is April 20', iso(easterSunday(2025)) === '2025-04-20');
  check('Easter 2026 is April 5',  iso(easterSunday(2026)) === '2026-04-05');

  const at = (y, m, d) => seasonForDate(new Date(y, m - 1, d));
  check('Sep 1 is back-to-school', at(2026, 9, 1) === 'back-to-school');
  check('Oct 10 is fall',          at(2026, 10, 10) === 'fall');
  check('Nov 20 is thanksgiving',  at(2026, 11, 20) === 'thanksgiving');
  check('Dec 25 is christmas',     at(2026, 12, 25) === 'christmas');
  check('Jan 15 is winter',        at(2026, 1, 15) === 'winter');
  check('Feb 29 (leap) is winter', at(2024, 2, 29) === 'winter');
  check('May 10 is spring',        at(2026, 5, 10) === 'spring');
  check('Jul 4 is vbs-summer',     at(2026, 7, 4) === 'vbs-summer');
  // Easter 2026 is Apr 5: the window (Mar 22 – Apr 12) outranks spring…
  check('Mar 25 2026 is easter',   at(2026, 3, 25) === 'easter');
  check('Apr 11 2026 is easter',   at(2026, 4, 11) === 'easter');
  // …and hands back to spring outside it.
  check('Mar 20 2026 is spring',   at(2026, 3, 20) === 'spring');
  check('Apr 14 2026 is spring',   at(2026, 4, 14) === 'spring');

  // Every day of a full year maps to exactly one season — no gaps, no throws.
  let holes = 0;
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    if (!SEASON_KEYS.includes(seasonForDate(new Date(d)))) holes++;
  }
  check('the calendar tiling has no holes across 2026', holes === 0, `${holes} uncovered days`);
}

console.log('collectible of the week (#20) — rotation math');
{
  const { collectibleIndexForDate, COLLECTIBLE_SERIES } =
    require(path.join(__dirname, '..', 'print-server', 'server.js'));
  check('the series has twelve icons', COLLECTIBLE_SERIES.length === 12);
  const idx = collectibleIndexForDate(new Date());
  check('the index is a valid series position', Number.isInteger(idx) && idx >= 0 && idx < 12);
  // Stable across one day, advances by one across one week, wraps after twelve.
  const at = (ms) => collectibleIndexForDate(new Date(Date.now() + ms));
  const DAY = 86400000;
  check('same week, same icon (a reprint matches the original)',
    collectibleIndexForDate(new Date()) === idx);
  check('one week on, the next icon', at(7 * DAY) === (idx + 1) % 12);
  check('twelve weeks on, the series wraps', at(12 * 7 * DAY) === idx);
  // The week may only roll at LOCAL midnight (Monday anchor) — the old raw-ms
  // version rolled at Thursday 00:00 UTC, mid-club-night in US timezones.
  const wedEarly = collectibleIndexForDate(new Date(2026, 0, 14, 17, 30)); // Wed Jan 14 2026
  const wedLate  = collectibleIndexForDate(new Date(2026, 0, 14, 23, 59));
  const thu      = collectibleIndexForDate(new Date(2026, 0, 15, 0, 1));   // Thu — same week
  const nextMon  = collectibleIndexForDate(new Date(2026, 0, 19, 0, 1));   // Mon — next week
  check('the icon never flips within one local day', wedEarly === wedLate);
  check('Wednesday and Thursday share a week (no mid-club-night roll)', wedLate === thu);
  check('the week rolls on Monday', nextMon === (thu + 1) % 12);
}

console.log('musical printer (#11/#12) — the TSPL compiler');
{
  const { buildTuneTspl, nextTuneName, TUNE_NAMES, TUNE_ROTATION } =
    require(path.join(__dirname, '..', 'print-server', 'server.js'));

  check('four tunes exist (three in rotation + Happy Birthday)',
    TUNE_NAMES.length === 4 && TUNE_NAMES.includes('birthday'));
  check('the rotation excludes birthday — hearing it MEANS a birthday kid',
    TUNE_ROTATION.length === 3 && !TUNE_ROTATION.includes('birthday'));
  // Per-LABEL cycling (operator request — was per day): consecutive prints
  // get consecutive tunes, wrapping after three.
  const a = nextTuneName(), b = nextTuneName(), c = nextTuneName(), d = nextTuneName();
  check('consecutive labels play different tunes', a !== b && b !== c && a !== c);
  check('the rotation wraps after three', d === a);
  check('rotation only serves rotation tunes', [a, b, c].every((n) => TUNE_ROTATION.includes(n)));

  for (const name of TUNE_NAMES) {
    const prog = buildTuneTspl(name);
    const feeds = [...prog.matchAll(/^FEED (\d+)$/gm)].map(m => Number(m[1]));
    const backs = [...prog.matchAll(/^BACKFEED (\d+)$/gm)].map(m => Number(m[1]));
    const speeds = [...prog.matchAll(/^SPEED (\d+(?:\.\d+)?)$/gm)].map(m => Number(m[1]));
    check(`${name}: alternates SPEED/FEED and ends in one BACKFEED`,
      feeds.length >= 3 && backs.length === 1 && speeds.length === feeds.length + 1);
    check(`${name}: net media movement is zero (backfeed returns every dot fed)`,
      feeds.reduce((a, b) => a + b, 0) === backs[0], prog);
    check(`${name}: total forward feed stays under the 2in cap`,
      feeds.reduce((a, b) => a + b, 0) <= 400);
    check(`${name}: every speed is in the D450-safe 1-6 range`,
      speeds.every(v => v >= 1 && v <= 6));
    check(`${name}: CRLF line endings (TSPL is picky)`,
      prog.includes('\r\n') && !/[^\r]\n/.test(prog));
  }
  // Every program must actually differ — otherwise the rotation is fake.
  const progs = TUNE_NAMES.map(buildTuneTspl);
  check('all four tunes compile to distinct programs',
    new Set(progs).size === TUNE_NAMES.length);
  check('an unknown tune falls back to the arpeggio, never throws',
    buildTuneTspl('freebird') === buildTuneTspl('arpeggio'));
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
__suiteFinished = true;
process.exit(failed > 0 ? 1 : 0);
