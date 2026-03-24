import React, { useState } from 'react';
import { HEALTH_CHECK_ENDPOINT, HEALTH_CHECK_TIMEOUT } from '../src/constants';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

export const PrintServerInfo: React.FC = () => {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');

  const testConnection = async () => {
    setConnStatus('checking');
    setConnDetail('');
    try {
      const res = await fetch(HEALTH_CHECK_ENDPOINT, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT) });
      const data = await res.json();
      setConnStatus('connected');
      setConnDetail(`Printer: ${data.printer}`);
    } catch {
      setConnStatus('error');
      setConnDetail('Server not reachable — make sure the server is running first.');
    }
  };

  const [scriptStatus, setScriptStatus] = useState('');

  const copyScriptToClipboard = async () => {
    try {
      const scriptUrl = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1';
      const response = await fetch(scriptUrl);
      const scriptText = await response.text();
      await navigator.clipboard.writeText(scriptText);
      setScriptStatus('✓ Script copied to clipboard!');
      setTimeout(() => setScriptStatus(''), 3000);
    } catch (err) {
      setScriptStatus('✗ Failed to copy. Try manually downloading from GitHub.');
      setTimeout(() => setScriptStatus(''), 3000);
    }
  };

  const openBookmarklet = () => {
    window.open('http://localhost:3456/bookmarklet.html', 'awana_bookmarklet', 'width=600,height=800');
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
            <p className="font-semibold text-gray-800 mb-3">Get the setup script</p>
            <p className="mb-3">
              Click the button below to copy the install script to your clipboard.
              Then paste it into PowerShell to run it.
            </p>
            <button
              onClick={copyScriptToClipboard}
              className="flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors bg-green-600 hover:bg-green-700 text-white cursor-pointer"
            >
              <i className="fa fa-copy"></i>
              Copy Script to Clipboard
            </button>
            {scriptStatus && (
              <p className={`mt-2 text-sm ${scriptStatus.startsWith('✓') ? 'text-green-700' : 'text-red-600'}`}>
                {scriptStatus}
              </p>
            )}
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

        {/* Step 3 - Install Bookmarklet */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div>
            <p className="font-semibold text-gray-800 mb-3">Create the auto-print bookmarklet</p>
            <p className="mb-3 text-gray-600">
              A bookmarklet is a tiny button that runs print detection on the check-in page. No installation needed!
            </p>
            <button
              onClick={openBookmarklet}
              className="flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors bg-blue-600 hover:bg-blue-700 text-white cursor-pointer mb-4"
            >
              <i className="fa fa-bookmark"></i>
              Create Bookmarklet
            </button>
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
              <strong>Quick setup:</strong> Click the button above, then drag the "Drag to Bookmark Bar" button to your bookmark bar. Done! Now just click it on the check-in page.
            </p>
          </div>
        </li>

        {/* Step 4 - Optional Test */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">4</span>
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
