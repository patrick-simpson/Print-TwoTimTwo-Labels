// The print server's half of the Awana sync service (the Cloudflare Worker in
// the Awana-Check-in-Display repo, worker/). Pure request helpers, no state:
// server.js owns when they run and what is persisted.
//
// Owner, 2026-10-01: one passphrase ("kennebec") sets up every screen through
// the sync service, and that includes this computer. Signed in, the print
// server:
//   - seals check-ins with the service's display key (handing the service the
//     key it already had, on its very first sign-in, so screens set up before
//     keep reading names);
//   - stops publishing the old `provision` login frame (a short word on a
//     public channel could be guessed offline: the service checks it online,
//     with guess limits, instead);
//   - stops rebroadcasting the lobby deck and the shared settings, and
//     forwards a publish made on this computer to the service, which is now
//     their one home.
// Check-ins never pass through the service.
//
// Where the service is: shared/sync.json on the display site, written by the
// display repo's deploy-worker.yml. `url: ""` means "no service yet", and then
// nothing here changes how this server behaves.

'use strict';

const DEFAULT_SYNC_INDEX = 'https://awana.kvbchurch.org/lobby/shared/sync.json';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const TIMEOUT_MS = 15000;

function isValidSyncUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 200) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

function isValidSession(value) {
  return typeof value === 'string' && SESSION_RE.test(value);
}

/** Exactly what the screens and the service apply before comparing. */
function normalizeSyncPassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
}

function fetcher(fetchFn) {
  const f = fetchFn || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('fetch is not available in this Node');
  return f;
}

/**
 * The service's address, or '' for "none yet". null when the index could not
 * be read at all (offline): the caller keeps whatever it knew.
 */
async function resolveSyncUrl({ fetchFn, indexUrl = DEFAULT_SYNC_INDEX } = {}) {
  try {
    const res = await fetcher(fetchFn)(indexUrl, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    const url = typeof body?.url === 'string' ? body.url.trim().replace(/\/+$/, '') : '';
    if (url === '') return '';
    return isValidSyncUrl(url) ? url : null;
  } catch {
    return null;
  }
}

/** One request. Never throws; status 0 means unreachable. */
async function syncRequest(base, path, { method = 'GET', body, session, fetchFn } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session) headers.Authorization = `Bearer ${session}`;
  try {
    const res = await fetcher(fetchFn)(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let parsed = null;
    try { parsed = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * Sign in. `seedKey` is the display key this server already seals with; the
 * service adopts it only if it has none yet.
 * @returns {Promise<{ok: true, session: string, displayKey: string}
 *   | {ok: false, status: number, reason: string, error: string, triesLeft?: number, retryAfterSec?: number}>}
 */
async function syncLogin(base, passphrase, { seedKey, fetchFn } = {}) {
  const body = { passphrase: normalizeSyncPassphrase(passphrase) };
  if (seedKey) body.seedKey = String(seedKey).trim();
  const res = await syncRequest(base, '/v1/login', { method: 'POST', body, fetchFn });
  const b = res.body || {};
  if (res.status === 0) return { ok: false, status: 0, reason: 'unreachable', error: 'Could not reach the sync service. Check this computer\'s internet connection.' };
  if (res.status === 401) {
    const out = { ok: false, status: 401, reason: 'wrong', error: 'That is not the passphrase.' };
    if (Number.isFinite(Number(b.triesLeft))) out.triesLeft = Number(b.triesLeft);
    return out;
  }
  if (res.status === 429) return { ok: false, status: 429, reason: 'locked', error: 'Too many wrong tries. Wait a little, then try again.', retryAfterSec: Number(b.retryAfterSec) || 900 };
  if (!res.ok || !isValidSession(b.session) || typeof b.displayKey !== 'string') {
    return { ok: false, status: res.status, reason: 'rejected', error: typeof b.error === 'string' ? b.error : `The sync service answered HTTP ${res.status}.` };
  }
  return { ok: true, session: b.session, displayKey: b.displayKey.trim() };
}

/** Is this sign-in still good? 'ok' | 'signed-out' | 'unreachable'. */
async function syncCheck(base, session, { fetchFn } = {}) {
  const res = await syncRequest(base, '/v1/state', { session, fetchFn });
  if (res.status === 401) return 'signed-out';
  return res.ok ? 'ok' : 'unreachable';
}

/** Forward a lobby deck or the shared settings to the service. */
async function syncPublish(base, session, kind, payload, { fetchFn } = {}) {
  return syncRequest(base, `/v1/${kind}`, {
    method: 'PUT',
    body: kind === 'settings' ? { settings: payload } : { slides: payload },
    session,
    fetchFn,
  });
}

module.exports = {
  DEFAULT_SYNC_INDEX,
  isValidSyncUrl,
  isValidSession,
  normalizeSyncPassphrase,
  resolveSyncUrl,
  syncRequest,
  syncLogin,
  syncCheck,
  syncPublish,
};
