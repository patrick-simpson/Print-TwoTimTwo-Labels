#!/usr/bin/env node
// Tests for the connect card (#10): the attendance-ledger signals that drive
// the auto-trigger, the trigger itself over HTTP, and the guarantee that a
// connect card is a PRINT but never a CHECK-IN.
//
// The auto-trigger's safety claim is negative in two directions:
//   • opening night / a fresh install must NOT fire a card per child (every
//     kid's ledger count is 1 that night), and
//   • a card row in history must NOT inflate anything that counts check-ins —
//     tonight's stats, the CSV write-back into TwoTimTwo, or reprint-by-name.
// Both get paired positive controls, same discipline as test-server-demo.cjs.
//
// printImage() shells out to `powershell`, which does not exist on Linux, so a
// stub that exits 0 is placed on PATH (also mirrors test-server-demo.cjs).
//
// Run: npm run test:connect

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


const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34573);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method,
      path: pathname,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        : {},
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, body: data, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}
const post = (p, b) => request('POST', p, b);
const get = (p) => request('GET', p);

function readJson(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch { return null; }
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-connect-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-connect-bin-'));

  const stub = path.join(binDir, 'powershell');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Roster,Kid,2018-03-15,,Cubbies A,y\n');

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const { recordAttendance, isNonCheckinRow } = server;
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  console.log('\nconnect card: attendance-ledger signals');

  // ── 1. recordAttendance: signals and id migration ──────────────────────────
  {
    // Empty ledger, first kid tonight: their first night ever, but the club has
    // never met before — the opening-night / fresh-install shape.
    let att = recordAttendance('Alice', 'First', null);
    check('first kid on a fresh ledger: firstEver', att.firstEver === true, JSON.stringify(att));
    check('first kid on a fresh ledger: NO prior night', att.priorNightExists === false, JSON.stringify(att));
    check('first kid on a fresh ledger: seasonCount 1', att.seasonCount === 1, JSON.stringify(att));

    // Same kid again tonight: idempotent, still their first night.
    att = recordAttendance('Alice', 'First', null);
    check('same kid same night: still firstEver, count still 1',
      att.firstEver === true && att.seasonCount === 1, JSON.stringify(att));

    // A second kid the same night still sees no PRIOR night — tonight is not
    // "before tonight". This is what keeps opening night card-free even
    // mid-evening, after dozens of kids have already printed.
    att = recordAttendance('Bob', 'Second', null);
    check('second kid, same night: still no prior night', att.priorNightExists === false, JSON.stringify(att));

    // Seed an earlier club night, as history would have left it.
    const ledger = readJson(dataDir, 'attendance.json');
    ledger['veteran kid'] = { name: 'Veteran Kid', dates: ['2025-11-05'] };
    fs.writeFileSync(path.join(dataDir, 'attendance.json'), JSON.stringify(ledger));

    att = recordAttendance('Cara', 'Newface', null);
    check('new face after a prior night: firstEver AND priorNightExists',
      att.firstEver === true && att.priorNightExists === true, JSON.stringify(att));

    att = recordAttendance('Veteran', 'Kid', null);
    check('returning kid: NOT firstEver (dates span seasons)',
      att.firstEver === false, JSON.stringify(att));

    // Id migration: the kid's name-keyed streak moves to the id key intact.
    att = recordAttendance('Veteran', 'Kid', '778899');
    check('id call migrates the name entry: streak continues, not reset',
      att.firstEver === false, JSON.stringify(att));
    const after = readJson(dataDir, 'attendance.json');
    check('ledger now holds the id key', !!after['id:778899'], Object.keys(after).join(','));
    check('the legacy name key is retired', !after['veteran kid'], Object.keys(after).join(','));
    check('the migrated entry kept its dates',
      after['id:778899'].dates.includes('2025-11-05') && after['id:778899'].dates.includes(todayISO()),
      JSON.stringify(after['id:778899']));
  }

  // ── 1.5 Streak (#14): consecutive club nights, gaps between nights ignored ─
  {
    // Five past club nights. StreakKid attended all five; GapKid missed the
    // third-from-last. The ledger's union of dates defines what a "club
    // night" is, so the seeded veteran night (2025-11-05) participates too.
    const nights = ['2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04'];
    const ledger = readJson(dataDir, 'attendance.json');
    ledger['streak kid'] = { name: 'Streak Kid', dates: nights.slice() };
    ledger['gap kid'] = { name: 'Gap Kid', dates: nights.filter(d => d !== '2026-02-18') };
    fs.writeFileSync(path.join(dataDir, 'attendance.json'), JSON.stringify(ledger));

    // Tonight is a club night for both (recordAttendance adds today).
    const s = recordAttendance('Streak', 'Kid', null);
    // today + the five nights = 6 consecutive; the 2025-11-05 veteran night
    // breaks it there (StreakKid stayed home that night).
    check('unbroken run counts today + every trailing club night', s.streak === 6, JSON.stringify(s));

    const g = recordAttendance('Gap', 'Kid', null);
    // today, 03-04, 02-25 attended; 02-18 was a club night GapKid missed.
    check('a missed club night ends the streak', g.streak === 3, JSON.stringify(g));

    // Calendar gaps don't matter: only club nights count. (StreakKid's run
    // spans Feb 4 → today with multi-week silences in between.)
    check('weeks with no club at all never break a streak', s.streak === 6);

    // New-kid sparkle (#15): within 14 days of the kid's FIRST-EVER night.
    check('a first-ever check-in is a new kid', recordAttendance('Brand', 'New', null).isNewKid === true);
    check('a long-timer is not a new kid', s.isNewKid === false, JSON.stringify(s));
    const daysAgo = (n) => {
      const d = new Date(); d.setDate(d.getDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const l2 = readJson(dataDir, 'attendance.json');
    l2['recent kid'] = { name: 'Recent Kid', dates: [daysAgo(13)] };
    l2['fortnight kid'] = { name: 'Fortnight Kid', dates: [daysAgo(14)] };
    fs.writeFileSync(path.join(dataDir, 'attendance.json'), JSON.stringify(l2));
    check('first night 13 days ago: still sparkling',
      recordAttendance('Recent', 'Kid', null).isNewKid === true);
    check('first night 14 days ago: sparkle expired',
      recordAttendance('Fortnight', 'Kid', null).isNewKid === false);
  }

  // ── 2. isNonCheckinRow: one predicate for both non-check-in prints ─────────
  {
    check('award slips are non-check-in rows', isNonCheckinRow({ isAward: true }) === true);
    check('connect cards are non-check-in rows', isNonCheckinRow({ isConnectCard: true }) === true);
    check('leader name tags are non-check-in rows', isNonCheckinRow({ isLeader: true }) === true);
    check('a plain row is a check-in', isNonCheckinRow({ firstName: 'A' }) === false);
    check('null-safe', isNonCheckinRow(null) === false);
  }

  console.log('connect card: HTTP trigger + non-check-in guarantees');

  // ── 3. Auto-trigger over HTTP ───────────────────────────────────────────────
  {
    const cfg = await post('/config', {
      connectCard: true,
      connectCardAutoFirstTimer: true,
      connectCardGreeting: 'Welcome to club night!',
    });
    check('config save accepted', cfg.status === 200, cfg.body.slice(0, 120));
    const roundTrip = (await get('/config')).json || {};
    check('connectCardAutoFirstTimer round-trips', roundTrip.connectCardAutoFirstTimer === true);
    check('connectCardGreeting round-trips', roundTrip.connectCardGreeting === 'Welcome to club night!');

    // A brand-new name, no visitor flag: the ledger (which has the seeded
    // earlier night) should auto-fire the card.
    const res = await post('/print', { firstName: 'Auto', lastName: 'Detected', clubName: 'Cubbies' });
    check('auto-detected first-timer print succeeds', res.status === 200, res.body.slice(0, 120));

    const history = readJson(dataDir, 'print-history.json') || [];
    const cardRows = history.filter(e => e.isConnectCard);
    const checkinRows = history.filter(e => !isNonCheckinRow(e));
    check('the connect card was recorded in history', cardRows.length === 1, JSON.stringify(history));
    check('exactly one CHECK-IN row for the kid', checkinRows.length === 1, JSON.stringify(history));

    // The sealed checkin event (buffered for recap) carries the welcome flag.
    const buffer = readJson(dataDir, 'events-buffer.json') || [];
    const evt = buffer[buffer.length - 1];
    check('the checkin event is flagged isFirstTimer for the display',
      evt && evt.isFirstTimer === true, JSON.stringify(evt));

    // Non-check-in guarantees, with the card row present:
    const stats = (await get('/stats/tonight')).json || {};
    check('the card does NOT inflate tonight\'s check-ins', stats.checkedIn === 1, JSON.stringify(stats));
    const csv = (await get('/checkin-csv-export')).body || '';
    const csvRows = csv.trim().split('\n').slice(1);
    check('the card does NOT reach the TwoTimTwo write-back CSV',
      csvRows.length === 1 && csvRows[0].includes('Auto'), JSON.stringify(csvRows));

    // Reprint-by-name must find the check-in label, never the card row (the
    // card row is newer — history is newest-first — so a missing exclusion
    // would pick it first).
    const rep = await post('/reprint', { name: 'Auto Detected' });
    check('reprint-by-name still targets the check-in label', rep.status === 200, rep.body.slice(0, 120));

    // The same kid a second time tonight: dedup suppresses the whole request.
    // A NEW kid tonight is no longer firstEver→false? They are firstEver (their
    // own first night) and a prior night exists (the seeded one) → card fires
    // again for them, proving the trigger is per-child, not per-night.
    const res2 = await post('/print', { firstName: 'Another', lastName: 'Newkid', clubName: 'Cubbies' });
    check('a second new kid also gets a card', res2.status === 200
      && (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length === 2);

    // A kid with attendance from an earlier night (seeded in section 1, since
    // migrated to their id key) is not firstEver, so no card. The id matters:
    // an id-less print for a migrated kid starts a fresh name entry — the
    // documented benign failure mode of the migration.
    const res3 = await post('/print', { firstName: 'Veteran', lastName: 'Kid', clubName: 'Cubbies', clubberId: '778899' });
    check('a returning kid gets no card', res3.status === 200
      && (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length === 2,
      JSON.stringify(readJson(dataDir, 'print-history.json')));

    // Once per kid per night: Cara re-printed with a clubberId slips past the
    // 25s dedup window (different dup key) and is STILL firstEver (tonight is
    // her only ledger date) — the history gate is what stops a second card.
    const cardsBefore = (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length;
    await post('/print', { firstName: 'Auto', lastName: 'Detected', clubName: 'Cubbies', clubberId: '424242' });
    const cardsAfter = (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length;
    check('a re-print the same night does not produce a second card',
      cardsAfter === cardsBefore, `${cardsBefore} → ${cardsAfter}`);
  }

  // ── 4. The toggle is honored ────────────────────────────────────────────────
  {
    await post('/config', { connectCard: true, connectCardAutoFirstTimer: false });
    const before = (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length;
    const res = await post('/print', { firstName: 'Toggled', lastName: 'Off', clubName: 'Cubbies' });
    const after = (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length;
    check('auto-trigger off: a new kid gets no card', res.status === 200 && after === before,
      `${before} → ${after}`);

    // …but the operator's explicit visitor flag still fires it.
    const res2 = await post('/print', { firstName: 'Marked', lastName: 'Visitor', clubName: 'Cubbies', visitor: true });
    const after2 = (readJson(dataDir, 'print-history.json') || []).filter(e => e.isConnectCard).length;
    check('explicit visitor flag still fires the card', res2.status === 200 && after2 === before + 1,
      `${before} → ${after2}`);
  }

  // ── 5. Greeting sanitization ───────────────────────────────────────────────
  {
    await post('/config', { connectCardGreeting: '  Hi\tthere\n  friends  ' + 'x'.repeat(100) });
    const cfg = (await get('/config')).json || {};
    check('greeting is collapsed to one bounded printable line',
      typeof cfg.connectCardGreeting === 'string'
        && cfg.connectCardGreeting.length <= 60
        && cfg.connectCardGreeting.startsWith('Hi there friends'),
      JSON.stringify(cfg.connectCardGreeting));
    await post('/config', { connectCardGreeting: '' });
    const cleared = (await get('/config')).json || {};
    check('clearing the greeting deletes the key (default applies)',
      !('connectCardGreeting' in cleared), JSON.stringify(cleared.connectCardGreeting));
  }

  listener.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  - ${f}`));
  }
  // Unconditional: server.js arms module-level publish intervals, so without
  // an explicit exit the process hangs the npm test chain forever.
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
