(function() {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  const EXTENSION_VERSION = '5.8.1';
  const PRINT_COOLDOWN = 2000;
  // POST /print is synchronous on the server: PowerShell + a cold printer can
  // take 15-30 s (the server retries the spooler internally). This must sit
  // ABOVE that worst case — aborting a print that is still succeeding and
  // retrying it is exactly what double-printed labels. The server also
  // suppresses same-name duplicates as a second layer of defence.
  const PRINT_TIMEOUT_MS = 35000;
  const BATCH_DELAY = 400;
  const DEBOUNCE_MS = 100;
  const STATUS_TIMEOUT = 3000;
  const PRINT_SERVER = 'http://localhost:3456';
  const STORAGE_KEY = 'awana_selectedPrinterId';
  const MINIMIZE_KEY = 'awana_widgetMinimized';
  const PRINTER_KEY  = 'awana_selectedPrinterName';

  const QUEUE_KEY      = 'awana_printQueue';
  const MUTE_KEY       = 'awana_soundMuted';
  const QUICK_MODE_KEY = 'awana_quickMode';
  const STEP_UP_KEY    = 'awana_stepUpMode'; // 'auto' | 'on' | 'off'
  const STORE_KEY      = 'awana_storeMode';  // 'auto' | 'on' | 'off'

  let selectedMode        = localStorage.getItem(STORAGE_KEY) || 'auto';
  let selectedPrinterName = localStorage.getItem(PRINTER_KEY) || '';
  let soundMuted          = localStorage.getItem(MUTE_KEY) === 'true';
  let quickModeEnabled    = localStorage.getItem(QUICK_MODE_KEY) === 'true';
  let stepUpMode          = localStorage.getItem(STEP_UP_KEY) || 'auto';
  let storeMode           = localStorage.getItem(STORE_KEY) || 'auto';
  let lastPrintedName = null;
  var batchPrintedNames = new Set();
  // R-1: reconcile-against-checkin_report state (see scheduleReconcile at the
  // bottom of the file). Declared here so loadPrintedState can restore
  // reconcileBaselineDone before the roster/reconcile passes ever run.
  var reconcileBaselineDone = false;
  var reconcileInFlight = false;

  // ── Remote check-in detection state ────────────────────────────────────────
  // The .clubber list on TwoTimTwo.com shrinks when a kid is checked in on
  // ANY device.  By diffing the visible set between scans we can detect
  // check-ins that happened on a phone/other laptop and print their label
  // here.  A session-scoped "printed" set dedupes against the existing
  // #lastCheckin detection path so locally-checked-in kids aren't reprinted.
  // R-4: ROSTER_CACHE, printedNames, knownClubbers, pendingMissing and
  // batchPrintedNames are all keyed by a stable *identity key* — 'id:<recid>'
  // when TwoTimTwo's own clubber id is known, else 'nm:<lowercased name>' for
  // walk-ins / offline-cached entries that have no recid. This is what keeps
  // two kids who share a first+last name from collapsing into one entry.
  // ROSTER_CACHE must still be searchable by name (widget search, sibling
  // lookups), so ROSTER_NAME_INDEX is a secondary nameKey → identityKey index.
  var ROSTER_CACHE      = {};          // { identityKey: { displayName, clubName, clubImageData, recid, clubId, element } }
  // { nameKeyLower: identityKey | AMBIGUOUS_NAME }. Two children really can
  // share a display name (twins, cousins, two unrelated Jane Does). A
  // single-valued index silently resolved such a name to whichever row was
  // scanned last, which meant a label could print with the OTHER child's club
  // and consent data while marking that child printed — so she then never got
  // a label at all. When a name maps to more than one clubber id we record the
  // collision instead and refuse to guess: callers fall back to the name key,
  // which prints the right name and never attributes one child's safety data
  // to another.
  // Local calendar date (YYYY-MM-DD). Must be local, not UTC: after 7pm ET a
  // UTC date is already tomorrow, which would ask TwoTimTwo for the wrong
  // meeting mid-club.
  function todayIsoDate() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  var AMBIGUOUS_NAME = '*ambiguous*';
  var ROSTER_NAME_INDEX = {};
  var knownClubbers   = new Set();   // last-seen identity keys
  var printedNames    = new Set();   // session dedup, identity keys
  var baselineScanned = false;
  // A kid must be missing from at least this many consecutive scans before the
  // roster-diff path is allowed to print their label. This defends against
  // transient disappearances (search filter, scroll virtualization, page
  // re-render) that are NOT real check-ins.
  var PENDING_MISS_THRESHOLD = 2;
  // Map<nameKey, consecutiveMissCount>
  var pendingMissing  = new Map();
  // If >= this fraction of the known roster disappears in a single scan, treat
  // it as a UI reshuffle (filter / tab switch / reload with filter active) and
  // re-baseline instead of printing anyone.
  var MASS_DISAPPEAR_RATIO = 0.8;
  // Any roster shrink that crosses the 80 % ratio is treated as a UI
  // reshuffle. Set abs threshold to 1 (was 3) so small clubs (≤10 kids) are
  // protected from search-filter phantom prints — a real check-in only loses
  // 1 kid at a time, so a 50-kid roster never shrinks to <80 % from a single
  // checkin and a legitimate single check-in still flows through guard B.
  var MASS_DISAPPEAR_ABS   = 1;
  var REMOTE_PRINTED_KEY  = 'awana_printedNames';
  var REMOTE_PRINTED_TS   = 'awana_printedTs';
  var REMOTE_BASELINE_KEY = 'awana_baselineDone';
  var REMOTE_KNOWN_KEY    = 'awana_knownClubbers';
  var REMOTE_ROSTER_KEY   = 'awana_rosterCache';
  var REMOTE_STALE_MS     = 4 * 60 * 60 * 1000; // 4h idle resets dedup (new event night)
  var SCAN_INTERVAL_MS    = 5000;
  var AUTO_REFRESH_INTERVAL_MS = 30000;
  // R-1: separate baseline flag for the checkin_report reconcile pass — kept
  // next to the roster-diff baseline key but tracked independently so a
  // reload can't re-trigger the "first pass never prints" seeding twice.
  var REMOTE_RECONCILE_BASELINE_KEY = 'awana_reconcileBaselineDone';

  // ── R-4: stable identity keys ───────────────────────────────────────────
  // Internal whitespace is collapsed, not just trimmed: the check-in report's
  // name sits between two links in the markup, so its text can come back with
  // padding or a line break inside it ("Jane  Doe") while the roster row reads
  // "Jane Doe". Keying those differently would make reconcile treat one child
  // as two and print a duplicate label.
  function nameKeyOf(name) {
    return String(name == null ? '' : name).toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function identityKey(recid, displayName) {
    return recid ? ('id:' + recid) : ('nm:' + nameKeyOf(displayName));
  }
  // Older sessionStorage payloads (pre-identity-key) stored bare lowercased
  // names with no prefix. Treat anything without an 'id:'/'nm:' prefix as an
  // 'nm:' key so a mid-event extension update doesn't reprint everyone.
  function migrateLegacyKey(v) {
    if (typeof v !== 'string') return v;
    return (/^(id:|nm:)/).test(v) ? v : ('nm:' + v);
  }
  // Resolve the identity key for a name, preferring an explicitly-known recid,
  // else looking the name up in ROSTER_NAME_INDEX (populated by scanClubberList
  // whenever the kid has been seen on the live roster), else falling back to
  // the name-only key.
  function resolveIdentityKey(name, recid) {
    if (recid == null) {
      var idk = ROSTER_NAME_INDEX[nameKeyOf(name)];
      if (idk && idk !== AMBIGUOUS_NAME) recid = idk.indexOf('id:') === 0 ? idk.slice(3) : null;
    }
    return identityKey(recid, name);
  }
  function isPrinted(name, recid) {
    if (printedNames.has(resolveIdentityKey(name, recid))) return true;
    // A label printed before this station knew the child's TwoTimTwo id was
    // recorded under a name key — a hand-typed walk-in is the common case, and
    // registering that walk-in (the F-3 checkbox) then checks them in, so they
    // come back from the check-in report carrying a real id. Without this
    // fallback the id-keyed lookup misses the name-keyed record and reconcile
    // prints a SECOND label for the same child.
    return printedNames.has('nm:' + nameKeyOf(name));
  }
  // Secondary name → identityKey index lookup, so ROSTER_CACHE (keyed by
  // identity) stays reachable from code that only has a display name (widget
  // search, sibling matching, doPrint's clubberId lookup).
  function rosterLookupByName(name) {
    var idk = ROSTER_NAME_INDEX[nameKeyOf(name)];
    if (!idk || idk === AMBIGUOUS_NAME) return null;
    return ROSTER_CACHE[idk] || null;
  }

  function loadPrintedState() {
    try {
      var ts = parseInt(sessionStorage.getItem(REMOTE_PRINTED_TS) || '0', 10);
      if (ts && Date.now() - ts < REMOTE_STALE_MS) {
        var arr = JSON.parse(sessionStorage.getItem(REMOTE_PRINTED_KEY) || '[]');
        if (Array.isArray(arr)) printedNames = new Set(arr.map(migrateLegacyKey));
        baselineScanned = sessionStorage.getItem(REMOTE_BASELINE_KEY) === '1';
        reconcileBaselineDone = sessionStorage.getItem(REMOTE_RECONCILE_BASELINE_KEY) === '1';
        // Restore knownClubbers + ROSTER_CACHE so diff survives a reload.
        var knownArr = JSON.parse(sessionStorage.getItem(REMOTE_KNOWN_KEY) || '[]');
        if (Array.isArray(knownArr)) knownClubbers = new Set(knownArr.map(migrateLegacyKey));
        var rosterObj = JSON.parse(sessionStorage.getItem(REMOTE_ROSTER_KEY) || '{}');
        if (rosterObj && typeof rosterObj === 'object') {
          ROSTER_CACHE = {};
          ROSTER_NAME_INDEX = {};
          Object.keys(rosterObj).forEach(function(k) {
            var v = rosterObj[k];
            // Pre-identity-key persisted caches were keyed by bare name.
            var idk = (/^(id:|nm:)/).test(k) ? k : identityKey(v && v.recid, (v && v.displayName) || k);
            ROSTER_CACHE[idk] = v;
            if (v && v.displayName) ROSTER_NAME_INDEX[nameKeyOf(v.displayName)] = idk;
          });
        }
      } else {
        sessionStorage.removeItem(REMOTE_PRINTED_KEY);
        sessionStorage.removeItem(REMOTE_PRINTED_TS);
        sessionStorage.removeItem(REMOTE_BASELINE_KEY);
        sessionStorage.removeItem(REMOTE_KNOWN_KEY);
        sessionStorage.removeItem(REMOTE_ROSTER_KEY);
        sessionStorage.removeItem(REMOTE_RECONCILE_BASELINE_KEY);
      }
    } catch (e) { /* ignore sessionStorage errors */ }
  }

  var rosterDirty = false;
  function saveScanState() {
    try {
      sessionStorage.setItem(REMOTE_KNOWN_KEY, JSON.stringify(Array.from(knownClubbers)));
      if (rosterDirty) {
        sessionStorage.setItem(REMOTE_ROSTER_KEY, JSON.stringify(ROSTER_CACHE));
        persistRosterLocal();
        rosterDirty = false;
      }
    } catch (e) { /* ignore quota errors */ }
  }

  // ── Offline roster cache ────────────────────────────────────────────────────
  // The scraped roster is persisted to chrome.storage.local (survives tab
  // closes and browser restarts) so widget search and label printing still
  // work if TwoTimTwo or the venue Wi-Fi goes down mid-event and the page
  // can no longer render its .clubber list.
  var ROSTER_LOCAL_KEY = 'awana_rosterCacheLocal';
  var ROSTER_LOCAL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // two weeks

  function persistRosterLocal() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      var entries = Object.keys(ROSTER_CACHE).slice(0, 400).map(function(k) {
        var m = ROSTER_CACHE[k];
        return { displayName: m.displayName, clubName: m.clubName || '', clubImageData: m.clubImageData || null, recid: m.recid || null, clubId: m.clubId || null };
      });
      var payload = {};
      payload[ROSTER_LOCAL_KEY] = { ts: Date.now(), entries: entries };
      chrome.storage.local.set(payload);
    } catch (e) { /* storage full — non-critical */ }
  }

  function restoreRosterFromLocal() {
    if (Object.keys(ROSTER_CACHE).length > 0) return; // live roster present
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(ROSTER_LOCAL_KEY, function(result) {
      var saved = result && result[ROSTER_LOCAL_KEY];
      if (!saved || !Array.isArray(saved.entries)) return;
      if (Date.now() - (saved.ts || 0) > ROSTER_LOCAL_MAX_AGE_MS) return;
      if (Object.keys(ROSTER_CACHE).length > 0) return; // roster appeared meanwhile
      saved.entries.forEach(function(m) {
        if (!m || !m.displayName) return;
        var idk = identityKey(m.recid, m.displayName);
        ROSTER_CACHE[idk] = {
          displayName: m.displayName, clubName: m.clubName || '',
          clubImageData: m.clubImageData || null, element: null,
          recid: m.recid || null, clubId: m.clubId || null
        };
        ROSTER_NAME_INDEX[nameKeyOf(m.displayName)] = idk;
      });
      console.log('[Awana] Restored ' + saved.entries.length + ' roster entries from local cache (offline mode)');
    });
  }

  function markPrinted(name, recid) {
    if (!name || !name.trim()) return;
    var key = resolveIdentityKey(name, recid);
    printedNames.add(key);
    try {
      sessionStorage.setItem(REMOTE_PRINTED_KEY, JSON.stringify(Array.from(printedNames)));
      sessionStorage.setItem(REMOTE_PRINTED_TS, String(Date.now()));
    } catch (e) { /* ignore quota errors */ }
  }

  function isUndo(text) {
    return text && text.toLowerCase().includes('undo');
  }

  // Step Up Night — the one Wednesday a year when kids whose age/grade puts
  // them in a different club next year get a "Stepping up to X" label.
  // Detection: scan the TwoTimTwo page for "step up" text (case-insensitive)
  // outside our own widget. The widget toggle ('auto' | 'on' | 'off') lets
  // the volunteer override either way.
  function scanCalendarFor(pattern) {
    var headings = document.querySelectorAll(
      'h1, h2, h3, h4, [class*="event"], [class*="club-night"], [class*="theme"], [class*="title"], [class*="header"], #event-name, #club-night'
    );
    for (var i = 0; i < headings.length; i++) {
      var el = headings[i];
      // #awana-widget is the id injectWidget() actually assigns — the old
      // '#awana-printer-widget' never matched anything, so our own panel text
      // was scanned as if it were page content.
      if (el.closest && el.closest('#awana-widget')) continue;
      if (el.id === 'awana-search-input') continue;
      if (!el.offsetParent && el.tagName !== 'TITLE') continue;
      var text = el.innerText || el.textContent || '';
      if (pattern.test(text)) return true;
    }
    return false;
  }

  function isStepUpNight() {
    if (stepUpMode === 'on')  return true;
    if (stepUpMode === 'off') return false;
    return scanCalendarFor(/step\s*up/i);
  }

  // Awana Store Night — kids spend their accumulated shares ("shekels") at
  // a small in-house store. On these nights the label gets a small 🪙 N
  // badge in the bottom-right icon strip, sourced from TwoTimTwo's own
  // share-balance report (one CSV per club, fetched with the volunteer's
  // logged-in session). The +1 reflects tonight's attendance share.
  function isAwanaStoreNight() {
    if (storeMode === 'on')  return true;
    if (storeMode === 'off') return false;
    return scanCalendarFor(/store/i);
  }

  // Share-balance cache. Populated by fetchShareBalances() when a Store
  // Night becomes active. byKey is normalized "first last" → integer.
  var SHARES = { byKey: {}, fetchedAt: 0, fetching: false, lastError: null };
  var SHARES_TTL_MS = 5 * 60 * 1000;
  // Shares club ids now live in CHURCH_CFG (server church-config.json).

  function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Tiny CSV parser — these files are simple, trusted, same-origin, two
  // columns ("Name","Balance"). Returns array of [name, balance] pairs,
  // skipping header. Bails on anything that doesn't look like CSV (e.g.
  // a login redirect HTML page).
  function parseShareCsv(text) {
    if (!text || /<\s*html/i.test(text.slice(0, 200))) return [];
    var lines = text.split(/\r?\n/);
    var out = [];
    for (var i = 1; i < lines.length; i++) {  // skip header
      var line = lines[i].trim();
      if (!line) continue;
      // Match "Name","Balance" — balance may be empty
      var m = line.match(/^"([^"]*)","([^"]*)"\s*$/);
      if (!m) continue;
      out.push([m[1], m[2]]);
    }
    return out;
  }

  function fetchShareBalances() {
    if (SHARES.fetching) return Promise.resolve();
    SHARES.fetching = true;
    var byKey = {};
    var origin = location.origin;  // e.g. https://kvbchurch.twotimtwo.com
    return Promise.all(CHURCH_CFG.sharesClubIds.map(function(id) {
      var url = origin + '/report/shekelBalance?club_id=' + id + '&output=csv';
      return fetch(url, { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.text() : ''; })
        .then(function(txt) {
          parseShareCsv(txt).forEach(function(row) {
            var key = normalizeName(row[0]);
            if (!key) return;
            var bal = parseInt(row[1], 10);
            byKey[key] = isNaN(bal) ? 0 : bal;
          });
        })
        .catch(function(e) {
          console.warn('[Awana] Share balance fetch failed for club ' + id + ':', e.message);
        });
    })).then(function() {
      SHARES.byKey = byKey;
      SHARES.fetchedAt = Date.now();
      SHARES.lastError = null;
      var count = Object.keys(byKey).length;
      console.log('[Awana] Loaded share balances:', count, 'kids across', CHURCH_CFG.sharesClubIds.length, 'clubs');
      return byKey;
    }).catch(function(e) {
      SHARES.lastError = e.message;
      console.warn('[Awana] Share balance load failed:', e.message);
    }).then(function(v) {
      SHARES.fetching = false;
      return v;
    });
  }

  // Kicks off a refresh if cache is stale; returns whatever we have right
  // now without blocking. Returns null if the kid isn't in any CSV (per
  // user's "no badge for unknown kids" rule).
  function getShareBalance(firstName, lastName) {
    if (Date.now() - SHARES.fetchedAt > SHARES_TTL_MS) fetchShareBalances();
    var key = normalizeName(firstName + ' ' + lastName);
    return Object.prototype.hasOwnProperty.call(SHARES.byKey, key) ? SHARES.byKey[key] : null;
  }

  // ── Audio feedback ──────────────────────────────────────────────────────────
  var audioCtx = null;
  function playTone(freq, duration, type) {
    if (soundMuted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (duration || 0.2));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + (duration || 0.2));
    } catch (e) { /* audio not available */ }
  }
  function playSuccess() { playTone(880, 0.12); setTimeout(function() { playTone(1108, 0.15); }, 120); }
  function playError() { playTone(330, 0.3, 'square'); }

  // ── Offline print queue ────────────────────────────────────────────────────
  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
  }
  function saveQueue(q) {
    if (q.length > 50) q.length = 50;
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    updateQueueBadge();
  }
  function queuePrint(payload) {
    var q = getQueue();
    q.push(payload);
    saveQueue(q);
    console.log('[Awana] Queued print for later (' + q.length + ' in queue)');
  }
  function flushQueue() {
    var q = getQueue();
    if (q.length === 0) return;
    console.log('[Awana] Flushing ' + q.length + ' queued print(s)');
    var item = q.shift();
    saveQueue(q);
    // Drop any queued item whose target was already printed in this session
    // (or carried over via sessionStorage). Without this, a queue persisted in
    // localStorage across a browser crash can replay a label that another path
    // (onCheckin / roster diff / Pusher) has already produced.
    var hasName = !!(item && item.name);
    var idKey = hasName ? resolveIdentityKey(item.name, item.clubberId) : null;
    if (idKey && printedNames.has(idKey)) {
      console.log('[Awana] Dropping queued print (already printed this session):', item.name);
      if (getQueue().length > 0) setTimeout(flushQueue, PRINT_COOLDOWN);
      return;
    }
    fetch(PRINT_SERVER + '/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
    }).then(function(r) {
      if (r.ok) {
        if (idKey) markPrinted(item.name, item.clubberId);
        playSuccess();
        console.log('[Awana] Flushed queued print: ' + item.name);
        if (getQueue().length > 0) setTimeout(flushQueue, PRINT_COOLDOWN);
      } else {
        // Put it back
        var q2 = getQueue(); q2.unshift(item); saveQueue(q2);
      }
    }).catch(function() {
      var q2 = getQueue(); q2.unshift(item); saveQueue(q2);
    });
  }
  function updateQueueBadge() {
    var badge = document.getElementById('awana-queue-badge');
    var q = getQueue();
    if (badge) {
      badge.textContent = q.length > 0 ? q.length + ' queued' : '';
      badge.style.display = q.length > 0 ? 'block' : 'none';
    }
  }

  // ── Sibling detection ─────────────────────────────────────────────────────
  // Tries the print server's CSV-based family index first (handles blended
  // families / different last names).  Falls back to DOM last-name matching
  // if the server is unreachable or returns no results.
  async function findSiblings(fullName) {
    // 1. Try server CSV family-index lookup.
    // If the server responds (even with an empty list), trust it — the CSV family
    // index uses HouseholdID / PrimaryContact / Guardian / Address before falling
    // back to LastName, so it correctly separates families that share a last name
    // (e.g. two unrelated Miller families).  Only fall back to DOM last-name
    // matching when the server is unreachable or times out.
    var serverReachable = false;
    // R-4: pass along TwoTimTwo's own clubber id for this kid when known — the
    // server accepts it for an exact-identity lookup and ignores it otherwise.
    var selfMeta = rosterLookupByName(fullName);
    var clubberIdParam = (selfMeta && selfMeta.recid) ? ('&clubberId=' + encodeURIComponent(selfMeta.recid)) : '';
    try {
      var resp = await fetch(PRINT_SERVER + '/siblings?name=' + encodeURIComponent(fullName) + clubberIdParam,
        { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        serverReachable = true;
        var data = await resp.json();
        if (data.siblings && data.siblings.length > 0) {
          var serverSiblings = [];
          var clubberEls = document.querySelectorAll('.clubber');
          data.siblings.forEach(function(sibName) {
            for (var i = 0; i < clubberEls.length; i++) {
              var nameEl = clubberEls[i].querySelector('.name');
              if (!nameEl) continue;
              var domName = nameEl.innerText.trim();
              if (domName.toLowerCase() === sibName.toLowerCase()) {
                var imgEl = clubberEls[i].querySelector('.club img');
                var clubName = imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
                serverSiblings.push({ name: domName, clubName: clubName, element: clubberEls[i] });
                break;
              }
            }
          });
          return serverSiblings; // may be empty if none found in DOM
        }
        // Server responded with empty siblings — respect that; do NOT fall back
        // to last-name DOM matching, which would incorrectly group separate families.
        return [];
      }
    } catch (_e) { /* server unavailable or timed out — fall through */ }

    // 2. Fallback: match by shared last name in the DOM.
    // Only used when the server could not be reached (offline / not running).
    if (serverReachable) return [];
    var parts = fullName.trim().split(/\s+/);
    if (parts.length < 2) return [];
    var lastName = parts.slice(1).join(' ').toLowerCase();
    var siblings = [];
    var clubbers = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubbers.length; i++) {
      var nameEl = clubbers[i].querySelector('.name');
      if (!nameEl) continue;
      var name = nameEl.innerText.trim();
      if (name === fullName) continue; // skip self
      var nameParts = name.split(/\s+/);
      if (nameParts.length < 2) continue;
      var sibLast = nameParts.slice(1).join(' ').toLowerCase();
      if (sibLast === lastName) {
        var imgEl = clubbers[i].querySelector('.club img');
        var clubName = imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
        siblings.push({ name: name, clubName: clubName, element: clubbers[i] });
      }
    }
    return siblings;
  }

  function showSiblingPanel(siblings, checkedInName) {
    // Remove existing panel
    var existing = document.getElementById('awana-sibling-panel');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'awana-sibling-panel';
    Object.assign(overlay.style, {
      position: 'fixed', top: '55px', right: '12px', zIndex: '100000',
      background: '#fff', border: '1px solid #c8e6c9', borderRadius: '10px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: '260px',
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px'
    });

    var header = document.createElement('div');
    Object.assign(header.style, {
      padding: '10px 14px', background: '#4caf50', color: '#fff',
      borderRadius: '10px 10px 0 0', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', fontWeight: '700', fontSize: '13px'
    });
    header.textContent = 'Also here tonight?';

    var closeX = document.createElement('button');
    Object.assign(closeX.style, {
      background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
      width: '22px', height: '22px', borderRadius: '50%', cursor: 'pointer',
      fontSize: '14px', lineHeight: '22px', textAlign: 'center', padding: '0'
    });
    closeX.innerHTML = '&#x2715;';
    closeX.addEventListener('click', function() { overlay.remove(); });
    header.appendChild(closeX);

    var body = document.createElement('div');
    Object.assign(body.style, { padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' });

    var subtitle = document.createElement('div');
    Object.assign(subtitle.style, { fontSize: '11px', color: '#64748b', marginBottom: '4px' });
    subtitle.textContent = 'Siblings of ' + checkedInName + ':';
    body.appendChild(subtitle);

    // Puggles and Cubbies don't have Bible or Friend check-in options.
    function isYoungClub(clubName) {
      var n = (clubName || '').toLowerCase();
      return n.includes('puggle') || n.includes('cubbie');
    }

    var checkboxes = [];
    siblings.forEach(function(sib) {
      var row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
        background: '#f8fafc', borderRadius: '6px'
      });
      var includeCb = document.createElement('input');
      includeCb.type = 'checkbox';
      includeCb.checked = true;
      includeCb.style.flexShrink = '0';
      var nameSpan = document.createElement('span');
      nameSpan.style.fontWeight = '600';
      nameSpan.style.flex = '1';
      nameSpan.textContent = sib.name;
      var clubSpan = document.createElement('span');
      Object.assign(clubSpan.style, { fontSize: '11px', color: '#64748b' });
      clubSpan.textContent = sib.clubName || '';

      // Puggles / Cubbies have no Bible or Friend check-in option
      var young = isYoungClub(sib.clubName);
      var bibleCb = { checked: false };
      var friendCb = { checked: false };

      if (!young) {
        // Per-sibling checkboxes on the right
        var bibleLbl = document.createElement('label');
        Object.assign(bibleLbl.style, {
          display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px',
          cursor: 'pointer', flexShrink: '0'
        });
        var realBibleCb = document.createElement('input');
        realBibleCb.type = 'checkbox';
        realBibleCb.checked = true;
        bibleCb = realBibleCb;
        var bibleSpan = document.createElement('span');
        bibleSpan.textContent = 'Bible';
        bibleLbl.append(realBibleCb, bibleSpan);

        var friendLbl = document.createElement('label');
        Object.assign(friendLbl.style, {
          display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px',
          cursor: 'pointer', flexShrink: '0'
        });
        var realFriendCb = document.createElement('input');
        realFriendCb.type = 'checkbox';
        realFriendCb.checked = false;
        friendCb = realFriendCb;
        var friendSpan = document.createElement('span');
        friendSpan.textContent = 'Friend';
        friendLbl.append(realFriendCb, friendSpan);

        row.append(includeCb, nameSpan, clubSpan, bibleLbl, friendLbl);
      } else {
        row.append(includeCb, nameSpan, clubSpan);
      }

      body.appendChild(row);
      checkboxes.push({ checkbox: includeCb, sibling: sib, bibleCb: bibleCb, friendCb: friendCb });
    });

    var btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '8px', marginTop: '6px' });

    var checkInBtn = document.createElement('button');
    checkInBtn.textContent = 'Check In Selected';
    Object.assign(checkInBtn.style, {
      flex: '1', padding: '8px', background: '#4caf50', color: '#fff',
      border: 'none', borderRadius: '6px', cursor: 'pointer',
      fontWeight: '700', fontSize: '12px'
    });
    checkInBtn.addEventListener('click', function() {
      var selected = checkboxes
        .filter(function(c) { return c.checkbox.checked; })
        .map(function(c) {
          return Object.assign({}, c.sibling, { options: { Bible: c.bibleCb.checked, Friend: c.friendCb.checked } });
        });
      overlay.remove();
      if (selected.length > 0) {
        batchCheckInSiblings(selected);
      }
    });

    var skipBtn = document.createElement('button');
    skipBtn.textContent = 'Skip';
    Object.assign(skipBtn.style, {
      padding: '8px 14px', background: '#f1f5f9', color: '#475569',
      border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer',
      fontWeight: '600', fontSize: '12px'
    });
    skipBtn.addEventListener('click', function() { overlay.remove(); });

    btnRow.append(checkInBtn, skipBtn);
    body.appendChild(btnRow);
    overlay.append(header, body);
    document.body.appendChild(overlay);
  }

  function applyCheckinOptions(modalContainer, options) {
    if (!options || !modalContainer) return;
    // Map panel option keys to regex patterns that match modal checkbox labels
    var optionPatterns = {
      'Bible':   /bible/i,
      'Friend':  /friend|brought/i
    };
    var allCheckboxes = modalContainer.querySelectorAll('input[type="checkbox"]');
    allCheckboxes.forEach(function(cb) {
      // Resolve label text: prefer wrapping <label>, then label[for=id], then adjacent text
      var labelText = '';
      var lbl = cb.closest('label');
      if (!lbl && cb.id) lbl = document.querySelector('label[for="' + cb.id + '"]');
      if (lbl) {
        labelText = lbl.textContent || '';
      } else if (cb.nextSibling) {
        labelText = (cb.nextSibling.textContent || cb.nextSibling.nodeValue || '');
      }
      Object.keys(options).forEach(function(key) {
        if (!options[key]) return;
        var pattern = optionPatterns[key];
        if (pattern && pattern.test(labelText) && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
          cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      });
    });
  }

  // ── F-2: direct check-in API ─────────────────────────────────────────────
  // Mirrors TwoTimTwo's own POST /clubber/checkinclubber (docs/TWOTIMTWO.md
  // §2.2/§2.3) instead of clicking the .clubber row and polling for the
  // modal's button#checkin. Used by batchCheckInSiblings / executePhoneAction /
  // Quick Mode; each falls back to the original click-and-poll dance whenever
  // the calendar id or CSRF token can't be found, or the POST doesn't verify —
  // a TwoTimTwo redesign must degrade check-in, never break it outright.
  function findCsrfToken() {
    // Yii 1.x injects one page-wide CSRF field (name fixed by the app's
    // csrfTokenName config — 'YII_CSRF_TOKEN' here, same name the login form
    // uses per docs/TWOTIMTWO.md §1) into any form it renders when CSRF
    // protection is on.
    var el = document.querySelector('input[name="YII_CSRF_TOKEN"]');
    return el && el.value ? el.value : null;
  }

  // Reads #checkinForm's own '.event' checkboxes (docs §2.2) and returns the
  // events[] values to submit: automatic="1" items (e.g. Attendance) always,
  // any explicit Bible/Friend `options` next, else whatever the DOM's live
  // checkbox state is. An event whose clubs="…" CSV doesn't include this
  // clubber's club_id is skipped entirely, even if its checkbox happens to be
  // checked — that CSV is what keeps a stale, previously-club's selection
  // from leaking into this child's submission.
  function collectApplicableEvents(clubId, options) {
    var out = [];
    var form = document.getElementById('checkinForm');
    if (!form) return out;
    var inputs = form.querySelectorAll('input.event[name="events[]"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var clubsAttr = (input.getAttribute('clubs') || '').split(',')
        .map(function(s) { return s.trim(); }).filter(Boolean);
      var appliesToClub = clubsAttr.length === 0 || (clubId != null && clubsAttr.indexOf(String(clubId)) !== -1);
      if (!appliesToClub) continue;
      var isAutomatic = input.getAttribute('automatic') === '1';
      var include = isAutomatic || input.checked;
      if (options) {
        var lbl = input.closest('label');
        if (!lbl && input.id) lbl = document.querySelector('label[for="' + input.id + '"]');
        var labelText = lbl ? (lbl.textContent || '') : (input.nextSibling ? (input.nextSibling.textContent || '') : '');
        if (/bible/i.test(labelText) && Object.prototype.hasOwnProperty.call(options, 'Bible')) include = options.Bible;
        if (/friend|brought/i.test(labelText) && Object.prototype.hasOwnProperty.call(options, 'Friend')) include = options.Friend;
      }
      if (include && input.value) out.push(input.value);
    }
    return out;
  }

  // POSTs the real check-in directly. Resolves true only once the row has
  // actually vanished from the roster (the same success signal the
  // click-and-poll path uses) — a truthy HTTP response alone isn't trusted.
  function driveCheckinDirect(clubberId, childName, clubId, options) {
    if (!clubberId) return Promise.resolve(false);
    var calInput = document.getElementById('calendar_id');
    var calendarId = calInput && calInput.value;
    var csrfToken = findCsrfToken();
    if (!calendarId || !csrfToken) return Promise.resolve(false);

    var body = 'clubber_id=' + encodeURIComponent(clubberId) +
      '&calendar_id=' + encodeURIComponent(calendarId);
    collectApplicableEvents(clubId, options).forEach(function(v) {
      body += '&events%5B%5D=' + encodeURIComponent(v);
    });
    body += '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);

    return fetch('/clubber/checkinclubber', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      signal: AbortSignal.timeout(8000)
    }).then(function(r) {
      if (!r.ok) return false;
      return r.text();
    }).then(function(text) {
      if (!text) return false;
      var firstName = (childName || '').trim().split(/\s+/)[0] || '';
      var ok = firstName ? text.indexOf(firstName) !== -1 : true;
      if (!ok) return false;
      // Drop the row ourselves. TwoTimTwo removes a checked-in child's row from
      // its own AJAX success handler — which never runs here, because posting
      // directly is the whole point of this path. Without this the row stays
      // put forever, the caller's "did the row disappear?" verification always
      // times out, and it falls back to the click-and-poll dance — checking the
      // child in a SECOND time and double-crediting their events.
      var row = findClubberElByName(childName);
      if (row && row.parentNode) row.parentNode.removeChild(row);
      return true;
    }).catch(function() {
      return false;
    });
  }

  // Shared entry point for the three driven-check-in call sites. Resolves
  // true only when the direct POST both looked successful AND the row
  // disappeared within ~2s; false means "fall back to click-and-poll" —
  // never a rejection, so callers can always .then() it.
  function tryDirectCheckin(clubberId, childName, clubId, options) {
    if (CHURCH_CFG.enableDrivenCheckin === false) return Promise.resolve(false);
    return driveCheckinDirect(clubberId, childName, clubId, options).then(function(posted) {
      if (!posted) return false;
      return new Promise(function(resolve) {
        var attempts = 0;
        (function poll() {
          if (!findClubberElByName(childName)) { resolve(true); return; }
          if (++attempts >= 20) { resolve(false); return; } // didn't verify — caller falls back
          setTimeout(poll, 100);
        })();
      });
    });
  }

  // After clicking the modal's check-in button, wait for the kid's row to
  // disappear from the .clubber roster — that's the only signal that
  // TwoTimTwo actually accepted the check-in. If the row is still there
  // after the verify window, re-click the row once before giving up. This
  // protects against modal races where the click landed but TwoTimTwo
  // dismissed the modal without recording the check-in.
  function verifyBatchCheckin(sib, remaining, options, pollAttempt, retriesLeft) {
    if (!findClubberElByName(sib.name)) {
      if (remaining.length > 0) {
        setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
      }
      return;
    }
    if (pollAttempt < 20) { // up to 2 s for TwoTimTwo to update the DOM
      setTimeout(function() {
        verifyBatchCheckin(sib, remaining, options, pollAttempt + 1, retriesLeft);
      }, 100);
      return;
    }
    if (retriesLeft > 0) {
      console.log('[Awana] Batch: ' + sib.name + ' did not check in after click — retrying once');
      var freshEl = findClubberElByName(sib.name);
      if (freshEl) {
        freshEl.click();
        setTimeout(function() {
          pollForCheckinButton(sib, remaining, options, 30, retriesLeft - 1);
        }, 200);
        return;
      }
      // Race: row vanished between attempts → success
      if (remaining.length > 0) {
        setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
      }
      return;
    }
    console.log('[Awana] Batch: ' + sib.name + ' could not be verified as checked in (retries exhausted)');
    if (remaining.length > 0) {
      setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
    }
  }

  function pollForCheckinButton(sib, remaining, options, attempts, retriesLeft) {
    if (typeof retriesLeft !== 'number') retriesLeft = 1;
    if (attempts <= 0) {
      // Modal never opened — click the row again before giving up
      if (retriesLeft > 0) {
        console.log('[Awana] Modal never opened for ' + sib.name + ' — re-clicking row');
        var freshEl = findClubberElByName(sib.name);
        if (freshEl) {
          freshEl.click();
          setTimeout(function() {
            pollForCheckinButton(sib, remaining, options, 30, retriesLeft - 1);
          }, 200);
          return;
        }
      }
      console.log('[Awana] Timed out waiting for check-in button for ' + sib.name);
      if (remaining.length > 0) {
        setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
      }
      return;
    }
    var checkinBtn = null;

    // Strategy 1: TwoTimTwo-specific — button#checkin inside a visible #checkin-modal
    // Bug 1 fix: use getComputedStyle().display instead of offsetParent.
    // The modal is position:fixed, so offsetParent is ALWAYS null even when fully visible.
    var ttModal = document.getElementById('checkin-modal');
    if (ttModal && window.getComputedStyle(ttModal).display !== 'none') {
      checkinBtn = ttModal.querySelector('button#checkin');
    }

    // Strategy 2: explicit TwoTimTwo-style selectors
    if (!checkinBtn) {
      checkinBtn = document.querySelector('.checkin-btn, button[data-action="checkin"]');
    }

    // Strategy 3: any visible button with check-in text in document
    if (!checkinBtn) {
      var allBtns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < allBtns.length; i++) {
        var btn = allBtns[i];
        if (!btn.offsetParent) continue;
        var txt = btn.textContent.toLowerCase().trim();
        if (txt === 'checkin' || txt === 'check in' || txt === 'check-in') {
          checkinBtn = btn;
          break;
        }
      }
    }

    // Strategy 4: modal-scoped fallback — use #checkin-modal directly to avoid
    // accidentally matching buttons in other Bootstrap modals (like #page-info-window)
    if (!checkinBtn) {
      var modalBtns = document.querySelectorAll('#checkin-modal button, .dialog button, [role="dialog"] button');
      for (var i = 0; i < modalBtns.length; i++) {
        if (!modalBtns[i].offsetParent) continue;
        var txt = modalBtns[i].textContent.toLowerCase().trim();
        if (txt === 'checkin' || txt === 'check in' || txt === 'check-in') {
          checkinBtn = modalBtns[i];
          break;
        }
      }
    }

    if (checkinBtn && checkinBtn.offsetParent !== null) {
      console.log('[Awana] Found check-in button, applying options and clicking for ' + sib.name);

      // Bug 2 fix: use #checkin-modal directly instead of .closest('[class*="modal"]'),
      // which incorrectly matches .modal-footer (an ancestor with "modal" in its class name),
      // resulting in 0 checkboxes found and options never being applied.
      var modalContainer = document.getElementById('checkin-modal') || checkinBtn.parentElement;
      applyCheckinOptions(modalContainer, options);

      // Bug 3 fix: only call .click() once — the dispatchEvent was causing a double-submission
      checkinBtn.click();

      // Verify the click actually checked the kid in (row disappears)
      // before moving to the next sibling. Retry once on failure.
      verifyBatchCheckin(sib, remaining, options, 0, retriesLeft);
    } else {
      setTimeout(function() {
        pollForCheckinButton(sib, remaining, options, attempts - 1, retriesLeft);
      }, 100);
    }
  }

  function batchCheckInSiblings(siblings) {
    if (siblings.length === 0) return;

    var sib = siblings[0];
    var remaining = siblings.slice(1);
    var options = sib.options || {};

    console.log('[Awana] Batch check-in: clicking ' + sib.name);
    setStatus('\u23F3');

    // Fire print in background immediately — don't wait for check-in to complete.
    // batchPrintedNames (8 s window) guards against onCheckin double-printing.
    var club = lookupClub(sib.name);
    var sibRecid = (sib.element && sib.element.getAttribute) ? sib.element.getAttribute('recid') : null;
    var sibClubId = (sib.element && sib.element.getAttribute) ? sib.element.getAttribute('club_id') : null;
    var sibKey = resolveIdentityKey(sib.name, sibRecid);
    batchPrintedNames.add(sibKey);
    setTimeout(function() { batchPrintedNames.delete(sibKey); }, 8000);
    markPrinted(sib.name, sibRecid); // record in session dedup so remote scan won't reprint
    doPrint(sib.name, club.clubName || sib.clubName, club.clubImageData, undefined, sibRecid);

    // F-2: try the direct check-in POST first — no modal, no click-timing
    // dance. Fall back to the original click + poll-for-#checkin flow when
    // the direct path is unavailable or doesn't verify.
    tryDirectCheckin(sibRecid, sib.name, sibClubId, options).then(function(ok) {
      if (ok) {
        console.log('[Awana] Batch: ' + sib.name + ' checked in via direct API');
        if (remaining.length > 0) {
          setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
        }
        return;
      }
      // Re-query the clubber element by name. The reference captured at
      // findSiblings() time goes stale after the previous sibling's check-in
      // re-renders the roster — clicking a detached node is a silent no-op.
      var freshEl = findClubberElByName(sib.name);
      if (!freshEl || !freshEl.isConnected) {
        console.log('[Awana] Batch: ' + sib.name + ' not in current DOM — skipping page check-in');
        if (remaining.length > 0) {
          setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
        }
        return;
      }
      sib.element = freshEl;
      freshEl.click();

      // Poll for the modal's check-in button (up to 3s)
      pollForCheckinButton(sib, remaining, options, 30);
    });
  }

  function getClubImageDataUrl(img) {
    try {
      if (!img || !img.src || !img.complete || img.naturalWidth === 0) {
        return null;
      }
      // Capture at up to 320px, never above the image's own resolution.
      // The print server draws this into a ~317px icon zone on a 300 DPI
      // label, so the old fixed 64×64 capture forced a 5× upscale at print
      // time — the logos came out blurry and speckled on thermal output.
      const _side = Math.min(320, Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = _side;
      const _ctx = canvas.getContext('2d');
      _ctx.imageSmoothingEnabled = true;
      _ctx.imageSmoothingQuality = 'high';
      const _aspect = img.naturalWidth / img.naturalHeight;
      let _dw, _dh, _ox = 0, _oy = 0;
      if (_aspect > 1) { _dw = _side; _dh = _side / _aspect; _oy = (_side - _dh) / 2; }
      else             { _dh = _side; _dw = _side * _aspect; _ox = (_side - _dw) / 2; }
      _ctx.drawImage(img, _ox, _oy, _dw, _dh);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return img.src || null;
    }
  }

  function injectWidget() {
    // Default to minimized so the widget never obstructs the page on first load.
    // Only stay expanded if the user explicitly expanded it (stored 'false').
    var isMinimized = localStorage.getItem(MINIMIZE_KEY) !== 'false';

    // Shared building blocks so every section of the panel looks the same.
    function sectionLabel(text) {
      var el = document.createElement('div');
      Object.assign(el.style, {
        fontSize: '10px', color: '#94a3b8', fontWeight: '600',
        textTransform: 'uppercase', letterSpacing: '0.05em'
      });
      el.textContent = text;
      return el;
    }
    function divider() {
      var el = document.createElement('div');
      Object.assign(el.style, { height: '1px', background: '#e2e8f0', margin: '2px 0' });
      return el;
    }

    // ── Outer container ──
    const widget = document.createElement('div');
    widget.id = 'awana-widget';
    Object.assign(widget.style, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      transition: 'all 0.2s ease'
    });

    // ── Collapsed state: small branded pill ──
    const pill = document.createElement('div');
    pill.id = 'awana-pill';
    Object.assign(pill.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: '#4caf50',
      color: '#ffffff',
      borderRadius: '20px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(76,175,80,0.3)',
      fontSize: '12px',
      fontWeight: '600',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      transition: 'all 0.15s ease'
    });
    pill.innerHTML = '<span style="font-size:14px">&#x1F5A8;</span> Awana Print';
    pill.title = 'Expand print controls';
    pill.addEventListener('mouseenter', function() { pill.style.background = '#43a047'; });
    pill.addEventListener('mouseleave', function() { pill.style.background = '#4caf50'; });

    // Where the widget sits, in one place. The panel's max-height is derived
    // from these, so the "how far down the page" and "how tall may it be"
    // numbers can never drift apart.
    const PANEL_TOP = 55;   // clears TwoTimTwo's two nav bars
    const PANEL_GAP = 12;   // breathing room at the bottom edge

    // ── Expanded state: full panel ──
    const panel = document.createElement('div');
    panel.id = 'awana-panel';
    // A COLUMN BOUNDED BY THE VIEWPORT, not a box that grows without limit.
    //
    // This used to be `overflow: hidden` with no height cap, on a widget fixed at
    // top:55px with nothing constraining it either. So the moment the panel grew
    // taller than the screen — which is exactly what ticking "Also register in
    // TwoTimTwo" does, revealing four more controls — the overflow was CLIPPED
    // with no scrollbar. On a laptop at the check-in table the Print button and
    // the registration fields simply became unreachable, mid-check-in, with no
    // way to get at them.
    //
    // Now: the header stays pinned, the body scrolls, and the whole thing can
    // never exceed the space between the site's nav bar and the bottom of the
    // window.
    Object.assign(panel.style, {
      background: '#ffffff',
      border: '1px solid #c8e6c9',
      borderRadius: '8px',
      boxShadow: '0 6px 20px rgba(15, 23, 42, 0.12)',
      overflow: 'hidden',
      minWidth: '260px',
      width: '320px',
      maxWidth: 'calc(100vw - 24px)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',   // positioning context for the "more below" fade
      // Cannot outgrow the viewport: PANEL_TOP is where the widget is pinned,
      // plus a matching gap at the bottom so it never kisses the taskbar.
      maxHeight: 'calc(100vh - ' + (PANEL_TOP + PANEL_GAP) + 'px)'
    });

    // Panel header (purple bar with title + close X)
    const panelHeader = document.createElement('div');
    Object.assign(panelHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      background: '#4caf50',
      color: '#ffffff',
      // Never squeezed by a long body — the close button must always be
      // reachable, which is the escape hatch when anything else goes wrong.
      flex: '0 0 auto'
    });

    const headerLeft = document.createElement('div');
    Object.assign(headerLeft.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    headerLeft.innerHTML = '<span style="font-size:14px">&#x1F5A8;</span>' +
      '<span style="font-weight:700;font-size:13px">Awana Print</span>' +
      '<span style="font-size:10px;opacity:0.7">v' + EXTENSION_VERSION + '</span>';

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      background: 'rgba(255,255,255,0.2)',
      border: 'none',
      color: '#ffffff',
      width: '22px',
      height: '22px',
      borderRadius: '50%',
      cursor: 'pointer',
      fontSize: '14px',
      lineHeight: '22px',
      textAlign: 'center',
      padding: '0',
      transition: 'background 0.15s ease'
    });
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.title = 'Minimize';
    closeBtn.addEventListener('mouseenter', function() { closeBtn.style.background = 'rgba(0,0,0,0.15)'; });
    closeBtn.addEventListener('mouseleave', function() { closeBtn.style.background = 'rgba(255,255,255,0.2)'; });

    panelHeader.append(headerLeft, closeBtn);

    // Panel body
    const panelBody = document.createElement('div');
    panelBody.id = 'awana-panel-body';
    Object.assign(panelBody.style, {
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      // THE FIX: this is the scroll container. flex:1 1 auto lets it take the
      // remaining height under the pinned header and no more.
      flex: '1 1 auto',
      overflowY: 'auto',
      overflowX: 'hidden',
      overscrollBehavior: 'contain',  // scrolling to the end must not scroll the page behind
      scrollbarGutter: 'stable'       // no content jump when the scrollbar appears
    });

    // Controls row
    const controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '8px' });

    const modeSelect = document.createElement('select');
    modeSelect.id = 'awana-mode-select';
    Object.assign(modeSelect.style, {
      flex: '1',
      padding: '5px 8px',
      borderRadius: '6px',
      border: '1px solid #e2e8f0',
      cursor: 'pointer',
      fontSize: '12px',
      background: '#f8fafc'
    });

    var modes = [
      ['auto', 'Auto-Print'],
      ['dialog', 'Print Dialog'],
      ['off', 'Off']
    ];
    modes.forEach(function(pair) {
      var value = pair[0], label = pair[1];
      var option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = selectedMode;
    modeSelect.addEventListener('change', function() {
      selectedMode = modeSelect.value;
      localStorage.setItem(STORAGE_KEY, selectedMode);
      console.log('[Awana] Mode changed to:', selectedMode);
    });

    const statusEl = document.createElement('span');
    statusEl.id = 'awana-status';
    statusEl.style.fontSize = '16px';
    statusEl.style.minWidth = '20px';
    statusEl.style.textAlign = 'center';

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    Object.assign(testBtn.style, {
      fontSize: '11px',
      padding: '5px 10px',
      background: '#f1f5f9',
      border: '1px solid #e2e8f0',
      borderRadius: '6px',
      cursor: 'pointer',
      fontWeight: '600',
      color: '#475569',
      transition: 'background 0.15s ease'
    });
    testBtn.addEventListener('mouseenter', function() { testBtn.style.background = '#e2e8f0'; });
    testBtn.addEventListener('mouseleave', function() { testBtn.style.background = '#f1f5f9'; });
    testBtn.addEventListener('click', function() {
      console.log('[Awana] Test button clicked');
      doPrint('Test Child', 'Sparks', null);
    });

    // Night-systems canary: exercises the whole pipeline — server → TEST
    // label print → Pusher canary event — plus this page's selectors.
    var nightTestBtn = document.createElement('button');
    nightTestBtn.textContent = 'Night Test';
    Object.assign(nightTestBtn.style, {
      fontSize: '11px', padding: '5px 10px',
      background: '#eef2ff', border: '1px solid #c7d2fe',
      borderRadius: '6px', cursor: 'pointer',
      fontWeight: '600', color: '#4338ca',
      transition: 'background 0.15s ease'
    });
    nightTestBtn.addEventListener('mouseenter', function() { nightTestBtn.style.background = '#e0e7ff'; });
    nightTestBtn.addEventListener('mouseleave', function() { nightTestBtn.style.background = '#eef2ff'; });
    nightTestBtn.addEventListener('click', function() {
      nightTestBtn.disabled = true;
      nightTestBtn.textContent = 'Testing...';
      var selectorsOk = runSelectorSelfTest();
      fetch(PRINT_SERVER + '/canary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerName: selectedPrinterName || undefined }),
        signal: AbortSignal.timeout(45000)
      })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var lines = (res.stages || []).map(function(s) {
            return (s.passed ? '✅' : '❌') + ' ' + s.stage + (s.detail ? ' — ' + s.detail : '');
          });
          lines.unshift((selectorsOk ? '✅' : '❌') + ' page selectors');
          alert('Night systems test:\n\n' + lines.join('\n'));
        })
        .catch(function() {
          alert('Night systems test:\n\n' + (selectorsOk ? '✅' : '❌') + ' page selectors\n❌ server — could not reach the print server');
        })
        .finally(function() {
          nightTestBtn.disabled = false;
          nightTestBtn.textContent = 'Night Test';
        });
    });

    controls.append(modeSelect, statusEl, testBtn, nightTestBtn);

    // Printer row
    var printerRow = document.createElement('div');
    Object.assign(printerRow.style, { display: 'flex', flexDirection: 'column', gap: '2px' });

    var printerLabel = sectionLabel('Printer');

    var printerSelect = document.createElement('select');
    printerSelect.id = 'awana-printer-select';
    Object.assign(printerSelect.style, {
      width: '100%', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', cursor: 'pointer',
      fontSize: '11px', background: '#f8fafc', color: '#475569'
    });
    var loadingOpt = document.createElement('option');
    loadingOpt.value = ''; loadingOpt.textContent = 'Loading printers...'; loadingOpt.disabled = true;
    printerSelect.appendChild(loadingOpt);

    printerSelect.addEventListener('change', function() {
      selectedPrinterName = printerSelect.value;
      localStorage.setItem(PRINTER_KEY, selectedPrinterName);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ awana_selectedPrinterName: selectedPrinterName });
      }
      console.log('[Awana] Printer changed to:', selectedPrinterName || '(server default)');
    });

    printerRow.append(printerLabel, printerSelect);

    // Status rows
    var csvStatus = document.createElement('div');
    csvStatus.id = 'awana-csv-status';
    Object.assign(csvStatus.style, {
      fontSize: '11px',
      color: '#94a3b8',
      whiteSpace: 'nowrap',
      padding: '2px 0'
    });
    csvStatus.textContent = 'Syncing roster...';

    // ── Privacy status ────────────────────────────────────────────────────────
    // Whether children's first names leave the print PC encrypted. Fed by the
    // /health poll below.
    //
    // This row shows STATE ONLY, never the key itself. This panel is injected
    // into a page served by twotimtwo.com, so anything rendered here is
    // readable by that site's scripts — which is also why the server redacts
    // displayKey for every non-loopback caller. The key is typed on the
    // dashboard, at loopback, and nowhere else.
    var privacyStatus = document.createElement('div');
    privacyStatus.id = 'awana-privacy-status';
    Object.assign(privacyStatus.style, {
      display: 'none',
      fontSize: '11px',
      padding: '5px 8px',
      borderRadius: '6px',
      lineHeight: '1.4'
    });

    var updateRow = document.createElement('div');
    updateRow.id = 'awana-update-notice';
    Object.assign(updateRow.style, {
      display: 'none',
      fontSize: '11px',
      color: '#f59e0b',
      fontWeight: 'bold',
      padding: '4px 8px',
      background: '#fffbeb',
      borderRadius: '6px',
      border: '1px solid #fde68a'
    });

    // Walk-in guest section
    var walkInLabel = sectionLabel('Walk-in Guest');

    var walkInRow = document.createElement('div');
    Object.assign(walkInRow.style, { display: 'flex', gap: '4px' });

    var guestInput = document.createElement('input');
    guestInput.type = 'text';
    guestInput.placeholder = 'First Last';
    Object.assign(guestInput.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '12px',
      background: '#f8fafc', color: '#1e293b', outline: 'none'
    });

    var walkInPrintBtn = document.createElement('button');
    walkInPrintBtn.textContent = 'Print';
    Object.assign(walkInPrintBtn.style, {
      fontSize: '11px', padding: '5px 10px',
      background: '#4caf50', color: '#ffffff',
      border: 'none', borderRadius: '6px',
      cursor: 'pointer', fontWeight: '600',
      transition: 'background 0.15s ease'
    });
    walkInPrintBtn.addEventListener('mouseenter', function() { walkInPrintBtn.style.background = '#43a047'; });
    walkInPrintBtn.addEventListener('mouseleave', function() { walkInPrintBtn.style.background = '#4caf50'; });

    // Club selector for walk-ins
    var walkInClubRow = document.createElement('div');
    Object.assign(walkInClubRow.style, { display: 'flex', gap: '4px', alignItems: 'center' });

    var clubSelect = document.createElement('select');
    Object.assign(clubSelect.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '11px',
      background: '#f8fafc', color: '#475569'
    });
    var clubOptions = ['(no club)', 'Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek'];
    clubOptions.forEach(function(c) {
      var opt = document.createElement('option');
      opt.value = c === '(no club)' ? '' : c;
      opt.textContent = c;
      clubSelect.appendChild(opt);
    });

    var visitorCheck = document.createElement('label');
    Object.assign(visitorCheck.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap'
    });
    var visitorCb = document.createElement('input');
    visitorCb.type = 'checkbox';
    visitorCheck.append(visitorCb);
    visitorCheck.append(document.createTextNode('Visitor'));

    walkInClubRow.append(clubSelect, visitorCheck);

    // \u2500\u2500 F-3: optional "also register in TwoTimTwo" \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // The label print above always happens regardless of this checkbox \u2014 a
    // child at the door gets a label whether or not TwoTimTwo registration
    // succeeds. This just additionally submits the real registration form
    // (docs/TWOTIMTWO.md \u00A74) so the walk-in leaves a TwoTimTwo record too.
    var registerCheck = document.createElement('label');
    Object.assign(registerCheck.style, {
      display: 'flex', alignItems: 'center', gap: '4px',
      fontSize: '11px', color: '#64748b', cursor: 'pointer'
    });
    var registerCb = document.createElement('input');
    registerCb.type = 'checkbox';
    registerCheck.append(registerCb, document.createTextNode('Also register in TwoTimTwo'));

    var registerFields = document.createElement('div');
    registerFields.id = 'awana-register-fields';
    Object.assign(registerFields.style, {
      display: 'none', flexDirection: 'column', gap: '6px',
      padding: '10px', background: '#f8fafc', borderRadius: '8px',
      border: '1px solid #e2e8f0'
    });

    // Says what the four boxes are for and that all of them are needed. The
    // register call refuses without every field, and previously said so only
    // AFTER the operator pressed Print — at the door, with a child waiting.
    var registerHint = document.createElement('div');
    registerHint.textContent = 'All four are required by TwoTimTwo';
    Object.assign(registerHint.style, {
      fontSize: '10px', color: '#94a3b8', fontWeight: '600',
      letterSpacing: '0.02em', marginBottom: '1px'
    });

    function regFieldInput(placeholder, type) {
      var inp = document.createElement('input');
      inp.type = type || 'text';
      inp.placeholder = placeholder;
      Object.assign(inp.style, {
        padding: '5px 8px', borderRadius: '6px', border: '1px solid #e2e8f0',
        fontSize: '11px', background: '#fff', color: '#1e293b', outline: 'none'
      });
      return inp;
    }
    var guardianInput  = regFieldInput('Guardian name');
    var phoneInput     = regFieldInput('Guardian phone', 'tel');
    var birthdateInput = regFieldInput('Birthdate', 'date');

    var genderSelect = document.createElement('select');
    Object.assign(genderSelect.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '11px', background: '#fff', color: '#1e293b'
    });
    [['M', 'Boy'], ['F', 'Girl']].forEach(function(pair) {
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = pair[1];
      genderSelect.appendChild(o);
    });

    // grade_id \u2192 club mapping from the real registration form (docs \u00A74).
    var GRADE_OPTIONS = [
      { id: 17, label: 'Age 2 (Puggles)' },
      { id: 3,  label: 'Preschool 1yr before K (Cubbies)' },
      { id: 22, label: 'Preschool 2yr before K (Cubbies)' },
      { id: 4,  label: 'K (Sparks)' },
      { id: 5,  label: 'Gr 1 (Sparks)' },
      { id: 6,  label: 'Gr 2 (Sparks)' },
      { id: 7,  label: 'Gr 3 (T&T)' },
      { id: 8,  label: 'Gr 4 (T&T)' },
      { id: 9,  label: 'Gr 5 (T&T)' },
      { id: 18, label: 'Gr 6 (Trek)' },
      { id: 19, label: 'Gr 7 (Trek)' },
      { id: 20, label: 'Gr 8 (Trek)' },
      { id: 21, label: 'Gr 9 (Journey)' },
      { id: 23, label: 'Gr 10 (Journey)' }
    ];
    var gradeSelect = document.createElement('select');
    Object.assign(gradeSelect.style, {
      flex: '1', padding: '5px 8px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '11px', background: '#fff', color: '#1e293b'
    });
    var gradePlaceholder = document.createElement('option');
    gradePlaceholder.value = '';
    gradePlaceholder.textContent = 'Grade\u2026';
    gradePlaceholder.disabled = true;
    gradePlaceholder.selected = true;
    gradeSelect.appendChild(gradePlaceholder);
    GRADE_OPTIONS.forEach(function(g) {
      var o = document.createElement('option');
      o.value = String(g.id); o.textContent = g.label;
      gradeSelect.appendChild(o);
    });

    var genderGradeRow = document.createElement('div');
    Object.assign(genderGradeRow.style, { display: 'flex', gap: '4px' });
    genderGradeRow.append(genderSelect, gradeSelect);

    var registerStatus = document.createElement('div');
    registerStatus.id = 'awana-register-status';
    Object.assign(registerStatus.style, { fontSize: '10px', color: '#94a3b8' });

    registerFields.append(registerHint, guardianInput, phoneInput, birthdateInput, genderGradeRow, registerStatus);

    registerCb.addEventListener('change', function() {
      registerFields.style.display = registerCb.checked ? 'flex' : 'none';
      // Scroll the revealed form into view. The panel scrolls now, but a form
      // that appears below the fold on an unchanged-looking panel is the same
      // "where did it go" problem wearing a different hat.
      if (registerCb.checked) {
        try {
          registerFields.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          guardianInput.focus({ preventScroll: true });
        } catch (e) { /* older browsers: the panel still scrolls by hand */ }
      }
      updateScrollFade();
    });

    function setRegisterStatus(text, color) {
      registerStatus.textContent = text;
      registerStatus.style.color = color || '#94a3b8';
    }

    // Fire-and-forget: the label already printed by the time this resolves,
    // and it never blocks or retries the print on a registration failure.
    function registerWalkInGuest(fullName, guardianName, phone, birthdate, gradeId, gender) {
      var parts = fullName.trim().split(/\s+/);
      var firstName = parts[0] || '';
      var lastName = parts.slice(1).join(' ') || '';
      if (!guardianName || !phone || !birthdate || !gradeId) {
        setRegisterStatus('\u26A0 Fill in guardian, phone, birthdate & grade to register', '#f59e0b');
        return;
      }
      var csrfToken = findCsrfToken();
      if (!csrfToken) {
        setRegisterStatus('\u26A0 Could not find TwoTimTwo\u2019s form token \u2014 not registered (label still printed)', '#ef4444');
        return;
      }
      setRegisterStatus('Registering in TwoTimTwo\u2026', '#94a3b8');
      var body = 'jscript=yep' +
        '&Household%5Bname1%5D=' + encodeURIComponent(guardianName) +
        '&Household%5Bphn1%5D=' + encodeURIComponent(phone) +
        '&Clubber%5B0%5D%5Bfirst_name%5D=' + encodeURIComponent(firstName) +
        '&Clubber%5B0%5D%5Blast_name%5D=' + encodeURIComponent(lastName) +
        '&Clubber%5B0%5D%5Bgender%5D=' + encodeURIComponent(gender) +
        '&Clubber%5B0%5D%5Bgrade_id%5D=' + encodeURIComponent(gradeId) +
        '&Clubber%5B0%5D%5Bbirthdate%5D=' + encodeURIComponent(birthdate) +
        '&YII_CSRF_TOKEN=' + encodeURIComponent(csrfToken);
      fetch('/clubber/register?default_visitor=Y', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
        signal: AbortSignal.timeout(10000)
      }).then(function(r) {
        if (r.ok) {
          setRegisterStatus('\u2713 Registered in TwoTimTwo', '#16a34a');
        } else {
          setRegisterStatus('\u26A0 Registration failed (HTTP ' + r.status + ') \u2014 label printed, register manually', '#ef4444');
        }
      }).catch(function(err) {
        setRegisterStatus('\u26A0 Registration failed (' + err.message + ') \u2014 label printed, register manually', '#ef4444');
      });
    }

    function triggerWalkIn() {
      var name = guestInput.value.trim();
      if (!name) return;
      var club = clubSelect.value;
      var isVisitor = visitorCb.checked;
      // Send with visitor flag if checked
      var payload = {
        name: name, clubName: club, clubImageData: null,
        printerName: selectedPrinterName || '',
        stepUpNight: isStepUpNight()
      };
      if (isVisitor) payload.visitor = true;
      if (isAwanaStoreNight()) {
        var parts = name.split(/\s+/);
        var bal = getShareBalance(parts[0] || '', parts.slice(1).join(' '));
        if (bal !== null) payload.awanaShares = bal + 1;
      }
      // Record the walk-in in the session dedup set. This was the ONE print
      // path that never did, so once the guest was registered and checked in
      // (the new one-step option makes that routine), reconcile / roster-diff /
      // the last-checkin observer all saw a name they had no record of printing
      // and produced a SECOND label.
      markPrinted(name);
      setStatus('\u23F3');
      fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
      }).then(function(r) {
        if (r.ok) { setStatus('\u2705'); playSuccess(); }
        else { setStatus('\u274C'); playError(); }
        clearStatus();
      }).catch(function() {
        queuePrint(payload);
        setStatus('\uD83D\uDCE6');
        clearStatus();
      });

      // F-3: registration is independent of the print above \u2014 it never waits
      // on it and never blocks/undoes it if the TwoTimTwo POST fails.
      if (registerCb.checked) {
        registerWalkInGuest(name, guardianInput.value.trim(), phoneInput.value.trim(),
          birthdateInput.value, gradeSelect.value, genderSelect.value);
      }

      guestInput.value = '';
    }
    guestInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') triggerWalkIn(); });
    walkInPrintBtn.addEventListener('click', triggerWalkIn);

    walkInRow.append(guestInput, walkInPrintBtn);

    // ── Tonight's check-ins (reprint) ──
    var tonightHeader = document.createElement('div');
    Object.assign(tonightHeader.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    var tonightLabel = sectionLabel('Tonight');
    tonightLabel.style.flex = '1';
    var tonightCount = document.createElement('span');
    tonightCount.id = 'awana-tonight-count';
    Object.assign(tonightCount.style, { fontSize: '10px', color: '#94a3b8' });
    var tonightRefresh = document.createElement('button');
    tonightRefresh.textContent = '\u21BB';
    tonightRefresh.title = 'Refresh list';
    Object.assign(tonightRefresh.style, {
      fontSize: '11px', padding: '0 6px', background: '#f1f5f9',
      border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
      color: '#475569', lineHeight: '16px'
    });
    tonightRefresh.addEventListener('click', loadTonight);
    tonightHeader.append(tonightLabel, tonightCount, tonightRefresh);

    var tonightList = document.createElement('div');
    tonightList.id = 'awana-tonight-list';
    Object.assign(tonightList.style, {
      display: 'flex', flexDirection: 'column', gap: '2px',
      maxHeight: '132px', overflowY: 'auto'
    });

    // Queue badge
    var queueBadge = document.createElement('div');
    queueBadge.id = 'awana-queue-badge';
    Object.assign(queueBadge.style, {
      display: 'none', fontSize: '11px', color: '#f59e0b',
      fontWeight: '600', padding: '2px 0'
    });

    // ── R-1: reconcile-against-checkin_report status + manual "Sync now" ──
    var reconcileRow = document.createElement('div');
    Object.assign(reconcileRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
    var reconcileStatus = document.createElement('span');
    reconcileStatus.id = 'awana-reconcile-status';
    Object.assign(reconcileStatus.style, { fontSize: '10px', color: '#94a3b8', flex: '1' });
    var syncNowBtn = document.createElement('button');
    syncNowBtn.textContent = 'Sync now';
    Object.assign(syncNowBtn.style, {
      fontSize: '10px', padding: '3px 8px', background: '#f1f5f9',
      border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
      color: '#475569', fontWeight: '600'
    });
    syncNowBtn.addEventListener('click', function() {
      syncNowBtn.disabled = true;
      syncNowBtn.textContent = 'Syncing…';
      runReconcile().then(function() {
        syncNowBtn.disabled = false;
        syncNowBtn.textContent = 'Sync now';
      });
    });
    reconcileRow.append(reconcileStatus, syncNowBtn);

    // ── Quick Mode toggle ──
    var quickModeRow = document.createElement('div');
    Object.assign(quickModeRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: quickModeEnabled ? '#e3f2fd' : '#f8fafc',
      borderRadius: '6px', border: '1px solid ' + (quickModeEnabled ? '#90caf9' : '#e2e8f0'),
      transition: 'all 0.15s ease'
    });
    var quickModeLbl = document.createElement('label');
    Object.assign(quickModeLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var quickModeCb = document.createElement('input');
    quickModeCb.type = 'checkbox';
    quickModeCb.checked = quickModeEnabled;
    var quickModeText = document.createElement('span');
    quickModeText.textContent = 'Quick Mode';
    var quickModeHint = document.createElement('span');
    Object.assign(quickModeHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    quickModeHint.textContent = 'One-click check-in + keyboard';
    quickModeLbl.append(quickModeCb, quickModeText);
    quickModeRow.append(quickModeLbl, quickModeHint);

    function applyQuickModeVisuals() {
      panelHeader.style.background = quickModeEnabled ? '#2196f3' : '#4caf50';
      pill.style.background = quickModeEnabled ? '#2196f3' : '#4caf50';
      pill.style.boxShadow = quickModeEnabled ? '0 2px 8px rgba(33,150,243,0.3)' : '0 2px 8px rgba(76,175,80,0.3)';
      quickModeRow.style.background = quickModeEnabled ? '#e3f2fd' : '#f8fafc';
      quickModeRow.style.borderColor = quickModeEnabled ? '#90caf9' : '#e2e8f0';
    }
    quickModeCb.addEventListener('change', function() {
      quickModeEnabled = quickModeCb.checked;
      localStorage.setItem(QUICK_MODE_KEY, quickModeEnabled ? 'true' : 'false');
      applyQuickModeVisuals();
      console.log('[Awana] Quick Mode:', quickModeEnabled ? 'ON' : 'OFF');
    });
    // Apply initial visual state
    applyQuickModeVisuals();

    // ── Step Up Night control ──
    // 'auto' detects the page text; 'on'/'off' force the mode regardless.
    var stepUpRow = document.createElement('div');
    Object.assign(stepUpRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: '#f8fafc',
      borderRadius: '6px', border: '1px solid #e2e8f0',
      transition: 'all 0.15s ease'
    });
    var stepUpLbl = document.createElement('label');
    Object.assign(stepUpLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var stepUpText = document.createElement('span');
    stepUpText.textContent = 'Step Up Night';
    var stepUpSelect = document.createElement('select');
    stepUpSelect.id = 'awana-stepup-select';
    Object.assign(stepUpSelect.style, {
      padding: '2px 4px', borderRadius: '4px',
      border: '1px solid #cbd5e1', fontSize: '11px',
      background: '#fff', color: '#1e293b'
    });
    [
      { v: 'auto', l: 'Auto' },
      { v: 'on',   l: 'On'   },
      { v: 'off',  l: 'Off'  }
    ].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.v; o.textContent = opt.l;
      if (opt.v === stepUpMode) o.selected = true;
      stepUpSelect.appendChild(o);
    });
    var stepUpHint = document.createElement('span');
    Object.assign(stepUpHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    function updateStepUpHint() {
      if (stepUpMode === 'auto') {
        stepUpHint.textContent = isStepUpNight() ? 'auto: ON' : 'auto: off';
      } else {
        stepUpHint.textContent = '';
      }
    }
    function applyStepUpVisuals() {
      var active = isStepUpNight();
      stepUpRow.style.background = active ? '#fff7ed' : '#f8fafc';
      stepUpRow.style.borderColor = active ? '#fdba74' : '#e2e8f0';
      updateStepUpHint();
    }
    stepUpLbl.append(stepUpText);
    stepUpRow.append(stepUpLbl, stepUpHint, stepUpSelect);
    stepUpSelect.addEventListener('change', function() {
      stepUpMode = stepUpSelect.value;
      localStorage.setItem(STEP_UP_KEY, stepUpMode);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ awana_stepUpMode: stepUpMode });
      }
      applyStepUpVisuals();
      console.log('[Awana] Step Up Night mode:', stepUpMode, '→ active:', isStepUpNight());
    });
    applyStepUpVisuals();
    // Re-evaluate auto detection every minute (page text may load late)
    setInterval(function() { if (stepUpMode === 'auto') applyStepUpVisuals(); }, 60000);

    // ── Awana Store Night control ──
    // Same Auto/On/Off pattern as Step Up. When active, fetchShareBalances
    // pulls one CSV per club_id 2..6 from the volunteer's logged-in
    // TwoTimTwo session and labels get a 🪙 N badge in the icon strip.
    var storeRow = document.createElement('div');
    Object.assign(storeRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 8px', background: '#f8fafc',
      borderRadius: '6px', border: '1px solid #e2e8f0',
      transition: 'all 0.15s ease'
    });
    var storeLbl = document.createElement('label');
    Object.assign(storeLbl.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '12px', fontWeight: '600', cursor: 'pointer', flex: '1', color: '#1e293b'
    });
    var storeText = document.createElement('span');
    storeText.textContent = 'Awana Store Night';
    var storeSelect = document.createElement('select');
    storeSelect.id = 'awana-store-select';
    Object.assign(storeSelect.style, {
      padding: '2px 4px', borderRadius: '4px',
      border: '1px solid #cbd5e1', fontSize: '11px',
      background: '#fff', color: '#1e293b'
    });
    [
      { v: 'auto', l: 'Auto' },
      { v: 'on',   l: 'On'   },
      { v: 'off',  l: 'Off'  }
    ].forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt.v; o.textContent = opt.l;
      if (opt.v === storeMode) o.selected = true;
      storeSelect.appendChild(o);
    });
    var storeHint = document.createElement('span');
    Object.assign(storeHint.style, { fontSize: '10px', color: '#64748b', fontWeight: '400' });
    function applyStoreVisuals() {
      var active = isAwanaStoreNight();
      storeRow.style.background = active ? '#fef3c7' : '#f8fafc';
      storeRow.style.borderColor = active ? '#fcd34d' : '#e2e8f0';
      if (storeMode === 'auto') {
        if (active) {
          var n = Object.keys(SHARES.byKey).length;
          storeHint.textContent = n ? ('auto: ON, ' + n + ' kids') : 'auto: ON, loading…';
        } else {
          storeHint.textContent = 'auto: off';
        }
      } else if (active) {
        var n2 = Object.keys(SHARES.byKey).length;
        storeHint.textContent = n2 ? (n2 + ' kids loaded') : 'loading…';
      } else {
        storeHint.textContent = '';
      }
    }
    storeLbl.append(storeText);
    storeRow.append(storeLbl, storeHint, storeSelect);
    storeSelect.addEventListener('change', function() {
      storeMode = storeSelect.value;
      localStorage.setItem(STORE_KEY, storeMode);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ awana_storeMode: storeMode });
      }
      if (isAwanaStoreNight()) {
        fetchShareBalances().then(applyStoreVisuals);
      }
      applyStoreVisuals();
      console.log('[Awana] Store Night mode:', storeMode, '→ active:', isAwanaStoreNight());
    });
    applyStoreVisuals();
    // Re-evaluate auto detection (and refresh balance count) every minute
    setInterval(function() {
      if (storeMode === 'auto') applyStoreVisuals();
      if (isAwanaStoreNight() && Date.now() - SHARES.fetchedAt > SHARES_TTL_MS) {
        fetchShareBalances().then(applyStoreVisuals);
      }
    }, 60000);
    // Initial fetch if active on load
    if (isAwanaStoreNight() && SHARES.fetchedAt === 0) {
      fetchShareBalances().then(applyStoreVisuals);
    }

    // ── Search bar ──
    var searchContainer = document.createElement('div');
    Object.assign(searchContainer.style, { position: 'relative' });

    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search roster...';
    searchInput.id = 'awana-search-input';
    Object.assign(searchInput.style, {
      width: '100%', padding: '6px 8px 6px 26px', borderRadius: '6px',
      border: '1px solid #e2e8f0', fontSize: '12px',
      background: '#f8fafc', color: '#1e293b', outline: 'none',
      boxSizing: 'border-box'
    });
    searchInput.addEventListener('focus', function() { searchInput.style.borderColor = '#90caf9'; });
    searchInput.addEventListener('blur', function() {
      searchInput.style.borderColor = '#e2e8f0';
      // Delay hiding results so click events on results can fire
      setTimeout(function() {
        var dd = document.getElementById('awana-search-results');
        if (dd) dd.style.display = 'none';
      }, 200);
    });

    var searchIcon = document.createElement('span');
    Object.assign(searchIcon.style, {
      position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
      fontSize: '12px', color: '#94a3b8', pointerEvents: 'none'
    });
    searchIcon.textContent = '\uD83D\uDD0D'; // 🔍

    var searchResults = document.createElement('div');
    searchResults.id = 'awana-search-results';
    Object.assign(searchResults.style, {
      display: 'none', position: 'absolute', top: '100%', left: '0', right: '0',
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 6px 6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '240px', overflowY: 'auto',
      zIndex: '100001'
    });

    var searchSelectedIdx = -1;

    function renderSearchResults(query) {
      while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
      searchSelectedIdx = -1;
      if (!query || query.length < 2) {
        searchResults.style.display = 'none';
        return;
      }
      var q = query.toLowerCase();
      var matches = [];
      Object.keys(ROSTER_CACHE).forEach(function(key) {
        if (matches.length >= 8) return;
        var meta = ROSTER_CACHE[key];
        if (!meta || !meta.displayName) return;
        if (meta.displayName.toLowerCase().indexOf(q) !== -1) {
          matches.push(meta);
        }
      });
      if (matches.length === 0) {
        searchResults.style.display = 'none';
        return;
      }
      matches.forEach(function(meta, idx) {
        var row = document.createElement('div');
        row.setAttribute('data-idx', idx);
        Object.assign(row.style, {
          padding: '6px 10px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f1f5f9', fontSize: '12px',
          transition: 'background 0.1s'
        });
        row.addEventListener('mouseenter', function() {
          searchSelectedIdx = idx;
          highlightSearchResult();
        });
        row.addEventListener('click', function() {
          searchInput.value = '';
          searchResults.style.display = 'none';
          triggerSearchCheckin(meta);
        });
        var nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = '600';
        nameSpan.textContent = meta.displayName;
        var clubSpan = document.createElement('span');
        Object.assign(clubSpan.style, { fontSize: '10px', color: '#64748b' });
        clubSpan.textContent = meta.clubName || '';
        row.append(nameSpan, clubSpan);
        searchResults.appendChild(row);
      });
      searchResults.style.display = 'block';
    }

    function highlightSearchResult() {
      var rows = searchResults.children;
      for (var i = 0; i < rows.length; i++) {
        rows[i].style.background = (i === searchSelectedIdx) ? '#e3f2fd' : '';
      }
    }

    function triggerSearchCheckin(meta) {
      var name = meta.displayName;
      if (isPrinted(name, meta.recid)) {
        console.log('[Awana] Already checked in this session:', name);
        return;
      }
      if (quickModeEnabled) {
        // Quick Mode: print immediately + auto-click the clubber element to check in on TwoTimTwo
        markPrinted(name, meta.recid);
        doPrint(name, meta.clubName || '', meta.clubImageData || null, undefined, meta.recid);
        var el = meta.element;
        if (el && el.isConnected) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
          setTimeout(function() {
            pollForCheckinButton({ name: name, element: el }, [], {}, 30);
          }, 150);
        }
      } else {
        // Normal mode: scroll to and click the clubber element (opens TwoTimTwo modal)
        var el = meta.element;
        if (el && el.isConnected) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.click();
        } else {
          // Offline roster entry (no live DOM row): print the label anyway so
          // the kid isn't stuck at the door — do the TwoTimTwo check-in once
          // the site is reachable again.
          console.log('[Awana] ' + name + ' not on the live page — printing label only (cached roster)');
          markPrinted(name, meta.recid);
          doPrint(name, meta.clubName || '', meta.clubImageData || null, undefined, meta.recid);
        }
      }
    }

    searchInput.addEventListener('input', function() {
      renderSearchResults(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', function(e) {
      var rows = searchResults.children;
      if (rows.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchSelectedIdx = Math.min(searchSelectedIdx + 1, rows.length - 1);
        highlightSearchResult();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        searchSelectedIdx = Math.max(searchSelectedIdx - 1, 0);
        highlightSearchResult();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var idx = searchSelectedIdx >= 0 ? searchSelectedIdx : 0;
        if (rows[idx]) {
          var matchKey = Object.keys(ROSTER_CACHE).filter(function(k) {
            return ROSTER_CACHE[k].displayName === rows[idx].querySelector('span').textContent;
          })[0];
          if (matchKey) {
            searchInput.value = '';
            searchResults.style.display = 'none';
            triggerSearchCheckin(ROSTER_CACHE[matchKey]);
          }
        }
      } else if (e.key === 'Escape') {
        searchInput.value = '';
        searchResults.style.display = 'none';
      }
    });

    searchContainer.append(searchIcon, searchInput, searchResults);

    // ── CSV warning banner ──
    var csvWarningBanner = document.createElement('div');
    csvWarningBanner.id = 'awana-csv-warning';
    Object.assign(csvWarningBanner.style, {
      display: 'none', fontSize: '11px', color: '#92400e', fontWeight: '600',
      padding: '6px 8px', background: '#fffbeb', borderRadius: '6px',
      border: '1px solid #fde68a', cursor: 'pointer', textAlign: 'center'
    });
    csvWarningBanner.textContent = 'Roster may be outdated \u2014 click to refresh';
    csvWarningBanner.addEventListener('click', function() {
      csvWarningBanner.style.display = 'none';
      syncCsv();
    });

    // Sound mute toggle
    var soundRow = document.createElement('div');
    Object.assign(soundRow.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    var muteLabel = document.createElement('label');
    Object.assign(muteLabel.style, {
      display: 'flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', color: '#94a3b8', cursor: 'pointer'
    });
    var muteCb = document.createElement('input');
    muteCb.type = 'checkbox';
    muteCb.checked = soundMuted;
    muteCb.addEventListener('change', function() {
      soundMuted = muteCb.checked;
      localStorage.setItem(MUTE_KEY, soundMuted ? 'true' : 'false');
    });
    muteLabel.append(muteCb);
    muteLabel.append(document.createTextNode('Mute sounds'));
    soundRow.appendChild(muteLabel);

    // ── Help / panic button ──
    var helpBtn = document.createElement('button');
    helpBtn.textContent = 'Help \u2014 Not Working?';
    Object.assign(helpBtn.style, {
      width: '100%', padding: '6px', background: '#fff7ed', color: '#c2410c',
      border: '1px solid #fed7aa', borderRadius: '6px', cursor: 'pointer',
      fontWeight: '600', fontSize: '11px', transition: 'background 0.15s ease'
    });
    helpBtn.addEventListener('mouseenter', function() { helpBtn.style.background = '#ffedd5'; });
    helpBtn.addEventListener('mouseleave', function() { helpBtn.style.background = '#fff7ed'; });
    helpBtn.addEventListener('click', function() {
      helpBtn.textContent = 'Checking...';
      helpBtn.disabled = true;
      fetch(PRINT_SERVER + '/diagnostics', { signal: AbortSignal.timeout(5000) })
        .then(function(r) { return r.json(); })
        .then(function(tests) {
          var failed = tests.filter(function(t) { return !t.passed; });
          var msg = '';
          if (failed.length === 0) {
            msg = '\u2705 Everything looks good! Try clicking Test to print a test label.';
          } else {
            msg = '\u26A0\uFE0F Issues found:\n';
            failed.forEach(function(t) {
              if (t.test === 'Printer detected') msg += '\n\u2022 Your printer may be off or disconnected. Check the USB cable and turn it on.';
              else if (t.test === 'CSV loaded') msg += '\n\u2022 Roster data is missing. Labels will still print but without allergy/birthday info.';
              else if (t.test === 'Label rendering') msg += '\n\u2022 Label rendering failed. Try restarting the server.';
              else msg += '\n\u2022 ' + t.test + ': ' + (t.detail || 'failed');
            });
          }
          alert(msg);
        })
        .catch(function() {
          alert('\u274C Cannot reach the print server.\n\nMake sure the Awana Print window is open on this computer.');
        })
        .finally(function() {
          helpBtn.textContent = 'Help \u2014 Not Working?';
          helpBtn.disabled = false;
        });
    });

    // Last-5 confirmation feed (#17a/#29): every print this station sent,
    // with its detection source, pinned at the top of the panel.
    var feedWrap = document.createElement('div');
    var feedLabel = sectionLabel('Last prints');
    var feedList = document.createElement('div');
    feedList.id = 'awana-feed-list';
    Object.assign(feedList.style, { display: 'flex', flexDirection: 'column', gap: '1px', fontSize: '11px', color: '#94a3b8' });
    feedList.textContent = 'No prints yet tonight';
    feedWrap.append(feedLabel, feedList);

    // Panel layout, most-used first: last-prints feed + search + Quick Mode
    // on top, then the per-night toggles, printing controls, walk-in
    // printing, tonight's reprint list, and finally status lines and help.
    panelBody.append(
      feedWrap, divider(),
      searchContainer, quickModeRow,
      divider(), sectionLabel('Night Modes'), stepUpRow, storeRow,
      divider(), sectionLabel('Printing'), controls, printerRow,
      divider(), walkInLabel, walkInRow, walkInClubRow, registerCheck, registerFields,
      divider(), tonightHeader, tonightList,
      queueBadge, reconcileRow, csvStatus, csvWarningBanner, privacyStatus, updateRow,
      divider(), soundRow, helpBtn
    );
    // A scrollbar the operator can actually SEE. A body that scrolls but shows
    // no affordance looks identical to content that is cut off — which is the
    // impression this panel gave before, and the reason nobody tried scrolling.
    if (!document.getElementById('awana-panel-scroll-style')) {
      var scrollStyle = document.createElement('style');
      scrollStyle.id = 'awana-panel-scroll-style';
      scrollStyle.textContent =
        '#awana-panel-body{scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent;}' +
        '#awana-panel-body::-webkit-scrollbar{width:8px;}' +
        '#awana-panel-body::-webkit-scrollbar-track{background:transparent;}' +
        '#awana-panel-body::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px;' +
        'border:2px solid #ffffff;}' +
        '#awana-panel-body::-webkit-scrollbar-thumb:hover{background:#94a3b8;}';
      document.head.appendChild(scrollStyle);
    }

    var scrollFade = document.createElement('div');
    Object.assign(scrollFade.style, {
      position: 'absolute', left: '1px', right: '1px', bottom: '0',
      height: '26px', pointerEvents: 'none', opacity: '0',
      transition: 'opacity 0.15s ease',
      borderRadius: '0 0 8px 8px',
      background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.96))'
    });

    // Shown only when there is genuinely more below, so it never lies about
    // content that is not there.
    function updateScrollFade() {
      var moreBelow = panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight > 4;
      scrollFade.style.opacity = moreBelow ? '1' : '0';
    }
    panelBody.addEventListener('scroll', updateScrollFade, { passive: true });
    // Content grows and shrinks as sections expand (the register form) and as
    // the roster loads, so recompute on size changes rather than only on scroll.
    if (typeof ResizeObserver === 'function') {
      try { new ResizeObserver(updateScrollFade).observe(panelBody); } catch (e) { /* ignore */ }
    }
    window.addEventListener('resize', updateScrollFade);
    setTimeout(updateScrollFade, 0);

    panel.append(panelHeader, panelBody, scrollFade);
    widget.append(pill, panel);

    // ── Mount: fixed overlay on the right, below the site nav bars ──
    Object.assign(widget.style, {
      position: 'fixed',
      top: PANEL_TOP + 'px',
      right: PANEL_GAP + 'px',
      zIndex: '99999',
      // Bound here too, so the widget itself can never be taller than the
      // screen even if a future child ignores the panel's own cap.
      maxHeight: 'calc(100vh - ' + (PANEL_TOP + PANEL_GAP) + 'px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end'
    });
    document.body.appendChild(widget);

    // ── Toggle logic ──
    function applyMinimized(min) {
      isMinimized = min;
      pill.style.display = min ? 'flex' : 'none';
      // 'flex', not 'block': the panel is a flex column (pinned header +
      // scrolling body), and restoring it as a block would drop that layout.
      panel.style.display = min ? 'none' : 'flex';
      localStorage.setItem(MINIMIZE_KEY, min ? 'true' : 'false');
    }

    pill.addEventListener('click', function() { applyMinimized(false); loadTonight(); });
    closeBtn.addEventListener('click', function() { applyMinimized(true); });
    applyMinimized(isMinimized);

    console.log('[Awana] Widget injected');
  }

  // Whether names leave the print PC encrypted. State only — see the long note
  // where the element is created for why the key itself is never rendered here.
  function renderPrivacyStatus(data) {
    var el = document.getElementById('awana-privacy-status');
    if (!el) return;
    // No welcome screen configured means no names on the wire and nothing to
    // warn about. Silence is the correct output, not a green badge.
    if (!data.pusher || !data.pusher.configured) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = '';
    if (data.displayKeyConfigured) {
      el.style.background = '#f0fdf4';
      el.style.border = '1px solid #bbf7d0';
      el.style.color = '#166534';
      el.textContent = '🔒 Names encrypted on the welcome screen'
        + (data.displayKeyId ? ' (key ' + data.displayKeyId + ')' : '');
    } else {
      el.style.background = '#fef2f2';
      el.style.border = '1px solid #fecaca';
      el.style.color = '#991b1b';
      var msg = document.createElement('span');
      msg.textContent = "⚠ Names are NOT encrypted — anyone can subscribe to the welcome screen's channel. ";
      var link = document.createElement('a');
      link.href = PRINT_SERVER + '/#display-key';
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Set a display key';
      link.style.color = '#991b1b';
      link.style.fontWeight = '700';
      el.append(msg, link);
    }
  }

  // Check server health: extension version mismatch, server updates, CSV warnings
  function checkForExtensionUpdate() {
    fetch(PRINT_SERVER + '/health', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        renderPrivacyStatus(data);
        var notice = document.getElementById('awana-update-notice');
        // Extension version mismatch (highest priority)
        if (data.version && data.version !== EXTENSION_VERSION) {
          if (notice) {
            notice.style.display = 'block';
            // When the app manages the extension folder, the new files are
            // ALREADY on disk — the app rewrote them at launch. Chrome just
            // hasn't re-read them. Say the action that actually works instead
            // of "reload extension", which reads as "go download it again".
            var managed = data.extension && data.extension.version === data.version;
            notice.textContent = managed
              ? 'Extension v' + data.version + ' is installed — restart Chrome to load it'
              : 'Update available: v' + data.version + ' (reload extension at chrome://extensions)';
          }
        } else if (data.latestVersion && data.latestVersion !== data.version) {
          // Server itself is outdated — offer one-click update. The server
          // exits with a special code and the launcher re-runs the installer.
          if (notice && notice.dataset.updating !== '1') {
            notice.style.display = 'block';
            notice.textContent = '';
            var msg = document.createElement('span');
            msg.textContent = 'Server update v' + data.latestVersion + ' available ';
            var updBtn = document.createElement('button');
            updBtn.textContent = 'Update now';
            Object.assign(updBtn.style, {
              fontSize: '10px', padding: '2px 8px', marginLeft: '6px',
              background: '#f59e0b', color: '#fff', border: 'none',
              borderRadius: '4px', cursor: 'pointer', fontWeight: '700'
            });
            updBtn.addEventListener('click', function() {
              notice.dataset.updating = '1';
              notice.textContent = 'Updating \u2014 the server will restart itself (about a minute)...';
              fetch(PRINT_SERVER + '/update-now', { method: 'POST', signal: AbortSignal.timeout(5000) })
                .catch(function() { /* server exits before responding sometimes — expected */ });
            });
            notice.append(msg, updBtn);
          }
        }
        // CSV warnings
        var csvWarning = document.getElementById('awana-csv-warning');
        if (csvWarning && data.warnings && Array.isArray(data.warnings)) {
          var hasCsvIssue = data.warnings.some(function(w) {
            return w.type === 'csvStale' || w.type === 'csvMissing' || w.type === 'csvEmpty';
          });
          csvWarning.style.display = hasCsvIssue ? 'block' : 'none';
        }
      })
      .catch(function() { /* server offline, ignore */ });
  }

  function fetchPrinters() {
    var select = document.getElementById('awana-printer-select');
    if (!select) return;
    fetch(PRINT_SERVER + '/printers', { signal: AbortSignal.timeout(5000) })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(data) {
        var printers = data.printers || [];
        var serverDefault = data.serverDefault || '';
        while (select.firstChild) select.removeChild(select.firstChild);
        var defOpt = document.createElement('option');
        defOpt.value = '';
        defOpt.textContent = serverDefault
          ? 'Server Default (' + serverDefault + ')'
          : 'Server Default (system)';
        select.appendChild(defOpt);
        printers.forEach(function(p) {
          var opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.name + (p.isWindowsDefault ? ' \u2605' : '');
          select.appendChild(opt);
        });
        var saved = localStorage.getItem(PRINTER_KEY) || '';
        var exists = Array.from(select.options).some(function(o) { return o.value === saved; });
        if (exists && saved) {
          select.value = saved;
        } else if (!saved && data.autoDetected) {
          // Auto-select when only one printer is connected and nothing was saved
          select.value = data.autoDetected;
          localStorage.setItem(PRINTER_KEY, data.autoDetected);
        } else {
          select.value = exists ? saved : '';
          if (!exists && saved) localStorage.removeItem(PRINTER_KEY);
        }
        selectedPrinterName = select.value;
        console.log('[Awana] Loaded ' + printers.length + ' printer(s)' +
          (data.autoDetected ? ' (auto-detected: ' + data.autoDetected + ')' : ''));
      })
      .catch(function(err) {
        console.log('[Awana] Could not load printers:', err.message);
        while (select.firstChild) select.removeChild(select.firstChild);
        var fallback = document.createElement('option');
        fallback.value = ''; fallback.textContent = 'Default (server)';
        select.appendChild(fallback);
        select.value = ''; selectedPrinterName = '';
      });
  }

  function setStatus(text) {
    const el = document.getElementById('awana-status');
    if (el) {
      el.textContent = text;
      console.log('[Awana] Status:', text);
    }
  }

  function clearStatus() {
    setTimeout(function() { setStatus(''); }, STATUS_TIMEOUT);
  }

  // ── Tonight's check-ins list (widget reprint) ──────────────────────────────
  // Pulls today's print history from the server and renders the most recent
  // prints with a one-tap reprint button — rescues torn/jammed/lost labels
  // without leaving the check-in page.
  function loadTonight() {
    var list = document.getElementById('awana-tonight-list');
    var count = document.getElementById('awana-tonight-count');
    if (!list) return;
    fetch(PRINT_SERVER + '/history/today', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(entries) {
        if (count) count.textContent = entries.length ? entries.length + ' printed' : '';
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!entries.length) {
          var empty = document.createElement('div');
          Object.assign(empty.style, { fontSize: '11px', color: '#94a3b8', padding: '2px 0' });
          empty.textContent = 'No check-ins yet tonight';
          list.appendChild(empty);
          return;
        }
        entries.slice(0, 8).forEach(function(e) {
          var fullName = ((e.firstName || '') + ' ' + (e.lastName || '')).trim();
          var row = document.createElement('div');
          Object.assign(row.style, {
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px', padding: '3px 6px', background: '#f8fafc',
            borderRadius: '4px'
          });
          var nameSpan = document.createElement('span');
          nameSpan.style.flex = '1';
          nameSpan.style.fontWeight = '600';
          nameSpan.textContent = fullName;
          var timeSpan = document.createElement('span');
          timeSpan.style.color = '#94a3b8';
          try {
            timeSpan.textContent = new Date(e.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          } catch (err) { timeSpan.textContent = ''; }
          var reBtn = document.createElement('button');
          reBtn.textContent = 'Reprint';
          Object.assign(reBtn.style, {
            fontSize: '10px', padding: '2px 8px', background: '#f1f5f9',
            border: '1px solid #e2e8f0', borderRadius: '4px', cursor: 'pointer',
            color: '#475569', fontWeight: '600'
          });
          reBtn.addEventListener('click', function() {
            reBtn.disabled = true;
            reBtn.textContent = '...';
            fetch(PRINT_SERVER + '/reprint', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: fullName }),
              signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
            }).then(function(r) {
              reBtn.disabled = false;
              reBtn.textContent = 'Reprint';
              if (r.ok) { setStatus('\u2705'); playSuccess(); } else { setStatus('\u274C'); playError(); }
              clearStatus();
            }).catch(function() {
              reBtn.disabled = false;
              reBtn.textContent = 'Reprint';
              setStatus('\u274C'); playError(); clearStatus();
            });
          });
          row.append(nameSpan, timeSpan, reBtn);
          list.appendChild(row);
        });
      })
      .catch(function() {
        if (count) count.textContent = '';
      });
  }

  function watchCheckins() {
    var debounceTimer = null;

    function checkForChange() {
      const lastCheckinEl = document.querySelector('#lastCheckin div');
      if (!lastCheckinEl) {
        lastPrintedName = null;
        return;
      }

      const clone = lastCheckinEl.cloneNode(true);
      const undoLink = clone.querySelector('a');
      if (undoLink) undoLink.remove();

      const text = clone.textContent.trim();

      if (isUndo(text)) {
        lastPrintedName = text;
      } else if (text && text !== lastPrintedName) {
        lastPrintedName = text;
        console.log('[Awana] Check-in detected:', text);
        onCheckin(text);
      } else if (!text) {
        lastPrintedName = null;
      }
    }

    const observer = new MutationObserver(function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkForChange, DEBOUNCE_MS);
    });

    const watchTarget = document.querySelector('#lastCheckin') || document.body;
    observer.observe(watchTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('[Awana] Watching for check-ins');
  }

  // ── Remote check-in detection ──────────────────────────────────────────────
  // Scan the visible .clubber list and compare against the previous scan.
  // Any name that was present last scan but is now missing just got checked
  // in (locally OR remotely).  On the very first scan we only populate the
  // baseline — we must NOT print the entire roster.

  // A search filter on the page hides .clubber rows the same way a check-in
  // does. Skip the diff scan whenever any non-widget text input has a value,
  // and drop any half-accumulated pendingMissing state — otherwise a quick
  // typing flap would breach PENDING_MISS_THRESHOLD and phantom-print.
  function isSearchActive() {
    var inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.id === 'awana-search-input') continue;
      // The widget's id is 'awana-widget'; the old '#awana-printer-widget'
      // selector matched nothing, and the walk-in guest field carries no id
      // (so the 'awana-walkin' prefix test never fired either). Net effect:
      // typing a walk-in guest's name silently froze remote check-in
      // detection until the field was cleared.
      if (inp.closest && inp.closest('#awana-widget')) continue;
      if (!inp.offsetParent) continue;
      var v = (inp.value || '').trim();
      if (v.length > 0) return true;
    }
    return false;
  }

  function scanClubberList() {
    if (isSearchActive()) {
      if (pendingMissing.size > 0) pendingMissing.clear();
      return;
    }
    var current = new Set();
    var clubberEls = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubberEls.length; i++) {
      var nameEl = clubberEls[i].querySelector('.name');
      if (!nameEl) continue;
      var displayName = nameEl.innerText.trim();
      if (!displayName) continue;
      // recid is TwoTimTwo's own id on the .clubber row — it gives exact
      // identity to the print server (CSV "Clubber ID" match), the direct
      // check-in API, AND the identity key below, so two kids sharing a
      // display name no longer collide (R-4).
      var recid = clubberEls[i].getAttribute('recid') || null;
      var idKey = identityKey(recid, displayName);
      var nk = nameKeyOf(displayName);
      var priorIdk = ROSTER_NAME_INDEX[nk];
      ROSTER_NAME_INDEX[nk] = (priorIdk && priorIdk !== idKey) ? AMBIGUOUS_NAME : idKey;
      current.add(idKey);

      // Cache club info + DOM element while the kid is still visible — once
      // they disappear, lookupClub() can't find them.  The element reference
      // is always refreshed so search/quick-mode clicks target the current DOM.
      var imgEl = clubberEls[i].querySelector('.club img');
      if (!ROSTER_CACHE[idKey]) {
        ROSTER_CACHE[idKey] = {
          displayName: displayName,
          clubName: imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '',
          clubImageData: imgEl ? getClubImageDataUrl(imgEl) : null,
          element: clubberEls[i],
          recid: recid,
          clubId: clubberEls[i].getAttribute('club_id') || null
        };
        rosterDirty = true;
      } else {
        // idKey already pins this entry to this specific recid (or, absent a
        // recid, this specific name) — just keep the element/club_id fresh.
        ROSTER_CACHE[idKey].element = clubberEls[i];
        var freshClubId = clubberEls[i].getAttribute('club_id') || null;
        if (freshClubId !== ROSTER_CACHE[idKey].clubId) {
          ROSTER_CACHE[idKey].clubId = freshClubId;
          rosterDirty = true;
        }
      }
    }

    if (!baselineScanned) {
      knownClubbers = current;
      baselineScanned = true;
      try { sessionStorage.setItem(REMOTE_BASELINE_KEY, '1'); } catch (e) {}
      console.log('[Awana] Baseline established: ' + current.size + ' kids');
      saveScanState();
      return;
    }

    // ── Guard A: mass-disappearance → re-baseline, no prints ────────────────
    // A filter/tab switch/reload with a different filter state can drop a
    // large chunk of .clubber rows at once. Those kids weren't checked in —
    // they're just no longer rendered. If the current scan lost >3 kids AND
    // shrunk to less than 80% of the previous known size, treat it as a UI
    // reshuffle and re-baseline WITHOUT printing.
    var missingCount = 0;
    knownClubbers.forEach(function(key) { if (!current.has(key)) missingCount++; });
    var shrunkRatio = knownClubbers.size > 0 ? (current.size / knownClubbers.size) : 1;
    if (missingCount > MASS_DISAPPEAR_ABS && shrunkRatio < MASS_DISAPPEAR_RATIO) {
      console.log('[Awana] Roster shrunk sharply (' + knownClubbers.size + ' → ' +
                  current.size + ', ' + missingCount + ' missing) — re-baselining, no prints');
      knownClubbers = current;
      pendingMissing.clear();
      saveScanState();
      return;
    }

    // ── Guard B: consecutive-miss confirmation ──────────────────────────────
    // A kid must be absent from PENDING_MISS_THRESHOLD consecutive scans before
    // we print their label. A single-scan flap (virtualization, brief filter)
    // never triggers a print. Reappearing in `current` clears the pending state.
    //
    // We evaluate the union of knownClubbers + pendingMissing so a kid who is
    // missing for scan N stays tracked through scan N+1 even after
    // knownClubbers gets reassigned to `current` below.
    var candidates = new Set();
    knownClubbers.forEach(function(k) { candidates.add(k); });
    pendingMissing.forEach(function(_, k) { candidates.add(k); });

    candidates.forEach(function(key) {
      if (current.has(key)) {
        // Reappeared — false alarm, forget any pending miss.
        if (pendingMissing.has(key)) pendingMissing.delete(key);
        return;
      }
      if (printedNames.has(key)) {
        pendingMissing.delete(key);
        return;
      }
      var meta = ROSTER_CACHE[key];
      if (!meta) return;
      var misses = (pendingMissing.get(key) || 0) + 1;
      if (misses < PENDING_MISS_THRESHOLD) {
        pendingMissing.set(key, misses);
        console.log('[Awana] ' + meta.displayName + ' missing ' + misses + '/' +
                    PENDING_MISS_THRESHOLD + ' — awaiting confirmation');
        return;
      }
      pendingMissing.delete(key);
      console.log('[Awana] Remote check-in detected:', meta.displayName);
      triggerRemotePrint(meta.displayName, meta.clubName, meta.clubImageData, meta.recid);
    });

    knownClubbers = current;
    saveScanState();
  }

  function triggerRemotePrint(fullName, clubName, clubImageData, recid) {
    if (selectedMode === 'off') return;
    var key = resolveIdentityKey(fullName, recid);
    // Same fix as onCheckin: per-name dedup is sufficient. The roster-diff
    // path can detect several remote check-ins in the same scan tick, and
    // each one needs to print — gating on a 2 s global cooldown silently
    // dropped all but the first.
    if (printedNames.has(key)) return;
    markPrinted(fullName, recid);
    doPrint(fullName, clubName || '', clubImageData || null,
      phoneNamesInFlight.has(nameKeyOf(fullName)) ? 'phone' : 'remote', recid);
  }

  // Re-query a .clubber row by display name. Element references captured
  // at findSiblings() time go stale once TwoTimTwo re-renders the roster
  // after a check-in, so batchCheckInSiblings must re-resolve before each
  // .click() — otherwise the click hits a detached node and the modal
  // never opens (label prints, page check-in silently fails).
  function findClubberElByName(name) {
    var target = (name || '').trim();
    if (!target) return null;
    var els = document.querySelectorAll('.clubber');
    for (var i = 0; i < els.length; i++) {
      var nameEl = els[i].querySelector('.name');
      if (nameEl && nameEl.innerText.trim() === target) return els[i];
    }
    return null;
  }

  function lookupClub(name) {
    var clubbers = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubbers.length; i++) {
      var clubber = clubbers[i];
      const nameEl = clubber.querySelector('.name');
      if (nameEl && nameEl.innerText.trim() === name) {
        const imgEl = clubber.querySelector('.club img');
        if (imgEl) {
          return {
            clubName: (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&'),
            clubImageData: getClubImageDataUrl(imgEl)
          };
        }
        return { clubName: '', clubImageData: null };
      }
    }
    return { clubName: '', clubImageData: null };
  }

  function onCheckin(name) {
    if (selectedMode === 'off') return;
    var key = resolveIdentityKey(name);
    // Per-name dedup is the actual deduplication mechanism. Two parents
    // checking different kids back-to-back must both print, so we do NOT
    // gate on a global time cooldown here — that was the v3.0.4 regression
    // that dropped the second of any two prints within 2 s.
    if (batchPrintedNames.has(key)) return; // already printed in batch
    if (printedNames.has(key)) return; // already printed this session (local or remote)

    var cachedMeta = rosterLookupByName(name);
    markPrinted(name, cachedMeta && cachedMeta.recid);
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData, 'local', cachedMeta && cachedMeta.recid);

    // Sibling suggest (#26): panel-only — NEVER auto-batch. The volunteer
    // confirms "Also here tonight?" chips; kill switch: enableDrivenCheckin
    // in the server config.
    if (CHURCH_CFG.enableDrivenCheckin !== false) {
      setTimeout(function() {
        findSiblings(name).then(function(siblings) {
          if (siblings.length === 0) return;
          showSiblingPanel(siblings, name);
        }).catch(function() { /* sibling lookup is best-effort */ });
      }, 500);
    }
  }

  function doPrint(fullName, clubName, imageData, source, explicitClubberId) {
    setStatus('\u23F3');

    var parts = fullName.split(' ');
    var firstName = parts[0] || '';
    var lastName = parts.slice(1).join(' ') || '';

    if (isUndo(firstName) || isUndo(lastName) || isUndo(clubName)) {
      setStatus('\uD83D\uDEAB');
      clearStatus();
      return;
    }

    var payload = {
      name: fullName, clubName: clubName, clubImageData: imageData,
      printerName: selectedPrinterName || '',
      stepUpNight: isStepUpNight()
    };
    // TwoTimTwo's own clubber id lets the server match the exact CSV row even
    // when two kids share a name or a middle name is on the label. An
    // explicitly-known id (reconcile report, roster-diff meta) wins over the
    // ROSTER_CACHE lookup by name; name stays as the fallback for walk-ins
    // and offline entries with no cached row.
    var cached = rosterLookupByName(fullName);
    var resolvedClubberId = explicitClubberId || (cached && cached.recid) || null;
    if (resolvedClubberId) payload.clubberId = resolvedClubberId;
    if (isAwanaStoreNight()) {
      var bal = getShareBalance(firstName, lastName);
      if (bal !== null) payload.awanaShares = bal + 1;
    }

    console.log('[Awana] POST /print:', fullName, '|', clubName || '(no club)');

    function attemptPrint(p, retriesLeft) {
      return fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
      }).then(function(response) {
        if (response.ok) return true;
        throw new Error('HTTP ' + response.status);
      }).catch(function(err) {
        if (retriesLeft > 0) {
          console.log('[Awana] Print failed, retrying in 3s (' + retriesLeft + ' left):', err.message);
          return new Promise(function(resolve) {
            setTimeout(function() { resolve(attemptPrint(p, retriesLeft - 1)); }, 3000);
          });
        }
        throw err;
      });
    }

    var printPromise;
    if (selectedMode !== 'dialog') {
      printPromise = attemptPrint(payload, 1).then(function() {
        setStatus('\u2705');
        playSuccess();
        clearStatus();
        flushQueue();
        loadTonight();
        recordFeed(fullName, source, true);
        console.log('[Awana] Silent print sent to server');
        return true;
      }).catch(function(err) {
        console.log('[Awana] Server unavailable after retry, queuing:', err.message);
        queuePrint(payload);
        recordFeed(fullName, source, false);
        setStatus('\uD83D\uDCE6'); // 📦 queued icon
        clearStatus();
        return false;
      });
    } else {
      printPromise = Promise.resolve(false);
    }

    printPromise.then(function(sentToServer) {
      if (sentToServer || selectedMode === 'off') return;
      if (selectedMode === 'dialog') fallbackPrint(firstName, lastName, clubName, imageData);
    });
  }

  function fallbackPrint(firstName, lastName, clubName, imageData) {
    // Ask the server to generate the same label PNG it would silently print,
    // then show it in the browser's print dialog — so both modes look identical.
    var fullName = firstName + (lastName ? ' ' + lastName : '');
    fetch(PRINT_SERVER + '/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fullName, clubName: clubName, clubImageData: imageData }),
      signal: AbortSignal.timeout(5000)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.blob();
    }).then(function(blob) {
      var reader = new FileReader();
      reader.onload = function() { printLabelDataUrl(reader.result); };
      reader.readAsDataURL(blob);
    }).catch(function(err) {
      console.warn('[Awana] /label unavailable (' + err.message + '), using local HTML');
      printLabelDataUrl(null, firstName, lastName, clubName, imageData);
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function printLabelDataUrl(dataUrl, firstName, lastName, clubName, imageData) {
    var frame = document.getElementById('awana-print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'awana-print-frame';
      Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0',
        width: '0', height: '0', border: '0', visibility: 'hidden' });
      document.body.appendChild(frame);
    }

    var html;
    if (dataUrl) {
      // Server-generated PNG — same output as auto-print
      html = '<!DOCTYPE html><html><head><style>' +
        '@page { size: 4in 2in; margin: 0; }' +
        '* { margin: 0; padding: 0; }' +
        'body { width: 4in; height: 2in; overflow: hidden; }' +
        'img { width: 4in; height: 2in; display: block; }' +
        '</style></head><body><img src="' + dataUrl + '"/></body></html>';
    } else {
      // ── Offline fallback label ───────────────────────────────────────────
      // Fires ONLY when the print server is unreachable, which is exactly why
      // it cannot be unified with the real renderer: every safety field on a
      // normal label — allergy icons, birthday, photo-consent, handbook group —
      // is derived by the SERVER from its roster CSV. The extension has never
      // held that data, so an offline label physically cannot show it.
      //
      // The danger is therefore not the missing icons, it's that the label
      // still LOOKS complete: a volunteer who has learned "no peanut icon means
      // no peanut allergy" would read this as safe. So it says plainly that it
      // is incomplete. A label that admits what it doesn't know is safe; one
      // that quietly omits an allergy is not.
      //
      // Names, club names, and the icon URL all come from the page's DOM, so
      // they go through escapeHtml/attr before being concatenated into markup —
      // an apostrophe or an angle bracket in a kid's name would otherwise
      // mangle (or inject into) the label.
      var fontSize = (firstName || '').length > 12 ? '32pt' : (firstName || '').length > 8 ? '40pt' : '48pt';
      var iconHtml = imageData
        ? '<div class="icon-col"><img src="' + escapeHtml(imageData) + '"/></div><div class="divider"></div>'
        : '';
      var lastNameHtml = lastName ? '<div class="ln">' + escapeHtml(lastName) + '</div>' : '';
      var clubHtml = clubName
        ? '<div class="sep"></div><div class="cn">' + escapeHtml(clubName) + '</div>'
        : '';
      html = '<!DOCTYPE html><html><head><style>' +
        '@page { size: 4in 2in; margin: 0; }' +
        '* { box-sizing: border-box; margin: 0; padding: 0; }' +
        'body { width: 4in; height: 2in; display: flex; align-items: center; justify-content: center; font-family: Helvetica, Arial, sans-serif; }' +
        '.badge { width: 3.8in; height: 1.8in; border: 1.5pt solid #000; border-radius: 12pt; display: flex; align-items: stretch; overflow: hidden; }' +
        '.icon-col { width: 1.1in; display: flex; align-items: center; justify-content: center; background: #f4f4f4; flex-shrink: 0; padding: 8pt; }' +
        '.icon-col img { width: 52pt; height: 52pt; object-fit: contain; }' +
        '.divider { width: 1pt; background: #ddd; flex-shrink: 0; }' +
        '.text { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 6pt 10pt; text-align: center; }' +
        '.fn { font-size: ' + fontSize + '; font-weight: bold; line-height: 1.05; word-break: break-word; }' +
        '.ln { font-size: 20pt; margin-top: 2pt; }' +
        '.sep { width: 65%; height: 0.5pt; background: #ccc; margin: 5pt auto; }' +
        '.cn { font-size: 12pt; font-style: italic; color: #444; }' +
        // Inverted band so it survives a 1-bit thermal print and is impossible
        // to mistake for part of the normal layout.
        '.offline { margin-top: 4pt; background: #000; color: #fff; font-size: 8pt; ' +
        'font-weight: bold; letter-spacing: 0.4pt; padding: 2pt 6pt; border-radius: 3pt; }' +
        '</style></head><body><div class="badge">' +
        iconHtml +
        '<div class="text"><div class="fn">' + escapeHtml(firstName || '') + '</div>' +
        lastNameHtml + clubHtml +
        '<div class="offline">OFFLINE &mdash; CHECK ALLERGY LIST</div>' +
        '</div></div></body></html>';
    }

    frame.contentWindow.document.open();
    frame.contentWindow.document.write(html);
    frame.contentWindow.document.close();

    setTimeout(function() {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setStatus('\u2705');
        console.log('[Awana] Print dialog opened');
      } catch (err) {
        setStatus('\u274C');
        console.error('[Awana] Print failed:', err);
      }
      clearStatus();
    }, 600);
  }

  // Sync clubbers.csv from the authenticated browser session to the print server.
  // The browser has session cookies for twotimtwo.com, so fetch('/clubber/csv')
  // succeeds here even though PowerShell's Invoke-WebRequest can't authenticate.
  function setCsvStatus(text, color) {
    var el = document.getElementById('awana-csv-status');
    if (el) {
      el.textContent = text;
      el.style.color = color || '#94a3b8';
    }
  }

  function syncCsv() {
    setCsvStatus('Syncing roster...', '#94a3b8');
    fetch('/clubber/csv')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('html') !== -1) throw new Error('Got HTML, not CSV (login required?)');
        return r.text();
      })
      .then(function(csv) {
        if (!csv || !csv.trim()) {
          setCsvStatus('No roster data from site', '#f59e0b');
          return;
        }
        return fetch(PRINT_SERVER + '/update-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csv }),
          signal: AbortSignal.timeout(5000)
        });
      })
      .then(function(r) {
        if (r && r.ok) {
          return r.json();
        }
      })
      .then(function(data) {
        if (data && data.count !== undefined) {
          setCsvStatus('Roster synced (' + data.count + ' clubbers)', '#22c55e');
          console.log('[Awana] Synced clubbers.csv to print server (' + data.count + ' clubbers)');
        }
      })
      .catch(function(err) {
        console.log('[Awana] CSV sync failed:', err.message);
        // Check if the server already has roster data on disk from a previous sync
        fetch(PRINT_SERVER + '/roster-status', { signal: AbortSignal.timeout(3000) })
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.count > 0) {
              setCsvStatus('Using saved roster (' + data.count + ')', '#f59e0b');
            } else {
              setCsvStatus('No roster data -- labels will be basic', '#ef4444');
            }
          })
          .catch(function() {
            setCsvStatus('Server offline -- no roster data', '#ef4444');
          });
      });
  }

  // ── Peak-window auto-refresh ───────────────────────────────────────────────
  // TwoTimTwo.com doesn't push updates of remote check-ins, so during the
  // busiest window (5:40 PM - 6:00 PM) we reload the page every 30 seconds
  // so the .clubber-list diff sees the latest state.  Suppressed while the
  // user is mid-action (modal open, sibling panel open, typing).
  function autoRefresh() {
    try {
      if (document.hidden) return;
      // Club night only. The clock window alone has no day component, so a
      // tab left open on any other evening was reloading itself every 30 s
      // between 5:40 and 6:00 — losing whatever the volunteer was doing.
      if (!isInClubWindow()) return;
      var now = new Date();
      var mins = now.getHours() * 60 + now.getMinutes();
      var WINDOW_START = 17 * 60 + 40; // 5:40 PM
      var WINDOW_END   = 18 * 60;      // 6:00 PM
      if (mins < WINDOW_START || mins >= WINDOW_END) return;

      // Suppress reload if any modal / panel is open or user is typing
      if (document.getElementById('awana-sibling-panel')) return;
      if (document.getElementById('checkin-modal')) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

      console.log('[Awana] Peak-window auto-refresh');
      location.reload();
    } catch (e) { console.log('[Awana] autoRefresh error:', e); }
  }


  // ── Church config (#50) ─────────────────────────────────────────────────────
  // Club-night windows, shares club ids, and the driven-check-in kill switch
  // come from the print server (GET /config/church + /config) with baked KVBC
  // fallbacks, replacing scattered hardcodes.
  var CHURCH_CFG = {
    sharesClubIds: [2, 3, 4, 5, 6],
    clubNights: [{ dow: 3, start: '17:30', end: '20:00' }],
    enableDrivenCheckin: true
  };

  function loadChurchConfig() {
    fetch(PRINT_SERVER + '/config/church', { signal: AbortSignal.timeout(4000) })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (Array.isArray(cfg.sharesClubIds) && cfg.sharesClubIds.length) CHURCH_CFG.sharesClubIds = cfg.sharesClubIds;
        if (Array.isArray(cfg.clubNights) && cfg.clubNights.length) CHURCH_CFG.clubNights = cfg.clubNights;
        console.log('[Awana] Church config loaded');
      })
      .catch(function() { /* baked defaults */ });
    fetch(PRINT_SERVER + '/config', { signal: AbortSignal.timeout(4000) })
      .then(function(r) { return r.json(); })
      .then(function(cfg) {
        if (cfg && cfg.enableDrivenCheckin === false) CHURCH_CFG.enableDrivenCheckin = false;
      })
      .catch(function() { /* default on */ });
  }

  function parseHM(v) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function isInClubWindow() {
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    return CHURCH_CFG.clubNights.some(function(w) {
      if (!w || Number(w.dow) !== now.getDay()) return false;
      var st = parseHM(w.start), en = parseHM(w.end);
      return st !== null && en !== null && mins >= st && mins < en;
    });
  }

  // ── Confirmation feed (#17a) + pinned last-5 (#29 polish) ──────────────────
  // Every print this station sends, newest first, with how it was detected:
  // local click, remote roster-diff, phone check-in, manual widget action, or
  // R-1's reconcile-against-checkin_report catch-up.
  var printFeed = []; // { name, source, ok, at }
  var SOURCE_ICON = { local: '🖱', remote: '📡', phone: '📱', manual: '⌨', reconcile: '♻️' };

  function recordFeed(name, source, ok) {
    printFeed.unshift({ name: name, source: source || 'manual', ok: ok, at: Date.now() });
    if (printFeed.length > 5) printFeed.length = 5;
    renderPrintFeed();
  }

  function renderPrintFeed() {
    var list = document.getElementById('awana-feed-list');
    if (!list) return;
    list.innerHTML = '';
    if (!printFeed.length) {
      list.textContent = 'No prints yet tonight';
      list.style.color = '#94a3b8';
      return;
    }
    list.style.color = '';
    printFeed.forEach(function(f) {
      var row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', padding: '1px 0' });
      var icon = document.createElement('span');
      icon.textContent = SOURCE_ICON[f.source] || '⌨';
      icon.title = f.source;
      var nm = document.createElement('span');
      nm.style.fontWeight = '600';
      nm.style.flex = '1';
      nm.style.overflow = 'hidden';
      nm.style.textOverflow = 'ellipsis';
      nm.style.whiteSpace = 'nowrap';
      nm.textContent = f.name;
      var check = document.createElement('span');
      check.textContent = f.ok ? '✓ printed' : '📦 queued';
      check.style.color = f.ok ? '#16a34a' : '#f59e0b';
      row.append(icon, nm, check);
      list.appendChild(row);
    });
  }

  // ── Phone check-in executor (#17b) ──────────────────────────────────────────
  // The phone page queues actions on the print server; this station (which
  // holds the authenticated TwoTimTwo session) long-polls for them and drives
  // the real check-in in the DOM. The label prints via the normal detection
  // path — never directly — so dedup still guarantees a single label.
  var phoneActionsInFlight = new Set();  // action ids being driven
  var phoneNamesInFlight = new Set();    // lowercased names → tag feed source

  function reportPhoneAction(id, ok, detail) {
    fetch(PRINT_SERVER + '/pending-actions/' + id + '/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: ok, detail: detail || '' }),
      signal: AbortSignal.timeout(4000)
    }).catch(function() {});
  }

  function executePhoneAction(action) {
    if (phoneActionsInFlight.has(action.id)) return;
    phoneActionsInFlight.add(action.id);
    var nameKey = action.name.toLowerCase().trim();

    if (isPrinted(action.name)) {
      reportPhoneAction(action.id, true, 'Already checked in at this station');
      return;
    }
    var el = findClubberElByName(action.name);
    if (!el) {
      reportPhoneAction(action.id, false, 'Kid not on the check-in page (already in, or filtered)');
      return;
    }
    console.log('[Awana] Phone check-in: driving ' + action.name);
    phoneNamesInFlight.add(nameKey);
    var recid = el.getAttribute('recid');
    var clubId = el.getAttribute('club_id');

    // Success = the row vanishes (TwoTimTwo removes checked-in kids).
    function verifyAndReport() {
      var deadline = Date.now() + 25000;
      (function verify() {
        if (!findClubberElByName(action.name)) {
          reportPhoneAction(action.id, true, '');
          setTimeout(function() { phoneNamesInFlight.delete(nameKey); }, 15000);
          return;
        }
        if (Date.now() > deadline) {
          phoneNamesInFlight.delete(nameKey);
          reportPhoneAction(action.id, false, 'Row did not clear — check in at the desk');
          return;
        }
        setTimeout(verify, 1000);
      })();
    }

    // F-2: try the direct check-in POST first; fall back to click + poll.
    tryDirectCheckin(recid, action.name, clubId, {}).then(function(ok) {
      if (ok) {
        reportPhoneAction(action.id, true, '');
        setTimeout(function() { phoneNamesInFlight.delete(nameKey); }, 15000);
        return;
      }
      el.click();
      pollForCheckinButton({ name: action.name, element: el }, [], {}, 30);
      verifyAndReport();
    });
  }

  function pollPendingActions() {
    if (CHURCH_CFG.enableDrivenCheckin === false) {
      setTimeout(pollPendingActions, 60000);
      return;
    }
    fetch(PRINT_SERVER + '/pending-actions', { signal: AbortSignal.timeout(30000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        (data.actions || []).forEach(executePhoneAction);
        setTimeout(pollPendingActions, 500);
      })
      .catch(function() { setTimeout(pollPendingActions, 10000); });
  }

  // ── R-1: reconcile against TwoTimTwo's own check-in report ─────────────────
  // scanClubberList() infers remote check-ins from rows vanishing off the
  // roster — a heuristic guarded against filters/re-renders/mass-disappear,
  // but still a heuristic. /clubber/checkin_report (docs/TWOTIMTWO.md §2.4) is
  // the authoritative "who is checked in tonight" list, so periodically
  // cross-checking it catches anything the diff engine missed (a station that
  // was asleep, a scan that happened to land on a guard, etc).
  var RECONCILE_MAX_PRINTS          = 5;
  var RECONCILE_FIRST_DELAY_MS      = 60 * 1000;
  var RECONCILE_INTERVAL_CLUB_MS    = 60 * 1000;
  var RECONCILE_INTERVAL_OFF_MS     = 10 * 60 * 1000;

  function fetchCheckinReport() {
    return fetch('/clubber/checkin_report?date=' + todayIsoDate(), { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
      .then(function(r) { return r.ok ? r.text() : null; })
      .then(function(html) {
        if (!html || html.indexOf('Login Required') !== -1) return null;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var tables = doc.querySelectorAll('table');
        if (!tables.length) return null;
        var out = [];
        tables.forEach(function(table) {
          var titleTh = table.querySelector('th.title');
          var clubImg = titleTh ? titleTh.querySelector('img[alt]') : null;
          var clubName = clubImg ? (clubImg.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
          var rows = table.querySelectorAll('tbody tr');
          rows.forEach(function(row) {
            var tds = row.querySelectorAll('td');
            if (!tds.length) return;
            var link = tds[0].querySelector('a[href*="/meeting/clubberCheckin/"]');
            if (!link) return;
            var m = /\/meeting\/clubberCheckin\/(\d+)/.exec(link.getAttribute('href') || '');
            if (!m) return;
            var clubberId = m[1];
            var name = tds.length > 1 ? (tds[1].textContent || '').trim() : '';
            if (!name) {
              // Defensive fallback if the name is folded into the same cell as
              // the edit link, rather than its own <td> — strip the link's own
              // text so what remains is (hopefully) just the child's name.
              var clone = tds[0].cloneNode(true);
              var innerLink = clone.querySelector('a');
              if (innerLink) innerLink.remove();
              name = (clone.textContent || '').trim();
            }
            if (!name) return;
            out.push({ clubberId: clubberId, name: name, club: clubName });
          });
        });
        return out;
      })
      .catch(function(e) {
        console.log('[Awana] Reconcile fetch failed:', e.message);
        return null;
      });
  }

  // Undo detection (roadmap follow-up to R-1): post this SAME authoritative
  // list to the print server on every successful parse, not just when it's
  // used to catch a missed check-in. The server has no way on its own to
  // learn that a check-in it already printed a label for was later undone on
  // TwoTimTwo — its print-history.json only ever grows — so it diffs this
  // report against that history to notice one. `ok: true` is sent ONLY when
  // fetchCheckinReport() actually parsed a real report (never inferred from
  // an empty list, which just as plausibly means a login bounce or a missing
  // table); the server refuses anything without it rather than guess.
  // Best-effort and silent on failure, same as every other feed post in this
  // codebase — a print-server hiccup or an older server build without this
  // route must never interrupt reconcile's own missed-check-in/phantom work.
  function postCheckinReport(entries) {
    fetch(PRINT_SERVER + '/feed/checkin-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        entries: entries.map(function(e) {
          return { clubberId: e.clubberId, name: e.name, club: e.club };
        })
      }),
      signal: AbortSignal.timeout(8000)
    }).catch(function() { /* best-effort — never block reconcile on this */ });
  }

  function updateReconcileWidget(phantomCount) {
    var el = document.getElementById('awana-reconcile-status');
    if (!el) return;
    if (phantomCount > 0) {
      el.textContent = '⚠ ' + phantomCount + ' phantom?';
      el.style.color = '#f59e0b';
      el.title = phantomCount + ' printed name(s) not found in tonight’s TwoTimTwo report';
    } else {
      el.textContent = 'Reconciled ✓';
      el.style.color = '#94a3b8';
      el.title = '';
    }
  }

  function runReconcile() {
    if (reconcileInFlight) return Promise.resolve();
    reconcileInFlight = true;
    return fetchCheckinReport().then(function(entries) {
      reconcileInFlight = false;
      if (entries === null) {
        console.log('[Awana] Reconcile: report unavailable this pass (login required / no tables)');
        return;
      }
      console.log('[Awana] Reconcile: report has ' + entries.length + ' checked-in kid(s)');
      postCheckinReport(entries);

      if (!reconcileBaselineDone) {
        // First successful reconcile this session: seed dedup with everyone
        // already checked in so we never print the whole existing roster —
        // a station opened mid-event must not trigger a paper explosion.
        // Persisted to sessionStorage so a page reload can't re-baseline.
        entries.forEach(function(e) { markPrinted(e.name, e.clubberId); });
        reconcileBaselineDone = true;
        try { sessionStorage.setItem(REMOTE_RECONCILE_BASELINE_KEY, '1'); } catch (err) { /* ignore */ }
        console.log('[Awana] Reconcile: baseline seeded with ' + entries.length + ' existing check-in(s) — will not print for these');
        updateReconcileWidget(0);
        return;
      }

      // Anyone in the report not already printed this session is a check-in
      // the roster-diff detector missed.
      var missed = entries.filter(function(e) { return !isPrinted(e.name, e.clubberId); });

      // Inverse check — TELEMETRY ONLY. Never unprint, never print for this.
      // Note this intentionally also flags plain walk-in prints that were
      // never registered in TwoTimTwo (F-3 checkbox left off) — that's
      // expected noise, not necessarily a real phantom.
      // Match on BOTH the id key and the name key: a child in the report under
      // an id may have been printed under their name (see isPrinted), and
      // counting that as a phantom would cry wolf on every walk-in.
      var reportKeys = new Set();
      entries.forEach(function(e) {
        reportKeys.add(identityKey(e.clubberId, e.name));
        reportKeys.add('nm:' + nameKeyOf(e.name));
      });
      var phantomCount = 0;
      printedNames.forEach(function(key) { if (!reportKeys.has(key)) phantomCount++; });
      if (phantomCount > 0) {
        console.warn('[Awana] Reconcile: ' + phantomCount + ' locally-printed name(s) not present in tonight\'s report (possible phantom print)');
      }
      updateReconcileWidget(phantomCount);

      if (missed.length === 0) return;
      if (missed.length > RECONCILE_MAX_PRINTS) {
        console.warn('[Awana] Reconcile found ' + missed.length + ' missed check-in(s) — printing only ' +
          RECONCILE_MAX_PRINTS + ' this pass (a gap this large means something is wrong; check the roster)');
      }
      missed.slice(0, RECONCILE_MAX_PRINTS).forEach(function(e) {
        // Mode check FIRST. Marking before it meant a reconcile tick that fired
        // while a volunteer had printing off (reloading paper) permanently ate
        // those check-ins — flipping the mode back never recovered them, unlike
        // every other detection path, which returns before marking.
        if (selectedMode === 'off') return;
        markPrinted(e.name, e.clubberId);
        var cached = rosterLookupByName(e.name);
        var clubName = (cached && cached.clubName) || e.club || '';
        var clubImageData = (cached && cached.clubImageData) || null;
        console.log('[Awana] Reconcile: printing missed check-in for ' + e.name);
        doPrint(e.name, clubName, clubImageData, 'reconcile', e.clubberId);
      });
    }).catch(function(err) {
      reconcileInFlight = false;
      console.log('[Awana] Reconcile error:', err.message);
    });
  }

  function scheduleNextReconcile() {
    var delay = isInClubWindow() ? RECONCILE_INTERVAL_CLUB_MS : RECONCILE_INTERVAL_OFF_MS;
    setTimeout(function() {
      runReconcile().then(scheduleNextReconcile).catch(scheduleNextReconcile);
    }, delay);
  }

  // ── Selector self-test ───────────────────────────────────────────────────────
  // The whole detection pipeline hangs off a handful of TwoTimTwo DOM
  // selectors. If the site ships a redesign, everything fails SILENTLY — the
  // widget still shows green and nobody notices until kids stop getting
  // labels. This probes the live DOM every 10 minutes, reports to the server
  // (dashboard Night Status card), and throws a loud page banner on hard
  // failure. Modal selectors (#checkin-modal, button#checkin) only exist
  // while a modal is open, so they're verified passively by the driven
  // check-in paths, not here.
  var SELFTEST_INTERVAL_MS = 10 * 60 * 1000;
  var selectorBannerShown = false;

  function runSelectorSelfTest() {
    var results = [];
    try {
      var clubberEls = document.querySelectorAll('.clubber');
      results.push({ check: '.clubber roster rows', passed: clubberEls.length > 0, detail: clubberEls.length + ' row(s)' });

      var namesOk = false, iconsOk = false;
      if (clubberEls.length > 0) {
        for (var i = 0; i < clubberEls.length; i++) {
          if (clubberEls[i].querySelector('.name')) { namesOk = true; break; }
        }
        for (var j = 0; j < clubberEls.length; j++) {
          if (clubberEls[j].querySelector('.club img')) { iconsOk = true; break; }
        }
        results.push({ check: '.clubber .name', passed: namesOk, detail: namesOk ? '' : 'no .name inside any .clubber row' });
        // Missing icons only degrade the label (monogram fallback) — soft check.
        results.push({ check: '.club img icons', passed: iconsOk, detail: iconsOk ? '' : 'no club icons found (labels fall back to monograms)' });
      }

      var lastCheckinOk = !!document.querySelector('#lastCheckin');
      results.push({ check: '#lastCheckin', passed: lastCheckinOk, detail: lastCheckinOk ? '' : 'local check-in detection is blind' });

      // Hard failure = the load-bearing selectors are gone while the page has
      // real content (an empty roster after everyone checks in is normal).
      var pageHasContent = document.body && document.body.children.length > 3;
      var hard = pageHasContent && (!lastCheckinOk || (clubberEls.length > 0 && !namesOk));
      var ok = !hard;

      fetch(PRINT_SERVER + '/selftest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: ok, results: results, extensionVersion: EXTENSION_VERSION }),
        signal: AbortSignal.timeout(3000)
      }).catch(function() { /* server offline — dashboard will show stale */ });

      if (hard && !selectorBannerShown) {
        selectorBannerShown = true;
        var banner = document.createElement('div');
        banner.id = 'awana-selector-banner';
        banner.textContent = '⚠ AWANA PRINTER: the check-in page layout has changed — automatic label printing may be broken. Use the widget search or walk-in printing, and check the dashboard.';
        Object.assign(banner.style, {
          position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
          background: '#dc2626', color: '#fff', fontWeight: '700',
          fontSize: '14px', padding: '10px 16px', textAlign: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
        });
        document.body.appendChild(banner);
      } else if (!hard && selectorBannerShown) {
        selectorBannerShown = false;
        var existing = document.getElementById('awana-selector-banner');
        if (existing) existing.remove();
      }
      return ok;
    } catch (e) {
      console.log('[Awana] Selector self-test error:', e);
      return true; // a broken probe must not cry wolf
    }
  }

  // ── Quick Mode: one-click check-in interceptor ──────────────────────────────
  // When Quick Mode is ON, intercept clicks on .clubber elements. Let the native
  // click flow through (TwoTimTwo opens its modal), then auto-dismiss the modal.
  // We print immediately — before the modal even opens — since we already have
  // the name + club info.  The existing onCheckin() path also fires when
  // #lastCheckin updates, but printedNames dedup prevents a double print.
  var _quickModeProcessing = false;
  document.body.addEventListener('click', function(e) {
    if (!quickModeEnabled) return;
    if (_quickModeProcessing) return;
    var clubberEl = e.target.closest('.clubber');
    if (!clubberEl) return;
    var nameEl = clubberEl.querySelector('.name');
    if (!nameEl) return;
    var name = nameEl.innerText.trim();
    if (!name) return;
    if (selectedMode === 'off') return;
    var recid = clubberEl.getAttribute('recid') || null;
    if (isPrinted(name, recid)) return; // already printed
    var batchKey = resolveIdentityKey(name, recid);
    if (batchPrintedNames.has(batchKey)) return;

    console.log('[Awana] Quick Mode check-in:', name);
    // Print immediately
    markPrinted(name, recid);
    batchPrintedNames.add(batchKey);
    setTimeout(function() { batchPrintedNames.delete(batchKey); }, 8000);
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData, undefined, recid);

    // SIBLING CHECK-IN DISABLED — re-enable by uncommenting this block.
    // setTimeout(function() {
    //   findSiblings(name).then(function(siblings) {
    //     if (siblings && siblings.length > 0) {
    //       console.log("[Awana] Quick Mode: automatically checking in " + siblings.length + " sibling(s)");
    //       var autoSibs = siblings.map(function(sib) {
    //         return Object.assign({}, sib, { options: {} });
    //       });
    //       batchCheckInSiblings(autoSibs);
    //     }
    //   });
    // }, 500);

    // F-2: try the direct check-in POST first — this blocks TwoTimTwo's own
    // click handler from ever opening a modal at all. Only if the direct path
    // is unavailable/fails do we replay the click and fall back to the
    // original open-modal + auto-dismiss dance.
    if (recid && CHURCH_CFG.enableDrivenCheckin !== false) {
      e.preventDefault();
      e.stopPropagation();
      var clubId = clubberEl.getAttribute('club_id') || null;
      tryDirectCheckin(recid, name, clubId, {}).then(function(ok) {
        if (ok) return;
        _quickModeProcessing = true;
        clubberEl.click();
        setTimeout(function() {
          pollForCheckinButton({ name: name, element: clubberEl }, [], {}, 30);
          setTimeout(function() { _quickModeProcessing = false; }, 500);
        }, 150);
      });
      return;
    }

    // Let native click open the modal, then auto-dismiss after 150ms
    setTimeout(function() {
      _quickModeProcessing = true;
      pollForCheckinButton({ name: name, element: clubberEl }, [], {}, 30);
      setTimeout(function() { _quickModeProcessing = false; }, 500);
    }, 150);
  }, true); // capture phase

  injectWidget();
  loadPrintedState();
  // Restore printer selection from chrome.storage.local (survives extension updates)
  // Also restore Step Up Night and Awana Store mode if set on the options page.
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['awana_selectedPrinterName', 'awana_stepUpMode', 'awana_storeMode'], function(result) {
      if (result.awana_selectedPrinterName && !localStorage.getItem(PRINTER_KEY)) {
        selectedPrinterName = result.awana_selectedPrinterName;
        localStorage.setItem(PRINTER_KEY, selectedPrinterName);
        var sel = document.getElementById('awana-printer-select');
        if (sel) sel.value = selectedPrinterName;
      }
      if (result.awana_stepUpMode && result.awana_stepUpMode !== stepUpMode) {
        stepUpMode = result.awana_stepUpMode;
        localStorage.setItem(STEP_UP_KEY, stepUpMode);
        var sus = document.getElementById('awana-stepup-select');
        if (sus) sus.value = stepUpMode;
      }
      if (result.awana_storeMode && result.awana_storeMode !== storeMode) {
        storeMode = result.awana_storeMode;
        localStorage.setItem(STORE_KEY, storeMode);
        var sst = document.getElementById('awana-store-select');
        if (sst) sst.value = storeMode;
        if (isAwanaStoreNight()) fetchShareBalances();
      }
    });
    chrome.storage.onChanged && chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if (changes.awana_stepUpMode) {
        stepUpMode = changes.awana_stepUpMode.newValue || 'auto';
        localStorage.setItem(STEP_UP_KEY, stepUpMode);
        var sus = document.getElementById('awana-stepup-select');
        if (sus) sus.value = stepUpMode;
      }
      if (changes.awana_storeMode) {
        storeMode = changes.awana_storeMode.newValue || 'auto';
        localStorage.setItem(STORE_KEY, storeMode);
        var sst = document.getElementById('awana-store-select');
        if (sst) sst.value = storeMode;
        if (isAwanaStoreNight()) fetchShareBalances();
      }
    });
  }
  fetchPrinters();
  watchCheckins();
  loadTonight();
  // Establish the roster baseline on load (or re-populate ROSTER_CACHE after a
  // reload that preserved baselineScanned via sessionStorage).
  setTimeout(scanClubberList, 500);
  // If the page produced no roster (site down, offline reload), fall back to
  // the copy cached in chrome.storage.local so search still works.
  setTimeout(restoreRosterFromLocal, 2000);
  // Safety-net scan in case the MutationObserver misses a DOM change —
  // adaptive (#17a): 2 s inside the club-night window so remote check-ins
  // print fast at the door, 5 s the rest of the week. Self-rescheduling
  // setTimeout instead of setInterval so a slow scan can never stack.
  (function scheduleScan() {
    setTimeout(function() {
      try { scanClubberList(); } catch (e) { /* keep scanning */ }
      scheduleScan();
    }, isInClubWindow() ? 2000 : SCAN_INTERVAL_MS);
  })();
  // Peak-window auto-refresh
  setInterval(autoRefresh, AUTO_REFRESH_INTERVAL_MS);
  loadChurchConfig();
  setTimeout(pollPendingActions, 4000);
  syncCsv();
  checkForExtensionUpdate();
  // Periodically check server health for CSV warnings + update notices
  setInterval(checkForExtensionUpdate, 60000);
  // Selector self-test: first probe after the page settles, then every 10 min
  setTimeout(runSelectorSelfTest, 15000);
  setInterval(runSelectorSelfTest, SELFTEST_INTERVAL_MS);
  // R-1: first reconcile pass ~60s after load, then self-reschedules based on
  // isInClubWindow() (every 60s in-window, every 10 min otherwise).
  setTimeout(function() {
    runReconcile().then(scheduleNextReconcile).catch(scheduleNextReconcile);
  }, RECONCILE_FIRST_DELAY_MS);
  // Keep the Tonight list fresh while the panel is expanded (other stations
  // print too — their check-ins should show up here for reprints).
  setInterval(function() {
    var panel = document.getElementById('awana-panel');
    if (panel && panel.style.display !== 'none') loadTonight();
  }, 60000);
  updateQueueBadge();

  // Flush any queued prints on startup
  setTimeout(flushQueue, 3000);
  // Periodically try to flush queue
  setInterval(function() {
    if (getQueue().length > 0) flushQueue();
  }, 30000);

  console.log('[Awana] Extension loaded (v' + EXTENSION_VERSION + ')');
})();
