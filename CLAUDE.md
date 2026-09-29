# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project
Windows app for printing child check-in labels at Awana events from TwoTimTwo.com. Branded **"Club Label Printer"** since v5.9.0 (was "Awana Label Printer" — renamed for Awana Clubs International trademark compliance; see changes.md's 5.9.0 entry for the full rationale).

**Components:** React Simulator (root) | Chrome Extension (chrome-extension/, zipped for download by bump-version.cjs) | Electron App (electron-app/) | Print Server (print-server/) | Legacy Installer (install-and-run.ps1, deprecated)

**Branding vs. internal identifiers — don't conflate these when touching either:**
`productName` (`electron-app/package.json`) is "Club Label Printer" — every
user-visible string (window titles, tray, shortcuts, installer filename)
should match it. `"name"`/`"appId"` (`awana-label-printer` /
`com.kvbc.awana-label-printer`) are **deliberately still the old name** —
electron-builder derives the install directory and `app.getPath('userData')`
from `"name"`, not `productName` (confirmed in `build-electron.yml`'s CI
comment), so renaming it would orphan every existing install's data folder
and break the NSIS upgrade-in-place registry lookup for zero user-visible
benefit. `%APPDATA%\awana-label-printer\chrome-extension` is therefore the
real, current path — don't "fix" it back to a title-cased `Club Label
Printer` folder; it was never that, even under the old branding (that was a
pre-existing doc bug, corrected in the 5.9.0 pass). Same reasoning protects
the Pusher channel `awana-channel` (shared wire protocol with the
`Awana-Check-in-Display` repo) and the `AWANA_*` env vars / `X-Awana-Pin`
header / `window.awana` bridge (internal-only, never shown to a user) — none
of these are part of the product's public branding, so none of them move if
"Club Label Printer" ever changes again.

## MANDATORY Checklist
Every functional change requires:
1. **Version bump** — `node scripts/bump-version.cjs <X.Y.Z>` (server.js or install-and-run.ps1 changes). Auto-updates all files + extension. Also regenerate lockfiles (`npm install --package-lock-only` in `print-server/` and `electron-app/`) — the bump script doesn't touch their `version` field.
2. **changes.md** — Add entry at top with version, date, and what changed + why.
3. **Website/UI** — Update React components if affecting user install/usage.
4. **Build** — `npm run build` to sync bookmarklet and dist.
5. **Commit & push** — Never leave uncommitted. Changes only done when deployed.
6. **Open a PR to `main`** — ALWAYS, for every pushed branch, including
   website-only changes: nothing is live until it lands on `main` (GitHub
   Pages deploys from `main`, and releases are cut from `main`), so a pushed
   branch with no PR is work stranded where the operator can't see it. This
   rule exists because it happened: the round-2 ideas page sat pushed-but-dark
   until someone asked where it was. If the operator hasn't said otherwise,
   also merge it once CI is green.
7. **Cut the release** (if `electron-app/` or `print-server/` changed) — see "Releasing the Windows app" below. Don't stop at pushing to `main`; the `.exe` isn't live until the tagged build publishes.

## Releasing the Windows app

**Never create the release tag manually** (`git tag` + `git push`, or the GitHub web UI "Draft a new release" flow). This has repeatedly failed in practice: a Claude Code session's git access is commonly scoped to branches only (tag pushes rejected), and manual web-UI tagging has hit silent footguns — tag name case-sensitivity (`build-electron.yml` matches lowercase `v*` only; `V5.0.2` or `5.0.2` without the `v` silently never triggers it), and republishing a release without first deleting its underlying tag reuses the old tag ref instead of moving it.

Instead, after steps 1–5 land on `main`, cut the release by dispatching **`.github/workflows/create-release-tag.yml`** with a `version` input (e.g. `5.0.2`, no leading `v`):
- **Human:** GitHub → Actions tab → "Create Release Tag" → Run workflow → enter the version.
- **Claude:** `mcp__github__actions_run_trigger` with `method: "run_workflow"`, `workflow_id: "create-release-tag.yml"`, `ref: "main"`, `inputs: {"version": "5.0.2"}`.

That workflow creates and pushes the `vX.Y.Z` tag using its own `GITHUB_TOKEN` (not subject to session git restrictions), then explicitly dispatches `build-electron.yml` against that tag — a plain tag push alone isn't enough, because GitHub's anti-recursion rule means a push made *by* `GITHUB_TOKEN` doesn't fire other workflows' `push` triggers (confirmed the hard way: v5.0.2's tag was created but never auto-built). The dispatched run behaves identically to a native tag-push trigger: build → headless render smoke test → silent-install + `/health` + `/preview` smoke test on a Windows runner → publish the `.exe` + `latest.yml` + blockmap to the GitHub Release. Watch it through via `mcp__github__actions_get`/`get_job_logs` — don't consider a release done until that pipeline is green and the release has assets attached.

**Made a mistake (wrong-case tag, stray manual release)?** Don't try to delete it via git/web UI either — same restriction. Dispatch **`.github/workflows/delete-release.yml`** with `tag` set to the exact stray tag name; it removes both the release and its underlying git tag via its own token. Do this promptly if the mistaken tag/release is newer than the real one — GitHub's "latest release" (which electron-updater's auto-update check queries) is whichever release was published most recently, not the highest version number, so a stray release left in place can break real users' auto-update.

## Commands

| Context | Command |
|---------|---------|
| React (root) | `npm run dev` (port 3000) \| `npm run build` |
| Electron | `npm run dev` \| `npm run dist` (NSIS .exe) |
| Print Server | `PRINTER_NAME="Printer" node server.js` (port 3456) |

## Public website (root React app → GitHub Pages)

The home page is a capability showcase written for church leadership first
(then other churches and volunteers: the Simulator, Install Guide and FAQ
sit lower down, and the `#install`, `#simulator`, `#faq`, `#features` and
`#how-it-works` anchors must keep resolving). It is one of three "family"
pages with the Check-in Display's and Journey Display's `about.html`.

- **This repo holds the family design system.** `styles/family.css` is the
  canonical stylesheet and `docs/FAMILY-DESIGN.md` its spec
  (`docs/family-reference.html` renders every component). Byte-identical
  copies live at `Awana-Check-in-Display/public/family.css` and
  `Journey-Display/public/family.css`: change the canonical file, copy it
  over both, and bump the `family.css?v=N` token on both about pages.
  Page-only styling goes in `styles/page.css` (`lbl-` prefix).
- **Tailwind v4 is compiled** (`@tailwindcss/vite`, `styles/site.css` with
  `source(none)` + explicit `@source` lines limited to the site's own files).
  No runtime CDN, no import map; icons are the inline SVG sprite in
  `components/family/Icons.tsx`.
- **The Simulator's DOM is a contract.** `#lastCheckin`, `.clubber`,
  `.name` and `.club img` (see `src/constants.ts` DOM_SELECTORS) mirror
  TwoTimTwo's real page, so keep that structure whenever it is restyled.
  Its roster (`data.ts`) is obviously fictional full names on purpose.
- **Claims track the code.** Every sentence must be true of the current
  release; a feature change that the page describes updates the page in the
  same PR. Opt-in features carry a `.fam-card__tag`, the phone's "Not here"
  list is always shown with its safeguards, and the label mocks follow
  `generateLabel()`. Screens are CSS recreations with generic first names
  and no Awana logos or club art; the disclaimer bar, meta description and
  footer carry the not-affiliated line. Links out go only to the two sibling
  about pages, the three repos and this app's own downloads, never to the
  live signage or kiosk roots.

## Architecture

**Label Generation:**
- ONE renderer: `generateLabel()` in `print-server/server.js` draws a
  1200×600 canvas PNG (4x2 @ 300dpi), printed via PowerShell
  `System.Drawing`. Electron does NOT render labels — its only hidden
  BrowserWindow is for printer enumeration; it require()s the print server
  in-process. (The extension's offline fallback label in `content.js` is a
  deliberately degraded safety artifact, not a second layout to keep in sync.)
- Per-club layout: `config.labelTemplates` (overrides-only, keyed by
  `clubKey()`), resolved by `labelTemplateFor()` in the HANDLERS and passed
  in as `input.template` — the renderer never reads config (golden-suite
  purity). Fail open: any broken template renders the stock label. Safety
  content (allergy icons, no-photo camera, birthday) is not templatable.

**Tonight's count:** TwoTimTwo's own `/clubber/checkin_report` is the source of
truth when it is fresh (received within `REPORT_FRESH_MS`, 12 minutes); the
printer's own history is the fallback, and `/health` raises a
`{type:'tally-source'}` warning whenever it is the one being used.
`authoritativeTonight()` in `print-server/server.js` is **the one function** —
`publishTally()`, `computeTonightStats()` (so `/stats/tonight` and the
dashboard), `/phone/tonight` and `/health` all read it, and none of them
computes a count of its own. Rules: only a report the reconcile pass actually
APPLIED is kept (one the mass-undo guard refused would zero a night); a row
marked `undoneBy` — the phone's Remove, or `/reset-tonight` — beats the report,
because TwoTimTwo goes on listing that child all evening; unregistered visitors
do not count while a report is fresh (owner's decision — they are not on it);
identities match on BOTH the clubber id and the name, so one child is never two.
The `tally` payload shape is unchanged and must stay so.

**The brand kit (6.17.0, shout face Paytone One since 6.18.0).**
`print-server/public/brand/` is a byte-identical
mirror of the canonical kit in Awana-Check-in-Display (`shared/brand/`), pinned
by `scripts/brand-kit.sha256` and checked by `scripts/test-brand-kit.cjs` (in
`npm test`); take a new kit with `node scripts/gen-brand-manifest.cjs --from
<canonical>`, never by hand (the text files are LF only; `.gitattributes`
keeps them so). `print-server/brand.js` registers Paytone One / Londrina Solid /
Figtree with the canvas and loads the official one-colour club marks, and
EVERYTHING in it fails open: a missing or damaged font, or a letter the font
lacks, prints that word in the old Windows face; a missing mark falls back to
the letter monogram; with the whole kit gone the label is the pre-rebrand one.
`/health` reports `fonts` / `clubMarks` and raises `brandFonts` / `brandMarks`
`{type, message}` warnings (reasons are fixed strings, never paths). The kit
folder is the ONE path served before the PIN gate (`/brand/`, only `.css`,
`.woff2`, `.ttf`, `.svg` with plain paths), because the phone page is the PIN
screen; keep it to public brand files only.

**The shout is Paytone One (6.18.0), not Galindo.** Owner decision 2026-09-29:
Galindo "looks too much like SpongeBob", so the first name, the monogram, a
custom label and every screen's headline are Paytone One (OFL; its Reserved
Font Names forbid a subset or re-encode, so the kit ships the FULL font and a
WOFF2 built to meet the OFL's WOFF exception: never swap in a Google or
@fontsource subset). Londrina Solid (label voice) and Figtree (read voice)
stayed; Londrina reserves its name too, so it ships whole the same way (its
web copies were Latin subsets until the 6.18.0 kit). What that means here:
- **Coverage moved.** Paytone One draws Ș Ț and every precomposed Vietnamese
  letter, which Galindo did not, so those first names and custom labels now
  print in the kit. It still lacks Cyrillic, Greek, CJK and the rest, and a
  few Latin letters (Ewe ɔ), which fall back whole. Figtree still lacks the
  precomposed Vietnamese letters, so a last name like "Nguyễn" falls back on
  its own (each voice decides for itself). Any test about "a letter the shout
  face lacks" must use a letter its character map really lacks: Cyrillic or
  Greek (`test-brand-kit.cjs` pins that they stay uncovered).
- **The ink sits differently in its box.** Measured off the canvas at a 'top'
  baseline: Paytone's capitals start 0.26 em down and its descenders are
  shallower than Galindo's, so the name is drawn `NAME_LIFT_BRAND` above its
  line box and the box is `NAME_LINE_H_BRAND`; and because it draws accents
  and the Ș comma far outside that box (Ấ rises 0.23 em above the origin, the
  comma hangs to 1.31 em), the layout also measures the name's own ink
  (`labelType().inkReach`) and reserves room above and below when a glyph
  needs it. `'middle'`-baseline lines (custom label, monogram) are centred on
  the capitals with `labelType().capCentre`. All of that applies only when the
  line prints in the kit face, so the old-Windows-face fallback labels are
  byte-identical to before (`fonts-fallback` and `kit-missing` baselines did
  not change), and the golden suite's "ink clear of the badge and the last
  name" checks measure pixels, not the layout numbers.
- **A mark's room comes from the paper first, then the block, then size.** A
  rising mark (É, Ấ) may print as near as `NAME_INK_TOP` (4 pt, what 6.17.0
  already printed) to the top edge; `accentCharge` charges the block only for
  what that margin cannot give. Past the 18 pt floor the room a mark or a comma
  asks for is given back in name size (at most `NAME_ROOM_SHRINK_MAX` under
  the floor), never left to land on the bottom band: the busiest step-up label
  (trophy chip, "Go to", milestone, twin hint) prints its callout exactly where
  an ordinary name does. Do not charge the whole room to `blockH` again (it cost
  accented names up to a quarter of their size on a crowded label), and do not
  let the leftover ride down (it printed the callout over the chip).
- **Wrapped custom labels set their pitch from the ink.** The marks are taller
  than the old 1.15 em line pitch (Ấ 1.19-1.22 em), so `customLineH` widens the
  pitch to the first line's lowest ink + the second's highest + a small gap
  whenever the whole label is in the kit face, and `fitCustomLabelText` fits
  the height with it (`lineH` in its result). Old-face labels keep 1.15 exactly.
  Any other place that stacks two kit lines needs the same, measured with
  `inkReach(..., 'alphabetic')`.
- **One name in three places.** The family string is `FONT_FILES[0]` in
  `brand.js`, `--brand-font-display` / `fonts.css` in the kit, and each
  surface's `--f-shout` fallback (dashboard, phone, bookmarklet, the status
  window) plus `step-chip.js`'s measuring family; `test-brand-kit.cjs` and
  `test-dashboard-chrome.cjs` fail if they drift. The installer's `/health`
  smoke check still needs 4 loaded fonts (Paytone One, Londrina Solid, Londrina
  Solid Black, Figtree): the number is unchanged.

**Custom labels never write history.** `POST /print-custom` prints one line of
free text on a blank label and records nothing at all: no `addHistoryEntry`, no
`recordAttendance`, no `publishTally`, no `events.publish*`. It is not a
check-in in any mode, so it carries no TEST band either.

**Realtime privacy:** the Pusher channel is PUBLIC and Pusher public channels
have no server-side authorization primitive, so `checkin`, `recap` and
`birthdays` are sealed with AES-256-GCM before publish (`print-server/events.js`;
consumer half is `src/lib/envelope.js` in the display repo). Rules that must
survive any change:
- **Fail closed, never plaintext.** If a key is configured but a payload cannot
  be sealed, publish NOTHING. A silent downgrade is the worst outcome available.
- With **no** key configured the publisher stays plaintext on purpose (an
  operator who has not opted in must not have banners break on an auto-update),
  and `/health` says so loudly. Anti-downgrade lives on the consumer.
- Padding is part of the spec, not an optimisation — GCM leaks
  `len(firstName) + len(club)` without it, and club is inferable from the
  plaintext `tally`. `npm run test:envelope` fails the build if two `checkin`
  frames differ in length.
- The framing is pinned by `envelope-vectors.json`, mirrored byte-identically
  into the display repo. Changing it means bumping `ENVELOPE_VERSION`,
  `npm run gen:envelope-fixture`, and landing both repos together — there is no
  partial failure, either the sides agree or no name renders anywhere.
- **Printing is never gated on the pipe.** A child at the door gets a label even
  if the key, Pusher and the network are all broken.

**Extension distribution:** the extension is loaded UNPACKED, so Chrome never
auto-updates it and a self-hosted `update_url` is not honoured — silent update
is not available and must not be claimed. Instead `chrome-extension/` ships in
`extraResources` and the app syncs it into
`%APPDATA%\awana-label-printer\chrome-extension` on every launch
(`electron-app/src/extension-sync.js`), so an update costs a Chrome restart.
Rules: the target lives under **userData**, never `resources/` (an update
replaces that wholesale and Chrome would be left pointing at nothing); files are
written tmp+rename because Chrome may be reading them; files a new version drops
are pruned, or manifest.json loads old code beside new. The folder path is
loopback-only in `/health` — it contains the operator's Windows username and
`/health` is CORS-readable from the check-in site. The version is not gated;
the extension needs it for the update banner.

**`/health` warnings must be `{type, message}` objects.** The dashboard renders
`w.message`, so a bare string painted an EMPTY yellow box — the privacy and
phone-PIN warnings were invisible for exactly this reason. `warningTexts()` in
`test-server-realtime.cjs` fails by name if strings come back.

**Config writes:** `config.json` has several writers with different views of it.
Use `applySavedConfig()` for the live sync — plain `Object.assign` cannot DELETE,
which is why clearing the phone PIN used to leave the old one accepted until a
restart. The Electron app must merge via `electron-app/src/config-store.js`,
never write the file whole.

**Data Flow:**
- Bookmarklet fetches CSV → POST /update-csv
- Server reloads clubbers.csv on every print request
- Enrichment: Match firstName+lastName to allergies (Notes field)

## Reliability Mandates
- **Zero-Loop Policy:** Self-relaunching scripts MUST have recursion guards. Never assume admin checks are bulletproof.
- **Context-Aware:** Batch/PowerShell must account for parent process (CMD vs PowerShell vs Electron).
- **Never Crash:** uncaughtException handlers in server; silent failures for enrichment (print basic label).
- **Cleanup:** Always unlink temp files in finally blocks.
- **Update Safety:** Clear port 3456 before file operations in install-and-run.ps1.
