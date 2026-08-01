// Feed receive endpoints — pure validation + throttle logic (contract v3).
//
// POST /feed/tonight, /feed/points, /feed/schedule, /feed/notice let the
// Chrome extension (which scrapes TwoTimTwo's own report CSVs / iCal / admin
// messages) push aggregate content to the shared Pusher channel without the
// print server having to know how any of that scraping works.
//
// Every feed mirrors exactly one contract-v3 builder in ./events.js:
//   tonight  -> events.buildTonight   (roadmap D-1)
//   points   -> events.buildPoints    (roadmap D-2)
//   schedule -> events.buildSchedule  (roadmap D-3)
//   notice   -> events.buildNotice    (roadmap D-5)
//   checkout -> events.buildCheckout   (contract v4)
//
// This module is deliberately Express-free — server.js owns the HTTP layer
// (routes, req/res, the actual pusher.trigger() call) and calls submitFeed()
// per request. Keeping validation + throttle decisions here means
// scripts/test-server-helpers.cjs can unit test them directly without
// booting Express or configuring Pusher.
//
// PRIVACY: the original four feeds only ever carry aggregate counters / team
// names / calendar facts / church-authored notice text — never a child's name.
// The shape is enforced by events.js's builders, which structurally cannot
// accept a name field; this module's job is just "is the body well-formed
// enough to build a valid payload from."
//
// `checkout` is the ONE EXCEPTION and it is deliberate: it carries first names,
// because a board that says "who is still here" without names is not the feature
// the operator asked for. It is the same data class as `checkin` (first name +
// club, nothing else, enforced by buildCheckout) and it is SEALED by the same
// AES-256-GCM transport. It also gets a slower throttle than the others, because
// a list of unattended children has no business being republished every 5
// seconds.

'use strict';

const events = require('./events');

// One publish per feed per this many ms — a runaway or buggy content script
// re-scraping in a tight loop must not flood the shared Pusher channel.
const THROTTLE_MS = 5000;

const FEED_NAMES = ['tonight', 'points', 'schedule', 'notice', 'checkout'];

// Per-feed throttle overrides. checkout is the most sensitive payload on the
// channel and the least urgent: the board is useful at pickup-rush granularity,
// not per-second, and every republish is another copy of "these children are
// still unattended" on the wire.
const FEED_THROTTLE_MS = { checkout: 20000 };

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// A counter field is fine when absent (the builder defaults it to 0) but if
// the caller DID send one, it must be a finite, non-negative number — a
// string like "Alice Smith" or a nested object must never silently become a
// 0 on the wire; the request should fail loudly instead so the extension's
// scrape bug gets noticed.
function isValidCount(v) {
  if (v === undefined) return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Per-feed validators ──────────────────────────────────────────────────
// Each returns { ok: true, payload } (payload is the exact contract-v3
// wire shape from events.js) or { ok: false, reason } for a 400.

function validateTonightBody(body) {
  if (body !== undefined && body !== null && !isPlainObject(body)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const b = body || {};
  for (const f of ['checkedIn', 'booksCompleted', 'awardsEarned', 'friendsBrought']) {
    if (!isValidCount(b[f])) return { ok: false, reason: `${f} must be a non-negative number` };
  }
  return { ok: true, payload: events.buildTonight(b) };
}

function validatePointsBody(body) {
  if (body !== undefined && body !== null && !isPlainObject(body)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const b = body || {};
  if (b.groups !== undefined && !isPlainObject(b.groups)) {
    return { ok: false, reason: 'groups must be an object of {teamName: points}' };
  }
  for (const [team, pts] of Object.entries(b.groups || {})) {
    if (!isValidCount(pts)) return { ok: false, reason: `groups.${team} must be a non-negative number` };
  }
  return { ok: true, payload: events.buildPoints(b.groups || {}, b.club) };
}

function validateScheduleBody(body) {
  if (body !== undefined && body !== null && !isPlainObject(body)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const b = body || {};
  if (b.nextMeetingDate !== undefined && b.nextMeetingDate !== null && String(b.nextMeetingDate).trim() !== '' &&
      !ISO_DATE_RE.test(String(b.nextMeetingDate))) {
    return { ok: false, reason: 'nextMeetingDate must be YYYY-MM-DD' };
  }
  return { ok: true, payload: events.buildSchedule(b) };
}

function validateNoticeBody(body) {
  if (body !== undefined && body !== null && !isPlainObject(body)) {
    return { ok: false, reason: 'body must be an object' };
  }
  const b = body || {};
  // buildNotice() itself returns null for an empty/whitespace message — that
  // is a 400 here, never a silent no-op publish (a blank notice must never
  // look like a successful broadcast to the operator).
  const payload = events.buildNotice(b.level, b.message);
  if (!payload) return { ok: false, reason: 'message is required and must not be empty' };
  return { ok: true, payload };
}

// The checkout board's entry list. Validation is deliberately strict about the
// SHAPE and silent about the contents: buildCheckout() drops entries with no
// usable first name and strips every field that is not firstName/club, so a
// scraper that starts picking up guardian names or allergy text cannot leak them
// through here. What this must catch is a body that is structurally wrong —
// which, for this feed, usually means the scraper matched the wrong table and is
// about to publish an EMPTY board that would read as "everyone has been picked
// up" while the room is still full.
function validateCheckoutBody(body) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  if (!Array.isArray(body.entries)) {
    // A missing array is NOT an empty board. "I could not read the page" and
    // "everyone has gone home" are opposite facts and must never collapse.
    return { ok: false, reason: 'entries must be an array (a missing array is not an empty board)' };
  }
  if (body.entries.length > events.CHECKOUT_MAX) {
    return { ok: false, reason: `entries must not exceed ${events.CHECKOUT_MAX}` };
  }
  if (body.printed !== undefined) {
    const p = Number(body.printed);
    if (!Number.isFinite(p) || p < 0) {
      return { ok: false, reason: 'printed must be a non-negative number when present' };
    }
  }
  const payload = events.buildCheckout(body.entries, body.printed);
  // Every entry was dropped from a NON-empty input: the scraper found rows but
  // none of them had a readable name, which means the selectors have drifted.
  // Publishing that as an empty board would tell the lobby everyone had left.
  if (body.entries.length > 0 && payload.entries.length === 0) {
    return {
      ok: false,
      reason: 'every entry was unusable — the checkout page selectors have probably drifted',
    };
  }
  return { ok: true, payload };
}

const VALIDATORS = {
  tonight: validateTonightBody,
  points: validatePointsBody,
  schedule: validateScheduleBody,
  notice: validateNoticeBody,
  checkout: validateCheckoutBody,
};

// ── Per-feed state ────────────────────────────────────────────────────────
// lastPublishAt gates the throttle window; feedState backs GET /health so
// the dashboard can show freshness ("last received", "last published",
// "currently throttled") per feed.
let lastPublishAt = {};
let feedState = {};

function freshState() {
  return { lastReceivedAt: null, lastPayload: null, lastPublishedAt: null, lastThrottled: false, lastPublishOk: null };
}

FEED_NAMES.forEach(f => { lastPublishAt[f] = 0; feedState[f] = freshState(); });

// The single entry point server.js calls per POST /feed/<name>. Validates
// the body, decides whether this submission should be throttled, and
// records the last-received payload for /health. Does NOT touch Pusher —
// server.js does the actual events.publish() call with the payload this
// returns, then reports the outcome back via recordPublishOutcome() so a
// Pusher hiccup can never live inside this module.
function submitFeed(feedName, body, now = Date.now()) {
  const validator = VALIDATORS[feedName];
  if (!validator) return { valid: false, status: 400, reason: `unknown feed: ${feedName}` };

  const result = validator(body);
  if (!result.ok) return { valid: false, status: 400, reason: result.reason };

  const state = feedState[feedName];
  state.lastReceivedAt = new Date(now).toISOString();
  state.lastPayload = result.payload;

  const last = lastPublishAt[feedName] || 0;
  if (now - last < (FEED_THROTTLE_MS[feedName] || THROTTLE_MS)) {
    state.lastThrottled = true;
    return { valid: true, throttled: true, payload: result.payload };
  }

  lastPublishAt[feedName] = now;
  state.lastThrottled = false;
  state.lastPublishedAt = state.lastReceivedAt;
  return { valid: true, throttled: false, payload: result.payload };
}

// Called by server.js after it attempts the actual Pusher publish, so
// GET /health can show whether the last attempt actually succeeded.
function recordPublishOutcome(feedName, published) {
  if (feedState[feedName]) feedState[feedName].lastPublishOk = !!published;
}

function getFeedsHealth() {
  const out = {};
  FEED_NAMES.forEach(f => {
    const s = feedState[f];
    out[f] = {
      lastReceivedAt: s.lastReceivedAt,
      lastPublishedAt: s.lastPublishedAt,
      lastThrottled: s.lastThrottled,
      lastPublishOk: s.lastPublishOk,
    };
  });
  return out;
}

// Test-only: reset all in-memory state between unit test cases so one
// test's throttle window can't bleed into the next.
function _resetForTests() {
  FEED_NAMES.forEach(f => { lastPublishAt[f] = 0; feedState[f] = freshState(); });
}

module.exports = {
  FEED_NAMES,
  FEED_THROTTLE_MS,
  THROTTLE_MS,
  submitFeed,
  recordPublishOutcome,
  getFeedsHealth,
  _resetForTests,
  // Exported individually so focused unit tests can exercise validation
  // rules without going through the throttle/state machinery.
  validateTonightBody,
  validatePointsBody,
  validateScheduleBody,
  validateNoticeBody,
};
