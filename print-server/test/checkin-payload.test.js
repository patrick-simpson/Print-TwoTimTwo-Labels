// Contract tests for the Awana Check-in Broadcast Contract v1.
// The display repo (Awana-Check-in-Display) mirrors these assertions in
// src/hooks/useSocket.test.js using the same canonical fixture — if one
// side changes shape, its contract test fails before the screen goes dark.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CHECKIN_CHANNEL, CHECKIN_EVENT, buildCheckinPayload } = require('../checkin-payload');

// Canonical fixture — must match the display repo's contract test verbatim.
const CANONICAL_FIXTURE = {
  firstName: 'Amelia',
  club: 'Sparks',
  isBirthday: false,
  isFirstTimer: true,
};

test('channel and event names match the contract', () => {
  assert.equal(CHECKIN_CHANNEL, 'awana-channel');
  assert.equal(CHECKIN_EVENT, 'checkin');
});

test('payload matches the canonical fixture exactly', () => {
  const payload = buildCheckinPayload({
    firstName: 'Amelia',
    clubName: 'Sparks',
    birthday: false,
    visitor: true,
  });
  assert.deepEqual(payload, CANONICAL_FIXTURE);
});

test('payload has exactly the four contract keys — nothing else', () => {
  const payload = buildCheckinPayload({
    firstName: 'Sam',
    clubName: 'T&T',
    birthday: true,
    visitor: false,
    // Fields that must never leak into the broadcast:
    lastName: 'Smith',
    allergies: 'peanuts',
    notes: 'private',
  });
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['club', 'firstName', 'isBirthday', 'isFirstTimer'],
  );
});

test('booleans are strict booleans regardless of input truthiness', () => {
  const payload = buildCheckinPayload({
    firstName: 'Sam',
    clubName: 'Trek',
    birthday: 'yes',   // truthy non-boolean
    visitor: undefined,
  });
  assert.equal(payload.isBirthday, true);
  assert.equal(payload.isFirstTimer, false);
  assert.equal(typeof payload.isBirthday, 'boolean');
  assert.equal(typeof payload.isFirstTimer, 'boolean');
});

test('strings are trimmed and non-strings become empty strings', () => {
  const payload = buildCheckinPayload({
    firstName: '  Nora  ',
    clubName: null,
    birthday: false,
    visitor: false,
  });
  assert.equal(payload.firstName, 'Nora');
  assert.equal(payload.club, '');
});
