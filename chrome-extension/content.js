// Configuration and constants
const PRINT_COOLDOWN_MS = 2000;  // Prevent duplicate prints within 2 seconds
const MUTATION_DEBOUNCE_MS = 100; // Debounce MutationObserver to prevent rapid firing
const STATUS_ICON_TIMEOUT_MS = 3000; // How long to show status icon (✅, ❌, 🚫)

let selectedPrinterId = 'default_kiosk';
let autoPrintEnabled = true;
let lastPrintedName = null;
let lastPrintTime = 0; // Timestamp of last print attempt

function init() {
  injectPrinterDropdown();
  observeCheckins();
}

function injectPrinterDropdown() {
  const container = document.createElement('div');
  container.id = 'twotimtwo-printer-container';
  container.style.position = 'fixed';
  container.style.top = '10px';
  container.style.right = '10px';
  container.style.zIndex = '9999';
  container.style.background = '#f8fafc';
  container.style.padding = '10px 15px';
  container.style.border = '1px solid #cbd5e1';
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';
  container.style.fontFamily = 'sans-serif';

  const row1 = document.createElement('div');
  row1.style.display = 'flex';
  row1.style.alignItems = 'center';
  row1.style.gap = '10px';

  const label = document.createElement('label');
  label.textContent = '🖨️ Auto-Print:';
  label.style.fontWeight = 'bold';
  label.style.fontSize = '14px';
  label.style.color = '#334155';
  
  const select = document.createElement('select');
  select.id = 'twotimtwo-printer-select';
  select.style.padding = '4px 8px';
  select.style.borderRadius = '4px';
  select.style.border = '1px solid #cbd5e1';
  select.style.fontSize = '14px';
  select.style.cursor = 'pointer';
  
  const disableOption = document.createElement('option');
  disableOption.value = 'disabled';
  disableOption.textContent = '❌ Disabled';
  select.appendChild(disableOption);

  const dialogOption = document.createElement('option');
  dialogOption.value = 'print_dialog';
  dialogOption.textContent = '🖨️ Open Print Dialog';
  select.appendChild(dialogOption);

  const kioskOption = document.createElement('option');
  kioskOption.value = 'default_kiosk';
  kioskOption.textContent = '🖨️ Auto-Print (OS Default)';
  select.appendChild(kioskOption);
  
  const statusIcon = document.createElement('span');
  statusIcon.id = 'twotimtwo-printer-status';
  statusIcon.style.fontSize = '14px';
  
  row1.appendChild(label);
  row1.appendChild(select);
  row1.appendChild(statusIcon);

  const row2 = document.createElement('div');
  row2.style.display = 'flex';
  row2.style.justifyContent = 'flex-end';

  const testBtn = document.createElement('button');
  testBtn.textContent = 'Test Print';
  testBtn.style.fontSize = '11px';
  testBtn.style.padding = '2px 8px';
  testBtn.style.background = '#e2e8f0';
  testBtn.style.border = '1px solid #cbd5e1';
  testBtn.style.borderRadius = '4px';
  testBtn.style.cursor = 'pointer';
  testBtn.addEventListener('click', () => {
    generateAndPrintPDF('Test Child', 'Test Club');
  });

  row2.appendChild(testBtn);

  container.appendChild(row1);
  container.appendChild(row2);
  document.body.appendChild(container);

  // Load saved printer
  chrome.storage.sync.get(['selectedPrinterId'], (result) => {
    if (result.selectedPrinterId) {
      select.value = result.selectedPrinterId;
      selectedPrinterId = result.selectedPrinterId;
    } else {
      select.value = 'default_kiosk';
      selectedPrinterId = 'default_kiosk';
    }
    autoPrintEnabled = selectedPrinterId !== 'disabled';
  });

  select.addEventListener('change', (e) => {
    selectedPrinterId = e.target.value;
    autoPrintEnabled = selectedPrinterId !== 'disabled';
    chrome.storage.sync.set({ selectedPrinterId });
  });
}

// Helper: Detect if text contains "undo" action (shared logic)
function isUndoAction(text) {
  return text && text.toLowerCase().includes('undo');
}

function observeCheckins() {
  let observerTimeout = null;

  // Debounced callback to prevent rapid-fire mutations from causing multiple prints
  const handleMutations = () => {
    const lastCheckinDiv = document.querySelector('#lastCheckin div');
    if (lastCheckinDiv) {
      const clone = lastCheckinDiv.cloneNode(true);
      const undoLink = clone.querySelector('a');
      if (undoLink) undoLink.remove();
      const name = clone.innerText.trim();

      // Check if "undo" is present in the text (case-insensitive)
      if (isUndoAction(name)) {
        console.log('Detected "undo" in check-in text, skipping print.');
        lastPrintedName = name; // Mark as "seen" so we don't trigger again
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
    // Clear previous timeout and set a new one (debouncing)
    if (observerTimeout) clearTimeout(observerTimeout);
    observerTimeout = setTimeout(handleMutations, MUTATION_DEBOUNCE_MS);
  });

  // Only observe the specific container to improve performance
  const container = document.querySelector('#lastCheckin');
  if (container) {
    observer.observe(container, { childList: true, subtree: true, characterData: true });
  } else {
    // Fallback: observe body if container not yet available
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function handleNewCheckin(name) {
  if (!autoPrintEnabled || selectedPrinterId === 'disabled') {
    console.warn('Auto-print is disabled.');
    return;
  }

  // Prevent duplicate prints: check cooldown timer
  const now = Date.now();
  if (now - lastPrintTime < PRINT_COOLDOWN_MS) {
    console.log(`Print cooldown active (${PRINT_COOLDOWN_MS}ms). Ignoring rapid check-in.`);
    return;
  }

  let clubName = "";
  const clubberDivs = document.querySelectorAll('.clubber');
  for (let i = 0; i < clubberDivs.length; i++) {
    const n = clubberDivs[i].querySelector('.name');
    if (n && n.innerText.trim() === name) {
      const img = clubberDivs[i].querySelector('.club img');
      if (img) {
        clubName = img.getAttribute('alt').trim();
        clubName = clubName.replace(/&amp;/g, '&');
      }
      break;
    }
  }

  // Update lastPrintTime before generating PDF
  lastPrintTime = now;
  generateAndPrintPDF(name, clubName);
}

async function generateAndPrintPDF(name, clubName) {
  const statusIcon = document.getElementById('twotimtwo-printer-status');
  if (statusIcon) statusIcon.textContent = '⏳';

  try {
    // Split Name into First and Last
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Final "undo" check - if any part of the label contains "undo", skip it
    if (isUndoAction(firstName) || isUndoAction(lastName) || isUndoAction(clubName)) {
      console.log('Skipping print because "undo" was found in content.');
      if (statusIcon) statusIcon.textContent = '🚫';
      setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, STATUS_ICON_TIMEOUT_MS);
      return;
    }

    // ── Try silent print server first (unless user chose "Print Dialog") ──────
    if (selectedPrinterId !== 'print_dialog') {
      try {
        const res = await fetch('http://localhost:3456/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, clubName }),
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          if (statusIcon) statusIcon.textContent = '✅';
          setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, STATUS_ICON_TIMEOUT_MS);
          return;
        }
      } catch {
        // Server not running — fall through to browser print
        console.log('[twotimtwo] Print server not available, using browser print fallback.');
      }
    }

    // ── Fallback: browser print via hidden iframe ─────────────────────────────
    // Create an invisible iframe to print the label
    let printIframe = document.getElementById('twotimtwo-print-iframe');
    if (!printIframe) {
      printIframe = document.createElement('iframe');
      printIframe.id = 'twotimtwo-print-iframe';
      printIframe.style.position = 'fixed';
      printIframe.style.right = '0';
      printIframe.style.bottom = '0';
      printIframe.style.width = '0';
      printIframe.style.height = '0';
      printIframe.style.border = '0';
      printIframe.style.visibility = 'hidden';
      document.body.appendChild(printIframe);
    }

    const printDoc = printIframe.contentWindow.document;
    printDoc.open();
    printDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Print Label - ${name}</title>
          <style>
            @page {
              size: 4in 2in;
              margin: 0;
            }
            body {
              margin: 0;
              padding: 0;
              width: 4in;
              height: 2in;
              display: flex;
              align-items: center;
              justify-content: center;
              font-family: "Helvetica", "Arial", sans-serif;
              overflow: hidden;
            }
            .badge {
              width: 3.8in;
              height: 1.8in;
              border: 2px solid black;
              border-radius: 15px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              box-sizing: border-box;
              padding: 5px;
            }
            .first-name {
              font-size: 48pt;
              font-weight: bold;
              line-height: 1.1;
              word-wrap: break-word;
              max-width: 100%;
            }
            .last-name {
              font-size: 22pt;
              margin-top: 2pt;
            }
            .club-name {
              font-size: 14pt;
              font-style: italic;
              margin-top: 8pt;
              border-top: 1px solid #ccc;
              padding-top: 4pt;
              width: 70%;
            }
          </style>
        </head>
        <body>
          <div class="badge">
            <div class="first-name">${firstName}</div>
            ${lastName ? `<div class="last-name">${lastName}</div>` : ''}
            ${clubName ? `<div class="club-name">${clubName}</div>` : ''}
          </div>
        </body>
      </html>
    `);
    printDoc.close();

    // Trigger print from the parent window context for better kiosk mode support
    // Use 500ms delay to ensure iframe document is fully ready
    setTimeout(() => {
      try {
        printIframe.contentWindow.focus();
        printIframe.contentWindow.print();

        if (statusIcon) statusIcon.textContent = '✅';
        setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, STATUS_ICON_TIMEOUT_MS);
      } catch (err) {
        if (statusIcon) statusIcon.textContent = '❌';
        console.error('Print execution failed:', err);
        setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, STATUS_ICON_TIMEOUT_MS);
      }
    }, 500);

  } catch (error) {
    if (statusIcon) statusIcon.textContent = '❌';
    console.error('Print generation error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
