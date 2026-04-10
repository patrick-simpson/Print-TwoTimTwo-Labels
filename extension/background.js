chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PRINT_LABEL') {
    fetch('http://localhost:3456/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: message.payload.name,
        clubName: message.payload.clubName,
        clubImageData: message.payload.clubImageData
      }),
      // We don't use AbortSignal.timeout directly because it might not be supported in older Chrome backgrounds,
      // instead we rely on standard fetch or use a manual timeout.
    })
    .then(response => {
      sendResponse({ success: response.ok });
    })
    .catch(err => {
      console.error('[Awana Background] Print server unreachable:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Required to keep the message channel open for async fetch
  }
});
