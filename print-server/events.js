// Awana event bus — pure payload builders + resilient publisher.
//
// The print server is the ONLY publisher on the shared Pusher channel; the
// check-in display and the countdown app are subscribe-only consumers.
// Every payload shape here is pinned by contract-vectors.json (validated by
// scripts/test-contracts.cjs) and mirrored in the consumer repos.
//
// PRIVACY RULE: only first names ever ride the channel. No lastName, no
// allergies, no contact info, no birth years — the builders enforce this
// structurally by never accepting those fields.

'use strict';

const crypto = require('crypto');

const OPS_TYPES = ['print-failure', 'canary', 'selector-fail'];

const NAME_MAX = 40;
const RECAP_MAX = 15;
const BIRTHDAYS_MAX = 40;
const TALLY_CLUBS_MAX = 30;

function nowIso() {
  return new Date().toISOString();
}

function cleanName(s) {
  return String(s == null ? '' : s).trim().slice(0, NAME_MAX);
}

// ── checkin ───────────────────────────────────────────────────────────────────
// v2 of the original 4-field event: `id` lets consumers dedupe live vs recap
// delivery, `at` lets them age out stale replays. Consumers treat both as
// optional so deploy order between producer and consumers doesn't matter.
function buildCheckin(input) {
  const src = input || {};
  return {
    id: crypto.randomUUID(),
    at: nowIso(),
    firstName: cleanName(src.firstName),
    club: cleanName(src.club),
    isBirthday: !!src.isBirthday,
    isFirstTimer: !!src.isFirstTimer,
  };
}

// ── recap ─────────────────────────────────────────────────────────────────────
// Rolling replay of tonight's recent check-ins so a display that reconnects
// mid-event can celebrate the kids it missed. Entries are verbatim checkin
// payloads (id + at required — consumers dedupe on id).
function buildRecap(checkins) {
  const entries = (Array.isArray(checkins) ? checkins : [])
    .filter(c => c && typeof c.id === 'string' && typeof c.at === 'string')
    .slice(-RECAP_MAX)
    .map(c => ({
      id: c.id,
      at: c.at,
      firstName: cleanName(c.firstName),
      club: cleanName(c.club),
      isBirthday: !!c.isBirthday,
      isFirstTimer: !!c.isFirstTimer,
    }));
  return { entries, at: nowIso() };
}

// ── tally ─────────────────────────────────────────────────────────────────────
// Per-club checked-in counts — pure numbers, zero PII. Keys are club display
// names exactly as the check-in system reports them; each consumer normalizes
// through its own alias map.
function buildTally(byClub, total) {
  const counts = {};
  let sum = 0;
  const entries = Object.entries(byClub && typeof byClub === 'object' ? byClub : {})
    .slice(0, TALLY_CLUBS_MAX);
  for (const [club, n] of entries) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    const key = cleanName(club);
    if (!key) continue;
    counts[key] = Math.floor(v);
    sum += counts[key];
  }
  const t = Number(total);
  return {
    counts,
    total: Number.isFinite(t) && t >= 0 ? Math.floor(t) : sum,
    at: nowIso(),
  };
}

// ── birthdays ─────────────────────────────────────────────────────────────────
// This week's birthday kids: first name + club + the birthday's calendar
// month/day (ints, NO year) so the countdown app can reuse its pure
// week-matching directly. Invalid entries are dropped, never passed through.
function buildBirthdays(rawEntries) {
  const entries = [];
  for (const item of Array.isArray(rawEntries) ? rawEntries : []) {
    if (entries.length >= BIRTHDAYS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const firstName = cleanName(item.firstName);
    const club = cleanName(item.club);
    const month = Math.floor(Number(item.month));
    const day = Math.floor(Number(item.day));
    if (!firstName) continue;
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    if (!Number.isFinite(day) || day < 1 || day > 31) continue;
    entries.push({ firstName, club, month, day });
  }
  return { entries, at: nowIso() };
}

// ── ops ───────────────────────────────────────────────────────────────────────
// Operator-only telemetry (print failures, selector drift). Carries a type,
// an optional club, and a timestamp — NEVER a name. Displays surface these on
// status widgets, never as public banners.
function buildOps(type, club) {
  const t = OPS_TYPES.includes(type) ? type : null;
  if (!t) return null;
  const payload = { type: t, at: nowIso() };
  const c = cleanName(club);
  if (c) payload.club = c;
  return payload;
}

// ── canary ────────────────────────────────────────────────────────────────────
// End-to-end "is the pipe alive" test event fired by POST /canary.
function buildCanary() {
  return { at: nowIso(), nonce: crypto.randomBytes(8).toString('hex') };
}

// ── Club-night window ─────────────────────────────────────────────────────────
// clubNights: [{ dow: 0-6 (Sunday=0), start: "HH:MM", end: "HH:MM" }].
// Pure function of the supplied date (defaults to now) so it's testable.
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function isClubNightNow(clubNights, date) {
  if (!Array.isArray(clubNights)) return false;
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const mins = d.getHours() * 60 + d.getMinutes();
  return clubNights.some(w => {
    if (!w || typeof w !== 'object') return false;
    if (Number(w.dow) !== d.getDay()) return false;
    const start = parseHM(w.start);
    const end = parseHM(w.end);
    return start !== null && end !== null && mins >= start && mins < end;
  });
}

// ── Publisher ─────────────────────────────────────────────────────────────────
// Wraps pusher.trigger so a Pusher outage can never take a print down with
// it: publish() NEVER throws and never rejects. Health state is recorded for
// /health so the dashboard can show "last publish OK / failed at HH:MM".
const publishState = {
  configured: false,
  lastPublishOk: null,   // true | false | null (never attempted)
  lastPublishAt: null,   // ISO string of the last attempt
  lastEvent: null,       // event name of the last attempt
  lastError: null,       // message of the last failure
};

function getPublishState() {
  return { ...publishState };
}

function publish(pusher, channel, event, payload) {
  publishState.configured = !!pusher;
  if (!pusher || !payload) return Promise.resolve(false);
  try {
    return Promise.resolve(pusher.trigger(channel, event, payload)).then(
      () => {
        publishState.lastPublishOk = true;
        publishState.lastPublishAt = nowIso();
        publishState.lastEvent = event;
        publishState.lastError = null;
        return true;
      },
      (e) => {
        publishState.lastPublishOk = false;
        publishState.lastPublishAt = nowIso();
        publishState.lastEvent = event;
        publishState.lastError = (e && e.message) || 'publish failed';
        console.warn(`[pusher] ${event} publish failed:`, publishState.lastError);
        return false;
      }
    );
  } catch (e) {
    publishState.lastPublishOk = false;
    publishState.lastPublishAt = nowIso();
    publishState.lastEvent = event;
    publishState.lastError = (e && e.message) || 'publish threw';
    console.warn(`[pusher] ${event} publish threw:`, publishState.lastError);
    return Promise.resolve(false);
  }
}

module.exports = {
  OPS_TYPES,
  RECAP_MAX,
  buildCheckin,
  buildRecap,
  buildTally,
  buildBirthdays,
  buildOps,
  buildCanary,
  isClubNightNow,
  parseHM,
  publish,
  getPublishState,
};
