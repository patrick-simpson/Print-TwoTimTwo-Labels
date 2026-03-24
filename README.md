# Awana Label Printer

**Automatic label printing for TwoTimTwo.com check-in system**

When a child checks in during Awana, automatically print a 4" × 2" label to your label printer with zero dialogs or manual steps.

## What This Does

This tool watches the TwoTimTwo check-in page and automatically prints a label for each new check-in. It works as a **Windows PowerShell setup script** that:
- Installs Node.js (if needed)
- Downloads the project
- Installs dependencies
- Configures your printer and church check-in URL
- Starts a silent print server that runs in the background

## Quick Start (3 Steps)

### Step 1: Download
Download `install-and-run.ps1` from the [GitHub releases](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases) or [directly from the repo](https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1).

### Step 2: Run
Right-click `install-and-run.ps1` → **Run with PowerShell**

The script will:
- Check for Node.js (install if missing)
- Download the project files
- Install dependencies (~300 MB, one-time only)
- Ask you to select your label printer
- Ask for your church's check-in URL
- Start the server and open Edge at your check-in page

### Step 3: Use It
Once setup is complete, **double-click** `install-and-run.ps1` each session. It starts the server automatically in 5 seconds (press any key to change settings).

Then just use TwoTimTwo check-in normally — labels print silently as children check in.

---

## Requirements

- **Windows 10 or 11** (PowerShell 5.0+)
- **Label printer** (connected and working, e.g., DYMO LabelWriter, Brother QL series)
- **Internet** (one-time download of ~300 MB for dependencies)

The printer should appear in Windows Settings → Bluetooth & devices → Printers & scanners.

## How It Works

```
Check-in happens on TwoTimTwo.com
              ↓
   Bookmarklet detects new check-in
              ↓
   Sends request to localhost:3456
              ↓
   Node.js server generates label PDF
   (with name + club logo)
              ↓
   PDF sent silently to your configured
   label printer (no dialog, no user action)
              ↓
   Label prints automatically
```

## Advanced Options

### Command-Line Parameters

Run the script with parameters to skip configuration:

```powershell
.\install-and-run.ps1 -PrinterName "DYMO LabelWriter 450" -CheckinUrl "https://yourchurch.twotimtwo.com/clubber/checkin"
```

Supported parameters:
- `-PrinterName "Name"` - Printer to use (skip printer selection)
- `-CheckinUrl "URL"` - Check-in URL (skip URL prompt)
- `-InstallPath "C:\Path"` - Custom install location (default: %APPDATA%\Awana-Print)
- `-SkipNodeCheck` - Skip Node.js check (if you know it's installed)

### Fallback Behavior

If the server isn't running or can't reach the printer, the bookmarklet automatically falls back to a normal print dialog. This means:
- Users can still print manually if needed
- Setup failures are graceful, not blocking
- The tool degrades but doesn't break the check-in workflow

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for solutions to common issues:
- Printer not found
- Extension not detected
- PowerShell execution policy errors
- Port already in use
- And more...

## Technical Details

### Architecture

- **install-and-run.ps1** - All-in-one Windows installer/launcher
- **Bookmarklet** - JavaScript that runs on TwoTimTwo.com and detects check-ins
- **Node.js print server** - Runs on localhost:3456, generates PDFs and prints silently
- **React web UI** (optional) - Simulator and configuration reference

### Dependencies

- Node.js 18+ LTS
- npm packages:
  - `express` - Web server
  - `pdf-to-printer` - Silent printing to Windows printers
  - `puppeteer` - HTML-to-PDF rendering
  - `cors` - Cross-origin requests

Total install size: ~300 MB (Puppeteer/Chromium is large, but one-time download)

### Label Format

- **Size:** 4 inches wide × 2 inches tall
- **Content:** First name (large), Last name, Club logo (if available), KVBC footer
- **Print quality:** 300 DPI

## Limitations

- **Windows only** - PowerShell script requires Windows 10+
- **Printer must be Windows-compatible** - Uses Windows printer drivers
- **TwoTimTwo.com structure** - If the site's HTML changes, the bookmarklet may need updates
- **Local network only** - Server runs on localhost, no remote access

## Disclaimer

This project is **not affiliated with, endorsed by, or approved by TwoTimTwo.com**. It is a community-built tool that works alongside their check-in system. Use at your own discretion.

## Getting Help

1. **Check the troubleshooting guide:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **Open browser DevTools (F12)** → Console tab for error messages
3. **Check the PowerShell window** for server startup messages
4. **Verify your printer** - Go to Windows Settings → Printers and make sure it's there

## Credits

Built with:
- [jsPDF](https://github.com/parallax/jsPDF) for PDF generation
- [Puppeteer](https://github.com/puppeteer/puppeteer) for HTML rendering
- [pdf-to-printer](https://github.com/npm2s/pdf-to-printer) for Windows printing
- [Express.js](https://expressjs.com/) for the web server

## License

MIT
