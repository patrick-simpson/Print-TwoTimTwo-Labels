# CLAUDE.md — AI Assistant Guide for Print-TwoTimTwo-Labels

## Project Overview

**Awana Label Printer** — A Windows-native solution that silently prints 4"×2" identification labels when children check in on [TwoTimTwo.com](https://twotimtwo.com) (a Kids Club check-in platform). This project is **not affiliated with TwoTimTwo.com**.

### Core User Problem
Church ministry workers need to print labels at check-in without interrupting the workflow. This project eliminates manual print dialogs by intercepting check-in events on TwoTimTwo.com and sending label print jobs directly to a configured label printer (DYMO, Brother QL, etc.).

### Three Deployment Options
1. **Electron App** (`electron-app/`) — A Windows `.exe` installer with embedded print server and setup wizard (recommended)
2. **PowerShell Script** (`install-and-run.ps1`) — Downloads and runs the print server automatically
3. **Chrome Extension** (`chrome-extension/`) — Browser-native silent printing via `--kiosk-printing` flag

---

## Repository Structure

```
Print-TwoTimTwo-Labels/
├── index.tsx / App.tsx          # React simulator UI (dev/testing only)
├── index.html                   # HTML entry with Tailwind CDN + import maps
├── types.ts                     # Clubber interface + CLUBS image map
├── data.ts                      # 16 mock clubbers for simulator testing
├── src/constants.ts             # Central constants (ports, timeouts, selectors)
│
├── components/
│   ├── ClubberList.tsx          # Grid display of children
│   ├── CheckinModal.tsx         # Check-in confirmation dialog
│   ├── PrintServerInfo.tsx      # Setup wizard UI + health check + CSV docs
│   └── ExtensionInfo.tsx        # Chrome extension installation guide
│
├── chrome-extension/
│   ├── manifest.json            # Manifest v3
│   ├── content.js               # Injected on TwoTimTwo.com — intercepts check-ins
│   ├── background.js            # Service worker — handles print requests
│   └── lib/jspdf.umd.min.js    # Bundled jsPDF
│
├── print-server/
│   ├── server.js                # Express server on localhost:3456
│   ├── package.json             # Server dependencies
│   └── clubbers-template.csv   # Template for enrichment data
│
├── electron-app/
│   ├── main.js                  # Electron main process
│   ├── preload.js               # IPC bridge (contextBridge)
│   ├── src/server.js            # Bundled print server copy
│   ├── src/checkin-script.js    # Bookmarklet script copy
│   └── renderer/                # React setup wizard + status UI
│
├── public/bookmarklet.html      # Bookmarklet generator (GitHub Pages hosted)
├── install-and-run.ps1          # PowerShell installer/runner (v1.4.1)
│
├── .github/workflows/
│   ├── webpack.yml              # Build test (Node 18/20/22)
│   ├── deploy.yml               # Deploy to GitHub Pages
│   └── build-electron.yml       # Build Windows .exe on tagged releases
│
├── README.md                    # User-facing setup guide
├── TROUBLESHOOTING.md           # Common issues and solutions
└── changes.md                   # Design decisions and project history
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend UI | React 19, TypeScript 5.8, Vite 6 |
| Styling | Tailwind CSS (CDN) |
| PDF generation | jsPDF 4.x (client/extension), pdfkit 0.15 (server) |
| Print server | Node.js + Express 4.x + pdf-to-printer 5.x |
| Desktop app | Electron 28 + electron-builder 24 |
| Extension | Chrome Manifest v3, service worker |
| CI/CD | GitHub Actions |

---

## Development Workflows

### Local Frontend Development (React Simulator)

```bash
npm install
npm run dev        # Starts Vite dev server at http://localhost:3000
npm run build      # Builds to /dist (used by GitHub Pages deploy)
npm run preview    # Preview production build
```

The React app is a **simulator only** — it recreates the TwoTimTwo DOM structure for testing the bookmarklet/extension logic locally. It is not the check-in UI itself.

### Print Server Development

```bash
cd print-server
npm install
node server.js     # Runs on localhost:3456
```

Test endpoints:
- `GET /health` — Returns server status and printer list
- `GET /printers` — Lists available Windows printers
- `POST /print` — Accepts `{ name, club, color, group, allergies, birthday, handbookGroup, printerName }` and prints a label

### Electron App Development

```bash
cd electron-app
npm install

# Build renderer UI first
cd renderer && npm install && npm run build && cd ..

# Run in dev mode
npm start

# Build distributable .exe
npm run dist
```

### Chrome Extension Development

1. Open `chrome://extensions` in Chrome
2. Enable Developer Mode
3. Click "Load Unpacked" → select `chrome-extension/`
4. For silent printing: launch Chrome with `--kiosk-printing` flag

---

## Key Conventions

### TypeScript / React

- **Components:** PascalCase filenames, functional components with typed props interfaces
- **Constants:** UPPER_SNAKE_CASE, centralized in `src/constants.ts` — never hardcode port numbers, timeouts, or label dimensions inline
- **Event handlers:** Named `handle<Action>` (e.g., `handleCheckin`, `handlePrint`)
- **CSS:** Tailwind utility classes only — no separate `.css` files
- **Imports:** Use `@/` path alias for root-level imports (configured in `tsconfig.json`)
- **Styles:** Gender-based color coding — girls: `#FDCCCE` (pink), boys: `#D6DCFF` (blue)

### Server-side (Node.js)

- **Section headers:** Use `─` dividers in comments for visual section separation
- **Logging:** Prefix with tags: `[csv]`, `[fatal]`, `[icon]`, `[print]`
- **Error handling:** Catch all errors, log, and continue — **never crash** the server during a live event. Defensive fallbacks at every layer.
- **CSV robustness:** Handle quoted fields, blank lines, BOM characters, and `EBUSY` states (file being written mid-read)
- **Input validation:** Validate and sanitize all inputs at function entry before use
- **PDF generation:** Always wrapped in try-catch with basic-label fallback if enriched generation fails

### Bookmarklet / Content Scripts

- DOM selectors are centralized in `src/constants.ts` — update there when TwoTimTwo changes structure
- The bookmarklet and content script must be kept in sync in both `public/bookmarklet.html` and `electron-app/src/checkin-script.js`

### Versioning

- **Server version:** Stored in `print-server/package.json` and `src/constants.ts` (`SERVER_VERSION`)
- **PowerShell installer version:** Tracked in `install-and-run.ps1` header comment
- **GitHub releases:** Tagged as `v*` — triggers `build-electron.yml` to build and upload `.exe`

---

## Critical Constants (`src/constants.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `SERVER_PORT` | `3456` | Print server port — must match everywhere |
| `SERVER_VERSION` | `1.1.0` | Version check between installer and server |
| `HEALTH_CHECK_TIMEOUT` | `3000` ms | UI health check request timeout |
| `PRINT_REQUEST_TIMEOUT` | `5000` ms | Label print request timeout |
| `LABEL_WIDTH_INCHES` | `4` | Target label size |
| `LABEL_HEIGHT_INCHES` | `2` | Target label size |
| `LABEL_DPI` | `300` | PDF resolution |

When modifying server port or label dimensions, update **both** `src/constants.ts` (frontend) **and** `print-server/server.js` (backend).

---

## Data Model

```typescript
// types.ts
interface Clubber {
  id: number;
  name: string;
  club: string;      // "Puggles" | "Cubbies" | "Sparks" | "T&T" | "Trek" | "Journey"
  color: string;     // Club color (hex)
  group: string;     // Handbook group within club
}
```

### CSV Enrichment Columns (`clubbers.csv`)

The server reads an optional `clubbers.csv` to add extra data to labels:

| Column | Description |
|---|---|
| `Name` | Must match TwoTimTwo name exactly (case-insensitive) |
| `Allergies` | Printed prominently on label if present |
| `Birthday` | ISO date — "Birthday Week" shown if within 7 days |
| `HandbookGroup` | Overrides the default group display |

---

## CI/CD Pipelines

| Workflow | Trigger | Action |
|---|---|---|
| `webpack.yml` | Push/PR to `main` | Build test on Node 18, 20, 22 |
| `deploy.yml` | Push to `main` | Deploy `/dist` to GitHub Pages |
| `build-electron.yml` | Tag `v*` or manual dispatch | Build Windows `.exe`, upload to GitHub Release |

**GitHub Pages URL:** `https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/`

The Vite base path is set to `/Print-TwoTimTwo-Labels/` in `vite.config.ts` to match this URL.

---

## Testing Strategy

There are no automated unit tests. Testing is done through:

1. **React simulator** (`npm run dev`) — Interactive UI that mimics TwoTimTwo check-in flow
2. **Mock data** (`data.ts`) — 16 representative clubbers covering different clubs and genders
3. **Server health check** — The `PrintServerInfo` component can ping `localhost:3456/health`
4. **Build matrix CI** — GitHub Actions verifies the build on Node 18/20/22

When adding features, test manually through the simulator and verify the build passes.

---

## Common Pitfalls

- **Port 3456 conflicts:** If another process uses port 3456, the server will fail silently. Check `src/constants.ts` and update consistently if changing.
- **Windows-only printing:** `pdf-to-printer` only works on Windows. Don't add cross-platform print support without verifying the library chain.
- **Bookmarklet sync:** `public/bookmarklet.html` and `electron-app/src/checkin-script.js` contain duplicate logic — keep them in sync manually.
- **TwoTimTwo DOM changes:** Content script and bookmarklet rely on CSS selectors from `src/constants.ts`. If TwoTimTwo updates their UI, these selectors will break.
- **CSV EBUSY errors:** The server handles files being open mid-read (Windows file locking). Don't remove this defensive handling.
- **Electron renderer build:** Must run `renderer/` Vite build before packaging. The `electron-app/` `npm run dist` script does this, but `npm start` requires it done first.

---

## Release Process

1. Update version in `print-server/package.json` and `src/constants.ts`
2. Commit and push to `main`
3. Create a git tag: `git tag v1.x.x && git push origin v1.x.x`
4. `build-electron.yml` automatically builds and attaches the `.exe` to the GitHub Release

---

## Architecture Diagram

```
TwoTimTwo.com (browser)
    │
    ▼
Bookmarklet / Chrome Extension
    │  intercepts check-in DOM event
    │  reads: name, club, color, group
    ▼
HTTP POST → localhost:3456/print
    │
    ▼
Print Server (Node.js / Express)
    │  merges with clubbers.csv enrichment data
    │  generates PDF (4"×2", 300 DPI)
    ▼
pdf-to-printer (Windows API)
    │
    ▼
Label Printer (DYMO / Brother QL / etc.)
```
