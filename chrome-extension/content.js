let selectedPrinterId = null;
let lastPrintedName = null;

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
  container.style.alignItems = 'center';
  container.style.gap = '10px';
  container.style.fontFamily = 'sans-serif';

  const label = document.createElement('label');
  label.textContent = '🖨️ Auto-Print:';
  label.style.fontWeight = 'bold';
  label.style.fontSize = '14px';
  label.style.color = '#334155';
  
  const select = document.createElement('select');
  select.id = 'twotimtwo-printer-select';
  select.style.padding = '6px 10px';
  select.style.borderRadius = '4px';
  select.style.border = '1px solid #94a3b8';
  select.style.fontSize = '14px';
  select.style.outline = 'none';
  select.style.cursor = 'pointer';
  
  const statusIcon = document.createElement('span');
  statusIcon.id = 'twotimtwo-printer-status';
  statusIcon.style.fontSize = '14px';
  
  container.appendChild(label);
  container.appendChild(select);
  container.appendChild(statusIcon);
  document.body.appendChild(container);

  chrome.storage.sync.get(['selectedPrinterId'], (result) => {
    selectedPrinterId = result.selectedPrinterId || null;
    
    chrome.runtime.sendMessage({ action: 'getPrinters' }, (response) => {
      if (response && response.printers) {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Select Printer --';
        select.appendChild(defaultOption);

        response.printers.forEach(printer => {
          const option = document.createElement('option');
          option.value = printer.id;
          option.textContent = printer.name;
          if (printer.id === selectedPrinterId) {
            option.selected = true;
          }
          select.appendChild(option);
        });
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No printers found';
        select.appendChild(option);
        if (response && response.error) {
          console.error('Printer fetch error:', response.error);
        }
      }
    });
  });

  select.addEventListener('change', (e) => {
    selectedPrinterId = e.target.value;
    chrome.storage.sync.set({ selectedPrinterId });
  });
}

function observeCheckins() {
  const observer = new MutationObserver((mutationsList) => {
    const lastCheckinDiv = document.querySelector('#lastCheckin div');
    if (lastCheckinDiv) {
      const clone = lastCheckinDiv.cloneNode(true);
      const undoLink = clone.querySelector('a');
      if (undoLink) undoLink.remove();
      const name = clone.innerText.trim();
      
      if (name && name !== lastPrintedName) {
        lastPrintedName = name;
        handleNewCheckin(name);
      } else if (!name) {
        lastPrintedName = null;
      }
    } else {
      lastPrintedName = null;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function handleNewCheckin(name) {
  if (!selectedPrinterId) {
    console.warn('No printer selected for auto-print.');
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

  generateAndPrintPDF(name, clubName);
}

function generateAndPrintPDF(name, clubName) {
  const statusIcon = document.getElementById('twotimtwo-printer-status');
  if (statusIcon) statusIcon.textContent = '⏳';

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'in',
      format: [4, 2]
    });

    const pageWidth = 4;
    
    // Name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(36);
    const nameWidth = doc.getStringUnitWidth(name) * doc.internal.getFontSize() / 72;
    const nameX = (pageWidth - nameWidth) / 2;
    
    let currentY = 0.8;
    if (!clubName) {
      currentY = 1.1;
    }
    
    doc.text(name, nameX, currentY);

    // Club Name
    if (clubName) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(24);
      
      // Text wrapping for club name
      const maxClubWidth = 3.8;
      const splitClubName = doc.splitTextToSize(clubName, maxClubWidth);
      
      currentY += 0.5;
      
      splitClubName.forEach(line => {
        const lineWidth = doc.getStringUnitWidth(line) * doc.internal.getFontSize() / 72;
        const lineX = (pageWidth - lineWidth) / 2;
        doc.text(line, lineX, currentY);
        currentY += 0.35;
      });
    }

    const dataUri = doc.output('datauristring');

    chrome.runtime.sendMessage({
      action: 'printJob',
      printerId: selectedPrinterId,
      title: `Label - ${name}`,
      documentBase64: dataUri
    }, (response) => {
      if (response && response.status === 'OK') {
        if (statusIcon) statusIcon.textContent = '✅';
        setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, 3000);
      } else {
        if (statusIcon) statusIcon.textContent = '❌';
        console.error('Print failed:', response ? response.error : 'Unknown error');
      }
    });
  } catch (error) {
    if (statusIcon) statusIcon.textContent = '❌';
    console.error('PDF generation error:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
