# Setup guide

Two supported installs — pick one per station:

| | Chrome extension + server (recommended) | Electron tray app |
|---|---|---|
| Install | `install-and-run.ps1` + load `chrome-extension/` | NSIS installer (`npm run dist` in `electron-app/`) |
| Detection | In-page (instant, all paths) | Same (the tray app now hosts the full server; the extension does detection) |
| Best for | The main check-in laptop | Secondary stations that only print |

## 1. Print server (the main laptop)

Run `install-and-run.ps1` (right-click → Run with PowerShell). It
installs Node, downloads the project, walks through printer/URL
config, adds the firewall rule for phone check-in, creates the
desktop launcher, and starts the server on port **3456**.

## 2. Chrome extension

`chrome://extensions` → Developer mode → *Load unpacked* → pick the
`chrome-extension/` folder. Open the TwoTimTwo check-in page — the
green widget appears. Pin the page as the browser homepage.

## 3. Dashboard settings (`http://localhost:3456`)

- **Printer + check-in URL** — set once.
- **Pusher** (optional) — powers the lobby welcome display and the
  countdown app's live counts. Only this server holds the secret.
- **Check-in Features** — phone PIN, late-arrival grace, visitor label
  style, connect cards, and the driven-check-in kill switch.
- **Group Schedule** — one row per club (start time, location, room);
  late check-ins get a "Go to:" line on the label.

## 4. Phone check-in (optional)

Any phone on the same Wi-Fi: `http://<laptop-ip>:3456/phone`.
Find the laptop's IP with `ipconfig` (Wireless LAN → IPv4).

**Trust model:** the PIN rides plain HTTP on your LAN. It stops casual
misuse, not a hostile network — use it on the church's private Wi-Fi,
not open guest networks. The phone page never prints directly; it
queues the check-in for the main laptop, which does the real TwoTimTwo
check-in and prints through the normal (deduplicated) path.

## 5. Church configuration

`print-server/church-config.json` — check-in URL, club-night windows
(when live broadcasts run), shares club ids, Pusher channel. Baked
KVBC defaults apply if the file is missing. Forks change this one file.

## Per-night knobs (widget)

Step Up Night and Awana Store night modes: auto (from the TwoTimTwo
calendar), or forced on/off. Quick Mode makes any roster click a
one-tap check-in.
