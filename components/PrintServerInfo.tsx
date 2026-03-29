import React, { useState } from 'react';
import { HEALTH_CHECK_ENDPOINT, HEALTH_CHECK_TIMEOUT, SERVER_VERSION } from '../src/constants';

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

  const downloadInstaller = () => {
    window.open('https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install.bat', '_blank');
  };

  

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-purple-600">
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center flex-wrap gap-2">
        <i className="fa fa-server mr-2 text-purple-600"></i>
        Silent Print Server
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-mono font-normal">
          v{SERVER_VERSION}
        </span>
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        By default the browser opens a print dialog. Use this automatic setup to print silently to your label printer with a single click after each check-in.
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
            <p className="font-semibold text-gray-800 mb-3">Install the print server</p>
            <p className="mb-3">
              Open PowerShell and paste this one-liner:
            </p>
            <div className="bg-gray-900 rounded p-3 font-mono text-xs leading-relaxed overflow-x-auto mb-3">
              <code className="text-green-300">irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex</code>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Or download and double-click <code className="bg-gray-100 px-1 rounded text-xs">install.bat</code> instead:
            </p>
            <button
              onClick={downloadInstaller}
              className="flex items-center gap-2 font-bold text-sm px-5 py-2.5 rounded shadow transition-colors bg-green-600 hover:bg-green-700 text-white cursor-pointer"
            >
              <i className="fa fa-download"></i>
              Download install.bat
            </button>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">2</span>
          <div>
            <p className="font-semibold text-gray-800 mb-3">Run the installer</p>
            <p className="mb-2">Double-click <code className="bg-gray-100 px-1 rounded">install.bat</code> to start the setup.</p>
            <p className="mb-3 text-gray-600">The installer will automatically:</p>
            <ul className="list-disc list-inside text-gray-600 space-y-1 mb-3">
              <li>Install Node.js if needed</li>
              <li>Download the project files</li>
              <li>Install dependencies (~300 MB, one time only)</li>
              <li>Ask you to choose your label printer</li>
              <li>Ask for your church's check-in URL</li>
              <li>Create an <strong>"Awana Print"</strong> shortcut on your desktop</li>
              <li>Start the server and open Edge at the check-in page</li>
            </ul>
            <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
              <strong>After setup:</strong> Just double-click the "Awana Print" icon on your desktop.
              No installer needed again unless updating.
            </p>
          </div>
        </li>

        {/* Step 3 - Install Extension */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div>
            <p className="font-semibold text-gray-800 mb-3">Install the browser extension</p>
            <p className="mb-3 text-gray-600">
              The extension provides the most reliable "zero-click" experience and survives page reloads.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded p-4 text-xs">
              <p className="font-bold text-blue-800 mb-2">How to install (Developer Mode):</p>
              <ol className="list-decimal list-inside space-y-1.5 text-blue-700">
                <li>Open <code className="bg-white/50 px-1 rounded">edge://extensions</code> or <code className="bg-white/50 px-1 rounded">chrome://extensions</code></li>
                <li>Turn on <strong>Developer Mode</strong> (top right)</li>
                <li>Click <strong>Load unpacked</strong></li>
                <li>Select the <code className="bg-white/50 px-1 rounded">chrome-extension</code> folder in the project directory</li>
              </ol>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              Once installed, the KVBC Print widget will automatically appear on the check-in page!
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

      {/* ── Optional: CSV enrichment ──────────────────────────────────────── */}
      <div className="mt-8 border-t border-gray-200 pt-6">
        <h3 className="text-base font-bold text-gray-700 mb-1 flex items-center gap-2">
          <i className="fa fa-table text-purple-500"></i>
          Optional: Enhanced Labels with <code className="font-mono text-purple-700 bg-purple-50 px-1 rounded">clubbers.csv</code>
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Drop a <code className="bg-gray-100 px-1 rounded text-xs">clubbers.csv</code> file into the same folder as{' '}
          <code className="bg-gray-100 px-1 rounded text-xs">install-and-run.ps1</code> to unlock four extra features
          on every printed label.
        </p>

        {/* Feature tiles */}
        <div className="grid grid-cols-2 gap-2 mb-5 text-xs">
          <div className="bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
            <i className="fa fa-exclamation-triangle text-red-500 mt-0.5 flex-shrink-0"></i>
            <div>
              <strong className="text-red-700 block mb-0.5">Allergy strip</strong>
              <span className="text-gray-600">Red bar at bottom of label — NUTS, DAIRY, GLUTEN, EGG, SHELLFISH detected automatically</span>
            </div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2 flex items-start gap-2">
            <i className="fa fa-birthday-cake text-yellow-500 mt-0.5 flex-shrink-0"></i>
            <div>
              <strong className="text-yellow-700 block mb-0.5">Birthday banner</strong>
              <span className="text-gray-600">Red "Happy Birthday!" line printed when a birthday falls within the next 7 days</span>
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded p-2 flex items-start gap-2">
            <i className="fa fa-book text-blue-500 mt-0.5 flex-shrink-0"></i>
            <div>
              <strong className="text-blue-700 block mb-0.5">Handbook group</strong>
              <span className="text-gray-600">Small line below the club name (e.g. "Sparks Group A")</span>
            </div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded p-2 flex items-start gap-2">
            <i className="fa fa-user-plus text-green-500 mt-0.5 flex-shrink-0"></i>
            <div>
              <strong className="text-green-700 block mb-0.5">New visitor safe</strong>
              <span className="text-gray-600">Unknown names print a basic label — no crash, no missing labels</span>
            </div>
          </div>
        </div>

        {/* CSV format example */}
        <p className="text-xs font-semibold text-gray-700 mb-1">
          Required column names (header row must match exactly):
        </p>
        <div className="bg-gray-900 rounded p-3 font-mono text-xs leading-relaxed overflow-x-auto mb-4">
          <div className="text-gray-500 mb-1">// Save as clubbers.csv alongside install-and-run.ps1</div>
          <div className="text-green-300">FirstName,LastName,Birthdate,Allergies,HandbookGroup</div>
          <div className="text-gray-300">Alice,Smith,2018-03-15,peanut allergy,Cubbies A</div>
          <div className="text-gray-300">Bob,Jones,2019-07-22,,T&amp;T Group B</div>
          <div className="text-gray-300">Carol,White,05/12/2020,dairy and tree nut,</div>
        </div>

        {/* Column reference table */}
        <table className="w-full text-xs border-collapse mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left p-2 border border-gray-200 font-semibold">Column</th>
              <th className="text-left p-2 border border-gray-200 font-semibold">Format</th>
              <th className="text-left p-2 border border-gray-200 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-2 border border-gray-200 font-mono text-purple-700">FirstName</td>
              <td className="p-2 border border-gray-200">Text</td>
              <td className="p-2 border border-gray-200">Matched case-insensitively against the check-in name</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="p-2 border border-gray-200 font-mono text-purple-700">LastName</td>
              <td className="p-2 border border-gray-200">Text</td>
              <td className="p-2 border border-gray-200">Matched case-insensitively against the check-in name</td>
            </tr>
            <tr>
              <td className="p-2 border border-gray-200 font-mono text-purple-700">Birthdate</td>
              <td className="p-2 border border-gray-200">
                <code className="bg-gray-100 px-1 rounded">YYYY-MM-DD</code>{' '}or{' '}
                <code className="bg-gray-100 px-1 rounded">MM/DD/YYYY</code>
              </td>
              <td className="p-2 border border-gray-200">Leave blank if unknown — no crash</td>
            </tr>
            <tr className="bg-gray-50">
              <td className="p-2 border border-gray-200 font-mono text-purple-700">Allergies</td>
              <td className="p-2 border border-gray-200">Free text</td>
              <td className="p-2 border border-gray-200">
                Detected keywords: <em>nut / peanut, dairy / milk / lactose, gluten / wheat, egg, shellfish / shrimp / crab</em>
              </td>
            </tr>
            <tr>
              <td className="p-2 border border-gray-200 font-mono text-purple-700">HandbookGroup</td>
              <td className="p-2 border border-gray-200">Free text</td>
              <td className="p-2 border border-gray-200">Displayed below club name; truncated at 30 characters</td>
            </tr>
          </tbody>
        </table>

        <div className="bg-green-50 border border-green-200 rounded p-3 text-xs text-green-800">
          <strong>Live-event safe:</strong> The server re-reads <code className="bg-green-100 px-1 rounded">clubbers.csv</code> on
          every check-in so you can update it mid-event. If the file is missing, locked (being saved by Excel), or
          malformed, the server silently falls back to basic labels and keeps running — it will never crash the print server.
        </div>
      </div>

      {/* ── Summary ───────────────────────────────────────────────────────── */}
      <div className="mt-6 bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-800">
        <strong>That's it!</strong> Once configured, silent printing is automatic. Each time a child checks in,
        a label prints directly to your configured printer with no dialog. If the server isn't running,
        the extension falls back to a normal print dialog automatically.
      </div>
    </div>
  );
};

