#!/usr/bin/env node
// Tests for demo / training mode (POST /print with `demo: true`).
//
// The whole safety claim of demo mode is negative — "a fake check-in touches
// NOTHING" — so these tests are written as paired runs: the same request with
// and without the flag, asserting the demo one leaves no trace while the
// control one does. A test that only checked the demo path would pass just as
// happily if /print were broken entirely.
//
// Each guarded side effect matters for a concrete reason:
//   • print-history.json feeds /checkin-csv-export, which is imported BACK
//     INTO TwoTimTwo — a fake kid would be recorded as having attended.
//   • attendance.json is the permanent season ledger; padding it corrupts real
//     milestone lines ("10th club night!") for the rest of the year.
//   • events-buffer.json + the Pusher publish put a fake child's name on the
//     lobby TV.
//
// printImage() shells out to `powershell`, which does not exist on Linux, so a
// stub that exits 0 is placed on PATH. Without it every print lands in the
// catch block and the success-path guards could never be exercised at all.
//
// Run: npm run test:demo

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34571);

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

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method: 'POST',
      path: pathname,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: data, json: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, body: data, json: parsed });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Read a DATA_DIR json file, or null when it doesn't exist yet.
function readJson(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch { return null; }
}

function countRows(v) {
  return Array.isArray(v) ? v.length : 0;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-demo-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-demo-bin-'));

  // ── Stub `powershell` so printImage() succeeds and the SUCCESS path runs ────
  // Without this, /print always throws at the print step on a non-Windows host
  // and only the catch-block guards would ever be tested.
  const stub = path.join(binDir, 'powershell');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  // One roster row so enrichment has something to find, including an allergy —
  // a demo label should still render the real enrichment a volunteer will see.
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Demo,Kid,2018-03-15,peanut allergy,Cubbies A,y\n');

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  // ── 1. A demo print leaves no trace ────────────────────────────────────────
  {
    const res = await post('/print', { firstName: 'Demo', lastName: 'Kid', clubName: 'Cubbies', demo: true });
    check('demo print succeeds', res.status === 200, `status ${res.status} ${res.body.slice(0, 120)}`);
    check('demo print is flagged as demo in the response',
      res.json && res.json.demo === true, JSON.stringify(res.json));

    check('demo print writes NO history row',
      countRows(readJson(dataDir, 'print-history.json')) === 0,
      JSON.stringify(readJson(dataDir, 'print-history.json')));
    check('demo print writes NO attendance ledger entry',
      readJson(dataDir, 'attendance.json') === null
        || Object.keys(readJson(dataDir, 'attendance.json')).length === 0,
      JSON.stringify(readJson(dataDir, 'attendance.json')));
    check('demo print writes NO recap event buffer',
      countRows(readJson(dataDir, 'events-buffer.json')) === 0,
      JSON.stringify(readJson(dataDir, 'events-buffer.json')));

    const stats = await get('/stats/tonight');
    check('demo print does not count toward tonight\'s check-ins',
      stats.json && stats.json.checkedIn === 0, JSON.stringify(stats.json));
    const failuresList = await get('/failures');
    check('demo print raises no print-failure telemetry',
      countRows(failuresList.json) === 0, JSON.stringify(failuresList.json));
  }

  // ── 2. Demo mode is repeatable (duplicate window bypassed) ─────────────────
  {
    const again = await post('/print', { firstName: 'Demo', lastName: 'Kid', clubName: 'Cubbies', demo: true });
    check('a repeated demo print is NOT suppressed as a duplicate',
      again.status === 200 && !(again.json && again.json.duplicate),
      JSON.stringify(again.json));
    check('repeat demo print still writes no history',
      countRows(readJson(dataDir, 'print-history.json')) === 0);
  }

  // ── 3. The control: the SAME request without the flag does record ──────────
  // This is what proves the guards are doing the work, rather than /print
  // being inert in the test environment.
  {
    const res = await post('/print', { firstName: 'Demo', lastName: 'Kid', clubName: 'Cubbies' });
    check('a real print succeeds', res.status === 200, `status ${res.status} ${res.body.slice(0, 120)}`);
    check('a real print is NOT flagged demo', !(res.json && res.json.demo));

    const rows = readJson(dataDir, 'print-history.json');
    check('a real print DOES write a history row',
      countRows(rows) === 1, JSON.stringify(rows));
    // Proves the powershell stub worked and we are exercising the SUCCESS path,
    // not the catch block. If this were success:false the guards being tested
    // above would be the error-path ones only, and the suite would be lying
    // about what it covers.
    check('the control print took the SUCCESS path (stub printer worked)',
      rows && rows[0] && rows[0].success === true,
      `success=${rows && rows[0] && rows[0].success}`);
    const ledger = readJson(dataDir, 'attendance.json');
    check('a real print DOES record attendance',
      ledger && Object.keys(ledger).length === 1, JSON.stringify(ledger));
    check('a real print DOES fill the recap buffer',
      countRows(readJson(dataDir, 'events-buffer.json')) === 1,
      JSON.stringify(readJson(dataDir, 'events-buffer.json')));

    const stats = await get('/stats/tonight');
    check('a real print counts toward tonight\'s check-ins',
      stats.json && stats.json.checkedIn === 1, JSON.stringify(stats.json));
  }

  // ── 3.5 Rehearsal mode (#19): the dashboard button's server half ──────────
  // Arming rehearsal must turn EVERY print into a demo (TEST band, zero
  // side effects) without the caller asking, say so loudly on /health, tell
  // the event bus via tally's optional flag, and release completely on
  // disarm. Same paired-run discipline as the rest of this file.
  {
    const historyBefore = countRows(readJson(dataDir, 'print-history.json'));

    const arm = await post('/rehearsal', { on: true });
    check('arming rehearsal succeeds from loopback', arm.status === 200 && arm.json && arm.json.rehearsal === true, JSON.stringify(arm.json));

    let h = await get('/health');
    check('/health reports rehearsal armed', h.json && h.json.rehearsal === true);
    check('/health warns loudly while armed, as a {type, message} object',
      (h.json.warnings || []).some((w) => w && w.type === 'rehearsalArmed' && /TEST band/.test(w.message || '')),
      JSON.stringify(h.json.warnings));

    const res = await post('/print', { firstName: 'Rehearsal', lastName: 'Kid', clubName: 'Sparks' });
    check('a print WITHOUT the demo flag is treated as demo while armed',
      res.status === 200 && res.json && res.json.demo === true, JSON.stringify(res.json));
    check('an armed-rehearsal print writes NO history row',
      countRows(readJson(dataDir, 'print-history.json')) === historyBefore);

    const disarm = await post('/rehearsal', { on: false });
    check('disarming succeeds', disarm.status === 200 && disarm.json && disarm.json.rehearsal === false, JSON.stringify(disarm.json));

    h = await get('/health');
    check('/health reports rehearsal off after disarm', h.json && h.json.rehearsal === false);
    check('the armed warning is gone after disarm',
      !(h.json.warnings || []).some((w) => w && w.type === 'rehearsalArmed'), JSON.stringify(h.json.warnings));

    const real = await post('/print', { firstName: 'Ada', lastName: 'Rehearse', clubName: 'Sparks' });
    check('a real print after disarm records again (the guard fully releases)',
      real.status === 200 && !(real.json && real.json.demo)
        && countRows(readJson(dataDir, 'print-history.json')) === historyBefore + 1,
      JSON.stringify(real.json));
  }

  // ── 4. A failing demo print stays silent ──────────────────────────────────
  // Remove the powershell stub so printImage() throws, and confirm the catch
  // block's demo guard holds: no history row, no ops print-failure event. A
  // training mishap must not look like a lost label on the dashboard.
  {
    fs.unlinkSync(stub);
    const historyBefore = countRows(readJson(dataDir, 'print-history.json'));
    const failuresBefore = countRows((await get('/failures')).json);

    const res = await post('/print', { firstName: 'Demo', lastName: 'Kid', clubName: 'Cubbies', demo: true });
    check('a failing demo print reports the error', res.status === 500, `status ${res.status}`);
    check('a failing demo print is flagged demo', res.json && res.json.demo === true, JSON.stringify(res.json));
    check('a failing demo print adds NO history row',
      countRows(readJson(dataDir, 'print-history.json')) === historyBefore,
      `${historyBefore} → ${countRows(readJson(dataDir, 'print-history.json'))}`);
    check('a failing demo print raises NO print-failure telemetry',
      countRows((await get('/failures')).json) === failuresBefore);

    // Control: the same failure WITHOUT the flag must be recorded, or the
    // assertions above prove nothing.
    const real = await post('/print', { firstName: 'Real', lastName: 'Kid', clubName: 'Cubbies' });
    check('a failing real print reports the error', real.status === 500, `status ${real.status}`);
    check('a failing real print DOES add a history row',
      countRows(readJson(dataDir, 'print-history.json')) === historyBefore + 1,
      `${historyBefore} → ${countRows(readJson(dataDir, 'print-history.json'))}`);
    check('a failing real print DOES raise print-failure telemetry',
      countRows((await get('/failures')).json) === failuresBefore + 1);
  }

  listener.close();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(binDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error('  - ' + f));
  }
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
