'use strict';

// ── Security policy for the print server ──────────────────────────────────────
//
// This module is the ONE place the server's trust model lives. It is pure —
// no I/O, no Express, no timers — so scripts/test-server-helpers.cjs can
// exercise every rule directly.
//
// THE TRUST MODEL, in one sentence: the loopback interface is trusted, the
// LAN is not, and the open internet is not.
//
//   • Loopback (127.0.0.1 / ::1) — trusted. This is the Chrome extension
//     talking to http://localhost:3456, the dashboard, and the Electron
//     shell. No PIN required; these callers already run as the volunteer on
//     the volunteer's own machine.
//
//   • The LAN — untrusted. Phone check-in genuinely needs it, so it stays
//     reachable, but ONLY when the operator explicitly turns it on AND has
//     set a PIN, and then every request must carry that PIN. A church WiFi
//     (guest network included) is a room full of strangers' phones.
//
//   • Any other web page the volunteer has open — untrusted. It shares the
//     loopback interface with the extension, so the socket address cannot
//     tell them apart; the Origin header is what distinguishes them. Hence
//     the origin allowlist below, applied to reads AND writes.
//
// Why this shape: before v5.3.0 the server bound 0.0.0.0 with `cors()` wide
// open and no authentication on the roster endpoints, so a child's name and
// allergy list were readable by anyone on the venue network and by any
// website open in the volunteer's browser.

const crypto = require('crypto');

// ── Control characters ────────────────────────────────────────────────────────
// Expressed as char-code checks rather than regex escapes: this file is read
// and edited often, and a mangled \x1f in a character class fails silently in
// the direction of accepting too much.
function isControlCharCode(code) {
  return code < 0x20 || code === 0x7f;
}

function hasControlChars(value) {
  const s = String(value == null ? '' : value);
  for (let i = 0; i < s.length; i++) {
    if (isControlCharCode(s.charCodeAt(i))) return true;
  }
  return false;
}

function stripControlChars(value, replacement) {
  const s = String(value == null ? '' : value);
  const fill = replacement === undefined ? ' ' : replacement;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    out += isControlCharCode(s.charCodeAt(i)) ? fill : s[i];
  }
  return out;
}

// ── Loopback detection ────────────────────────────────────────────────────────
// Deliberately reads the raw socket address and NEVER X-Forwarded-For or
// req.ip: a forwarded header is attacker-supplied, and treating it as the peer
// address would let any LAN caller claim to be loopback and skip the PIN. If
// this server is ever put behind a real proxy, that proxy has to be modelled
// explicitly — not inferred from a header.

const LOOPBACK_RE = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

function isLoopbackAddress(addr) {
  if (!addr) return false;
  // Node hands back IPv6-mapped IPv4 ("::ffff:127.0.0.1") on dual-stack binds,
  // and may append a zone id ("::1%lo0").
  const s = String(addr).trim().split('%')[0];
  return LOOPBACK_RE.test(s);
}

function isLoopbackRequest(req) {
  const sock = req && req.socket;
  return isLoopbackAddress(sock && sock.remoteAddress);
}

// ── Origin allowlist ──────────────────────────────────────────────────────────
// Replaces `app.use(cors())`. That set `Access-Control-Allow-Origin: *`, which
// let ANY website the volunteer had open read the response body of
// /stats/tonight — names plus allergy tokens — with a single fetch().
//
// Allowed origins, and why each is needed:
//   • chrome-extension://…      the extension's options page
//   • https://*.twotimtwo.com   the content script's page origin (a fetch from
//                               a content script carries the PAGE's origin, not
//                               the extension's). Subdomain-wide because every
//                               church has its own subdomain — a fork must work
//                               without editing this list.
//   • http://<loopback-or-private-host>:<our port>   the dashboard and the
//                               phone page, which this server itself serves.
//                               Same-origin fetches need no CORS header, but
//                               browsers do send Origin on them and the
//                               mutating-request check below inspects it.
//   • anything in config.allowedOrigins (validated, opt-in)

const PRIVATE_IPV4_RE = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function isPrivateHostname(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local')) return true;               // mDNS / Bonjour name
  if (PRIVATE_IPV4_RE.test(h)) return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;  // link-local / ULA
  return false;
}

function isTwoTimTwoOrigin(url) {
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.toLowerCase();
  return h === 'twotimtwo.com' || h.endsWith('.twotimtwo.com');
}

// `extraOrigins` are exact, case-insensitive origin strings from
// config.allowedOrigins — for a church serving the phone page through
// something unusual. Wildcards are NOT accepted: an operator who pasted "*"
// would silently restore the hole this function exists to close.
function isAllowedOrigin(origin, opts) {
  if (!origin || typeof origin !== 'string') return false;
  const { port = 3456, extraOrigins = [] } = opts || {};
  const o = origin.trim();
  if (!o || o === 'null') return false;                // sandboxed iframe / file://

  if (o.startsWith('chrome-extension://')) return true;
  if (o.startsWith('moz-extension://')) return true;

  let url;
  try { url = new URL(o); } catch { return false; }

  if (isTwoTimTwoOrigin(url)) return true;

  // Our own pages. Requires BOTH our port and a private/loopback host, so a
  // hostile site merely served on port 3456 does not qualify — the old
  // `origin.endsWith(':3456')` check accepted http://evil.example:3456.
  if (url.protocol === 'http:' && String(url.port) === String(port) && isPrivateHostname(url.hostname)) {
    return true;
  }

  const normalized = `${url.protocol}//${url.host}`.toLowerCase();
  return extraOrigins.some((e) => {
    if (typeof e !== 'string' || e.includes('*')) return false;
    let candidate;
    try { candidate = new URL(e.trim()); } catch { return false; }
    return `${candidate.protocol}//${candidate.host}`.toLowerCase() === normalized;
  });
}

// Exact-match origin check for narrowly-scoped route exceptions (the lobby
// slides publish endpoint admits the display app's own https origin, nothing
// else). Deliberately NOT isAllowedOrigin: that list grants roster reads, and
// widening it for one route would widen it for every route. No wildcards, and
// the browser-facing rule stays "exact origin or nothing".
function isExactAllowedOrigin(origin, origins) {
  if (!origin || typeof origin !== 'string' || !Array.isArray(origins)) return false;
  let url;
  try { url = new URL(origin.trim()); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const normalized = `${url.protocol}//${url.host}`.toLowerCase();
  return origins.some((e) => {
    if (typeof e !== 'string' || e.includes('*') || hasControlChars(e)) return false;
    let candidate;
    try { candidate = new URL(e.trim()); } catch { return false; }
    return `${candidate.protocol}//${candidate.host}`.toLowerCase() === normalized;
  });
}

function sanitizeAllowedOrigins(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && !v.includes('*') && !hasControlChars(v))
    .map((v) => v.trim())
    .filter((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch { return false; }
    })
    .slice(0, 10);
}

// ── Cross-origin writes ───────────────────────────────────────────────────────
// A cross-origin fetch with Content-Type: application/json is preflighted, and
// a strict allowlist already fails that preflight. But a form POST (text/plain,
// no preflight) still reaches the handler, and the old code's own comment
// acknowledged that "any page the volunteer has open can POST here" — which is
// how a crafted child name could get into print-history.json and from there
// into the dashboard's innerHTML. So a mutating request carrying a
// non-allowlisted Origin is refused outright. A request with NO Origin (curl,
// the Electron shell, a same-origin navigation) is unaffected.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isMutatingMethod(method) {
  return MUTATING_METHODS.has(String(method || '').toUpperCase());
}

// ── PIN verification ──────────────────────────────────────────────────────────
// The PIN gates the roster on the LAN, so it must survive being guessed at by a
// phone in the parking lot. Three properties the old check lacked:
//   1. Fails CLOSED when unset. `if (!pin) return true` meant a default install
//      served the whole roster to the LAN with no credential at all.
//   2. Constant-time compare, so response timing does not leak the prefix.
//   3. Rate limited, so a 4-digit PIN is not brute-forceable in seconds.

function timingSafeStringEqual(a, b) {
  const ab = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ab.length !== bb.length) {
    // Compare something of equal length anyway so the mismatched-length path is
    // not measurably faster than the mismatched-content path.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 64;

function isAcceptablePin(pin) {
  const s = String(pin == null ? '' : pin);
  return s.length >= PIN_MIN_LENGTH && s.length <= PIN_MAX_LENGTH && !hasControlChars(s);
}

// Per-remote-address failure tracking. Bounded so a spoofed-source flood cannot
// grow it without limit; entries expire on their own.
//
// Repeated-identical-guess dedupe: a phone silently retrying the same stale
// PIN, or a volunteer holding down Enter, must not cost more than ONE failure
// per distinct wrong value — otherwise a handful of real mistakes plus a
// flaky retry loop reach the lockout threshold before a human ever gets a
// second try. Only the HASH of the last failed guess is kept (sha256 over a
// per-process random salt + the guess) so the limiter never holds a
// recoverable copy of an attempted PIN in memory. Distinct guesses always
// still count — this dedupes retries, it does not raise maxFailures or widen
// the brute-force window.
function createPinLimiter(opts) {
  const {
    maxFailures = 8,
    lockoutMs = 60 * 1000,
    decayMs = 15 * 60 * 1000,
    maxTracked = 512,
  } = opts || {};
  const byAddr = new Map();
  const guessSalt = crypto.randomBytes(32);

  function hashGuess(guess) {
    return crypto.createHash('sha256').update(guessSalt).update(String(guess)).digest('hex');
  }

  function prune(now) {
    for (const [addr, rec] of byAddr) {
      if (now - rec.last > decayMs) byAddr.delete(addr);
    }
    if (byAddr.size > maxTracked) {
      // Drop the least recently seen entries first.
      const sorted = [...byAddr.entries()].sort((a, b) => a[1].last - b[1].last);
      for (const [addr] of sorted.slice(0, byAddr.size - maxTracked)) byAddr.delete(addr);
    }
  }

  return {
    // Returns 0 when the caller may attempt, or the ms remaining on a lockout.
    retryAfterMs(addr, now) {
      const key = String(addr);
      const rec = byAddr.get(key);
      if (!rec || rec.failures < maxFailures) return 0;
      const remaining = rec.lockedUntil - now;
      if (remaining > 0) return remaining;
      byAddr.delete(key);              // lockout served — start fresh
      return 0;
    },
    // `guess` is the attempted PIN behind this failure. Omit it (existing
    // callers/tests) to always count as a distinct failure — dedupe only
    // engages when the caller actually has a guess to compare.
    recordFailure(addr, now, guess) {
      prune(now);
      const key = String(addr);
      const rec = byAddr.get(key) || { failures: 0, last: now, lockedUntil: 0, lastGuessHash: null };
      const guessHash = guess === undefined || guess === null ? null : hashGuess(guess);
      const isRepeatGuess = guessHash !== null && rec.lastGuessHash !== null && guessHash === rec.lastGuessHash;
      if (!isRepeatGuess) {
        rec.failures += 1;
        if (guessHash !== null) rec.lastGuessHash = guessHash;
      }
      rec.last = now;
      if (rec.failures >= maxFailures) rec.lockedUntil = now + lockoutMs;
      byAddr.set(key, rec);
      return rec;
    },
    recordSuccess(addr) {
      byAddr.delete(String(addr));
    },
    get size() { return byAddr.size; },
  };
}

// ── Bind host ─────────────────────────────────────────────────────────────────
// The old code called app.listen(PORT) with no host, which binds 0.0.0.0 —
// every interface — while the file header claimed "listens on
// http://localhost:3456". Loopback is now the default and LAN exposure is an
// explicit, PIN-gated opt-in.
//
// AWANA_BIND_HOST is an escape hatch for tests and for an operator who knows
// exactly what they are doing; it is honoured verbatim and logged at startup.
function resolveBindHost(opts) {
  const { lanAccess = false, hasPin = false, envHost = '' } = opts || {};
  const explicit = String(envHost || '').trim();
  if (explicit) {
    return {
      host: explicit,
      lan: !isLoopbackAddress(explicit),
      reason: 'AWANA_BIND_HOST',
    };
  }
  if (lanAccess && hasPin) {
    return { host: '0.0.0.0', lan: true, reason: 'lanAccess enabled with a PIN set' };
  }
  if (lanAccess && !hasPin) {
    return { host: '127.0.0.1', lan: false, reason: 'lanAccess requested but no PIN is set — refusing to expose the roster' };
  }
  return { host: '127.0.0.1', lan: false, reason: 'default (loopback only)' };
}

// ── Outbound URL validation ───────────────────────────────────────────────────
// config.checkinUrl reaches shell.openExternal() in the Electron shell and
// Start-Process in the legacy installer, and POST /config accepted it from any
// caller with no validation at all — so a poisoned config turned into an
// arbitrary URI handed to the Windows shell. Only http(s) is ever legitimate
// here (it is a check-in web page).
function isSafeExternalUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > 2048) return false;
  if (hasControlChars(s)) return false;
  let url;
  try { url = new URL(s); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;      // no credentials-in-URL
  return true;
}

// ── Stored field hygiene ──────────────────────────────────────────────────────
// Names arrive from the request body and are persisted to print-history.json,
// which the dashboard renders. The dashboard now escapes on output (that is the
// actual fix for the stored-XSS chain); this caps length and strips control
// characters so an unbounded or terminal-escape-laden value cannot bloat the
// history file or mangle a console log. It deliberately does NOT strip angle
// brackets — silently corrupting a child's name is worse than escaping it at
// the point of display, which is where correctness belongs.
const STORED_NAME_MAX = 80;

function sanitizeStoredText(value, max) {
  const limit = Number.isFinite(max) ? max : STORED_NAME_MAX;
  return stripControlChars(value, ' ').trim().slice(0, limit);
}

// ── History retention ─────────────────────────────────────────────────────────
// MAX_HISTORY bounds the row COUNT but not the age, so a quiet church kept
// every child's name and check-in time indefinitely. Prune by age too: the
// dashboard only ever shows today, and tonight's stats only need today.
const DEFAULT_HISTORY_RETENTION_DAYS = 60;

function normalizeRetentionDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_RETENTION_DAYS;
  return Math.max(1, Math.min(730, Math.round(n)));
}

function pruneHistoryByAge(history, retentionDays, now) {
  if (!Array.isArray(history)) return [];
  const days = normalizeRetentionDays(retentionDays);
  const cutoff = (typeof now === 'number' ? now : Date.now()) - days * 24 * 60 * 60 * 1000;
  return history.filter((e) => {
    if (!e || !e.timestamp) return false;              // undateable row — drop it
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
}

module.exports = {
  hasControlChars,
  stripControlChars,
  isLoopbackAddress,
  isLoopbackRequest,
  isPrivateHostname,
  isAllowedOrigin,
  isExactAllowedOrigin,
  sanitizeAllowedOrigins,
  isMutatingMethod,
  timingSafeStringEqual,
  isAcceptablePin,
  createPinLimiter,
  resolveBindHost,
  isSafeExternalUrl,
  sanitizeStoredText,
  pruneHistoryByAge,
  normalizeRetentionDays,
  PIN_MIN_LENGTH,
  PIN_MAX_LENGTH,
  STORED_NAME_MAX,
  DEFAULT_HISTORY_RETENTION_DAYS,
};
