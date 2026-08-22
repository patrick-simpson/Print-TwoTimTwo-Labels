#!/usr/bin/env node
// Tests for the per-club label templates (#1): the dedicated config endpoint's
// sanitization and trusted-origin gate, template resolution at print time, the
// /preview override, and — the invariant everything else bows to — fail-open
// rendering: a broken template must degrade to the stock label, never block a
// child's print.
//
// Run: npm run test:templates

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34575);

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

function request(method, pathname, body, headers) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method,
      path: pathname,
      headers: Object.assign(
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        headers || {}
      ),
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { chunks.push(c); });
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary or non-JSON */ }
        resolve({ status: res.statusCode, buf, json });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}
const post = (p, b, h) => request('POST', p, b, h);
const get = (p) => request('GET', p);

function readJson(dir, name) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
  catch { return null; }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-templates-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-templates-bin-'));

  const stub = path.join(binDir, 'powershell');
  fs.writeFileSync(stub, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Roster,Kid,2018-03-15,peanut allergy,Sparks A,y\n');

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  console.log('\nlabel templates: endpoint + sanitization');

  // ── 1. Save path: normalization, clamps, unknown-field/club dropping ───────
  {
    const res = await post('/config/label-templates', {
      templates: {
        'T & T': { showIconPanel: false, nameMaxPt: 999, evil: '<script>', version: 42 },
        'Sparks': { showLastName: false, nameMaxPt: 30 },
        'Klingon Klub': { showIconPanel: false },   // unrecognized → dropped
        'default': { showFooter: false },
        'Puggles': {},                              // no overrides → dropped
      },
    });
    check('save accepted', res.status === 200, JSON.stringify(res.json));
    const saved = (readJson(dataDir, 'config.json') || {}).labelTemplates || {};
    check('club names normalize through clubKey (T & T → t&t)',
      !!saved['t&t'] && !saved['T & T'], Object.keys(saved).join(','));
    check('sparks key is canonical (spark)', !!saved.spark, Object.keys(saved).join(','));
    check('an unrecognized club is dropped (default serves it)',
      !Object.keys(saved).some(k => /kling/i.test(k)), Object.keys(saved).join(','));
    check('an all-default template is not stored', !saved.puggle, Object.keys(saved).join(','));
    check('unknown fields are dropped', !('evil' in saved['t&t']), JSON.stringify(saved['t&t']));
    check('out-of-range nameMaxPt is dropped, not clamped in',
      !('nameMaxPt' in saved['t&t']), JSON.stringify(saved['t&t']));
    check('in-range nameMaxPt survives', saved.spark.nameMaxPt === 30, JSON.stringify(saved.spark));
    check('version is forced to 1', saved['t&t'].version === 1, JSON.stringify(saved['t&t']));

    const listed = (await get('/config/label-templates')).json || {};
    check('GET returns the stored map', JSON.stringify(listed.templates) === JSON.stringify(saved));
    check('GET lists the known clubs for the editor',
      Array.isArray(listed.knownClubs) && listed.knownClubs.includes('spark'), JSON.stringify(listed.knownClubs));
  }

  // ── 2. The trusted-origin gate ─────────────────────────────────────────────
  {
    const res = await post('/config/label-templates',
      { templates: { default: { showFooter: false } } },
      { Origin: 'http://evil.example:' + PORT });
    check('a foreign Origin cannot write templates', res.status === 403, `status ${res.status}`);
    const res2 = await post('/config/label-templates', { templates: 'garbage' });
    check('a non-object map is a 400', res2.status === 400, `status ${res2.status}`);
  }

  console.log('label templates: rendering');

  // ── 3. Resolution + effect: the template actually changes the pixels ───────
  {
    const stock = await get('/preview?firstName=Roster&lastName=Kid&clubName=Sparks&template=' +
      encodeURIComponent('{}'));
    const templated = await get('/preview?firstName=Roster&lastName=Kid&clubName=Sparks');
    check('stock preview renders', stock.status === 200 && stock.buf.length > 1000);
    check('saved template (spark: no last name) changes the render',
      templated.status === 200 && !stock.buf.equals(templated.buf),
      `${stock.buf.length} vs ${templated.buf.length} bytes`);

    const override = await get('/preview?firstName=Roster&lastName=Kid&clubName=Sparks&template=' +
      encodeURIComponent(JSON.stringify({ showIconPanel: false, showLastName: false })));
    check('an unsaved ?template= override renders and differs from the saved one',
      override.status === 200 && !override.buf.equals(templated.buf));

    const badJson = await get('/preview?firstName=Roster&lastName=Kid&clubName=Sparks&template=%7Bnope');
    check('a malformed ?template= falls back to the saved template, not a 500',
      badJson.status === 200 && badJson.buf.equals(templated.buf));

    // 'default' serves a club with no entry of its own AND an unknown club.
    const unknownClub = await get('/preview?firstName=Roster&lastName=Kid&clubName=Rocketeers');
    check('an unknown club renders via the default template', unknownClub.status === 200);
  }

  // ── 4. Fail open: garbage in config never blocks a print ──────────────────
  {
    // Corrupt the live config the way a hand-edit could: wrong types everywhere.
    const cfg = readJson(dataDir, 'config.json') || {};
    cfg.labelTemplates = { spark: [1, 2, 3], default: 'not-an-object' };
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(cfg));
    server.applySavedConfig(cfg);

    const res = await post('/print', { firstName: 'Roster', lastName: 'Kid', clubName: 'Sparks' });
    check('a print with garbage templates in config still succeeds',
      res.status === 200 && res.json && res.json.success === true, JSON.stringify(res.json));
    const preview = await get('/preview?firstName=Roster&lastName=Kid&clubName=Sparks');
    check('preview also survives garbage templates', preview.status === 200);
  }

  // ── 5. Musical printer endpoint (#11/#12): gates before hardware ──────────
  {
    console.log('musical printer: /play-tune gates');
    const off = await post('/play-tune', {});
    check('toggle off: 409, nothing sent to the printer', off.status === 409, `status ${off.status}`);

    await post('/config', { musicalPrinter: true });
    const evil = await post('/play-tune', {}, { Origin: 'http://evil.example:' + PORT });
    check('foreign Origin cannot make the printer sing', evil.status === 403, `status ${evil.status}`);

    const bad = await post('/play-tune', { printerName: 'x"; rm -rf /' });
    check('an unsafe printerName is refused', bad.status === 400, `status ${bad.status}`);

    // With the toggle on, a loopback caller, and the stubbed powershell on
    // PATH, the raw sender's happy path runs end to end.
    const play = await post('/play-tune', {});
    check('with a working printer path the tune reports ok',
      play.status === 200 && play.json && play.json.ok === true, JSON.stringify(play.json));
    check('the response names a real tune', play.json && ['arpeggio', 'charge', 'westminster'].includes(play.json.tune));

    // Remove the stub so the raw path throws — the response must still be a
    // clean 200 with ok:false, never a 500: the tune is garnish.
    fs.unlinkSync(stub);
    const dead = await post('/play-tune', {});
    check('a raw-path failure is swallowed (ok:false, not a 500)',
      dead.status === 200 && dead.json && dead.json.ok === false, JSON.stringify(dead.json));

    await post('/config', { musicalPrinter: false });
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
