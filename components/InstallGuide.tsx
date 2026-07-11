import React, { useState } from 'react';
import { HEALTH_CHECK_ENDPOINT, HEALTH_CHECK_TIMEOUT } from '../src/constants';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const INSTALL_CMD = "powershell -ExecutionPolicy Bypass -Command 'irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex'";

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <li className="relative pl-14">
    <span className="absolute left-0 top-0 w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center font-black text-sm shadow">{n}</span>
    <h3 className="font-bold text-slate-900 mb-2 pt-1.5">{title}</h3>
    <div className="text-sm text-slate-600 space-y-3">{children}</div>
  </li>
);

export const InstallGuide: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const testConnection = async () => {
    setConnStatus('checking');
    setConnDetail('');
    try {
      const res = await fetch(HEALTH_CHECK_ENDPOINT, { signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT) });
      const data = await res.json();
      setConnStatus('connected');
      setConnDetail(`v${data.version} — printer: ${data.printer}`);
    } catch {
      setConnStatus('error');
      setConnDetail('Server not reachable — make sure the Awana Check In window is open on this computer.');
    }
  };

  return (
    <section id="install" className="max-w-4xl mx-auto px-4 py-20">
      <h2 className="text-3xl font-black text-slate-900 text-center tracking-tight">Install in 5 minutes</h2>
      <p className="text-slate-500 text-center mt-2 mb-4">
        Windows PC + any thermal label printer with 4×2 in labels. Node.js is installed for you.
      </p>
      <p className="text-xs text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 mb-12 max-w-2xl mx-auto">
        <strong>Independent tool:</strong> not affiliated with or endorsed by TwoTimTwo.com — a
        community-built companion that works alongside their check-in system.
      </p>

      <ol className="space-y-12">
        <Step n={1} title="Install the print server">
          <p>Open PowerShell and paste this command:</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 block bg-slate-900 text-brand-200 rounded-lg px-4 py-3 font-mono text-xs leading-relaxed overflow-x-auto">
              {INSTALL_CMD}
            </code>
            <button
              onClick={copyCmd}
              className="shrink-0 px-4 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 text-sm font-semibold transition-colors"
              title="Copy command"
            >
              <i className={`fa ${copied ? 'fa-check text-brand-600' : 'fa-copy'}`}></i>
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Prefer a file? <a className="text-brand-700 font-semibold hover:underline" href="https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install.bat" target="_blank" rel="noopener noreferrer">Download install.bat</a> and double-click it instead.
          </p>
          <p>
            The installer sets up Node.js and the server, asks for your label printer and church
            check-in URL, and creates an <strong>“Awana Check In”</strong> desktop shortcut. From then
            on that shortcut is all you touch — it checks for updates on every launch.
          </p>
        </Step>

        <Step n={2} title="Load the browser extension">
          <p>
            <a href="chrome-extension.zip" download className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow transition-colors">
              <i className="fa fa-download"></i> Download chrome-extension.zip
            </a>
            <span className="ml-3 text-xs text-slate-400">and extract it to a folder</span>
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs space-y-1.5">
            <p className="font-bold text-slate-700 mb-1">Then, in Edge or Chrome:</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-600">
              <li>Open <code className="bg-white px-1 rounded border border-slate-200">edge://extensions</code> or <code className="bg-white px-1 rounded border border-slate-200">chrome://extensions</code></li>
              <li>Turn on <strong>Developer Mode</strong> (top right)</li>
              <li>Click <strong>Load unpacked</strong> and pick the extracted <code className="bg-white px-1 rounded border border-slate-200">chrome-extension</code> folder</li>
            </ol>
          </div>
          <p className="text-xs text-slate-500">
            Ran the installer already? The folder is also at <code className="bg-slate-100 px-1 rounded">C:\output\Print-TwoTimTwo-Labels\chrome-extension</code>.
            The green <strong>Awana Print</strong> widget appears on your check-in page once it's loaded.
          </p>
        </Step>

        <Step n={3} title="Enrich labels from your roster (automatic)">
          <p>
            The extension syncs your TwoTimTwo roster to the server on every visit, which unlocks
            allergy icons, birthday cakes, handbook groups and the no-photo flag. You can also drop a{' '}
            <code className="bg-slate-100 px-1 rounded">clubbers.csv</code> next to the server with these columns:
          </p>
          <div className="overflow-x-auto">
            <code className="block bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-xs whitespace-nowrap">
              FirstName, LastName, Birthdate, Allergies, HandbookGroup, MedRelease
            </code>
          </div>
          <p className="text-xs text-slate-500">
            <strong>MedRelease</strong> is y/n — a “n” prints a crossed-out camera on that child’s label
            so volunteers know not to photograph them. Unknown kids still get a basic label; nothing ever crashes.
          </p>
        </Step>

        <Step n={4} title="Test the connection">
          <p>With the server running on this computer, verify everything is wired up:</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={testConnection}
              disabled={connStatus === 'checking'}
              className="bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2.5 rounded-lg transition-colors"
            >
              {connStatus === 'checking' ? 'Checking…' : 'Test Connection'}
            </button>
            {connStatus === 'connected' && (
              <span className="text-brand-700 font-semibold text-sm"><i className="fa fa-circle-check mr-1.5"></i>Connected — {connDetail}</span>
            )}
            {connStatus === 'error' && (
              <span className="text-red-600 text-xs max-w-sm">{connDetail}</span>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Then scroll down to the <a href="#simulator" className="text-brand-700 font-semibold hover:underline">simulator</a> and
            click a child — a real label should print.
          </p>
        </Step>
      </ol>
    </section>
  );
};
