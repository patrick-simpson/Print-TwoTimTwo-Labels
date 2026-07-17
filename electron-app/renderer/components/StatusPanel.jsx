import React, { useState, useEffect } from 'react';

const SERVER = 'http://localhost:3456';

export default function StatusPanel({ config, onReset }) {
  const [health, setHealth]         = useState(null);   // /health JSON or null
  const [healthErr, setHealthErr]   = useState(false);
  const [serverState, setServerState] = useState(null); // main-process view (load failure, update)
  const [lanAddress, setLanAddress] = useState(null);
  const [testState, setTestState]   = useState('idle'); // idle | printing | ok | error
  const [fwState, setFwState]       = useState('idle'); // idle | working | ok | error

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
  const updateReady = serverState?.update?.downloaded;
  const updateAvailable = health?.latestVersion && health.latestVersion !== health.version;
  const csv = health?.csv;
  const warnings = health?.warnings || [];

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logoRow}>
          <span style={s.logo}>🖨️</span>
          <div>
            <h1 style={s.title}>Awana Label Printer</h1>
            {failed
              ? <span style={s.badgeBad}>● Server NOT running</span>
              : <span style={s.badge}>● Server running{health?.version ? ` — v${health.version}` : ''}</span>}
          </div>
        </div>
      </div>

      {/* Server-failure detail: never hide a broken server */}
      {serverState?.status === 'failed' && (
        <div style={s.errorCard}>
          <b>The print server failed to start — labels cannot print.</b>
          <pre style={s.errorPre}>{String(serverState.error || '').split('\n')[0]}</pre>
          <span style={s.errorHint}>Send a screenshot of this window to your administrator.</span>
        </div>
      )}

      {/* Update ready */}
      {updateReady && (
        <div style={s.updateCard}>
          <span>Update v{updateReady} is ready.</span>
          <button style={s.updateBtn} onClick={() => window.awana.installUpdate()}>Restart to update</button>
        </div>
      )}
      {!updateReady && updateAvailable && (
        <div style={s.updateCard}>
          <span>Version {health.latestVersion} is available — downloading in the background.</span>
        </div>
      )}

      {/* Status card */}
      <div style={s.card}>
        <Row label="Printer"  value={health?.printer || config.printerName} />
        <Row label="Server"   value={SERVER} mono />
        <Row label="Check-in" value={config.checkinUrl} small />
        <Row label="Roster"   value={csv ? `${csv.count} clubbers${csv.updatedAt ? ` — updated ${timeAgo(csv.updatedAt)}` : ''}` : '—'} />
        {lanAddress && (
          <Row label="Phones" value={`http://${lanAddress}:3456/phone`} mono small />
        )}
      </div>

      {/* Health warnings from the server (printer offline, stale CSV, …) */}
      {warnings.length > 0 && (
        <div style={s.warnCard}>
          {warnings.map((w, i) => <div key={i} style={s.warnRow}>⚠ {w.message || w.type}</div>)}
        </div>
      )}

      {/* Actions */}
      <div style={s.actions}>
        <button style={s.primaryBtn} onClick={() => window.awana.openCheckinPage(config.checkinUrl)}>
          Open Check-in Page
        </button>

        <button
          style={s.outlineBtn}
          onClick={printTestLabel}
          disabled={testState === 'printing' || failed}
        >
          {testState === 'printing' ? 'Printing…'
           : testState === 'ok'     ? '✓ Test label sent'
           : testState === 'error'  ? '✗ Test print failed'
           : 'Print Test Label'}
        </button>

        <button
          style={s.outlineBtn}
          onClick={enablePhone}
          disabled={fwState === 'working'}
          title="Adds a Windows Firewall rule (asks for administrator approval) so phones on your Wi-Fi can reach phone check-in"
        >
          {fwState === 'working' ? 'Waiting for approval…'
           : fwState === 'ok'    ? '✓ Phone check-in enabled'
           : fwState === 'error' ? '✗ Not enabled'
           : 'Enable Phone Check-in (firewall)'}
        </button>

        <button style={s.ghostBtn} onClick={onReset}>
          Change Settings
        </button>
      </div>

      <p style={s.hint}>
        Close this window — the server keeps running in the system tray.
      </p>
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
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <span style={{ ...s.rowValue, ...(mono ? s.mono : {}), ...(small ? s.small : {}) }}>
        {value}
      </span>
    </div>
  );
}

const PURPLE = '#5c2d91';

const s = {
  page:       { fontFamily: 'Segoe UI, Arial, sans-serif', padding: '20px 24px', backgroundColor: '#f4f4f8', minHeight: '100vh', boxSizing: 'border-box' },
  header:     { marginBottom: '18px' },
  logoRow:    { display: 'flex', alignItems: 'center', gap: '12px' },
  logo:       { fontSize: '32px' },
  title:      { margin: 0, fontSize: '20px', fontWeight: '700', color: '#1a1a2e' },
  badge:      { fontSize: '12px', color: '#27ae60', fontWeight: '600' },
  badgeBad:   { fontSize: '12px', color: '#c0392b', fontWeight: '700' },
  errorCard:  { backgroundColor: '#fdecea', border: '1px solid #f5c6cb', borderRadius: '8px', padding: '12px 14px', marginBottom: '14px', fontSize: '12px', color: '#7a1f1a' },
  errorPre:   { whiteSpace: 'pre-wrap', margin: '8px 0', fontSize: '11px', fontFamily: 'Consolas, monospace' },
  errorHint:  { fontSize: '11px', color: '#a94442' },
  updateCard: { backgroundColor: '#eef4ff', border: '1px solid #c9dcff', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '12px', color: '#1f3f7a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' },
  updateBtn:  { padding: '6px 10px', backgroundColor: PURPLE, color: '#fff', border: 'none', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' },
  card:       { backgroundColor: '#fff', borderRadius: '10px', padding: '4px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.09)', marginBottom: '14px' },
  warnCard:   { backgroundColor: '#fff8e1', border: '1px solid #ffe1a8', borderRadius: '8px', padding: '8px 14px', marginBottom: '14px' },
  warnRow:    { fontSize: '12px', color: '#8a6d1a', padding: '2px 0' },
  row:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' },
  rowLabel:   { fontSize: '12px', fontWeight: '600', color: '#888', minWidth: '70px' },
  rowValue:   { fontSize: '13px', color: '#333', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '320px', whiteSpace: 'nowrap' },
  mono:       { fontFamily: 'Consolas, monospace', fontSize: '12px' },
  small:      { fontSize: '11px' },
  actions:    { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' },
  primaryBtn: { padding: '10px', backgroundColor: PURPLE, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  outlineBtn: { padding: '9px', backgroundColor: '#fff', color: '#333', border: '1px solid #ccc', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  ghostBtn:   { padding: '8px', backgroundColor: 'transparent', color: '#888', border: 'none', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' },
  hint:       { fontSize: '11px', color: '#bbb', textAlign: 'center', margin: 0 }
};
