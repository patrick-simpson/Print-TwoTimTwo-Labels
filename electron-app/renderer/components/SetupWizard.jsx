import React, { useState, useEffect } from 'react';
import BrandHeader from './BrandHeader.jsx';
import CornerTab from './CornerTab.jsx';

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
    // Only the keys this wizard owns — the main process merges them into the
    // config on disk, so the server-owned keys (PIN, Pusher credentials,
    // schedule) survive. It hands back the merged result to render from.
    const result = await window.awana.saveConfig(config);
    if (result?.success) {
      onSaved(result.config || config);
    } else {
      setError('Failed to save settings. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="app">
      <BrandHeader sub="First-time setup" />

      <main className="app-body">
        <div className="card">
          <CornerTab>Set up this PC</CornerTab>
          <div className="card-pad">

            {/* Printer */}
            <label className="field-label" htmlFor="setup-printer">Label Printer</label>
            {printers === null ? (
              <p className="field-hint">Detecting printers…</p>
            ) : printers.length > 0 ? (
              <select
                id="setup-printer"
                value={printerName}
                onChange={e => setPrinterName(e.target.value)}
                className="field"
              >
                {printers.map((p, i) => {
                  const name = typeof p === 'string' ? p : p.name;
                  return <option key={i} value={name}>{name}</option>;
                })}
              </select>
            ) : (
              <input
                id="setup-printer"
                value={printerName}
                onChange={e => setPrinterName(e.target.value)}
                className="field"
                placeholder="Enter printer name exactly as it appears in Windows"
                spellCheck={false}
              />
            )}
            <p className="field-hint">Choose your label printer (e.g. DYMO LabelWriter, Brother QL)</p>

            {/* URL */}
            <label className="field-label" htmlFor="setup-url">Check-in URL</label>
            <input
              id="setup-url"
              value={checkinUrl}
              onChange={e => setCheckinUrl(e.target.value)}
              className="field"
              placeholder="https://yourchurch.twotimtwo.com/clubber/checkin?#"
              spellCheck={false}
            />
            <p className="field-hint">Your church's TwoTimTwo check-in page URL</p>

            {/* Auto-start */}
            <label className="check-row">
              <input
                type="checkbox"
                checked={launchOnBoot}
                onChange={e => setLaunchOnBoot(e.target.checked)}
              />
              <span>Start automatically when this PC turns on</span>
            </label>
            <p className="field-hint">Recommended — the printer is ready before the first family arrives.</p>

            {error && <p className="form-error" role="alert">{error}</p>}

            <button
              onClick={handleSave}
              disabled={saving || printers === null}
              className="btn btn-hot btn-block wizard-go"
            >
              {saving ? 'Starting server…' : 'Save & Start'}
            </button>
          </div>
        </div>

        <p className="footer-note">
          If Windows asks about network access after saving, click <b>Allow</b> —
          that's what lets phones on your Wi-Fi use phone check-in.
        </p>
      </main>
    </div>
  );
}
