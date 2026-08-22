#!/usr/bin/env node
// Tests for the Electron app's Pusher `update` event decision logic — plain
// Node, zero deps. See electron-app/src/update-push.js and CONTRACT.md's
// "`update` event (laptop-internal)" section.
//
// WHAT THIS GUARDS
//
// The Electron shell subscribes to the SAME public Pusher channel the print
// server publishes checkin/tally/etc. on, listening for an `update` event
// that pings "a new release just published" so the laptop can act sooner
// than its periodic 24h poll. Two things must never happen:
//
//   - a malformed/spoofed payload crashing the app or doing anything beyond
//     triggering a normal checkForUpdates() (which electron-updater verifies
//     against the real GitHub release feed regardless of what the ping said)
//   - a burst of repeat pings (a flaky publish retry, a re-run workflow)
//     hammering checkForUpdates() over and over
//
// Run: node scripts/test-update-push.cjs

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


const updatePush = require('../electron-app/src/update-push.js');

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

console.log('\nupdate-push: payload validation');
{
  check('a well-formed payload is valid',
    updatePush.isValidUpdatePayload({ version: '5.8.0', at: '2026-08-02T12:00:00.000Z' }));
  check('version-only (no `at`) is valid — `at` is optional',
    updatePush.isValidUpdatePayload({ version: '5.8.0' }));
  check('null is invalid', !updatePush.isValidUpdatePayload(null));
  check('a bare string is invalid', !updatePush.isValidUpdatePayload('5.8.0'));
  check('an array is invalid', !updatePush.isValidUpdatePayload(['5.8.0']));
  check('missing version is invalid', !updatePush.isValidUpdatePayload({ at: 'x' }));
  check('a non-string version is invalid', !updatePush.isValidUpdatePayload({ version: 580 }));
  check('a non-semver-shaped version is invalid',
    !updatePush.isValidUpdatePayload({ version: 'not-a-version' }));
  check('a version with extra text is invalid (no injection surface)',
    !updatePush.isValidUpdatePayload({ version: '5.8.0; rm -rf /' }));
  check('a non-string `at` is invalid even with a good version',
    !updatePush.isValidUpdatePayload({ version: '5.8.0', at: 12345 }));
  check('an extra unexpected field does not itself invalidate the payload '
    + '(structurally no PII is even expressible in this shape)',
    updatePush.isValidUpdatePayload({ version: '5.8.0', extra: 'ignored' }));
}

console.log('update-push: decision logic');
{
  const malformed = updatePush.decideOnUpdateEvent({ version: 'garbage' }, { now: 1000 });
  check('a malformed payload never acts', malformed.act === false);
  check('a malformed payload reports why', /malformed/.test(malformed.reason));

  const first = updatePush.decideOnUpdateEvent({ version: '5.8.0' }, {
    now: 1000, lastVersion: null, lastAt: 0, debounceMs: 30000,
  });
  check('the first sighting of a version acts', first.act === true);
  check('the decision carries the version through', first.version === '5.8.0');

  const repeatSoon = updatePush.decideOnUpdateEvent({ version: '5.8.0' }, {
    now: 1000 + 5000, lastVersion: '5.8.0', lastAt: 1000, debounceMs: 30000,
  });
  check('an identical repeat inside the debounce window does not act', repeatSoon.act === false);
  check('the debounced decision reports why', /debounced/.test(repeatSoon.reason));

  const repeatLater = updatePush.decideOnUpdateEvent({ version: '5.8.0' }, {
    now: 1000 + 60000, lastVersion: '5.8.0', lastAt: 1000, debounceMs: 30000,
  });
  check('an identical repeat past the debounce window acts again', repeatLater.act === true);

  const differentVersion = updatePush.decideOnUpdateEvent({ version: '5.8.1' }, {
    now: 1000 + 1, lastVersion: '5.8.0', lastAt: 1000, debounceMs: 30000,
  });
  check('a DIFFERENT version acts immediately, even inside the debounce window',
    differentVersion.act === true);

  // Deliberately no "version <= running version" short-circuit — see the
  // comment in update-push.js. A stale/equal ping still acts; it is
  // electron-updater's own feed check that turns it into a no-op.
  const staleVersionStillActs = updatePush.decideOnUpdateEvent({ version: '1.0.0' }, {
    now: 1000, lastVersion: null, lastAt: 0,
  });
  check('a version at/below "current" is not filtered here — that is the feed check\'s job',
    staleVersionStillActs.act === true);

  const defaultsUsed = updatePush.decideOnUpdateEvent({ version: '5.8.0' }, {});
  check('decideOnUpdateEvent tolerates a missing state object (sane defaults)',
    defaultsUsed.act === true);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
__suiteFinished = true;
process.exit(failed > 0 ? 1 : 0);
