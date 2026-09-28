import React, { useState } from 'react';
import { HEALTH_CHECK_ENDPOINT, HEALTH_CHECK_TIMEOUT } from '../src/constants';
import { Icon } from './family/Icons';

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const INSTALLER_URL = 'https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/releases/latest/download/Club-Label-Printer-Setup.exe';
const LEGACY_INSTALL_CMD = "powershell -ExecutionPolicy Bypass -Command 'irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex'";

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <li className="lbl-install__step">
    <span className="lbl-install__num" aria-hidden="true">{n}</span>
    <h3 className="lbl-install__title"><span className="fam-sr">Step {n}: </span>{title}</h3>
    <div className="lbl-install__body">{children}</div>
  </li>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="lbl-code">{children}</code>
);

export const InstallGuide: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('idle');
  const [connDetail, setConnDetail] = useState('');

  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(LEGACY_INSTALL_CMD);
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
      setConnDetail('Server not reachable — make sure the Club Label Printer window is open on this computer.');
    }
  };

  return (
    <section id="install" className="lbl-part" aria-labelledby="install-title">
      <div className="fam-wrap">
        <div className="lbl-part__head">
          <p className="fam-kicker">Install</p>
          <h2 className="lbl-part__title" id="install-title">Set it up in a few minutes</h2>
          <p className="lbl-part__lede">
            A Windows PC and any thermal label printer that takes 4×2 inch labels. One installer, with no
            Node.js and no scripts.
          </p>
          <p className="lbl-note">
            <Icon name="shield" className="lbl-note__icon" />
            <span><strong>An independent tool.</strong> Club Label Printer is not affiliated with or endorsed by
            TwoTimTwo.com. It is a companion made by a church that works alongside their check-in system.</span>
          </p>
        </div>

        <ol className="lbl-install">
          <Step n={1} title="Install the app">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a href={INSTALLER_URL} className="fam-btn"><Icon name="download" />Download Club Label Printer for Windows</a>
              <span className="text-step--1 text-ink-3">then run the downloaded file</span>
            </p>
            <div className="lbl-note lbl-note--block">
              <p><strong>Windows may show a blue “Windows protected your PC” screen.</strong></p>
              <p>
                That’s SmartScreen being cautious about a new community app. Click{' '}
                <strong>More info</strong>, then <strong>Run anyway</strong>. It only happens on the first install.
              </p>
            </div>
            <p>
              The print server starts the moment the app opens, even before setup is finished. The
              one-page setup asks you to pick your label printer, confirm your church’s check-in address,
              and click <strong>Save &amp; Start</strong>. The app then lives in the system tray (near
              the clock), starts automatically when the PC boots, prints a test label on demand, and{' '}
              <strong>updates itself</strong>, so there are no installers to re-run.
            </p>
            <p className="lbl-small">
              Server not running for any reason? Launch <strong>Club Label Printer</strong> from the desktop
              or Start menu again: every launch checks the server and starts it if it’s down. There’s also a{' '}
              <strong>Start print server</strong> button in the tray menu and in Settings.
            </p>
            <p className="lbl-small">
              If Windows asks about network access after setup, click <strong>Allow</strong>. That’s what lets
              phones on your Wi-Fi use phone check-in, once you turn it on and set a PIN.
            </p>
            <details className="fam-hood lbl-legacy">
              <summary><svg className="fam-hood__chev" aria-hidden="true" focusable="false"><use href="#i-chev" /></svg>Previous install method (PowerShell script, deprecated)</summary>
              <div className="fam-hood__body">
                <p>
                  Existing script installs at <Code>C:\output</Code> keep working and are imported
                  automatically the first time you run the new app. To install the old way anyway, paste this
                  into PowerShell:
                </p>
                <div className="lbl-cmd">
                  <code className="lbl-cmd__text">{LEGACY_INSTALL_CMD}</code>
                  <button type="button" onClick={copyCmd} className="lbl-cmd__copy" aria-label={copied ? 'Copied' : 'Copy command'}>
                    <Icon name={copied ? 'check' : 'copy'} />
                  </button>
                </div>
              </div>
            </details>
          </Step>

          <Step n={2} title="Load the browser extension">
            <p>
              The app already installed the extension’s files for you. You just have to point your browser
              at them <em>once</em>.
            </p>
            <div className="lbl-note lbl-note--block">
              <p><strong>In Edge or Chrome:</strong></p>
              <ol className="lbl-olist">
                <li>Open <Code>edge://extensions</Code> or <Code>chrome://extensions</Code></li>
                <li>Turn on <strong>Developer Mode</strong> (top right)</li>
                <li>Click <strong>Load unpacked</strong> and pick <Code>%APPDATA%\awana-label-printer\chrome-extension</Code></li>
              </ol>
              <p className="lbl-small">
                Can’t find it? The tray menu has <strong>Open Chrome extension folder</strong>, and the
                dashboard’s <strong>Diagnostics</strong> tab has a <strong>Copy folder path</strong> button.
              </p>
            </div>
            <div className="lbl-note lbl-note--block lbl-note--accent">
              <p><strong>Why that folder and not a download</strong></p>
              <p>
                The app rewrites that folder every time it starts, so when the app updates itself the
                extension updates with it. Just <strong>restart Chrome</strong> to pick it up, and the widget
                tells you when one is owed. A copy you download and unzip somewhere else never updates, and
                quietly drifts behind the print server.
              </p>
            </div>
            <p className="lbl-small">
              The green <strong>Club Print</strong> widget appears on your check-in page once it’s loaded.
              (Old script installs have the folder at <Code>C:\output\Print-TwoTimTwo-Labels\chrome-extension</Code>;{' '}
              <a href="chrome-extension.zip" download>the zip</a> is still there for anyone not using the
              Windows app.)
            </p>
          </Step>

          <Step n={3} title="Enrich labels from your roster (automatic)">
            <p>
              The extension syncs your TwoTimTwo roster to the print server on every visit, which unlocks
              allergy icons, birthday cakes, handbook groups and the no-photo flag. You can also drop a{' '}
              <Code>clubbers.csv</Code> next to the server with these columns:
            </p>
            <div className="lbl-scroll" tabIndex={0} role="region" aria-label="CSV columns">
              <Code>FirstName, LastName, Birthdate, Allergies, HandbookGroup, MedRelease</Code>
            </div>
            <p className="lbl-small">
              A “no” in <strong>MedRelease</strong> (or TwoTimTwo’s photo-release column) prints a crossed-out
              camera on that child’s label, so volunteers know not to photograph them. Unknown children still
              get a basic label; nothing ever crashes.
            </p>
          </Step>

          <Step n={4} title="Test the connection">
            <p>With the app running on this computer, check that everything is wired up:</p>
            <div className="flex items-center gap-x-4 gap-y-3 flex-wrap">
              <button
                type="button"
                onClick={testConnection}
                disabled={connStatus === 'checking'}
                className="fam-btn fam-btn--ghost disabled:opacity-60 disabled:cursor-wait"
              >
                {connStatus === 'checking' ? 'Checking…' : 'Test Connection'}
              </button>
              <span role="status" className="min-w-0">
                {connStatus === 'connected' && (
                  <span className="lbl-conn lbl-conn--ok"><Icon name="check" />Connected: {connDetail}</span>
                )}
                {connStatus === 'error' && (
                  <span className="lbl-conn lbl-conn--err"><Icon name="alarm" />{connDetail}</span>
                )}
              </span>
            </div>
            <p className="lbl-small">
              Then open your church’s TwoTimTwo check-in page in Chrome and check a child in. A real label
              should print. (The dashboard’s test label works too.)
            </p>
          </Step>
        </ol>
      </div>
    </section>
  );
};
