let selectedPrinterId = 'default_kiosk';
let autoPrintEnabled = true;
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
  select.style.padding = '4px 8px';
  select.style.borderRadius = '4px';
  select.style.border = '1px solid #cbd5e1';
  select.style.fontSize = '14px';
  select.style.cursor = 'pointer';
  
  const disableOption = document.createElement('option');
  disableOption.value = 'disabled';
  disableOption.textContent = '❌ Disabled';
  select.appendChild(disableOption);

  const kioskOption = document.createElement('option');
  kioskOption.value = 'default_kiosk';
  kioskOption.textContent = '🖨️ OS Default (Kiosk Mode)';
  select.appendChild(kioskOption);
  
  const statusIcon = document.createElement('span');
  statusIcon.id = 'twotimtwo-printer-status';
  statusIcon.style.fontSize = '14px';
  
  container.appendChild(label);
  container.appendChild(select);
  container.appendChild(statusIcon);
  document.body.appendChild(container);

  // Fetch printers from background script
  chrome.runtime.sendMessage({ action: 'getPrinters' }, (response) => {
    if (response && response.printers && response.printers.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Direct Printers';
      response.printers.forEach(printer => {
        const option = document.createElement('option');
        option.value = printer.id;
        option.textContent = printer.name;
        group.appendChild(option);
      });
      select.appendChild(group);
    } else if (response && response.error) {
      console.warn("Direct printing API not available:", response.error);
    }

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
  });

  select.addEventListener('change', (e) => {
    selectedPrinterId = e.target.value;
    autoPrintEnabled = selectedPrinterId !== 'disabled';
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
  if (!autoPrintEnabled || selectedPrinterId === 'disabled') {
    console.warn('Auto-print is disabled.');
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
    
    // Split Name into First and Last
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    let currentY = 0.6;
    if (!clubName && !lastName) {
      currentY = 1.1;
    } else if (!clubName || !lastName) {
      currentY = 0.8;
    }

    // First Name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(36);
    const firstNameWidth = doc.getStringUnitWidth(firstName) * doc.internal.getFontSize() / 72;
    const firstNameX = (pageWidth - firstNameWidth) / 2;
    doc.text(firstName, firstNameX, currentY);

    // Last Name
    if (lastName) {
      currentY += 0.5;
      const lastNameWidth = doc.getStringUnitWidth(lastName) * doc.internal.getFontSize() / 72;
      const lastNameX = (pageWidth - lastNameWidth) / 2;
      doc.text(lastName, lastNameX, currentY);
    }

    // Club Name
    if (clubName) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(24);
      
      // Text wrapping for club name
      const maxClubWidth = 3.8;
      const splitClubName = doc.splitTextToSize(clubName, maxClubWidth);
      
      currentY += 0.45;
      
      splitClubName.forEach(line => {
        const lineWidth = doc.getStringUnitWidth(line) * doc.internal.getFontSize() / 72;
        const lineX = (pageWidth - lineWidth) / 2;
        doc.text(line, lineX, currentY);
        currentY += 0.35;
      });
    }

    if (selectedPrinterId === 'default_kiosk') {
      // Tell the PDF to automatically open the print dialog when loaded
      doc.autoPrint();
      
      // Get blob URL instead of data URI to avoid some browser restrictions
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);

      // Create an invisible iframe to print the PDF
      let printIframe = document.getElementById('twotimtwo-print-iframe');
      if (!printIframe) {
        printIframe = document.createElement('iframe');
        printIframe.id = 'twotimtwo-print-iframe';
        // Do NOT use display: none, as it breaks printing in some browsers
        printIframe.style.position = 'fixed';
        printIframe.style.right = '0';
        printIframe.style.bottom = '0';
        printIframe.style.width = '0';
        printIframe.style.height = '0';
        printIframe.style.border = '0';
        document.body.appendChild(printIframe);
      }

      printIframe.src = blobUrl;
      
      printIframe.onload = () => {
        try {
          // The PDF's internal autoPrint() should trigger the dialog.
          // We also call contentWindow.print() as a fallback for browsers that allow it.
          try {
            printIframe.contentWindow.print();
          } catch (e) {
            // Ignore cross-origin errors if the PDF viewer blocks it, 
            // autoPrint() inside the PDF should still work.
          }
          
          if (statusIcon) statusIcon.textContent = '✅';
          setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, 3000);
          
          // Clean up blob URL after a delay
          setTimeout(() => { URL.revokeObjectURL(blobUrl); }, 10000);
        } catch (err) {
          if (statusIcon) statusIcon.textContent = '❌';
          console.error('Print execution failed:', err);
        }
      };
    } else {
      // Direct printing via chrome.printing API
      const dataUri = doc.output('datauristring');

      chrome.runtime.sendMessage({
        action: 'printJob',
        printerId: selectedPrinterId,
        title: `Label - ${name}`,
        pdfBase64: dataUri
      }, (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          if (statusIcon) statusIcon.textContent = '❌';
          console.error('Print execution failed:', chrome.runtime.lastError || response?.error);
        } else {
          if (statusIcon) statusIcon.textContent = '✅';
          setTimeout(() => { if (statusIcon) statusIcon.textContent = ''; }, 3000);
        }
      });
    }

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
