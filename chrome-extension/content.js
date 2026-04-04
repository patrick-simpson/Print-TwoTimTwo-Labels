(function() {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  const EXTENSION_VERSION = '1.10.8';
  const PRINT_COOLDOWN = 2000;
  const DEBOUNCE_MS = 100;
  const STATUS_TIMEOUT = 3000;
  const PRINT_SERVER = 'http://localhost:3456';
  const STORAGE_KEY = 'awana_selectedPrinterId';
  const MINIMIZE_KEY = 'awana_widgetMinimized';
  const PRINTER_KEY  = 'awana_selectedPrinterName';

  let selectedMode        = localStorage.getItem(STORAGE_KEY) || 'auto';
  let selectedPrinterName = localStorage.getItem(PRINTER_KEY) || '';
  let lastPrintedName = null;
  let lastPrintTime = 0;

  function isUndo(text) {
    return text && text.toLowerCase().includes('undo');
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
    var isMinimized = localStorage.getItem(MINIMIZE_KEY) === 'true';

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

    function triggerWalkIn() {
      var name = guestInput.value.trim();
      if (!name) return;
      doPrint(name, '', null);
      guestInput.value = '';
    }
    guestInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') triggerWalkIn(); });
    walkInPrintBtn.addEventListener('click', triggerWalkIn);

    walkInRow.append(guestInput, walkInPrintBtn);

    panelBody.append(controls, printerRow, walkInDivider, walkInLabel, walkInRow, csvStatus, updateRow);
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

    var printPromise;
    if (selectedMode !== 'dialog') {
      printPromise = fetch(PRINT_SERVER + '/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, clubName: clubName, clubImageData: imageData, printerName: selectedPrinterName || '' }),
        signal: AbortSignal.timeout(5000)
      }).then(function(response) {
        if (response.ok) {
          setStatus('\u2705');
          clearStatus();
          console.log('[Awana] Silent print sent to server');
          return true;
        }
        return false;
      }).catch(function(err) {
        console.log('[Awana] Server unavailable:', err.message);
        return false;
      });
    } else {
      printPromise = Promise.resolve(false);
    }

    printPromise.then(function(sentToServer) {
      if (sentToServer || selectedMode === 'off') return;
      fallbackPrint(firstName, lastName, clubName, imageData);
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
  fetchPrinters();
  watchCheckins();
  syncCsv();
  checkForExtensionUpdate();
  console.log('[Awana] Extension loaded (v' + EXTENSION_VERSION + ')');
})();
