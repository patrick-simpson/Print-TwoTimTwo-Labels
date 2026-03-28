# GEMINI.md

This file provides guidance to Gemini CLI when working with this repository.

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
- Use the automated script: 
ode scripts/bump-version.cjs <new_version>
- This script updates all 4 relevant files automatically.
- After bumping, run 
pm run build to update the bookmarklet.

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
- **Standalone Server** (print-server/server.js): Uses **pdfkit** to draw labels manually.
- **Electron App** (electron-app/src/server.js): Renders labels using **HTML/CSS** in a hidden BrowserWindow.

### Data Flow & Enrichment
- **Bookmarklet** fetches CSV and POSTs to localhost:3456/update-csv.
- **Print Server** reloads clubbers.csv on **every** print request.
- **Enrichment Logic**: Matches irstName + lastName to find allergies (from "Notes" field).

### Reliability Mandates
- **Never Crash**: Use uncaughtException handlers.
- **Silent Failures**: Print basic label if CSV enrichment fails.
- **Cleanup**: Always s.unlink temporary PDFs in a inally block.
- **Update Safety**: Port 3456 MUST be cleared before file operations in install-and-run.ps1.
