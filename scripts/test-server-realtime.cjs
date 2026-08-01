#!/usr/bin/env node
// Tests for the encrypted realtime pipe, against a REALLY running print server.
//
// WHAT THIS GUARDS THAT test-envelope.cjs CANNOT
//
// test-envelope.cjs proves the crypto is correct. This proves the SERVER is
// wired to it: that a name actually leaves this process as ciphertext, that the
// key can be generated and saved and takes effect without a restart, that
// /health tells the operator which mode they are in, and — the one that bit me
// while building this — that CLEARING the key actually clears it.
//
// That last one was a genuine bug in two places. Both POST /config paths can
// `delete next.<key>`, and the live-config sync was `Object.assign(config,
// next)`, which copies properties but never removes them. So clearing the phone
// PIN wrote the file correctly while the live auth gate — which reads
// config.phonePin per request — kept accepting the OLD PIN until someone
// restarted the server. An operator revoking a leaked PIN had every reason to
// believe it was gone. The display key had the same hole. `applySavedConfig()`
// fixes both, and the assertions at the bottom of this file are what keep it
// fixed.
//
// Run: npm run test:realtime

'use strict';

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34573);
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

// ── Intercept `pusher` so nothing reaches the network ─────────────────────────
// Every trigger is recorded instead, which is the only way to assert what
// actually went ON THE WIRE. Patching Module._load rather than dropping a stub
// in node_modules: Node resolves bare specifiers from the requiring file's own
// node_modules first, so a stub elsewhere is simply never seen — and the server
// would genuinely try to publish to pusher.com while this file quietly asserted
// nothing. (I hit exactly that.)
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

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});
const sealedFrames = (event) => wire.filter((w) => w.event === event);
const isSealed = (b) => Boolean(b && b.v === events.ENVELOPE_VERSION && typeof b.ct === 'string');

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-realtime-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-realtime-bin-'));

  // printImage() shells out to `powershell`, absent on a Linux runner. Without
  // this stub every /print throws at the print step, the checkin publish never
  // runs, and this whole file would pass while testing nothing.
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  // Distinct children per phase: the server suppresses a repeat print of the
  // same child within 25s, so reusing one name makes later phases test nothing.
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Amy,Tester,,peanut allergy,Sparks A,y\n'
    + 'Bella,Tester,,,Sparks A,y\n'
    + 'Cody,Tester,,,Sparks A,y\n'
    + 'Dana,Tester,,,Sparks A,y\n');

  // Pusher credentials so the publisher is "configured" — the FakePusher above
  // is what actually gets constructed.
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
    phonePin: '4821',
  }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  const configFile = path.join(dataDir, 'config.json');
  const onDisk = () => JSON.parse(fs.readFileSync(configFile, 'utf8'));

  // ── 1. Unkeyed: plaintext, and loudly said so ──────────────────────────────
  console.log('\nrealtime: with no display key');
  {
    let h = await j('/health');
    check('/health reports no display key', h.body.displayKeyConfigured === false);
    check('/health reports it is not encrypting', h.body.encryptingNames === false);
    check('/health warns that names are unencrypted',
      (h.body.warnings || []).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));

    await post('/print', { firstName: 'Amy', lastName: 'Tester', clubName: 'Sparks' });
    const ck = sealedFrames('checkin');
    check('a checkin was published', ck.length === 1, `saw ${ck.length}`);
    // Plaintext while unkeyed is DELIBERATE: an operator who has not opted in
    // must not have banners break under them on an auto-update. The consumer's
    // anti-downgrade rule is what makes it safe once a screen IS keyed.
    check('and it is plaintext (rollout mode)',
      ck.length === 1 && ck[0].payload.firstName === 'Amy' && !isSealed(ck[0].payload));
  }

  // ── 2. Generating and saving a key ─────────────────────────────────────────
  console.log('realtime: generating and saving a key');
  let KEY;
  {
    const gen = await post('/config/display-key/generate');
    KEY = gen.body && gen.body.key;
    check('generate returns a valid 32-byte key',
      gen.status === 200 && events.isValidDisplayKey(KEY), JSON.stringify(gen.body));
    // Generate deliberately does not persist: the operator copies it into the
    // screens FIRST, so a mistyped paste cannot leave every screen locked out of
    // a key the server has already committed to.
    check('generate does not save it yet', !onDisk().displayKey);
    check('and the server is still unencrypted until it is saved',
      events.getDisplayKeyState().configured === false);

    check('an invalid key is refused with 400',
      (await post('/config', { displayKey: 'not-a-key' })).status === 400);
    check('an over-long key is refused',
      (await post('/config', { displayKey: Buffer.alloc(64).toString('base64') })).status === 400);
    check('a refused key leaves the server unencrypted rather than half-keyed',
      events.getDisplayKeyState().configured === false);

    check('a valid key is accepted', (await post('/config', { displayKey: KEY })).status === 200);
    check('it is persisted', onDisk().displayKey === KEY);
    check('and it takes effect immediately, with no restart',
      events.getDisplayKeyState().configured === true);
  }

  // ── 3. Names leave this process as ciphertext ──────────────────────────────
  console.log('realtime: names are sealed on the wire');
  {
    const before = wire.length;
    await post('/print', { firstName: 'Bella', lastName: 'Tester', clubName: 'Sparks' });
    const fresh = wire.slice(before);
    const ck = fresh.filter((w) => w.event === 'checkin');
    check('a checkin was published', ck.length === 1, `saw ${ck.length}`);
    const env = ck[0] && ck[0].payload;
    check('the checkin on the wire is an envelope', isSealed(env),
      JSON.stringify(env || null).slice(0, 120));
    check('the child\'s name appears nowhere in the frame',
      !JSON.stringify(env || {}).includes('Bella'));
    let opened = null;
    try { opened = events.openForTest(KEY, 'checkin', env); } catch { /* reported */ }
    check('the church key opens it back to the real payload',
      Boolean(opened && opened.firstName === 'Bella'), JSON.stringify(opened));
    check('and the payload still carries no last name or allergy',
      Boolean(opened) && !('lastName' in opened) && !('allergies' in opened));

    // The non-PII events must stay readable — that readability is what lets a
    // screen tell "pipe down" from "cannot read names" from "quiet night".
    const tally = fresh.filter((w) => w.event === 'tally');
    check('tally stays plaintext and readable (deliberate)',
      tally.length === 0 || (!isSealed(tally[0].payload) && tally[0].payload.counts !== undefined),
      JSON.stringify((tally[0] && tally[0].payload) || null).slice(0, 120));
  }

  // ── 4. /health and Night Test report the truth ──────────────────────────────
  console.log('realtime: the operator can see which mode they are in');
  {
    const h = await j('/health');
    check('/health reports the key is configured', h.body.displayKeyConfigured === true);
    check('/health exposes the kid fingerprint',
      typeof h.body.displayKeyId === 'string' && h.body.displayKeyId.length === 8);
    check('/health NEVER exposes the key itself',
      !JSON.stringify(h.body).includes(KEY));
    check('/health stops warning once encrypted',
      !(h.body.warnings || []).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));

    const canary = await post('/canary', { printerName: 'Fake' });
    const stage = (canary.body.stages || []).find((s) => s.stage === 'display key');
    check('Night Test has a display-key stage', Boolean(stage),
      JSON.stringify(canary.body.stages));
    check('and it passes with a key set', Boolean(stage && stage.passed),
      JSON.stringify(stage));
    // The stage publishes a sealed recap, which doubles as the heartbeat a screen
    // uses to notice a wrong key BEFORE the first child arrives.
    const recaps = sealedFrames('recap');
    check('the stage publishes a sealed recap',
      recaps.length > 0 && isSealed(recaps[recaps.length - 1].payload));
  }

  // ── 5. Clearing a secret actually clears it ────────────────────────────────
  // The regression this file exists for. Object.assign cannot delete, so both of
  // these used to write the file and keep the old value live until a restart.
  console.log('realtime: clearing a secret takes effect immediately');
  {
    await post('/config', { displayKey: '' });
    check('the key is gone from disk', !onDisk().displayKey);
    check('AND gone from the live publisher, not just the file',
      events.getDisplayKeyState().configured === false,
      'this is the Object.assign-cannot-delete bug');

    const before = wire.length;
    await post('/print', { firstName: 'Cody', lastName: 'Tester', clubName: 'Sparks' });
    const ck = wire.slice(before).filter((w) => w.event === 'checkin');
    check('and it really is publishing unsealed frames again',
      ck.length === 1 && !isSealed(ck[0].payload),
      JSON.stringify((ck[0] && ck[0].payload) || null).slice(0, 120));

    // The same bug class, on the security control that matters most: an operator
    // clearing a LEAKED PIN must actually revoke it, not merely appear to.
    //
    // Observed through the /health warning rather than a field, because that
    // warning is derived from the LIVE `config` object at request time — exactly
    // the thing the Object.assign bug left stale. With lanAccess on, /health warns
    // if and only if the live config has no acceptable PIN.
    const pinWarning = async () => ((await j('/health')).body.warnings || [])
      .some((w) => /no PIN is set/i.test(w));
    await post('/config', { lanAccess: true, phonePin: '4821' });
    check('with LAN on and a PIN set, /health does not warn about the PIN',
      (await pinWarning()) === false);
    await post('/config', { phonePin: '' });
    check('a cleared PIN is gone from disk', !onDisk().phonePin);
    check('AND the live auth gate no longer holds it',
      (await pinWarning()) === true,
      'the old PIN would still have been accepted until a restart');
  }

  // ── 6. Encryption never blocks a label ─────────────────────────────────────
  console.log('realtime: printing is never gated on the realtime pipe');
  {
    // The printing guarantee outranks everything else here: a child at the door
    // must get a label even if the pipe, the key or Pusher itself is broken.
    events.setDisplayKey(KEY);
    const res = await post('/print', { firstName: 'Dana', lastName: 'Tester', clubName: 'Sparks' });
    check('a print succeeds with encryption on', res.body && res.body.success === true,
      JSON.stringify(res.body));
    const hist = await j('/history');
    const rows = Array.isArray(hist.body) ? hist.body : (hist.body && hist.body.history) || [];
    check('every print was recorded', rows.length >= 4, `history has ${rows.length} rows`);
  }

  listener.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
}

main().then(() => {
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  console.error('\nharness error:', err);
  process.exit(1);
});
