import React, { useState } from 'react';

export default function StatusPanel({ config, onReset }) {
  const [testState, setTestState] = useState('idle'); // idle | checking | ok | error

  async function testConnection() {
    setTestState('checking');
    try {
      const data = await window.awana.pingServer();
      setTestState(data?.status === 'ok' ? 'ok' : 'error');
    } catch {
      setTestState('error');
    }
    setTimeout(() => setTestState('idle'), 4000);
  }

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logoRow}>
          <span style={s.logo}>🖨️</span>
          <div>
            <h1 style={s.title}>Awana Label Printer</h1>
            <span style={s.badge}>● Server running</span>
          </div>
        </div>
      </div>

      {/* Status card */}
      <div style={s.card}>
        <Row label="Printer"    value={config.printerName} />
        <Row label="Server"     value="http://localhost:3456" mono />
        <Row label="Check-in"   value={config.checkinUrl} small />
      </div>

      {/* Actions */}
      <div style={s.actions}>
        <button style={s.primaryBtn} onClick={() => window.awana.openCheckinPage(config.checkinUrl)}>
          Open Check-in Page
        </button>

        <button
          style={s.outlineBtn}
          onClick={testConnection}
          disabled={testState === 'checking'}
        >
          {testState === 'checking' ? 'Checking…'
           : testState === 'ok'     ? '✓ Connected'
           : testState === 'error'  ? '✗ Not reachable'
           : 'Test Connection'}
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
  card:       { backgroundColor: '#fff', borderRadius: '10px', padding: '4px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.09)', marginBottom: '16px' },
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
