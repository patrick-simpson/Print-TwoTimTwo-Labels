import React, { useState } from 'react';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

export const PrintServerInfo: React.FC = () => {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError, setPrintersError] = useState('');
  const [copiedPrinter, setCopiedPrinter] = useState('');

  const testConnection = async () => {
    setConnStatus('checking');
    setConnDetail('');
    try {
      const res = await fetch('http://localhost:3456/health', { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      setConnStatus('connected');
      setConnDetail(`Printer: ${data.printer}`);
    } catch {
      setConnStatus('error');
      setConnDetail('Server not reachable — make sure node server.js is running.');
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
      // pdf-to-printer returns an array of objects with a `name` field, or plain strings
      const names: string[] = data.map((p: any) => (typeof p === 'string' ? p : p.name || p.deviceId || JSON.stringify(p)));
      setPrinters(names);
    } catch (e: any) {
      setPrintersError(e.message || 'Could not reach server');
    } finally {
      setPrintersLoading(false);
    }
  };

  const copyPrinter = (name: string) => {
    navigator.clipboard.writeText(name);
    setCopiedPrinter(name);
    setTimeout(() => setCopiedPrinter(''), 2000);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md mb-8 border-l-4 border-purple-600">
      <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center">
        <i className="fa fa-server mr-2 text-purple-600"></i>
        Optional: Silent Print Server
      </h2>
      <p className="text-sm text-gray-500 mb-5">
        By default the bookmarklet opens a print dialog. Follow these steps to print silently
        to a specific printer with no dialog at all.
      </p>

      <ol className="space-y-5 text-sm text-gray-700">

        {/* Step 1 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">1</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Install Node.js <span className="font-normal text-gray-500">(skip if already installed)</span></p>
            <p>
              Download the <strong>LTS</strong> version from{' '}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-blue-600 underline">nodejs.org</a>{' '}
              and run the installer. Afterwards, open a <strong>Terminal</strong> (Mac) or{' '}
              <strong>Command Prompt</strong> (Windows) and confirm it works:
            </p>
            <code className="block mt-2 bg-gray-100 px-3 py-1.5 rounded font-mono text-xs">node --version</code>
            <p className="mt-1 text-gray-500">You should see something like <code className="bg-gray-100 px-1 rounded">v20.x.x</code>.</p>
          </div>
        </li>

        {/* Step 2 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">2</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Download the print server</p>
            <p>
              The <code className="bg-gray-100 px-1 rounded">print-server/</code> folder is included in{' '}
              <a href="https://github.com/patrick-simpson/Print-TwoTimTwo-Labels" target="_blank" rel="noreferrer" className="text-blue-600 underline">
                this repository
              </a>.
              Click <strong>Code → Download ZIP</strong>, unzip it, and open the <code className="bg-gray-100 px-1 rounded">print-server</code> folder inside.
            </p>
          </div>
        </li>

        {/* Step 3 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">3</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Install dependencies</p>
            <p>Open a Terminal / Command Prompt <em>inside</em> the <code className="bg-gray-100 px-1 rounded">print-server</code> folder and run:</p>
            <code className="block mt-2 bg-gray-100 px-3 py-1.5 rounded font-mono text-xs">npm install</code>
            <p className="mt-1 text-gray-500">This takes a few minutes the first time — it downloads a ~300 MB bundled browser used for rendering labels.</p>
          </div>
        </li>

        {/* Step 4 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">4</span>
          <div>
            <p className="font-semibold text-gray-800 mb-2">Find your printer's exact name</p>
            <p className="mb-2">Start the server first (Step 5 below), then click this button to see every printer installed on this computer:</p>
            <button
              onClick={listPrinters}
              disabled={printersLoading}
              className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded"
            >
              {printersLoading ? 'Loading...' : 'List Printers'}
            </button>
            {printersError && <p className="mt-2 text-red-600 text-xs">{printersError} — make sure node server.js is running first.</p>}
            {printers && printers.length === 0 && <p className="mt-2 text-gray-500 text-xs">No printers found.</p>}
            {printers && printers.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {printers.map(name => (
                  <button
                    key={name}
                    onClick={() => copyPrinter(name)}
                    title="Click to copy"
                    className="bg-gray-100 hover:bg-gray-200 border border-gray-300 px-2 py-1 rounded font-mono text-xs cursor-pointer"
                  >
                    {copiedPrinter === name ? '✓ Copied!' : name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </li>

        {/* Step 5 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">5</span>
          <div>
            <p className="font-semibold text-gray-800 mb-1">Start the server</p>
            <p className="mb-2">In the same Terminal, run the command for your OS — replacing the printer name with yours from Step 4:</p>
            <div className="space-y-2">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Windows</p>
                <code className="block bg-gray-100 px-3 py-1.5 rounded font-mono text-xs break-all">
                  set PRINTER_NAME=DYMO LabelWriter 450 &amp;&amp; node server.js
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Mac / Linux</p>
                <code className="block bg-gray-100 px-3 py-1.5 rounded font-mono text-xs break-all">
                  PRINTER_NAME="DYMO LabelWriter 450" node server.js
                </code>
              </div>
            </div>
            <p className="mt-2 text-gray-500">You should see: <code className="bg-gray-100 px-1 rounded">Awana Print Server running at http://localhost:3456</code></p>
          </div>
        </li>

        {/* Step 6 */}
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-xs">6</span>
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
              <p className="mt-2 text-green-700 font-semibold text-sm">✓ Connected — {connDetail}</p>
            )}
            {connStatus === 'error' && (
              <p className="mt-2 text-red-600 text-xs">{connDetail}</p>
            )}
            {connStatus === 'connected' && (
              <p className="mt-2 text-gray-600">
                You're all set! Arm the bookmarklet on the check-in page — the badge will flash{' '}
                <strong className="text-green-700">Printed!</strong> after each label instead of opening a dialog.
              </p>
            )}
          </div>
        </li>

      </ol>

      <div className="mt-6 bg-purple-50 border border-purple-200 rounded p-3 text-sm text-purple-800">
        <strong>Every check-in session:</strong> Open a Terminal in the <code className="bg-purple-100 px-1 rounded">print-server</code> folder
        and run <code className="bg-purple-100 px-1 rounded">node server.js</code> before you start checking children in.
        The Terminal window can stay in the background — it uses almost no resources while idle.
        If the server isn't running, the bookmarklet automatically falls back to the normal print dialog.
      </div>
    </div>
  );
};
