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

// ── POST /feed/checkin-report — undo detection ──────────────────────────────
// NOT one of the five contract-v3/v4 feeds above: it never publishes a Pusher
// event of its own (no new event type — the display contract is pinned), so
// it deliberately sits outside VALIDATORS/submitFeed. It carries the SAME
// /clubber/checkin_report scrape content.js's R-1 reconcile pass already fetches
// every ~60s ("who's checked in tonight, authoritatively") so the server can
// diff it against print-history.json and notice an UNDO — a check-in removed
// on TwoTimTwo itself, which is otherwise invisible to both the roster-diff
// detector and to history. server.js's reconcileHistoryWithReport() owns the
// actual diff/mutation; this module's job is the same as for every other feed:
// decide whether the body is well-formed enough to act on, and throttle a
// runaway/buggy content script.
//
// `name` here is a whole "First Last" string (or just "First"), unlike the
// other feeds which never carry a name at all — this is the one input to this
// server that is allowed to, because it never leaves this process: it is
// compared against print-history.json in memory and never published anywhere.
const CHECKIN_REPORT_MAX = 500;
const CHECKIN_REPORT_THROTTLE_MS = 5000;

function validateCheckinReportBody(body) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  // Explicit ok/complete signal from the extension side, required rather than
  // inferred from an empty entries array — an empty array can honestly mean
  // "nobody has checked in yet" OR "the scrape failed/needed login", and only
  // the extension (which just fetched the page) can tell those apart. Treating
  // silence as "empty" would hand a plausible-looking mass-undo straight to
  // the guard below with nothing left to catch it on the way in.
  if (body.ok !== true) {
    return { ok: false, reason: 'ok must be true — only post a report that parsed successfully and completely' };
  }
  if (!Array.isArray(body.entries)) {
    return { ok: false, reason: 'entries must be an array (a missing array is not an empty report)' };
  }
  if (body.entries.length > CHECKIN_REPORT_MAX) {
    return { ok: false, reason: `entries must not exceed ${CHECKIN_REPORT_MAX}` };
  }
  const entries = [];
  for (const raw of body.entries) {
    if (!isPlainObject(raw)) continue;
    const name = String(raw.name || '').trim().slice(0, 80);
    if (!name) continue; // an entry with no readable name can't be matched to anyone
    const clubberIdRaw = raw.clubberId != null ? String(raw.clubberId).trim() : '';
    entries.push({
      name,
      clubberId: clubberIdRaw ? clubberIdRaw.slice(0, 40) : null,
      club: String(raw.club || '').trim().slice(0, 60),
    });
  }
  return { ok: true, payload: { entries } };
}

// ── POST /feed/unverified-checkins (#2: batch self-verify report) ─────────
// The extension's list of kids whose driven site check-in could not be
// verified as stuck (label printed, TwoTimTwo never confirmed). Same
// loopback-only, never-published rule as the checkin report above — names
// are allowed in because they never leave this process except via /health's
// operator warning. REPLACE semantics: every post is the full current list,
// so an emptied list clears the dashboard warning immediately.
const UNVERIFIED_MAX = 30;

function validateUnverifiedBody(body) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  if (!Array.isArray(body.entries)) return { ok: false, reason: 'entries must be an array' };
  // Truncate, never reject: a mass failure (site contract drift mid-night) is
  // exactly when this list matters most, and a hard 400 on entry #31 would
  // freeze the dashboard warning at a stale list while the widget shows the
  // truth. Keep the newest (the extension appends in insertion order).
  const capped = body.entries.length > UNVERIFIED_MAX
    ? body.entries.slice(-UNVERIFIED_MAX)
    : body.entries;
  const entries = [];
  for (const raw of capped) {
    if (!isPlainObject(raw)) continue;
    const name = String(raw.name || '').trim().slice(0, 80);
    if (!name) continue;
    entries.push({
      name,
      clubberId: raw.clubberId != null && String(raw.clubberId).trim()
        ? String(raw.clubberId).trim().slice(0, 40) : null,
      club: String(raw.club || '').trim().slice(0, 60),
      at: typeof raw.at === 'string' ? raw.at.slice(0, 40) : null,
    });
  }
  return { ok: true, payload: { entries } };
}

let unverifiedState = { entries: [], updatedAt: null };

function submitUnverified(body, now = Date.now()) {
  const result = validateUnverifiedBody(body);
  if (!result.ok) return { valid: false, status: 400, reason: result.reason };
  unverifiedState = { entries: result.payload.entries, updatedAt: now };
  return { valid: true, payload: result.payload };
}

// Read by /health's warning builder. Entries go stale after 3h so a list
// left over from last week's club night can't paint a warning forever if
// the extension never runs again to clear it.
const UNVERIFIED_STALE_MS = 3 * 60 * 60 * 1000;
function getUnverifiedCheckins(now = Date.now()) {
  if (!unverifiedState.entries.length) return [];
  if (now - (unverifiedState.updatedAt || 0) > UNVERIFIED_STALE_MS) return [];
  return unverifiedState.entries;
}

// ── POST /feed/completed-books (#293: the trophy band) ──────────────────────
// Which children finished a handbook recently, scraped from TwoTimTwo's own
// /report/completed_books. Same standalone, loopback-only, NEVER-PUBLISHED
// class as the two feeds above: it is deliberately outside FEED_NAMES /
// VALIDATORS / submitFeed, because makeFeedRoute() publishes every registered
// feed to the PUBLIC Pusher channel and these rows carry children's full
// names. They live in memory here, are never written to disk, and are read
// only at print time to decorate that child's next label.
//
// MERGE semantics, not replace: the extension posts one payload per club, so
// a second club's post must not wipe the first's.
const COMPLETED_BOOKS_MAX = 500;
const COMPLETED_BOOKS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const COMPLETED_BOOKS_THROTTLE_MS = 5000;

// The report's "Name" column ordering is undocumented (docs/TWOTIMTWO.md
// §5 lists the header only), so both "First Last" and "Last, First" have to
// key the same child — otherwise the band would silently never fire.
function normalizeChildName(name) {
  let s = String(name == null ? '' : name).replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
  const comma = s.indexOf(',');
  if (comma !== -1) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    s = `${first} ${last}`.trim();
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Returns an ISO YYYY-MM-DD string, or null when the date cannot be read with
// confidence. A row whose date is unreadable is DROPPED: no band beats a band
// celebrating a book finished last spring.
function parseBookDate(raw, now = Date.now()) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let y; let mo; let d;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]);
    if (y < 100) y += 2000;
  }
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // Guard both ends: a typo'd future date would stick around forever, and an
  // out-of-window one is not worth carrying.
  if (t > now + 24 * 60 * 60 * 1000) return null;
  if (t < now - COMPLETED_BOOKS_WINDOW_MS) return null;
  return iso;
}

function validateCompletedBooksBody(body, now = Date.now()) {
  if (!isPlainObject(body)) return { ok: false, reason: 'body must be an object' };
  if (!Array.isArray(body.entries)) return { ok: false, reason: 'entries must be an array' };
  // Truncate, never reject (same reasoning as validateUnverifiedBody): a
  // decoration is not worth a 400 that hides every other row in the batch.
  const capped = body.entries.length > COMPLETED_BOOKS_MAX
    ? body.entries.slice(-COMPLETED_BOOKS_MAX)
    : body.entries;
  const entries = [];
  for (const raw of capped) {
    if (!isPlainObject(raw)) continue;
    const key = normalizeChildName(raw.name);
    if (!key) continue;
    const book = String(raw.book || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!book) continue;
    const date = parseBookDate(raw.date, now);
    if (!date) continue;
    entries.push({ key, book, date });
  }
  return { ok: true, payload: { entries } };
}

let completedBooksState = { byName: new Map(), updatedAt: null };
let lastCompletedBooksAt = 0;

function submitCompletedBooks(body, now = Date.now()) {
  const result = validateCompletedBooksBody(body, now);
  if (!result.ok) return { valid: false, status: 400, reason: result.reason };
  if (now - lastCompletedBooksAt < COMPLETED_BOOKS_THROTTLE_MS) {
    return { valid: true, throttled: true, payload: result.payload };
  }
  lastCompletedBooksAt = now;
  for (const e of result.payload.entries) {
    const prev = completedBooksState.byName.get(e.key);
    if (!prev || e.date >= prev.date) completedBooksState.byName.set(e.key, { book: e.book, date: e.date });
  }
  const cutoff = now - COMPLETED_BOOKS_WINDOW_MS;
  for (const [k, v] of completedBooksState.byName) {
    if (Date.parse(`${v.date}T00:00:00Z`) < cutoff) completedBooksState.byName.delete(k);
  }
  completedBooksState.updatedAt = now;
  return { valid: true, throttled: false, payload: result.payload };
}

// The print-time lookup. Synchronous, in-memory, and re-checks the window on
// READ as well as on write — a server left running for a month must not still
// be banding a book finished in September.
function getCompletedBook(name, now = Date.now()) {
  const key = normalizeChildName(name);
  if (!key) return null;
  const row = completedBooksState.byName.get(key);
  if (!row) return null;
  if (Date.parse(`${row.date}T00:00:00Z`) < now - COMPLETED_BOOKS_WINDOW_MS) return null;
  return { book: row.book, date: row.date };
}

let lastCheckinReportAt = 0;

// Same shape as submitFeed()'s return ({valid, status, reason} | {valid:true,
// throttled, payload}) so server.js's route reads identically to the other
// feed routes, minus the Pusher publish step that route does itself.
function submitCheckinReport(body, now = Date.now()) {
  const result = validateCheckinReportBody(body);
  if (!result.ok) return { valid: false, status: 400, reason: result.reason };
  if (now - lastCheckinReportAt < CHECKIN_REPORT_THROTTLE_MS) {
    return { valid: true, throttled: true, payload: result.payload };
  }
  lastCheckinReportAt = now;
  return { valid: true, throttled: false, payload: result.payload };
}

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
  lastCheckinReportAt = 0;
  unverifiedState = { entries: [], updatedAt: null };
  completedBooksState = { byName: new Map(), updatedAt: null };
  lastCompletedBooksAt = 0;
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
  // POST /feed/checkin-report (undo detection) — deliberately not part of
  // FEED_NAMES/VALIDATORS/submitFeed; see the comment above its definition.
  CHECKIN_REPORT_MAX,
  CHECKIN_REPORT_THROTTLE_MS,
  validateCheckinReportBody,
  submitCheckinReport,
  // POST /feed/unverified-checkins (#2) — also standalone, never published.
  UNVERIFIED_MAX,
  validateUnverifiedBody,
  submitUnverified,
  getUnverifiedCheckins,
  // POST /feed/completed-books (#293, the trophy band) — standalone and never
  // published, for the same reason: these rows carry children's full names.
  COMPLETED_BOOKS_MAX,
  COMPLETED_BOOKS_WINDOW_MS,
  normalizeChildName,
  parseBookDate,
  validateCompletedBooksBody,
  submitCompletedBooks,
  getCompletedBook,
};
