// feeds.js — TwoTimTwo → print-server data bridge.
//
// A second, fully independent content script (registered in manifest.json
// alongside content.js). It periodically pulls a handful of TwoTimTwo's own
// reports (check-in report, meeting report CSV, color-group points,
// calendar iCal feed, admin messages, household CSV, handbook PDFs) and
// POSTs compact, PII-free JSON to the local print server, which is the only
// publisher on the shared Pusher channel feeding lobby signage / projector.
//
// Hard rules:
//   - Own IIFE, own window.__awanaFeeds* flag — never reads/writes any
//     window/localStorage/sessionStorage state that content.js owns.
//   - ES5 style (var/function) to match content.js.
//   - Must never throw into the page. Every fetch/parse step is guarded;
//     network/parse failures are logged and swallowed, never surfaced.
//   - Privacy invariant: only aggregate numbers, team/club names, dates, and
//     church-authored announcement text ever leave this script. Never child
//     last names, allergy/contact info, birth years, or calendar
//     attendee/organizer/location data.
(function() {
  if (window.__awanaFeedsLoaded) return;
  window.__awanaFeedsLoaded = true;

  var LOG_PREFIX = '[Awana feeds]';
  var PRINT_SERVER = 'http://localhost:3456';
  var FEED_TIMEOUT_MS = 8000;
  var GET_TIMEOUT_MS = 15000;
  var PDF_TIMEOUT_MS = 20000;

  // Awana club_id → display name (see docs/TWOTIMTWO.md §2.1 / §4). Used only
  // to label club-scoped feeds/slips — never to identify a specific child.
  var CLUB_ID_NAMES = {
    '1': 'Cubbies',
    '2': 'Sparks',
    '3': 'T&T',
    '4': 'Puggles',
    '6': 'Trek',
    '7': 'Journey'
  };

  // ── Church config (mirrors content.js's own loader; kept as an
  // independent copy per the isolation rule — feeds.js must not read
  // content.js's internal CHURCH_CFG closure variable). ──────────────────────
  var CHURCH_CFG = {
    clubNights: [{ dow: 3, start: '17:30', end: '20:00' }],
    sharesClubIds: [2, 3, 4, 5, 6]
  };
  var churchConfigLoaded = false;

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

  // True for the first `thresholdMinutes` of a configured club window today —
  // used to fire the once-per-night worksheet print shortly after doors open,
  // rather than at an arbitrary point mid-meeting.
  function isNearClubWindowStart(thresholdMinutes) {
    var now = new Date();
    var mins = now.getHours() * 60 + now.getMinutes();
    return CHURCH_CFG.clubNights.some(function(w) {
      if (!w || Number(w.dow) !== now.getDay()) return false;
      var st = parseHM(w.start);
      if (st === null) return false;
      return mins >= st && mins < st + thresholdMinutes;
    });
  }

  function loadChurchConfig() {
    fetchText('/config/church').then(function(text) {
      if (!text) return;
      var cfg;
      try { cfg = JSON.parse(text); } catch (e) { return; }
      if (!cfg) return;
      if (Array.isArray(cfg.clubNights) && cfg.clubNights.length) CHURCH_CFG.clubNights = cfg.clubNights;
      if (Array.isArray(cfg.sharesClubIds) && cfg.sharesClubIds.length) CHURCH_CFG.sharesClubIds = cfg.sharesClubIds;
      churchConfigLoaded = true;
      console.log(LOG_PREFIX, 'church config loaded');
    });
  }

  // ── Small shared helpers ────────────────────────────────────────────────────
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function formatDateYMD(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Same-origin GET with credentials, tolerant of any failure. Resolves to
  // the response text, or null on network error / timeout / non-2xx.
  function fetchText(path) {
    var url = /^https?:\/\//i.test(path) ? path : (location.origin + path);
    return fetch(url, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(GET_TIMEOUT_MS)
    }).then(function(r) {
      return r.ok ? r.text() : null;
    }).catch(function() {
      return null;
    });
  }

  // Bail quietly on a dead session or an unexpected (HTML login page) shape.
  function isLoginPage(text) {
    if (typeof text !== 'string' || !text) return true;
    if (text.indexOf('Login Required') !== -1) return true;
    if (/<html/i.test(text) && /login/i.test(text) && /password/i.test(text)) return true;
    return false;
  }

  function looksLikeCsv(text) {
    if (!text) return false;
    var t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    var firstLine = (t.split(/\r?\n/)[0] || '').replace(/^\s+/, '');
    if (firstLine.charAt(0) === '<') return false;
    return firstLine.indexOf(',') !== -1;
  }

  // One shared POST helper for every print-server write in this file —
  // /feed/*, /update-households, /print-award, /print-pdf. Silent on any
  // failure (connection refused, timeout, or a 404 from an older server
  // build that doesn't have these routes yet).
  function postFeed(path, body) {
    return fetch(PRINT_SERVER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    }).then(function(r) {
      if (r.ok) {
        console.log(LOG_PREFIX, 'posted', path);
      } else {
        console.log(LOG_PREFIX, 'post not ok (older server build?)', path, r.status);
      }
      return r;
    }).catch(function() {
      console.log(LOG_PREFIX, 'post failed (server offline?)', path);
    });
  }

  // Minimal stateful CSV parser — handles quoted fields containing commas
  // and embedded newlines (per docs/TWOTIMTWO.md §3.2). Returns an array of
  // rows, each an array of field strings.
  function parseCsvText(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\r') {
        // skip
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // TwoTimTwo CSV exports end with footer/blank lines (e.g. "Clubber
  // Count=<n>", a blank line, "FILTER,VALUE" — docs/TWOTIMTWO.md §3). Skip
  // anything that looks like footer noise rather than a data row.
  function isFooterOrBlankRow(row) {
    if (!row || !row.length) return true;
    var joined = row.join('').trim();
    if (!joined) return true;
    if (/count\s*=/i.test(row[0] || '')) return true;
    if (/^filter$/i.test((row[0] || '').trim())) return true;
    return false;
  }

  function getCalendarIdFromPage() {
    try {
      var form = document.getElementById('checkinForm');
      var el = (form && form.querySelector('#calendar_id, input[name="calendar_id"]')) ||
        document.getElementById('calendar_id');
      if (el && el.value) return String(el.value).trim();
    } catch (e) { /* never throw into the page */ }
    return null;
  }

  function detectClubScope() {
    try {
      var params = new URL(location.href).searchParams;
      var clubId = params.get('club_id');
      if (clubId && CLUB_ID_NAMES[clubId]) return CLUB_ID_NAMES[clubId];
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── Tonight's counters + award slips (both sourced from the same two
  // TwoTimTwo reports, so fetched together in one pass) ──────────────────────

  function parseCheckinReport(html) {
    if (!html || isLoginPage(html)) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    var tables = doc.querySelectorAll('table');
    var countedViaTotals = false;
    var totalCount = 0;
    var friendCount = 0;
    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];
      var totalsRow = table.querySelector('tfoot tr.totals');
      if (!totalsRow) continue;
      var rowText = totalsRow.textContent || '';
      var m = /Count:\s*(\d+)/i.exec(rowText);
      if (m) {
        totalCount += parseInt(m[1], 10);
        countedViaTotals = true;
      }
      var headerRow = table.querySelector('thead tr') || table.querySelector('tr');
      var headerCells = headerRow ? headerRow.querySelectorAll('th') : [];
      var friendIdx = -1;
      for (var h = 0; h < headerCells.length; h++) {
        var htext = (headerCells[h].textContent || '').trim();
        if (/friend|brought/i.test(htext)) { friendIdx = h; break; }
      }
      if (friendIdx >= 0) {
        var bodyRows = table.querySelectorAll('tbody tr');
        for (var r = 0; r < bodyRows.length; r++) {
          var cells = bodyRows[r].querySelectorAll('td');
          if (cells.length > friendIdx) {
            var ctext = (cells[friendIdx].textContent || '').trim();
            if (/^yes$/i.test(ctext)) friendCount++;
          }
        }
      }
    }
    if (!countedViaTotals) {
      // Fallback: count rows carrying an undo control with a numeric clubber id.
      var ids = {};
      var undoEls = doc.querySelectorAll(
        '[onclick*="undoCheckin"], [onclick*="checkinclubberundo"], a[href*="checkinclubberundo"]'
      );
      for (var u = 0; u < undoEls.length; u++) {
        var attr = undoEls[u].getAttribute('onclick') || undoEls[u].getAttribute('href') || '';
        var idm = /(\d+)/.exec(attr);
        if (idm) ids[idm[1]] = true;
      }
      totalCount = Object.keys(ids).length;
    }
    return { checkedIn: totalCount, friendsBrought: friendCount };
  }

  var AWARD_RE = /award/i;
  var BOOK_RE = /book|section/i;

  // Returns { booksCompleted, awardsEarned, slips: [{name, clubName, award}] }
  // or null if the CSV shape can't be confidently understood — per the
  // "fall back to 0 rather than guessing wrong" mandate, an empty/absent
  // match set simply yields zero counts rather than a special case.
  function parseMeetingReportCsv(text) {
    if (!text || isLoginPage(text) || !looksLikeCsv(text)) return null;
    var rows = parseCsvText(text);
    if (rows.length < 2 || !rows[0] || rows[0].length < 2) return null;
    var header = rows[0];
    var awardCols = [], bookCols = [];
    var firstIdx = -1, lastIdx = -1, nameIdx = -1, clubIdx = -1;
    for (var i = 0; i < header.length; i++) {
      var h = (header[i] || '').trim();
      var hl = h.toLowerCase();
      if (AWARD_RE.test(h)) { awardCols.push({ idx: i, label: h }); continue; }
      if (BOOK_RE.test(h)) { bookCols.push({ idx: i, label: h }); continue; }
      if (/^first/.test(hl)) firstIdx = i;
      else if (/^last/.test(hl)) lastIdx = i;
      else if (hl === 'name' || /clubber\s*name/.test(hl)) nameIdx = i;
      else if (/^club$/.test(hl)) clubIdx = i;
    }
    var booksCompleted = 0, awardsEarned = 0;
    var slips = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (isFooterOrBlankRow(row)) continue;
      var name = '';
      if (firstIdx >= 0 && lastIdx >= 0) {
        name = ((row[firstIdx] || '').trim() + ' ' + (row[lastIdx] || '').trim()).trim();
      } else if (nameIdx >= 0) {
        name = (row[nameIdx] || '').trim();
      }
      var clubName = clubIdx >= 0 ? (row[clubIdx] || '').trim() : '';
      awardCols.forEach(function(col) {
        var v = (row[col.idx] || '').trim();
        if (!v) return;
        awardsEarned++;
        if (name) slips.push({ name: name, clubName: clubName, award: col.label });
      });
      bookCols.forEach(function(col) {
        var v = (row[col.idx] || '').trim();
        if (!v) return;
        booksCompleted++;
        if (name) slips.push({ name: name, clubName: clubName, award: col.label });
      });
    }
    return { booksCompleted: booksCompleted, awardsEarned: awardsEarned, slips: slips };
  }

  // Dedup lives in localStorage keyed by DATE, not sessionStorage. The meeting
  // report is a persistent record, not a queue: it keeps listing an award all
  // night. sessionStorage is wiped when the tab is closed or the browser
  // restarts, so a fresh tab would find every already-slipped award "new" and
  // print a second slip for each. Keyed by date it survives a restart and still
  // starts clean next club night. (Same pattern the worksheet marker uses.)
  var AWARD_SLIP_PREFIX = 'awana_feedsSlippedAwards_';
  var AWARD_SLIP_CAP = 10;

  function awardSlipKeyForToday() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return AWARD_SLIP_PREFIX + d.getFullYear() + '-' +
      (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function loadSlipped() {
    try { return new Set(JSON.parse(localStorage.getItem(awardSlipKeyForToday()) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveSlipped(set) {
    try {
      localStorage.setItem(awardSlipKeyForToday(), JSON.stringify(Array.from(set)));
      // Drop markers from previous dates so this can't grow without bound.
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && k.indexOf(AWARD_SLIP_PREFIX) === 0 && k !== awardSlipKeyForToday()) {
          localStorage.removeItem(k);
        }
      }
    } catch (e) { /* ignore quota errors */ }
  }

  // Only run during the club-night window (per spec); caps at 10 slips/pass
  // and dedupes "name|award" pairs for the whole DATE so neither a page
  // refresh nor a browser restart reprints the same slip.
  function processAwardSlips(slips) {
    if (!Array.isArray(slips) || !slips.length) return;
    var slipped = loadSlipped();
    var posted = 0;
    var changed = false;
    for (var i = 0; i < slips.length && posted < AWARD_SLIP_CAP; i++) {
      var s = slips[i];
      if (!s || !s.name || !s.award) continue;
      var key = (s.name + '|' + s.award).toLowerCase();
      if (slipped.has(key)) continue;
      slipped.add(key);
      changed = true;
      posted++;
      postFeed('/print-award', { name: s.name, clubName: s.clubName || '', award: s.award });
    }
    if (changed) saveSlipped(slipped);
  }

  function runTonight() {
    var today = formatDateYMD(new Date());
    fetchText('/clubber/checkin_report?date=' + today).then(function(html) {
      var parsed = parseCheckinReport(html);
      if (!parsed) return;
      var calId = getCalendarIdFromPage();
      var reportUrl = '/meeting/report?output=csv' + (calId ? '&calendar_id=' + encodeURIComponent(calId) : '');
      fetchText(reportUrl).then(function(csv) {
        var mr = parseMeetingReportCsv(csv);
        var body = {
          checkedIn: parsed.checkedIn,
          booksCompleted: mr ? mr.booksCompleted : 0,
          awardsEarned: mr ? mr.awardsEarned : 0,
          friendsBrought: parsed.friendsBrought
        };
        postFeed('/feed/tonight', body);
        if (mr && isInClubWindow()) processAwardSlips(mr.slips);
      });
    });
  }

  // ── Color-group points ──────────────────────────────────────────────────────

  function parseColorGroupHtml(html) {
    if (!html || isLoginPage(html)) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    var table = doc.querySelector('table');
    if (!table) return null;
    var headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    var headerCells = headerRow ? headerRow.querySelectorAll('th, td') : [];
    var colorIdx = -1, pointsIdx = -1;
    for (var i = 0; i < headerCells.length; i++) {
      var h = (headerCells[i].textContent || '').trim().toLowerCase();
      if (colorIdx === -1 && /color/.test(h)) colorIdx = i;
      if (/total\s*points/.test(h)) pointsIdx = i;
    }
    if (colorIdx === -1 || pointsIdx === -1) return null;
    var groups = {};
    var bodyRows = table.querySelectorAll('tbody tr');
    if (!bodyRows.length) bodyRows = table.querySelectorAll('tr');
    for (var r = 0; r < bodyRows.length; r++) {
      var cells = bodyRows[r].querySelectorAll('td');
      if (!cells.length || cells.length <= Math.max(colorIdx, pointsIdx)) continue;
      var colorName = (cells[colorIdx].textContent || '').trim();
      var pointsText = (cells[pointsIdx].textContent || '').trim();
      var pts = parseInt(pointsText.replace(/[^\d-]/g, ''), 10);
      if (!colorName || isNaN(pts)) continue;
      groups[colorName] = pts;
    }
    if (!Object.keys(groups).length) return null;
    return groups;
  }

  function runPoints() {
    fetchText('/meeting/colorGroup').then(function(html) {
      var groups = parseColorGroupHtml(html);
      if (!groups) return;
      var body = { groups: groups };
      var club = detectClubScope();
      if (club) body.club = club;
      postFeed('/feed/points', body);
    });
  }

  // ── Next meeting from the calendar iCal feed ────────────────────────────────

  function unfoldICal(text) {
    var lines = text.split(/\r\n|\n|\r/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if ((line.charAt(0) === ' ' || line.charAt(0) === '\t') && out.length) {
        out[out.length - 1] += line.slice(1);
      } else {
        out.push(line);
      }
    }
    return out;
  }

  // Handles both VALUE=DATE (YYYYMMDD) and full UTC (YYYYMMDDTHHMMSSZ) forms.
  function parseICalDate(v) {
    var m = /^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(String(v || '').trim());
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
    if (m[4]) {
      return new Date(Date.UTC(y, mo, d, parseInt(m[5], 10), parseInt(m[6], 10), parseInt(m[7], 10)));
    }
    return new Date(y, mo, d);
  }

  // Only DTSTART and SUMMARY are read. ATTENDEE, ORGANIZER, LOCATION lines
  // are never inspected, let alone forwarded — privacy invariant.
  function parseICalFeed(text) {
    if (!text) return null;
    var lines = unfoldICal(text);
    var events = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^BEGIN:VEVENT/i.test(line)) { cur = {}; continue; }
      if (/^END:VEVENT/i.test(line)) { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      var idx = line.indexOf(':');
      if (idx === -1) continue;
      var key = line.slice(0, idx).split(';')[0].toUpperCase();
      var value = line.slice(idx + 1);
      if (key === 'DTSTART') cur.dtstart = value.trim();
      else if (key === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
    }
    return events;
  }

  function runSchedule() {
    fetchText('/calendar/iCal').then(function(text) {
      if (!text || isLoginPage(text)) return;
      var events = parseICalFeed(text);
      if (!events || !events.length) return;
      var todayYMD = formatDateYMD(new Date());
      var best = null, bestYMD = null;
      events.forEach(function(ev) {
        if (!ev.dtstart) return;
        var d = parseICalDate(ev.dtstart);
        if (!d) return;
        var ymd = formatDateYMD(d);
        if (ymd < todayYMD) return; // past meeting
        if (!best || ymd < bestYMD) { best = ev; bestYMD = ymd; }
      });
      if (!best) return;
      var body = { nextMeetingDate: bestYMD };
      if (best.summary) body.title = best.summary;
      if (bestYMD === todayYMD && best.summary && /no awana|no club|cancel/i.test(best.summary)) {
        body.noClubThisWeek = true;
      }
      postFeed('/feed/schedule', body);
    });
  }

  // ── Church announcement / cancellation ──────────────────────────────────────

  var NOTICE_MAX_LEN = 300;

  function parseAdminMessages(html) {
    if (!html || isLoginPage(html)) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
    var text = null;
    // Prefer an explicit "active" marker — but NEVER a bare '.active'. This is a
    // Bootstrap app, where '.active' marks the current nav tab / pagination
    // link: the check-in pages carry <li class="active"> in their own tab strip.
    // A bare match therefore grabbed a NAVIGATION LABEL and would have published
    // it to the lobby TV as a church announcement. Restrict to table rows and an
    // explicit data attribute, and reject anything sitting in a nav container.
    var candidates = doc.querySelectorAll('tr.active, tbody .active, [data-active="1"]');
    for (var c = 0; c < candidates.length && !text; c++) {
      var el = candidates[c];
      if (el.closest && el.closest('nav, .navbar, .nav, .nav-tabs, .htabs, .pagination, ul.nav')) continue;
      var t = (el.textContent || '').trim();
      if (t) text = t;
    }
    if (!text) {
      // Undocumented markup — only guess when unambiguous (exactly one data
      // row), per the project's "be conservative" rule. Otherwise do nothing.
      var table = doc.querySelector('table');
      if (table) {
        var rows = table.querySelectorAll('tbody tr');
        if (!rows.length) rows = table.querySelectorAll('tr');
        var dataRows = [];
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].querySelectorAll('td').length) dataRows.push(rows[i]);
        }
        if (dataRows.length === 1) text = (dataRows[0].textContent || '').trim();
      }
    }
    if (!text) return null;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (text.length > NOTICE_MAX_LEN) text = text.slice(0, NOTICE_MAX_LEN - 1) + '…';
    var level = 'info';
    if (/cancel|closed|no club/i.test(text)) level = 'critical';
    else if (/delay|late|change/i.test(text)) level = 'warn';
    return { level: level, message: text };
  }

  function runNotice() {
    fetchText('/msg/admin').then(function(html) {
      var parsed = parseAdminMessages(html);
      if (!parsed) return; // no active message → post nothing
      postFeed('/feed/notice', parsed);
    });
  }

  // ── Authoritative household map ─────────────────────────────────────────────

  function runHouseholds() {
    fetchText('/household/csv').then(function(text) {
      if (!text || isLoginPage(text) || !looksLikeCsv(text)) return;
      postFeed('/update-households', { csv: text });
    });
  }

  // ── Leader worksheets (opt-in, once per club night) ─────────────────────────

  var WORKSHEETS_FLAG_KEY = 'awana_autoWorksheets';
  var WORKSHEETS_MARKER_PREFIX = 'awana_feedsWorksheetsPrinted_';
  var WORKSHEETS_WINDOW_GRACE_MIN = 30; // "shortly after the window opens"

  function worksheetsEnabled() {
    try { return localStorage.getItem(WORKSHEETS_FLAG_KEY) === 'true'; }
    catch (e) { return false; }
  }
  function alreadyPrintedWorksheetsToday(dateStr) {
    try { return localStorage.getItem(WORKSHEETS_MARKER_PREFIX + dateStr) === '1'; }
    catch (e) { return false; }
  }
  function markWorksheetsPrinted(dateStr) {
    try { localStorage.setItem(WORKSHEETS_MARKER_PREFIX + dateStr, '1'); }
    catch (e) { /* ignore quota errors */ }
  }

  function fetchPdfBase64(url) {
    return fetch((/^https?:\/\//i.test(url) ? url : location.origin + url), {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(PDF_TIMEOUT_MS)
    }).then(function(r) {
      if (!r.ok) return null;
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('pdf') === -1) return null; // unexpected shape — bail
      return r.blob();
    }).then(function(blob) {
      if (!blob) return null;
      return new Promise(function(resolve) {
        var reader = new FileReader();
        reader.onloadend = function() {
          var result = reader.result || '';
          var idx = String(result).indexOf(',');
          resolve(idx >= 0 ? String(result).slice(idx + 1) : null);
        };
        reader.onerror = function() { resolve(null); };
        reader.readAsDataURL(blob);
      });
    }).catch(function() { return null; });
  }

  // NOTE (follow-up): there's no dedicated "which clubs run at this church"
  // config key yet, so this reuses CHURCH_CFG.sharesClubIds (the existing
  // per-church club-id list) as the set to fetch worksheets for. A purpose-
  // built `clubIds` key on /config/church would be cleaner — flagging for
  // whoever owns print-server/server.js.
  function runWorksheets() {
    if (!worksheetsEnabled()) return;
    if (!isInClubWindow()) return;
    if (!isNearClubWindowStart(WORKSHEETS_WINDOW_GRACE_MIN)) return;
    var todayStr = formatDateYMD(new Date());
    if (alreadyPrintedWorksheetsToday(todayStr)) return;
    // Mark before the async fetches so an overlapping tick can't double-fire.
    markWorksheetsPrinted(todayStr);
    var calId = getCalendarIdFromPage();
    CHURCH_CFG.sharesClubIds.forEach(function(clubId) {
      var url = '/meeting/handbook?club_id=' + encodeURIComponent(clubId) +
        (calId ? '&cal_id=' + encodeURIComponent(calId) : '');
      fetchPdfBase64(url).then(function(b64) {
        if (!b64) return;
        var clubName = CLUB_ID_NAMES[String(clubId)] || String(clubId);
        postFeed('/print-pdf', { pdfBase64: b64, label: clubName + ' handbook agenda' });
      });
    });
  }

  // ── Who is still here (contract v4) ─────────────────────────────────────────
  // /clubber/checkout is not a checkout FORM, it is the live list of children
  // currently checked in — each row has a button to check that child out, and
  // the row disappears once they are. So "who is still here" is simply the set
  // of rows, and needs no departure event to miss.
  //
  // THIS IS THE ONE FEED THAT CARRIES NAMES. Everything else in this file is
  // aggregate counters and church copy. First name + club only, and the print
  // server's buildCheckout() enforces that structurally — a guardian name or a
  // security code cannot get through even if this parser started reading them.
  // The payload is then sealed with AES-256-GCM before it reaches the channel.
  //
  // Structure is documented in docs/TWOTIMTWO.md §2.1. The guards below are not
  // defensive padding; each one prevents a specific way this feed could tell the
  // lobby that the building is clear while children are still in it.

  function parseCheckoutHtml(html) {
    if (!html || isLoginPage(html)) return null;
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }

    // GUARD 1 — positively identify the page. A redirect, an error page or a
    // session timeout must read as "unknown", never as an empty room.
    var title = (doc.title || '');
    if (!/checkout\s*clubber/i.test(title)) return null;

    // GUARD 2 — the data table is the SECOND table. The first
    // (table.items.table) is an unrelated notices table; querySelector('table')
    // would silently parse that one and find zero children.
    var tables = doc.querySelectorAll('table');
    var table = null;
    for (var t = 0; t < tables.length; t++) {
      if (tables[t].classList && tables[t].classList.contains('items')) continue;
      table = tables[t];
      break;
    }
    if (!table) return null;

    // GUARD 3 — refuse a FILTERED view. The club filter checkboxes are all
    // checked by default, but if a volunteer has unticked one, the page shows a
    // subset and every child in the hidden clubs would look picked up. That is
    // the failure mode with the worst consequence and the least visible cause,
    // so a partial view is treated as no reading at all.
    var filters = doc.querySelectorAll('input.filter[name^="clubs"]');
    for (var f = 0; f < filters.length; f++) {
      if (!filters[f].checked) {
        console.log(LOG_PREFIX, 'checkout page is club-filtered — refusing to publish a partial board');
        return null;
      }
    }

    var rows = table.querySelectorAll('tr');
    var entries = [];
    var sawEmptyPlaceholder = false;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row.querySelector('th') && !row.querySelector('td')) continue;   // header
      if (row.querySelector('td.empty, .empty')) { sawEmptyPlaceholder = true; continue; }

      var nameCell = row.querySelector('td.clubber.name') || row.querySelector('td.clubber');
      if (!nameCell) continue;
      var firstName = (nameCell.textContent || '').trim().split(/\s+/)[0] || '';
      if (!firstName) continue;

      // Club comes from the icon's alt text, the same way the check-in page
      // reads it. Trailing space in the alt is normal ("Sparks ").
      var icon = row.querySelector('img.club-icon-20[alt]');
      var club = icon ? (icon.getAttribute('alt') || '').trim() : '';

      // FIRST NAME ONLY. The row also holds the child's full name, guardian
      // names, authorized-pickup names and a security code; none of that is
      // read, and none of it would survive the server's builder if it were.
      entries.push({ firstName: firstName, club: club });
    }

    // GUARD 4 — zero rows is only "everyone has gone home" when the page said so
    // itself. A parse that found the table but matched no rows, with no empty
    // placeholder, means the row selectors have drifted — and publishing that as
    // an empty board would tell a volunteer the building is clear when it is not.
    if (!entries.length && !sawEmptyPlaceholder) {
      console.log(LOG_PREFIX, 'checkout page parsed no rows and showed no empty placeholder — treating as unknown');
      return null;
    }
    return entries;
  }

  function runCheckout() {
    fetchText('/clubber/checkout').then(function(html) {
      var entries = parseCheckoutHtml(html);
      // null means "could not read it". Post nothing: a silent gap ages the
      // board on screen, which is honest, whereas an empty array would claim
      // the room is clear.
      if (!entries) return;
      // `printed` is filled in by the print server from its own history — this
      // script has no idea how many labels were printed.
      postFeed('/feed/checkout', { entries: entries });
    });
  }

  // ── Scheduler: one self-rescheduling loop (never setInterval), each task
  // keeping its own last-run time and cadence so a slow fetch can't stack. ──

  var TICK_MS = 15000;
  var HOUSEHOLDS_INITIAL_DELAY_MS = 20 * 1000;
  var startedAt = Date.now();

  var lastRun = {
    tonight: 0,
    points: 0,
    schedule: 0,
    notice: 0,
    checkout: 0,
    households: 0,
    worksheets: 0
  };

  var TASK_FNS = {
    tonight: runTonight,
    points: runPoints,
    schedule: runSchedule,
    notice: runNotice,
    checkout: runCheckout,
    households: runHouseholds,
    worksheets: runWorksheets
  };

  function intervalFor(task) {
    switch (task) {
      case 'tonight':
      case 'points':
        return isInClubWindow() ? 90 * 1000 : 15 * 60 * 1000;
      case 'checkout':
        // Only worth scraping while club is actually running; pickup is the
        // whole point. Outside the window it is off, not merely slow — there is
        // no reason for a list of children to be on the wire at 2pm Tuesday.
        return isInClubWindow() ? 60 * 1000 : Infinity;
      case 'schedule':
        return 60 * 60 * 1000;
      case 'notice':
        return isInClubWindow() ? 5 * 60 * 1000 : 30 * 60 * 1000;
      case 'households':
        return 30 * 60 * 1000;
      case 'worksheets':
        return 5 * 60 * 1000; // internal guards decide whether it actually fires
      default:
        return 15 * 60 * 1000;
    }
  }

  function isDue(task, now) {
    if (task === 'households' && lastRun.households === 0) {
      return now - startedAt >= HOUSEHOLDS_INITIAL_DELAY_MS;
    }
    return now - lastRun[task] >= intervalFor(task);
  }

  function runOne(task) {
    var fn = TASK_FNS[task];
    if (!fn) return;
    lastRun[task] = Date.now();
    try {
      fn();
    } catch (e) {
      console.warn(LOG_PREFIX, 'task threw (swallowed):', task, e && e.message);
    }
  }

  function runAll() {
    Object.keys(TASK_FNS).forEach(runOne);
  }

  function tick() {
    try {
      if (!churchConfigLoaded) loadChurchConfig();
      var now = Date.now();
      Object.keys(TASK_FNS).forEach(function(task) {
        if (isDue(task, now)) runOne(task);
      });
    } catch (e) {
      console.warn(LOG_PREFIX, 'tick error (swallowed):', e && e.message);
    } finally {
      setTimeout(tick, TICK_MS);
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  try {
    loadChurchConfig();
    setTimeout(tick, TICK_MS);
    window.__awanaFeeds = { runAll: runAll, runOne: runOne };
    console.log(LOG_PREFIX, 'loaded');
  } catch (e) {
    console.warn(LOG_PREFIX, 'init error (swallowed):', e && e.message);
  }
})();
