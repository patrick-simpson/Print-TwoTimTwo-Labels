import React, { useState } from 'react';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const generatePs1 = (printerName: string) =>
`# Awana Print Server — Startup Script
# Printer: ${printerName}
# Save this file in the same folder as your print-server/ directory.
# Double-click it at the start of each check-in session.

$ErrorActionPreference = "Stop"
$printerName = "${printerName}"
$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir   = Join-Path $scriptDir "print-server"

Write-Host ""
Write-Host "Awana Print Server  |  Printer: $printerName" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Opening nodejs.org..." -ForegroundColor Yellow
    Start-Process "https://nodejs.org"
    Read-Host "Install Node.js LTS then re-run this script. Press Enter to exit"
    exit 1
}

if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
    Write-Host "Installing packages (first time only, ~300 MB)..." -ForegroundColor Yellow
    Push-Location $serverDir
    npm install
    Pop-Location
}

Write-Host "Server running at http://localhost:3456" -ForegroundColor Cyan
Write-Host "Leave this window open during check-in. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
$env:PRINTER_NAME = $printerName
Set-Location $serverDir
node server.js
`;

export const PrintServerInfo: React.FC = () => {
  const [connStatus,    setConnStatus]    = useState<ConnectionStatus>('idle');
  const [connDetail,    setConnDetail]    = useState('');
  const [printers,      setPrinters]      = useState<string[] | null>(null);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError, setPrintersError] = useState('');
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [manualPrinter,   setManualPrinter]   = useState('');

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
      setPrintersError('Could not reach server. Start it first with the one-liner below.');
    } finally {
      setPrintersLoading(false);
    }
  };

  const downloadPs1 = () => {
    if (!activePrinter) return;
    const blob = new Blob([generatePs1(activePrinter)], { type: 'text/plain' });
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
      <p className="text-sm text-gray-500 mb-6">
        By default the bookmarklet opens a print dialog each time. Follow these steps to print
        silently to a specific printer with no dialog.
      </p>

      <ol className="space-y-6 text-sm text-gray-700">

        {/* Step 1 — Node.js */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">1</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">
              Install Node.js <span className="font-normal text-gray-500">(skip if already installed)</span>
            </p>
            <p>
              Download the <strong>LTS</strong> version from{' '}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-blue-600 underline">nodejs.org</a>{' '}
              and run the installer. Confirm it worked by opening a Command Prompt and typing:
            </p>
            <code className="block mt-2 bg-gray-100 px-3 py-1.5 rounded font-mono text-xs">node --version</code>
            <p className="mt-1 text-gray-500">You should see something like <code className="bg-gray-100 px-1 rounded">v20.x.x</code>.</p>
          </div>
        </li>

        {/* Step 2 — Download */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">2</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Download the print server files</p>
            <p>
              Go to the{' '}
              <a
                href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels"
                target="_blank" rel="noreferrer"
                className="text-blue-600 underline"
              >
                GitHub repository
              </a>
              , click <strong>Code → Download ZIP</strong>, and unzip it somewhere on your computer
              (e.g. your Desktop). You'll use the <code className="bg-gray-100 px-1 rounded">print-server/</code> folder
              and <code className="bg-gray-100 px-1 rounded">setup.ps1</code> inside.
            </p>
          </div>
        </li>

        {/* Step 3 — Pick printer + download PS1 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div className="w-full">
            <p className="font-semibold text-gray-800 mb-3">Pick your printer &amp; download your startup script</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Option A */}
              <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                <p className="font-semibold text-purple-800 mb-2 text-xs uppercase tracking-wide">
                  Option A — Pick from this page
                </p>
                <p className="text-gray-600 mb-3 text-xs">
                  Start the server once (no printer needed yet), then click "List Printers" to see what's available.
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
                {printersError && (
                  <p className="text-red-600 text-xs mt-1">{printersError}</p>
                )}
                {printers && printers.length === 0 && (
                  <p className="text-gray-500 text-xs mt-1">No printers found.</p>
                )}
                {printers && printers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {printers.map(name => (
                      <button
                        key={name}
                        onClick={() => { setSelectedPrinter(name); setManualPrinter(''); }}
                        className={`px-2 py-1 rounded border font-mono text-xs cursor-pointer transition-colors
                          ${selectedPrinter === name
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-white border-gray-300 hover:bg-gray-100 text-gray-800'
                          }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Option B */}
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <p className="font-semibold text-gray-700 mb-2 text-xs uppercase tracking-wide">
                  Option B — Type name or run setup.ps1
                </p>
                <p className="text-gray-600 mb-3 text-xs">
                  If you know the printer name already, type it below. Or run{' '}
                  <code className="bg-gray-200 px-1 rounded">setup.ps1</code> — it lists and selects
                  printers without needing this page.
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
            <div className="mt-4">
              <button
                onClick={downloadPs1}
                disabled={!activePrinter}
                className={`flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors
                  ${activePrinter
                    ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
              >
                <i className="fa fa-download"></i>
                {activePrinter
                  ? `Download start-print-server.ps1  (for: ${activePrinter})`
                  : 'Select a printer above to enable download'}
              </button>
              {activePrinter && (
                <p className="mt-2 text-xs text-gray-500">
                  Save this file in the same folder as your unzipped repo, then double-click it
                  at the start of each check-in session. It handles everything automatically.
                </p>
              )}
            </div>
          </div>
        </li>

        {/* Step 4 — Test + daily use */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">4</span>
          <div>
            <p className="font-semibold text-gray-800 mb-2">Test the connection</p>
            <button
              onClick={testConnection}
              disabled={connStatus === 'checking'}
              className="bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded"
            >
              {connStatus === 'checking' ? 'Checking...' : 'Test Connection'}
            </button>
            {connStatus === 'connected' && (
              <p className="mt-2 text-green-700 font-semibold">✓ Connected — {connDetail}</p>
            )}
            {connStatus === 'error' && (
              <p className="mt-2 text-red-600 text-xs">{connDetail}</p>
            )}
          </div>
        </li>

      </ol>

      <div className="mt-6 bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-800">
        <strong>Each session:</strong> Double-click <code className="bg-purple-100 px-1 rounded">start-print-server.ps1</code>{' '}
        (or <code className="bg-purple-100 px-1 rounded">setup.ps1</code> if you haven't downloaded one yet).
        Leave the window open in the background. If the server isn't running, the bookmarklet
        falls back to the normal print dialog automatically.
      </div>
    </div>
  );
};
