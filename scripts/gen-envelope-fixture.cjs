#!/usr/bin/env node
// Regenerate envelope-vectors.json — the cross-implementation interop fixture.
//
// Run ONLY when the envelope framing itself changes (version, AAD, padding,
// length prefix), and then mirror the output into the display repo in the same
// commit. `npm run test:envelope` fails loudly if the two drift.
//
// WHY A COMMITTED FIXTURE RATHER THAN EACH SIDE TESTING ITSELF
//
// The seal lives in print-server/events.js (Node crypto) and the open lives in
// the display repo's src/lib/envelope.js (WebCrypto). Two separate
// implementations of one wire format is exactly the situation where both sides
// pass their own tests and no name ever reaches a screen. So both are pinned to
// THIS artifact: the printer asserts it can still open these envelopes, and the
// display asserts the same. A framing change on either side breaks that side's
// test immediately, rather than at 5:55pm on a Wednesday.
//
// The key here is a FIXED TEST KEY and is published on purpose — it protects
// nothing. It must never be used by a real install; the dashboard's Generate
// button is the only correct source of a real key.
//
// Run: node scripts/gen-envelope-fixture.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const events = require('../print-server/events.js');

// Deterministic, non-secret, obviously-fake: 32 bytes of 0x01..0x20.
const TEST_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

if (!events.setDisplayKey(TEST_KEY)) {
  console.error('The fixed test key was rejected by setDisplayKey — check isValidDisplayKey.');
  process.exit(1);
}

const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contract-vectors.json'), 'utf8'));

// Seal every VALID vector of every encrypted event, straight from the canonical
// contract. That means the interop fixture cannot cover a payload shape the
// contract doesn't describe, and it grows automatically when a vector is added.
const cases = [];
// Derived from the module rather than hardcoded, so adding an encrypted event
// cannot leave its interop coverage silently behind.
for (const event of [...events.ENCRYPTED_EVENTS]) {
  const valid = (vectors.events[event] && vectors.events[event].valid) || [];
  valid.forEach((payload, i) => {
    const envelope = events.seal(event, payload);
    if (!envelope) {
      console.error(`Could not seal ${event}.valid[${i}] — refusing to write a partial fixture.`);
      process.exit(1);
    }
    cases.push({ event, vector: `${event}.valid[${i}]`, payload, envelope });
  });
}

// An empty recap: the key heartbeat that keeps flowing on the ~2-minute cadence
// so a screen can tell "no key" from "quiet night". Worth pinning explicitly.
cases.push({
  event: 'recap',
  vector: 'recap.heartbeat',
  payload: { entries: [], at: '2026-08-01T23:30:00.000Z' },
  envelope: events.seal('recap', { entries: [], at: '2026-08-01T23:30:00.000Z' }),
});

const out = {
  note: [
    'Cross-implementation interop fixture for the sealed-envelope transport.',
    'CANONICAL COPY lives in the printer repo; the display repo carries a',
    'byte-identical mirror. Both repos assert they can open every envelope here,',
    'which is what stops the Node seal and the WebCrypto open from drifting.',
    'The testKey below is deliberately public and protects nothing — never use',
    'it on a real install.',
  ].join(' '),
  envelopeVersion: events.ENVELOPE_VERSION,
  encryptedEvents: [...events.ENCRYPTED_EVENTS],
  aad: 'utf8("<envelopeVersion>:<eventName>")',
  plaintextFraming: 'u32be(jsonByteLength) || utf8(json) || zero filler',
  ciphertextLayout: 'aes-256-gcm ciphertext || 16-byte auth tag, base64',
  checkinPad: events.CHECKIN_PAD,
  padLadder: events.PAD_LADDER,
  // `slides` pads on its own shorter ladder with NO round-up past 4096: an
  // 8192-padded plaintext base64-inflates past Pusher's ceiling, so that rung
  // must not exist for this event. Fail closed instead — see events.js.
  slidesPadLadder: events.SLIDES_PAD_LADDER,
  testKey: TEST_KEY,
  cases,
};

const canonical = path.join(__dirname, '..', 'envelope-vectors.json');
const mirror = '/home/user/Awana-Check-in-Display/src/lib/__fixtures__/envelope-vectors.json';
const json = `${JSON.stringify(out, null, 2)}\n`;
fs.writeFileSync(canonical, json);
console.log(`wrote ${canonical} (${cases.length} cases)`);
if (fs.existsSync(path.dirname(mirror))) {
  fs.writeFileSync(mirror, json);
  console.log(`mirrored to ${mirror}`);
} else {
  console.warn(`display repo not present — mirror ${path.basename(mirror)} by hand`);
}
