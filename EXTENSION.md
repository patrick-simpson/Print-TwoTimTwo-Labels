# KVBC Kids Check-in Extension

This browser extension provides a **\"zero-click\"** auto-printing experience for the KVBC Kids Check-in system. It automatically runs in the background whenever you are on the check-in page and communicates with the local KVBC Print Server.

## Why use the extension?
- **Zero Clicks:** Automatically starts watching for check-ins as soon as the page loads.
- **Survives Reloads:** If the page is refreshed, the extension automatically re-injects itself.
- **Reliable:** Bypasses browser security restrictions by sending print jobs through a background service worker.

## Installation Instructions (Developer Mode)

1. Open your browser and go to the extensions page:
   - **Edge:** \edge://extensions\
   - **Chrome:** \chrome://extensions\
2. Turn on **Developer Mode**.
3. Click the **Load unpacked** button.
4. Select the \chrome-extension\ folder in this project directory.
5. Ensure the local KVBC Print Server is running.

The KVBC widget will now automatically appear on the check-in page!

## Technical Transparency & Security
- **Local Communication:** This extension communicates only with \http://localhost:3456\. This is a local network address that refers to your own computer. 
- **Purpose:** The communication is used to send label data (Name, Club, Icon) to the **KVBC Print Server** software that you have installed locally.
- **No External Traffic:** No data ever leaves your local network or is sent to any cloud-based services.
