#!/usr/bin/env node
// Contract tests for the Awana event bus — plain Node, zero dependencies.
// Validates every payload builder in print-server/events.js against the
// canonical contract-vectors.json, plus the isClubNightNow() scheduling gate.
//
// Run: npm run test:contracts   (or: node scripts/test-contracts.cjs)

'use strict';

const path = require('path');
const fs = require('fs');

const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
const vectors = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'contract-vectors.json'), 'utf8')
);

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

function keysOf(obj) {
  return Object.keys(obj).sort();
}

function sameKeys(obj, fields, optional) {
  const opt = new Set(optional || []);
  const have = new Set(Object.keys(obj));
  for (const f of fields) {
    if (opt.has(f)) continue;
    if (!have.has(f)) return false;
  }
  for (const k of have) {
    if (!fields.includes(k) && !(vectorsOptional(k, optional))) return false;
  }
  return true;
}

function vectorsOptional(key, optional) {
  return (optional || []).includes(key);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

console.log('contract-vectors.json — self-consistency');
{
  check('contractVersion is 2', vectors.contractVersion === 2);
  check('channel is awana-channel', vectors.channel === 'awana-channel');
  for (const [name, spec] of Object.entries(vectors.events)) {
    for (const [i, v] of (spec.valid || []).entries()) {
      const allowed = [...spec.fields, ...(spec.optionalFields || [])];
      const extras = Object.keys(v).filter(k => !allowed.includes(k));
      check(`${name}.valid[${i}] has only declared fields`, extras.length === 0, `extras: ${extras.join(',')}`);
    }
    // The privacy rule, applied to the vectors themselves.
    const banned = ['lastName', 'allergies', 'phone', 'address', 'photo'];
    for (const [i, v] of (spec.valid || []).entries()) {
      const raw = JSON.stringify(v);
      check(`${name}.valid[${i}] carries no PII fields`, !banned.some(b => raw.includes(`"${b}"`)));
    }
  }
}

console.log('buildCheckin');
{
  const spec = vectors.events.checkin;
  const c = events.buildCheckin({ firstName: '  Alice  ', club: 'Sparks', isBirthday: 1, isFirstTimer: 0 });
  check('exact field set', keysOf(c).join(',') === [...spec.fields].sort().join(','), keysOf(c).join(','));
  check('id is a uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(c.id));
  check('at is ISO', ISO_RE.test(c.at));
  check('firstName trimmed', c.firstName === 'Alice');
  check('booleans coerced', c.isBirthday === true && c.isFirstTimer === false);
  const c2 = events.buildCheckin({ firstName: 'Alice', lastName: 'Smith', club: 'Sparks', allergies: 'nuts' });
  check('lastName structurally impossible', !('lastName' in c2) && !JSON.stringify(c2).includes('Smith'));
  check('allergies structurally impossible', !('allergies' in c2) && !JSON.stringify(c2).includes('nuts'));
  check('long names truncated to 40', events.buildCheckin({ firstName: 'x'.repeat(100) }).firstName.length === 40);
  check('null input safe', typeof events.buildCheckin(null) === 'object');
}

console.log('buildRecap');
{
  const spec = vectors.events.recap;
  const mk = n => events.buildCheckin({ firstName: 'Kid' + n, club: 'Sparks' });
  const buffer = Array.from({ length: 25 }, (_, i) => mk(i));
  const r = events.buildRecap(buffer);
  check('exact field set', keysOf(r).join(',') === [...spec.fields].sort().join(','));
  check(`caps at ${events.RECAP_MAX} entries`, r.entries.length === events.RECAP_MAX);
  check('keeps the MOST RECENT entries', r.entries[r.entries.length - 1].firstName === 'Kid24');
  check('at is ISO', ISO_RE.test(r.at));
  for (const e of r.entries) {
    check('entry has exact checkin shape', keysOf(e).join(',') === [...spec.entryFields].sort().join(','));
  }
  const dirty = events.buildRecap([{ firstName: 'NoId', club: 'Sparks' }, buffer[0]]);
  check('entries without id/at dropped', dirty.entries.length === 1 && dirty.entries[0].firstName === 'Kid0');
  check('non-array input safe', events.buildRecap('garbage').entries.length === 0);
}

console.log('buildTally');
{
  const spec = vectors.events.tally;
  const t = events.buildTally({ Sparks: 12, 'T&T': 19.7, Cubbies: -3, Trek: 'Alice Smith' }, undefined);
  check('exact field set', keysOf(t).join(',') === [...spec.fields].sort().join(','));
  check('floats floored', t.counts['T&T'] === 19);
  check('negative counts dropped', !('Cubbies' in t.counts));
  check('non-numeric counts dropped (PII can never ride a tally)', !('Trek' in t.counts) && !JSON.stringify(t).includes('Alice'));
  check('total derived when omitted', t.total === 31);
  check('explicit total honored', events.buildTally({ Sparks: 1 }, 5).total === 5);
  check('at is ISO', ISO_RE.test(t.at));
  check('null input safe', events.buildTally(null).total === 0);
}

console.log('buildBirthdays');
{
  const spec = vectors.events.birthdays;
  const b = events.buildBirthdays([
    { firstName: 'Maya', club: 'Puggles', month: 9, day: 18 },
    { firstName: 'Maya', lastName: 'Nguyen', club: 'Puggles', month: 9, day: 18, year: 2020 },
    { firstName: 'Ghost', club: 'Sparks', month: 13, day: 40 },
    { firstName: '', club: 'Sparks', month: 5, day: 5 },
    null,
  ]);
  check('exact field set', keysOf(b).join(',') === [...spec.fields].sort().join(','));
  check('valid entries pass', b.entries.length === 2);
  for (const e of b.entries) {
    check('entry has exact shape', keysOf(e).join(',') === [...spec.entryFields].sort().join(','));
  }
  check('lastName/year structurally impossible', !JSON.stringify(b).includes('Nguyen') && !JSON.stringify(b).includes('2020'));
  check('out-of-range month/day dropped', !JSON.stringify(b).includes('Ghost'));
  const big = events.buildBirthdays(Array.from({ length: 100 }, (_, i) => ({ firstName: 'K' + i, club: 'Sparks', month: 1, day: 1 })));
  check('caps at 40 entries', big.entries.length === 40);
}

console.log('buildOps');
{
  const spec = vectors.events.ops;
  const o = events.buildOps('print-failure', 'Sparks');
  check('exact field set (with club)', keysOf(o).join(',') === [...spec.fields, ...spec.optionalFields].sort().join(','));
  const o2 = events.buildOps('selector-fail');
  check('club omitted when absent', keysOf(o2).join(',') === [...spec.fields].sort().join(','));
  check('unknown type returns null', events.buildOps('reboot-everything') === null);
  check('type enum matches vectors', JSON.stringify([...events.OPS_TYPES].sort()) === JSON.stringify([...spec.types].sort()));
  check('ops never carries a name field', !('name' in o) && !('firstName' in o));
}

console.log('buildCanary');
{
  const c = events.buildCanary();
  check('at is ISO', ISO_RE.test(c.at));
  check('nonce is a short hex string', /^[0-9a-f]{16}$/.test(c.nonce));
  check('no other fields', keysOf(c).join(',') === 'at,nonce');
}

console.log('isClubNightNow');
{
  const nights = [{ dow: 3, start: '17:30', end: '20:00' }];
  // Wed Sep 16 2026 is a Wednesday.
  check('inside window', events.isClubNightNow(nights, new Date(2026, 8, 16, 18, 0)) === true);
  check('at start (inclusive)', events.isClubNightNow(nights, new Date(2026, 8, 16, 17, 30)) === true);
  check('at end (exclusive)', events.isClubNightNow(nights, new Date(2026, 8, 16, 20, 0)) === false);
  check('before window', events.isClubNightNow(nights, new Date(2026, 8, 16, 17, 29)) === false);
  check('wrong day', events.isClubNightNow(nights, new Date(2026, 8, 17, 18, 0)) === false);
  check('empty config', events.isClubNightNow([], new Date(2026, 8, 16, 18, 0)) === false);
  check('garbage config safe', events.isClubNightNow('wednesday') === false);
  check('malformed window safe', events.isClubNightNow([{ dow: 3, start: 'six', end: '20:00' }], new Date(2026, 8, 16, 18, 0)) === false);
}

console.log('publish() resilience');
{
  // A pusher whose trigger rejects must never reject the publish() promise.
  const rejecting = { trigger: () => Promise.reject(new Error('network down')) };
  const throwing = { trigger: () => { throw new Error('sync throw'); } };
  Promise.all([
    events.publish(rejecting, 'awana-channel', 'tally', events.buildTally({}, 0)),
    events.publish(throwing, 'awana-channel', 'tally', events.buildTally({}, 0)),
    events.publish(null, 'awana-channel', 'tally', events.buildTally({}, 0)),
  ]).then(([a, b, c]) => {
    check('rejecting trigger → false', a === false);
    check('throwing trigger → false', b === false);
    check('null pusher → false', c === false);
    const st = events.getPublishState();
    check('failure recorded for /health', st.lastPublishOk === false && !!st.lastError);
    finish();
  }).catch(e => {
    failed++;
    console.error('  ✗ publish() rejected — it must NEVER reject:', e.message);
    finish();
  });
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
