# Troubleshooting Guide

Having issues with Awana Label Printer? This guide covers common problems and solutions.

## Installation Issues

### "PowerShell execution policy" error

**Error:** `cannot be loaded because running scripts is disabled on this system`

**Solution:**
1. Right-click PowerShell → **Run as Administrator**
2. Run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`
3. Type `Y` and press Enter
4. Now run `install-and-run.ps1` again

---

### "Node.js not found" even after installation

**Problem:** Node.js was installed but PATH wasn't refreshed.

**Solution:**
1. Close PowerShell completely
2. Open a **new** PowerShell window
3. Run: `node --version`
4. If still not found, reinstall Node.js from https://nodejs.org

---

### "npm install failed" or "Cannot find npm"

**Problem:** npm packages couldn't be installed.

**Solution:**
1. Check that Node.js is actually installed: `node --version`
2. Try running again - it may be a temporary network issue
3. If it fails twice, manually navigate to the print-server folder and run:
   ```powershell
   npm install
   ```

---

### "No printers found"

**Problem:** Script says no printers are detected.

**Solution:**
1. Go to **Settings → Bluetooth & devices → Printers & scanners**
2. Make sure your label printer is listed there
3. If not listed:
   - Connect the printer via USB
   - Wait 10 seconds for Windows to detect it
   - Install drivers if needed (check printer manufacturer's website)
4. Run `install-and-run.ps1` again

---

## Runtime Issues

### Labels print but look wrong

**Problem:** Labels appear cut off, text is wrong size, or formatting is broken.

**Checklist:**
1. **Verify label size:** Settings → Printers → Your Printer → Preferences → Paper size should be **4×2 inches**
2. **Check printer driver:** Some printers need specific label-size drivers
3. **Test with a manual print:** Use Windows print dialog to test one label manually
4. **Check for paper jams:** Some printers fail silently

**Solution:** Adjust label dimensions in the extension configuration (if available).

---

### Print dialog appears instead of silent print

**Problem:** Despite running the server, a print dialog still shows.

**Causes:**
1. The server might not be running
2. Printer configuration might be wrong
3. Browser might be blocking the action

**Solution:**
1. Check the PowerShell window where the server started - should say:
   ```
   Print server running at http://localhost:3456
   ```
2. If not running, look for error messages in the window
3. Verify printer name is correct (check in PowerShell output)
4. Try clicking the Test Connection button in the simulator (if you have it open)

---

### "Connection refused" or "Server not reachable"

**Problem:** Bookmarklet or test button says server can't be reached.

**Solution:**
1. Make sure `install-and-run.ps1` is still running (check PowerShell window)
2. If the window closed, run the script again
3. Check that port 3456 isn't blocked:
   ```powershell
   netstat -ano | findstr 3456
   ```
   If something is using it, either:
   - Close that application
   - Edit `install-and-run.ps1` and change line 108 from 3456 to 3457 (or another unused port)

---

### No label prints at all

**Problem:** Child checks in, but nothing happens - no print, no dialog.

**Debug steps:**
1. Open your browser's **Developer Tools (F12)**
2. Go to the **Console** tab
3. Do a check-in and look for error messages
4. Common messages:
   - `"Fetch failed"` → Server not running
   - `"Print error"` → Printer issue
   - `"POST failed"` → Network issue

**Solutions:**
- **If server not running:** Start `install-and-run.ps1` again
- **If printer error:** Check printer is online and default printer is set correctly
- **If network issue:** Make sure you're accessing TwoTimTwo from localhost or same machine

---

## Extension Issues

### Extension widget doesn't appear

**Problem:** The purple "Awana Print" widget doesn't show up on the check-in page.

**Causes:**
1. Extension isn't loaded in the browser
2. You're not on the TwoTimTwo.com check-in page
3. Developer Mode is turned off in edge://extensions

**Solution:**
1. Go to `edge://extensions` or `chrome://extensions`
2. Ensure **Developer Mode** is ON
3. Ensure the extension is listed and enabled
4. Refresh the TwoTimTwo check-in page

---

### Extension appears but says "Server offline"

**Problem:** The widget shows up but the status or sync indicator is red/error.

**Solution:**
1. Make sure `install-and-run.ps1` is running
2. Check that the print server is reachable at http://localhost:3456
3. If you just started the server, wait 5 seconds for it to initialize

---

## General Debugging

### How to check server logs

The PowerShell window where you ran `install-and-run.ps1` shows all server output. Look for:
- `Printer: DYMO LabelWriter 450` → Printer is configured
- `POST /print` → Someone just tried to print
- `Error: ...` → Something went wrong

---

### How to test locally without TwoTimTwo

1. Open the React app: Run `npm run dev` in a terminal
2. You'll see a simulator with fake check-in data
3. Click "Check In" to test the printing logic

---

### How to enable debug logging

1. Open **Developer Tools (F12)** in your browser
2. Go to **Console** tab
3. Add this to the extension to see detailed logs:
   ```javascript
   window.DEBUG_PRINT = true;
   ```
4. Then do a check-in - you'll see detailed logs in the Console

---

## Still Stuck?

If none of these solutions work:

1. **Collect information:**
   - Screenshot of the error message
   - Output from the PowerShell window
   - Browser console errors (F12 → Console tab)
   - Windows printer name (Settings → Printers & scanners)

2. **Check the GitHub issues:** https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/issues
   - Your issue might already be documented

3. **Create a new issue** with the information above

---

## Quick Checklist

Before getting help, verify:
- [ ] Windows 10+ is running
- [ ] Node.js is installed (`node --version` works in PowerShell)
- [ ] Printer is connected and appears in Windows Settings
- [ ] Printer has paper
- [ ] install-and-run.ps1 PowerShell window is still open
- [ ] No other application is using port 3456
- [ ] Running on the TwoTimTwo.com check-in page (not a different page)
