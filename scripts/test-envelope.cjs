#!/usr/bin/env node
// Tests for the sealed-envelope transport — plain Node, zero deps.
//
// TREAT THE NEGATIVE CASES AS LOAD-BEARING, NOT AS COVERAGE.
//
// Encryption-shaped code that accepts a tampered frame, or that returns partial
// plaintext on a failed tag check, or that lets a `checkin` ciphertext be
// replayed under the `recap` event name, is worse than no encryption: it carries
// the confidence without the property. Every assertion below that says "must
// reject" is the actual product here.
//
// Run: npm run test:envelope

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


const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const events = require('../print-server/events.js');

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

// Assert a thunk throws. Used for every "must reject" case — a silent pass here
// would mean a forged frame reaching a screen.
function rejects(name, fn) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  check(name, threw, 'it was ACCEPTED');
}

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'envelope-vectors.json'), 'utf8'));
const KEY = FIXTURE.testKey;

// ── 1. The committed fixture still opens ─────────────────────────────────────
// This is the interop pin. The display repo runs the equivalent assertion
// against a byte-identical mirror using WebCrypto, so a framing change on
// either side breaks that side's build instead of the club night.
console.log('\nenvelope: the committed interop fixture still opens');
{
  events.setDisplayKey(KEY);
  check('fixture declares the framing this build implements',
    FIXTURE.envelopeVersion === events.ENVELOPE_VERSION
    && FIXTURE.checkinPad === events.CHECKIN_PAD
    && JSON.stringify(FIXTURE.padLadder) === JSON.stringify(events.PAD_LADDER),
    'regenerate with scripts/gen-envelope-fixture.cjs AND mirror it');

  for (const c of FIXTURE.cases) {
    let opened = null;
    try { opened = events.openForTest(KEY, c.event, c.envelope); } catch (e) { /* reported below */ }
    check(`${c.vector} round-trips to its exact payload`,
      opened !== null && JSON.stringify(opened) === JSON.stringify(c.payload),
      'the seal/open framing changed — regenerate the fixture and mirror it');
  }
}

// ── 2. Length invariance — the re-identification channel ─────────────────────
// GCM is CTR-based and adds no padding, so without this every envelope reveals
// len(firstName) + len(club). Club is inferable from the PLAINTEXT tally event,
// and first names run 3-9 characters, so against a known church roster over a
// season an attacker could often guess who arrived. That would quietly demote
// the whole change from "cannot read the names" to "can often guess the names".
console.log('envelope: ciphertext length leaks nothing about the name');
{
  events.setDisplayKey(KEY);
  const lengths = new Set();
  // Deliberately extreme: a 1-char name in a 1-char club vs the longest the
  // builders will emit. These must be indistinguishable on the wire.
  const probes = [
    { firstName: 'A', club: 'X' },
    { firstName: 'Bartholomew', club: 'Truth & Training' },
    { firstName: 'A'.repeat(40), club: 'C'.repeat(40) },
  ];
  for (const p of probes) {
    const env = events.seal('checkin', events.buildCheckin(p));
    lengths.add(Buffer.from(env.ct, 'base64').length);
  }
  check('every sealed checkin is the same ciphertext length',
    lengths.size === 1, `got ${[...lengths].join(', ')} bytes`);

  const fixtureCheckins = FIXTURE.cases.filter((c) => c.event === 'checkin');
  const fixtureLengths = new Set(fixtureCheckins.map((c) => c.envelope.ct.length));
  check('every checkin vector in the fixture is the same length too',
    fixtureLengths.size === 1, `got ${[...fixtureLengths].join(', ')}`);

  // The bulk events must land on the declared ladder, not on their exact size.
  const recapSmall = events.seal('recap', events.buildRecap([
    { id: 'a', at: '2026-08-01T23:00:00.000Z', firstName: 'Amy', club: 'Sparks' },
  ]));
  const recapBig = events.seal('recap', events.buildRecap(
    Array.from({ length: 15 }, (_, i) => ({
      id: `id-${i}`, at: '2026-08-01T23:00:00.000Z', firstName: 'Nathaniel', club: 'Truth & Training',
    }))));
  const smallLen = Buffer.from(recapSmall.ct, 'base64').length - 16;
  const bigLen = Buffer.from(recapBig.ct, 'base64').length - 16;
  check('recap padding lands on the declared ladder',
    events.PAD_LADDER.includes(smallLen) && events.PAD_LADDER.includes(bigLen),
    `${smallLen} / ${bigLen}`);
  // Within a rung, entry count AND name lengths must both be hidden. The ladder
  // starts high (2048) precisely so realistic recaps all share one rung.
  const recapOf = (n, name) => events.seal('recap', events.buildRecap(
    Array.from({ length: n }, (_, i) => ({
      id: `id-${i}-0000-0000-0000-000000000000`, at: '2026-08-01T23:00:00.000Z',
      firstName: name, club: 'Sparks',
    }))));
  check('recaps of 3 and 4 entries are indistinguishable by length',
    recapOf(3, 'Amy').ct.length === recapOf(4, 'Amy').ct.length);
  check('a short name and a long name in the same recap are indistinguishable',
    recapOf(4, 'Amy').ct.length === recapOf(4, 'Bartholomew').ct.length);

  // Pusher rejects any event over its per-message ceiling, so padding must not
  // push a REALISTIC payload past it. Base64 inflates by 4/3, and the envelope
  // carries the iv and kid too — measure the whole serialized frame.
  const frameBytes = (env) => Buffer.from(JSON.stringify(env), 'utf8').length;
  const realisticWorst = [
    ['checkin', events.seal('checkin', events.buildCheckin({
      firstName: 'Bartholomew', club: 'Truth & Training', isBirthday: true }))],
    ['recap (15 entries)', events.seal('recap', events.buildRecap(
      Array.from({ length: 15 }, (_, i) => ({
        id: `123e4567-e89b-12d3-a456-42661417400${i % 10}`,
        at: '2026-08-01T23:59:59.999Z', firstName: 'Nathaniel',
        club: 'Truth & Training', isBirthday: true, isFirstTimer: true }))))],
    ['birthdays (40 entries)', events.seal('birthdays', events.buildBirthdays(
      Array.from({ length: 40 }, () => ({
        firstName: 'Nathaniel', club: 'Truth & Training', month: 12, day: 31 }))))],
  ];
  for (const [label, env] of realisticWorst) {
    const size = frameBytes(env);
    check(`${label} stays under Pusher's ${events.PUSHER_MAX_BYTES}-byte event ceiling`,
      size < events.PUSHER_MAX_BYTES, `frame is ${size} bytes`);
  }
}

// ── 3. Forgery, tampering, replay ────────────────────────────────────────────
console.log('envelope: forged and tampered frames are rejected');
{
  events.setDisplayKey(KEY);
  const payload = events.buildCheckin({ firstName: 'Amy', club: 'Sparks' });
  const env = events.seal('checkin', payload);

  const otherKey = crypto.randomBytes(32).toString('base64');
  rejects('a different key cannot open the frame',
    () => events.openForTest(otherKey, 'checkin', env));

  rejects('a checkin ciphertext replayed as a recap fails on the AAD',
    () => events.openForTest(KEY, 'recap', env));
  rejects('a checkin ciphertext replayed as a birthdays fails on the AAD',
    () => events.openForTest(KEY, 'birthdays', env));

  // Flip one bit of the ciphertext body. GCM must refuse, and crucially must
  // not hand back the decrypted-but-unauthenticated prefix.
  {
    const ct = Buffer.from(env.ct, 'base64');
    ct[10] ^= 0x01;
    rejects('a single flipped ciphertext byte fails authentication',
      () => events.openForTest(KEY, 'checkin', { ...env, ct: ct.toString('base64') }));
  }
  // Flip a bit of the auth tag itself.
  {
    const ct = Buffer.from(env.ct, 'base64');
    ct[ct.length - 1] ^= 0x80;
    rejects('a tampered auth tag fails authentication',
      () => events.openForTest(KEY, 'checkin', { ...env, ct: ct.toString('base64') }));
  }
  // Change the IV — same key, wrong nonce.
  {
    const iv = Buffer.from(env.iv, 'base64');
    iv[0] ^= 0xff;
    rejects('a substituted IV fails authentication',
      () => events.openForTest(KEY, 'checkin', { ...env, iv: iv.toString('base64') }));
  }
  rejects('a truncated ciphertext is rejected',
    () => events.openForTest(KEY, 'checkin', {
      ...env, ct: Buffer.from(env.ct, 'base64').subarray(0, 20).toString('base64') }));

  // Two seals of the SAME payload must differ — a reused (key, IV) pair in GCM
  // is catastrophic rather than merely weak, so this is not a style assertion.
  const a = events.seal('checkin', payload);
  const b = events.seal('checkin', payload);
  check('the IV is fresh per frame', a.iv !== b.iv);
  check('identical payloads produce different ciphertexts', a.ct !== b.ct);
  check('a 12-byte IV is used', Buffer.from(a.iv, 'base64').length === 12);
  check('the kid is stable for one key', a.kid === b.kid && a.kid === env.kid);
}

// ── 4. Key handling ──────────────────────────────────────────────────────────
console.log('envelope: key validation and fail-closed behaviour');
{
  check('a generated key is 32 bytes of base64',
    Buffer.from(events.generateDisplayKey(), 'base64').length === 32);
  check('two generated keys differ',
    events.generateDisplayKey() !== events.generateDisplayKey());

  for (const bad of ['', '   ', 'not base64!!', 'c2hvcnQ=', null, undefined, 42, {},
    Buffer.alloc(16).toString('base64'), Buffer.alloc(64).toString('base64')]) {
    check(`an invalid key is rejected: ${JSON.stringify(bad)}`,
      events.isValidDisplayKey(bad) === false);
  }
  check('a valid key is accepted', events.isValidDisplayKey(KEY) === true);

  // An invalid key must CLEAR rather than half-configure, so the fail-closed
  // branch in publish() catches it instead of a crypto throw at print time.
  events.setDisplayKey(KEY);
  check('setDisplayKey reports success for a good key',
    events.getDisplayKeyState().configured === true);
  check('setDisplayKey(garbage) returns false', events.setDisplayKey('garbage') === false);
  check('a rejected key leaves NO key configured, not a broken one',
    events.getDisplayKeyState().configured === false
    && events.getDisplayKeyState().kid === null);
  check('seal() returns null with no key configured', events.seal('checkin', { a: 1 }) === null);

  // Padding overflow must fail closed rather than silently choosing a bigger
  // rung, which would reintroduce the length channel for the frames that
  // matter most.
  check('a checkin too big for its fixed pad returns null, not a bigger rung',
    events.paddedSize('checkin', events.CHECKIN_PAD) === null);
  check('a checkin that fits gets the fixed pad',
    events.paddedSize('checkin', 10) === events.CHECKIN_PAD);
  check('bulk events land on the first rung that fits',
    events.paddedSize('recap', 600) === 2048
    && events.paddedSize('recap', 3000) === 4096);
  check('bulk events above the ladder round up to whole top rungs',
    events.paddedSize('recap', 70000) % events.PAD_LADDER[events.PAD_LADDER.length - 1] === 0);
}

// ── 5. publish() integration ─────────────────────────────────────────────────
console.log('envelope: publish() seals the right events and only those');
{
  const sent = [];
  const fakePusher = { trigger: (ch, ev, body) => { sent.push({ ev, body }); return Promise.resolve(); } };
  const isSealed = (b) => b && b.v === events.ENVELOPE_VERSION && typeof b.ct === 'string';

  events.setDisplayKey(KEY);
  const cases = {
    checkin: events.buildCheckin({ firstName: 'Amy', club: 'Sparks' }),
    recap: events.buildRecap([]),
    birthdays: events.buildBirthdays([{ firstName: 'Amy', club: 'Sparks', month: 8, day: 3 }]),
    tally: events.buildTally({ Sparks: 4 }, 4),
    tonight: events.buildTonight({ checkedIn: 12 }),
    notice: events.buildNotice('info', 'Club is on'),
    points: events.buildPoints({ Red: 10 }),
    canary: events.buildCanary(),
    ops: events.buildOps('canary'),
    schedule: events.buildSchedule({ nextMeetingDate: '2026-08-05' }),
  };
  return (async () => {
    for (const [ev, payload] of Object.entries(cases)) {
      await events.publish(fakePusher, 'awana-channel', ev, payload);
    }
    for (const { ev, body } of sent) {
      const shouldSeal = events.ENCRYPTED_EVENTS.has(ev);
      check(`${ev} is ${shouldSeal ? 'sealed' : 'plaintext'} on the wire`,
        isSealed(body) === shouldSeal,
        shouldSeal ? 'a name-bearing event went out in the clear' : 'a non-PII event was needlessly sealed');
    }
    // The plaintext events must still be readable, or a screen loses its
    // ability to distinguish "pipe down" from "cannot read names".
    const tally = sent.find((s) => s.ev === 'tally');
    check('tally counts are still readable by anyone (deliberate)',
      tally.body.counts && tally.body.counts.Sparks === 4);
    const notice = sent.find((s) => s.ev === 'notice');
    check('a CLUB CANCELLED notice is still readable by anyone (deliberate)',
      typeof notice.body.message === 'string' && notice.body.message.length > 0);

    // Every sealed frame must decrypt back to exactly what the builder made.
    for (const { ev, body } of sent.filter((s) => events.ENCRYPTED_EVENTS.has(s.ev))) {
      const opened = events.openForTest(KEY, ev, body);
      check(`${ev} decrypts back to the builder's payload`,
        JSON.stringify(opened) === JSON.stringify(cases[ev]));
    }

    // Unkeyed: publishes PLAINTEXT and says so. This is the deliberate
    // deviation from "fail closed on no key" — see SECURITY.md. An operator who
    // has not opted in yet must not have banners break under them on an
    // auto-update, and the consumer's anti-downgrade rule is what makes a
    // silent downgrade impossible once a screen IS keyed.
    sent.length = 0;
    events.setDisplayKey('');
    await events.publish(fakePusher, 'awana-channel', 'checkin', cases.checkin);
    check('with no key, checkin publishes plaintext (rollout mode)',
      sent.length === 1 && !isSealed(sent[0].body) && sent[0].body.firstName === 'Amy');
    check('and publishState records that it is NOT encrypting',
      events.getPublishState().encrypting === false,
      '/health must be able to tell the operator which mode they are in');

    // Keyed but unsealable: must publish NOTHING rather than fall back.
    sent.length = 0;
    events.setDisplayKey(KEY);
    const huge = { firstName: 'A'.repeat(300), club: 'B'.repeat(300), id: 'x', at: 'y' };
    const ok = await events.publish(fakePusher, 'awana-channel', 'checkin', huge);
    check('an unsealable checkin publishes NOTHING (fail closed)',
      ok === false && sent.length === 0,
      'it must never fall back to plaintext');
    check('and the failure is recorded for /health',
      /fail closed/.test(events.getPublishState().lastError || ''));

    // publish() must still never throw — printing depends on that.
    events.setDisplayKey(KEY);
    const throwing = { trigger: () => { throw new Error('pusher exploded'); } };
    let threw = false;
    try {
      check('publish never rejects even when the transport throws',
        (await events.publish(throwing, 'awana-channel', 'checkin', cases.checkin)) === false);
    } catch { threw = true; }
    check('publish did not throw synchronously either', threw === false);

    console.log('');
    console.log(`${passed} passed, ${failed} failed`);
    __suiteFinished = true;
    process.exit(failed > 0 ? 1 : 0);
  })();
}
