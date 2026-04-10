# Troubleshooting

If a check-in doesn't print, walk through this list. Most issues are resolved in under a minute.

---

## Nothing prints when a child checks in

**1. Is the print server running?**

Double-click `start.bat`. You should see:

```
  Awana Print Server v2.2.0  •  http://localhost:3456
  Dashboard : http://localhost:3456/
  Printer   : DYMO LabelWriter 450
  Waiting for check-ins.
```

If the window closes instantly, Node.js isn't installed or `npm install` failed on first run — reopen `start.bat` and read the error message.

**2. Is the server reachable?**

Open <http://localhost:3456/health> in your browser. You should see JSON like:

```json
{ "status": "ok", "ready": true, "version": "2.2.0", "printer": "DYMO LabelWriter 450", "warnings": [] }
```

If that doesn't load, the server isn't running, or Windows Firewall is blocking localhost (rare but possible on locked-down machines).

**3. Is the extension loaded and on the right page?**

- Open `chrome://extensions` and confirm the extension is enabled.
- Navigate to your TwoTimTwo check-in URL (the extension only runs on `*.twotimtwo.com`).
- Press F12 → Console. You should see `[Awana] Watching for check-ins` shortly after the page loads.

**4. Any `warnings` in `/health`?**

The health endpoint reports common setup issues:

- `csvMissing` — no `clubbers.csv` yet. Sync the roster via the dashboard or bookmarklet.
- `csvStale` — your roster is >24h old. Re-sync.
- `printerNotFound` — the name in `config.json` doesn't match any installed printer.

---

## Printer not found

Open the dashboard at <http://localhost:3456/> and pick your printer from the dropdown. The server saves it to `config.json`.

Still not listed? Open **Settings → Bluetooth & devices → Printers & scanners** and confirm Windows can see the printer. The server queries `Get-Printer` and will find whatever Windows finds.

---

## Port 3456 already in use

Another copy of the server (or another app) is using the port. Two fixes:

1. Close the other copy. Check your system tray and Task Manager for `node.exe`.
2. Edit `server/config.json` and set `"port": 3457` (or any free port). Then update the `PRINT_SERVER` constant in `extension/content.js` to match.

The server now fails loudly with an actionable message when the port is taken, rather than silently killing whatever else is running (which the old PowerShell installer did).

---

## Extension isn't detecting check-ins

Open F12 → Console on the TwoTimTwo check-in page.

- **If you see** `[Awana] Heartbeat: expected check-in selectors are no longer matching` — TwoTimTwo changed their page structure. Open `extension/content.js`, find the `SELECTORS` constant near the top, and update the selectors to match the new DOM. Reload the extension (`chrome://extensions` → reload button).
- **If you see nothing at all** — the content script didn't load. Check that the page URL matches `*://*.twotimtwo.com/*` in `extension/manifest.json`.
- **If you see** `[Awana] Check-in detected` but nothing printed — the problem is downstream. Check the server window for the incoming POST.

---

## Labels have the wrong text or formatting

The server reloads `clubbers.csv` on every print request, so mid-event CSV updates are picked up automatically. If enrichment is off:

- Check `/roster-status`: <http://localhost:3456/roster-status> — returns the row count.
- Confirm `FirstName` + `LastName` in the CSV match what the extension is sending (case-insensitive, but typos break the match).
- Allergies can come from either an `Allergies` column or the `Notes` column (the parser checks both).

---

## Getting more help

1. Check the server window for errors after a failed check-in.
2. Open F12 → Console in the browser for extension-side errors.
3. Open a GitHub issue with:
   - Server version (from `/health`)
   - Extension version (from `chrome://extensions` or the popup)
   - The error message you see
   - A screenshot of the check-in page if the selectors are drifting

<https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/issues>
