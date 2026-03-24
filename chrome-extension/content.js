// Configuration and constants
const PRINT_COOLDOWN_MS    = 2000;  // Prevent duplicate prints within 2 seconds
const MUTATION_DEBOUNCE_MS = 100;   // Debounce MutationObserver to prevent rapid firing
const STATUS_ICON_TIMEOUT  = 3000;  // How long to show status icon (✅ ❌ 🚫)
const PRINT_SERVER         = 'http://localhost:3456';

let selectedPrinterId = 'default_kiosk';
let autoPrintEnabled  = true;
let lastPrintedName   = null;
let lastPrintTime     = 0;

// ── Helper: detect "undo" text ───────────────────────────────────────────────
function isUndoAction(text) {
  return text && text.toLowerCase().includes('undo');
}

// ── Capture club image as a PNG data-URL via canvas ──────────────────────────
function getClubImageDataUrl(imgElement) {
  try {
    if (!imgElement || !imgElement.src) return null;
    if (!imgElement.complete || imgElement.naturalWidth === 0) return null;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(imgElement, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } catch {
    // Canvas tainted by cross-origin image — fall back to URL
    return imgElement.src || null;
  }
}

// ── Inject the printer control UI ────────────────────────────────────────────
function init() {
  injectUI();
  observeCheckins();
}

function injectUI() {
  const container = document.createElement('div');
  container.id = 'twotimtwo-printer-container';
  Object.assign(container.style, {
    position: 'fixed', top: '10px', right: '10px', zIndex: '9999',
    background: '#f8fafc', padding: '10px 15px',
    border: '1px solid #cbd5e1', borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    display: 'flex', flexDirection: 'column', gap: '8px',
    fontFamily: 'sans-serif'
  });

  // Row 1: label + dropdown + status icon
  const row1 = document.createElement('div');
  Object.assign(row1.style, { display: 'flex', alignItems: 'center', gap: '10px' });

  const label = document.createElement('label');
  label.textContent = '🖨️ Auto-Print:';
  Object.assign(label.style, { fontWeight: 'bold', fontSize: '14px', color: '#334155' });

  const select = document.createElement('select');
  select.id = 'twotimtwo-printer-select';
  Object.assign(select.style, {
    padding: '4px 8px', borderRadius: '4px',
    border: '1px solid #cbd5e1', fontSize: '14px', cursor: 'pointer'
  });

  [
    ['disabled',     '❌ Disabled'],
    ['print_dialog', '🖨️ Open Print Dialog'],
    ['default_kiosk','🖨️ Auto-Print (Silent Server)']
  ].forEach(([val, text]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    select.appendChild(opt);
  });

  const statusIcon = document.createElement('span');
  statusIcon.id = 'twotimtwo-printer-status';
  statusIcon.style.fontSize = '16px';

  row1.append(label, select, statusIcon);

  // Row 2: test button
  const row2 = document.createElement('div');
  Object.assign(row2.style, { display: 'flex', justifyContent: 'flex-end' });

  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test Print';
  Object.assign(testBtn.style, {
    fontSize: '11px', padding: '2px 8px', background: '#e2e8f0',
    border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer'
  });
  testBtn.addEventListener('click', () => generateAndPrintPDF('Test Child', 'Sparks', null));

  row2.appendChild(testBtn);
  container.append(row1, row2);
  document.body.appendChild(container);

  // Restore saved setting
  chrome.storage.sync.get(['selectedPrinterId'], (result) => {
    const saved = result.selectedPrinterId || 'default_kiosk';
    select.value = saved;
    selectedPrinterId = saved;
    autoPrintEnabled = saved !== 'disabled';
  });

  select.addEventListener('change', (e) => {
    selectedPrinterId = e.target.value;
    autoPrintEnabled  = selectedPrinterId !== 'disabled';
    chrome.storage.sync.set({ selectedPrinterId });
  });
}

// ── Watch for check-ins via MutationObserver ──────────────────────────────────
function observeCheckins() {
  let debounceTimer = null;

  const handleMutations = () => {
    const lastCheckinDiv = document.querySelector('#lastCheckin div');
    if (lastCheckinDiv) {
      // Use a clone so we can strip the "undo" link before reading text
      const clone = lastCheckinDiv.cloneNode(true);
      const undoLink = clone.querySelector('a');
      if (undoLink) undoLink.remove();
      const name = clone.textContent.trim();   // textContent works on detached nodes

      if (isUndoAction(name)) {
        lastPrintedName = name;
        return;
      }
      if (name && name !== lastPrintedName) {
        lastPrintedName = name;
        handleNewCheckin(name);
      } else if (!name) {
        lastPrintedName = null;
      }
    } else {
      lastPrintedName = null;
    }
  };

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(handleMutations, MUTATION_DEBOUNCE_MS);
  });

  const target = document.querySelector('#lastCheckin') || document.body;
  observer.observe(target, { childList: true, subtree: true, characterData: true });
}

// ── Find club info for a checked-in person ────────────────────────────────────
function lookupClubInfo(name) {
  const clubberDivs = document.querySelectorAll('.clubber');
  for (const div of clubberDivs) {
    const nameEl = div.querySelector('.name');
    if (nameEl && nameEl.innerText.trim() === name) {
      const img = div.querySelector('.club img');
      if (img) {
        const clubName = (img.getAttribute('alt') || '').trim().replace(/&amp;/g, '&');
        const clubImageData = getClubImageDataUrl(img);
        return { clubName, clubImageData };
      }
      return { clubName: '', clubImageData: null };
    }
  }
  return { clubName: '', clubImageData: null };
}

// ── React to a new check-in ───────────────────────────────────────────────────
function handleNewCheckin(name) {
  if (!autoPrintEnabled || selectedPrinterId === 'disabled') return;

  const now = Date.now();
  if (now - lastPrintTime < PRINT_COOLDOWN_MS) return;
  lastPrintTime = now;

  const { clubName, clubImageData } = lookupClubInfo(name);
  generateAndPrintPDF(name, clubName, clubImageData);
}

// ── Core print function ───────────────────────────────────────────────────────
async function generateAndPrintPDF(name, clubName, clubImageData) {
  const statusEl = document.getElementById('twotimtwo-printer-status');
  const setStatus = (s) => { if (statusEl) statusEl.textContent = s; };
  const clearStatus = () => setTimeout(() => setStatus(''), STATUS_ICON_TIMEOUT);

  setStatus('⏳');

  const nameParts  = name.split(' ');
  const firstName  = nameParts[0] || '';
  const lastName   = nameParts.slice(1).join(' ') || '';

  // Final undo guard
  if (isUndoAction(firstName) || isUndoAction(lastName) || isUndoAction(clubName)) {
    setStatus('🚫'); clearStatus(); return;
  }

  // ── Try silent print server first (skip only for explicit "Print Dialog" mode)
  if (selectedPrinterId !== 'print_dialog') {
    try {
      const res = await fetch(`${PRINT_SERVER}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, clubName, clubImageData }),
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) { setStatus('✅'); clearStatus(); return; }
    } catch {
      console.log('[twotimtwo] Print server unavailable — falling back to browser print.');
    }
  }

  // ── Fallback: browser print via hidden iframe ─────────────────────────────
  let iframe = document.getElementById('twotimtwo-print-iframe');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'twotimtwo-print-iframe';
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0',
      width: '0', height: '0', border: '0', visibility: 'hidden'
    });
    document.body.appendChild(iframe);
  }

  const iconHtml = clubImageData
    ? `<div class="icon-col"><img src="${clubImageData}" /></div><div class="divider"></div>`
    : '';
  const hasIcon = !!clubImageData;

  iframe.contentWindow.document.open();
  iframe.contentWindow.document.write(`<!DOCTYPE html><html><head>
    <title>Print Label</title>
    <style>
      @page { size: 4in 2in; margin: 0; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        width: 4in; height: 2in;
        display: flex; align-items: center; justify-content: center;
        font-family: Helvetica, Arial, sans-serif; overflow: hidden;
      }
      .badge {
        width: 3.8in; height: 1.8in;
        border: 1.5pt solid #000; border-radius: 12pt;
        display: flex; align-items: stretch; overflow: hidden;
      }
      .icon-col {
        width: 1.1in; display: flex; align-items: center; justify-content: center;
        background: #f5f5f5; flex-shrink: 0; padding: 8pt;
      }
      .icon-col img { width: 52pt; height: 52pt; object-fit: contain; }
      .divider { width: 1pt; background: #ddd; flex-shrink: 0; }
      .text-col {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: ${hasIcon ? '6pt 10pt' : '6pt 12pt'};
        text-align: center;
      }
      .first-name {
        font-size: ${firstName.length > 8 ? (firstName.length > 12 ? '32pt' : '40pt') : '48pt'};
        font-weight: bold; line-height: 1.05; word-break: break-word; max-width: 100%;
      }
      .last-name  { font-size: 20pt; margin-top: 2pt; color: #111; }
      .separator  { width: 65%; height: 0.5pt; background: #ccc; margin: 6pt auto; }
      .club-name  { font-size: 13pt; font-style: italic; color: #444; }
    </style></head><body>
    <div class="badge">
      ${iconHtml}
      <div class="text-col">
        <div class="first-name">${firstName}</div>
        ${lastName  ? `<div class="last-name">${lastName}</div>` : ''}
        ${clubName  ? `<div class="separator"></div><div class="club-name">${clubName}</div>` : ''}
      </div>
    </div>
  </body></html>`);
  iframe.contentWindow.document.close();

  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setStatus('✅'); clearStatus();
    } catch (err) {
      console.error('Print failed:', err);
      setStatus('❌'); clearStatus();
    }
  }, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
