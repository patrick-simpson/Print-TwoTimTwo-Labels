# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project

Windows tool for printing child check-in labels at Awana events from TwoTimTwo.com.

**Two shipped components:**

| Component | Path        | What it is                                                                 |
|-----------|-------------|----------------------------------------------------------------------------|
| Print Server | `server/`   | Node.js + Express, renders labels via `node-canvas`, prints silently on Win32. |
| Extension    | `extension/`| Chrome/Edge MV3 content script that watches TwoTimTwo and POSTs check-ins. |

Plus a static landing/setup site in `website/` (React + Vite, published to GitHub Pages). The `scripts/` folder contains version sync + check tooling.

Electron, PowerShell installers, `install.bat`, and `launch-awana.bat` have all been removed — the supported delivery path is now **zip-and-extract**.

---

## MANDATORY Checklist

Every functional change:

1. **Bump version** — `node scripts/bump-version.cjs <X.Y.Z>` (touches every versioned file).
2. **Verify** — `node scripts/check-versions.cjs` (CI also runs this).
3. **Update `changes.md`** — new entry at the top with version, date, what, why.
4. **Update the website** (`website/`) if user-facing install steps changed.
5. **Run tests** — `cd server && npm test` (Node's built-in `node:test`, no extra deps).
6. **Run build** — `npm run build` at root (website) + verify `dist/website/` exists.
7. **Commit & push** — never leave uncommitted. Changes are only done when deployed.

---

## Commands

| Context     | Command                                         |
|-------------|--------------------------------------------------|
| Website dev | `npm run dev` (port 3000)                        |
| Website build | `npm run build` → `dist/website/`              |
| Server run  | `cd server && npm start` (port 3456)             |
| Server test | `cd server && npm test`                          |
| Extension   | Load `extension/` unpacked in `chrome://extensions` |
| Version bump | `node scripts/bump-version.cjs X.Y.Z`           |
| Version check | `node scripts/check-versions.cjs`             |

---

## Architecture

### Print server (`server/`)
- `server.js` — thin 50-line entrypoint; wires modules and starts the listener.
- `src/csv.js` — CSV parser + canonical header normalization. Handles quoted fields with embedded newlines (TwoTimTwo export format). Pure, never throws.
- `src/label.js` — 4×2 label renderer via `node-canvas`. Takes fields in, returns `{ pngPath, buffer }`.
- `src/printer.js` — Windows-only printer enumeration and silent-print via PowerShell `System.Drawing`.
- `src/enrich.js` — allergy parsing, birthday-week detection, handbook group normalization.
- `src/config.js` — `config.json` loader/saver with atomic writes.
- `src/roster.js` — in-memory CSV cache, reloaded on every print request.
- `src/history.js` — ring-buffer print history.
- `src/routes.js` — Express route definitions; wires all modules together.
- `src/log.js` — leveled stderr/stdout logger.
- `test/` — unit tests (`node --test`).

### Extension (`extension/`)
- `content.js` — single-file content script. Selectors are centralized in a `SELECTORS` constant at the top for quick updates when TwoTimTwo redesigns their page. A selector heartbeat runs every 60 s and logs a clear warning if the expected elements stop matching.
- `background.js` — minimal service worker.
- `popup.html` / `popup.js` — settings UI.

### Website (`website/`)
- `App.tsx` — single-file landing page with Hero, How it works, Setup guide, Label preview, Troubleshooting, Footer.
- `components/ClubberList.tsx`, `CheckinModal.tsx` — reused for the interactive label preview.
- `vite.config.ts` — builds to `dist/website/`, base path `/Print-TwoTimTwo-Labels/` for GitHub Pages.

---

## Reliability Mandates

- **Process never dies.** `uncaughtException` + `unhandledRejection` handlers in `server.js` keep the process alive; a jammed printer cannot take down a live event.
- **CSV parsing is defensive.** Returns `[]` on any error. The printer falls back to a basic label (no enrichment) if the roster is missing or malformed.
- **Temp files always cleaned up.** Every label render writes a PNG to `os.tmpdir()`; the route handler unlinks it in a `finally` block.
- **Atomic config writes.** `config.save()` writes to `config.json.tmp` then `rename()` so a crash mid-write can't corrupt the file.
- **Port collisions fail loudly.** If 3456 is taken, the server prints an actionable message and exits — it does NOT kill whatever else is on the port.
- **Selector drift is surfaced.** Extension heartbeat warns in console after 3 consecutive minute-checks where TwoTimTwo selectors don't match anything.
- **Version drift is a build failure.** `check-versions.cjs` runs in CI and release; any mismatch fails the pipeline.

---

## CI / Releases

- `.github/workflows/ci.yml` — version check, server tests, website build on every PR.
- `.github/workflows/release.yml` — on `v*` tags, builds both zips and attaches them to a GitHub Release.
- `.github/workflows/deploy-website.yml` — on pushes to `main` touching `website/`, deploys to GitHub Pages.
