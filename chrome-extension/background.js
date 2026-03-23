chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPrinters') {
    if (chrome.printing && chrome.printing.getPrinters) {
      chrome.printing.getPrinters().then(printers => {
        sendResponse({ printers });
      }).catch(error => {
        sendResponse({ error: error.message });
      });
    } else {
      sendResponse({ error: 'chrome.printing API not available. Make sure you are on a supported platform.' });
    }
    return true;
  }

  if (request.action === 'printJob') {
    const { printerId, title, documentBase64 } = request;
    
    fetch(documentBase64)
      .then(res => res.blob())
      .then(blob => {
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
          contentType: 'application/pdf',
          document: blob
        };
        return chrome.printing.submitJob(printJob);
      })
      .then(response => {
        sendResponse({ status: response.status });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true;
  }
});
