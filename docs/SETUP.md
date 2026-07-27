# Setup guide

## 1. Print server (the main laptop)

Install the Windows app: download **Awana-Label-Printer-Setup.exe**
from the [latest release](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest),
run it (SmartScreen: *More info → Run anyway*), pick your printer and
check-in URL. The app lives in the system tray, hosts the full server
on port **3456**, starts with Windows, auto-updates, and can print a
test label from Settings. When Windows asks about network access,
click **Allow** (needed for phone check-in); or use Settings →
*Enable Phone Check-in (firewall)*.

Upgrading from the legacy `install-and-run.ps1` install: the app
imports your config and roster from `C:\output` on first run and
offers to remove the old shortcuts. The script path still works but
is deprecated.

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

## 4. Phone check-in (optional, OFF by default)

**Since 5.3.0 the server listens only on the laptop itself unless you
turn this on.** The roster, check-in history and allergy list are not
reachable from the church network by default. To enable phone check-in
you need BOTH, in Settings → Check-in Features:

1. **Phone check-in PIN** — at least 4 characters. Without a PIN the
   server refuses to expose itself and stays private (it says so at
   startup and in the dashboard's warnings).
2. **"Let phones on this Wi-Fi reach this PC"** — then restart the app,
   because the listening socket is bound at startup.

Then any phone on the same Wi-Fi: `http://<laptop-ip>:3456/phone`.
Find the laptop's IP with `ipconfig` (Wireless LAN → IPv4).

**Trust model:** every request from the network must carry the PIN —
including the roster fetch — and wrong PINs are rate-limited. But the
PIN rides plain HTTP, so it stops a bystander reading the roster, not
someone who can already sniff the network. Use the church's private
Wi-Fi, not an open guest network. The Pusher secret and the PIN itself
are never readable over the network, even with a valid PIN.

The phone page never prints directly; it queues the check-in for the
main laptop, which does the real TwoTimTwo check-in and prints through
the normal (deduplicated) path.

See [SECURITY.md](../SECURITY.md) for the full trust model, what it
deliberately does not defend against, and the fork checklist.

## 5. Church configuration

`print-server/church-config.json` — check-in URL, club-night windows
(when live broadcasts run), shares club ids, Pusher channel. Baked
KVBC defaults apply if the file is missing. Forks change this one file.

## Per-night knobs (widget)

Step Up Night and Awana Store night modes: auto (from the TwoTimTwo
calendar), or forced on/off. Quick Mode makes any roster click a
one-tap check-in.
