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
// Same module instance server.js requires internally (Node's require cache is
// keyed by resolved path) — used in phase 7 only to reset the /feed/checkin-
// report throttle between assertions so the test isn't paced by it.
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

  // Every /health warning must be a {type, message} OBJECT. The dashboard
  // renders `w.message`, so a bare string arrived as undefined and painted an
  // EMPTY yellow box — the loudest warnings in the codebase were the invisible
  // ones. Read warnings through here so a slip back to strings shows up as a
  // named failure rather than a silently-never-matching regex.
  const warningTexts = (warnings) => (warnings || []).map((w) => {
    check('every /health warning is a {type, message} object',
      w && typeof w === 'object' && typeof w.type === 'string' && typeof w.message === 'string',
      JSON.stringify(w));
    return (w && w.message) || '';
  });

  let amyPrintedAt;

  // ── 1. Unkeyed: plaintext, and loudly said so ──────────────────────────────
  console.log('\nrealtime: with no display key');
  {
    let h = await j('/health');
    check('/health reports no display key', h.body.displayKeyConfigured === false);
    check('/health reports it is not encrypting', h.body.encryptingNames === false);
    check('/health warns that names are unencrypted',
      warningTexts(h.body.warnings).some((w) => /unencrypted/i.test(w)),
      JSON.stringify(h.body.warnings));
    check('and the warning names the exact place to fix it',
      warningTexts(h.body.warnings).some((w) => /Settings . Realtime privacy/i.test(w)),
      JSON.stringify(h.body.warnings));

    amyPrintedAt = Date.now(); // phase 7 (R-1 undo detection) reuses her to prove the
    // 25s duplicate-print window doesn't block a re-check-in "minutes later" —
    // by the time that phase runs, real wall-clock time has already done the
    // waiting for us.
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
    // Structural rather than a substring search over base64: a short name can
    // collide with random ciphertext by chance (a 3-letter one did, in the
    // checkout suite). Key-set equality tests the same property — that no
    // plaintext payload field rode along beside the envelope — and cannot flake.
    check('the frame carries only envelope fields — no plaintext rode along',
      JSON.stringify(Object.keys(env || {}).sort()) === JSON.stringify(['ct', 'iv', 'kid', 'v']),
      JSON.stringify(Object.keys(env || {})));
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
      !warningTexts(h.body.warnings).some((w) => /unencrypted/i.test(w)),
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
    const pinWarning = async () => warningTexts((await j('/health')).body.warnings)
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

  // ── 7. R-1 undo detection: mark, decrement, roster, re-check-in, guards ────
  // content.js's runReconcile() already polls /clubber/checkin_report every
  // ~60s (R-1, since v5.2) to catch check-ins the roster-diff detector
  // missed. This is the other direction that same report never covered: an
  // UNDO on TwoTimTwo — a child removed from the roster after being checked
  // in — which print-history.json has no way to learn on its own. This phase
  // exercises the new POST /feed/checkin-report end to end, against the SAME
  // running server (so it inherits Amy/Bella/Cody/Dana, checked in over the
  // course of phases 1-6, as "already checked in tonight" — the messy
  // real-world starting point). Amy specifically (not a fresh throwaway name)
  // is reused throughout: /phone/roster only lists clubbers who are actually
  // in clubbers.csv, and she's the one this fixture has.
  //
  // feeds._resetForTests() is called between report posts purely to bypass
  // THIS feed's own 5s throttle so the test isn't paced by it — the throttle
  // itself is already covered by feeds.submitCheckinReport's own unit test.
  console.log('realtime: R-1 undo detection (POST /feed/checkin-report)');
  {
    const kidsByName = (body) => new Map((body.kids || []).map((k) => [k.name, k.checkedIn]));

    const before = (await j('/stats/tonight')).body;
    check('Amy/Bella/Cody/Dana are already checked in from earlier phases',
      before.checkedIn === 4, `checkedIn=${before.checkedIn}`);

    // Everyone tonight EXCEPT Amy — a reconcile pass that lost track of one child.
    const everyoneButAmy = [
      { name: 'Bella Tester', club: 'Sparks' },
      { name: 'Cody Tester', club: 'Sparks' },
      { name: 'Dana Tester', club: 'Sparks' },
    ];

    const wireBefore = wire.length;
    const rep1 = await post('/feed/checkin-report', { ok: true, entries: everyoneButAmy });
    check('a well-formed report is accepted and applied',
      rep1.status === 200 && rep1.body.ok === true && rep1.body.applied === true, JSON.stringify(rep1.body));
    check('exactly the one missing kid (Amy) is marked undone', rep1.body.changed === 1, JSON.stringify(rep1.body));

    const afterUndo = (await j('/stats/tonight')).body;
    check('checkedIn decrements immediately', afterUndo.checkedIn === before.checkedIn - 1,
      `before=${before.checkedIn} afterUndo=${afterUndo.checkedIn}`);

    const tallyFrames = wire.slice(wireBefore).filter((w) => w.event === 'tally');
    check('a tally is republished immediately — not waiting for the 60s tick', tallyFrames.length >= 1);
    check('and it already carries the decremented total',
      tallyFrames.length > 0 && tallyFrames[tallyFrames.length - 1].payload.total === afterUndo.checkedIn,
      JSON.stringify(tallyFrames[tallyFrames.length - 1] && tallyFrames[tallyFrames.length - 1].payload));

    const roster1 = await post('/phone/roster', {});
    check('the undone kid is available again for phone check-in',
      kidsByName(roster1.body).get('Amy Tester') === false,
      JSON.stringify(roster1.body.kids && roster1.body.kids.find((k) => k.name === 'Amy Tester')));
    check('her still-checked-in friend is unaffected',
      kidsByName(roster1.body).get('Bella Tester') === true);

    // ── Reappearance with NO new print clears undone on the SAME row ────────
    // (the undo was itself a mistake, corrected back on TwoTimTwo — no fresh
    // print exists to supersede it, so the existing row must be un-marked
    // rather than left stuck.)
    const histBeforeClear = (await j('/history')).body;
    check('exactly one history row for Amy so far',
      histBeforeClear.filter((r) => r.firstName === 'Amy').length === 1);
    feeds._resetForTests();
    const rep2 = await post('/feed/checkin-report', { ok: true, entries: [...everyoneButAmy, { name: 'Amy Tester', club: 'Sparks' }] });
    check('reappearing clears the undone flag', rep2.body.changed === 1, JSON.stringify(rep2.body));
    const afterClear = (await j('/stats/tonight')).body;
    check('checkedIn is restored', afterClear.checkedIn === before.checkedIn,
      `before=${before.checkedIn} afterClear=${afterClear.checkedIn}`);
    const histAfterClear = (await j('/history')).body;
    const amyRowsAfterClear = histAfterClear.filter((r) => r.firstName === 'Amy');
    check('still exactly ONE history row for Amy — the same row was un-marked, not a new one added',
      amyRowsAfterClear.length === 1 && !amyRowsAfterClear[0].undone, JSON.stringify(amyRowsAfterClear));

    // Re-undo her so the re-check-in-with-a-fresh-print path below starts from
    // "undone", which is the scenario that actually matters operationally.
    feeds._resetForTests();
    await post('/feed/checkin-report', { ok: true, entries: everyoneButAmy });
    check('she is undone again ahead of the re-check-in test',
      kidsByName((await post('/phone/roster', {})).body).get('Amy Tester') === false);

    // ── The 25s duplicate-print window (recordPrint/dupKey) must not block a
    // real re-check-in minutes later — only an immediate retry of the SAME
    // request. Amy's ORIGINAL /print call was all the way back in phase 1;
    // everything phases 2-6 did is real wall-clock time that has already
    // elapsed since then, so this proves the window against the actual /print
    // path a re-check-in takes, with no artificial shortcut around it.
    const elapsed = Date.now() - amyPrintedAt;
    const remaining = 25200 - elapsed; // DUPLICATE_WINDOW_MS (25000) + margin
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

    const reprint = await post('/print', { firstName: 'Amy', lastName: 'Tester', clubName: 'Sparks' });
    check('the re-check-in print succeeds (not suppressed as a stale duplicate)',
      reprint.body && reprint.body.success === true, JSON.stringify(reprint.body));
    const afterRecheckin = (await j('/stats/tonight')).body;
    check('and counts her exactly once more (not twice)', afterRecheckin.checkedIn === afterClear.checkedIn,
      `afterClear=${afterClear.checkedIn} afterRecheckin=${afterRecheckin.checkedIn}`);
    const roster2 = await post('/phone/roster', {});
    check('the phone roster reflects the re-check-in', kidsByName(roster2.body).get('Amy Tester') === true);

    const histFinal = (await j('/history')).body;
    const amyRowsFinal = histFinal.filter((r) => r.firstName === 'Amy');
    check('two history rows for Amy now exist — history is a print log, an undo is never deleted',
      amyRowsFinal.length === 2, `saw ${amyRowsFinal.length}`);
    check('the newest row wins (not undone) even though an older undone row for her still exists',
      amyRowsFinal.some((r) => r.undone === true) && amyRowsFinal.some((r) => !r.undone));

    // ── Guards ────────────────────────────────────────────────────────────
    feeds._resetForTests();
    const badSignal = await post('/feed/checkin-report', { entries: [] });
    check('a report missing the explicit ok:true signal is rejected outright (never inferred from emptiness)',
      badSignal.status === 400, JSON.stringify(badSignal.body));

    const beforeGuard = (await j('/stats/tonight')).body.checkedIn;
    check('several kids are checked in before the guard test', beforeGuard >= 4, `checkedIn=${beforeGuard}`);
    const guardRes = await post('/feed/checkin-report', { ok: true, entries: [] });
    check('a suspiciously-empty report is well-formed enough to accept...', guardRes.status === 200);
    check('...but the mass-undo guard (>50% in one pass) refuses to apply it',
      guardRes.body.applied === false && guardRes.body.changed === 0, JSON.stringify(guardRes.body));
    const afterGuard = (await j('/stats/tonight')).body.checkedIn;
    check('so nothing was actually undone', afterGuard === beforeGuard, `before=${beforeGuard} after=${afterGuard}`);
  }

  // ── 8. Batch self-verify report (#2): the "didn't stick" dashboard half ──
  console.log('\nrealtime: unverified-checkins feed → /health warning');
  {
    const bad = await post('/feed/unverified-checkins', { nope: true });
    check('a body without entries is rejected', bad.status === 400, JSON.stringify(bad.body));

    const ok = await post('/feed/unverified-checkins', {
      entries: [{ name: 'Zoe Tester', clubberId: '4242', club: 'Sparks', at: new Date().toISOString() }],
    });
    check('a well-formed list is accepted', ok.status === 200 && ok.body.count === 1, JSON.stringify(ok.body));

    let h = await j('/health');
    check('/health warns about the check-in that did not stick, naming the kid',
      warningTexts(h.body.warnings).some((w) => /didn.t stick|may not have stuck/i.test(w) && /Zoe Tester/.test(w)),
      JSON.stringify(h.body.warnings));

    // Replace semantics: an emptied list clears the warning immediately —
    // a resolved problem must not keep shouting on the dashboard.
    await post('/feed/unverified-checkins', { entries: [] });
    h = await j('/health');
    check('an emptied list clears the warning',
      !warningTexts(h.body.warnings).some((w) => /may not have stuck/i.test(w)),
      JSON.stringify(h.body.warnings));
  }

  // ── 9. Contract-drift canary (#3): route → /health card + warning ────────
  console.log('\nrealtime: contract canary feed → /health');
  {
    const fail = await post('/contract-canary', {
      ok: false,
      extensionVersion: '9.9.9',
      results: [
        { check: '.clubber roster rows', passed: true, detail: '12 row(s)' },
        { check: '/clubber/csv roster export', passed: false, detail: 'header changed' },
      ],
    });
    check('a failing sweep is accepted', fail.status === 200, JSON.stringify(fail.body));

    let h = await j('/health');
    check('/health exposes the sweep result for the dashboard card',
      h.body.contractCanary && h.body.contractCanary.ok === false
        && h.body.contractCanary.results.length === 2,
      JSON.stringify(h.body.contractCanary));
    check('/health warns about contract drift, naming the failing check',
      warningTexts(h.body.warnings).some((w) => /no longer matches/i.test(w) && /csv roster export/.test(w)),
      JSON.stringify(h.body.warnings));

    await post('/contract-canary', { ok: true, results: [{ check: 'all', passed: true }] });
    h = await j('/health');
    check('a passing sweep clears the drift warning',
      h.body.contractCanary.ok === true
        && !warningTexts(h.body.warnings).some((w) => /no longer matches/i.test(w)),
      JSON.stringify(h.body.warnings));
  }

  // ── 10. What's new (#6): the route serves the real top changes.md entry ──
  console.log('\nrealtime: /whats-new serves the shipped release notes');
  {
    const res = await j('/whats-new');
    check('/whats-new returns the top entry', res.status === 200 && res.body && /^\d+\.\d+\.\d+$/.test(res.body.version), JSON.stringify(res.body && res.body.version));
    check('the entry has a body', typeof res.body.body === 'string' && res.body.body.length > 10);
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
