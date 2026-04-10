'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const { parseAllergies, isBirthdayWeek, enrichClubber } = require('../src/enrich');

test('parseAllergies: empty/null returns []', () => {
  assert.deepEqual(parseAllergies(''), []);
  assert.deepEqual(parseAllergies(null), []);
  assert.deepEqual(parseAllergies(undefined), []);
});

test('parseAllergies: detects common allergens', () => {
  assert.deepEqual(parseAllergies('peanut allergy'), ['NUTS']);
  assert.deepEqual(parseAllergies('milk, gluten, egg, dye'), ['DAIRY', 'GLUTEN', 'EGG', 'DYE']);
});

test('parseAllergies: \\begg\\b avoids matching "eggnog"', () => {
  // "eggnog" should not match EGG (word boundary)
  assert.deepEqual(parseAllergies('eggnog allergy'), []);
});

test('parseAllergies: tree nut matches NUTS', () => {
  assert.deepEqual(parseAllergies('tree nut'), ['NUTS']);
  assert.deepEqual(parseAllergies('tree-nut'), ['NUTS']);
});

test('isBirthdayWeek: blank / N/A → false', () => {
  assert.equal(isBirthdayWeek(''), false);
  assert.equal(isBirthdayWeek('N/A'), false);
  assert.equal(isBirthdayWeek(null), false);
});

test('isBirthdayWeek: garbage → false, never throws', () => {
  assert.equal(isBirthdayWeek('foo'), false);
  assert.equal(isBirthdayWeek('13/45/2020'), false);
});

test('isBirthdayWeek: returns true within 6 days', () => {
  // Mock "today" as Jan 1 2030. Birthday Jan 3 2015 → 2 days away → true.
  const jan1 = new Date('2030-01-01T12:00:00');
  assert.equal(isBirthdayWeek('2015-01-03', jan1), true);
  assert.equal(isBirthdayWeek('01/03/2015', jan1), true);
});

test('isBirthdayWeek: returns false when >6 days away', () => {
  const jan1 = new Date('2030-01-01T12:00:00');
  assert.equal(isBirthdayWeek('2015-02-15', jan1), false);
});

test('isBirthdayWeek: year-wrap (Dec 30 → Jan 2)', () => {
  const dec30 = new Date('2030-12-30T12:00:00');
  assert.equal(isBirthdayWeek('2015-01-02', dec30), true);
});

test('enrichClubber: null record returns safe defaults', () => {
  assert.deepEqual(enrichClubber(null), { allergyTokens: [], handbookGroup: '', isBirthday: false });
});

test('enrichClubber: HandbookGroup "All" is blanked out', () => {
  const out = enrichClubber({ HandbookGroup: 'All', Notes: '' });
  assert.equal(out.handbookGroup, '');
});

test('enrichClubber: Notes is used when Allergies is blank', () => {
  const out = enrichClubber({ Notes: 'peanut allergy' });
  assert.deepEqual(out.allergyTokens, ['NUTS']);
});
