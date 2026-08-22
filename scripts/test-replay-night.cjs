#!/usr/bin/env node
// Record-and-replay regression harness (#4).
//
// Replays scripts/fixtures/replay-night.json — one FULLY SYNTHETIC club night
// (see the fixture's own description: anonymized by construction, nothing in
// it was ever captured from a real event) — through a real server instance,
// and asserts both halves of what the fixture pins:
//
//   • the CSV SHAPE: the verbatim 66-column /clubber/csv export (quoted
//     header, trailing empty column, a quoted comma inside Notes, the
//     Clubber Count / FILTER footer) must parse, sync via POST /update-csv,
//     and enrich prints — if TwoTimTwo renames a column or HEADER_MAP drifts,
//     this fails in CI instead of labels going basic on a Wednesday night;
//   • the EVENT STREAM: a night's worth of prints (normal, birthday-week,
//     visitor, twins sharing a first name, allergy kid, walk-in with no CSV
//     row), the duplicate window, a reconcile undo, and the aggregate truth
//     they must leave behind (history rows, tonight's stats, the tally on
//     the wire, one checkin event per real print).
//
// The night is data, the engine is below: adding a scenario to the fixture
// should rarely require touching this file.
//
// Run: npm run test:replay

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
const os = require('os');
const path = require('path');
const Module = require('module');

const PORT = Number(process.env.AWANA_TEST_PORT || 34577);
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

// Intercept the pusher module so nothing reaches the network and every
// publish is recorded (same Module._load patch as test-server-realtime.cjs,
// and for the same reason: a stub file in node_modules is never resolved).
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
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'replay-night.json'), 'utf8'));

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-replay-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-replay-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);

  // Pusher creds so the publisher is configured (the FakePusher above is what
  // actually gets constructed). Deliberately NO display key: plaintext events
  // make the payload assertions direct; the sealed path has its own suites.
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
  }));

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  // {{BIRTHDAY}} → today's month/day (year fixed) so the birthday-week path
  // always fires no matter what day CI runs on.
  const now = new Date();
  const birthday = `${now.getMonth() + 1}/${now.getDate()}/2018`;
  const csvText = fixture.csvLines.join('\r\n').replace('{{BIRTHDAY}}', birthday) + '\r\n';

  // ── CSV shape: parseCSV must survive the verbatim export format ────────────
  console.log('replay-night: the CSV shape contract');
  {
    const rows = server.parseCSV(csvText);
    check('parseCSV reads exactly the data rows (footer lines stopped at)',
      rows.length === fixture.night[0].expectRows, `parsed ${rows.length}`);
    const lyra = rows.find((r) => r.FirstName === 'Lyra');
    check('quoted comma inside Notes survives (allergy source intact)',
      !!lyra && /peanut allergy, carries epipen/.test(lyra.Notes || ''), JSON.stringify(lyra && lyra.Notes));
    check('Clubber ID normalizes to the canonical identity key',
      !!lyra && String(lyra.ClubberID) === '9004', JSON.stringify(lyra && lyra.ClubberID));
    check('Photo Release? normalizes (the no-photo flag source)',
      !!lyra && /no/i.test(String(lyra.PhotoRelease || '')), JSON.stringify(lyra && lyra.PhotoRelease));
    const mias = rows.filter((r) => r.FirstName === 'Mia');
    check('the twin pair is present — same first name, same club, distinct ids',
      mias.length === 2 && mias[0].ClubberID !== mias[1].ClubberID);
  }

  // ── The night itself ────────────────────────────────────────────────────────
  console.log('replay-night: the event stream');
  const checkinFrames = () => wire.filter((w) => w.event === 'checkin');
  for (const step of fixture.night) {
    if (step.step === 'roster-sync') {
      const res = await post('/update-csv', { csv: csvText });
      check('roster-sync: POST /update-csv accepts the export verbatim',
        res.status === 200 && res.body && res.body.count === step.expectRows, JSON.stringify(res.body));
      continue;
    }
    if (step.step === 'print') {
      const before = checkinFrames().length;
      const res = await post('/print', step.body);
      check(`print (${step.label}) succeeds`, res.status === 200 && res.body && res.body.success === true,
        `status ${res.status} ${JSON.stringify(res.body)}`);
      check(`print (${step.label}) is not flagged duplicate`, !(res.body && res.body.duplicate), JSON.stringify(res.body));
      const frames = checkinFrames();
      check(`print (${step.label}) publishes exactly one checkin event`, frames.length === before + 1,
        `${before} → ${frames.length}`);
      const payload = frames[frames.length - 1] && frames[frames.length - 1].payload;
      const want = (step.expect && step.expect.checkin) || {};
      for (const [k, v] of Object.entries(want)) {
        check(`print (${step.label}): checkin.${k} === ${JSON.stringify(v)}`,
          payload && payload[k] === v, JSON.stringify(payload));
      }
      continue;
    }
    if (step.step === 'print-duplicate') {
      const before = checkinFrames().length;
      const res = await post('/print', step.body);
      check(`duplicate (${step.label}) is suppressed`,
        res.status === 200 && res.body && res.body.duplicate === true, JSON.stringify(res.body));
      check(`duplicate (${step.label}) publishes NO second checkin event`,
        checkinFrames().length === before);
      continue;
    }
    if (step.step === 'checkin-report-undo') {
      const res = await post('/feed/checkin-report', { ok: true, entries: step.reportEntries });
      check(`reconcile (${step.label}) applies exactly ${step.expect.changed} undo`,
        res.status === 200 && res.body && res.body.applied === true && res.body.changed === step.expect.changed,
        JSON.stringify(res.body));
      continue;
    }
    check(`unknown fixture step "${step.step}"`, false);
  }

  // ── Aggregate truth the night must leave behind ─────────────────────────────
  console.log('replay-night: the morning-after aggregates');
  {
    const agg = fixture.expectedAggregates;

    const history = (await j('/history')).body || [];
    check(`history holds ${agg.historyRows} print rows (duplicate added none)`,
      history.length === agg.historyRows, `saw ${history.length}`);
    check('the undone kid keeps their history row, marked undone (history is a log)',
      history.some((r) => r.firstName === 'Nova' && r.undone === true), JSON.stringify(history.map((r) => [r.firstName, r.undone])));

    const stats = (await j('/stats/tonight')).body || {};
    check(`tonight's stats settle at ${agg.checkedIn} checked in`,
      stats.checkedIn === agg.checkedIn, JSON.stringify(stats));

    const tallies = wire.filter((w) => w.event === 'tally');
    const last = tallies[tallies.length - 1] && tallies[tallies.length - 1].payload;
    check('a tally went on the wire', tallies.length > 0);
    check(`the final tally totals ${agg.tally.total}`, last && last.total === agg.tally.total, JSON.stringify(last));
    for (const [club, n] of Object.entries(agg.tally)) {
      if (club === 'total') continue;
      check(`the final tally counts ${club} = ${n}`,
        last && last.counts && last.counts[club] === n, JSON.stringify(last && last.counts));
    }

    check(`${agg.checkinEventsPublished} checkin events went on the wire (one per real print)`,
      checkinFrames().length === agg.checkinEventsPublished, `saw ${checkinFrames().length}`);
    // The privacy rule, replayed: nothing but first names ever rides a checkin.
    check('no checkin payload ever carries a last name or allergy text',
      checkinFrames().every(({ payload }) =>
        payload && !('lastName' in payload) && !JSON.stringify(payload).includes('Quasar')
          && !JSON.stringify(payload).includes('peanut')),
      'privacy leak in a published payload');
  }

  listener.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
