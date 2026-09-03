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

const OPS_TYPES = ['print-failure', 'canary', 'selector-fail', 'update-ok'];
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
  const out = {
    id: crypto.randomUUID(),
    at: nowIso(),
    firstName: cleanName(src.firstName),
    club: cleanName(src.club),
    isBirthday: !!src.isBirthday,
    isFirstTimer: !!src.isFirstTimer,
  };
  // OPTIONAL celebration flags (contract optionalFields), sealed with the
  // rest of the payload so a name-bearing celebration never rides plaintext:
  //   welcomeBack — a RETURNING kid's first night of the season (#9).
  //   milestone   — the season night-count on the night a label milestone
  //                 is hit (5/10/25/50), for the display's milestone wall
  //                 (#10). A count alone is low-risk, but it rides the
  //                 sealed envelope regardless because it's per-child data.
  // Optional forever: old displays drop unknown fields, deploy order never
  // matters, and the fixed 512-byte checkin pad has ~100 bytes of headroom
  // these short fields fit inside (test:envelope proves length uniformity).
  if (src.welcomeBack === true) out.welcomeBack = true;
  const ms = Number(src.milestone);
  if (Number.isInteger(ms) && ms > 0 && ms <= 999) out.milestone = ms;
  return out;
}

// ── recap ─────────────────────────────────────────────────────────────────────
// Rolling replay of tonight's recent check-ins so a display that reconnects
// mid-event can celebrate the kids it missed. Entries are verbatim checkin
// payloads (id + at required — consumers dedupe on id).
function buildRecap(checkins) {
  const entries = (Array.isArray(checkins) ? checkins : [])
    .filter(c => c && typeof c.id === 'string' && typeof c.at === 'string')
    .slice(-RECAP_MAX)
    .map(c => {
      const e = {
        id: c.id,
        at: c.at,
        firstName: cleanName(c.firstName),
        club: cleanName(c.club),
        isBirthday: !!c.isBirthday,
        isFirstTimer: !!c.isFirstTimer,
      };
      // Replayed entries keep the celebration flags (#9/#10) so a display
      // that reconnects mid-night still knows — quietly — who was new-season
      // and who hit a milestone.
      if (c.welcomeBack === true) e.welcomeBack = true;
      if (Number.isInteger(c.milestone) && c.milestone > 0) e.milestone = c.milestone;
      return e;
    });
  return { entries, at: nowIso() };
}

// ── checkout (contract v4) ────────────────────────────────────────────────────
// Who is still in the building. TwoTimTwo's /clubber/checkout page IS the live
// list of children currently checked in, so this carries that SET rather than a
// departure signal — there is no "child left" event to miss.
//
// Same data class as `checkin`: first name + club, nothing else. It is sealed by
// the same transport for the same reason, and it needs it MORE than the others:
// a list of who is still unattended is the single most sensitive thing this
// system could put on a wire.
//
// `printed` (how many labels were printed tonight) travels alongside so a
// consumer can show the board honestly — "12 of 43 still here" — rather than
// implying the list is a verified headcount. It is NOT a headcount: it reflects
// whether volunteers performed checkout, which during a pickup rush they often
// do not. Consumers must treat it as "recorded checkouts", gate it behind an
// operator setting, and stop naming individuals once the count gets small.
const CHECKOUT_MAX = 60;

function buildCheckout(rawEntries, printed) {
  const entries = [];
  for (const item of Array.isArray(rawEntries) ? rawEntries : []) {
    if (entries.length >= CHECKOUT_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const firstName = cleanName(item.firstName);
    if (!firstName) continue;
    // Structurally only these two fields — a lastName or clubberId on the input
    // object cannot reach the payload even if a caller passes one.
    entries.push({ firstName, club: cleanName(item.club) });
  }
  const payload = { entries, at: nowIso() };
  const p = Number(printed);
  if (Number.isFinite(p) && p >= 0) payload.printed = Math.floor(p);
  return payload;
}

// ── tally ─────────────────────────────────────────────────────────────────────
// Per-club checked-in counts — pure numbers, zero PII. Keys are club display
// names exactly as the check-in system reports them; each consumer normalizes
// through its own alias map.
function buildTally(byClub, total, extras) {
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
  const out = {
    counts,
    total: Number.isFinite(t) && t >= 0 ? Math.floor(t) : sum,
    at: nowIso(),
  };
  // OPTIONAL, plaintext, zero-PII extras (contract optionalFields):
  //   season    — unified theming (#18): the printer's season broadcast, a
  //               lowercase slug like 'christmas', so screens and labels
  //               switch together. Absent when the operator turned art off.
  //   rehearsal — rehearsal mode (#19): true while a training run is armed,
  //               so displays can watermark themselves. Absent otherwise.
  // Both must stay optional forever: old displays drop unknown fields, and
  // deploy order between the repos must never matter (CONTRACT.md).
  if (extras && typeof extras === 'object') {
    const s = String(extras.season || '').toLowerCase();
    if (/^[a-z][a-z-]{1,19}$/.test(s)) out.season = s;
    if (extras.rehearsal === true) out.rehearsal = true;
  }
  return out;
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
function buildOps(type, club, extras) {
  const t = OPS_TYPES.includes(type) ? type : null;
  if (!t) return null;
  const payload = { type: t, at: nowIso() };
  const c = cleanName(club);
  if (c) payload.club = c;
  // Update health beacon (#5): version + ok flag ONLY — a bare semver string
  // is the entire payload beyond the type. Junk (or anything non-semver) is
  // dropped rather than published; there is structurally nothing else here.
  const x = extras || {};
  if (typeof x.version === 'string' && /^\d+\.\d+\.\d+$/.test(x.version)) {
    payload.version = x.version;
  }
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

// ── slides (contract v5) ──────────────────────────────────────────────────────
// The lobby displays' typed slide deck, published once by the operator so every
// screen shows the same announcements. TEXT ONLY, by contract: the display app
// also supports per-device video slides whose bytes live in that device's
// IndexedDB, so a video entry is meaningless on any other screen — the builder
// drops them (and any unknown type) rather than publishing a dead reference.
//
// The deck is arbitrary operator-authored copy ("Pray for the Smiths"), so the
// event rides SEALED like the name-bearing four. One deck can exceed Pusher's
// per-message ceiling, so it is split into chunks; every chunk of one publish
// carries identical {deckRev, publishedAt} and its {seq, total}. publishedAt is
// the ONE ordering authority on the consumer (deckRev is an operator-facing
// counter that restarts harmlessly if this server loses its state file), so
// rebroadcasts must reuse the stored publishedAt byte-identically.
//
// These caps mirror the display repo's src/lib/slides.js and are pinned on both
// sides by contract-vectors.json.
const SLIDE_THEMES = ['sky', 'sunset', 'night', 'meadow', 'lavender'];
const SLIDE_TEXT_SIZES = ['auto', 'xl', 'lg', 'md'];
const SLIDES_MAX = 50;
const SLIDE_TEXT_MAX = 500;
const SLIDE_EYEBROW_MAX = 60;
const SLIDE_ID_MAX = 64;
const SLIDE_MIN_DURATION_SEC = 3;
const SLIDE_MAX_DURATION_SEC = 600;
// One chunk's JSON must seal into the 4096 pad rung (4 length-prefix bytes
// spare), and 12 chunks must cover any deck the size gate below admits. The
// budget leaves margin for the {deckRev, publishedAt, seq, total} wrapper.
const SLIDES_CHUNK_JSON_BUDGET = 3900;
const SLIDES_TOTAL_MAX = 12;
// Coarse publish-time cap on the whole sanitized deck's serialized size —
// far beyond any deck a lobby loop can actually show. NOT a chunk-count
// guarantee: greedy packing can strand nearly a full slide of slack per
// chunk, so the publish endpoint additionally dry-runs buildSlidesChunks and
// refuses any deck it returns null for. Both refusals are a clear 413, never
// silent truncation.
const SLIDES_DECK_JSON_MAX = 40000;

// Slide text keeps its newlines (decks are typed multi-line) but never control
// characters, which bloat as \uXXXX escapes and can mangle logs.
function slideText(value, max) {
  const s = String(value == null ? '' : value);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code === 0x0a ? '\n' : ((code < 0x20 || code === 0x7f) ? ' ' : s[i]);
  }
  return out.trim().slice(0, max);
}

/**
 * Sanitize one raw deck into publishable text slides. Video and unknown-type
 * entries are DROPPED (device-local by design), blank text drops the slide,
 * every field is clamped to the contract caps. Never throws.
 */
function buildSlidesDeck(rawSlides) {
  const slides = [];
  for (const item of Array.isArray(rawSlides) ? rawSlides : []) {
    if (slides.length >= SLIDES_MAX) break;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.type !== undefined) continue;               // video / future types: device-local
    const text = slideText(item.text, SLIDE_TEXT_MAX);
    if (!text) continue;
    const slide = {
      eyebrow: slideText(item.eyebrow, SLIDE_EYEBROW_MAX).replace(/\n/g, ' '),
      text,
      theme: SLIDE_THEMES.includes(item.theme) ? item.theme : 'auto',
      textSize: SLIDE_TEXT_SIZES.includes(item.textSize) ? item.textSize : 'auto',
      durationSec: 0,
    };
    const dur = Number(item.durationSec);
    if (Number.isFinite(dur) && dur > 0) {
      slide.durationSec = Math.min(SLIDE_MAX_DURATION_SEC, Math.max(SLIDE_MIN_DURATION_SEC, Math.round(dur)));
    }
    // The display keys its React lists and dedupe on ids; a clean one passes
    // through, anything else is omitted and the consumer mints its own.
    if (typeof item.id === 'string' && item.id.trim() && item.id.length <= SLIDE_ID_MAX
        && !hasSlideControlChars(item.id)) {
      slide.id = item.id;
    }
    slides.push(slide);
  }
  return slides;
}

function hasSlideControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Serialized size of the sanitized deck — the publish endpoint's size gate. */
function slidesDeckJsonBytes(slides) {
  return Buffer.byteLength(JSON.stringify(slides), 'utf8');
}

/**
 * Split one sanitized deck into sealed-transport chunks. Greedy byte-budget
 * packing; every chunk carries identical {deckRev, publishedAt} plus its
 * {seq, total}. An EMPTY deck is one chunk with slides:[] — "the operator
 * published nothing" must propagate, it is not the absence of a publish.
 *
 * Returns null (fail closed — nothing publishable) when the deck cannot fit
 * SLIDES_TOTAL_MAX chunks. The publish endpoint dry-runs this and refuses
 * (413) any deck that returns null BEFORE committing state, so a null from
 * the heartbeat/startup path can only mean a state file written by something
 * other than an accepted publish.
 */
function buildSlidesChunks(slides, deckRev, publishedAt) {
  const deck = Array.isArray(slides) ? slides : [];
  const rev = Math.max(1, Math.floor(Number(deckRev) || 1));
  const stamp = String(publishedAt);
  const groups = [[]];
  let groupBytes = 0;
  for (const slide of deck) {
    const bytes = Buffer.byteLength(JSON.stringify(slide), 'utf8') + 1;
    if (groups[groups.length - 1].length > 0 && groupBytes + bytes > SLIDES_CHUNK_JSON_BUDGET) {
      groups.push([]);
      groupBytes = 0;
    }
    groups[groups.length - 1].push(slide);
    groupBytes += bytes;
  }
  if (groups.length > SLIDES_TOTAL_MAX) return null;
  const total = groups.length;
  const chunks = groups.map((group, seq) => ({
    deckRev: rev,
    publishedAt: stamp,
    seq,
    total,
    slides: group,
  }));
  // The budget must guarantee every chunk seals into the slides pad ladder; a
  // chunk that could not would make publish() fail closed mid-deck.
  for (const chunk of chunks) {
    if (paddedSize('slides', Buffer.byteLength(JSON.stringify(chunk), 'utf8')) == null) return null;
  }
  return chunks;
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

// ── Sealed envelopes ──────────────────────────────────────────────────────────
// The write side of the encrypted realtime pipe. The consumer half is
// Awana-Check-in-Display/src/lib/envelope.js and the framing below MUST stay
// byte-compatible with it.
//
// WHY: the Pusher channel is PUBLIC. Subscription is granted by possession of
// the app key, which has to ship in the display's public bundle for a screen to
// connect at all, so anyone who views source can subscribe from anywhere in the
// world and read every event forever. Pusher public channels have no
// server-side authorization primitive to switch on — it is absent from the
// product, not merely unconfigured. The first-names-only rule above is still
// the primary defence and still holds, but "a stranger can read every child's
// first name and club, live, from anywhere" was never acceptable.
//
// The four name-bearing events are sealed, and so is `slides` — the operator's
// typed deck is arbitrary church-authored text that has no business being
// world-readable forever. The remaining events stay plaintext ON PURPOSE: they
// are counts and short public copy, and their readability is what lets a screen
// distinguish "the pipe is down" from "I can't read the names" from "quiet
// night". See SECURITY.md in the display repo for what remains exposed (timing
// and headcount, irreducibly).
//
//   envelope  = { v: 1, kid, iv, ct }          // base64 except v
//   aad       = utf8("1:" + eventName)         // binds a frame to its event
//   plaintext = u32be(jsonByteLength) || json || zero filler
//   ct        = aesgcm_ciphertext || 16-byte tag   (WebCrypto's layout)
const ENVELOPE_VERSION = 1;
const ENCRYPTED_EVENTS = new Set(['checkin', 'recap', 'birthdays', 'checkout', 'slides']);
// checkin gets a FIXED pad: it is the frame that matters, one child per event,
// so its length must reveal nothing at all. 512 covers the true worst case —
// note the builders cap names at 40 CHARACTERS, and a character can be 4 bytes
// in UTF-8, so the worst case is ~380 bytes, not the ~220 that ASCII suggests.
const CHECKIN_PAD = 512;
// The bulk events (recap, birthdays) are periodic rebroadcasts of many entries
// and cannot use a fixed pad: Pusher rejects any event over PUSHER_MAX_BYTES,
// and their worst case padded to a single size would exceed it. They get a
// coarse ladder instead, which hides the exact byte size — so name lengths
// within a rung are indistinguishable — while leaking a rough bucket of the
// entry count. That bucket is not sensitive: the PLAINTEXT tally already
// publishes exact per-club counts by design, so the count of recent check-ins
// is public knowledge either way. What must stay hidden is WHO, and it does.
// The ladder starts high on purpose, so realistic recaps all land in one rung.
const PAD_LADDER = [2048, 4096, 8192];
// `slides` gets its own SHORTER ladder with NO round-up past the top rung: an
// 8192-padded plaintext base64-inflates past Pusher's 10 KB ceiling, so a rung
// the transport cannot actually deliver must not exist for this event. The
// chunker guarantees every chunk fits 4096; if one ever did not, publish()
// fails closed rather than leaking a bigger-than-declared frame.
const SLIDES_PAD_LADDER = [2048, 4096];
const LEN_PREFIX = 4;
// Pusher's per-event ceiling (10 KB on the Sandbox plan). Base64 inflates by
// 4/3, so a padded plaintext above ~7 KB produces a message Pusher refuses.
// Asserted against realistic worst cases in scripts/test-envelope.cjs.
const PUSHER_MAX_BYTES = 10240;

// PADDING IS NOT OPTIONAL. GCM is CTR-based and adds no padding of its own, so
// an unpadded envelope reveals len(firstName) + len(club) exactly. Club is
// inferable by correlating the plaintext `tally`, and first names run 3-9
// characters, so against a known roster over a season that is a real
// re-identification channel — it would reduce the claim from "cannot read the
// names" to "can often guess the names". scripts/test-envelope.cjs asserts
// every valid checkin vector seals to an IDENTICAL ciphertext length.
function paddedSize(event, jsonByteLength) {
  const needed = LEN_PREFIX + jsonByteLength;
  if (event === 'checkin') {
    // Deliberately no fallback to a larger rung: that would reintroduce the
    // length channel for exactly the frames that matter most. The builders cap
    // name and club length upstream so this is unreachable; if it ever fires,
    // publish() fails closed rather than leaking a length.
    return needed <= CHECKIN_PAD ? CHECKIN_PAD : null;
  }
  if (event === 'slides') {
    for (const rung of SLIDES_PAD_LADDER) if (needed <= rung) return rung;
    return null;   // fail closed — see SLIDES_PAD_LADDER above
  }
  for (const rung of PAD_LADDER) if (needed <= rung) return rung;
  const step = PAD_LADDER[PAD_LADDER.length - 1];
  return Math.ceil(needed / step) * step;
}

// The key this server seals with. Held in a module-level slot rather than
// threaded through publish()'s signature so all ~20 call sites in server.js are
// untouched and cannot individually forget it.
let displayKeyBytes = null;
let displayKeyId = null;

/** 32 raw bytes, base64-encoded. */
function isValidDisplayKey(value) {
  const s = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z0-9+/]{42,44}={0,2}$/.test(s)) return false;
  try {
    return Buffer.from(s, 'base64').length === 32;
  } catch {
    return false;
  }
}

/** Generate a fresh key for the dashboard's "Generate display key" button. */
function generateDisplayKey() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Install (or clear) the sealing key. Returns true when a usable key is set.
 * An invalid key CLEARS rather than half-configures, so the fail-closed branch
 * in publish() catches it instead of a later crypto throw.
 */
function setDisplayKey(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || !isValidDisplayKey(s)) {
    displayKeyBytes = null;
    displayKeyId = null;
    return false;
  }
  displayKeyBytes = Buffer.from(s, 'base64');
  displayKeyId = kidFor(displayKeyBytes);
  return true;
}

/** The public fingerprint of a key: first 8 hex chars of SHA-256(keyBytes). */
function kidFor(keyBytes) {
  return crypto.createHash('sha256').update(keyBytes).digest('hex').slice(0, 8);
}

function getDisplayKeyState() {
  return { configured: !!displayKeyBytes, kid: displayKeyId };
}

function aadFor(event) {
  return Buffer.from(`${ENVELOPE_VERSION}:${event}`, 'utf8');
}

/**
 * Seal one payload. Returns the envelope, or null when it cannot be sealed —
 * callers MUST treat null as "do not publish", never as "publish plaintext".
 */
function seal(event, payload) {
  if (!displayKeyBytes) return null;
  return sealWith(displayKeyBytes, displayKeyId, event, payload);
}

/**
 * The same envelope under an explicit key — the display-login provision frame
 * is sealed with a passphrase-derived wrapping key rather than the display key.
 * Identical framing on purpose, so the display opens it with the one
 * openEnvelope() it already has.
 */
function sealWith(keyBytes, kid, event, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const size = paddedSize(event, json.length);
  if (size == null) return null;
  const plain = Buffer.alloc(size);           // zero-filled: the filler is
  plain.writeUInt32BE(json.length, 0);        // inside the ciphertext, so it
  json.copy(plain, LEN_PREFIX);               // reveals nothing.
  // A fresh random IV per frame. Never a counter, never derived from a clock:
  // a repeated (key, IV) pair in GCM is catastrophic, not merely weak.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  cipher.setAAD(aadFor(event));
  const ct = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return {
    v: ENVELOPE_VERSION,
    kid,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Test seam — the consumer's job in production, but needed for round-trips. */
function openForTest(keyBase64, event, envelope) {
  return openWithForTest(Buffer.from(String(keyBase64).trim(), 'base64'), event, envelope);
}

function openWithForTest(key, event, envelope) {
  const ct = Buffer.from(envelope.ct, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = ct.subarray(ct.length - 16);
  const body = ct.subarray(0, ct.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(aadFor(event));
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(body), d.final()]);
  const len = plain.readUInt32BE(0);
  return JSON.parse(plain.subarray(LEN_PREFIX, LEN_PREFIX + len).toString('utf8'));
}

// ── Display login (device provisioning) ───────────────────────────────────────
// One church passphrase logs every screen in. The server derives a 32-byte
// wrapping key from it with PBKDF2-SHA256 (the one KDF WebCrypto also has), and
// publishes the display key + the slides publish token sealed under that key —
// the SAME envelope framing as every other sealed event, so a screen opens it
// with the openEnvelope() it already trusts. Delivered as event `provision` on a
// Pusher CACHE channel (cache-<channel>-provision): a screen that subscribes
// receives the last frame immediately, or `pusher:cache_miss` if the server has
// not published in the last ~30 minutes. The 5-minute heartbeat in server.js is
// therefore the delivery mechanism, not a nicety.
//
// The frame is public ciphertext on a public channel. The passphrase's strength
// is the ONLY thing protecting the display key: generated passphrases are 80
// bits; typed ones must be at least 12 characters. A leaked passphrase is a
// leaked display key and publish token — rotate all three (SECURITY.md).
//
// `provision` is deliberately NOT in ENCRYPTED_EVENTS: it is sealed here with
// the wrapping key, never the display key, and it is transport/provisioning,
// not one of the display-contract events a screen ever renders.
const PROVISION_EVENT = 'provision';
const PROVISION_KDF_NAME = 'PBKDF2-SHA256';
const PROVISION_KDF_ITERATIONS = 600000;   // OWASP's SHA-256 figure; ~0.3s here
const PROVISION_SALT_BYTES = 16;
const LOGIN_PASSPHRASE_MIN = 12;
const LOGIN_PASSPHRASE_MAX = 128;
// What the lobby-slides publish token must look like (server.js validates the
// operator's value with it; the bundle refuses to carry anything else).
const SLIDES_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

function provisionChannelFor(channel) {
  return `cache-${channel}-provision`;
}

/** Both sides apply exactly this before UTF-8 encoding — pinned in the fixture. */
function normalizePassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC');
}

function isValidLoginPassphrase(p) {
  const s = normalizePassphrase(p);
  if (s.length < LOGIN_PASSPHRASE_MIN || s.length > LOGIN_PASSPHRASE_MAX) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x1f\x7f]/.test(s);
}

// 4 groups of 4 from a 32-letter alphabet with no l/0/1/2 (the four that get
// misread from across a room): 5 bits a character, 80 bits a passphrase.
const PASSPHRASE_ALPHABET = 'abcdefghijkmnopqrstuvwxyz3456789';
function generateLoginPassphrase() {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += PASSPHRASE_ALPHABET[crypto.randomInt(PASSPHRASE_ALPHABET.length)];
    groups.push(s);
  }
  return groups.join('-');
}

function generateLoginSalt() {
  return crypto.randomBytes(PROVISION_SALT_BYTES).toString('base64');
}

function isValidLoginSalt(saltB64) {
  try {
    const n = Buffer.from(String(saltB64 || ''), 'base64').length;
    return n >= 16 && n <= 32;
  } catch { return false; }
}

function deriveLoginKey(passphrase, saltB64, iterations = PROVISION_KDF_ITERATIONS) {
  return crypto.pbkdf2Sync(
    Buffer.from(normalizePassphrase(passphrase), 'utf8'),
    Buffer.from(String(saltB64), 'base64'),
    iterations, 32, 'sha256');
}

let loginState = null;   // { salt, iterations, keyBytes, kid } or null

/**
 * Install (or clear) the display login. Derives once (~0.3 s) and caches; an
 * invalid passphrase or salt CLEARS, like setDisplayKey. Returns true when set.
 */
function setDisplayLogin(passphrase, saltB64) {
  if (!isValidLoginPassphrase(passphrase) || !isValidLoginSalt(saltB64)) {
    loginState = null;
    return false;
  }
  if (loginState && loginState.salt === saltB64 && loginState.passphrase === normalizePassphrase(passphrase)) return true;
  const keyBytes = deriveLoginKey(passphrase, saltB64);
  loginState = {
    passphrase: normalizePassphrase(passphrase),
    salt: saltB64,
    iterations: PROVISION_KDF_ITERATIONS,
    keyBytes,
    kid: kidFor(keyBytes),
  };
  return true;
}

function getDisplayLoginState() {
  return loginState
    ? { configured: true, kid: loginState.kid, iterations: loginState.iterations }
    : { configured: false, kid: null, iterations: PROVISION_KDF_ITERATIONS };
}

/**
 * The sealed provisioning frame, or null when it must not go out: no login
 * configured, or no usable display key. Publishing a bundle with an EMPTY
 * display key would make every logged-in screen drop its key and fall back to
 * plaintext — an authenticated downgrade — so the whole frame fails closed.
 */
function buildProvisionFrame({ displayKey, slidesPublishToken, issuedAt } = {}) {
  if (!loginState) return null;
  const key = String(displayKey == null ? '' : displayKey).trim();
  if (!isValidDisplayKey(key)) return null;
  const token = String(slidesPublishToken == null ? '' : slidesPublishToken).trim();
  const bundle = {
    v: 1,
    displayKey: key,
    slidesPublishToken: SLIDES_TOKEN_RE.test(token) ? token : '',
    issuedAt: issuedAt || nowIso(),
  };
  const envelope = sealWith(loginState.keyBytes, loginState.kid, PROVISION_EVENT, bundle);
  if (!envelope) return null;
  return {
    v: 1,
    kdf: { name: PROVISION_KDF_NAME, iterations: loginState.iterations, salt: loginState.salt },
    envelope,
  };
}

/** Test seam: what a screen does with the frame once the passphrase is typed. */
function openProvisionForTest(passphrase, frame) {
  if (!frame || !frame.kdf || frame.kdf.name !== PROVISION_KDF_NAME) throw new Error('not a provision frame');
  const key = deriveLoginKey(passphrase, frame.kdf.salt, frame.kdf.iterations);
  if (kidFor(key) !== frame.envelope.kid) throw new Error('kid mismatch (wrong passphrase)');
  return openWithForTest(key, PROVISION_EVENT, frame.envelope);
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
  encrypting: null,      // true once the name-bearing events are being sealed
};

function getPublishState() {
  return { ...publishState };
}

// `configured` used to be set only by publish(), so it stayed FALSE from
// startup until the first event of the night. That reads as "no welcome screen
// connected" — and the whole point of the privacy banner is to warn a church
// with a screen but no key BEFORE the first child arrives, not after their
// first name has already gone out in the clear. The server calls this once at
// startup with the real client, so "configured" means configured.
function setPublisherConfigured(isConfigured) {
  publishState.configured = !!isConfigured;
}

function publish(pusher, channel, event, payload) {
  publishState.configured = !!pusher;
  if (!pusher || !payload) return Promise.resolve(false);

  // Seal the three name-bearing events. FAIL CLOSED: if a display key is
  // configured-but-unusable, or the payload somehow will not fit its fixed
  // padding, we publish NOTHING rather than falling back to plaintext. A
  // silent downgrade would be the worst outcome available — every screen would
  // keep rendering names while the operator believed the channel was sealed.
  let body = payload;
  if (ENCRYPTED_EVENTS.has(event)) {
    if (!displayKeyBytes) {
      // Not an error during rollout: with no key set the publisher is expected
      // to stay plaintext so an un-keyed screen still works (see the migration
      // order in SECURITY.md). Recorded so /health can say which mode we are in.
      publishState.encrypting = false;
    } else {
      const sealed = seal(event, payload);
      if (!sealed) {
        publishState.lastPublishOk = false;
        publishState.lastPublishAt = nowIso();
        publishState.lastEvent = event;
        publishState.lastError = `could not seal ${event} — NOT published (fail closed)`;
        console.error(`[pusher] ${publishState.lastError}`);
        return Promise.resolve(false);
      }
      publishState.encrypting = true;
      body = sealed;
    }
  }

  try {
    return Promise.resolve(pusher.trigger(channel, event, body)).then(
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
  CHECKOUT_MAX,
  POINTS_GROUPS_MAX,
  buildCheckin,
  buildRecap,
  buildCheckout,
  buildTally,
  buildBirthdays,
  buildOps,
  buildCanary,
  buildTonight,
  buildPoints,
  buildSchedule,
  buildNotice,
  buildSlidesDeck,
  buildSlidesChunks,
  slidesDeckJsonBytes,
  SLIDES_MAX,
  SLIDES_TOTAL_MAX,
  SLIDES_DECK_JSON_MAX,
  SLIDES_CHUNK_JSON_BUDGET,
  isClubNightNow,
  parseHM,
  publish,
  getPublishState,
  setPublisherConfigured,
  // Sealed envelopes — see the block above publish().
  ENVELOPE_VERSION,
  ENCRYPTED_EVENTS,
  CHECKIN_PAD,
  PAD_LADDER,
  SLIDES_PAD_LADDER,
  PUSHER_MAX_BYTES,
  paddedSize,
  isValidDisplayKey,
  generateDisplayKey,
  setDisplayKey,
  getDisplayKeyState,
  seal,
  sealWith,
  kidFor,
  openForTest,
  // Display login (device provisioning) — see the block above publish().
  PROVISION_EVENT,
  PROVISION_KDF_NAME,
  PROVISION_KDF_ITERATIONS,
  PROVISION_SALT_BYTES,
  LOGIN_PASSPHRASE_MIN,
  LOGIN_PASSPHRASE_MAX,
  SLIDES_TOKEN_RE,
  provisionChannelFor,
  normalizePassphrase,
  isValidLoginPassphrase,
  generateLoginPassphrase,
  generateLoginSalt,
  isValidLoginSalt,
  deriveLoginKey,
  setDisplayLogin,
  getDisplayLoginState,
  buildProvisionFrame,
  openProvisionForTest,
};
