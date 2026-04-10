# Awana Label Printer

**Automatic check-in label printing for [TwoTimTwo.com](https://twotimtwo.com).**

When a child checks in during an Awana event, a 4″ × 2″ label prints silently to your label printer (DYMO, Brother QL, etc.). Zero dialogs, zero clicks.

> 🌐 **Setup guide & live demo:** <https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/>

---

## What's in the box

Two small pieces that work together on the check-in laptop:

1. **Print server** (`server/`) — a tiny Node.js / Express app that listens on `http://localhost:3456` and renders labels via `node-canvas`, printing silently through the Windows print subsystem.
2. **Browser extension** (`extension/`) — a Chrome / Edge MV3 content script that watches the TwoTimTwo check-in page, detects check-ins, and POSTs them to the print server.

A public [setup website](https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/) (source in `website/`) walks first-time users through the install.

---

## Quick start

1. **Install Node.js LTS** from <https://nodejs.org/>. One-time, ~30s.
2. **Download the latest release** from <https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest>. You'll get two zips:
   - `awana-print-server-X.Y.Z.zip`
   - `awana-checkin-extension-X.Y.Z.zip`
3. **Unzip the print server** to any folder (Desktop is fine) and double-click `start.bat`. First run installs dependencies; subsequent runs start instantly.
4. **Install the extension**:
   - Unzip the extension folder somewhere permanent.
   - Open `chrome://extensions` (or `edge://extensions`).
   - Toggle on **Developer mode** (top-right).
   - Click **Load unpacked** and pick the extension folder.
5. **Open your TwoTimTwo check-in page** and check in a child. A label should print automatically.

Open the dashboard at <http://localhost:3456/> to pick a printer, preview labels, view print history, and run diagnostics.

---

## Configuration

The print server reads `server/config.json` (falls back to env vars `PRINTER_NAME`, `PORT`, `CHECKIN_URL`, then hard-coded defaults):

```json
{
  "printerName": "DYMO LabelWriter 450",
  "port": 3456,
  "checkinUrl": "https://yourchurch.twotimtwo.com/clubber/checkin"
}
```

You can also edit it live from the dashboard at `http://localhost:3456/`.

---

## How it works

```
Check-in happens on TwoTimTwo.com
              ↓
  Extension content script sees it
              ↓
  POST http://localhost:3456/print
              ↓
  Server renders a 4×2 PNG label
  (name + club + allergy icons)
              ↓
  Windows silently sends it to the
  configured label printer
              ↓
           Label prints
```

**Fallback:** if the server is unreachable (not running, wrong port, firewall), the extension falls back to the normal browser print dialog. The tool degrades — it doesn't block check-in.

---

## Repository layout

```
Print-TwoTimTwo-Labels/
├── server/            # Node print server
│   ├── server.js      # Thin entry point
│   ├── src/           # csv, label, printer, enrich, config, routes, log, roster, history
│   ├── test/          # Unit tests (node --test)
│   ├── public/        # Built-in dashboard
│   ├── start.bat      # Windows launcher
│   └── config.json.example
├── extension/         # Chrome/Edge MV3 extension
├── website/           # React + Vite landing/setup site → GitHub Pages
├── scripts/           # bump-version, check-versions
└── .github/workflows/ # ci.yml, release.yml, deploy-website.yml
```

---

## Developing

```bash
# Root: website dev server
npm install
npm run dev               # website on http://localhost:3000

# Server
cd server
npm install
npm start                 # http://localhost:3456
npm test                  # run unit tests

# Extension
# Load extension/ as an unpacked extension in Chrome.
# No build step — it's plain JS.
```

Unit tests use Node's built-in test runner — no extra dev dependencies.

---

## Releasing a new version

```bash
node scripts/bump-version.cjs 2.3.0   # updates every versioned file
node scripts/check-versions.cjs       # sanity check (CI also runs this)

# Update changes.md with a new entry at the top
git add -A
git commit -m "v2.3.0: <what changed>"
git tag v2.3.0
git push origin main --tags
```

The `release.yml` workflow builds and attaches `awana-print-server-2.3.0.zip` and `awana-checkin-extension-2.3.0.zip` to a GitHub Release automatically.

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues: printer not found, port 3456 in use, extension not detecting check-ins, etc.

---

## Credits & license

- **Not affiliated with TwoTimTwo.com** — this is a community-built tool that works alongside their check-in system.
- Built with [Express](https://expressjs.com/), [node-canvas](https://github.com/Automattic/node-canvas), [React](https://react.dev/), and [Vite](https://vitejs.dev/).
- MIT license.
