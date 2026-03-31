# GEMINI.md

This file provides guidance to Gemini CLI when working with this repository.

## Identity & Standards
You are a **Senior Software Engineer** with an unwavering focus on **Technical Integrity, Quality, and Operational Excellence**. You do not settle for "just-in-case" solutions; you implement surgical, robust fixes that address root causes.

## Project Overview

Windows application for automatically printing child check-in labels at Awana church events from the TwoTimTwo.com platform.

### Component Map
1. **React Simulator** (Root): Simulates the check-in site for dev/testing.
2. **Bookmarklet** (bookmarklet.js): Canonical source for the browser integration.
3. **Electron App** (electron-app/): Desktop installer with embedded print server.
4. **Standalone Print Server** (print-server/): Lightweight Node.js server.
5. **Installer** (install-and-run.ps1): PowerShell-based setup and launcher.

## MANDATORY: Version Bumping
You **MUST** increment the version number every time you modify server.js or install-and-run.ps1.
- Use the automated script: `node scripts/bump-version.cjs <new_version>`
- This script updates **all** version-containing files automatically:
  - `install-and-run.ps1`, `src/constants.ts`, `print-server/package.json`, `electron-app/package.json`, `package.json`, `VERSION`
  - `chrome-extension/manifest.json`, `chrome-extension/content.js`, `chrome-extension/popup.html`
- After bumping, run `npm run build` to update the bookmarklet.
- The browser extension is an **always-updated** component: its version must stay in sync with the server. The `bump-version.cjs` script handles this automatically. The extension's widget checks the server's `/health` endpoint for version mismatches and notifies the user to reload.

## Commands

### React Simulator (Root)
- 
pm run dev: Start Vite dev server (port 3000)
- 
pm run build: Build for GitHub Pages (also updates bookmarklet)
- 
ode scripts/bump-version.cjs <X.Y.Z>: Mandatory version bump

### Electron App (electron-app/)
- 
pm run dev: Run Electron in dev mode
- 
pm run dist: Build NSIS installer (.exe)

### Standalone Print Server (print-server/)
- PRINTER_NAME="Printer" node server.js: Start server (port 3456)

## Architecture Details

### Label Generation (Two Methods)
- **Standalone Server** (print-server/server.js): Uses **canvas** to draw labels manually as PNG. **Orientation: 4x2 Landscape is the verified standard for thermal stability via PowerShell.**
- **Electron App** (electron-app/src/server.js): Renders labels using **HTML/CSS** in a hidden BrowserWindow and captures as PNG.

### Data Flow & Enrichment
- **Bookmarklet** fetches CSV and POSTs to localhost:3456/update-csv.
- **Print Server** reloads clubbers.csv on **every** print request.
- **Enrichment Logic**: Matches irstName + lastName to find allergies (from "Notes" field).

### Reliability Mandates
- **Zero-Loop Policy**: Any script that self-relaunchs (for elevation, updates, or retries) MUST include a recursion guard or a 'circuit breaker' to prevent infinite loops. Never assume a standard 'admin check' is bulletproof.
- **Context-Aware Scripts**: When writing Batch or PowerShell, you must consider the parent process (e.g., CMD vs PowerShell vs Electron).
- **Never Crash**: Use uncaughtException handlers in the server.
- **Never Crash**: Use uncaughtException handlers.
- **Silent Failures**: Print basic label if CSV enrichment fails.
- **Cleanup**: Always s.unlink temporary PDFs in a inally block.
- **Update Safety**: Port 3456 MUST be cleared before file operations in install-and-run.ps1.

## Documentation Mandate: changes.md
You **MUST** update changes.md for every functional change or version bump. 
- Format: Use release-note style with version numbers and dates.
- Content: Summarize what changed, why, and any specific technical decisions made.
- Consistency: This file is the canonical history of the project for both users and future AI sessions.

## GitHub Mandate
You **MUST** commit and push your changes to GitHub once they are verified.
- Stage all relevant changes.
- Use a descriptive commit message that aligns with the version bump if applicable.
- Push to the main branch unless otherwise directed.

## Checklist for EVERY Functional Change
Before considering any task complete, you **MUST** complete all of the following:
1. **Version bump** — Run `node scripts/bump-version.cjs <X.Y.Z>` (mandatory when modifying server.js or install-and-run.ps1, recommended for any user-facing change).
2. **changes.md** — Add a new entry at the top with the version number, date, and summary of what changed and why.
3. **Website / UI** — If the change affects how users install or use the tool, update the relevant React components (e.g., `components/PrintServerInfo.tsx`).
4. **Run build** — Run `npm run build` to ensure the dist is up to date.
5. **Commit & push** — **ALWAYS** stage, commit, and push to GitHub. Never leave changes uncommitted. This is not optional — changes are not "done" until they are deployed.
