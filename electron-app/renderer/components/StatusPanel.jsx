import React, { useState, useEffect } from 'react';
import BrandHeader from './BrandHeader.jsx';
import CornerTab from './CornerTab.jsx';
import StepChip from './StepChip.jsx';

const SERVER = 'http://localhost:3456';

export default function StatusPanel({ config, onReset }) {
  const [health, setHealth]         = useState(null);   // /health JSON or null
  const [healthErr, setHealthErr]   = useState(false);
  const [serverState, setServerState] = useState(null); // main-process view (load failure, update)
  const [lanAddress, setLanAddress] = useState(null);
  const [testState, setTestState]   = useState('idle'); // idle | printing | ok | error
  const [fwState, setFwState]       = useState('idle'); // idle | working | ok | error
  const [starting, setStarting]     = useState(false);  // Start Server button
  const [checking, setChecking]     = useState(false);  // Check for Updates button
  const [checkNote, setCheckNote]   = useState('');     // result of an explicit check

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        if (alive) { setHealth(data); setHealthErr(data.status !== 'ok'); }
      } catch {
        if (alive) { setHealth(null); setHealthErr(true); }
      }
      try {
        const st = await window.awana.getServerState();
        if (alive) setServerState(st);
      } catch { /* older main process */ }
    }
    poll();
    const t = setInterval(poll, 5000);
    window.awana.getLanAddress?.().then(a => { if (alive) setLanAddress(a); });
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function printTestLabel() {
    setTestState('printing');
    try {
      const res = await fetch(`${SERVER}/canary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(30000)
      });
      const data = await res.json();
      const printStage = (data.stages || []).find(st => st.stage === 'print');
      setTestState(printStage?.passed ? 'ok' : 'error');
    } catch {
      setTestState('error');
    }
    setTimeout(() => setTestState('idle'), 5000);
  }

  async function startServerNow() {
    setStarting(true);
    try { await window.awana.startServer?.(); } catch { /* older main process */ }
    // Give the port a moment to bind, then let the next health poll repaint.
    await new Promise(r => setTimeout(r, 1200));
    try {
      const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      setHealth(data); setHealthErr(data.status !== 'ok');
    } catch { /* still down — the failed card stays up */ }
    setStarting(false);
  }

  async function checkForUpdatesNow() {
    setChecking(true);
    setCheckNote('');
    try {
      const r = await window.awana.checkForUpdates?.();
      if (r) {
        setServerState(st => ({ ...(st || {}), update: r }));
        if (r.supported === false) setCheckNote('Automatic updates only run in the installed app.');
        else if (r.upToDate) setCheckNote('You have the newest version.');
        else if (!r.available && !r.downloaded) setCheckNote('Could not reach the update server — check your internet connection.');
      }
    } catch { setCheckNote('Update check failed.'); }
    setChecking(false);
  }

  async function enablePhone() {
    setFwState('working');
    try {
      const r = await window.awana.enablePhoneCheckin();
      setFwState(r?.ok ? 'ok' : 'error');
    } catch {
      setFwState('error');
    }
    setTimeout(() => setFwState('idle'), 6000);
  }

  const failed = serverState?.status === 'failed' || (healthErr && !health);
  const upd = serverState?.update || {};
  const updateReady = upd.downloaded;
  const updateAvailable = upd.available
    || (health?.latestVersion && health.latestVersion !== health.version ? health.latestVersion : null);
  const appVersion = serverState?.version || health?.version;
  const csv = health?.csv;
  const warnings = health?.warnings || [];

  // Same rule as the dashboard's header chip: PROBLEM when a warning means
  // nothing is coming out of the printer.
  const printerProblem = warnings.some(w => w && (w.type === 'printerNotFound' || w.type === 'spoolerBacklog'));
  const chip = failed ? { value: 'OFFLINE', plate: 'var(--bad)' }
    : printerProblem ? { value: 'PROBLEM', plate: 'var(--c-hot-deep)' }
    : { value: 'ONLINE', plate: 'var(--c-plate)' };

  return (
    <div className="app">
      <BrandHeader
        sub={failed ? 'Server NOT running' : `Server running${health?.version ? ` · v${health.version}` : ''}`}
        subTone={failed ? 'bad' : ''}
      >
        <StepChip label="PRINTER" value={chip.value} plate={chip.plate} />
      </BrandHeader>

      <main className="app-body">

        {/* Server down: never hide it, and give the one-click way back up */}
        {failed && (
          <div className="notice bad" role="alert">
            <b>The print server is not running — labels cannot print.</b>
            {serverState?.status === 'failed' && (
              <pre>{String(serverState.error || '').split('\n')[0]}</pre>
            )}
            <button className="btn btn-go btn-block" style={{ marginTop: 10 }} onClick={startServerNow} disabled={starting}>
              {starting ? 'Starting…' : '▶ Start Server'}
            </button>
            {serverState?.status === 'failed' && (
              <div className="notice-hint">If it won't start, send a screenshot of this window to your administrator.</div>
            )}
          </div>
        )}

        {/* Updates: always visible, always says where the updater is */}
        {updateReady ? (
          <div className="notice update">
            <span>Update v{updateReady} is downloaded and ready.</span>
            <button className="btn btn-primary btn-sm" onClick={() => window.awana.installUpdate()}>Restart to update</button>
          </div>
        ) : updateAvailable ? (
          <div className="notice update">
            <span>
              Version {updateAvailable} is available — downloading
              {upd.percent != null ? ` (${upd.percent}%)` : ' in the background'}…
            </span>
          </div>
        ) : (
          <div className="notice update">
            <span>
              {appVersion ? `Version ${appVersion}` : 'Version …'}
              {checkNote ? ` — ${checkNote}` : upd.upToDate ? ' — ✓ up to date' : ''}
            </span>
            <button className="btn btn-sm" onClick={checkForUpdatesNow} disabled={checking}>
              {checking ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
        )}

        {/* Status card */}
        <div className="card">
          <CornerTab>This PC</CornerTab>
          <div className="card-pad">
            <Row label="Printer"  value={health?.printer || config.printerName} />
            <Row label="Server"   value={SERVER} mono />
            <Row label="Check-in" value={config.checkinUrl} small />
            <Row label="Roster"   value={csv ? `${csv.count} clubbers${csv.updatedAt ? ` — updated ${timeAgo(csv.updatedAt)}` : ''}` : '—'} />
            {lanAddress && (
              <Row label="Phones" value={`http://${lanAddress}:3456/phone`} mono small />
            )}
          </div>
        </div>

        {/* Health warnings from the server (printer offline, stale CSV, …) */}
        {warnings.length > 0 && (
          <div className="card">
            <CornerTab tone="t-sun">Warnings</CornerTab>
            <div className="card-pad">
              {warnings.map((w, i) => <div key={i} className="warn-row">⚠ {w.message || w.type}</div>)}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="actions">
          <button className="btn btn-hot btn-block" onClick={() => window.awana.openCheckinPage(config.checkinUrl)}>
            Open Check-in Page
          </button>

          <button
            className="btn"
            onClick={printTestLabel}
            disabled={testState === 'printing' || failed}
          >
            {testState === 'printing' ? 'Printing…'
             : testState === 'ok'     ? '✓ Test label sent'
             : testState === 'error'  ? '✗ Test print failed'
             : 'Print Test Label'}
          </button>

          <button
            className="btn"
            onClick={enablePhone}
            disabled={fwState === 'working'}
            title="Adds a Windows Firewall rule (asks for administrator approval) so phones on your Wi-Fi can reach phone check-in"
          >
            {fwState === 'working' ? 'Waiting for approval…'
             : fwState === 'ok'    ? '✓ Phone check-in enabled'
             : fwState === 'error' ? '✗ Not enabled'
             : 'Enable Phone Check-in (firewall)'}
          </button>

          <button className="btn btn-ghost" onClick={onReset}>
            Change Settings
          </button>
        </div>

        <p className="hint">
          Close this window — the server keeps running in the system tray.
        </p>
      </main>
    </div>
  );
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

function Row({ label, value, mono, small }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className={`row-value${mono ? ' mono' : ''}${small ? ' small' : ''}`} title={typeof value === 'string' ? value : undefined}>
        {value}
      </span>
    </div>
  );
}
