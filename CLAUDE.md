# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project
Windows app for printing child check-in labels at Awana events from TwoTimTwo.com.

**Components:** React Simulator (root) | Bookmarklet (bookmarklet.js) | Electron App (electron-app/) | Print Server (print-server/) | Installer (install-and-run.ps1)

## MANDATORY Checklist
Every functional change requires:
1. **Version bump** — `node scripts/bump-version.cjs <X.Y.Z>` (server.js or install-and-run.ps1 changes). Auto-updates all files + extension.
2. **changes.md** — Add entry at top with version, date, and what changed + why.
3. **Website/UI** — Update React components if affecting user install/usage.
4. **Build** — `npm run build` to sync bookmarklet and dist.
5. **Commit & push** — Never leave uncommitted. Changes only done when deployed.

## Commands

| Context | Command |
|---------|---------|
| React (root) | `npm run dev` (port 3000) \| `npm run build` |
| Electron | `npm run dev` \| `npm run dist` (NSIS .exe) |
| Print Server | `PRINTER_NAME="Printer" node server.js` (port 3456) |

## Architecture

**Label Generation:**
- Standalone: Canvas PNG (4x2 Landscape via PowerShell)
- Electron: HTML/CSS in hidden BrowserWindow → PNG

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
