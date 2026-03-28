# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Windows application for automatically printing child check-in labels at Awana church events from the TwoTimTwo.com check-in platform. It has three deployment paths:

1. **Electron Desktop App** — Standalone Windows app with embedded print server
2. **PowerShell Script** — Installer/launcher for the standalone Node.js print server

## Commands

### React Simulator App (root)
```bash
npm run dev          # Start Vite dev server on port 3000
npm run build        # Build React app to /dist (runs validate-bookmarklet first)
npm run preview      # Preview production build
npm run validate-bookmarklet  # Validate bookmarklet syntax
```

### Electron App
```bash
cd electron-app
npm run dev          # Run Electron in dev mode
npm run build:renderer  # Build React renderer only
npm run dist         # Build Awana-Label-Printer-Setup.exe installer
```

### Print Server (standalone)
```bash
cd print-server
PRINTER_NAME="My Printer" node server.js   # Runs on port 3456
```

No test or lint scripts are configured.

## Architecture

### Two Deployment Paths

**Electron App** (`electron-app/`)
- `main.js`: Main process — single-instance lock, system tray, IPC handlers, printer enumeration via `webContents.getPrintersAsync()`, loads config from `%APPDATA%\Awana-Print\config.json`
- `src/server.js`: Embedded Express server (port 3456) — generates PDFs via a hidden Electron BrowserWindow (avoiding Puppeteer's ~170MB), sends to Windows printer via `pdf-to-printer`
- `renderer/`: React UI setup wizard for first-time configuration

**React Simulator** (root `App.tsx`, deployed to GitHub Pages)
- Simulates the TwoTimTwo check-in page for testing the bookmarklet without live site access
- Components: `CheckinModal.tsx`, `ClubberList.tsx`, `PrintServerInfo.tsx`
- Mock data in `data.ts`

**Bookmarklet** (`bookmarklet.js` at project root)
- This is the canonical source for the bookmarklet IIFE — edit this file, not `public/bookmarklet.html`
- A Vite plugin in `vite.config.ts` serves it at `/bookmarklet.js` during dev and emits it to `dist/` at build time
- `public/bookmarklet.html` fetches it via `fetch('./bookmarklet.js')` to build the draggable bookmark URL
- `scripts/validate-bookmarklet.cjs` reads it directly for syntax checking (runs as `prebuild`)
- `bookmarklet.min.js` (generated) — contains `javascript:` + the minified IIFE on one line; paste its entire contents directly into a browser bookmark's URL field. Regenerate with `npm run build:bookmarklet` after editing `bookmarklet.js`
- On load, the bookmarklet fetches `/clubber/csv` from the same origin (using the browser's authenticated session) and POSTs the CSV data to `localhost:3456/update-csv` so the print server has fresh enrichment data

**PowerShell Script** (`install-and-run.ps1`)
- On launch, opens two Edge tabs: the check-in URL and `http://localhost:3456/bookmarklet.html` so the user can drag the bookmarklet to their bookmark bar on first run
- Creates a desktop shortcut ("Awana Print") pointing to `launch-awana.bat` for day-to-day use without PowerShell

**Desktop Launcher** (for end users after initial install)
- `install.bat` — First-time install wrapper; double-click instead of .ps1 to avoid security warnings
- `launch-awana.bat` — Day-to-day launcher (no PowerShell); reads config via `read-config.js`, starts Node server, opens Edge
- `read-config.js` — Tiny helper that prints config.json values for batch consumption
- These files are copied to `%APPDATA%\Awana-Print\` by the installer (one level above the project dir, so they survive re-downloads)

### Key Constants (`src/constants.ts`)
- `SERVER_PORT = 3456` — print server port used across all components
- `PRINT_COOLDOWN = 2000ms` — debounce to prevent duplicate prints
- Label size: 4" × 2" (288pt × 144pt)
- DOM selectors for TwoTimTwo.com: `#lastCheckin div`, `.clubber`, `.name`, `.club img`

### Label Format
4" × 2" PDF labels containing: first name (large/bold), last name, club logo, KVBC footer. Print quality target is 300 DPI; Windows printer properties must be set to the correct paper size.

## Versioning

The PowerShell script and the React web app share a single version number that must stay in sync. Whenever you change either file, bump the version in **both** places:

| File | Location |
|---|---|
| `install-and-run.ps1` | Line 2 comment (`# Version    : X.Y.Z`) **and** `$ScriptVersion = "X.Y.Z"` (line 27) |
| `src/constants.ts` | `SERVER_VERSION = 'X.Y.Z'` (displayed in the web UI via `PrintServerInfo.tsx`) |

Use [semver](https://semver.org/): patch bump for bug fixes, minor bump for new features, major bump for breaking changes.

## Release Process

Electron installer is built via GitHub Actions (`build-electron.yml`):
1. Tag the commit: `git tag v1.0.1`
2. Push the tag: `git push origin v1.0.1`
3. CI builds `Awana-Label-Printer-Setup.exe` on a Windows runner and attaches it to the GitHub Release.

The React simulator deploys automatically to GitHub Pages on every push to `main` (`deploy.yml`). Base path is `/Print-TwoTimTwo-Labels/` (configured in `vite.config.ts`).

## Key Dependencies

| Package | Where used | Purpose |
|---|---|---|
| `jsPDF` | Chrome extension, root React app | In-browser PDF generation |
| `pdf-to-printer` | Electron embedded server, standalone print server | Send PDF to Windows printer |
| `electron-builder` | `electron-app/` | Package Electron app as NSIS installer |
| `pdfkit` | `print-server/` | PDF generation in standalone Node server |
