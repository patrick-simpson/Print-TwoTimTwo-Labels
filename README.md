# Awana Label Printer

**Automatic label printing for TwoTimTwo.com check-in system**

When a child checks in during Awana, automatically print a 4" × 2" label to your label printer with zero dialogs or manual steps.

## Quick Start — Download the Installer (Recommended)

**[👉 Download Awana-Label-Printer-Setup.exe](https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest)**

1. Download the `.exe` file
2. Double-click to install (one-click, no setup wizard)
3. The app launches and guides you through first-time setup
4. Done — server runs silently in your system tray

No PowerShell, no Node.js install, no terminal window. This is the easiest way to get started.

---

## Alternative: PowerShell Script (Fallback)

If you prefer the terminal-based setup or need a portable version:

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
- **Black & White Optimization:** The system is optimized for thermal B&W printers. Colors (like allergy strips and weather banners) are rendered as high-contrast grayscale for maximum clarity.
- **Internet** (one-time download of ~300 MB for dependencies)

The printer should appear in Windows Settings → Bluetooth & devices → Printers & scanners.

## How It Works

```
Check-in happens on TwoTimTwo.com
              ↓
   Extension detects new check-in
              ↓
   Sends request to localhost:3456
              ↓
   Node.js server generates label PNG
   (with name + club logo + allergies)
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

If the server isn't running or can't reach the printer, the extension automatically falls back to a normal print dialog. This means:
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
- **TwoTimTwo.com structure** - If the site's HTML changes, the extension may need updates
- **Local network only** - Server runs on localhost, no remote access

## Disclaimer

This project is **not affiliated with, endorsed by, or approved by TwoTimTwo.com**. It is a community-built tool that works alongside their check-in system. Use at your own discretion.

## Getting Help

1. **Check the troubleshooting guide:** [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. **Open browser DevTools (F12)** → Console tab for error messages
3. **Check the PowerShell window** for server startup messages
4. **Verify your printer** - Go to Windows Settings → Printers and make sure it's there

## For Developers — Releasing a New Version

The `.exe` installer is automatically built and released via GitHub Actions. To release:

```bash
# 1. Bump version in electron-app/package.json
#    (e.g., change "version": "1.0.0" to "1.0.1")

git add electron-app/package.json
git commit -m "Bump version to 1.0.1"
git push origin main

# 2. Create and push a version tag
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions automatically:
- Builds the installer on a Windows server
- Creates a GitHub Release
- Attaches `Awana-Label-Printer-Setup.exe` to it

Users download from: **https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest**

To test the build without releasing, go to **Actions** → **Build Electron App** → **Run workflow** and select your branch.

## Credits

Built with:
- [Electron](https://www.electronjs.org/) for the desktop app
- [React](https://react.dev/) for the UI
- [Vite](https://vitejs.dev/) for fast builds
- [Express.js](https://expressjs.com/) for the print server
- [pdf-to-printer](https://github.com/npm2s/pdf-to-printer) for Windows printing

## License

MIT
