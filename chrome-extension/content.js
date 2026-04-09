(function() {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  const EXTENSION_VERSION = '2.2.0';
  const PRINT_COOLDOWN = 2000;
  const BATCH_DELAY = 400;
  const DEBOUNCE_MS = 100;
  const STATUS_TIMEOUT = 3000;
  const PRINT_SERVER = 'http://localhost:3456';
  const STORAGE_KEY = 'awana_selectedPrinterId';
  const MINIMIZE_KEY = 'awana_widgetMinimized';
  const PRINTER_KEY  = 'awana_selectedPrinterName';

  const QUEUE_KEY   = 'awana_printQueue';
  const MUTE_KEY    = 'awana_soundMuted';

  let selectedMode        = localStorage.getItem(STORAGE_KEY) || 'auto';
  let selectedPrinterName = localStorage.getItem(PRINTER_KEY) || '';
  let soundMuted          = localStorage.getItem(MUTE_KEY) === 'true';
  let lastPrintedName = null;
  let lastPrintTime = 0;
  var batchPrintedNames = new Set();

  // ── Remote check-in detection state ────────────────────────────────────────
  // The .clubber list on TwoTimTwo.com shrinks when a kid is checked in on
  // ANY device.  By diffing the visible set between scans we can detect
  // check-ins that happened on a phone/other laptop and print their label
  // here.  A session-scoped "printed" set dedupes against the existing
  // #lastCheckin detection path so locally-checked-in kids aren't reprinted.
  var ROSTER_CACHE    = {};          // { nameLower: { displayName, clubName, clubImageData } }
  var knownClubbers   = new Set();   // last-seen lowercased names
  var printedNames    = new Set();   // session dedup
  var baselineScanned = false;
  var REMOTE_PRINTED_KEY  = 'awana_printedNames';
  var REMOTE_PRINTED_TS   = 'awana_printedTs';
  var REMOTE_BASELINE_KEY = 'awana_baselineDone';
  var REMOTE_KNOWN_KEY    = 'awana_knownClubbers';
  var REMOTE_ROSTER_KEY   = 'awana_rosterCache';
  var REMOTE_STALE_MS     = 4 * 60 * 60 * 1000; // 4h idle resets dedup (new event night)
  var SCAN_INTERVAL_MS    = 5000;
  var AUTO_REFRESH_INTERVAL_MS = 30000;

  function loadPrintedState() {
    try {
      var ts = parseInt(sessionStorage.getItem(REMOTE_PRINTED_TS) || '0', 10);
      if (ts && Date.now() - ts < REMOTE_STALE_MS) {
        var arr = JSON.parse(sessionStorage.getItem(REMOTE_PRINTED_KEY) || '[]');
        if (Array.isArray(arr)) printedNames = new Set(arr);
        baselineScanned = sessionStorage.getItem(REMOTE_BASELINE_KEY) === '1';
        // Restore knownClubbers + ROSTER_CACHE so diff survives a reload.
        var knownArr = JSON.parse(sessionStorage.getItem(REMOTE_KNOWN_KEY) || '[]');
        if (Array.isArray(knownArr)) knownClubbers = new Set(knownArr);
        var rosterObj = JSON.parse(sessionStorage.getItem(REMOTE_ROSTER_KEY) || '{}');
        if (rosterObj && typeof rosterObj === 'object') ROSTER_CACHE = rosterObj;
      } else {
        sessionStorage.removeItem(REMOTE_PRINTED_KEY);
        sessionStorage.removeItem(REMOTE_PRINTED_TS);
        sessionStorage.removeItem(REMOTE_BASELINE_KEY);
        sessionStorage.removeItem(REMOTE_KNOWN_KEY);
        sessionStorage.removeItem(REMOTE_ROSTER_KEY);
      }
    } catch (e) { /* ignore sessionStorage errors */ }
  }

  var rosterDirty = false;
  function saveScanState() {
    try {
      sessionStorage.setItem(REMOTE_KNOWN_KEY, JSON.stringify(Array.from(knownClubbers)));
      if (rosterDirty) {
        sessionStorage.setItem(REMOTE_ROSTER_KEY, JSON.stringify(ROSTER_CACHE));
        rosterDirty = false;
      }
    } catch (e) { /* ignore quota errors */ }
  }

  function markPrinted(name) {
    if (!name) return;
    var key = name.toLowerCase().trim();
    if (!key) return;
    printedNames.add(key);
    try {
      sessionStorage.setItem(REMOTE_PRINTED_KEY, JSON.stringify(Array.from(printedNames)));
      sessionStorage.setItem(REMOTE_PRINTED_TS, String(Date.now()));
    } catch (e) { /* ignore quota errors */ }
  }

  function isUndo(text) {
    return text && text.toLowerCase().includes('undo');
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
    fetch(PRINT_SERVER + '/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
      signal: AbortSignal.timeout(5000)
    }).then(function(r) {
      if (r.ok) {
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
    try {
      var resp = await fetch(PRINT_SERVER + '/siblings?name=' + encodeURIComponent(fullName),
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
    header.textContent = 'Check in siblings?';

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

  function pollForCheckinButton(sib, remaining, options, attempts) {
    if (attempts <= 0) {
      console.log('[Awana] Timed out waiting for check-in button for ' + sib.name);
      // Bug 4 fix: wrap in function so it's deferred, not called immediately
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

      if (remaining.length > 0) {
        setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY);
      }
    } else {
      setTimeout(function() { pollForCheckinButton(sib, remaining, options, attempts - 1); }, 100);
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
    // Guard against onCheckin double-printing via two layers:
    //   1. batchPrintedNames Set (8 s window) — primary guard
    //   2. lastPrintTime reset — secondary cooldown guard
    var club = lookupClub(sib.name);
    var sibKey = sib.name.toLowerCase().trim();
    batchPrintedNames.add(sibKey);
    setTimeout(function() { batchPrintedNames.delete(sibKey); }, 8000);
    lastPrintTime = Date.now(); // also arm the cooldown guard
    markPrinted(sib.name); // record in session dedup so remote scan won't reprint
    doPrint(sib.name, club.clubName || sib.clubName, club.clubImageData);

    // Click the sibling's clubber element to open the check-in modal
    sib.element.click();

    // Poll for the modal's check-in button (up to 3s)
    pollForCheckinButton(sib, remaining, options, 30);
  }

  function getClubImageDataUrl(img) {
    try {
      if (!img || !img.src || !img.complete || img.naturalWidth === 0) {
        return null;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const _ctx = canvas.getContext('2d');
      const _aspect = img.naturalWidth / img.naturalHeight;
      let _dw, _dh, _ox = 0, _oy = 0;
      if (_aspect > 1) { _dw = 64; _dh = 64 / _aspect; _oy = (64 - _dh) / 2; }
      else             { _dh = 64; _dw = 64 * _aspect;  _ox = (64 - _dw) / 2; }
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

    // ── Expanded state: full panel ──
    const panel = document.createElement('div');
    panel.id = 'awana-panel';
    Object.assign(panel.style, {
      background: '#ffffff',
      border: '1px solid #c8e6c9',
      borderRadius: '8px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
      overflow: 'hidden',
      minWidth: '240px'
    });

    // Panel header (purple bar with title + close X)
    const panelHeader = document.createElement('div');
    Object.assign(panelHeader.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      background: '#4caf50',
      color: '#ffffff'
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
    Object.assign(panelBody.style, { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' });

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

    controls.append(modeSelect, statusEl, testBtn);

    // Printer row
    var printerRow = document.createElement('div');
    Object.assign(printerRow.style, { display: 'flex', flexDirection: 'column', gap: '2px' });

    var printerLabel = document.createElement('div');
    Object.assign(printerLabel.style, {
      fontSize: '10px', color: '#94a3b8', fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: '0.05em'
    });
    printerLabel.textContent = 'Printer';

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
    var walkInDivider = document.createElement('div');
    Object.assign(walkInDivider.style, { height: '1px', background: '#e2e8f0', margin: '2px 0' });

    var walkInLabel = document.createElement('div');
    Object.assign(walkInLabel.style, {
      fontSize: '10px', color: '#94a3b8', fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: '0.05em'
    });
    walkInLabel.textContent = 'Walk-in Guest';

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

    function triggerWalkIn() {
      var name = guestInput.value.trim();
      if (!name) return;
      var club = clubSelect.value;
      var isVisitor = visitorCb.checked;
      // Send with visitor flag if checked
      var payload = { name: name, clubName: club, clubImageData: null, printerName: selectedPrinterName || '' };
      if (isVisitor) payload.visitor = true;
      setStatus('\u23F3');
      fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      }).then(function(r) {
        if (r.ok) { setStatus('\u2705'); playSuccess(); }
        else { setStatus('\u274C'); playError(); }
        clearStatus();
      }).catch(function() {
        queuePrint(payload);
        setStatus('\uD83D\uDCE6');
        clearStatus();
      });
      guestInput.value = '';
    }
    guestInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') triggerWalkIn(); });
    walkInPrintBtn.addEventListener('click', triggerWalkIn);

    walkInRow.append(guestInput, walkInPrintBtn);

    // Queue badge
    var queueBadge = document.createElement('div');
    queueBadge.id = 'awana-queue-badge';
    Object.assign(queueBadge.style, {
      display: 'none', fontSize: '11px', color: '#f59e0b',
      fontWeight: '600', padding: '2px 0'
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

    panelBody.append(controls, printerRow, walkInDivider, walkInLabel, walkInRow, walkInClubRow, queueBadge, csvStatus, updateRow, soundRow);
    panel.append(panelHeader, panelBody);
    widget.append(pill, panel);

    // ── Mount: fixed overlay on the right, below the site nav bars ──
    Object.assign(widget.style, { position: 'fixed', top: '55px', right: '12px', zIndex: '99999' });
    document.body.appendChild(widget);

    // ── Toggle logic ──
    function applyMinimized(min) {
      isMinimized = min;
      pill.style.display = min ? 'flex' : 'none';
      panel.style.display = min ? 'none' : 'block';
      localStorage.setItem(MINIMIZE_KEY, min ? 'true' : 'false');
    }

    pill.addEventListener('click', function() { applyMinimized(false); });
    closeBtn.addEventListener('click', function() { applyMinimized(true); });
    applyMinimized(isMinimized);

    console.log('[Awana] Widget injected');
  }

  // Check if the print server is running a newer version and notify the user
  function checkForExtensionUpdate() {
    fetch(PRINT_SERVER + '/health', { signal: AbortSignal.timeout(3000) })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.version && data.version !== EXTENSION_VERSION) {
          var notice = document.getElementById('awana-update-notice');
          if (notice) {
            notice.style.display = 'block';
            notice.textContent = 'Update available: v' + data.version + ' (reload extension)';
          }
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
        select.value = exists ? saved : '';
        selectedPrinterName = select.value;
        if (!exists && saved) localStorage.removeItem(PRINTER_KEY);
        console.log('[Awana] Loaded ' + printers.length + ' printer(s)');
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
      debounceTimer = setTimeout(function() {
        checkForChange();
        // Also scan the clubber list for remote check-ins on every mutation
        try { scanClubberList(); } catch (e) { console.log('[Awana] scan error:', e); }
      }, DEBOUNCE_MS);
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
  function scanClubberList() {
    var current = new Set();
    var clubberEls = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubberEls.length; i++) {
      var nameEl = clubberEls[i].querySelector('.name');
      if (!nameEl) continue;
      var displayName = nameEl.innerText.trim();
      if (!displayName) continue;
      var key = displayName.toLowerCase();
      current.add(key);

      // Cache club info while the kid is still visible — once they disappear,
      // lookupClub() can't find them.
      if (!ROSTER_CACHE[key]) {
        var imgEl = clubberEls[i].querySelector('.club img');
        ROSTER_CACHE[key] = {
          displayName: displayName,
          clubName: imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '',
          clubImageData: imgEl ? getClubImageDataUrl(imgEl) : null
        };
        rosterDirty = true;
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

    // Diff: previously present, now missing → just got checked in
    knownClubbers.forEach(function(key) {
      if (current.has(key)) return;
      if (printedNames.has(key)) return;
      var meta = ROSTER_CACHE[key];
      if (!meta) return;
      console.log('[Awana] Remote check-in detected:', meta.displayName);
      triggerRemotePrint(meta.displayName, meta.clubName, meta.clubImageData);
    });

    knownClubbers = current;
    saveScanState();
  }

  function triggerRemotePrint(fullName, clubName, clubImageData) {
    if (selectedMode === 'off') return;
    var key = fullName.toLowerCase().trim();
    if (printedNames.has(key)) return;
    if (Date.now() - lastPrintTime < PRINT_COOLDOWN) {
      // Another print is in flight; retry on the next scan
      return;
    }
    lastPrintTime = Date.now();
    markPrinted(fullName);
    doPrint(fullName, clubName || '', clubImageData || null);
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
    if (Date.now() - lastPrintTime < PRINT_COOLDOWN) return;
    var key = name.toLowerCase().trim();
    if (batchPrintedNames.has(key)) return; // already printed in batch
    if (printedNames.has(key)) return; // already printed this session (local or remote)

    lastPrintTime = Date.now();
    markPrinted(name);
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData);

    // Check for siblings after printing the current child
    setTimeout(function() {
      findSiblings(name).then(function(siblings) {
        if (siblings.length > 0) {
          showSiblingPanel(siblings, name);
        }
      });
    }, 500);
  }

  function doPrint(fullName, clubName, imageData) {
    setStatus('\u23F3');

    var parts = fullName.split(' ');
    var firstName = parts[0] || '';
    var lastName = parts.slice(1).join(' ') || '';

    if (isUndo(firstName) || isUndo(lastName) || isUndo(clubName)) {
      setStatus('\uD83D\uDEAB');
      clearStatus();
      return;
    }

    var payload = { name: fullName, clubName: clubName, clubImageData: imageData, printerName: selectedPrinterName || '' };

    var printPromise;
    if (selectedMode !== 'dialog') {
      printPromise = fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      }).then(function(response) {
        if (response.ok) {
          setStatus('\u2705');
          playSuccess();
          clearStatus();
          flushQueue(); // try flushing any queued items
          console.log('[Awana] Silent print sent to server');
          return true;
        }
        return false;
      }).catch(function(err) {
        console.log('[Awana] Server unavailable, queuing:', err.message);
        queuePrint(payload);
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
      // Offline fallback HTML label
      var fontSize = (firstName || '').length > 12 ? '32pt' : (firstName || '').length > 8 ? '40pt' : '48pt';
      var iconHtml = imageData
        ? '<div class="icon-col"><img src="' + imageData + '"/></div><div class="divider"></div>'
        : '';
      var lastNameHtml = lastName ? '<div class="ln">' + lastName + '</div>' : '';
      var clubHtml = clubName
        ? '<div class="sep"></div><div class="cn">' + clubName + '</div>'
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
        '</style></head><body><div class="badge">' +
        iconHtml +
        '<div class="text"><div class="fn">' + (firstName || '') + '</div>' +
        lastNameHtml + clubHtml +
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

  injectWidget();
  loadPrintedState();
  fetchPrinters();
  watchCheckins();
  // Establish the roster baseline on load (or re-populate ROSTER_CACHE after a
  // reload that preserved baselineScanned via sessionStorage).
  setTimeout(scanClubberList, 500);
  // Safety-net scan every 5 s in case the MutationObserver misses a DOM change.
  setInterval(scanClubberList, SCAN_INTERVAL_MS);
  // Peak-window auto-refresh
  setInterval(autoRefresh, AUTO_REFRESH_INTERVAL_MS);
  syncCsv();
  checkForExtensionUpdate();
  updateQueueBadge();

  // Flush any queued prints on startup
  setTimeout(flushQueue, 3000);
  // Periodically try to flush queue
  setInterval(function() {
    if (getQueue().length > 0) flushQueue();
  }, 30000);

  console.log('[Awana] Extension loaded (v' + EXTENSION_VERSION + ')');
})();
