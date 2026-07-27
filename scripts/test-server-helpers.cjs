#!/usr/bin/env node
// Tests for the print server's CSV / roster helpers — plain Node, zero deps.
// The fixture header is the VERBATIM header line of TwoTimTwo's real
// /clubber/csv export (captured 2026-07-26 from kvbchurch.twotimtwo.com,
// documented in docs/TWOTIMTWO.md). If TwoTimTwo renames a column, update the
// fixture here AND the HEADER_MAP in print-server/server.js together.
//
// Run: npm run test:server   (or: node scripts/test-server-helpers.cjs)

'use strict';

const path = require('path');

const {
  parseCSV, normalizeHeader, buildFamilyIndex, findClubberIn, parseNoPhoto,
  parseAllergies, buildHouseholdSiblingIndex, siblingsFor, isSafePrinterName,
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
//  - Amy: "Med Release?"=n but "Photo Release?"=y → photos are FINE.
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
  check('"Parent/Guardian#1" → PrimaryContact', normalizeHeader('Parent/Guardian#1') === 'PrimaryContact');
  check('"Parent/Guardian#2" → Guardian', normalizeHeader('Parent/Guardian#2') === 'Guardian');
  check('"Address1" → Address', normalizeHeader('Address1') === 'Address');
  check('"Primary Phone" → PrimaryPhone', normalizeHeader('Primary Phone') === 'PrimaryPhone');
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
  check('PrimaryPhone captured', amy.PrimaryPhone === '(207) 555-0101');
  check('PrimaryContact captured from "Parent/Guardian#1"', amy.PrimaryContact === 'Pat Zephyr');
  check('Address captured from "Address1"', amy.Address === '1 Elm St');

  const bom = parseCSV('﻿' + FIXTURE);
  check('UTF-8 BOM stripped', bom.length === 3 && bom[0].FirstName === 'Amy');
}

console.log('parseNoPhoto — photo consent beats med consent');
{
  const rows = parseCSV(FIXTURE);
  const amy = rows[0], ben = rows[1], cal = rows[2];
  const noPhoto = r => parseNoPhoto(r.PhotoRelease !== undefined ? r.PhotoRelease : r.MedRelease);
  check('Amy (med=n, photo=y) → photos allowed', noPhoto(amy) === false);
  check('Ben (med=y, photo=n) → no-photo flag', noPhoto(ben) === true);
  check('Cal (both blank) → photos allowed', noPhoto(cal) === false);
  check('legacy single-column fallback still works', parseNoPhoto('No') === true);
}

console.log('buildFamilyIndex — real export grouping');
{
  const rows = parseCSV(FIXTURE);
  const idx = buildFamilyIndex(rows);
  const amySibs = idx.get('amy zephyr') || [];
  check('blended family: Amy ↔ Ben grouped by shared phone',
    amySibs.length === 1 && amySibs[0] === 'Ben Orchard', JSON.stringify(amySibs));
  check('same last name, different household: Cal NOT grouped with Amy',
    !(idx.get('cal zephyr') || []).includes('Amy Zephyr'),
    JSON.stringify(idx.get('cal zephyr')));
  check('phone format differences normalized ("(207) 555-0101" ≡ "207-555-0101")',
    (idx.get('ben orchard') || []).includes('Amy Zephyr'));
}

console.log('buildFamilyIndex — placeholder/shared phones must not over-merge');
{
  // Three unrelated families whose rows all carry a sentinel/placeholder phone
  // (all-zeros, all-fives) plus one real family. The placeholders must NOT
  // collapse the three unrelated kids into one giant sibling group.
  const rows = parseCSV([
    'First Name,Last Name,Primary Phone,Parent/Guardian#1,Address1',
    'Ivy,Reed,000-000-0000,Reed Parent,10 A St',
    'Jack,Stone,(000) 000-0000,Stone Parent,20 B St',
    'Kate,Vale,555-5555,Vale Parent,30 C St',
    'Lee,West,(207) 555-0142,West Parent,40 D St',
    'Mia,West,207.555.0142,West Parent,40 D St',
  ].join('\n'));
  const idx = buildFamilyIndex(rows);
  check('all-zero phone rejected → Ivy not grouped with Jack',
    !(idx.get('ivy reed') || []).includes('Jack Stone'), JSON.stringify(idx.get('ivy reed')));
  check('repeated-digit phone rejected (Kate has no phantom siblings)',
    (idx.get('kate vale') || []).length === 0);
  check('real 10-digit phone still groups the Wests',
    (idx.get('lee west') || []).includes('Mia West'));
}

console.log('buildFamilyIndex — contact groups even when address is inconsistent');
{
  // No phone at all; two siblings share PrimaryContact but only one row has an
  // address filled in. Contact-before-address must still group them.
  const rows = parseCSV([
    'First Name,Last Name,Parent/Guardian#1,Address1',
    'Nate,Frost,Frost Parent,55 E St',
    'Owen,Frost,Frost Parent,',
  ].join('\n'));
  const idx = buildFamilyIndex(rows);
  check('siblings group on PrimaryContact despite one blank address',
    (idx.get('nate frost') || []).includes('Owen Frost'), JSON.stringify(idx.get('nate frost')));
}

console.log('buildFamilyIndex — manual/template rosters keep working');
{
  const manual = parseCSV([
    'FirstName,LastName,Allergies,HouseholdID',
    'Dot,Miller,peanut,H1',
    'Ed,Stone,,H1',
    'Flo,Miller,,H2',
    'Gus,Pine,,',
    'Hal,Pine,,',
  ].join('\n'));
  const idx = buildFamilyIndex(manual);
  check('HouseholdID grouping wins', (idx.get('dot miller') || []).includes('Ed Stone'));
  check('different HouseholdID not grouped', !(idx.get('dot miller') || []).includes('Flo Miller'));
  check('last-name fallback when no household data',
    (idx.get('gus pine') || []).includes('Hal Pine'));
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

console.log('buildHouseholdSiblingIndex — authoritative household export (GET /household/csv)');
{
  const rows = parseCSV([
    'Household ID,Parent/Guardian#1,Active Clubbers',
    'H1,Pat Zephyr,"Amy Zephyr, Ben Orchard"',
    'H2,Robin Zephyr,Cal Zephyr',
  ].join('\n'));
  const idx = buildHouseholdSiblingIndex(rows);
  check('"Active Clubbers" column parsed via HEADER_MAP', rows[0].ActiveClubbers === 'Amy Zephyr, Ben Orchard');
  check('household groups a blended-family pair by name alone (no shared phone needed)',
    (idx.get('amy zephyr') || []).includes('Ben Orchard') && (idx.get('ben orchard') || []).includes('Amy Zephyr'));
  check('single-child household has no sibling entry',
    !idx.has('cal zephyr') || (idx.get('cal zephyr') || []).length === 0);
  check('empty/garbage rows are ignored without throwing', arrEq([...buildHouseholdSiblingIndex([{}, { ActiveClubbers: '' }]).keys()], []));
}

console.log('siblingsFor — authoritative household map wins over CSV heuristics');
{
  const csvRows = parseCSV(FIXTURE); // Amy/Ben grouped by shared phone; Cal is a separate household
  const householdRows = parseCSV([
    'Household ID,Active Clubbers',
    'H9,"Amy Zephyr, Cal Zephyr"',
  ].join('\n'));
  const hhIndex = buildHouseholdSiblingIndex(householdRows);

  check('household map overrides the CSV phone/address heuristic entirely',
    arrEq(siblingsFor('Amy Zephyr', hhIndex, csvRows), ['Cal Zephyr']));
  check('falls back to CSV heuristics for a child with no household entry',
    (siblingsFor('Ben Orchard', hhIndex, csvRows) || []).includes('Amy Zephyr'));
  check('falls back to CSV heuristics entirely when no household map loaded',
    (siblingsFor('Ben Orchard', new Map(), csvRows) || []).includes('Amy Zephyr'));
  check('unknown child → empty array, never throws', arrEq(siblingsFor('Nobody Here', hhIndex, csvRows), []));
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

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
