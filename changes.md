## [5.10.0] - 2026-08-22
Labels can now carry a configurable footer — one short operator-set line (church name, a verse, service times) printed along the bottom of every label. First of the three features picked from the ideas triage (#8 on the scratchpad); the connect-card auto-trigger (#10) and per-club template editor (#1) follow.

### One line, on every label that goes home
A new `labelFooter` config key (Settings → Check-in Features → "Label footer", blank by default) renders as an italic 10pt line at the very bottom-left of the badge, below any "Go to:" routing or milestone line. It rides on every render path a family sees — check-in labels, the connect card, reprints, award slips, `/label` dialog renders, and the dashboard preview — but not canary/test labels. The value is not a secret (it's printed on paper by design), so it saves through the normal `POST /config` path; it is sanitized to a single printable line before persisting (control characters become spaces, whitespace collapses, 60-char cap) and clearing it deletes the key, the same pattern as `phonePin`.

The renderer never reads config: the handlers pass the footer in as `input.footerText` via a tiny `labelFooterText()` helper, so `generateLabel()` stays a pure function of its argument and the golden-image suite keeps meaning what it says. An empty footer renders byte-identically to 5.9.0 — confirmed by 22 of 24 baselines surviving regeneration untouched.

### The bottom band stopped guessing where the icons are
Adding a line that appears on *every* label exposed a latent collision: the bottom-left lines (goTo/milestone, now footer) truncated at a flat 55% of the badge width, while a five-allergy icon row grows leftward past that point — so the torture case interleaved text through the allergy emoji. The lines now truncate against the icon row's actual left edge (measured, not guessed), which also means an icon-less label lets the footer run nearly the full badge width instead of cutting off at half. A configured footer also reserves the same 20pt bottom strip the icon row does, so the centered name block can't descend onto it.

### Tests
Two new golden cases (`footer`, `footer-with-go-to` pinning the stack order: footer at the very bottom, routing above) and the torture case now carries a footer too — its baseline is the only regenerated one. `test-config-store.cjs` adds `labelFooter` to the server-owned keys that must survive a setup-wizard save.

## [5.9.0] - 2026-08-10
Renamed the product from "Awana Label Printer" to **"Club Label Printer"** — Awana Clubs International's published Trademark Guidelines say they don't grant permission to create products bearing their name, and this app's own branding (window titles, tray text, Start Menu/Desktop shortcuts, the installer filename, the website) was doing exactly that. A first pass the same guidelines review turned up (disclaimer wording, ® marking) shipped as website/README-only copy fixes with no version bump; this release is the actual rebrand.

### What changed, and what deliberately didn't
Every user-visible string changed: the Electron app's window titles, tray tooltip/menu, error dialogs, the installer artifact (`Club-Label-Printer-Setup.exe`), the browser-extension widget ("Club Print"), the print-server dashboard/phone/bookmarklet pages, the website (nav, hero, install guide, footer, capabilities page), and all the docs (README, TROUBLESHOOTING, EXTENSION, SETUP, NIGHT-OF, CONTRACT). The legacy `install-and-run.ps1`/`install.bat`/`launch-awana.bat` scripts (deprecated, superseded by the .exe installer) got their banners renamed too, but **not** the shortcut/firewall-rule names they create on disk (`Awana Check In.lnk`, `Awana Print Server (TCP 3456)`) — those are literal legacy artifact names `migrate.js` already keys off for cleanup, and this script is on its way out regardless.

Three things were **deliberately left alone**, because changing them is what would actually break existing installs rather than just being untidy:
- `electron-app/package.json`'s `"name"` (`awana-label-printer`) and `"appId"` (`com.kvbc.awana-label-printer`). Neither is ever shown to a user, and — confirmed the hard way in `build-electron.yml`'s CI comment — electron-builder derives the install directory *and* `app.getPath('userData')` from `"name"`, not `"productName"`. Renaming it would silently orphan every existing install's config, roster, and print history in a folder nothing points at anymore, and break the NSIS upgrade-in-place registry lookup. `productName` (`Club Label Printer`) is what actually changes the file's displayed name, Start Menu/Desktop shortcut text, and window/taskbar text — all of it, with none of the data-loss risk. `%APPDATA%\awana-label-printer\chrome-extension` is therefore still the real path today; EXTENSION.md/TROUBLESHOOTING.md/docs/SETUP.md previously all claimed the title-case `Awana Label Printer` folder, which was already wrong before this release (electron-builder never used `productName` for this) — corrected while touching these docs anyway.
- The Pusher channel `awana-channel` (`print-server/church-config.json`'s default, `CONTRACT.md`) — this is the wire-protocol identifier the separate `Awana-Check-in-Display` repo's lobby signage subscribes to. Renaming it here with no coordinated change on that side would silently stop every check-in/tally/birthday event from reaching the display.
- Internal-only identifiers with zero user visibility: the `AWANA_DATA_DIR`/`AWANA_BIND_HOST`/`AWANA_PORT` env vars, the `X-Awana-Pin` header, `window.awana` (the preload bridge), and the DOM ids/localStorage keys/`[Awana]` console-log tags throughout `chrome-extension/content.js`. None of these function as a trademark — they're plumbing nobody but a developer ever reads — and touching them buys no compliance benefit for real risk of breaking something.

### Upgrade path for existing installs
`productName` changing *does* move where NSIS puts shortcuts (electron-builder names `.lnk` files after `productName`), so an update leaves the old "Awana Label Printer.lnk" behind alongside the new "Club Label Printer.lnk" — `migrate.js`/`main.js` now detect the old-named shortcut on Desktop and in the Start Menu and offer to remove it once, same pattern already used for the legacy-script-install shortcuts. No data migration is needed at all, since userData never moves (see above).

### Not fixed here — flagged for the project owner
The label-printing feature fetches each club's official Awana logo from the operator's own TwoTimTwo account and reprocesses it (dithers/binarizes for thermal output) — core to what this app does, and not something a rename touches. This technically brushes against the guidelines' "never modify our logos" rule; the actual remedy, if the owner wants one, is a permission request to `permission@awana.org`, not a code change.

## [5.8.2] - 2026-08-03
The no-photo flag now honors an explicit "no" in EITHER release column — fixing a real consent failure at KVB, where every no-photo child was printing without the camera icon.

### An unused column was eating the media release
TwoTimTwo's clubber export carries both `Med Release?` and `Photo Release?`. The code assumed photo consent lives in the photo column and used `Med Release?` only as a fallback for exports that lacked `Photo Release?` entirely. Field data proved the assumption wrong: KVB records the **media** release under `Med Release?` and never touches `Photo Release?` — and since the unused column still exists in every export, the precedence rule read the blank photo column, found no explicit "no", and silently dropped the flag for every no-photo child. The label, the reprint, and the dashboard's no-photo list all inherited the same blindness, because they all (correctly) derive from the same helper.

`noPhotoFor()` is now an OR, not a precedence chain: an explicit "no" under either column flags the child. A consent flag must fail toward protection — the worst outcome of OR is a spurious camera icon on a child whose medical release was declined but whose photos are fine; the worst outcome of precedence was photographing a child whose family said no. Blank, missing, and unrecognized values in both columns still mean "photos allowed", so rosters without either column are unaffected. The fixture test now pins the OR (`Amy: med=n, photo=y → flagged`) and calls the real exported `noPhotoFor` instead of a private copy of the rule.

## [5.8.1] - 2026-08-02
Identical to 5.8.0 in every feature — this release exists because 5.8.0's installer never got built. GitHub's workflow parser rejects `secrets.*` inside a step-level `if:` expression, and the new "ping laptops over Pusher" step used exactly that guard; the whole workflow file was invalid, so the tag was created but its build died before it began. The inline notify script already guards itself (it exits cleanly, with a log line, when the Pusher secrets are absent), so the `if:` is gone and the script is the guard. The orphaned `v5.8.0` tag remains in the repo with no release attached; this is the real 5.8 release. See 5.8.0's entry below for what actually shipped.


## [5.8.0] - 2026-08-02
Updates now reach the laptop in seconds, not hours — and an update that arrives mid-club installs itself immediately, because a mid-club release only ever means an urgent fix is on the way.

### Releases are pushed, not polled
When a release publishes, the build workflow now pings the same Pusher channel the lobby display already listens to, with a tiny `update` event carrying nothing but the version number and a timestamp. The app subscribes to that channel (read-only, with the same key/cluster/channel it already uses to publish) and reacts to the ping by asking electron-updater to check the real GitHub release feed — the ping is a doorbell, never the package, so a spoofed event could at most trigger a harmless verified check. Displays are untouched: they bind only their known event names, and CONTRACT.md now documents `update` as laptop-internal, version-only, forever.

The push leg activates when the repo has `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` secrets (plus optional `PUSHER_CHANNEL`); without them the workflow step skips silently and nothing breaks. The old every-6-hours poll relaxes to every 24 hours — with push doing the real work it's just the safety net for a laptop that was off when the doorbell rang, alongside the unchanged check on every launch.

### Updates install themselves, mid-club included
The previous policy — download silently, install on quit, never restart mid-club-night — optimized for not surprising anyone. The operator has reversed it deliberately: the only reason a release ships at 7:15pm on a Wednesday is that something is wrong right now. When a download completes, the app now gives any in-flight work a few seconds of grace (it will consult a server busy-signal if one is ever exported; today it is a fixed 5-second grace), shows "Updating to vX… restarting" in the tray, then quits, installs silently, and relaunches itself — kiosk-style, nobody at the keyboard, print server back up in seconds. Install-on-quit remains as a fallback for the rare download that lands exactly as someone closes the app.

### Verification
New unit suite for the push-event logic (payload shape, identical-version debounce, different-version always acts, stale versions deferred to the updater's own feed check). The workflow's Pusher signing was exercised for real from CI-like conditions — a correctly signed request reaching Pusher and rejected only on credentials proves the wire format without spending a real secret. All 12 suites green; root build green; secrets and signatures never appear in workflow logs.


## [5.7.0] - 2026-08-02
Undos on TwoTimTwo now actually undo: the count comes back down and the kid can be checked in again. Phones refresh themselves instead of showing 7:00pm data all night. And the PIN lockout stops punishing honest thumbs.

### An undone check-in is finally noticed
The printer's tally (and everything downstream: the lobby ticker, the gym display's corner counter) recounts its own label history — and nothing ever told that history about an undo made on TwoTimTwo's check-in report. The stale count survived all night, and the phone page kept the kid greyed out as "checked in", so a volunteer couldn't fix the mistake by just checking them in again.

The extension already polls `/clubber/checkin_report` (the authoritative "who's in tonight" table) every minute for label reconciliation (R-1, since 5.2). That same pass now posts the report's identity list to the print server, which diffs it against tonight's history:

- A kid present in history but gone from the report is marked **undone** (the record is kept — history doubles as the print log — just no longer counted). The tally rebroadcasts immediately, so displays drop within seconds, not at the next minute tick.
- `/phone/roster` stops reporting an undone kid as checked in, so **phones can re-check them in**; the fresh check-in prints a label, broadcasts, and counts once — latest record wins, deterministically, even across reprints.
- If the kid reappears in the report with no new print (the undo itself was the mistake), the undone flag clears in place.

Guards, because a bad scrape must never mass-undo a club night: the extension only posts a report that parsed successfully (an empty or bounced page never masquerades as "nobody's here"); a pass that would undo more than half of tonight's kids is skipped and logged as a suspect scrape; and visitor entries are never undo-marked (the report's coverage of first-timers is unverified) though reappearance can still clear a false undo on one. No event shapes changed — the display contract is untouched; the numbers just stopped lying.

### Phone screens refresh themselves
The phone page fetched the roster exactly once, at PIN entry. Every later change — another phone's check-ins, the desk's, an undo — was invisible until someone thought to pull-to-refresh a page that had no refresh. Now it re-fetches every ~12 seconds (same family as the dashboard's 15s polls), plus immediately when the screen comes back to focus and right after its own check-in resolves. Server truth merges into the list without touching a row whose check-in this phone still has in flight — the old renderer rebuilt every button on each paint, so a naive poll would have wiped a "Working…" button mid-check-in; transient state now lives outside the DOM precisely so a refresh can never eat a check-in in progress. Offline, the poll backs off to 60s and catches up on the first success; a wrong PIN (the desk changed it) stops polling cold and returns to the PIN screen rather than grinding the limiter in the background.

### The PIN lockout counts mistakes, not anxiety
Two compounding bugs made the lockout fire far earlier than its advertised 8 attempts. The unlock button had no in-flight guard, so a double-tap (or Enter-mashing on a slow network) sent the same wrong PIN two or three times — each counted. And every wrong request counted separately even when it was literally the same guess, so four honest typos worth of mashing could lock a phone. Now: the button disables while a request is out; and server-side, repeated identical wrong guesses from the same phone count as one failure (a salted hash of the last failed guess is compared — the guess itself is never stored). Distinct guesses still count, so the brute-force math is intact — a guesser has to vary PINs, and 8 distinct failures still locks for 60 seconds. The lockout message finally shows a live countdown from the server's own Retry-After instead of "wait a minute".

### Verification
New pure-function tests for the reconcile diff (mark, clear, reappear, latest-wins across reprints, visitor exemption both directions, the exact mass-undo boundary) and limiter dedupe (identical guess ×10 counts once; distinct guesses still lock; success still clears; per-address scoping intact), plus end-to-end HTTP tests: tally decrements and republishes on undo, the roster frees the kid, and a real re-check-in through `/print` after the real 25-second duplicate window counts exactly once. Full suite green, root build clean.


## [5.6.1] - 2026-08-01
Puggles labels are fixed: the club logo now prints as solid black instead of a ghost, and the meaningless "Puggles group" line is gone.

### The Puggles logo printed as a tiny speck
Every club's icon on TwoTimTwo is a standard Awana image except Puggles — this church's Puggles image is a custom upload (`/database/customFile/315`), and it is a **light-cyan** wordmark. A thermal printer has exactly two tones; the driver dithers everything else, and light cyan dithers to (almost) nothing. The only pixels dark enough to survive were the duckling's eyes and beak — so the printed label showed a tiny unreadable speck floating in the icon zone. And because a logo was "successfully" drawn, the club-name text line was suppressed too: the label carried no readable club identity at all.

Club logos are now prepared for what the printer can actually say (`prepareLogoForThermal`):

- **Anything opaque and meaningfully non-white becomes solid black ink.** The distance-from-white test is per-channel, so light-but-saturated colors — cyan, yellow, pink — count as ink even though their gray luminance is high. Gray luminance is exactly the measure the dither uses to erase them; that gap *was* this bug.
- **White stays white**, so white-on-dark logos keep their lettering as holes, and the duck's eyes survive as white cutouts in the silhouette.
- **The logo is cropped to its ink** before scaling, so artwork marooned in a padded canvas fills the icon zone instead of shrinking with its padding. The existing too-small-source check now measures the artwork, not the canvas.
- **A logo with no printable ink at all** (all-white, near-white, transparent, undecodable) falls back to the monogram badge — and, since no logo was drawn, the club name still prints as text.

All five standard Awana club images (Sparks, Cubbies, T&T, Trek, Journey) were rendered with the real assets from TwoTimTwo and come out crisper than before — solid black wordmarks instead of dithered color. The dashboard's Label Preview shows the binarized logo too, which is a feature: the preview now shows what the printer will actually produce.

### "Puggles group" no longer prints
TwoTimTwo assigns Puggles kids a pseudo handbook group — literally the string "Puggles group" — and it printed as an italic line under every Puggles name. Puggles is the toddler program: no handbooks, no handbook time, nothing to route to. The handbook-group line exists to send a child to the right table, so values that route nowhere now print as nothing (`effectiveHandbookGroup`): the "all" placeholder (existing rule, now centralized instead of pasted at four call sites), any Puggles group, and a group named after its own club ("Sparks group" says only what the icon already says). Real groups — "Sparks A", "Flight 3:16" — are untouched, end to end.

One of the four call sites was fixed in the process: the reprint path referenced a variable that is not in scope in that handler, and the driven-print path now judges the group against the club that actually prints (after the roster fill), so a club-less POST for a Puggles kid still drops the pseudo-group.

### Found by adversarial review, fixed in the same release
An independent multi-agent review of the diff caught a real regression the first 831 assertions could not see: **on inverted labels (first-timer visitors and award slips) the icon panel prints near-black, and the newly binarized black logo vanished into it** — black on black, with the club-name text also suppressed because a logo "was drawn". Logo ink now follows the label's palette (white on inverted labels), pinned by a golden case whose invariant counts LIGHT pixels in the dark icon zone — counting dark ink there would pass trivially, which is exactly how this slipped past the other five logo checks.

Also from review: club-less requests through `POST /label` (Print Dialog mode) and `GET /preview` now fill the club from the roster before judging the group — previously only `/print` did, so those two paths still printed "Puggles group"; the ink threshold was raised so a pale-gray card background reads as paper instead of becoming a black slab that swallows its own artwork; the too-small gate now measures the artwork's true source resolution rather than its size after the bounded scan; "T & T group" matches club "T&T" the same way `clubKey` already treats them as one club; and a PNG whose header claims absurd dimensions is refused before it is ever decoded.

### Verification
Rendered Marvin's exact label — the real custom Puggles asset, the real "Puggles group" value — and confirmed the wordmark fills the icon zone in solid black with no group line. Four new golden cases (light-cyan, padded, ghost, white-on-dark) with a new icon-zone invariant that counts only thermally printable ink (luminance < 128): with binarization removed, the cyan case drops to 0.10% zone coverage — the two-eyes speck from the photo, quantified — and fails. Negative-controlled the crop and the Puggles rule the same way. An end-to-end test proves enrichment through the real HTTP path produces a byte-identical label to the suppressed render while "Sparks A" survives. 843 assertions across eleven suites, all green.


## [5.6.0] - 2026-08-01
The display key is on the front page instead of buried, the extension says whether names are encrypted, and an app update now updates the extension too.

### "Where do I access the display key?"
It was in Settings → below Pusher → *Realtime privacy — display key*. Reachable, but only if you already knew it existed — which is a poor place for the one control that decides whether children's first names ride a public channel in the clear.

Three changes:

- **A "Names on the Welcome Screen" card at the top of the dashboard**, above the fold, before any tab. Green with the key fingerprint when names are encrypted; red and explicit when they are not — *"anyone who views a screen's page source can subscribe from anywhere and read every child's first name"*. Its **Set up the display key** button opens the Settings tab, scrolls to the key, and flashes it, so the button lands you on the control rather than at the top of a long form.
- **`http://localhost:3456/#display-key` is now a real deep link**, which is what the extension points at.
- **The card stays quiet for a church with no welcome screen.** No Pusher configured means no names on the wire and nothing to warn about.

### The warnings that should have made this findable were rendering BLANK
`/health` warnings are a mix of `{type, message}` objects and bare strings. The dashboard renders `w.message` — which is `undefined` for a string — so it painted an **empty yellow box**. Both realtime-privacy warnings and the phone-PIN warning were affected: the three loudest warnings in the codebase were the invisible ones. All warnings are objects now, and the renderer also tolerates strings so an older server paired with a newer page degrades to readable text rather than a blank rectangle.

Related: `publishState.configured` was only set by `publish()`, so from startup until the first event of the night the server reported Pusher as *not configured*. The privacy banner would have said "no welcome screen connected" to a church that has one — and only turned red after the first child's name had already gone out plaintext. It is now set when the Pusher client is constructed.

### The extension now says whether names are encrypted
Two places, because "the extension" means two different surfaces depending on where you go looking:

- **The check-in panel** on the TwoTimTwo page gets a status row: locked and green with the key fingerprint, or red with a link straight to the dashboard setting.
- **The extension's Settings page** (`chrome://extensions` → Details → Extension options) gets a *Realtime privacy — display key* card, directly below the Pusher card it belongs with. Same three states, plus an **Open the print server dashboard** button that lands on the key.

The Settings page shows status and links out rather than offering its own Generate button — and that is a deliberate choice, not an omission. It *could* show the key: it runs at a `chrome-extension://` origin, which the server trusts on loopback, which is why the Pusher secret already loads there. The reason not to is operational. Rotating the key blanks names on **every** screen at once until the new value is pasted into each one, and the safe ordering — generate, copy into the screens, only then save — is a sequence, not a button. Two surfaces implementing that sequence is two chances to get it subtly different, on the one control that can take every welcome screen down mid-club.

**State only, never the key — on both.** The panel is injected into a page served by twotimtwo.com, so anything rendered there is readable by that site's scripts, which is also why the server redacts `displayKey` for every non-loopback caller. A test asserts the panel cannot render the key even if `/health` were to send one.

### An app update now updates the extension
Previously the extension was not shipped in the `.exe` at all. Updating it meant: notice the version banner, find the zip, download, unzip, remove the old entry in `chrome://extensions`, Load unpacked again. In practice it drifts months behind the print server and nobody notices, because the check-in page keeps working — just against an older content script.

**What is not possible:** Chrome never auto-updates an unpacked extension, and it only honours a self-hosted `update_url` for Web Store or enterprise-policy installs. There is no silent update available for how this extension is distributed, and this release does not pretend otherwise.

**What is:** the folder Chrome loads is now a folder the installer owns.

- `chrome-extension/` ships inside the `.exe` as an extra resource.
- On every launch the app syncs it into `%APPDATA%\Awana Label Printer\chrome-extension` — a path that survives updates, unlike `resources/`, which an update replaces wholesale and would leave Chrome pointing at a folder that vanished.
- Load *that* folder unpacked once. From then on the cost of an extension update is **restarting Chrome**, and the widget tells you when one is owed: *"Extension v5.6.0 is installed — restart Chrome to load it"*, instead of the old "reload extension", which read as "go download it again".
- Tray → **Open Chrome extension folder**, and dashboard → Diagnostics → **Copy folder path**, so finding it is not a scavenger hunt.

The copy is careful because Chrome may be reading that folder while it happens: every file is written to a temp name and renamed into place (a half-written `content.js` is a broken extension on the one page that must not break), files dropped by a new version are removed rather than left to be loaded alongside new code, an identical version is skipped entirely rather than rewritten on every launch, and an implausible source folder is refused rather than mirrored into the operator's profile next to `config.json` and `clubbers.csv`.

The folder path is **loopback-only** in `/health`. The version travels to the check-in site (the extension needs it for the banner); the path does not, because it contains the operator's Windows username and `/health` is CORS-readable from that site.

### Verification
47 new assertions for the extension sync, plus new coverage of the privacy badge, the warning shape, and the loopback gate — 774 across eleven suites, all green. Each new guard was negative-controlled by removing it and confirming the tests go red: the stale-file prune, the source-size refusal, the loopback path gate, and the key-leak check. The extension's Settings page was driven in real Chromium with the extension actually loaded, at its real `chrome-extension://` origin — the first attempt served the page over http from a spare port, which the server's CORS allowlist correctly refused, so the harness was fixed rather than the allowlist. The dashboard was driven in real Chromium end to end — red banner and readable warnings with no key, the jump button scrolling and flashing the right block, the deep link, the Diagnostics path, and the banner turning green with only the fingerprint (never the key) after saving one.


## [5.5.1] - 2026-08-01
The check-in panel no longer traps you when you tick "Also register in TwoTimTwo".

> Split out of 5.5.0 rather than folded into it: v5.5.0 was already tagged and
> published — `.exe` and all — before this fix merged, so claiming it there
> would have described a release that does not contain it. The tag is not
> reusable either (republishing reuses the old ref, so the build would never
> pick up the new commit), which is why this is a new version rather than a
> re-cut.

### The panel could grow past the bottom of the screen with no way to scroll
Ticking **Also register in TwoTimTwo** reveals four more controls — guardian name, guardian phone, birthdate, and gender/grade. On a laptop at the check-in table that pushed the panel past the bottom of the window, and because the panel was `overflow: hidden` with no height limit and sat in a widget pinned at `top: 55px` with nothing constraining it either, the overflow was simply **clipped**. No scrollbar, no way to reach the fields — mid-check-in, with a child at the door.

Measured on a 700px-tall window: the panel already overflowed by 60px with the form closed, and by 199px with it open. Every one of those 199 pixels was unreachable.

The panel is now a column bounded by the viewport: the green header stays pinned (so the close button is always available — it is the escape hatch when anything else goes wrong), and the body below it scrolls.

Three things beyond the raw fix, because "it technically scrolls now" would not have solved the complaint:

- **A fade at the bottom edge when there is more below.** Styling `::-webkit-scrollbar` is not enough — Chromium draws overlay scrollbars that occupy 0px and only appear while you are already scrolling, so a panel with hidden content looks exactly like one that has been cut off. The fade is visible at rest, and disappears at the end of the list so it never implies content that is not there.
- **Ticking the box scrolls the form into view and focuses the first field.** A form that appears below the fold on an unchanged-looking panel is the same "where did it go" problem in a different shape.
- **The register box says "All four are required by TwoTimTwo".** It always did require all four, but previously said so only *after* Print was pressed.

Also: the panel is wider (320px), which stops "Night Test" and "Quick Mode" wrapping onto two lines; the scrollbar gutter is reserved so content does not jump when it appears; scrolling to the end no longer scrolls the page behind it; and restoring the panel after minimising keeps the column layout instead of collapsing back to a plain block.

Verified in a real browser at 1280x700 by injecting the actual content script: the panel stays inside the viewport with the form open, the body scrolls to its end, the grade selector and the close button are both reachable, and the fade appears and clears correctly. The same script run against the previous code reproduces the original overflow, so the test genuinely covers the reported bug.


## [5.5.0] - 2026-08-01
The server now starts on every launch of the app — including the very first one — plus a one-click Start Server button everywhere, an always-visible update status, and club logos that print crisp instead of speckled.

### The server starts the moment the app does
Field testing surfaced the gap: install the app, and nothing is listening on port 3456 until the setup wizard is completed — the server literally did not exist before "Save & Start" was clicked. Now the print server starts on every launch, first run included. Before setup it prints to the system default printer; the wizard save restarts it with the chosen one. The tray icon and its status appear immediately too, and first-run also registers the launch-on-boot entry (the wizard checkbox can still turn it off), so an installed machine comes back up printing after a reboot even if setup was interrupted.

Because the server module is require-cached across these restarts, its load-time printer name and config snapshot went stale the moment settings changed — with a pre-setup start it would have been frozen EMPTY. The Electron shell now pushes the saved printer and the merged config.json into the live module (`setPrinterName()` + `applySavedConfig()`) on every restart, the same live-sync rule that fixed the stale-PIN bug.

### Launching the app IS the fix
Double-clicking the desktop shortcut while the app was already in the tray used to just open the settings window. It now health-probes port 3456 first and starts the server if nothing answers — the operator's natural "it isn't printing" gesture actually repairs the situation. The same one-click start lives in the tray menu ("▶ Start print server" when it's down, "Restart print server" when it's up) and as a green **▶ Start Server** button right in the settings window's failure card.

### Auto-update you can see
The updater worked but was invisible until a download had already finished. The tray now always shows the installed version and exactly where the updater is: "Checking…", "Downloading update vX…", "⬇ Restart to update to vX", or "✓ Up to date". The settings window gained a permanent version card with a **Check for Updates** button that answers out loud — newest version, downloading (with percent), ready to restart, or can't reach the update server. `runAfterFinish` is now pinned explicitly in the NSIS config so install → app launches → server up stays true by contract, not by default.

### Club logos print crisp instead of speckled
The photo evidence: Sparks and T&T logos printing as pixelated mush. Root cause was in the extension — it captured every club image onto a fixed 64×64 canvas, and the label renderer then blew that up to a ~317-pixel icon zone (76pt at 300 DPI), a 5× upscale whose blurry edges the 1-bit thermal printer dithered into speckle. The extension now captures at up to 320px (never above the image's own resolution), and the renderer refuses to upscale any logo more than 2× — below that it falls back to the solid-ink monogram badge, which prints crisp, and keeps the club name in the text area since initials alone don't identify the club. Rejecting a too-small logo beats printing an unrecognizable one; update the extension to get real logos back at full quality.

The check-in panel no longer traps you when you tick "Also register in TwoTimTwo".

## [5.4.0] - 2026-08-01
Children's names are encrypted on the realtime channel. Plus volunteer training mode, a child-identity fix, two config-loss bugs, and CI that actually runs the tests.

### Demo mode: print a real label, touch nothing else
There was no safe way to rehearse. Driving a fake check-in through `POST /print` does the real thing in every respect, and each effect causes lasting damage during a practice run: `print-history.json` feeds `/checkin-csv-export`, which is imported **back into TwoTimTwo**, so a pretend child gets recorded as having attended; `attendance.json` is the permanent season ledger, and padding it makes real milestone lines ("10th club night!") wrong for the rest of the year; the `checkin` publish and recap buffer put a fake child's name on the lobby TV by name, mid-service; and `publishTally` inflates tonight's counts on every screen.

`POST /print` now takes `demo: true`. It prints a REAL label — so a volunteer sees actual output, with real roster enrichment and allergy icons — carrying the same diagonal TEST band `/canary` already uses, and skips all four effects plus the duplicate window (repeating a demonstration is the normal case, not a double-tap). A failing demo print is also silent: no history row and no `ops` print-failure event, so a training mishap never looks like a lost label. This generalises what `/canary` already did for one hardcoded name.

### Same-named children no longer merge into one history row
Print history was keyed on a lowercased "first last" string, so two children who share a name became one row. Three real consequences: the CSV export that TwoTimTwo re-imports recorded only one of them as present; tonight's stats under-reported the room; and a by-name `/reprint` could fetch the wrong child's label — and a label is a safety artifact carrying allergy icons and photo-consent flags.

The extension solved this on its side long ago with `identityKey()`, and has been **sending** TwoTimTwo's `clubberId` on every check-in all along — the server simply discarded it. It is now stored on the row and threaded through every writer. Identity is id-first with a name fallback, so rows written before the field existed still resolve and a mid-season upgrade doesn't orphan the night's history.

### The offline label now says what it cannot know
The extension's offline fallback renderer draws only first name, last name, club and icon — no allergy icons, no birthday, no photo-consent flag. It cannot do better: that path fires only when the print **server** is unreachable, and every safety field is derived server-side from the roster CSV, which the extension has never held.

So the hazard was never the missing icons — it was that the label still *looked* complete. A volunteer who has learned "no peanut icon means no peanut allergy" would read an offline label as safe. It now carries an inverted `OFFLINE — CHECK ALLERGY LIST` band (inverted so it survives a 1-bit thermal print and can't be mistaken for part of the normal layout). A label that admits what it doesn't know is safe; one that quietly omits an allergy is not.

### Children's first names are now encrypted on the realtime channel
The Pusher channel is **public**. Subscription is granted by possession of the app key, and that key must ship in the display's public bundle for a screen to connect at all — so anyone who viewed the page source could subscribe to `awana-channel` from anywhere in the world and watch every child's first name arrive live, every Wednesday, forever. This was not a misconfiguration: Pusher public channels have **no server-side authorization primitive**. It is absent from the product. The display repo's SECURITY.md documented the exposure at length and concluded that closing it would require a backend neither repo has.

It does not. `checkin`, `recap` and `birthdays` are now sealed with AES-256-GCM under a key only this server and the church's own screens hold, so Pusher relays ciphertext it cannot read. The other seven events (`tally`, `tonight`, `points`, `schedule`, `notice`, `ops`, `canary`) stay in the clear **on purpose**: they are counts and church-authored copy, none of it PII, and their readability is what lets a screen tell "the pipe is down" from "I can't read the names" from "quiet night". Encrypt everything and all three look identical — and the last one is the dangerous case, because nobody investigates a quiet night.

**The name events are the only thing that can stop.** Clock, weather, counts, countdown, slides and any CLUB CANCELLED notice never need the key. A missed setup step is never an emergency.

Setup is once, ever: dashboard → **Realtime → Generate display key**, then paste the same value into each screen (Settings → Connection → Display key), then press **Test Night Systems**, which gained a third `display key` stage that publishes a sealed test frame so a wrong key surfaces at 5:45 rather than mid-service. `/health` reports whether names are actually being encrypted and warns loudly when they are not, because "we set that up" must be a fact rather than a belief. Generating deliberately does **not** save the key — the operator copies it into the screens first, so a mistyped paste cannot lock every screen out of a key the server has already committed to.

Rollout has no flag day. The display shipped first and is plaintext-tolerant with no key set, and this server publishes plaintext until a key exists, so neither side can break the other by deploying first. Anti-downgrade lives on the consumer, where it belongs: once a *screen* holds a key it refuses an unsealed name event, so a silent downgrade is impossible in the configuration that matters.

Three details are load-bearing rather than polish:

- **Padding is part of the spec.** GCM is CTR-based and adds no padding, so an unpadded envelope reveals `len(firstName) + len(club)` exactly — and club is inferable by correlating the *plaintext* `tally`. Against a known roster over a season that is a real re-identification channel; it would quietly reduce the claim from "cannot read the names" to "can often guess the names". Every sealed `checkin` is padded to one identical size and a test fails the build if two ever differ. The bulk events use a coarse ladder instead, because a fixed worst-case pad would exceed Pusher's 10 KB per-event ceiling outright.
- **AAD binds a frame to its event name**, so a `checkin` ciphertext cannot be replayed as a `recap`.
- **A fresh random IV per frame.** Never a counter, never derived from a clock — a repeated (key, IV) pair in GCM is catastrophic rather than merely weak.

Two new suites, 104 assertions. `test-envelope.cjs` treats the negative cases as the actual product: wrong key, mismatched key id, a single flipped ciphertext byte, a tampered auth tag, a substituted IV, a truncated frame, and cross-event replay must all be **refused**, with no partial plaintext ever returned. `test-server-realtime.cjs` runs a real server and asserts a name genuinely leaves the process as ciphertext, that the key applies without a restart, and that printing still succeeds through all of it — the printing guarantee outranks the pipe, always.

Both repos are pinned to one committed interop fixture (`envelope-vectors.json`, mirrored byte-identically like `contract-vectors.json`). Two implementations of one wire format — Node's `crypto` here, WebCrypto there — is exactly the situation where both sides pass their own tests and no name ever reaches a screen. Verified beyond the unit tests: real Chromium opens all seven Node-sealed envelopes exactly and rejects both a flipped byte and a cross-event replay.

### `generateLabel` takes an options object
The renderer had **fourteen positional parameters**. Reading a call site meant counting commas to work out whether the seventh `false` was `isBirthday` or `stepUp`, and two callers had already drifted in exactly the way that invites: `/reprint` passes nothing for visitor, step-up, shares, the "Go to:" line or the milestone line — because print history never stored them, so a reprint has quietly differed from the label it reprints — and the connect card smuggles its greeting through the `handbookGroup` slot, which is why that greeting inherits a 30-character truncation nobody chose.

All ten call sites now pass one named object, and a non-object argument throws instead of rendering. That last part matters more than it looks: a leftover positional call would otherwise produce a label with a first name and nothing else — which prints, and looks almost right, which is the worst failure available for something carrying allergy icons.

The conversion is **byte-identical by construction** and the 18 golden-image baselines are the proof rather than the claim. They caught a real mistake during the work: 17 cases matched exactly while the all-fields torture case differed by 38% of its pixels, because one multi-line case had not been converted and was rendering a blank label. A signature refactor that only ran the unit tests would have shipped that.

The golden suite also learned something from CI. It gated its pixel comparison on `process.platform === 'linux'`, which turned out to be far too coarse: the runner is Linux too, with different font packages, so identical code rendered different glyphs and every baseline missed by ~9% of its pixels. A gate that red-lights on a font-package bump is a gate somebody deletes. The baselines now record a fingerprint of the font stack that produced them and compare pixels only when it matches, saying so loudly otherwise instead of either failing (noise) or passing silently (a lie). What CI enforces in its place is font-independent and genuinely load-bearing — determinism, ink coverage, and pairwise distinctness between cases — all three of which catch the blank-render bug above.

The golden cases are now declarative models rather than positional argument arrays, with a small adapter in the harness, so the next signature change touches one function instead of eighteen fixtures — and the baselines keep policing pixels across a refactor rather than being regenerated, which would let the gate certify its own change.

This is the groundwork for the per-club label template editor; it is landed on its own because it stands on its own.

### Who's still here — contract v4
TwoTimTwo's `/clubber/checkout` page turns out not to be a checkout *form*: it is the live list of children **currently checked in**, each with a button to check them out, and a row vanishes once they are. So "who is still here" needs no departure event to miss — it is simply the set of rows.

The extension scrapes that page (the print server cannot: only the volunteer's browser holds the TwoTimTwo session) and POSTs first names and clubs to `POST /feed/checkout`, which publishes a new `checkout` event. It is **sealed with the same AES-256-GCM transport** as the other name-bearing events, and it needs that more than they do: a list of children not yet with a parent is the most sensitive payload this system produces.

Four scraper guards, each stopping one specific way this could tell a lobby the building is clear while children are still in it: the page must positively identify itself (a redirect or session timeout reads as *unknown*, not *empty*); the data table is the **second** table, so a naive `querySelector('table')` would parse an unrelated notices table and find nobody; a **club filter left touched** by a volunteer makes whole clubs look picked up, so a filtered page is refused outright; and rows found but none parsed means selector drift, which is again *unknown* rather than *empty*. Only the page's own "nobody is checked in" placeholder may publish an empty board. All four were verified by removing each guard and watching the suite go red.

The `printed` count is filled in by the **server**, not trusted from the extension, and is computed on the **local** calendar day. That distinction matters: history timestamps are UTC, and a 17:30–20:00 club night straddles UTC midnight for most of the US winter, so a UTC-day filter would silently drop the second half of the night and publish a fresh, plausible, badly-wrong number in the middle of pickup.

**This feature is not a headcount and the display is required to say so.** It reflects whether volunteers *recorded* checkout, which during a pickup rush often lags. The board is off by default, stops naming individuals once the list gets short (a list of two names points at two specific unattended children), and words everything as "not checked out yet".

A new suite (`test-checkout-parser.cjs`, 42 assertions) covers the parser, all four guards, the feed validator and the transport. It needs a DOM, so `jsdom` joins devDependencies — pinned to `^25` deliberately, because jsdom 26+ pulls an undici that calls a Node 21+ API and would break `npm test` on the Node 20 that CI and the shipped Electron app both run.

### Clearing a PIN or a key now actually clears it
Found while testing the above, and the more serious half of it is **pre-existing**. Both `POST /config` paths can delete a key — `delete next.phonePin` when the operator clears the PIN, `delete next.displayKey` for the display key — but the live-process sync was `Object.assign(config, next)`, and `Object.assign` copies properties without ever removing them.

So clearing the phone PIN wrote `config.json` correctly while the running auth gate, which reads `config.phonePin` per request, **kept accepting the old PIN until someone restarted the server**. An operator revoking a PIN they believed had leaked had every reason to think it was gone; it was not. `applySavedConfig()` now makes the live config mirror the file exactly, deletions included, and the regression test asserts both the PIN and the display key really do stop working the moment they are cleared. Verified by restoring the old one-line behaviour and watching all three assertions fail.

### Saving Electron settings no longer erases the security config
`config.json` has several writers with very different views of it. The print server owns the security and realtime keys — `phonePin`, `lanAccess`, `allowedOrigins`, the four Pusher credentials — plus the `schedule`, `historyRetentionDays`, `connectCard` and `worksheetPrinter`. The Electron setup wizard owns exactly three: `printerName`, `checkinUrl`, `launchOnBoot`.

The Electron writer replaced the whole file with the renderer's three-key object, so one click on Save in Settings deleted every server-owned key — and because the handler restarts the server immediately afterwards, the loss went live at once. Three unrelated failures from one click, none of them reported: phone check-in refused every request (the v5.3.0 gate fails closed with no PIN, which is the safe direction but looks like a broken phone page), the lobby TV lost its Pusher credentials and went dark, and late arrivals stopped being routed because the schedule was gone. The realistic trigger is the worst possible moment — the printer jams mid-event, a volunteer opens Settings to pick the backup printer, and saves.

Writes are now a **merge** of the renderer's patch over what is on disk, via a new `electron-app/src/config-store.js` that is deliberately Electron-free so it can be unit-tested, and are written tmp-then-rename so a crash mid-write cannot truncate the file either. The `save-config` handler now acts on the merged result rather than the patch, since the patch alone lacks everything `startServer` needs.

Separately, the deprecated PowerShell installer read-modify-writes correctly but called `ConvertTo-Json` with no `-Depth`; PowerShell 5.1 defaults to depth 2, which serialises `schedule[].label` as a type-name string instead of JSON — silent corruption rather than clean loss. Both call sites now pass `-Depth 10`.

A sixth suite (`test-config-store.cjs`, 31 assertions) covers the merge, first-run creation, corrupt and non-object config files, and the `-Depth` flag. Because the bug was a bare `writeFileSync` in `main.js` rather than a wrong merge, it also asserts at the source level that nothing bypasses the store. Both halves were verified by reintroducing each bug and watching the suite go red.

### CI runs the test suites now
All four suites — event contracts, server helpers, the v5.3.0 trust model, extension identity — existed and passed for several releases while being invoked **only by hand**. The only automated check was the label render smoke test. So the security suite proving the roster isn't reachable from the network could have started failing and no push would have noticed.

`webpack.yml` gains a test job and its push trigger widens from `main` to every branch; `build-electron.yml` gains the same job and `build` now needs it, so a tag cut from a green `main` still can't publish an `.exe` without re-verifying the contract and the trust model. Verified by breaking `security.js`'s loopback check and watching CI go red.

A fifth suite (`test-server-demo.cjs`, 23 assertions) covers demo mode. Its tests are deliberately paired: every "demo writes nothing" assertion has a control running the same request WITHOUT the flag and asserting it DOES record — otherwise the suite would pass just as happily if `/print` were inert. 713 assertions now pass across ten suites.

## [5.3.0] - 2026-07-27
Security and privacy release. An audit of both repos found that the print server exposed children's names and allergy data to anyone on the church network, and to any website open in the volunteer's browser. Nothing here changes how a label prints; all of it changes who can read the roster.

**Nothing was leaked into git.** No roster CSV, history file or Pusher secret has ever been committed to this repo — that was checked across the full history. The exposure was on the running server, and in what a *future* commit could have published (see the `.gitignore` item below).

### The server was listening on every network interface
`app.listen(PORT)` omits its host argument, which binds `0.0.0.0` — every interface — even though the file header claimed "listens on http://localhost:3456". Combined with no authentication on the roster endpoints, any device on the church WiFi (guest network included, if it is flat) could fetch tonight's children and their allergy list:

```
curl http://<laptop-ip>:3456/stats/tonight
```

That endpoint returns full names, **allergy tokens**, birthday-week children, and the **no-photo-consent** list. `GET /history`, `/checkin-csv-export`, `/siblings` and `POST /phone/roster` were comparably open.

The server now binds **loopback only** by default. A default install is not reachable from the network at all — not merely PIN-protected there. LAN access (needed for phone check-in) requires the new `lanAccess` setting **and** a PIN; enable it without a PIN and the server stays on loopback, says so at startup, and raises a `/health` warning rather than silently exposing the roster.

### The phone PIN failed open, and was brute-forceable
`phonePinOk()` began `if (!pin) return true` — no PIN configured meant *no check at all* on the LAN, so the default install served the whole roster to the network. It also compared with `===` (timing-leaky) and had no rate limiting, so a 4-digit PIN fell in seconds. And `GET /config` handed the PIN out to any caller with no `Origin` header — i.e. to `curl` from any phone on the WiFi — which made the PIN self-defeating.

Now: PIN enforcement fails **closed**, uses a constant-time compare, locks an address out after 8 failures, and is applied by a single app-level gate ahead of every route instead of a per-route opt-in that `/stats/tonight`, `/history` and `/checkin-csv-export` had simply never been given. The Pusher secret and the PIN are readable only from loopback, never from the LAN even with a valid PIN.

### `Access-Control-Allow-Origin: *` let any website read the roster
`app.use(cors())` set a wildcard ACAO on every response, and a browser lets a page **read** a response bearing that header. So any site the volunteer visited while the server ran could `fetch('http://localhost:3456/stats/tonight')` and take the names and allergies — no network access required. The old code's own comment noted that a hostile tab could POST here; the read side was the larger hole.

CORS is now an allowlist (the extension, `*.twotimtwo.com`, this server's own pages, plus an optional `allowedOrigins`) which echoes the exact origin and never `*`. Mutating requests carrying a non-allowlisted `Origin` are refused outright — a form POST is never preflighted, so the allowlist alone would not have stopped writes.

The origin check guarding the secrets had a second hole: it accepted `origin.endsWith(':3456')`, so a page served from `http://evil.example:3456` qualified. It now requires a loopback host as well as the port.

### Stored XSS in the dashboard, escalating to secret theft
`POST /print` is unauthenticated and wrote `firstName`/`lastName` verbatim into `print-history.json`; the dashboard rendered them with `innerHTML` unescaped. A crafted name therefore became script running on `http://localhost:3456` — the one origin trusted with the Pusher secret and the PIN — which it could then read from `/config` and exfiltrate. The allergy, no-photo and birthday flag lists, the club chips, the failures list and the diagnostics rows had the same defect, and the schedule editor had the attribute-injection variant.

Every interpolation of an outside value now goes through `esc()`. Names are also length-capped and control-character-stripped on the way into the history file, but the output escaping is the actual fix. A static check in the test suite fails the build if any of those fields is interpolated unescaped again — verified by reintroducing the bug and watching it fail with the line number.

### A poisoned config could hand an arbitrary URI to the Windows shell
`POST /config` gated only `pusherSecret` and `phonePin`, so **any** origin could set `checkinUrl`, with no validation whatsoever. That value reaches `shell.openExternal()` (Electron, at launch and on tray click) and `Start-Process` (legacy installer) — both of which pass a non-`http` scheme to the OS handler. `checkinUrl` is now validated as plain `http(s)` before it is persisted *and* again at each sink, the same treatment `worksheetPrinter` already had.

### `.gitignore` did not cover the files a live install writes
The important one for anyone who forks this repo. `DATA_DIR` defaults to `print-server/` itself for legacy script installs, so a running install writes **inside the git working tree** — but only `clubbers*.csv` was ignored. A `git add -A`, or a pull request from a machine that had run the server, would have published `config.json` (**the Pusher app secret and the phone PIN**), `households.csv` (guardians, addresses, phone numbers), `print-history.json` and `attendance.json`.

All of those are now ignored. New `SECURITY.md` documents the trust model, what it deliberately does *not* defend against, and a fork checklist: audit history for committed data, rotate credentials, set your own church identity, and point `install-and-run.ps1` at your own repo (`$RepoSlug` — a fork previously downloaded *upstream's* code, silently discarding its own changes).

### Real children's names in the sample data
The public marketing page rendered a real child's first and last name on its example label, and `data.ts` carried two more in its mock roster — inherited by every fork and published to GitHub Pages. Replaced with synthetic placeholders matching the file's existing style.

### Installers ran unverified downloads with admin rights
`install-and-run.ps1` downloaded the Node.js and PowerShell 7 MSIs and executed them elevated with no integrity check. HTTPS from a known host is a reasonable trust anchor, but not a sufficient one for an elevated execution. Both are now Authenticode-verified (publisher, not a pinned hash, so it survives a version bump) and refuse to run otherwise.

### Also
- History is pruned by **age** as well as row count (`historyRetentionDays`, default 60) — a quiet church previously kept every child's name and check-in time indefinitely. Pruning applies on read, so an existing over-long file shrinks on the next run.
- Removed the `cors` dependency; the policy is 40 lines in `security.js` and no longer needs it.
- `AWANA_PORT` added so the test suite can bind off 3456 without colliding with a real install. The default is unchanged.
- The phone page now distinguishes "locked out" from "wrong PIN" instead of reporting a WiFi problem.
- New `print-server/security.js` holds the whole trust model as pure functions, with 100+ unit assertions in `test-server-helpers.cjs` and 72 end-to-end assertions in the new `test-server-security.cjs` — including one that starts a default-configured server in a child process and proves it cannot be reached on the LAN address at all.

## [5.2.2] - 2026-07-27
Two label-rendering fixes found by actually looking at rendered labels rather than only asserting on them in tests.

### The handbook group could be hidden behind the allergy icons
The bottom-right icon row (allergies, birthday cake, share balance, do-not-photograph) is right-anchored on the same band the handbook-group line occupies, so a child with several icons had their group text running underneath them — "Flight 3:16" was partly covered by a cake and a peanut. The handbook group is what sends a child to the correct table, so it has to stay readable. That line now reserves the icon row's width and centres in the space that remains.

### Print Dialog mode dropped the first-timer palette
`POST /label` — the render behind "Print Dialog" mode and the preview image — never passed the extras that `POST /print` does, so a first-time visitor's label came out on a normal white background instead of the inverted palette auto-printing gives them, and late-arrival routing text was missing too. Both paths now build the same extras. (Attendance milestones are deliberately still excluded from this path: that text comes from recording a check-in, and a preview must not record one.) This is the same shape of bug as the photo-consent fix in 5.2.0 — a feature applied to one render path and not its sibling.

## [5.2.1] - 2026-07-27
**The v5.2.0 Windows build did not publish** — its install smoke test caught a packaging bug, so no broken `.exe` ever reached anyone. 5.2.1 is the release that ships.

### The packaged app was missing a module and died on startup
`electron-builder` copies the print server into the app via an `extraResources` **filter that enumerated files by name**. The new `print-server/feeds.js` was never added to that list, so it worked in development and passed every local test, but the installed app's server crashed immediately with `Cannot find module './feeds'` and never answered `/health`. The filter now globs `*.js`, so any future print-server module is packaged automatically.

More importantly, this class of bug can no longer wait 15 minutes for a Windows runner to reveal it: the test suite now cross-checks every local `require('./…')` in the print server against the packaging filter and fails immediately if a module wouldn't ship. Verified by reproducing the exact regression — with `feeds.js` removed from the filter, the suite fails with a message naming the file and the fix.

### Extension fix: a navigation label could be published to the lobby TV as a church announcement.

The new announcement feed looked for an "active" marker on TwoTimTwo's messages page and, absent one, fell back to a bare `.active` selector. TwoTimTwo is a Bootstrap app, where `.active` marks the **current navigation tab** — the check-in pages carry `<li class="active">` in their own tab strip. So on a page with no real active-message marker, the parser would pick up a nav label like "Checkin Report" and broadcast it as an announcement for the lobby screen to display. Now restricted to table rows and an explicit data attribute, with anything inside a nav, tab strip or pagination container rejected outright. The conservative fallback (only read a message when the page has exactly one unambiguous data row) is unchanged.

Version-only bump for the rest of the app: the `.exe` does not contain the extension, so this is an extension-side fix. It ships as 5.2.1 rather than a second 5.2.0 so the downloadable extension zip can't drift from the version the server reports — mismatched versions make the widget nag about a phantom update.

## [5.2.0] - 2026-07-27
The whole "future possibilities" backlog from v5.1.0 — all fourteen items — is now built. v5.1.0 validated what TwoTimTwo actually exposes; this release uses it. The theme: the printer stops guessing and starts asking TwoTimTwo directly, and the screens start showing what TwoTimTwo already knows.

### No child gets missed: check-ins are now reconciled against TwoTimTwo itself (R-1)
Remote check-in detection worked by watching rows disappear from the check-in page's roster — so if a row was missed (a search filter, a re-render, a browser hiccup), that child silently never got a label. The extension now cross-checks TwoTimTwo's own **check-in report** every minute during club and prints anything the diff detector missed. Three safety properties were designed in before the feature: the **first pass never prints** (it seeds dedup from whoever is already checked in, so opening a station mid-event cannot print the entire roster), the baseline is cleared with the other stale-session keys so a new club night re-baselines instead of reprinting the room, and **a pass prints at most 5 labels** — a bigger gap means something is wrong and a volunteer must not be handed sixty labels. The reverse check (printed here but absent from the report) is telemetry only: it surfaces a count and never prints or unprints. A "Sync now" button runs it on demand.

### Labels are tied to a child, not a name (R-4)
Dedup was keyed on lowercased display name, so two children sharing a name were one record. Identity now prefers TwoTimTwo's own clubber id and falls back to the name, threaded through the roster cache, the printed set, and the print payload. Two dedup holes found while reviewing this are fixed: a hand-typed walk-in recorded under a name key would print a **second** label once registration checked them in and the reconcile report returned a real id; and name keys only trimmed their ends, so the report's markup (the name sits between two links, and can carry padding or a newline) could yield `jane  doe` against the roster's `jane doe` — one child treated as two, another duplicate label.

### Siblings are now looked up, not guessed (R-3)
The roster export carries no household id, so "Also here tonight?" had to infer families from phone and address heuristics. The household CSV — whose *Active Clubbers* column lists each household's children directly — is now synced every 30 minutes and is the primary source, with the heuristics kept only as a fallback. `GET /siblings` also accepts a clubber id, so duplicate names resolve to the right family.

### Allergy icons: fewer false alarms, and never a false negative (R-5)
Allergies come from a free-text Notes field, so parsing was noisy ("loves coloring" produced a dye icon). Parsing is now negation-aware — "no known allergies" yields nothing — and the dye match requires a food-dye sense. Critically, **text after an exception marker is always scanned**: "no known allergies except peanuts", "none other than dairy" and "not allergic to nuts but is allergic to eggs" all still flag. Suppressing a whole clause silently dropped those allergies, which is the one direction this code must never fail in. All locked in as regression tests.

### New at the check-in table
- **Award slips (F-1)** — when a child finishes a book or earns an award, a slip prints alongside their label, sourced from the meeting report. Flagged in history so it never masquerades as a check-in in the reprint list.
- **Direct check-in (F-2)** — sibling, phone and Quick Mode check-ins called TwoTimTwo by clicking its modal and polling for the button. They now post to the check-in endpoint directly, with the old click-and-poll path kept as a fallback.
- **One-step walk-ins (F-3)** — the walk-in box can now also register the guest in TwoTimTwo. The label prints regardless of whether the form succeeds.
- **Leader worksheets (F-4)** — handbook agenda PDFs can auto-print at meeting start. Opt-in, because a surprise stack of letter-size paper is worse than none.
- **Attendance safety net (R-2)** — `GET /checkin-csv-export` produces a CSV in the exact format TwoTimTwo's own check-in import expects, so a station that lost its connection reconciles a night's attendance instead of hand-entering it.

### The screens now show what TwoTimTwo knows (D-1 … D-5)
Four new PII-free event types (contract v3: `tonight`, `points`, `schedule`, `notice`) carry aggregates from TwoTimTwo's own reports to the displays: a **lobby ticker** of tonight's counts, a **color-team points scoreboard** on the projector, **calendar-driven next-meeting awareness** so the countdown stops relying on a hand-maintained schedule, and **announcement/cancellation alerts** where a cancellation renders as an unmissable full-width bar. Trek and Journey are also no longer dropped by the projector's club code — their birthdays were silently never celebrated.

### Security: remote code execution in PDF printing (found and fixed pre-release)
Worth calling out plainly. The new worksheet-printing path built a PowerShell command by escaping the printer name for single quotes and then embedding it in a **double-quoted** string — so a name containing a double quote ended the string early and the rest ran as commands. Because the print server intentionally accepts requests from any page on the machine (that is how the browser extension reaches it), **any website open in a volunteer's browser could have run arbitrary code on the laptop being used to check children in.** A persistent variant existed too: the fallback worksheet printer was settable from any origin, so it could be poisoned once and fire later during a legitimate print.

Fixed at the root rather than patched: the file path and printer name are no longer interpolated into the script at all — they are passed to the child process as environment variables, so no value can break out of a string. A validator was added as a second layer (a Windows printer name is a plain label, so quotes, shell metacharacters and control characters mean it is not one) and applied at every entry point including the config write, so a bad value cannot even be stored. The published exploit payload is now refused, verified by test, with 13 regression checks pinning the validator.

Two duplicate-print paths were fixed alongside it: award slips were deduplicated per browser session rather than per date, so closing and reopening the tab reprinted every slip already earned that night (the meeting report keeps listing them); and award dedup ignored the clubber id it already had, so two children sharing a name could suppress each other's slip.

### Check-in defects found by reviewing this release (all fixed pre-release)
A second adversarial pass over the label-printing paths found five more ways a child could get a duplicate label, no label, or **another child's data**. The worst: two children who share a display name resolved to whichever roster row was scanned most recently, so a label could print carrying the other child's club, photo consent and allergy data — and mark that other child as printed, so she then never got a label at all. Names that map to two children are now treated as ambiguous and the code refuses to guess; the right name still prints, and one child's safety data can never be attributed to another. Also fixed: a walk-in could be printed twice once registered (it was the one path that never recorded its print); reconcile could permanently consume check-ins if it fired while printing was switched off; two same-named children checking in within 25 seconds collided in the server's duplicate window so the second was silently never printed; and the new direct check-in double-recorded attendance because posting directly bypasses the handler that removes the roster row, so verification could never succeed and it always fell back to also checking the child in the old way.

### Privacy and safety of the new surface
The only free-text field ever added to the channel is a notice message, and only because it is church-authored copy written *for* public display; it is capped and forced to plain text on both the producer and the consumer. Everything else is counters, team names and dates — the calendar parser reads only the start date and title, never attendee or organizer data. Two hardening fixes landed during review: request-body limits are **scoped** so only the PDF route accepts a large body (CORS is deliberately wide open here so the extension can reach the server, which also means any page the volunteer has open can POST — a global 18 MB limit would let a stray tab push megabytes through a laptop mid-event), and the household ingest refuses a payload that parses to zero households while a good map is loaded.

### Testing
The Chrome extension had **no test coverage at all** before this release. It now has a suite covering the identity/dedup logic that decides whether a child already has a label — and because `content.js` is a single IIFE that exports nothing, the tests extract the real function source and evaluate it rather than re-implementing it (a copy would pass while the shipped code broke). That suite caught the whitespace bug above. Totals: **241 checks in the printer repo** (141 contract + 83 server + 17 extension) and **503 in the display repo**, plus the headless label render and the Playwright countdown-boundary suite.

## [5.1.0] - 2026-07-26
Validated the whole roster/check-in integration against the **real** TwoTimTwo site (kvbchurch.twotimtwo.com) for the first time, instead of the assumed formats it had been coded against. The check-in DOM contract, the `/clubber/csv` export, and the check-in AJAX endpoints are now captured in `docs/TWOTIMTWO.md` so nobody has to re-scrape the site to understand it. Several enrichment paths that were quietly keyed to the wrong columns are fixed, and clubber identity is now anchored to TwoTimTwo's own id.

### The photo/no-photo icon read the wrong consent column (print server)
The real export carries **two** separate consent columns — `Med Release?` (medical treatment) and `Photo Release?` (photography). `HEADER_MAP` folded both onto a single `MedRelease` key, so which one actually decided the label's no-photo camera icon depended on CSV column order — and semantically it was keyed off *medical* release, not photo release. `Photo Release?` now maps to its own `PhotoRelease` field and the no-photo flag reads that, falling back to `MedRelease` only for older single-column/manual rosters. A child whose family declined **photos** is now correctly flagged regardless of their medical-release answer.

### Roster columns were named for a format the site doesn't emit (print server)
`HEADER_MAP` expected `Household ID`, `Primary Contact`, `Address`, etc. The real `/clubber/csv` has none of those — its family columns are `Parent/Guardian#1`, `Parent/Guardian#2`, `Address1`, and `Primary Phone`, and several headers end in a literal `?`. `normalizeHeader()` now strips trailing punctuation, and the new mappings mean sibling detection and allergy/group/birthday enrichment actually engage on real rosters instead of silently degrading to last-name-only grouping and basic labels.

### Sibling grouping now uses the phone number the export actually carries (print server)
The real export has no household id, so `buildFamilyIndex()` was falling all the way through to last-name grouping — which wrongly merges two unrelated "Miller" families and misses blended families with different last names. It now groups by normalized `Primary Phone` first (then guardian+address, then a type-prefixed fallback chain), so blended families are detected and unrelated same-surname families are kept apart. Manual/template rosters with a real `HouseholdID` still take priority.

### Labels are matched to the exact clubber, not just the name (print server + extension)
The extension now reads TwoTimTwo's own `recid`/`club_id` off each `.clubber` row and sends `clubberId` with the print job; the server matches the CSV's `Clubber ID` column exactly before falling back to name matching. Two kids named "Ava Brown", or a middle name on the roster, no longer risk pulling the wrong allergy/photo data. Detection paths that never saw a page row (e.g. a station that loaded mid-event) now backfill the club from the roster so the label isn't club-less.

### New: server-helper test suite pinned to the real export format
`scripts/test-server-helpers.cjs` (wired into `npm test`) exercises `parseCSV`, `normalizeHeader`, `buildFamilyIndex`, `findClubberIn`, and the photo-consent logic against a fixture whose header is the **verbatim** 66-column real export line. If TwoTimTwo renames a column, these tests fail loudly instead of labels silently losing data on a Wednesday night. 41 checks, plus the existing 91 contract checks.

### Post-review hardening (same version, pre-release)
An adversarial review of the above changes caught three real issues, now fixed:
- **No-photo flag was only half-migrated.** `/print` and `/label` read the new
  `Photo Release?` column, but `/reprint`, `/preview`, and the dashboard
  no-photo safety list (`/stats/tonight`) still read `Med Release?` — so a
  reprinted label or the director's "do not photograph" list could disagree
  with the original label for any child whose two consent answers differ. All
  five paths now go through a single `noPhotoFor(record)` helper.
- **Phone-based family grouping could over-merge on placeholder numbers.** A
  sentinel like `000-000-0000` or a shared office line typed into many rows
  would have collapsed unrelated families into one giant sibling group. Phone
  keys now require a full 10–15 digit number with at least 3 distinct digits
  (normalized to the last 10), and contact-name grouping comes before address
  so a family with an inconsistently-filled address still groups — restoring
  the pre-phone `PrimaryContact`-alone behavior for manual rosters.
- **Extension identity could desync for identical names.** The cached `recid`
  was frozen to the first-scanned row while the clickable element tracked the
  latest, so two kids with the same display name could click one row but send
  the other's id. `recid`/`club_id` now move with the element every scan.

Known follow-ups (see the Capabilities & Roadmap page, R-4/R-5): two children
with an *identical* first+last name are still deduped/grouped by name in the
extension and in `GET /siblings` (no clubberId disambiguation there yet); and
allergy parsing intentionally stays permissive on the free-text `Notes` field
(an extra icon is safer than a missed allergy).

## [5.0.3] - 2026-07-25
Bug-fix sweep across the print server and the Chrome extension. No new features; several of these were failing silently.

### Roster enrichment was dead whenever the CSV carried a BOM (print server)
`parseCSV()` didn't strip the UTF-8 byte-order mark. Because TwoTimTwo's export quotes its fields, the BOM sits *before* the first opening quote, so the field parser took the unquoted branch and returned the first header as `"First Name"` — quotes and all. `HEADER_MAP` missed it, every row came back without a `FirstName`, and `findClubber()` therefore matched nobody: allergies, handbook group, birthday cake, and the no-photo flag vanished from **every** label while the server logged a healthy roster count. The mark is now stripped before parsing.

### A bad roster sync could blank the roster for the night (print server)
`POST /update-csv` wrote the payload to `clubbers.csv` and then replaced the in-memory roster with whatever it parsed to — including zero rows, e.g. when the site answers a sync with a login redirect. Both the memory copy and the on-disk copy were destroyed. The CSV is now parsed *before* the write, and a sync that yields zero rows while a good roster is loaded is rejected with 422 and leaves both copies intact.

### Pusher secret and phone PIN were readable by any website (print server)
CORS is deliberately wide open so the content script on twotimtwo.com can reach the print endpoints — which also meant any page open in the volunteer's browser could `fetch('http://localhost:3456/config')` and read `pusherSecret` and `phonePin`, or POST new ones. Those two fields are now limited to callers that legitimately edit them: same-origin requests (the dashboard), `chrome-extension://` origins (the options page), and any origin on the server's own port (the dashboard over the LAN IP). Everything else gets the config with those keys omitted, and a cross-site POST that touches them is refused with 403. Non-secret reads and writes are unchanged, so the extension's `enableDrivenCheckin` lookup still works.

### Saving settings stacked duplicate publish timers (print server / Electron)
The Electron shell restarts the server on every settings save, and `startListening()` re-ran its one-time startup block each time — so each visit to Settings added another set of tally/recap/birthday intervals to the same process and re-fired the prewarm blank print. The startup block now runs once per process.

### Labels 500'd on an explicitly-null club name (print server)
`generateLabel()` called `.trim()` on `clubName`/`lastName` directly. A payload with `clubName: null` defeats the default parameter, so the render threw, the check-in returned 500, and the failure was recorded as a print failure. Text inputs are coerced before layout. Repeated query params on `GET /preview?clubName=…` and `GET /siblings?name=…` (which Express hands back as arrays) are coerced the same way.

### Typing a walk-in guest's name froze remote check-in detection (extension)
`isSearchActive()` pauses the roster-diff scan while a page filter is active, and tried to exclude the widget's own inputs via `closest('#awana-printer-widget')` — but the widget's id is `awana-widget`, so the test never matched, and the walk-in guest field has no id, so the `awana-walkin` prefix test never matched either. Any text in that box therefore stopped remote/phone check-ins from printing until it was cleared. The same wrong selector in `scanCalendarFor()` (which meant our own panel text was scanned for "step up"/"store") is fixed too.

### The check-in page reloaded itself on non-club nights (extension)
The peak-window auto-refresh checked only the clock (5:40–6:00 PM) and never the day, so a tab left open on any other evening reloaded every 30 seconds. It now requires the configured club-night window as well.

### Label markup escaping (extension)
The offline fallback label built its HTML by string concatenation with unescaped names, club names, and the icon URL, all read from the page DOM. They now go through an escape helper.

## [5.0.2] - 2026-07-17
**Stale extension download fixed:** the committed `chrome-extension.zip` (root + `public/`, the file behind the website's "Download chrome-extension.zip" button) still contained the **4.0.0** extension — nothing regenerated it on version bumps, so the site had been serving a two-major-versions-stale extension. Both zips are rebuilt from the current source, and `scripts/bump-version.cjs` now regenerates them on every bump (`zip` on Unix, `Compress-Archive` on Windows) so they can't drift again. Also cleaned up release-page clutter: deleted the empty stray releases/tags (`V5.0.2`, `5.0.1`, `v5.0.1`, `v5.0.0`, `release`) left behind by failed/manual release attempts — a stray "latest" release breaks electron-updater for real users, and a new `delete-release.yml` workflow now exists for this cleanup.

CI-only fix, round two: after 5.0.1 fixed the install-path race, the very next step in the same smoke test broke for the same underlying reason — the CI script's "Seed config and launch" step hardcoded `%APPDATA%\Awana Label Printer` for the app's config file, but the install step had just proven electron-builder names the app folder after package.json's `"name"` field (`awana-label-printer`), not `"productName"`. Guessing the userData path the same way would have hit the identical bug. `.github/workflows/build-electron.yml` now launches the packaged app with `--user-data-dir` (a native Electron/Chromium switch) to pin its data directory explicitly instead of guessing, and captures the app's stdout/stderr to log files that get dumped automatically if `/health` never responds — so any future failure here is diagnosable from logs on the first try instead of another blind guess-and-retag cycle. No application behavior changes.

## [5.0.1] - 2026-07-17
CI-only fix: the release pipeline's Windows install smoke test had a race — the one-click NSIS installer's silent stub can return from `Start-Process -Wait` before a detached child finishes copying files, so a single `Test-Path` check immediately after install intermittently (reproduced on two separate CI runners) reported the app missing even though the build itself was fine. `.github/workflows/build-electron.yml` now polls for the installed exe (up to 60s) and dumps directory/registry diagnostics if it still doesn't appear, instead of a one-shot check right after `-Wait` returns. No app behavior changes in this release.

## [5.0.0] - 2026-07-17
The Windows app (`Awana-Label-Printer-Setup.exe`) becomes the single supported install path — download, run, pick a printer, done. The PowerShell script install is deprecated (still works this release; migrated automatically).

### Print server is now truly portable (root cause of the "slim fallback" problem)
Swapped `canvas` for `@napi-rs/canvas`: prebuilt ABI-stable N-API binaries load identically under plain Node and inside packaged Electron, killing the native-module failure that silently degraded installs to the feature-poor slim server (which is now **deleted** — a server failure shows a visible error box + red tray state instead of quietly printing worse labels). Also ~40 MB of deps instead of ~300 MB. Writable files (config.json, clubbers.csv, history, attendance, event buffer) moved behind `AWANA_DATA_DIR` (Electron sets it to `%APPDATA%\Awana Label Printer`; legacy installs keep writing next to server.js). A bare `require()` of server.js now has zero side effects — sweep/roster-load/publish-timers/prewarm run in `startListening()`, and the legacy VERSION-poll self-update only runs when launched directly (it used to run inside Electron and would have tried to patch files inside the packaged resources).

### Auto-update via electron-updater + smoke-tested releases
The app checks GitHub Releases, downloads in the background, and installs on quit or via the tray's "Restart to update" (never forces a restart mid-club-night). `/update-now` delegates to the shell via the new `setUpdateHandler()` export (legacy installs keep the exit-99 launcher dance). CI now: installs print-server deps **before** packaging (the old workflow shipped an empty `node_modules` — the packaged full server could never load), runs a headless label-render smoke test with PNG artifacts, builds the installer, silent-installs it on a Windows runner and asserts the FULL server answers `/health` + `/preview` with the tagged version — and only then attaches the exe + `latest.yml` + blockmap to the release.

### Foolproof first run + migration from script installs
First launch imports config/roster/history from `C:\output\Print-TwoTimTwo-Labels\print-server`, prefills the wizard, and offers to remove the old desktop/Startup shortcuts. If something else holds port 3456 (usually the old auto-start launcher), the app names the process and offers a one-click stop — killing the launcher's cmd tree so it can't respawn. New: launch-on-boot toggle (silent `--auto-start`, no browser pop), "Print Test Label" button (uses `/canary`'s TEST-banner label), live health panel (roster count/age, printer warnings, phone-check-in URL), and an "Enable Phone Check-in" button that adds the firewall rule via a UAC prompt (the per-user installer can't add it silently — first-run relies on Windows' Allow prompt, now called out in the wizard).

### Website/docs
InstallGuide leads with a download button (`releases/latest/download/Awana-Label-Printer-Setup.exe`, fixed artifact name) + SmartScreen "More info → Run anyway" callout; the `irm | iex` command moved into a collapsed "Previous install method" section. README/SETUP/TROUBLESHOOTING updated (new .exe troubleshooting section); deprecation banner added to `install-and-run.ps1`. Also fixed a pre-existing garbled `Write-Host` in the installer's port-check catch block that would have crashed the trap handler.

## [4.2.1] - 2026-07-17
KVBC-Awana-Countdown retirement housekeeping (docs only — no behavior change).

### CONTRACT.md consumer list updated
The countdown consumer is now Awana-Check-in-Display's `/countdown.html` (the presentation tool absorbed from the retired KVBC-Awana-Countdown repo). The mirror instructions now name the single live mirror (`src/lib/__fixtures__/contract-vectors.json` in the display repo). Verified during the same sweep: this repo never consumed the old repo's `shared/*.json` URLs — the group schedule is dashboard-edited local config (`church-config.json`) — so no code repoint was needed.

### Drift protection (in the display repo)
Awana-Check-in-Display CI now byte-compares its mirrored `contract-vectors.json` against this repo's canonical copy (raw.githubusercontent.com) on every CI/deploy run plus a weekly cron, so a canonical change here that isn't re-mirrored breaks their build instead of silently drifting. The `note` field inside `contract-vectors.json` still mentions KVBC-Awana-Countdown; it is left byte-locked on purpose — editing it would break mirror parity, and cleaning it up requires the two-repo canonical-first re-mirror dance this entry describes.

## [4.2.0] - 2026-07-16
Check-in features wave: phone check-in, sibling suggestions, first-timer treatment, late-arrival routing, attendance milestones, Electron/server consolidation, and a docs rewrite.

### Phone check-in (#17b) — new `/phone` page
Volunteers on the club Wi-Fi open `http://<laptop-ip>:3456/phone` (PIN-gated, set on the dashboard), search the roster, and tap **Check in**. The request queues on the server (`POST /phone/checkin` → pending-actions); the extension long-polls `GET /pending-actions` (25 s hold), drives the real TwoTimTwo check-in in the browser (click row → modal → verify the row vanishes), and reports back (`POST /pending-actions/:id/result`). The phone never prints directly — the label flows through normal detection, so dedup still guarantees exactly one label. The phone shows live status ("Working… → Checked in"). `install-and-run.ps1` adds an idempotent TCP-3456 firewall rule. LAN-trust only (PIN over HTTP) — documented in docs/SETUP.md.

### Sibling suggestions re-enabled, panel-only (#26)
After each check-in the family lookup runs again and an **"Also here tonight?"** panel offers the kid's siblings — one tap drives their check-in. NEVER auto-batches (the quick-mode auto path stays retired). Kill switch: dashboard → "Allow driven check-ins" (also disables phone-driven check-ins).

### First-timer treatment (#27)
Visitor labels now use the inverted (black) palette so they pop out of a stack — palette only, icons and text behave normally (generalized from the Step Up ternary; toggle on the dashboard). Optional **connect card**: a second label for visitors pointing the family to the club's time/location from the group schedule.

### Late-arrival routing (#28)
New dashboard **Group Schedule** editor (club, start time, location, room; `GET/POST /config/schedule`). A check-in later than start + grace (default 10 min, configurable) adds a bold **"Go to: Music, Rm 4"** line to the label, bottom-left, clear of the icon row.

### Attendance milestones (#30)
New compact `attendance.json` ledger (one dates[] per kid, atomic writes) — print history rolls over every ~2 nights, so milestones needed their own store. The 5th/10th/25th/50th club night within the season (Aug 1 boundary) prints "⭐ Nth club night tonight!" on the label. Canary/test prints never count.

### Extension + server consolidation (#16)
- Deleted dead `electron-app/src/checkin-script.js` (never injected — Electron opens the check-in page in the default browser).
- `server.js` is now requireable: `module.exports = { app, startListening }` with a `require.main` guard.
- The Electron tray app prefers the FULL print server (packaged via electron-builder `extraResources`, including node-canvas); the slim HTML-renderer server remains as an explicit fallback if canvas fails to load. Electron installs now get roster enrichment, dedup, history, Pusher, and phone check-in.

### Roster-diff hardening (#17a) + confirmation feed
The safety-net roster scan is now adaptive — every 2 s inside the club-night window (from `/config/church`), 5 s otherwise — and converted from `setInterval` to a self-rescheduling `setTimeout` so a slow scan can never stack. New **Last prints** feed pinned at the top of the widget panel: the last 5 labels with their detection source (🖱 local / 📡 remote / 📱 phone / ⌨ manual) and ✓ printed / 📦 queued state (#29 polish).

### Church config in one place (#50 slice)
The extension fetches `/config/church` once at startup: shares club ids and club-night windows replace hardcodes (baked KVBC fallbacks preserved).

### Docs rewrite (#33)
README rewritten around the extension + Electron (bookmarklet-era copy retired from the top); new `docs/NIGHT-OF.md` print-and-tape one-pager and `docs/SETUP.md` full setup guide (incl. the phone-check-in trust model); TROUBLESHOOTING gains phone-check-in and selector-banner sections.

## [4.1.0] - 2026-07-16
Event bus + night reliability: the print server becomes the single publisher for the whole Awana app family (check-in display + countdown app), with contract-pinned payloads, self-testing selectors, an end-to-end canary, and visible print failures.

### Event bus — new pinned contract (CONTRACT.md + contract-vectors.json)
The print server now publishes five event types on the Pusher channel (only it holds the secret; displays subscribe with the public key). Payload builders live in `print-server/events.js` — pure, structurally incapable of leaking PII (first names only, ever):
- **`checkin` v2** — existing four fields plus `id` (uuid) + `at` (ISO) so displays can dedupe live vs replay. Consumers treat both as optional, so deploy order doesn't matter.
- **`recap`** (every 2 min during club hours) — the last ≤15 check-ins, so a display that reconnects mid-event still celebrates the kids it missed. Buffer persists across a server restart (`events-buffer.json`, today-only).
- **`tally`** (each check-in + every 60 s) — per-club checked-in counts, zero PII. Drives the countdown app's live GameTimeView counts.
- **`birthdays`** (startup + every 10 min on club night) — this week's birthday kids as `{firstName, club, month, day}` (no year, no last name). Kills the countdown app's manual CSV upload chore.
- **`ops`** (`print-failure` / `selector-fail` / `canary`) — operator telemetry: type/club/at only, never a name.
Interval publishers are gated by the club-night window in the new `print-server/church-config.json` (per-church knobs: check-in URL, Pusher channel, club nights, shares club ids — baked KVBC defaults if missing). New `GET /config/church` serves it; `npm run test:contracts` (zero-dep Node script, 91 assertions) pins every payload shape against the canonical vectors.

### Selector self-test (chrome-extension/content.js + POST /selftest)
The extension probes the load-bearing TwoTimTwo selectors (`.clubber`, `.name`, `#lastCheckin`, club icons) 15 s after load and every 10 min, and reports to the server. A hard failure (site redesign) throws a loud red page banner instead of failing silently, and the server publishes an `ops: selector-fail` event on the transition. Modal selectors are verified passively by the driven check-in paths (they only exist while a modal is open).

### Canary — "Test Night Systems" (POST /canary)
One click before doors open proves the whole pipeline: stage 1 prints a real label with a bold diagonal **TEST — NOT A CHECK-IN** band (unique `Canary HH:MM:SS` name defeats the duplicate window; excluded from history, stats, tally, and the checkin event), stage 2 publishes a `canary` event on the bus. Buttons on the dashboard (Night Status card) and in the widget (**Night Test**, which also re-runs the selector probe).

### Print failures are now visible (#15)
The server previously recorded only successes — a jammed printer was invisible. Failed `/print`/`/reprint` calls now land in history (`success:false`, shown struck-red in the dashboard table, excluded from stats), in a `GET /failures` list (last 20, names stay local), and on the bus as `ops: print-failure` (club only). `/stats/tonight` logic extracted to `computeTonightStats()` and shared with the tally publisher.

### Night Status dashboard card
New card on the dashboard: club-night window state, event-bus publish health (last event + timestamp or error), selector self-test result, last canary stages, roster freshness — plus the canary button. `/health` gains `clubNight`, `pusher`, `selectorSelfTest`, `lastCanary`, `printFailures`, and `csv` fields.

## [4.0.0] - 2026-07-11
Major release: widget reprints, live "Tonight" stats, offline roster cache, one-click updates, Med Release no-photo labels, and a fully redesigned website.

### One-tap reprints in the widget (chrome-extension/content.js)
New **Tonight** section in the widget lists today's prints (name, time) with a Reprint button per row — rescues torn/jammed/lost labels without leaving the check-in page. Refreshes when the panel opens, after every successful print, and once a minute while expanded. Uses the existing `/history/today` + `/reprint` endpoints.

### Tonight at a glance (print-server)
- New `GET /stats/tonight`: unique kids checked in, labels printed, visitors, per-club counts, plus safety flags for everyone in the building — allergy kids (with tokens), birthday-week kids, and no-photo kids. Each child counts once regardless of reprints.
- Dashboard gets a "Tonight at a Glance" card: per-club chips and color-coded allergy / no-photo / birthday rows, refreshed every 15 s.
- Print history entries now record the `visitor` flag so visitor counts are accurate.

### Offline roster cache (chrome-extension/content.js)
The scraped roster (names, clubs, logos) is persisted to `chrome.storage.local` (2-week TTL, 400-entry cap) and restored automatically when the page can't render its roster — site down, Wi-Fi drop, offline reload. Widget search keeps working, and selecting a cached kid with no live page row prints the label anyway (label-only; do the TwoTimTwo check-in when the site is back). Combined with the existing print queue, a mid-event outage no longer stops the door.

### One-click self-update
- New `POST /update-now`: the server exits with code 99 after confirming an update exists.
- `launch-awana.bat` treats exit 99 as "re-run the update check" — it downloads the latest installer and restarts on the new version (the launcher already updates on every launch; this adds mid-season one-click updates).
- The widget's update notice and the dashboard banner both grow an **Update now** button.

### Med Release → no-photo label icon (print-server/server.js)
- New CSV column `MedRelease` (aliases: Med/Medical/Media/Photo Release, Photo Permission) parsed as y/n. Only an explicit "n"/"no"/"false"/"0" flags the child — blank or missing prints nothing.
- Flagged kids get a **crossed-out camera** (camera emoji + drawn slash) in the label's bottom-right icon row, and appear in `/stats/tonight` + the dashboard as NO PHOTOS.
- `clubbers-template.csv` updated with the new column; enrichment logs show `NO PHOTO`.

### Website redesigned from scratch
New single-page site (App.tsx + Nav/Hero/Features/InstallGuide/Simulator/Faq components, PrintServerInfo removed): hero with a CSS mock of the real 4×2 label, 3-step "How it works", v4 feature grid, 4-step install guide with copy-to-clipboard command and connection test, the working check-in simulator (now with a functional name filter) styled as a browser mock, and a volunteer FAQ. Inter font, brand green palette, fully responsive.

## [3.9.0] - 2026-07-11
Housekeeping release: sibling check-in disabled for now, widget panel reorganized, dead code removed.

### Sibling check-in disabled (chrome-extension/content.js)
Both triggers — the sibling panel after a normal check-in and Quick Mode's auto-sibling batch — are commented out with `SIBLING CHECK-IN DISABLED` markers. All the underlying functions (`findSiblings`, `showSiblingPanel`, `batchCheckInSiblings`, …) are kept intact so the feature can be re-enabled by uncommenting the two blocks. Quick Mode hint and website copy updated to match ("currently disabled").

### Widget interface cleanup (chrome-extension/content.js)
The expanded panel is reorganized into labeled sections, most-used first:
1. **Search + Quick Mode** at the top
2. **Night Modes** — Step Up Night, Awana Store Night
3. **Printing** — mode selector, Test, printer picker
4. **Walk-in Guest** — name, club, visitor
5. Status lines (queue, roster sync, warnings) and Help at the bottom

New shared `sectionLabel()`/`divider()` helpers replace the hand-rolled duplicate style blocks.

### Dead code removed
- `lastPrintTime` (extension): assigned in four places but never read — the cooldown guard it armed was removed in v3.6.1.
- `printHistory` (server): loaded at startup but never used; `/history` reads the file per request.
- Stale "Text truncation helper" comment block referencing pdfkit, which the server no longer uses.

## [3.8.0] - 2026-07-11
Field-test fixes: duplicate label printed for the first check-in of the night; label redesign per feedback (no left stripe, allergy icons instead of words, handbook group restored).

### Bug fix: same child's label printed twice
First real-machine test: Micah's label printed twice, Sophia's once.
- **Root cause:** POST `/print` is synchronous on the server — PowerShell startup plus a cold printer can take 15–30 s (the server retries the spooler internally, up to ~31 s worst case). The extension aborted the request after only **5 s** and retried; the first request was still succeeding, so the retry printed a second copy. The first print of the night is the cold one, which is why only Micah duplicated.
- **Server fix (root cause):** `/print` now suppresses any request for a name that already printed successfully within 25 s and acknowledges it as `{success, duplicate}` — a client retry, double-tap, or overlapping detection path can never double-print. Deliberate reprints via `/reprint` are not gated.
- **Extension fix:** `/print` request timeout raised from 5 s to 35 s (above the server's worst case) so a slow-but-successful print is never aborted and re-sent.

### Label design (print-server/server.js), per field feedback
- **Left identity stripe removed.** The 3.7.1 per-club pattern stripe (zigzag/rungs/dots…) read as a printing artifact on real labels ("weird looking bar"). Club identity remains via the logo/monogram icon panel and club fonts.
- **Allergy words → icons.** The bold `[NUTS]`-style text chips are replaced with emoji icons (🥜 🥛 🌾 🥚 💧) at 22 pt — no words along the bottom of the label. Unknown tokens fall back to ⚠.
- **Bottom icon row can't collide with text.** The centered text block now reserves 20 pt of bottom space whenever the coin/cake/allergy row is present, so a wide handbook-group line no longer overlaps the icons.

### Bug fix: handbook group missing from labels
Enriched labels printed allergies but no handbook-group line.
- Enrichment now falls back to the generic `Group` CSV column when `HandbookGroup` is absent (TwoTimTwo exports the grouping under a plain "Group"-style header), at all four sites (/print, /label, /preview, /reprint). "All" still suppresses the line.
- Added `handbook` and `handbook time` header aliases to the CSV header map.
- The server now logs **every** parsed CSV column on load (not just recognized ones), so a renamed TwoTimTwo header is visible in the console instead of silently dropping enrichment.

### Website
- "Per-club label design" section: stripe-pattern description and legend removed.
- Allergy tile: "Allergy chips" → "Allergy icons" with the emoji legend.

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

