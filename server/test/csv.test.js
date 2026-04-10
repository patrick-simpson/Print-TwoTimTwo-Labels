'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, findClubber, buildFamilyIndex } = require('../src/csv');

test('parseCSV: manual template headers', () => {
  const raw = 'FirstName,LastName,Birthdate,HandbookGroup,Allergies\nAlice,Smith,2015-01-05,Sparks,nuts';
  const rows = parseCSV(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].FirstName, 'Alice');
  assert.equal(rows[0].LastName, 'Smith');
  assert.equal(rows[0].Allergies, 'nuts');
});

test('parseCSV: TwoTimTwo export headers with spaces', () => {
  const raw = '"First Name","Last Name","Date of Birth","Handbook Group","Notes"\n"Bob","Jones","01/05/2015","T&T Ultimate","milk allergy"';
  const rows = parseCSV(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].FirstName, 'Bob');
  assert.equal(rows[0].Birthdate, '01/05/2015');
  assert.equal(rows[0].HandbookGroup, 'T&T Ultimate');
  assert.equal(rows[0].Notes, 'milk allergy');
});

test('parseCSV: quoted fields with embedded commas and newlines', () => {
  const raw = 'FirstName,LastName,Notes\n"Ana","Lopez","allergy: peanuts, dairy\nsevere"';
  const rows = parseCSV(raw);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].Notes.includes('peanuts, dairy'));
  assert.ok(rows[0].Notes.includes('severe'));
});

test('parseCSV: escaped quotes via double-quote', () => {
  const raw = 'FirstName,LastName\n"Dan","""Danger"" Smith"';
  const rows = parseCSV(raw);
  assert.equal(rows[0].LastName, '"Danger" Smith');
});

test('parseCSV: stops at TwoTimTwo footer lines', () => {
  const raw = 'FirstName,LastName\nAlice,Smith\nBob,Jones\nClubber Count=2';
  const rows = parseCSV(raw);
  assert.equal(rows.length, 2);
});

test('parseCSV: empty input returns []', () => {
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('   \n  '), []);
  assert.deepEqual(parseCSV(null), []);
});

test('parseCSV: malformed input never throws', () => {
  assert.doesNotThrow(() => parseCSV('"unterminated\nquote,foo'));
  assert.doesNotThrow(() => parseCSV('no,headers,here,\n'));
});

test('findClubber: case and whitespace insensitive', () => {
  const rows = [{ FirstName: 'Alice', LastName: 'Smith' }];
  assert.ok(findClubber(rows, 'alice ', ' SMITH'));
  assert.equal(findClubber(rows, 'Bob', 'Jones'), null);
});

test('buildFamilyIndex: groups siblings by HouseholdID', () => {
  const rows = [
    { FirstName: 'Alice', LastName: 'Smith', HouseholdID: 'H1' },
    { FirstName: 'Bob',   LastName: 'Smith', HouseholdID: 'H1' },
    { FirstName: 'Lone',  LastName: 'Wolf',  HouseholdID: 'H2' },
  ];
  const idx = buildFamilyIndex(rows);
  assert.deepEqual(idx.get('alice smith'), ['Bob Smith']);
  assert.deepEqual(idx.get('bob smith'),   ['Alice Smith']);
  assert.equal(idx.has('lone wolf'), false); // no siblings
});

test('buildFamilyIndex: falls back to LastName when no HouseholdID', () => {
  const rows = [
    { FirstName: 'A', LastName: 'Lee' },
    { FirstName: 'B', LastName: 'Lee' },
  ];
  const idx = buildFamilyIndex(rows);
  assert.deepEqual(idx.get('a lee'), ['B Lee']);
});
