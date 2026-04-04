# CHANGELOG_ARCHIVE.md

Historical release notes for versions prior to 1.8.5. For current releases, see [changes.md](changes.md).

## [1.8.4] - 2026-03-29
- **Orientation Fix:** PDF page size changed from `[PAGE_H, PAGE_W]` with `layout: 'landscape'` to `[PAGE_W, PAGE_H]` (4"x2") without rotation, matching browser print dialog.

## [1.8.3] - 2026-03-29
- **Execution Policy Fix:** Bootstrap install.ps1 launches full installer with `-ExecutionPolicy Bypass`. Website one-liner wrapped in `powershell -ExecutionPolicy Bypass -Command`.

## [1.8.2] - 2026-03-29
- **Extension Install Guide:** Improved Step 3 with download button for chrome-extension.zip and path to local extension folder.
- **Distribution:** Added chrome-extension.zip to GitHub Pages for direct user download.

## [1.8.1] - 2026-03-29
- **One-Liner Installer:** Added bootstrap install.ps1 served via GitHub Pages: `irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex`
- **Website:** Featured one-liner as primary install method, install.bat as secondary.

## [1.7.3] - 2026-03-27
- **Auto-Update Launcher:** Added admin check, auto-elevation, version checking to launch-awana.bat.
- **Desktop Shortcut:** Installer always creates/updates "Awana Print" shortcut pointing correctly.

## [1.7.2] - 2026-03-27
- **Auto-Update:** Enhanced install.bat to check GitHub for new versions.
- **Versioning:** Introduced dedicated VERSION file for lightweight version checking.

## [1.7.1] - 2026-03-27
- **Extension UX:** Added popup menu showing real-time status of local print server.
- **Diagnostics:** "Refresh Status" button and installer download link when server offline.

## [1.7.0] - 2026-03-27
- **Browser Extension:** Introduced Manifest V3 chrome-extension/ replacing bookmarklet.
- **Zero-Click Auto-Print:** Extension injects automatically on check-in page, persists across reloads.
- **Reliability:** Refactored to background Service Worker bypassing CORS and Private Network Access restrictions.

## [1.6.9] - 2026-03-27
- **Allergies:** Added 'DYE' detection (looks for 'dye' or 'color' in notes).
- **Orientation:** Fixed sideways printing with PDF portrait (2x4) + landscape layout.
- **Design:** Preserved original icon aspect ratio; capped name font max 32pt.
- **UX:** Added version number to bookmarklet setup page.

## [1.6.8] - 2026-03-27
- **Installer Reliability:** Multi-pass directory clearing in install-and-run.ps1.
- **Process Management:** Force-kill running Node processes before install/update.
- **Cleanup:** Removed all stale file remnants during updates.

## [1.6.7] - 2026-03-27
- **Bookmarklet Distribution:** Served from print-server public directory for local accessibility.
- **Sync:** Updated internal bookmarklet to latest version.

## [1.6.6] - 2026-03-27
- **Fallback Logic:** Updated bookmarklet fallback printing to match server behavior for consistent UX when server unreachable.

## [1.6.5] - 2026-03-27
- **UX Improvement:** Refined install.bat to show only current step for cleaner UI.

## [1.6.4] - 2026-03-27
- **Label Design:** Fixed image aspect ratio, capped name font size, improved 4x2 layout readability.

## [1.6.3] - 2026-03-27
- **Label Design:** Removed redundant club name text when logo present.
- **Orientation:** Reverted to standard 4x2 portrait as stable standard for thermal printers.

## [1.6.0 - 1.6.2] - 2026-03-27
- **Reliability:** Successive installation directory clearing improvements.
- **Data Integrity:** Ensured HandbookGroup always printed, fixed club name conditional logic.

## [1.5.9] - 2026-03-27
- **Print Optimization:** Prioritized HandbookGroup display, finalized PDF orientation for thermal stability.

## [1.5.6 - 1.5.8] - 2026-03-27
- **Recursion Guard:** Fixed infinite loops in install.bat with explicit recursion guard/circuit breaker.
- **Policy:** Added "Zero-Loop Policy" to gemini.md.

## [1.5.1 - 1.5.5] - 2026-03-27
- **Admin Elevation:** Enhanced install.bat with robust admin checks and cleaner UI.
- **Versioning:** Automated versioning via scripts/bump-version.cjs.
- **Stability:** Reverted to stable 4x2 format, fixed PowerShell syntax.

## [1.4.9] - 2026-03-27
- **Label Orientation:** 2x4 portrait PDF with landscape layout for DYMO printers.
- **CSV Parser:** Fixed trailing spaces inside quotes preventing name matches; added diagnostic logging.
- **Redundancy:** Skip club name when logo displayed.

## [Pre-1.4.9 Highlights] - 2026-03-27
- New Launchers: install.bat and launch-awana.bat (no PowerShell knowledge required).
- Desktop Integration: Automatic "Awana Print" shortcuts.
- Authentication: CSV downloading via Edge browser for TwoTimTwo auth.
- CSV Robustness: Server-side parser handles quoted fields, embedded newlines, TwoTimTwo headers.
- Bookmarklet Safety: Moved to text/plain block, added syntax validation.
- Hosting: Bookmarklet on GitHub Pages for centralized updates.
