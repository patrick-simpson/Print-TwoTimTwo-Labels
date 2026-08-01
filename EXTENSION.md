# KVBC Kids Check-in Extension

This browser extension provides a **\"zero-click\"** auto-printing experience for the KVBC Kids Check-in system. It automatically runs in the background whenever you are on the check-in page and communicates with the local KVBC Print Server.

## Why use the extension?
- **Zero Clicks:** Automatically starts watching for check-ins as soon as the page loads.
- **Survives Reloads:** If the page is refreshed, the extension automatically re-injects itself.
- **Reliable:** Bypasses browser security restrictions by sending print jobs through a background service worker.

## Installation Instructions (Developer Mode)

**Load the folder the app manages, not a copy from Downloads.** The Windows app
keeps one folder up to date on every launch, so loading *that* one is what lets
future app updates refresh the extension for you. A copy unzipped somewhere else
never updates and will quietly drift behind the print server.

1. Find the managed folder. Either:
   - **Tray icon → Open Chrome extension folder**, or
   - the dashboard at `http://localhost:3456` → **Diagnostics** → *Chrome
     extension folder* → **Copy folder path**.

   It is `%APPDATA%\Awana Label Printer\chrome-extension`.
2. Open your browser and go to the extensions page:
   - **Edge:** `edge://extensions`
   - **Chrome:** `chrome://extensions`
3. Turn on **Developer Mode**.
4. Click **Load unpacked** and pick the folder from step 1.
5. Ensure the local KVBC Print Server is running.

The KVBC widget will now automatically appear on the check-in page!

> Running from a source checkout instead of the installer? Load
> `chrome-extension/` from the repo. There is no managed folder in that case,
> and the dashboard hides the Diagnostics block rather than pointing you at a
> path that does not exist.

## Keeping the extension up to date

Chrome does **not** auto-update extensions loaded in Developer Mode, and Chrome
only honours a self-hosted `update_url` for Web Store or enterprise-policy
installs. So there is no fully silent update available here — but the manual
work is down to one step:

1. The app updates itself (electron-updater), as before.
2. On its next launch it rewrites the managed folder with the extension files
   from the new build. This happens whether or not Chrome is open.
3. Chrome re-reads an unpacked extension when it restarts. The widget shows
   *"Extension vX.Y.Z is installed — restart Chrome to load it"* until you do.

So: **restart Chrome.** No download, no unzip, no re-adding the extension. If you
would rather not close your tabs, `chrome://extensions` → **Reload** on the
KVBC entry does the same thing immediately.

The version banner compares the extension's version against the print server's,
so a mismatch is always visible on the check-in page rather than something you
have to remember to check.

## Technical Transparency & Security
- **Local Communication:** This extension communicates only with \http://localhost:3456\. This is a local network address that refers to your own computer. 
- **Purpose:** The communication is used to send label data (Name, Club, Icon) to the **KVBC Print Server** software that you have installed locally.
- **No External Traffic:** No data ever leaves your local network or is sent to any cloud-based services.
