## [1.10.7] - 2026-04-04
- **Widget Position Fix:** Widget now inserts to the RIGHT of `#lastCheckin` (was incorrectly inserting to the left).

## [1.10.6] - 2026-04-04
- **Embedded Widget:** Widget now injects inline beside the `#lastCheckin` element instead of floating as a fixed overlay, using the page's existing whitespace.
- **Green Color Scheme:** Replaced purple with the site's green (`#4caf50`) on the pill, panel header, and Walk-in Print button.
- **Softer Panel Style:** Lighter border (`#c8e6c9`), reduced shadow, and `8px` border radius to blend with the site's flat design.
- **Fallback:** If `#lastCheckin` is not found, widget still appears as a fixed top-right overlay.

## [1.10.5] - 2026-04-04
- **Label Border Removed:** Removed the black rounded-rect outline surrounding the label.
- **Larger Club Logo:** Increased club logo max size from 56pt to 76pt (aspect ratio preserved via letterboxing).

## [1.10.4] - 2026-04-04
- **Allergy Icons Redesign:** Removed red bottom bar. Allergy icons now appear in the lower-right corner of the label. Icons are larger (16pt vs 13pt).
- **Removed Shellfish:** Dropped SHELLFISH (🦐) from allergy detection and icon map.
- **DYE Icon:** Changed from ⚠ to 💧 (water drop) for food dye/artificial coloring sensitivity.

## [1.10.3] - 2026-04-04
- **Aspect Ratio Fix:** Club logo images were squished to 64×64 square before being sent to the print server. Fixed `getClubImageDataUrl()` in both content.js and bookmarklet.js to letterbox images preserving natural aspect ratio.
- **HandbookGroup Filter:** Children in handbook group "All" (case-insensitive) now print no group text — the field is treated as blank.
- **Walk-in Guest Print:** Added free-text input to extension widget. Type any name and press Print/Enter to print a basic label for walk-in guests not in the TwoTimTwo roster.

## [1.10.2] - 2026-03-30
- **Orientation Fix:** Replaced landscape flag with explicit `PaperSize("Label", 400, 200)` (4"×2" in hundredths of inches). D450 label stock was being rotated 90° extra, producing portrait output.
- **Emoji Allergy Icons:** Replaced text strip ("NUTS • DAIRY") with emojis (🥜🥛🌾🥚🦐⚠) using Segoe UI Emoji font, increased from 14pt to 20pt.

## [1.10.1] - 2026-03-30
- **Silent Print Fix:** Fixed blank page submissions. Root cause: `$img` in outer scope was inaccessible in `add_PrintPage` event handler (known .NET closure issue). Now store image path as `PrintDocument` property, load fresh inside handler via `$sender.LabelImagePath`. Script written to temp file with `-File` flag to avoid multiline quoting issues. Added `$ErrorActionPreference = 'Stop'` for real error surfacing.

## [1.10.0] - 2026-03-30
- **Printer Selection:** Added dropdown to extension widget. Fetches `GET /printers`, stores selection in localStorage, sends with every print request. "Server Default" falls back to `PRINTER_NAME` env var.
- **New `/printers` endpoint:** Returns installed printers and server default.
- **Per-request override:** `/print` endpoint accepts optional `printerName` in POST body.

## [1.9.3] - 2026-03-30
- **Extension Autoprint Fix:** Content script routed through background service worker, which can terminate mid-flight. Now fetches print server directly (matching bookmarklet).

## [1.9.2] - 2026-03-29
- **Orientation Fix:** Set `Landscape = $true` in PowerShell for 4x2 aspect ratio.
- **Electron Sync:** Updated Electron print server to PNG engine for consistency.

## [1.9.1] - 2026-03-29
- **PNG Engine:** Replaced PDF (pdfkit + pdf-to-printer) with PNG (canvas + PowerShell System.Drawing). 1200x600 pixels at 300 DPI eliminates driver rotation issues. Tested on Labelife D450 BT.
- **Widget UX:** Minimize button → arrow tab on left edge. Full collapse when minimized.
- **Dependency change:** pdfkit/pdf-to-printer → canvas.

## [1.9.0] - 2026-03-29
- **Orientation (real fix):** PDF page 4"x2" portrait, passing `orientation: 'portrait'` and `scale: 'noscale'` to pdf-to-printer to prevent driver rotation.

## [1.8.9] - 2026-03-29
- **Version Check:** Secondary check compares project `VERSION` against script version. Catches stale project zips (including chrome-extension/) even when `.script-version` matches.

## [1.8.8] - 2026-03-29
- **Install Location Migration:** Moved from `%APPDATA%\Awana-Print` to `C:\output`. Detects old location, migrates config.json + clubbers.csv, removes old folder.
- **ProgressPreference Fix:** Single global assignment at top of install-and-run.ps1, removed individual assignments that error in some contexts.

## [1.8.7] - 2026-03-29
- **Launcher Path Fix:** launch-awana.bat now derives install dir from own location (`%~dp0`) instead of hardcoding. Desktop shortcut works anywhere.
- **Update Fix:** Launcher downloads install-and-run.ps1 directly, passes `-InstallPath` matching current location.

## [1.8.6] - 2026-03-29
- **Installer Fix:** Removed `$ProgressPreference` from bootstrap install.ps1 (double-quoted `-Command` interpolates `$` variables). Changed one-liner to single quotes.

## [1.8.5] - 2026-03-29
- **Widget Minimize:** Added collapse/expand button to print widget.
- **Widget Version Display:** Shows current extension version (e.g. "v1.8.5").
- **Extension Auto-Update:** Checks `/health` endpoint for version mismatches, displays "Update available" notice.
- **Server Health Endpoint:** `/health` now returns `version` alongside `status` and `printer`.
- **Version Sync:** `bump-version.cjs` updates chrome-extension files automatically.

---

**Older releases:** See [CHANGELOG_ARCHIVE.md](CHANGELOG_ARCHIVE.md)
