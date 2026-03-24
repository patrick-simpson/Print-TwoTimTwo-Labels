/**
 * Awana Label Printer — check-in detector
 * Injected by Electron into the twotimtwo.com check-in BrowserWindow.
 * Does NOT use chrome.* APIs — uses localStorage for persistence instead.
 */
(function () {
  if (window.__awanaPrinterLoaded) return;
  window.__awanaPrinterLoaded = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const PRINT_COOLDOWN    = 2000;
  const DEBOUNCE_MS       = 100;
  const STATUS_TIMEOUT    = 3000;
  const PRINT_SERVER      = 'http://localhost:3456';
  const STORAGE_KEY       = 'awana_selectedPrinterId';

  // ── State ──────────────────────────────────────────────────────────────────
  let selectedMode    = localStorage.getItem(STORAGE_KEY) || 'auto';
  let lastPrintedName = null;
  let lastPrintTime   = 0;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function isUndo(text) {
    return text && text.toLowerCase().includes('undo');
  }

  function getClubImageDataUrl(img) {
    try {
      if (!img || !img.src || !img.complete || img.naturalWidth === 0) return null;
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').drawImage(img, 0, 0, 64, 64);
      return c.toDataURL('image/png');
    } catch {
      return img.src || null;
    }
  }

  // ── Floating status widget ─────────────────────────────────────────────────
  function injectWidget() {
    const wrap = document.createElement('div');
    wrap.id = 'awana-widget';
    Object.assign(wrap.style, {
      position: 'fixed', top: '10px', right: '10px', zIndex: '99999',
      background: '#f8fafc', padding: '10px 14px',
      border: '1px solid #cbd5e1', borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      display: 'flex', flexDirection: 'column', gap: '6px',
      fontFamily: 'system-ui, sans-serif', fontSize: '13px'
    });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

    const lbl = document.createElement('span');
    lbl.textContent = '🖨️';
    lbl.style.fontSize = '16px';

    const sel = document.createElement('select');
    sel.id = 'awana-mode-select';
    Object.assign(sel.style, {
      padding: '3px 7px', borderRadius: '4px',
      border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: '12px'
    });
    [['auto', '🖨️ Auto-Print'], ['dialog', '🗔 Print Dialog'], ['off', '❌ Off']]
      .forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        sel.appendChild(o);
      });
    sel.value = selectedMode;

    const status = document.createElement('span');
    status.id = 'awana-status';
    status.style.fontSize = '16px';

    sel.addEventListener('change', () => {
      selectedMode = sel.value;
      localStorage.setItem(STORAGE_KEY, selectedMode);
    });

    const testBtn = document.createElement('button');
    testBtn.textContent = 'Test';
    Object.assign(testBtn.style, {
      fontSize: '11px', padding: '2px 7px', background: '#e2e8f0',
      border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer'
    });
    testBtn.addEventListener('click', () => doPrint('Test Child', 'Sparks', null));

    row.append(lbl, sel, status, testBtn);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
  }

  function setStatus(icon) {
    const el = document.getElementById('awana-status');
    if (el) el.textContent = icon;
  }
  function clearStatus() {
    setTimeout(() => setStatus(''), STATUS_TIMEOUT);
  }

  // ── MutationObserver ───────────────────────────────────────────────────────
  function watchCheckins() {
    let timer = null;
    const check = () => {
      const div = document.querySelector('#lastCheckin div');
      if (!div) { lastPrintedName = null; return; }
      const clone = div.cloneNode(true);
      clone.querySelector('a')?.remove();
      const name = clone.textContent.trim();
      if (isUndo(name)) { lastPrintedName = name; return; }
      if (name && name !== lastPrintedName) {
        lastPrintedName = name;
        onCheckin(name);
      } else if (!name) {
        lastPrintedName = null;
      }
    };

    const target = document.querySelector('#lastCheckin') || document.body;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(check, DEBOUNCE_MS);
    }).observe(target, { childList: true, subtree: true, characterData: true });
  }

  // ── Find club info ─────────────────────────────────────────────────────────
  function lookupClub(name) {
    for (const div of document.querySelectorAll('.clubber')) {
      const nameEl = div.querySelector('.name');
      if (nameEl && nameEl.innerText.trim() === name) {
        const img = div.querySelector('.club img');
        if (img) {
          return {
            clubName: (img.getAttribute('alt') || '').trim().replace(/&amp;/g, '&'),
            clubImageData: getClubImageDataUrl(img)
          };
        }
        return { clubName: '', clubImageData: null };
      }
    }
    return { clubName: '', clubImageData: null };
  }

  // ── Check-in handler ───────────────────────────────────────────────────────
  function onCheckin(name) {
    if (selectedMode === 'off') return;
    const now = Date.now();
    if (now - lastPrintTime < PRINT_COOLDOWN) return;
    lastPrintTime = now;
    const { clubName, clubImageData } = lookupClub(name);
    doPrint(name, clubName, clubImageData);
  }

  // ── Print ──────────────────────────────────────────────────────────────────
  async function doPrint(name, clubName, clubImageData) {
    setStatus('⏳');
    const parts     = name.split(' ');
    const firstName = parts[0] || '';
    const lastName  = parts.slice(1).join(' ') || '';

    if (isUndo(firstName) || isUndo(lastName) || isUndo(clubName)) {
      setStatus('🚫'); clearStatus(); return;
    }

    // Silent server print
    if (selectedMode !== 'dialog') {
      try {
        const res = await fetch(`${PRINT_SERVER}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, clubName, clubImageData }),
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) { setStatus('✅'); clearStatus(); return; }
      } catch {
        console.log('[Awana] Print server unavailable — falling back to window.print()');
      }
    }

    if (selectedMode === 'off') return;

    // Browser print fallback via hidden iframe
    let iframe = document.getElementById('awana-print-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'awana-print-frame';
      Object.assign(iframe.style, {
        position: 'fixed', right: '0', bottom: '0',
        width: '0', height: '0', border: '0', visibility: 'hidden'
      });
      document.body.appendChild(iframe);
    }

    const iconHtml = clubImageData
      ? `<div class="icon-col"><img src="${clubImageData}"/></div><div class="div"></div>`
      : '';
    const fs = firstName.length > 12 ? '32pt' : firstName.length > 8 ? '40pt' : '48pt';

    iframe.contentWindow.document.open();
    iframe.contentWindow.document.write(`<!DOCTYPE html><html><head>
      <style>
        @page{size:4in 2in;margin:0}
        *{box-sizing:border-box;margin:0;padding:0}
        body{width:4in;height:2in;display:flex;align-items:center;justify-content:center;font-family:Helvetica,Arial,sans-serif}
        .badge{width:3.8in;height:1.8in;border:1.5pt solid #000;border-radius:12pt;display:flex;align-items:stretch;overflow:hidden}
        .icon-col{width:1.1in;display:flex;align-items:center;justify-content:center;background:#f4f4f4;flex-shrink:0;padding:8pt}
        .icon-col img{width:52pt;height:52pt;object-fit:contain}
        .div{width:1pt;background:#ddd;flex-shrink:0}
        .text{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6pt 10pt;text-align:center}
        .fn{font-size:${fs};font-weight:bold;line-height:1.05;word-break:break-word}
        .ln{font-size:20pt;margin-top:2pt}
        .sep{width:65%;height:.5pt;background:#ccc;margin:5pt auto}
        .cn{font-size:12pt;font-style:italic;color:#444}
      </style></head><body>
      <div class="badge">
        ${iconHtml}
        <div class="text">
          <div class="fn">${firstName}</div>
          ${lastName  ? `<div class="ln">${lastName}</div>` : ''}
          ${clubName  ? `<div class="sep"></div><div class="cn">${clubName}</div>` : ''}
        </div>
      </div></body></html>`);
    iframe.contentWindow.document.close();

    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); setStatus('✅'); }
      catch { setStatus('❌'); }
      clearStatus();
    }, 500);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  injectWidget();
  watchCheckins();

})();
