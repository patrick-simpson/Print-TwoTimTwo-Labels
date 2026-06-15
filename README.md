# Awana Label Printer

**Automatic 4" × 2" check-in labels for TwoTimTwo.com**

When a child checks in during Awana, a name label prints automatically — no
dialogs, no clicking, no typing. Each club gets its own look (pattern + font),
and labels can include allergies, handbook group, birthday, and visitor flags.

There are **two ways to print**. Pick the one that fits your station:

| | Automatic (recommended) | Zero-install browser |
|---|---|---|
| **Best for** | A dedicated Windows check-in laptop | Any computer, any printer, in a pinch |
| **Install needed** | One-time setup app | None |
| **How labels print** | Silently to a label/thermal printer | Browser print dialog |
| **Printer** | DYMO / Brother / any Windows printer | Any printer (inkjet, laser, label) |

---

## Option 1 — Automatic printing (recommended)

This runs a tiny background helper on a Windows laptop. Once set up, labels just
print as kids check in. **A volunteer never has to touch it during the event.**

### Step 1 — Install (one time, ~5 minutes)

1. Download **Awana-Label-Printer-Setup.exe** from the
   **[latest release](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest)**.
2. Double-click it. There is no wizard — it installs and launches itself.
3. When it asks, **pick your label printer** from the list and **paste your
   church's check-in web address** (the page you normally use to check kids in).
4. That's it. A small icon sits in the system tray (bottom-right of Windows),
   and the helper runs quietly in the background.

> No PowerShell, no Node.js, no terminal. If you can install an app, you can do this.

### Step 2 — Each event night

1. Turn on the laptop and the label printer.
2. Open your check-in page as usual.
3. Check kids in normally. **Labels print on their own.**

A small status pop-up appears in the corner of the check-in page:
**spinning circle** = printing, **green ✓** = printed, **blue note** = saved to
print later (server busy), **red ⚠ banner** = a problem, with a plain-English fix.

### Step 3 — If something looks wrong

- **No label printed?** Make sure the printer is on and loaded with labels, then
  check the same child in again.
- **Red banner on screen?** Read it — it tells you exactly what to do.
- Still stuck? See **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)**.

---

## Option 2 — Zero-install browser printing

No app, no setup. Good for a backup station, a substitute laptop, or any
non-Windows computer. It prints through the **browser's own print dialog**, so
it works on **Chrome, Firefox, and Safari** and any connected printer.

**Open the printer page:**
👉 **https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/print-labels.html**

Then:

1. Type or paste the children — one per line, as `First Last, Club`
   (for example: `Emma Johnson, Sparks`). You can also paste a CSV with a
   header row.
2. Click **Update preview** to see the labels.
3. Click **Print labels**. In the browser's print box, choose your printer and,
   for label stock, set **Paper size = 4 × 2 in** and **Margins = None**.

Long names shrink to fit automatically, missing fields are skipped cleanly, and
only the labels print — none of the web page chrome.

---

## Option 3 — The bookmarklet (advanced / no extension)

A **bookmarklet** is a bookmark that runs a little code. This one turns on
automatic printing on the check-in page **without installing the browser
extension** — handy if your browser can't sideload extensions. It still needs
the helper from Option 1 to be running.

**To install it:**

1. Show your browser's bookmarks bar (Chrome/Edge: `Ctrl+Shift+B`).
2. Right-click the bookmarks bar → **Add page / New bookmark**.
3. **Name:** `Awana Auto-Print`
4. **URL:** paste the entire block below, then save.

```text
javascript:(function(){try{if(window.__awanaPrinterLoaded){alert('Awana auto-print is already active on this page.');return;}var s=document.createElement('script');s.src='http://localhost:3456/bookmarklet.js?v='+Date.now();s.onload=function(){console.log('[Awana] auto-print bookmarklet loaded');};s.onerror=function(){alert('Could not reach the Awana Print Server at localhost:3456.\n\n1) Make sure the print server app is running.\n2) Then click this bookmarklet again.\n\nNo server? Use the zero-install browser printer instead:\nhttps://patrick-simpson.github.io/Print-TwoTimTwo-Labels/print-labels.html');};(document.body||document.documentElement).appendChild(s);}catch(e){alert('Awana bookmarklet error: '+e.message);}})();
```

**To use it:** open your check-in page, click the **Awana Auto-Print** bookmark
once. A small widget appears in the corner and auto-printing is active for that
tab. If the helper isn't running, you'll get a friendly pop-up telling you what
to do.

> There's also a drag-to-install helper page at
> `http://localhost:3456/bookmarklet.html` when the server is running.

---

## Enhanced labels (optional)

Drop a `clubbers.csv` file next to the helper (or let the extension sync it
automatically from your logged-in check-in session) to add, per child:

- **Allergy chips** — bold `NUTS` / `DAIRY` / `GLUTEN` / `EGG` / `DYE` tags,
  detected automatically from notes.
- **Handbook group** — printed under the club name.
- **Birthday cake 🍰** — shown during the child's birthday week.
- **Step-Up Night** — an inverted "Stepping up to <next club>" label.

Unknown names still print a basic label — there is no crash and no missed label.

CSV header (column names must match):

```text
FirstName,LastName,Birthdate,Allergies,HandbookGroup
Emma,Johnson,2019-06-09,dairy and gluten,Cubbies Bears
Liam,Carter,11/21/2018,egg,T&T Group B
```

---

## Requirements

- **Automatic mode:** Windows 10 or 11, and a Windows-compatible label printer
  (e.g. DYMO LabelWriter, Brother QL). One-time ~300 MB download for the helper.
- **Browser mode:** any modern browser (Chrome, Firefox, Safari) and any printer.

---

## How it works (for the curious)

```
Child checks in on TwoTimTwo.com
            │
            ▼
Extension / bookmarklet detects the check-in   (MutationObserver + safety-net polling)
            │
            ▼
Sends the name + club to the local helper       (http://localhost:3456, with retry + offline queue)
            │
            ▼
Helper draws a 4×2" label as a 300-DPI PNG      (Node.js + canvas, per-club design)
            │
            ▼
Prints silently via Windows PowerShell          (System.Drawing → your label printer)
```

The **browser-only** path skips the helper entirely: it renders labels with CSS
and uses the browser's print dialog.

### Project layout

- **`install-and-run.ps1` / Electron app** — the Windows helper + installer.
- **`print-server/server.js`** — local server on port 3456; draws and prints labels.
- **`chrome-extension/content.js`** — detects check-ins; also served as the bookmarklet.
- **`public/print-labels.html`** — the zero-install browser printer.
- **React app (root)** — setup reference and label simulator.

### Label format

- **Size:** 4 in × 2 in at 300 DPI
- **Content:** first name (large, auto-fit), last name, club (pattern + font),
  optional allergies / handbook group / birthday / visitor / step-up

---

## Limitations

- Automatic silent printing is **Windows only** (uses Windows printer drivers).
- The check-in detector depends on TwoTimTwo.com's page structure; if the site
  changes its HTML, the detector may need an update.
- The helper runs on **localhost** only — no remote access.

## Disclaimer

Not affiliated with, endorsed by, or approved by TwoTimTwo.com. Community-built
tool that works alongside their check-in system. Use at your own discretion.

## License

MIT
