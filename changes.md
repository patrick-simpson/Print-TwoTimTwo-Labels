## [1.8.6] - 2026-03-29
- **Installer Fix:** Removed `$ProgressPreference` from bootstrap `install.ps1` — it caused errors when run via `irm | iex` because double-quoted `-Command` strings interpolate `$` variables. Changed website one-liner to use single quotes.

## [1.8.5] - 2026-03-29
- **Widget Minimize:** Added a minimize/restore button to the on-page print widget so it can be collapsed to a compact header bar.
- **Widget Version Display:** The widget now shows the current extension version (e.g. "v1.8.5") in its header.
- **Extension Auto-Update Notification:** The widget checks the print server's `/health` endpoint for version mismatches and displays an "Update available" notice when the server is running a newer version.
- **Server Health Endpoint:** `/health` now returns `version` alongside `status` and `printer`.
- **Version Sync:** `bump-version.cjs` now also updates `chrome-extension/manifest.json`, `content.js`, and `popup.html` automatically.

## [1.8.4] - 2026-03-29
- **Orientation Fix:** Fixed sideways label printing in autoprint mode. PDF page size was `[PAGE_H, PAGE_W]` with `layout: 'landscape'` — changed to `[PAGE_W, PAGE_H]` (4"x2") with no rotation, matching the browser print dialog behavior.

## [1.8.3] - 2026-03-29
- **Execution Policy Fix:** Updated bootstrap `install.ps1` to launch the full installer with `-ExecutionPolicy Bypass`, preventing "scripts disabled" errors on restricted Windows systems.
- **Website:** Updated the one-liner command to include `powershell -ExecutionPolicy Bypass -Command` wrapper so it works out of the box on any system.

## [1.8.2] - 2026-03-29
- **Extension Install Guide:** Improved Step 3 on the website with a download button for `chrome-extension.zip` and clear path to the local extension folder for users who already ran the installer.
- **Extension Distribution:** Added `chrome-extension.zip` to GitHub Pages so users can download it directly from the website.

## [1.8.1] - 2026-03-29
- **One-Liner Installer:** Added a bootstrap `install.ps1` script served via GitHub Pages, enabling installation with a single PowerShell command: `irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex`
- **Website:** Updated the setup page to feature the one-liner command as the primary install method, with `install.bat` as a secondary option.

## [1.7.3] - 2026-03-27
- **Auto-Update Launcher:** Added administrative check, auto-elevation, and version checking directly to \launch-awana.bat\.
- **Desktop Shortcut:** Updated installer to always create/update the "Awana Print" desktop shortcut, ensuring it points correctly to the launcher in \AppData\.

# Project Changes & Release Notes

## [1.7.2] - 2026-03-27
- **Auto-Update:** Enhanced install.bat to automatically check for new versions of the setup script on GitHub.
- **Versioning:** Introduced a dedicated VERSION file in the project root for lightweight version checking.


## [1.7.1] - 2026-03-27
- **Extension UX:** Added a popup menu (visible when clicking the extension icon) that shows the real-time status of the local KVBC Print Server.
- **Diagnostics:** Added a "Refresh Status" button and a direct link to download the installer if the server is offline.

## [1.7.0] - 2026-03-27
- **Browser Extension:** Introduced a full Manifest V3 browser extension (chrome-extension/) to replace the bookmarklet.
- **Zero-Click Auto-Printing:** The extension injects automatically on the check-in page and persists across page reloads.
- **Reliability:** Refactored the network request logic into a background Service Worker (ackground.js) to completely bypass web page CORS and Private Network Access restrictions.

## [1.6.9] - 2026-03-27
- **Allergies:** Added 'DYE' (detects 'dye' or 'color' in notes) to the detected allergy list for labels.
- **Orientation:** Fixed sideways printing in auto-mode by setting PDF size to portrait (2x4) with landscape layout.
- **Design:** Resolved icon "crunching" by preserving the original aspect ratio when fitting icons to the label.
- **Typography:** Capped the maximum font size for names at 32pt to prevent overflowing the label.
- **UX:** Added version number display to the bookmarklet setup page for verification.

## [1.6.8] - 2026-03-27
- **Installer Reliability:** Implemented aggressive multi-pass directory clearing in \install-and-run.ps1\.
- **Process Management:** Added a force-kill for any running Node processes before installation/update to release file locks.
- **Cleanup:** Ensured all remnants are removed during updates to prevent stale file issues.

## [1.6.7] - 2026-03-27
- **Bookmarklet Distribution:** Now serving the bookmarklet from the \print-server\ public directory for better local accessibility.
- **Sync:** Updated internal bookmarklet logic to the latest version.

## [1.6.6] - 2026-03-27
- **Fallback Logic:** Updated bookmarklet fallback printing logic to match server behavior, ensuring consistent UX when the server is unreachable.

## [1.6.5] - 2026-03-27
- **UX Improvement:** Refined \install.bat\ to show only the current step, resulting in a cleaner UI during installation.

## [1.6.4] - 2026-03-27
- **Label Design:** Fixed image aspect ratio, capped maximum name font size, and improved overall layout for better readability on 4x2 labels.

## [1.6.3] - 2026-03-27
- **Label Design:** Removed redundant club name text when the logo is present.
- **Orientation:** Reverted to standard 4x2 portrait orientation as the verified stable standard for thermal printers.

## [1.6.0 - 1.6.2] - 2026-03-27
- **Reliability:** Successive improvements to installation directory clearing.
- **Data Integrity:** Ensured HandbookGroup is always printed and fixed club name conditional logic.

## [1.5.9] - 2026-03-27
- **Print Optimization:** Prioritized HandbookGroup display and finalized PDF orientation for thermal stability.

## [1.5.6 - 1.5.8] - 2026-03-27
- **Recursion Guard:** Fixed infinite loops in \install.bat\ elevation checks by implementing an explicit recursion guard/circuit breaker.
- **Policy:** Added "Zero-Loop Policy" to \gemini.md\ to prevent future self-relaunching script bugs.

## [1.5.1 - 1.5.5] - 2026-03-27
- **Admin Elevation:** Enhanced \install.bat\ with robust admin checks and a cleaner UI.
- **Versioning:** Implemented automated versioning across all components via \scripts/bump-version.cjs\.
- **Stability:** Reverted orientation to the stable 4x2 format and fixed PowerShell syntax issues.

## [1.4.9] - 2026-03-27
- **Label Orientation:** Configured pdfkit to use 2x4 portrait paper with landscape layout, ensuring DYMO printers receive correctly oriented pages.
- **CSV Parser:** Fixed a bug where trailing spaces inside quotes prevented name matches; added diagnostic logging for parsed names.
- **Redundancy:** Conditional logic added to skip club name text when the logo icon is displayed.

## [Pre-1.4.9 Highlights] - 2026-03-27
- **New Launchers:** Introduced \install.bat\ and \launch-awana.bat\ for a no-PowerShell-knowledge required experience.
- **Desktop Integration:** Automatic creation of "Awana Print" desktop shortcuts.
- **Authentication:** Shifted CSV downloading to use the Edge browser session to handle TwoTimTwo authentication.
- **CSV Robustness:** Rewrote the server-side CSV parser to handle real TwoTimTwo exports (quoted fields, embedded newlines, and specific headers).
- **Bookmarklet Safety:** Moved bookmarklet source into a \	ext/plain\ block to avoid template literal escaping issues and added a prebuild syntax validation script.
- **Hosting:** Moved bookmarklet hosting to GitHub Pages for centralized updates.


