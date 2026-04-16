## [3.0.0] - 2026-04-16
"Go Big" release: 14 improvements to reduce clicks, add automation, and simplify setup. The #1 volunteer complaint was "too many buttons to click" — Quick Mode addresses this directly.

### Quick Mode (chrome-extension/content.js)
- **One-click check-in:** New "Quick Mode" toggle in the widget. When ON, clicking a child's name immediately prints their label and auto-dismisses the check-in modal (skips Bible/Friend options). Visual cue: panel header turns blue.
- **Auto-sibling check-in:** In Quick Mode, siblings are automatically checked in without showing the confirmation popup. Uses the existing `batchCheckInSiblings()` path.
- **Keyboard-driven check-in:** Arrow keys navigate search results, Enter checks in the selected child, Escape clears.

### Search-First UI (chrome-extension/content.js)
- **Roster search bar** at the top of the widget with type-ahead filtering. Matches against the cached roster (refreshed every 5s by `scanClubberList()`).
- Up to 8 results shown in a dropdown. Click or press Enter to check in. In Quick Mode, prints immediately; otherwise opens TwoTimTwo's native modal.
- DOM element references now cached in `ROSTER_CACHE` alongside club info, enabling click-to-check-in from search results.

### Automation (chrome-extension/content.js, print-server/server.js, scripts)
- **Auto-start on boot:** Install script now offers to add a shortcut to the Windows Startup folder (opt-in, idempotent).
- **Stale CSV warning:** Yellow banner appears in the widget when the server's `/health` endpoint reports `csvStale`, `csvMissing`, or `csvEmpty`. Click to refresh.
- **Auto-retry failed prints:** `doPrint()` now retries once after 3 seconds before queuing. Handles transient server hiccups.
- **Non-blocking update notice:** Widget now shows "Server update vX available — restart server to apply" when the server detects a newer version on GitHub.
- **Self-healing server:** `launch-awana.bat` now runs a restart loop (max 5 restarts per Zero-Loop Policy) instead of a fire-and-forget `start /min`. Server runs in the foreground of the "Keep this window open" window.

### Setup Simplification (chrome-extension/content.js, print-server/server.js, install-and-run.ps1)
- **Auto-detect printer:** If only one printer is connected, it's auto-selected in both the install script and the Chrome extension (via new `autoDetected` field in `/printers` response).
- **Chrome extension auto-config:** Printer selection is now persisted in `chrome.storage.local` (survives extension updates), with `localStorage` fallback.
- **Pre-warm printer:** Optional `config.json` setting (`prewarmPrinter: true`) sends a blank label to the printer 5 seconds after server start, eliminating cold-start delay. Off by default.

### Dashboard & UX (print-server/public/index.html, chrome-extension/content.js)
- **Traffic-light health dashboard:** Large green/yellow/red indicator at the top of the server dashboard (localhost:3456). Plain-English warning descriptions instead of technical codes. Auto-refreshes every 10 seconds (was 30s).
- **"Help — Not Working?" panic button:** Orange button at the bottom of the widget. Runs `/diagnostics`, parses the 4 test results, and shows plain-English guidance (printer off, server unreachable, roster missing, etc.).
- **Periodic health checks:** Extension now re-checks `/health` every 60 seconds to surface warnings promptly.

## [2.3.0] - 2026-04-15
Fix phantom prints caused by the roster-diff remote check-in detector, and replace the "Happy Birthday!" text banner with a 🍰 cake emoji in the bottom-right icon row.

### Why
Two live-event bugs:
- **Genevieve Bean** printed a label even though she was never checked in.
- **Eowyn Bambakakis** printed **twice** even though she was never checked in.

Both are the same root cause. `scanClubberList()` treats any `.clubber` row that was present in the previous scan but missing in the current one as a remote check-in. But `.clubber` rows can disappear for reasons that are **not** check-ins: search/filter input, club-tab filtering, scroll virtualization, or a page reload that restores `knownClubbers` from `sessionStorage` while the filter state is now different. When that happens, the diff mass-prints the "missing" kids. If the filter flaps twice (or a reload lands in a different filter state), the same phantom can print twice because `printedNames` dedup never records a real print target between the flaps.

### Phantom-print fix (chrome-extension/content.js)
- **Mass-disappearance guard:** if > 3 kids go missing in a single scan **and** the roster shrinks below 80% of its previous size, treat it as a UI reshuffle (filter / tab switch / reload) and re-baseline `knownClubbers` without printing anyone. Clears `pendingMissing` to prevent stale state.
- **Consecutive-miss confirmation:** a new `pendingMissing` `Map<nameKey, missCount>` requires a kid to be absent for **2 consecutive scans** (≥ 10 seconds at the 5-second `SCAN_INTERVAL_MS`) before the diff path fires. A single-scan flap (brief filter, virtualization glitch) clears pending state as soon as the kid reappears in `current`.
- The scan iterates the union of `knownClubbers` + `pendingMissing.keys()` so in-flight pending entries continue to be re-evaluated after `knownClubbers` rolls forward to the latest scan.
- The `#lastCheckin` observer path is unchanged — it remains the trusted primary detector for check-ins made on this browser.

### Birthday cake emoji (print-server/server.js)
- Removed the red 9pt bold "Happy Birthday!" text banner that used to sit under the handbook group (and its contribution to `blockH`, so the centered text block is now truly centered on non-birthday labels as well).
- Added a 🍰 glyph at **26pt** (~1.6× the 16pt allergy emoji size) to the bottom-right icon row. Rendered with the same emoji font stack as the allergy emojis (`"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`) so visual style matches.
- Ordering in the row: **cake leftmost, allergy emojis to its right**, with the rightmost allergy emoji anchored against the label's right padding. The icon row renders whenever `hasAllergy || isBirthday`.
- Per-glyph measurement via `ctx.measureText` so the differently-sized cake and allergy emojis share the same baseline and pack cleanly without overlap.

### Scope
- **Chrome extension + print server only.** The Electron HTML label renderer (`electron-app/src/server.js`) already did not render allergies or birthdays, so it is unchanged.

## [2.2.0] - 2026-04-09
Detect remote check-ins by diffing the `.clubber` roster across scans, so a kid checked in from another device (phone, second laptop) eventually gets their label printed here. Auto-refresh the page during peak time so the diff sees fresh data.

### Why
TwoTimTwo.com doesn't push real-time updates — the existing `#lastCheckin` observer only fires for check-ins made on *this* browser. If a volunteer uses a phone or a second laptop to check someone in, the label never prints because the laptop never sees the event. This was causing missed labels during the 5:40–6:00 PM rush when multiple volunteers are checking kids in simultaneously.

### Remote check-in detection (chrome-extension/content.js)
- New `scanClubberList()` captures the visible `.clubber` names on every scan; any name present on the previous scan but missing now is treated as a check-in (local *or* remote) and its label is printed via the normal `doPrint()` path.
- Club name + icon image are cached in `ROSTER_CACHE` while the kid is still visible, so they can still be printed after the kid disappears (where `lookupClub()` would fail).
- A session-scoped `printedNames` `Set` dedupes across the `#lastCheckin` path, the batch-sibling path, and the new diff path — a locally-checked-in kid is never reprinted. `onCheckin()` and `batchCheckInSiblings()` now call `markPrinted()` to feed this set.
- State (`printedNames`, `knownClubbers`, `ROSTER_CACHE`, baseline flag) is persisted to `sessionStorage` so detection survives the peak-window auto-refresh reload. A 4-hour idle timeout auto-clears the dedup state between Awana nights.
- First scan after load is a baseline-only populate — we never print the full roster on page load.
- Scans fire once on init, on every debounced `MutationObserver` callback, and on a 5-second safety interval.

### Peak-window auto-refresh (chrome-extension/content.js)
- New `autoRefresh()` reloads the page every 30 seconds when the local clock is between 17:40 and 18:00.
- Suppressed when the document is hidden, the sibling panel (`#awana-sibling-panel`) is open, the check-in modal (`#checkin-modal`) is open, or any `INPUT`/`TEXTAREA`/`SELECT` is focused — preserves in-progress user actions.

### Scope
- **Chrome extension only** — `electron-app/src/checkin-script.js` intentionally not updated in this release.

## [2.1.0] - 2026-04-09
Batch check-in reliability and quality improvements: duplicate prevention, faster throughput, club-specific fonts, age-appropriate sibling options, and correct multi-family separation.

### Improvements

**Duplicate label prevention (batch check-in):**
- `lastPrintTime` is now updated when batch fires a print, engaging the `PRINT_COOLDOWN` guard as a second layer alongside the existing `batchPrintedNames` Set.
- Name keys stored in `batchPrintedNames` are now `.trim()`ed for both write and read, eliminating any edge-case mismatch from trailing whitespace in `#lastCheckin`.

**Faster batch check-ins:**
- `BATCH_DELAY` reduced from 700 ms to 400 ms between siblings. The print fires before the check-in modal is submitted so the modal round-trip is the real bottleneck — 400 ms is sufficient for the next sibling selection without sacrificing reliability.

**Club-specific label fonts:**
- Each Awana club now uses a distinct font personality on the printed label:
  - Puggles / Cubbies → Comic Sans MS (fun, rounded, age-appropriate)
  - Sparks → Trebuchet MS (modern, energetic)
  - T&T → Arial Black (bold, strong)
  - Trek → Georgia (classic, mature)
  - Journey → Palatino Linotype (sophisticated)
  - Unknown / default → Helvetica / Arial (unchanged)
- `fitFontSize` updated to accept a `fontFamily` parameter so auto-sizing uses the same face as rendering.

**No Bible / Friend options for Puggles and Cubbies:**
- Sibling check-in panel now detects the sibling's club name. If the club is Puggles or Cubbies the Bible and Friend checkboxes are omitted — those programmes don't track those options.

**Correct Miller-family (same-last-name) separation:**
- `findSiblings` previously always fell back to DOM last-name matching when the server returned zero siblings, incorrectly grouping unrelated families who share a last name.
- Fix: if the server responds successfully (HTTP 200) with an empty siblings list the DOM fallback is suppressed. The fallback now only activates when the server is unreachable or times out.
- Families with the same last name are correctly separated as long as the synced CSV contains any distinguishing field: HouseholdID, PrimaryContact, Guardian, or Address.

## [2.0.5] - 2026-04-08
Critical fixes for sibling check-in — all siblings were timing out due to four bugs in button detection and options application.

### Bug Fixes (pollForCheckinButton)

**Bug 1 — offsetParent always null for position:fixed elements:**
- `#checkin-modal` uses CSS `position: fixed`, which means `offsetParent` is **always `null`** regardless of visibility. Strategy 1 was never finding the button because the visibility check failed immediately.
- **Fix:** Replace `ttModal.offsetParent !== null` with `window.getComputedStyle(ttModal).display !== 'none'`.

**Bug 2 — Wrong modalContainer from `.closest('[class*="modal"]')`:**
- `.closest()` walks up the DOM and stops at the first ancestor matching the selector. For `button#checkin`, it matched `.modal-footer` (an ancestor whose class name contains "modal"), not `#checkin-modal`. Result: 0 checkboxes found, Bible/Friend options never applied.
- **Fix:** Use `document.getElementById('checkin-modal')` directly instead of `.closest()`.

**Bug 3 — Double-submission from dual click handlers:**
- Code called both `checkinBtn.click()` and `checkinBtn.dispatchEvent(new MouseEvent('click'))`, firing the form submission handler twice and creating duplicate check-in records.
- **Fix:** Remove the `dispatchEvent` line. `.click()` alone is sufficient.

**Bug 4 — Broken timeout fallback calls immediately:**
- `setTimeout(batchCheckInSiblings(remaining), BATCH_DELAY)` executed `batchCheckInSiblings(remaining)` right away (passing `undefined` to `setTimeout`). The deferred batch never ran.
- **Fix:** Wrap in a function: `setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY)`.

**Bonus — Strategy 4 selector specificity:**
- Changed from `.modal button` to `#checkin-modal button` to avoid accidentally matching buttons in other Bootstrap modals on the page (like `#page-info-window`).

**Result:** Siblings now check in correctly with Bible/Friend options applied and no duplicate submissions.

## [2.0.4] - 2026-04-08
Removes bookmarklet, consolidates on Chrome extension only.

### Bookmarklet Removed
- **Decision:** Eliminated `bookmarklet.js` and related files (root + `print-server/public/`). All functionality now lives exclusively in the Chrome extension (`chrome-extension/content.js`).
- **Why:** Bookmarklet requires manual paste into browser console on every visit; Chrome extension persists and auto-injects. Extension is the single source of truth going forward.
- **Updated:** `vite.config.ts` no longer serves/emits bookmarklet files. Removed `package.json` bookmarklet scripts and deleted `scripts/validate-bookmarklet.cjs` and `scripts/build-bookmarklet-url.cjs`.

### Chrome Extension Updated (v2.0.3 fixes)
- Applied sibling check-in fixes to `chrome-extension/content.js`: Strategy 1 now targets `button#checkin` in visible `#checkin-modal`.
- Per-sibling Bible/Friend checkboxes in the sibling panel (no global options).
- Faster batch check-ins: `BATCH_DELAY` 700ms, prints fire in background before check-in.
- `batchPrintedNames` deduplication to prevent double-prints from `#lastCheckin` observer.

## [2.0.3] - 2026-04-08
Fixes sibling batch check-in, speeds up batch processing, and updates checkbox UI.

### Sibling Check-in Fix
- **Root cause fixed:** `pollForCheckinButton` Strategy 1 now directly targets `button#checkin` inside `#checkin-modal` when that modal is visible. TwoTimTwo's Bootstrap modal is pre-rendered in the DOM (always present but hidden), so the previous "new button" detection (Strategy 2) always skipped it since it was in the pre-click snapshot. Now we check modal visibility (`offsetParent !== null`) before querying the button.
- **Strategy 2 simplified:** No longer relies on pre-click button snapshot — now simply scans all visible buttons for check-in text, which correctly handles both React (dynamic) and Bootstrap (static) modal patterns.
- **Strategy 3 hardened:** Added visibility check (`offsetParent !== null`) before matching by text, preventing false positives from hidden modals.

### Faster Batch Check-ins
- **Print queued in background:** `batchCheckInSiblings` now fires `doPrint` for each sibling immediately before clicking their card, so label printing happens in the background while check-ins proceed.
- **Reduced inter-sibling delay:** `PRINT_COOLDOWN + 500` (2500ms) → `BATCH_DELAY` (700ms) between siblings. Entire batch of 3 siblings now takes ~2s instead of ~7.5s.
- **Deduplication guard:** Added `batchPrintedNames` Set. When `#lastCheckin div` updates after a batch check-in, `onCheckin` checks this set and skips printing to prevent double-prints. Names are cleared from the set after 8 seconds.

### Sibling Panel UI
- **Per-child checkboxes:** Each sibling row now shows Bible (default checked) and Friend (default unchecked) checkboxes on the right, instead of a global "Check-in Options" section at the bottom.
- **Removed global options:** Bible, Book, and Uniform global checkboxes replaced by per-sibling Bible and Friend options.
- **`applyCheckinOptions` updated:** Now maps Bible → `/bible/i` and Friend → `/friend|brought/i` (removed Book and Uniform patterns).

### Simulator CheckinModal
- **Checkboxes repositioned:** Bible and Friend checkboxes now appear to the right of the child's name/info in the modal header, not in a separate body section below.
- **Simplified to two options:** Removed "Kids Club meeting" checkbox. Only Bible (default checked) and Friend (default unchecked) remain.
- **Bookmarklet-compatible IDs:** Modal container now has `id="checkin-modal"` and Checkin button has `id="checkin"` so bookmarklet Strategy 1 works in the simulator.

## [2.0.2] - 2026-04-06
Critical fixes for batch check-in and print dialog consistency.

### Batch Check-in Button Detection
- **Multi-strategy search:** `pollForCheckinButton()` now uses three fallback strategies: explicit TwoTimTwo selectors (`.checkin-btn`, `[data-action="checkin"]`), pre-click button snapshot to find newly-appeared modal buttons (eliminates reliance on specific CSS classes), and modal-scoped selector fallback. Resolves batch check-in failures on different TwoTimTwo UI versions.
- **Pre-click snapshot:** `batchCheckInSiblings()` now snapshots all visible buttons before clicking a clubber card. The subsequent poll can identify the new check-in button even if TwoTimTwo wraps it in dynamically-generated containers.

### Print Dialog Consistency
- **Unified label rendering:** New `/label` POST endpoint generates the same PNG label that `/print` would send silently, without printing it. This ensures Print Dialog mode uses the identical canvas output (with allergies, birthday banner, handbook group, visitor badge, enrichment) instead of hand-coded HTML that was missing club name and enrichment data.
- **Fallback behavior:** If `/label` is unavailable (offline/error), fallback HTML now correctly includes club name and respects the offline label structure.

## [2.0.1] - 2026-04-06
Fixes race condition in batch sibling check-in, adds check-in attribute options to the sibling panel, and improves sibling detection using the synced CSV roster.

### Extension & Bookmarklet Fixes
- **Batch check-in race condition fixed:** `batchCheckInSiblings()` no longer uses a hardcoded 600 ms `setTimeout` before looking for the check-in button. It now polls every 100 ms for up to 3 seconds, checking button visibility (`offsetParent !== null`) before clicking — eliminating failures on slower connections or React/Vue SPA pages where the modal renders asynchronously.
- **Dual-click for framework compatibility:** Once the check-in button is found, both `.click()` and a bubbling `MouseEvent('click')` are dispatched so React/Vue synthetic event handlers are reliably triggered.
- **Check-in Options in sibling panel:** The sibling sidebar now includes a "Check-in Options" section with Bible, Book, and Uniform checkboxes (unchecked by default). Checked options are applied to the modal's corresponding checkboxes (with `change` + `click` events) before the check-in form is submitted.
- **CSV-based sibling detection:** `findSiblings()` is now async and first queries the new server `/siblings` endpoint before falling back to the existing DOM last-name match. This finds siblings in blended families or families where children have different last names, as long as the roster CSV includes a common family identifier (Household ID, Primary Contact, Guardian, or Address).

### Server Changes
- **`GET /siblings?name=First+Last`:** New endpoint returns an array of sibling names for the given child, derived from the synced `clubbers.csv`. Groups families by the best available identifier (HouseholdID → PrimaryContact → Guardian → Address → LastName fallback). Returns `{ siblings: [] }` if the child is not in the CSV or has no detected family members.
- **Extended CSV column support:** `HEADER_MAP` now recognises family/household identifier columns exported by TwoTimTwo and similar systems: `Primary Contact`, `Guardian`, `Parents`, `Household ID`, `Family ID`, `Address`, and common variants.

## [2.0.0] - 2026-04-06
Major release adding dashboard, sibling batch check-in, offline queue, and operational tooling.

### Server Features
- **Dashboard Web UI:** Open `localhost:3456` for real-time server status, print history, label preview, settings, and diagnostics — all in one page.
- **Label Preview Endpoint:** `GET /preview?name=Alice+Smith` returns a rendered PNG without printing. Used by dashboard and useful for testing.
- **Print History:** Every print is logged to `print-history.json`. View today's prints on the dashboard with one-click reprint buttons.
- **Reprint Endpoint:** `POST /reprint` reprints any label from history without re-checking-in the child.
- **Enhanced Health Checks:** `/health` now returns warnings (printer not found, CSV missing/empty/stale) surfaced on the dashboard and in the extension widget.
- **Auto-Update Check:** Server checks GitHub for newer versions on startup and every 6 hours. Update notice shown on dashboard and extension.
- **Config via Web UI:** Change printer and check-in URL from the dashboard Settings tab (saves to config.json).
- **Self-Diagnostics:** One-click diagnostic tool checks server, printer, CSV, and label rendering with pass/fail indicators.
- **Visitor Badge:** Walk-in guests flagged as visitors get a "VISITOR" badge in the top-right corner of their label.

### Extension & Bookmarklet Features
- **Sibling Batch Check-in:** When a child checks in, the extension detects siblings (same last name) and shows a popup with checkboxes to check them all in with one click.
- **Audio Feedback:** Success chime on print, error tone on failure. Mute toggle in the widget.
- **Offline Print Queue:** When the server is unreachable, labels queue in localStorage (up to 50) and auto-flush when connectivity restores.
- **Walk-in Guest Enhancement:** Club selector dropdown and "Visitor" checkbox added to the walk-in guest section. Visitors get a badge on their label.

### Simulator
- **Sibling Test Data:** Added Simpson and Johnson sibling pairs to mock data for testing the batch check-in feature.
- **v2.0 Feature Tiles:** PrintServerInfo component updated with new feature descriptions.

## [1.10.9] - 2026-04-04
- **Widget Default Minimized:** Widget now starts collapsed as a small green pill instead of an expanded panel. Prevents the widget from obstructing page content on first load. Click the pill to expand; click × to collapse again. State persists across page loads.

## [1.10.8] - 2026-04-04
- **Widget Position Fix:** Reverted inline DOM injection (placed widget in wrong sidebar). Widget now uses `position: fixed` at `top: 55px, right: 12px` — floating over the right column below the site nav bars.

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
