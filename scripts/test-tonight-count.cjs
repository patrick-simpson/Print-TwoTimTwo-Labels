#!/usr/bin/env node
// Tests for "how many children are here tonight" — authoritativeTonight() and
// the four count bugs fixed alongside it in 6.14.0.
//
// WHAT THIS GUARDS
//
// * The report is the source of truth WHEN IT IS FRESH, and this printer's own
//   history when it is not. Both modes, the boundary between them, and the
//   fact that the fallback is announced rather than silent.
// * A person's decision beats the report. A row marked `undoneBy` (the phone's
//   Remove, or the operator's Reset) stays removed even though TwoTimTwo's
//   report goes on listing that child all evening — which is exactly what made
//   Reset un-reset itself within a minute before 6.14.0.
// * One child, one count. A kid with both an `id:` history row and a `name:`
//   one (walk-in first, driven check-in later) is ONE child, not two.
// * A reprint cannot launder an award slip into a check-in.
// * The periodic tally outlives the club window by an hour, so the last kids
//   of the night are still counted on the wall.
//
// Run: node scripts/test-tonight-count.cjs

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34601);
const BASE = `http://127.0.0.1:${PORT}`;

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

const wire = [];
const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher {
      trigger(channel, event, payload) {
        wire.push({ channel, event, payload });
        return Promise.resolve();
      }
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
const feeds = require(path.join(__dirname, '..', 'print-server', 'feeds.js'));

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-tonight-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-tonight-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'ClubberID,FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + '9001,Nova,Tester,,,Sparks A,y\n'
    + '9002,Orion,Tester,,,Sparks A,y\n');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ printerName: 'Fake' }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const {
    authoritativeTonight, tonightCheckins, computeTonightStats, REPORT_FRESH_MS, TALLY_GRACE_MIN,
    localDayISO, historyIdentityKey,
  } = server;
  const setReport = server._setLastCheckinReportForTests;
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  const TODAY = localDayISO();
  const NOW = Date.now();
  const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

  // History is newest-first, the way loadHistory() serves it.
  const hist = (rows) => rows.map((r) => Object.assign({
    firstName: '', lastName: '', clubName: 'Sparks', success: true, timestamp: at(30),
  }, r));

  // ── 1. No report: exactly the behaviour that shipped before ───────────────
  console.log('\ntonight: with no report, history is the count');
  {
    setReport(null);
    const t = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001' },
      { firstName: 'Orion', lastName: 'Tester', clubberId: '9002', clubName: 'T&T' },
    ]), TODAY);
    const a = authoritativeTonight(t, NOW);
    check('the source is history', a.source === 'history');
    check('it counts the active rows', a.checkedIn === 2, JSON.stringify(a));
    check('per club, from the rows', JSON.stringify(a.byClub) === JSON.stringify({ Sparks: 1, 'T&T': 1 }),
      JSON.stringify(a.byClub));
    check('and there is no report timestamp to report', a.at === null && a.ageMs === null);
  }

  // ── 2. A fresh report IS the count ────────────────────────────────────────
  console.log('\ntonight: a fresh report is the count');
  {
    // History knows about one child. TwoTimTwo knows about three — two of them
    // checked in at a station that never printed a label, which is precisely
    // the gap this feature exists to close.
    const t = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', timestamp: at(40) },
    ]), TODAY);
    setReport({
      at: NOW - 2 * 60000,
      entries: [
        { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
        { clubberId: '9002', name: 'Orion Tester', club: 'T&T' },
        { clubberId: '9003', name: 'Rigel Tester', club: 'T&T' },
      ],
    });
    const a = authoritativeTonight(t, NOW);
    check('the source is the report', a.source === 'report');
    check('children TwoTimTwo saw but this printer never did are counted',
      a.checkedIn === 3, JSON.stringify(a));
    check('per club, from the report’s own club column',
      JSON.stringify(a.byClub) === JSON.stringify({ Sparks: 1, 'T&T': 2 }), JSON.stringify(a.byClub));
    check('and it says how old the report is', a.at === NOW - 2 * 60000 && a.ageMs === 2 * 60000);

    // The optimistic tick-up: a label printed AFTER the report was taken.
    const t2 = tonightCheckins(hist([
      { firstName: 'Sirius', lastName: 'Tester', clubberId: '9004', clubName: 'Cubbies', timestamp: at(1) },
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', timestamp: at(40) },
    ]), TODAY);
    const b = authoritativeTonight(t2, NOW);
    check('a child printed since the report ticks the count up immediately',
      b.checkedIn === 4, JSON.stringify(b));
    check('in their own club', b.byClub.Cubbies === 1, JSON.stringify(b.byClub));
    // And once the NEXT report lands carrying him, he must not count twice.
    setReport({
      at: NOW - 30 * 1000,
      entries: [
        { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
        { clubberId: '9002', name: 'Orion Tester', club: 'T&T' },
        { clubberId: '9003', name: 'Rigel Tester', club: 'T&T' },
        { clubberId: '9004', name: 'Sirius Tester', club: 'Cubbies' },
      ],
    });
    check('and the next report carrying him does not count him twice',
      authoritativeTonight(t2, NOW).checkedIn === 4, JSON.stringify(authoritativeTonight(t2, NOW)));
  }

  // ── 3. One child, two identity keys ──────────────────────────────────────
  console.log('\ntonight: one child is never two');
  {
    setReport(null);
    // Printed as a walk-in by name at the door, then the extension drove the
    // real check-in and printed again with TwoTimTwo's id.
    const rows = hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', timestamp: at(10) },
      { firstName: 'Nova', lastName: 'Tester', timestamp: at(25) },
    ]);
    const t = tonightCheckins(rows, TODAY);
    check('the two rows collapse to one child', t.active.length === 1, JSON.stringify(t.active));
    check('and the id row is the one kept',
      historyIdentityKey(t.active[0]) === 'id:9001', historyIdentityKey(t.active[0]));
    check('both prints are still in the print log', t.entries.length === 2);
    check('so the count is one, not two', authoritativeTonight(t, NOW).checkedIn === 1);

    // Two genuinely different children who happen to share nothing must not be
    // touched by that rule, and neither must same-named twins with distinct
    // ids (the case historyIdentityKey exists for in the first place).
    const twins = tonightCheckins(hist([
      { firstName: 'Mia', lastName: 'Castor', clubberId: '9005' },
      { firstName: 'Mia', lastName: 'Delphinus', clubberId: '9006' },
    ]), TODAY);
    check('same first name, different children, still two', twins.active.length === 2);

    // A report entry keyed by id must also find the name-only history row.
    setReport({ at: NOW - 60000, entries: [{ clubberId: '9001', name: 'Nova Tester', club: 'Sparks' }] });
    const nameOnly = tonightCheckins(hist([{ firstName: 'Nova', lastName: 'Tester', timestamp: at(25) }]), TODAY);
    check('a report entry with an id matches a history row with only a name',
      authoritativeTonight(nameOnly, NOW).checkedIn === 1,
      JSON.stringify(authoritativeTonight(nameOnly, NOW)));
  }

  // ── 4. A person's removal beats the report ───────────────────────────────
  console.log('\ntonight: Remove and Reset stay removed');
  {
    setReport({
      at: NOW - 60000,
      entries: [
        { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
        { clubberId: '9002', name: 'Orion Tester', club: 'Sparks' },
      ],
    });
    const removed = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', undone: true, undoneBy: 'phone' },
      { firstName: 'Orion', lastName: 'Tester', clubberId: '9002' },
    ]), TODAY);
    check('a phone Remove decrements even while the report still lists the child',
      authoritativeTonight(removed, NOW).checkedIn === 1,
      JSON.stringify(authoritativeTonight(removed, NOW)));

    const reset = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', undone: true, undoneBy: 'reset' },
      { firstName: 'Orion', lastName: 'Tester', clubberId: '9002', undone: true, undoneBy: 'reset' },
    ]), TODAY);
    check('a reset night stays at zero even against a report full of names',
      authoritativeTonight(reset, NOW).checkedIn === 0,
      JSON.stringify(authoritativeTonight(reset, NOW)));

    // An undo the RECONCILE pass made (no undoneBy) is TwoTimTwo's own truth,
    // and a report that lists the child again is the correction — so it must
    // NOT be suppressed the way a person's removal is.
    const reconciled = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', undone: true },
      { firstName: 'Orion', lastName: 'Tester', clubberId: '9002' },
    ]), TODAY);
    check('a reconcile-made undo is not a person’s decision, so the report wins',
      authoritativeTonight(reconciled, NOW).checkedIn === 2,
      JSON.stringify(authoritativeTonight(reconciled, NOW)));

    // A child removed and then genuinely checked in again: the NEWEST row is
    // active, so the stale undone row must not suppress them.
    setReport({ at: NOW - 60000, entries: [{ clubberId: '9001', name: 'Nova Tester', club: 'Sparks' }] });
    const rechecked = tonightCheckins(hist([
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', timestamp: at(2) },
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', undone: true, undoneBy: 'phone', timestamp: at(20) },
    ]), TODAY);
    check('a re-check-in after a Remove counts again', authoritativeTonight(rechecked, NOW).checkedIn === 1,
      JSON.stringify(authoritativeTonight(rechecked, NOW)));
  }

  // ── 5. Unregistered visitors ─────────────────────────────────────────────
  console.log('\ntonight: unregistered visitors (owner’s decision)');
  {
    setReport({ at: NOW - 60000, entries: [{ clubberId: '9001', name: 'Nova Tester', club: 'Sparks' }] });
    const t = tonightCheckins(hist([
      { firstName: 'Vera', lastName: 'Visitor', clubName: 'Cubbies', visitor: true, timestamp: at(1) },
      { firstName: 'Nova', lastName: 'Tester', clubberId: '9001', timestamp: at(20) },
    ]), TODAY);
    const a = authoritativeTonight(t, NOW);
    check('a walk-in visitor does not tick a report-backed count up', a.checkedIn === 1, JSON.stringify(a));
    check('and does not appear in the per-club numbers', a.byClub.Cubbies === undefined, JSON.stringify(a.byClub));
    // But a visitor who IS on the report (registered at the desk) counts like
    // anyone else — the rule is "on the report", not "not a visitor".
    setReport({
      at: NOW - 60000,
      entries: [
        { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
        { name: 'Vera Visitor', club: 'Cubbies' },
      ],
    });
    check('a visitor the report knows about does count',
      authoritativeTonight(t, NOW).checkedIn === 2, JSON.stringify(authoritativeTonight(t, NOW)));
    // With no report at all, nothing changes for visitors: they are children
    // this printer printed for, and history mode counts exactly those.
    setReport(null);
    check('with no report, a visitor counts as they always did',
      authoritativeTonight(t, NOW).checkedIn === 2);
  }

  // ── 6. Freshness ─────────────────────────────────────────────────────────
  console.log('\ntonight: a stale report stops speaking');
  {
    const t = tonightCheckins(hist([{ firstName: 'Nova', lastName: 'Tester', clubberId: '9001' }]), TODAY);
    const entries = [
      { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
      { clubberId: '9002', name: 'Orion Tester', club: 'Sparks' },
    ];
    setReport({ at: NOW - (REPORT_FRESH_MS - 1000), entries });
    check('just inside the window it still speaks', authoritativeTonight(t, NOW).source === 'report');
    setReport({ at: NOW - (REPORT_FRESH_MS + 1000), entries });
    const stale = authoritativeTonight(t, NOW);
    check('just outside it, history takes over', stale.source === 'history');
    check('and the count falls back to what this printer knows', stale.checkedIn === 1);
    setReport({ at: NOW + 5 * 60000, entries });
    check('a report from the future is broken, not fresh',
      authoritativeTonight(t, NOW).source === 'history');
    setReport({ at: NOW - 20 * 60 * 60 * 1000, entries });
    check('yesterday’s report never speaks for tonight',
      authoritativeTonight(t, NOW).source === 'history');
    setReport(null);
  }

  // ── 7. The tally window outlives club by an hour ─────────────────────────
  console.log('\ntonight: the tally keeps going after club ends');
  {
    const nights = [{ dow: 3, start: '17:30', end: '20:00' }];
    const wed = (h, m) => new Date(2026, 8, 16, h, m, 0); // a Wednesday
    check(`the grace is ${TALLY_GRACE_MIN} minutes`, TALLY_GRACE_MIN === 60);
    check('inside club, both windows are open',
      events.isClubNightNow(nights, wed(19, 0)) === true
      && events.isClubNightNow(nights, wed(19, 0), TALLY_GRACE_MIN) === true);
    check('at 20:05 the club window has closed',
      events.isClubNightNow(nights, wed(20, 5)) === false);
    check('...but the tally window has not — the last kids are still being counted',
      events.isClubNightNow(nights, wed(20, 5), TALLY_GRACE_MIN) === true);
    check('at 20:59 it is still open', events.isClubNightNow(nights, wed(20, 59), TALLY_GRACE_MIN) === true);
    check('at 21:00 it closes too', events.isClubNightNow(nights, wed(21, 0), TALLY_GRACE_MIN) === false);
    check('before club it is shut either way',
      events.isClubNightNow(nights, wed(17, 0), TALLY_GRACE_MIN) === false);
    check('and a Thursday is not a club night however much grace you give it',
      events.isClubNightNow(nights, new Date(2026, 8, 17, 20, 30), TALLY_GRACE_MIN) === false);
    check('grace never rolls past midnight into the next day',
      events.isClubNightNow([{ dow: 3, start: '22:00', end: '23:30' }], wed(23, 59), TALLY_GRACE_MIN) === true
      && events.isClubNightNow([{ dow: 3, start: '22:00', end: '23:30' }], new Date(2026, 8, 17, 0, 10), TALLY_GRACE_MIN) === false);
    check('omitting the grace is byte-identical to the old two-argument call',
      events.isClubNightNow(nights, wed(20, 5)) === events.isClubNightNow(nights, wed(20, 5), 0));
  }

  // ── 8. The routes ────────────────────────────────────────────────────────
  console.log('\ntonight: the routes that write history');
  {
    setReport(null);
    await post('/print', { firstName: 'Nova', lastName: 'Tester', clubName: 'Sparks', clubberId: '9001' });
    await post('/print', { firstName: 'Orion', lastName: 'Tester', clubName: 'Sparks', clubberId: '9002' });
    check('two children are checked in', computeTonightStats().checkedIn === 2,
      String(computeTonightStats().checkedIn));

    // Reset, then let the report come back still listing both of them — the
    // exact sequence that used to un-reset the night within a minute.
    const reset = await post('/reset-tonight', { confirm: true });
    check('reset marks both rows undone', reset.status === 200 && reset.body.undone === 2,
      JSON.stringify(reset.body));
    const history = (await j('/history')).body || [];
    check('and stamps them undoneBy: reset, so reconcile leaves them alone',
      history.filter((r) => r.undone).length === 2
      && history.filter((r) => r.undoneBy === 'reset').length === 2,
      JSON.stringify(history.map((r) => [r.firstName, r.undone, r.undoneBy])));
    check('the count is zero', computeTonightStats().checkedIn === 0);

    feeds._resetForTests();
    const rep = await post('/feed/checkin-report', { ok: true, entries: [
      { clubberId: '9001', name: 'Nova Tester', club: 'Sparks' },
      { clubberId: '9002', name: 'Orion Tester', club: 'Sparks' },
    ] });
    check('a report listing both of them is accepted', rep.status === 200 && rep.body.applied === true,
      JSON.stringify(rep.body));
    check('...and the reset STAYS reset', computeTonightStats().checkedIn === 0,
      String(computeTonightStats().checkedIn));
    check('the report is what the count is built from now',
      computeTonightStats().countSource === 'report');

    // A report the mass-undo guard refuses must not become the count either.
    // Fresh names: the duplicate-print window would swallow a repeat of the
    // two above, and this phase needs real rows, not suppressed ones.
    await post('/print', { firstName: 'Rigel', lastName: 'Tester', clubName: 'Sparks', clubberId: '9003' });
    await post('/print', { firstName: 'Sirius', lastName: 'Tester', clubName: 'Sparks', clubberId: '9004' });
    check('two children are checked in again', computeTonightStats().checkedIn === 2,
      String(computeTonightStats().checkedIn));
    const trusted = server._getLastCheckinReportForTests();
    feeds._resetForTests();
    const guarded = await post('/feed/checkin-report', { ok: true, entries: [] });
    check('an empty report is refused by the mass-undo guard',
      guarded.body.applied === false, JSON.stringify(guarded.body));
    check('...and is NOT adopted as the count — the guard is the one judge of a scrape',
      server._getLastCheckinReportForTests() === trusted);
    check('so the night is still two children, not zero', computeTonightStats().checkedIn === 2,
      String(computeTonightStats().checkedIn));
  }

  // ── 9. A reprint cannot launder an award slip ────────────────────────────
  console.log('\ntonight: /reprint by index refuses a non-check-in row');
  {
    const award = await post('/print-award', { name: 'Nova Tester', clubName: 'Sparks', award: 'Book 1 finished' });
    check('an award slip prints', award.status === 200 && award.body.success === true, JSON.stringify(award.body));
    const history = (await j('/history')).body || [];
    const idx = history.findIndex((r) => r.isAward === true);
    check('and is recorded as an award row', idx >= 0);

    const before = computeTonightStats().checkedIn;
    const re = await post('/reprint', { index: idx });
    check('reprinting it by index is refused with a 400', re.status === 400, JSON.stringify(re.body));
    check('and the reason says what the row actually is', /award slip/i.test((re.body || {}).error || ''),
      JSON.stringify(re.body));
    const after = (await j('/history')).body || [];
    check('no unflagged copy of it was written', after.length === history.length,
      `${history.length} -> ${after.length}`);
    check('so tonight’s count did not gain a child', computeTonightStats().checkedIn === before);

    // A leader row, by contrast, reprints fine — reprintRow has its own branch
    // that keeps the isLeader flag, so it is still not a check-in.
    await post('/print-leader', { name: 'Cara Leader', clubName: 'Sparks' });
    const withLeader = (await j('/history')).body || [];
    const leaderIdx = withLeader.findIndex((r) => r.isLeader === true);
    const reLeader = await post('/reprint', { index: leaderIdx });
    check('a leader tag still reprints as a leader tag',
      reLeader.status === 200 && reLeader.body.leader === true, JSON.stringify(reLeader.body));
    check('and it is still not a child', computeTonightStats().checkedIn === before);
  }

  // ── 10. /health says which measurement it used ───────────────────────────
  console.log('\ntonight: /health names the fallback');
  {
    const texts = (w) => (w || []).map((x) => (x && typeof x === 'object' ? x.message : String(x)));
    const typed = (w) => (w || []).filter((x) => x && x.type === 'tally-source');

    setReport({ at: Date.now(), entries: [] });
    let h = await j('/health');
    check('a fresh report is not a warning — it is the good state',
      typed(h.body.warnings).length === 0, JSON.stringify(h.body.warnings));
    check('and /health reports the source as data too', h.body.tallySource.source === 'report',
      JSON.stringify(h.body.tallySource));

    setReport({ at: Date.now() - 25 * 60000, entries: [] });
    h = await j('/health');
    const warn = typed(h.body.warnings)[0];
    check('a stale report IS a warning', !!warn, JSON.stringify(h.body.warnings));
    check('it is a {type, message} object, never a bare string',
      warn && typeof warn.message === 'string' && warn.message.length > 20, JSON.stringify(warn));
    check('it says the count came from the printer’s own history',
      /printer’s own history|printer's own history/.test(warn.message), warn.message);
    check('and how long the report has been missing', /25 minutes/.test(warn.message), warn.message);
    check('the data field agrees', h.body.tallySource.source === 'history');
    check('every /health warning is still an object',
      texts(h.body.warnings).every((t) => typeof t === 'string' && t !== 'undefined'));

    setReport(null);
  }

  listener.close();
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  __suiteFinished = true;
  process.exit(1);
});
