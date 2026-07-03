## [3.9.0] - 2026-06-15
Catalog-true label design (based on the official Awana Clubs 2026–27 catalog) + async serialized printing and roster-matching/reliability upgrades.

### Why
The label design predated the current Awana brand. Reviewing the 2026–27 catalog: chunky rounded type, four-point sparkle doodles, rounded "AGES/GRADES" tab chips, and strong club motifs — apples ARE the Cubbies award system, T&T's logo is a hexagon shield, Sparks is a flight theme with pilot-wing badges. Separately, the print path still used `execSync`, which froze the entire Node event loop for up to ~31 s per print (2 × 15 s timeout + retry wait) — during a busy check-in rush the server appeared dead to every other request.

### Label design (print-server/server.js), all thermal-safe solid ink
- **Club emblem badges** (monogram fallback) now use catalog-true shapes: Cubbies = apple (body + stem + leaf) with "C", T&T = hexagon shield with "T&T", Sparks = disc with pilot wings, others = disc. Each badge gets a small ✦ sparkle accent — the catalog's signature doodle.
- **Stripe motifs updated:** Cubbies solid bar → stacked apples; T&T rungs → chained hexagon outlines. Dots/zigzag/hatch/chevrons unchanged.
- **Grade-band tab chip** (bottom-left): the catalog's rounded "AGES 2–3 / GRADES K–2" chip, per club (Puggles 2–3, Cubbies 3–5, Sparks K–2, T&T 3–6, Trek 6–8, Journey 9–12) — lets a door volunteer route a visiting kid to the right room without asking. Skipped on step-up labels.
- **Step-up celebration:** amber ✦ sparkles flank the "Stepping up to X" callout.
- **Layout fix:** when the bottom-right row (allergy chips/cake/shares) prints, the centered text block shifts up 7 pt so a long handbook-group line can never collide with the chips (it previously could).

### Reliability (print-server/server.js)
- **Async serialized print queue:** `printImage` now runs PowerShell via async `execFile` (argument vector — no shell quoting) with jobs serialized one-at-a-time. The event loop is never blocked, concurrent check-ins can't race the Windows spooler with parallel PowerShell processes, and per-request error semantics are unchanged (callers `await` their own job). Verified: two simultaneous /print requests fail independently with clean per-request errors when the spooler is unavailable, while /health stays responsive.
- **Accent/punctuation-insensitive roster matching:** "José Muñoz" at check-in now matches "Jose Munoz" in the CSV (NFD normalize + strip non-alphanumerics), as do O'Neil↔ONeil and Mary-Jane↔Mary Jane. Exact match is tried first, and the fallback is still full-name equality — deterministic, never fuzzy, because a wrong match would print the wrong kid's allergies.
- **Configurable step-up grades:** `config.json` `{"stepUpGrades": {"t&t": 6}}` overrides the graduating grade per club. Shipped defaults unchanged — note the 2026–27 catalog lists T&T as grades 3–6 (grade-6 graduation); churches running T&T through grade 5 need no change, churches following the new structure can opt in without a code edit.
- **Roster backup:** /update-csv keeps `clubbers.csv.bak` (previous good roster) before each sync — a bad export can be undone by renaming one file.
- **Print observability:** /health now reports `printQueue` depth, `lastPrintAt`, and `lastPrintError`.

### Verification
- `node --check` passes; full render suite for all six clubs + visitor + step-up + allergies + shares reviewed visually at 300 DPI; malformed/edge payloads unchanged from 3.7/3.8 behavior; concurrent-print and health-during-print behavior tested live.

## [3.8.0] - 2026-06-15
Resilience + UX overhaul for non-technical volunteers, and a new zero-install browser print path. Also fixes a shipped-broken bookmarklet (404) and a stale, inaccurate README.

### Why
The tool is operated by volunteers mid-event. Feedback was emoji-in-a-pill, several DOM/parse/print paths could throw unguarded, there was no generic "wait for the page to be ready," and the only print path required a Windows helper + thermal printer. The referenced bookmarklet files never existed, so the bookmarklet page and `/bookmarklet.js` `/bookmarklet.min.js` routes returned 404. The README still described a puppeteer/pdf-to-printer/jsPDF pipeline that the project no longer uses.

### 1. Robustness & defensive programming (chrome-extension/content.js)
- Added `waitForElement(selector, {root, timeout, visible})` — MutationObserver + polling safety-net + hard timeout, so slow/partial page loads never hang or throw.
- Added `isVisible()` that correctly handles `position:fixed` (the old `offsetParent` checks misclassified fixed elements).
- Added `safeTry(label, fn, fallback)` — wraps risky work and logs full diagnostic context (label + message + error) instead of failing silently.
- Added `sanitizeField(value, maxLen)` and `escapeHtml()`; `doPrint()` now validates/normalises name + club, drops oversized (>1.5 MB) club images, and ignores empty names instead of producing a broken label or bloated payload.

### 2. User experience & visual feedback (chrome-extension/content.js)
- New `AwanaUI` overlay rendered in a **Shadow DOM** so styles are fully scoped (no bleed in or out): a loading **spinner**, a self-dismissing **success toast**, and a friendly **error banner** with a plain-English fix and a dismiss button.
- Routed the existing `setStatus()` emoji codes (⏳ ✅ ❌ 📦 🚫) through the overlay, so every existing call site is upgraded at once; the legacy `#awana-status` text node is kept for compatibility. The overlay can never throw into the print path.

### 3. Print layout & CSS precision
- **Both paths, as chosen:**
  - **New zero-install browser printer** `public/print-labels.html` (also served at `http://localhost:3456/print-labels.html`): pure-CSS 4×2" labels via the browser print dialog — works on Chrome/Firefox/Safari and any printer. Uses **CSS Grid** (fixed icon track + `1fr` text, `min-width:0`) chosen over Flexbox to prevent long-name width drift and guarantee zero margin drift across multi-page runs; `@page { size:4in 2in; margin:0 }`, `page-break-after:always`, `print-color-adjust:exact`, and `@media print` rules that strip all on-screen UI so only labels print. Robust CSV/line parsing, auto font-shrink for long names, clean handling of missing fields and empty datasets, optional `?data=` hand-off.
  - **Hardened the existing PNG fallback** (`printLabelDataUrl`): added `print-color-adjust:exact`, exact sizing, and rebuilt the offline HTML label on CSS Grid with sanitised + HTML-escaped fields and long-name clamping.

### 4. Documentation & delivery
- **Fixed the broken bookmarklet:** created `bookmarklet.min.js` (a robust loader with a friendly "server not reachable" fallback) in `public/` and `print-server/public/`. `/bookmarklet.js` now falls back to serving the extension content script, so the bookmarklet runs the exact same tested logic (single source of truth).
- **Rewrote README.md** for non-technical admins: three clearly separated options (automatic / zero-install browser / bookmarklet), step-by-step setup, a copy-pasteable bookmarklet block, accurate architecture (canvas PNG + PowerShell, not puppeteer/jsPDF), and correct dependencies.

### Verification
- `node --check` on `content.js`, `server.js`, the embedded `print-labels.html` script, and the bookmarklet (prefix stripped) — all pass.
- Simulated varied payloads against the live server: very long first+last names (truncate, no clipping — verified visually), missing last name, missing club, special characters `& < > '`, and empty name (→ clean 400). Malformed JSON → clean `400 {"error":...}`.
- New routes return 200; `/bookmarklet.js` correctly falls back to the content script. `npm run build` copies both new artifacts into `dist/`.

## [3.7.2] - 2026-06-11
Club logos guaranteed: monogram badge fallback when the client doesn't supply a logo image.

### Why
The icon panel only rendered when the browser extension successfully scraped the club logo `<img>` from the check-in page and POSTed it as `clubImageData`. If the page layout changed, the image failed to load, or a caller hit the API without an image, the label silently lost its entire icon zone. Club identity on the label shouldn't depend on client-side scraping succeeding.

### Fix (print-server/server.js)
- New `CLUB_MONOGRAM` map (P, C, S, T&T, TR, J — TR so Trek can't be confused with T&T).
- The icon panel now always renders for any recognized club: the real logo when `clubImageData` is supplied (unchanged), otherwise a solid-ink monogram badge drawn in the club's own font — crisp on 1-bit thermal output, where the old "decode failed" gray placeholder circle would just dither away.
- A failed logo decode also falls back to the monogram badge instead of the placeholder circle.
- The club-name text line is now hidden only when a *real logo* is shown (a logo self-identifies the club); monogram labels keep the printed club name since initials alone are ambiguous to new volunteers.

### Behavior change
- **Before:** no `clubImageData` → no icon panel at all; failed decode → empty gray circle.
- **After:** recognized club always gets an icon — real logo preferred, monogram badge otherwise. Unknown club names without an image keep the previous full-width text layout.

## [3.7.1] - 2026-06-11
Rework the 3.7.0 per-club design for monochrome thermal printers; harden allergy visibility; fix birthday-cake week bug.

### Why
The 3.7.0 design used official Awana club hues, but the target printer is a 1-bit thermal printer: mid-tone colors dither into mushy, indistinguishable grays. The colored stripe lost its "which club" value, the colored club name and visitor pill *lost* contrast, and the existing tiny allergy emojis were already marginal in grayscale — unacceptable for safety-critical information.

### Per-club design, thermal-first (print-server/server.js)
- `CLUB_THEMES` color palettes replaced with `CLUB_PATTERNS`: each club's identity stripe is now a distinct solid-ink pattern that stays crisp at 300 dpi in pure black and white — **Puggles** dots · **Cubbies** solid bar · **Sparks** zigzag · **T&T** ladder rungs · **Trek** diagonal hatch · **Journey** chevrons. Unknown clubs print no stripe.
- All label text back to full-contrast near-black (club name bold italic black, group #333); separator is a solid 1 pt rule (gradients dither to noise); visitor pill back to black/white; icon panel back to neutral light gray. Step-up labels keep black/amber, stripe pattern drawn in white ink.
- **Allergy chips:** allergens now print as solid-black rounded chips with bold white text (e.g. [NUTS] [DAIRY]) in the bottom-right corner instead of 16 pt emojis — unmissable on thermal output. Cake 🍰 and share-coin glyphs unchanged. Unused `ALLERGY_EMOJI` map removed.
- Verified end-to-end with a test roster (allergies, handbook groups, birthday) and a 1-bit threshold simulation of thermal output: all six patterns distinguishable, chips and groups fully legible.

### Bug fix: birthday cake disappeared after the birthday passed
`isBirthdayWeek()` rolled an already-passed birthday forward to *next year* before the ISO-week comparison, so the cake vanished the day after the birthday — contradicting the 3.6.2 documented behavior ("the whole calendar week containing the birthday"). Now the birthday is tested in both the current and next calendar year against today's ISO week, which restores the full-week behavior and still handles the Dec→Jan ISO-week wrap.

### Website
"Per-club label design" section rewritten for the pattern system; allergy tile corrected ("Bold black chips… NUTS, DAIRY, GLUTEN, EGG, DYE" — the old text described a removed red bar and a SHELLFISH token that never existed in the parser).

### Behavior change
- **Before (3.7.0):** colored stripes/club names that flatten to similar grays on thermal; allergy emojis hard to read; cake only until the birthday itself.
- **After:** black pattern stripes distinguishable in pure 1-bit output; bold inverted allergy chips; cake for the entire calendar week containing the birthday.

## [3.7.0] - 2026-06-11
Feature: per-club label design system (official Awana club colors) + a broad reliability hardening pass on the print server.

### Why
All clubs printed visually identical labels — only the font differed — so volunteers sorting kids at the door had to read the small club line on every label. And several long-standing reliability gaps could degrade or kill the server mid-event: a port collision during update killed the process silently, a locked CSV wiped enrichment data for the rest of the night, and a single spooler hiccup sent a child away without a label.

### Per-club design (print-server/server.js)
Each club now has an accent palette in `CLUB_THEMES`, alongside its existing font personality:
- **Puggles** leaf green / teal · **Cubbies** sky blue / yellow · **Sparks** flame red / yellow · **T&T** green / black · **Trek** orange / charcoal · **Journey** blue / charcoal
- New club identity stripe: a two-tone color bar on the left edge of every label — the at-a-glance "which club" cue.
- Icon panel background and divider are now a light tint of the club primary (derived via a `tint()` helper, no second hardcoded palette).
- Club name prints bold italic in the club primary; the separator rule is a primary→secondary gradient.
- Visitor pill now uses the club primary instead of plain black.
- Step-up labels are unchanged (black/amber) except the stripe, which matches the amber callout. All primaries are mid-dark so monochrome thermal printers flatten them to legible grays.

### Reliability (print-server/server.js)
- **Port bind retry:** `EADDRINUSE` on startup now retries 5× with backoff (the installer can hold port 3456 for a few seconds during updates) and prints an actionable message instead of dying silently.
- **Last-known-good roster:** if `clubbers.csv` becomes unreadable mid-event (EBUSY/deleted/corrupt), the server keeps serving the previous in-memory roster instead of wiping it — labels keep their allergies and groups.
- **Print retry:** one automatic retry (750 ms) on PowerShell print failure — transient spooler errors (printer waking, USB renegotiation) routinely succeed on the second attempt.
- **Atomic writes:** `clubbers.csv` (from /update-csv) and `print-history.json` are written to a temp file and renamed, so a crash mid-write can never leave a truncated file.
- **Club icon cache:** remote club logos are downloaded once (with one retry) and cached in memory, so a Wi-Fi blip no longer costs the label its icon.
- **Collision-proof temp files:** temp PNG/PS1 names now include a random suffix — two prints in the same millisecond no longer delete each other's files.
- **Orphan sweep:** leftover `awana-*.png`/`awana-print-*.ps1` files older than 1 h are removed at startup.
- **Clean JSON errors:** malformed request bodies return `400 {"error": ...}` instead of the default Express HTML stack trace.

### Behavior change
- **Before:** all labels white with gray text; server died silently on port conflict; locked CSV = basic labels for the rest of the night; one spooler error = no label.
- **After:** each club's label carries its official colors; the server survives port conflicts, CSV lock-outs, spooler hiccups, and network blips without losing a print.

## [3.6.2] - 2026-05-05
Fix: birthday cake emoji now displays during the calendar week containing the birthday, not for any birthday within the next 7 days.

### Why
The previous "next 7 days" logic was too broad. At Awana events, displaying the cake emoji the entire week *before* a birthday created confusion — volunteers seeing the cake would expect it to be someone's actual birthday, but it would sometimes be 5+ days away. The cake emoji should signal "this birthday is happening this week" rather than "this birthday might happen in the next week."

### Root cause
`isBirthdayWeek()` function was calculating `diffDays >= 0 && diffDays <= 6`, which displays the cake for any birthday within 7 days, regardless of calendar week boundaries.

### Fix (print-server/server.js)
- Modified `isBirthdayWeek()` to use ISO week number comparison instead of day difference arithmetic.
- Birthday now shows a cake emoji only if it falls within the same calendar week as today (same ISO week number and year).
- Updated documentation (PrintServerInfo.tsx) to clarify that the emoji shows "when a birthday is in the same calendar week" and corrected it to say "cake emoji 🍰 in bottom-right corner" instead of the outdated "red Happy Birthday line".

### Behavior change
- **Before:** A child's label shows a cake emoji for 7 days: from 6 days before their birthday through the day after.
- **After:** A child's label shows a cake emoji only during the calendar week containing their birthday (Mon–Sun or your locale's week start/end).
- **Example:** If a birthday is Thursday May 6, the cake emoji shows from Monday May 4 through Sunday May 10 (the same ISO week), but not on May 3 (prior week) or May 11 (next week).

## [3.6.1] - 2026-05-03
Hotfix: drop the 2-second blanket print cooldown that was silently swallowing the second of any two back-to-back check-ins.

### Why
Volunteer report after v3.0.4: standard click → modal → confirm flow was missing prints. Two parents checking different kids back-to-back would get one label and one missed kid, with no visible error.

### Root cause
`onCheckin` (the fast path triggered by the `#lastCheckin` mutation observer) and `triggerRemotePrint` (the roster-diff fallback) both had a `Date.now() - lastPrintTime < PRINT_COOLDOWN` early-return. Designed as a belt-and-suspenders cross-path dedup, but it was over-broad — it gated on **time** rather than **name**, so a different kid checked in within 2 s of the previous one was dropped without ever reaching `doPrint`.

The actual deduplication mechanism (`printedNames` Set + `batchPrintedNames` Set, both keyed on lowercase name) is sufficient: every print path checks the sets *before* POSTing, and writes to them *before* POSTing, so the race window where the same kid would be printed twice from two different detection paths is already zero.

### Fix (chrome-extension/content.js)
- Removed the `Date.now() - lastPrintTime < PRINT_COOLDOWN` gate from both `onCheckin` and `triggerRemotePrint`. Per-name dedup is unchanged.
- `lastPrintTime` is still updated for diagnostic continuity but no longer gates anything.
- Added a `console.log('[Awana] POST /print:', fullName, ...)` line in `doPrint` so the next time something looks off, the volunteer (or whoever's helping debug) can open DevTools, watch the console, and see exactly which check-ins fired their POST and which didn't.
- `PRINT_COOLDOWN` constant is preserved — it's still used as the polling interval for `flushQueue`.

### Behavior change
- **Before:** two parents back-to-back → first label prints, second drops silently. Three parents in 4 s → only the first label prints.
- **After:** every kid checked in via the standard flow gets a label. Same-kid double-detection is still blocked by `printedNames`.

## [3.6.0] - 2026-05-03
Awana Store Night support: each kid's label gets a small `🪙 N` badge in the bottom-right icon strip showing their current share balance, sourced live from TwoTimTwo's share-balance report.

### Why
On Awana Store nights, kids spend their accumulated shares ("shekels") at a small in-house store. Today the volunteer at the counter has to look every kid up by hand in TwoTimTwo. This change puts the balance straight on the label so they can scan and ring up in one motion.

### Detection (chrome-extension/content.js, options.html / options.js)
- New `isAwanaStoreNight()` reuses the same DOM scanner as `isStepUpNight()`, matching `/store/i` (case-insensitive). The detection helper was factored into a shared `scanCalendarFor(pattern)` so both modes use identical exclusion rules.
- New widget toggle (Auto / On / Off) sits immediately after the Step Up Night row. The hint shows the live auto-detect result and the count of kids currently in the share-balance cache.
- Mirrored on the extension Options page; the two stay in sync via `chrome.storage.local` and the existing `chrome.storage.onChanged` listener. The Options page now uses a small `bindModeSelect(elementId, storageKey)` helper that handles both Step Up and Store toggles.

### Share-balance fetch + cache (chrome-extension/content.js)
- `fetchShareBalances()` issues five parallel `GET https://kvbchurch.twotimtwo.com/report/shekelBalance?club_id=N&output=csv` requests for `N=2..6` (Cubbies, Sparks, T&T, Trek, Journey) using the volunteer's logged-in TwoTimTwo session (`credentials: 'same-origin'`).
- A tiny inline parser handles the simple `"Name","Balance"` two-column CSVs and bails on anything that looks like an HTML response (e.g. a login-redirect page).
- Results are merged into a single map keyed on `lowercase + trim + collapse-whitespace` of the full name, so the double-spaces seen in the source data (`"Avery  McAdam"`) don't break lookups.
- Cache TTL is 5 minutes. `getShareBalance(firstName, lastName)` returns whatever's currently cached and kicks off a background refresh if stale — never blocks the print path.
- Initial fetch fires when Store mode becomes active (widget init, toggle change, options-page change). A per-minute timer refreshes both the auto-detection and the cache count shown in the widget hint.

### Print payload (chrome-extension/content.js)
- Both `doPrint()` and `triggerWalkIn()` now include `awanaShares: <csvBalance + 1>` in the payload when Store mode is active and the kid is found in the cache. The `+ 1` reflects tonight's attendance share (the CSV is last week's total).
- Kids missing from all 5 CSVs send no `awanaShares` field — per spec, the label shows no badge rather than implying a balance the kid doesn't have.

### Server-side rendering (print-server/server.js)
- `generateLabel(...)` accepts a new optional final parameter `awanaShares = null`. Non-finite or negative values are coerced to `null` so a malformed payload can't print "🪙 -3".
- The existing bottom-right icon row branch now triggers on `(hasAllergy || isBirthday || awanaShares != null)` and prepends the shares glyph as the leftmost entry: read order is `🪙 N → 🍰 → allergy emojis`. The existing emoji font stack (`Segoe UI Emoji`, …, `sans-serif`) handles both the coin glyph and the ASCII digits.
- `/print` and `/label` accept and pass-through `awanaShares` from the request body.
- Composes cleanly with Step Up Night: a stepping-up kid on a Store night gets the inverted black/amber label AND the `🪙 N` badge.

### Scope
- Chrome extension + print server. The Electron HTML renderer (`electron-app/`) is unchanged. Reprint/preview/diagnostic paths intentionally don't carry `awanaShares` (they'd need access to the share cache too, and reprints from history are contextual).

### Things to watch
- CSV fetch needs an active TwoTimTwo session. If it isn't, all 5 fetches return HTML; we detect this and skip silently — labels just won't have badges. The widget hint will say "loading…" indefinitely in that case.
- The `+1` rule is a fixed assumption per the requirement; if a kid missed last week and the office hasn't reconciled, the printed number could be off by one. Not trying to be clever about it.

## [3.5.0] - 2026-05-03
Step Up Night support: kids who are graduating to a different club next year get an inverted, hard-to-miss label that says "Stepping up to <next club>" in place of their handbook group.

### Why
This Wednesday is Step Up Night at KVBC. Volunteers need to be able to spot stepping-up kids at a glance so they're routed to the right room — same name, same allergy/birthday icons, but a label that visually screams "this kid is changing clubs".

### Detection (chrome-extension/content.js, options.html / options.js)
- New `isStepUpNight()` scans the TwoTimTwo page DOM (excluding the widget) for any heading or event/title element whose visible text contains "step up" (case-insensitive).
- New widget toggle (Auto / On / Off) sits next to Quick Mode. The hint shows the live auto-detect result so volunteers can see what the page reports.
- Same toggle is also surfaced on the extension Options page; the two stay in sync via `chrome.storage.local` and the `chrome.storage.onChanged` listener in the content script.
- The current mode is included on every `/print` and `/label` payload as `stepUpNight: true|false`.

### Eligibility (print-server/server.js)
- New `isSteppingUp(record, clubName)` decides whether a given kid actually graduates next year:
  - **Puggles:** all of them step up to Cubbies.
  - **Cubbies:** the kid's 5th birthday must fall on or before October 15 of the next Awana-year start (the script automatically uses this calendar year's Oct 15 if today is January–June, next year's Oct 15 otherwise).
  - **Sparks:** 2nd-graders step up to T&T.
  - **T&T:** 5th-graders step up to Trek.
  - **Trek:** 8th-graders step up to Journey.
  - **Journey:** 12th-graders step up to Graduates.
- Helpers added: `parseBirthdate` (handles both `MM/DD/YYYY` and `YYYY-MM-DD`), `parseGrade` (`K`/`Kindergarten` → 0, `1st` → 1, …, `12th` → 12; rejects Pre-K), `clubKey`, `nextClubFor`, plus the `STEP_UP_GRADUATING_GRADE` and `STEP_UP_NEXT_CLUB` constants for easy adjustment.
- `/print` and `/label` only honour the client's `stepUpNight` flag for kids who actually pass `isSteppingUp()`. Everyone else prints a normal label tonight.

### Inverted label rendering (print-server/server.js — `generateLabel`)
- Stepping-up labels render on a black background with white name, light-gray supporting text, and an amber "Stepping up to <next club>" line replacing the handbook-group line. The visitor pill inverts to white-on-black so it stays readable.
- The current club's icon panel is dropped on stepping-up labels (the kid is leaving that club; widening the text area also makes the message more prominent).
- All previously-existing label features (allergy emojis, birthday cake, visitor pill, club font personality, etc.) still render — the change is a pure color/text-content swap.

### Scope
- Chrome extension + print server. The Electron HTML renderer (`electron-app/`) is unchanged.

## [3.0.4] - 2026-05-03
Belt-and-suspenders pass after the v3.0.3 fixes: close the last two paths that could produce errant labels and make batch check-in self-verify so kids can't be left as "label printed but not actually checked in".

### Why
A full audit of every print trigger and the batch check-in chain found two remaining gaps:
- **Stale offline queue could replay a label.** `flushQueue()` reads from `localStorage` (persists across crashes / restarts) but never consulted `printedNames` before `POST /print`. If a kid was queued during a server outage, then printed via another path (onCheckin / roster diff / Pusher) before the queue flushed, the queue would re-print them.
- **Batch check-in clicked the modal button but never confirmed TwoTimTwo accepted it.** With v3.0.3's fresh-element re-query, `.click()` reliably opens the modal and the modal button gets clicked — but if TwoTimTwo dismissed the modal without recording the check-in (modal race, network blip), the chain proceeded to the next sibling regardless. The label was already printed but the kid was left visible in the roster.

### Fixes (chrome-extension/content.js)
- **Queue-flush dedup:** `flushQueue()` now checks `printedNames` before sending each queued item; already-printed entries are dropped. Successful flushes also call `markPrinted()` so a later path won't re-emit them.
- **Self-verifying batch check-in:** new `verifyBatchCheckin()` polls the `.clubber` roster for up to 2 s after the modal click; if the kid's row is still present, it re-clicks the row and re-runs `pollForCheckinButton` once before logging and moving on. `pollForCheckinButton()` got a matching `retriesLeft` parameter and now also re-clicks the row once if the modal never opened (button never appeared inside its 3 s window). Existing single-call sites (Quick Mode, search-triggered check-in) inherit the verification automatically.

### Scope
- **Chrome extension only.** No server changes.

## [3.0.3] - 2026-04-30
Two volunteer-reported bugs from the live event: phantom labels printing during page searches, and batch sibling check-in printing labels but not actually checking the kids in on TwoTimTwo.

### Why
- **Phantom prints during search.** Prior phantom-print fixes (v2.3.0 mass-disappearance guard, v3.0.2.3 server-side dedup) reduced but didn't eliminate it. Two gaps remained:
  - `watchCheckins()` was calling `scanClubberList()` from inside the MutationObserver callback. Each search keystroke fires DOM mutations; with `PENDING_MISS_THRESHOLD = 2`, a kid hidden during typing could hit two consecutive misses inside ~200 ms instead of the documented ≥10 s.
  - The mass-disappearance guard required `missingCount > 3` strict-greater. A 7-kid club with 3 hidden by search produces exactly 3 — guard skips, consecutive-miss confirmation fires, label phantom-prints.
- **Batch siblings printed but not checked in.** `batchCheckInSiblings()` clicked `sib.element` — a DOM reference captured at `findSiblings()` time. After the first sibling's check-in, TwoTimTwo re-renders the roster, the cached node detaches, and `.click()` on a detached node is a silent no-op. The print succeeded (it only needs cached name/club), but the modal never opened so `pollForCheckinButton()` had nothing to click.

### Fixes (chrome-extension/content.js)
- **Pause roster-diff during search:** new `isSearchActive()` helper checks for any visible non-widget text/search input with non-empty value. `scanClubberList()` now returns early and clears `pendingMissing` when search is active.
- **Drop mutation-driven scan:** `watchCheckins()` no longer calls `scanClubberList()` from the `MutationObserver` callback. The 5-second `setInterval` and the once-on-init scan remain — remote check-in detection latency is unchanged from documented behaviour.
- **Tightened Guard A:** `MASS_DISAPPEAR_ABS` lowered from 3 to 1. Combined with the unchanged `<80%` ratio, this catches the small-roster gap (7-kid club with 3 hidden) without touching legitimate single check-ins (a 50-kid roster never crosses 80% from one kid disappearing).
- **Fresh DOM lookup before batch click:** new `findClubberElByName()` re-queries the live `.clubber` row by name. `batchCheckInSiblings()` now resolves a fresh element immediately before `.click()` and skips to the next sibling if the row is gone.

### Scope
- **Chrome extension only.** `print-server/` and `electron-app/` are unchanged.

## [3.0.2.4] - 2026-04-29
Added extension settings page for Pusher configuration.

### Added (chrome-extension/)
- **Options Page:** New settings page (`options.html` / `options.js`) accessible via right-click → "Options" on the extension icon, or via the new "Extension Settings" button in the popup.
- **Pusher Fields:** App ID, Key, Secret, and Cluster inputs that load from and save to the print server's `/config` endpoint.
- **Offline Handling:** Settings page shows a warning banner when the print server is unreachable, but remains usable.

## [3.0.2.3] - 2026-04-18
Fixed duplicate prints and server responsiveness issues.

### Fixes (print-server/server.js)
- **Asynchronous Printing:** Refactored printImage and printer diagnostics to use non-blocking asynchronous execution. This prevents the server from appearing 'offline' in the dashboard during active printing.
- **Server-Side Deduplication:** Implemented a 4-hour cooldown for reprinting the same name. This prevents 'phantom' prints even if the client triggers multiple requests.

### Fixes (chrome-extension/content.js)
- **Session Persistence:** Updated printedNames deduplication set to reliably persist in sessionStorage. This ensures that children already printed during a session remain marked as 'printed' even after the page auto-refreshes or is manually reloaded.

## [3.0.2.2] - 2026-04-17
Fixes Quick Mode auto-sibling check-in.

### Fixes (chrome-extension/content.js)
- **Quick Mode Auto-Siblings:** Fixed an issue where clicking a child''s name in Quick Mode would skip the sibling check-in logic. Sibling detection and automatic check-in is now integrated directly into the Quick Mode click interceptor.

## [3.0.2.1] - 2026-04-17
Hotfix for print server crash and configuration improvements.

### Fixes (print-server/server.js)
- **Fix crash on print:** Added null check for `pusher` object. The server would previously crash if Pusher was not configured (default state).
- **Fix SyntaxError:** Removed redundant `CONFIG_FILE` declaration that prevented the server from starting.

### Setup (install-and-run.ps1, print-server/public/index.html)
- **Pusher Configuration:** Added UI and script prompts to configure Pusher App ID, Key, Secret, and Cluster. Credentials are saved to `config.json` and persist across restarts.
- **Improved Settings Dashboard:** Settings panel now includes a dedicated Pusher section with helpful hints.

## [3.0.1] - 2026-04-17
Broadcast real-time check-in events via Pusher so external dashboards/displays can react instantly. After each successful print, `print-server/server.js` triggers a `checkin` event on `awana-channel` with `firstName`, `club`, `isBirthday`, and `isFirstTimer`. Pusher is initialised with placeholder credentials (appId/key/secret/cluster) that must be replaced before use. Added `pusher` npm dependency.

## [3.0.0] - 2026-04-16
"Go Big" release: 14 improvements to reduce clicks, add automation, and simplify setup. The #1 volunteer complaint was "too many buttons to click" â€” Quick Mode addresses this directly.

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
- **Non-blocking update notice:** Widget now shows "Server update vX available â€” restart server to apply" when the server detects a newer version on GitHub.
- **Self-healing server:** `launch-awana.bat` now runs a restart loop (max 5 restarts per Zero-Loop Policy) instead of a fire-and-forget `start /min`. Server runs in the foreground of the "Keep this window open" window.

### Setup Simplification (chrome-extension/content.js, print-server/server.js, install-and-run.ps1)
- **Auto-detect printer:** If only one printer is connected, it's auto-selected in both the install script and the Chrome extension (via new `autoDetected` field in `/printers` response).
- **Chrome extension auto-config:** Printer selection is now persisted in `chrome.storage.local` (survives extension updates), with `localStorage` fallback.
- **Pre-warm printer:** Optional `config.json` setting (`prewarmPrinter: true`) sends a blank label to the printer 5 seconds after server start, eliminating cold-start delay. Off by default.

### Dashboard & UX (print-server/public/index.html, chrome-extension/content.js)
- **Traffic-light health dashboard:** Large green/yellow/red indicator at the top of the server dashboard (localhost:3456). Plain-English warning descriptions instead of technical codes. Auto-refreshes every 10 seconds (was 30s).
- **"Help â€” Not Working?" panic button:** Orange button at the bottom of the widget. Runs `/diagnostics`, parses the 4 test results, and shows plain-English guidance (printer off, server unreachable, roster missing, etc.).
- **Periodic health checks:** Extension now re-checks `/health` every 60 seconds to surface warnings promptly.

## [2.3.0] - 2026-04-15
Fix phantom prints caused by the roster-diff remote check-in detector, and replace the "Happy Birthday!" text banner with a ðŸ° cake emoji in the bottom-right icon row.

### Why
Two live-event bugs:
- **Genevieve Bean** printed a label even though she was never checked in.
- **Eowyn Bambakakis** printed **twice** even though she was never checked in.

Both are the same root cause. `scanClubberList()` treats any `.clubber` row that was present in the previous scan but missing in the current one as a remote check-in. But `.clubber` rows can disappear for reasons that are **not** check-ins: search/filter input, club-tab filtering, scroll virtualization, or a page reload that restores `knownClubbers` from `sessionStorage` while the filter state is now different. When that happens, the diff mass-prints the "missing" kids. If the filter flaps twice (or a reload lands in a different filter state), the same phantom can print twice because `printedNames` dedup never records a real print target between the flaps.

### Phantom-print fix (chrome-extension/content.js)
- **Mass-disappearance guard:** if > 3 kids go missing in a single scan **and** the roster shrinks below 80% of its previous size, treat it as a UI reshuffle (filter / tab switch / reload) and re-baseline `knownClubbers` without printing anyone. Clears `pendingMissing` to prevent stale state.
- **Consecutive-miss confirmation:** a new `pendingMissing` `Map<nameKey, missCount>` requires a kid to be absent for **2 consecutive scans** (â‰¥ 10 seconds at the 5-second `SCAN_INTERVAL_MS`) before the diff path fires. A single-scan flap (brief filter, virtualization glitch) clears pending state as soon as the kid reappears in `current`.
- The scan iterates the union of `knownClubbers` + `pendingMissing.keys()` so in-flight pending entries continue to be re-evaluated after `knownClubbers` rolls forward to the latest scan.
- The `#lastCheckin` observer path is unchanged â€” it remains the trusted primary detector for check-ins made on this browser.

### Birthday cake emoji (print-server/server.js)
- Removed the red 9pt bold "Happy Birthday!" text banner that used to sit under the handbook group (and its contribution to `blockH`, so the centered text block is now truly centered on non-birthday labels as well).
- Added a ðŸ° glyph at **26pt** (~1.6Ã— the 16pt allergy emoji size) to the bottom-right icon row. Rendered with the same emoji font stack as the allergy emojis (`"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`) so visual style matches.
- Ordering in the row: **cake leftmost, allergy emojis to its right**, with the rightmost allergy emoji anchored against the label's right padding. The icon row renders whenever `hasAllergy || isBirthday`.
- Per-glyph measurement via `ctx.measureText` so the differently-sized cake and allergy emojis share the same baseline and pack cleanly without overlap.

### Scope
- **Chrome extension + print server only.** The Electron HTML label renderer (`electron-app/src/server.js`) already did not render allergies or birthdays, so it is unchanged.

## [2.2.0] - 2026-04-09
Detect remote check-ins by diffing the `.clubber` roster across scans, so a kid checked in from another device (phone, second laptop) eventually gets their label printed here. Auto-refresh the page during peak time so the diff sees fresh data.

### Why
TwoTimTwo.com doesn't push real-time updates â€” the existing `#lastCheckin` observer only fires for check-ins made on *this* browser. If a volunteer uses a phone or a second laptop to check someone in, the label never prints because the laptop never sees the event. This was causing missed labels during the 5:40â€“6:00 PM rush when multiple volunteers are checking kids in simultaneously.

### Remote check-in detection (chrome-extension/content.js)
- New `scanClubberList()` captures the visible `.clubber` names on every scan; any name present on the previous scan but missing now is treated as a check-in (local *or* remote) and its label is printed via the normal `doPrint()` path.
- Club name + icon image are cached in `ROSTER_CACHE` while the kid is still visible, so they can still be printed after the kid disappears (where `lookupClub()` would fail).
- A session-scoped `printedNames` `Set` dedupes across the `#lastCheckin` path, the batch-sibling path, and the new diff path â€” a locally-checked-in kid is never reprinted. `onCheckin()` and `batchCheckInSiblings()` now call `markPrinted()` to feed this set.
- State (`printedNames`, `knownClubbers`, `ROSTER_CACHE`, baseline flag) is persisted to `sessionStorage` so detection survives the peak-window auto-refresh reload. A 4-hour idle timeout auto-clears the dedup state between Awana nights.
- First scan after load is a baseline-only populate â€” we never print the full roster on page load.
- Scans fire once on init, on every debounced `MutationObserver` callback, and on a 5-second safety interval.

### Peak-window auto-refresh (chrome-extension/content.js)
- New `autoRefresh()` reloads the page every 30 seconds when the local clock is between 17:40 and 18:00.
- Suppressed when the document is hidden, the sibling panel (`#awana-sibling-panel`) is open, the check-in modal (`#checkin-modal`) is open, or any `INPUT`/`TEXTAREA`/`SELECT` is focused â€” preserves in-progress user actions.

### Scope
- **Chrome extension only** â€” `electron-app/src/checkin-script.js` intentionally not updated in this release.

## [2.1.0] - 2026-04-09
Batch check-in reliability and quality improvements: duplicate prevention, faster throughput, club-specific fonts, age-appropriate sibling options, and correct multi-family separation.

### Improvements

**Duplicate label prevention (batch check-in):**
- `lastPrintTime` is now updated when batch fires a print, engaging the `PRINT_COOLDOWN` guard as a second layer alongside the existing `batchPrintedNames` Set.
- Name keys stored in `batchPrintedNames` are now `.trim()`ed for both write and read, eliminating any edge-case mismatch from trailing whitespace in `#lastCheckin`.

**Faster batch check-ins:**
- `BATCH_DELAY` reduced from 700 ms to 400 ms between siblings. The print fires before the check-in modal is submitted so the modal round-trip is the real bottleneck â€” 400 ms is sufficient for the next sibling selection without sacrificing reliability.

**Club-specific label fonts:**
- Each Awana club now uses a distinct font personality on the printed label:
  - Puggles / Cubbies â†’ Comic Sans MS (fun, rounded, age-appropriate)
  - Sparks â†’ Trebuchet MS (modern, energetic)
  - T&T â†’ Arial Black (bold, strong)
  - Trek â†’ Georgia (classic, mature)
  - Journey â†’ Palatino Linotype (sophisticated)
  - Unknown / default â†’ Helvetica / Arial (unchanged)
- `fitFontSize` updated to accept a `fontFamily` parameter so auto-sizing uses the same face as rendering.

**No Bible / Friend options for Puggles and Cubbies:**
- Sibling check-in panel now detects the sibling's club name. If the club is Puggles or Cubbies the Bible and Friend checkboxes are omitted â€” those programmes don't track those options.

**Correct Miller-family (same-last-name) separation:**
- `findSiblings` previously always fell back to DOM last-name matching when the server returned zero siblings, incorrectly grouping unrelated families who share a last name.
- Fix: if the server responds successfully (HTTP 200) with an empty siblings list the DOM fallback is suppressed. The fallback now only activates when the server is unreachable or times out.
- Families with the same last name are correctly separated as long as the synced CSV contains any distinguishing field: HouseholdID, PrimaryContact, Guardian, or Address.

## [2.0.5] - 2026-04-08
Critical fixes for sibling check-in â€” all siblings were timing out due to four bugs in button detection and options application.

### Bug Fixes (pollForCheckinButton)

**Bug 1 â€” offsetParent always null for position:fixed elements:**
- `#checkin-modal` uses CSS `position: fixed`, which means `offsetParent` is **always `null`** regardless of visibility. Strategy 1 was never finding the button because the visibility check failed immediately.
- **Fix:** Replace `ttModal.offsetParent !== null` with `window.getComputedStyle(ttModal).display !== 'none'`.

**Bug 2 â€” Wrong modalContainer from `.closest('[class*="modal"]')`:**
- `.closest()` walks up the DOM and stops at the first ancestor matching the selector. For `button#checkin`, it matched `.modal-footer` (an ancestor whose class name contains "modal"), not `#checkin-modal`. Result: 0 checkboxes found, Bible/Friend options never applied.
- **Fix:** Use `document.getElementById('checkin-modal')` directly instead of `.closest()`.

**Bug 3 â€” Double-submission from dual click handlers:**
- Code called both `checkinBtn.click()` and `checkinBtn.dispatchEvent(new MouseEvent('click'))`, firing the form submission handler twice and creating duplicate check-in records.
- **Fix:** Remove the `dispatchEvent` line. `.click()` alone is sufficient.

**Bug 4 â€” Broken timeout fallback calls immediately:**
- `setTimeout(batchCheckInSiblings(remaining), BATCH_DELAY)` executed `batchCheckInSiblings(remaining)` right away (passing `undefined` to `setTimeout`). The deferred batch never ran.
- **Fix:** Wrap in a function: `setTimeout(function() { batchCheckInSiblings(remaining); }, BATCH_DELAY)`.

**Bonus â€” Strategy 4 selector specificity:**
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
- **Strategy 2 simplified:** No longer relies on pre-click button snapshot â€” now simply scans all visible buttons for check-in text, which correctly handles both React (dynamic) and Bootstrap (static) modal patterns.
- **Strategy 3 hardened:** Added visibility check (`offsetParent !== null`) before matching by text, preventing false positives from hidden modals.

### Faster Batch Check-ins
- **Print queued in background:** `batchCheckInSiblings` now fires `doPrint` for each sibling immediately before clicking their card, so label printing happens in the background while check-ins proceed.
- **Reduced inter-sibling delay:** `PRINT_COOLDOWN + 500` (2500ms) â†’ `BATCH_DELAY` (700ms) between siblings. Entire batch of 3 siblings now takes ~2s instead of ~7.5s.
- **Deduplication guard:** Added `batchPrintedNames` Set. When `#lastCheckin div` updates after a batch check-in, `onCheckin` checks this set and skips printing to prevent double-prints. Names are cleared from the set after 8 seconds.

### Sibling Panel UI
- **Per-child checkboxes:** Each sibling row now shows Bible (default checked) and Friend (default unchecked) checkboxes on the right, instead of a global "Check-in Options" section at the bottom.
- **Removed global options:** Bible, Book, and Uniform global checkboxes replaced by per-sibling Bible and Friend options.
- **`applyCheckinOptions` updated:** Now maps Bible â†’ `/bible/i` and Friend â†’ `/friend|brought/i` (removed Book and Uniform patterns).

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
- **Batch check-in race condition fixed:** `batchCheckInSiblings()` no longer uses a hardcoded 600 ms `setTimeout` before looking for the check-in button. It now polls every 100 ms for up to 3 seconds, checking button visibility (`offsetParent !== null`) before clicking â€” eliminating failures on slower connections or React/Vue SPA pages where the modal renders asynchronously.
- **Dual-click for framework compatibility:** Once the check-in button is found, both `.click()` and a bubbling `MouseEvent('click')` are dispatched so React/Vue synthetic event handlers are reliably triggered.
- **Check-in Options in sibling panel:** The sibling sidebar now includes a "Check-in Options" section with Bible, Book, and Uniform checkboxes (unchecked by default). Checked options are applied to the modal's corresponding checkboxes (with `change` + `click` events) before the check-in form is submitted.
- **CSV-based sibling detection:** `findSiblings()` is now async and first queries the new server `/siblings` endpoint before falling back to the existing DOM last-name match. This finds siblings in blended families or families where children have different last names, as long as the roster CSV includes a common family identifier (Household ID, Primary Contact, Guardian, or Address).

### Server Changes
- **`GET /siblings?name=First+Last`:** New endpoint returns an array of sibling names for the given child, derived from the synced `clubbers.csv`. Groups families by the best available identifier (HouseholdID â†’ PrimaryContact â†’ Guardian â†’ Address â†’ LastName fallback). Returns `{ siblings: [] }` if the child is not in the CSV or has no detected family members.
- **Extended CSV column support:** `HEADER_MAP` now recognises family/household identifier columns exported by TwoTimTwo and similar systems: `Primary Contact`, `Guardian`, `Parents`, `Household ID`, `Family ID`, `Address`, and common variants.

## [2.0.0] - 2026-04-06
Major release adding dashboard, sibling batch check-in, offline queue, and operational tooling.

### Server Features
- **Dashboard Web UI:** Open `localhost:3456` for real-time server status, print history, label preview, settings, and diagnostics â€” all in one page.
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
- **Widget Default Minimized:** Widget now starts collapsed as a small green pill instead of an expanded panel. Prevents the widget from obstructing page content on first load. Click the pill to expand; click Ã— to collapse again. State persists across page loads.

## [1.10.8] - 2026-04-04
- **Widget Position Fix:** Reverted inline DOM injection (placed widget in wrong sidebar). Widget now uses `position: fixed` at `top: 55px, right: 12px` â€” floating over the right column below the site nav bars.

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
- **Removed Shellfish:** Dropped SHELLFISH (ðŸ¦) from allergy detection and icon map.
- **DYE Icon:** Changed from âš  to ðŸ’§ (water drop) for food dye/artificial coloring sensitivity.

## [1.10.3] - 2026-04-04
- **Aspect Ratio Fix:** Club logo images were squished to 64Ã—64 square before being sent to the print server. Fixed `getClubImageDataUrl()` in both content.js and bookmarklet.js to letterbox images preserving natural aspect ratio.
- **HandbookGroup Filter:** Children in handbook group "All" (case-insensitive) now print no group text â€” the field is treated as blank.
- **Walk-in Guest Print:** Added free-text input to extension widget. Type any name and press Print/Enter to print a basic label for walk-in guests not in the TwoTimTwo roster.

## [1.10.2] - 2026-03-30
- **Orientation Fix:** Replaced landscape flag with explicit `PaperSize("Label", 400, 200)` (4"Ã—2" in hundredths of inches). D450 label stock was being rotated 90Â° extra, producing portrait output.
- **Emoji Allergy Icons:** Replaced text strip ("NUTS â€¢ DAIRY") with emojis (ðŸ¥œðŸ¥›ðŸŒ¾ðŸ¥šðŸ¦âš ) using Segoe UI Emoji font, increased from 14pt to 20pt.

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
- **Widget UX:** Minimize button â†’ arrow tab on left edge. Full collapse when minimized.
- **Dependency change:** pdfkit/pdf-to-printer â†’ canvas.

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

