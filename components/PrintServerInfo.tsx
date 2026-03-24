import React, { useState } from 'react';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

export const PrintServerInfo: React.FC = () => {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');

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

  const downloadScript = () => {
    // Trigger download of install-and-run.ps1 from the repo
    const scriptUrl = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1';
    const a = document.createElement('a');
    a.href = scriptUrl;
    a.download = 'install-and-run.ps1';
    a.click();
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-purple-600">
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center">
        <i className="fa fa-server mr-2 text-purple-600"></i>
        Silent Print Server
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        By default the bookmarklet opens a print dialog. Use this automatic setup to print silently
        to your label printer with a single click after each check-in.
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
            <p className="font-semibold text-gray-800 mb-3">Download the setup script</p>
            <p className="mb-3">
              Click the button below to download <code className="bg-gray-100 px-1 rounded">install-and-run.ps1</code>.
              This is the only file you need — it handles everything automatically.
            </p>
            <button
              onClick={downloadScript}
              className="flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors bg-green-600 hover:bg-green-700 text-white cursor-pointer"
            >
              <i className="fa fa-download"></i>
              Download install-and-run.ps1
            </button>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">2</span>
          <div>
            <p className="font-semibold text-gray-800 mb-3">Run the script</p>
            <p className="mb-2">Right-click <code className="bg-gray-100 px-1 rounded">install-and-run.ps1</code> and select <strong>"Run with PowerShell"</strong>.</p>
            <p className="mb-3 text-gray-600">The script will automatically:</p>
            <ul className="list-disc list-inside text-gray-600 space-y-1 mb-3">
              <li>Install Node.js if needed</li>
              <li>Download the project files</li>
              <li>Install dependencies (~300 MB, one time only)</li>
              <li>Ask you to choose your label printer</li>
              <li>Ask for your church's check-in URL</li>
              <li>Start the server and open Edge at the check-in page</li>
            </ul>
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
              <strong>Tip:</strong> After the first run, the script remembers your printer and URL.
              Future runs will auto-start in 5 seconds — press any key to reconfigure.
            </p>
          </div>
        </li>

        {/* Step 3 - Optional Test */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div>
            <p className="font-semibold text-gray-800 mb-2">Test the connection <span className="font-normal text-gray-500">(optional)</span></p>
            <p className="text-gray-600 mb-3">Once the server is running, click below to verify everything is working.</p>
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
        <strong>That's it!</strong> Once configured, silent printing is automatic. Each time a child checks in,
        a label prints directly to your configured printer with no dialog. If the server isn't running,
        the bookmarklet falls back to a normal print dialog automatically.
      </div>
    </div>
  );
};
