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
} = require(path.join(__dirname, '..', 'print-server', 'server.js'));

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

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
