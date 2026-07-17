# Awana Product Family — Improvement Roadmap & Resume Notes

> **For a future Claude session:** this file is your entry point if you're
> picking up mid-roadmap. Read this whole file before touching code. It
> explains the cross-repo architecture, what's already shipped, and exactly
> what's left, in order. A copy of this file lives in all three repos
> (`KVBC-Awana-Countdown`, `Print-TwoTimTwo-Labels`, `Awana-Check-in-Display`)
> so whichever one you're opened into, you have the full picture.

## Branch

All three repos develop on **`claude/product-improvement-ideas-lxpq9n`**
(already exists on origin in all three repos — check it out, don't create a
new one). No PRs unless the user explicitly asks. Push directly to this
branch as work completes (each repo's own commit conventions apply —
conventional commits for the countdown repo, version-bump + changes.md for
the printer repo).

## Context

The user (KVBC Church) runs three apps together on Awana club nights:

1. **Print-TwoTimTwo-Labels** (producer) — Chrome extension detects
   check-ins on TwoTimTwo.com; local Node print server renders/prints 4×2
   thermal labels with enrichment (allergies, birthdays, store night,
   step-up); optionally publishes `checkin` events to Pusher channel
   `awana-channel`.
2. **Awana-Check-in-Display** (celebration consumer) — React/Vite kiosk on
   GitHub Pages; subscribes to Pusher (public key) and shows sanitized
   welcome/birthday/first-timer banners over a slideshow. Hard privacy
   invariant: `sanitize()` allowlists only `firstName, club, isBirthday,
   isFirstTimer`.
3. **KVBC-Awana-Countdown** (room presentation, this repo) — React 19/TS app
   on GitHub Pages; pure schedule engine drives countdown → opening
   ceremony → per-club game time → closing → shutdown, with
   birthdays/weather/calendar. **This repo now also hosts shared data for
   the whole family** (see below).

From a 50-idea PM review, the user approved ~31 ideas (with modifications).
They also supplied official club art (Puggles logo + 4 characters, T&T
"Agents of Grace" characters + T&T blue logo, Journey logo, Trek logo) and
the 2026–27 Awana catalog PDF, which are now committed at
`KVBC-Awana-Countdown/shared/art/`.

**User decisions locked in:**
- Phone check-in (#17): **both** — harden roster-diff detection AND build a
  phone check-in page served by the print server.
- Local .pptx renderer in the display app (#34): **finish it** (not delete).
- Sequencing: **reliability + plumbing first** (Wave 1), then check-in
  features (Wave 2), then display polish + church config (Wave 3).
- (#1 modified): per-club live count goes **subtly in each club's
  GameTimeView** in the countdown app — DONE, see below.
- (#28 modified): extension/server settings must let the operator specify
  **when each group goes where** (drives late check-in routing on labels).

## Cross-app architecture (decided; binding for all remaining work)

### Event bus — Pusher channel `awana-channel`
Only the print server holds the publish secret; both display apps stay
subscribe-only (public key).

- `checkin` (existing, UNCHANGED fields + new **optional** `id` + `at`):
  `{id, at, firstName, club, isBirthday, isFirstTimer}`. The display's
  existing sanitizer stays strict; `id`/`at` are added to its allowlist
  deliberately with contract tests. Optional so deploy order between printer
  and display doesn't matter.
- `recap` (new, printer → every ~2 min during club hours): last ~15 events,
  same shape as checkin. Enables banner replay after a display reconnects
  (#11) without any backend.
- `tally` (new, printer → each check-in + ~60s): `{counts: {club: n}, total,
  at}` — no PII. `counts` is keyed by club display name as TwoTimTwo reports
  it; each consumer normalizes through its own alias map (countdown
  `normalizeClub`, display `clubs.js`). Drives GameTimeView counts (#1,
  DONE) and display club milestones (#36, not yet done).
- `birthdays` (new, printer → startup + ~10 min on club night):
  `{entries: [{firstName, club, month, day}], at}` — **first names only,
  ever**; `month`/`day` are the birthday's calendar month/day (ints, no
  year) so the countdown app can reuse its existing pure week-matching
  (`birthdaysThisWeek`) directly. Kills the countdown app's manual CSV
  chore (#5, DONE on the countdown side — printer side not yet built).
- `ops` (new, printer): `{type: 'print-failure'|'canary'|'selector-fail',
  club?, at}` — operator-only surfaces (#10/#15), never a public banner.

**Privacy rule:** every new event type gets its own strict allowlist
sanitizer in the display app; shared contract vectors (below) pin all
schemas. No last names, no allergy info, no contact info ever rides the
channel.

### Shared data — hosted by this repo (KVBC-Awana-Countdown)
Published at `https://patrick-simpson.github.io/KVBC-Awana-Countdown/shared/`
via a vite plugin (`vite.config.ts` → `sharedDir()`) that serves `shared/*`
in dev and copies it into `dist/shared/` on build.

- **`shared/schedule.json`** — meeting day/time, window table, dated
  overrides (`specialDates`: either `{noClub:true}` to cancel a night, or a
  full replacement window table — no partial patches), timezone. Validated
  by `src/lib/shared-config.ts` (`parseScheduleConfig`, throws at build on a
  bad file). Countdown consumes it at build time (it hosts it); the display
  and printer repos should fetch it at runtime with a cache + baked-in
  fallback (not yet implemented in those repos).
- **`shared/theme.json`** — per-club `{name, color, aliases[], art:
  {logo?, title?, characters?[], group?, monochrome?}}`, art paths relative
  to theme.json's own URL. Includes puggles/cubbies/sparks/tnt (scheduled
  clubs) plus journey/trek (art-only, for the other repos).
- **`shared/art/*.png`** — the official club art you uploaded, already
  cleaned up and committed (RGBA, reasonable file sizes). See the file list
  in `shared/theme.json`.
- **`shared/README.md`** — documents both JSON shapes and the versioning
  policy for other repos.
- Calendar (#12): the display repo's nightly-Action-generated
  `calendar-feed.json` (published on **its own** Pages site) is the PRIMARY
  calendar source for both display and countdown; direct scrape is
  secondary; the `api.allorigins.win` CORS-proxy dependency has been
  **removed** from the countdown repo (done) — still present in the display
  repo (not yet touched, see Display Wave 1 below).

### Contracts (#8)
`contract-vectors.json` + `CONTRACT.md` define all event schemas with valid
+ dirty-PII test vectors, mirrored **byte-identical** across the printer and
display repos (the countdown repo doesn't need a copy — it never touches
Pusher payload contracts directly beyond consuming `tally`/`birthdays`,
which it validates with its own hand-rolled pure parsers in `src/lib/`).
**Not yet created in either the printer or display repo** — this is the
very first thing to do in Printer Wave 1.

---

## Status: what's DONE (commit `dcfc488` on `KVBC-Awana-Countdown`, pushed)

### ✅ Countdown repo — Wave 1 (complete, tested, pushed)
- `shared/schedule.json`, `shared/theme.json`, `shared/art/*.png`,
  `shared/README.md` — committed and building into `dist/shared/`.
- `vite.config.ts` — `sharedDir()` plugin (dev middleware + build copy).
- `tsconfig.json` — `resolveJsonModule: true` added.
- `src/church.config.ts` — coords, calendar URLs, Pusher key/cluster,
  watchdog timing, all in one documented module (first slice of #50).
- `src/lib/shared-config.ts` — strict hand-rolled validation of both JSON
  files (`parseScheduleConfig`, `parseThemeConfig`), throws at module init
  so a bad file fails `lint`/`test`/`build` before it can deploy. Exports
  `SCHEDULE_CONFIG`, `THEME`, `artUrl()`, `localDateKey()`.
- `src/config.ts` — now derives `CLUBS`/`MEETING_DAY`/`MEETING_START`/
  `WEDNESDAY_SCHEDULE` from the shared config; same exported names so
  downstream call sites didn't need to change. `DECKS`/pledge text remain
  local defaults.
- `src/lib/schedule.ts` — parameterized but still pure (`cfg =
  SCHEDULE_CONFIG` default keeps every existing test passing unmodified).
  New `windowsForDate(now, cfg)` resolves `specialDates` (noClub / full
  replacement table, even on non-meeting weekdays). `getNextMeeting` skips
  cancelled weeks (bounded 53-iteration walk).
- `src/lib/schedule.test.ts` — all original cases kept + new suites:
  noClub Wednesday (COUNTDOWN all evening, correct next-meeting skip),
  replacement-table Store Night (shifted boundaries, gaps→COUNTDOWN, never
  leaks to normal Wednesdays, applies even on non-meeting weekdays).
- `src/lib/shared-config.test.ts` — validates the shipped files themselves
  (gap-free windows, every scheduled club themed, **CSS token drift guard**
  — fails if `theme.json` colors diverge from `--color-club-*` in
  `index.css`, every art path in theme.json actually exists on disk),
  plus unit tests for `parseHHMM`/`parseScheduleConfig`/`parseThemeConfig`
  validation and rejection cases.
- `src/lib/tally.ts` + `src/lib/tally.test.ts` — pure parser for the
  `tally` Pusher event; `countForClub()` normalizes club-name spellings via
  the existing `normalizeClub` from `birthdays.ts` and sums duplicates;
  returns `null` (not 0) for clubs the tally doesn't cover, so callers can
  distinguish "no data" from "zero kids."
- `src/lib/pusher.ts` — lazy singleton Pusher client. Subscribe-only,
  fails silently if unconfigured, supports one-time `?pusherKey=` /
  `?pusherCluster=` URL provisioning persisted to localStorage
  (`adoptPusherUrlFlags()`), reconnects on `visibilitychange`.
- `src/hooks/useTally.ts` — binds `tally`, exposes `Tally | null`;
  consumers judge staleness themselves against the ticking clock (no
  internal timer).
- `src/lib/birthdays.ts` — added `LiveBirthday` type and pure
  `mergeLiveBirthdays(csv, live, now)`: CSV is authoritative (dedupe key =
  club + first name token, case-insensitive); live entries older than
  `LIVE_BIRTHDAY_MAX_AGE_MS` (~8 days) are pruned. Tested in
  `birthdays.test.ts` (appended, not rewritten).
- `src/hooks/useBirthdays.ts` — now manages **two** localStorage keys
  (`kvbc-awana-birthdays` CSV, `kvbc-awana-live-birthdays` broadcast-synced)
  and exposes `useBirthdayRoster()` (merged list + `csvCount`/`liveCount`)
  and `useBirthdays()` (merged list only, for existing call sites). `Clear`
  wipes both.
- `src/hooks/useBirthdaySync.ts` — binds the `birthdays` Pusher event,
  strictly validates each entry (firstName, normalizable club, valid
  month/day), replaces the live roster on every broadcast (each broadcast
  is the full current list, not a delta).
- `src/hooks/useCalendarEvents.ts` — rewritten: primary = the display
  repo's `calendar-feed.json` (validated defensively — `version:1`,
  `events[]`, `isCancelled` filtered out, `isSpecial` computed if absent);
  secondary = direct HTML scrape (unchanged parser); **allorigins proxy
  removed entirely**.
- `src/hooks/useWeather.ts` — coords now come from `CHURCH.coords` instead
  of local constants.
- `src/lib/watchdog.ts` + `src/lib/watchdog.test.ts` — pure
  `evaluateOverride()`: self-heal (override state === natural state),
  boundary-resume (natural state changed since override was set), timeout
  (`max(setAt, lastStayAt) + overrideTimeoutMin`). This is what makes the
  pre-6pm "skip to opening ceremony" flow safe — it self-heals at 18:00
  instead of getting yanked or stranding the screen.
- `src/hooks/useSchedule.ts` — rewritten to track override metadata
  (`setAt`, `naturalKeyAtSet`, `lastStayAt`), evaluates the watchdog every
  tick, exposes `resumeAt` and a new `stay()` action. Countdown overrides
  never time out (self-heal/boundary only — this is also the
  post-shutdown restart path, which must never auto-yank).
- `src/components/ResumePill.tsx` — bottom-center "Back to schedule in Ns"
  pill with a "Stay" button, shown in the final `warningSec` seconds
  before a window-override watchdog resume.
- `src/views/QuickNav.tsx` — nav list now resolves against
  `windowsForDate(now)` (so a Store Night's replacement table shows
  correctly in the menu); active-state probe uses the real app clock
  instead of `new Date()` (fixes `?now=` time-travel QA); birthday upload
  UI shows "N loaded · M live" and Clear wipes both sources.
- `src/views/GameTimeView.tsx` — rewritten: `ClubEmblem` renders the
  official logo PNG from `theme.json` with `onError` fallback to the
  original typographic `Badge` (never blanks); seeded `CharacterArt`
  renders 1–2 official character PNGs in the lower corners (deterministic
  per window via `mulberry32`); new subtle live "N checked in" chip row
  fed by `useTally()`, hidden when no data or stale (>10 min vs the
  ticking clock).
- `src/App.tsx` — wires `adoptPusherUrlFlags()` (once), `useBirthdaySync()`,
  and `<ResumePill>`.
- **Verified:** `npm run lint` clean, `npm test` 64/64 passing, `npm run
  build` produces `dist/shared/{schedule.json,theme.json,art/,README.md}`,
  `npm run preview` serves `/KVBC-Awana-Countdown/shared/schedule.json`
  with 200 + CORS header. Playwright screenshots taken of Countdown view
  and both Game Time views (T&T solo, Puggles+Cubbies combo) — logos
  render correctly (a first-pass drop-shadow-only glow made the T&T navy
  logo hard to read against the green wave; fixed with a white-first glow
  stack), countdown view unregressed, character art appears in the
  corners.

**Nothing else in this repo is required for Wave 1.** Wave 3 items for this
repo (Settings UI #42, "Coming up at KVBC" slide #44, fork docs #50 finish)
are deliberately deferred — see "Remaining work" below.

### ⬜ Printer repo (`Print-TwoTimTwo-Labels`) — NOTHING DONE YET
Confirmed clean working tree, correct branch checked out, no commits ahead
of the merged v4.0.0 history. **This is the next repo to work on** — the
countdown repo's tally/birthday consumers have nothing to listen to until
the printer publishes.

### ⬜ Display repo (`Awana-Check-in-Display`) — NOTHING DONE YET
Confirmed clean working tree, correct branch checked out.

---

## Remaining work, in order

### 1. Printer Wave 1 → ship as v4.1.0 (`Print-TwoTimTwo-Labels`)
This is the linchpin — do this next.

- **Step 0 plumbing:** `print-server/church-config.json` (subdomain,
  checkinUrl, `pusherChannel: 'awana-channel'`, `clubIds`, `clubNights:
  [{dow,start,end}]`, `canaryLeadMinutes`) + `isClubNightNow()` helper.
  New **`print-server/events.js`**: pure payload builders (`buildCheckin`
  adds `id` via `crypto.randomUUID()` + `at` ISO string; `buildRecap`,
  `buildBirthdays`, `buildTally`, `buildOps`, `buildCanary`) + a `publish()`
  wrapper that **never throws** (try/catch, records
  `{lastPublishOk, lastPublishAt, lastError}` for `/health`). Switch the
  existing inline Pusher trigger to use it. Keep an in-memory buffer of
  tonight's last ~50 check-in events (persisted alongside print-history for
  restart safety) — recap reads from this buffer.
  - ⚠️ **Correction from repo exploration (verify still true before
    coding):** Electron does NOT inject a script into the check-in page —
    `electron-app/main.js` opens the URL via `shell.openExternal()` in the
    user's default browser, where the Chrome extension runs.
    `electron-app/src/checkin-script.js` is dead code (only referenced in
    changes.md history) — delete it in Wave 2, not Wave 1.
  - ⚠️ **Correction:** the server has never recorded print *failures*
    (`addHistoryEntry` is only called on success) — this needs to be added
    before an `ops` print-failure event or dashboard failure list can
    exist.
  - ⚠️ **Birthdays payload shape:** MUST be `{entries: [{firstName, club,
    month, day}], at}` — the countdown repo's `useBirthdaySync.ts` already
    expects exactly this shape (`month`/`day` as 1-based ints, no year).
    Don't ship `{firstName, club}` only — that was an earlier draft of the
    contract, superseded during implementation.
- **(#8) Contracts:** new `CONTRACT.md` + `contract-vectors.json`
  (canonical copies — the display repo mirrors these verbatim) documenting
  every event's schema with valid + dirty-PII vectors. New
  `scripts/test-contracts.cjs` (plain Node, zero deps — this repo has no
  test framework) validating every `events.js` builder output against the
  vectors. Add `"test:contracts"` npm script.
- **(#11/#5/#1/#15) Publishers:** interval scheduler gated by
  `isClubNightNow()` — recap every 2 min (last 15 buffer entries); tally
  every 60s **and** on each check-in (extract `computeTonightStats()` out
  of the existing `/stats/tonight` handler and reuse it); birthdays at
  startup + every 10 min (iterate the loaded roster through the existing
  `isBirthdayWeek` helper, emit only `{firstName, club, month, day}` per
  entry — never last names). `/print` and `/reprint` catch blocks: record
  `ok:false` to history, push to an in-memory failure list, publish
  `ops {type:'print-failure', club, at}` (club + timestamp only, no name).
- **(#9) Selector self-test:** `runSelectorSelfTest()` in the extension at
  startup + every 10 min, checking `.clubber` count, `.name`, `#lastCheckin`,
  `.club img`, and that the shekelBalance report URL responds with
  non-HTML. `#checkin-modal`/`button#checkin` can't be statically tested
  (the modal only exists while open) — instrument passively inside the
  existing `pollForCheckinButton` instead and report "last verified
  <time>". Hard failure → loud persistent widget banner + `POST
  /selftest`. `/health` gains `selectorSelfTest`/`pusher`/`lastCanary`
  fields.
- **(#10) Canary:** `POST /canary` — stage 1 prints a label with a
  `testBanner` overlay (unique name like "Canary 18:04:33" defeats the 25s
  dedup; excluded from history/stats/checkin publish), stage 2 publishes a
  `canary` event. Returns per-stage `{pass, detail}`. Widget "Test night
  systems" button adds the detection-stage check; dashboard button runs the
  server-only stages; optional auto-run at club start minus
  `canaryLeadMinutes`.
- **(#7) Night Status panel:** dashboard card polling the extended
  `/health` (version/uptime, printer warnings, CSV freshness, Pusher
  publish status, self-test result, last canary stages).
- **Wrap-up:** `node scripts/test-contracts.cjs` green → `node
  scripts/bump-version.cjs 4.1.0` → changes.md entry (repo convention: one
  section per item, current style) → `npm run build` (syncs bookmarklet/
  dist) → commit → push.
- **Verification:** run the server locally, `curl /health` shows new
  fields; temporarily shorten the recap interval and confirm publishes (or
  confirm the `pusher === null` path never crashes if Pusher creds aren't
  configured in this sandbox); use the root React Simulator + paste
  `content.js` into a console against it (or a temporary localhost URL
  match) to fire a check-in and confirm buffer/recap/tally; rename
  `#lastCheckin` in devtools to confirm the self-test flags it within one
  cycle; run the canary from both the widget and dashboard; simulate a
  print failure (unplug/rename the configured printer) and confirm an
  `ops` event + dashboard failure row.

### 2. Display Wave 1 (`Awana-Check-in-Display`)
Do this once the printer is publishing (or in parallel, since `id`/`at`
and all new event types are additive/optional on the consumer side).

- **Foundations:** new `src/lib/eventSanitizers.js` — one strict allowlist
  sanitizer per event type in the style of the existing `sanitize()`
  (null on garbage, never throw): `sanitizeCheckin` (moved from
  `useSocket.js`, extended with optional `id` ≤64 chars / `at`→epoch-ms),
  `sanitizeRecap` (cap 30 entries, each via `sanitizeCheckin`, entries
  without both `id` and `at` are dropped), `sanitizeBirthdays` (cap ~40 of
  `{firstName, club}` — **note:** the display never needs `month`/`day`,
  it only shows a name+club banner, so those fields can be dropped by this
  sanitizer even though the printer sends them), `sanitizeTally` (counts
  int ≥0, ≤30 club keys, names ≤40 chars — numbers only, a name can never
  ride in), `sanitizeOps` (`type` enum `['print-failure']` only for now),
  `sanitizeCanary` (`{at, nonce?}`).
- New `src/lib/__fixtures__/contract-vectors.json` — **mirrored
  byte-identical** from the printer repo's canonical copy (valid + dirty-PII
  fixtures per event). New `src/lib/eventSanitizers.test.js` — data-driven
  over the vectors: exact deep-equality, exact key-list assertions, and an
  assertion that dirty fixtures never leak (stringify the sanitizer output
  and confirm no PII markers from the fixture appear). Existing
  `useSocket.test.js` stays (guards `sanitize` via re-export) but its
  fixture needs updating for the v2 `id`/`at` fields.
- **Modify `src/hooks/useSocket.js`** — generalize to bind every allowlisted
  event name through its dedicated sanitizer; track `lastEventAt` and
  `lastCheckinAt` for the health surface.
- **(#11) Replay:** new `src/hooks/useSeenEvents.js` (id→at Map, capped at
  500, persisted to sessionStorage so an accidental reload mid-club
  doesn't replay everything). Live checkin → mark seen, enqueue as
  `'live'`. Recap → skip already-seen ids and entries older than
  `recapMaxAgeMin` (config, default 20 min — prevents a stale recap
  replaying last week's check-ins if the TV reboots), enqueue as
  `'replay'`, and bump the local tally state for those.
  `useCheckInQueue.enqueue` needs a new `presentation: 'live'|'replay'|
  'late'` field threaded through. Replay banners get a quieter treatment
  ("Also joined us tonight", subdued scale, **no confetti/chime**,
  standard hold time — not the special extended hold).
- **(#12) Calendar:** replace the allorigins proxy fallback with a
  best-effort direct fetch (`fetchDirect(calendarUrl)`); delete the
  `calendarCorsProxy` config key + its validator entirely (the existing
  `sanitizeOverrides` machinery should auto-drop the stale localStorage
  value on next load — write a test confirming that). Update
  `SettingsPanel`'s calendar tab to drop the proxy field.
- **(#4) Phase awareness:** new pure `src/lib/schedule.js` (NOT the same
  file as the countdown repo's — this is a lightweight consumer-side
  clone): `sanitizeSchedule(json)` + `resolvePhase(schedule, now,
  isClubNight)` → `countdown|ceremony|game-time|closing|shutdown|off`, with
  a baked `DEFAULT_SCHEDULE` fallback matching the countdown repo's
  defaults. New `src/hooks/useSchedule.js` fetches the countdown repo's
  published `shared/schedule.json` (config key `sharedScheduleUrl`), caches
  to localStorage (`awanaSchedule.v1`), 6h refresh, fetch→cache→baked
  fallback chain. Once past the ceremony start time, live banners get
  `presentation:'late'` (calm styling shared with the replay CSS) and
  chimes duck via a `gain` multiplier threaded through `src/lib/audio.js`
  (the existing `tone(..., peak)` param already supports this — just wire
  it through). Phase should be visible/overridable in DebugPanel for
  testing.
- **(#14) Panic mode:** new config key `panicMode` (bool) + keyboard
  shortcut **Ctrl+Shift+X** (S/E/D are already taken by other panels) +
  pure `applyPanicMode(config)` helper applied in `App.jsx` after URL-flag
  merge: forces a placeholder background (the existing `CatalogScene`
  static path), disables calendar and weather, reduces widgets to just
  clock + status dot. The banner/Pusher pipeline is untouched — that's the
  whole point of the mode. Show a subtle "simplified mode" pill near the
  gear icon.
- **(#15) ops consumer:** App keeps a capped `opsFailures` list (last 20,
  today only) fed by the sanitized `ops` events; render as a small red dot
  + count on the existing "Signal"/connection status sticker (forced
  visible, like the existing dead-pipe indicator). Never a public banner.
  Details visible in SettingsPanel/DebugPanel; add a "Simulate print
  failure" button to DebugPanel.
- **(#7) Health surface:** extend SettingsPanel's status header with
  last-event age, calendar/schedule/config source lines, ops failure
  count. Extend DebugPanel with phase display, seen-id/recap stats, and
  simulator buttons for recap/tally/print-failure/canary.
- **(#8) Docs:** update `CONTRACT.md` to a v2 event table + pointer to
  `contract-vectors.json`; update the CLAUDE.md privacy paragraph to
  describe "one strict allowlist sanitizer per event type" instead of the
  single `sanitize()` function.
- **Verification:** `npm test` (all sanitizer/contract-vector tests
  including dirty-PII, the v2 checkin fixture, the dropped-config-key
  test), `npm run lint`, `npm run build`; DebugPanel simulations (normal
  rush, recap replay — confirm quiet variant + no duplicate banners after
  re-firing the same recap, print-failure red dot, phase override → late
  banner + ducked chime); manual: Ctrl+Shift+X toggles panic mode and
  back; `?overlay=1`/`?chroma=` still work and aren't affected by the new
  presentation variants.

### 3. Printer Wave 2 → ship as v4.2.0 (`Print-TwoTimTwo-Labels`)
- **(#16) Consolidation (rescoped after exploration):** delete the dead
  `electron-app/src/checkin-script.js`. Wrap the server's startup block in
  `if (require.main === module)` and export `{app, startListening}`; make
  Electron's slim server a thin wrapper requiring the full server (verify
  electron-builder can package `print-server/` + the native `node-canvas`
  module — keep the slim server as an explicit fallback if that packaging
  fails). Result: Electron installs get roster/dedup/history/Pusher/phone —
  everything the extension install gets.
- **(#17a) Roster-diff hardening:** adaptive scan interval — 2000ms inside
  the club-night window (fetched from a new `GET /config/church`), 5000ms
  otherwise; convert the polling `setInterval` to a self-rescheduling
  `setTimeout` so a slow tick can't pile up. Keep the existing
  `PENDING_MISS_THRESHOLD` confirmation logic. Add a widget confirmation
  feed: `{name, source: local|remote|phone, ✓ printed}` per check-in.
- **(#17b) Phone check-in page:** `GET /phone` (mobile-friendly HTML, PIN
  gate via the existing `POST /config` mechanism, roster + search, a
  checked-in-today set from history), `POST /phone/checkin` → an
  in-memory `pendingActions` queue, `GET /pending-actions` (extension
  long-polls this, 25s cap), `POST /pending-actions/:id/result`, `GET
  /phone/status/:id` (phone polls this for pass/fail). Extension executes
  each pending action via the **existing** driven-DOM chain (find → click
  → `pollForCheckinButton` → `verifyBatchCheckin`; the row must vanish
  within the verify window or the action posts back as failed).
  **Critically: never print directly from the phone flow** — the label
  must flow through the normal detection path so the existing dedup
  machinery (25s server-side + client `printedNames`) guarantees exactly
  one print. `install-and-run.ps1` needs an idempotent firewall rule for
  TCP 3456. Document that PIN-over-plain-HTTP is LAN-trust-only, not a
  real auth system.
- **(#26) Sibling suggest:** re-enable the commented-out sibling panel
  (content.js, was disabled in v3.9.0 as unreliable when fully automated)
  but **panel-only, never auto-batch** — restyle as tappable "Also here
  tonight?" chips that a volunteer confirms, driving the same
  `batchCheckInSiblings` machinery used by the phone flow. Share a config
  kill switch (`enableDrivenCheckin`) with #17b in case the driven-DOM
  approach proves too fragile against a TwoTimTwo markup change.
- **(#27) First-timer treatment:** visitors get the inverted color palette
  already built for step-up night (generalize the existing `stepUp`
  color ternary into a reusable `inverted` flag) plus an optional second
  "connect card" label (club time/location/leader pulled from the #28
  schedule table) — config toggle.
- **(#28) Group schedule settings:** `GET/POST /config/schedule` (rows
  `{club, startTime, location, room}`) persisted in config.json + a
  dashboard editor. `/print` computes lateness (`now > start + grace`) →
  renders a `goToLine` ("Go to: Music, Room 4") under the handbook-group
  line on the label.
- **(#30) Attendance milestones:** new `print-server/attendance.json`
  ledger (the existing `print-history.json` rolls over in ~2 club nights
  at `MAX_HISTORY=200`, so it can't be reused for season-long counts) —
  upsert `{nameKey, dates:[...]}` per successful non-test print (reuse the
  atomic-write pattern from `saveHistory`); milestones at [5,10,25,50]
  within the season (Aug 1 boundary) print a `milestoneLine` on the label.
- **(#33/#50) Docs + config:** rewrite README.md + TROUBLESHOOTING.md
  around the real extension+Electron architecture (both still describe
  the bookmarklet, which was removed in v2.0.4 — this is actively
  misleading to a volunteer following the docs today); new
  `docs/NIGHT-OF.md` one-pager + `docs/SETUP.md`; content.js fetches
  `/config/church` once at startup (replacing hardcoded club IDs / windows)
  with a baked KVBC fallback for offline resilience. Awana-universal
  tables (STEP_UP maps, CLUB_MONOGRAM) stay hardcoded — they're not
  church-specific.
- **Wrap-up:** `bump-version.cjs 4.2.0`, changes.md, `npm run build`,
  `electron npm run dist`, commit, push.
- **Verification:** simulator-driven sibling chips against the modal;
  `/phone` tested from an actual phone on the same LAN including the
  failure path; a late check-in prints the Go-to line; a visitor prints
  inverted + connect card; seed `attendance.json` to a count of 9 for a
  test name and confirm the next print says "10th night"; Electron `npm
  run dist` smoke test.

### 4. Display Wave 3 (`Awana-Check-in-Display`)
- **(#34) Finish the local .pptx renderer** — the existing
  `PptxSlideshow`/`pptxHandler.js`/`useLocalSlideshow` stubs are flagged
  EXPERIMENTAL and unimplemented (rendering is a no-op, always falls back
  to the iframe). Extend the existing hand-rolled JSZip + native
  `DOMParser` parser (JSZip is already a dependency — **zero new runtime
  deps**; `pptxjs`/`pptx-preview` npm packages were evaluated during
  planning and rejected as too heavy/opaque for this repo's philosophy).
  Parse into a plain-JSON slide model: `sldSz` EMU coordinate space,
  layout/master/theme color chain (`srgbClr` + `schemeClr` with
  lumMod/lumOff/tint/shade approximations), backgrounds
  (solid/linear-gradient/image), `p:sp` text boxes (size/color/bold/
  italic/align), `p:pic` images via rels → blob object URLs (released on
  unmount), and **fix** `p:transition@advTm` timing extraction (the
  current stub always returns a hardcoded 5000ms). Rewrite
  `PptxSlideshow.jsx` to render the model as positioned DOM (not canvas —
  framer-motion transitions and per-slide error boundaries come free),
  `scale()` from EMU space, crossfade between slides, a per-slide
  `{error:true}` falls back to a themed `CatalogScene` placeholder for
  just that slide, and a whole-deck parse failure falls back to the
  existing iframe path. **Add a file-upload → IndexedDB input path**
  (clone the existing `videoStore.js` pattern) as the *primary* input,
  since OneDrive `?download=1` URLs frequently lack CORS headers and would
  make a URL-only renderer permanently dead on many tenants; keep the
  OneDrive URL download as a secondary path. Document fidelity limits (no
  animations/SmartArt/charts/tables, font substitution, linear gradients
  only). Commit a tiny fixture `.pptx` and unit-test the slide model
  (order, timing, backgrounds, text runs, image resolution).
- **(#3) Theme consumption:** new `src/lib/theme.js` (`sanitizeTheme`:
  per-club `{primary, deep, accent, confetti[], logoUrl, mascotUrl}`, hex +
  https validation) + `src/hooks/useTheme.js` (fetch the countdown repo's
  published `sharedThemeUrl`, cache, 6h refresh, **preload every image
  before applying** so a banner can never flash a broken img). `clubs.js`
  gains `applyClubOverrides()`/`clearClubOverrides()` merging field-by-
  field over the existing baked palette values — all existing call sites
  and signatures stay unchanged, baked values remain the fallback.
- **(#35) Central config:** Settings export/import of ALL config overrides
  (reuse the existing SlideEditorPanel download/import pattern; document
  that video slide bytes don't travel in the export, same caveat the
  slide editor already documents for itself); `?config=<https-url>` URL
  flag; new config precedence layering `defaults < remoteConfig <
  localStorage overrides < ?key/?cluster` via a `useRemoteConfig(url)`
  hook (same `sanitizeOverrides` validation, cached to
  `awanaRemoteConfig.v1` for offline boot, 6h refresh).
- **(#36) Club milestones:** extend the **existing** milestone toast
  (`fireMilestone()` in App.jsx — do NOT build a new parallel component)
  to accept a `{kind:'club', club, count}` variant using club palette +
  mascot art + club-colored confetti, driven by a new prevCounts-tracking
  hook over the `tally` events (first tally received is baseline-only, no
  celebration — mirrors the existing "restoring a saved tally can't
  re-celebrate" rule already in the codebase). Config key
  `clubMilestoneEvery` (default 10, 0 = off).
- **(#37) Themed night skins:** pure `src/lib/nightSkins.js` — a keyword→
  skin registry (water→splash, pajama→cozy, "crazy hair"→zany, christmas,
  neon, …) matched case-insensitively against tonight's calendar event
  title; each skin is CSS-variable accents + an existing `SLIDE_THEMES`
  entry + optional banner trim class — **club colors stay primary**, skins
  only add an accent layer. Config `nightSkinsEnabled` + a
  `nightSkinKeywords` override map.

### 5. Countdown Wave 3 (`KVBC-Awana-Countdown`)
- **(#42) Settings UI:** pure `src/lib/settings.ts` (`OperatorSettings`:
  meeting day/start, game-window club order, slide/pledge text, watchdog
  timeout; strict `parseSettings`; `applySettings(sharedCfg, decks,
  settings)` → an effective config, where a game-order override permutes
  clubs/titles **without** touching window times) + `useSettings` hook
  (localStorage `kvbc-awana-settings`, clone of the `useBirthdays` storage
  pattern, with a reset-to-defaults). `App.tsx` builds the effective
  config once per render and threads it through `useSchedule(now, cfg)` +
  a small `ConfigContext` for decks. New `src/views/SettingsPanel.tsx`
  opened from a QuickNav "Settings" button — field-level validation,
  "Reset to defaults", and a "differs from shared schedule" hint since
  this repo's local override can now diverge from what it publishes to
  the other two apps. **Required guard while you're in there:**
  `useKeydown` must ignore events whose target is an input/textarea, or
  typing in the new Settings panel will drive the slideshow/countdown
  keyboard shortcuts.
- **(#44) Coming-up slide:** repurpose the currently-dead `'welcome'`
  slide layout (confirmed unused by any deck, and it also has a pre-
  existing bug rendering `slide.title` twice — fix that while you're in
  there) → rename to `'coming-up'`, add an `EventChips`-based row of
  upcoming special calendar events, extend `SlideDef` with an optional
  `events` field. New pure `buildClosingDeck(closing, events)` helper in
  `src/lib/decks.ts` (tested) appends the coming-up slide to the closing
  deck **only** when there are actual special events to show (never an
  empty-looking slide). While in this area, also fix the pre-existing
  duplication between the closing slide's "Have a great night! / See you
  next week!" text and `ShutdownView`'s separately-hardcoded "SEE YOU NEXT
  WEEK!" — have both read from one (settings-overridable) source.
- **(#50) Fork docs:** finish `church.config.ts` doc comments; README
  "Fork this for your church" section (edit church.config.ts,
  `shared/schedule.json`, `shared/theme.json`, swap the art, set the Vite
  `base`, GitHub Pages setup); update this repo's CLAUDE.md to describe
  its new shared-data-host role, the new hooks, the watchdog, and the
  Settings panel.

---

## General notes for whoever resumes this

- **Read `/root/.claude/plans/root-claude-uploads-dde90a52-96fc-584a-smooth-metcalfe.md`
  if it still exists in this environment** — it's the original approved
  plan with slightly more granular file-by-file detail per repo than this
  doc repeats. This doc is the authoritative *status* tracker; that file
  is the original *design* reference. If they conflict on some point
  because of something discovered mid-implementation, trust this doc and
  the actual code over the original plan.
- **Contract vectors must be byte-identical** between the printer and
  display repos once both exist — when creating the display repo's copy in
  Display Wave 1, copy the printer repo's file verbatim rather than
  re-deriving it.
- **Verify Pusher credentials before assuming live integration testing is
  possible** — this sandbox may not have real Pusher app keys configured;
  design/test the `pusher === null` / unconfigured path as a first-class
  case in every repo (all three already do this by convention — preserve
  it).
- **Don't relax the privacy invariant.** Every new Pusher event type needs
  its own strict allowlist sanitizer in the display app before that event
  can influence anything user-visible. When in doubt about a field, leave
  it out.
- **Task tracking:** this session was using TaskCreate/TaskUpdate; if you
  have access to the same task list, tasks #1–#6 correspond to the six
  chunks above (#1 Countdown Wave 1 = DONE, #2–#6 = the five bullets above
  in order). If you don't have that task list, it's fine — this doc is a
  complete substitute.
- **Update this file as you go.** When you finish Printer Wave 1, move its
  bullet from "Remaining work" up into "Status: what's DONE" (with the
  commit hash) so the next resume is accurate. Keep one synced copy in
  each of the three repos.
