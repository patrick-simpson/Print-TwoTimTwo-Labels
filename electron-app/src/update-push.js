// Pure decision logic for the Pusher `update` event — see the "`update`
// event (laptop-internal)" section of CONTRACT.md for the payload shape and
// why displays must never bind it.
//
// Deliberately Electron-free (like config-store.js and extension-sync.js)
// so it can be unit tested without booting Electron or a real Pusher
// connection: scripts/test-update-push.cjs exercises it directly.
//
// WHY THIS EXISTS
//
// main.js subscribes to the SAME public Pusher channel the print server
// already publishes checkin/tally/etc. on (reusing config.json's
// pusherKey/pusherCluster and church-config.json's pusherChannel — no new
// config). A malformed or repeated `update` event must never crash the app
// or spam checkForUpdates(); that judgement lives here so it is testable in
// isolation from the real subscription.
'use strict';

// Loose but structural: catches "not a version at all" (missing field, an
// object, a sentence) without being a full semver parser. `at` is optional
// and, per CONTRACT.md, only ever logged — never used for any decision.
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;

// Is this a well-formed `update` payload? Version string only, no PII is
// even possible in this shape — enforced structurally, the same way
// print-server/events.js's builders enforce the other event contracts.
function isValidUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (typeof payload.version !== 'string' || !VERSION_RE.test(payload.version)) return false;
  if (payload.at !== undefined && typeof payload.at !== 'string') return false;
  return true;
}

// Decide whether a just-arrived `update` event should trigger a
// checkForUpdates() call.
//
// `state`: { now, lastVersion, lastAt, debounceMs }
//   - now:         Date.now() at call time (injectable for tests)
//   - lastVersion: the version string acted on last time (or null)
//   - lastAt:      Date.now() of that last action (or 0)
//   - debounceMs:  collapse window for an identical repeat
//
// Returns { act: false, reason } or { act: true, version }.
//
// A version that is <= the app's own running version is NOT filtered out
// here on purpose: the operator's spec is that the laptop always calls
// checkForUpdates() and lets electron-updater's own feed comparison decide
// whether that is a no-op. Comparing against app.getVersion() here would be
// a second, potentially-stale source of truth for "current" — simpler to
// let the real update feed be the only one.
function decideOnUpdateEvent(payload, state = {}) {
  if (!isValidUpdatePayload(payload)) {
    return { act: false, reason: 'malformed update payload' };
  }

  const { version } = payload;
  const { now = Date.now(), lastVersion = null, lastAt = 0, debounceMs = 30000 } = state;

  if (version === lastVersion && (now - lastAt) < debounceMs) {
    return { act: false, reason: `debounced repeat of v${version} within ${debounceMs}ms` };
  }

  return { act: true, version };
}

module.exports = { isValidUpdatePayload, decideOnUpdateEvent, VERSION_RE };
