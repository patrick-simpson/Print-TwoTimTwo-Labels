'use strict';

// Windows printer integration. Everything that shells out to PowerShell
// lives here so the rest of the codebase stays platform-agnostic and the
// system-call surface can be mocked in tests.

const { execSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const log  = require('./log').make('printer');

const IS_WINDOWS = process.platform === 'win32';

// Lists all installed printers via `Get-Printer`. Returns
// [{ name, isWindowsDefault }]. On non-Windows or any failure returns [].
function listPrinters() {
  if (!IS_WINDOWS) return [];
  try {
    const raw = execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress"',
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    if (!raw) return [];
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) parsed = [parsed]; // single printer → bare object
    return parsed.map(p => ({ name: p.Name, isWindowsDefault: !!p.Default }));
  } catch (err) {
    log.warn(`Failed to list printers: ${err.message}`);
    return [];
  }
}

// Resolves the printer to use, in priority order:
//   1. explicit name from the request
//   2. configured default (from config.json or PRINTER_NAME env var)
//   3. Windows default printer
//   4. first available printer
// Returns null if no printer is available at all.
function resolvePrinter(requested, configured) {
  const candidates = [requested, configured].filter(n => n && String(n).trim());
  if (!IS_WINDOWS) return candidates[0] || null;

  const available = listPrinters();
  if (available.length === 0) return candidates[0] || null;
  const names = available.map(p => p.name);

  for (const name of candidates) {
    if (names.includes(name)) return name;
  }
  const winDefault = available.find(p => p.isWindowsDefault);
  if (winDefault) return winDefault.name;
  return available[0].name;
}

// Print a PNG image silently via PowerShell System.Drawing. The PS script
// is written to a temp .ps1 file and executed with -File (not -Command)
// to avoid multiline quoting issues. Temp file is always unlinked via
// finally so we never leak temps even on crash paths.
function printImage(imagePath, printerName) {
  if (!IS_WINDOWS) {
    throw new Error('Silent printing only supported on Windows');
  }
  const safePath    = imagePath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$pd = New-Object System.Drawing.Printing.PrintDocument
${safePrinter ? `$pd.PrinterSettings.PrinterName = '${safePrinter}'` : ''}
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label", 400, 200)
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$pd | Add-Member -NotePropertyName LabelImagePath -NotePropertyValue '${safePath}'
$pd.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($sender.LabelImagePath)
  try { $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height) }
  finally { $img.Dispose() }
})
$pd.Print()
$pd.Dispose()
`.trim();

  const psPath = path.join(os.tmpdir(), `awana-print-${Date.now()}-${process.pid}.ps1`);
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
      timeout: 15000,
      windowsHide: true,
      encoding: 'utf8'
    });
    if (result && result.trim()) log.info(`PowerShell: ${result.trim()}`);
  } finally {
    try { fs.unlinkSync(psPath); } catch { /* file may not exist on early failure */ }
  }
}

module.exports = { listPrinters, resolvePrinter, printImage, IS_WINDOWS };
