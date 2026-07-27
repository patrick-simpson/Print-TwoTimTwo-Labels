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
const NOTICE_LEVELS = ['info', 'warn', 'critical'];

const NAME_MAX = 40;
const RECAP_MAX = 15;
const BIRTHDAYS_MAX = 40;
const TALLY_CLUBS_MAX = 30;
const POINTS_GROUPS_MAX = 20;
const NOTICE_MAX = 200;
const TITLE_MAX = 60;

// Whole non-negative integer, or 0 when the input is unusable. Every
// contract-v3 counter is a count of things — never a name, never a rate.
function wholeCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function nowIso() {
  return new Date().toISOString();
}

function cleanName(s) {
  return String(s == null ? '' : s).trim().slice(0, NAME_MAX);
}

// Bounded plain text: strips anything markup-shaped and collapses whitespace
// (including the newlines TwoTimTwo's textareas allow) so display copy can
// never inject markup or blow up a fixed-height banner.
function plainText(s, max) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
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

// ── tonight (contract v3, roadmap D-1) ────────────────────────────────────────
// Aggregate counters for the lobby "tonight" ticker, derived by the extension
// from TwoTimTwo's own check-in report + meeting report. PURE NUMBERS — there
// is structurally no field here that could carry a name.
function buildTonight(input) {
  const src = input || {};
  return {
    checkedIn: wholeCount(src.checkedIn),
    booksCompleted: wholeCount(src.booksCompleted),
    awardsEarned: wholeCount(src.awardsEarned),
    friendsBrought: wholeCount(src.friendsBrought),
    at: nowIso(),
  };
}

// ── points (contract v3, roadmap D-2) ─────────────────────────────────────────
// Color-group points race (TwoTimTwo /meeting/colorGroup). Keys are color-team
// display names ("Red", "Blue"), values whole points. Team names, never kids.
function buildPoints(byGroup, club) {
  const groups = {};
  const entries = Object.entries(byGroup && typeof byGroup === 'object' ? byGroup : {})
    .slice(0, POINTS_GROUPS_MAX);
  for (const [group, n] of entries) {
    const key = cleanName(group);
    if (!key) continue;
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    groups[key] = Math.floor(v);
  }
  const payload = { groups, at: nowIso() };
  const c = cleanName(club);
  if (c) payload.club = c;
  return payload;
}

// ── schedule (contract v3, roadmap D-3) ───────────────────────────────────────
// Next-meeting facts read from TwoTimTwo's iCal feed, so the countdown/signage
// never has to guess when club actually meets. Date is a bare calendar date
// (no time-of-day, no attendee data); title is the church-authored meeting
// theme shown publicly on the calendar.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildSchedule(input) {
  const src = input || {};
  const payload = { at: nowIso() };
  const date = String(src.nextMeetingDate == null ? '' : src.nextMeetingDate).trim();
  if (ISO_DATE_RE.test(date)) payload.nextMeetingDate = date;
  const title = plainText(src.title, TITLE_MAX);
  if (title) payload.title = title;
  if (src.noClubThisWeek !== undefined) payload.noClubThisWeek = !!src.noClubThisWeek;
  return payload;
}

// ── notice (contract v3, roadmap D-5) ─────────────────────────────────────────
// A church-authored announcement (e.g. "CLUB CANCELLED TONIGHT") from
// TwoTimTwo's /msg/admin, mirrored to the screens.
//
// PRIVACY NOTE: `message` is the ONLY free-text field on the whole channel. It
// exists because this copy is written BY church staff FOR public display, so it
// is intentionally shown verbatim. It is still bounded and forced to plain text
// (markup stripped) so it can neither break the layout nor inject markup, and
// it is never derived from roster data. Returns null for an empty message so a
// blank notice can't blank the screen.
function buildNotice(level, message) {
  const text = plainText(message, NOTICE_MAX);
  if (!text) return null;
  const lvl = NOTICE_LEVELS.includes(level) ? level : 'info';
  return { level: lvl, message: text, at: nowIso() };
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
  NOTICE_LEVELS,
  RECAP_MAX,
  POINTS_GROUPS_MAX,
  buildCheckin,
  buildRecap,
  buildTally,
  buildBirthdays,
  buildOps,
  buildCanary,
  buildTonight,
  buildPoints,
  buildSchedule,
  buildNotice,
  isClubNightNow,
  parseHM,
  publish,
  getPublishState,
};
