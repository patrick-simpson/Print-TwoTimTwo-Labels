chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPrinters') {
    if (chrome.printing && chrome.printing.getPrinters) {
      chrome.printing.getPrinters()
        .then(printers => {
          sendResponse({ printers: printers });
        })
        .catch(err => {
          console.error("Error getting printers:", err);
          sendResponse({ error: err.message });
        });
    } else {
      sendResponse({ error: "chrome.printing API not available" });
    }
    return true; // Keep channel open for async response
  }

  if (request.action === 'printJob') {
    const { printerId, title, pdfBase64 } = request;
    
    // Convert base64 to ArrayBuffer
    const binaryString = atob(pdfBase64.split(',')[1]);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const printJob = {
      printerId: printerId,
      title: title,
      ticket: {
        version: "1.0",
        print: {
          color: { type: "STANDARD_MONOCHROME" },
          duplex: { type: "NO_DUPLEX" },
          page_orientation: { type: "LANDSCAPE" },
          copies: { copies: 1 }
        }
      },
      contentType: "application/pdf",
      document: new Blob([bytes], { type: 'application/pdf' })
    };

    chrome.printing.submitJob(printJob)
      .then(response => {
        sendResponse({ status: response.status });
      })
      .catch(err => {
        console.error("Error submitting print job:", err);
        sendResponse({ error: err.message });
      });
    return true;
  }
});
