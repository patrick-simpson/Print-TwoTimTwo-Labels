chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Background script is currently not needed for the default OS printing
  // or print dialog options, as they are handled entirely within the content script.
  // This file is kept for future expansion if needed.
});
