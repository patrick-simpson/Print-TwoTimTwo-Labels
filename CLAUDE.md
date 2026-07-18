# CLAUDE.md

Senior Software Engineer focused on **Technical Integrity, Quality, and Operational Excellence**. Surgical fixes addressing root causes, not workarounds.

## Project
Windows app for printing child check-in labels at Awana events from TwoTimTwo.com.

**Components:** React Simulator (root) | Bookmarklet (bookmarklet.js) | Electron App (electron-app/) | Print Server (print-server/) | Installer (install-and-run.ps1)

## MANDATORY Checklist
Every functional change requires:
1. **Version bump** — `node scripts/bump-version.cjs <X.Y.Z>` (server.js or install-and-run.ps1 changes). Auto-updates all files + extension. Also regenerate lockfiles (`npm install --package-lock-only` in `print-server/` and `electron-app/`) — the bump script doesn't touch their `version` field.
2. **changes.md** — Add entry at top with version, date, and what changed + why.
3. **Website/UI** — Update React components if affecting user install/usage.
4. **Build** — `npm run build` to sync bookmarklet and dist.
5. **Commit & push** — Never leave uncommitted. Changes only done when deployed.
6. **Cut the release** (if `electron-app/` or `print-server/` changed) — see "Releasing the Windows app" below. Don't stop at pushing to `main`; the `.exe` isn't live until the tagged build publishes.

## Releasing the Windows app

**Never create the release tag manually** (`git tag` + `git push`, or the GitHub web UI "Draft a new release" flow). This has repeatedly failed in practice: a Claude Code session's git access is commonly scoped to branches only (tag pushes rejected), and manual web-UI tagging has hit silent footguns — tag name case-sensitivity (`build-electron.yml` matches lowercase `v*` only; `V5.0.2` or `5.0.2` without the `v` silently never triggers it), and republishing a release without first deleting its underlying tag reuses the old tag ref instead of moving it.

Instead, after steps 1–5 land on `main`, cut the release by dispatching **`.github/workflows/create-release-tag.yml`** with a `version` input (e.g. `5.0.2`, no leading `v`):
- **Human:** GitHub → Actions tab → "Create Release Tag" → Run workflow → enter the version.
- **Claude:** `mcp__github__actions_run_trigger` with `method: "run_workflow"`, `workflow_id: "create-release-tag.yml"`, `ref: "main"`, `inputs: {"version": "5.0.2"}`.

That workflow creates and pushes the `vX.Y.Z` tag using its own `GITHUB_TOKEN` (not subject to session git restrictions), which fires `build-electron.yml`'s normal tag-push trigger: build → headless render smoke test → silent-install + `/health` + `/preview` smoke test on a Windows runner → publish the `.exe` + `latest.yml` + blockmap to the GitHub Release. Watch it through via `mcp__github__actions_get`/`get_job_logs` — don't consider a release done until that pipeline is green and the release has assets attached.

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
