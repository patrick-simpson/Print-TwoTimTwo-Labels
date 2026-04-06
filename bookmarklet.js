(function() {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  const PRINT_COOLDOWN = 2000;
  const DEBOUNCE_MS = 100;
  const STATUS_TIMEOUT = 3000;
  const PRINT_SERVER = 'http://localhost:3456';
  const STORAGE_KEY = 'awana_selectedPrinterId';

  const QUEUE_KEY = 'awana_printQueue';
  const MUTE_KEY  = 'awana_soundMuted';

  let selectedMode = localStorage.getItem(STORAGE_KEY) || 'auto';
  let soundMuted   = localStorage.getItem(MUTE_KEY) === 'true';
  let lastPrintedName = null;
  let lastPrintTime = 0;

  function isUndo(text) {
    return text && text.toLowerCase().includes('undo');
  }

  // Audio feedback
  var audioCtx = null;
  function playTone(freq, dur, type) {
    if (soundMuted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audioCtx.createOscillator(); var gain = audioCtx.createGain();
      osc.type = type || 'sine'; osc.frequency.value = freq; gain.gain.value = 0.15;
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (dur || 0.2));
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + (dur || 0.2));
    } catch(e) {}
  }
  function playSuccess() { playTone(880, 0.12); setTimeout(function() { playTone(1108, 0.15); }, 120); }
  function playError() { playTone(330, 0.3, 'square'); }

  // Offline queue
  function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; } }
  function saveQueue(q) { if (q.length > 50) q.length = 50; localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  function queuePrint(payload) { var q = getQueue(); q.push(payload); saveQueue(q); console.log('[Awana] Queued (' + q.length + ')'); }
  function flushQueue() {
    var q = getQueue(); if (!q.length) return;
    var item = q.shift(); saveQueue(q);
    fetch(PRINT_SERVER + '/print', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item), signal: AbortSignal.timeout(5000)
    }).then(function(r) { if (r.ok) { playSuccess(); if (getQueue().length) setTimeout(flushQueue, PRINT_COOLDOWN); }
      else { var q2 = getQueue(); q2.unshift(item); saveQueue(q2); }
    }).catch(function() { var q2 = getQueue(); q2.unshift(item); saveQueue(q2); });
  }

  // Sibling detection
  function findSiblings(fullName) {
    var parts = fullName.trim().split(/\s+/); if (parts.length < 2) return [];
    var lastName = parts.slice(1).join(' ').toLowerCase(); var siblings = [];
    var clubbers = document.querySelectorAll('.clubber');
    for (var i = 0; i < clubbers.length; i++) {
      var nameEl = clubbers[i].querySelector('.name'); if (!nameEl) continue;
      var name = nameEl.innerText.trim(); if (name === fullName) continue;
      var np = name.split(/\s+/); if (np.length < 2) continue;
      if (np.slice(1).join(' ').toLowerCase() === lastName) {
        var imgEl = clubbers[i].querySelector('.club img');
        var cn = imgEl ? (imgEl.getAttribute('alt') || '').trim().replace(/&amp;/g, '&') : '';
        siblings.push({ name: name, clubName: cn, element: clubbers[i] });
      }
    }
    return siblings;
  }

  function showSiblingPanel(siblings, checkedInName) {
    var existing = document.getElementById('awana-sibling-panel'); if (existing) existing.remove();
    var overlay = document.createElement('div'); overlay.id = 'awana-sibling-panel';
    Object.assign(overlay.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '100000',
      background: '#fff', border: '1px solid #c8e6c9', borderRadius: '10px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: '240px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px' });
    var header = document.createElement('div');
    Object.assign(header.style, { padding: '10px 14px', background: '#4caf50', color: '#fff',
      borderRadius: '10px 10px 0 0', fontWeight: '700', fontSize: '13px', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center' });
    header.textContent = 'Check in siblings?';
    var closeX = document.createElement('button');
    Object.assign(closeX.style, { background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
      width: '22px', height: '22px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px',
      lineHeight: '22px', textAlign: 'center', padding: '0' });
    closeX.innerHTML = '&#x2715;';
    closeX.addEventListener('click', function() { overlay.remove(); });
    header.appendChild(closeX);
    var body = document.createElement('div');
    Object.assign(body.style, { padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '6px' });
    var checkboxes = [];
    siblings.forEach(function(sib) {
      var row = document.createElement('label');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
        background: '#f8fafc', borderRadius: '6px', cursor: 'pointer' });
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
      var ns = document.createElement('span'); ns.style.fontWeight = '600'; ns.textContent = sib.name;
      row.append(cb, ns); body.appendChild(row); checkboxes.push({ checkbox: cb, sibling: sib });
    });
    var btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '8px', marginTop: '6px' });
    var goBtn = document.createElement('button'); goBtn.textContent = 'Check In Selected';
    Object.assign(goBtn.style, { flex: '1', padding: '8px', background: '#4caf50', color: '#fff',
      border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' });
    goBtn.addEventListener('click', function() {
      var sel = checkboxes.filter(function(c) { return c.checkbox.checked; }).map(function(c) { return c.sibling; });
      overlay.remove(); if (sel.length) batchCheckInSiblings(sel);
    });
    var skipBtn = document.createElement('button'); skipBtn.textContent = 'Skip';
    Object.assign(skipBtn.style, { padding: '8px 14px', background: '#f1f5f9', color: '#475569',
      border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' });
    skipBtn.addEventListener('click', function() { overlay.remove(); });
    btnRow.append(goBtn, skipBtn); body.appendChild(btnRow);
    overlay.append(header, body); document.body.appendChild(overlay);
  }

  function batchCheckInSiblings(siblings) {
    if (!siblings.length) return; var sib = siblings[0]; var remaining = siblings.slice(1);
    console.log('[Awana] Batch: clicking ' + sib.name); setStatus('\u23F3');
    sib.element.click();
    setTimeout(function() {
      var checkinBtn = null;
      var buttons = document.querySelectorAll('.modal button, .dialog button, [class*="modal"] button');
      for (var i = 0; i < buttons.length; i++) {
        var txt = buttons[i].textContent.toLowerCase().trim();
        if (txt === 'checkin' || txt === 'check in') { checkinBtn = buttons[i]; break; }
      }
      if (checkinBtn) { checkinBtn.click(); }
      else { var club = lookupClub(sib.name); doPrint(sib.name, club.clubName, club.clubImageData); }
      if (remaining.length) setTimeout(function() { batchCheckInSiblings(remaining); }, PRINT_COOLDOWN + 500);
    }, 600);
  }

  function getClubImageDataUrl(img) {
    try {
      if (!img || !img.src || !img.complete || img.naturalWidth === 0) {
        return null;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      canvas.getContext('2d').drawImage(img, 0, 0, 64, 64);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return img.src || null;
    }
  }

  function injectWidget() {
    const widget = document.createElement('div');
    widget.id = 'awana-widget';
    Object.assign(widget.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      zIndex: '99999',
      background: '#f8fafc',
      padding: '10px 14px',
      border: '1px solid #cbd5e1',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px'
    });

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    });

    const icon = document.createElement('span');
    icon.textContent = '\uD83D\uDDA8\uFE0F';
    icon.style.fontSize = '16px';

    const modeSelect = document.createElement('select');
    modeSelect.id = 'awana-mode-select';
    Object.assign(modeSelect.style, {
      padding: '3px 7px',
      borderRadius: '4px',
      border: '1px solid #cbd5e1',
      cursor: 'pointer',
      fontSize: '12px'
    });

    const modes = [
      ['auto', '\uD83D\uDDA8\uFE0F Auto-Print'],
      ['dialog', '\uD83D\uDDD4 Print Dialog'],
      ['off', '\u274C Off']
    ];
    modes.forEach(function(pair) {
      var value = pair[0], label = pair[1];
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = selectedMode;

    const statusEl = document.createElement('span');
    statusEl.id = 'awana-status';
    statusEl.style.fontSize = '16px';

    modeSelect.addEventListener('change', function() {
      selectedMode = modeSelect.value;
      localStorage.setItem(STORAGE_KEY, selectedMode);
      console.log('[Awana] Mode changed to:', selectedMode);
    });

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    Object.assign(testBtn.style, {
      fontSize: '11px',
      padding: '2px 7px',
      background: '#e2e8f0',
      border: '1px solid #cbd5e1',
      borderRadius: '4px',
      cursor: 'pointer'
    });
    testBtn.addEventListener('click', function() {
      console.log('[Awana] Test button clicked');
      doPrint('Test Child', 'Sparks', null);
    });

    var csvStatus = document.createElement('div');
    csvStatus.id = 'awana-csv-status';
    Object.assign(csvStatus.style, {
      fontSize: '11px',
      color: '#94a3b8',
      whiteSpace: 'nowrap'
    });
    csvStatus.textContent = 'Syncing roster...';

    controls.append(icon, modeSelect, statusEl, testBtn);
    widget.appendChild(controls);
    widget.appendChild(csvStatus);
    document.body.appendChild(widget);
    console.log('[Awana] Widget injected');
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

    lastPrintTime = Date.now();
    var club = lookupClub(name);
    doPrint(name, club.clubName, club.clubImageData);

    setTimeout(function() {
      var siblings = findSiblings(name);
      if (siblings.length > 0) showSiblingPanel(siblings, name);
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

    var payload = { name: fullName, clubName: clubName, clubImageData: imageData };

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
          flushQueue();
          console.log('[Awana] Silent print sent to server');
          return true;
        }
        return false;
      }).catch(function(err) {
        console.log('[Awana] Server unavailable, queuing:', err.message);
        queuePrint(payload);
        setStatus('\uD83D\uDCE6');
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
    var frame = document.getElementById('awana-print-frame');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'awana-print-frame';
      Object.assign(frame.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
        visibility: 'hidden'
      });
      document.body.appendChild(frame);
    }

    var fontSize = firstName.length > 12 ? '32pt' : firstName.length > 8 ? '40pt' : '48pt';
    var iconHtml = imageData
      ? '<div class="icon-col"><img src="' + imageData + '"/></div><div class="divider"></div>'
      : '';
    var lastNameHtml = lastName ? '<div class="ln">' + lastName + '</div>' : '';
    // Removed club name from fallback
    var clubHtml = ''
      ? '<div class="sep"></div><div class="cn">' + clubName + '</div>'
      : '';

    var html = '<!DOCTYPE html><html><head><style>' +
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
      '<div class="text"><div class="fn">' + firstName + '</div>' +
      lastNameHtml +
      clubHtml +
      '</div></div></body></html>';

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
    }, 500);
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

  injectWidget();
  watchCheckins();
  syncCsv();
  setTimeout(flushQueue, 3000);
  console.log('[Awana] Bookmarklet loaded and active');
})();
