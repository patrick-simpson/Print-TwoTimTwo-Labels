import React, { useState } from 'react';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/clubber/checkin?#';

const generatePs1 = (printerName: string, checkinUrl: string) =>
`# Awana Label Print Server — Startup Script
# Default printer : ${printerName}
# Default URL     : ${checkinUrl}
#
# Double-click this file to start the print server and open the check-in page.
# On first run it uses the values above. After that it remembers your last settings.
# Press any key during the 5-second countdown to change printer or URL.

$ErrorActionPreference = "Stop"
$defaultPrinter = "${printerName}"
$defaultUrl     = "${checkinUrl}"
$scriptDir      = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir      = Join-Path $scriptDir "print-server"
$configPath     = Join-Path $serverDir "config.json"

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# --- Node.js check ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Opening nodejs.org..." -ForegroundColor Yellow
    Start-Process "https://nodejs.org"
    Read-Host "Install Node.js LTS then re-run this script. Press Enter to exit"
    exit 1
}

# --- Install packages (first time only) ---
if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
    Write-Host "Installing packages (first time only, ~300 MB)..." -ForegroundColor Yellow
    Push-Location $serverDir; npm install; $code = $LASTEXITCODE; Pop-Location
    if ($code -ne 0) { Read-Host "npm install failed. Press Enter to exit"; exit 1 }
    Write-Host "Packages installed." -ForegroundColor Green
}

# --- Load config (falls back to defaults baked into this script) ---
$cfg = [ordered]@{ printerName = $defaultPrinter; checkinUrl = $defaultUrl }
if (Test-Path $configPath) {
    try {
        $saved = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($saved.printerName) { $cfg.printerName = $saved.printerName }
        if ($saved.checkinUrl)  { $cfg.checkinUrl  = $saved.checkinUrl  }
    } catch {}
}

# --- Configure function ---
function Configure {
    Write-Host ""
    $printers = @(Get-Printer | Select-Object -ExpandProperty Name)
    if ($printers.Count -eq 0) {
        Write-Host "No printers found. Make sure your label printer is connected." -ForegroundColor Red
        Read-Host "Press Enter to exit"; exit 1
    }
    Write-Host "Available printers:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $printers.Count; $i++) {
        $marker = if ($printers[$i] -eq $cfg.printerName) { "  <-- current" } else { "" }
        Write-Host "  [$i] $($printers[$i])$marker"
    }
    $choice = Read-Host "\`nEnter printer number (or press Enter to keep current)"
    if ($choice -match '^\d+$') {
        $idx = [int]$choice
        if ($idx -ge 0 -and $idx -lt $printers.Count) { $cfg.printerName = $printers[$idx] }
    }
    Write-Host ""
    $newUrl = Read-Host "Check-in URL (press Enter to keep: $($cfg.checkinUrl))"
    if ($newUrl.Trim()) { $cfg.checkinUrl = $newUrl.Trim() }
    [PSCustomObject]@{ printerName = $cfg.printerName; checkinUrl = $cfg.checkinUrl } |
        ConvertTo-Json | Set-Content $configPath
    Write-Host "Settings saved." -ForegroundColor Green
}

# --- Countdown or first-time setup ---
Write-Host "  Printer : $($cfg.printerName)" -ForegroundColor White
Write-Host "  URL     : $($cfg.checkinUrl)" -ForegroundColor White
Write-Host ""
Write-Host "Starting in 5 seconds...  Press any key to change settings." -ForegroundColor Gray

$changed = $false
for ($i = 5; $i -gt 0; $i--) {
    Write-Host -NoNewline "\`r  $i...   "
    Start-Sleep -Milliseconds 950
    if ([Console]::KeyAvailable) { $null = [Console]::ReadKey($true); $changed = $true; break }
}
Write-Host ""
if ($changed) { Configure }

# --- Save defaults to config on first run (no existing config file) ---
if (-not (Test-Path $configPath)) {
    [PSCustomObject]@{ printerName = $cfg.printerName; checkinUrl = $cfg.checkinUrl } |
        ConvertTo-Json | Set-Content $configPath
}

# --- Open Edge ---
Write-Host ""
Write-Host "Opening Microsoft Edge at check-in page..." -ForegroundColor Cyan
Start-Process "msedge" -ArgumentList $cfg.checkinUrl

# --- Start server ---
Write-Host "Print server running at http://localhost:3456" -ForegroundColor Cyan
Write-Host "Leave this window open during check-in. Press Ctrl+C to stop.\`n" -ForegroundColor Gray
$env:PRINTER_NAME = $cfg.printerName
Set-Location $serverDir
node server.js
`;

export const PrintServerInfo: React.FC = () => {
  const [connStatus,      setConnStatus]      = useState<ConnectionStatus>('idle');
  const [connDetail,      setConnDetail]      = useState('');
  const [printers,        setPrinters]        = useState<string[] | null>(null);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError,   setPrintersError]   = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [manualPrinter,   setManualPrinter]   = useState('');
  const [checkinUrl,      setCheckinUrl]      = useState(DEFAULT_URL);

  const activePrinter = selectedPrinter || manualPrinter.trim();

  const testConnection = async () => {
    setConnStatus('checking');
    setConnDetail('');
    try {
      const res  = await fetch('http://localhost:3456/health', { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      setConnStatus('connected');
      setConnDetail(`Printer: ${data.printer}`);
    } catch {
      setConnStatus('error');
      setConnDetail('Server not reachable — make sure the server is running first.');
    }
  };

  const listPrinters = async () => {
    setPrintersLoading(true);
    setPrintersError('');
    setPrinters(null);
    try {
      const res = await fetch('http://localhost:3456/printers', { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('Server returned an error');
      const data = await res.json();
      const names: string[] = data.map((p: any) =>
        typeof p === 'string' ? p : (p.name || p.deviceId || JSON.stringify(p))
      );
      setPrinters(names);
    } catch {
      setPrintersError('Could not reach server. Start it first (see the one-liner below).');
    } finally {
      setPrintersLoading(false);
    }
  };

  const downloadPs1 = () => {
    if (!activePrinter) return;
    const blob = new Blob([generatePs1(activePrinter, checkinUrl)], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'start-print-server.ps1';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-purple-600">
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center">
        <i className="fa fa-server mr-2 text-purple-600"></i>
        Optional: Silent Print Server
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        By default the bookmarklet opens a print dialog. Follow these steps to print silently
        to a specific printer with no dialog — fully automatic after one-time setup.
      </p>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-5 text-xs text-amber-800">
        <strong>Independent tool:</strong> This project is not affiliated with, endorsed by,
        or approved by TwoTimTwo.com. It is a community-built tool that works alongside their
        check-in system. Use at your own discretion.
      </div>

      <ol className="space-y-6 text-sm text-gray-700">

        {/* Step 1 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">1</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">
              Install Node.js <span className="font-normal text-gray-500">(skip if already installed)</span>
            </p>
            <p>
              Download the <strong>LTS</strong> version from{' '}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-blue-600 underline">nodejs.org</a>{' '}
              and run the installer. Confirm it worked:
            </p>
            <code className="block mt-2 bg-gray-100 px-3 py-1.5 rounded font-mono text-xs">node --version</code>
            <p className="mt-1 text-gray-500">Should show <code className="bg-gray-100 px-1 rounded">v20.x.x</code> or similar.</p>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">2</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Download the files</p>
            <p>
              Go to the{' '}
              <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels" target="_blank" rel="noreferrer" className="text-blue-600 underline">
                GitHub repository
              </a>
              , click <strong>Code → Download ZIP</strong>, and unzip it somewhere (e.g. your Desktop).
              It contains the <code className="bg-gray-100 px-1 rounded">print-server/</code> folder
              and <code className="bg-gray-100 px-1 rounded">setup.ps1</code>.
            </p>
          </div>
        </li>

        {/* Step 3 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div className="w-full">
            <p className="font-semibold text-gray-800 mb-3">Configure &amp; download your startup script</p>

            {/* Check-in URL */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Your church's check-in URL
              </label>
              <input
                type="url"
                value={checkinUrl}
                onChange={e => setCheckinUrl(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"
                placeholder="https://yourchurch.twotimtwo.com/clubber/checkin?#"
              />
              <p className="text-xs text-gray-400 mt-1">Pre-filled with the KVBC URL — update this for your church.</p>
            </div>

            {/* Printer selection */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                <p className="font-semibold text-purple-800 mb-2 text-xs uppercase tracking-wide">
                  Option A — Pick from this page
                </p>
                <p className="text-gray-600 mb-3 text-xs">
                  Start the server briefly with no printer set, then click "List Printers".
                </p>
                <code className="block bg-white border border-purple-200 px-3 py-1.5 rounded font-mono text-xs mb-3 break-all">
                  cd print-server &amp;&amp; node server.js
                </code>
                <button
                  onClick={listPrinters}
                  disabled={printersLoading}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded mb-2"
                >
                  {printersLoading ? 'Loading...' : 'List Printers'}
                </button>
                {printersError && <p className="text-red-600 text-xs mt-1">{printersError}</p>}
                {printers && printers.length === 0 && <p className="text-gray-500 text-xs mt-1">No printers found.</p>}
                {printers && printers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {printers.map(name => (
                      <button
                        key={name}
                        onClick={() => { setSelectedPrinter(name); setManualPrinter(''); }}
                        className={`px-2 py-1 rounded border font-mono text-xs cursor-pointer transition-colors
                          ${selectedPrinter === name
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white border-gray-300 hover:bg-gray-100 text-gray-800'}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <p className="font-semibold text-gray-700 mb-2 text-xs uppercase tracking-wide">
                  Option B — Type name or use setup.ps1
                </p>
                <p className="text-gray-600 mb-3 text-xs">
                  Type the printer name if you already know it. Or just run{' '}
                  <code className="bg-gray-200 px-1 rounded">setup.ps1</code> — it lists printers
                  interactively without needing this page.
                </p>
                <label className="block text-xs text-gray-600 mb-1">Printer name:</label>
                <input
                  type="text"
                  value={manualPrinter}
                  onChange={e => { setManualPrinter(e.target.value); setSelectedPrinter(''); }}
                  placeholder="e.g. DYMO LabelWriter 450"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-400"
                />
              </div>
            </div>

            {/* Download button */}
            <button
              onClick={downloadPs1}
              disabled={!activePrinter}
              className={`flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors
                ${activePrinter
                  ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <i className="fa fa-download"></i>
              {activePrinter
                ? `Download start-print-server.ps1  (printer: ${activePrinter})`
                : 'Select or type a printer above to enable download'}
            </button>
            {activePrinter && (
              <p className="mt-2 text-xs text-gray-500">
                Save this in the same folder as your unzipped repo.
                Double-click it each session — it starts the server, opens Edge at your check-in page,
                and remembers your settings for next time.
              </p>
            )}
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">4</span>
          <div>
            <p className="font-semibold text-gray-800 mb-2">Test the connection</p>
            <p className="text-gray-600 mb-3">After the server starts, click below to confirm it's running.</p>
            <button
              onClick={testConnection}
              disabled={connStatus === 'checking'}
              className="bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded"
            >
              {connStatus === 'checking' ? 'Checking...' : 'Test Connection'}
            </button>
            {connStatus === 'connected' && (
              <p className="mt-2 text-green-700 font-semibold text-sm">✓ Connected — {connDetail}</p>
            )}
            {connStatus === 'error' && (
              <p className="mt-2 text-red-600 text-xs">{connDetail}</p>
            )}
          </div>
        </li>

      </ol>

      <div className="mt-6 bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-800">
        <strong>Every session:</strong> Double-click <code className="bg-purple-100 px-1 rounded">start-print-server.ps1</code>.
        It auto-starts in 5 seconds, opens Edge at your check-in page, and prints labels silently.
        Press any key during the countdown to change the printer or URL.
        If the server isn't running, the bookmarklet falls back to a normal print dialog automatically.
      </div>
    </div>
  );
};
