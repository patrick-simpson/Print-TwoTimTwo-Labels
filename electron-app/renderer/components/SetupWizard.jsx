import React, { useState, useEffect } from 'react';

const DEFAULT_URL = 'https://kvbchurch.twotimtwo.com/clubber/checkin?#';

export default function SetupWizard({ onSaved }) {
  const [printers, setPrinters]       = useState(null);  // null = still loading
  const [printerName, setPrinterName] = useState('');
  const [checkinUrl, setCheckinUrl]   = useState(DEFAULT_URL);
  const [launchOnBoot, setLaunchOnBoot] = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    window.awana.getPrinters().then(list => {
      setPrinters(list);
      if (list.length > 0) {
        const first = typeof list[0] === 'string' ? list[0] : list[0].name;
        setPrinterName(first);
      }
    }).catch(() => setPrinters([]));
    // Pre-fill from any existing (partial) config — including data migrated
    // from an old script install (printer + URL carry over automatically).
    window.awana.getConfig().then(cfg => {
      if (cfg?.checkinUrl) setCheckinUrl(cfg.checkinUrl);
      if (cfg?.printerName) setPrinterName(cfg.printerName);
      if (cfg?.launchOnBoot === false) setLaunchOnBoot(false);
    });
  }, []);

  async function handleSave() {
    if (!printerName) { setError('Please select a printer.'); return; }
    if (!checkinUrl)  { setError('Please enter a check-in URL.'); return; }
    setSaving(true);
    setError('');
    const config = { printerName, checkinUrl, launchOnBoot };
    const result = await window.awana.saveConfig(config);
    if (result?.success) {
      onSaved(config);
    } else {
      setError('Failed to save settings. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logoRow}>
          <span style={s.logo}>🖨️</span>
          <div>
            <h1 style={s.title}>Awana Label Printer</h1>
            <p style={s.subtitle}>First-time setup</p>
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={s.card}>

        {/* Printer */}
        <label style={s.label}>Label Printer</label>
        {printers === null ? (
          <p style={s.loading}>Detecting printers…</p>
        ) : printers.length > 0 ? (
          <select
            value={printerName}
            onChange={e => setPrinterName(e.target.value)}
            style={s.select}
          >
            {printers.map((p, i) => {
              const name = typeof p === 'string' ? p : p.name;
              return <option key={i} value={name}>{name}</option>;
            })}
          </select>
        ) : (
          <input
            value={printerName}
            onChange={e => setPrinterName(e.target.value)}
            style={s.input}
            placeholder="Enter printer name exactly as it appears in Windows"
            spellCheck={false}
          />
        )}
        <p style={s.hint}>Choose your label printer (e.g. DYMO LabelWriter, Brother QL)</p>

        {/* URL */}
        <label style={s.label}>Check-in URL</label>
        <input
          value={checkinUrl}
          onChange={e => setCheckinUrl(e.target.value)}
          style={s.input}
          placeholder="https://yourchurch.twotimtwo.com/clubber/checkin?#"
          spellCheck={false}
        />
        <p style={s.hint}>Your church's TwoTimTwo check-in page URL</p>

        {/* Auto-start */}
        <label style={s.checkboxRow}>
          <input
            type="checkbox"
            checked={launchOnBoot}
            onChange={e => setLaunchOnBoot(e.target.checked)}
          />
          <span style={s.checkboxText}>Start automatically when this PC turns on</span>
        </label>
        <p style={s.hint}>Recommended — the printer is ready before the first family arrives.</p>

        {error && <p style={s.error}>{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving || printers === null}
          style={saving || printers === null ? { ...s.btn, ...s.btnDisabled } : s.btn}
        >
          {saving ? 'Starting server…' : 'Save & Start'}
        </button>
      </div>

      <p style={s.footer}>
        If Windows asks about network access after saving, click <b>Allow</b> —
        that's what lets phones on your Wi-Fi use phone check-in.
      </p>
    </div>
  );
}

const PURPLE = '#5c2d91';

const s = {
  page:      { fontFamily: 'Segoe UI, Arial, sans-serif', padding: '20px 24px', backgroundColor: '#f4f4f8', minHeight: '100vh', boxSizing: 'border-box' },
  header:    { marginBottom: '18px' },
  logoRow:   { display: 'flex', alignItems: 'center', gap: '12px' },
  logo:      { fontSize: '32px' },
  title:     { margin: 0, fontSize: '20px', fontWeight: '700', color: '#1a1a2e' },
  subtitle:  { margin: '2px 0 0', fontSize: '13px', color: '#666' },
  card:      { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.09)' },
  label:     { display: 'block', fontWeight: '600', fontSize: '13px', color: '#333', marginBottom: '6px' },
  select:    { width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '13px', marginBottom: '4px', boxSizing: 'border-box', backgroundColor: '#fff' },
  input:     { width: '100%', padding: '8px 10px', borderRadius: '5px', border: '1px solid #ccc', fontSize: '12px', marginBottom: '4px', boxSizing: 'border-box' },
  hint:      { margin: '0 0 16px', fontSize: '11px', color: '#999' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', cursor: 'pointer' },
  checkboxText: { fontSize: '13px', color: '#333', fontWeight: '600' },
  loading:   { fontSize: '12px', color: '#999', margin: '0 0 16px' },
  error:     { fontSize: '12px', color: '#c0392b', marginBottom: '12px' },
  btn:       { width: '100%', padding: '11px', backgroundColor: PURPLE, color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' },
  btnDisabled: { backgroundColor: '#b0b0b0', cursor: 'not-allowed' },
  footer:    { marginTop: '14px', fontSize: '11px', color: '#888', textAlign: 'center' }
};
