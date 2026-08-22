// Club Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label as PNG via canvas.

'use strict';

// ── Process-level safety net ──────────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up, log it
// but NEVER crash the process — a live event cannot afford a dead print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

const express = require('express');
const Pusher  = require('pusher');
const events  = require('./events');
const feeds   = require('./feeds');
// The whole trust model (loopback vs LAN vs the open web, PIN handling, origin
// allowlist, bind host) lives in one pure module so it can be unit-tested.
const security = require('./security');
// @napi-rs/canvas ships prebuilt N-API binaries, so the same node_modules
// works under plain Node AND inside a packaged Electron app — the old `canvas`
// package needed an ABI-matched native build and silently broke when embedded.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { execSync } = require('child_process');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// 3456 is the port the extension, the bookmarklet and the installer all
// hardcode, so it stays the default. AWANA_PORT exists only so the test suite
// can bind somewhere else without colliding with a real install on the machine.
const PORT         = Number(process.env.AWANA_PORT) || 3456;
// `let`, not `const`: the Electron shell requires this module once and the
// require cache keeps it alive across settings changes, so an env-var-only
// printer name would be frozen at whatever it was on FIRST load — which is
// empty when the server now starts before first-time setup. setPrinterName()
// lets the shell push the newly saved printer into the live module.
let PRINTER_NAME = process.env.PRINTER_NAME || '';
function setPrinterName(name) {
  PRINTER_NAME = (name == null ? '' : String(name)).trim();
}
const SERVER_VERSION = require('./package.json').version;

// ── Writable data directory ───────────────────────────────────────────────────
// All files the server WRITES (config, clubbers.csv, history, attendance,
// event buffer) live here. Defaults to the script directory for legacy script
// installs; the Electron shell sets AWANA_DATA_DIR to its userData folder
// because a packaged app must never write inside resources/.
const DATA_DIR = process.env.AWANA_DATA_DIR || __dirname;
const CSV_FILE = path.join(DATA_DIR, 'clubbers.csv');
// The household export (GET /household/csv per docs/TWOTIMTWO.md §3.3) is the
// authoritative sibling map — its "Active Clubbers" column lists a whole
// household's children directly, unlike the roster CSV which has no
// household id at all. Persisted the same way as clubbers.csv so a restart
// mid-event doesn't silently fall back to the phone/address heuristics.
const HOUSEHOLDS_CSV_FILE = path.join(DATA_DIR, 'households.csv');

// ── Load configuration ────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = {};
try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('[config] Failed to load config.json:', e.message);
}

// Install the display key into the publisher. The three name-bearing events
// (checkin, recap, birthdays) are sealed with it so the PUBLIC Pusher channel
// carries ciphertext instead of children's first names — see the sealed-envelope
// block in events.js. With no key set the publisher stays plaintext, which is
// what makes the rollout safe in either order; /health says which mode we are in
// so "am I actually encrypted?" is answerable rather than assumed.
if (events.setDisplayKey(config.displayKey)) {
  console.log(`[realtime] Display key loaded (kid ${events.getDisplayKeyState().kid}) — names are encrypted on the channel`);
} else if (config.displayKey) {
  console.warn('[realtime] config.displayKey is INVALID — names will be published in the clear until it is fixed');
} else {
  console.warn('[realtime] No display key set — children\'s first names are published UNENCRYPTED on a public channel. Generate one in the dashboard (Realtime).');
}

// Brute-force protection for the phone PIN. Lives at module scope so the
// failure counts survive across requests but not across restarts — a restart
// mid-event must never leave a volunteer locked out.
const pinLimiter = security.createPinLimiter();

// ── Church configuration ──────────────────────────────────────────────────────
// Per-church knobs (check-in URL, club-night windows, event-bus channel) live
// in church-config.json next to this script. Baked KVBC defaults keep the
// server fully functional when the file is missing or malformed, and let a
// fork swap churches by editing one JSON file instead of source.
// Prefer a church-config.json in the data dir (survives app updates); fall
// back to the copy shipped next to this script.
const CHURCH_CONFIG_FILE = fs.existsSync(path.join(DATA_DIR, 'church-config.json'))
  ? path.join(DATA_DIR, 'church-config.json')
  : path.join(__dirname, 'church-config.json');
const CHURCH_DEFAULTS = {
  churchName: 'KVBC Church',
  subdomain: 'kvbchurch',
  checkinUrl: 'https://kvbchurch.twotimtwo.com/clubber/checkin',
  pusherChannel: 'awana-channel',
  sharesClubIds: [2, 3, 4, 5, 6],
  clubNights: [{ dow: 3, start: '17:30', end: '20:00' }],
  canaryLeadMinutes: 20,
};
let churchConfig = { ...CHURCH_DEFAULTS };
try {
  if (fs.existsSync(CHURCH_CONFIG_FILE)) {
    Object.assign(churchConfig, JSON.parse(fs.readFileSync(CHURCH_CONFIG_FILE, 'utf8')));
    console.log(`[church] Loaded church-config.json (${churchConfig.churchName})`);
  }
} catch (e) {
  console.warn('[church] Failed to load church-config.json — using baked defaults:', e.message);
}
const EVENT_CHANNEL = churchConfig.pusherChannel || 'awana-channel';

const pusher = (config.pusherAppId && config.pusherKey && config.pusherSecret)
  ? new Pusher({
      appId:   config.pusherAppId,
      key:     config.pusherKey,
      secret:  config.pusherSecret,
      cluster: config.pusherCluster || 'us2',
    })
  : null;

// Tell the event module the truth at STARTUP rather than letting it infer
// "configured" from the first publish. /health's privacy banner keys off this,
// and a church with a screen but no display key has to be warned before the
// first child checks in — not after their name has already gone out plaintext.
events.setPublisherConfigured(Boolean(pusher));

if (pusher) {
  console.log(`[pusher] Initialized with App ID: ${config.pusherAppId}`);
} else {
  console.log('[pusher] Not configured (Joyful Welcome Screen disabled)');
}

// ── Tonight's event buffer ────────────────────────────────────────────────────
// The last ~50 checkin events, persisted so a mid-event server restart doesn't
// lose the recap replay window. Only today's events survive a reload.
// "Today" for a club night is the OPERATOR'S LOCAL calendar day. The UTC day
// flips at 7pm EST / 6pm CST — the middle of a winter club night — so any
// "today" derived from toISOString() splits one physical night in two:
// attendance streaks break, tonight's stats drop the early arrivals at the
// boundary, and opening-night connect-card gating misfires. Every today/
// tonight comparison below goes through these two helpers (the same local-day
// discipline the extension's todayIsoDate() has always used).
function localDayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isOnLocalDay(isoTimestamp, localDay) {
  if (typeof isoTimestamp !== 'string') return false;
  const t = new Date(isoTimestamp);
  return !Number.isNaN(t.getTime()) && localDayISO(t) === localDay;
}

const EVENT_BUFFER_FILE = path.join(DATA_DIR, 'events-buffer.json');
const EVENT_BUFFER_MAX = 50;
let eventBuffer = [];
try {
  if (fs.existsSync(EVENT_BUFFER_FILE)) {
    const raw = JSON.parse(fs.readFileSync(EVENT_BUFFER_FILE, 'utf8'));
    const today = localDayISO();
    if (Array.isArray(raw)) {
      eventBuffer = raw.filter(e => e && typeof e.at === 'string' && isOnLocalDay(e.at, today));
      if (eventBuffer.length) console.log(`[events] Restored ${eventBuffer.length} checkin event(s) from tonight's buffer`);
    }
  }
} catch (e) { /* corrupt buffer — start fresh */ }

function pushEventToBuffer(checkinEvent) {
  eventBuffer.push(checkinEvent);
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_MAX);
  try {
    const tmp = EVENT_BUFFER_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(eventBuffer), 'utf8');
    fs.renameSync(tmp, EVENT_BUFFER_FILE);
  } catch (e) { /* persistence is best-effort */ }
}

// ── Print-failure tracking ────────────────────────────────────────────────────
// The server used to record only successes; a jammed printer was invisible
// beyond the extension's toast. Failures now land in history (ok:false), in
// this in-memory list for the dashboard, and on the event bus as an `ops`
// event (type/club/at only — never a name on Pusher).
const printFailures = [];  // { name, club, at, error } — name stays LOCAL only
const PRINT_FAILURES_MAX = 20;

function recordPrintFailure(name, club, error) {
  printFailures.unshift({ name, club: club || '', at: new Date().toISOString(), error: String(error || '').slice(0, 200) });
  if (printFailures.length > PRINT_FAILURES_MAX) printFailures.length = PRINT_FAILURES_MAX;
  events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('print-failure', club));
}

// ── Selector self-test + canary state ────────────────────────────────────────
let lastSelfTest = null;   // { ok, results, extensionVersion, at } — posted by the extension
let lastContractCanary = null; // { ok, results, extensionVersion, manual, at } — full daily sweep (#3)
// Version skew (#7): the RUNNING extension version, as the extension itself
// last reported it (every /selftest and /contract-canary post carries one).
// The app knows what it SYNCED to disk (extensionInfo.version); Chrome keeps
// running the old code until it restarts, and only the extension's own posts
// reveal which version is actually live in the browser.
let lastExtensionReport = null; // { version, at (ms) }
function recordExtensionReport(version) {
  const v = String(version || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(v)) lastExtensionReport = { version: v, at: Date.now() };
}
// The Electron shell registers a handler here to surface operator alerts as
// tray/system notifications (contract drift, and anything else that must not
// wait for someone to open the dashboard). No-op when running headless.
let opsAlertHandler = null;
function setOpsAlertHandler(fn) { opsAlertHandler = typeof fn === 'function' ? fn : null; }
function fireOpsAlert(title, body) {
  try { if (opsAlertHandler) opsAlertHandler({ title, body }); } catch (e) { /* alerts never break serving */ }
}
let lastCanary   = null;   // { at, stages } — result of the last POST /canary

// ── Label geometry (1 pt = 1/72 inch) ────────────────────────────────────────
const PAGE_W  = 4 * 72;  // 288 pt
const PAGE_H  = 2 * 72;  // 144 pt
const INSET   = 6;        // badge margin from page edge
const BX = INSET, BY = INSET;
const BW = PAGE_W - INSET * 2;   // badge width  (276 pt)
const BH = PAGE_H - INSET * 2;   // badge height (132 pt)
const CORNER = 12;

// Columns (when icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width

// ── In-memory CSV snapshot ────────────────────────────────────────────────────
// Populated at startup and refreshed on every POST /print so changes to
// clubbers.csv (e.g. added mid-event) are picked up automatically.
let clubbers = [];

// ── In-memory household snapshot ──────────────────────────────────────────────
// Populated at startup from households.csv (if synced) and replaced wholesale
// by POST /update-households. householdSiblingIndex is the authoritative
// lowercased-full-name → [sibling full names] map GET /siblings prefers.
let households = [];
let householdSiblingIndex = new Map();

// ── CSV parser ────────────────────────────────────────────────────────────────
// Parses a raw CSV string into an array of plain objects keyed by canonical
// field names.  Handles both the TwoTimTwo export (quoted fields, spaces in
// headers like "First Name") and the manual clubbers-template.csv format
// ("FirstName").  Returns [] on empty input or any parse error — never throws.

// Map every known header variation to a canonical key.
// Add new mappings here if TwoTimTwo ever renames a column.
const HEADER_MAP = {
  // canonical ← variations (all compared lowercase, spaces/underscores stripped)
  'firstname':      'FirstName',
  'first name':     'FirstName',
  'first_name':     'FirstName',
  'lastname':       'LastName',
  'last name':      'LastName',
  'last_name':      'LastName',
  'birthdate':      'Birthdate',
  'birth date':     'Birthdate',
  'birthday':       'Birthdate',
  'date of birth':  'Birthdate',
  'dob':            'Birthdate',
  'allergies':      'Allergies',
  'allergy':        'Allergies',
  'notes':          'Notes',
  'handbookgroup':  'HandbookGroup',
  'handbook group': 'HandbookGroup',
  'handbook_group': 'HandbookGroup',
  'handbook':       'HandbookGroup',
  'handbook time':  'HandbookGroup',
  'med release':      'MedRelease',
  'medrelease':       'MedRelease',
  'med_release':      'MedRelease',
  'medical release':  'MedRelease',
  // TwoTimTwo exports BOTH "Med Release?" and "Photo Release?", but which
  // one a church actually fills in varies — KVB records the MEDIA release
  // under "Med Release?" and never touches "Photo Release?". Both map to
  // their own key and noPhotoFor() flags on an explicit "no" in either.
  'media release':    'PhotoRelease',
  'mediarelease':     'PhotoRelease',
  'photo release':    'PhotoRelease',
  'photo permission': 'PhotoRelease',
  'club':           'Club',
  'group':          'Group',
  'color':          'Color',
  'grade':          'Grade',
  'gender':         'Gender',
  'clubber id':     'ClubberID',
  'clubberid':      'ClubberID',
  'inactive':       'Inactive',
  'book':           'Book',
  // Family / household identifiers used by TwoTimTwo and similar systems
  'primarycontact':  'PrimaryContact',
  'primary contact': 'PrimaryContact',
  'guardian':        'Guardian',
  'guardians':       'Guardian',
  'parent':          'Guardian',
  'parents':         'Guardian',
  // The real TwoTimTwo /clubber/csv export carries the guardians as
  // "Parent/Guardian#1" / "Parent/Guardian#2" (no household id column at all)
  // — without these mappings the family index silently degrades to
  // last-name-only grouping.
  'parent/guardian#1':  'PrimaryContact',
  'parent/guardian #1': 'PrimaryContact',
  'parent/guardian1':   'PrimaryContact',
  'parent/guardian#2':  'Guardian',
  'parent/guardian #2': 'Guardian',
  'parent/guardian2':   'Guardian',
  'householdid':     'HouseholdID',
  'household id':    'HouseholdID',
  'familyid':        'HouseholdID',
  'family id':       'HouseholdID',
  'family':          'HouseholdID',
  // GET /household/csv's "Active Clubbers" column — a comma-separated
  // "First Last" list of that household's children (docs/TWOTIMTWO.md §3.3).
  // This is what builds the authoritative sibling map.
  'active clubbers': 'ActiveClubbers',
  'activeclubbers':  'ActiveClubbers',
  'address':         'Address',
  'address1':        'Address',
  'address 1':       'Address',
  'streetaddress':   'Address',
  'street address':  'Address',
  'homeaddress':     'Address',
  'home address':    'Address',
  'primary phone':   'PrimaryPhone',
  'primaryphone':    'PrimaryPhone',
  'share balance':   'ShareBalance',
  'sharebalance':    'ShareBalance',
  'leader notes':    'LeaderNotes',
};


function normalizeHeader(raw) {
  // Trailing punctuation must be stripped: the real export names several
  // columns with a question mark ("Med Release?", "Photo Release?") which
  // otherwise never match the map.
  const key = raw.toLowerCase().replace(/[_\s]+/g, ' ').replace(/[?!.:]+$/, '').trim();
  return HEADER_MAP[key] || raw;  // keep original if no mapping found
}

function parseCSV(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    // Strip a leading UTF-8 BOM. TwoTimTwo's export carries one, and because
    // its fields are quoted the BOM lands *before* the first opening quote —
    // nextField() then takes the unquoted branch and returns `"First Name"`
    // with the quotes still attached. HEADER_MAP misses, every row loses
    // FirstName, and findClubber() matches nobody: the entire roster silently
    // degrades to basic labels (no allergies, group, birthday, or no-photo).
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    // The TwoTimTwo CSV has quoted fields that can contain newlines (e.g. Notes,
    // Emergency Contact).  We need a proper stateful parser, not a simple
    // line-by-line split.
    const rows = [];
    let headers = [];
    let headerParsed = false;
    let pos = 0;
    const len = raw.length;

    // Parse one field starting at `pos`. Returns the field value and advances
    // `pos` past the delimiter (comma or end-of-record).
    function nextField() {
      // Skip leading whitespace (but not newlines — those are record separators)
      while (pos < len && raw[pos] === ' ') pos++;

      if (pos >= len) return '';

      if (raw[pos] === '"') {
        // Quoted field — collect until closing quote
        pos++;  // skip opening quote
        let val = '';
        while (pos < len) {
          if (raw[pos] === '"') {
            if (pos + 1 < len && raw[pos + 1] === '"') {
              // Escaped quote
              val += '"';
              pos += 2;
            } else {
              // Closing quote
              pos++;  // skip closing quote
              break;
            }
          } else {
            val += raw[pos];
            pos++;
          }
        }
        // Skip any whitespace between closing quote and delimiter
        while (pos < len && raw[pos] === ' ') pos++;
        return val.trim();
      } else {
        // Unquoted field — collect until comma or newline
        let val = '';
        while (pos < len && raw[pos] !== ',' && raw[pos] !== '\n' && raw[pos] !== '\r') {
          val += raw[pos];
          pos++;
        }
        return val.trim();
      }
    }

    function parseRecord() {
      const fields = [];
      while (pos < len) {
        fields.push(nextField());
        if (pos < len && raw[pos] === ',') {
          pos++;  // skip comma, continue to next field
        } else {
          // End of record (newline or EOF)
          break;
        }
      }
      // Skip trailing newlines between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n')) pos++;
      return fields;
    }

    while (pos < len) {
      // Skip blank lines / whitespace between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n' || raw[pos] === ' ')) pos++;
      if (pos >= len) break;

      // Stop at TwoTimTwo footer lines like "Clubber Count=116" or "FILTER,VALUE"
      const restOfLine = raw.slice(pos, raw.indexOf('\n', pos) === -1 ? len : raw.indexOf('\n', pos));
      if (/^Clubber Count=/i.test(restOfLine) || /^FILTER,/i.test(restOfLine)) break;

      const fields = parseRecord();
      if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

      if (!headerParsed) {
        headers = fields.map(normalizeHeader);
        headerParsed = true;
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
      rows.push(obj);
    }

    return rows;
  } catch (e) {
    console.warn('[csv] Unexpected parse error:', e.message);
    return [];
  }
}

// ── Load clubbers from CSV ────────────────────────────────────────────────────
// Reads clubbers.csv from the same directory as this script.
// Gracefully handles every failure mode so the server always keeps running:
//   ENOENT  — file doesn't exist yet (first run, or file was deleted)
//   EBUSY   — PowerShell is currently overwriting the file mid-event
//   other   — malformed data, permissions, etc.
function loadClubbers() {
  const csvPath = CSV_FILE;
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(raw);
    if (rows.length > 0) {
      // Log every parsed column (not just the known ones) so a renamed
      // TwoTimTwo header that misses HEADER_MAP is visible in the console
      // instead of silently dropping enrichment (group, allergies, ...).
      const keys = Object.keys(rows[0]);
      console.log(`[csv] Loaded ${rows.length} clubber(s) from clubbers.csv (columns: ${keys.join(', ')})`);
      // Log a few sample names to verify parsing
      const samples = rows.slice(0, 3).map(r => `${r.FirstName} ${r.LastName}`).join(', ');
      console.log(`[csv] Sample names: ${samples}`);
    } else {
      console.log('[csv] clubbers.csv is empty or has no data rows');
    }
    return rows;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[csv] clubbers.csv not found — running without enrichment data');
    } else if (e.code === 'EBUSY') {
      // EBUSY: PowerShell may be writing this file mid-event.
      // Skip this reload; the next request will try again automatically.
      console.warn('[csv] clubbers.csv is busy (being written) — skipping reload');
    } else {
      console.warn('[csv] Failed to read/parse clubbers.csv:', e.message);
    }
    // Last-known-good fallback: a transient read failure mid-event must not
    // wipe the in-memory roster — that would silently downgrade every label
    // to "basic" (no allergies, no groups) until the file becomes readable.
    if (clubbers.length > 0) {
      console.warn(`[csv] Keeping last good roster in memory (${clubbers.length} clubber(s))`);
    }
    return clubbers;
  }
}

// ── Load households from disk ─────────────────────────────────────────────────
// Same failure-tolerance shape as loadClubbers(): a missing/busy/malformed
// file must never crash startup — it just means no authoritative household
// map yet, and GET /siblings falls back to the CSV heuristics.
function loadHouseholds() {
  try {
    const raw = fs.readFileSync(HOUSEHOLDS_CSV_FILE, 'utf8');
    const rows = parseCSV(raw);
    if (rows.length > 0) {
      console.log(`[households] Loaded ${rows.length} household(s) from households.csv`);
    }
    return rows;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[households] households.csv not found — /siblings will use CSV heuristics only');
    } else {
      console.warn('[households] Failed to read/parse households.csv:', e.message);
    }
    return households; // last-known-good, same rationale as loadClubbers()
  }
}

// ── Duplicate-print suppression ───────────────────────────────────────────────
// A cold printer plus PowerShell startup can push a print past the client's
// request timeout; the client then aborts and retries even though the first
// request is still printing (or just printed). Printing is per-child-per-
// check-in, so any /print for a name that already printed successfully within
// this window is a duplicate — acknowledge it as success without printing.
// Deliberate reprints go through POST /reprint, which is not gated.
const DUPLICATE_WINDOW_MS = 25000;
const recentPrints = new Map();  // nameKey → timestamp of last successful print

function isDuplicatePrint(nameKey) {
  const last = recentPrints.get(nameKey);
  return last !== undefined && Date.now() - last < DUPLICATE_WINDOW_MS;
}

function recordPrint(nameKey) {
  const now = Date.now();
  recentPrints.set(nameKey, now);
  // Prune expired entries so the map stays small over a whole event night
  for (const [k, t] of recentPrints) {
    if (now - t >= DUPLICATE_WINDOW_MS) recentPrints.delete(k);
  }
}

// ── Find a child in the CSV ───────────────────────────────────────────────────
// An explicit clubberId (the extension reads it off the check-in page's
// .clubber[recid] attribute) matches exactly against the export's
// "Clubber ID" column — immune to middle names, suffixes, and duplicate
// names. Name matching stays as the fallback: case-insensitive and
// whitespace-trimmed on both sides so "alice " matches "Alice".
function findClubberIn(rows, firstName, lastName, clubberId) {
  const id = String(clubberId == null ? '' : clubberId).trim();
  if (id) {
    const byId = rows.find(r => String(r.ClubberID || '').trim() === id);
    if (byId) return byId;
  }
  const fn = (firstName || '').toLowerCase().trim();
  const ln = (lastName  || '').toLowerCase().trim();
  if (!fn && !ln) return null;
  return rows.find(r =>
    (r.FirstName || '').toLowerCase().trim() === fn &&
    (r.LastName  || '').toLowerCase().trim() === ln
  ) || null;
}

function findClubber(firstName, lastName, clubberId) {
  return findClubberIn(clubbers, firstName, lastName, clubberId);
}

// ── Family index for sibling lookup ──────────────────────────────────────────
// Groups clubbers by the best available family identifier and builds a reverse
// map: lowercased full-name → array of sibling full-names. Priority:
//   HouseholdID → Primary Phone → PrimaryContact/Guardian → Address → LastName.
// Manual/template rosters that carry a real HouseholdID keep grouping on it.
// The real TwoTimTwo export has NO household id, so the primary phone is the
// strongest signal it carries; contact name comes before address so a family
// whose address is inconsistently filled across siblings still groups (matching
// the pre-phone behavior that grouped on PrimaryContact alone).
// Called on-demand by GET /siblings so it always reflects the current roster.

// A phone is only trustworthy as a family key if it isn't a placeholder or a
// shared office/ministry number typed into many rows. Reject anything with
// fewer than 3 distinct digits (0000000, 1111111, 5555555, 123-4567 repeats)
// and require a plausible length; such numbers otherwise merge dozens of
// unrelated families into one giant "sibling" group.
function usablePhoneKey(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D+/g, '');
  if (digits.length < 10 || digits.length > 15) return null; // full US/intl number
  if (new Set(digits).size < 3) return null;                 // 000..., 5555..., etc.
  return digits.slice(-10);                                  // last 10 = the line
}

function buildFamilyIndex(rows) {
  const groups = new Map(); // groupKey → [fullName, ...]

  rows.forEach(r => {
    const full = ((r.FirstName || '') + ' ' + (r.LastName || '')).trim();
    if (!full) return;
    // Pick the most specific available key (order = priority). Keys are
    // type-prefixed so a phone number can never collide with a name/address.
    const phoneKey = usablePhoneKey(r.PrimaryPhone);
    const contact = (r.PrimaryContact || r.Guardian || '').trim().toLowerCase();
    const address = (r.Address || '').trim().toLowerCase();
    const household = (r.HouseholdID || '').trim();
    const groupKey =
      household ? 'hh:' + household :
      phoneKey  ? 'ph:' + phoneKey :
      contact   ? 'pc:' + contact :
      address   ? 'ad:' + address :
      (r.LastName || '').trim() ? 'ln:' + r.LastName.trim().toLowerCase() :
      '';
    if (!groupKey) return;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(full);
  });

  // Reverse map: fullName.toLowerCase() → [sibling full-names]
  const index = new Map();
  groups.forEach(members => {
    if (members.length < 2) return; // no siblings in this group
    members.forEach(name => {
      index.set(name.toLowerCase(), members.filter(m => m !== name));
    });
  });
  return index;
}

// ── Authoritative household sibling map (from POST /update-households) ──────
// GET /household/csv's "Active Clubbers" column already IS the sibling group
// for that household — no phone/address/contact heuristics needed. Each row
// is a comma-separated "First Last" list; every name in it is a sibling of
// every other name in the same row.
function buildHouseholdSiblingIndex(rows) {
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const raw = (r && (r.ActiveClubbers || r['Active Clubbers'])) || '';
    if (!raw) return;
    const members = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (members.length < 2) return; // only child in this household — no siblings
    members.forEach(name => {
      const key = name.toLowerCase();
      const additions = members.filter(m => m.toLowerCase() !== key);
      if (!additions.length) return;
      const existing = index.get(key) || [];
      // Set-dedupe in case the same child's name is repeated across rows
      // (shouldn't happen with a clean export, but stay defensive).
      index.set(key, Array.from(new Set([...existing, ...additions])));
    });
  });
  return index;
}

// GET /siblings' resolution rule: the authoritative household map wins when
// it has an entry for this child; otherwise fall back to the CSV heuristics
// (phone/contact/address/last-name via buildFamilyIndex). Pure + exported so
// the precedence rule itself is unit-testable without booting Express.
function siblingsFor(fullName, siblingIndex, csvRows) {
  const key = String(fullName == null ? '' : fullName).toLowerCase().trim();
  if (!key) return [];
  const fromHousehold = siblingIndex && typeof siblingIndex.get === 'function' ? siblingIndex.get(key) : undefined;
  if (fromHousehold) return fromHousehold;
  return buildFamilyIndex(Array.isArray(csvRows) ? csvRows : []).get(key) || [];
}

// ── Step Up Night eligibility ─────────────────────────────────────────────────
// Step Up Night is the one Wednesday a year when kids whose age/grade puts
// them in a different club next year are recognised on their label. The
// label is inverted (black bg / white text) and the handbook-group line is
// replaced with "Stepping up to <Next Club>".

const STEP_UP_GRADUATING_GRADE = {
  spark:   2,  // last grade in Sparks
  't&t':   5,  // last grade in T&T
  trek:    8,  // last grade in Trek
  journey: 12  // last grade in Journey
};

const STEP_UP_NEXT_CLUB = {
  puggle:  'Cubbies',
  cubbie:  'Sparks',
  spark:   'T&T',
  't&t':   'Trek',
  trek:    'Journey',
  journey: 'Graduates'
};

function clubKey(clubName) {
  const n = String(clubName || '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('puggle'))  return 'puggle';
  if (n.includes('cubbie'))  return 'cubbie';
  if (n.includes('spark'))   return 'spark';
  if (n.includes('trek'))    return 'trek';
  if (n.includes('journey')) return 'journey';
  if (n.includes('t&t') || n.includes('t & t') || n === 'tnt' || n === 't t') return 't&t';
  return null;
}

function nextClubFor(clubName) {
  const k = clubKey(clubName);
  return k ? (STEP_UP_NEXT_CLUB[k] || null) : null;
}

// The handbook-group line exists to route a child to the right table during
// handbook time. Three kinds of value carry no routing information and only
// clutter the label, so they render as NO line at all:
//
//   * "all"            — TwoTimTwo's placeholder for "not in a specific group".
//                        (This rule predates this helper; it used to be pasted
//                        at four call sites.)
//   * any Puggles group — Puggles is the toddler program: no handbooks, no
//                        handbook time, nothing to route to. TwoTimTwo still
//                        assigns them a pseudo-group (literally "Puggles
//                        group"), which printed as a redundant italic line on
//                        every Puggles label.
//   * "<club> group"   — a group named after the club itself ("Sparks group",
//                        "Cubbies class") says only what the icon and club
//                        line already say. "Sparks A" or "Flight 3:16" still
//                        print — the comparison is against the WHOLE string,
//                        so anything with an extra token survives.
function effectiveHandbookGroup(rawGroup, clubName) {
  const g = String(rawGroup == null ? '' : rawGroup).trim();
  if (!g) return '';
  // Collapse to bare alphanumerics for the comparison: clubKey in this same
  // file already treats "T&T", "T & T" and "tnt" as one club, so the
  // self-named-group rule must not be defeated by ampersand spacing.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const gN = norm(g);
  if (gN === 'all') return '';
  if (clubKey(clubName) === 'puggle') return '';
  const cN = norm(clubName);
  if (cN && (gN === cN || gN === `${cN}group` || gN === `${cN}class` || gN === `${cN}room`)) return '';
  return g;
}

// (parseBirthdate lives with the birthday-week helpers further down — this
// spot briefly held a duplicate declaration that the later one shadowed.)

function parseGrade(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (t === 'k' || t.startsWith('kinder')) return 0;
  if (t.startsWith('pre')) return null;        // Pre-K isn't a school grade
  const m = t.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (isNaN(n) || n < 0 || n > 12) return null;
  return n;
}

// Cubbies cutoff: kid steps up only if their 5th birthday is on or before
// October 15 of the next Awana year start. Awana year begins in September,
// so before July we use this calendar year's cutoff; July onward we roll to
// next year so the eligibility is correct for kids checking in over summer.
function isSteppingUp(record, clubName) {
  const k = clubKey(clubName);
  if (!k) return false;
  if (k === 'puggle') return true;
  if (k === 'cubbie') {
    const bd = parseBirthdate(record && record.Birthdate);
    if (!bd) return false;
    const today = new Date();
    const cutoffYear = today.getMonth() < 6 ? today.getFullYear() : today.getFullYear() + 1;
    const cutoff = new Date(cutoffYear, 9, 15); // Oct 15
    const fifthBirthday = new Date(bd.getFullYear() + 5, bd.getMonth(), bd.getDate());
    return fifthBirthday <= cutoff;
  }
  const grade = parseGrade(record && record.Grade);
  if (grade === null) return false;
  return grade === STEP_UP_GRADUATING_GRADE[k];
}

// ── Seasonal border art (#16) ─────────────────────────────────────────────────
// Eight seasons, resolved automatically from the calendar with a dashboard
// override (config.seasonTheme: 'auto' | 'off' | a season key). The art is
// pure 1-bit-safe LINE WORK — a dash-patterned stroke of the badge outline
// plus a small top-center motif — because the v3.7.x per-club themes proved
// that color and gray fills dither to mush on thermal output.
const SEASON_KEYS = [
  'back-to-school', 'fall', 'thanksgiving', 'christmas',
  'winter', 'spring', 'easter', 'vbs-summer',
];

// Easter moves (anonymous Gregorian computus). Pinned by test: 2026-04-05.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// The calendar's season for a date. Easter (two weeks before Easter Sunday
// through the week after) outranks the underlying spring window; the fixed
// windows tile the rest of the year with no gaps.
function seasonForDate(now = new Date()) {
  const easter = easterSunday(now.getFullYear());
  const eStart = new Date(easter); eStart.setDate(eStart.getDate() - 14);
  const eEnd = new Date(easter); eEnd.setDate(eEnd.getDate() + 7);
  if (now >= eStart && now < eEnd) return 'easter';
  const md = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  if (md >= '08-15' && md <= '09-30') return 'back-to-school';
  if (md >= '10-01' && md <= '11-14') return 'fall';
  if (md >= '11-15' && md <= '11-30') return 'thanksgiving';
  if (md >= '12-01') return 'christmas';
  if (md <= '02-29') return 'winter';
  if (md <= '05-31') return 'spring';
  return 'vbs-summer';   // 06-01 .. 08-14
}

// What the label should wear tonight: '' (no art) when off, the operator's
// pinned season, or the calendar's. Resolved by CALLERS and passed into
// generateLabel as input.season — the renderer never reads config.
function currentLabelSeason(now = new Date()) {
  const cfg = String(config.seasonTheme || 'auto');
  if (cfg === 'off') return '';
  if (SEASON_KEYS.includes(cfg)) return cfg;
  return seasonForDate(now);
}

// (The per-season dashed border that traced the whole label was removed by
// operator request — the seasonal art is now the top-center motif alone.)

// A small top-center motif, pure path work at ~12pt. Drawn only when the
// centered name block leaves headroom — a crowded label keeps its ink for
// the name. (cx, top) is the motif box's top-center.
function drawSeasonMotif(ctx, season, cx, top, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  const cy = top + 6;   // motif center line
  switch (season) {
    case 'back-to-school': {   // pencil
      ctx.strokeRect(cx - 8, cy - 2.5, 12, 5);
      ctx.beginPath(); ctx.moveTo(cx + 4, cy - 2.5); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx + 4, cy + 2.5); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 4, cy - 2.5); ctx.lineTo(cx - 4, cy + 2.5); ctx.stroke();
      break;
    }
    case 'fall': {             // leaf
      ctx.beginPath(); ctx.moveTo(cx - 7, cy); ctx.quadraticCurveTo(cx, cy - 6, cx + 7, cy);
      ctx.quadraticCurveTo(cx, cy + 6, cx - 7, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.stroke();
      break;
    }
    case 'thanksgiving': {     // wheat sprig
      ctx.beginPath(); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy - 5); ctx.stroke();
      for (let j = 0; j < 3; j++) {
        const yy = cy - 4 + j * 3;
        ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx - 3.5, yy + 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, yy); ctx.lineTo(cx + 3.5, yy + 2); ctx.stroke();
      }
      break;
    }
    case 'christmas': {        // holly: two leaves + berries
      ctx.beginPath(); ctx.moveTo(cx - 1, cy); ctx.quadraticCurveTo(cx - 5, cy - 5, cx - 9, cy - 1);
      ctx.quadraticCurveTo(cx - 5, cy + 2, cx - 1, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 1, cy); ctx.quadraticCurveTo(cx + 5, cy - 5, cx + 9, cy - 1);
      ctx.quadraticCurveTo(cx + 5, cy + 2, cx + 1, cy); ctx.stroke();
      for (const dx of [-2, 0, 2]) {
        ctx.beginPath(); ctx.arc(cx + dx, cy + 3, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'winter': {           // snowflake asterisk
      for (let j = 0; j < 3; j++) {
        const a = (Math.PI / 3) * j;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(a) * 6, cy - Math.sin(a) * 6);
        ctx.lineTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
        ctx.stroke();
      }
      break;
    }
    case 'spring': {           // tulip
      ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.quadraticCurveTo(cx - 4, cy + 1, cx, cy + 1);
      ctx.quadraticCurveTo(cx + 4, cy + 1, cx + 4, cy - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx - 2, cy - 1.5); ctx.lineTo(cx, cy - 4);
      ctx.lineTo(cx + 2, cy - 1.5); ctx.lineTo(cx + 4, cy - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + 1); ctx.lineTo(cx, cy + 6); ctx.stroke();
      break;
    }
    case 'easter': {           // egg with a zigzag band
      ctx.beginPath(); ctx.ellipse(cx, cy, 4.5, 6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 4, cy);
      ctx.lineTo(cx - 2, cy - 2); ctx.lineTo(cx, cy); ctx.lineTo(cx + 2, cy - 2); ctx.lineTo(cx + 4, cy);
      ctx.stroke();
      break;
    }
    case 'vbs-summer': {       // sun
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.stroke();
      for (let j = 0; j < 8; j++) {
        const a = (Math.PI / 4) * j;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5);
        ctx.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

// ── Collectible label icons (#20) ─────────────────────────────────────────────
// A tiny path-drawn icon that changes every calendar week — same icon for
// every kid that night, twelve in the series, so a season's worth of labels
// becomes a collection. Pure line work (thermal-safe), leftmost in the
// bottom-right icon row. On by default; config.collectibleIcons === false
// turns it off.
const COLLECTIBLE_SERIES = [
  'star', 'rocket', 'crown', 'butterfly', 'kite', 'acorn',
  'music', 'lightning', 'fish', 'sailboat', 'balloon', 'snail',
];

// Which icon this week: whole weeks since the epoch, mod the series length.
// Stable for the whole calendar week (UTC), so a reprint later the same
// night — or the same week — matches the original label.
function collectibleIndexForDate(now = new Date()) {
  // Local-calendar days since epoch, so the week can only roll at LOCAL
  // midnight — the old raw-ms version rolled at Thursday 00:00 UTC, i.e.
  // Wednesday evening in US timezones, flipping the icon MID-CLUB-NIGHT and
  // breaking both stated guarantees (same icon all night, reprint matches).
  // Epoch day 0 was a Thursday; +3 moves the boundary to Monday, safely far
  // from any club night.
  const days = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return Math.floor((days + 3) / 7) % COLLECTIBLE_SERIES.length;
}

function currentCollectibleIndex(now = new Date()) {
  if (config.collectibleIcons === false) return null;
  return collectibleIndexForDate(now);
}

// Draw collectible `idx` with its center-bottom at (cx, baselineY). ~13pt of
// stroke paths, no fills except dots — nothing to dither.
function drawCollectible(ctx, idx, cx, baselineY, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const cy = baselineY - 6.5;   // icon center
  switch (COLLECTIBLE_SERIES[idx]) {
    case 'star': {
      ctx.beginPath();
      for (let j = 0; j < 10; j++) {
        const r = j % 2 === 0 ? 6 : 2.6;
        const a = -Math.PI / 2 + (Math.PI / 5) * j;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        j === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
      break;
    }
    case 'rocket': {
      ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.quadraticCurveTo(cx + 3.5, cy - 1, cx + 2.2, cy + 4);
      ctx.lineTo(cx - 2.2, cy + 4); ctx.quadraticCurveTo(cx - 3.5, cy - 1, cx, cy - 6);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 2.2, cy + 2); ctx.lineTo(cx - 4.5, cy + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 2.2, cy + 2); ctx.lineTo(cx + 4.5, cy + 5); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy - 1.5, 1.1, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'crown': {
      ctx.beginPath(); ctx.moveTo(cx - 5.5, cy + 3.5); ctx.lineTo(cx - 5.5, cy - 3);
      ctx.lineTo(cx - 2.5, cy); ctx.lineTo(cx, cy - 5); ctx.lineTo(cx + 2.5, cy);
      ctx.lineTo(cx + 5.5, cy - 3); ctx.lineTo(cx + 5.5, cy + 3.5); ctx.closePath(); ctx.stroke();
      break;
    }
    case 'butterfly': {
      ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 3.2, cy - 1.8, 2.8, 2.2, -0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 3.2, cy - 1.8, 2.8, 2.2, 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx - 2.6, cy + 2.2, 2, 1.7, 0.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 2.6, cy + 2.2, 2, 1.7, -0.4, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'kite': {
      ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 3.5, cy - 1.5); ctx.lineTo(cx, cy + 3);
      ctx.lineTo(cx - 3.5, cy - 1.5); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + 3); ctx.quadraticCurveTo(cx - 2, cy + 5, cx - 1, cy + 6.5); ctx.stroke();
      break;
    }
    case 'acorn': {
      ctx.beginPath(); ctx.arc(cx, cy - 1.5, 3.6, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 3.6, cy - 1.5); ctx.quadraticCurveTo(cx, cy + 6, cx + 3.6, cy - 1.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy - 6.5); ctx.stroke();
      break;
    }
    case 'music': {
      ctx.beginPath(); ctx.moveTo(cx + 3, cy - 5.5); ctx.lineTo(cx + 3, cy + 2.5); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + 1.2, cy + 3, 2.2, 1.6, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 3, cy - 5.5); ctx.quadraticCurveTo(cx + 6, cy - 4.5, cx + 6, cy - 2); ctx.stroke();
      break;
    }
    case 'lightning': {
      ctx.beginPath(); ctx.moveTo(cx + 1.5, cy - 6); ctx.lineTo(cx - 3, cy + 0.5); ctx.lineTo(cx - 0.5, cy + 0.5);
      ctx.lineTo(cx - 1.5, cy + 6); ctx.lineTo(cx + 3, cy - 0.5); ctx.lineTo(cx + 0.5, cy - 0.5);
      ctx.closePath(); ctx.stroke();
      break;
    }
    case 'fish': {
      ctx.beginPath(); ctx.ellipse(cx - 0.5, cy, 4, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 3.5, cy); ctx.lineTo(cx + 6, cy - 2.5); ctx.lineTo(cx + 6, cy + 2.5);
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - 2.5, cy - 0.6, 0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'sailboat': {
      ctx.beginPath(); ctx.moveTo(cx - 5, cy + 3); ctx.lineTo(cx + 5, cy + 3); ctx.lineTo(cx + 3.2, cy + 5.5);
      ctx.lineTo(cx - 3.2, cy + 5.5); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + 3); ctx.lineTo(cx, cy - 6); ctx.lineTo(cx + 4.5, cy + 1.5); ctx.closePath(); ctx.stroke();
      break;
    }
    case 'balloon': {
      ctx.beginPath(); ctx.ellipse(cx, cy - 2, 3.2, 4, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy + 2); ctx.quadraticCurveTo(cx - 1.5, cy + 4.5, cx + 0.5, cy + 6.5); ctx.stroke();
      break;
    }
    case 'snail': {
      ctx.beginPath(); ctx.arc(cx + 1, cy, 3.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + 1, cy, 1.6, 0.5, Math.PI * 1.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 2.4, cy + 2.4); ctx.quadraticCurveTo(cx - 5.5, cy + 3, cx - 5.5, cy - 1);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 5.5, cy - 1); ctx.lineTo(cx - 6.3, cy - 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 5.5, cy - 1); ctx.lineTo(cx - 4.5, cy - 3); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── Twin-safe labels (#13) ────────────────────────────────────────────────────
// When two ACTIVE roster kids share a normalized first+last name, their labels
// need something a volunteer can tell apart at arm's length. Preference order:
//   1. a middle initial, if the roster ever carries one — TwoTimTwo's real
//      /clubber/csv export (verbatim 66-column header pinned in
//      test-server-helpers.cjs and docs/TWOTIMTWO.md) has NO middle-name
//      column today, so this is opportunistic future-proofing, checked
//      against the unmapped raw columns parseCSV preserves;
//   2. the birth month ("b. Mar") — always present in practice, meaningless
//      to strangers, stable across years (unlike a grade hint).
// Returns {middleInitial, nameHint} — both '' when the name is unique, so
// the common case renders byte-identically to today.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function twinDisambiguation(record, rows) {
  const out = { middleInitial: '', nameHint: '' };
  if (!record || !Array.isArray(rows)) return out;
  const norm = (r) => (String(r.FirstName || '').trim() + ' ' + String(r.LastName || '').trim())
    .toLowerCase().replace(/\s+/g, ' ');
  const me = norm(record);
  if (me === ' ' || me === '') return out;
  const twins = rows.filter(r => r && !String(r.Inactive || '').trim() && norm(r) === me);
  if (twins.length < 2) return out;

  const middle = String(record['Middle Name'] || record.Middle || record.MiddleName || '').trim();
  if (middle) {
    out.middleInitial = middle[0].toUpperCase();
    return out;
  }
  const bd = parseBirthdate(record.Birthdate);
  if (bd) out.nameHint = 'b. ' + MONTH_ABBR[bd.getMonth()];
  return out;
}

// ── Birthday-week check ───────────────────────────────────────────────────────
// Returns true if the child's next birthday falls within the next 7 days
// (inclusive of today). Handles year-wrapping correctly: if today is Dec 30
// and the birthday is Jan 2, this returns true.
// Returns false — without throwing — for blank, null, "N/A", or any
// unparseable date string.

// Parse a roster birthdate into a Date, or null for blank/"N/A"/unparseable.
// Normalises MM/DD/YYYY → YYYY-MM-DD so Date() parses it correctly on all
// platforms (the ISO form is the only reliably portable format in Node).
function parseBirthdate(birthdateStr) {
  if (!birthdateStr || String(birthdateStr).trim() === '' || birthdateStr === 'N/A') {
    return null;
  }
  const t = String(birthdateStr).trim();
  // Build a LOCAL date from the components. The old path normalised to
  // 'YYYY-MM-DD' and string-parsed it — which JS treats as UTC MIDNIGHT, so
  // in any US timezone getMonth()/getDate() read back the PREVIOUS day: a
  // Mar 1 twin printed "b. Feb", and 1st-of-month birthdays fell on the
  // wrong side of the June–August half-birthday gate.
  let year = null, month = null, day = null;
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY (the export's format)
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (slash) {
    month = parseInt(slash[1], 10); day = parseInt(slash[2], 10); year = parseInt(slash[3], 10);
  } else if (iso) {
    year = parseInt(iso[1], 10); month = parseInt(iso[2], 10); day = parseInt(iso[3], 10);
  }
  if (year !== null) {
    const bday = new Date(year, month - 1, day);
    // Reject rollovers (2/30 → Mar 2) instead of silently shifting the date.
    return (bday.getFullYear() === year && bday.getMonth() === month - 1 && bday.getDate() === day) ? bday : null;
  }
  const bday = new Date(t);
  return isNaN(bday.getTime()) ? null : bday;
}

// True when the given month/day (0-indexed month) falls in the same ISO week
// as today. Tested in both this calendar year and the next: the old code
// rolled an already-passed birthday forward a year before comparing, so the
// cake vanished the day after the birthday even though the documented
// behavior is "the whole calendar week containing it". Checking next year as
// well keeps the Dec→Jan ISO-week wrap working (e.g. today Dec 29 in ISO
// week 1, target Jan 2).
function isWeekOfMonthDay(month, day) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const getWeekNumber = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getFullYear(), week: weekNum };
    };

    const todayWeek = getWeekNumber(today);
    for (const yr of [today.getFullYear(), today.getFullYear() + 1]) {
      // Clamp the day into the target month (Aug 31's half-birthday must be
      // the end of February, not roll into March).
      const lastDay = new Date(yr, month + 1, 0).getDate();
      const candidate = new Date(yr, month, Math.min(day, lastDay));
      const w = getWeekNumber(candidate);
      if (w.year === todayWeek.year && w.week === todayWeek.week) return true;
    }
    return false;
  } catch {
    // Any unexpected error (timezone edge case, etc.) — safe fallback
    return false;
  }
}

function isBirthdayWeek(birthdateStr) {
  const bday = parseBirthdate(birthdateStr);
  if (!bday) return false;
  return isWeekOfMonthDay(bday.getMonth(), bday.getDate());
}

// Half-birthday cake (#8): the Awana year runs roughly late August to May, so
// a June–August birthday NEVER lands on a club night — those kids watch every
// other kid get a cake and never get one. Their half-birthday, six months on,
// falls squarely inside the season and gets the same 🍰. Everyone else keeps
// exactly one cake week a year.
//
// LABEL ONLY, deliberately: the display's checkin banner and the weekly
// birthday list stay REAL birthdays (isBirthdayWeek), so nobody on stage
// wishes a January "happy birthday" to an August kid.
function isHalfBirthdayWeek(birthdateStr) {
  const bday = parseBirthdate(birthdateStr);
  if (!bday) return false;
  const m = bday.getMonth();
  if (m < 5 || m > 7) return false;   // June (5) – August (7) birthdays only
  return isWeekOfMonthDay((m + 6) % 12, bday.getDate());
}

// What the LABEL's cake icon keys on: the real birthday week, or a summer
// kid's half-birthday week.
function isCakeWeek(birthdateStr) {
  return isBirthdayWeek(birthdateStr) || isHalfBirthdayWeek(birthdateStr);
}

// ── Allergy parser ────────────────────────────────────────────────────────────
// Converts the free-text Notes/Allergies field into a compact array of short
// tokens printed on the label. Returns [] for null/blank.
//
// The real TwoTimTwo export has NO dedicated allergy column (docs/TWOTIMTWO.md
// §3.1) — Notes is regex-matched free text, which used to produce false
// positives like "loves coloring" printing a DYE icon. This parser is
// negation-aware to cut that noise, but it is DELIBERATELY BIASED TOWARD A
// FALSE POSITIVE OVER A FALSE NEGATIVE: an extra icon on a label is a minor
// annoyance, a missed real allergy is a safety incident. So a clause is only
// ever suppressed when it opens with an explicit negation cue (no / none /
// not / without / denies / n/a) — anything merely hedged, uncertain, or
// ambiguous ("possible peanut allergy") still flags.
function parseAllergies(allergiesStr) {
  if (!allergiesStr || !String(allergiesStr).trim()) return [];
  const s = String(allergiesStr);

  // Sentence/clause boundaries: newlines (Notes can be multi-line — see the
  // CSV quoting rules in docs/TWOTIMTWO.md §3.2), periods, commas, semicolons.
  const clauses = s.split(/[\n.,;]+/);

  // Only a NEGATION AT THE CLAUSE'S OWN START suppresses that clause — e.g.
  // "no known allergies" or the second half of "allergic to milk, not eggs".
  // A negation buried mid-clause ("give a snack, not candy though") must not
  // blank out an earlier real allergy mention in the same clause.
  const NEGATION_LEAD_RE = /^(no|none|not|without|denies|n[\/\-. ]?a)\b/i;

  // ...but a negation is frequently followed by the REAL allergy as an
  // exception: "no known allergies except peanuts", "none other than dairy",
  // "not allergic to nuts but is allergic to eggs". Splitting each clause on
  // these contrast markers and only ever negating the part BEFORE the marker
  // keeps those allergies. Everything after the marker is always scanned.
  // This can over-flag ("no nuts but dairy is fine" -> DAIRY), which is the
  // correct direction to err: an extra icon is harmless, a missed allergy is not.
  const EXCEPTION_SPLIT_RE = /\b(?:except(?:\s+for)?|but|however|besides|aside\s+from|other\s+than|apart\s+from)\b/i;

  const NUT_RE    = /\bpeanuts?\b|\btree.?nuts?\b|\bnuts?\b/i;
  const DAIRY_RE  = /\bdairy\b|\bmilk\b|\blactose\b/i;
  const GLUTEN_RE = /\bgluten\b|\bwheat\b/i;
  const EGG_RE    = /\beggs?\b/i;  // \b avoids matching "eggnog" as EGG
  // Tightened to a food-dye SENSE, not a bare "color/colour" (which false-
  // positived on things like "loves coloring").
  const DYE_RE    = /\bdyes?\b|\bfood\s*colou?ring\b|\bred\s*40\b|\bartificial\s+colou?r(?:ing)?\b/i;

  const found = new Set();
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) continue;

    // Split off any "except/but/other than ..." remainder. Segment 0 is the
    // only one a leading negation can suppress; every later segment names an
    // exception to that negation and is always scanned.
    const segments = clause.split(EXCEPTION_SPLIT_RE);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i].trim();
      if (!segment) continue;
      if (i === 0 && NEGATION_LEAD_RE.test(segment)) continue;

      if (NUT_RE.test(segment))    found.add('NUTS');
      if (DAIRY_RE.test(segment))  found.add('DAIRY');
      if (GLUTEN_RE.test(segment)) found.add('GLUTEN');
      if (EGG_RE.test(segment))    found.add('EGG');
      if (DYE_RE.test(segment))    found.add('DYE');
    }
  }

  // Stable, deterministic order regardless of clause order in the source text.
  const ORDER = ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'];
  return ORDER.filter(t => found.has(t));
}

// Allergen icons for the bottom-right row — icons only, no words on the label.
const ALLERGY_EMOJI = {
  'NUTS':   '\uD83E\uDD5C',  // 🥜
  'DAIRY':  '\uD83E\uDD5B',  // 🥛
  'GLUTEN': '\uD83C\uDF3E',  // 🌾
  'EGG':    '\uD83E\uDD5A',  // 🥚
  'DYE':    '\uD83D\uDCA7',  // 💧 food dye / artificial coloring sensitivity
};

// ── Med Release parser ────────────────────────────────────────────────────────
// The roster's Med Release column is y/n. Only an explicit "no" flags the
// label with a crossed-out camera (do-not-photograph) icon — blank, missing,
// or unrecognized values print nothing, so rosters without the column are
// unaffected.
function parseNoPhoto(value) {
  return /^(n|no|false|0)$/i.test(String(value == null ? '' : value).trim());
}

// The do-not-photograph flag for a roster row: an explicit "no" in EITHER
// release column flags the label. This is deliberately an OR, not a
// precedence chain. The previous rule ("PhotoRelease when the column exists,
// MedRelease only as a fallback") assumed the photo column is where photo
// consent lives — but field data proved otherwise: KVB's TwoTimTwo instance
// records the MEDIA release under "Med Release?" and leaves "Photo Release?"
// unused, and since the unused column still exists in every export, the
// precedence rule read the blank column and silently dropped the flag for
// every no-photo child. A consent flag must fail toward protection: the
// worst outcome of OR is a spurious camera icon; the worst outcome of
// precedence was photographing a child whose family said no.
// Every label/preview/reprint/dashboard path MUST derive the flag through here
// so the printed label, its reprint, and the director's no-photo list can never
// disagree for a child whose two consent answers differ.
function noPhotoFor(record) {
  if (!record) return false;
  return parseNoPhoto(record.PhotoRelease) || parseNoPhoto(record.MedRelease);
}

// ── Unique temp file path ─────────────────────────────────────────────────────
// Date.now() alone can collide when two prints land in the same millisecond
// (double-tap on the check-in screen) — one request would then delete the
// other's file mid-print. A random suffix makes names collision-proof.
function tmpFilePath(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

// ── Orphaned temp file sweep ──────────────────────────────────────────────────
// If a previous run crashed between writing a temp PNG/PS1 and unlinking it,
// the file stays behind forever. Sweep anything matching our prefixes that is
// older than an hour (never touches files a live request might still need).
// Runs once at startup; never throws.
function sweepOrphanedTempFiles() {
  try {
    const dir = os.tmpdir();
    const cutoff = Date.now() - 3600000;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/^awana-(print-)?\d+.*\.(png|ps1)$/.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch { /* vanished or locked — skip */ }
    }
    if (removed) console.log(`[cleanup] Removed ${removed} orphaned temp file(s) from previous runs`);
  } catch { /* tmpdir unreadable — non-critical */ }
}

// ── Download a remote image into a Buffer ─────────────────────────────────────
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Club icon cache ───────────────────────────────────────────────────────────
// Remote club logos are downloaded once per URL and kept in memory, so every
// print doesn't re-fetch the same PNG and a mid-event network blip doesn't
// cost the label its icon. Bounded so a misbehaving client can't grow it.
const iconCache = new Map();  // url → Buffer
const ICON_CACHE_MAX = 20;

// ── Resolve clubImageData → Buffer (or null) ──────────────────────────────────
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData) return null;
  try {
    if (clubImageData.startsWith('data:')) {
      // base64 data URL
      const b64 = clubImageData.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    if (/^https?:\/\//.test(clubImageData)) {
      if (iconCache.has(clubImageData)) return iconCache.get(clubImageData);
      // One retry — venue Wi-Fi hiccups are routine, a second attempt 400ms
      // later usually succeeds and the result is cached for the whole event.
      let buf;
      try {
        buf = await downloadImage(clubImageData);
      } catch (firstErr) {
        await new Promise(r => setTimeout(r, 400));
        buf = await downloadImage(clubImageData);
      }
      if (iconCache.size >= ICON_CACHE_MAX) {
        iconCache.delete(iconCache.keys().next().value);  // evict oldest entry
      }
      iconCache.set(clubImageData, buf);
      return buf;
    }
  } catch (e) {
    console.log(`[icon] Could not load club image: ${e.message}`);
  }
  return null;
}

// Monogram fallback for the icon panel: when the client doesn't supply a
// club logo (page layout changed, image failed to scrape), the label still
// gets a club emblem — a solid badge with the club's monogram, drawn in the
// club's font. TR (not T) for Trek so it can't be confused with T&T.
const CLUB_MONOGRAM = {
  puggle:  'P',
  cubbie:  'C',
  spark:   'S',
  't&t':   'T&T',
  trek:    'TR',
  journey: 'J',
};

// ── Club-specific font selection ──────────────────────────────────────────────
// Each Awana club gets a distinct font personality on the label.
// Fonts are standard Windows system fonts available on the target machine.
// Falls back through safe generic stacks so labels always render even if
// a specific face is missing.
function getClubFontFamily(clubName) {
  const n = (clubName || '').toLowerCase();
  if (n.includes('puggle'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('cubbie'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('spark'))                           return "'Trebuchet MS', Arial, sans-serif";
  if (n.includes('t&t') || n.includes('t & t') || n.includes('truth and training'))
                                                     return "'Arial Black', 'Arial Bold', Arial, sans-serif";
  if (n.includes('trek'))                            return "Georgia, 'Times New Roman', serif";
  if (n.includes('journey'))                         return "'Palatino Linotype', Palatino, Georgia, serif";
  return "Helvetica, Arial, sans-serif";
}

// ── Auto-size a font to fit within maxWidth (canvas version) ─────────────────
function fitFontSize(ctx, text, fontStyle, maxWidth, maxSize = 32, minSize = 18, fontFamily = 'Helvetica, Arial, sans-serif') {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${fontStyle} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
}

function truncateTextCanvas(ctx, text, font, maxWidth) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// ── Draw a rounded rectangle on canvas ───────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Generate the label as a PNG ──────────────────────────────────────────────
// Returns the path to a temporary PNG file (caller must delete it).
const DPI = 300;
const PX_W = Math.round(4 * DPI);  // 1200 px
const PX_H = Math.round(2 * DPI);  // 600 px
const SCALE = DPI / 72;            // convert pt → px

// ── Prepare a club logo for 1-bit thermal output ──────────────────────────────
// A thermal printer has exactly two tones, so the driver dithers everything
// else — and dithering destroys light colors. The real failure that motivated
// this: one church's Puggles club image on TwoTimTwo is a custom upload, a
// light-cyan wordmark. Drawn as-is, the cyan dithered to (almost) nothing and
// the printed label showed only the duckling's dark eyes and beak — a tiny
// unreadable speck floating in the icon zone.
//
// So logos are converted to what the printer can actually say:
//
//   * INK   = a pixel that is opaque enough AND far enough from white. The
//     distance test is per-channel (Chebyshev), so light-but-saturated colors
//     — cyan, yellow, pink — count as ink even though their gray luminance is
//     high. That is the whole point: luminance is exactly the measure the
//     dither uses to erase them. The threshold sits at 64 so a pale wash
//     (#d0d0d0 card backgrounds and lighter) reads as PAPER, not ink — at 40
//     a pale-gray card came back as a featureless black slab that swallowed
//     the artwork inside it.
//   * Ink renders as ONE solid color. Where the source's antialiasing lives in
//     the ALPHA channel (transparent-background PNG, the extension's capture
//     format) the edge alpha is preserved and edges stay smooth like text;
//     where the source is opaque (JPEG, PNG flattened on white) the edge is
//     hard-thresholded, which is what the 1-bit printer would do to it anyway.
//     The color follows the label's palette: black on a normal label, WHITE on
//     an inverted one — the inverted icon panel is near-black, and near-black
//     prints as black, so black ink there is an invisible logo. (Both review
//     lenses caught exactly that on the first-timer label.)
//   * The result is CROPPED to the ink's bounding box, so an asset with big
//     transparent or white margins scales by its artwork, not its canvas.
//
// White-on-dark logos survive: the dark field is ink, the white lettering
// stays white. A logo with NO ink at all (all-white, all-transparent, or
// undecodable) returns null and the caller falls back to the monogram badge —
// the icon zone never silently disappears.
//
// POST /label (the extension's Print Dialog mode) is the surface that shows
// this output before paper. GET /preview takes no image parameter, so the
// dashboard preview always renders the monogram badge.
const LOGO_INK_ALPHA = 64;        // out of 255 — below this a pixel is "air"
const LOGO_INK_WHITE_DIST = 64;   // max(255-r,255-g,255-b) at or above this is ink
const LOGO_MAX_DECODE_SIDE = 2048; // bound on the scan canvas (see sniff below for decode)

// PNG dimensions live in the IHDR chunk at a fixed offset, readable without
// decoding a single pixel. loadImage() decodes at natural size, and PNG
// compresses flat color at extreme ratios — a small buffer can decode to a
// bitmap large enough to hurt, and this runs on the check-in path. Non-PNG
// formats skip the sniff (JPEG can't reach PNG's compression ratios and the
// buffer itself is already size-capped upstream); the scan canvas below is
// bounded regardless.
function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;   // not PNG magic
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const LOGO_MAX_SOURCE_SIDE = 8192;  // refuse to DECODE anything bigger

async function prepareLogoForThermal(clubImageBuffer, { ink = [0, 0, 0] } = {}) {
  if (!clubImageBuffer) return null;
  const sniffed = Buffer.isBuffer(clubImageBuffer) ? pngDimensions(clubImageBuffer) : null;
  if (sniffed && Math.max(sniffed.width, sniffed.height) > LOGO_MAX_SOURCE_SIDE) {
    console.log(`[icon] Club image claims ${sniffed.width}x${sniffed.height}px — refusing to decode it`);
    return null;
  }
  let img;
  try {
    img = await loadImage(clubImageBuffer);
  } catch {
    return null;                   // undecodable — caller falls back to monogram
  }
  if (!img.width || !img.height) return null;

  // Scan at a bounded size regardless of what decoded. Downscaling before the
  // scan costs nothing visually — the icon zone is ~317 device px.
  const scanScale = Math.min(1, LOGO_MAX_DECODE_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scanScale));
  const h = Math.max(1, Math.round(img.height * scanScale));
  const scan = createCanvas(w, h);
  const sctx = scan.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, w, h);

  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let yPix = 0; yPix < h; yPix++) {
    for (let xPix = 0; xPix < w; xPix++) {
      const i = (yPix * w + xPix) * 4;
      const a = px[i + 3];
      const whiteDist = Math.max(255 - px[i], 255 - px[i + 1], 255 - px[i + 2]);
      if (a >= LOGO_INK_ALPHA && whiteDist >= LOGO_INK_WHITE_DIST) {
        // Ink: one solid color, original alpha (keeps antialiased edges smooth).
        px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2];
        if (xPix < minX) minX = xPix;
        if (xPix > maxX) maxX = xPix;
        if (yPix < minY) minY = yPix;
        if (yPix > maxY) maxY = yPix;
      } else {
        px[i + 3] = 0;             // air: fully transparent
      }
    }
  }
  if (maxX < 0) return null;       // no ink anywhere — monogram is the better label

  sctx.putImageData(data, 0, 0);

  // Crop to the ink plus a 1px breath so an antialiased edge is never shaved.
  const cx = Math.max(0, minX - 1);
  const cy = Math.max(0, minY - 1);
  const cw = Math.min(w, maxX + 2) - cx;
  const ch = Math.min(h, maxY + 2) - cy;
  const out = createCanvas(cw, ch);
  out.getContext('2d').drawImage(scan, cx, cy, cw, ch, 0, 0, cw, ch);
  // width/height are scan-space (what the canvas holds); sourceWidth/Height
  // undo the scan downscale so the caller's too-small gate measures the
  // artwork's TRUE resolution — otherwise identical artwork passed or failed
  // depending on how much empty canvas happened to surround it.
  return {
    canvas: out, width: cw, height: ch,
    sourceWidth: Math.round(cw / scanScale), sourceHeight: Math.round(ch / scanScale),
  };
}

// Render one 4x2in label to a PNG.
//
// ONE OPTIONS OBJECT, not fourteen positional parameters. The old signature was
// `generateLabel(firstName, lastName, clubName, clubImageBuffer, allergyTokens,
// handbookGroup, isBirthday, isVisitor, stepUp, stepUpNextClub, awanaShares,
// noPhoto, testBanner, extras)`, and reading a call site meant counting commas
// to find out whether the seventh `false` was isBirthday or stepUp. Two of the
// callers had already drifted: /reprint silently passed nothing for visitor,
// stepUp, awanaShares, goToLine and milestoneLine because history never stored
// them, and the connect card used to smuggle its greeting through
// `handbookGroup`, silently inheriting that field's 30-character truncation —
// fixed since by the first-class `greeting` field below.
//
// The conversion is byte-identical by construction — every default below
// matches the old parameter default — and the 18 golden-image baselines are the
// proof. They compare pixels, so a mis-mapped argument would show up as a diff
// rather than as a plausible-looking label.
//
// @param {object} input
async function generateLabel(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    // Loud rather than mysterious: a leftover positional caller would otherwise
    // render a label with a first name and nothing else, which prints and looks
    // almost right — the worst possible failure for a safety artifact.
    throw new TypeError('generateLabel() takes a single options object');
  }
  let {
    firstName, lastName, clubName, clubImageBuffer,
    allergyTokens = [], handbookGroup = '', isBirthday = false, isVisitor = false,
    stepUp = false, stepUpNextClub = '', awanaShares = null, noPhoto = false,
    testBanner = false, footerText = '', greeting = '', template = null,
    streakCount = null, isNewKid = false, middleInitial = '', nameHint = '', season = '',
    collectibleIndex = null, extras = {},
  } = input;
  // Coerce the text inputs before anything calls .trim() on them. A client
  // that posts `clubName: null` (explicit null defeats the default parameter)
  // would otherwise throw deep inside layout and turn a printable label into
  // a 500 + recorded print failure.
  firstName     = String(firstName == null ? '' : firstName);
  lastName      = String(lastName  == null ? '' : lastName);
  clubName      = String(clubName  == null ? '' : clubName);
  allergyTokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  handbookGroup = (handbookGroup || '').trim();
  footerText    = String(footerText == null ? '' : footerText).trim();
  // First-class greeting slot (connect cards). It renders on the same line the
  // handbook group uses, but is NOT subject to that field's 30-character cap —
  // the cap exists because a group name past 30 chars is roster noise, whereas
  // a greeting is deliberate operator copy that just needs to fit the width.
  greeting      = String(greeting == null ? '' : greeting).trim();
  // Per-club template (#1): a constrained set of layout switches, resolved by
  // the CALLER (labelTemplateFor) and passed in — the renderer never reads
  // config. Every switch defaults to "on" and the name ceiling to 48, so a
  // missing, partial, or malformed template renders byte-identically to no
  // template at all: a broken saved template degrades to the stock label,
  // it never blocks a child's print.
  const tpl = (template && typeof template === 'object' && !Array.isArray(template)) ? template : {};
  const tplOn = (key) => tpl[key] !== false;
  const tplNameMax = (() => {
    const n = Math.round(Number(tpl.nameMaxPt));
    return (Number.isFinite(n) && n >= 18 && n <= 48) ? n : 48;
  })();
  isBirthday    = !!isBirthday;
  stepUp        = !!stepUp;
  noPhoto       = !!noPhoto;
  // null / undefined / non-finite → no badge. Negative numbers are coerced
  // to nothing as well so a malformed payload doesn't print "🪙 -3".
  if (awanaShares !== null && awanaShares !== undefined) {
    const n = Number(awanaShares);
    awanaShares = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  // Streak flame (#14): same coercion discipline as awanaShares — a malformed
  // value must never print "🔥 NaN".
  if (streakCount !== null && streakCount !== undefined) {
    const n = Number(streakCount);
    streakCount = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  isNewKid = !!isNewKid;
  // Twin-safe fields (#13): a single initial and one short hint line, bounded
  // here so a malformed caller can't reshape the name block.
  middleInitial = String(middleInitial == null ? '' : middleInitial).trim().slice(0, 1).toUpperCase();
  nameHint      = String(nameHint == null ? '' : nameHint).trim().slice(0, 16);
  // Season art (#16): unknown values render as no art at all - fail open.
  season        = SEASON_KEYS.includes(season) ? season : '';
  // Collectible (#20): a valid series index or nothing.
  if (collectibleIndex !== null && collectibleIndex !== undefined) {
    const n = Number(collectibleIndex);
    collectibleIndex = (Number.isInteger(n) && n >= 0 && n < COLLECTIBLE_SERIES.length) ? n : null;
  }

  // Step-up labels are inverted (black bg, light text) and replace the
  // handbook-group line with "Stepping up to <next club>" so volunteers
  // and parents can spot graduating kids at a glance. First-timer labels
  // can borrow the same inverted palette (extras.inverted) so a visitor
  // pops out of a stack of white labels — palette only, the icon panel
  // and text lines keep their normal behavior.
  // Both palettes are thermal-first: a 1-bit printer collapses everything to
  // black or white, so every tone here is either near-black or near-white —
  // no mid-grays that would dither into speckle.
  const COLOR = (stepUp || (extras && extras.inverted)) ? {
    bg: '#000000',
    name: '#ffffff',
    last: '#e5e7eb',
    club: '#cbd5e1',
    group: '#fbbf24',                // amber draws the eye on black
    sep: '#e5e7eb',
    iconBg: '#1f2937',
    iconDivider: '#3f3f46',
    iconPlaceholder: '#d4d4d8',
    visitorBg: '#ffffff',
    visitorText: '#000000'
  } : {
    bg: '#ffffff',
    name: '#000000',
    last: '#111111',
    club: '#000000',
    group: '#333333',
    sep: '#333333',
    iconBg: '#f4f4f4',
    iconDivider: '#bbbbbb',
    iconPlaceholder: '#888888',
    visitorBg: '#000000',
    visitorText: '#ffffff'
  };

  const pngPath = tmpFilePath('awana', 'png');

  const canvas = createCanvas(PX_W, PX_H);
  const ctx = canvas.getContext('2d');

  // Scale all drawing from points to pixels
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // On step-up labels, drop the club icon entirely — the kid is leaving
  // that club, and the wider text area makes the message more obvious.
  // The icon panel shows the real club logo when the client supplied one,
  // and falls back to a monogram badge for any recognized club so the icon
  // zone never silently disappears.
  const hasLogo     = !stepUp && !!clubImageBuffer && tplOn('showIconPanel');
  const hasMonogram = !stepUp && !hasLogo && !!CLUB_MONOGRAM[clubKey(clubName)] && tplOn('showIconPanel');
  const hasIcon     = hasLogo || hasMonogram;
  const textX   = hasIcon ? TEXT_X : BX + 10;
  const textW   = hasIcon ? TEXT_W : BW - 20;

  // ── Badge border (no outline) ─────────────────────────────────────────────
  roundedRect(ctx, BX, BY, BW, BH, CORNER);

  // ── Left icon panel ───────────────────────────────────────────────────────
  // Tracked OUTSIDE the panel block: the text area below prints the club name
  // only when no real logo made it onto the label, and a supplied-but-rejected
  // logo (too small, undecodable) must count as "no logo" there too.
  let logoDrawn = false;
  if (hasIcon) {
    ctx.save();
    roundedRect(ctx, BX, BY, BW, BH, CORNER);
    ctx.clip();
    ctx.fillStyle = COLOR.iconBg;
    ctx.fillRect(BX, BY, ICON_COL_W, BH);
    ctx.restore();

    // Subtle vertical divider
    ctx.beginPath();
    ctx.moveTo(DIVIDER_X, BY + 12);
    ctx.lineTo(DIVIDER_X, BY + BH - 12);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLOR.iconDivider;
    ctx.stroke();

    // Club icon image (76×76 pt max, centred in the icon zone)
    const iconSize = 76;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    if (hasLogo) {
      // Crop to the artwork and binarize for thermal — see
      // prepareLogoForThermal. A null result (undecodable, or no ink at all)
      // falls through to the monogram badge below. Ink follows the palette:
      // on an inverted label the icon panel prints black, so the logo must be
      // white there or it vanishes into its own background.
      const inkWhite = Boolean(extras && extras.inverted);
      const logo = await prepareLogoForThermal(clubImageBuffer,
        { ink: inkWhite ? [255, 255, 255] : [0, 0, 0] });
      if (logo) {
        // The icon zone is 76pt ≈ 317 device px at 300 DPI. A logo whose
        // ARTWORK (post-crop — a small graphic on a big padded canvas no
        // longer gets credit for the padding) is much smaller than that
        // (the pre-5.5 extension captured club images at 64×64) would be
        // upscaled 4–5×, and the thermal printer then dithers the blurry
        // antialiased edges into speckle — the printed result is
        // recognisably worse than no logo at all. Below half the target
        // resolution, the solid-ink monogram badge is the better label:
        // skip the image and fall through to it.
        const targetPx = iconSize * SCALE;
        if (Math.max(logo.sourceWidth, logo.sourceHeight) >= targetPx / 2) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // Preserve aspect ratio within the 76pt square. Post-crop this is
          // the aspect of the ARTWORK — a wordmark on a padded square canvas
          // used to fit by its padding and shrink the art; now it fits by
          // the art itself.
          const aspect = logo.width / logo.height;
          let drawW = iconSize, drawH = iconSize;
          if (aspect > 1) { drawH = iconSize / aspect; }
          else { drawW = iconSize * aspect; }
          const dx = iconX + (iconSize - drawW) / 2;
          const dy = iconY + (iconSize - drawH) / 2;
          ctx.drawImage(logo.canvas, dx, dy, drawW, drawH);
          logoDrawn = true;
        } else {
          console.log(`[icon] Club artwork is ${logo.sourceWidth}x${logo.sourceHeight}px after cropping — too small for a ${Math.round(targetPx)}px icon zone, using the monogram badge instead`);
        }
      }
    }
    if (!logoDrawn) {
      // Monogram badge: solid disc + club initials in the club's own font.
      // Solid ink stays crisp on thermal output where a grayscale logo
      // placeholder would just dither away.
      const monogram = CLUB_MONOGRAM[clubKey(clubName)] || '?';
      const cx = BX + ICON_COL_W / 2;
      const cy = BY + BH / 2;
      const radius = 28;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.name;
      ctx.fill();
      const mFont = getClubFontFamily(clubName);
      const mSize = fitFontSize(ctx, monogram, 'bold', radius * 1.5, 30, 12, mFont);
      ctx.font = `bold ${mSize}px ${mFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLOR.bg;
      ctx.fillText(monogram, cx, cy + 1);
      ctx.textBaseline = 'top';  // restore default used by the text area
    }
  }

  // ── Text area ─────────────────────────────────────────────────────────────
  // On step-up labels, the handbook group line is replaced with the
  // "Stepping up to <next club>" callout — always show that line.
  const stepUpGroupText = stepUp ? ('Stepping up to ' + (stepUpNextClub || 'next club')) : '';
  const hasLast  = lastName.trim().length > 0 && tplOn('showLastName');
  // A real logo self-identifies the club, so the text line is redundant;
  // a monogram badge is only initials, so keep the club name printed too.
  // logoDrawn, not hasLogo: a supplied logo that was rejected (too small to
  // print cleanly, failed to decode) fell back to the monogram badge, and the
  // label must then carry the club name in text like any other monogram label.
  const hasClub  = clubName.trim().length > 0 && !logoDrawn && tplOn('showClubLine');
  // The step-up callout and a connect-card greeting always show — a template
  // only suppresses the roster-derived handbook-group line.
  const hasGroup = stepUp ? !!stepUpGroupText
    : (greeting.length > 0 || (handbookGroup.length > 0 && tplOn('showGroupLine')));
  const hasAllergy = allergyTokens.length > 0;
  const hasFooter = footerText.length > 0 && tplOn('showFooter');

  // Reserve room for the bottom band: right side is the coin/cake/allergy icon
  // row, left side is the goTo/milestone/footer stack. 20pt covers the icon row
  // or one text line; each additional bottom-left line stacks 13pt higher. The
  // goTo/milestone lines used to skip this reservation as "rare and short", but
  // the moment two bottom lines coexist (a connect card's schedule line over a
  // footer) the centered block sat right on top of them.
  const hasIconRowGlyphs = hasAllergy || isBirthday || awanaShares != null || noPhoto || streakCount != null || isNewKid || collectibleIndex != null;
  const bottomLineCount = ((extras && extras.goToLine) ? 1 : 0)
    + ((extras && extras.milestoneLine) ? 1 : 0)
    + (hasFooter ? 1 : 0);
  const ALLERGY_STRIP_H = Math.max(
    hasIconRowGlyphs ? 20 : 0,
    bottomLineCount > 0 ? 7 + bottomLineCount * 13 : 0
  );

  // Pick a font personality based on the child's Awana club
  const fontFamily = getClubFontFamily(clubName);

  // Twin-safe (#13): the middle initial rides the first-name line so the
  // width fit below accounts for it; the birth-month hint is its own small
  // line under the last name.
  const displayFirst = middleInitial ? `${firstName} ${middleInitial}.` : firstName;
  const hasHint = nameHint.length > 0;

  // Font sizes (in pt)
  let fs1 = fitFontSize(ctx, displayFirst, 'bold', textW, tplNameMax, 18, fontFamily);
  const fs2 = 20;
  const fs3 = 12;
  const fs4 = 10;
  const fs5 = 9;
  const GAP = 4;
  const SEP = 9;

  let blockH = fs1;
  if (hasLast)     blockH += GAP + fs2;
  if (hasHint)     blockH += 2 + fs5;
  if (hasClub)     blockH += SEP + fs3;
  if (hasGroup)    blockH += GAP + fs4;
  // Birthday no longer consumes vertical space in the centered text block —
  // it renders as a 🍰 emoji in the bottom-right corner alongside allergies.

  const usableH = BH - ALLERGY_STRIP_H;
  // Height-fit: a crowded label (name + last + club + group over a stacked
  // bottom band) shrinks the FIRST NAME rather than descending into the band —
  // blockH is linear in fs1, so the overflow maps 1:1 onto the size reduction.
  // Floor of 18 matches fitFontSize's width floor; past that, the clamp on y
  // below keeps the block on the badge and any residual crowding lands at the
  // bottom, where it degrades legibility instead of clipping the name.
  if (blockH > usableH) {
    const reduce = Math.min(blockH - usableH, fs1 - 18);
    if (reduce > 0) { fs1 -= reduce; blockH -= reduce; }
  }

  const centerY = BY + usableH / 2;
  let y = Math.max(BY + 2, centerY - blockH / 2);

  // Seasonal motif (#16): a small top-center flourish, only when the name
  // block leaves real headroom - a crowded label keeps its ink for the name.
  if (season && y >= BY + 17) {
    drawSeasonMotif(ctx, season, textX + textW / 2, BY + 3, COLOR.club);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textCenterX = textX + textW / 2;

  // ── First name ────────────────────────────────────────────────────────────
  const firstFont = `bold ${fs1}px ${fontFamily}`;
  ctx.font = firstFont;
  const safeFirst = truncateTextCanvas(ctx, displayFirst, firstFont, textW);
  ctx.fillStyle = COLOR.name;
  ctx.fillText(safeFirst, textCenterX, y);
  y += fs1;

  // ── Last name ─────────────────────────────────────────────────────────────
  if (hasLast) {
    y += GAP;
    const lastFont = `${fs2}px ${fontFamily}`;
    ctx.font = lastFont;
    const safeLast = truncateTextCanvas(ctx, lastName, lastFont, textW);
    ctx.fillStyle = COLOR.last;
    ctx.fillText(safeLast, textCenterX, y);
    y += fs2;
  }

  // ── Twin hint (#13) ───────────────────────────────────────────────────────
  // A whisper under the name — "b. Mar" — only present when two active roster
  // kids share this exact name and no middle initial could split them.
  if (hasHint) {
    y += 2;
    const hintFont = `italic ${fs5}px ${fontFamily}`;
    ctx.font = hintFont;
    ctx.fillStyle = COLOR.club;
    ctx.fillText(truncateTextCanvas(ctx, nameHint, hintFont, textW), textCenterX, y);
    y += fs5;
  }

  // ── Club name with separator ──────────────────────────────────────────────
  if (hasClub) {
    y += 4;
    // Solid 1pt rule — gradients dither to noise on thermal output
    const sepMargin = textW * 0.1;
    ctx.beginPath();
    ctx.moveTo(textX + sepMargin, y + 0.5);
    ctx.lineTo(textX + textW - sepMargin, y + 0.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.sep;
    ctx.stroke();
    y += 5;
    const clubFont = `italic bold ${fs3}px ${fontFamily}`;
    ctx.font = clubFont;
    const safeClub = truncateTextCanvas(ctx, clubName, clubFont, textW);
    ctx.fillStyle = COLOR.club;
    ctx.fillText(safeClub, textCenterX, y);
    y += fs3;
  }

  // ── Handbook group / step-up callout ──────────────────────────────────────
  if (hasGroup) {
    y += GAP;
    let groupStr = stepUp
      ? stepUpGroupText
      : greeting
        ? greeting   // width-fitted by truncateTextCanvas below, no 30-char cap
        : (handbookGroup.length > 30 ? handbookGroup.slice(0, 29) + '…' : handbookGroup);
    const groupFont = stepUp
      ? `bold ${fs4}px ${fontFamily}`
      : `italic ${fs4}px ${fontFamily}`;
    ctx.font = groupFont;
    // The bottom-right icon row is right-anchored on the same band this line
    // occupies, so a centered group ran straight under the icons — the handbook
    // group is what sends a child to the right table, so it must stay readable.
    // Reserve the icon row's width on the right and centre what's left.
    const iconCount = allergyTokens.length + (isBirthday ? 1 : 0) +
      (noPhoto ? 1 : 0) + (awanaShares != null ? 1 : 0) + (streakCount != null ? 1 : 0) +
      (isNewKid ? 1 : 0) + (collectibleIndex != null ? 1 : 0);
    const reservedRight = iconCount > 0 ? iconCount * 25 + 10 : 0;
    const groupMaxW = Math.max(40, textW - reservedRight);
    const groupCenterX = textCenterX - reservedRight / 2;
    groupStr = truncateTextCanvas(ctx, groupStr, groupFont, groupMaxW);
    ctx.fillStyle = COLOR.group;
    ctx.fillText(groupStr, groupCenterX, y);
    y += fs4;
  }

  // ── Visitor badge ─────────────────────────────────────────────────────────
  if (isVisitor && tplOn('showVisitorPill')) {
    const visitorFont = `bold ${fs5}px ${fontFamily}`;
    ctx.font = visitorFont;
    const vText = 'VISITOR';
    const vWidth = ctx.measureText(vText).width;
    const vPad = 4;
    const vX = BX + BW - vPad - vWidth - 8;
    const vY = BY + vPad;
    // Rounded pill background — invert on step-up so it stays readable
    ctx.fillStyle = COLOR.visitorBg;
    roundedRect(ctx, vX - vPad, vY - 1, vWidth + vPad * 2, fs5 + 4, 4);
    ctx.fill();
    ctx.fillStyle = COLOR.visitorText;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(vText, vX, vY + 1);
    // Reset alignment
    ctx.textAlign = 'center';
  }

  // ── Bottom-right row: coin shares · cake birthday · allergy icons ─────────
  // Icons only along the bottom edge — no words. Allergens render as emoji
  // glyphs, sized up so they stay recognizable on 1-bit thermal output.
  // Where the icon row begins (its leftmost pixel) — the bottom-left text lines
  // below truncate against THIS, not a guessed fraction of the badge, so a wide
  // allergy row and a footer can share the band without colliding. Defaults to
  // the badge's right padding edge when there is no icon row at all.
  let iconRowLeftX = BX + BW - 8;
  if (hasIconRowGlyphs) {
    const EMOJI_SIZE         = 16;
    const ALLERGY_EMOJI_SIZE = 22;
    const BDAY_EMOJI_SIZE    = 26;
    const EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    const PAD     = 6;
    const SPACING = 3;

    // Build ordered glyph list, leftmost first:
    //   coin-emoji + N (shares)  ->  cake (birthday)  ->  allergy icons
    const glyphs = [];
    if (collectibleIndex != null) {
      // Collectible of the week (#20): path-drawn, leftmost so the safety
      // icons keep their familiar right-edge positions.
      const ci = collectibleIndex;
      glyphs.push({ w: 15, draw: (x, baseY) => drawCollectible(ctx, ci, x + 7.5, baseY, COLOR.name) });
    }
    if (awanaShares != null) {
      // Coin emoji (U+1FA99) + space + ASCII digits. The font stack
      // falls back to sans-serif for the digits, no extra font wiring.
      glyphs.push({ ch: '\uD83E\uDE99 ' + awanaShares, size: EMOJI_SIZE });
    }
    if (streakCount != null) {
      // Flame + attendance streak (#14) - same coin-badge pattern.
      glyphs.push({ ch: '\uD83D\uDD25 ' + streakCount, size: EMOJI_SIZE });
    }
    if (isNewKid) {
      // Sparkle (#15): the kid's first two club weeks, so leaders learn the
      // new names fast. Subtle by design - no text, small glyph.
      glyphs.push({ ch: '\u2728', size: EMOJI_SIZE });
    }
    if (isBirthday) {
      glyphs.push({ ch: '\uD83C\uDF70', size: BDAY_EMOJI_SIZE });
    }
    allergyTokens.forEach(function(t) {
      glyphs.push({ ch: ALLERGY_EMOJI[t] || '\u26A0', size: ALLERGY_EMOJI_SIZE });
    });
    if (noPhoto) {
      // Camera emoji with a slash drawn over it — "do not photograph".
      glyphs.push({ ch: '\uD83D\uDCF7', size: ALLERGY_EMOJI_SIZE, slash: true });
    }

    // Measure each glyph under its own font so we can right-anchor the row.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let totalW = 0;
    glyphs.forEach(function(g, i) {
      if (!g.draw) {
        ctx.font = `${g.size}px ${EMOJI_FONT_STACK}`;
        g.w = ctx.measureText(g.ch).width;
      }
      totalW += g.w;
      if (i < glyphs.length - 1) totalW += SPACING;
    });

    let ex = BX + BW - PAD - totalW;
    iconRowLeftX = ex;
    const ey = BY + BH - PAD;  // shared baseline along the bottom padding line
    glyphs.forEach(function(g) {
      if (g.draw) {
        g.draw(ex, ey);
        ex += g.w + SPACING;
        return;
      }
      ctx.font = `${g.size}px ${EMOJI_FONT_STACK}`;
      ctx.fillStyle = COLOR.name;  // share digits must stay light on step-up
      ctx.fillText(g.ch, ex, ey);
      if (g.slash) {
        // Diagonal bar corner-to-corner across the glyph box
        ctx.save();
        ctx.strokeStyle = COLOR.name;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex + 1, ey + 1);
        ctx.lineTo(ex + g.w - 1, ey - g.size + 3);
        ctx.stroke();
        ctx.restore();
      }
      ex += g.w + SPACING;
    });

    // Reset text state for any subsequent drawing
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
  }

  // ── Routing / milestone lines (bottom-left, above the icon row) ──────────
  // goToLine: late check-in routing from the group schedule ("Go to: Music,
  // Room 4"). milestoneLine: attendance milestones ("10th club night!").
  // Anchored bottom-left so they never collide with the bottom-right icons.
  const extraLines = [];
  if (extras && extras.goToLine) extraLines.push({ text: String(extras.goToLine).slice(0, 48), bold: true });
  if (extras && extras.milestoneLine) extraLines.push({ text: String(extras.milestoneLine).slice(0, 48), bold: false });
  // Operator-configured footer (#8: church name, a verse, service times) —
  // pushed last so the reversed draw below puts it at the very bottom, under
  // any routing/milestone lines. Italic so it reads as branding, not routing.
  if (hasFooter) extraLines.push({ text: footerText.slice(0, 48), bold: false, italic: true });
  if (extraLines.length) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lineX = hasIcon ? DIVIDER_X + 8 : BX + 8;
    // Truncate against where the bottom-right icon row actually begins (or the
    // badge edge when there is none) rather than a guessed fraction of the
    // badge — the old flat 55% cap both wasted half the band on icon-less
    // labels and still collided under a five-allergy icon row. The 40pt floor
    // keeps at least a word visible against a pathologically wide row.
    const maxW = Math.max(40, iconRowLeftX - lineX - 4);
    let ly = BY + BH - 6;
    for (const line of extraLines.reverse()) {
      ctx.font = `${line.italic ? 'italic ' : ''}${line.bold ? 'bold ' : ''}10px ${getClubFontFamily(clubName)}`;
      ctx.fillStyle = COLOR.group;
      ctx.fillText(truncateTextCanvas(ctx, line.text, ctx.font, maxW), lineX, ly);
      ly -= 13;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
  }

  // ── TEST overlay (canary labels) ──────────────────────────────────────────
  // A bold diagonal band so a canary print can never be mistaken for a real
  // check-in label. Solid black band + white text stays crisp on 1-bit
  // thermal output.
  if (testBanner) {
    ctx.save();
    ctx.translate(PAGE_W / 2, PAGE_H / 2);
    ctx.rotate(-0.18);
    const bandW = PAGE_W * 1.2;
    const bandH = 30;
    ctx.fillStyle = COLOR.name;
    ctx.fillRect(-bandW / 2, -bandH / 2, bandW, bandH);
    ctx.font = 'bold 20px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.bg;
    ctx.fillText('TEST — NOT A CHECK-IN', 0, 1);
    ctx.restore();
    ctx.textBaseline = 'top';
  }

  // Write PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

// ── Print a PNG image silently via PowerShell System.Drawing ─────────────────
// The script is written to a temp .ps1 file and run with -File (not -Command)
// to avoid multiline quoting issues.  The image path is stored on the
// PrintDocument object itself so the PrintPage handler can load it fresh —
// this sidesteps the .NET event handler scope issue where outer-scope
// variables are not reliably accessible inside add_PrintPage scriptblocks.
function printImage(imagePath, printerName) {
  // Escape single quotes in paths/names for PowerShell single-quoted strings
  const safePath    = imagePath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$pd = New-Object System.Drawing.Printing.PrintDocument
${safePrinter ? `$pd.PrinterSettings.PrinterName = '${safePrinter}'` : ''}
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label", 400, 200)
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$pd | Add-Member -NotePropertyName LabelImagePath -NotePropertyValue '${safePath}'
$pd.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($sender.LabelImagePath)
  try { $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height) }
  finally { $img.Dispose() }
})
$pd.Print()
$pd.Dispose()
`.trim();

  const psPath = tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    // One retry on failure: transient spooler errors (printer waking from
    // sleep, USB renegotiation) routinely succeed on a second attempt. The
    // child must not be sent away label-less over a hiccup.
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
          timeout: 15000,
          windowsHide: true,
          encoding: 'utf8'
        });
        if (result) console.log('[print] PowerShell:', result.trim());
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          console.warn(`[print] Attempt ${attempt} failed (${e.message.split('\n')[0]}) — retrying in 750ms`);
          // Synchronous wait keeps the existing blocking print contract
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
        }
      }
    }
    throw lastErr;
  } finally {
    fs.unlink(psPath, () => {});
  }
}

// ── Musical printer (#11/#12) ─────────────────────────────────────────────────
// A thermal label printer is a stepper motor with a paper supply, and stepper
// pitch tracks step rate: vary the feed SPEED and the motor sings. TSPL-family
// printers (the club's Phomemo/Omezizy D450-class speaks it over USB) accept
// per-command SPEED changes, so a "tune" is a sequence of SPEED+FEED pairs sent
// as RAW bytes past the Windows driver, ending in one fast BACKFEED that
// returns the media to (near) its start — a final swoop note that also keeps
// stock use at zero-ish.
//
// Hard rules: the raw path NEVER touches normal label printing (its own temp
// file, its own PowerShell script, failures logged and swallowed), and the
// whole feature sits behind config.musicalPrinter — off by default, because
// raw bytes at an unknown printer model are a party trick, not a guarantee.
const TUNES = {
  // [speed ips, seconds] per note. Pitch tracks speed; duration is
  // feed-length/speed. Speeds stay in the D450-class's 1–6 range.
  arpeggio:    [[2, 0.18], [3, 0.18], [4, 0.18], [6, 0.28]],
  charge:      [[3, 0.14], [4, 0.14], [5, 0.14], [6, 0.22], [5, 0.14], [6, 0.30]],
  westminster: [[5, 0.22], [3, 0.22], [4, 0.22], [2, 0.34], [2, 0.22], [4, 0.22], [5, 0.22], [3, 0.34]],
};
const TUNE_NAMES = Object.keys(TUNES);
const TSPL_DPI = 203;                 // D450-class print head
const TUNE_MAX_FEED_DOTS = 400;       // hard cap ≈ 2in of forward feed

// Rotate through the three tunes by day, so club nights alternate.
function currentTuneName(now = new Date()) {
  const days = Math.floor(now.getTime() / 86400000);
  return TUNE_NAMES[days % TUNE_NAMES.length];
}

// Compile a tune to a TSPL program. Pure and exported: the byte stream is the
// unit-testable artifact, since nobody wants CI to need a singing printer.
function buildTuneTspl(tuneName) {
  const notes = TUNES[tuneName] || TUNES.arpeggio;
  const lines = [];
  let totalDots = 0;
  for (const [speed, seconds] of notes) {
    let dots = Math.max(8, Math.round(speed * TSPL_DPI * seconds));
    if (totalDots + dots > TUNE_MAX_FEED_DOTS) dots = TUNE_MAX_FEED_DOTS - totalDots;
    if (dots <= 0) break;
    lines.push(`SPEED ${speed}`);
    lines.push(`FEED ${dots}`);
    totalDots += dots;
  }
  // The return swoop: fast backfeed of everything we fed, so the label stock
  // ends (near) where it started. Printers that refuse long backfeeds just
  // creep forward a little — the operator's cue to turn the toggle off.
  lines.push('SPEED 6');
  lines.push(`BACKFEED ${totalDots}`);
  return lines.join('\r\n') + '\r\n';
}

// Send raw bytes to a named printer via winspool's RAW datatype — the escape
// hatch past the GDI driver. Same execSync/temp-file discipline as
// printImage(); the printer name is validated (isSafePrinterName) at the
// endpoint, single quotes escaped here.
function sendRawToPrinter(bytes, printerName) {
  const binPath = tmpFilePath('awana-tune', 'bin');
  fs.writeFileSync(binPath, bytes);
  const safeBin = binPath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string printer, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOA di);
  [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool WritePrinter(IntPtr h, byte[] bytes, int count, out int written);
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safeBin}')
$h = [IntPtr]::Zero
if (-not [RawPrint]::OpenPrinter('${safePrinter}', [ref]$h, [IntPtr]::Zero)) { throw 'OpenPrinter failed' }
try {
  $di = New-Object RawPrint+DOCINFOA
  $di.pDocName = 'Club Label Printer tune'
  $di.pDataType = 'RAW'
  if (-not [RawPrint]::StartDocPrinter($h, 1, [ref]$di)) { throw 'StartDocPrinter failed' }
  [RawPrint]::StartPagePrinter($h) | Out-Null
  $written = 0
  if (-not [RawPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw 'WritePrinter failed' }
  [RawPrint]::EndPagePrinter($h) | Out-Null
  [RawPrint]::EndDocPrinter($h) | Out-Null
} finally { [RawPrint]::ClosePrinter($h) | Out-Null }
`.trim();
  const psPath = tmpFilePath('awana-tune', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 15000, windowsHide: true });
  } finally {
    fs.unlink(psPath, () => {});
    fs.unlink(binPath, () => {});
  }
}

// Play a tune if (and only if) the toggle is on. Never throws: the chirp is
// garnish, and garnish must never delay or fail a label.
function playTuneIfEnabled(printerName, tuneName) {
  if (config.musicalPrinter !== true) return false;
  try {
    const name = TUNE_NAMES.includes(tuneName) ? tuneName : currentTuneName();
    sendRawToPrinter(Buffer.from(buildTuneTspl(name), 'ascii'), printerName);
    console.log(`[tune] Played '${name}' on ${printerName || 'default printer'}`);
    return true;
  } catch (e) {
    console.warn('[tune] Tune failed (non-critical):', e.message);
    return false;
  }
}

// ── Attendance ledger (#30) ───────────────────────────────────────────────────
// Print history rolls over every ~2 nights (MAX_HISTORY=200), so milestones
// need their own compact ledger: one dates[] per kid, one entry per day,
// season-scoped (Awana years start Aug 1). Written atomically like history.
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const MILESTONES = [5, 10, 25, 50];

function seasonStartISO(now = new Date()) {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

function loadAttendance() {
  try {
    if (fs.existsSync(ATTENDANCE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
      if (raw && typeof raw === 'object') return raw;
    }
  } catch (e) { console.warn('[attendance] Failed to load ledger:', e.message); }
  return {};
}

function saveAttendance(ledger) {
  try {
    const tmp = ATTENDANCE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ledger), 'utf8');
    fs.renameSync(tmp, ATTENDANCE_FILE);
  } catch (e) { console.warn('[attendance] Failed to save ledger:', e.message); }
}

// Upsert tonight for this kid. Returns:
//   seasonCount      — their night count within the current season (milestones)
//   firstEver        — tonight is the first date this ledger has EVER seen them
//                      (dates[] is never pruned, so this spans seasons)
//   priorNightExists — some kid, any kid, attended on an earlier date, i.e.
//                      the club has met before tonight on this machine
// The last two exist for the auto connect card (#10): "new face at a club
// that has met before" is what distinguishes a genuine first-timer from
// opening night / a fresh install, where EVERY kid's count is 1 and firing a
// welcome card per child would bury the printer.
//
// Keyed id-first with a one-time migration from the legacy name key, mirroring
// historyIdentityKey: two same-named kids stop merging the moment a caller
// knows who they are, and a kid's existing streak moves with them. A kid whose
// entry migrated to the id key and who later prints WITHOUT an id starts a
// fresh name entry — the failure modes there are a wrong milestone line and a
// spurious welcome card, both benign, both no worse than the name-collision
// behaviour this replaces.
function recordAttendance(firstName, lastName, clubberId = null) {
  const nameKey = `${firstName} ${lastName}`.toLowerCase().trim();
  const idRaw = clubberId == null ? '' : String(clubberId).trim();
  const idKey = idRaw ? `id:${idRaw.toLowerCase()}` : '';
  if (!nameKey && !idKey) return { seasonCount: 0, firstEver: false, priorNightExists: false };
  const today = localDayISO();
  const ledger = loadAttendance();

  let priorNightExists = false;
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    if (ds.some(d => d < today)) { priorNightExists = true; break; }
  }

  if (idKey && nameKey && ledger[nameKey]) {
    // Migrate (or merge, if tonight already saw both shapes) the legacy
    // name-keyed entry into the id key, then retire the name key.
    const legacy = ledger[nameKey];
    if (!ledger[idKey] || !Array.isArray(ledger[idKey].dates)) {
      ledger[idKey] = legacy;
    } else if (Array.isArray(legacy.dates)) {
      for (const d of legacy.dates) {
        if (!ledger[idKey].dates.includes(d)) ledger[idKey].dates.push(d);
      }
    }
    delete ledger[nameKey];
  }

  const key = idKey || nameKey;
  const entry = ledger[key] && Array.isArray(ledger[key].dates)
    ? ledger[key]
    : { name: `${firstName} ${lastName}`.trim(), dates: [] };
  if (!entry.dates.includes(today)) entry.dates.push(today);
  ledger[key] = entry;
  saveAttendance(ledger);

  // Streak (#14): consecutive CLUB NIGHTS attended, tonight included. A club
  // night is any date some kid attended — walking that union (not calendar
  // weeks) means Christmas break and cancelled weeks never break a streak;
  // only a night the club met and this kid stayed home does.
  const clubNights = new Set();
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    for (const d of ds) if (typeof d === 'string' && d <= today) clubNights.add(d);
  }
  const mine = new Set(entry.dates);
  let streak = 0;
  for (const night of [...clubNights].sort().reverse()) {
    if (mine.has(night)) streak++;
    else break;
  }

  // New-kid window (#15): tonight is within 14 days of the kid's first-ever
  // night on this ledger — their first two typical club weeks. Day-based, not
  // night-based, so a make-up event in the same fortnight doesn't extend it.
  let isNewKid = false;
  const firstNight = entry.dates.reduce((a, b) => (a && a < b ? a : b), null);
  if (firstNight) {
    const first = new Date(firstNight + 'T00:00:00');
    const now = new Date(today + 'T00:00:00');
    isNewKid = (now - first) / 86400000 < 14;
  }

  const start = seasonStartISO();
  return {
    seasonCount: entry.dates.filter(d => d >= start).length,
    firstEver: entry.dates.length === 1,
    priorNightExists,
    streak,
    isNewKid,
  };
}

function milestoneLineFor(count) {
  return MILESTONES.includes(count) ? `⭐ ${count}th club night tonight!` : '';
}

// ── Group schedule (#28) ──────────────────────────────────────────────────────
// Where each club goes first, and when — drives the "Go to:" routing line on
// late check-ins. Rows live in config.json: { club, startTime "HH:MM",
// location, room }. Grace defaults to 10 minutes past the club's start.
function scheduleRows() {
  return Array.isArray(config.schedule) ? config.schedule : [];
}

function scheduleRowFor(clubName) {
  const key = clubKey(clubName);
  if (!key) return null;
  return scheduleRows().find(r => r && clubKey(r.club) === key) || null;
}

function lateGoToLine(clubName, now = new Date()) {
  const row = scheduleRowFor(clubName);
  if (!row || !row.startTime) return '';
  const start = events.parseHM(row.startTime);
  if (start === null) return '';
  const graceMin = Number.isFinite(Number(config.lateGraceMin)) ? Number(config.lateGraceMin) : 10;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins <= start + graceMin) return '';
  const where = [row.location, row.room].filter(Boolean).join(', ');
  return where ? `Go to: ${where}` : '';
}

// Operator-configured footer (#8) — one short line (church name, a verse,
// service times) along the bottom of every label. Read from config here, at
// the call sites, and passed INTO generateLabel as input.footerText: the
// renderer stays a pure function of its argument, which is what keeps the
// golden-image suite meaningful.
function labelFooterText() {
  return String(config.labelFooter || '').trim();
}

// Connect-card greeting (#10) — operator-configurable, with the long-standing
// default. Read from config at the call site (never inside the renderer) for
// the same purity reason as labelFooterText above.
const DEFAULT_CONNECT_GREETING = "We're so glad you're here!";
function connectCardGreeting() {
  return String(config.connectCardGreeting || '').trim() || DEFAULT_CONNECT_GREETING;
}

// ── Per-club label templates (#1) ─────────────────────────────────────────────
// config.labelTemplates is a map of clubKey (or 'default') → a small object of
// layout OVERRIDES. Only deviations from the stock label are stored — a switch
// that's on and a name ceiling of 48 are the defaults, not data — which keeps
// config.json tiny and lets the default layout evolve without stale copies of
// it frozen in every install's config.
const LABEL_TEMPLATE_BOOLEANS = [
  'showIconPanel', 'showLastName', 'showClubLine',
  'showGroupLine', 'showVisitorPill', 'showFooter',
];
const LABEL_TEMPLATE_MAX_CLUBS = 12;

// One template: returns the overrides-only form, or null for a non-object.
function sanitizeLabelTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = { version: 1 };
  for (const k of LABEL_TEMPLATE_BOOLEANS) {
    if (raw[k] === false) out[k] = false;
  }
  if (raw.nameMaxPt !== undefined) {
    const n = Math.round(Number(raw.nameMaxPt));
    if (Number.isFinite(n) && n >= 18 && n < 48) out.nameMaxPt = n;
  }
  return out;
}

// The whole map. Club keys are normalized through clubKey() so 'T&T', 't & t'
// and 'tnt' can't become three diverging templates. clubKey() returns null for
// a club it doesn't recognize, so an unrecognized key is dropped here — a
// custom-named club is served by the 'default' entry instead, which is also
// how labelTemplateFor resolves it at print time.
// Returns {ok, value} or {ok:false, error}.
function sanitizeLabelTemplates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'templates must be an object keyed by club name (or "default")' };
  }
  const out = {};
  for (const rawKey of Object.keys(raw).slice(0, LABEL_TEMPLATE_MAX_CLUBS)) {
    const key = rawKey === 'default' ? 'default' : clubKey(rawKey);
    if (!key) continue;
    const t = sanitizeLabelTemplate(raw[rawKey]);
    if (!t || Object.keys(t).length <= 1) continue;   // no overrides → nothing to store
    out[key] = t;
  }
  return { ok: true, value: out };
}

// Resolve the template for one club: exact club entry, else 'default', else
// null (stock label). Type-guarded at every step — this reads persisted
// config, and a hand-edited config.json must degrade, not throw, mid-event.
function labelTemplateFor(clubName) {
  const all = config.labelTemplates;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
  const key = clubKey(clubName);
  const chosen = (key && all[key]) || all.default || null;
  return (chosen && typeof chosen === 'object' && !Array.isArray(chosen)) ? chosen : null;
}

// ── Phone check-in queue (#17b) ───────────────────────────────────────────────
// A phone on the LAN posts a check-in request; the extension (which has the
// authenticated TwoTimTwo session) long-polls for pending actions and drives
// the real check-in in the browser. The label then flows through the normal
// detection path — the phone page NEVER prints directly, so the existing
// dedup guarantees a single label. PIN-over-HTTP is LAN-trust only.
let pendingActions = [];      // { id, name, at, status, detail }
let pendingWaiters = [];      // long-poll responders
const PENDING_MAX = 100;
const PENDING_WAITERS_MAX = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;

function prunePendingActions() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  pendingActions = pendingActions.filter(a => new Date(a.at).getTime() >= cutoff).slice(-PENDING_MAX);
}

function wakePendingWaiters() {
  const waiters = pendingWaiters.splice(0);
  const pending = pendingActions.filter(a => a.status === 'pending');
  waiters.forEach(w => {
    clearTimeout(w.timer);
    try { w.res.json({ actions: pending }); } catch { /* client gone */ }
  });
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();

// ── CORS: an allowlist, not `*` ───────────────────────────────────────────────
// This used to be `app.use(cors())`, i.e. `Access-Control-Allow-Origin: *` on
// every response. Because the browser lets a page READ a response bearing that
// header, any website open in the volunteer's browser could fetch
// /stats/tonight and walk away with tonight's children plus their allergy
// tokens. The allowlist (security.isAllowedOrigin) admits only the extension,
// *.twotimtwo.com, this server's own pages, and any operator-configured extra.
//
// Two rules, both necessary:
//   • Reads  — no ACAO header for a stranger, so the browser blocks the read.
//   • Writes — a mutating request carrying a non-allowlisted Origin is refused
//     outright (403). A form POST with text/plain is never preflighted, so
//     without this a hostile tab could still WRITE (that is how a crafted name
//     reached print-history.json and then the dashboard's innerHTML).
function corsPolicy(req, res, next) {
  const origin = req.headers.origin;
  const allowed = security.isAllowedOrigin(origin, {
    port: PORT,
    extraOrigins: security.sanitizeAllowedOrigins(config.allowedOrigins),
  });

  // Vary so a proxy or the browser cache never reuses one origin's answer for
  // another origin's request.
  res.setHeader('Vary', 'Origin');

  if (origin && allowed) {
    // Echo the exact origin — never '*'. No Allow-Credentials: these endpoints
    // are authenticated by PIN (or by being loopback), never by cookie.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Awana-Pin');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    // Answer the preflight before the auth gate: a rejected preflight must look
    // like a CORS failure, not a PIN failure.
    return res.sendStatus(origin && allowed ? 204 : 403);
  }

  if (origin && !allowed && security.isMutatingMethod(req.method)) {
    console.warn(`[security] Refused ${req.method} ${req.path} from disallowed origin ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  return next();
}
app.use(corsPolicy);

// Keep the GLOBAL body limit small so a hostile or buggy tab can't push
// megabytes of JSON through a laptop that is mid-event. Exactly one route
// legitimately carries a base64 PDF (/print-pdf, where base64 inflates a 12MB
// worksheet by ~4/3), so the global parser steps aside for that single path and
// the route mounts its own larger parser. The global parser must skip it rather
// than the route "overriding" it — app-level middleware runs first, so a big
// body would otherwise be rejected here before the route is ever reached.
const PDF_UPLOAD_PATH = '/print-pdf';
const globalJson = express.json({ limit: '2mb' });
app.use((req, res, next) => {
  if (req.path === PDF_UPLOAD_PATH) return next();
  return globalJson(req, res, next);
});

// ── The auth gate ─────────────────────────────────────────────────────────────
// Mounted BEFORE express.static and before every route, so nothing — not the
// dashboard, not the roster, not /config — is reachable from the LAN without
// the PIN. Loopback callers (the extension via localhost, the dashboard, the
// Electron shell) pass through untouched, which is why this adds no friction to
// the normal single-laptop setup.
//
// LAN_PUBLIC_PATHS is the one exception: the phone page itself is the PIN entry
// form, so it must load before a PIN exists to send. It contains no roster
// data — every byte of that arrives via POST /phone/roster, which is gated.
const LAN_PUBLIC_PATHS = new Set(['/phone']);

app.use((req, res, next) => {
  if (security.isLoopbackRequest(req)) return next();
  if (LAN_PUBLIC_PATHS.has(req.path)) return next();

  const addr = (req.socket && req.socket.remoteAddress) || 'unknown';
  const pin = String(config.phonePin || '');

  // Fail CLOSED. The old phonePinOk() returned true when no PIN was set, so a
  // default install handed the whole roster to anyone on the venue network.
  if (!pin) {
    console.warn(`[security] Refused ${req.method} ${req.path} from ${addr} — no PIN is configured`);
    return res.status(403).json({ error: 'This server is not accepting network requests. Set a PIN in Settings to enable phone check-in.' });
  }

  const now = Date.now();
  const waitMs = pinLimiter.retryAfterMs(addr, now);
  if (waitMs > 0) {
    res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
    return res.status(429).json({ error: `Too many wrong PINs — try again in ${Math.ceil(waitMs / 1000)}s` });
  }

  const supplied = String(
    (req.body && req.body.pin) || req.headers['x-awana-pin'] || req.query.pin || ''
  );
  if (!supplied || !security.timingSafeStringEqual(supplied, pin)) {
    // Pass the attempted PIN through so identical repeated wrong guesses
    // (a phone retrying a stale saved PIN, Enter-mashing) count once instead
    // of accumulating toward the lockout — see createPinLimiter's dedupe.
    const rec = pinLimiter.recordFailure(addr, now, supplied);
    console.warn(`[security] Wrong/missing PIN for ${req.method} ${req.path} from ${addr} (failure ${rec.failures})`);
    return res.status(403).json({ error: 'Wrong PIN' });
  }

  pinLimiter.recordSuccess(addr);
  return next();
});

app.use(express.static(path.join(__dirname, 'public')));  // serve static files (bookmarklet.html, etc)

// Health endpoint defined below with enhanced warnings

app.get('/roster-status', (req, res) => {
  res.json({ count: clubbers.length, householdCount: households.length });
});

// Returns siblings (family members) of a given child. Prefers the
// authoritative household map (POST /update-households, GET /household/csv's
// "Active Clubbers" column) and falls back to buildFamilyIndex()'s CSV
// heuristics (HouseholdID / PrimaryContact / Guardian / Address / LastName)
// for churches that haven't synced a household export yet.
//
// An optional `clubberId` resolves the SUBJECT child exactly (via
// findClubberIn, same id TwoTimTwo puts on `.clubber[recid]`) before falling
// back to name matching, so two kids with the same name resolve correctly.
//
// Response: { siblings: ["Jane Smith", "John Smith"] }
// The extension matches returned names against DOM elements on the check-in
// page; an empty array causes it to fall back to DOM last-name detection.
app.get('/siblings', (req, res) => {
  const rawName = String(req.query.name == null ? '' : req.query.name).trim();
  const clubberId = req.query.clubberId != null ? String(req.query.clubberId).trim() : '';

  let subjectName = rawName;
  if (clubberId) {
    const record = findClubberIn(clubbers, '', '', clubberId);
    if (record) {
      const full = `${record.FirstName || ''} ${record.LastName || ''}`.trim();
      if (full) subjectName = full;
    }
  }

  if (!subjectName) return res.status(400).json({ error: 'name or clubberId query param required' });

  res.json({ siblings: siblingsFor(subjectName, householdSiblingIndex, clubbers) });
});

app.get('/printers', (req, res) => {
  try {
    const raw = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) parsed = [parsed];  // PowerShell returns bare object for single printer
    const printers = parsed.map(p => ({ name: p.Name, isWindowsDefault: !!p.Default }));
    const autoDetected = printers.length === 1 ? printers[0].name : null;
    res.json({ printers, serverDefault: PRINTER_NAME || null, autoDetected });
  } catch (err) {
    console.error('[printers] Failed to list printers:', err.message);
    res.status(500).json({ error: 'Failed to list printers', printers: [] });
  }
});

// Explicit route for bookmarklet page
app.get('/bookmarklet.html', (req, res) => {
  const bookmarkletPath = path.join(__dirname, 'public', 'bookmarklet.html');
  res.sendFile(bookmarkletPath);
});

// Serve bookmarklet JS files from project root (one level up from print-server/)
app.get('/bookmarklet.min.js', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'bookmarklet.min.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.min.js not found');
});
app.get('/bookmarklet.js', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'bookmarklet.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.js not found');
});

// ── Receive CSV from the bookmarklet (authenticated browser session) ─────────
// The bookmarklet fetches /clubber/csv from the same origin (which has the
// user's session cookies) and POSTs the raw CSV text here so the server can
// write it to clubbers.csv for enriched label data.
app.post('/update-csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required (string)' });
  }
  const csvPath = CSV_FILE;
  const tmpPath = csvPath + '.tmp';

  // Parse BEFORE writing. A sync that yields zero rows (login redirect, an
  // export format change, a truncated download) must not overwrite a roster
  // we know is good — that would blank enrichment for the rest of the night
  // and persist the damage to disk.
  const rows = parseCSV(csv);
  if (rows.length === 0 && clubbers.length > 0) {
    console.warn(`[csv] Rejected roster sync: posted CSV parsed to 0 rows — keeping the ${clubbers.length} clubber(s) already loaded`);
    return res.status(422).json({ error: 'CSV parsed to 0 rows — roster not replaced', count: clubbers.length });
  }

  try {
    // Atomic write: write to a temp file then rename over the target, so a
    // crash or concurrent reader mid-write can never observe a truncated CSV.
    fs.writeFileSync(tmpPath, csv, 'utf8');
    fs.renameSync(tmpPath, csvPath);
    clubbers = rows;
    console.log(`[csv] Updated clubbers.csv from browser (${rows.length} clubber(s))`);
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    console.error('[csv] Failed to write clubbers.csv:', e.message);
    fs.unlink(tmpPath, () => {});
    res.status(500).json({ error: 'Failed to write CSV' });
  }
});

// ── Receive the household export (authoritative sibling map) ────────────────
// GET /household/csv, posted the same way the roster CSV is: the bookmarklet
// fetches it same-origin (session cookies) and POSTs the raw text here. Its
// "Active Clubbers" column IS the sibling group for that household directly —
// no phone/address heuristics needed once this is loaded.
app.post('/update-households', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required (string)' });
  }

  // Same defensive rule as /update-csv: a sync that yields zero households
  // (login redirect, export format change, truncated download) must not wipe
  // out a household map we know is good.
  const rows = parseCSV(csv);
  if (rows.length === 0 && households.length > 0) {
    console.warn(`[households] Rejected household sync: posted CSV parsed to 0 rows — keeping the ${households.length} household(s) already loaded`);
    return res.status(422).json({ error: 'CSV parsed to 0 rows — household map not replaced', count: households.length });
  }

  const csvPath = HOUSEHOLDS_CSV_FILE;
  const tmpPath = csvPath + '.tmp';
  try {
    // Atomic write, same rationale as clubbers.csv.
    fs.writeFileSync(tmpPath, csv, 'utf8');
    fs.renameSync(tmpPath, csvPath);
    households = rows;
    householdSiblingIndex = buildHouseholdSiblingIndex(rows);
    console.log(`[households] Updated households.csv from browser (${rows.length} household(s))`);
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    console.error('[households] Failed to write households.csv:', e.message);
    fs.unlink(tmpPath, () => {});
    res.status(500).json({ error: 'Failed to write households CSV' });
  }
});

// ── Label generation (returns PNG, no printing) ──────────────────────────────
// Same enrichment pipeline as /print but streams the PNG back to the caller.
// Used by the "Print Dialog" mode so both paths render the same label.
app.post('/label', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    clubImageData = null,
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName, clubberId);

  let allergyTokens, handbookGroup, birthday, noPhoto;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    noPhoto = noPhotoFor(record);
    // Same roster fill (and same ordering) as /print: the group is judged
    // against the club that actually prints, so a club-less request for a
    // Puggles kid still drops the "Puggles group" pseudo-group. Review caught
    // this path diverging from /print.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  } else {
    allergyTokens = [];
    handbookGroup = '';
    birthday = false;
    noPhoto = false;
  }

  // Step Up Night eligibility — only kicks in when the client says it's
  // step-up night AND the kid is in a graduating cohort.
  const stepUp = !!stepUpNight && isSteppingUp(record, effectiveClubName);
  const stepUpNextClub = stepUp ? (nextClubFor(effectiveClubName) || '') : '';

  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    // Same extras /print builds, so the label a volunteer sees in Print Dialog
    // mode (and any preview) matches what auto-print produces. Without this a
    // first-timer's label silently lost its inverted palette on this path.
    // milestoneLine is deliberately NOT computed here: it comes from recording
    // attendance, and a preview/dialog render must not record a check-in.
    const labelExtras = {};
    const labelGoTo = lateGoToLine(effectiveClubName);
    if (labelGoTo) labelExtras.goToLine = labelGoTo;
    if (visitor && config.firstTimerInverted !== false) labelExtras.inverted = true;

    const twin = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: birthday, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      footerText: labelFooterText(),
      season: currentLabelSeason(),
      collectibleIndex: currentCollectibleIndex(),
      template: labelTemplateFor(effectiveClubName),
      extras: labelExtras,
    });
    fs.unlink(result.pngPath, () => {});
    res.set('Content-Type', 'image/png');
    res.send(result.buffer);
  } catch (err) {
    console.error('[label] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/print', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    clubImageData = null,
    printerName   = '',
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null,
    demo          = false
  } = req.body || {};

  // ── Demo / training mode ────────────────────────────────────────────────────
  // A demo check-in prints a REAL label (so a volunteer sees the actual output)
  // carrying the same diagonal TEST band /canary uses, and touches nothing else.
  // Every persistent side effect below is skipped, because each one causes real
  // damage during training:
  //   • addHistoryEntry   → print-history.json feeds /checkin-csv-export, which
  //                         is imported BACK INTO TwoTimTwo. Fake kids would be
  //                         recorded as having attended.
  //   • recordAttendance  → the season ledger is permanent; a padded count makes
  //                         real milestone lines ("10th club night!") wrong for
  //                         the rest of the year.
  //   • publish + buffer  → fake children celebrated by name on the lobby TV.
  //   • publishTally      → inflates tonight's counts on every screen.
  // This is the same set /canary already skips; demo mode generalises it to an
  // arbitrary name and club.
  const isDemo = demo === true || demo === 'true' || isRehearsalActive();

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : PRINTER_NAME;

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  // Duplicate check-in retry (client timeout/retry, double-tap, overlapping
  // detection paths) — the label already printed, so just acknowledge it.
  // Keyed on the clubber id when the client knows it: a name-only key means two
  // children who share a name and check in within the window collide, and the
  // second is silently reported as a duplicate and never printed. Falls back to
  // the name for walk-ins and older extensions that send no id.
  const dupKey = (clubberId ? `id:${String(clubberId).trim()}` : `${firstName} ${lastName}`)
    .toLowerCase().trim();
  // Demo mode skips the duplicate window: a trainer demonstrating the same
  // child twice in a row is the normal case, not a double-tap to suppress.
  if (!isDemo && isDuplicatePrint(dupKey)) {
    console.log(`[print] '${firstName} ${lastName}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }

  // Reload CSV on every request so mid-event additions are always picked up.
  // If the file is locked or missing, loadClubbers() returns [] and logs a
  // warning — this request continues with a basic label.
  clubbers = loadClubbers();

  // Attempt to enrich the label with data from the CSV
  const record = findClubber(firstName, lastName, clubberId);

  let allergyTokens, handbookGroup, birthday, cakeWeek, noPhoto;
  let effectiveClubName = clubName;
  if (record) {
    // TwoTimTwo CSV has "Notes" instead of a dedicated "Allergies" column.
    // Check Allergies first (manual CSV), fall back to Notes (TwoTimTwo).
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday      = isBirthdayWeek(record.Birthdate);   // real — feeds the display event
    cakeWeek      = isCakeWeek(record.Birthdate);       // label icon: real or half-birthday
    noPhoto       = noPhotoFor(record);
    // Detection paths that never saw the kid's page row (checkin-report
    // polling on a freshly loaded station) send no club — fill it from the
    // roster so the label isn't club-less. Icon falls back to the monogram.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    // After the roster fill, so the group is judged against the club that
    // actually prints — a club-less POST for a Puggles kid must still drop
    // the "Puggles group" pseudo-group.
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
    console.log(`[csv] Enriched: ${firstName} ${lastName} | group: ${handbookGroup || '(none)'} | allergies: ${allergyTokens.join(', ') || '(none)'} | birthday: ${birthday}${noPhoto ? ' | NO PHOTO' : ''}`);
  } else {
    // Child not in CSV (new visitor, typo, or CSV unavailable) — print a basic
    // label using only the data from the POST request. No crash, no skip.
    allergyTokens = [];
    handbookGroup = '';
    birthday      = false;
    cakeWeek      = false;
    noPhoto       = false;
    if (firstName || lastName) {
      console.log(`[csv] '${firstName} ${lastName}' not found in CSV — printing basic label`);
    }
  }

  // Step Up Night: only honour the client's flag if the kid is actually in
  // a graduating cohort (puggle = always, cubbie = 5 by Oct 15, others =
  // graduating grade). All other kids print a normal label tonight.
  const stepUp = !!stepUpNight && isSteppingUp(record, effectiveClubName);
  const stepUpNextClub = stepUp ? (nextClubFor(effectiveClubName) || '') : '';
  if (stepUp) {
    console.log(`[print] ${firstName} ${lastName} stepping up: ${effectiveClubName} → ${stepUpNextClub}`);
  }
  if (awanaShares != null) {
    console.log(`[print] ${firstName} ${lastName} shares badge: ${awanaShares}`);
  }
  console.log(`[print] ${firstName} ${lastName} | ${handbookGroup || effectiveClubName || '—'} | printer: ${effectivePrinter || 'default'}`);

  // Wave 2 extras: late-arrival routing from the group schedule (#28),
  // attendance milestones (#30), and the inverted first-timer palette (#27).
  const extras = {};
  const goTo = lateGoToLine(effectiveClubName);
  if (goTo) extras.goToLine = goTo;
  if (visitor && config.firstTimerInverted !== false) extras.inverted = true;

  let pngPath = null;
  let connectPngPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);

    // Attendance is recorded before rendering so the milestone prints on
    // the very night it's earned. Never blocks the label on a ledger error.
    // Skipped for demo prints — the ledger is permanent, and padding it would
    // corrupt real milestone lines for the rest of the season.
    let milestoneLine = '';
    let autoFirstTimer = false;
    let streakCount = null;
    let newKid = false;
    let welcomeBack = false;
    let milestoneCount = null;
    if (!isDemo) {
      try {
        const att = recordAttendance(firstName, lastName, clubberId);
        milestoneLine = milestoneLineFor(att.seasonCount);
        // Streak flame (#14): earns its ink at six consecutive club nights.
        if (att.streak >= 6) streakCount = att.streak;
        // New-kid sparkle (#15): the first two club weeks.
        if (att.isNewKid) newKid = true;
        // Auto connect card (#10): a new face at a club that has met before.
        // Both halves matter — firstEver alone fires for EVERY kid on opening
        // night (and on a fresh install), because everyone's ledger starts at
        // one. This is deliberately "first time on this machine's ledger", not
        // "first time ever at church" — the ledger is the only memory we have.
        autoFirstTimer = !!config.connectCardAutoFirstTimer && att.firstEver && att.priorNightExists;
        // Welcome back (#9): a RETURNING kid's first night of the season -
        // firstEver kids get the first-timer treatment instead, never both.
        welcomeBack = !att.firstEver && att.seasonCount === 1;
        // Milestone wall (#10): the display celebrates the same nights the
        // label's milestone line marks (5/10/25/50).
        if (milestoneLine) milestoneCount = att.seasonCount;
      } catch { /* ledger trouble must not stop the print */ }
    }
    if (milestoneLine) extras.milestoneLine = milestoneLine;
    // The operator's explicit visitor flag and the ledger heuristic converge
    // here for the connect card and the display's welcome treatment. The
    // label's inverted palette deliberately stays on the EXPLICIT flag only:
    // a heuristic misfire that prints one extra welcome card is shrugged off,
    // one that turns a regular kid's label black tells every volunteer to
    // welcome the wrong child.
    const isFirstTimerTonight = !!visitor || autoFirstTimer;

    const twin = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: cakeWeek, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto, streakCount, isNewKid: newKid,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      testBanner: isDemo,   // a demo label is visibly marked
      footerText: labelFooterText(),
      season: currentLabelSeason(),
      collectibleIndex: currentCollectibleIndex(),
      template: labelTemplateFor(effectiveClubName),
      extras,
    });
    pngPath = result.pngPath;

    printImage(pngPath, effectivePrinter);
    if (!isDemo) recordPrint(dupKey);

    // Connect card (#27/#10): first-time families optionally get a second
    // label pointing them to the club's time and place — triggered by the
    // operator's explicit visitor flag, or (when enabled) by the attendance
    // ledger spotting a first-ever check-in. Failure here never fails the
    // check-in — the main label already printed. Must stay a SAME-REQUEST
    // second printImage: a separate POST would die in the 25s dedup window.
    // The explicit visitor flag always fires (an operator re-flagging after a
    // lost card is deliberate); the AUTO path fires once per kid per night —
    // a re-print past the 25s dedup window (lost label, roster fix, a second
    // station) must not hand the family a second welcome card, and firstEver
    // alone can't see that because tonight is still the kid's only ledger date.
    let shouldConnectCard = false;
    if (config.connectCard) {
      if (visitor) {
        shouldConnectCard = true;
      } else if (autoFirstTimer) {
        const todayIso = localDayISO();
        shouldConnectCard = !loadHistory().some(e => e && e.isConnectCard && e.success !== false
          && isOnLocalDay(e.timestamp, todayIso)
          && historyRowMatches(e, firstName, lastName, clubberId));
      }
    }
    if (shouldConnectCard) {
      try {
        const row = scheduleRowFor(effectiveClubName);
        const where = row ? [row.startTime, row.location, row.room].filter(Boolean).join(' · ') : '';
        const card = await generateLabel({
          firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
          greeting: connectCardGreeting(),
          isVisitor: true,
          testBanner: isDemo,   // a demo card must be as visibly fake as its label
          footerText: labelFooterText(),
          season: currentLabelSeason(),
          collectibleIndex: currentCollectibleIndex(),
          extras: where ? { goToLine: where } : {},
        });
        connectPngPath = card.pngPath;
        printImage(connectPngPath, effectivePrinter);
        console.log(`[print] Connect card printed for ${firstName} ${lastName}${autoFirstTimer && !visitor ? ' (auto: first-ever check-in)' : ''}`);
        // Recorded like an award slip: visible in the dashboard's history,
        // excluded from everything that counts check-ins.
        if (!isDemo) {
          addHistoryEntry({
            firstName, lastName, clubName: effectiveClubName, clubImageData,
            printer: effectivePrinter, success: true, isConnectCard: true, clubberId,
          });
        }
      } catch (e) {
        console.warn('[print] Connect card failed (non-critical):', e.message);
      }
    }

    if (isDemo) {
      // The label printed and nothing else happened: no broadcast, no history,
      // no tally, no ledger. Deliberately logged so a demo run is obvious when
      // reading the console after a training session.
      console.log(`[demo] Printed a TEST label for '${firstName} ${lastName}' (${effectiveClubName || 'no club'}) — nothing recorded or broadcast`);
      res.json({ success: true, demo: true });
    } else {
      // Event bus: checkin (v2 — id + at for replay dedup), buffered for recap,
      // plus a fresh tally so displays update within seconds of the check-in.
      const checkinEvent = events.buildCheckin({
        firstName, club: effectiveClubName, isBirthday: !!birthday, isFirstTimer: isFirstTimerTonight,
        welcomeBack, milestone: milestoneCount,
      });
      events.publish(pusher, EVENT_CHANNEL, 'checkin', checkinEvent);
      pushEventToBuffer(checkinEvent);

      // Log to print history
      addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: true, visitor: !!visitor, clubberId
      });

      publishTally();

      res.json({ success: true });
    }
  } catch (err) {
    // Log the error but keep the server alive — the next check-in must still work.
    // A jammed printer or corrupted PDF is not a reason to bring down the server.
    console.error('[print] Error:', err.message);
    // A failed DEMO print is a training problem, not an operational one: it must
    // not appear in the history the dashboard shows, and must not raise an `ops`
    // print-failure event that makes the church think a real label was lost.
    if (!isDemo) {
      addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: false, visitor: !!visitor, clubberId
      });
      recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    }
    res.status(500).json({ error: err.message, ...(isDemo ? { demo: true } : {}) });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
    if (connectPngPath) fs.unlink(connectPngPath, () => {});
  }
});

// ── Print history ────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(DATA_DIR, 'print-history.json');
const MAX_HISTORY = 200;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      // MAX_HISTORY caps the row COUNT; this caps the AGE. Without it a church
      // that prints a handful of labels a week accumulated children's names and
      // check-in times indefinitely. Applied on read as well as write so an
      // existing over-long file shrinks on the next run.
      return security.pruneHistoryByAge(raw, config.historyRetentionDays, Date.now());
    }
  } catch (e) {
    console.warn('[history] Failed to load print history:', e.message);
  }
  return [];
}

function saveHistory(entries) {
  try {
    // Atomic write — a crash mid-save must not corrupt the history JSON,
    // which would break /history and reprints until manually deleted.
    const tmpPath = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmpPath, HISTORY_FILE);
  } catch (e) {
    console.warn('[history] Failed to save print history:', e.message);
  }
}

// Does a history row refer to this child?
//
// Identity is id-first with a name fallback, because rows written before the
// clubberId field existed have none — and a mid-season upgrade must not make
// every earlier check-in unrecognisable. The rules, in order:
//   1. Both sides know an id → the ids decide, and a mismatch is a DIFFERENT
//      child even when the names are identical. This is the whole point.
//   2. Either side lacks an id → fall back to the lowercased full name, which
//      is exactly the old behaviour.
// Mirrors the extension's identityKey()/migrateLegacyKey() pair, which solved
// this on its side (roadmap R-4) while the server never followed.
function historyRowMatches(row, firstName, lastName, clubberId) {
  if (!row) return false;
  const rowId = row.clubberId != null ? String(row.clubberId).trim() : '';
  const wantId = clubberId != null ? String(clubberId).trim() : '';
  if (rowId && wantId) return rowId === wantId;
  const rowName = `${row.firstName || ''} ${row.lastName || ''}`.toLowerCase().trim();
  const wantName = `${firstName || ''} ${lastName || ''}`.toLowerCase().trim();
  return !!rowName && rowName === wantName;
}

// The dedup key for "one row per child" aggregations. Prefers the id so two
// same-named children stay two children; falls back to the name for older rows.
function historyIdentityKey(row) {
  const id = row && row.clubberId != null ? String(row.clubberId).trim() : '';
  if (id) return `id:${id}`;
  return `name:${`${(row && row.firstName) || ''} ${(row && row.lastName) || ''}`.toLowerCase().trim()}`;
}

// Same identity key, computed from a checkin_report entry ({ clubberId, name,
// club } — content.js's fetchCheckinReport() shape) instead of a history row,
// so the two can be compared directly. Whitespace is collapsed (not just
// trimmed): the report's name sits between two links in TwoTimTwo's own
// markup and can come back with padding or a line break inside it, and a
// history row never does, so leaving it uncollapsed would make an
// already-checked-in child look "missing" from the report on a whitespace
// technicality — exactly the false-undo this feature must not cause.
function reportEntryIdentityKey(entry) {
  const id = entry && entry.clubberId != null ? String(entry.clubberId).trim() : '';
  if (id) return `id:${id}`;
  const name = String((entry && entry.name) || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `name:${name}`;
}

// R-1's /clubber/checkin_report is already the authoritative "who's checked in
// tonight" list (content.js has polled it every ~60s since v5.2 to catch
// missed check-ins). This is the other direction it never covered: an UNDO on
// TwoTimTwo — a child removed from the roster after having been checked in —
// is invisible to both the roster-diff detector and to print-history, which
// has no way to learn a print it already recorded got undone. Reusing the same
// report for this means no second scrape, no new event type, no parallel
// pipeline — only a diff against history the server already owns.
//
// Pure by design (mirrors the display repo's decideBoard() philosophy per
// CLAUDE.md): takes and returns a history array, so it is exhaustively
// testable without touching disk. The caller (POST /feed/checkin-report)
// owns load/save and the follow-up publishTally().
//
// History is never deleted — it doubles as the print log — so an undone
// check-in is marked `undone: true` / `undoneAt: <ISO>` in place rather than
// removed.
//
// Identity resolution: for each identity, only the NEWEST qualifying row
// tonight (history is newest-first) is eligible to be marked/cleared. That is
// the same row computeTonightStats() treats as "currently checked in" for
// that identity, and it is what makes the outcome deterministic when both an
// undone row and a newer successful re-check-in exist for the same child: the
// newer row always wins, never an older duplicate (a same-night reprint, or a
// stale prior undo) reviving or re-hiding a status that has since moved on.
//
// Safety guards baked in (a bad/partial scrape must never mass-undo a night):
//   - Only entries actually present in the (already-validated) report count as
//     "still checked in" — this function trusts its caller to have confirmed
//     the report parsed successfully; see feeds.validateCheckinReportBody()'s
//     `ok: true` requirement.
//   - Visitors are exempt from being marked undone: it is unknown whether
//     /clubber/checkin_report lists first-timers at all (TWOTIMTWO.md is
//     silent on it), so treating their absence as "undone" could be nothing
//     more than the report not tracking them. Reappearance still clears an
//     existing `undone` flag for a visitor — that direction can only correct a
//     false undo, never wrongly cause one.
//   - If applying the report would mark more than half of tonight's currently
//     checked-in kids as undone in one pass, the WHOLE pass is skipped (history
//     comes back unchanged) rather than trusted partially — that ratio is far
//     more consistent with a broken/partial scrape (wrong table, filtered
//     view, login bounce mid-parse) than with a real mass walkout.
function reconcileHistoryWithReport(history, reportEntries, now = Date.now()) {
  const today = localDayISO(new Date(now));
  const reportKeys = new Set(
    (Array.isArray(reportEntries) ? reportEntries : [])
      .map(reportEntryIdentityKey)
      .filter(k => k !== 'name:')
  );

  // The newest (index-first, since history is unshift()ed newest-first) row
  // per identity — the one row this pass is allowed to touch.
  const activeIdx = new Map(); // identityKey -> index into history[]
  history.forEach((row, i) => {
    if (!row || row.success === false || isNonCheckinRow(row)) return;
    if (!isOnLocalDay(row.timestamp, today)) return;
    const key = historyIdentityKey(row);
    if (!activeIdx.has(key)) activeIdx.set(key, i);
  });

  const toUndo = [];
  const toClear = [];
  let checkedInBefore = 0;
  activeIdx.forEach((i) => {
    const row = history[i];
    if (!row.undone) checkedInBefore++;
    const inReport = reportKeys.has(historyIdentityKey(row));
    if (!inReport && !row.undone && !row.visitor) toUndo.push(i);
    else if (inReport && row.undone) toClear.push(i);
  });

  if (checkedInBefore > 0 && toUndo.length > checkedInBefore / 2) {
    return {
      history,
      changed: 0,
      skipped: true,
      reason: `refusing to mark ${toUndo.length}/${checkedInBefore} checked-in kid(s) undone in one pass ` +
        '(more than half — treating as a suspect/partial scrape rather than a real mass walkout)',
    };
  }

  if (!toUndo.length && !toClear.length) {
    return { history, changed: 0, skipped: false, reason: null };
  }

  // Copy-on-write: only the rows that actually change become new objects.
  const next = history.slice();
  const nowIso = new Date(now).toISOString();
  toUndo.forEach((i) => { next[i] = { ...next[i], undone: true, undoneAt: nowIso }; });
  toClear.forEach((i) => {
    const { undone, undoneAt, ...rest } = next[i];
    next[i] = rest;
  });

  return { history: next, changed: toUndo.length + toClear.length, skipped: false, reason: null };
}

// A history row that is a PRINT but not a CHECK-IN: award slips and connect
// cards. One predicate, used by every consumer that counts check-ins (tonight's
// stats, the CSV write-back into TwoTimTwo, undo reconciliation, milestones,
// name-based reprint lookup) — a missed exclusion at any of those sites means a
// recognition print double-counts a child, so they must all share this test.
function isNonCheckinRow(e) {
  return !!(e && (e.isAward || e.isConnectCard));
}

function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift({
    // Bounded and control-character-stripped on the way in: these strings come
    // straight off a request body and are persisted, then rendered by the
    // dashboard. The dashboard escapes on output (that is the real fix for the
    // stored-XSS path); this keeps an unbounded or escape-laden value from
    // bloating the history file or mangling the console log.
    firstName: security.sanitizeStoredText(entry.firstName),
    lastName: security.sanitizeStoredText(entry.lastName),
    clubName: security.sanitizeStoredText(entry.clubName || ''),
    clubImageData: entry.clubImageData || null,
    printer: security.sanitizeStoredText(entry.printer || ''),
    success: entry.success,
    visitor: !!entry.visitor,
    // Award slips (POST /print-award) are flagged so they never masquerade
    // as a check-in: they're excluded from name-based /reprint lookups and
    // from tonight's check-in stats, but still show up in /history for the
    // dashboard's own record-keeping.
    isAward: !!entry.isAward,
    award: security.sanitizeStoredText(entry.award || ''),
    // Connect cards (#10) are flagged for the same reason award slips are:
    // they show in /history so the operator can see the card went out, but
    // isNonCheckinRow() keeps them out of every place that counts check-ins.
    isConnectCard: !!entry.isConnectCard,
    // TwoTimTwo's own clubber id, when the caller knew it. Everything here was
    // keyed on a lowercased "first last" string, so two children who share a
    // name merged into one row — the same defect the extension already fixed on
    // its side with identityKey(), which the server never followed. Stored as a
    // bounded string (ids are numeric today, but that is TwoTimTwo's business
    // to change). Absent on rows written before this, so every consumer must
    // fall back to the name — see historyRowMatches().
    clubberId: entry.clubberId != null && String(entry.clubberId).trim()
      ? security.sanitizeStoredText(String(entry.clubberId), 40)
      : null,
    timestamp: new Date().toISOString()
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  saveHistory(history);
}

app.get('/history', (req, res) => {
  const history = loadHistory();
  res.json(history);
});

app.get('/history/today', (req, res) => {
  const history = loadHistory();
  const today = localDayISO();
  const todayEntries = history.filter(e => isOnLocalDay(e.timestamp, today));
  res.json(todayEntries);
});

// ── Tonight at a glance ───────────────────────────────────────────────────────
// Aggregates today's print history + the roster into the numbers a director
// needs during the event: kids checked in per club, visitors, and the safety
// flags for everyone currently in the building (allergies, birthdays,
// no-photo kids). Each child counts once no matter how many reprints.
function computeTonightStats() {
  const history = loadHistory();
  const today = localDayISO();
  // Failed prints stay in history for the dashboard but never count a kid in.
  // Award slips and connect cards are excluded — they're a recognition/welcome
  // print, not a check-in, and must never inflate tonight's counts.
  const entries = history.filter(e => isOnLocalDay(e.timestamp, today) && e.success !== false && !isNonCheckinRow(e));

  const byClub = {};
  const seen = new Set();
  let checkedIn = 0;
  let visitors = 0;
  const allergyKids = [];
  const birthdayKids = [];
  const noPhotoKids = [];

  entries.forEach(e => {
    const name = `${e.firstName || ''} ${e.lastName || ''}`.trim();
    if (!name) return;
    // Keyed on the clubber id when the row has one, so two children who share a
    // name count as two. Older rows without an id keep the name key, which is
    // the previous behaviour.
    const key = historyIdentityKey(e);
    // The FIRST row seen per identity is the newest (history/entries are
    // newest-first) — the same row R-1 reconciliation is allowed to mark
    // `undone`. Marking `seen` here, before the undone check, is what stops an
    // older duplicate row (a same-night reprint, or a stale pre-undo print)
    // from being read next and reviving/re-hiding a status the newest row has
    // already settled — "latest record wins", deterministically.
    if (seen.has(key)) return;
    seen.add(key);
    // R-1 reconciliation (POST /feed/checkin-report) marks a row `undone` when
    // TwoTimTwo's own authoritative check-in report no longer lists the
    // child — an undo made on the site itself. Excluded from every count
    // below so the next `tally` broadcast decrements instead of keeping the
    // stale higher number all night.
    if (e.undone) return;
    checkedIn++;
    const club = (e.clubName || '').trim() || 'No club';
    byClub[club] = (byClub[club] || 0) + 1;
    if (e.visitor) visitors++;

    const record = findClubber(e.firstName, e.lastName);
    if (!record) return;
    const tokens = parseAllergies(record.Allergies || record.Notes || '');
    if (tokens.length) allergyKids.push({ name, allergies: tokens });
    if (isBirthdayWeek(record.Birthdate)) birthdayKids.push(name);
    if (noPhotoFor(record)) noPhotoKids.push(name);
  });

  return {
    date: today,
    prints: entries.length,
    checkedIn,
    visitors,
    byClub,
    allergyKids,
    birthdayKids,
    noPhotoKids
  };
}

app.get('/stats/tonight', (req, res) => {
  res.json(computeTonightStats());
});

// ── Label preview ────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  const { name, firstName: qFirst, lastName: qLast } = req.query;
  // Express hands back an array for a repeated query param (?clubName=a&clubName=b);
  // String() keeps the label renderer off a non-string.
  const clubName = String(req.query.clubName == null ? '' : req.query.clubName);
  let firstName, lastName;
  if (qFirst) {
    firstName = String(qFirst).trim();
    lastName = String(qLast || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || 'Preview';
    lastName = parts.slice(1).join(' ') || '';
  } else {
    firstName = 'Preview';
    lastName = 'Label';
  }

  // Enrich from CSV if available
  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName);
  let allergyTokens = [], handbookGroup = '', birthday = false, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    noPhoto = noPhotoFor(record);
    // Same roster fill (and same ordering) as /print — a preview must show the
    // label the same request would PRINT, pseudo-group suppression included.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  }

  // Editor live preview: an unsaved template rides in ?template=<json>. It is
  // sanitized exactly like a saved one and is never persisted; a parse failure
  // falls back to the saved template, so a typo can't 500 the preview. The
  // ?visitor=1 flag exists so the editor can see the VISITOR pill toggle.
  let template = labelTemplateFor(effectiveClubName);
  if (typeof req.query.template === 'string' && req.query.template) {
    try {
      const t = sanitizeLabelTemplate(JSON.parse(req.query.template));
      if (t) template = t;
    } catch { /* keep the saved template */ }
  }
  const previewVisitor = req.query.visitor === '1';

  try {
    const twinP = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName,
      allergyTokens, handbookGroup, isBirthday: birthday, noPhoto,
      isVisitor: previewVisitor,
      middleInitial: twinP.middleInitial, nameHint: twinP.nameHint,
      footerText: labelFooterText(),
      season: currentLabelSeason(),
      collectibleIndex: currentCollectibleIndex(),
      template,
    });
    res.set('Content-Type', 'image/png');
    res.send(result.buffer);
    // Clean up temp file
    fs.unlink(result.pngPath, () => {});
  } catch (err) {
    console.error('[preview] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Reprint ──────────────────────────────────────────────────────────────────
app.post('/reprint', async (req, res) => {
  const { name, index, clubberId = null } = req.body || {};
  const history = loadHistory();

  let entry;
  if (typeof index === 'number' && index >= 0 && index < history.length) {
    entry = history[index];
  } else if (name || clubberId) {
    // Award slips (isAward) are excluded from lookup so reprinting "by name"
    // always targets the check-in label, never an award slip that happens to
    // share the same child's name.
    //
    // historyRowMatches is id-first: when the caller knows the clubber id AND
    // the stored row has one, a name collision can no longer reprint the wrong
    // child's label. Rows predating the id fall back to name matching, so this
    // is a strict improvement rather than a behaviour change.
    const parts = String(name || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ');
    entry = history.find(e => !isNonCheckinRow(e) && historyRowMatches(e, first, last, clubberId));
  }

  if (!entry) {
    return res.status(404).json({ error: 'No matching print history entry found' });
  }

  const effectivePrinter = (req.body.printerName && req.body.printerName.trim()) || entry.printer || PRINTER_NAME;

  let pngPath = null;
  try {
    clubbers = loadClubbers();
    const record = findClubber(entry.firstName, entry.lastName);
    let allergyTokens = [], handbookGroup = '', birthday = false, noPhoto = false;
    if (record) {
      const allergySource = record.Allergies || record.Notes || '';
      allergyTokens = parseAllergies(allergySource);
      handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, entry.clubName);
      birthday = isCakeWeek(record.Birthdate);
      noPhoto = noPhotoFor(record);
    }

    const clubImageBuffer = await resolveImageBuffer(entry.clubImageData);
    // NOTE: visitor, stepUp, awanaShares, goToLine and milestoneLine are all
    // absent here because print history never stored them, so a reprint has
    // quietly differed from the original label. Naming the fields makes that
    // omission visible rather than hidden in a run of positional `false`s.
    const twinR = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
      clubImageBuffer, allergyTokens, handbookGroup, isBirthday: birthday, noPhoto,
      middleInitial: twinR.middleInitial, nameHint: twinR.nameHint,
      footerText: labelFooterText(),
      season: currentLabelSeason(),
      collectibleIndex: currentCollectibleIndex(),
      template: labelTemplateFor(entry.clubName),
    });
    pngPath = result.pngPath;

    printImage(pngPath, effectivePrinter);

    addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: entry.clubImageData,
      printer: effectivePrinter, success: true, clubberId: entry.clubberId
    });

    console.log(`[reprint] ${entry.firstName} ${entry.lastName}`);
    res.json({ success: true, name: `${entry.firstName} ${entry.lastName}` });
  } catch (err) {
    console.error('[reprint] Error:', err.message);
    addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: entry.clubImageData,
      printer: effectivePrinter, success: false, clubberId: entry.clubberId
    });
    recordPrintFailure(`${entry.firstName} ${entry.lastName}`.trim(), entry.clubName, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }
});

// ── Award slip labels ─────────────────────────────────────────────────────────
// A small recognition slip ("🏅 Awarded: <award>") for a completed book or
// earned award, printed through the SAME generateLabel/printImage pipeline
// as a normal check-in label — no new rendering path, so it can't regress
// one. The award text rides in the existing handbook-group text slot (with
// a medal prefix so it reads unambiguously as an award, not a group name),
// and the inverted (black-background) palette — already used for step-up
// and first-timer labels — makes an award slip visually distinct from a
// normal white check-in label at a glance.
app.post('/print-award', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    award,
    clubImageData = null,
    printerName   = '',
    clubberId     = null,
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  const awardText = String(award == null ? '' : award).trim();
  if (!awardText) return res.status(400).json({ error: 'award is required' });

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : PRINTER_NAME;

  // Duplicate suppression keyed on name+award (NOT name alone) — a child can
  // legitimately earn two different awards in one evening, and each should
  // print. Namespaced ("award:...") so it can never collide with a normal
  // check-in's dedup key in the same recentPrints map.
  const dupKey = `award:${clubberId ? 'id' + clubberId : firstName + ' ' + lastName}:${awardText}`
    .toLowerCase().trim();
  if (isDuplicatePrint(dupKey)) {
    console.log(`[print-award] '${firstName} ${lastName}' — '${awardText}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }

  // Enrich from the roster the same way /print does, including clubberId
  // awareness — an award slip must show the same allergy/no-photo safety
  // icons a check-in label would.
  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName, clubberId);

  let allergyTokens = [], birthday = false, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    noPhoto  = noPhotoFor(record);
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
  }

  const medalLine = `🏅 Awarded: ${awardText}`.slice(0, 60);

  let pngPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    const twinA = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup: medalLine, isBirthday: birthday, noPhoto,
      middleInitial: twinA.middleInitial, nameHint: twinA.nameHint,
      footerText: labelFooterText(),
      season: currentLabelSeason(),
      extras: { inverted: true },
    });
    pngPath = result.pngPath;

    printImage(pngPath, effectivePrinter);
    recordPrint(dupKey);

    addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: true, isAward: true, award: awardText,
      clubberId,
    });

    console.log(`[print-award] ${firstName} ${lastName} — ${awardText}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[print-award] Error:', err.message);
    addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: false, isAward: true, award: awardText,
      clubberId,
    });
    recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }
});

// ── Print an arbitrary PDF (leader worksheets) ────────────────────────────────
// Leader handbook-agenda / undistributed-award worksheets come out of
// TwoTimTwo as PDFs (docs/TWOTIMTWO.md §5 — /meeting/handbook,
// /meeting/Awards_undistributed), letter-size rather than 4×2, so they need
// their own print path and (usually) their own printer.
const PDF_MAX_BYTES = 12 * 1024 * 1024; // ~12MB cap on the DECODED payload
const PDF_MAGIC = '%PDF-';

// Prints a PDF on Windows via the shell's registered PDF handler (Start-Process
// -Verb Print), the same temp-file + execSync + finally-unlink shape as
// printImage(). If a specific printer was requested, best-effort switch the
// Windows default printer to it first (Start-Process -Verb Print has no
// direct "-Printer" argument) — failure to do that is non-fatal, the job
// still goes to whatever the current default is.
// A printer name is operator data that reaches a shell. Windows printer names
// are plain labels ("Brother QL-820NWB", "HP LaserJet (Office)"), so anything
// carrying quotes, shell metacharacters, or control characters is not a printer
// name — it is an injection attempt or corrupt config. Refuse it outright
// rather than try to escape it.
const PRINTER_NAME_MAX = 120;
function isSafePrinterName(name) {
  const s = String(name == null ? '' : name);
  if (!s) return true;                       // empty = "use the default"
  if (s.length > PRINTER_NAME_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  return !/["'`$;|&<>(){}\[\]\\\r\n%]/.test(s);
}

// Prints a PDF on Windows.
//
// SECURITY: neither the file path nor the printer name is interpolated into the
// PowerShell source. Both are handed to the child process as environment
// variables and read back with $env:, so no value can terminate a string
// literal and start a new statement. An earlier version escaped only single
// quotes and then embedded the printer name inside a DOUBLE-quoted filter
// string, which let a name containing a double quote run arbitrary commands —
// and because this server deliberately accepts requests from any local page,
// that was reachable from any website the volunteer had open.
function printPdf(pdfPath, printerName) {
  if (!isSafePrinterName(printerName)) {
    throw new Error('Refusing to print: printer name contains unsupported characters');
  }

  const ps = `
$ErrorActionPreference = 'Stop'
$target = $env:AWANA_PDF_PATH
$printer = $env:AWANA_PRINTER
if ($printer) {
  try {
    $p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $printer }
    if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null }
  } catch { }
}
Start-Process -FilePath $target -Verb Print -WindowStyle Hidden -Wait
`.trim();

  const psPath = tmpFilePath('awana-print-pdf', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
      timeout: 30000,
      windowsHide: true,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        AWANA_PDF_PATH: pdfPath,
        AWANA_PRINTER: printerName || '',
      }),
    });
    if (result) console.log('[print-pdf] PowerShell:', result.trim());
  } finally {
    fs.unlink(psPath, () => {});
  }
}

// The ONLY route allowed a large body — the global parser skips this path (see
// PDF_UPLOAD_PATH above) so this 18mb parser is the one that runs here.
app.post(PDF_UPLOAD_PATH, express.json({ limit: '18mb' }), async (req, res) => {
  // Validate the printer name FIRST, before the platform short-circuit below:
  // a malformed request is malformed on every OS, and rejecting it here means
  // the refusal is observable in tests that run on Linux rather than being
  // masked by the 501.
  if (!isSafePrinterName((req.body || {}).printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }

  // The headless render-smoke test runs on Linux — printing must fail loudly
  // and cheaply there, never attempt a PowerShell shell-out.
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'PDF printing requires Windows — not available on this platform' });
  }

  const { pdfBase64, printerName = '', label = '' } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'pdfBase64 (string) is required' });
  }
  // Cheap length pre-check before the (comparatively expensive) base64 decode
  // — base64 inflates size by ~4/3, so this rejects wildly oversized payloads
  // without ever allocating the decoded buffer.
  if (pdfBase64.length > PDF_MAX_BYTES * 1.4) {
    return res.status(413).json({ error: 'PDF payload too large (12MB max)' });
  }

  let buffer;
  try {
    buffer = Buffer.from(pdfBase64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'pdfBase64 is not valid base64' });
  }
  if (!buffer.length || buffer.length > PDF_MAX_BYTES) {
    return res.status(413).json({ error: 'PDF payload too large (12MB max)' });
  }
  // The magic bytes can be a handful of bytes into some generators' output
  // (stray leading whitespace/BOM), so scan a small header window rather
  // than requiring byte 0 exactly.
  if (!buffer.subarray(0, 1024).toString('latin1').includes(PDF_MAGIC)) {
    return res.status(400).json({ error: 'Decoded content is not a PDF (missing %PDF- header)' });
  }

  if (!isSafePrinterName(printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  const effectivePrinter = (printerName && String(printerName).trim())
    || config.worksheetPrinter
    || PRINTER_NAME;

  const pdfPath = tmpFilePath('awana-doc', 'pdf');
  try {
    fs.writeFileSync(pdfPath, buffer);
    printPdf(pdfPath, effectivePrinter);
    console.log(`[print-pdf] Printed ${label ? `'${String(label).slice(0, 60)}' ` : ''}(${buffer.length} bytes) to ${effectivePrinter || 'default'}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[print-pdf] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(pdfPath, () => {});
  }
});

// ── Check-in CSV write-back safety net ────────────────────────────────────────
// If a station loses its TwoTimTwo session mid-event, tonight's check-ins are
// still in print history — this exports them in the shape TwoTimTwo's own
// check-in CSV importer expects (docs/TWOTIMTWO.md §2.4, /clubber/checkin_csv,
// which does fuzzy name matching) so the director can reconcile attendance
// afterwards instead of hand-entering it.
function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// How many distinct children this server printed a label for TODAY, in LOCAL
// time. Feeds the checkout board's honest denominator.
//
// Local, not UTC, and that distinction is load-bearing. History timestamps are
// ISO/UTC, and a 17:30-20:00 local club night straddles UTC midnight for most of
// the US winter — at 19:00 EST it is already Thursday in UTC. A UTC-day filter
// would therefore drop the second half of the night, and the board would publish
// a FRESH, plausible, badly-wrong denominator right in the middle of pickup,
// which no staleness check can catch.
//
// It counts LABELS PRINTED BY THIS SERVER, which is not the same population as
// "children in the building": another station, a manual check-in or a printer jam
// all break the equivalence. Consumers must word it as the former.
function distinctChildrenPrintedToday(now = new Date()) {
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = localDay(now);
  const seen = new Set();
  for (const e of loadHistory()) {
    if (!e || !e.timestamp) continue;
    const when = new Date(e.timestamp);
    if (Number.isNaN(when.getTime()) || localDay(when) !== today) continue;
    if (e.success === false) continue;   // a failed print never checked anyone in
    if (isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
    const key = historyIdentityKey(e);
    if (!key) continue;
    seen.add(key);                       // reprints must not inflate the count
  }
  return seen.size;
}

app.get('/checkin-csv-export', (req, res) => {
  const dateParam = String(req.query.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localDayISO();

  const history = loadHistory();
  const seen = new Set();
  const rows = [];
  for (const e of history) {
    if (!e || !isOnLocalDay(e.timestamp, date)) continue;
    if (e.success === false) continue;   // a failed print never actually checked the kid in
    if (isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
    const first = String(e.firstName || '').trim();
    const last  = String(e.lastName  || '').trim();
    if (!first && !last) continue;
    // Id-first: this export is imported BACK INTO TwoTimTwo, so merging two
    // same-named children into one row would silently under-report attendance
    // for one of them.
    const key = historyIdentityKey(e);
    if (seen.has(key)) continue;         // one row per child even with reprints
    seen.add(key);
    rows.push({ first, last });
  }

  const lines = ['First Name,Last Name,Date'];
  rows.forEach(r => lines.push([csvField(r.first), csvField(r.last), csvField(date)].join(',')));
  const csv = lines.join('\r\n') + '\r\n';

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="checkin-export-${date}.csv"`);
  res.send(csv);
});

// ── Feed receive endpoints (contract v3) ──────────────────────────────────────
// The extension scrapes TwoTimTwo's own report CSVs / iCal / admin messages
// and POSTs the results here; feeds.js validates + throttles (max one publish
// per 5s per feed) and this thin route does the actual Pusher publish.
function makeFeedRoute(feedName) {
  return async (req, res) => {
    const result = feeds.submitFeed(feedName, req.body, Date.now());
    if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
    if (result.throttled) return res.json({ ok: true, throttled: true });

    let published = false;
    try {
      published = await events.publish(pusher, EVENT_CHANNEL, feedName, result.payload);
    } catch (e) { published = false; }
    feeds.recordPublishOutcome(feedName, published);
    res.json({ ok: true, published });
  };
}

app.post('/feed/tonight',  makeFeedRoute('tonight'));
app.post('/feed/points',   makeFeedRoute('points'));
app.post('/feed/schedule', makeFeedRoute('schedule'));
app.post('/feed/notice',   makeFeedRoute('notice'));
// Who is still in the building (contract v4). The extension scrapes
// TwoTimTwo's /clubber/checkout page — which IS the live list of children
// currently checked in — and posts the rows here. The print server cannot fetch
// that page itself: only the volunteer's browser holds the TwoTimTwo session.
//
// Consequence to accept honestly: this only works while someone has that tab
// open, so the board must degrade by showing its age rather than by silently
// claiming everyone is still present.
//
// `printed` is filled in HERE rather than trusted from the extension, because the
// server is the only thing that knows how many labels it printed. It means
// exactly "labels this server printed tonight" — NOT "children in the building".
// Those are different populations (another station, a manual check-in, a printer
// jam) and the display is required to word it as the former.
app.post('/feed/checkout', (req, res, next) => {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body.printed = distinctChildrenPrintedToday();
  }
  return makeFeedRoute('checkout')(req, res, next);
});

// Undo detection (roadmap follow-up to R-1). content.js's runReconcile()
// already polls /clubber/checkin_report every ~60s to catch check-ins the
// roster-diff detector misses; this reuses that SAME scrape for the direction
// it never covered — an undo on TwoTimTwo removes a row from that report, and
// nothing before this endpoint ever noticed. The extension posts the full
// authoritative "who's in tonight" list here on every successful reconcile
// pass (not just misses), and the server diffs it against its own
// print-history.json, which is the one place that already knows who it thinks
// is checked in.
//
// Deliberately NOT routed through makeFeedRoute()/feeds.submitFeed(): this
// never publishes a Pusher event itself (no new event type, per the contract
// freeze) — it mutates history, and only if that mutation actually changed
// anything does it call publishTally() immediately, so a display isn't stuck
// on a stale headcount until the next 60s tick.
app.post('/feed/checkin-report', (req, res) => {
  const result = feeds.submitCheckinReport(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  if (result.throttled) return res.json({ ok: true, throttled: true });

  const outcome = reconcileHistoryWithReport(loadHistory(), result.payload.entries, Date.now());
  if (outcome.skipped) {
    console.warn('[reconcile]', outcome.reason);
    return res.json({ ok: true, applied: false, changed: 0, reason: outcome.reason });
  }
  if (outcome.changed > 0) {
    saveHistory(outcome.history);
    publishTally();
  }
  res.json({ ok: true, applied: true, changed: outcome.changed });
});

// #2: the extension's "didn't stick" list — kids whose driven site check-in
// never verified (label printed, TwoTimTwo never confirmed). Stored in
// memory only and surfaced as a /health warning so the dashboard shows the
// same list the widget does. Replace semantics: an empty list clears it.
app.post('/feed/unverified-checkins', (req, res) => {
  const result = feeds.submitUnverified(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  res.json({ ok: true, count: result.payload.entries.length });
});

// ── Event-bus publishers ──────────────────────────────────────────────────────
// Interval publishers are gated by the church-config club-night window so the
// channel stays quiet the other ~165 hours a week. Every publisher is wrapped:
// a Pusher outage can never disturb printing.

function publishTally() {
  try {
    const st = computeTonightStats();
    // Unified theming (#18): every tally carries the printer's current season
    // (already resolved: pinned, calendar, or '' when art is off), so screens
    // follow the labels within a minute of any change - and a display that
    // boots mid-night picks it up on the next tally without any handshake.
    events.publish(pusher, EVENT_CHANNEL, 'tally', events.buildTally(st.byClub, st.checkedIn, {
      season: currentLabelSeason(),
      rehearsal: isRehearsalActive(),
    }));
  } catch (e) { console.warn('[events] tally publish skipped:', e.message); }
}

function publishRecap() {
  try {
    // An EMPTY recap is published on purpose once names are encrypted, where it
    // used to be skipped. It costs one sealed frame every two minutes and buys
    // the screens a continuous key-health heartbeat: a screen needs two failed
    // frames before it admits it cannot read names, so without this the first two
    // children of the night are silently missed before anything appears on the
    // wall. With it, a wrong key is on screen before the doors even open.
    // The consumer's handleRecap iterates `entries`, so [] is a clean no-op.
    if (!eventBuffer.length && !events.getDisplayKeyState().configured) return;
    events.publish(pusher, EVENT_CHANNEL, 'recap', events.buildRecap(eventBuffer));
  } catch (e) { console.warn('[events] recap publish skipped:', e.message); }
}

function publishBirthdays() {
  try {
    const entries = [];
    for (const r of clubbers) {
      if (!isBirthdayWeek(r.Birthdate)) continue;
      const bd = parseBirthdate(r.Birthdate);
      if (!bd) continue;
      // First name + club + calendar month/day ONLY — no last name, no year.
      entries.push({
        firstName: r.FirstName || '',
        club: r.Club || '',
        month: bd.getMonth() + 1,
        day: bd.getDate(),
      });
    }
    events.publish(pusher, EVENT_CHANNEL, 'birthdays', events.buildBirthdays(entries));
  } catch (e) { console.warn('[events] birthdays publish skipped:', e.message); }
}

function onClubNight(fn) {
  return () => {
    try {
      if (!events.isClubNightNow(churchConfig.clubNights)) return;
      fn();
    } catch (e) { /* scheduler must never die */ }
  };
}

// Club-night publish timers are started by startListening() so a bare
// require() of this module never spins up background work — but embedders
// (the Electron shell) still get them the moment the server actually starts.
function startClubNightTimers() {
  setInterval(onClubNight(publishRecap), 2 * 60 * 1000);
  setInterval(onClubNight(publishTally), 60 * 1000);
  setInterval(onClubNight(publishBirthdays), 10 * 60 * 1000);
}

// ── Selector self-test receiver ───────────────────────────────────────────────
// The extension probes the TwoTimTwo DOM (roster rows, names, #lastCheckin,
// club icons) every 10 minutes and posts the result here so silent selector
// drift is visible on the dashboard before it eats a club night. A transition
// into hard failure publishes an ops event (type/at only — no PII).
app.post('/selftest', (req, res) => {
  const body = req.body || {};
  const wasOk = !lastSelfTest || lastSelfTest.ok !== false;
  lastSelfTest = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 20).map(r => ({
          check: String(r && r.check || '').slice(0, 60),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    at: new Date().toISOString(),
  };
  recordExtensionReport(body.extensionVersion);
  if (!lastSelfTest.ok && wasOk) {
    console.warn('[selftest] Extension reports selector failure — check-in page markup may have changed');
    events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
  }
  res.json({ ok: true });
});

// Contract-drift canary (#3): the extension's full once-a-day sweep of every
// TwoTimTwo selector and endpoint docs/TWOTIMTWO.md documents as load-bearing.
// Same shape as /selftest but a superset in scope; a fresh failure publishes
// the existing ops selector-fail (no contract change) and raises a tray alert
// through the Electron shell, so the operator hears about drift BEFORE club
// night rather than when a modal click silently stops working.
app.post('/contract-canary', (req, res) => {
  const body = req.body || {};
  const wasOk = !lastContractCanary || lastContractCanary.ok !== false;
  lastContractCanary = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 40).map(r => ({
          check: String(r && r.check || '').slice(0, 80),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
          // soft (#3 refinement): meeting-dependent checks that legitimately
          // miss on a non-club day — informational, never counted as drift.
          soft: !!(r && r.soft),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    manual: body.manual === true,
    at: new Date().toISOString(),
  };
  recordExtensionReport(body.extensionVersion);
  if (!lastContractCanary.ok && wasOk) {
    const failing = lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    console.warn('[contract-canary] TwoTimTwo contract drift detected: ' + failing.join(', '));
    events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
    fireOpsAlert('Club Label Printer — site check failed',
      'The TwoTimTwo page no longer matches what the printer expects (' +
      (failing[0] || 'unknown check') + (failing.length > 1 ? ' +' + (failing.length - 1) + ' more' : '') +
      '). Open the dashboard before club night.');
  }
  res.json({ ok: true });
});

// ── Canary — end-to-end night-systems test ────────────────────────────────────
// Stage 1 prints a real label with a TEST overlay (unique name defeats the
// duplicate window; excluded from history, stats, tally, and the checkin
// event). Stage 2 publishes a canary event so displays can confirm the pipe.
app.post('/canary', async (req, res) => {
  const stages = [];
  const canaryName = 'Canary ' + new Date().toTimeString().slice(0, 8);

  let pngPath = null;
  try {
    const result = await generateLabel({
      firstName: canaryName, lastName: '', clubName: 'Test', testBanner: true,
    });
    pngPath = result.pngPath;
    const printerName = (req.body && req.body.printerName && String(req.body.printerName).trim()) || PRINTER_NAME;
    // Startup chirp (#12): the morning test print announces itself with a
    // two-second motor melody. Failure is swallowed inside — the canary's
    // job is the label and the pipe, never the music.
    playTuneIfEnabled(printerName);
    printImage(pngPath, printerName);
    stages.push({ stage: 'print', passed: true, detail: `TEST label sent to ${printerName || 'default printer'}` });
  } catch (err) {
    stages.push({ stage: 'print', passed: false, detail: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }

  const published = await events.publish(pusher, EVENT_CHANNEL, 'canary', events.buildCanary());
  stages.push({
    stage: 'pusher',
    passed: published,
    detail: pusher ? (published ? `canary event on ${EVENT_CHANNEL}` : 'publish failed') : 'Pusher not configured',
  });

  // Third stage: prove the ENCRYPTED path works, not just the channel. A screen
  // that can reach Pusher but cannot open a sealed frame shows no banners, and
  // without this stage the only symptom is "the wall stopped welcoming children"
  // — discovered mid-service rather than at 5:45.
  const keyState = events.getDisplayKeyState();
  if (keyState.configured) {
    // An empty recap on purpose: the consumer's handleRecap iterates entries, so
    // [] is a clean no-op that still exercises seal -> publish -> open.
    const sealedOk = await events.publish(
      pusher, EVENT_CHANNEL, 'recap', events.buildRecap([]));
    stages.push({
      stage: 'display key',
      passed: sealedOk,
      detail: sealedOk
        ? `sealed recap sent (key ${keyState.kid}) — each screen should flash "key OK"`
        : 'could not publish the sealed test event',
    });
  } else {
    stages.push({
      stage: 'display key',
      passed: false,
      detail: "No display key set — names are going out UNENCRYPTED on a public channel. Generate one under Realtime.",
    });
  }

  lastCanary = { at: new Date().toISOString(), stages };
  console.log(`[canary] ${stages.map(s => `${s.stage}:${s.passed ? 'ok' : 'FAIL'}`).join(' ')}`);
  res.json({ ok: stages.every(s => s.passed), stages });
});

// ── Church config (read-only) ─────────────────────────────────────────────────
// The extension fetches this once at startup so club-night windows, the
// check-in URL, and shares club ids live in one place instead of hardcodes.
app.get('/config/church', (req, res) => {
  res.json(churchConfig);
});

// ── Enhanced health check ────────────────────────────────────────────────────
let cachedPrinterCheck = { warnings: [], checkedAt: 0 };
const PRINTER_CHECK_INTERVAL = 60000; // 60 seconds

async function checkPrinterWarnings() {
  const now = Date.now();
  if (now - cachedPrinterCheck.checkedAt < PRINTER_CHECK_INTERVAL) {
    return cachedPrinterCheck.warnings;
  }
  const warnings = [];
  const csvPath = CSV_FILE;

  // Check CSV
  try {
    if (!fs.existsSync(csvPath)) {
      warnings.push({ type: 'csvMissing', message: 'clubbers.csv not found' });
    } else {
      const stat = fs.statSync(csvPath);
      const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
      if (rows.length === 0) {
        warnings.push({ type: 'csvEmpty', message: 'clubbers.csv has no data rows' });
      }
      const ageHours = (now - stat.mtimeMs) / 3600000;
      if (ageHours > 24) {
        warnings.push({ type: 'csvStale', message: `clubbers.csv is ${Math.round(ageHours)}h old` });
      }
    }
  } catch (e) { /* ignore */ }

  // Check printer (Windows only)
  if (PRINTER_NAME && process.platform === 'win32') {
    try {
      const raw = execSync(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name | ConvertTo-Json -Compress"',
        { timeout: 8000, windowsHide: true }
      ).toString().trim();
      let parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const names = parsed.map(p => p.Name);
      if (!names.includes(PRINTER_NAME)) {
        warnings.push({ type: 'printerNotFound', message: `Printer "${PRINTER_NAME}" not found` });
      }
    } catch (e) {
      warnings.push({ type: 'printerCheckFailed', message: 'Could not query printers' });
    }
  }

  cachedPrinterCheck = { warnings, checkedAt: now };
  return warnings;
}

// ── Auto-update check ────────────────────────────────────────────────────────
let latestVersion = null;
const UPDATE_CHECK_INTERVAL = 6 * 3600000; // 6 hours

// Embedders (the Electron shell) own the update lifecycle: they register a
// handler that /update-now calls instead of the legacy exit-99 dance, and
// they feed electron-updater's state into /health via setLatestVersion().
let updateHandler = null;
function setUpdateHandler(fn) { updateHandler = fn; }
function setLatestVersion(ver) {
  if (ver && /^\d+\.\d+\.\d+$/.test(String(ver).trim())) latestVersion = String(ver).trim();
}

// Where the Electron shell keeps the managed copy of the Chrome extension, and
// which version is sitting there. Pushed in rather than guessed from the
// filesystem: only the shell knows whether it actually synced, and /health
// reporting a folder the app never wrote would be worse than reporting none.
// Stays null under a standalone `node server.js`, which is the truth there.
let extensionInfo = null;
// Version skew (#7), pure half: warn only when the synced folder and the
// running extension genuinely disagree AND the running-version report is
// fresh. A report from before the sync (or from last week's session) must
// not shout "restart Chrome" at an operator whose Chrome is already fine —
// the extension reports every 10 minutes while a check-in page is open, so
// 30 minutes of freshness covers a slow tab without covering a stale one.
const EXTENSION_REPORT_FRESH_MS = 30 * 60 * 1000;
function extensionSkew(syncedVersion, report, now = Date.now()) {
  if (!syncedVersion || !report || !report.version) return null;
  if (now - report.at > EXTENSION_REPORT_FRESH_MS) return null;
  if (report.version === syncedVersion) return null;
  return { running: report.version, synced: syncedVersion };
}

function setExtensionInfo(info) {
  if (!info || !info.targetDir) { extensionInfo = null; return; }
  extensionInfo = {
    dir: String(info.targetDir),
    version: info.version ? String(info.version) : null,
    action: info.action ? String(info.action) : null,
  };
}

function checkForUpdates() {
  const url = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION';
  https.get(url, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const ver = data.trim();
      if (ver && /^\d+\.\d+\.\d+$/.test(ver)) {
        latestVersion = ver;
        if (ver !== SERVER_VERSION) {
          console.log(`[update] New version available: ${ver} (current: ${SERVER_VERSION})`);
        }
      }
    });
  }).on('error', () => { /* ignore */ });
}

// Override health endpoint with enhanced version
app.get('/health', async (req, res) => {
  // Copy: checkPrinterWarnings() hands back its CACHED array, so appending in
  // place would re-append on every poll until the cache expired.
  const warnings = [...await checkPrinterWarnings()];
  // Surface security misconfiguration where the operator already looks. A
  // silently loopback-only server looks identical to a broken phone page, and
  // "I turned on phone check-in and nothing happens" must not be a mystery.
  //
  // Every entry must be a {type, message} OBJECT. The dashboard renders
  // `w.message`, so a bare string arrived as `undefined` and painted an EMPTY
  // yellow box — the loudest warnings in the file were the invisible ones, and
  // that is exactly why nobody found the display key.
  if (config.lanAccess === true && !security.isAcceptablePin(config.phonePin)) {
    warnings.push({
      type: 'phonePinMissing',
      message: 'Phone check-in is enabled but no PIN is set, so the server is only listening on this computer. Set a PIN in Settings and restart.',
    });
  }
  // Surface the realtime privacy mode where the operator already looks. An
  // unencrypted channel is not broken, so it cannot be an error — but it must
  // never be INVISIBLE, or "we set that up" becomes a belief rather than a fact.
  const keyState = events.getDisplayKeyState();
  if (pusher && !keyState.configured) {
    warnings.push({
      type: 'displayKeyMissing',
      message: "No display key is set, so children's first names are published unencrypted on a channel anyone can subscribe to. Open Settings → Realtime privacy and press Generate display key.",
    });
  }
  if (config.displayKey && !keyState.configured) {
    warnings.push({
      type: 'displayKeyInvalid',
      message: 'The saved display key is invalid, so names are going out in the clear. Open Settings → Realtime privacy and generate a new one.',
    });
  }
  // #2: check-ins the extension could not verify as stuck on TwoTimTwo.
  // Names are allowed here: /health is loopback/operator-facing and this
  // list exists precisely so a human re-checks these kids on the site.
  // Version skew (#7): the app synced a new extension to disk, but Chrome is
  // still running the old code until it restarts. The widget already shows
  // its own "restart Chrome" banner; this is the dashboard half, driven by
  // what the extension itself last reported it was running.
  const skew = extensionSkew(extensionInfo && extensionInfo.version, lastExtensionReport);
  if (skew) {
    warnings.push({
      type: 'extensionSkew',
      message: `Chrome is running extension v${skew.running}, but v${skew.synced} is already installed on disk. Restart Chrome to load it — until then the browser keeps the old behavior.`,
    });
  }
  // Contract drift (#3): the daily sweep's latest verdict. A failing sweep is
  // exactly the "warn before club night" moment, so it belongs in the same
  // yellow box the operator already reads.
  if (lastContractCanary && lastContractCanary.ok === false) {
    const failing = lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    warnings.push({
      type: 'contractDrift',
      message: `The TwoTimTwo site no longer matches what this printer expects (${failing.join(', ') || 'unknown check'}). Automatic printing may be broken — run the widget's "Check site" after any fix.`,
    });
  }
  // Rehearsal mode is never an error, but it must never be INVISIBLE either:
  // an armed rehearsal turns every print into a TEST label, so the dashboard
  // has to shout it until it's turned off (or the 2h auto-disarm fires).
  if (isRehearsalActive()) {
    warnings.push({
      type: 'rehearsalArmed',
      message: 'Rehearsal mode is ON: every label prints with a TEST band and nothing is recorded or broadcast as real. Turn it off before real check-ins (it auto-disarms 2 hours after arming).',
    });
  }
  const unverified = feeds.getUnverifiedCheckins(Date.now());
  if (unverified.length) {
    const names = unverified.map(e => e.name).join(', ');
    warnings.push({
      type: 'unverifiedCheckins',
      message: `${unverified.length} check-in${unverified.length > 1 ? 's' : ''} may not have stuck on TwoTimTwo: ${names}. Labels printed, but the site never confirmed - re-check these kids on the check-in page.`,
    });
  }
  let csvUpdatedAt = null;
  try {
    csvUpdatedAt = fs.statSync(CSV_FILE).mtime.toISOString();
  } catch { /* no CSV yet */ }
  let householdsUpdatedAt = null;
  try {
    householdsUpdatedAt = fs.statSync(HOUSEHOLDS_CSV_FILE).mtime.toISOString();
  } catch { /* no household export synced yet */ }
  res.json({
    status: 'ok',
    printer: PRINTER_NAME || '(default)',
    rehearsal: isRehearsalActive(),
    version: SERVER_VERSION,
    latestVersion: latestVersion,
    uptime: Math.round(process.uptime()),
    warnings,
    clubNight: events.isClubNightNow(churchConfig.clubNights),
    pusher: events.getPublishState(),
    // Never the key itself — only whether one is installed, plus its public
    // `kid` fingerprint, which is what lets a screen confirm it holds the SAME
    // key rather than merely some key. "Are we actually encrypted?" has to be
    // answerable from the dashboard, not a belief.
    displayKeyConfigured: keyState.configured,
    displayKeyId: keyState.kid,
    encryptingNames: keyState.configured,
    // Managed Chrome extension folder + the version sitting in it. Null under a
    // standalone server. The VERSION is safe for anyone (the extension itself
    // reads it to know a restart is owed); the PATH is not, because it contains
    // the operator's Windows username and /health is CORS-reachable from the
    // check-in site. So the folder is loopback-only, like the display key.
    extension: extensionInfo && (isTrustedConfigOrigin(req)
      ? extensionInfo
      : { version: extensionInfo.version, action: extensionInfo.action }),
    selectorSelfTest: lastSelfTest,
    contractCanary: lastContractCanary,
    extensionRunning: lastExtensionReport,
    lastCanary,
    printFailures: printFailures.length,
    csv: { count: clubbers.length, updatedAt: csvUpdatedAt },
    households: { count: households.length, updatedAt: householdsUpdatedAt },
    // Freshness per POST /feed/* so the dashboard can show whether the
    // extension's tonight/points/schedule/notice scrapes are still landing.
    feeds: feeds.getFeedsHealth(),
  });
});

// Recent print failures for the dashboard (names stay local — never on Pusher)
app.get('/failures', (req, res) => {
  res.json(printFailures);
});

// ── One-click update ──────────────────────────────────────────────────────────
// Exits with code 99, which launch-awana.bat treats as "re-run the update
// check": it downloads the latest installer, refreshes the project, and
// starts the new server. Guarded so a stray call when no update exists can't
// bounce the server mid-event for nothing.
app.post('/update-now', (req, res) => {
  if (!latestVersion || latestVersion === SERVER_VERSION) {
    return res.status(409).json({ error: 'Already on the latest version', version: SERVER_VERSION });
  }
  res.json({ ok: true, updatingTo: latestVersion });
  if (updateHandler) {
    // Embedded in the Electron shell: hand the update to electron-updater.
    console.log(`[update] Update to v${latestVersion} requested — delegating to the app shell`);
    setTimeout(() => { try { updateHandler(latestVersion); } catch (e) { console.error('[update] Handler failed:', e.message); } }, 500);
  } else {
    // Legacy script install: exit 99 so launch-awana.bat re-runs the updater.
    console.log(`[update] Update to v${latestVersion} requested — exiting so the launcher can update`);
    // Let the response flush before the process exits.
    setTimeout(() => process.exit(99), 500);
  }
});

// ── Config endpoints ─────────────────────────────────────────────────────────

// The Pusher app secret and the phone PIN are the two values that must never
// leave this machine: the secret lets anyone publish to the church's screens,
// and the PIN is what gates the roster on the LAN.
//
// The previous version of this check had two holes, both closed here:
//   • `origin.endsWith(':3456')` accepted ANY host on that port, so a page
//     served from http://evil.example:3456 read both secrets cross-origin.
//   • `if (!origin) return true` trusted every request without an Origin
//     header — including a plain `curl` from any phone on the church WiFi,
//     which made the PIN self-defeating (fetch the PIN, then use it).
//
// Now: the request must come from the loopback interface, AND its Origin (when
// present) must be the extension or one of this server's own loopback pages.
// A LAN caller never gets these fields even with a valid PIN.
const SECRET_CONFIG_KEYS = ['pusherSecret', 'phonePin', 'displayKey'];

// Operator text that ends up printed on a label (labelFooter, the connect-card
// greeting). Not secrets, but they go onto paper and into config.json, so only
// a single bounded printable line is ever persisted: control characters become
// spaces, whitespace collapses, and the length is capped.
function printableConfigLine(value, maxLen) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Make the live `config` object exactly mirror what was just written to disk.
//
// Object.assign() alone was NOT enough, and the gap was security-relevant. Both
// POST /config paths can DELETE a key — `delete next.phonePin` when the operator
// clears the PIN, `delete next.displayKey` when they clear the display key — and
// Object.assign copies properties but never removes them. So the file said the
// PIN was gone while the live auth gate, which reads config.phonePin per
// request, kept accepting the OLD one until someone restarted the server. An
// operator clearing a leaked PIN had every reason to believe it was revoked.
// Same for the display key: clearing it left the publisher still sealing with
// the key it was supposed to have forgotten.
function applySavedConfig(next) {
  for (const key of Object.keys(config)) {
    if (!(key in next)) delete config[key];
  }
  Object.assign(config, next);
  // Sealing is per-publish, so a key change takes effect immediately — a
  // volunteer fixing a name outage mid-event must not have to restart the server
  // that is currently printing labels.
  events.setDisplayKey(config.displayKey);
}

function isTrustedConfigOrigin(req) {
  if (!security.isLoopbackRequest(req)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;                                   // same-origin GET, curl on this machine, tests
  if (origin.startsWith('chrome-extension://')) return true;   // the extension's options page
  if (origin.startsWith('moz-extension://')) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && String(url.port) === String(PORT)
      && (url.hostname === 'localhost' || security.isLoopbackAddress(url.hostname));
  } catch {
    return false;
  }
}

app.get('/config', (req, res) => {
  let saved;
  try {
    saved = fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
      : { printerName: PRINTER_NAME, checkinUrl: '' };
  } catch (e) {
    saved = { printerName: PRINTER_NAME, checkinUrl: '' };
  }
  if (!isTrustedConfigOrigin(req)) {
    saved = { ...saved };
    SECRET_CONFIG_KEYS.forEach(k => { delete saved[k]; });
  }
  res.json(saved);
});

// Generate a fresh display key for the dashboard's button. Loopback-only via
// isTrustedConfigOrigin: a phone on the venue Wi-Fi must never be able to mint
// the key that reads children's names, PIN or no PIN. Deliberately does NOT save
// it — the operator copies it, pastes it into the screens, and only then commits
// it here, so a mistyped paste cannot leave the screens keyed to a key the
// server has already replaced.
app.post('/config/display-key/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display key can only be generated from the dashboard on this computer' });
  }
  const key = events.generateDisplayKey();
  console.log('[realtime] Generated a new display key (not yet saved)');
  res.json({ key });
});

app.post('/config', (req, res) => {
  const {
    printerName, checkinUrl,
    pusherAppId, pusherKey, pusherSecret, pusherCluster,
    phonePin, firstTimerInverted, connectCard, enableDrivenCheckin, lateGraceMin,
    worksheetPrinter, lanAccess, allowedOrigins, historyRetentionDays, displayKey,
    labelFooter, connectCardAutoFirstTimer, connectCardGreeting, seasonTheme, collectibleIcons,
    musicalPrinter, updateBeacon,
  } = req.body || {};
  if (!isTrustedConfigOrigin(req) && SECRET_CONFIG_KEYS.some(k => (req.body || {})[k] !== undefined)) {
    return res.status(403).json({ error: 'Pusher/PIN settings can only be changed from the dashboard or the extension options page' });
  }
  try {
    const next = {};
    if (fs.existsSync(CONFIG_FILE)) {
      Object.assign(next, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
    }
    if (printerName !== undefined) next.printerName = printerName;
    // checkinUrl is handed to shell.openExternal() (Electron) and Start-Process
    // (legacy installer), so an unvalidated value was an arbitrary URI aimed at
    // the Windows shell — and this route accepts writes from the extension's
    // origin. Same reasoning as worksheetPrinter below: refuse to PERSIST
    // anything unsafe, so it can never be poisoned once and fire later.
    if (checkinUrl !== undefined) {
      if (!security.isSafeExternalUrl(checkinUrl)) {
        return res.status(400).json({ error: 'checkinUrl must be a plain http(s) URL' });
      }
      next.checkinUrl = String(checkinUrl).trim();
    }
    if (pusherAppId !== undefined) next.pusherAppId = pusherAppId;
    if (pusherKey !== undefined) next.pusherKey = pusherKey;
    if (pusherSecret !== undefined) next.pusherSecret = pusherSecret;
    if (pusherCluster !== undefined) next.pusherCluster = pusherCluster;
    // A PIN is the only thing between the LAN and the roster, so it has a
    // minimum length now and the 12-char cap is gone (it discouraged
    // passphrases). Clearing it is still allowed — that just turns LAN access
    // off, because the auth gate fails closed without one.
    if (phonePin !== undefined) {
      const wanted = String(phonePin);
      if (wanted === '') {
        delete next.phonePin;
      } else if (!security.isAcceptablePin(wanted)) {
        return res.status(400).json({
          error: `PIN must be ${security.PIN_MIN_LENGTH}–${security.PIN_MAX_LENGTH} characters`,
        });
      } else {
        next.phonePin = wanted;
      }
    }
    // The AES key that lets the church's own screens read children's names off
    // the public Pusher channel. Clearing it stops the three name-bearing events
    // from being published at all (they fail closed rather than reverting to
    // plaintext) — which is the whole-system rollback lever, no deploy needed.
    if (displayKey !== undefined) {
      const wanted = String(displayKey).trim();
      if (wanted === '') {
        delete next.displayKey;
      } else if (!events.isValidDisplayKey(wanted)) {
        return res.status(400).json({
          error: 'Display key must be 32 bytes of base64 — use the Generate button rather than typing one',
        });
      } else {
        next.displayKey = wanted;
      }
    }
    // Binding beyond loopback is an explicit choice, not a default. Takes
    // effect on restart (the listening socket is already bound).
    if (lanAccess !== undefined) next.lanAccess = !!lanAccess;
    if (allowedOrigins !== undefined) next.allowedOrigins = security.sanitizeAllowedOrigins(allowedOrigins);
    if (historyRetentionDays !== undefined) {
      next.historyRetentionDays = security.normalizeRetentionDays(historyRetentionDays);
    }
    if (firstTimerInverted !== undefined) next.firstTimerInverted = !!firstTimerInverted;
    if (connectCard !== undefined) next.connectCard = !!connectCard;
    // Label footer (#8): one short operator line (church name, a verse, service
    // times) rendered along the bottom of every label. Clearing it deletes the
    // key (same pattern as phonePin) so config.json stays clean.
    if (labelFooter !== undefined) {
      const lf = printableConfigLine(labelFooter, 60);
      if (lf === '') delete next.labelFooter;
      else next.labelFooter = lf;
    }
    // Connect card auto-trigger + greeting (#10). An empty greeting deletes the
    // key and the printed card falls back to the built-in default.
    if (connectCardAutoFirstTimer !== undefined) next.connectCardAutoFirstTimer = !!connectCardAutoFirstTimer;
    if (connectCardGreeting !== undefined) {
      const cg = printableConfigLine(connectCardGreeting, 60);
      if (cg === '') delete next.connectCardGreeting;
      else next.connectCardGreeting = cg;
    }
    // Season theme (#16): 'auto' is the default (and deletes the key), 'off'
    // disables the art, a known season pins it. Anything else is refused so a
    // typo can't silently mean 'auto'.
    if (seasonTheme !== undefined) {
      const st = String(seasonTheme || 'auto');
      if (st === 'auto') delete next.seasonTheme;
      else if (st === 'off' || SEASON_KEYS.includes(st)) next.seasonTheme = st;
      else return res.status(400).json({ error: 'unknown seasonTheme' });
    }
    // Collectible of the week (#20): on by default; false turns it off.
    if (collectibleIcons !== undefined) next.collectibleIcons = !!collectibleIcons;
    // Musical printer (#11/#12): OFF by default - raw TSPL bytes at an unknown
    // printer model are a party trick, not a guarantee.
    if (musicalPrinter !== undefined) next.musicalPrinter = !!musicalPrinter;
    if (updateBeacon !== undefined) next.updateBeacon = !!updateBeacon;
    if (enableDrivenCheckin !== undefined) next.enableDrivenCheckin = !!enableDrivenCheckin;
    if (lateGraceMin !== undefined) next.lateGraceMin = Math.max(0, Math.min(120, Number(lateGraceMin) || 0));
    // Worksheets (POST /print-pdf) are letter-size, not 4x2 labels, so a
    // church running two printers can route them separately.
    if (worksheetPrinter !== undefined) {
      // This value reaches a shell via printPdf(); refuse to persist anything
      // that isn't a plain printer label so it can never be poisoned once and
      // fire later during a legitimate worksheet print.
      const wp = String(worksheetPrinter || '').trim();
      if (!isSafePrinterName(wp)) {
        return res.status(400).json({ error: 'worksheetPrinter contains unsupported characters' });
      }
      next.worksheetPrinter = wp;
    }

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
    // Keep the live process in sync so schedule/PIN/toggle/key changes apply
    // without a restart (Pusher creds still need one — noted in the UI).
    applySavedConfig(next);
    console.log('[config] Saved');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Group schedule (#28) ──────────────────────────────────────────────────────
app.get('/config/schedule', (req, res) => {
  res.json({ schedule: scheduleRows(), lateGraceMin: Number.isFinite(Number(config.lateGraceMin)) ? Number(config.lateGraceMin) : 10 });
});

app.post('/config/schedule', (req, res) => {
  const { schedule, lateGraceMin } = req.body || {};
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule must be an array' });
  const rows = schedule.slice(0, 12).map(r => ({
    club: String(r && r.club || '').slice(0, 30),
    startTime: /^\d{1,2}:\d{2}$/.test(String(r && r.startTime || '')) ? String(r.startTime) : '',
    location: String(r && r.location || '').slice(0, 40),
    room: String(r && r.room || '').slice(0, 20),
  })).filter(r => r.club);
  try {
    const next = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
    next.schedule = rows;
    if (lateGraceMin !== undefined) next.lateGraceMin = Math.max(0, Math.min(120, Number(lateGraceMin) || 0));
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
    applySavedConfig(next);
    res.json({ ok: true, schedule: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Musical printer (#11/#12) — endpoint ──────────────────────────────────────
// Loopback/trusted-origin only: feeding paper is a physical act, and a phone
// on the venue Wi-Fi has no business making the printer sing mid-club.
// ── Rehearsal mode (#19) ──────────────────────────────────────────────────────
// One dashboard button arms a fake club night across BOTH apps: while armed,
// EVERY print is treated as a demo (real label, diagonal TEST band, zero
// persistent side effects — no history, no ledger, no publish, no tally), and
// every tally broadcast carries the contract's optional `rehearsal: true`
// flag (staged in v5.20.0) so the displays watermark themselves. In-memory
// only, and it auto-disarms after 2 hours: a rehearsal armed at Tuesday
// training and forgotten must never turn Wednesday's real check-ins into
// TEST labels. /health carries both the state and a loud warning while armed.
const REHEARSAL_AUTO_DISARM_MS = 2 * 60 * 60 * 1000;
let rehearsalState = { on: false, armedAt: 0 };

function isRehearsalActive(now = Date.now()) {
  if (!rehearsalState.on) return false;
  if (now - rehearsalState.armedAt > REHEARSAL_AUTO_DISARM_MS) {
    rehearsalState = { on: false, armedAt: 0 };
    console.log('[rehearsal] Auto-disarmed after 2h — rehearsal mode never outlives a training session');
    // Broadcast the disarm, or displays keep the TEST watermark until the
    // next club night's first interval tally. Deferred a tick: this getter
    // is called from inside publishTally itself, and the state above is
    // already cleared, so the deferred tally reads rehearsal=false.
    setTimeout(() => { try { publishTally(); } catch (e) { /* best-effort */ } }, 0);
    return false;
  }
  return true;
}

app.post('/rehearsal', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'Rehearsal mode can only be toggled from the dashboard on this computer' });
  }
  const on = (req.body || {}).on === true;
  rehearsalState = on ? { on: true, armedAt: Date.now() } : { on: false, armedAt: 0 };
  console.log('[rehearsal] ' + (on ? 'ARMED — every print is a TEST label, nothing is recorded, displays watermark' : 'disarmed — back to real check-ins'));
  // Broadcast immediately so screens flip their watermark within seconds,
  // not at the next 60s tally tick (and drop it just as fast on disarm).
  publishTally();
  res.json({ ok: true, rehearsal: rehearsalState.on });
});

app.post('/play-tune', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The tune button only works from the dashboard on this computer' });
  }
  if (config.musicalPrinter !== true) {
    return res.status(409).json({ error: 'Musical printer is off — enable it in Settings first' });
  }
  const wanted = String((req.body || {}).printerName || '').trim();
  if (wanted && !isSafePrinterName(wanted)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  const tune = String((req.body || {}).tune || '') || undefined;
  const ok = playTuneIfEnabled(wanted || PRINTER_NAME, tune);
  res.json({ ok, tune: TUNE_NAMES.includes(tune) ? tune : currentTuneName() });
});

// ── Per-club label templates (#1) — endpoints ─────────────────────────────────
app.get('/config/label-templates', (req, res) => {
  res.json({
    templates: (config.labelTemplates && typeof config.labelTemplates === 'object' && !Array.isArray(config.labelTemplates))
      ? config.labelTemplates : {},
    knownClubs: Object.keys(CLUB_MONOGRAM),
    fields: LABEL_TEMPLATE_BOOLEANS,
  });
});

// Writes are gated on isTrustedConfigOrigin — stricter than the other
// non-secret keys, deliberately: a template changes what gets PRINTED for a
// whole club, and the phone PIN is a LAN-trust credential, not authorization
// to restyle every label. The dashboard and extension options page (both
// loopback) are the only writers.
app.post('/config/label-templates', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'Label templates can only be changed from the dashboard on this computer' });
  }
  const cleaned = sanitizeLabelTemplates((req.body || {}).templates);
  if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });
  try {
    const next = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {};
    if (Object.keys(cleaned.value).length === 0) delete next.labelTemplates;
    else next.labelTemplates = cleaned.value;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
    applySavedConfig(next);
    console.log('[config] Label templates saved:', Object.keys(cleaned.value).join(', ') || '(none)');
    res.json({ ok: true, templates: cleaned.value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Phone check-in (#17b) ─────────────────────────────────────────────────────
// PIN enforcement for every non-loopback caller now lives in the app-level auth
// gate near the top of the Express setup — one check, applied to every route,
// rather than a per-route opt-in that was easy to forget on a new endpoint (and
// was in fact missing from /stats/tonight, /history and /checkin-csv-export).
//
// The PIN still rides plain HTTP on the venue network, so it remains a
// LAN-trust credential rather than a cryptographic one: it stops a bystander
// reading the roster, not someone who can already sniff the church WiFi.

app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

// Roster + tonight's checked-in set for the phone page.
app.post('/phone/roster', (req, res) => {
  // PIN already verified by the auth gate for every non-loopback caller.
  clubbers = loadClubbers();
  const checkedIn = new Set(
    loadHistory()
      // !e.undone: R-1 reconciliation (POST /feed/checkin-report) marks a row
      // undone when the child is no longer on TwoTimTwo's own authoritative
      // check-in report — an undo made on the website itself. Without this a
      // kid who was undone stayed "checkedIn: true" here forever, so a phone
      // volunteer could never re-check them in.
      .filter(e => isOnLocalDay(e.timestamp, localDayISO()) && e.success !== false && !e.undone)
      .map(e => `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().trim())
  );
  const kids = clubbers.map(r => {
    const name = `${r.FirstName || ''} ${r.LastName || ''}`.trim();
    return { name, club: r.Club || '', checkedIn: checkedIn.has(name.toLowerCase()) };
  }).filter(k => k.name);
  res.json({ kids });
});

app.post('/phone/checkin', (req, res) => {
  // PIN already verified by the auth gate for every non-loopback caller.
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name is required' });
  prunePendingActions();
  // One pending action per kid — a double-tap must not double-drive.
  const existing = pendingActions.find(a => a.name.toLowerCase() === name.toLowerCase() && a.status === 'pending');
  if (existing) return res.json({ id: existing.id, queued: true });
  const action = {
    id: crypto.randomUUID(),
    name,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  pendingActions.push(action);
  console.log(`[phone] Check-in queued: ${name}`);
  wakePendingWaiters();
  res.json({ id: action.id, queued: true });
});

// Extension long-poll: returns pending actions immediately if any exist,
// otherwise holds the request up to 25 s waiting for one.
app.get('/pending-actions', (req, res) => {
  prunePendingActions();
  const pending = pendingActions.filter(a => a.status === 'pending');
  if (pending.length || pendingWaiters.length >= PENDING_WAITERS_MAX) {
    return res.json({ actions: pending });
  }
  const waiter = { res, timer: null };
  waiter.timer = setTimeout(() => {
    pendingWaiters = pendingWaiters.filter(w => w !== waiter);
    try { res.json({ actions: [] }); } catch { /* client gone */ }
  }, 25000);
  req.on('close', () => {
    clearTimeout(waiter.timer);
    pendingWaiters = pendingWaiters.filter(w => w !== waiter);
  });
  pendingWaiters.push(waiter);
});

app.post('/pending-actions/:id/result', (req, res) => {
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  action.status = (req.body && req.body.ok) ? 'done' : 'failed';
  action.detail = String((req.body && req.body.detail) || '').slice(0, 200);
  console.log(`[phone] ${action.name}: ${action.status}${action.detail ? ' — ' + action.detail : ''}`);
  res.json({ ok: true });
});

app.get('/phone/status/:id', (req, res) => {
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  res.json({ status: action.status, detail: action.detail });
});

// ── Diagnostics ──────────────────────────────────────────────────────────────
app.get('/diagnostics', async (req, res) => {
  const results = [];

  // 1. Server running
  results.push({ test: 'Server running', passed: true, detail: `v${SERVER_VERSION}, uptime ${Math.round(process.uptime())}s` });

  // 2. Printer detected
  if (process.platform === 'win32') {
    try {
      const raw = execSync(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
        { timeout: 8000, windowsHide: true }
      ).toString().trim();
      let parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const target = PRINTER_NAME || parsed.find(p => p.Default)?.Name || '(none)';
      const found = parsed.some(p => p.Name === (PRINTER_NAME || '') || (!PRINTER_NAME && p.Default));
      results.push({ test: 'Printer detected', passed: found, detail: target });
    } catch (e) {
      results.push({ test: 'Printer detected', passed: false, detail: e.message });
    }
  } else {
    results.push({ test: 'Printer detected', passed: false, detail: 'Not on Windows' });
  }

  // 3. CSV loaded
  const csvPath = CSV_FILE;
  const csvExists = fs.existsSync(csvPath);
  const csvCount = csvExists ? parseCSV(fs.readFileSync(csvPath, 'utf8')).length : 0;
  results.push({ test: 'CSV loaded', passed: csvExists && csvCount > 0, detail: csvExists ? `${csvCount} clubbers` : 'File not found' });

  // 4. Can render test label
  try {
    const testResult = await generateLabel({ firstName: 'Test', lastName: 'Child', clubName: '' });
    fs.unlink(testResult.pngPath, () => {});
    results.push({ test: 'Label rendering', passed: true, detail: `${testResult.buffer.length} bytes` });
  } catch (e) {
    results.push({ test: 'Label rendering', passed: false, detail: e.message });
  }

  res.json(results);
});

// ── Error handling middleware ─────────────────────────────────────────────────
// Registered after all routes. Malformed JSON bodies used to surface as the
// default Express HTML stack trace; return clean JSON the clients can parse.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: 'Invalid or oversized JSON body' });
  }
  console.error('[http] Unhandled route error:', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

// ── Start up ──────────────────────────────────────────────────────────────────
// The full server is also requireable (#16): the Electron app requires this
// module and calls startListening() so its users get the whole feature set —
// roster enrichment, dedup, history, Pusher, phone check-in. A bare `require`
// has ZERO side effects — no port bind, no timers, no network. Everything the
// running server needs (temp-file sweep, roster load, publish timers, birthday
// push, prewarm) happens inside startListening(); only the legacy VERSION-poll
// self-update stays in the require.main block, because the Electron shell owns
// updates itself via setUpdateHandler()/setLatestVersion().

// Pre-warm: send a blank label to the printer to eliminate cold-start delay.
// Off by default — enable via config.json { "prewarmPrinter": true }
function prewarmPrinterIfConfigured() {
  try {
    const prewarmConfig = fs.existsSync(CONFIG_FILE)
      ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
      : {};
    if (prewarmConfig.prewarmPrinter) {
      setTimeout(async () => {
        try {
          console.log('[prewarm] Sending blank label to printer...');
          const result = await generateLabel({ firstName: ' ', lastName: ' ', clubName: '' });
          printImage(result.pngPath, PRINTER_NAME);
          fs.unlink(result.pngPath, () => {});
          console.log('[prewarm] Done');
        } catch (e) {
          console.log('[prewarm] Failed (non-critical):', e.message);
        }
      }, 5000);
    }
  } catch (e) { /* config parse error — ignore */ }
}

// Bind the port with retry: during updates, install-and-run.ps1 (or a
// just-killed previous instance) can hold port 3456 for a few seconds.
// Previously an EADDRINUSE here killed the process with no usable message.
const LISTEN_MAX_ATTEMPTS = 5;
// The Electron shell calls startListening() again every time settings are
// saved (it restarts the server to pick up a new printer). Without this latch
// each save stacked another set of publish intervals on the same process, so
// after a few visits to Settings the event bus fired tally/recap/birthday
// publishes N times a tick — and re-ran the prewarm blank print each time.
let startupTasksDone = false;
// ── What changed (#6) ─────────────────────────────────────────────────────────
// The release notes already exist — changes.md is written for every version —
// so the "what's new" panel parses that file rather than inventing a second
// changelog. changes.md ships in the packaged app (extraResources), and the
// same relative path resolves in dev (repo root) and packaged (resources/)
// because the server dir sits one level below both.
const CHANGES_FILE = path.join(__dirname, '..', 'changes.md');

// Pure: first `## [X.Y.Z] - date` heading and its body up to the next `## `.
function parseLatestChangeEntry(markdown) {
  if (typeof markdown !== 'string' || !markdown) return null;
  const text = markdown.replace(/^\uFEFF/, '');
  const m = text.match(/^## \[(\d+\.\d+\.\d+)\] - (\S+)\s*\n/m);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = text.indexOf('\n## [', start);
  const body = text.slice(start, next === -1 ? undefined : next).trim();
  return { version: m[1], date: m[2], body };
}

let cachedChangeEntry;
function latestChangeEntry() {
  if (cachedChangeEntry !== undefined) return cachedChangeEntry;
  try {
    cachedChangeEntry = parseLatestChangeEntry(fs.readFileSync(CHANGES_FILE, 'utf8'));
  } catch {
    cachedChangeEntry = null; // changes.md not shipped/readable — panel hides itself
  }
  return cachedChangeEntry;
}

app.get('/whats-new', (req, res) => {
  const entry = latestChangeEntry();
  if (!entry) return res.status(404).json({ error: 'no release notes available' });
  res.json(entry);
});

// ── Update health beacon (#5, opt-in) ────────────────────────────────────────
// After an auto-update, the operator has no confirmation the new build came
// back cleanly until they walk to the laptop. When config.updateBeacon is on,
// the first boot of a NEW version publishes ops {type:'update-ok', version} —
// version + ok flag only, nothing else rides it. The last-booted version is
// recorded on EVERY boot regardless of the setting, so turning the beacon on
// later never fires a stale beacon for an update that happened weeks ago.
const LAST_BOOT_VERSION_FILE = path.join(DATA_DIR, 'last-boot-version.json');

function shouldSendUpdateBeacon(prevVersion, currentVersion, enabled) {
  if (enabled !== true) return false;
  if (!prevVersion || typeof prevVersion !== 'string') return false; // first-ever boot is not an update
  return prevVersion !== currentVersion;
}

function recordBootVersionAndMaybeBeacon() {
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(LAST_BOOT_VERSION_FILE, 'utf8')).version || null;
  } catch { /* first boot, or unreadable — treated as no previous version */ }
  try {
    fs.writeFileSync(LAST_BOOT_VERSION_FILE, JSON.stringify({ version: SERVER_VERSION, at: new Date().toISOString() }));
  } catch (e) { console.warn('[update-beacon] Could not record boot version:', e.message); }
  // What changed (#6): the tray half. A LOCAL notification on the first boot
  // of a new version — independent of the opt-in beacon above, which gates
  // only the PUBLIC event. Once per version by construction (prev is
  // rewritten before this runs).
  if (prev && typeof prev === 'string' && prev !== SERVER_VERSION) {
    const entry = latestChangeEntry();
    const firstLine = entry ? String(entry.body).split('\n', 1)[0].slice(0, 180) : '';
    fireOpsAlert('Club Label Printer updated to v' + SERVER_VERSION,
      firstLine || 'See the dashboard\u2019s "What\u2019s new" panel for details.');
  }
  if (shouldSendUpdateBeacon(prev, SERVER_VERSION, config.updateBeacon === true)) {
    console.log(`[update-beacon] Updated ${prev} → ${SERVER_VERSION} and came back cleanly — publishing ops update-ok`);
    try {
      events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('update-ok', null, { version: SERVER_VERSION }));
    } catch (e) { console.warn('[update-beacon] publish skipped:', e.message); }
  }
}

function startListening(attempt = 1) {
  if (attempt === 1 && !startupTasksDone) {
    startupTasksDone = true;
    // One-time startup work (skipped on EADDRINUSE retries and restarts).
    // Clean up any temp files a crashed previous run left behind.
    sweepOrphanedTempFiles();
    // Load clubbers before accepting requests so the first print has data ready.
    clubbers = loadClubbers();
    households = loadHouseholds();
    householdSiblingIndex = buildHouseholdSiblingIndex(households);
    startClubNightTimers();
    // Publish the birthday roster once at startup so displays that boot before
    // the first club-night interval still get the list. Delayed a few seconds
    // so the CSV is loaded and Pusher has settled.
    setTimeout(() => { try { publishBirthdays(); } catch (e) { /* ignore */ } }, 5000);
    prewarmPrinterIfConfigured();
    // Update health beacon (#5): delayed so config.json is loaded and the
    // Pusher client has settled — same reasoning as the birthday publish.
    setTimeout(() => { try { recordBootVersionAndMaybeBeacon(); } catch (e) { /* never blocks boot */ } }, 4000);
  }
  // Bind loopback-only unless the operator has explicitly enabled LAN access
  // AND set a PIN. Previously this was a bare app.listen(PORT), which binds
  // every interface — so the roster, the check-in history and the allergy list
  // were readable by anything on the church WiFi.
  const bind = security.resolveBindHost({
    lanAccess: config.lanAccess === true,
    hasPin: security.isAcceptablePin(config.phonePin),
    envHost: process.env.AWANA_BIND_HOST,
  });
  const server = app.listen(PORT, bind.host, () => {
    console.log(`\n  Club Print Server v${SERVER_VERSION}  •  http://localhost:${PORT}`);
    console.log(`  Dashboard : http://localhost:${PORT}/`);
    console.log(`  Printer   : ${PRINTER_NAME || '(system default)'}`);
    console.log(`  Network   : bound to ${bind.host} — ${bind.reason}`);
    if (bind.lan) {
      console.log('              Phone check-in is reachable on this network; every');
      console.log('              request from it must carry the PIN.');
    } else if (config.lanAccess === true) {
      console.log('              LAN access is ON in settings but no PIN is set, so the');
      console.log('              server stayed loopback-only. Set a PIN and restart.');
    }
    console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < LISTEN_MAX_ATTEMPTS) {
      const delay = 2000 * attempt;
      console.warn(`[startup] Port ${PORT} is in use — retrying in ${delay / 1000}s (attempt ${attempt}/${LISTEN_MAX_ATTEMPTS})`);
      setTimeout(() => startListening(attempt + 1), delay);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[startup] Port ${PORT} is still in use after ${LISTEN_MAX_ATTEMPTS} attempts.`);
      console.error('[startup] Another print server is likely running — close it and restart, or reboot the machine.');
    } else {
      console.error('[startup] Server error:', err.message);
    }
  });
  return server;
}

module.exports = {
  app, startListening, setUpdateHandler, setLatestVersion, setExtensionInfo, setOpsAlertHandler,
  // For the Electron shell: this module is require-cached across settings
  // saves, so the shell pushes the freshly merged config.json and printer
  // name into the LIVE module instead of relying on load-time state.
  applySavedConfig, setPrinterName,
  // Pure helpers exported for scripts/test-server-helpers.cjs — they carry
  // the assumptions about TwoTimTwo's real /clubber/csv export format.
  parseCSV, normalizeHeader, buildFamilyIndex, findClubberIn, parseNoPhoto, noPhotoFor,
  isSafePrinterName,
  parseAllergies, buildHouseholdSiblingIndex, siblingsFor,
  historyRowMatches, historyIdentityKey, distinctChildrenPrintedToday,
  reconcileHistoryWithReport, reportEntryIdentityKey, computeTonightStats,
  shouldSendUpdateBeacon, parseLatestChangeEntry, extensionSkew,
  // Attendance ledger — exported so the id-migration and the auto-connect-card
  // signals (firstEver / priorNightExists) can be unit-tested against a temp
  // AWANA_DATA_DIR without driving the whole /print route.
  recordAttendance, isNonCheckinRow,
  // Birthday/cake helpers — the half-birthday rule (#8) has date math worth
  // pinning (June–August gate, day clamping, ISO-week reuse).
  parseBirthdate, isBirthdayWeek, isHalfBirthdayWeek, isCakeWeek,
  // Twin-safe labels (#13) — collision detection + hint preference order.
  twinDisambiguation,
  // Seasonal art (#16) — the computus and the calendar tiling are date math
  // worth pinning; SEASON_KEYS doubles as the dashboard's option list.
  easterSunday, seasonForDate, SEASON_KEYS,
  // Collectible of the week (#20) — the rotation math.
  collectibleIndexForDate, COLLECTIBLE_SERIES,
  // Musical printer (#11/#12) — the TSPL compiler is the testable artifact.
  buildTuneTspl, currentTuneName, TUNE_NAMES,
  // Exported for the golden-image suite (scripts/test-label-golden.cjs), which
  // has to render field combinations GET /preview cannot express — a visitor
  // with allergies, a step-up night, an all-fields-on torture case. Going
  // through HTTP would also make every baseline depend on the route's defaults
  // rather than on the renderer itself.
  generateLabel,
  // The thermal-logo pipeline and the group-line policy, exported so tests can
  // exercise them directly: prepareLogoForThermal against synthetic light-ink /
  // padded / blank images, effectiveHandbookGroup against TwoTimTwo's real
  // pseudo-group values ("all", "Puggles group").
  prepareLogoForThermal, effectiveHandbookGroup,
  // The security policy itself is tested through print-server/security.js;
  // re-exported here so a test can assert the server wires up the same module.
  security,
};

if (require.main === module) {
  startListening();
  // Legacy self-update: poll the repo VERSION file so /update-now + exit 99
  // can hand off to launch-awana.bat. The Electron shell does NOT get this —
  // electron-updater owns its update lifecycle (see setUpdateHandler above).
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
}
